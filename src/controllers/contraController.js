const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Contra Voucher
const createContra = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const { date, sourceAccountId, items, manualReceiptNo, mainNarration, signature, logo } = req.body;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });
        if (!date || !sourceAccountId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please fill all required fields' });
        }

        // Generate Auto Receipt No
        const getAutoReceiptNo = async (companyId) => {
            const count = await prisma.transaction.count({
                where: { companyId, voucherType: 'CONTRA' }
            });
            return `CNT-${String(count + 1).padStart(3, '0')}`;
        };

        const autoReceiptNo = await getAutoReceiptNo(companyId);

        const transactions = [];

        for (const item of items) {
            // Construct narration with delimiter '|'
            const combinedNarration = ((mainNarration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            // Transaction Logic:
            // Source (Credit): The account money is coming FROM (e.g. Cash withdrawn from Bank -> Bank is Source)
            // Destination (Debit): The account money is going TO (e.g. Cash Account)

            // Wait, usually "Paid From" implies Credit. 
            // So 'sourceAccountId' = Credit Ledger (Outgoing Money)
            // 'items.accountId' = Debit Ledger (Incoming Money)

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'CONTRA',
                    voucherNumber: autoReceiptNo,
                    creditLedgerId: parseInt(sourceAccountId), // Outgoing
                    debitLedgerId: parseInt(item.accountId),   // Incoming
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature || null,
                    logo: logo || null
                }
            });

            // Update Balances
            // 1. Credit Source (Decrease Asset)
            // Contra is strictly between Asset/Liability accounts (Cash/Bank). 
            // If Asset: Credit decreases. If Bank OD (Liability): Credit Increases (more debt).
            // We need to check types dynamically to be safe, though usually it's Asset logic.

            const sourceLedger = await prisma.ledger.findUnique({ where: { id: parseInt(sourceAccountId) }, include: { accountgroup: true } });
            let creditAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(sourceLedger.accountgroup.type)) {
                creditAdjust = -parseFloat(item.amount); // Decrease Asset
            } else {
                creditAdjust = parseFloat(item.amount); // Increase Liability (OD)
            }
            await prisma.ledger.update({
                where: { id: parseInt(sourceAccountId) },
                data: { currentBalance: { increment: creditAdjust } }
            });

            // 2. Debit Destination (Increase Asset)
            const destLedger = await prisma.ledger.findUnique({ where: { id: parseInt(item.accountId) }, include: { accountgroup: true } });
            let debitAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(destLedger.accountgroup.type)) {
                debitAdjust = parseFloat(item.amount); // Increase Asset
            } else {
                debitAdjust = -parseFloat(item.amount); // Decrease Liability (pay off OD)
            }
            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: debitAdjust } }
            });

            transactions.push(transaction);
        }

        res.status(201).json({ success: true, message: 'Contra voucher created', data: transactions });

    } catch (error) {
        console.error('Error creating contra:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Contra
const getContra = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const transactions = await prisma.transaction.findMany({
            where: { companyId: parseInt(companyId), voucherType: 'CONTRA' },
            include: {
                ledger_transaction_debitLedgerIdToledger: true,
                ledger_transaction_creditLedgerIdToledger: true
            },
            orderBy: { date: 'desc' }
        });

        const grouped = {};

        transactions.forEach(t => {
            if (!grouped[t.voucherNumber]) {
                grouped[t.voucherNumber] = {
                    transactions: []
                };
            }
            grouped[t.voucherNumber].transactions.push(t);
        });

        const result = Object.values(grouped).map(group => {
            const txs = group.transactions;
            const firstTx = txs[0];

            const manualRefMatch = firstTx.narration && firstTx.narration.match(/\(Ref: (.*?)\)/);
            const manualReceiptNo = manualRefMatch ? manualRefMatch[1] : '';

            const cleanNarrations = txs.map(t =>
                t.narration ? t.narration.replace(/\s*\(Ref: .*?\)/, '').trim() : ''
            );

            let mainNarration = '';
            let items = [];

            const hasDelimiter = cleanNarrations.every(n => n.includes('|'));

            if (hasDelimiter) {
                const parts = cleanNarrations[0].split('|');
                mainNarration = parts[0].trim();

                items = txs.map((t, index) => {
                    const parts = cleanNarrations[index].split('|');
                    return {
                        accountId: t.debitLedgerId, // Destination (Debit)
                        amount: t.amount,
                        narration: parts.slice(1).join('|').trim()
                    };
                });
            } else {
                // Fallback LCP
                mainNarration = cleanNarrations[0] || '';
                for (let i = 1; i < cleanNarrations.length; i++) {
                    let j = 0;
                    while (j < mainNarration.length && j < cleanNarrations[i].length && mainNarration[j] === cleanNarrations[i][j]) {
                        j++;
                    }
                    mainNarration = mainNarration.substring(0, j);
                }
                mainNarration = mainNarration.trim();

                items = txs.map((t, index) => {
                    const clean = cleanNarrations[index];
                    let specificNarration = clean.substring(mainNarration.length).trim();
                    return {
                        accountId: t.debitLedgerId,
                        amount: t.amount,
                        narration: specificNarration
                    };
                });
            }

            return {
                id: firstTx.id,
                date: firstTx.date,
                voucherNumber: firstTx.voucherNumber,
                manualReceiptNo: manualReceiptNo,
                sourceAccount: firstTx.ledger_transaction_creditLedgerIdToledger, // Paid From
                sourceAccountId: firstTx.creditLedgerId,
                accounts: [...new Set(txs.map(t => t.ledger_transaction_debitLedgerIdToledger.name))].join(', '),
                items: items,
                totalAmount: txs.reduce((sum, t) => sum + t.amount, 0),
                mainNarration: mainNarration,
                signature: firstTx.signature,
                logo: firstTx.logo
            };
        });

        res.status(200).json({ success: true, data: result });

    } catch (error) {
        console.error('Error fetching contra:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Contra
const deleteContra = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!voucherNumber.startsWith('CNT-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({
                where: { id: parseInt(voucherNumber) }
            });
            if (transById) voucherNumber = transById.voucherNumber;
        }

        const transactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'CONTRA' }
        });

        if (transactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher not found' });
        }

        for (const t of transactions) {
            // Reverse Credit Source
            const sourceLedger = await prisma.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });
            let reverseCredit = 0;
            if (['ASSETS', 'EXPENSES'].includes(sourceLedger.accountgroup.type)) {
                reverseCredit = t.amount; // Increase back
            } else {
                reverseCredit = -t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { increment: reverseCredit } }
            });

            // Reverse Debit Destination
            const destLedger = await prisma.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
            let reverseDebit = 0;
            if (['ASSETS', 'EXPENSES'].includes(destLedger.accountgroup.type)) {
                reverseDebit = -t.amount; // Decrease back
            } else {
                reverseDebit = t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { increment: reverseDebit } }
            });
        }

        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'CONTRA' }
        });

        res.status(200).json({ success: true, message: 'Contra voucher deleted successfully' });

    } catch (error) {
        console.error('Error deleting contra:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Contra
const updateContra = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const { date, sourceAccountId, items, manualReceiptNo, mainNarration, signature, logo } = req.body;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID required' });

        if (!voucherNumber.startsWith('CNT-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({ where: { id: parseInt(voucherNumber) } });
            if (transById) voucherNumber = transById.voucherNumber;
        }

        const oldTransactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'CONTRA' }
        });

        if (oldTransactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Contra voucher not found' });
        }

        // Reverse Old
        for (const t of oldTransactions) {
            // Reverse Credit Source
            const sourceLedger = await prisma.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });
            let reverseCredit = 0;
            if (['ASSETS', 'EXPENSES'].includes(sourceLedger.accountgroup.type)) {
                reverseCredit = t.amount;
            } else {
                reverseCredit = -t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { increment: reverseCredit } }
            });

            // Reverse Debit Destination
            const destLedger = await prisma.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
            let reverseDebit = 0;
            if (['ASSETS', 'EXPENSES'].includes(destLedger.accountgroup.type)) {
                reverseDebit = -t.amount;
            } else {
                reverseDebit = t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { increment: reverseDebit } }
            });
        }

        // Delete Old
        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'CONTRA' }
        });

        // Create New
        const transactions = [];
        for (const item of items) {
            const combinedNarration = ((mainNarration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'CONTRA',
                    voucherNumber: voucherNumber,
                    creditLedgerId: parseInt(sourceAccountId),
                    debitLedgerId: parseInt(item.accountId),
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature || null,
                    logo: logo || null
                }
            });

            // Update Balances - New
            const sourceLedger = await prisma.ledger.findUnique({ where: { id: parseInt(sourceAccountId) }, include: { accountgroup: true } });
            let creditAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(sourceLedger.accountgroup.type)) {
                creditAdjust = -parseFloat(item.amount);
            } else {
                creditAdjust = parseFloat(item.amount);
            }
            await prisma.ledger.update({
                where: { id: parseInt(sourceAccountId) },
                data: { currentBalance: { increment: creditAdjust } }
            });

            const destLedger = await prisma.ledger.findUnique({ where: { id: parseInt(item.accountId) }, include: { accountgroup: true } });
            let debitAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(destLedger.accountgroup.type)) {
                debitAdjust = parseFloat(item.amount);
            } else {
                debitAdjust = -parseFloat(item.amount);
            }
            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: debitAdjust } }
            });

            transactions.push(transaction);
        }

        res.status(200).json({ success: true, message: 'Contra updated successfully', data: transactions });

    } catch (error) {
        console.error('Error updating contra:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createContra,
    getContra,
    deleteContra,
    updateContra
};
