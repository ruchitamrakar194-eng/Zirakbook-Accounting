const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Get All Stock Transfers
const getStockTransfers = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const transfers = await prisma.stocktransfer.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                warehouse: { select: { name: true } },
                stocktransferitem: {
                    include: {
                        product: { select: { name: true, sku: true } },
                        warehouse: { select: { name: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: transfers });
    } catch (error) {
        console.error('Error fetching stock transfers:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get Stock Transfer By ID
const getStockTransferById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const transfer = await prisma.stocktransfer.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                warehouse: { select: { name: true } },
                stocktransferitem: {
                    include: {
                        product: { select: { name: true, sku: true, barcode: true } },
                        warehouse: { select: { name: true } }
                    }
                }
            }
        });

        if (!transfer) {
            return res.status(404).json({ success: false, message: 'Stock transfer not found' });
        }

        res.status(200).json({ success: true, data: transfer });
    } catch (error) {
        console.error('Error fetching stock transfer:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Create Stock Transfer
const createStockTransfer = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const {
            voucherNo, manualVoucherNo, date, toWarehouseId, narration, items
        } = req.body;

        let resolvedVoucherNo = voucherNo;
        if (!resolvedVoucherNo) {
            const nextNumObj = await numberingService.getNextNumber(companyId, 'stocktransfer');
            resolvedVoucherNo = nextNumObj.formattedNumber;
        }

        if (!resolvedVoucherNo || !toWarehouseId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid stock transfer data' });
        }

        // Calculate total amount
        const totalAmount = items.reduce((acc, item) => acc + (parseFloat(item.rate || 0) * parseFloat(item.quantity)), 0);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Stock Transfer Record
            const transfer = await tx.stocktransfer.create({
                data: {
                    voucherNo: resolvedVoucherNo,
                    manualVoucherNo,
                    date: date ? new Date(date) : new Date(),
                    toWarehouseId: parseInt(toWarehouseId),
                    narration,
                    totalAmount,
                    companyId: parseInt(companyId),
                    stocktransferitem: {
                        create: items.map(item => ({
                            productId: parseInt(item.productId),
                            fromWarehouseId: parseInt(item.fromWarehouseId),
                            quantity: parseFloat(item.quantity),
                            rate: parseFloat(item.rate || 0),
                            amount: parseFloat(item.rate || 0) * parseFloat(item.quantity),
                            narration: item.narration
                        }))
                    }
                }
            });

            // 2. Update Stock and Log Inventory Transactions
            for (const item of items) {
                const qty = parseFloat(item.quantity);
                const pid = parseInt(item.productId);
                const fromWH = parseInt(item.fromWarehouseId);
                const toWH = parseInt(toWarehouseId);

                // a. Update source stock (Allowing negative)
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: fromWH, productId: pid } },
                    update: { quantity: { decrement: qty } },
                    create: {
                        warehouseId: fromWH,
                        productId: pid,
                        quantity: -qty,
                        initialQty: 0,
                        minOrderQty: 0
                    }
                });

                // c. Increment at destination
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: toWH, productId: pid } },
                    update: { quantity: { increment: qty } },
                    create: {
                        warehouseId: toWH,
                        productId: pid,
                        quantity: qty,
                        initialQty: 0,
                        minOrderQty: 0
                    }
                });

                // d. Log Inventory Transaction (History)
                await tx.inventorytransaction.create({
                    data: {
                        type: 'TRANSFER',
                        productId: pid,
                        fromWarehouseId: fromWH,
                        toWarehouseId: toWH,
                        quantity: qty,
                        reason: `Voucher: ${resolvedVoucherNo}. ${item.narration || ''}`,
                        companyId: parseInt(companyId)
                    }
                });
            }

            return transfer;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'stocktransfer', resolvedVoucherNo);
        res.status(201).json({ success: true, message: 'Stock transfer created successfully', data: result });
    } catch (error) {
        console.error('Error creating stock transfer:', error);
        res.status(400).json({ success: false, message: error.message || 'Failed to create stock transfer' });
    }
};

