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
                invoiceType: a.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(a.amount)
            }));
        } else if (invoiceId) {
            normalizedAllocations = [{
                invoiceId: parseInt(invoiceId),
                invoiceType: req.body.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(amount)
            }];
        }

        const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);

        const totalLimit = parseFloat(amount) + parseFloat(discountAmount || 0);
        if (allocatedSum > totalLimit) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the received amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Find first TAX_INVOICE allocation (if any) to populate receipt.invoiceId (FK constraint)
            const standardAlloc = normalizedAllocations.find(a => a.invoiceType === 'TAX_INVOICE');
            const receiptInvoiceId = invoiceId && (req.body.invoiceType !== 'POS_INVOICE') ? parseInt(invoiceId) : (standardAlloc?.invoiceId || null);

            // 1. Create Receipt Record
            const receipt = await tx.receipt.create({
                data: {
                    customFields: req.body.customFields ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : null,
                    receiptNumber,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: receiptInvoiceId,
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
            let standardLedgerAmount = 0;
            let posLedgerAmount = 0;
            let totalLedgerDiscount = 0;
            const appliedDiscount = parseFloat(discountAmount || 0);

            // Sum allocations
            const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = parseFloat(amount) - allocatedSum;

            for (let i = 0; i < normalizedAllocations.length; i++) {
                const alloc = normalizedAllocations[i];
                const allocDiscount = (i === 0) ? appliedDiscount : 0;
                
                if (alloc.invoiceType === 'POS_INVOICE') {
                    // Update POS invoice
                    const posInvoice = await tx.posinvoice.findUnique({ where: { id: alloc.invoiceId } });
                    if (posInvoice) {
                        const newPaid = (posInvoice.paidAmount || 0) + alloc.amount + allocDiscount;
                        const newBalance = (posInvoice.totalAmount || 0) - newPaid;
                        
                        await tx.posinvoice.update({
                            where: { id: alloc.invoiceId },
                            data: {
                                paidAmount: newPaid,
                                balanceAmount: newBalance,
                                status: newBalance <= 0.01 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Due'),
                                updatedAt: new Date()
                            }
                        });

                        // Create linked transaction for POS payment history
                        await tx.transaction.create({
                            data: {
                                date: new Date(date),
                                voucherType: 'RECEIPT',
                                voucherNumber: receiptNumber,
                                debitLedgerId: bankLedger.id,
                                creditLedgerId: customer.ledgerId,
                                amount: alloc.amount,
                                narration: `Payment received for POS ${posInvoice.invoiceNumber} via ${paymentMode || 'BANK'}`,
                                companyId: parseInt(companyId),
                                receiptId: receipt.id,
                                posInvoiceId: alloc.invoiceId,
                                updatedAt: new Date()
                            }
                        });

                        posLedgerAmount += alloc.amount;
                        totalLedgerDiscount += allocDiscount;
                    }
                } else {
                    // Create link record (Standard Tax Invoice)
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
                        standardLedgerAmount += alloc.amount * rate;
                        totalLedgerDiscount += allocDiscount * rate;
                    }
                }
            }

            // Unallocated amount is in company base currency
            standardLedgerAmount += unallocatedAmount;

            // 3. Accounting Entries
            // DR Cash/Bank
            await tx.ledger.update({
                where: { id: bankLedger.id },
                data: { currentBalance: { increment: standardLedgerAmount + posLedgerAmount } }
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
                data: { currentBalance: { decrement: standardLedgerAmount + posLedgerAmount + totalLedgerDiscount } }
            });

            // Log Cash/Bank Transaction (Decoupled from invoice) for standard allocations & unallocated portion
            if (standardLedgerAmount > 0) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'RECEIPT',
                        voucherNumber: receiptNumber,
                        debitLedgerId: bankLedger.id,
                        creditLedgerId: customer.ledgerId,
                        amount: standardLedgerAmount,
                        narration: `Payment received from ${customer.name}`,
                        companyId: parseInt(companyId),
                        receiptId: receipt.id,
                        invoiceId: null // Keep null so it is decoupled and never cascade-deleted!
                    }
                });
            }

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
                invoiceType: a.invoiceType || 'TAX_INVOICE',
                amount: parseFloat(a.amount)
            }));
        } else if (req.body.invoiceId) {
            normalizedNewAllocations = [{
                invoiceId: parseInt(req.body.invoiceId),
                invoiceType: req.body.invoiceType || 'TAX_INVOICE',
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

            // Retrieve old POS transactions first to revert old POS invoice balances
            const oldPosTransactions = await tx.transaction.findMany({
                where: {
                    receiptId: parseInt(id),
                    posInvoiceId: { not: null },
                    voucherType: 'RECEIPT'
                }
            });

            for (const t of oldPosTransactions) {
                const posInvoice = await tx.posinvoice.findUnique({ where: { id: t.posInvoiceId } });
                if (posInvoice) {
                    const oldAllocDiscount = 0; // POS discount is not split-allocated on standard edits currently
                    const revPaid = Math.max(0, (posInvoice.paidAmount || 0) - t.amount - oldAllocDiscount);
                    const revBalance = (posInvoice.totalAmount || 0) - revPaid;
                    await tx.posinvoice.update({
                        where: { id: t.posInvoiceId },
                        data: {
                            paidAmount: revPaid,
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'Paid' : (revPaid > 0 ? 'Partial' : 'Due')
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

            // Find first TAX_INVOICE allocation (if any) to populate receipt.invoiceId (FK constraint)
            const standardNewAlloc = normalizedNewAllocations.find(a => a.invoiceType === 'TAX_INVOICE');
            const receiptInvoiceId = req.body.invoiceId && (req.body.invoiceType !== 'POS_INVOICE') ? parseInt(req.body.invoiceId) : (standardNewAlloc?.invoiceId || null);

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
                    invoiceId: receiptInvoiceId
                }
            });

            // Create new allocations and update new invoices
            let newStandardLedgerAmount = 0;
            let newPosLedgerAmount = 0;
            let newLedgerDiscount = 0;
            const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
            const newUnallocatedAmount = finalAmount - newAllocatedSum;

            for (let i = 0; i < normalizedNewAllocations.length; i++) {
                const alloc = normalizedNewAllocations[i];
                const allocDiscount = (i === 0) ? finalDiscount : 0;

                if (alloc.invoiceType === 'POS_INVOICE') {
                    const posInvoice = await tx.posinvoice.findUnique({ where: { id: alloc.invoiceId } });
                    if (posInvoice) {
                        const newPaid = (posInvoice.paidAmount || 0) + alloc.amount + allocDiscount;
                        const newBalance = (posInvoice.totalAmount || 0) - newPaid;

                        await tx.posinvoice.update({
                            where: { id: alloc.invoiceId },
                            data: {
                                paidAmount: newPaid,
                                balanceAmount: newBalance,
                                status: newBalance <= 0.01 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Due'),
                                updatedAt: new Date()
                            }
                        });

                        // Create linked transaction for POS payment history
                        await tx.transaction.create({
                            data: {
                                date: date ? new Date(date) : existingReceipt.date,
                                voucherType: 'RECEIPT',
                                voucherNumber: existingReceipt.receiptNumber,
                                debitLedgerId: finalBankId,
                                creditLedgerId: existingReceipt.customer.ledgerId,
                                amount: alloc.amount,
                                narration: `Payment received for POS ${posInvoice.invoiceNumber} via ${paymentMode || 'BANK'}`,
                                companyId: parseInt(companyId),
                                receiptId: parseInt(id),
                                posInvoiceId: alloc.invoiceId,
                                updatedAt: new Date()
                            }
                        });

                        newPosLedgerAmount += alloc.amount;
                        newLedgerDiscount += allocDiscount;
                    }
                } else {
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
                        newStandardLedgerAmount += alloc.amount * rate;
                        newLedgerDiscount += allocDiscount * rate;
                    }
                }
            }
            newStandardLedgerAmount += newUnallocatedAmount;

            // Apply new ledger balances
            if (finalBankId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: finalBankId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: finalBankId },
                        data: { currentBalance: { increment: newStandardLedgerAmount + newPosLedgerAmount } }
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
                        data: { currentBalance: { decrement: newStandardLedgerAmount + newPosLedgerAmount + newLedgerDiscount } }
                    });
                }
            }

            // Create new lumped transaction for standard allocations & unallocated portion (decoupled)
            if (newStandardLedgerAmount > 0) {
                await tx.transaction.create({
                    data: {
                        date: date ? new Date(date) : existingReceipt.date,
                        voucherType: 'RECEIPT',
                        voucherNumber: existingReceipt.receiptNumber,
                        debitLedgerId: finalBankId,
                        creditLedgerId: existingReceipt.customer.ledgerId,
                        amount: newStandardLedgerAmount,
                        narration: `Updated Payment from ${existingReceipt.customer.name}`,
                        companyId: parseInt(companyId),
                        receiptId: parseInt(id),
                        invoiceId: null // Decoupled
                    }
                });
            }

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
            // Reverse effects on standard invoices
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

            // Reverse effects on POS invoices
            const oldPosTransactions = await tx.transaction.findMany({
                where: {
                    receiptId: parseInt(id),
                    posInvoiceId: { not: null },
                    voucherType: 'RECEIPT'
                }
            });

            for (const t of oldPosTransactions) {
                const posInvoice = await tx.posinvoice.findUnique({ where: { id: t.posInvoiceId } });
                if (posInvoice) {
                    const revPaid = Math.max(0, (posInvoice.paidAmount || 0) - t.amount);
                    const revBalance = (posInvoice.totalAmount || 0) - revPaid;
                    await tx.posinvoice.update({
                        where: { id: t.posInvoiceId },
                        data: {
                            paidAmount: revPaid,
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'Paid' : (revPaid > 0 ? 'Partial' : 'Due')
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

        // Fetch POS allocations from transactions linked to these receipts
        const receiptIds = receipts.map(r => r.id);
        const posTransactions = receiptIds.length > 0 ? await prisma.transaction.findMany({
            where: {
                receiptId: { in: receiptIds },
                posInvoiceId: { not: null },
                voucherType: 'RECEIPT'
            },
            include: {
                posinvoice: {
                    select: {
                        id: true,
                        invoiceNumber: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        date: true,
                        status: true
                    }
                }
            }
        }) : [];

        // Map and unify allocations
        const mapped = receipts.map(r => {
            const standardAllocs = r.allocations.map(a => ({
                id: a.id,
                receiptId: a.receiptId,
                invoiceId: a.invoiceId,
                invoiceType: 'TAX_INVOICE',
                amount: a.amount,
                companyId: a.companyId,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                invoice: a.invoice
            }));

            const posAllocs = posTransactions
                .filter(t => t.receiptId === r.id)
                .map(t => ({
                    id: t.id,
                    receiptId: t.receiptId,
                    invoiceId: t.posInvoiceId,
                    invoiceType: 'POS_INVOICE',
                    amount: t.amount,
                    companyId: t.companyId,
                    createdAt: t.createdAt,
                    updatedAt: t.updatedAt,
                    invoice: t.posinvoice ? {
                        id: t.posinvoice.id,
                        invoiceNumber: t.posinvoice.invoiceNumber,
                        totalAmount: t.posinvoice.totalAmount,
                        paidAmount: t.posinvoice.paidAmount,
                        balanceAmount: t.posinvoice.balanceAmount,
                        date: t.posinvoice.date,
                        status: t.posinvoice.status
                    } : null
                }));

            const combinedAllocs = [...standardAllocs, ...posAllocs];
            return {
                ...r,
                allocations: combinedAllocs,
                invoice: combinedAllocs[0]?.invoice || null
            };
        });

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

        // Fetch POS allocations for this receipt
        const posTransactions = await prisma.transaction.findMany({
            where: {
                receiptId: receipt.id,
                posInvoiceId: { not: null },
                voucherType: 'RECEIPT'
            },
            include: {
                posinvoice: {
                    select: {
                        id: true,
                        invoiceNumber: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        date: true,
                        status: true
                    }
                }
            }
        });

        const standardAllocs = receipt.allocations.map(a => ({
            id: a.id,
            receiptId: a.receiptId,
            invoiceId: a.invoiceId,
            invoiceType: 'TAX_INVOICE',
            amount: a.amount,
            companyId: a.companyId,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt,
            invoice: a.invoice
        }));

        const posAllocs = posTransactions.map(t => ({
            id: t.id,
            receiptId: t.receiptId,
            invoiceId: t.posInvoiceId,
            invoiceType: 'POS_INVOICE',
            amount: t.amount,
            companyId: t.companyId,
            createdAt: t.createdAt,
            updatedAt: t.updatedAt,
            invoice: t.posinvoice ? {
                id: t.posinvoice.id,
                invoiceNumber: t.posinvoice.invoiceNumber,
                totalAmount: t.posinvoice.totalAmount,
                paidAmount: t.posinvoice.paidAmount,
                balanceAmount: t.posinvoice.balanceAmount,
                date: t.posinvoice.date,
                status: t.posinvoice.status
            } : null
        }));

        const combinedAllocs = [...standardAllocs, ...posAllocs];
        const mapped = {
            ...receipt,
            allocations: combinedAllocs,
            invoice: combinedAllocs[0]?.invoice || null
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
