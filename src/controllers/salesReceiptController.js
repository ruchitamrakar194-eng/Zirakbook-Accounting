const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Customer Receipt (Payment)
const createReceipt = async (req, res) => {
    try {
        const { receiptNumber, date, customerId, invoiceId, amount, paymentMode, referenceNumber, cashBankAccountId, notes, discountAmount, discountLedgerId, allocations } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (!receiptNumber || !customerId || !amount || !cashBankAccountId) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
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

        // Date must not be before the customer's account creation date
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
                amount: parseFloat(a.amount)
            }));
        } else if (invoiceId) {
            normalizedAllocations = [{
                invoiceId: parseInt(invoiceId),
                amount: parseFloat(amount)
            }];
        }

        const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);

        const totalLimit = parseFloat(amount) + parseFloat(discountAmount || 0);
        if (allocatedSum > totalLimit) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the received amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Receipt Record
            const receipt = await tx.receipt.create({
                data: {
                    customFields: req.body.customFields ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : null,
                    receiptNumber,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: invoiceId ? parseInt(invoiceId) : (normalizedAllocations[0]?.invoiceId || null),
                    amount: parseFloat(amount),
                    paymentMode: paymentMode,
                    referenceNumber,
                    cashBankAccountId: parseInt(cashBankAccountId),
                    companyId: parseInt(companyId),
                    notes,
                    discountAmount: parseFloat(discountAmount || 0),
                    discountLedgerId: discountLedgerId ? parseInt(discountLedgerId) : null
                }
            });

            // 2. Create Allocations and Update Invoice Balances
            let totalLedgerAmount = 0;
            let totalLedgerDiscount = 0;
            const appliedDiscount = parseFloat(discountAmount || 0);

            // Sum allocations
            const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = parseFloat(amount) - allocatedSum;

            for (let i = 0; i < normalizedAllocations.length; i++) {
                const alloc = normalizedAllocations[i];
                
                // Create link record
                await tx.receiptinvoiceallocation.create({
                    data: {
                        receiptId: receipt.id,
                        invoiceId: alloc.invoiceId,
                        amount: alloc.amount,
                        companyId: parseInt(companyId)
                    }
                });

                const invoice = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
                if (invoice) {
                    const allocDiscount = (i === 0) ? appliedDiscount : 0;
                    const newPaid = (invoice.paidAmount || 0) + alloc.amount + allocDiscount;
                    const newBalance = (invoice.totalAmount || 0) - newPaid;

                    await tx.invoice.update({
                        where: { id: alloc.invoiceId },
                        data: {
                            paidAmount: newPaid,
                            balanceAmount: newBalance,
                            status: newBalance <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });

                    const rate = invoice.exchangeRate || 1.0;
                    totalLedgerAmount += alloc.amount * rate;
                    totalLedgerDiscount += allocDiscount * rate;
                }
            }

            // Unallocated amount is in company base currency
            totalLedgerAmount += unallocatedAmount;

            // 3. Accounting Entries
            // DR Cash/Bank
            await tx.ledger.update({
                where: { id: bankLedger.id },
                data: { currentBalance: { increment: totalLedgerAmount } }
            });

            // DR Discount Expense Ledger
            if (discountLedgerId && totalLedgerDiscount > 0) {
                await tx.ledger.update({
                    where: { id: parseInt(discountLedgerId) },
                    data: { currentBalance: { increment: totalLedgerDiscount } }
                });
            }

            // CR Customer
            await tx.ledger.update({
                where: { id: customer.ledgerId },
                data: { currentBalance: { decrement: totalLedgerAmount + totalLedgerDiscount } }
            });

            // Log Cash/Bank Transaction (Decoupled from invoice)
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'RECEIPT',
                    voucherNumber: receiptNumber,
                    debitLedgerId: bankLedger.id,
                    creditLedgerId: customer.ledgerId,
                    amount: totalLedgerAmount,
                    narration: `Payment received from ${customer.name}`,
                    companyId: parseInt(companyId),
                    receiptId: receipt.id,
                    invoiceId: null // Keep null so it is decoupled and never cascade-deleted!
                }
            });

            // Log Discount Transaction (Decoupled from invoice)
            if (discountLedgerId && totalLedgerDiscount > 0) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'RECEIPT',
                        voucherNumber: receiptNumber,
                        debitLedgerId: parseInt(discountLedgerId),
                        creditLedgerId: customer.ledgerId,
                        amount: totalLedgerDiscount,
                        narration: `Discount allowed to ${customer.name}`,
                        companyId: parseInt(companyId),
                        receiptId: receipt.id,
                        invoiceId: null // Keep null
                    }
                });
            }

            return receipt;
        }, {
            timeout: 30000
        });

        await numberingService.incrementNumber(companyId, 'receipt', receiptNumber);
        const { logActivity } = require('../utils/auditLogger');
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
        const { date, amount, paymentMode, referenceNumber, cashBankAccountId, notes, discountAmount, discountLedgerId, allocations } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        const existingReceipt = await prisma.receipt.findUnique({
            where: { id: parseInt(id) },
            include: {
                customer: true,
                allocations: {
                    include: { invoice: true }
                }
            }
        });

        if (!existingReceipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        // Normalize new allocations
        let normalizedNewAllocations = [];
        if (allocations && allocations.length > 0) {
            normalizedNewAllocations = allocations.map(a => ({
                invoiceId: parseInt(a.invoiceId),
                amount: parseFloat(a.amount)
            }));
        } else if (req.body.invoiceId) {
            normalizedNewAllocations = [{
                invoiceId: parseInt(req.body.invoiceId),
                amount: parseFloat(amount || existingReceipt.amount)
            }];
        }

        const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
        const finalAmount = amount !== undefined ? parseFloat(amount) : existingReceipt.amount;
        const newTotalLimit = finalAmount + parseFloat(req.body.discountAmount !== undefined ? (req.body.discountAmount || 0) : (existingReceipt.discountAmount || 0));
        if (newAllocatedSum > newTotalLimit) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the received amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. REVERSE PREVIOUS EFFECTS
            // Reverse invoice paid amounts based on old allocations
            const oldDiscount = existingReceipt.discountAmount || 0;
            for (let i = 0; i < existingReceipt.allocations.length; i++) {
                const oldAlloc = existingReceipt.allocations[i];
                const invoice = await tx.invoice.findUnique({ where: { id: oldAlloc.invoiceId } });
                if (invoice) {
                    const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
                    const revPaid = Math.max(0, (invoice.paidAmount || 0) - oldAlloc.amount - oldAllocDiscount);
                    const revBalance = (invoice.totalAmount || 0) - revPaid;
                    await tx.invoice.update({
                        where: { id: oldAlloc.invoiceId },
                        data: {
                            paidAmount: revPaid,
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'PAID' : (revPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // Calculate old ledger amounts to revert ledger balances
            let oldLedgerAmount = 0;
            let oldLedgerDiscount = 0;
            const oldAllocatedSum = existingReceipt.allocations.reduce((sum, a) => sum + a.amount, 0);
            const oldUnallocatedAmount = existingReceipt.amount - oldAllocatedSum;

            for (let i = 0; i < existingReceipt.allocations.length; i++) {
                const oldAlloc = existingReceipt.allocations[i];
                const rate = oldAlloc.invoice?.exchangeRate || 1.0;
                oldLedgerAmount += oldAlloc.amount * rate;
                if (i === 0) {
                    oldLedgerDiscount += oldDiscount * rate;
                }
            }
            oldLedgerAmount += oldUnallocatedAmount;

            // Reverse ledger balances
            if (existingReceipt.cashBankAccountId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.cashBankAccountId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.cashBankAccountId },
                        data: { currentBalance: { decrement: oldLedgerAmount } }
                    });
                }
            }

            if (existingReceipt.discountLedgerId && oldLedgerDiscount > 0) {
                const discountLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.discountLedgerId } });
                if (discountLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.discountLedgerId },
                        data: { currentBalance: { decrement: oldLedgerDiscount } }
                    });
                }
            }

            if (existingReceipt.customer && existingReceipt.customer.ledgerId) {
                const customerLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.customer.ledgerId } });
                if (customerLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.customer.ledgerId },
                        data: { currentBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                    });
                }
            }

            // Delete old transaction & old allocations
            await tx.transaction.deleteMany({ where: { receiptId: parseInt(id) } });
            await tx.receiptinvoiceallocation.deleteMany({ where: { receiptId: parseInt(id) } });

            // 2. APPLY NEW EFFECTS
            const finalAmount = amount !== undefined ? parseFloat(amount) : existingReceipt.amount;
            const finalDiscount = discountAmount !== undefined ? parseFloat(discountAmount || 0) : (existingReceipt.discountAmount || 0);
            const finalBankId = cashBankAccountId ? parseInt(cashBankAccountId) : existingReceipt.cashBankAccountId;
            const finalDiscountLedgerId = discountLedgerId !== undefined ? (discountLedgerId ? parseInt(discountLedgerId) : null) : existingReceipt.discountLedgerId;

            const updatedReceipt = await tx.receipt.update({
                where: { id: parseInt(id) },
                data: {
                    customFields: req.body.customFields !== undefined ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : undefined,
                    date: date ? new Date(date) : undefined,
                    amount: finalAmount,
                    paymentMode,
                    referenceNumber,
                    cashBankAccountId: finalBankId,
                    notes,
                    discountAmount: finalDiscount,
                    discountLedgerId: finalDiscountLedgerId,
                    invoiceId: req.body.invoiceId ? parseInt(req.body.invoiceId) : (normalizedNewAllocations[0]?.invoiceId || null)
                }
            });

            // Create new allocations and update new invoices
            let newLedgerAmount = 0;
            let newLedgerDiscount = 0;
            const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
            const newUnallocatedAmount = finalAmount - newAllocatedSum;

            for (let i = 0; i < normalizedNewAllocations.length; i++) {
                const alloc = normalizedNewAllocations[i];

                await tx.receiptinvoiceallocation.create({
                    data: {
                        receiptId: parseInt(id),
                        invoiceId: alloc.invoiceId,
                        amount: alloc.amount,
                        companyId: parseInt(companyId)
                    }
                });

                const invoice = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
                if (invoice) {
                    const allocDiscount = (i === 0) ? finalDiscount : 0;
                    const newPaid = (invoice.paidAmount || 0) + alloc.amount + allocDiscount;
                    const newBalance = (invoice.totalAmount || 0) - newPaid;

                    await tx.invoice.update({
                        where: { id: alloc.invoiceId },
                        data: {
                            paidAmount: newPaid,
                            balanceAmount: newBalance,
                            status: newBalance <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });

                    const rate = invoice.exchangeRate || 1.0;
                    newLedgerAmount += alloc.amount * rate;
                    newLedgerDiscount += allocDiscount * rate;
                }
            }
            newLedgerAmount += newUnallocatedAmount;

            // Apply new ledger balances
            if (finalBankId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: finalBankId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: finalBankId },
                        data: { currentBalance: { increment: newLedgerAmount } }
                    });
                }
            }

            if (finalDiscountLedgerId && newLedgerDiscount > 0) {
                const discountLedger = await tx.ledger.findUnique({ where: { id: finalDiscountLedgerId } });
                if (discountLedger) {
                    await tx.ledger.update({
                        where: { id: finalDiscountLedgerId },
                        data: { currentBalance: { increment: newLedgerDiscount } }
                    });
                }
            }

            if (existingReceipt.customer && existingReceipt.customer.ledgerId) {
                const customerLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.customer.ledgerId } });
                if (customerLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.customer.ledgerId },
                        data: { currentBalance: { decrement: newLedgerAmount + newLedgerDiscount } }
                    });
                }
            }

            // Create new transaction (decoupled)
            await tx.transaction.create({
                data: {
                    date: date ? new Date(date) : existingReceipt.date,
                    voucherType: 'RECEIPT',
                    voucherNumber: existingReceipt.receiptNumber,
                    debitLedgerId: finalBankId,
                    creditLedgerId: existingReceipt.customer.ledgerId,
                    amount: newLedgerAmount,
                    narration: `Updated Payment from ${existingReceipt.customer.name}`,
                    companyId: parseInt(companyId),
                    receiptId: parseInt(id),
                    invoiceId: null // Decoupled
                }
            });

            if (finalDiscountLedgerId && newLedgerDiscount > 0) {
                await tx.transaction.create({
                    data: {
                        date: date ? new Date(date) : existingReceipt.date,
                        voucherType: 'RECEIPT',
                        voucherNumber: existingReceipt.receiptNumber,
                        debitLedgerId: finalDiscountLedgerId,
                        creditLedgerId: existingReceipt.customer.ledgerId,
                        amount: newLedgerDiscount,
                        narration: `Updated Discount allowed to ${existingReceipt.customer.name}`,
                        companyId: parseInt(companyId),
                        receiptId: parseInt(id),
                        invoiceId: null // Decoupled
                    }
                });
            }

            return updatedReceipt;
        }, {
            timeout: 30000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Receipt', result.id, `Receipt #${result.receiptNumber} updated for Customer ID ${result.customerId} with amount ${result.amount}`);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Receipt Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Customer Receipt
const deleteReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const existingReceipt = await prisma.receipt.findUnique({
            where: { id: parseInt(id) },
            include: {
                customer: true,
                allocations: {
                    include: { invoice: true }
                }
            }
        });

        if (!existingReceipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        await prisma.$transaction(async (tx) => {
            // Reverse effects
            const oldDiscount = existingReceipt.discountAmount || 0;
            for (let i = 0; i < existingReceipt.allocations.length; i++) {
                const oldAlloc = existingReceipt.allocations[i];
                const invoice = await tx.invoice.findUnique({ where: { id: oldAlloc.invoiceId } });
                if (invoice) {
                    const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
                    const revPaid = Math.max(0, (invoice.paidAmount || 0) - oldAlloc.amount - oldAllocDiscount);
                    const revBalance = (invoice.totalAmount || 0) - revPaid;
                    await tx.invoice.update({
                        where: { id: oldAlloc.invoiceId },
                        data: {
                            paidAmount: revPaid,
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'PAID' : (revPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // Calculate old ledger amounts to revert ledger balances
            let oldLedgerAmount = 0;
            let oldLedgerDiscount = 0;
            const oldAllocatedSum = existingReceipt.allocations.reduce((sum, a) => sum + a.amount, 0);
            const oldUnallocatedAmount = existingReceipt.amount - oldAllocatedSum;

            for (let i = 0; i < existingReceipt.allocations.length; i++) {
                const oldAlloc = existingReceipt.allocations[i];
                const rate = oldAlloc.invoice?.exchangeRate || 1.0;
                oldLedgerAmount += oldAlloc.amount * rate;
                if (i === 0) {
                    oldLedgerDiscount += oldDiscount * rate;
                }
            }
            oldLedgerAmount += oldUnallocatedAmount;

            if (existingReceipt.cashBankAccountId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.cashBankAccountId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.cashBankAccountId },
                        data: { currentBalance: { decrement: oldLedgerAmount } }
                    });
                }
            }

            if (existingReceipt.discountLedgerId && oldLedgerDiscount > 0) {
                const discountLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.discountLedgerId } });
                if (discountLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.discountLedgerId },
                        data: { currentBalance: { decrement: oldLedgerDiscount } }
                    });
                }
            }

            if (existingReceipt.customer && existingReceipt.customer.ledgerId) {
                const customerLedger = await tx.ledger.findUnique({ where: { id: existingReceipt.customer.ledgerId } });
                if (customerLedger) {
                    await tx.ledger.update({
                        where: { id: existingReceipt.customer.ledgerId },
                        data: { currentBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                    });
                }
            }

            // Delete transactions, allocations and receipt
            await tx.transaction.deleteMany({ where: { receiptId: parseInt(id) } });
            await tx.receiptinvoiceallocation.deleteMany({ where: { receiptId: parseInt(id) } });
            await tx.receipt.delete({ where: { id: parseInt(id) } });
        }, {
            timeout: 30000
        });

        // Sync customer.accountBalance from ledger after deletion
        try {
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
        } catch (syncErr) {
            console.error('Customer balance sync error after receipt delete:', syncErr);
        }

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Receipt', existingReceipt.id, `Receipt #${existingReceipt.receiptNumber} deleted for Customer ID ${existingReceipt.customerId} with amount ${existingReceipt.amount}`);
        res.status(200).json({ success: true, message: 'Receipt deleted successfully' });
    } catch (error) {
        console.error('Receipt Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Receipts
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
                        invoice: { select: { id: true, invoiceNumber: true, balanceAmount: true, totalAmount: true, paidAmount: true, date: true, dueDate: true, status: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Map invoice for backwards compatibility
        const mapped = receipts.map(r => ({
            ...r,
            invoice: r.allocations[0]?.invoice || null
        }));

        res.status(200).json({ success: true, data: mapped });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Receipt by ID
const getReceiptById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;
        const receipt = await prisma.receipt.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                customer: true,
                cashBankAccount: true,
                discountLedger: true,
                allocations: {
                    include: {
                        invoice: {
                            include: {
                                invoiceitem: {
                                    include: {
                                        product: true,
                                        service: true,
                                        warehouse: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!receipt) {
            return res.status(404).json({ success: false, message: 'Receipt not found' });
        }

        // Map invoice for backwards compatibility
        const mapped = {
            ...receipt,
            invoice: receipt.allocations[0]?.invoice || null
        };

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
    deleteReceipt
};
