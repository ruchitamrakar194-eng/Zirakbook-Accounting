const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Delivery Challan
const createChallan = async (req, res) => {
    try {
        const {
            challanNumber, manualReference, date, customerId, salesOrderId, items, notes,
            shippingAddress, shippingCity, shippingState, shippingZipCode, shippingPhone, shippingEmail,
            vehicleNo, carrier, transportNote, remarks, customFields
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!challanNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const challanItems = items
            .map(item => ({
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: parseFloat(item.quantity),
                description: item.description || ''
            }))
            .filter(item => !isNaN(item.productId) && !isNaN(item.warehouseId) && item.quantity > 0);

        if (challanItems.length === 0) {
            return res.status(400).json({ success: false, message: 'Valid items with product and warehouse are required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};

            // A. Create Challan
            const challan = await tx.deliverychallan.create({
                data: {
                    challanNumber,
                    date: new Date(date),
                    customer: { connect: { id: parseInt(customerId) } },
                    salesorder: salesOrderId ? { connect: { id: parseInt(salesOrderId) } } : undefined,
                    company: { connect: { id: parseInt(companyId) } },
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingPhone,
                    shippingEmail,
                    notes,
                    vehicleNo,
                    transportNote,
                    remarks,
                    deliverychallanitem: {
                        create: challanItems
                    }
                },
                include: {
                    deliverychallanitem: true,
                    customer: true
                }
            });

            // B. Clear SO Reservations if linked
            if (salesOrderId) {
                const so = await tx.salesorder.findFirst({
                    where: { id: parseInt(salesOrderId), companyId: parseInt(companyId) },
                    include: { salesorderitem: true }
                });

                if (so && config.reserveOnSO) {
                    for (const item of so.salesorderitem) {
                        if (item.productId && item.warehouseId) {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                                create: {
                                    warehouseId: item.warehouseId,
                                    productId: item.productId,
                                    reservedQuantity: -item.quantity,
                                    quantity: 0,
                                    initialQty: 0,
                                    minOrderQty: 0
                                },
                                update: {
                                    reservedQuantity: { decrement: item.quantity }
                                }
                            });
                        }
                    }
                }
            }

            // C. Inventory Logic (Reserve vs Issue)
            const action = config.challanAction || 'ISSUE';

            for (const item of challanItems) {
                if (item.productId && item.warehouseId) {
                    if (action === 'ISSUE') {
                        // Decrement Stock
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

                        // Log Inventory Transaction
                        await tx.inventorytransaction.create({
                            data: {
                                type: 'SALE',
                                productId: item.productId,
                                fromWarehouseId: item.warehouseId,
                                quantity: item.quantity,
                                reason: `Challan Issue: ${challanNumber}`,
                                companyId: parseInt(companyId)
                            }
                        });
                    } else if (action === 'RESERVE') {
                        // Increment Reserved Quantity
                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: { warehouseId: item.warehouseId, productId: item.productId, reservedQuantity: item.quantity },
                            update: { reservedQuantity: { increment: item.quantity } }
                        });
                    }
                }
            }

            // D. Update Sales Order status
            if (salesOrderId) {
                await tx.salesorder.update({
                    where: { id: parseInt(salesOrderId), companyId: parseInt(companyId) },
                    data: { status: 'PARTIAL' }
                });
            }

            return challan;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'deliverychallan', challanNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Challan Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Challans
const getChallans = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const challans = await prisma.deliverychallan.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: {
                    select: {
                        name: true, email: true, phone: true,
                        billingName: true, billingPhone: true, billingAddress: true, billingCity: true, billingState: true, billingZipCode: true,
                        shippingName: true, shippingPhone: true, shippingAddress: true, shippingCity: true, shippingState: true, shippingZipCode: true
                    }
                },
                deliverychallanitem: { include: { product: true, warehouse: true } },
                salesorder: {
                    include: { salesorderitem: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: challans });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Challan By ID
const getChallanById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const challan = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                deliverychallanitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                },
                customer: true,
                salesorder: true
            }
        });

        if (!challan) {
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }

        res.status(200).json({ success: true, data: challan });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Delivery Challan
const updateChallan = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            challanNumber, date, customerId, salesOrderId, items, notes,
            shippingAddress, shippingCity, shippingState, shippingZipCode, shippingPhone, shippingEmail,
            vehicleNo, transportNote, remarks, customFields
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }

        const challanItems = items
            .map(item => ({
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: parseFloat(item.quantity),
                description: item.description || ''
            }))
            .filter(item => !isNaN(item.productId) && !isNaN(item.warehouseId) && item.quantity > 0);

        const result = await prisma.$transaction(async (tx) => {
            // Delete existing items
            await tx.deliverychallanitem.deleteMany({
                where: { challanId: parseInt(id) }
            });

            // Update Challan
            return await tx.deliverychallan.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    challanNumber,
                    date: new Date(date),
                    customer: { connect: { id: parseInt(customerId) } },
                    salesorder: salesOrderId ? { connect: { id: parseInt(salesOrderId) } } : { disconnect: true },
                    company: { connect: { id: parseInt(companyId) } },
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    vehicleNo,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingPhone,
                    shippingEmail,
                    notes,
                    transportNote,
                    remarks,
                    deliverychallanitem: {
                        create: challanItems
                    }
                },
                include: {
                    deliverychallanitem: true,
                    customer: true
                }
            });
        }, { timeout: 30000 });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Update Challan Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Challan
const deleteChallan = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }

        await prisma.deliverychallan.delete({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        res.status(200).json({ success: true, message: 'Delivery Challan deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createChallan,
    getChallans,
    getChallanById,
    updateChallan,
    deleteChallan
};
