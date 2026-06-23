const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Purchase Quotation
const createQuotation = async (req, res) => {
    try {
        const { quotationNumber, manualReference, date, expiryDate, vendorId, items, notes, terms, attachments, overallDiscount, overallDiscountType, customFields } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (!quotationNumber || !vendorId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const vendor = await prisma.vendor.findUnique({
            where: { id: parseInt(vendorId) }
        });
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        if (vendor.creationDate) {
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
            const vendDateStr = getLocalDateString(vendor.creationDate);
            if (txDateStr && vendDateStr && txDateStr < vendDateStr) {
                return res.status(400).json({
                    success: false,
                    message: `Transaction date (${getFormattedDate(date)}) cannot be before Vendor '${vendor.name}' creation date (${getFormattedDate(vendor.creationDate)})`
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
            const itemWarehouseId = item.warehouseId ? parseInt(item.warehouseId) : null;

            const lineGross = itemQty * itemRate;
            const lineTaxable = lineGross - itemDiscount;
            const lineTax = (lineTaxable * itemTaxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineGross;
            taxAmount += lineTax;
            totalDiscount += itemDiscount;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                warehouseId: itemWarehouseId,
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
            const baseTotal = (subtotal - totalDiscount) + taxAmount;
            let finalTotal = baseTotal;
            if (overallDiscount && overallDiscountType === 'percentage') {
                finalTotal = baseTotal - (baseTotal * overallDiscount / 100);
            } else if (overallDiscount) {
                finalTotal = baseTotal - overallDiscount;
            }

            const quotation = await tx.purchasequotation.create({
                data: {
                    quotationNumber,
                    manualReference,
                    date: new Date(date),
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    vendorId: parseInt(vendorId),
                    companyId: parseInt(companyId),
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    totalAmount: finalTotal,
                    notes,
                    terms,
                    attachments,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    purchasequotationitem: {
                        create: quotationItems.map(i => ({
                            productId: i.productId,
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
                    purchasequotationitem: {
                        include: {
                            product: true,
                            warehouse: true,
                            uom: true
                        }
                    },
                    vendor: true
                }
            });

            return quotation;
        }, { timeout: 30000 });

        await numberingService.incrementNumber(companyId, 'purchasequotation', quotationNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Create Purchase Quotation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Purchase Quotations
const getQuotations = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const quotations = await prisma.purchasequotation.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                vendor: { select: { name: true, email: true, phone: true } },
                purchasequotationitem: {
                    include: {
                        product: true,
                        warehouse: true,
                        uom: true
                    }
                },
                purchaseorder: true
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
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const quotation = await prisma.purchasequotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                purchasequotationitem: {
                    include: {
                        product: true,
                        warehouse: true,
                        uom: true
                    }
                },
                vendor: true,
                purchaseorder: true
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
        const { quotationNumber, manualReference, date, expiryDate, vendorId, items, notes, terms, attachments, status, overallDiscount, overallDiscountType, customFields } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const existing = await prisma.purchasequotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        const vendor = await prisma.vendor.findUnique({
            where: { id: parseInt(vendorId) }
        });
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        if (vendor.creationDate) {
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
            const vendDateStr = getLocalDateString(vendor.creationDate);
            if (txDateStr && vendDateStr && txDateStr < vendDateStr) {
                return res.status(400).json({
                    success: false,
                    message: `Transaction date (${getFormattedDate(date)}) cannot be before Vendor '${vendor.name}' creation date (${getFormattedDate(vendor.creationDate)})`
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
            const itemWarehouseId = item.warehouseId ? parseInt(item.warehouseId) : null;

            const lineGross = itemQty * itemRate;
            const lineTaxable = lineGross - itemDiscount;
            const lineTax = (lineTaxable * itemTaxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineGross;
            taxAmount += lineTax;
            totalDiscount += itemDiscount;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                warehouseId: itemWarehouseId,
                description: item.description,
                quantity: itemQty,
                rate: itemRate,
                discount: itemDiscount,
                taxRate: itemTaxRate,
                amount: lineTotal,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        await prisma.$transaction(async (tx) => {
            // Delete old items
            await tx.purchasequotationitem.deleteMany({
                where: { quotationId: parseInt(id) }
            });

            const baseTotal = (subtotal - totalDiscount) + taxAmount;
            let finalTotal = baseTotal;
            if (overallDiscount && overallDiscountType === 'percentage') {
                finalTotal = baseTotal - (baseTotal * overallDiscount / 100);
            } else if (overallDiscount) {
                finalTotal = baseTotal - overallDiscount;
            }

            // Update Quotation
            return await tx.purchasequotation.update({
                where: { id: parseInt(id) },
                data: {
                    quotationNumber,
                    manualReference,
                    date: new Date(date),
                    expiryDate: expiryDate ? new Date(expiryDate) : null,
                    vendorId: parseInt(vendorId),
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    totalAmount: finalTotal,
                    notes,
                    terms,
                    attachments,
                    status,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    purchasequotationitem: {
                        create: quotationItems.map(i => ({
                            productId: i.productId,
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
                }
            });
        }, { timeout: 30000 });

        const updated = await prisma.purchasequotation.findFirst({
            where: { id: parseInt(id) },
            include: {
                purchasequotationitem: {
                    include: {
                        product: true,
                        warehouse: true,
                        uom: true
                    }
                },
                vendor: true
            }
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
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const existing = await prisma.purchasequotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        await prisma.purchasequotation.delete({
            where: { id: parseInt(id) }
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
