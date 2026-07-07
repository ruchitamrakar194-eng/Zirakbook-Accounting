const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Delivery Challan
const createChallan = async (req, res) => {
    try {
        const {
            challanNumber, manualReference, date, customerId, salesOrderId, items, notes,
            shippingAddress, shippingCity, shippingState, shippingZipCode, shippingPhone, shippingEmail,
            vehicleNo, carrier, transportNote, remarks, customFields, manualStatus, status,
            allowDuplicateManualNo
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.deliverychallan.findFirst({
                where: { companyId: parseInt(companyId), manualReference }
            });
            if (existingManual) {
                return res.status(400).json({
                    success: false,
                    isDuplicateWarning: true,
                    message: `Manual reference number '${manualReference}' already exists. Do you want to use this duplicate number?`
                });
            }
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
                    manualReference,
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
            challanNumber, manualReference, date, customerId, salesOrderId, items, notes,
            shippingAddress, shippingCity, shippingState, shippingZipCode, shippingPhone, shippingEmail,
            vehicleNo, transportNote, remarks, customFields, manualStatus, status, onlyUpdateStatus,
            allowDuplicateManualNo
        } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.deliverychallan.findFirst({
                where: {
                    companyId: parseInt(companyId),
                    manualReference,
                    id: { not: parseInt(id) }
                }
            });
            if (existingManual) {
                return res.status(400).json({
                    success: false,
                    isDuplicateWarning: true,
                    message: `Manual reference number '${manualReference}' already exists. Do you want to use this duplicate number?`
                });
            }
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
                    manualReference,
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

        // Propagate updates to linked Invoice if exists
        const invoice = await prisma.invoice.findFirst({
            where: { deliveryChallanId: result.id, companyId: parseInt(companyId) }
        });
        if (invoice) {
            // Find the linked Sales Order
            const salesOrder = await prisma.salesorder.findUnique({
                where: { id: result.salesOrderId },
                include: { salesorderitem: true }
            });
            if (salesOrder) {
                // Map current delivery challan items to invoice items using rates and discounts from sales order items
                const invoiceItems = result.deliverychallanitem.map(item => {
                    const soItem = salesOrder.salesorderitem.find(si => si.productId === item.productId);
                    const rate = soItem ? soItem.rate : 0;
                    const discount = soItem ? soItem.discount : 0;
                    const taxRate = soItem ? soItem.taxRate : 0;
                    const serviceId = soItem ? soItem.serviceId : null;
                    const uomId = soItem ? soItem.uomId : null;

                    return {
                        productId: item.productId,
                        serviceId,
                        uomId,
                        warehouseId: item.warehouseId,
                        description: item.description || (soItem ? soItem.description : ''),
                        quantity: item.quantity,
                        rate,
                        discount,
                        taxRate
                    };
                });

                // Invoke updateInvoice using mock req/res
                const fakeReq = {
                    user: req.user,
                    params: { id: String(invoice.id) },
                    body: {
                        invoiceNumber: invoice.invoiceNumber,
                        date: invoice.date.toISOString().split('T')[0],
                        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : null,
                        customerId: result.customerId,
                        salesOrderId: salesOrder.id,
                        deliveryChallanId: result.id,
                        items: invoiceItems,
                        notes: result.notes || '',
                        overallDiscount: salesOrder.overallDiscount,
                        overallDiscountType: salesOrder.overallDiscountType,
                        billingName: salesOrder.billingName || result.customer?.billingName || result.customer?.name,
                        billingAddress: salesOrder.billingAddress || result.customer?.billingAddress,
                        billingCity: salesOrder.billingCity || result.customer?.billingCity,
                        billingState: salesOrder.billingState || result.customer?.billingState,
                        billingZipCode: salesOrder.billingZipCode || result.customer?.billingZipCode,
                        billingCountry: salesOrder.billingCountry,
                        shippingName: salesOrder.shippingName || result.customer?.shippingName || result.customer?.name,
                        shippingAddress: result.shippingAddress || salesOrder.shippingAddress || result.customer?.shippingAddress || result.customer?.billingAddress,
                        shippingCity: result.shippingCity || salesOrder.shippingCity || result.customer?.shippingCity || result.customer?.billingCity,
                        shippingState: result.shippingState || salesOrder.shippingState || result.customer?.shippingState || result.customer?.billingState,
                        shippingZipCode: result.shippingZipCode || salesOrder.shippingZipCode || result.customer?.shippingZipCode || result.customer?.billingZipCode,
                        shippingCountry: salesOrder.shippingCountry,
                        currency: invoice.currency || 'USD',
                        exchangeRate: invoice.exchangeRate || 1.0,
                        manualStatus: invoice.manualStatus,
                        status: invoice.status,
                        companyId: parseInt(companyId)
                    }
                };

                let responseStatus = 200;
                let responseData = null;
                const fakeRes = {
                    status: function(code) { responseStatus = code; return this; },
                    json: function(data) { responseData = data; return this; }
                };

                const salesInvoiceController = require('./salesInvoiceController');
                await salesInvoiceController.updateInvoice(fakeReq, fakeRes);
            }
        }

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

const convertToInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Fetch delivery challan
        const challan = await prisma.deliverychallan.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                deliverychallanitem: { include: { product: true } },
                salesorder: { include: { salesorderitem: true } },
                customer: true
            }
        });

        if (!challan) {
            return res.status(404).json({ success: false, message: 'Delivery Challan not found' });
        }

        if (challan.status === 'CONVERTED') {
            return res.status(400).json({ success: false, message: 'Delivery Challan has already been converted' });
        }

        // Find linked sales order
        const salesOrder = challan.salesorder;
        if (!salesOrder) {
            return res.status(400).json({ success: false, message: 'No linked Sales Order found for this Delivery Challan' });
        }

        // Generate Invoice Number
        const numbering = await numberingService.getNextNumber(companyId, 'invoice');
        const invoiceNumber = numbering.formattedNumber;

        // Map challan items to invoice items using rates and discounts from sales order items
        const invoiceItems = challan.deliverychallanitem.map(item => {
            // Find corresponding item in sales order matching by productId
            const soItem = salesOrder.salesorderitem.find(si => si.productId === item.productId);
            const rate = soItem ? soItem.rate : 0;
            const discount = soItem ? soItem.discount : 0;
            const taxRate = soItem ? soItem.taxRate : 0;
            const serviceId = soItem ? soItem.serviceId : null;
            const uomId = soItem ? soItem.uomId : null;

            return {
                productId: item.productId,
                serviceId,
                uomId,
                warehouseId: item.warehouseId,
                description: item.description || (soItem ? soItem.description : ''),
                quantity: item.quantity,
                rate,
                discount,
                taxRate
            };
        });

        // Set up the fake request body for createInvoice
        const fakeReq = {
            user: req.user,
            body: {
                invoiceNumber,
                date: new Date().toISOString().split('T')[0],
                dueDate: new Date().toISOString().split('T')[0],
                customerId: challan.customerId,
                salesOrderId: salesOrder.id,
                deliveryChallanId: challan.id,
                items: invoiceItems,
                notes: challan.notes,
                overallDiscount: salesOrder.overallDiscount,
                overallDiscountType: salesOrder.overallDiscountType,
                billingName: salesOrder.billingName || challan.customer?.billingName || challan.customer?.name,
                billingAddress: salesOrder.billingAddress || challan.customer?.billingAddress,
                billingCity: salesOrder.billingCity || challan.customer?.billingCity,
                billingState: salesOrder.billingState || challan.customer?.billingState,
                billingZipCode: salesOrder.billingZipCode || challan.customer?.billingZipCode,
                billingCountry: salesOrder.billingCountry,
                shippingName: salesOrder.shippingName || challan.customer?.shippingName || challan.customer?.name,
                shippingAddress: challan.shippingAddress || salesOrder.shippingAddress || challan.customer?.shippingAddress || challan.customer?.billingAddress,
                shippingCity: challan.shippingCity || salesOrder.shippingCity || challan.customer?.shippingCity || challan.customer?.billingCity,
                shippingState: challan.shippingState || salesOrder.shippingState || challan.customer?.shippingState || challan.customer?.billingState,
                shippingZipCode: challan.shippingZipCode || salesOrder.shippingZipCode || challan.customer?.shippingZipCode || challan.customer?.billingZipCode,
                shippingCountry: salesOrder.shippingCountry,
                currency: 'USD',
                exchangeRate: 1.0,
                manualStatus: false,
                status: 'UNPAID',
                companyId: parseInt(companyId)
            }
        };

        // Create a fake response helper to capture status and json
        let responseStatus = 200;
        let responseData = null;

        const fakeRes = {
            status: function(code) {
                responseStatus = code;
                return this;
            },
            json: function(data) {
                responseData = data;
                return this;
            }
        };

        // Call the createInvoice function inside salesInvoiceController
        const salesInvoiceController = require('./salesInvoiceController');
        await salesInvoiceController.createInvoice(fakeReq, fakeRes);

        // Check if invoice creation was successful
        if ((responseStatus === 200 || responseStatus === 201) && responseData && responseData.success) {
            // Update Delivery Challan Status to CONVERTED
            await prisma.deliverychallan.update({
                where: { id: challan.id },
                data: { status: 'CONVERTED' }
            });

            // Advance numbering
            await numberingService.incrementNumber(companyId, 'invoice', invoiceNumber);

            return res.status(200).json({
                success: true,
                message: 'Delivery Challan converted to Invoice successfully',
                data: responseData.data
            });
        } else {
            return res.status(responseStatus).json(responseData || {
                success: false,
                message: 'Failed to create invoice from delivery challan'
            });
        }

    } catch (error) {
        console.error('Error converting delivery challan to invoice:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting delivery challan to invoice' });
    }
};

