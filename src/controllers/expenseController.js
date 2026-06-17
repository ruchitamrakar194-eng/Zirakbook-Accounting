const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Expense Voucher
const createExpense = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const { date, paidFromAccountId, items, manualReceiptNo, narration, paidToVendorId, paidToAccountId, signature, customFields } = req.body;
        
        // Fetch company logo
        const company = await prisma.company.findUnique({
            where: { id: parseInt(companyId) },
            select: { logo: true }
        });
        const companyLogo = company?.logo || null;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }
        if (!date || !paidFromAccountId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please fill all required fields' });
        }

        // Generate Auto Receipt No
        const getAutoReceiptNo = async (companyId) => {
            const count = await prisma.transaction.count({
                where: { companyId, voucherType: 'EXPENSE' }
            });
            return `AUTO-${String(count + 1).padStart(3, '0')}`;
        };

        const autoReceiptNo = await getAutoReceiptNo(companyId);

        const transactions = [];

        for (const item of items) {
            // Construct narration with delimiter '|' to separate Main and Item narration
            const combinedNarration = ((narration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'EXPENSE',
                    voucherNumber: autoReceiptNo,
                    debitLedgerId: parseInt(item.accountId),
                    creditLedgerId: parseInt(paidFromAccountId),
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature,
                    logo: companyLogo,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null
                }
            });

            // Update Balances
            // Debit Expense (Increase Expense)
            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: parseFloat(item.amount) } }
            });

            // Credit Asset (Decrease Asset)
            const fromLedger = await prisma.ledger.findUnique({ where: { id: parseInt(paidFromAccountId) }, include: { accountgroup: true } });

            let creditAdjust = 0;
            const fromType = fromLedger.accountgroup.type;

            if (['ASSETS', 'EXPENSES'].includes(fromType)) {
                creditAdjust = -parseFloat(item.amount); // Decrease Asset
            } else {
                creditAdjust = parseFloat(item.amount); // Increase Liability
            }

            await prisma.ledger.update({
                where: { id: parseInt(paidFromAccountId) },
                data: { currentBalance: { increment: creditAdjust } }
            });

            transactions.push(transaction);
        }

        res.status(201).json({ success: true, message: 'Expense voucher created', data: transactions });

    } catch (error) {
        console.error('Error creating expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Expenses
const getExpenses = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const transactions = await prisma.transaction.findMany({
            where: { companyId: parseInt(companyId), voucherType: 'EXPENSE' },
            include: {
                ledger_transaction_debitLedgerIdToledger: true,
                ledger_transaction_creditLedgerIdToledger: true
            },
            orderBy: { date: 'desc' }
        });

        const grouped = {};

        // 1. Group transactions by voucherNumber
        transactions.forEach(t => {
            if (!grouped[t.voucherNumber]) {
                grouped[t.voucherNumber] = {
                    transactions: []
                };
            }
            grouped[t.voucherNumber].transactions.push(t);
        });

        // 2. Process groups to extract Main Narration vs Item Narration
        const result = Object.values(grouped).map(group => {
            const txs = group.transactions;
            const firstTx = txs[0];

            // Extract common manual receipt no
            const manualRefMatch = firstTx.narration && firstTx.narration.match(/\(Ref: (.*?)\)/);
            const manualReceiptNo = manualRefMatch ? manualRefMatch[1] : '';

            // Clean narrations (remove Ref tag)
            const cleanNarrations = txs.map(t =>
                t.narration ? t.narration.replace(/\s*\(Ref: .*?\)/, '').trim() : ''
            );

            let mainNarration = '';
            let items = [];

            // Strategy 1: Check for delimiter '|'
            const hasDelimiter = cleanNarrations.every(n => n.includes('|'));

            if (hasDelimiter) {
                // Use delimiter splitting
                const parts = cleanNarrations[0].split('|');
                mainNarration = parts[0].trim();

                items = txs.map((t, index) => {
                    const parts = cleanNarrations[index].split('|');
                    return {
                        accountId: t.debitLedgerId,
                        amount: t.amount,
                        narration: parts.slice(1).join('|').trim()
                    };
                });
            } else {
                // Strategy 2: Fallback to LCP
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
                paidFrom: firstTx.ledger_transaction_creditLedgerIdToledger,
                paidFromAccountId: firstTx.creditLedgerId,
                accounts: [...new Set(txs.map(t => t.ledger_transaction_debitLedgerIdToledger.name))].join(', '),
                items: items,
                totalAmount: txs.reduce((sum, t) => sum + t.amount, 0),
                mainNarration: mainNarration,
                signature: firstTx.signature,
                logo: firstTx.logo,
                customFields: firstTx.customFields
            };
        });

        res.status(200).json({ success: true, data: result });

    } catch (error) {
        console.error('Error fetching expenses:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Expense
const deleteExpense = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        // Check if voucherNumber is ID
        if (!voucherNumber.startsWith('AUTO-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({
                where: { id: parseInt(voucherNumber) }
            });
            if (transById) {
                voucherNumber = transById.voucherNumber;
            }
        }

        const transactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'EXPENSE' }
        });

        if (transactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher not found' });
        }

        for (const t of transactions) {
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { decrement: t.amount } }
            });

            const fromLedger = await prisma.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });
            let reverseCredit = 0;
            if (['ASSETS', 'EXPENSES'].includes(fromLedger.accountgroup.type)) {
                reverseCredit = t.amount;
            } else {
                reverseCredit = -t.amount;
            }

            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { increment: reverseCredit } }
            });
        }

        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'EXPENSE' }
        });

        res.status(200).json({ success: true, message: 'Expense voucher deleted successfully' });

    } catch (error) {
        console.error('Error deleting expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Expense
const updateExpense = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const { date, paidFromAccountId, items, manualReceiptNo, mainNarration, signature, customFields } = req.body;

        // Fetch company logo
        const company = await prisma.company.findUnique({
            where: { id: parseInt(companyId) },
            select: { logo: true }
        });
        const companyLogo = company?.logo || null;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID required' });

        if (!voucherNumber.startsWith('AUTO-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({
                where: { id: parseInt(voucherNumber) }
            });
            if (transById) {
                voucherNumber = transById.voucherNumber;
            }
        }

        const oldTransactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'EXPENSE' }
        });

        if (oldTransactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Expense voucher not found' });
        }

        for (const t of oldTransactions) {
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { decrement: t.amount } }
            });
            const fromLedger = await prisma.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });
            let reverseCredit = 0;
            if (['ASSETS', 'EXPENSES'].includes(fromLedger.accountgroup.type)) {
                reverseCredit = t.amount;
            } else {
                reverseCredit = -t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { increment: reverseCredit } }
            });
        }

        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'EXPENSE' }
        });

        const transactions = [];
        for (const item of items) {
            // Construct narration with delimiter '|'
            const combinedNarration = ((mainNarration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'EXPENSE',
                    voucherNumber: voucherNumber, // Keep original voucher number
                    debitLedgerId: parseInt(item.accountId),
                    creditLedgerId: parseInt(paidFromAccountId),
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature,
                    logo: companyLogo,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null
                }
            });

            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: parseFloat(item.amount) } }
            });

            const fromLedger = await prisma.ledger.findUnique({ where: { id: parseInt(paidFromAccountId) }, include: { accountgroup: true } });
            let creditAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(fromLedger.accountgroup.type)) {
                creditAdjust = -parseFloat(item.amount);
            } else {
                creditAdjust = parseFloat(item.amount);
            }
            await prisma.ledger.update({
                where: { id: parseInt(paidFromAccountId) },
                data: { currentBalance: { increment: creditAdjust } }
            });

            transactions.push(transaction);
        }

        res.status(200).json({ success: true, message: 'Expense updated successfully', data: transactions });

    } catch (error) {
        console.error('Error updating expense:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createExpense,
    getExpenses,
    deleteExpense,
    updateExpense
};
