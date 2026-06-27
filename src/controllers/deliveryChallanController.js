const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Delivery Challan
const createChallan = async (req, res) => {
    try {
        const {
            challanNumber, manualReference, date, customerId, salesOrderId, items, notes,
            shippingAddress, shippingCity, shippingState, shippingZipCode, shippingPhone, shippingEmail,
            vehicleNo, carrier, transportNote, remarks, customFields, manualStatus, status
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
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'PENDING',
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
                                companyId: parseInt(companyId),
                                userId: req.user?.userId || null
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
                await updateSalesOrderStatus(tx, salesOrderId);
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
            vehicleNo, transportNote, remarks, customFields, manualStatus, status, onlyUpdateStatus
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.deliverychallan.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const existing = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { deliverychallanitem: true }
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
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};
            const action = config.challanAction || 'ISSUE';

            // 1. Revert Old Stock & Inventory Transactions
            for (const item of existing.deliverychallanitem) {
                if (item.productId && item.warehouseId) {
                    if (action === 'ISSUE') {
                        // Restore stock (Increment)
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
                    } else if (action === 'RESERVE') {
                        // Revert reserve (Decrement)
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

            // Delete old associated inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: `Challan Issue: ${existing.challanNumber}`
                }
            });

            // Delete existing items
            await tx.deliverychallanitem.deleteMany({
                where: { challanId: parseInt(id) }
            });

            // 2. Apply New Stock & Inventory Transactions
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
                                date: new Date(date),
                                type: 'SALE',
                                productId: item.productId,
                                fromWarehouseId: item.warehouseId,
                                quantity: item.quantity,
                                reason: `Challan Issue: ${challanNumber}`,
                                companyId: parseInt(companyId),
                                userId: req.user?.userId || null
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

            // Update Challan
            const updated = await tx.deliverychallan.update({
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
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status,
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

            // Recalculate status of old and new Sales Orders
            if (existing.salesOrderId) {
                await updateSalesOrderStatus(tx, existing.salesOrderId);
            }
            if (salesOrderId && parseInt(salesOrderId) !== existing.salesOrderId) {
                await updateSalesOrderStatus(tx, parseInt(salesOrderId));
            }

            return updated;
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

        const challan = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { deliverychallanitem: true }
        });

        if (!challan) {
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }

        await prisma.$transaction(async (tx) => {
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};
            const action = config.challanAction || 'ISSUE';

            // 1. Revert Stock
            for (const item of challan.deliverychallanitem) {
                if (item.productId && item.warehouseId) {
                    if (action === 'ISSUE') {
                        // Restore stock (Increment)
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
                    } else if (action === 'RESERVE') {
                        // Revert reserve (Decrement)
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

            // Delete associated inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: `Challan Issue: ${challan.challanNumber}`
                }
            });

            // 2. Delete deliverychallan items and the challan
            await tx.deliverychallanitem.deleteMany({
                where: { challanId: challan.id }
            });
            await tx.deliverychallan.delete({
                where: { id: challan.id }
            });

            // Recalculate status
            if (challan.salesOrderId) {
                await updateSalesOrderStatus(tx, challan.salesOrderId);
            }
        }, { timeout: 30000 });

        res.status(200).json({ success: true, message: 'Delivery Challan deleted successfully' });
    } catch (error) {
        console.error('Delete Challan Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

async function updateSalesOrderStatus(tx, salesOrderId) {
    if (!salesOrderId) return;
    const soId = parseInt(salesOrderId);
    if (isNaN(soId)) return;

    const so = await tx.salesorder.findUnique({
        where: { id: soId },
        include: { salesorderitem: true }
    });

    if (!so) return;
    if (so.manualStatus === true) return;

    const challans = await tx.deliverychallan.findMany({
        where: { salesOrderId: soId },
        include: { deliverychallanitem: true }
    });

    const deliveredMap = {};
    for (const dc of challans) {
        for (const item of dc.deliverychallanitem) {
            const pId = item.productId;
            if (pId) {
                deliveredMap[pId] = (deliveredMap[pId] || 0) + item.quantity;
            }
        }
    }

    let allCompleted = true;
    let someDelivered = false;

    for (const soItem of so.salesorderitem) {
        const ordered = soItem.quantity || 0;
        const delivered = deliveredMap[soItem.productId] || 0;

        if (delivered < ordered) {
            allCompleted = false;
        }
        if (delivered > 0) {
            someDelivered = true;
        }
    }

    let finalStatus = 'PENDING';
    if (allCompleted && so.salesorderitem.length > 0) {
        finalStatus = 'COMPLETED';
    } else if (someDelivered) {
        finalStatus = 'PARTIAL';
    }

    await tx.salesorder.update({
        where: { id: soId },
        data: { status: finalStatus }
    });
}

module.exports = {
    createChallan,
    getChallans,
    getChallanById,
    updateChallan,
    deleteChallan
};