const convertMultipleToInvoice = async (req, res) => {
    try {
        const { challanIds } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!challanIds || !Array.isArray(challanIds) || challanIds.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one Delivery Challan ID must be provided' });
        }

        // Fetch all selected delivery challans
        const challans = await prisma.deliverychallan.findMany({
            where: {
                id: { in: challanIds.map(id => parseInt(id)) },
                companyId: parseInt(companyId)
            },
            include: {
                deliverychallanitem: { include: { product: true } },
                salesorder: { include: { salesorderitem: true } },
                customer: true
            }
        });

        if (challans.length === 0) {
            return res.status(404).json({ success: false, message: 'No selected Delivery Challans found' });
        }

        // Check if any is already converted
        const alreadyConverted = challans.filter(c => c.status === 'CONVERTED');
        if (alreadyConverted.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Delivery Challan(s) already converted: ${alreadyConverted.map(c => c.challanNumber).join(', ')}`
            });
        }

        // Group challans by customerId
        const groups = {};
        for (const challan of challans) {
            const custId = challan.customerId;
            if (!groups[custId]) {
                groups[custId] = [];
            }
            groups[custId].push(challan);
        }

        const createdInvoices = [];

        for (const [custId, customerChallans] of Object.entries(groups)) {
            const challanNumbers = customerChallans.map(c => c.challanNumber);
            const firstChallan = customerChallans[0];
            const linkedSalesOrder = firstChallan.salesorder;

            // Consolidate items by productId + warehouseId
            const consolidatedMap = {};
            for (const challan of customerChallans) {
                const salesOrder = challan.salesorder;
                for (const item of challan.deliverychallanitem) {
                    let rate = 0;
                    let discount = 0;
                    let taxRate = 0;
                    let serviceId = null;
                    let uomId = null;
                    let description = item.description || '';

                    if (salesOrder && salesOrder.salesorderitem) {
                        const soItem = salesOrder.salesorderitem.find(si => si.productId === item.productId);
                        if (soItem) {
                            rate = soItem.rate;
                            discount = soItem.discount;
                            taxRate = soItem.taxRate;
                            serviceId = soItem.serviceId;
                            uomId = soItem.uomId;
                            if (!description) description = soItem.description;
                        }
                    }

                    const key = `${item.productId || 'none'}_${item.warehouseId || 'none'}`;
                    if (consolidatedMap[key]) {
                        consolidatedMap[key].quantity += item.quantity;
                    } else {
                        consolidatedMap[key] = {
                            productId: item.productId,
                            serviceId,
                            uomId,
                            warehouseId: item.warehouseId,
                            description,
                            quantity: item.quantity,
                            rate,
                            discount,
                            taxRate
                        };
                    }
                }
            }

            const invoiceItems = Object.values(consolidatedMap);

            // Generate Invoice Number
            const numbering = await numberingService.getNextNumber(companyId, 'invoice');
            const invoiceNumber = numbering.formattedNumber;

            // Set up the fake request body for createInvoice
            const fakeReq = {
                user: req.user,
                body: {
                    invoiceNumber,
                    date: new Date().toISOString().split('T')[0],
                    dueDate: new Date().toISOString().split('T')[0],
                    customerId: parseInt(custId),
                    salesOrderId: linkedSalesOrder ? linkedSalesOrder.id : null,
                    deliveryChallanId: firstChallan.id, // link to the first one for relation mapping
                    items: invoiceItems,
                    notes: `Delivery Challans: ${challanNumbers.join(', ')}${firstChallan.notes ? '\n' + firstChallan.notes : ''}`,
                    overallDiscount: linkedSalesOrder ? linkedSalesOrder.overallDiscount : 0,
                    overallDiscountType: linkedSalesOrder ? linkedSalesOrder.overallDiscountType : 'percentage',
                    billingName: linkedSalesOrder?.billingName || firstChallan.customer?.billingName || firstChallan.customer?.name,
                    billingAddress: linkedSalesOrder?.billingAddress || firstChallan.customer?.billingAddress,
                    billingCity: linkedSalesOrder?.billingCity || firstChallan.customer?.billingCity,
                    billingState: linkedSalesOrder?.billingState || firstChallan.customer?.billingState,
                    billingZipCode: linkedSalesOrder?.billingZipCode || firstChallan.customer?.billingZipCode,
                    billingCountry: linkedSalesOrder?.billingCountry,
                    shippingName: linkedSalesOrder?.shippingName || firstChallan.customer?.shippingName || firstChallan.customer?.name,
                    shippingAddress: firstChallan.shippingAddress || linkedSalesOrder?.shippingAddress || firstChallan.customer?.shippingAddress || firstChallan.customer?.billingAddress,
                    shippingCity: firstChallan.shippingCity || linkedSalesOrder?.shippingCity || firstChallan.customer?.shippingCity || firstChallan.customer?.billingCity,
                    shippingState: firstChallan.shippingState || linkedSalesOrder?.shippingState || firstChallan.customer?.shippingState || firstChallan.customer?.billingState,
                    shippingZipCode: firstChallan.shippingZipCode || linkedSalesOrder?.shippingZipCode || firstChallan.customer?.shippingZipCode || firstChallan.customer?.billingZipCode,
                    shippingCountry: firstChallan.shippingCountry || linkedSalesOrder?.shippingCountry || firstChallan.customer?.shippingCountry || firstChallan.customer?.billingCountry,
                    companyId: parseInt(companyId)
                }
            };

            let responseStatus = 200;
            let responseData = null;
            const fakeRes = {
                status: function(code) { responseStatus = code; return this; },
                json: function(data) { responseData = data; return this; }
            };

            const salesInvoiceController = require('./salesInvoiceController');
            await salesInvoiceController.createInvoice(fakeReq, fakeRes);

            if ((responseStatus === 200 || responseStatus === 201) && responseData && responseData.success) {
                // Update selected Delivery Challans for this customer to CONVERTED
                await prisma.deliverychallan.updateMany({
                    where: { id: { in: customerChallans.map(c => c.id) } },
                    data: { status: 'CONVERTED' }
                });

                // Advance numbering
                await numberingService.incrementNumber(companyId, 'invoice', invoiceNumber);
                createdInvoices.push(responseData.data);
            } else {
                throw new Error(responseData?.message || 'Failed to create invoice for customer ID ' + custId);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Successfully converted selected Delivery Challans to ${createdInvoices.length} Invoice(s)`,
            data: createdInvoices
        });
    } catch (error) {
        console.error('Error converting delivery challans to invoice:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting delivery challans to invoice' });
    }
};

module.exports = {
    createChallan,
    getChallans,
    getChallanById,
    updateChallan,
    deleteChallan,
    convertToInvoice,
    convertMultipleToInvoice
};
