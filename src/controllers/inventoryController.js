const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Transfer Stock between Warehouses
const transferStock = async (req, res) => {
    try {
        const { productId, fromWarehouseId, toWarehouseId, quantity, description } = req.body;
        const companyId = req.user.companyId;

        if (!productId || !fromWarehouseId || !toWarehouseId || !quantity || quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid transfer details' });
        }

        if (fromWarehouseId === toWarehouseId) {
            return res.status(400).json({ success: false, message: 'Source and Destination warehouses cannot be the same' });
        }

        // Check if source stock exists
        const sourceStock = await prisma.stock.findUnique({
            where: {
                warehouseId_productId: {
                    warehouseId: parseInt(fromWarehouseId),
                    productId: parseInt(productId)
                }
            }
        });

        if (!sourceStock || sourceStock.quantity < quantity) {
            return res.status(400).json({ success: false, message: 'Insufficient stock in source warehouse' });
        }

        // Perform Transfer within a Transaction
        await prisma.$transaction(async (prisma) => {
            // 1. Decrement Source
            await prisma.stock.update({
                where: {
                    warehouseId_productId: {
                        warehouseId: parseInt(fromWarehouseId),
                        productId: parseInt(productId)
                    }
                },
                data: { quantity: { decrement: parseFloat(quantity) } }
            });

            // 2. Increment Destination (Upsert)
            await prisma.stock.upsert({
                where: {
                    warehouseId_productId: {
                        warehouseId: parseInt(toWarehouseId),
                        productId: parseInt(productId)
                    }
                },
                update: { quantity: { increment: parseFloat(quantity) } },
                create: {
                    warehouseId: parseInt(toWarehouseId),
                    productId: parseInt(productId),
                    quantity: parseFloat(quantity),
                    initialQty: 0,
                    minOrderQty: 0
                }
            });

            // 3. Log Transaction
            await prisma.inventorytransaction.create({
                data: {
                    type: 'TRANSFER',
                    productId: parseInt(productId),
                    fromWarehouseId: parseInt(fromWarehouseId),
                    toWarehouseId: parseInt(toWarehouseId),
                    quantity: parseFloat(quantity),
                    reason: description || 'Stock Transfer',
                    companyId: parseInt(companyId),
                    userId: req.user?.userId || null
                }
            });
        });

        res.status(200).json({ success: true, message: 'Stock transferred successfully' });

    } catch (error) {
        console.error('Transfer Error:', error);
        res.status(500).json({ success: false, message: 'Failed to transfer stock', error: error.message });
    }
};

// Adjust Stock (Damage, Loss, Correction)
const adjustStock = async (req, res) => {
    try {
        const { productId, warehouseId, quantity, type, reason } = req.body; // type: 'ADD' or 'REMOVE'
        const companyId = req.user.companyId;

        if (!productId || !warehouseId || !quantity || quantity <= 0 || !type) {
            return res.status(400).json({ success: false, message: 'Invalid adjustment details' });
        }

        const qty = parseFloat(quantity);
        const adjustmentQuantity = type === 'REMOVE' ? -qty : qty;

        // Optionally check stock for removal
        if (type === 'REMOVE') {
            const currentStock = await prisma.stock.findUnique({
                where: {
                    warehouseId_productId: {
                        warehouseId: parseInt(warehouseId),
                        productId: parseInt(productId)
                    }
                }
            });
            if (!currentStock || currentStock.quantity < qty) {
                return res.status(400).json({ success: false, message: 'Insufficient stock to remove' });
            }
        }

        await prisma.$transaction(async (prisma) => {
            // 1. Update Stock
            await prisma.stock.upsert({
                where: {
                    warehouseId_productId: {
                        warehouseId: parseInt(warehouseId),
                        productId: parseInt(productId)
                    }
                },
                update: { quantity: { increment: adjustmentQuantity } },
                create: {
                    warehouseId: parseInt(warehouseId),
                    productId: parseInt(productId),
                    quantity: adjustmentQuantity > 0 ? adjustmentQuantity : 0,
                    // Note: Creating with negative stock is theoretically possible but weird. 
                    // But check above prevents removal if no stock exists.
                    // If adding, it's fine.
                    initialQty: 0,
                    minOrderQty: 0
                }
            });

            // 2. Log Transaction
            await prisma.inventorytransaction.create({
                data: {
                    type: 'ADJUSTMENT',
                    productId: parseInt(productId),
                    // If adding, it goes TO the warehouse. If removing, it comes FROM the warehouse?
                    // Or just use 'toWarehouse' for consistency and rely on type/quantity?
                    // Let's use logic:
                    // If ADD: toWarehouse = ID.
                    // If REMOVE: fromWarehouse = ID.
                    toWarehouseId: type === 'ADD' ? parseInt(warehouseId) : null,
                    fromWarehouseId: type === 'REMOVE' ? parseInt(warehouseId) : null,
                    quantity: qty, // Log the absolute amount
                    reason: reason || `${type} Adjustment`,
                    companyId: parseInt(companyId),
                    userId: req.user?.userId || null
                }
            });
        });

        res.status(200).json({ success: true, message: 'Stock adjusted successfully' });

    } catch (error) {
        console.error('Adjustment Error:', error);
        res.status(500).json({ success: false, message: 'Failed to adjust stock', error: error.message });
    }
};

