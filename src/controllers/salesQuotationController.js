const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Sales Quotation
const createQuotation = async (req, res) => {
    try {
        const { quotationNumber, manualReference, date, expiryDate, customerId, items, notes, terms, overallDiscount, overallDiscountType, customFields, manualStatus, status, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.salesquotation.findFirst({
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
                amount: lineTotal,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const result = await prisma.$transaction(async (tx) => {
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            const config = company.inventoryConfig || {};

            const quotation = await tx.salesquotation.create({
                data: {
                    quotationNumber,
                    manualReference,
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
                    terms,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'DRAFT',
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
                            amount: i.amount,
                            uomId: i.uomId
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
                        service: true,
                        uom: true
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
        const { quotationNumber, manualReference, date, expiryDate, customerId, items, notes, terms, status, overallDiscount, overallDiscountType, customFields, manualStatus, onlyUpdateStatus, allowDuplicateManualNo } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (manualReference && !(allowDuplicateManualNo === true || allowDuplicateManualNo === 'true')) {
            const existingManual = await prisma.salesquotation.findFirst({
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
            const updated = await prisma.salesquotation.update({
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
                amount: lineTotal,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const result = await prisma.$transaction(async (tx) => {
            // Delete old items
            await tx.salesquotationitem.deleteMany({
                where: { quotationId: parseInt(id) }
            });

            // Update Quotation
            const updatedQuotation = await tx.salesquotation.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    quotationNumber,
                    manualReference,
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
                    terms,
                    manualStatus: manualStatus === true || manualStatus === 'true',
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
                            amount: i.amount,
                            uomId: i.uomId
                        }))
                    }
                }
            });

            // Propagate changes to Sales Order if linked
            const salesOrder = await tx.salesorder.findFirst({
                where: { quotationId: updatedQuotation.id }
            });
            if (salesOrder) {
                // Delete existing salesorder items
                await tx.salesorderitem.deleteMany({
                    where: { orderId: salesOrder.id }
                });
                // Re-create items matching quotation items
                await tx.salesorderitem.createMany({
                    data: quotationItems.map(i => ({
                        orderId: salesOrder.id,
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
                });
                // Update Sales Order fields
                const updatedSO = await tx.salesorder.update({
                    where: { id: salesOrder.id },
                    data: {
                        customer: { connect: { id: parseInt(updatedQuotation.customerId) } },
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

                // Cascade to Delivery Challans
                const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
                const config = company.inventoryConfig || {};
                const action = config.challanAction || 'ISSUE';

                const challans = await tx.deliverychallan.findMany({
                    where: { salesOrderId: updatedSO.id }
                });
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

                    // Create new items matching the sales quotation
                    const physicalItems = quotationItems.filter(i => i.productId);
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
                            customer: { connect: { id: parseInt(updatedSO.customerId) } },
                            shippingAddress: updatedSO.shippingAddress,
                            shippingCity: updatedSO.shippingCity,
                            shippingState: updatedSO.shippingState,
                            shippingZipCode: updatedSO.shippingZipCode,
                            customFields: updatedSO.customFields
                        }
                    });
                }
            }

            return updatedQuotation;
        }, {
            maxWait: 5000,
            timeout: 60000
        });

        // Cascading Invoice Sync after transaction has completed
        const linkedSO = await prisma.salesorder.findFirst({
            where: { quotationId: result.id },
            include: { salesorderitem: true }
        });
        if (linkedSO) {
            const challans = await prisma.deliverychallan.findMany({
                where: { salesOrderId: linkedSO.id }
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
                        const soItem = linkedSO.salesorderitem.find(si => si.productId === item.productId);
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
                            salesOrderId: linkedSO.id,
                            deliveryChallanId: dc.id,
                            items: invoiceItems,
                            notes: dc.notes || '',
                            overallDiscount: linkedSO.overallDiscount,
                            overallDiscountType: linkedSO.overallDiscountType,
                            billingName: linkedSO.billingName || dc.customer?.billingName || dc.customer?.name,
                            billingAddress: linkedSO.billingAddress || dc.customer?.billingAddress,
                            billingCity: linkedSO.billingCity || dc.customer?.billingCity,
                            billingState: linkedSO.billingState || dc.customer?.billingState,
                            billingZipCode: linkedSO.billingZipCode || dc.customer?.billingZipCode,
                            billingCountry: linkedSO.billingCountry,
                            shippingName: linkedSO.shippingName || dc.customer?.shippingName || dc.customer?.name,
                            shippingAddress: dc.shippingAddress || linkedSO.shippingAddress || dc.customer?.shippingAddress || dc.customer?.billingAddress,
                            shippingCity: dc.shippingCity || linkedSO.shippingCity || dc.customer?.shippingCity || dc.customer?.billingCity,
                            shippingState: dc.shippingState || linkedSO.shippingState || dc.customer?.shippingState || dc.customer?.billingState,
                            shippingZipCode: dc.shippingZipCode || linkedSO.shippingZipCode || dc.customer?.shippingZipCode || dc.customer?.billingZipCode,
                            shippingCountry: linkedSO.shippingCountry,
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
        }

        const updated = await prisma.salesquotation.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                salesquotationitem: {
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

const convertToSalesOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const quotation = await tx.salesquotation.findFirst({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                include: { salesquotationitem: true, customer: true }
            });

            if (!quotation) {
                throw new Error('Sales quotation not found');
            }

            if (quotation.status === 'CONVERTED') {
                throw new Error('Sales quotation has already been converted');
            }

            const existingSO = await tx.salesorder.findFirst({
                where: { quotationId: quotation.id }
            });
            if (existingSO) {
                throw new Error('This quotation has already been converted to a Sales Order');
            }

            // Generate Sales Order number
            const numbering = await numberingService.getNextNumber(companyId, 'salesorder');
            const orderNumber = numbering.formattedNumber;

            // Copy items
            const orderItems = quotation.salesquotationitem.map(item => ({
                productId: item.productId,
                serviceId: item.serviceId,
                warehouseId: item.warehouseId,
                description: item.description,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount,
                taxRate: item.taxRate,
                amount: item.amount,
                uomId: item.uomId
            }));

            // Create Sales Order
            const salesOrder = await tx.salesorder.create({
                data: {
                    orderNumber,
                    date: new Date(),
                    customerId: quotation.customerId,
                    companyId: parseInt(companyId),
                    quotationId: quotation.id,
                    subtotal: quotation.subtotal,
                    discountAmount: quotation.discountAmount,
                    overallDiscount: quotation.overallDiscount,
                    overallDiscountType: quotation.overallDiscountType,
                    taxAmount: quotation.taxAmount,
                    totalAmount: quotation.totalAmount,
                    notes: `Quotation No: ${quotation.quotationNumber}${quotation.notes ? '\n' + quotation.notes : ''}`,
                    terms: quotation.terms,
                    status: 'PENDING',
                    customFields: quotation.customFields,
                    billingName: quotation.billingName || quotation.customer?.billingName || quotation.customer?.name,
                    billingAddress: quotation.billingAddress || quotation.customer?.billingAddress,
                    billingCity: quotation.billingCity || quotation.customer?.billingCity,
                    billingState: quotation.billingState || quotation.customer?.billingState,
                    billingZipCode: quotation.billingZipCode || quotation.customer?.billingZipCode,
                    billingCountry: quotation.customer?.billingCountry,
                    shippingName: quotation.shippingName || quotation.customer?.shippingName || quotation.customer?.name,
                    shippingAddress: quotation.shippingAddress || quotation.customer?.shippingAddress || quotation.customer?.billingAddress,
                    shippingCity: quotation.shippingCity || quotation.customer?.shippingCity || quotation.customer?.billingCity,
                    shippingState: quotation.shippingState || quotation.customer?.shippingState || quotation.customer?.billingState,
                    shippingZipCode: quotation.shippingZipCode || quotation.customer?.shippingZipCode || quotation.customer?.billingZipCode,
                    shippingCountry: quotation.customer?.shippingCountry,
                    salesorderitem: {
                        create: orderItems
                    }
                }
            });

            // Update Quotation Status to CONVERTED
            await tx.salesquotation.update({
                where: { id: quotation.id },
                data: { status: 'CONVERTED' }
            });

            // Advance numbering
            await numberingService.incrementNumber(companyId, 'salesorder', orderNumber);

            return salesOrder;
        });

        return res.status(200).json({ success: true, message: 'Sales Quotation converted successfully', data: result });
    } catch (error) {
        console.error('Error converting sales quotation:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting sales quotation' });
    }
};

module.exports = {
    createQuotation,
    getQuotations,
    getQuotationById,
    updateQuotation,
    deleteQuotation,
    convertToSalesOrder
};
