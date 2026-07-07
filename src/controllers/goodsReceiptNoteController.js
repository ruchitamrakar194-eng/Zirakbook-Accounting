const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create GRN (Linked to PO)
const createGRN = async (req, res) => {
    try {
        const { grnNumber, date, vendorId, purchaseOrderId, items, notes, customFields, manualStatus, status } = req.body;
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
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : 'Received',
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
                await updatePurchaseOrderStatus(tx, purchaseOrderId);
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

            // 4. Update PO Status
            if (grn.purchaseOrderId) {
                await updatePurchaseOrderStatus(tx, grn.purchaseOrderId);
            }
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
        const { grnNumber, date, vendorId, purchaseOrderId, items, notes, customFields, manualStatus, status, onlyUpdateStatus } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.goodsreceiptnote.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        const existing = await prisma.goodsreceiptnote.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { goodsreceiptnoteitem: true }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'GRN not found' });
        }

        const grnItems = items
            .map(item => ({
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: parseFloat(item.quantity),
                description: item.description || ''
            }))
            .filter(item => !isNaN(item.productId) && !isNaN(item.warehouseId) && item.quantity > 0);

        const result = await prisma.$transaction(async (tx) => {
            // 1. Revert Old Stock
            for (const item of existing.goodsreceiptnoteitem) {
                if (item.productId && item.warehouseId) {
                    await tx.stock.upsert({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        create: {
                            warehouseId: item.warehouseId,
                            productId: item.productId,
                            quantity: -item.quantity,
                            initialQty: 0
                        },
                        update: {
                            quantity: { decrement: item.quantity }
                        }
                    });
                }
            }

            // Delete old associated inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId),
                    reason: `GRN: ${existing.grnNumber}`
                }
            });

            // Delete existing items
            await tx.goodsreceiptnoteitem.deleteMany({
                where: { grnId: parseInt(id) }
            });

            // 2. Apply New Stock & Create Inventory Transactions
            for (const item of grnItems) {
                if (item.productId && item.warehouseId) {
                    // Update Stock (increment because goods are received)
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
            }

            // 3. Update GRN document
            const updated = await tx.goodsreceiptnote.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    grnNumber,
                    date: new Date(date),
                    vendorId: parseInt(vendorId),
                    purchaseOrderId: purchaseOrderId ? parseInt(purchaseOrderId) : null,
                    notes,
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    goodsreceiptnoteitem: {
                        create: grnItems
                    }
                },
                include: { goodsreceiptnoteitem: true }
            });

            // 4. Update PO Status
            if (existing.purchaseOrderId) {
                await updatePurchaseOrderStatus(tx, existing.purchaseOrderId);
            }
            if (purchaseOrderId && parseInt(purchaseOrderId) !== existing.purchaseOrderId) {
                await updatePurchaseOrderStatus(tx, parseInt(purchaseOrderId));
            }

            return updated;
        }, { timeout: 30000 });

        // Propagate updates to linked Purchase Bill if exists
        const bill = await prisma.purchasebill.findFirst({
            where: { grnId: result.id, companyId: parseInt(companyId) }
        });
        if (bill) {
            const purchaseOrder = await prisma.purchaseorder.findUnique({
                where: { id: result.purchaseOrderId },
                include: { purchaseorderitem: true }
            });
            if (purchaseOrder) {
                const billItems = result.goodsreceiptnoteitem.map(item => {
                    const poItem = purchaseOrder.purchaseorderitem.find(pi => pi.productId === item.productId);
                    const rate = poItem ? poItem.rate : 0;
                    const discount = poItem ? poItem.discount : 0;
                    const taxRate = poItem ? poItem.taxRate : 0;
                    const uomId = poItem ? poItem.uomId : null;

                    return {
                        productId: item.productId,
                        uomId,
                        warehouseId: item.warehouseId,
                        description: item.description || (poItem ? poItem.description : ''),
                        quantity: item.quantity,
                        rate,
                        discount,
                        taxRate
                    };
                });

                // Invoke updateBill using mock req/res
                const fakeReq = {
                    user: req.user,
                    params: { id: String(bill.id) },
                    body: {
                        billNumber: bill.billNumber,
                        date: bill.date.toISOString().split('T')[0],
                        dueDate: bill.dueDate ? bill.dueDate.toISOString().split('T')[0] : null,
                        vendorId: result.vendorId,
                        purchaseOrderId: purchaseOrder.id,
                        grnId: result.id,
                        items: billItems,
                        notes: result.notes || '',
                        overallDiscount: purchaseOrder.overallDiscount,
                        overallDiscountType: purchaseOrder.overallDiscountType,
                        billingName: purchaseOrder.billingName || result.vendor?.billingName || result.vendor?.name,
                        billingAddress: purchaseOrder.billingAddress || result.vendor?.billingAddress,
                        billingCity: purchaseOrder.billingCity || result.vendor?.billingCity,
                        billingState: purchaseOrder.billingState || result.vendor?.billingState,
                        billingZipCode: purchaseOrder.billingZipCode || result.vendor?.billingZipCode,
                        billingCountry: purchaseOrder.billingCountry,
                        shippingName: purchaseOrder.shippingName || result.vendor?.shippingName || result.vendor?.name,
                        shippingAddress: purchaseOrder.shippingAddress || result.vendor?.shippingAddress || result.vendor?.billingAddress,
                        shippingCity: purchaseOrder.shippingCity || result.vendor?.shippingCity || result.vendor?.billingCity,
                        shippingState: purchaseOrder.shippingState || result.vendor?.shippingState || result.vendor?.billingState,
                        shippingZipCode: purchaseOrder.shippingZipCode || result.vendor?.shippingZipCode || result.vendor?.billingZipCode,
                        shippingCountry: purchaseOrder.shippingCountry,
                        currency: bill.currency || 'USD',
                        exchangeRate: bill.exchangeRate || 1.0,
                        manualStatus: bill.manualStatus,
                        status: bill.status,
                        companyId: parseInt(companyId)
                    }
                };

                let responseStatus = 200;
                let responseData = null;
                const fakeRes = {
                    status: function(code) { responseStatus = code; return this; },
                    json: function(data) { responseData = data; return this; }
                };

                const purchaseBillController = require('./purchaseBillController');
                await purchaseBillController.updateBill(fakeReq, fakeRes);
            }
        }

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Update GRN Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

