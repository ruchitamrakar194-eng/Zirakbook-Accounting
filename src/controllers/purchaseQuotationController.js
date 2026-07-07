const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Purchase Quotation
const createQuotation = async (req, res) => {
    try {
        const { quotationNumber, manualReference, date, expiryDate, vendorId, items, notes, terms, attachments, overallDiscount, overallDiscountType, customFields, manualStatus, status, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existing = await prisma.purchasequotation.findFirst({
                where: { companyId: parseInt(companyId), manualReference }
            });
            if (existing) {
                return res.status(400).json({
                    success: false,
                    isDuplicateWarning: true,
                    message: `Manual reference number '${manualReference}' already exists. Do you want to use this duplicate number?`
                });
            }
        }

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
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'DRAFT',
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
        const { quotationNumber, manualReference, date, expiryDate, vendorId, items, notes, terms, attachments, status, overallDiscount, overallDiscountType, customFields, manualStatus, onlyUpdateStatus, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.purchasequotation.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const existing = await prisma.purchasequotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Quotation not found' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingDuplicate = await prisma.purchasequotation.findFirst({
                where: {
                    companyId: parseInt(companyId),
                    manualReference,
                    id: { not: parseInt(id) }
                }
            });
            if (existingDuplicate) {
                return res.status(400).json({
                    success: false,
                    isDuplicateWarning: true,
                    message: `Manual reference number '${manualReference}' already exists. Do you want to use this duplicate number?`
                });
            }
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
            const updatedQuotation = await tx.purchasequotation.update({
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
                    manualStatus: manualStatus === true || manualStatus === 'true',
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

            // Propagate changes to Purchase Order if linked
            const purchaseOrder = await tx.purchaseorder.findFirst({
                where: { quotationId: updatedQuotation.id }
            });
            if (purchaseOrder) {
                // Delete existing purchaseorder items
                await tx.purchaseorderitem.deleteMany({
                    where: { orderId: purchaseOrder.id }
                });
                // Re-create items matching quotation items
                await tx.purchaseorderitem.createMany({
                    data: quotationItems.map(i => ({
                        orderId: purchaseOrder.id,
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
                });
                // Update Purchase Order fields
                await tx.purchaseorder.update({
                    where: { id: purchaseOrder.id },
                    data: {
                        vendor: { connect: { id: parseInt(updatedQuotation.vendorId) } },
                        subtotal: updatedQuotation.subtotal,
                        discountAmount: updatedQuotation.discountAmount,
                        taxAmount: updatedQuotation.taxAmount,
                        overallDiscount: updatedQuotation.overallDiscount,
                        overallDiscountType: updatedQuotation.overallDiscountType,
                        totalAmount: updatedQuotation.totalAmount,
                        notes: updatedQuotation.notes,
                        terms: updatedQuotation.terms,
                        billingName: updatedQuotation.billingName,
                        billingAddress: updatedQuotation.billingAddress,
                        billingCity: updatedQuotation.billingCity,
                        billingState: updatedQuotation.billingState,
                        billingZipCode: updatedQuotation.billingZipCode,
                        billingCountry: updatedQuotation.billingCountry,
                        shippingName: updatedQuotation.shippingName,
                        shippingAddress: updatedQuotation.shippingAddress,
                        shippingCity: updatedQuotation.shippingCity,
                        shippingState: updatedQuotation.shippingState,
                        shippingZipCode: updatedQuotation.shippingZipCode,
                        shippingCountry: updatedQuotation.shippingCountry,
                        customFields: updatedQuotation.customFields
                    }
                });
            }

            return updatedQuotation;
        }, { timeout: 30000 });

        // Cascading GRN and Bill updates after transaction completes
        const linkedPO = await prisma.purchaseorder.findFirst({
            where: { quotationId: result.id },
            include: { purchaseorderitem: true }
        });
        if (linkedPO) {
            const grns = await prisma.goodsreceiptnote.findMany({
                where: { purchaseOrderId: linkedPO.id }
            });
            for (const grn of grns) {
                const physicalItems = linkedPO.purchaseorderitem.filter(i => i.productId);
                const grnItems = physicalItems.map(i => ({
                    productId: i.productId,
                    warehouseId: i.warehouseId || 1,
                    quantity: i.quantity,
                    description: i.description || ''
                }));

                const fakeReq = {
                    user: req.user,
                    params: { id: String(grn.id) },
                    body: {
                        grnNumber: grn.grnNumber,
                        date: grn.date.toISOString().split('T')[0],
                        vendorId: linkedPO.vendorId,
                        purchaseOrderId: linkedPO.id,
                        items: grnItems,
                        notes: grn.notes || '',
                        customFields: grn.customFields,
                        manualStatus: grn.manualStatus,
                        status: grn.status,
                        companyId: parseInt(companyId)
                    }
                };

                let responseStatus = 200;
                let responseData = null;
                const fakeRes = {
                    status: function(code) { responseStatus = code; return this; },
                    json: function(data) { responseData = data; return this; }
                };

                const goodsReceiptNoteController = require('./goodsReceiptNoteController');
                await goodsReceiptNoteController.updateGRN(fakeReq, fakeRes);
            }
        }

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

const convertToPurchaseOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const quotation = await tx.purchasequotation.findFirst({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                include: { purchasequotationitem: true, vendor: true }
            });

            if (!quotation) {
                throw new Error('Purchase quotation not found');
            }

            if (quotation.status === 'CONVERTED') {
                throw new Error('Purchase quotation has already been converted');
            }

            const existingPO = await tx.purchaseorder.findFirst({
                where: { quotationId: quotation.id }
            });
            if (existingPO) {
                throw new Error('This quotation has already been converted to a Purchase Order');
            }

            // Generate Purchase Order number
            const numbering = await numberingService.getNextNumber(companyId, 'purchaseorder');
            const orderNumber = numbering.formattedNumber;

            // Copy items
            const orderItems = quotation.purchasequotationitem.map(item => ({
                productId: item.productId,
                warehouseId: item.warehouseId,
                description: item.description,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount,
                taxRate: item.taxRate,
                amount: item.amount,
                uomId: item.uomId
            }));

            // Create Purchase Order
            const purchaseOrder = await tx.purchaseorder.create({
                data: {
                    orderNumber,
                    date: new Date(),
                    vendorId: quotation.vendorId,
                    companyId: parseInt(companyId),
                    quotationId: quotation.id,
                    subtotal: quotation.subtotal,
                    discountAmount: quotation.discountAmount,
                    taxAmount: quotation.taxAmount,
                    totalAmount: quotation.totalAmount,
                    status: 'PENDING',
                    notes: `Quotation No: ${quotation.quotationNumber}${quotation.notes ? '\n' + quotation.notes : ''}`,
                    overallDiscount: quotation.overallDiscount,
                    overallDiscountType: quotation.overallDiscountType,
                    terms: quotation.terms,
                    customFields: quotation.customFields,
                    billingName: quotation.vendor?.billingName || quotation.vendor?.name,
                    billingAddress: quotation.vendor?.billingAddress,
                    billingCity: quotation.vendor?.billingCity,
                    billingState: quotation.vendor?.billingState,
                    billingZipCode: quotation.vendor?.billingZipCode,
                    billingCountry: quotation.vendor?.billingCountry,
                    shippingName: quotation.vendor?.shippingName || quotation.vendor?.name,
                    shippingAddress: quotation.vendor?.shippingAddress || quotation.vendor?.billingAddress,
                    shippingCity: quotation.vendor?.shippingCity || quotation.vendor?.billingCity,
                    shippingState: quotation.vendor?.shippingState || quotation.vendor?.billingState,
                    shippingZipCode: quotation.vendor?.shippingZipCode || quotation.vendor?.billingZipCode,
                    shippingCountry: quotation.vendor?.shippingCountry,
                    purchaseorderitem: {
                        create: orderItems
                    }
                }
            });

            // Update Quotation Status to CONVERTED
            await tx.purchasequotation.update({
                where: { id: quotation.id },
                data: { status: 'CONVERTED' }
            });

            // Advance numbering
            await numberingService.incrementNumber(companyId, 'purchaseorder', orderNumber);

            return purchaseOrder;
        });

        return res.status(200).json({ success: true, message: 'Purchase Quotation converted successfully', data: result });
    } catch (error) {
        console.error('Error converting purchase quotation:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting purchase quotation' });
    }
};

module.exports = {
    createQuotation,
    getQuotations,
    getQuotationById,
    updateQuotation,
    deleteQuotation,
    convertToPurchaseOrder
};
