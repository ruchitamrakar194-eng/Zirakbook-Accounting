const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

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

// Create Sales Order
const createOrder = async (req, res) => {
    try {
        const { orderNumber, manualReference, date, expectedDate, customerId, items, notes, terms, quotationId, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, customFields, manualStatus, status, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.salesorder.findFirst({
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

        if (!orderNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) }
        });
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        if (customer.creationDate) {
            const getLocalDateString = (dateObj) => {
                const d = new Date(dateObj);
                if (isNaN(d.getTime())) return null;
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };
            const getFormattedDate = (dateObj) => {
                const d = new Date(dateObj);
                if (isNaN(d.getTime())) return '';
                return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            };

            const txDateStr = getLocalDateString(date);
            const custDateStr = getLocalDateString(customer.creationDate);
            if (txDateStr && custDateStr && txDateStr < custDateStr) {
                return res.status(400).json({
                    success: false,
                    message: `Transaction date (${getFormattedDate(date)}) cannot be before Customer '${customer.name}' creation date (${getFormattedDate(customer.creationDate)})`
                });
            }
        }

        let subtotal = 0;
        let taxAmount = 0;
        let totalDiscount = 0;

        const orderItems = items.map(item => {
            const itemQty = parseFloat(item.quantity) || 0;
            const itemRate = parseFloat(item.rate) || 0;
            const itemDiscount = parseFloat(item.discount) || 0;
            const itemTaxRate = parseFloat(item.taxRate) || 0;

            const lineGross = itemQty * itemRate;
            const lineTaxable = lineGross - itemDiscount;
            const lineTax = (lineTaxable * itemTaxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineGross;
            taxAmount += lineTax;
            totalDiscount += itemDiscount;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                description: item.description,
                quantity: itemQty,
                rate: itemRate,
                discount: itemDiscount,
                taxRate: itemTaxRate,
                amount: lineTotal,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const result = await prisma.$transaction(async (tx) => {
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};

            const baseTotal = (subtotal - totalDiscount) + taxAmount;
            let finalTotal = baseTotal;
            if (overallDiscount && overallDiscountType === 'percentage') {
                finalTotal = baseTotal - (baseTotal * overallDiscount / 100);
            } else if (overallDiscount) {
                finalTotal = baseTotal - overallDiscount;
            }

            const order = await tx.salesorder.create({
                data: {
                    orderNumber,
                    manualReference,
                    date: new Date(date),
                    expectedDate: expectedDate ? new Date(expectedDate) : null,
                    customer: { connect: { id: parseInt(customerId) } },
                    company: { connect: { id: parseInt(companyId) } },
                    salesquotation: quotationId ? { connect: { id: parseInt(quotationId) } } : undefined,
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    totalAmount: finalTotal,
                    notes,
                    terms,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'PENDING',
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    billingName,
                    billingAddress,
                    billingCity,
                    billingState,
                    billingZipCode,
                    billingCountry,
                    shippingName,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingCountry,
                    salesorderitem: {
                        create: orderItems.map(i => ({
                            productId: i.productId,
                            serviceId: i.serviceId,
                            warehouseId: i.warehouseId,
                            description: i.description,
                            quantity: i.quantity,
                            rate: i.rate,
                            discount: i.discount,
                            taxRate: i.taxRate,
                            amount: i.amount,
                            uomId: i.uomId
                        }))
                    }
                },
                include: {
                    salesorderitem: true,
                    customer: true
                }
            });

            // If quotation exists, handle its transition
            if (quotationId) {
                const quotation = await tx.salesquotation.findFirst({
                    where: { id: parseInt(quotationId), companyId: parseInt(companyId) },
                    include: { salesquotationitem: true }
                });

                if (quotation) {
                    // Update status
                    await tx.salesquotation.update({
                        where: { id: quotation.id, companyId: parseInt(companyId) },
                        data: { status: 'ACCEPTED' }
                    });

                    // Clear Quotation Reservations if config was on
                    if (config.reserveOnQuotation) {
                        for (const item of quotation.salesquotationitem) {
                            if (item.productId && item.warehouseId) {
                                await tx.stock.updateMany({
                                    where: { warehouseId: item.warehouseId, productId: item.productId },
                                    data: { reservedQuantity: { decrement: item.quantity } }
                                });
                            }
                        }
                    }
                }
            }

            // Optional Reserve Logic for SO
            if (config.reserveOnSO) {
                for (const item of orderItems) {
                    if (item.productId && item.warehouseId) {
                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: { warehouseId: item.warehouseId, productId: item.productId, reservedQuantity: item.quantity },
                            update: { reservedQuantity: { increment: item.quantity } }
                        });
                    }
                }
            }

            return order;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'salesorder', orderNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Order Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Orders
const getOrders = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const orders = await prisma.salesorder.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: {
                    select: {
                        name: true, email: true, phone: true,
                        billingName: true, billingPhone: true, billingAddress: true, billingCity: true, billingState: true, billingZipCode: true,
                        shippingName: true, shippingPhone: true, shippingAddress: true, shippingCity: true, shippingState: true, shippingZipCode: true
                    }
                },
                salesorderitem: true,
                salesquotation: { select: { quotationNumber: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: orders });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Order By ID
const getOrderById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const order = await prisma.salesorder.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                salesorderitem: {
                    include: {
                        product: true,
                        service: true,
                        uom: true
                    }
                },
                customer: true,
                salesquotation: true
            }
        });

        if (!order) {
            return res.status(404).json({ success: false, message: 'Sales Order not found' });
        }

        res.status(200).json({ success: true, data: order });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Order
const updateOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderNumber, manualReference, date, expectedDate, customerId, items, notes, terms, status, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, customFields, manualStatus, onlyUpdateStatus, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.salesorder.findFirst({
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
            const updated = await prisma.salesorder.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) }
        });
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        if (customer.creationDate) {
            const getLocalDateString = (dateObj) => {
                const d = new Date(dateObj);
                if (isNaN(d.getTime())) return null;
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };
            const getFormattedDate = (dateObj) => {
                const d = new Date(dateObj);
                if (isNaN(d.getTime())) return '';
                return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            };

            const txDateStr = getLocalDateString(date);
            const custDateStr = getLocalDateString(customer.creationDate);
            if (txDateStr && custDateStr && txDateStr < custDateStr) {
                return res.status(400).json({
                    success: false,
                    message: `Transaction date (${getFormattedDate(date)}) cannot be before Customer '${customer.name}' creation date (${getFormattedDate(customer.creationDate)})`
                });
            }
        }

        const existing = await prisma.salesorder.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Sales Order not found' });
        }

        let subtotal = 0;
        let taxAmount = 0;
        let totalDiscount = 0;

        const orderItems = items.map(item => {
            const itemQty = parseFloat(item.quantity) || 0;
            const itemRate = parseFloat(item.rate) || 0;
            const itemDiscount = parseFloat(item.discount) || 0;
            const itemTaxRate = parseFloat(item.taxRate) || 0;

            const lineGross = itemQty * itemRate;
            const lineTaxable = lineGross - itemDiscount;
            const lineTax = (lineTaxable * itemTaxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineGross;
            taxAmount += lineTax;
            totalDiscount += itemDiscount;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                description: item.description,
                quantity: itemQty,
                rate: itemRate,
                discount: itemDiscount,
                taxRate: itemTaxRate,
                amount: lineTotal,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const result = await prisma.$transaction(async (tx) => {
            await tx.salesorderitem.deleteMany({
                where: { orderId: parseInt(id) }
            });

            const baseTotal = (subtotal - totalDiscount) + taxAmount;
            let finalTotal = baseTotal;
            if (overallDiscount && overallDiscountType === 'percentage') {
                finalTotal = baseTotal - (baseTotal * overallDiscount / 100);
            } else if (overallDiscount) {
                finalTotal = baseTotal - overallDiscount;
            }

            const updatedOrder = await tx.salesorder.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    orderNumber,
                    manualReference,
                    date: new Date(date),
                    expectedDate: expectedDate ? new Date(expectedDate) : null,
                    customer: { connect: { id: parseInt(customerId) } },
                    company: { connect: { id: parseInt(companyId) } },
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    totalAmount: finalTotal,
                    notes,
                    terms,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    billingName,
                    billingAddress,
                    billingCity,
                    billingState,
                    billingZipCode,
                    billingCountry,
                    shippingName,
                    shippingAddress,
                    shippingCity,
                    shippingState,
                    shippingZipCode,
                    shippingCountry,
                    salesorderitem: {
                        create: orderItems.map(i => ({
                            productId: i.productId,
                            serviceId: i.serviceId,
                            warehouseId: i.warehouseId,
                            description: i.description,
                            quantity: i.quantity,
                            rate: i.rate,
                            discount: i.discount,
                            taxRate: i.taxRate,
                            amount: i.amount,
                            uomId: i.uomId
                        }))
                    }
                },
                include: { salesorderitem: true }
            });

            // Propagate changes to Delivery Challans if linked
            const challans = await tx.deliverychallan.findMany({
                where: { salesOrderId: updatedOrder.id }
            });
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};
            const action = config.challanAction || 'ISSUE';

            for (const dc of challans) {
                // Revert stock of existing DC items
                const existingDcItems = await tx.deliverychallanitem.findMany({
                    where: { challanId: dc.id }
                });
                for (const item of existingDcItems) {
                    if (item.productId && item.warehouseId) {
                        if (action === 'ISSUE') {
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

                // Delete old inventory transactions for this DC
                await tx.inventorytransaction.deleteMany({
                    where: {
                        companyId: parseInt(companyId),
                        reason: `Challan Issue: ${dc.challanNumber}`
                    }
                });

                // Delete existing items
                await tx.deliverychallanitem.deleteMany({
                    where: { challanId: dc.id }
                });

                // Re-create items matching physical items in the sales order
                const physicalItems = orderItems.filter(i => i.productId);
                await tx.deliverychallanitem.createMany({
                    data: physicalItems.map(i => ({
                        challanId: dc.id,
                        productId: i.productId,
                        warehouseId: i.warehouseId || 1,
                        quantity: i.quantity,
                        description: i.description || ''
                    }))
                });

                // Apply new stock and log transaction
                for (const item of physicalItems) {
                    const wId = item.warehouseId || 1;
                    if (item.productId && wId) {
                        if (action === 'ISSUE') {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: wId, productId: item.productId } },
                                create: {
                                    warehouseId: wId,
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
                                    type: 'SALE',
                                    productId: item.productId,
                                    fromWarehouseId: wId,
                                    quantity: item.quantity,
                                    reason: `Challan Issue: ${dc.challanNumber}`,
                                    companyId: parseInt(companyId),
                                    userId: req.user?.userId || null
                                }
                            });
                        } else if (action === 'RESERVE') {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: wId, productId: item.productId } },
                                create: { warehouseId: wId, productId: item.productId, reservedQuantity: item.quantity },
                                update: { reservedQuantity: { increment: item.quantity } }
                            });
                        }
                    }
                }

                // Update Delivery Challan fields
                await tx.deliverychallan.update({
                    where: { id: dc.id },
                    data: {
                        customer: { connect: { id: parseInt(updatedOrder.customerId) } },
                        shippingAddress: updatedOrder.shippingAddress,
                        shippingCity: updatedOrder.shippingCity,
                        shippingState: updatedOrder.shippingState,
                        shippingZipCode: updatedOrder.shippingZipCode,
                        customFields: updatedOrder.customFields
                    }
                });
            }

            // Recalculate status of updated sales order
            await updateSalesOrderStatus(tx, updatedOrder.id);

            return updatedOrder;
        }, { timeout: 30000 });

        // Cascading Invoice Sync after transaction has completed
        const challans = await prisma.deliverychallan.findMany({
            where: { salesOrderId: result.id }
        });
        for (const dc of challans) {
            const invoice = await prisma.invoice.findFirst({
                where: { deliveryChallanId: dc.id, companyId: parseInt(companyId) }
            });
            if (invoice) {
                const dcItems = await prisma.deliverychallanitem.findMany({
                    where: { challanId: dc.id }
                });
                const invoiceItems = dcItems.map(item => {
                    const soItem = result.salesorderitem.find(si => si.productId === item.productId);
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
                        description: item.description || '',
                        quantity: item.quantity,
                        rate,
                        discount,
                        taxRate
                    };
                });

                const fakeReq = {
                    user: req.user,
                    params: { id: String(invoice.id) },
                    body: {
                        invoiceNumber: invoice.invoiceNumber,
                        date: invoice.date.toISOString().split('T')[0],
                        dueDate: invoice.dueDate ? invoice.dueDate.toISOString().split('T')[0] : null,
                        customerId: dc.customerId,
                        salesOrderId: result.id,
                        deliveryChallanId: dc.id,
                        items: invoiceItems,
                        notes: dc.notes || '',
                        overallDiscount: result.overallDiscount,
                        overallDiscountType: result.overallDiscountType,
                        billingName: result.billingName || dc.customer?.billingName || dc.customer?.name,
                        billingAddress: result.billingAddress || dc.customer?.billingAddress,
                        billingCity: result.billingCity || dc.customer?.billingCity,
                        billingState: result.billingState || dc.customer?.billingState,
                        billingZipCode: result.billingZipCode || dc.customer?.billingZipCode,
                        billingCountry: result.billingCountry,
                        shippingName: result.shippingName || dc.customer?.shippingName || dc.customer?.name,
                        shippingAddress: dc.shippingAddress || result.shippingAddress || dc.customer?.shippingAddress || dc.customer?.billingAddress,
                        shippingCity: dc.shippingCity || result.shippingCity || dc.customer?.shippingCity || dc.customer?.billingCity,
                        shippingState: dc.shippingState || result.shippingState || dc.customer?.shippingState || dc.customer?.billingState,
                        shippingZipCode: dc.shippingZipCode || result.shippingZipCode || dc.customer?.shippingZipCode || dc.customer?.billingZipCode,
                        shippingCountry: result.shippingCountry,
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

        const updated = await prisma.salesorder.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                salesorderitem: {
                    include: {
                        product: true,
                        service: true,
                        uom: true
                    }
                },
                customer: true
            }
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Order
const deleteOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.salesorder.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Sales Order not found' });
        }

        await prisma.salesorder.delete({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        res.status(200).json({ success: true, message: 'Sales Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const convertToDeliveryChallan = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const order = await tx.salesorder.findFirst({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                include: { salesorderitem: true, customer: true }
            });

            if (!order) {
                throw new Error('Sales Order not found');
            }

            if (order.status === 'CONVERTED') {
                throw new Error('Sales Order has already been converted');
            }

            // Filter items to physical products only
            const physicalItems = order.salesorderitem.filter(item => item.productId !== null);
            if (physicalItems.length === 0) {
                throw new Error('This Sales Order contains no physical products to deliver');
            }

            // Generate Delivery Challan number
            const numbering = await numberingService.getNextNumber(companyId, 'deliverychallan');
            const challanNumber = numbering.formattedNumber;

            // Copy items
            const challanItems = physicalItems.map(item => ({
                productId: item.productId,
                warehouseId: item.warehouseId || 1, // fallback to a default warehouse ID if not set
                quantity: item.quantity,
                description: item.description || ''
            }));

            // Create Delivery Challan
            const challan = await tx.deliverychallan.create({
                data: {
                    challanNumber,
                    date: new Date(),
                    customerId: order.customerId,
                    salesOrderId: order.id,
                    companyId: parseInt(companyId),
                    notes: order.notes,
                    status: 'PENDING',
                    shippingAddress: order.shippingAddress || order.customer?.shippingAddress || order.customer?.billingAddress,
                    shippingCity: order.shippingCity || order.customer?.shippingCity || order.customer?.billingCity,
                    shippingState: order.shippingState || order.customer?.shippingState || order.customer?.billingState,
                    shippingZipCode: order.shippingZipCode || order.customer?.shippingZipCode || order.customer?.billingZipCode,
                    shippingPhone: order.customer?.phone,
                    shippingEmail: order.customer?.email,
                    customFields: order.customFields,
                    remarks: order.terms,
                    deliverychallanitem: {
                        create: challanItems
                    }
                }
            });

            // Update Sales Order Status to CONVERTED
            await tx.salesorder.update({
                where: { id: order.id },
                data: { status: 'CONVERTED' }
            });

            // Advance numbering
            await numberingService.incrementNumber(companyId, 'deliverychallan', challanNumber);

            return challan;
        });

        return res.status(200).json({ success: true, message: 'Sales Order converted successfully', data: result });
    } catch (error) {
        console.error('Error converting sales order:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting sales order' });
    }
};

module.exports = {
    createOrder,
    getOrders,
    getOrderById,
    updateOrder,
    deleteOrder,
    convertToDeliveryChallan
};