async function updatePurchaseOrderStatus(tx, purchaseOrderId) {
    if (!purchaseOrderId) return;
    const poId = parseInt(purchaseOrderId);
    if (isNaN(poId)) return;

    const po = await tx.purchaseorder.findUnique({
        where: { id: poId },
        include: { purchaseorderitem: true }
    });

    if (!po) return;
    if (po.manualStatus === true) return;

    const grns = await tx.goodsreceiptnote.findMany({
        where: { purchaseOrderId: poId },
        include: { goodsreceiptnoteitem: true }
    });

    const deliveredMap = {};
    for (const grn of grns) {
        for (const item of grn.goodsreceiptnoteitem) {
            const pId = item.productId;
            if (pId) {
                deliveredMap[pId] = (deliveredMap[pId] || 0) + item.quantity;
            }
        }
    }

    let allCompleted = true;
    let someDelivered = false;

    for (const poItem of po.purchaseorderitem) {
        const ordered = poItem.quantity || 0;
        const delivered = deliveredMap[poItem.productId] || 0;

        if (delivered < ordered) {
            allCompleted = false;
        }
        if (delivered > 0) {
            someDelivered = true;
        }
    }

    let finalStatus = 'PENDING';
    if (allCompleted && po.purchaseorderitem.length > 0) {
        finalStatus = 'COMPLETED';
    } else if (someDelivered) {
        finalStatus = 'PARTIAL';
    }

    await tx.purchaseorder.update({
        where: { id: poId },
        data: { status: finalStatus }
    });
}


