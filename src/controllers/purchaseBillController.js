const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');
const {
    getInventoryConfig,
    recordStockIn,
    reverseStockIn,
    calculateNetRate
} = require('../services/inventoryValuationService');

// Helper to dynamically adjust Purchase Bill quantities and amounts by associated returns
const adjustBillWithReturns = (bill) => {
    if (!bill) return bill;

    const returns = bill.purchasereturn || [];
    let returnedTotal = 0;
    const returnedItemsMap = {}; // productId -> { quantity, amount }

    for (const ret of returns) {
        returnedTotal += ret.totalAmount || 0;
        const retItems = ret.purchasereturnitem || [];
        for (const item of retItems) {
            if (item.productId) {
                if (!returnedItemsMap[item.productId]) {
                    returnedItemsMap[item.productId] = { quantity: 0, amount: 0 };
                }
                returnedItemsMap[item.productId].quantity += item.quantity || 0;
                returnedItemsMap[item.productId].amount += item.amount || 0;
            }
        }
    }

    if (bill.purchasebillitem) {
        bill.purchasebillitem = bill.purchasebillitem.map(item => {
            const ret = returnedItemsMap[item.productId];
            if (ret) {
                const adjustedQty = Math.max(0, item.quantity - ret.quantity);
                const adjustedAmt = Math.max(0, item.amount - ret.amount);
                return {
                    ...item,
                    quantity: adjustedQty,
                    amount: adjustedAmt
                };
            }
            return item;
        });
    }

    const adjustedTotal = Math.max(0, bill.totalAmount - returnedTotal);
    const paidAmount = bill.paidAmount || 0;
    const adjustedBalance = Math.max(0, adjustedTotal - paidAmount);

    let adjustedStatus = bill.status;
    if (bill.manualStatus === true || bill.manualStatus === 'true') {
        adjustedStatus = bill.status;
    } else if (adjustedBalance <= 0) {
        adjustedStatus = 'PAID';
    } else if (paidAmount > 0) {
        adjustedStatus = 'PARTIAL';
    } else {
        adjustedStatus = 'UNPAID';
    }

    return {
        ...bill,
        totalAmount: adjustedTotal,
        balanceAmount: adjustedBalance,
        status: adjustedStatus
    };
};

