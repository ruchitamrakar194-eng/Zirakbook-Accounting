const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Income Voucher
const createIncome = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const { date, receivedInAccountId, items, manualReceiptNo, narration, mainNarration, signature, logo, customFields } = req.body;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }
        if (!date || !receivedInAccountId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please fill all required fields' });
        }

        // Generate Auto Receipt No
        const getAutoReceiptNo = async (companyId) => {
            const count = await prisma.transaction.count({
                where: { companyId, voucherType: 'INCOME' }
            });
            return `INC-${String(count + 1).padStart(3, '0')}`;
        };

        const autoReceiptNo = await getAutoReceiptNo(companyId);

        const transactions = [];

        for (const item of items) {
            // Construct narration with delimiter '|'
            const combinedNarration = ((mainNarration || narration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            // Transaction Logic:
            // DEBIT: Received In Account (Cash/Bank/Customer) -> Increase Asset
            // CREDIT: Income Account (Row Item) -> Increase Income

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'INCOME',
                    voucherNumber: autoReceiptNo,
                    debitLedgerId: parseInt(receivedInAccountId),
                    creditLedgerId: parseInt(item.accountId),
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature || null,
                    logo: logo || null,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null
                }
            });

            // Update Balances

            // 1. Debit Received In (Asset/Customer)
            // Assets/Expenses increase on Debit. Liabilities/Inc/Equity decrease on Debit.
            // Received In is typically Asset (Cash/Bank/Customer). Make sure to handle if it's not.
            const receivedLedger = await prisma.ledger.findUnique({ where: { id: parseInt(receivedInAccountId) }, include: { accountgroup: true } });
            let debitAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(receivedLedger.accountgroup.type)) {
                debitAdjust = parseFloat(item.amount); // Increase
            } else {
                debitAdjust = -parseFloat(item.amount); // Decrease Liability if receiving into a Liability account? (Rare but possible)
            }

            await prisma.ledger.update({
                where: { id: parseInt(receivedInAccountId) },
                data: { currentBalance: { increment: debitAdjust } }
            });


            // 2. Credit Income Account
            // Income/Liabilities/Equity increase on Credit.
            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: parseFloat(item.amount) } }
            });

            transactions.push(transaction);
        }

        res.status(201).json({ success: true, message: 'Income voucher created', data: transactions });

    } catch (error) {
        console.error('Error creating income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Income
const getIncome = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const transactions = await prisma.transaction.findMany({
            where: { companyId: parseInt(companyId), voucherType: 'INCOME' },
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

            // Strategy 1: Check for delimiter '|'
            const hasDelimiter = cleanNarrations.every(n => n.includes('|'));

            if (hasDelimiter) {
                const parts = cleanNarrations[0].split('|');
                mainNarration = parts[0].trim();

                items = txs.map((t, index) => {
                    const parts = cleanNarrations[index].split('|');
                    return {
                        accountId: t.creditLedgerId, // For Income, items are Credit Ledgers
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
                        accountId: t.creditLedgerId,
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
                receivedIn: firstTx.ledger_transaction_debitLedgerIdToledger, // Debit Side
                receivedInAccountId: firstTx.debitLedgerId,
                accounts: [...new Set(txs.map(t => t.ledger_transaction_creditLedgerIdToledger.name))].join(', '),
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
        console.error('Error fetching income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Income
const deleteIncome = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        // Check if voucherNumber is ID
        if (!voucherNumber.startsWith('INC-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({
                where: { id: parseInt(voucherNumber) }
            });
            if (transById) {
                voucherNumber = transById.voucherNumber;
            }
        }

        const transactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'INCOME' }
        });

        if (transactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Voucher not found' });
        }

        for (const t of transactions) {
            // Reverse Debit (Received In)
            const receivedLedger = await prisma.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
            let reverseDebit = 0;
            if (['ASSETS', 'EXPENSES'].includes(receivedLedger.accountgroup.type)) {
                reverseDebit = -t.amount; // Decrease Asset
            } else {
                reverseDebit = t.amount; // Increase Liability
            }
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { increment: reverseDebit } }
            });

            // Reverse Credit (Income) -> Decrease
            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { decrement: t.amount } }
            });
        }

        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'INCOME' }
        });

        res.status(200).json({ success: true, message: 'Income voucher deleted successfully' });

    } catch (error) {
        console.error('Error deleting income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Income
const updateIncome = async (req, res) => {
    try {
        let { voucherNumber } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const { date, receivedInAccountId, items, manualReceiptNo, mainNarration, signature, logo, customFields } = req.body;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID required' });

        if (!voucherNumber.startsWith('INC-') && !isNaN(voucherNumber)) {
            const transById = await prisma.transaction.findUnique({
                where: { id: parseInt(voucherNumber) }
            });
            if (transById) {
                voucherNumber = transById.voucherNumber;
            }
        }

        const oldTransactions = await prisma.transaction.findMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'INCOME' }
        });

        if (oldTransactions.length === 0) {
            return res.status(404).json({ success: false, message: 'Income voucher not found' });
        }

        // Reverse Old Balances
        for (const t of oldTransactions) {
            // Reverse Debit (Received In)
            const receivedLedger = await prisma.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
            let reverseDebit = 0;
            if (['ASSETS', 'EXPENSES'].includes(receivedLedger.accountgroup.type)) {
                reverseDebit = -t.amount;
            } else {
                reverseDebit = t.amount;
            }
            await prisma.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { increment: reverseDebit } }
            });

            // Reverse Credit (Income)
            await prisma.ledger.update({
                where: { id: t.creditLedgerId },
                data: { currentBalance: { decrement: t.amount } }
            });
        }

        // Delete Old Transactions
        await prisma.transaction.deleteMany({
            where: { voucherNumber, companyId: parseInt(companyId), voucherType: 'INCOME' }
        });

        // Create New Transactions
        const transactions = [];
        for (const item of items) {
            // Construct narration
            const combinedNarration = ((mainNarration || '') + ' | ' + (item.narration || '')).trim() + (manualReceiptNo ? ` (Ref: ${manualReceiptNo})` : '');

            const transaction = await prisma.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'INCOME',
                    voucherNumber: voucherNumber,
                    debitLedgerId: parseInt(receivedInAccountId),
                    creditLedgerId: parseInt(item.accountId),
                    amount: parseFloat(item.amount),
                    narration: combinedNarration,
                    companyId: parseInt(companyId),
                    signature: signature || null,
                    logo: logo || null,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null
                }
            });

            // Update Balances
            const receivedLedger = await prisma.ledger.findUnique({ where: { id: parseInt(receivedInAccountId) }, include: { accountgroup: true } });
            let debitAdjust = 0;
            if (['ASSETS', 'EXPENSES'].includes(receivedLedger.accountgroup.type)) {
                debitAdjust = parseFloat(item.amount);
            } else {
                debitAdjust = -parseFloat(item.amount);
            }
            await prisma.ledger.update({
                where: { id: parseInt(receivedInAccountId) },
                data: { currentBalance: { increment: debitAdjust } }
            });

            await prisma.ledger.update({
                where: { id: parseInt(item.accountId) },
                data: { currentBalance: { increment: parseFloat(item.amount) } }
            });

            transactions.push(transaction);
        }

        res.status(200).json({ success: true, message: 'Income updated successfully', data: transactions });

    } catch (error) {
        console.error('Error updating income:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createIncome,
    getIncome,
    deleteIncome,
    updateIncome
};
