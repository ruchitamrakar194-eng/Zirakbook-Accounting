const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Sales Order
const createOrder = async (req, res) => {
    try {
        const { orderNumber, date, expectedDate, customerId, items, notes, quotationId, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
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
                amount: lineTotal
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
                            amount: i.amount
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
                        service: true
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
        const { orderNumber, date, expectedDate, customerId, items, notes, status, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, overallDiscount, overallDiscountType, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
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
                amount: lineTotal
            };
        });

        await prisma.$transaction(async (tx) => {
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

            return await tx.salesorder.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    orderNumber,
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
                            amount: i.amount
                        }))
                    }
                }
            });
        }, { timeout: 30000 });

        const updated = await prisma.salesorder.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { salesorderitem: true, customer: true }
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

module.exports = {
    createOrder,
    getOrders,
    getOrderById,
    updateOrder,
    deleteOrder
};