// Create Purchase Bill (Financial Posting)
const createBill = async (req, res) => {
    try {
        const { billNumber, date, dueDate, vendorId, purchaseOrderId, grnId, items, notes, discountAmount, taxAmount, totalAmount, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, currency, exchangeRate, customFields, manualStatus, status } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const docCurrency = currency || 'USD';
        const docExchangeRate = parseFloat(exchangeRate) || 1.0;

        if (!billNumber || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // Check if Purchase Bill with this number already exists
        const existingBill = await prisma.purchasebill.findFirst({
            where: {
                companyId: parseInt(companyId),
                billNumber: billNumber
            }
        });

        if (existingBill) {
            return res.status(400).json({
                success: false,
                message: `Purchase Bill with number '${billNumber}' already exists. Please use a unique bill number.`
            });
        }

        // Check if Journal Entry / Voucher Number is already in use
        const existingJournal = await prisma.journalentry.findFirst({
            where: {
                companyId: parseInt(companyId),
                voucherNumber: billNumber
            }
        });

        if (existingJournal) {
            return res.status(400).json({
                success: false,
                message: `Voucher Number '${billNumber}' is already in use by another transaction (e.g. Sales Invoice or POS Invoice). Please use a unique bill number.`
            });
        }

        // Validate bill date is not before vendor's account creation date
        const vendorForDateCheck = await prisma.vendor.findUnique({
            where: { id: parseInt(vendorId) },
            select: { creationDate: true }
        });
        if (vendorForDateCheck?.creationDate && date) {
            const txDate = new Date(date);
            const accountDate = new Date(vendorForDateCheck.creationDate);
            txDate.setHours(0, 0, 0, 0);
            accountDate.setHours(0, 0, 0, 0);
            if (txDate < accountDate) {
                return res.status(400).json({
                    success: false,
                    message: `Bill date (${txDate.toDateString()}) cannot be before the vendor's account creation date (${accountDate.toDateString()}).`
                });
            }
        }

        let calculatedSubtotal = 0;
        let calculatedItemDiscount = 0;
        let calculatedTaxSum = 0;

        const billItems = items.map(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            const discount = parseFloat(item.discount || 0);
            const taxRate = parseFloat(item.taxRate || 0);

            const lineGross = qty * rate;
            const lineTaxable = lineGross - discount;
            const lineTax = (lineTaxable * taxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            calculatedSubtotal += lineGross;
            calculatedItemDiscount += discount;
            calculatedTaxSum += lineTax;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                uomId: item.uomId ? parseInt(item.uomId) : null,
                description: item.description,
                quantity: qty,
                rate: rate,
                discount: discount,
                taxRate: taxRate,
                amount: lineTotal
            };
        });

        const finalTax = parseFloat(taxAmount) || calculatedTaxSum;
        const baseTotal = (calculatedSubtotal - calculatedItemDiscount) + finalTax;
        let totalAmountValue = baseTotal;
        const ovVal = parseFloat(overallDiscount) || 0;
        let overallDiscountAmt = 0;
        if (overallDiscount && overallDiscountType === 'percentage') {
            overallDiscountAmt = baseTotal * ovVal / 100;
            totalAmountValue = baseTotal - overallDiscountAmt;
        } else if (overallDiscount) {
            overallDiscountAmt = ovVal;
            totalAmountValue = baseTotal - overallDiscountAmt;
        }

        const totalDiscount = calculatedItemDiscount + overallDiscountAmt;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Purchase Bill
            const bill = await tx.purchasebill.create({
                data: {
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    billNumber,
                    date: new Date(date),
                    dueDate: dueDate ? new Date(dueDate) : null,
                    vendorId: parseInt(vendorId),
                    purchaseOrderId: purchaseOrderId ? parseInt(purchaseOrderId) : null,
                    grnId: grnId ? parseInt(grnId) : null,
                    companyId: parseInt(companyId),
                    subtotal: calculatedSubtotal,
                    discountAmount: totalDiscount,
                    taxAmount: finalTax,
                    totalAmount: totalAmountValue,
                    balanceAmount: totalAmountValue,
                    currency: docCurrency,
                    exchangeRate: docExchangeRate,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'UNPAID',
                    notes,
                    billingName,
                    billingAddress,
                    billingCity,
                    billingState,
                    billingZipCode,
                    billingCountry,
                    shippingName,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingCountry,
                    overallDiscount: overallDiscount ? parseFloat(overallDiscount) : 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    purchasebillitem: {
                        create: billItems.map(i => ({
                            productId: i.productId,
                            warehouseId: i.warehouseId,
                            uomId: i.uomId,
                            description: i.description,
                            quantity: i.quantity,
                            rate: i.rate,
                            discount: i.discount,
                            taxRate: i.taxRate,
                            amount: i.amount
                        }))
                    }
                },
                include: {
                    purchasebillitem: {
                        include: {
                            product: true,
                            warehouse: true,
                            uom: true
                        }
                    }
                }
            });

            // Process Advance Adjustments if provided
            let totalAdjustedAmount = 0;
            if (req.body.adjustments && req.body.adjustments.length > 0) {
                for (const adj of req.body.adjustments) {
                    const payment = await tx.payment.findUnique({
                        where: { id: parseInt(adj.paymentId) },
                        include: { allocations: true }
                    });
                    if (payment) {
                        const allocatedSum = payment.allocations.reduce((sum, a) => sum + a.amount, 0);
                        const availableUnallocated = payment.amount - allocatedSum;
                        const adjustAmt = Math.min(parseFloat(adj.amount), availableUnallocated);
                        
                        if (adjustAmt > 0) {
                            // Create allocation record
                            await tx.paymentbillallocation.create({
                                data: {
                                    paymentId: payment.id,
                                    purchaseBillId: bill.id,
                                    amount: adjustAmt,
                                    companyId: parseInt(companyId)
                                }
                            });
                            totalAdjustedAmount += adjustAmt;
                        }
                    }
                }
            }

            if (totalAdjustedAmount > 0) {
                const finalPaid = totalAdjustedAmount;
                const finalBalance = totalAmountValue - finalPaid;
                await tx.purchasebill.update({
                    where: { id: bill.id },
                    data: {
                        paidAmount: finalPaid,
                        balanceAmount: finalBalance,
                        status: (manualStatus === true || manualStatus === 'true') && status ? status : (finalBalance <= 0 ? 'PAID' : 'PARTIAL')
                    }
                });
                bill.paidAmount = finalPaid;
                bill.balanceAmount = finalBalance;
                bill.status = (manualStatus === true || manualStatus === 'true') && status ? status : (finalBalance <= 0 ? 'PAID' : 'PARTIAL');
            }

            // Update linked PO status if exists
            if (purchaseOrderId) {
                await tx.purchaseorder.update({
                    where: { id: parseInt(purchaseOrderId) },
                    data: { status: 'COMPLETED' }
                });
            }

            // Update linked GRN status if exists
            if (grnId) {
                await tx.goodsreceiptnote.update({
                    where: { id: parseInt(grnId) },
                    data: { status: 'Invoiced' }
                });
            }

            // 2. Ledger Posting (Dr Inventory/Purchase, Cr Vendor)
            const vendor = await tx.vendor.findUnique({ where: { id: parseInt(vendorId) }, include: { ledger: true } });
            if (!vendor || !vendor.ledger) throw new Error('Vendor ledger not found. Please link a ledger to this vendor first.');

            // Helper to resolve ledgers (Auto-create if missing)
            const resolveLedger = async (namePattern, type) => {
                let ledger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await tx.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(companyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };


            const inventoryLedger = await resolveLedger('Inventory Asset', 'ASSETS') || await resolveLedger('Inventory', 'ASSETS');
            const purchaseLedger = await resolveLedger('Purchases', 'EXPENSES') || await resolveLedger('Purchase', 'EXPENSES');
            const discountReceivedLedger = await resolveLedger('Discount Received on Purchase', 'INCOME') || await resolveLedger('Discount Received', 'INCOME');

            // 3. Create Journal Entry
            const journalEntry = await tx.journalentry.create({
                data: {
                    date: new Date(date),
                    voucherNumber: billNumber,
                    narration: `Purchase Bill #${billNumber}`,
                    companyId: parseInt(companyId),
                }
            });

            // 4. Process Items for Accounting and Price Updates
            let totalProductGross = 0;
            let totalServiceGross = 0;

            for (const item of billItems) {
                const lineGross = item.quantity * item.rate;
                if (item.productId) {
                    totalProductGross += lineGross;
                    // Update Product Purchase Price
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { purchasePrice: item.rate }
                    });
                } else {
                    totalServiceGross += lineGross;
                }
            }

            // 5. DR Inventory / Purchases, CR Vendor
            const creditLedgerId = vendor.ledger.id;

            const ledgerProductAmount = totalProductGross * docExchangeRate;
            const ledgerServiceAmount = totalServiceGross * docExchangeRate;
            const ledgerTaxAmount = finalTax * docExchangeRate;
            const ledgerDiscountAmount = totalDiscount * docExchangeRate;
            const ledgerTotalAmount = totalAmountValue * docExchangeRate;

            // Entry for Products (Debit Purchases)
            const finalProductLedger = inventoryLedger || purchaseLedger;
            if (totalProductGross > 0 && finalProductLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        amount: ledgerProductAmount,
                        debitLedgerId: finalProductLedger.id,
                        creditLedgerId: creditLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: bill.id,
                        narration: 'Product Purchases'
                    }
                });
                await tx.ledger.update({ where: { id: finalProductLedger.id }, data: { currentBalance: { increment: ledgerProductAmount } } });
                await tx.ledger.update({ where: { id: creditLedgerId }, data: { currentBalance: { increment: ledgerProductAmount } } });

                // Update Physical Stock AND Inventory Valuation Layers
                if (!grnId) {
                    // Get inventory valuation method
                    const invConfig = await getInventoryConfig(companyId);
                    const valuationMethod = invConfig.valuationMethod || 'WAC';

                    for (const item of billItems) {
                        if (item.productId && item.warehouseId) {
                            // Fetch Product with Base UoM
                            const prod = await tx.product.findUnique({
                                where: { id: item.productId },
                                include: { uom: true }
                            });

                            // Fetch Selected Transaction UoM
                            let transUom = null;
                            if (item.uomId) {
                                transUom = await tx.uom.findUnique({
                                    where: { id: item.uomId }
                                });
                            }
                            const baseUom = prod?.uom;

                            // Convert quantity and rate to base UoM
                            const { convertToBaseQuantity, convertTransRateToBaseRate } = require('../services/uomConversionService');
                            const baseQty = convertToBaseQuantity(item.quantity, transUom, baseUom);
                            const netRate = calculateNetRate(item.rate, item.quantity, item.discount);
                            const baseNetRate = convertTransRateToBaseRate(netRate, transUom, baseUom);

                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                                update: { quantity: { increment: baseQty } },
                                create: { warehouseId: item.warehouseId, productId: item.productId, quantity: baseQty }
                            });

                            await tx.inventorytransaction.create({
                                data: {
                                    date: new Date(date),
                                    type: 'PURCHASE',
                                    productId: item.productId,
                                    toWarehouseId: item.warehouseId,
                                    quantity: baseQty,
                                    reason: `Direct Purchase Bill: ${billNumber}`,
                                    companyId: parseInt(companyId),
                                    userId: req.user?.userId || null
                                }
                            });

                            // Record inventory valuation layer (FIFO or WAC)
                            await recordStockIn(tx, {
                                companyId,
                                productId: item.productId,
                                warehouseId: item.warehouseId,
                                quantity: baseQty,
                                rate: baseNetRate,
                                purchaseBillId: bill.id,
                                method: valuationMethod
                            });
                        }
                    }
                }
            }


            // Entry for Services/Others (Debit Purchases Expense)
            const finalPurchaseLedger = purchaseLedger || inventoryLedger; // Fallback
            if (totalServiceGross > 0 && finalPurchaseLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        amount: ledgerServiceAmount,
                        debitLedgerId: finalPurchaseLedger.id,
                        creditLedgerId: creditLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: bill.id,
                        narration: 'Service/General Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: finalPurchaseLedger.id }, data: { currentBalance: { increment: ledgerServiceAmount } } });
                await tx.ledger.update({ where: { id: creditLedgerId }, data: { currentBalance: { increment: ledgerServiceAmount } } });
            }

            // Handle Tax if applicable (Debit Tax Input, Credit Vendor)
            if (parseFloat(finalTax) > 0) {
                const taxInputLedger = await resolveLedger('Tax', 'ASSETS') || await resolveLedger('Tax', 'LIABILITIES');
                if (taxInputLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(date),
                            amount: ledgerTaxAmount,
                            debitLedgerId: taxInputLedger.id,
                            creditLedgerId: creditLedgerId,
                            voucherType: 'PURCHASE',
                            voucherNumber: billNumber,
                            companyId: parseInt(companyId),
                            journalEntryId: journalEntry.id,
                            purchaseBillId: bill.id,
                            narration: 'Tax on Purchase'
                        }
                    });
                    await tx.ledger.update({ where: { id: taxInputLedger.id }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                    await tx.ledger.update({ where: { id: creditLedgerId }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                }
            }

            // Handle Discount Received if applicable (Debit Vendor, Credit Discount Received)
            if (ledgerDiscountAmount > 0 && discountReceivedLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        amount: ledgerDiscountAmount,
                        debitLedgerId: creditLedgerId, // Vendor (reduces liability with debit)
                        creditLedgerId: discountReceivedLedger.id, // Discount Received (increases income with credit)
                        voucherType: 'PURCHASE',
                        voucherNumber: billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: bill.id,
                        narration: 'Discount Received on Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: discountReceivedLedger.id }, data: { currentBalance: { increment: ledgerDiscountAmount } } });
                await tx.ledger.update({ where: { id: creditLedgerId }, data: { currentBalance: { decrement: ledgerDiscountAmount } } });
            }

            // Update Vendor Balance (Credit increases Liability)
            await tx.vendor.update({
                where: { id: parseInt(vendorId) },
                data: { accountBalance: { increment: ledgerTotalAmount } }
            });

            return bill;
        }, {
            timeout: 120000
        });

        await numberingService.incrementNumber(companyId, 'purchasebill', billNumber);
        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'PurchaseBill', result.id, `Purchase Bill #${result.billNumber} created for Vendor ID ${result.vendorId} with amount ${result.totalAmount}`);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Purchase Bill Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getBills = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const bills = await prisma.purchasebill.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                vendor: true,
                purchasebillitem: {
                    include: {
                        product: true,
                        warehouse: true,
                        uom: true
                    }
                },
                purchaseorder: true,
                goodsreceiptnote: true,
                purchasereturn: {
                    include: {
                        purchasereturnitem: true
                    }
                },
                payment: {
                    include: {
                        bankLedger: { select: { id: true, name: true } }
                    }
                },
                allocations: {
                    include: {
                        payment: {
                            include: {
                                bankLedger: { select: { id: true, name: true } }
                            }
                        }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Map allocations to payment list to maintain compatibility and show correct allocated amount
        const mappedBills = bills.map(bill => {
            const mappedPayments = [
                ...bill.payment.map(p => ({ ...p })),
                ...bill.allocations.map(alloc => ({
                    id: alloc.payment.id,
                    paymentNumber: alloc.payment.paymentNumber,
                    date: alloc.payment.date,
                    amount: alloc.amount, // Only the allocated amount
                    paymentMode: alloc.payment.paymentMode,
                    referenceNumber: alloc.payment.referenceNumber,
                    bankLedger: alloc.payment.bankLedger,
                    notes: alloc.payment.notes
                }))
            ];

            const seenIds = new Set();
            const deduplicatedPayments = [];
            for (const p of mappedPayments) {
                if (!seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    deduplicatedPayments.push(p);
                }
            }

            return adjustBillWithReturns({
                ...bill,
                payment: deduplicatedPayments
            });
        });

        res.status(200).json({ success: true, data: mappedBills });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getBillById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;
        const bill = await prisma.purchasebill.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                vendor: true,
                purchasebillitem: {
                    include: {
                        product: true,
                        warehouse: true,
                        uom: true
                    }
                },
                purchaseorder: true,
                goodsreceiptnote: true,
                purchasereturn: {
                    include: {
                        purchasereturnitem: true
                    }
                },
                payment: {
                    include: {
                        bankLedger: true
                    }
                },
                allocations: {
                    include: {
                        payment: {
                            include: {
                                bankLedger: true
                            }
                        }
                    }
                }
            }
        });
        if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });

        // Map allocations to payment list to maintain compatibility and show correct allocated amount
        const mappedPayments = [
            ...bill.payment.map(p => ({ ...p })),
            ...bill.allocations.map(alloc => ({
                id: alloc.payment.id,
                paymentNumber: alloc.payment.paymentNumber,
                date: alloc.payment.date,
                amount: alloc.amount, // Only the allocated amount
                paymentMode: alloc.payment.paymentMode,
                referenceNumber: alloc.payment.referenceNumber,
                bankLedger: alloc.payment.bankLedger,
                notes: alloc.payment.notes
            }))
        ];

        const seenIds = new Set();
        const deduplicatedPayments = [];
        for (const p of mappedPayments) {
            if (!seenIds.has(p.id)) {
                seenIds.add(p.id);
                deduplicatedPayments.push(p);
            }
        }

        const mappedBill = adjustBillWithReturns({
            ...bill,
            payment: deduplicatedPayments
        });

        res.status(200).json({ success: true, data: mappedBill });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteBill = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const bill = await prisma.purchasebill.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                transaction: true,
                vendor: { include: { ledger: true } }
            }
        });

        if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });

        await prisma.$transaction(async (tx) => {
            const { deletePurchaseReturnHelper } = require('./purchaseReturnController');
            const { deletePaymentHelper } = require('./paymentController');

            // Find and delete linked purchase returns
            const linkedReturns = await tx.purchasereturn.findMany({
                where: { purchaseBillId: bill.id },
                include: { purchasereturnitem: true }
            });
            for (const ret of linkedReturns) {
                await deletePurchaseReturnHelper(tx, ret, companyId);
            }

            // Find and delete linked payments
            const linkedPayments = await tx.payment.findMany({
                where: { purchaseBillId: bill.id }
            });
            for (const pay of linkedPayments) {
                await deletePaymentHelper(tx, pay, companyId);
            }

            // Unlink any remaining payments pointing to this purchase bill to prevent FK Restrict errors
            await tx.payment.updateMany({
                where: { purchaseBillId: bill.id },
                data: { purchaseBillId: null }
            });

            // 1. Revert Ledger Balances using transactions
            const vendorLedgerId = bill.vendor?.ledger?.id;
            for (const trans of bill.transaction) {
                if (vendorLedgerId && trans.debitLedgerId === vendorLedgerId) {
                    // Discount received transaction: Dr Vendor (decreased Vendor liability), Cr Discount (increased Discount income)
                    // Reversion: Cr Vendor (increment Vendor ledger), Dr Discount (decrement Discount ledger)
                    await tx.ledger.update({
                        where: { id: trans.debitLedgerId },
                        data: { currentBalance: { increment: trans.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: trans.creditLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                } else {
                    // Standard debit trans (Dr Inventory/Expense/Tax, Cr Vendor)
                    // Reversion: decrement both
                    await tx.ledger.update({
                        where: { id: trans.debitLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: trans.creditLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                }
            }

            // Retroactive tax balance decrement for older bills
            const hasTaxTrans = bill.transaction.some(t => t.narration === 'Tax on Purchase');
            if (!hasTaxTrans && parseFloat(bill.taxAmount) > 0) {
                const taxInputLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Tax' } }
                });
                if (taxInputLedger) {
                    await tx.ledger.update({
                        where: { id: taxInputLedger.id },
                        data: { currentBalance: { decrement: parseFloat(bill.taxAmount) } }
                    });
                }
            }

            // 2. Revert Vendor Balance
            await tx.vendor.update({
                where: { id: bill.vendorId },
                data: { accountBalance: { decrement: bill.totalAmount * (bill.exchangeRate || 1.0) } }
            });

            // 3. Delete payment allocations FIRST to avoid FK constraint error on purchasebill delete
            await tx.paymentbillallocation.deleteMany({ where: { purchaseBillId: bill.id } });

            // 4. Delete related transactions and journal entries
            const journalEntryIds = [...new Set(bill.transaction.map(t => t.journalEntryId).filter(Boolean))];

            await tx.transaction.deleteMany({ where: { purchaseBillId: bill.id } });
            await tx.journalentry.deleteMany({ where: { id: { in: journalEntryIds } } });

            // Also delete any orphaned journal entries with same voucherNumber (permanent delete guarantee)
            await tx.journalentry.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: bill.billNumber,
                    transaction: { none: {} } // only truly orphaned entries (no transactions left)
                }
            });

            // 5. Reverse Physical Stock & Valuation Layers
            //    Only reverse stock if the bill was NOT created from a GRN.
            //    If a GRN was linked, the stock was added by the GRN flow — do NOT double-reverse it here.
            if (!bill.grnId) {
                const invConfig = await getInventoryConfig(companyId);
                const valuationMethod = invConfig.valuationMethod || 'WAC';

                const billItemsForReversal = await tx.purchasebillitem.findMany({
                    where: { purchaseBillId: bill.id },
                    include: { product: { include: { uom: true } }, uom: true }
                });

                const { convertToBaseQuantity, convertTransRateToBaseRate } = require('../services/uomConversionService');

                for (const item of billItemsForReversal) {
                    if (item.productId && item.warehouseId) {
                        const baseQty = convertToBaseQuantity(item.quantity, item.uom, item.product?.uom);

                        // Revert physical stock
                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: {
                                warehouseId: item.warehouseId,
                                productId: item.productId,
                                quantity: -baseQty,
                                initialQty: 0,
                                minOrderQty: 0
                            },
                            update: {
                                quantity: { decrement: baseQty }
                            }
                        });
                    }
                }

                await reverseStockIn(tx, {
                    purchaseBillId: bill.id,
                    billItems: billItemsForReversal.map(i => {
                        const baseQty = convertToBaseQuantity(i.quantity, i.uom, i.product?.uom);
                        const baseRate = convertTransRateToBaseRate(i.rate, i.uom, i.product?.uom);
                        return {
                            productId: i.productId,
                            warehouseId: i.warehouseId,
                            quantity: baseQty,
                            rate: baseRate
                        };
                    }),
                    method: valuationMethod
                });

                // Delete original inventory transactions matching this bill
                await tx.inventorytransaction.deleteMany({
                    where: {
                        companyId: parseInt(companyId),
                        reason: { contains: bill.billNumber }
                    }
                });
            }

            // 6. Delete Bill Items and Bill
            await tx.purchasebillitem.deleteMany({ where: { purchaseBillId: bill.id } });
            await tx.purchasebill.delete({ where: { id: bill.id } });
        }, {
            timeout: 90000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'PurchaseBill', bill.id, `Purchase Bill #${bill.billNumber} deleted for Vendor ID ${bill.vendorId} with amount ${bill.totalAmount}`);
        res.status(200).json({ success: true, message: 'Bill deleted successfully' });
    } catch (error) {
        console.error('Delete Bill Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateBill = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            vendorId,
            date,
            billNumber,
            notes,
            dueDate,
            items,
            totalAmount,
            taxAmount,
            discountAmount,
            billingName,
            billingAddress,
            billingCity,
            billingState,
            billingZipCode,
            billingCountry,
            shippingName,
            shippingAddress,
            shippingCity,
            shippingState,
            shippingZipCode,
            shippingCountry,
            overallDiscount,
            overallDiscountType,
            currency,
            exchangeRate,
            customFields,
            manualStatus,
            status,
            onlyUpdateStatus
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updatedBill = await prisma.purchasebill.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updatedBill });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const oldBill = await tx.purchasebill.findFirst({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                include: {
                    transaction: true,
                    vendor: { include: { ledger: true } },
                    purchasebillitem: {
                        include: {
                            product: { include: { uom: true } },
                            uom: true
                        }
                    }
                }
            });
            if (!oldBill) throw new Error('Bill not found');

            // 1. Revert Old Vendor Balance
            await tx.vendor.update({
                where: { id: oldBill.vendorId },
                data: { accountBalance: { decrement: oldBill.totalAmount * (oldBill.exchangeRate || 1.0) } }
            });

            // 2. Revert Old Ledger Balances using old transactions
            const oldVendorLedgerId = oldBill.vendor?.ledger?.id;
            for (const trans of oldBill.transaction) {
                if (oldVendorLedgerId && trans.debitLedgerId === oldVendorLedgerId) {
                    await tx.ledger.update({
                        where: { id: trans.debitLedgerId },
                        data: { currentBalance: { increment: trans.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: trans.creditLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                } else {
                    await tx.ledger.update({
                        where: { id: trans.debitLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: trans.creditLedgerId },
                        data: { currentBalance: { decrement: trans.amount } }
                    });
                }
            }

            // Retroactive tax balance decrement for older bills
            const oldHasTaxTrans = oldBill.transaction.some(t => t.narration === 'Tax on Purchase');
            if (!oldHasTaxTrans && parseFloat(oldBill.taxAmount) > 0) {
                const taxInputLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Tax' } }
                });
                if (taxInputLedger) {
                    await tx.ledger.update({
                        where: { id: taxInputLedger.id },
                        data: { currentBalance: { decrement: parseFloat(oldBill.taxAmount) } }
                    });
                }
            }

            // Revert direct Vendor ledger balance for legacy bills that did not have correct transaction tracking
            const oldHasDiscountTrans = oldBill.transaction.some(t => t.narration === 'Discount Received on Purchase');
            if (!oldHasDiscountTrans || !oldHasTaxTrans) {
                const diff = parseFloat(oldBill.totalAmount) - (oldBill.transaction.reduce((sum, t) => sum + (t.creditLedgerId === oldVendorLedgerId ? t.amount : 0), 0) - oldBill.transaction.reduce((sum, t) => sum + (t.debitLedgerId === oldVendorLedgerId ? t.amount : 0), 0));
                if (oldVendorLedgerId && Math.abs(diff) > 0.01) {
                    await tx.ledger.update({
                        where: { id: oldVendorLedgerId },
                        data: { currentBalance: { decrement: diff } }
                    });
                }
            }

            // 3. Revert Physical Stock & Valuation Layers of old items (only if direct purchase, not GRN)
            if (!oldBill.grnId) {
                const invConfig = await getInventoryConfig(companyId);
                const valuationMethod = invConfig.valuationMethod || 'WAC';
                const { convertToBaseQuantity, convertTransRateToBaseRate } = require('../services/uomConversionService');

                for (const item of oldBill.purchasebillitem) {
                    if (item.productId && item.warehouseId) {
                        const baseQty = convertToBaseQuantity(item.quantity, item.uom, item.product?.uom);

                        // Revert physical stock
                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: {
                                warehouseId: item.warehouseId,
                                productId: item.productId,
                                quantity: -baseQty,
                                initialQty: 0,
                                minOrderQty: 0
                            },
                            update: {
                                quantity: { decrement: baseQty }
                            }
                        });

                        // Log inventory transaction for return/reversal
                        await tx.inventorytransaction.create({
                            data: {
                                date: new Date(),
                                type: 'RETURN',
                                productId: item.productId,
                                fromWarehouseId: item.warehouseId,
                                quantity: baseQty,
                                reason: `Purchase Bill Edited (Stock Reversal): ${oldBill.billNumber}`,
                                companyId: parseInt(companyId),
                                userId: req.user?.userId || null
                            }
                        });
                    }
                }

                await reverseStockIn(tx, {
                    purchaseBillId: oldBill.id,
                    billItems: oldBill.purchasebillitem.map(i => {
                        const baseQty = convertToBaseQuantity(i.quantity, i.uom, i.product?.uom);
                        const baseRate = convertTransRateToBaseRate(i.rate, i.uom, i.product?.uom);
                        return {
                            productId: i.productId,
                            warehouseId: i.warehouseId,
                            quantity: baseQty,
                            rate: baseRate
                        };
                    }),
                    method: valuationMethod
                });
            }

            // 4. Delete old transactions associated with the bill, and their journal entries
            await tx.transaction.deleteMany({ where: { purchaseBillId: oldBill.id } });

            const oldJournalIds = [...new Set(oldBill.transaction.map(t => t.journalEntryId).filter(Boolean))];
            if (oldJournalIds.length > 0) {
                await tx.journalentry.deleteMany({ where: { id: { in: oldJournalIds } } });
            }

            // Clean up orphaned journal entries with same old voucher number
            await tx.journalentry.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: oldBill.billNumber,
                    transaction: { none: {} }
                }
            });

            // 5. Clear old allocations for this bill
            await tx.paymentbillallocation.deleteMany({
                where: { purchaseBillId: parseInt(id) }
            });

            // Process new adjustments
            let totalAdjustedAmount = 0;
            if (req.body.adjustments && req.body.adjustments.length > 0) {
                for (const adj of req.body.adjustments) {
                    const payment = await tx.payment.findUnique({
                        where: { id: parseInt(adj.paymentId) },
                        include: { allocations: true }
                    });
                    if (payment) {
                        const allocatedSum = payment.allocations.reduce((sum, a) => sum + a.amount, 0);
                        const availableUnallocated = payment.amount - allocatedSum;
                        const adjustAmt = Math.min(parseFloat(adj.amount), availableUnallocated);
                        
                        if (adjustAmt > 0) {
                            await tx.paymentbillallocation.create({
                                data: {
                                    paymentId: payment.id,
                                    purchaseBillId: parseInt(id),
                                    amount: adjustAmt,
                                    companyId: parseInt(companyId)
                                }
                            });
                            totalAdjustedAmount += adjustAmt;
                        }
                    }
                }
            }

            // 6. Delete old items and write new ones
            let calculatedSubtotal = 0;
            let calculatedItemDiscount = 0;
            let calculatedTaxSum = 0;

            const finalBillItems = [];
            if (items && items.length > 0) {
                await tx.purchasebillitem.deleteMany({
                    where: { purchaseBillId: parseInt(id) }
                });

                for (const item of items) {
                    const qty = parseFloat(item.quantity) || 0;
                    const rate = parseFloat(item.rate) || 0;
                    const discount = parseFloat(item.discount || 0);
                    const taxRate = parseFloat(item.taxRate || 0);

                    const lineGross = qty * rate;
                    const lineTaxable = lineGross - discount;
                    const lineTax = (lineTaxable * taxRate) / 100;
                    const lineTotal = lineTaxable + lineTax;

                    calculatedSubtotal += lineGross;
                    calculatedItemDiscount += discount;
                    calculatedTaxSum += lineTax;

                    const newItem = {
                        productId: item.productId ? parseInt(item.productId) : null,
                        warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                        uomId: item.uomId ? parseInt(item.uomId) : null,
                        description: item.description,
                        quantity: qty,
                        rate: rate,
                        discount: discount,
                        taxRate: taxRate,
                        amount: lineTotal,
                        purchaseBillId: parseInt(id)
                    };
                    finalBillItems.push(newItem);
                }

                await tx.purchasebillitem.createMany({
                    data: finalBillItems.map(i => ({
                        productId: i.productId,
                        warehouseId: i.warehouseId,
                        uomId: i.uomId,
                        description: i.description,
                        quantity: i.quantity,
                        rate: i.rate,
                        discount: i.discount,
                        taxRate: i.taxRate,
                        amount: i.amount,
                        purchaseBillId: i.purchaseBillId
                    }))
                });
            } else {
                // If items are not updated, pull from DB and recalculate
                const existingItems = await tx.purchasebillitem.findMany({ where: { purchaseBillId: parseInt(id) } });
                for (const item of existingItems) {
                    const qty = parseFloat(item.quantity) || 0;
                    const rate = parseFloat(item.rate) || 0;
                    const discount = parseFloat(item.discount || 0);
                    const taxRate = parseFloat(item.taxRate || 0);

                    const lineGross = qty * rate;
                    calculatedSubtotal += lineGross;
                    calculatedItemDiscount += discount;
                    calculatedTaxSum += (lineGross - discount) * taxRate / 100;

                    finalBillItems.push(item);
                }
            }

            // 7. Resolve Updated Base Fields
            const targetVendorId = vendorId ? parseInt(vendorId) : oldBill.vendorId;
            const targetDate = date ? new Date(date) : new Date(oldBill.date);
            const targetBillNumber = billNumber || oldBill.billNumber;

            const newVendor = await tx.vendor.findUnique({
                where: { id: targetVendorId },
                include: { ledger: true }
            });
            if (!newVendor || !newVendor.ledger) throw new Error('Vendor ledger not found. Please link a ledger to the selected vendor first.');
            const newVendorLedgerId = newVendor.ledger.id;

            const currentOverallDiscount = overallDiscount !== undefined ? overallDiscount : oldBill.overallDiscount;
            const currentOverallDiscountType = overallDiscountType !== undefined ? overallDiscountType : oldBill.overallDiscountType;

            const finalTax = taxAmount !== undefined ? parseFloat(taxAmount) : calculatedTaxSum;
            const baseTotal = (calculatedSubtotal - calculatedItemDiscount) + finalTax;
            let totalAmountValue = baseTotal;
            const ovVal = parseFloat(currentOverallDiscount) || 0;
            let overallDiscountAmt = 0;
            if (currentOverallDiscount && currentOverallDiscountType === 'percentage') {
                overallDiscountAmt = baseTotal * ovVal / 100;
                totalAmountValue = baseTotal - overallDiscountAmt;
            } else if (currentOverallDiscount) {
                overallDiscountAmt = ovVal;
                totalAmountValue = baseTotal - overallDiscountAmt;
            }

            const totalDiscount = calculatedItemDiscount + overallDiscountAmt;

            // Resolve standard accounts
            const resolveLedger = async (namePattern, type) => {
                let ledger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await tx.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(companyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            const inventoryLedger = await resolveLedger('Inventory Asset', 'ASSETS') || await resolveLedger('Inventory', 'ASSETS');
            const purchaseLedger = await resolveLedger('Purchases', 'EXPENSES') || await resolveLedger('Purchase', 'EXPENSES');
            const discountReceivedLedger = await resolveLedger('Discount Received on Purchase', 'INCOME') || await resolveLedger('Discount Received', 'INCOME');

            // 8. Create new Journal Entry
            const journalEntry = await tx.journalentry.create({
                data: {
                    date: targetDate,
                    voucherNumber: targetBillNumber,
                    narration: `Purchase Bill #${targetBillNumber}`,
                    companyId: parseInt(companyId),
                }
            });

            // 9. Update Prices and Physical Stock/Valuation Layers of new items (only if direct purchase, not GRN)
            let totalProductGross = 0;
            let totalServiceGross = 0;

            for (const item of finalBillItems) {
                const lineGross = item.quantity * item.rate;
                if (item.productId) {
                    totalProductGross += lineGross;
                    await tx.product.update({
                        where: { id: item.productId },
                        data: { purchasePrice: item.rate }
                    });
                } else {
                    totalServiceGross += lineGross;
                }
            }

            if (!oldBill.grnId) {
                const invConfig = await getInventoryConfig(companyId);
                const valuationMethod = invConfig.valuationMethod || 'WAC';
                const { convertToBaseQuantity, convertTransRateToBaseRate } = require('../services/uomConversionService');

                for (const item of finalBillItems) {
                    if (item.productId && item.warehouseId) {
                        // Fetch Product with Base UoM
                        const prod = await tx.product.findUnique({
                            where: { id: item.productId },
                            include: { uom: true }
                        });

                        // Fetch Selected Transaction UoM
                        let transUom = null;
                        if (item.uomId) {
                            transUom = await tx.uom.findUnique({
                                where: { id: item.uomId }
                            });
                        }
                        const baseUom = prod?.uom;

                        // Convert quantity and rate to base UoM
                        const baseQty = convertToBaseQuantity(item.quantity, transUom, baseUom);
                        const netRate = calculateNetRate(item.rate, item.quantity, item.discount);
                        const baseNetRate = convertTransRateToBaseRate(netRate, transUom, baseUom);

                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            update: { quantity: { increment: baseQty } },
                            create: { warehouseId: item.warehouseId, productId: item.productId, quantity: baseQty }
                        });

                        await tx.inventorytransaction.create({
                            data: {
                                date: targetDate,
                                type: 'PURCHASE',
                                productId: item.productId,
                                toWarehouseId: item.warehouseId,
                                quantity: baseQty,
                                reason: `Direct Purchase Bill (Edited): ${targetBillNumber}`,
                                companyId: parseInt(companyId),
                                userId: req.user?.userId || null
                            }
                        });

                        // Record inventory valuation layer (FIFO or WAC)
                        await recordStockIn(tx, {
                            companyId,
                            productId: item.productId,
                            warehouseId: item.warehouseId,
                            quantity: baseQty,
                            rate: baseNetRate,
                            purchaseBillId: oldBill.id,
                            method: valuationMethod
                        });
                    }
                }
            }

            // 10. Post Transactions and Update Ledgers
            const docCurrency = currency !== undefined ? currency : oldBill.currency;
            const docExchangeRate = exchangeRate !== undefined ? parseFloat(exchangeRate) : (oldBill.exchangeRate || 1.0);

            const ledgerProductAmount = totalProductGross * docExchangeRate;
            const ledgerServiceAmount = totalServiceGross * docExchangeRate;
            const ledgerTaxAmount = finalTax * docExchangeRate;
            const ledgerDiscountAmount = totalDiscount * docExchangeRate;
            const ledgerTotalAmount = totalAmountValue * docExchangeRate;

            const finalProductLedger = inventoryLedger || purchaseLedger;
            if (totalProductGross > 0 && finalProductLedger) {
                await tx.transaction.create({
                    data: {
                        date: targetDate,
                        amount: ledgerProductAmount,
                        debitLedgerId: finalProductLedger.id,
                        creditLedgerId: newVendorLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: targetBillNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Product Purchases'
                    }
                });
                await tx.ledger.update({ where: { id: finalProductLedger.id }, data: { currentBalance: { increment: ledgerProductAmount } } });
                await tx.ledger.update({ where: { id: newVendorLedgerId }, data: { currentBalance: { increment: ledgerProductAmount } } });
            }

            const finalPurchaseLedger = purchaseLedger || inventoryLedger;
            if (totalServiceGross > 0 && finalPurchaseLedger) {
                await tx.transaction.create({
                    data: {
                        date: targetDate,
                        amount: ledgerServiceAmount,
                        debitLedgerId: finalPurchaseLedger.id,
                        creditLedgerId: newVendorLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: targetBillNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Service/General Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: finalPurchaseLedger.id }, data: { currentBalance: { increment: ledgerServiceAmount } } });
                await tx.ledger.update({ where: { id: newVendorLedgerId }, data: { currentBalance: { increment: ledgerServiceAmount } } });
            }

            if (parseFloat(finalTax) > 0) {
                const taxInputLedger = await resolveLedger('Tax', 'ASSETS') || await resolveLedger('Tax', 'LIABILITIES');
                if (taxInputLedger) {
                    await tx.transaction.create({
                        data: {
                            date: targetDate,
                            amount: ledgerTaxAmount,
                            debitLedgerId: taxInputLedger.id,
                            creditLedgerId: newVendorLedgerId,
                            voucherType: 'PURCHASE',
                            voucherNumber: targetBillNumber,
                            companyId: parseInt(companyId),
                            journalEntryId: journalEntry.id,
                            purchaseBillId: oldBill.id,
                            narration: 'Tax on Purchase'
                        }
                    });
                    await tx.ledger.update({ where: { id: taxInputLedger.id }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                    await tx.ledger.update({ where: { id: newVendorLedgerId }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                }
            }

            if (ledgerDiscountAmount > 0 && discountReceivedLedger) {
                await tx.transaction.create({
                    data: {
                        date: targetDate,
                        amount: ledgerDiscountAmount,
                        debitLedgerId: newVendorLedgerId,
                        creditLedgerId: discountReceivedLedger.id,
                        voucherType: 'PURCHASE',
                        voucherNumber: targetBillNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Discount Received on Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: discountReceivedLedger.id }, data: { currentBalance: { increment: ledgerDiscountAmount } } });
                await tx.ledger.update({ where: { id: newVendorLedgerId }, data: { currentBalance: { decrement: ledgerDiscountAmount } } });
            }

            // 11. Update Vendor Balance (Credit increases Liability)
            await tx.vendor.update({
                where: { id: targetVendorId },
                data: { accountBalance: { increment: ledgerTotalAmount } }
            });

            // 12. Finally update the purchasebill itself
            return await tx.purchasebill.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    notes,
                    date: targetDate,
                    billNumber: targetBillNumber,
                    vendorId: targetVendorId,
                    dueDate: dueDate ? new Date(dueDate) : undefined,
                    subtotal: calculatedSubtotal,
                    totalAmount: totalAmountValue,
                    taxAmount: finalTax,
                    discountAmount: totalDiscount,
                    paidAmount: totalAdjustedAmount,
                    balanceAmount: totalAmountValue - totalAdjustedAmount,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : ((totalAmountValue - totalAdjustedAmount) <= 0 ? 'PAID' : (totalAdjustedAmount > 0 ? 'PARTIAL' : 'UNPAID')),
                    currency: currency !== undefined ? currency : undefined,
                    exchangeRate: exchangeRate !== undefined ? parseFloat(exchangeRate) : undefined,
                    billingName,
                    billingAddress,
                    billingCity,
                    billingState,
                    billingZipCode,
                    billingCountry,
                    shippingName,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingCountry,
                    overallDiscount: overallDiscount ? parseFloat(overallDiscount) : undefined,
                    overallDiscountType: overallDiscountType || undefined
                },
                include: {
                    purchasebillitem: {
                        include: {
                            product: true,
                            warehouse: true,
                            uom: true
                        }
                    },
                    purchasereturn: {
                        include: {
                            purchasereturnitem: true
                        }
                    }
                }
            });
        }, {
            timeout: 120000
        });

        const adjustedUpdated = adjustBillWithReturns(updated);
        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'PurchaseBill', updated.id, `Purchase Bill #${updated.billNumber} updated for Vendor ID ${updated.vendorId} with amount ${updated.totalAmount}`);
        res.status(200).json({ success: true, data: adjustedUpdated });
    } catch (error) {
        console.error('Update Purchase Bill Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const result = await numberingService.getNextNumber(companyId, 'purchasebill');
        res.status(200).json({ success: true, nextNumber: result.formattedNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// One-time cleanup: remove orphaned journal entries (no linked transactions)
// These are left behind from bills that were deleted before the fix was applied
const cleanupOrphanedJournals = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const whereClause = {
            transaction: { none: {} }
        };
        if (companyId) {
            whereClause.companyId = parseInt(companyId);
        }

        // Find orphaned journal entries first (for reporting)
        const orphaned = await prisma.journalentry.findMany({
            where: whereClause,
            select: { id: true, voucherNumber: true, narration: true }
        });

        if (orphaned.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No orphaned journal entries found. Database is already clean!',
                deletedCount: 0
            });
        }

        // Delete them all
        const result = await prisma.journalentry.deleteMany({ where: whereClause });

        return res.status(200).json({
            success: true,
            message: `Cleaned up ${result.count} orphaned journal entries. You can now create bills without voucher number conflicts.`,
            deletedCount: result.count,
            deleted: orphaned.map(j => ({ id: j.id, voucherNumber: j.voucherNumber }))
        });
    } catch (error) {
        console.error('Cleanup Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createBill,
    getBills,
    getBillById,
    updateBill,
    deleteBill,
    getNextNumber,
    cleanupOrphanedJournals
};
