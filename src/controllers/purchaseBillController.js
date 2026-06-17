const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');
const {
    getInventoryConfig,
    recordStockIn,
    reverseStockIn,
    calculateNetRate
} = require('../services/inventoryValuationService');

// Create Purchase Bill (Financial Posting)
const createBill = async (req, res) => {
    try {
        const { billNumber, date, dueDate, vendorId, purchaseOrderId, grnId, items, notes, discountAmount, taxAmount, totalAmount, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, currency, exchangeRate, customFields } = req.body;
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
                    status: 'UNPAID',
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
                include: { purchasebillitem: true }
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
                        status: finalBalance <= 0 ? 'PAID' : 'PARTIAL'
                    }
                });
                bill.paidAmount = finalPaid;
                bill.balanceAmount = finalBalance;
                bill.status = finalBalance <= 0 ? 'PAID' : 'PARTIAL';
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

            // Entry for Products (Debit Inventory)
            if (totalProductGross > 0 && inventoryLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        amount: ledgerProductAmount,
                        debitLedgerId: inventoryLedger.id,
                        creditLedgerId: creditLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: bill.id,
                        narration: 'Product Inventory Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: inventoryLedger.id }, data: { currentBalance: { increment: ledgerProductAmount } } });
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
                                    companyId: parseInt(companyId)
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
            timeout: 30000
        });

        await numberingService.incrementNumber(companyId, 'purchasebill', billNumber);
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
                        warehouse: true
                    }
                },
                purchaseorder: true,
                goodsreceiptnote: true,
                purchasereturn: true,
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

            return {
                ...bill,
                payment: deduplicatedPayments
            };
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
                        warehouse: true
                    }
                },
                purchaseorder: true,
                goodsreceiptnote: true,
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

        const mappedBill = {
            ...bill,
            payment: deduplicatedPayments
        };

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
            // Unlink any payments pointing to this purchase bill to prevent FK Restrict errors
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

            // 3. Delete related transactions and journal entries
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

            // 4. Reverse Physical Stock & Valuation Layers
            const invConfig = await getInventoryConfig(companyId);
            const valuationMethod = invConfig.valuationMethod || 'WAC';

            // Get bill items for WAC reversal
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

                    // Log inventory transaction for return/reversal
                    await tx.inventorytransaction.create({
                        data: {
                            date: new Date(),
                            type: 'RETURN',
                            productId: item.productId,
                            fromWarehouseId: item.warehouseId,
                            quantity: baseQty,
                            reason: `Purchase Bill Deleted: ${bill.billNumber}`,
                            companyId: parseInt(companyId)
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

            // 5. Delete Bill Items and Bill
            await tx.purchasebillitem.deleteMany({ where: { purchaseBillId: bill.id } });
            await tx.purchasebill.delete({ where: { id: bill.id } });
        }, {
            timeout: 90000
        });

        res.status(200).json({ success: true, message: 'Bill deleted successfully' });
    } catch (error) {
        console.error('Delete Bill Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateBill = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, dueDate, items, totalAmount, taxAmount, discountAmount, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, currency, exchangeRate, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const updated = await prisma.$transaction(async (tx) => {
            const oldBill = await tx.purchasebill.findFirst({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                include: {
                    transaction: true,
                    vendor: { include: { ledger: true } }
                }
            });
            if (!oldBill) throw new Error('Bill not found');

            // 1. Revert Old Vendor Balance
            await tx.vendor.update({
                where: { id: oldBill.vendorId },
                data: { accountBalance: { decrement: oldBill.totalAmount * (oldBill.exchangeRate || 1.0) } }
            });

            // 2. Revert Old Ledger Balances using old transactions
            const vendorLedgerId = oldBill.vendor?.ledger?.id;
            for (const trans of oldBill.transaction) {
                if (vendorLedgerId && trans.debitLedgerId === vendorLedgerId) {
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
                const diff = parseFloat(oldBill.totalAmount) - (oldBill.transaction.reduce((sum, t) => sum + (t.creditLedgerId === vendorLedgerId ? t.amount : 0), 0) - oldBill.transaction.reduce((sum, t) => sum + (t.debitLedgerId === vendorLedgerId ? t.amount : 0), 0));
                if (vendorLedgerId && Math.abs(diff) > 0.01) {
                    await tx.ledger.update({
                        where: { id: vendorLedgerId },
                        data: { currentBalance: { decrement: diff } }
                    });
                }
            }

            // 3. Delete old transactions associated with the bill
            await tx.transaction.deleteMany({ where: { purchaseBillId: oldBill.id } });

            // Clear old allocations for this bill
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

            // 4. Delete old items and write new ones
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

            // Find or Create Journal Entry
            let journalEntry = await tx.journalentry.findFirst({
                where: { voucherNumber: oldBill.billNumber, companyId: parseInt(companyId) }
            });
            if (!journalEntry) {
                journalEntry = await tx.journalentry.create({
                    data: {
                        date: new Date(oldBill.date),
                        voucherNumber: oldBill.billNumber,
                        narration: `Purchase Bill #${oldBill.billNumber}`,
                        companyId: parseInt(companyId),
                    }
                });
            }

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

            // Post Transactions and Update Ledgers
            const docCurrency = currency !== undefined ? currency : oldBill.currency;
            const docExchangeRate = exchangeRate !== undefined ? parseFloat(exchangeRate) : (oldBill.exchangeRate || 1.0);

            const ledgerProductAmount = totalProductGross * docExchangeRate;
            const ledgerServiceAmount = totalServiceGross * docExchangeRate;
            const ledgerTaxAmount = finalTax * docExchangeRate;
            const ledgerDiscountAmount = totalDiscount * docExchangeRate;
            const ledgerTotalAmount = totalAmountValue * docExchangeRate;

            if (totalProductGross > 0 && inventoryLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(oldBill.date),
                        amount: ledgerProductAmount,
                        debitLedgerId: inventoryLedger.id,
                        creditLedgerId: vendorLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: oldBill.billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Product Inventory Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: inventoryLedger.id }, data: { currentBalance: { increment: ledgerProductAmount } } });
                await tx.ledger.update({ where: { id: vendorLedgerId }, data: { currentBalance: { increment: ledgerProductAmount } } });
            }

            const finalPurchaseLedger = purchaseLedger || inventoryLedger;
            if (totalServiceGross > 0 && finalPurchaseLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(oldBill.date),
                        amount: ledgerServiceAmount,
                        debitLedgerId: finalPurchaseLedger.id,
                        creditLedgerId: vendorLedgerId,
                        voucherType: 'PURCHASE',
                        voucherNumber: oldBill.billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Service/General Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: finalPurchaseLedger.id }, data: { currentBalance: { increment: ledgerServiceAmount } } });
                await tx.ledger.update({ where: { id: vendorLedgerId }, data: { currentBalance: { increment: ledgerServiceAmount } } });
            }

            if (parseFloat(finalTax) > 0) {
                const taxInputLedger = await resolveLedger('Tax', 'ASSETS') || await resolveLedger('Tax', 'LIABILITIES');
                if (taxInputLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(oldBill.date),
                            amount: ledgerTaxAmount,
                            debitLedgerId: taxInputLedger.id,
                            creditLedgerId: vendorLedgerId,
                            voucherType: 'PURCHASE',
                            voucherNumber: oldBill.billNumber,
                            companyId: parseInt(companyId),
                            journalEntryId: journalEntry.id,
                            purchaseBillId: oldBill.id,
                            narration: 'Tax on Purchase'
                        }
                    });
                    await tx.ledger.update({ where: { id: taxInputLedger.id }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                    await tx.ledger.update({ where: { id: vendorLedgerId }, data: { currentBalance: { increment: ledgerTaxAmount } } });
                }
            }

            if (ledgerDiscountAmount > 0 && discountReceivedLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(oldBill.date),
                        amount: ledgerDiscountAmount,
                        debitLedgerId: vendorLedgerId,
                        creditLedgerId: discountReceivedLedger.id,
                        voucherType: 'PURCHASE',
                        voucherNumber: oldBill.billNumber,
                        companyId: parseInt(companyId),
                        journalEntryId: journalEntry.id,
                        purchaseBillId: oldBill.id,
                        narration: 'Discount Received on Purchase'
                    }
                });
                await tx.ledger.update({ where: { id: discountReceivedLedger.id }, data: { currentBalance: { increment: ledgerDiscountAmount } } });
                await tx.ledger.update({ where: { id: vendorLedgerId }, data: { currentBalance: { decrement: ledgerDiscountAmount } } });
            }

            // Update Vendor Balance (Credit increases Liability)
            await tx.vendor.update({
                where: { id: oldBill.vendorId },
                data: { accountBalance: { increment: ledgerTotalAmount } }
            });

            // Finally update the purchasebill itself
            return await tx.purchasebill.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    notes,
                    dueDate: dueDate ? new Date(dueDate) : undefined,
                    subtotal: calculatedSubtotal,
                    totalAmount: totalAmountValue,
                    taxAmount: finalTax,
                    discountAmount: totalDiscount,
                    paidAmount: totalAdjustedAmount,
                    balanceAmount: totalAmountValue - totalAdjustedAmount,
                    status: (totalAmountValue - totalAdjustedAmount) <= 0 ? 'PAID' : (totalAdjustedAmount > 0 ? 'PARTIAL' : 'UNPAID'),
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
                            warehouse: true
                        }
                    }
                }
            });
        }, {
            timeout: 30000
        });

        res.status(200).json({ success: true, data: updated });
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
