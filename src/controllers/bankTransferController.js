const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Bank Transfer (Contra Entry)
const createTransfer = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId;
        const { fromAccountId, toAccountId, amount, date, reference, description } = req.body;

        // Validation
        if (!fromAccountId || !toAccountId || !amount || !date) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }

        if (fromAccountId === toAccountId) {
            return res.status(400).json({ success: false, message: 'Source and Destination accounts cannot be the same' });
        }

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID missing. Please log in again.' });
        }

        // Create Transaction
        // Debit the Receiver (To Account), Credit the Giver (From Account)
        // Note: In Prisma, if we provide the FK ID directly (debitLedgerId), we don't need 'connect'.
        // However, we MUST ensure companyId is valid and correct types are passed.
        const transaction = await prisma.transaction.create({
            data: {
                date: new Date(date),
                amount: parseFloat(amount),
                narration: description,
                voucherType: 'CONTRA',
                voucherNumber: reference || `CNTR-${Date.now()}`,

                // Relations via ID
                debitLedgerId: parseInt(toAccountId),
                creditLedgerId: parseInt(fromAccountId),
                companyId: parseInt(companyId),
                updatedAt: new Date()
            },
            include: {
                ledger_transaction_debitLedgerIdToledger: true,
                ledger_transaction_creditLedgerIdToledger: true
            }
        });

        // Update Balances
        // 1. From Account (Credit) -> Decrease Balance (Asset) or Increase (Liability)?
        // Use generic update: Credit entry decreases Asset balance.
        // We can use the service or direct update. Let's do direct for speed but careful.
        // Actually, let's reuse the chartOfAccountsService logic if possible, or replicate it carefully.
        // Asset/Expense: Dr (+), Cr (-)
        // Liability/Income/Equity: Dr (-), Cr (+)

        // Helper to update balance safely
        const updateBalance = async (ledgerId, amount, type) => {
            const ledger = await prisma.ledger.findUnique({ where: { id: ledgerId }, include: { accountgroup: true } });

            let adjust = 0;
            const isAssetExp = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);

            if (isAssetExp) {
                // Asset: Dr increases, Cr decreases
                adjust = type === 'DEBIT' ? amount : -amount;
            } else {
                // Liability: Cr increases, Dr decreases
                adjust = type === 'CREDIT' ? amount : -amount;
            }

            await prisma.ledger.update({
                where: { id: ledgerId },
                data: { currentBalance: { increment: adjust } }
            });
        };

        await updateBalance(parseInt(fromAccountId), parseFloat(amount), 'CREDIT');
        await updateBalance(parseInt(toAccountId), parseFloat(amount), 'DEBIT');

        res.status(201).json({ success: true, data: transaction, message: 'Transfer created successfully' });

    } catch (error) {
        console.error('Error creating transfer:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Transfers
const getTransfers = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.query.companyId || req.body.companyId;

        const transfers = await prisma.transaction.findMany({
            where: {
                companyId: companyId,
                voucherType: 'CONTRA'
            },
            include: {
                ledger_transaction_debitLedgerIdToledger: { select: { id: true, name: true } },
                ledger_transaction_creditLedgerIdToledger: { select: { id: true, name: true } }
            },
            orderBy: { date: 'desc' }
        });

        // Format for UI
        const formatted = transfers.map(t => ({
            id: t.id,
            date: t.date,
            fromAccount: t.ledger_transaction_creditLedgerIdToledger, // Giver
            toAccount: t.ledger_transaction_debitLedgerIdToledger,   // Receiver
            amount: t.amount,
            reference: t.voucherNumber,
            description: t.narration
        }));

        res.status(200).json({ success: true, data: formatted });
    } catch (error) {
        console.error('Error fetching transfers:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Transfer By ID
const getTransferById = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.query.companyId || req.body.companyId;
        const { id } = req.params;

        const transfer = await prisma.transaction.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId,
                voucherType: 'CONTRA'
            },
            include: {
                ledger_transaction_debitLedgerIdToledger: true,
                ledger_transaction_creditLedgerIdToledger: true
            }
        });

        if (!transfer) {
            return res.status(404).json({ success: false, message: 'Transfer not found' });
        }

        res.status(200).json({ success: true, data: transfer });
    } catch (error) {
        console.error('Error fetching transfer:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Transfer
const updateTransfer = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId || req.query.companyId;
        const { id } = req.params;
        const { fromAccountId, toAccountId, amount, date, reference, description } = req.body;

        const existing = await prisma.transaction.findFirst({
            where: { id: parseInt(id), companyId: companyId }
        });

        if (!existing) return res.status(404).json({ success: false, message: 'Transfer not found' });

        // Reverse old balances
        const revertBalance = async (ledgerId, amount, type) => {
            const ledger = await prisma.ledger.findUnique({ where: { id: ledgerId }, include: { accountgroup: true } });
            const isAssetExp = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);

            // Reversing: If it was DEBIT, we CREDIT (and vice versa) to undo
            // So we treat it as the OPPOSITE type for the adjustment
            let adjust = 0;
            if (isAssetExp) {
                // Undo Debit (increase) -> Decrease
                // Undo Credit (decrease) -> Increase
                adjust = type === 'DEBIT' ? -amount : amount;
            } else {
                // Undo Credit (increase) -> Decrease
                // Undo Debit (decrease) -> Increase
                adjust = type === 'CREDIT' ? -amount : amount;
            }

            await prisma.ledger.update({
                where: { id: ledgerId },
                data: { currentBalance: { increment: adjust } }
            });
        };

        // Revert stats of OLD transaction
        await revertBalance(existing.creditLedgerId, existing.amount, 'CREDIT');
        await revertBalance(existing.debitLedgerId, existing.amount, 'DEBIT');

        // Apply new Transaction
        const updated = await prisma.transaction.update({
            where: { id: parseInt(id) },
            data: {
                date: new Date(date),
                debitLedgerId: parseInt(toAccountId),
                creditLedgerId: parseInt(fromAccountId),
                amount: parseFloat(amount),
                narration: description,
                voucherNumber: reference
            }
        });

        // Apply new balances
        const applyBalance = async (ledgerId, amount, type) => {
            const ledger = await prisma.ledger.findUnique({ where: { id: ledgerId }, include: { accountgroup: true } });
            const isAssetExp = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);
            let adjust = 0;
            if (isAssetExp) {
                adjust = type === 'DEBIT' ? amount : -amount;
            } else {
                adjust = type === 'CREDIT' ? amount : -amount;
            }
            await prisma.ledger.update({
                where: { id: ledgerId },
                data: { currentBalance: { increment: adjust } }
            });
        };

        await applyBalance(parseInt(fromAccountId), parseFloat(amount), 'CREDIT');
        await applyBalance(parseInt(toAccountId), parseFloat(amount), 'DEBIT');

        res.status(200).json({ success: true, data: updated, message: 'Transfer updated successfully' });

    } catch (error) {
        console.error('Error updating transfer:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Transfer
const deleteTransfer = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId || req.query.companyId;
        const { id } = req.params;

        const existing = await prisma.transaction.findFirst({
            where: { id: parseInt(id), companyId: companyId }
        });

        if (!existing) return res.status(404).json({ success: false, message: 'Transfer not found' });

        // Revert balances
        const revertBalance = async (ledgerId, amount, type) => {
            const ledger = await prisma.ledger.findUnique({ where: { id: ledgerId }, include: { accountgroup: true } });
            const isAssetExp = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);
            let adjust = 0;
            if (isAssetExp) {
                adjust = type === 'DEBIT' ? -amount : amount;
            } else {
                adjust = type === 'CREDIT' ? -amount : amount;
            }
            await prisma.ledger.update({
                where: { id: ledgerId },
                data: { currentBalance: { increment: adjust } }
            });
        };

        await revertBalance(existing.creditLedgerId, existing.amount, 'CREDIT');
        await revertBalance(existing.debitLedgerId, existing.amount, 'DEBIT');

        // Delete
        await prisma.transaction.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ success: true, message: 'Transfer deleted successfully' });

    } catch (error) {
        console.error('Error deleting transfer:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTransfer,
    getTransfers,
    getTransferById,
    updateTransfer,
    deleteTransfer
};
