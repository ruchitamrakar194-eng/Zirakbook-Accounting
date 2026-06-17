const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Sales Quotation
const createQuotation = async (req, res) => {
    try {
        const { quotationNumber, date, expiryDate, customerId, items, notes, overallDiscount, overallDiscountType, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!quotationNumber || !customerId || !items || items.length === 0) {
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

        const quotationItems = items.map(item => {
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

            const quotation = await tx.salesquotation.create({
                data: {
                    quotationNumber,
                    date: new Date(date),
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    customer: { connect: { id: parseInt(customerId) } },
                    company: { connect: { id: parseInt(companyId) } },
                    subtotal,
                    discountAmount: totalDiscount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    taxAmount,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    totalAmount: (() => {
                        const baseTotal = (subtotal - totalDiscount) + taxAmount;
                        if (overallDiscountType === 'percentage') {
                            return baseTotal - (baseTotal * (parseFloat(overallDiscount) || 0) / 100);
                        }
                        return baseTotal - (parseFloat(overallDiscount) || 0);
                    })(),
                    notes,
                    salesquotationitem: {
                        create: quotationItems.map(i => ({
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
                    salesquotationitem: true,
                    customer: true
                }
            });

            // Optional Reserve Logic
            if (config.reserveOnQuotation) {
                for (const item of quotationItems) {
                    if (item.productId && item.warehouseId) {
                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: { warehouseId: item.warehouseId, productId: item.productId, reservedQuantity: item.quantity },
                            update: { reservedQuantity: { increment: item.quantity } }
                        });
                    }
                }
            }

            return quotation;
        }, {
            maxWait: 5000,
            timeout: 60000
        });

        await numberingService.incrementNumber(companyId, 'salesquotation', quotationNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Quotation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Quotations
const getQuotations = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const quotations = await prisma.salesquotation.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: { select: { id: true, name: true, email: true, phone: true } },
                salesquotationitem: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.status(200).json({ success: true, data: quotations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Quotation By ID
const getQuotationById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const quotation = await prisma.salesquotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                salesquotationitem: {
                    include: {
                        product: true,
                        service: true
                    }
                },
                customer: true
            }
        });

        if (!quotation) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        res.status(200).json({ success: true, data: quotation });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Quotation
const updateQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const { quotationNumber, date, expiryDate, customerId, items, notes, status, overallDiscount, overallDiscountType, customFields } = req.body;
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

        const existing = await prisma.salesquotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        let subtotal = 0;
        let taxAmount = 0;
        let totalDiscount = 0;

        const quotationItems = items.map(item => {
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
            // Delete old items
            await tx.salesquotationitem.deleteMany({
                where: { quotationId: parseInt(id) }
            });

            // Update Quotation
            return await tx.salesquotation.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    quotationNumber,
                    date: new Date(date),
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    customer: { connect: { id: parseInt(customerId) } },
                    company: { connect: { id: parseInt(companyId) } },
                    subtotal,
                    discountAmount: totalDiscount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    taxAmount,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    totalAmount: (() => {
                        const baseTotal = (subtotal - totalDiscount) + taxAmount;
                        if (overallDiscountType === 'percentage') {
                            return baseTotal - (baseTotal * (parseFloat(overallDiscount) || 0) / 100);
                        }
                        return baseTotal - (parseFloat(overallDiscount) || 0);
                    })(),
                    notes,
                    status,
                    salesquotationitem: {
                        create: quotationItems.map(i => ({
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
        }, {
            maxWait: 5000,
            timeout: 60000
        });

        const updated = await prisma.salesquotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { salesquotationitem: true, customer: true }
        });

        res.status(200).json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Quotation
const deleteQuotation = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.salesquotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        await prisma.salesquotation.delete({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        res.status(200).json({ success: true, message: 'Quotation deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createQuotation,
    getQuotations,
    getQuotationById,
    updateQuotation,
    deleteQuotation
};
