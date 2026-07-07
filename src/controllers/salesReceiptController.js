const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');
const { logActivity } = require('../utils/auditLogger');

// Helper to reliably update invoice balances
const updateInvoiceBalance = async (tx, invoiceId, type, deltaPaid) => {
    if (type === 'POS_INVOICE') {
        const inv = await tx.posinvoice.findUnique({ where: { id: invoiceId } });
        if (inv) {
            const newPaid = Math.max(0, (inv.paidAmount || 0) + deltaPaid);
            const newBalance = Math.max(0, (inv.totalAmount || 0) - newPaid);
            await tx.posinvoice.update({
                where: { id: invoiceId },
                data: {
                    paidAmount: newPaid,
                    balanceAmount: newBalance,
                    status: newBalance <= 0.01 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Due'),
                    updatedAt: new Date()
                }
            });
        }
    } else {
        const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
        if (inv) {
            const newPaid = Math.max(0, (inv.paidAmount || 0) + deltaPaid);
            const newBalance = Math.max(0, (inv.totalAmount || 0) - newPaid);
            await tx.invoice.update({
                where: { id: invoiceId },
                data: {
                    paidAmount: newPaid,
                    balanceAmount: newBalance,
                    status: newBalance <= 0.01 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
                }
            });
        }
    }
};

