const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Warehouse
const createWarehouse = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const { name, location, addressLine1, addressLine2, city, state, postalCode, country } = req.body;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });
        if (!name || !location) {
            return res.status(400).json({ success: false, message: 'Name and Location are required' });
        }

        const existingWarehouse = await prisma.warehouse.findFirst({
            where: { companyId: parseInt(companyId), name }
        });

        if (existingWarehouse) {
            return res.status(400).json({ success: false, message: 'Warehouse with this name already exists' });
        }

        const warehouse = await prisma.warehouse.create({
            data: {
                name,
                location,
                addressLine1,
                addressLine2,
                city,
                state,
                postalCode,
                country,
                companyId: parseInt(companyId)
            }
        });

        res.status(201).json({ success: true, message: 'Warehouse created successfully', data: warehouse });

    } catch (error) {
        console.error('Error creating warehouse:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Warehouses
const getWarehouses = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const warehouses = await prisma.warehouse.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                stock: {
                    select: {
                        quantity: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const formattedWarehouses = warehouses.map(w => {
            const totalStock = w.stock.reduce((sum, stock) => sum + (stock.quantity || 0), 0);
            const { stock, ...warehouseData } = w;
            return {
                ...warehouseData,
                totalStock
            };
        });

        res.status(200).json({ success: true, data: formattedWarehouses });

    } catch (error) {
        console.error('Error fetching warehouses:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Warehouse
const updateWarehouse = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const { name, location, addressLine1, addressLine2, city, state, postalCode, country } = req.body;

        const warehouse = await prisma.warehouse.update({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            data: {
                name,
                location,
                addressLine1,
                addressLine2,
                city,
                state,
                postalCode,
                country
            }
        });

        res.status(200).json({ success: true, message: 'Warehouse updated successfully', data: warehouse });

    } catch (error) {
        console.error('Error updating warehouse:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Warehouse
const deleteWarehouse = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const warehouseId = parseInt(id);

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // 1. Check stock with non-zero quantity or non-zero reservedQuantity
        const activeStock = await prisma.stock.findFirst({
            where: {
                warehouseId,
                OR: [
                    { quantity: { not: 0 } },
                    { reservedQuantity: { not: 0 } }
                ]
            }
        });
        if (activeStock) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it has active or reserved stock levels.' 
            });
        }

        // 2. Check if there are any related items in any transaction or document tables

        // Check purchase bill items (Purchase)
        const hasPurchaseBillItem = await prisma.purchasebillitem.findFirst({ where: { warehouseId } });
        if (hasPurchaseBillItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in purchase bills.' 
            });
        }

        // Check invoice items (Sale)
        const hasInvoiceItem = await prisma.invoiceitem.findFirst({ where: { warehouseId } });
        if (hasInvoiceItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in sales invoices.' 
            });
        }

        // Check POS invoice items (POS Sale)
        const hasPosInvoiceItem = await prisma.posinvoiceitem.findFirst({ where: { warehouseId } });
        if (hasPosInvoiceItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in POS invoices.' 
            });
        }

        // Check stock transfers
        const hasStockTransferTo = await prisma.stocktransfer.findFirst({ where: { toWarehouseId: warehouseId } });
        const hasStockTransferItemFrom = await prisma.stocktransferitem.findFirst({ where: { fromWarehouseId: warehouseId } });
        if (hasStockTransferTo || hasStockTransferItemFrom) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in stock transfers.' 
            });
        }

        // Check inventory transactions (All types of transactions)
        const hasInventoryTransaction = await prisma.inventorytransaction.findFirst({
            where: {
                OR: [
                    { fromWarehouseId: warehouseId },
                    { toWarehouseId: warehouseId }
                ]
            }
        });
        if (hasInventoryTransaction) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in inventory transactions.' 
            });
        }

        // Check other operational tables:
        
        // Delivery Challans
        const hasDeliveryChallanItem = await prisma.deliverychallanitem.findFirst({ where: { warehouseId } });
        if (hasDeliveryChallanItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in delivery challans.' 
            });
        }

        // Goods Receipt Notes
        const hasGoodsReceiptNoteItem = await prisma.goodsreceiptnoteitem.findFirst({ where: { warehouseId } });
        if (hasGoodsReceiptNoteItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in goods receipt notes.' 
            });
        }

        // Inventory Adjustments
        const hasInventoryAdjustment = await prisma.inventoryadjustment.findFirst({ where: { warehouseId } });
        const hasInventoryAdjustmentItem = await prisma.inventoryadjustmentitem.findFirst({ where: { warehouseId } });
        if (hasInventoryAdjustment || hasInventoryAdjustmentItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in inventory adjustments.' 
            });
        }

        // Purchase Orders
        const hasPurchaseOrderItem = await prisma.purchaseorderitem.findFirst({ where: { warehouseId } });
        if (hasPurchaseOrderItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in purchase orders.' 
            });
        }

        // Purchase Quotations
        const hasPurchaseQuotationItem = await prisma.purchasequotationitem.findFirst({ where: { warehouseId } });
        if (hasPurchaseQuotationItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in purchase quotations.' 
            });
        }

        // Purchase Returns
        const hasPurchaseReturnItem = await prisma.purchasereturnitem.findFirst({ where: { warehouseId } });
        if (hasPurchaseReturnItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in purchase returns.' 
            });
        }

        // Sales Orders
        const hasSalesOrderItem = await prisma.salesorderitem.findFirst({ where: { warehouseId } });
        if (hasSalesOrderItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in sales orders.' 
            });
        }

        // Sales Quotations
        const hasSalesQuotationItem = await prisma.salesquotationitem.findFirst({ where: { warehouseId } });
        if (hasSalesQuotationItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in sales quotations.' 
            });
        }

        // Sales Returns
        const hasSalesReturnItem = await prisma.salesreturnitem.findFirst({ where: { warehouseId } });
        if (hasSalesReturnItem) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it is referenced in sales returns.' 
            });
        }

        // Inventory Batches
        const hasInventoryBatch = await prisma.inventory_batch.findFirst({ where: { warehouseId } });
        if (hasInventoryBatch) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cannot delete warehouse as it has associated inventory batches.' 
            });
        }

        // 3. Delete the warehouse (cascade delete will handle 0-quantity stock records)
        await prisma.warehouse.delete({
            where: {
                id: warehouseId,
                companyId: parseInt(companyId)
            }
        });

        res.status(200).json({ success: true, message: 'Warehouse deleted successfully' });

    } catch (error) {
        console.error('Error deleting warehouse:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getWarehouseById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const warehouse = await prisma.warehouse.findUnique({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                stock: {
                    include: {
                        product: {
                            include: {
                                category: true
                            }
                        }
                    }
                }
            }
        });

        if (!warehouse) {
            return res.status(404).json({ success: false, message: 'Warehouse not found' });
        }

        // Calculate Stats
        const totalStockUnits = warehouse.stock.reduce((sum, stock) => sum + stock.quantity, 0);
        const categories = new Set(warehouse.stock.map(s => s.product?.categoryId).filter(Boolean));
        const totalCategories = categories.size;
        const totalProducts = warehouse.stock.length;

        // Find Highest and Lowest Stock Product
        let highestStockProduct = null;
        let lowestStockProduct = null;

        if (warehouse.stock.length > 0) {
            highestStockProduct = warehouse.stock.reduce((prev, current) => (prev.quantity > current.quantity) ? prev : current);
            lowestStockProduct = warehouse.stock.reduce((prev, current) => (prev.quantity < current.quantity) ? prev : current);
        }

        // Format Inventory List
        const inventoryList = (warehouse.stock || []).map(stock => ({
            id: stock.id,
            category: stock.product?.category?.name || 'Uncategorized',
            product: stock.product?.name,
            unit: stock.product?.unit || 'Units',
            quantity: stock.quantity
        }));

        const data = {
            ...warehouse,
            stats: {
                totalCategories,
                totalProducts,
                totalStockUnits,
                highestStockProduct: highestStockProduct ? `${highestStockProduct.product.name} (${highestStockProduct.quantity})` : '-',
                lowestStockProduct: lowestStockProduct ? `${lowestStockProduct.product.name} (${lowestStockProduct.quantity})` : '-'
            },
            inventory: inventoryList
        };

        res.status(200).json({ success: true, data });
    } catch (error) {
        console.error('Error fetching warehouse:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}


module.exports = {
    createWarehouse,
    getWarehouses,
    updateWarehouse,
    deleteWarehouse,
    getWarehouseById
};