const convertToPurchaseBill = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Fetch Goods Receipt Note
        const grn = await prisma.goodsreceiptnote.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                goodsreceiptnoteitem: { include: { product: true } },
                purchaseorder: { include: { purchaseorderitem: true } },
                vendor: true
            }
        });

        if (!grn) {
            return res.status(404).json({ success: false, message: 'Goods Receipt Note not found' });
        }

        if (grn.status === 'Converted') {
            return res.status(400).json({ success: false, message: 'Goods Receipt Note has already been converted' });
        }

        // Find linked purchase order
        const purchaseOrder = grn.purchaseorder;
        if (!purchaseOrder) {
            return res.status(400).json({ success: false, message: 'No linked Purchase Order found for this Goods Receipt Note' });
        }

        // Generate Bill Number
        const numbering = await numberingService.getNextNumber(companyId, 'purchasebill');
        const billNumber = numbering.formattedNumber;

        // Map grn items to purchase bill items using rates and discounts from purchase order items
        const billItems = grn.goodsreceiptnoteitem.map(item => {
            // Find corresponding item in purchase order matching by productId
            const poItem = purchaseOrder.purchaseorderitem.find(pi => pi.productId === item.productId);
            const rate = poItem ? poItem.rate : 0;
            const discount = poItem ? poItem.discount : 0;
            const taxRate = poItem ? poItem.taxRate : 0;
            const uomId = poItem ? poItem.uomId : null;

            return {
                productId: item.productId,
                uomId,
                warehouseId: item.warehouseId,
                description: item.description || (poItem ? poItem.description : ''),
                quantity: item.quantity,
                rate,
                discount,
                taxRate
            };
        });

        // Set up the fake request body for createBill
        const fakeReq = {
            user: req.user,
            body: {
                billNumber,
                date: new Date().toISOString().split('T')[0],
                dueDate: new Date().toISOString().split('T')[0],
                vendorId: grn.vendorId,
                purchaseOrderId: purchaseOrder.id,
                grnId: grn.id,
                items: billItems,
                notes: grn.notes,
                overallDiscount: purchaseOrder.overallDiscount,
                overallDiscountType: purchaseOrder.overallDiscountType,
                billingName: purchaseOrder.billingName || grn.vendor?.billingName || grn.vendor?.name,
                billingAddress: purchaseOrder.billingAddress || grn.vendor?.billingAddress,
                billingCity: purchaseOrder.billingCity || grn.vendor?.billingCity,
                billingState: purchaseOrder.billingState || grn.vendor?.billingState,
                billingZipCode: purchaseOrder.billingZipCode || grn.vendor?.billingZipCode,
                billingCountry: purchaseOrder.billingCountry,
                shippingName: purchaseOrder.shippingName || grn.vendor?.shippingName || grn.vendor?.name,
                shippingAddress: purchaseOrder.shippingAddress || grn.vendor?.shippingAddress || grn.vendor?.billingAddress,
                shippingCity: purchaseOrder.shippingCity || grn.vendor?.shippingCity || grn.vendor?.billingCity,
                shippingState: purchaseOrder.shippingState || grn.vendor?.shippingState || grn.vendor?.billingState,
                shippingZipCode: purchaseOrder.shippingZipCode || grn.vendor?.shippingZipCode || grn.vendor?.billingZipCode,
                shippingCountry: purchaseOrder.shippingCountry,
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

        // Call the createBill function inside purchaseBillController
        const purchaseBillController = require('./purchaseBillController');
        await purchaseBillController.createBill(fakeReq, fakeRes);

        // Check if bill creation was successful
        if ((responseStatus === 200 || responseStatus === 201) && responseData && responseData.success) {
            // Update Goods Receipt Note Status to Converted
            await prisma.goodsreceiptnote.update({
                where: { id: grn.id },
                data: { status: 'Converted' }
            });

            // Advance numbering
            await numberingService.incrementNumber(companyId, 'purchasebill', billNumber);

            return res.status(200).json({
                success: true,
                message: 'Goods Receipt Note converted to Purchase Bill successfully',
                data: responseData.data
            });
        } else {
            return res.status(responseStatus).json(responseData || {
                success: false,
                message: 'Failed to create purchase bill from goods receipt note'
            });
        }

    } catch (error) {
        console.error('Error converting goods receipt note to purchase bill:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting goods receipt note to purchase bill' });
    }
};

