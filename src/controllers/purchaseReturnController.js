const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Purchase Return (Stock OUT + Ledger Debit Vendor)
const createReturn = async (req, res) => {
    try {
        const { returnNumber, date, vendorId, purchaseBillId, items, reason, totalAmount, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!returnNumber || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

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
            }

            // 3. Ledger Posting (Dr Vendor, Cr Inventory/Purchase)
            const vendor = await tx.vendor.findUnique({ where: { id: parseInt(vendorId) }, include: { ledger: true } });
            if (!vendor || !vendor.ledger) throw new Error('Vendor ledger not found');

            // Resolve Ledgers
            const inventoryLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Inventory' }, accountgroup: { type: 'ASSETS' } }
            });
            const purchaseLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Purchase' }, accountgroup: { type: 'EXPENSES' } }
            });

            const debitLedgerId = vendor.ledger.id;
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

            // Debit Vendor (Reduce Liability)
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    amount: parseFloat(totalAmount),
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: creditLedgerId, // Just for record, though separate lines preferred
                    voucherType: 'PURCHASE_RETURN',
                    voucherNumber: returnNumber,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    narration: 'Purchase Return'
                }
            });

            // Update Vendor Balance (Debit reduces Credit balance for Vendor)
            // Vendor has Credit Balance type usually. Debit reduces it.
            // But we store 'accountBalance'. If it's a liability, positive means credit.
            // So Debit means subtracting from balance.
            await tx.vendor.update({
                where: { id: parseInt(vendorId) },
                data: { accountBalance: { decrement: parseFloat(totalAmount) } }
            });

            // Update Ledger Balances
            await tx.ledger.update({
                where: { id: debitLedgerId },
                data: { currentBalance: { decrement: parseFloat(totalAmount) } } // Vendor (Liability) decreases
            });
            await tx.ledger.update({
                where: { id: creditLedgerId },
                data: { currentBalance: { decrement: parseFloat(totalAmount) } } // Purchase (Expense) decreases
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
        const { returnNumber, date, vendorId, purchaseBillId, items, reason, totalAmount, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const existingReturn = await prisma.purchasereturn.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { purchasereturnitem: true }
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

            // Revert vendor account balance (add it back, since it was decremented on return)
            await tx.vendor.update({
                where: { id: oldVendorId },
                data: { accountBalance: { increment: oldTotalAmount } }
            });

            // Revert transaction ledger balances
            const txs = await tx.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: existingReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            for (const t of txs) {
                await tx.ledger.update({
                    where: { id: t.debitLedgerId },
                    data: { currentBalance: { increment: t.amount } } // Vendor ledger (Liability) increases back
                });
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
                    purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : undefined,
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
            }

            // 5. Apply New Ledger and Vendor Balances
            const targetVendorId = vendorId ? parseInt(vendorId) : existingReturn.vendorId;
            const vendor = await tx.vendor.findUnique({
                where: { id: targetVendorId },
                include: { ledger: true }
            });
            if (!vendor || !vendor.ledger) throw new Error('Vendor ledger not found');

            const inventoryLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Inventory' }, accountgroup: { type: 'ASSETS' } }
            });
            const purchaseLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Purchase' }, accountgroup: { type: 'EXPENSES' } }
            });

            const debitLedgerId = vendor.ledger.id;
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

            // Debit Vendor (Reduce Liability), Credit Purchases/Inventory
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    amount: finalAmount,
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: creditLedgerId,
                    voucherType: 'PURCHASE_RETURN',
                    voucherNumber: returnNumber,
                    companyId: parseInt(companyId),
                    journalEntryId: journalEntry.id,
                    narration: 'Purchase Return'
                }
            });

            // Update Vendor Balance (Debit reduces Credit balance for Vendor)
            await tx.vendor.update({
                where: { id: targetVendorId },
                data: { accountBalance: { decrement: finalAmount } }
            });

            // Update Ledger Balances
            await tx.ledger.update({
                where: { id: debitLedgerId },
                data: { currentBalance: { decrement: finalAmount } }
            });
            await tx.ledger.update({
                where: { id: creditLedgerId },
                data: { currentBalance: { decrement: finalAmount } }
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
            include: { purchasereturnitem: true }
        });

        if (!purchaseReturn) {
            return res.status(404).json({ success: false, message: 'Purchase return not found' });
        }

        await prisma.$transaction(async (tx) => {
            // 1. Revert Stock
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
            }

            // 2. Revert Ledger Balances and Vendor Balance
            const txs = await tx.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: purchaseReturn.returnNumber,
                    voucherType: 'PURCHASE_RETURN'
                }
            });

            for (const t of txs) {
                await tx.ledger.update({
                    where: { id: t.debitLedgerId },
                    data: { currentBalance: { increment: t.amount } } // Vendor (Liability) increases back
                });
                await tx.ledger.update({
                    where: { id: t.creditLedgerId },
                    data: { currentBalance: { increment: t.amount } } // Purchase (Expense) increases back
                });
            }

            await tx.vendor.update({
                where: { id: purchaseReturn.vendorId },
                data: { accountBalance: { increment: purchaseReturn.totalAmount } }
            });

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

module.exports = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturn,
    deleteReturn
};
