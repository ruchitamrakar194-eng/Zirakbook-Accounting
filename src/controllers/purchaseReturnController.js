const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');
const { getConversionRate, getCompanyCurrency } = require('../utils/currencyConverter');

// Create Purchase Return (Stock OUT + Ledger Debit Vendor)
const createReturn = async (req, res) => {
    try {
        const { returnNumber, date, vendorId, purchaseBillId, items, reason, totalAmount, customFields, currency, exchangeRate } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!returnNumber || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // --- Currency Setup ---
        let docCurrency = currency || null;
        let docExchangeRate = parseFloat(exchangeRate) || null;

        if (purchaseBillId && (!docCurrency || !docExchangeRate)) {
            const srcBill = await prisma.purchasebill.findUnique({
                where: { id: parseInt(purchaseBillId) },
                select: { currency: true, exchangeRate: true }
            });
            if (srcBill) {
                docCurrency = docCurrency || srcBill.currency || 'USD';
                docExchangeRate = docExchangeRate || parseFloat(srcBill.exchangeRate) || 1.0;
            }
        }
        if (!docCurrency) {
            docCurrency = await getCompanyCurrency(companyId);
        }
        if (!docExchangeRate) {
            docExchangeRate = await getConversionRate(docCurrency, await getCompanyCurrency(companyId));
        }
        const exRate = docExchangeRate || 1.0;

        const returnItems = items.map(item => ({
            productId: parseInt(item.productId),
            warehouseId: parseInt(item.warehouseId),
            quantity: parseFloat(item.quantity),
            rate: parseFloat(item.rate),
            amount: parseFloat(item.amount)
        }));

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Purchase Return Document
            const purchaseReturn = await tx.purchasereturn.create({
                data: {
                    returnNumber,
                    date: new Date(date),
                    vendorId: parseInt(vendorId),
                    purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : null,
                    companyId: parseInt(companyId),
                    totalAmount: parseFloat(totalAmount),
                    reason,
                    status: 'Processed',
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    purchasereturnitem: {
                        create: returnItems
                    }
                },
                include: { purchasereturnitem: true }
            });

            // 2. Inventory Update (Stock Decrement - OUT)
            for (const item of returnItems) {
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    create: {
                        warehouseId: item.warehouseId,
                        productId: item.productId,
                        quantity: -item.quantity,
                        initialQty: 0,
                        minOrderQty: 0
                    },
                    update: {
                        quantity: { decrement: item.quantity }
                    }
                });

                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(date),
                        type: 'RETURN', // Purchase Return
                        productId: item.productId,
                        fromWarehouseId: item.warehouseId,
                        quantity: item.quantity,
                        companyId: parseInt(companyId),
                        userId: req.user?.userId || null,
                        reason: `Purchase Return: ${returnNumber}`
                    }
                });

                // Update WAC product fields in base currency
                const currentProduct = await tx.product.findUnique({
                    where: { id: item.productId }
                });
                if (currentProduct) {
                    const currentQty = parseFloat(currentProduct.totalQty || 0);
                    const currentValue = parseFloat(currentProduct.totalInventoryValue || 0);
                    const returnValBase = item.amount * exRate;
                    const newTotalQty = Math.max(0, currentQty - item.quantity);
                    const newTotalValue = Math.max(0, currentValue - returnValBase);
                    const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : currentProduct.averageCost;

                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalQty: newTotalQty,
                            totalInventoryValue: newTotalValue,
                            averageCost: newAverageCost
                        }
                    });
                }

                // Update FIFO batches
                if (purchaseBillId) {
                    const batch = await tx.inventory_batch.findFirst({
                        where: {
                            productId: item.productId,
                            purchaseBillId: parseInt(purchaseBillId),
                            warehouseId: item.warehouseId
                        }
                    });
                    if (batch) {
                        await tx.inventory_batch.update({
                            where: { id: batch.id },
                            data: {
                                qtyRemaining: { decrement: item.quantity }
                            }
                        });
                    }
                }
            }

            // 3. Ledger Posting (Dr Vendor/Cash, Cr Inventory/Purchase)
            const vendor = await tx.vendor.findUnique({ where: { id: parseInt(vendorId) }, include: { ledger: true } });
            if (!vendor || !vendor.ledger) throw new Error('Vendor ledger not found');

            // Check if purchase bill is paid
            let isBillPaid = false;
            if (purchaseBillId) {
                const purchaseBill = await tx.purchasebill.findUnique({ where: { id: parseInt(purchaseBillId) } });
                if (purchaseBill && (purchaseBill.status === 'PAID' || purchaseBill.status === 'Paid' || purchaseBill.paidAmount >= purchaseBill.totalAmount)) {
                    isBillPaid = true;
                }
            }

            // Resolve Ledgers
            const inventoryLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Inventory' }, accountgroup: { type: 'ASSETS' } }
            });
            const purchaseLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Purchase' }, accountgroup: { type: 'EXPENSES' } }
            });
            const cashLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Cash in Hand' }, accountgroup: { type: 'ASSETS' } }
            }) || await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Main Bank Account' }, accountgroup: { type: 'ASSETS' } }
            });

            const debitLedgerId = isBillPaid && cashLedger ? cashLedger.id : vendor.ledger.id;
            const creditLedgerId = inventoryLedger?.id || purchaseLedger?.id;

            if (!creditLedgerId) throw new Error('Could not find appropriate ledger (Purchase or Inventory) for return');

            // Create Journal Entry
            const journalEntry = await tx.journalentry.create({
                data: {
                    date: new Date(date),
                    voucherNumber: returnNumber,
                    narration: `Purchase Return - ${reason || ''}`,
                    companyId: parseInt(companyId),
                }
            });

            // Debit Vendor/Cash, Credit Purchases/Inventory
            const ledgerTotalAmount = parseFloat(totalAmount) * exRate;
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    amount: ledgerTotalAmount,
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: creditLedgerId,
                    voucherType: 'PURCHASE_RETURN',
                    voucherNumber: returnNumber,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    narration: 'Purchase Return'
                }
            });

            // Update Vendor Balance if not paid in cash
            if (!isBillPaid) {
                await tx.vendor.update({
                    where: { id: parseInt(vendorId) },
                    data: { accountBalance: { decrement: ledgerTotalAmount } }
                });
            }

            // Update Ledger Balances
            if (isBillPaid) {
                await tx.ledger.update({
                    where: { id: debitLedgerId },
                    data: { currentBalance: { increment: ledgerTotalAmount } } // Cash (Asset) increases
                });
            } else {
                await tx.ledger.update({
                    where: { id: debitLedgerId },
                    data: { currentBalance: { decrement: ledgerTotalAmount } } // Vendor (Liability) decreases
                });
            }
            await tx.ledger.update({
                where: { id: creditLedgerId },
                data: { currentBalance: { decrement: ledgerTotalAmount } } // Purchase (Expense) decreases
            });

            return purchaseReturn;
        }, { timeout: 90000 });

        await numberingService.incrementNumber(companyId, 'purchasereturn', returnNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Purchase Return Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getReturns = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const returns = await prisma.purchasereturn.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                vendor: true,
                purchasereturnitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                },
                purchasebill: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // Map items for frontend consistency
        const formattedReturns = returns.map(ret => ({
            ...ret,
            items: ret.purchasereturnitem
        }));

        res.status(200).json({ success: true, data: formattedReturns });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getReturnById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const purchaseReturn = await prisma.purchasereturn.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                vendor: true,
                purchasereturnitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                },
                purchasebill: true
            }
        });

        if (!purchaseReturn) {
            return res.status(404).json({ success: false, message: 'Purchase return not found' });
        }

        // Map items to match frontend expectations
        const formattedReturn = {
            ...purchaseReturn,
            items: purchaseReturn.purchasereturnitem
        };

        res.status(200).json({ success: true, data: formattedReturn });
    } catch (error) {
        console.error('Get Return By ID Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { returnNumber, date, vendorId, purchaseBillId, items, reason, totalAmount, customFields, currency, exchangeRate } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        // --- Currency Setup ---
        let docExchangeRate = parseFloat(exchangeRate) || null;
        if (purchaseBillId && !docExchangeRate) {
            const srcBill = await prisma.purchasebill.findUnique({
                where: { id: parseInt(purchaseBillId) },
                select: { exchangeRate: true }
            });
            docExchangeRate = srcBill ? (parseFloat(srcBill.exchangeRate) || 1.0) : 1.0;
        }
        const exRate = docExchangeRate || 1.0;

        const existingReturn = await prisma.purchasereturn.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { purchasereturnitem: true, purchasebill: true }
        });

        if (!existingReturn) {
            return res.status(404).json({ success: false, message: 'Purchase return not found' });
        }

        const returnItems = items.map(item => ({
            productId: parseInt(item.productId),
            warehouseId: parseInt(item.warehouseId),
            quantity: parseFloat(item.quantity),
            rate: parseFloat(item.rate),
            amount: parseFloat(item.amount)
        }));

        const result = await prisma.$transaction(async (tx) => {
            // 1. Revert Physical Stock of Old Items (Increment stock since purchase return decremented it)
            const oldExRate = existingReturn.purchasebill ? (parseFloat(existingReturn.purchasebill.exchangeRate) || 1.0) : 1.0;
            for (const item of existingReturn.purchasereturnitem) {
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    create: {
                        warehouseId: item.warehouseId,
                        productId: item.productId,
                        quantity: item.quantity,
                        initialQty: 0,
                        minOrderQty: 0
                    },
                    update: {
                        quantity: { increment: item.quantity }
                    }
                });

                // Revert WAC product fields
                const currentProduct = await tx.product.findUnique({
                    where: { id: item.productId }
                });
                if (currentProduct) {
                    const currentQty = parseFloat(currentProduct.totalQty || 0);
                    const currentValue = parseFloat(currentProduct.totalInventoryValue || 0);
                    const returnValBase = item.amount * oldExRate;
                    const newTotalQty = currentQty + item.quantity;
                    const newTotalValue = currentValue + returnValBase;
                    const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : currentProduct.averageCost;

                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalQty: newTotalQty,
                            totalInventoryValue: newTotalValue,
                            averageCost: newAverageCost
                        }
                    });
                }

                // Revert FIFO batch
                if (existingReturn.purchaseBillId) {
                    const batch = await tx.inventory_batch.findFirst({
                        where: {
                            productId: item.productId,
                            purchaseBillId: parseInt(existingReturn.purchaseBillId),
                            warehouseId: item.warehouseId
                        }
                    });
                    if (batch) {
                        await tx.inventory_batch.update({
                            where: { id: batch.id },
                            data: {
                                qtyRemaining: { increment: item.quantity }
                            }
                        });
                    }
                }
            }

            // Delete old inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    productId: { in: existingReturn.purchasereturnitem.map(i => i.productId) },
                    reason: `Purchase Return: ${existingReturn.returnNumber}`,
                    companyId: parseInt(companyId)
                }
            });

            // 2. Revert Old Vendor Balance & Accounting Ledger Balances
            const oldVendorId = existingReturn.vendorId;
            const oldTotalAmount = parseFloat(existingReturn.totalAmount);

            // Revert transaction ledger balances
            const txs = await tx.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: existingReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            const cashLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Cash in Hand' }, accountgroup: { type: 'ASSETS' } }
            }) || await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Main Bank Account' }, accountgroup: { type: 'ASSETS' } }
            });

            let wasOldRefundPaid = false;
            const originalTx = txs[0];
            const oldDebitLedgerId = originalTx ? originalTx.debitLedgerId : null;
            if (oldDebitLedgerId && cashLedger && oldDebitLedgerId === cashLedger.id) {
                wasOldRefundPaid = true;
            }

            // Revert vendor account balance (only if the old return was not cash refund)
            if (!wasOldRefundPaid) {
                await tx.vendor.update({
                    where: { id: oldVendorId },
                    data: { accountBalance: { increment: oldTotalAmount } }
                });
            }

            for (const t of txs) {
                if (wasOldRefundPaid && t.debitLedgerId === cashLedger.id) {
                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: { decrement: t.amount } } // Cash (Asset) decreases back
                    });
                } else {
                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: { increment: t.amount } } // Vendor ledger (Liability) increases back
                    });
                }
                await tx.ledger.update({
                    where: { id: t.creditLedgerId },
                    data: { currentBalance: { increment: t.amount } } // Purchases ledger (Expense) increases back
                });
            }

            // Cleanup accounting records
            const journalEntryIds = [...new Set(txs.map(t => t.journalEntryId).filter(Boolean))];

            await tx.transaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: existingReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            if (journalEntryIds.length > 0) {
                await tx.journalentry.deleteMany({
                    where: { id: { in: journalEntryIds } }
                });
            }

            // Delete existing purchasereturn items from DB
            await tx.purchasereturnitem.deleteMany({
                where: { purchaseReturnId: parseInt(id) }
            });

            // 3. Update Purchase Return Document Header and Create Items
            const updatedReturn = await tx.purchasereturn.update({
                where: { id: parseInt(id) },
                data: {
                    returnNumber,
                    date: date ? new Date(date) : undefined,
                    vendorId: vendorId ? parseInt(vendorId) : undefined,
                    purchaseBillId: purchaseBillId !== undefined ? (purchaseBillId ? parseInt(purchaseBillId) : null) : undefined,
                    totalAmount: totalAmount ? parseFloat(totalAmount) : undefined,
                    reason,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    purchasereturnitem: {
                        create: returnItems
                    }
                },
                include: {
                    vendor: true,
                    purchasereturnitem: {
                        include: {
                            product: true,
                            warehouse: true
                        }
                    },
                    purchasebill: true
                }
            });

            // 4. Apply New Physical Stock (Decrement stock)
            for (const item of returnItems) {
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    create: {
                        warehouseId: item.warehouseId,
                        productId: item.productId,
                        quantity: -item.quantity,
                        initialQty: 0,
                        minOrderQty: 0
                    },
                    update: {
                        quantity: { decrement: item.quantity }
                    }
                });

                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(date),
                        type: 'RETURN', // Purchase Return
                        productId: item.productId,
                        fromWarehouseId: item.warehouseId,
                        quantity: item.quantity,
                        companyId: parseInt(companyId),
                        userId: req.user?.userId || null,
                        reason: `Purchase Return: ${returnNumber}`
                    }
                });

                // Update WAC product fields in base currency
                const currentProduct = await tx.product.findUnique({
                    where: { id: item.productId }
                });
                if (currentProduct) {
                    const currentQty = parseFloat(currentProduct.totalQty || 0);
                    const currentValue = parseFloat(currentProduct.totalInventoryValue || 0);
                    const returnValBase = item.amount * exRate;
                    const newTotalQty = Math.max(0, currentQty - item.quantity);
                    const newTotalValue = Math.max(0, currentValue - returnValBase);
                    const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : currentProduct.averageCost;

                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalQty: newTotalQty,
                            totalInventoryValue: newTotalValue,
                            averageCost: newAverageCost
                        }
                    });
                }

                // Update FIFO batches
                if (purchaseBillId) {
                    const batch = await tx.inventory_batch.findFirst({
                        where: {
                            productId: item.productId,
                            purchaseBillId: parseInt(purchaseBillId),
                            warehouseId: item.warehouseId
                        }
                    });
                    if (batch) {
                        await tx.inventory_batch.update({
                            where: { id: batch.id },
                            data: {
                                qtyRemaining: { decrement: item.quantity }
                            }
                        });
                    }
                }
            }

            // 5. Apply New Ledger and Vendor Balances
            const targetVendorId = vendorId ? parseInt(vendorId) : existingReturn.vendorId;
            const vendor = await tx.vendor.findUnique({
                where: { id: targetVendorId },
                include: { ledger: true }
            });
            if (!vendor || !vendor.ledger) throw new Error('Vendor ledger not found');

            // Check if purchase bill is paid
            let isNewBillPaid = false;
            if (purchaseBillId) {
                const purchaseBill = await tx.purchasebill.findUnique({ where: { id: parseInt(purchaseBillId) } });
                if (purchaseBill && (purchaseBill.status === 'PAID' || purchaseBill.status === 'Paid' || purchaseBill.paidAmount >= purchaseBill.totalAmount)) {
                    isNewBillPaid = true;
                }
            }

            const inventoryLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Inventory' }, accountgroup: { type: 'ASSETS' } }
            });
            const purchaseLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Purchase' }, accountgroup: { type: 'EXPENSES' } }
            });

            const debitLedgerId = isNewBillPaid && cashLedger ? cashLedger.id : vendor.ledger.id;
            const creditLedgerId = inventoryLedger?.id || purchaseLedger?.id;

            if (!creditLedgerId) throw new Error('Could not find appropriate ledger (Purchase or Inventory) for return');

            // Create Journal Entry
            const journalEntry = await tx.journalentry.create({
                data: {
                    date: new Date(date),
                    voucherNumber: returnNumber,
                    narration: `Purchase Return - ${reason || ''}`,
                    companyId: parseInt(companyId),
                }
            });

            const finalAmount = totalAmount ? parseFloat(totalAmount) : parseFloat(existingReturn.totalAmount);

            const ledgerFinalAmount = finalAmount * exRate;

            // Debit Vendor/Cash, Credit Purchases/Inventory
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    amount: ledgerFinalAmount,
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: creditLedgerId,
                    voucherType: 'PURCHASE_RETURN',
                    voucherNumber: returnNumber,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    narration: 'Purchase Return'
                }
            });

            // Update Vendor Balance if not paid in cash
            if (!isNewBillPaid) {
                await tx.vendor.update({
                    where: { id: targetVendorId },
                    data: { accountBalance: { decrement: ledgerFinalAmount } }
                });
            }

            // Update Ledger Balances
            if (isNewBillPaid) {
                await tx.ledger.update({
                    where: { id: debitLedgerId },
                    data: { currentBalance: { increment: ledgerFinalAmount } } // Cash (Asset) increases
                });
            } else {
                await tx.ledger.update({
                    where: { id: debitLedgerId },
                    data: { currentBalance: { decrement: ledgerFinalAmount } } // Vendor (Liability) decreases
                });
            }
            await tx.ledger.update({
                where: { id: creditLedgerId },
                data: { currentBalance: { decrement: ledgerFinalAmount } }
            });

            return updatedReturn;
        }, { timeout: 90000 });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Update Return Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const purchaseReturn = await prisma.purchasereturn.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { purchasereturnitem: true, purchasebill: true }
        });

        if (!purchaseReturn) {
            return res.status(404).json({ success: false, message: 'Purchase return not found' });
        }

        await prisma.$transaction(async (tx) => {
            // 1. Revert Stock
            const exRate = purchaseReturn.purchasebill ? (parseFloat(purchaseReturn.purchasebill.exchangeRate) || 1.0) : 1.0;
            for (const item of purchaseReturn.purchasereturnitem) {
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    create: {
                        warehouseId: item.warehouseId,
                        productId: item.productId,
                        quantity: item.quantity,
                        initialQty: 0,
                        minOrderQty: 0
                    },
                    update: {
                        quantity: { increment: item.quantity }
                    }
                });

                // Revert WAC product fields
                const currentProduct = await tx.product.findUnique({
                    where: { id: item.productId }
                });
                if (currentProduct) {
                    const currentQty = parseFloat(currentProduct.totalQty || 0);
                    const currentValue = parseFloat(currentProduct.totalInventoryValue || 0);
                    const returnValBase = item.amount * exRate;
                    const newTotalQty = currentQty + item.quantity;
                    const newTotalValue = currentValue + returnValBase;
                    const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : currentProduct.averageCost;

                    await tx.product.update({
                        where: { id: item.productId },
                        data: {
                            totalQty: newTotalQty,
                            totalInventoryValue: newTotalValue,
                            averageCost: newAverageCost
                        }
                    });
                }

                // Revert FIFO batch
                if (purchaseReturn.purchaseBillId) {
                    const batch = await tx.inventory_batch.findFirst({
                        where: {
                            productId: item.productId,
                            purchaseBillId: parseInt(purchaseReturn.purchaseBillId),
                            warehouseId: item.warehouseId
                        }
                    });
                    if (batch) {
                        await tx.inventory_batch.update({
                            where: { id: batch.id },
                            data: {
                                qtyRemaining: { increment: item.quantity }
                            }
                        });
                    }
                }
            }

            // 2. Revert Ledger Balances and Vendor Balance
            const txs = await tx.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: purchaseReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            const cashLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Cash in Hand' }, accountgroup: { type: 'ASSETS' } }
            }) || await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Main Bank Account' }, accountgroup: { type: 'ASSETS' } }
            });

            let wasRefundPaid = false;
            const originalTx = txs[0];
            const actualDebitLedgerId = originalTx ? originalTx.debitLedgerId : null;
            if (actualDebitLedgerId && cashLedger && actualDebitLedgerId === cashLedger.id) {
                wasRefundPaid = true;
            }

            for (const t of txs) {
                if (wasRefundPaid && t.debitLedgerId === cashLedger.id) {
                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: { decrement: t.amount } } // Cash (Asset) decreases back
                    });
                } else {
                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: { increment: t.amount } } // Vendor (Liability) increases back
                    });
                }
                await tx.ledger.update({
                    where: { id: t.creditLedgerId },
                    data: { currentBalance: { increment: t.amount } } // Purchase (Expense) increases back
                });
            }

            if (!wasRefundPaid) {
                await tx.vendor.update({
                    where: { id: purchaseReturn.vendorId },
                    data: { accountBalance: { increment: purchaseReturn.totalAmount } }
                });
            }

            // 3. Cleanup Accounting Records
            const journalEntryIds = [...new Set(txs.map(t => t.journalEntryId).filter(Boolean))];

            await tx.transaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: purchaseReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            if (journalEntryIds.length > 0) {
                await tx.journalentry.deleteMany({
                    where: { id: { in: journalEntryIds } }
                });
            }

            // Delete associated inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: `Purchase Return: ${purchaseReturn.returnNumber}`
                }
            });

            // 4. Delete Return items and document
            await tx.purchasereturnitem.deleteMany({ where: { purchaseReturnId: purchaseReturn.id } });
            await tx.purchasereturn.delete({ where: { id: purchaseReturn.id } });
        }, { timeout: 90000 });

        res.status(200).json({ success: true, message: 'Purchase return deleted successfully' });
    } catch (error) {
        console.error('Delete Return Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deletePurchaseReturnHelper = async (tx, purchaseReturn, companyId) => {
    // 1. Revert Stock
    let exRate = 1.0;
    if (purchaseReturn.purchaseBillId) {
        const bill = purchaseReturn.purchasebill || await tx.purchasebill.findUnique({
            where: { id: purchaseReturn.purchaseBillId },
            select: { exchangeRate: true }
        });
        if (bill) {
            exRate = parseFloat(bill.exchangeRate) || 1.0;
        }
    }

    for (const item of purchaseReturn.purchasereturnitem) {
        await tx.stock.upsert({
            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
            create: {
                warehouseId: item.warehouseId,
                productId: item.productId,
                quantity: item.quantity,
                initialQty: 0,
                minOrderQty: 0
            },
            update: {
                quantity: { increment: item.quantity }
            }
        });

        // Revert WAC product fields
        const currentProduct = await tx.product.findUnique({
            where: { id: item.productId }
        });
        if (currentProduct) {
            const currentQty = parseFloat(currentProduct.totalQty || 0);
            const currentValue = parseFloat(currentProduct.totalInventoryValue || 0);
            const returnValBase = item.amount * exRate;
            const newTotalQty = currentQty + item.quantity;
            const newTotalValue = currentValue + returnValBase;
            const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : currentProduct.averageCost;

            await tx.product.update({
                where: { id: item.productId },
                data: {
                    totalQty: newTotalQty,
                    totalInventoryValue: newTotalValue,
                    averageCost: newAverageCost
                }
            });
        }

        // Revert FIFO batch
        if (purchaseReturn.purchaseBillId) {
            const batch = await tx.inventory_batch.findFirst({
                where: {
                    productId: item.productId,
                    purchaseBillId: parseInt(purchaseReturn.purchaseBillId),
                    warehouseId: item.warehouseId
                }
            });
            if (batch) {
                await tx.inventory_batch.update({
                    where: { id: batch.id },
                    data: {
                        qtyRemaining: { increment: item.quantity }
                    }
                });
            }
        }
    }

    // 2. Revert Ledger Balances and Vendor Balance
    const txs = await tx.transaction.findMany({
        where: {
            companyId: parseInt(companyId),
            voucherNumber: purchaseReturn.returnNumber,
            voucherType: 'PURCHASE_RETURN'
        }
    });

    const cashLedger = await tx.ledger.findFirst({
        where: { companyId: parseInt(companyId), name: { contains: 'Cash in Hand' }, accountgroup: { type: 'ASSETS' } }
    }) || await tx.ledger.findFirst({
        where: { companyId: parseInt(companyId), name: { contains: 'Main Bank Account' }, accountgroup: { type: 'ASSETS' } }
    });

    let wasRefundPaid = false;
    const originalTx = txs[0];
    const actualDebitLedgerId = originalTx ? originalTx.debitLedgerId : null;
    if (actualDebitLedgerId && cashLedger && actualDebitLedgerId === cashLedger.id) {
        wasRefundPaid = true;
    }

    for (const t of txs) {
        if (wasRefundPaid && t.debitLedgerId === cashLedger.id) {
            await tx.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { decrement: t.amount } } // Cash decreases
            });
        } else {
            await tx.ledger.update({
                where: { id: t.debitLedgerId },
                data: { currentBalance: { increment: t.amount } } // Vendor increases
            });
        }
        await tx.ledger.update({
            where: { id: t.creditLedgerId },
            data: { currentBalance: { increment: t.amount } }
        });
    }

    if (!wasRefundPaid) {
        await tx.vendor.update({
            where: { id: purchaseReturn.vendorId },
            data: { accountBalance: { increment: purchaseReturn.totalAmount } }
        });
    }

    // 3. Cleanup Accounting Records
    const journalEntryIds = [...new Set(txs.map(t => t.journalEntryId).filter(Boolean))];

    await tx.transaction.deleteMany({
        where: {
            companyId: parseInt(companyId),
            voucherNumber: purchaseReturn.returnNumber,
            voucherType: 'PURCHASE_RETURN'
        }
    });

    if (journalEntryIds.length > 0) {
        await tx.journalentry.deleteMany({
            where: { id: { in: journalEntryIds } }
        });
    }

    // Delete associated inventory transactions
    await tx.inventorytransaction.deleteMany({
        where: {
            companyId: parseInt(companyId),
            reason: `Purchase Return: ${purchaseReturn.returnNumber}`
        }
    });

    // 4. Delete Return items and document
    await tx.purchasereturnitem.deleteMany({ where: { purchaseReturnId: purchaseReturn.id } });
    await tx.purchasereturn.delete({ where: { id: purchaseReturn.id } });
};

module.exports = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturn,
    deleteReturn,
    deletePurchaseReturnHelper
};
