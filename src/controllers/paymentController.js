const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Helper to get currency decimal places (KWD/BHD/OMR etc have 3, others have 2)
const getDecimalPlaces = (currency) => {
    const threeDecimalCurrencies = ['KWD', 'BHD', 'OMR', 'JOD', 'LYD', 'TND'];
    return threeDecimalCurrencies.includes(currency?.toUpperCase()) ? 3 : 2;
};

// Round value to specified decimal places
const roundTo = (val, decimals = 2) => {
    const factor = Math.pow(10, decimals);
    return Math.round(val * factor) / factor;
};

// Helper to reliably update bill balances
const updateBillBalance = async (tx, billId, deltaPaid) => {
    const bill = await tx.purchasebill.findUnique({ where: { id: billId } });
    if (bill) {
        const decimals = getDecimalPlaces(bill.currency || 'INR');
        const newPaid = Math.max(0, roundTo((bill.paidAmount || 0) + deltaPaid, decimals));
        const newBalance = Math.max(0, roundTo((bill.totalAmount || 0) - newPaid, decimals));
        const tolerance = decimals === 3 ? 0.001 : 0.01;
        await tx.purchasebill.update({
            where: { id: billId },
            data: {
                paidAmount: newPaid,
                balanceAmount: newBalance,
                status: newBalance <= tolerance ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
            }
        });
    }
};