const convertMultipleToPurchaseBill = async (req, res) => {
    try {
        const { grnIds } = req.body;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!grnIds || !Array.isArray(grnIds) || grnIds.length === 0) {
            return res.status(400).json({ success: false, message: 'At least one GRN ID must be provided' });
        }

        // Fetch all selected GRNs
        const grns = await prisma.goodsreceiptnote.findMany({
            where: {
                id: { in: grnIds.map(id => parseInt(id)) },
                companyId: parseInt(companyId)
            },
            include: {
                goodsreceiptnoteitem: { include: { product: true } },
                purchaseorder: { include: { purchaseorderitem: true } },
                vendor: true
            }
        });

        if (grns.length === 0) {
            return res.status(404).json({ success: false, message: 'No selected Goods Receipt Notes found' });
        }

        // Check if any is already converted
        const alreadyConverted = grns.filter(g => g.status === 'Converted');
        if (alreadyConverted.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Goods Receipt Note(s) already converted: ${alreadyConverted.map(g => g.grnNumber).join(', ')}`
            });
        }

        // Group GRNs by vendorId
        const groups = {};
        for (const grn of grns) {
            const vendId = grn.vendorId;
            if (!groups[vendId]) {
                groups[vendId] = [];
            }
            groups[vendId].push(grn);
        }

        const createdBills = [];

        for (const [vendId, vendorGrns] of Object.entries(groups)) {
            const grnNumbers = vendorGrns.map(g => g.grnNumber);
            const firstGRN = vendorGrns[0];
            const linkedPurchaseOrder = firstGRN.purchaseorder;

            // Consolidate items by productId + warehouseId
            const consolidatedMap = {};
            for (const grn of vendorGrns) {
                const purchaseOrder = grn.purchaseorder;
                for (const item of grn.goodsreceiptnoteitem) {
                    let rate = 0;
                    let discount = 0;
                    let taxRate = 0;
                    let uomId = null;
                    let description = item.description || '';

                    if (purchaseOrder && purchaseOrder.purchaseorderitem) {
                        const poItem = purchaseOrder.purchaseorderitem.find(pi => pi.productId === item.productId);
                        if (poItem) {
                            rate = poItem.rate;
                            discount = poItem.discount;
                            taxRate = poItem.taxRate;
                            uomId = poItem.uomId;
                            if (!description) description = poItem.description;
                        }
                    }

                    const key = `${item.productId || 'none'}_${item.warehouseId || 'none'}`;
                    if (consolidatedMap[key]) {
                        consolidatedMap[key].quantity += item.quantity;
                    } else {
                        consolidatedMap[key] = {
                            productId: item.productId,
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

            const billItems = Object.values(consolidatedMap);

            // Generate Purchase Bill Number
            const numbering = await numberingService.getNextNumber(companyId, 'purchasebill');
            const billNumber = numbering.formattedNumber;

            // Set up the fake request body for createBill
            const fakeReq = {
                user: req.user,
                body: {
                    billNumber,
                    date: new Date().toISOString().split('T')[0],
                    dueDate: new Date().toISOString().split('T')[0],
                    vendorId: parseInt(vendId),
                    purchaseOrderId: linkedPurchaseOrder ? linkedPurchaseOrder.id : null,
                    grnId: firstGRN.id, // link to first one for relation mapping
                    items: billItems,
                    notes: `GRNs: ${grnNumbers.join(', ')}${firstGRN.notes ? '\n' + firstGRN.notes : ''}`,
                    overallDiscount: linkedPurchaseOrder ? parseFloat(linkedPurchaseOrder.overallDiscount) : 0,
                    overallDiscountType: linkedPurchaseOrder ? linkedPurchaseOrder.overallDiscountType : 'percentage',
                    companyId: parseInt(companyId)
                }
            };

            let responseStatus = 200;
            let responseData = null;
            const fakeRes = {
                status: function(code) { responseStatus = code; return this; },
                json: function(data) { responseData = data; return this; }
            };

            const purchaseBillController = require('./purchaseBillController');
            await purchaseBillController.createBill(fakeReq, fakeRes);

            if ((responseStatus === 200 || responseStatus === 201) && responseData && responseData.success) {
                // Update selected GRNs for this vendor to Converted
                await prisma.goodsreceiptnote.updateMany({
                    where: { id: { in: vendorGrns.map(g => g.id) } },
                    data: { status: 'Converted' }
                });

                // Advance numbering
                await numberingService.incrementNumber(companyId, 'purchasebill', billNumber);
                createdBills.push(responseData.data);
            } else {
                throw new Error(responseData?.message || 'Failed to create purchase bill for vendor ID ' + vendId);
            }
        }

        return res.status(200).json({
            success: true,
            message: `Successfully converted selected Goods Receipt Notes to ${createdBills.length} Purchase Bill(s)`,
            data: createdBills
        });
    } catch (error) {
        console.error('Error converting goods receipt notes to purchase bill:', error);
        return res.status(500).json({ success: false, message: error.message || 'Error converting goods receipt notes to purchase bill' });
    }
};

module.exports = {
    createGRN,
    getGRNs,
    getGRNById,
    updateGRN,
    deleteGRN,
    convertToPurchaseBill,
    convertMultipleToPurchaseBill
};