// Get Inventory Transactions/History
const getInventoryHistory = async (req, res) => {
    try {
        const { productId, warehouseId } = req.query;
        const companyId = req.user.companyId;

        const where = { companyId: parseInt(companyId) };
        if (productId) where.productId = parseInt(productId);
        if (warehouseId) {
            where.OR = [
                { fromWarehouseId: parseInt(warehouseId) },
                { toWarehouseId: parseInt(warehouseId) }
            ];
        }

        const transactions = await prisma.inventorytransaction.findMany({
            where,
            include: {
                product: { select: { name: true, sku: true } },
                fromWarehouse: { select: { name: true } },
                toWarehouse: { select: { name: true } }
            },
            orderBy: { date: 'desc' }
        });

        res.status(200).json({ success: true, data: transactions });
    } catch (error) {
        console.error('History Error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch history' });
    }
};

// Recalculate Inventory Quantities for all product-warehouse mappings
const recalculateInventory = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        // 1. Get all products of this company
        const products = await prisma.product.findMany({
            where: { companyId: parseInt(companyId) },
            include: { stock: true }
        });

        // 2. Get all warehouses of this company
        const warehouses = await prisma.warehouse.findMany({
            where: { companyId: parseInt(companyId) }
        });

        const results = [];

        // 3. Perform the recalculation inside a transaction
        await prisma.$transaction(async (tx) => {
            for (const product of products) {
                let productTotalQty = 0;

                for (const warehouse of warehouses) {
                    // Find existing stock record or default initialQty
                    const existingStock = product.stock.find(s => s.warehouseId === warehouse.id);
                    const initialQty = existingStock ? parseFloat(existingStock.initialQty || 0) : 0;

                    // Query all inventory transactions for this product and warehouse
                    const txs = await tx.inventorytransaction.findMany({
                        where: {
                            companyId: parseInt(companyId),
                            productId: product.id,
                            OR: [
                                { fromWarehouseId: warehouse.id },
                                { toWarehouseId: warehouse.id }
                            ]
                        }
                    });

                    let calculatedQty = 0;
                    let hasOpeningStockTx = false;

                    for (const t of txs) {
                        if (t.type === 'OPENING_STOCK' && t.toWarehouseId === warehouse.id) {
                            hasOpeningStockTx = true;
                        }
                        
                        if (t.toWarehouseId === warehouse.id) {
                            calculatedQty += parseFloat(t.quantity);
                        }
                        if (t.fromWarehouseId === warehouse.id) {
                            calculatedQty -= parseFloat(t.quantity);
                        }
                    }

                    // If there was no OPENING_STOCK transaction but initialQty is > 0, include it
                    if (!hasOpeningStockTx && initialQty > 0) {
                        calculatedQty += initialQty;
                    }

                    // Update or create stock entry
                    await tx.stock.upsert({
                        where: {
                            warehouseId_productId: {
                                warehouseId: warehouse.id,
                                productId: product.id
                            }
                        },
                        update: { quantity: calculatedQty },
                        create: {
                            warehouseId: warehouse.id,
                            productId: product.id,
                            quantity: calculatedQty,
                            initialQty: initialQty,
                            minOrderQty: existingStock ? parseFloat(existingStock.minOrderQty || 0) : 0
                        }
                    });

                    productTotalQty += calculatedQty;

                    results.push({
                        productName: product.name,
                        warehouseName: warehouse.name,
                        productId: product.id,
                        warehouseId: warehouse.id,
                        oldQty: existingStock ? existingStock.quantity : 0,
                        newQty: calculatedQty
                    });
                }

                // Update the product's totalQty and totalInventoryValue based on averageCost/initialCost
                const averageCost = parseFloat(product.averageCost || product.initialCost || product.purchasePrice || 0);
                const totalInventoryValue = productTotalQty * averageCost;

                await tx.product.update({
                    where: { id: product.id },
                    data: {
                        totalQty: productTotalQty,
                        totalInventoryValue: totalInventoryValue
                    }
                });
            }
        });

        res.status(200).json({
            success: true,
            message: 'Inventory stock quantities recalculated successfully',
            data: results
        });

    } catch (error) {
        console.error('Recalculate Inventory Error:', error);
        res.status(500).json({ success: false, message: 'Failed to recalculate inventory', error: error.message });
    }
};

module.exports = {
    transferStock,
    adjustStock,
    getInventoryHistory,
    recalculateInventory
};