const createPayment = async (req, res) => {
    try {
        const {
            paymentNumber,
            date,
            vendorId,
            purchaseBillId,
            amount,
            paymentMode,
            referenceNumber,
            cashBankAccountId,
            notes,
            discountAmount,
            discountLedgerId,
            allocations,
            customFields,
            manualStatus,
            status
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!vendorId || !amount || !cashBankAccountId) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const vendor = await prisma.vendor.findUnique({
            where: { id: parseInt(vendorId) },
            include: { ledger: true }
        });

        const bankLedger = await prisma.ledger.findUnique({
            where: { id: parseInt(cashBankAccountId) }
        });

        if (!vendor || !vendor.ledgerId || !bankLedger) {
            return res.status(400).json({ success: false, message: 'Invalid vendor or bank/cash account' });
        }

        // Date must not be before the vendor's account creation date
        if (vendor.creationDate && date) {
            const txDate = new Date(date);
            const accountDate = new Date(vendor.creationDate);
            txDate.setHours(0, 0, 0, 0);
            accountDate.setHours(0, 0, 0, 0);
            if (txDate < accountDate) {
                return res.status(400).json({
                    success: false,
                    message: `Payment date (${txDate.toDateString()}) cannot be before the vendor's account creation date (${accountDate.toDateString()}).`
                });
            }
        }

        // Normalize payment mode for Prisma enum
        const modeMap = {
            'Bank Transfer': 'BANK',
            'Online': 'BANK',
            'UPI': 'UPI',
            'Cash': 'CASH',
            'Credit Card': 'CARD',
            'Cheque': 'CHEQUE'
        };
        const normalizedMode = modeMap[paymentMode] || 'OTHER';

        // Normalize allocations
        let normalizedAllocations = [];
        if (allocations && allocations.length > 0) {
            normalizedAllocations = allocations.map(a => ({
                purchaseBillId: parseInt(a.purchaseBillId),
                amount: parseFloat(a.amount)
            }));
        } else if (purchaseBillId) {
            normalizedAllocations = [{
                purchaseBillId: parseInt(purchaseBillId),
                amount: parseFloat(amount)
            }];
        }

        const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
        const totalPayLimit = parseFloat(amount) + parseFloat(discountAmount || 0);
        if (allocatedSum > totalPayLimit) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the paid amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const payment = await tx.payment.create({
                data: {
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    paymentNumber: paymentNumber || `PAY-${Date.now()}`,
                    date: date ? new Date(date) : new Date(),
                    vendorId: parseInt(vendorId),
                    purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : (normalizedAllocations[0]?.purchaseBillId || null),
                    amount: parseFloat(amount),
                    paymentMode: normalizedMode,
                    referenceNumber,
                    cashBankAccountId: parseInt(cashBankAccountId),
                    companyId: parseInt(companyId),
                    notes,
                    discountAmount: parseFloat(discountAmount || 0),
                    discountLedgerId: discountLedgerId ? parseInt(discountLedgerId) : null,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'CLEARED'
                }
            });
            // Sum allocations
            const allocatedSum = normalizedAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = parseFloat(amount) - allocatedSum;

            let totalBankAmount = 0; // Bank credit in base currency
            let totalVendorAmount = 0; // Vendor debit in base currency
            let totalLedgerDiscount = 0; // Discount in base currency
            let totalForexDiff = 0; // Cumulative forex difference
            const appliedDiscount = parseFloat(discountAmount || 0);

            // Payment exchange rate (from body or default to 1.0)
            const paymentRate = parseFloat(req.body.exchangeRate) || 1.0;

            // Find or create Foreign Exchange Gain/Loss Ledger
            let forexLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: 'Foreign Exchange Gain/Loss' }
            });
            if (!forexLedger) {
                let incomeGroup = await tx.accountgroup.findFirst({
                    where: { companyId: parseInt(companyId), type: 'INCOME' }
                });
                if (!incomeGroup) {
                    incomeGroup = await tx.accountgroup.create({
                        data: {
                            name: 'Indirect Income',
                            type: 'INCOME',
                            companyId: parseInt(companyId)
                        }
                    });
                }
                forexLedger = await tx.ledger.create({
                    data: {
                        name: 'Foreign Exchange Gain/Loss',
                        groupId: incomeGroup.id,
                        companyId: parseInt(companyId),
                        isControlAccount: false
                    }
                });
            }

            for (let i = 0; i < normalizedAllocations.length; i++) {
                const alloc = normalizedAllocations[i];

                // Create link record
                await tx.paymentbillallocation.create({
                    data: {
                        paymentId: payment.id,
                        purchaseBillId: alloc.purchaseBillId,
                        amount: alloc.amount,
                        companyId: parseInt(companyId)
                    }
                });

                const bill = await tx.purchasebill.findUnique({
                    where: { id: alloc.purchaseBillId }
                });

                if (bill) {
                    const allocDiscount = (i === 0) ? appliedDiscount : 0;
                    await updateBillBalance(tx, alloc.purchaseBillId, alloc.amount + allocDiscount);

                    const billRate = bill.exchangeRate || 1.0;
                    const bankAllocAmount = alloc.amount * paymentRate;
                    const vendorAllocAmount = alloc.amount * billRate;

                    totalBankAmount += bankAllocAmount;
                    totalVendorAmount += vendorAllocAmount;
                    totalLedgerDiscount += allocDiscount * billRate;

                    // Forex difference on Vendor Payment: cleared vendor liability - paid bank cash
                    const forexDiff = vendorAllocAmount - bankAllocAmount;
                    totalForexDiff += forexDiff;
                }
            }

            // Unallocated portion
            totalBankAmount += unallocatedAmount * paymentRate;
            totalVendorAmount += unallocatedAmount * paymentRate;

            // Accounting Entries
            const transactions = [];

            // Discount Received (debit Vendor, credit Discount Received)
            if (discountLedgerId && totalLedgerDiscount > 0) {
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: vendor.ledgerId,
                    creditLedgerId: parseInt(discountLedgerId),
                    amount: totalLedgerDiscount,
                    narration: `Discount received from ${vendor.name}`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
            }

            // Debit Vendor / Credit Bank and/or book Forex entries
            if (Math.abs(totalForexDiff) <= 0.001) {
                // Standard entry: DR Vendor, CR Bank
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: vendor.ledgerId,
                    creditLedgerId: bankLedger.id,
                    amount: totalBankAmount,
                    narration: `Payment to ${vendor.name}`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
            } else if (totalForexDiff > 0) {
                // Forex Gain (cleared liability > paid cash):
                // DR Vendor: totalVendorAmount
                // CR Bank: totalBankAmount
                // CR Forex Gain: totalForexDiff
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: vendor.ledgerId,
                    creditLedgerId: bankLedger.id,
                    amount: totalBankAmount,
                    narration: `Payment to ${vendor.name}`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: vendor.ledgerId,
                    creditLedgerId: forexLedger.id,
                    amount: totalForexDiff,
                    narration: `Foreign Exchange Gain on payment to ${vendor.name}`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
            } else {
                // Forex Loss (paid cash > cleared liability):
                // DR Vendor: totalVendorAmount
                // DR Forex Loss: Math.abs(totalForexDiff)
                // CR Bank: totalBankAmount
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: vendor.ledgerId,
                    creditLedgerId: bankLedger.id,
                    amount: totalVendorAmount,
                    narration: `Payment to ${vendor.name} (Bill rate portion)`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
                transactions.push({
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || payment.paymentNumber,
                    debitLedgerId: forexLedger.id,
                    creditLedgerId: bankLedger.id,
                    amount: Math.abs(totalForexDiff),
                    narration: `Foreign Exchange Loss on payment to ${vendor.name}`,
                    companyId: parseInt(companyId),
                    paymentId: payment.id
                });
            }

            const finalTxs = transactions.filter(t => t.amount > 0.001);
            for (const t of finalTxs) {
                await tx.transaction.create({ data: t });
            }

            // Update Ledger Balances strictly based on created transactions
            const allDbTxs = await tx.transaction.findMany({ where: { paymentId: payment.id } });
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

            const finalVendorLedger = await tx.ledger.findUnique({ where: { id: vendor.ledgerId } });
            await tx.vendor.update({
                where: { id: vendor.id },
                data: { accountBalance: finalVendorLedger.currentBalance }
            });

            return payment;
        }, {
            timeout: 30000
        });

        await numberingService.incrementNumber(companyId, 'payment', paymentNumber || result.paymentNumber);
        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'Payment', result.id, `Payment #${result.paymentNumber} created for Vendor ID ${result.vendorId} with amount ${result.amount}`);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Payment Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPayments = async (req, res) => {
    try {
        const {
            companyId,
            vendorId,
            startDate,
            endDate
        } = req.query;

        const currentCompanyId = req.user?.companyId || companyId;

        let where = {};
        if (currentCompanyId) where.companyId = parseInt(currentCompanyId);
        if (vendorId) where.vendorId = parseInt(vendorId);
        if (startDate && endDate) {
            where.date = {
                gte: new Date(startDate),
                lte: new Date(endDate)
            };
        }

        const payments = await prisma.payment.findMany({
            where,
            include: {
                vendor: true,
                bankLedger: { select: { id: true, name: true } },
                discountLedger: { select: { id: true, name: true } },
                allocations: {
                    include: {
                        purchasebill: true
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });

        // Map purchasebill for backwards compatibility
        const mapped = payments.map(p => ({
            ...p,
            purchasebill: p.allocations[0]?.purchasebill || null
        }));

        res.json(mapped);
    } catch (error) {
        console.error('Get Payments Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPaymentById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const payment = await prisma.payment.findUnique({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                vendor: { include: { ledger: true } },
                company: true,
                bankLedger: true,
                discountLedger: true,
                allocations: {
                    include: {
                        purchasebill: true
                    }
                }
            }
        });
        if (!payment) return res.status(404).json({ message: 'Payment not found' });

        // Map purchasebill for backwards compatibility
        const mapped = {
            ...payment,
            purchasebill: payment.allocations[0]?.purchasebill || null
        };

        res.json(mapped);
    } catch (error) {
        console.error('Get Payment By ID Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Update Payment
const updatePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            paymentNumber,
            date,
            vendorId,
            purchaseBillId,
            amount,
            paymentMode,
            referenceNumber,
            cashBankAccountId,
            notes,
            discountAmount,
            discountLedgerId,
            allocations,
            customFields,
            manualStatus,
            status,
            onlyUpdateStatus
        } = req.body;
        const currentCompanyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.payment.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const existingPayment = await prisma.payment.findUnique({
            where: { id: parseInt(id) },
            include: {
                vendor: true,
                allocations: {
                    include: { purchasebill: true }
                }
            }
        });

        if (!existingPayment) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const modeMap = {
            'Bank Transfer': 'BANK',
            'Online': 'BANK',
            'UPI': 'UPI',
            'Cash': 'CASH',
            'Credit Card': 'CARD',
            'Cheque': 'CHEQUE'
        };
        const normalizedMode = modeMap[paymentMode] || 'OTHER';

        // Normalize new allocations
        let normalizedNewAllocations = [];
        if (allocations && allocations.length > 0) {
            normalizedNewAllocations = allocations.map(a => ({
                purchaseBillId: parseInt(a.purchaseBillId),
                amount: parseFloat(a.amount)
            }));
        } else if (req.body.purchaseBillId) {
            normalizedNewAllocations = [{
                purchaseBillId: parseInt(req.body.purchaseBillId),
                amount: parseFloat(amount || existingPayment.amount)
            }];
        }

        const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
        const finalAmount = amount !== undefined ? parseFloat(amount) : existingPayment.amount;
        const newPayTotalLimit = finalAmount + parseFloat(req.body.discountAmount !== undefined ? (req.body.discountAmount || 0) : (existingPayment.discountAmount || 0));
        if (newAllocatedSum > newPayTotalLimit) {
            return res.status(400).json({ success: false, message: 'Total allocation cannot exceed the paid amount plus discount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. REVERSE PREVIOUS EFFECTS
            // Reverse Bills based on old allocations
            const oldDiscount = existingPayment.discountAmount || 0;
            for (let i = 0; i < existingPayment.allocations.length; i++) {
                const oldAlloc = existingPayment.allocations[i];
                const bill = await tx.purchasebill.findUnique({ where: { id: oldAlloc.purchaseBillId } });
                if (bill) {
                    const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
                    await updateBillBalance(tx, oldAlloc.purchaseBillId, -(oldAlloc.amount + oldAllocDiscount));
                }
            }

            // Calculate old ledger amounts to revert
            let oldLedgerAmount = 0;
            let oldLedgerDiscount = 0;
            const oldAllocatedSum = existingPayment.allocations.reduce((sum, a) => sum + a.amount, 0);
            const oldUnallocatedAmount = existingPayment.amount - oldAllocatedSum;

            for (let i = 0; i < existingPayment.allocations.length; i++) {
                const oldAlloc = existingPayment.allocations[i];
                const rate = oldAlloc.purchasebill?.exchangeRate || 1.0;
                oldLedgerAmount += oldAlloc.amount * rate;
                if (i === 0) {
                    oldLedgerDiscount += oldDiscount * rate;
                }
            }
            oldLedgerAmount += oldUnallocatedAmount;

            // Reverse Vendor
            if (existingPayment.vendor?.ledgerId) {
                const vendorLedger = await tx.ledger.findUnique({ where: { id: existingPayment.vendor.ledgerId } });
                if (vendorLedger) {
                    await tx.ledger.update({
                        where: { id: existingPayment.vendor.ledgerId },
                        data: { currentBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                    });
                }
                await tx.vendor.update({
                    where: { id: existingPayment.vendorId },
                    data: { accountBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                });
            }

            if (existingPayment.cashBankAccountId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: existingPayment.cashBankAccountId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: existingPayment.cashBankAccountId },
                        data: { currentBalance: { increment: oldLedgerAmount } }
                    });
                }
            }

            if (existingPayment.discountLedgerId && oldLedgerDiscount > 0) {
                const discountLedger = await tx.ledger.findUnique({ where: { id: existingPayment.discountLedgerId } });
                if (discountLedger) {
                    await tx.ledger.update({
                        where: { id: existingPayment.discountLedgerId },
                        data: { currentBalance: { decrement: oldLedgerDiscount } }
                    });
                }
            }

            // Delete old transactions & old allocations
            await tx.transaction.deleteMany({ where: { paymentId: existingPayment.id } });
            await tx.paymentbillallocation.deleteMany({ where: { paymentId: existingPayment.id } });

            // 2. APPLY NEW EFFECTS
            const finalAmount = amount !== undefined ? parseFloat(amount) : existingPayment.amount;
            const finalDiscount = discountAmount !== undefined ? parseFloat(discountAmount || 0) : (existingPayment.discountAmount || 0);
            const finalBankId = cashBankAccountId ? parseInt(cashBankAccountId) : existingPayment.cashBankAccountId;
            const finalDiscountLedgerId = discountLedgerId !== undefined ? (discountLedgerId ? parseInt(discountLedgerId) : null) : existingPayment.discountLedgerId;

            const updatedPayment = await tx.payment.update({
                where: { id: parseInt(id) },
                data: {
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    paymentNumber,
                    date: date ? new Date(date) : undefined,
                    vendorId: vendorId ? parseInt(vendorId) : undefined,
                    purchaseBillId: req.body.purchaseBillId ? parseInt(req.body.purchaseBillId) : (normalizedNewAllocations[0]?.purchaseBillId || null),
                    amount: finalAmount,
                    paymentMode: normalizedMode,
                    referenceNumber,
                    cashBankAccountId: finalBankId,
                    notes,
                    discountAmount: finalDiscount,
                    discountLedgerId: finalDiscountLedgerId,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status !== undefined ? status : undefined
                },
                include: { vendor: { include: { ledger: true } } }
            });

            // Create new allocations and update new Bills
            let totalBankAmount = 0; // Bank credit in base currency
            let totalVendorAmount = 0; // Vendor debit in base currency
            let totalLedgerDiscount = 0; // Discount in base currency
            let totalForexDiff = 0; // Cumulative forex difference
            const newAllocatedSum = normalizedNewAllocations.reduce((sum, a) => sum + a.amount, 0);
            const unallocatedAmount = finalAmount - newAllocatedSum;

            // Payment exchange rate
            const paymentRate = parseFloat(req.body.exchangeRate) || 1.0;

            // Find or create Foreign Exchange Gain/Loss Ledger
            let forexLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(currentCompanyId), name: 'Foreign Exchange Gain/Loss' }
            });
            if (!forexLedger) {
                let incomeGroup = await tx.accountgroup.findFirst({
                    where: { companyId: parseInt(currentCompanyId), type: 'INCOME' }
                });
                if (!incomeGroup) {
                    incomeGroup = await tx.accountgroup.create({
                        data: {
                            name: 'Indirect Income',
                            type: 'INCOME',
                            companyId: parseInt(currentCompanyId)
                        }
                    });
                }
                forexLedger = await tx.ledger.create({
                    data: {
                        name: 'Foreign Exchange Gain/Loss',
                        groupId: incomeGroup.id,
                        companyId: parseInt(currentCompanyId),
                        isControlAccount: false
                    }
                });
            }

            for (let i = 0; i < normalizedNewAllocations.length; i++) {
                const alloc = normalizedNewAllocations[i];

                await tx.paymentbillallocation.create({
                    data: {
                        paymentId: parseInt(id),
                        purchaseBillId: alloc.purchaseBillId,
                        amount: alloc.amount,
                        companyId: parseInt(currentCompanyId)
                    }
                });

                const bill = await tx.purchasebill.findUnique({ where: { id: alloc.purchaseBillId } });
                if (bill) {
                    const allocDiscount = (i === 0) ? finalDiscount : 0;
                    await updateBillBalance(tx, alloc.purchaseBillId, alloc.amount + allocDiscount);

                    const billRate = bill.exchangeRate || 1.0;
                    const bankAllocAmount = alloc.amount * paymentRate;
                    const vendorAllocAmount = alloc.amount * billRate;

                    totalBankAmount += bankAllocAmount;
                    totalVendorAmount += vendorAllocAmount;
                    totalLedgerDiscount += allocDiscount * billRate;

                    // Forex difference on Vendor Payment: cleared vendor liability - paid bank cash
                    const forexDiff = vendorAllocAmount - bankAllocAmount;
                    totalForexDiff += forexDiff;
                }
            }
            // Unallocated portion
            totalBankAmount += unallocatedAmount * paymentRate;
            totalVendorAmount += unallocatedAmount * paymentRate;

            // Accounting Entries
            const transactions = [];

            // Discount Received (debit Vendor, credit Discount Received)
            if (finalDiscountLedgerId && totalLedgerDiscount > 0) {
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: newVendor.ledgerId,
                    creditLedgerId: parseInt(finalDiscountLedgerId),
                    amount: totalLedgerDiscount,
                    narration: `Updated Discount received from ${newVendor.name}`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
            }

            // Debit Vendor / Credit Bank and/or book Forex entries
            if (Math.abs(totalForexDiff) <= 0.001) {
                // Standard entry: DR Vendor, CR Bank
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: newVendor.ledgerId,
                    creditLedgerId: finalBankId,
                    amount: totalBankAmount,
                    narration: `Updated Payment to ${newVendor.name}`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
            } else if (totalForexDiff > 0) {
                // Forex Gain:
                // DR Vendor: totalVendorAmount
                // CR Bank: totalBankAmount
                // CR Forex Gain: totalForexDiff
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: newVendor.ledgerId,
                    creditLedgerId: finalBankId,
                    amount: totalBankAmount,
                    narration: `Updated Payment to ${newVendor.name}`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: newVendor.ledgerId,
                    creditLedgerId: forexLedger.id,
                    amount: totalForexDiff,
                    narration: `Updated Foreign Exchange Gain on payment to ${newVendor.name}`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
            } else {
                // Forex Loss:
                // DR Vendor: totalVendorAmount
                // DR Forex Loss: Math.abs(totalForexDiff)
                // CR Bank: totalBankAmount
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: newVendor.ledgerId,
                    creditLedgerId: finalBankId,
                    amount: totalVendorAmount,
                    narration: `Updated Payment to ${newVendor.name} (Bill rate portion)`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
                transactions.push({
                    date: date ? new Date(date) : updatedPayment.date,
                    voucherType: 'PAYMENT',
                    voucherNumber: paymentNumber || updatedPayment.paymentNumber,
                    debitLedgerId: forexLedger.id,
                    creditLedgerId: finalBankId,
                    amount: Math.abs(totalForexDiff),
                    narration: `Updated Foreign Exchange Loss on payment to ${newVendor.name}`,
                    companyId: parseInt(currentCompanyId),
                    paymentId: updatedPayment.id
                });
            }

            const finalTxs = transactions.filter(t => t.amount > 0.001);
            for (const t of finalTxs) {
                await tx.transaction.create({ data: t });
            }

            // Update Ledger Balances strictly based on created transactions
            const allDbTxs = await tx.transaction.findMany({ where: { paymentId: updatedPayment.id } });
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

            const finalVendorLedger = await tx.ledger.findUnique({ where: { id: newVendor.ledgerId } });
            await tx.vendor.update({
                where: { id: newVendor.id },
                data: { accountBalance: finalVendorLedger.currentBalance }
            });

            return updatedPayment;
        }, {
            timeout: 30000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Payment', result.id, `Payment #${result.paymentNumber} updated for Vendor ID ${result.vendorId} with amount ${result.amount}`);
        res.json(result);
    } catch (error) {
        console.error('Update Payment Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const deletePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const payment = await prisma.payment.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                vendor: true,
                allocations: {
                    include: { purchasebill: true }
                }
            }
        });

        if (!payment) return res.status(404).json({ message: 'Payment not found' });

        await prisma.$transaction(async (tx) => {
            // Reverse Bills paid amounts based on old allocations
            const oldDiscount = payment.discountAmount || 0;
            for (let i = 0; i < payment.allocations.length; i++) {
                const oldAlloc = payment.allocations[i];
                const bill = await tx.purchasebill.findUnique({ where: { id: oldAlloc.purchaseBillId } });
                if (bill) {
                    const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
                    await updateBillBalance(tx, oldAlloc.purchaseBillId, -(oldAlloc.amount + oldAllocDiscount));
                }
            }

            // Calculate old ledger amounts to revert
            let oldLedgerAmount = 0;
            let oldLedgerDiscount = 0;
            const oldAllocatedSum = payment.allocations.reduce((sum, a) => sum + a.amount, 0);
            const oldUnallocatedAmount = payment.amount - oldAllocatedSum;

            for (let i = 0; i < payment.allocations.length; i++) {
                const oldAlloc = payment.allocations[i];
                const rate = oldAlloc.purchasebill?.exchangeRate || 1.0;
                oldLedgerAmount += oldAlloc.amount * rate;
                if (i === 0) {
                    oldLedgerDiscount += oldDiscount * rate;
                }
            }
            oldLedgerAmount += oldUnallocatedAmount;

            // Reverse Vendor ledger balance
            if (payment.vendor?.ledgerId) {
                const vendorLedger = await tx.ledger.findUnique({ where: { id: payment.vendor.ledgerId } });
                if (vendorLedger) {
                    await tx.ledger.update({
                        where: { id: payment.vendor.ledgerId },
                        data: { currentBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                    });
                }
                await tx.vendor.update({
                    where: { id: payment.vendorId },
                    data: { accountBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
                });
            }

            if (payment.cashBankAccountId) {
                const bankLedger = await tx.ledger.findUnique({ where: { id: payment.cashBankAccountId } });
                if (bankLedger) {
                    await tx.ledger.update({
                        where: { id: payment.cashBankAccountId },
                        data: { currentBalance: { increment: oldLedgerAmount } }
                    });
                }
            }

            if (payment.discountLedgerId && oldLedgerDiscount > 0) {
                const discountLedger = await tx.ledger.findUnique({ where: { id: payment.discountLedgerId } });
                if (discountLedger) {
                    await tx.ledger.update({
                        where: { id: payment.discountLedgerId },
                        data: { currentBalance: { decrement: oldLedgerDiscount } }
                    });
                }
            }

            // Delete transactions, allocations and payment
            await tx.transaction.deleteMany({ where: { paymentId: payment.id } });
            await tx.paymentbillallocation.deleteMany({ where: { paymentId: payment.id } });
            await tx.payment.delete({ where: { id: parseInt(id), companyId: parseInt(companyId) } });
        }, {
            timeout: 30000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Payment', payment.id, `Payment #${payment.paymentNumber} deleted for Vendor ID ${payment.vendorId} with amount ${payment.amount}`);
        res.json({ success: true, message: 'Payment deleted successfully' });
    } catch (error) {
        console.error('Delete Payment Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const deletePaymentHelper = async (tx, payment, companyId) => {
    const fullPayment = await tx.payment.findUnique({
        where: { id: payment.id },
        include: {
            allocations: { include: { purchasebill: true } }
        }
    });

    if (!fullPayment) return;

    // Reverse Bills paid amounts based on old allocations
    const oldDiscount = fullPayment.discountAmount || 0;
    for (let i = 0; i < fullPayment.allocations.length; i++) {
        const oldAlloc = fullPayment.allocations[i];
        const bill = await tx.purchasebill.findUnique({ where: { id: oldAlloc.purchaseBillId } });
        if (bill) {
            const oldAllocDiscount = (i === 0) ? oldDiscount : 0;
            const revPaid = Math.max(0, (bill.paidAmount || 0) - oldAlloc.amount - oldAllocDiscount);
            const revBalance = bill.totalAmount - revPaid;
            await tx.purchasebill.update({
                where: { id: oldAlloc.purchaseBillId },
                data: {
                    paidAmount: revPaid,
                    balanceAmount: revBalance,
                    status: revBalance <= 0 ? 'PAID' : (revPaid > 0 ? 'PARTIAL' : 'UNPAID')
                }
            });
        }
    }

    // Calculate old ledger amounts to revert
    let oldLedgerAmount = 0;
    let oldLedgerDiscount = 0;
    const oldAllocatedSum = fullPayment.allocations.reduce((sum, a) => sum + a.amount, 0);
    const oldUnallocatedAmount = fullPayment.amount - oldAllocatedSum;

    for (let i = 0; i < fullPayment.allocations.length; i++) {
        const oldAlloc = fullPayment.allocations[i];
        const rate = oldAlloc.purchasebill?.exchangeRate || 1.0;
        oldLedgerAmount += oldAlloc.amount * rate;
        if (i === 0) {
            oldLedgerDiscount += oldDiscount * rate;
        }
    }
    oldLedgerAmount += oldUnallocatedAmount;

    // Reverse Vendor ledger balance
    const vendor = await tx.vendor.findUnique({ where: { id: fullPayment.vendorId } });
    if (vendor && vendor.ledgerId) {
        await tx.ledger.update({
            where: { id: vendor.ledgerId },
            data: { currentBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
        });
        await tx.vendor.update({
            where: { id: fullPayment.vendorId },
            data: { accountBalance: { increment: oldLedgerAmount + oldLedgerDiscount } }
        });
    }

    if (fullPayment.cashBankAccountId) {
        await tx.ledger.update({
            where: { id: fullPayment.cashBankAccountId },
            data: { currentBalance: { increment: oldLedgerAmount } }
        });
    }

    if (fullPayment.discountLedgerId && oldLedgerDiscount > 0) {
        await tx.ledger.update({
            where: { id: fullPayment.discountLedgerId },
            data: { currentBalance: { decrement: oldLedgerDiscount } }
        });
    }

    // Delete transactions, allocations and payment
    await tx.transaction.deleteMany({ where: { paymentId: fullPayment.id } });
    await tx.paymentbillallocation.deleteMany({ where: { paymentId: fullPayment.id } });
    await tx.payment.delete({ where: { id: fullPayment.id } });
};

module.exports = {
    createPayment,
    getPayments,
    getPaymentById,
    updatePayment,
    deletePayment,
    deletePaymentHelper
};
