const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create GRN (Linked to PO)
const createGRN = async (req, res) => {
    try {
        const { grnNumber, date, vendorId, purchaseOrderId, items, notes, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!grnNumber || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const grnItems = items.map(item => ({
            productId: parseInt(item.productId),
            warehouseId: parseInt(item.warehouseId), // Required for tracking where stock goes
            quantity: parseFloat(item.quantity),
            description: item.description
        }));

        const result = await prisma.$transaction(async (tx) => {
            // 1. Create GRN
            const grn = await tx.goodsreceiptnote.create({
                data: {
                    grnNumber,
                    date: new Date(date),
                    vendorId: parseInt(vendorId),
                    purchaseOrderId: purchaseOrderId ? parseInt(purchaseOrderId) : null,
                    companyId: parseInt(companyId),
                    notes,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    goodsreceiptnoteitem: {
                        create: grnItems
                    }
                },
                include: { goodsreceiptnoteitem: true }
            });

            // 2. Increment Stock and Create Inventory Transactions (NO Ledger here)
            for (const item of grnItems) {
                // Update Stock
                await tx.stock.upsert({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    create: {
                        warehouseId: item.warehouseId,
                        productId: item.productId,
                        quantity: item.quantity,
                        initialQty: 0
                    },
                    update: {
                        quantity: { increment: item.quantity }
                    }
                });

                // Create Inventory Transaction
                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(date),
                        type: 'GRN',
                        productId: item.productId,
                        toWarehouseId: item.warehouseId,
                        quantity: item.quantity,
                        companyId: parseInt(companyId),
                        userId: req.user?.userId || null,
                        reason: `GRN: ${grnNumber}`
                    }
                });
            }

            // 3. Update PO Status
            if (purchaseOrderId) {
                await tx.purchaseorder.update({
                    where: { id: parseInt(purchaseOrderId) },
                    data: { status: 'PARTIAL' }
                });
            }

            return grn;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'goodsreceiptnote', grnNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create GRN Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All GRNs
const getGRNs = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const grns = await prisma.goodsreceiptnote.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                vendor: true,
                goodsreceiptnoteitem: true,
                purchaseorder: {
                    include: {
                        purchaseorderitem: true
                    }
                },
                purchasebill: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: grns });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get GRN By ID
const getGRNById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const grn = await prisma.goodsreceiptnote.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                goodsreceiptnoteitem: { include: { product: true, warehouse: true } },
                vendor: true,
                purchaseorder: {
                    include: {
                        purchaseorderitem: true
                    }
                }
            }
        });

        if (!grn) {
            return res.status(404).json({ success: false, message: 'GRN not found' });
        }

        res.status(200).json({ success: true, data: grn });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteGRN = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const grn = await prisma.goodsreceiptnote.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { goodsreceiptnoteitem: true }
        });

        if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

        await prisma.$transaction(async (tx) => {
            // 1. Revert Stock
            for (const item of grn.goodsreceiptnoteitem) {
                await tx.stock.update({
                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                    data: { quantity: { decrement: item.quantity } }
                });
            }

            // 2. Delete Inventory Transactions
            await tx.inventorytransaction.deleteMany({
                where: { reason: `GRN: ${grn.grnNumber}`, companyId: parseInt(companyId) }
            });

            // 3. Delete GRN Items and GRN
            await tx.goodsreceiptnoteitem.deleteMany({ where: { grnId: grn.id } });
            await tx.goodsreceiptnote.delete({ where: { id: grn.id } });
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'GRN deleted successfully' });
    } catch (error) {
        console.error('Delete GRN Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateGRN = async (req, res) => {
    try {
        const { id } = req.params;
        const { notes, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const updated = await prisma.goodsreceiptnote.update({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            data: { 
                notes,
                customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined
            }
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createGRN,
    getGRNs,
    getGRNById,
    updateGRN,
    deleteGRN
};