// Create Customer Receipt (Payment)
const createReceipt = async (req, res) => {
    try {
        const { receiptNumber, date, customerId, amount, paymentMode, referenceNumber, cashBankAccountId, notes, discountAmount, discountLedgerId, allocations, manualStatus, status } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (!receiptNumber || !customerId || amount === undefined || !cashBankAccountId) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const parsedAmount = parseFloat(amount);
        if (parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) },
            include: { ledger: true }
        });

        const bankLedger = await prisma.ledger.findUnique({
            where: { id: parseInt(cashBankAccountId) }
        });

        if (!customer || !customer.ledgerId || !bankLedger) {
            return res.status(400).json({ success: false, message: 'Invalid customer or bank/cash account' });
        }

        // Date validation
        if (customer.creationDate && date) {
            const txDate = new Date(date);
            const accountDate = new Date(customer.creationDate);
            txDate.setHours(0, 0, 0, 0);
            accountDate.setHours(0, 0, 0, 0);
            if (txDate < accountDate) {
                return res.status(400).json({
                    success: false,
                    message: `Receipt date (${txDate.toDateString()}) cannot be before the customer's account creation date (${accountDate.toDateString()}).`
                });
            }
        }

        // Normalize allocations
        let normalizedAllocations = [];
        if (allocations && allocations.length > 0) {
            normalizedAllocations = allocations.map(a => ({
                invoiceId: parseInt(a.invoiceId),
                invoiceType: a.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(a.amount)
            })).filter(a => a.amount > 0);
        } else if (req.body.invoiceId) {
            normalizedAllocations = [{
                invoiceId: parseInt(req.body.invoiceId),
                invoiceType: req.body.invoiceType || 'TAX_INVOICE',
                amount: parsedAmount
            }];
        }

        const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
        const parsedDiscount = parseFloat(discountAmount || 0);
        const totalLimit = parsedAmount + parsedDiscount;
        
        if (allocatedSum > totalLimit + 0.01) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the received amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Journal Entry
            const journalEntry = await tx.journalentry.create({
                data: {
                    date: new Date(date),
                    voucherNumber: receiptNumber,
                    narration: `Payment receipt ${receiptNumber} from ${customer.name}`,
                    companyId: parseInt(companyId),
                    source: 'receipt'
                }
            });

            // 2. Create Receipt Record
            const standardAlloc = normalizedAllocations.find(a => a.invoiceType === 'TAX_INVOICE');
            const receiptInvoiceId = req.body.invoiceId && (req.body.invoiceType !== 'POS_INVOICE') ? parseInt(req.body.invoiceId) : (standardAlloc?.invoiceId || null);

            const receipt = await tx.receipt.create({
                data: {
                    customFields: req.body.customFields ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : null,
                    receiptNumber,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: receiptInvoiceId,
                    amount: parsedAmount,
                    paymentMode,
                    referenceNumber,
                    cashBankAccountId: parseInt(cashBankAccountId),
                    companyId: parseInt(companyId),
                    notes,
                    discountAmount: parsedDiscount,
                    discountLedgerId: discountLedgerId ? parseInt(discountLedgerId) : null,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'CLEARED'
                }
            });

            // 3. Process Allocations and update Invoice balances
            let totalLedgerAmount = 0;
            let totalLedgerDiscount = 0;
            const appliedDiscount = parseFloat(parsedDiscount || 0);

            // Sum allocations
            const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = parsedAmount - allocatedSum;

            for (let i = 0; i < normalizedAllocations.length; i++) {
                const alloc = normalizedAllocations[i];
                const allocDiscount = (i === 0) ? appliedDiscount : 0; 
                
                await updateInvoiceBalance(tx, alloc.invoiceId, alloc.invoiceType, alloc.amount + allocDiscount);
                
                if (alloc.invoiceType === 'TAX_INVOICE') {
                    await tx.receiptinvoiceallocation.create({
                        data: {
                            receiptId: receipt.id,
                            invoiceId: alloc.invoiceId,
                            amount: alloc.amount,
                            companyId: parseInt(companyId)
                        }
                    });
                }

                let rate = 1.0;
                if (alloc.invoiceType === 'TAX_INVOICE') {
                    const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
                    rate = inv?.exchangeRate || 1.0;
                }
                totalLedgerAmount += alloc.amount * rate;
                totalLedgerDiscount += allocDiscount * rate;
            }

            // Unallocated is in base currency
            totalLedgerAmount += unallocatedAmount;

            // 4. Create Double Entry Transactions
            const transactions = [];

            // Debit: Bank/Cash
            transactions.push({
                date: new Date(date),
                voucherType: 'RECEIPT',
                voucherNumber: receiptNumber,
                debitLedgerId: bankLedger.id,
                creditLedgerId: customer.ledgerId,
                amount: totalLedgerAmount,
                narration: `Payment received from ${customer.name}`,
                companyId: parseInt(companyId),
                journalEntryId: journalEntry.id,
                receiptId: receipt.id
            });

            // Debit: Discount
            if (totalLedgerDiscount > 0 && discountLedgerId) {
                transactions.push({
                    date: new Date(date),
                    voucherType: 'RECEIPT',
                    voucherNumber: receiptNumber,
                    debitLedgerId: parseInt(discountLedgerId),
                    creditLedgerId: customer.ledgerId,
                    amount: totalLedgerDiscount,
                    narration: `Discount allowed to ${customer.name}`,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    receiptId: receipt.id
                });
            }

            const posAllocations = normalizedAllocations.filter(a => a.invoiceType === 'POS_INVOICE');
            for (const posAlloc of posAllocations) {
                 await tx.transaction.create({
                     data: {
                         date: new Date(date),
                         voucherType: 'RECEIPT',
                         voucherNumber: receiptNumber,
                         debitLedgerId: bankLedger.id,
                         creditLedgerId: customer.ledgerId,
                         amount: posAlloc.amount, 
                         narration: `Payment for POS Invoice`,
                         companyId: parseInt(companyId),
                         journalEntryId: journalEntry.id,
                         receiptId: receipt.id,
                         posInvoiceId: posAlloc.invoiceId
                     }
                 });
                 const mainBankTx = transactions.find(t => t.debitLedgerId === bankLedger.id && !t.posInvoiceId);
                 if (mainBankTx) mainBankTx.amount -= posAlloc.amount;
            }

            const finalTxs = transactions.filter(t => t.amount > 0);
            for (const t of finalTxs) {
                await tx.transaction.create({ data: t });
            }

            // 5. Update Ledger Balances Strictly
            const allDbTxs = await tx.transaction.findMany({ where: { journalEntryId: journalEntry.id } });
            
            const ledgerChanges = {};
            for (const t of allDbTxs) {
                ledgerChanges[t.debitLedgerId] = (ledgerChanges[t.debitLedgerId] || 0) + t.amount;
                ledgerChanges[t.creditLedgerId] = (ledgerChanges[t.creditLedgerId] || 0) - t.amount;
            }

            for (const [ledgerId, change] of Object.entries(ledgerChanges)) {
                if (change !== 0) {
                    await tx.ledger.update({
                        where: { id: parseInt(ledgerId) },
                        data: { currentBalance: { increment: change } }
                    });
                }
            }

            const finalCustomerLedger = await tx.ledger.findUnique({ where: { id: customer.ledgerId } });
            await tx.customer.update({
                where: { id: customer.id },
                data: { accountBalance: finalCustomerLedger.currentBalance }
            });

            return receipt;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'receipt', receiptNumber);
        logActivity(req, 'CREATE', 'Receipt', result.id, `Receipt #${result.receiptNumber} created for Customer ID ${result.customerId} with amount ${result.amount}`);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Receipt Creation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Customer Receipt
const updateReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, amount, paymentMode, referenceNumber, cashBankAccountId, notes, discountAmount, discountLedgerId, allocations, manualStatus, status, onlyUpdateStatus } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.receipt.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const existingReceipt = await prisma.receipt.findUnique({
            where: { id: parseInt(id) },
            include: { customer: true, allocations: true }
        });

        if (!existingReceipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        // Normalize new allocations
        let normalizedNewAllocations = [];
        if (allocations && allocations.length > 0) {
            normalizedNewAllocations = allocations.map(a => ({
                invoiceId: parseInt(a.invoiceId),
                invoiceType: a.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(a.amount)
            })).filter(a => a.amount > 0);
        } else if (req.body.invoiceId) {
            normalizedNewAllocations = [{
                invoiceId: parseInt(req.body.invoiceId),
                invoiceType: req.body.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(amount || existingReceipt.amount)
            }];
        }

        const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
        const finalAmount = amount !== undefined ? parseFloat(amount) : existingReceipt.amount;
        const finalDiscount = discountAmount !== undefined ? parseFloat(discountAmount || 0) : (existingReceipt.discountAmount || 0);
        const newTotalLimit = finalAmount + finalDiscount;
        
        if (newAllocatedSum > newTotalLimit + 0.01) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the received amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // --- 1. STRICT REVERSAL OF OLD RECORD ---
            const oldDiscount = existingReceipt.discountAmount || 0;
            for (let i = 0; i < existingReceipt.allocations.length; i++) {
                const oldAlloc = existingReceipt.allocations[i];
                const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
                await updateInvoiceBalance(tx, oldAlloc.invoiceId, 'TAX_INVOICE', -(oldAlloc.amount + oldAllocDiscount));
            }
            
            const oldTransactions = await tx.transaction.findMany({
                where: { receiptId: parseInt(id), voucherType: 'RECEIPT' }
            });
            
            for (const t of oldTransactions) {
                if (t.posInvoiceId) {
                    await updateInvoiceBalance(tx, t.posInvoiceId, 'POS_INVOICE', -t.amount);
                }
            }

            const oldLedgerChanges = {};
            for (const t of oldTransactions) {
                oldLedgerChanges[t.debitLedgerId] = (oldLedgerChanges[t.debitLedgerId] || 0) - t.amount;
                oldLedgerChanges[t.creditLedgerId] = (oldLedgerChanges[t.creditLedgerId] || 0) + t.amount;
            }
            
            for (const [ledgerId, change] of Object.entries(oldLedgerChanges)) {
                if (change !== 0) {
                    await tx.ledger.update({
                        where: { id: parseInt(ledgerId) },
                        data: { currentBalance: { increment: change } }
                    });
                }
            }

            await tx.receiptinvoiceallocation.deleteMany({ where: { receiptId: parseInt(id) } });
            await tx.transaction.deleteMany({ where: { receiptId: parseInt(id) } });
            
            const oldJournalIds = [...new Set(oldTransactions.map(t => t.journalEntryId).filter(Boolean))];
            if (oldJournalIds.length > 0) {
                 await tx.journalentry.deleteMany({ where: { id: { in: oldJournalIds } } });
            }

            // --- 2. APPLY NEW EFFECTS ---
            const finalBankId = cashBankAccountId ? parseInt(cashBankAccountId) : existingReceipt.cashBankAccountId;
            const finalDiscountLedgerId = discountLedgerId !== undefined ? (discountLedgerId ? parseInt(discountLedgerId) : null) : existingReceipt.discountLedgerId;
            const newDate = date ? new Date(date) : existingReceipt.date;

            const journalEntry = await tx.journalentry.create({
                data: {
                    date: newDate,
                    voucherNumber: existingReceipt.receiptNumber,
                    narration: `Updated Payment receipt ${existingReceipt.receiptNumber} from ${existingReceipt.customer.name}`,
                    companyId: parseInt(companyId),
                    source: 'receipt'
                }
            });

            const standardNewAlloc = normalizedNewAllocations.find(a => a.invoiceType === 'TAX_INVOICE');
            const receiptInvoiceId = req.body.invoiceId && (req.body.invoiceType !== 'POS_INVOICE') ? parseInt(req.body.invoiceId) : (standardNewAlloc?.invoiceId || null);

            const updatedReceipt = await tx.receipt.update({
                where: { id: parseInt(id) },
                data: {
                    customFields: req.body.customFields !== undefined ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : undefined,
                    date: newDate,
                    amount: finalAmount,
                    paymentMode,
                    referenceNumber,
                    cashBankAccountId: finalBankId,
                    notes,
                    discountAmount: finalDiscount,
                    discountLedgerId: finalDiscountLedgerId,
                    invoiceId: receiptInvoiceId,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status !== undefined ? status : undefined
                }
            });

            let totalLedgerAmount = 0;
            let totalLedgerDiscount = 0;
            const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = finalAmount - newAllocatedSum;

            for (let i = 0; i < normalizedNewAllocations.length; i++) {
                const alloc = normalizedNewAllocations[i];
                const allocDiscount = (i === 0) ? finalDiscount : 0;
                
                await updateInvoiceBalance(tx, alloc.invoiceId, alloc.invoiceType, alloc.amount + allocDiscount);
                
                if (alloc.invoiceType === 'TAX_INVOICE') {
                    await tx.receiptinvoiceallocation.create({
                        data: {
                            receiptId: updatedReceipt.id,
                            invoiceId: alloc.invoiceId,
                            amount: alloc.amount,
                            companyId: parseInt(companyId)
                        }
                    });
                }

                let rate = 1.0;
                if (alloc.invoiceType === 'TAX_INVOICE') {
                    const inv = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
                    rate = inv?.exchangeRate || 1.0;
                }
                totalLedgerAmount += alloc.amount * rate;
                totalLedgerDiscount += allocDiscount * rate;
            }

            // Unallocated is in base currency
            totalLedgerAmount += unallocatedAmount;

            const transactions = [];
            transactions.push({
                date: newDate,
                voucherType: 'RECEIPT',
                voucherNumber: existingReceipt.receiptNumber,
                debitLedgerId: finalBankId,
                creditLedgerId: existingReceipt.customer.ledgerId,
                amount: totalLedgerAmount,
                narration: `Updated Payment received from ${existingReceipt.customer.name}`,
                companyId: parseInt(companyId),
                journalEntryId: journalEntry.id,
                receiptId: updatedReceipt.id
            });

            if (finalDiscount > 0 && finalDiscountLedgerId) {
                transactions.push({
                    date: newDate,
                    voucherType: 'RECEIPT',
                    voucherNumber: existingReceipt.receiptNumber,
                    debitLedgerId: parseInt(finalDiscountLedgerId),
                    creditLedgerId: existingReceipt.customer.ledgerId,
                    amount: totalLedgerDiscount,
                    narration: `Updated Discount allowed to ${existingReceipt.customer.name}`,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    receiptId: updatedReceipt.id
                });
            }

            const posAllocations = normalizedNewAllocations.filter(a => a.invoiceType === 'POS_INVOICE');
            for (const posAlloc of posAllocations) {
                 await tx.transaction.create({
                     data: {
                         date: newDate,
                         voucherType: 'RECEIPT',
                         voucherNumber: existingReceipt.receiptNumber,
                         debitLedgerId: finalBankId,
                         creditLedgerId: existingReceipt.customer.ledgerId,
                         amount: posAlloc.amount,
                         narration: `Payment for POS Invoice`,
                         companyId: parseInt(companyId),
                         journalEntryId: journalEntry.id,
                         receiptId: updatedReceipt.id,
                         posInvoiceId: posAlloc.invoiceId
                     }
                 });
                 const mainBankTx = transactions.find(t => t.debitLedgerId === finalBankId && !t.posInvoiceId);
                 if (mainBankTx) mainBankTx.amount -= posAlloc.amount;
            }

            const finalTxs = transactions.filter(t => t.amount > 0);
            for (const t of finalTxs) {
                await tx.transaction.create({ data: t });
            }

            const allDbTxs = await tx.transaction.findMany({ where: { journalEntryId: journalEntry.id } });
            const newLedgerChanges = {};
            for (const t of allDbTxs) {
                newLedgerChanges[t.debitLedgerId] = (newLedgerChanges[t.debitLedgerId] || 0) + t.amount;
                newLedgerChanges[t.creditLedgerId] = (newLedgerChanges[t.creditLedgerId] || 0) - t.amount;
            }

            for (const [ledgerId, change] of Object.entries(newLedgerChanges)) {
                if (change !== 0) {
                    await tx.ledger.update({
                        where: { id: parseInt(ledgerId) },
                        data: { currentBalance: { increment: change } }
                    });
                }
            }

            const finalCustomerLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.customer.ledgerId } });
            await tx.customer.update({
                where: { id: existingReceipt.customer.id },
                data: { accountBalance: finalCustomerLedger.currentBalance }
            });

            return updatedReceipt;
        }, { timeout: 30000 });

        logActivity(req, 'UPDATE', 'Receipt', result.id, `Receipt #${result.receiptNumber} updated`);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Receipt Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteReceiptHelper = async (tx, receipt, companyId) => {
    const fullReceipt = await tx.receipt.findUnique({
        where: { id: receipt.id },
        include: { allocations: true, customer: true }
    });
    if (!fullReceipt) return;

    const oldDiscount = fullReceipt.discountAmount || 0;
    for (let i = 0; i < fullReceipt.allocations.length; i++) {
        const oldAlloc = fullReceipt.allocations[i];
        const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
        await updateInvoiceBalance(tx, oldAlloc.invoiceId, 'TAX_INVOICE', -(oldAlloc.amount + oldAllocDiscount));
    }
    
    const oldTransactions = await tx.transaction.findMany({
        where: { receiptId: fullReceipt.id, voucherType: 'RECEIPT' }
    });
    
    for (const t of oldTransactions) {
        if (t.posInvoiceId) {
            await updateInvoiceBalance(tx, t.posInvoiceId, 'POS_INVOICE', -t.amount);
        }
    }

    const oldLedgerChanges = {};
    for (const t of oldTransactions) {
        oldLedgerChanges[t.debitLedgerId] = (oldLedgerChanges[t.debitLedgerId] || 0) - t.amount;
        oldLedgerChanges[t.creditLedgerId] = (oldLedgerChanges[t.creditLedgerId] || 0) + t.amount;
    }
    
    for (const [ledgerId, change] of Object.entries(oldLedgerChanges)) {
        if (change !== 0) {
            await tx.ledger.update({
                where: { id: parseInt(ledgerId) },
                data: { currentBalance: { increment: change } }
            });
        }
    }

    await tx.receiptinvoiceallocation.deleteMany({ where: { receiptId: fullReceipt.id } });
    await tx.transaction.deleteMany({ where: { receiptId: fullReceipt.id } });
    
    const oldJournalIds = [...new Set(oldTransactions.map(t => t.journalEntryId).filter(Boolean))];
    if (oldJournalIds.length > 0) {
         await tx.journalentry.deleteMany({ where: { id: { in: oldJournalIds } } });
    }
    
    await tx.receipt.delete({ where: { id: fullReceipt.id } });
};

const deleteReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const existingReceipt = await prisma.receipt.findUnique({
            where: { id: parseInt(id) },
            include: { customer: true }
        });

        if (!existingReceipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        await prisma.$transaction(async (tx) => {
            await deleteReceiptHelper(tx, existingReceipt, companyId);
        }, { timeout: 30000 });

        if (existingReceipt.customerId) {
            const customer = await prisma.customer.findUnique({
                where: { id: existingReceipt.customerId },
                select: { id: true, ledgerId: true }
            });
            if (customer && customer.ledgerId) {
                const ledger = await prisma.ledger.findUnique({
                    where: { id: customer.ledgerId },
                    select: { currentBalance: true }
                });
                if (ledger) {
                    await prisma.customer.update({
                        where: { id: customer.id },
                        data: { accountBalance: ledger.currentBalance }
                    });
                }
            }
        }

        logActivity(req, 'DELETE', 'Receipt', existingReceipt.id, `Receipt #${existingReceipt.receiptNumber} deleted`);
        res.status(200).json({ success: true, message: 'Receipt deleted successfully' });
    } catch (error) {
        console.error('Receipt Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getReceipts = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { customerId } = req.query;
        
        const where = { companyId: parseInt(companyId) };
        if (customerId) {
            where.customerId = parseInt(customerId);
        }

        const receipts = await prisma.receipt.findMany({
            where,
            include: {
                customer: { select: { id: true, name: true, ledgerId: true } },
                cashBankAccount: { select: { id: true, name: true } },
                discountLedger: { select: { id: true, name: true } },
                allocations: {
                    include: {
                        invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, totalAmount: true, paidAmount: true, date: true, dueDate: true, status: true, currency: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const receiptIds = receipts.map(r => r.id);
        const posTransactions = receiptIds.length > 0 ? await prisma.transaction.findMany({
            where: {
                receiptId: { in: receiptIds },
                posInvoiceId: { not: null },
                voucherType: 'RECEIPT'
            },
            include: {
                posinvoice: {
                    select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, balanceAmount: true, date: true, status: true }
                }
            }
        }) : [];

        const mapped = receipts.map(r => {
            const standardAllocs = r.allocations.map(a => ({
                id: a.id, receiptId: a.receiptId, invoiceId: a.invoiceId, invoiceType: 'TAX_INVOICE', amount: a.amount,
                companyId: a.companyId, createdAt: a.createdAt, updatedAt: a.updatedAt, invoice: a.invoice
            }));

            const posAllocs = posTransactions.filter(t => t.receiptId === r.id).map(t => ({
                id: t.id, receiptId: t.receiptId, invoiceId: t.posInvoiceId, invoiceType: 'POS_INVOICE', amount: t.amount,
                companyId: t.companyId, createdAt: t.createdAt, updatedAt: t.updatedAt,
                invoice: t.posinvoice ? {
                    id: t.posinvoice.id, invoiceNumber: t.posinvoice.invoiceNumber, totalAmount: t.posinvoice.totalAmount,
                    paidAmount: t.posinvoice.paidAmount, balanceAmount: t.posinvoice.balanceAmount, date: t.posinvoice.date, status: t.posinvoice.status, currency: 'INR'
                } : null
            }));

            const combinedAllocs = [...standardAllocs, ...posAllocs];
            return { ...r, allocations: combinedAllocs, invoice: combinedAllocs[0]?.invoice || null };
        });

        res.status(200).json({ success: true, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getReceiptById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;
        const receipt = await prisma.receipt.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                customer: true, cashBankAccount: true, discountLedger: true,
                allocations: { include: { invoice: { include: { invoiceitem: { include: { product: true, service: true, warehouse: true } } } } } }
            }
        });

        if (!receipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        const posTransactions = await prisma.transaction.findMany({
            where: { receiptId: receipt.id, posInvoiceId: { not: null }, voucherType: 'RECEIPT' },
            include: { posinvoice: { select: { id: true, invoiceNumber: true, totalAmount: true, paidAmount: true, balanceAmount: true, date: true, status: true } } }
        });

        const standardAllocs = receipt.allocations.map(a => ({
            id: a.id, receiptId: a.receiptId, invoiceId: a.invoiceId, invoiceType: 'TAX_INVOICE', amount: a.amount,
            companyId: a.companyId, createdAt: a.createdAt, updatedAt: a.updatedAt, invoice: a.invoice
        }));

        const posAllocs = posTransactions.map(t => ({
            id: t.id, receiptId: t.receiptId, invoiceId: t.posInvoiceId, invoiceType: 'POS_INVOICE', amount: t.amount,
            companyId: t.companyId, createdAt: t.createdAt, updatedAt: t.updatedAt,
            invoice: t.posinvoice ? {
                id: t.posinvoice.id, invoiceNumber: t.posinvoice.invoiceNumber, totalAmount: t.posinvoice.totalAmount,
                paidAmount: t.posinvoice.paidAmount, balanceAmount: t.posinvoice.balanceAmount, date: t.posinvoice.date, status: t.posinvoice.status, currency: 'INR'
            } : null
        }));

        const combinedAllocs = [...standardAllocs, ...posAllocs];
        const mapped = { ...receipt, allocations: combinedAllocs, invoice: combinedAllocs[0]?.invoice || null };

        res.status(200).json({ success: true, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createReceipt,
    getReceipts,
    getReceiptById,
    updateReceipt,
    deleteReceipt,
    deleteReceiptHelper
};
