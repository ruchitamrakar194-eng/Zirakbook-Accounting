const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

const getAdjustments = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const adjustments = await prisma.inventoryadjustment.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                warehouse: true,
                inventoryadjustmentitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: adjustments });
    } catch (error) {
        console.error('Error fetching adjustments:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAdjustmentById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const adjustment = await prisma.inventoryadjustment.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                warehouse: true,
                inventoryadjustmentitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                }
            }
        });
        if (!adjustment) return res.status(404).json({ success: false, message: 'Adjustment not found' });
        res.status(200).json({ success: true, data: adjustment });
    } catch (error) {
        console.error('Error fetching adjustment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const createAdjustment = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const {
            voucherNo,
            manualVoucherNo,
            date,
            type, // ADD_STOCK, REMOVE_STOCK, ADJUST_VALUE
            warehouseId, // This will now serve as a default/header warehouse
            note,
            totalValue,
            items
        } = req.body;

        let resolvedVoucherNo = voucherNo;
        if (!resolvedVoucherNo) {
            const nextNumObj = await numberingService.getNextNumber(companyId, 'adjustment');
            resolvedVoucherNo = nextNumObj.formattedNumber;
        }

        if (!resolvedVoucherNo || !type || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Required fields are missing' });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create adjustment record
            // Use the first item's warehouseId if header warehouseId is not provided
            const headerWarehouseId = warehouseId ? parseInt(warehouseId) : parseInt(items[0].warehouseId);

            const adjustment = await tx.inventoryadjustment.create({
                data: {
                    voucherNo: resolvedVoucherNo,
                    manualVoucherNo,
                    date: date ? new Date(date) : new Date(),
                    type,
                    warehouseId: headerWarehouseId,
                    note,
                    totalValue: parseFloat(totalValue || 0),
                    companyId: parseInt(companyId),
                    inventoryadjustmentitem: {
                        create: items.map(item => ({
                            productId: parseInt(item.productId),
                            warehouseId: parseInt(item.warehouseId || headerWarehouseId),
                            quantity: parseFloat(item.quantity || 0),
                            rate: parseFloat(item.rate || 0),
                            amount: parseFloat(item.amount || 0),
                            narration: item.narration
                        }))
                    }
                },
                include: { inventoryadjustmentitem: true }
            });

            // 2. Update Stock and Log Transactions
            for (const item of items) {
                const qty = parseFloat(item.quantity || 0);
                const productId = parseInt(item.productId);
                const whId = parseInt(item.warehouseId || headerWarehouseId);

                if (type === 'ADD_STOCK') {
                    await tx.stock.upsert({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        update: { quantity: { increment: qty } },
                        create: { warehouseId: whId, productId: productId, quantity: qty }
                    });

                    await tx.inventorytransaction.create({
                        data: {
                            productId: productId,
                            toWarehouseId: whId,
                            quantity: qty,
                            type: 'ADJUSTMENT',
                            reason: `Adjustment (Add): ${resolvedVoucherNo}. ${item.narration || ''}`,
                            companyId: parseInt(companyId),
                            userId: req.user?.userId || null
                        }
                    });
                } else if (type === 'REMOVE_STOCK') {
                    const currentStock = await tx.stock.findUnique({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } }
                    });

                    if (!currentStock || currentStock.quantity < qty) {
                        throw new Error(`Insufficient stock for product ID ${productId} in warehouse ID ${whId}`);
                    }

                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        data: { quantity: { decrement: qty } }
                    });

                    await tx.inventorytransaction.create({
                        data: {
                            productId: productId,
                            fromWarehouseId: whId,
                            quantity: qty,
                            type: 'ADJUSTMENT',
                            reason: `Adjustment (Remove): ${resolvedVoucherNo}. ${item.narration || ''}`,
                            companyId: parseInt(companyId),
                            userId: req.user?.userId || null
                        }
                    });
                }
            }

            // 3. Accounting Integration (Professional Double Entry)
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

            const inventoryAsset = await resolveLedger('Inventory Asset', 'ASSETS');
            const adjExpense = await resolveLedger('Inventory Adjustment Expense', 'EXPENSES');
            const salesIncome = await resolveLedger('Sales Income', 'INCOME');


            if (inventoryAsset) {
                let debitLedgerId, creditLedgerId;
                const totalAmt = parseFloat(totalValue || 0);

                if (type === 'ADD_STOCK' && salesIncome) {
                    debitLedgerId = inventoryAsset.id;
                    creditLedgerId = salesIncome.id;
                } else if (type === 'REMOVE_STOCK' && adjExpense) {
                    debitLedgerId = adjExpense.id;
                    creditLedgerId = inventoryAsset.id;
                }

                if (debitLedgerId && creditLedgerId && totalAmt > 0) {
                    await tx.transaction.create({
                        data: {
                            date: date ? new Date(date) : new Date(),
                            debitLedgerId,
                            creditLedgerId,
                            amount: totalAmt,
                             narration: `Inventory Adjustment (${type}): ${resolvedVoucherNo}. ${note || ''}`,
                            voucherType: 'JOURNAL',
                            voucherNumber: resolvedVoucherNo,
                            companyId: parseInt(companyId)
                        }
                    });

                    await tx.ledger.update({
                        where: { id: debitLedgerId },
                        data: { currentBalance: { increment: totalAmt } }
                    });
                    await tx.ledger.update({
                        where: { id: creditLedgerId },
                        data: { currentBalance: { decrement: totalAmt } }
                    });
                }
            }

            return adjustment;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'adjustment', resolvedVoucherNo);
        res.status(201).json({ success: true, message: 'Adjustment saved successfully', data: result });
    } catch (error) {
        console.error('Error creating adjustment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteAdjustment = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const adjustment = await prisma.inventoryadjustment.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: { inventoryadjustmentitem: true }
        });

        if (!adjustment) return res.status(404).json({ success: false, message: 'Adjustment not found' });

        await prisma.$transaction(async (tx) => {
            // Reverse Stock Changes
            for (const item of adjustment.inventoryadjustmentitem) {
                const qty = item.quantity;
                const productId = item.productId;
                const whId = item.warehouseId;

                if (adjustment.type === 'ADD_STOCK') {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        data: { quantity: { decrement: qty } }
                    });
                } else if (adjustment.type === 'REMOVE_STOCK') {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        data: { quantity: { increment: qty } }
                    });
                }
            }

            // Reverse Accounting
            const transactions = await tx.transaction.findMany({
                where: {
                    companyId: parseInt(adjustment.companyId),
                    voucherNumber: adjustment.voucherNo,
                    voucherType: 'JOURNAL'
                }
            });

            for (const trans of transactions) {
                await tx.ledger.update({
                    where: { id: trans.debitLedgerId },
                    data: { currentBalance: { decrement: trans.amount } }
                });
                await tx.ledger.update({
                    where: { id: trans.creditLedgerId },
                    data: { currentBalance: { increment: trans.amount } }
                });
                await tx.transaction.delete({ where: { id: trans.id } });
            }

            // Delete inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: { startsWith: `Adjustment` },
                    AND: { reason: { contains: adjustment.voucherNo } }
                }
            });

            await tx.inventoryadjustment.delete({ where: { id: parseInt(id) } });
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'Adjustment deleted and stock reversed' });
    } catch (error) {
        console.error('Error deleting adjustment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Adjustment
const updateAdjustment = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;
        const {
            voucherNo, manualVoucherNo, date, type, note, totalValue, items
        } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get old adjustment
            const oldAdj = await tx.inventoryadjustment.findUnique({
                where: { id: parseInt(id) },
                include: { inventoryadjustmentitem: true }
            });

            if (!oldAdj) throw new Error('Adjustment not found');

            // 2. Reverse OLD Stock
            for (const item of oldAdj.inventoryadjustmentitem) {
                if (oldAdj.type === 'ADD_STOCK') {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        data: { quantity: { decrement: item.quantity } }
                    });
                } else if (oldAdj.type === 'REMOVE_STOCK') {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        data: { quantity: { increment: item.quantity } }
                    });
                }
            }

            // 3. Reverse OLD Accounting
            const oldTransactions = await tx.transaction.findMany({
                where: { companyId: parseInt(companyId), voucherNumber: oldAdj.voucherNo, voucherType: 'JOURNAL' }
            });
            for (const trans of oldTransactions) {
                await tx.ledger.update({
                    where: { id: trans.debitLedgerId },
                    data: { currentBalance: { decrement: trans.amount } }
                });
                await tx.ledger.update({
                    where: { id: trans.creditLedgerId },
                    data: { currentBalance: { increment: trans.amount } }
                });
                await tx.transaction.delete({ where: { id: trans.id } });
            }

            // 4. Delete old items and transactions
            await tx.inventoryadjustmentitem.deleteMany({ where: { inventoryAdjustmentId: parseInt(id) } });
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: { contains: oldAdj.voucherNo }
                }
            });

            // 5. Update Header & Create New Items
            const headerWarehouseId = parseInt(items[0].warehouseId);
            const updatedAdj = await tx.inventoryadjustment.update({
                where: { id: parseInt(id) },
                data: {
                    manualVoucherNo,
                    date: date ? new Date(date) : new Date(),
                    type,
                    warehouseId: headerWarehouseId,
                    note,
                    totalValue: parseFloat(totalValue || 0),
                    inventoryadjustmentitem: {
                        create: items.map(item => ({
                            productId: parseInt(item.productId),
                            warehouseId: parseInt(item.warehouseId),
                            quantity: parseFloat(item.quantity || 0),
                            rate: parseFloat(item.rate || 0),
                            amount: parseFloat(item.amount || 0),
                            narration: item.narration
                        }))
                    }
                }
            });

            // 6. Apply NEW Stock
            for (const item of items) {
                const qty = parseFloat(item.quantity || 0);
                const productId = parseInt(item.productId);
                const whId = parseInt(item.warehouseId);

                if (type === 'ADD_STOCK') {
                    await tx.stock.upsert({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        update: { quantity: { increment: qty } },
                        create: { warehouseId: whId, productId: productId, quantity: qty }
                    });
                    await tx.inventorytransaction.create({
                        data: {
                            productId: productId,
                            toWarehouseId: whId,
                            quantity: qty,
                            type: 'ADJUSTMENT',
                            reason: `Adjustment (Add-Updated): ${voucherNo}. ${item.narration || ''}`,
                            companyId: parseInt(companyId),
                            userId: req.user?.userId || null
                        }
                    });
                } else if (type === 'REMOVE_STOCK') {
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: whId, productId: productId } },
                        data: { quantity: { decrement: qty } }
                    });
                    await tx.inventorytransaction.create({
                        data: {
                            productId: productId,
                            fromWarehouseId: whId,
                            quantity: qty,
                            type: 'ADJUSTMENT',
                            reason: `Adjustment (Remove-Updated): ${voucherNo}. ${item.narration || ''}`,
                            companyId: parseInt(companyId),
                            userId: req.user?.userId || null
                        }
                    });
                }
            }

            // 7. Apply NEW Accounting
            const inventoryAsset = await tx.ledger.findFirst({ where: { companyId: parseInt(companyId), name: 'Inventory Asset' } });
            const adjExpense = await tx.ledger.findFirst({ where: { companyId: parseInt(companyId), name: 'Inventory Adjustment Expense' } });
            const salesIncome = await tx.ledger.findFirst({ where: { companyId: parseInt(companyId), name: 'Sales Income' } });

            if (inventoryAsset) {
                let debitLedgerId, creditLedgerId;
                const totalAmt = parseFloat(totalValue || 0);
                if (type === 'ADD_STOCK' && salesIncome) {
                    debitLedgerId = inventoryAsset.id; creditLedgerId = salesIncome.id;
                } else if (type === 'REMOVE_STOCK' && adjExpense) {
                    debitLedgerId = adjExpense.id; creditLedgerId = inventoryAsset.id;
                }
                if (debitLedgerId && creditLedgerId && totalAmt > 0) {
                    await tx.transaction.create({
                        data: {
                            date: date ? new Date(date) : new Date(),
                            debitLedgerId, creditLedgerId, amount: totalAmt,
                            narration: `Inventory Adjustment (${type}-Updated): ${voucherNo}. ${note || ''}`,
                            voucherType: 'JOURNAL', voucherNumber: voucherNo, companyId: parseInt(companyId)
                        }
                    });
                    await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { increment: totalAmt } } });
                    await tx.ledger.update({ where: { id: creditLedgerId }, data: { currentBalance: { decrement: totalAmt } } });
                }
            }

            return updatedAdj;
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'Adjustment updated successfully', data: result });
    } catch (error) {
        console.error('Error updating adjustment:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const result = await numberingService.getNextNumber(companyId, 'adjustment');
        res.status(200).json({ success: true, nextNumber: result.formattedNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAdjustments,
    getAdjustmentById,
    createAdjustment,
    deleteAdjustment,
    updateAdjustment,
    getNextNumber
};