// Delete Stock Transfer (Optional: Reverse the stock if needed, but usually just soft delete or hard delete with warning)
// For this simple version, let's just delete the record. Reversing is safer in ERP.
const deleteStockTransfer = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        await prisma.$transaction(async (tx) => {
            const transfer = await tx.stocktransfer.findFirst({
                where: {
                    id: parseInt(id),
                    companyId: parseInt(companyId)
                },
                include: { stocktransferitem: true }
            });

            if (!transfer) throw new Error('Transfer not found');

            // Reverse stock for each item
            for (const item of transfer.stocktransferitem) {
                // Return to source
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: item.fromWarehouseId, productId: item.productId } },
                    data: { quantity: { increment: item.quantity } }
                });

                // Remove from destination
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: transfer.toWarehouseId, productId: item.productId } },
                    data: { quantity: { decrement: item.quantity } }
                });
            }

            await tx.stocktransfer.delete({ where: { id: parseInt(id) } });
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'Stock transfer deleted and stock reversed successfully' });
    } catch (error) {
        console.error('Error deleting stock transfer:', error);
        res.status(400).json({ success: false, message: error.message || 'Failed to delete stock transfer' });
    }
};

// Update Stock Transfer
const updateStockTransfer = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;
        const {
            voucherNo, manualVoucherNo, date, toWarehouseId, narration, items
        } = req.body;

        if (!toWarehouseId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid stock transfer data' });
        }

        const totalAmount = items.reduce((acc, item) => acc + (parseFloat(item.rate || 0) * parseFloat(item.quantity)), 0);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Get existing transfer and items
            const oldTransfer = await tx.stocktransfer.findUnique({
                where: { id: parseInt(id) },
                include: { stocktransferitem: true }
            });

            if (!oldTransfer) throw new Error('Stock transfer not found');

            // 2. Reverse OLD stock movements
            for (const item of oldTransfer.stocktransferitem) {
                // Return to original source
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: item.fromWarehouseId, productId: item.productId } },
                    data: { quantity: { increment: item.quantity } }
                });

                // Remove from original destination
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: oldTransfer.toWarehouseId, productId: item.productId } },
                    data: { quantity: { decrement: item.quantity } }
                });
            }

            // 3. Delete old items and old inventory transactions (by voucher No preferably)
            await tx.stocktransferitem.deleteMany({ where: { stockTransferId: parseInt(id) } });
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: { startsWith: `Voucher: ${oldTransfer.voucherNo}` }
                }
            });

            // 4. Update Transfer Record
            const updatedTransfer = await tx.stocktransfer.update({
                where: { id: parseInt(id) },
                data: {
                    manualVoucherNo,
                    date: date ? new Date(date) : new Date(),
                    toWarehouseId: parseInt(toWarehouseId),
                    narration,
                    totalAmount,
                    stocktransferitem: {
                        create: items.map(item => ({
                            productId: parseInt(item.productId),
                            fromWarehouseId: parseInt(item.fromWarehouseId),
                            quantity: parseFloat(item.quantity),
                            rate: parseFloat(item.rate || 0),
                            amount: parseFloat(item.rate || 0) * parseFloat(item.quantity),
                            narration: item.narration
                        }))
                    }
                }
            });

            // 5. Apply NEW stock movements
            for (const item of items) {
                const qty = parseFloat(item.quantity);
                const pid = parseInt(item.productId);
                const fromWH = parseInt(item.fromWarehouseId);
                const toWH = parseInt(toWarehouseId);

                // a. Update source stock (Allowing negative)
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: fromWH, productId: pid } },
                    update: { quantity: { decrement: qty } },
                    create: {
                        warehouseId: fromWH,
                        productId: pid,
                        quantity: -qty,
                        initialQty: 0,
                        minOrderQty: 0
                    }
                });

                // Increment at destination
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: toWH, productId: pid } },
                    update: { quantity: { increment: qty } },
                    create: {
                        warehouseId: toWH,
                        productId: pid,
                        quantity: qty,
                        initialQty: 0,
                        minOrderQty: 0
                    }
                });

                // Log New Inventory Transaction
                await tx.inventorytransaction.create({
                    data: {
                        type: 'TRANSFER',
                        productId: pid,
                        fromWarehouseId: fromWH,
                        toWarehouseId: toWH,
                        quantity: qty,
                        reason: `Voucher: ${oldTransfer.voucherNo} (Updated). ${item.narration || ''}`,
                        companyId: parseInt(companyId)
                    }
                });
            }

            return updatedTransfer;
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'Stock transfer updated successfully', data: result });
    } catch (error) {
        console.error('Error updating stock transfer:', error);
        res.status(400).json({ success: false, message: error.message || 'Failed to update stock transfer' });
    }
};

const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const result = await numberingService.getNextNumber(companyId, 'stocktransfer');
        res.status(200).json({ success: true, nextNumber: result.formattedNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getStockTransfers,
    getStockTransferById,
    createStockTransfer,
    deleteStockTransfer,
    updateStockTransfer,
    getNextNumber
};
