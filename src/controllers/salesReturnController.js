const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Sales Return
const createReturn = async (req, res) => {
    try {
        const { returnNumber, date, customerId, invoiceId, invoiceType, items, reason, manualVoucherNo, customFields } = req.body;
        const companyId = req.user.companyId;

        if (!returnNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        console.log(`[createReturn] Starting return for customer ${customerId}, invoice ${invoiceId}, items:`, items);
        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) },
            include: { ledger: true }
        });

        // Check customer ledger
        if (!customer || !customer.ledgerId) {
            return res.status(400).json({ success: false, message: 'Customer ledger not found. Please ensure customer has a ledger configured.' });
        }

        let totalAmount = 0;
        let returnedSubtotal = 0;
        let returnedDiscount = 0;
        let returnedTax = 0;

        const returnItems = items.map(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            const discount = parseFloat(item.discount) || 0;
            const taxRate = parseFloat(item.taxRate) || 0;
            const taxableAmount = Math.max(0, (qty * rate) - discount);
            const taxAmount = (taxableAmount * taxRate) / 100;
            const amount = taxableAmount + taxAmount;
            
            totalAmount += amount;
            returnedSubtotal += (qty * rate);
            returnedDiscount += discount;
            returnedTax += taxAmount;

            return {
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: qty,
                rate: rate,
                taxRate: taxRate,
                discount: discount,
                amount: amount
            };
        });

        // Check if invoice is POS invoice
        // Frontend sends invoiceType='POS_INVOICE' explicitly; fall back to DB lookup
        let isPosInvoice = invoiceType === 'POS_INVOICE';
        let posInvoice = null;
        if (invoiceId) {
            if (isPosInvoice) {
                posInvoice = await prisma.posinvoice.findFirst({
                    where: { id: parseInt(invoiceId), companyId: parseInt(companyId) }
                });
                if (!posInvoice) isPosInvoice = false; // safety: not found, treat as regular
            } else {
                // Fallback: check if this invoiceId actually belongs to a POS invoice
                posInvoice = await prisma.posinvoice.findFirst({
                    where: { id: parseInt(invoiceId), companyId: parseInt(companyId) }
                });
                if (posInvoice) isPosInvoice = true;
            }
        }
        console.log(`[createReturn] isPosInvoice: ${isPosInvoice}, invoiceId: ${invoiceId}`);

        let customFieldsObj = {};
        if (customFields) {
            try {
                customFieldsObj = typeof customFields === 'string' ? JSON.parse(customFields) : customFields;
            } catch (e) {
                console.error("Error parsing customFields:", e);
            }
        }
        if (isPosInvoice) {
            customFieldsObj.posInvoiceId = posInvoice.id;
        }
        const finalCustomFields = JSON.stringify(customFieldsObj);

        const result = await prisma.$transaction(async (tx) => {
            console.log("[createReturn] tx: Resolving returnLedger...");
            // Helper to resolve ledgers (Auto-create if missing)
            const resolveLedger = async (txOrPrisma, namePattern, type) => {
                let ledger = await txOrPrisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await txOrPrisma.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await txOrPrisma.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(companyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            const returnLedger = await resolveLedger(tx, 'Sales Return', 'EXPENSES') || await resolveLedger(tx, 'Sales Return', 'INCOME');
            if (!returnLedger) throw new Error('Sales Return ledger could not be resolved or created');
            console.log(`[createReturn] tx: Resolved returnLedger: ${returnLedger.id}`);

            // Generate Auto Voucher No (inside transaction for consistency)
            const getAutoVoucherNo = async (companyId) => {
                const count = await tx.transaction.count({
                    where: { companyId: parseInt(companyId), voucherType: 'SALES_RETURN' }
                });
                return `SRT-${String(count + 1).padStart(6, '0')}`;
            };

            const autoVoucherNo = await getAutoVoucherNo(companyId);
            console.log(`[createReturn] tx: Generated autoVoucherNo: ${autoVoucherNo}`);

            // 1. Create Sales Return
            console.log("[createReturn] tx: Creating salesreturn record...");
            const salesReturn = await tx.salesreturn.create({
                data: {
                    returnNumber,
                    manualVoucherNo: manualVoucherNo || null,
                    autoVoucherNo: autoVoucherNo,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                    companyId: parseInt(companyId),
                    totalAmount,
                    reason,
                    status: 'Pending', // Default status
                    customFields: finalCustomFields,
                    salesreturnitem: {
                        create: returnItems
                    }
                }
            });
            console.log(`[createReturn] tx: SalesReturn created with ID: ${salesReturn.id}`);

            // 2. Inventory IN Logic
            console.log("[createReturn] tx: Processing inventory updates...");
            for (const item of returnItems) {
                // Increment Stock
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

                // Log Transaction
                await tx.inventorytransaction.create({
                    data: {
                        type: 'RETURN',
                        productId: item.productId,
                        toWarehouseId: item.warehouseId,
                        quantity: item.quantity,
                        reason: `Sales Return: ${returnNumber}`,
                        companyId: parseInt(companyId),
                        userId: req.user?.userId || null
                    }
                });
            }
            console.log("[createReturn] tx: Inventory updates complete.");

            // 3. Update Invoice Balance if linked
            console.log("[createReturn] tx: Updating invoice/posinvoice balance...");
            if (invoiceId) {
                if (isPosInvoice) {
                    const newBalance = Math.max(0, posInvoice.balanceAmount - totalAmount);
                    await tx.posinvoice.update({
                        where: { id: posInvoice.id },
                        data: {
                            balanceAmount: newBalance,
                            status: newBalance <= 0 ? 'Paid' : (posInvoice.paidAmount > 0 ? 'Partial' : 'Due')
                        }
                    });
                } else {
                    const invoice = await tx.invoice.findUnique({ where: { id: parseInt(invoiceId) } });
                    if (invoice) {
                        const newBalance = Math.max(0, invoice.balanceAmount - totalAmount);

                        await tx.invoice.update({
                            where: { id: invoice.id },
                            data: {
                                balanceAmount: newBalance,
                                status: newBalance <= 0 ? 'PAID' : (invoice.paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
                            }
                        });
                    }
                }
            }
            console.log("[createReturn] tx: Balance updates complete.");

            // 4. Accounting Entry (Main)
            console.log("[createReturn] tx: Resolving tax and discount ledgers...");
            const taxLedger = await resolveLedger(tx, 'Tax', 'LIABILITIES');
            const discountAllowedLedger = await resolveLedger(tx, 'Discount Allowed on Sale', 'EXPENSES');

            console.log("[createReturn] tx: Updating accounting ledger balances...");
            // DR Sales Return (gross portion)
            await tx.ledger.update({
                where: { id: returnLedger.id },
                data: { currentBalance: { increment: returnedSubtotal } }
            });

            // CR Customer (net portion: subtotal + tax - discount)
            await tx.ledger.update({
                where: { id: customer.ledgerId },
                data: { currentBalance: { decrement: totalAmount } }
            });

            // DR Tax Payable (VAT)
            if (returnedTax > 0 && taxLedger) {
                await tx.ledger.update({
                    where: { id: taxLedger.id },
                    data: { currentBalance: { decrement: returnedTax } }
                });
            }

            // CR Discount Allowed on Sale
            if (returnedDiscount > 0 && discountAllowedLedger) {
                await tx.ledger.update({
                    where: { id: discountAllowedLedger.id },
                    data: { currentBalance: { decrement: returnedDiscount } }
                });
            }

            // Entry 1: DR Sales Return, CR Customer (gross portion)
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'SALES_RETURN',
                    voucherNumber: autoVoucherNo,
                    debitLedgerId: returnLedger.id,
                    creditLedgerId: customer.ledgerId,
                    amount: returnedSubtotal,
                    narration: `Sales Return (Revenue portion) from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                    companyId: parseInt(companyId),
                    invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                    posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                }
            });

            // Entry 2 (if tax > 0): DR Tax Payable, CR Customer
            if (returnedTax > 0 && taxLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES_RETURN',
                        voucherNumber: autoVoucherNo,
                        debitLedgerId: taxLedger.id,
                        creditLedgerId: customer.ledgerId,
                        amount: returnedTax,
                        narration: `Sales Return Tax Reversal from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                        companyId: parseInt(companyId),
                        invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                        posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                    }
                });
            }

            // Entry 3 (if discount > 0): DR Customer, CR Discount Allowed on Sale
            if (returnedDiscount > 0 && discountAllowedLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES_RETURN',
                        voucherNumber: autoVoucherNo,
                        debitLedgerId: customer.ledgerId,
                        creditLedgerId: discountAllowedLedger.id,
                        amount: returnedDiscount,
                        narration: `Sales Return Discount Reversal from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                        companyId: parseInt(companyId),
                        invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                        posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                    }
                });
            }
            console.log("[createReturn] tx: Detailed double-entry financial transactions complete.");

            // 5. COGS and Inventory Reversal (DR Inventory, CR COGS)
            let totalReturnCOGS = 0;
            for (const item of returnItems) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                if (product) {
                    const unitCost = product.purchasePrice || product.initialCost || 0;
                    totalReturnCOGS += (unitCost * item.quantity);
                }
            }

            if (totalReturnCOGS > 0) {
                const inventoryLedger = await resolveLedger(tx, 'Inventory Asset', 'ASSETS');
                const purchaseLedger = await resolveLedger(tx, 'Purchases', 'EXPENSES') || await resolveLedger(tx, 'Purchase', 'EXPENSES');
                const cogsLedger = await resolveLedger(tx, 'Cost of Goods Sold', 'EXPENSES') || await resolveLedger(tx, 'COGS', 'EXPENSES');

                const finalDebitLedger = inventoryLedger || purchaseLedger;
                if (finalDebitLedger && cogsLedger) {

                    await tx.transaction.create({
                        data: {
                            date: new Date(date),
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-REV-${autoVoucherNo}`,
                            debitLedgerId: finalDebitLedger.id,
                            creditLedgerId: cogsLedger.id,
                            amount: totalReturnCOGS,
                            narration: `COGS Reversal for Return: ${returnNumber}`,
                            companyId: parseInt(companyId),
                        }
                    });

                    await tx.ledger.update({ where: { id: finalDebitLedger.id }, data: { currentBalance: { increment: totalReturnCOGS } } });
                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { decrement: totalReturnCOGS } } });
                }
            }


            return salesReturn;
        }, { timeout: 90000 });

        await numberingService.incrementNumber(companyId, 'salesreturn', returnNumber);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Sales Return Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Returns
const getReturns = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const returns = await prisma.salesreturn.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: { select: { name: true } },
                invoice: { select: { invoiceNumber: true } },
                salesreturnitem: {
                    include: {
                        product: true,
                        warehouse: { select: { name: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Post-process returns to populate virtual invoice field for POS invoices
        const processedReturns = await Promise.all(returns.map(async (row) => {
            if (!row.invoiceId && row.customFields) {
                try {
                    const parsedCF = typeof row.customFields === 'string'
                        ? JSON.parse(row.customFields)
                        : row.customFields;
                    if (parsedCF && parsedCF.posInvoiceId) {
                        const pos = await prisma.posinvoice.findUnique({
                            where: { id: parseInt(parsedCF.posInvoiceId) },
                            select: { invoiceNumber: true }
                        });
                        if (pos) {
                            return {
                                ...row,
                                invoice: {
                                    invoiceNumber: pos.invoiceNumber
                                }
                            };
                        }
                    }
                } catch (e) {
                    console.error("Error parsing customFields in getReturns:", e);
                }
            }
            return row;
        }));

        res.status(200).json({ success: true, data: processedReturns });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Return By ID
const getReturnById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const salesReturn = await prisma.salesreturn.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                customer: true,
                invoice: { select: { invoiceNumber: true } },
                salesreturnitem: {
                    include: {
                        product: true,
                        warehouse: { select: { name: true } }
                    }
                }
            }
        });

        if (!salesReturn) {
            return res.status(404).json({ success: false, message: 'Sales return not found' });
        }

        // Post-process if POS Invoice is linked
        if (!salesReturn.invoiceId && salesReturn.customFields) {
            try {
                const parsedCF = typeof salesReturn.customFields === 'string'
                    ? JSON.parse(salesReturn.customFields)
                    : salesReturn.customFields;
                if (parsedCF && parsedCF.posInvoiceId) {
                    const pos = await prisma.posinvoice.findUnique({
                        where: { id: parseInt(parsedCF.posInvoiceId) }
                    });
                    if (pos) {
                        salesReturn.invoice = {
                            id: pos.id,
                            invoiceNumber: pos.invoiceNumber,
                            type: 'POS_INVOICE',
                            ...pos
                        };
                    }
                }
            } catch (e) {
                console.error("Error parsing customFields in getReturnById:", e);
            }
        }

        res.status(200).json({ success: true, data: salesReturn });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Sales Return
const updateReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const { returnNumber, date, customerId, invoiceId, items, reason, manualVoucherNo, customFields } = req.body;
        const companyId = req.user.companyId;

        if (!returnNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // Check if return exists
        const existing = await prisma.salesreturn.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { salesreturnitem: true, customer: true }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Sales return not found' });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) },
            include: { ledger: true }
        });

        if (!customer || !customer.ledgerId) {
            return res.status(400).json({ success: false, message: 'Customer ledger not found' });
        }

        let totalAmount = 0;
        let returnedSubtotal = 0;
        let returnedDiscount = 0;
        let returnedTax = 0;

        const returnItems = items.map(item => {
            const qty = parseFloat(item.quantity) || 0;
            const rate = parseFloat(item.rate) || 0;
            const discount = parseFloat(item.discount) || 0;
            const taxRate = parseFloat(item.taxRate) || 0;
            const taxableAmount = Math.max(0, (qty * rate) - discount);
            const taxAmount = (taxableAmount * taxRate) / 100;
            const amount = taxableAmount + taxAmount;
            
            totalAmount += amount;
            returnedSubtotal += (qty * rate);
            returnedDiscount += discount;
            returnedTax += taxAmount;

            return {
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: qty,
                rate: rate,
                taxRate: taxRate,
                discount: discount,
                amount: amount
            };
        });

        // Check if new invoice is POS invoice
        let isPosInvoice = false;
        let posInvoice = null;
        if (invoiceId) {
            posInvoice = await prisma.posinvoice.findFirst({
                where: { id: parseInt(invoiceId), companyId: parseInt(companyId) }
            });
            if (posInvoice) {
                isPosInvoice = true;
            }
        }

        // Parse existing customFields to check for posInvoiceId
        let existingPosInvoiceId = null;
        if (existing.customFields) {
            try {
                const parsedCF = typeof existing.customFields === 'string'
                    ? JSON.parse(existing.customFields)
                    : existing.customFields;
                if (parsedCF && parsedCF.posInvoiceId) {
                    existingPosInvoiceId = parseInt(parsedCF.posInvoiceId);
                }
            } catch (e) {
                console.error("Error parsing existing customFields:", e);
            }
        }

        let customFieldsObj = {};
        if (customFields) {
            try {
                customFieldsObj = typeof customFields === 'string' ? JSON.parse(customFields) : customFields;
            } catch (e) {
                console.error("Error parsing customFields on update:", e);
            }
        }
        if (isPosInvoice) {
            customFieldsObj.posInvoiceId = posInvoice.id;
        } else {
            delete customFieldsObj.posInvoiceId;
        }
        const finalCustomFields = JSON.stringify(customFieldsObj);

        const result = await prisma.$transaction(async (tx) => {
            const resolveLedger = async (txOrPrisma, namePattern, type) => {
                let ledger = await txOrPrisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await txOrPrisma.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await txOrPrisma.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(companyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            const returnLedger = await resolveLedger(tx, 'Sales Return', 'EXPENSES') || await resolveLedger(tx, 'Sales Return', 'INCOME');
            if (!returnLedger) throw new Error('Sales Return ledger could not be resolved or created');

            // 1. Reverse Inventory Logic (Decrement Stock for old items)
            for (const item of existing.salesreturnitem) {
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
            }

            // Delete old inventory transactions
            await tx.inventorytransaction.deleteMany({
                where: {
                    productId: { in: existing.salesreturnitem.map(i => i.productId) },
                    reason: `Sales Return: ${existing.returnNumber}`,
                    companyId: parseInt(companyId)
                }
            });

            // 2. Reverse Invoice Balance update if linked
            if (existingPosInvoiceId) {
                const oldPosInvoice = await tx.posinvoice.findUnique({ where: { id: existingPosInvoiceId } });
                if (oldPosInvoice) {
                    const revBalance = Math.min(oldPosInvoice.totalAmount - oldPosInvoice.paidAmount, oldPosInvoice.balanceAmount + existing.totalAmount);
                    await tx.posinvoice.update({
                        where: { id: oldPosInvoice.id },
                        data: {
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'Paid' : (oldPosInvoice.paidAmount > 0 ? 'Partial' : 'Due')
                        }
                    });
                }
            } else if (existing.invoiceId) {
                const oldInvoice = await tx.invoice.findUnique({ where: { id: existing.invoiceId } });
                if (oldInvoice) {
                    const revBalance = Math.min(oldInvoice.totalAmount - oldInvoice.paidAmount, oldInvoice.balanceAmount + existing.totalAmount);
                    await tx.invoice.update({
                        where: { id: oldInvoice.id },
                        data: {
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'PAID' : (oldInvoice.paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // 3. Reverse Accounting Entries for old return
            console.log("[updateReturn] tx: Reversing accounting entries for old return...");
            const taxLedger = await resolveLedger(tx, 'Tax', 'LIABILITIES');
            const discountAllowedLedger = await resolveLedger(tx, 'Discount Allowed on Sale', 'EXPENSES');

            let oldSubtotal = 0;
            let oldTax = 0;
            let oldDiscount = 0;
            for (const item of existing.salesreturnitem) {
                const qty = item.quantity || 0;
                const rate = item.rate || 0;
                const discount = item.discount || 0;
                const taxRate = item.taxRate || 0;
                const taxable = Math.max(0, (qty * rate) - discount);
                const taxAmt = (taxable * taxRate) / 100;
                
                oldSubtotal += (qty * rate);
                oldDiscount += discount;
                oldTax += taxAmt;
            }

            if (returnLedger) {
                await tx.ledger.update({
                    where: { id: returnLedger.id },
                    data: { currentBalance: { decrement: oldSubtotal } }
                });
            }

            if (existing.customer && existing.customer.ledgerId) {
                await tx.ledger.update({
                    where: { id: existing.customer.ledgerId },
                    data: { currentBalance: { increment: existing.totalAmount } }
                });
            }

            if (oldTax > 0 && taxLedger) {
                await tx.ledger.update({
                    where: { id: taxLedger.id },
                    data: { currentBalance: { increment: oldTax } }
                });
            }

            if (oldDiscount > 0 && discountAllowedLedger) {
                await tx.ledger.update({
                    where: { id: discountAllowedLedger.id },
                    data: { currentBalance: { increment: oldDiscount } }
                });
            }

            // Reverse old COGS Reversal entries if they exist
            const oldCogsRevTrans = await tx.transaction.findFirst({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: `COGS-REV-${existing.autoVoucherNo}`,
                    voucherType: 'JOURNAL'
                }
            });

            if (oldCogsRevTrans) {
                await tx.ledger.update({
                    where: { id: oldCogsRevTrans.debitLedgerId },
                    data: { currentBalance: { decrement: oldCogsRevTrans.amount } }
                });
                await tx.ledger.update({
                    where: { id: oldCogsRevTrans.creditLedgerId },
                    data: { currentBalance: { increment: oldCogsRevTrans.amount } }
                });

                await tx.transaction.delete({
                    where: { id: oldCogsRevTrans.id }
                });
            }

            // Delete old main transactions
            await tx.transaction.deleteMany({
                where: {
                    voucherNumber: existing.autoVoucherNo,
                    voucherType: 'SALES_RETURN',
                    companyId: parseInt(companyId)
                }
            });

            // Delete existing salesreturn items from DB
            await tx.salesreturnitem.deleteMany({
                where: { salesReturnId: parseInt(id) }
            });

            // 4. Update Sales Return Document
            const updated = await tx.salesreturn.update({
                where: { id: parseInt(id) },
                data: {
                    returnNumber,
                    manualVoucherNo: manualVoucherNo || null,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                    totalAmount,
                    reason,
                    customFields: finalCustomFields,
                    salesreturnitem: {
                        create: returnItems
                    }
                },
                include: {
                    customer: true,
                    invoice: true,
                    salesreturnitem: { include: { product: true, warehouse: true } }
                }
            });

            // 5. Apply New Inventory Logic (Increment Stock)
            for (const item of returnItems) {
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

                // Log Transaction
                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(date),
                        type: 'RETURN',
                        productId: item.productId,
                        toWarehouseId: item.warehouseId,
                        quantity: item.quantity,
                        reason: `Sales Return: ${returnNumber}`,
                        companyId: parseInt(companyId),
                        userId: req.user?.userId || null
                    }
                });
            }

            // 6. Apply New Invoice Balance if linked
            if (invoiceId) {
                if (isPosInvoice) {
                    const newBalance = Math.max(0, posInvoice.balanceAmount - totalAmount);
                    await tx.posinvoice.update({
                        where: { id: posInvoice.id },
                        data: {
                            balanceAmount: newBalance,
                            status: newBalance <= 0 ? 'Paid' : (posInvoice.paidAmount > 0 ? 'Partial' : 'Due')
                        }
                    });
                } else {
                    const invoice = await tx.invoice.findUnique({ where: { id: parseInt(invoiceId) } });
                    if (invoice) {
                        const newBalance = Math.max(0, invoice.balanceAmount - totalAmount);

                        await tx.invoice.update({
                            where: { id: invoice.id },
                            data: {
                                balanceAmount: newBalance,
                                status: newBalance <= 0 ? 'PAID' : (invoice.paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
                            }
                        });
                    }
                }
            }

            // 7. Apply New Accounting Entry (Main)
            console.log("[updateReturn] tx: Applying detailed sales return accounting entries...");
            // DR Sales Return (gross portion)
            await tx.ledger.update({
                where: { id: returnLedger.id },
                data: { currentBalance: { increment: returnedSubtotal } }
            });

            // CR Customer (net portion: subtotal + tax - discount)
            await tx.ledger.update({
                where: { id: customer.ledgerId },
                data: { currentBalance: { decrement: totalAmount } }
            });

            // DR Tax Payable (VAT)
            if (returnedTax > 0 && taxLedger) {
                await tx.ledger.update({
                    where: { id: taxLedger.id },
                    data: { currentBalance: { decrement: returnedTax } }
                });
            }

            // CR Discount Allowed on Sale
            if (returnedDiscount > 0 && discountAllowedLedger) {
                await tx.ledger.update({
                    where: { id: discountAllowedLedger.id },
                    data: { currentBalance: { decrement: returnedDiscount } }
                });
            }

            // Entry 1: DR Sales Return, CR Customer (gross portion)
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'SALES_RETURN',
                    voucherNumber: existing.autoVoucherNo,
                    debitLedgerId: returnLedger.id,
                    creditLedgerId: customer.ledgerId,
                    amount: returnedSubtotal,
                    narration: `Sales Return (Revenue portion) from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                    companyId: parseInt(companyId),
                    invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                    posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                }
            });

            // Entry 2 (if tax > 0): DR Tax Payable, CR Customer
            if (returnedTax > 0 && taxLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES_RETURN',
                        voucherNumber: existing.autoVoucherNo,
                        debitLedgerId: taxLedger.id,
                        creditLedgerId: customer.ledgerId,
                        amount: returnedTax,
                        narration: `Sales Return Tax Reversal from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                        companyId: parseInt(companyId),
                        invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                        posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                    }
                });
            }

            // Entry 3 (if discount > 0): DR Customer, CR Discount Allowed on Sale
            if (returnedDiscount > 0 && discountAllowedLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES_RETURN',
                        voucherNumber: existing.autoVoucherNo,
                        debitLedgerId: customer.ledgerId,
                        creditLedgerId: discountAllowedLedger.id,
                        amount: returnedDiscount,
                        narration: `Sales Return Discount Reversal from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                        companyId: parseInt(companyId),
                        invoiceId: isPosInvoice ? null : (invoiceId ? parseInt(invoiceId) : null),
                        posInvoiceId: isPosInvoice ? parseInt(invoiceId) : null
                    }
                });
            }

            // 8. COGS and Inventory Reversal (DR Inventory, CR COGS)
            let totalReturnCOGS = 0;
            for (const item of returnItems) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                if (product) {
                    const unitCost = product.purchasePrice || product.initialCost || 0;
                    totalReturnCOGS += (unitCost * item.quantity);
                }
            }

            if (totalReturnCOGS > 0) {
                const inventoryLedger = await resolveLedger(tx, 'Inventory Asset', 'ASSETS');
                const purchaseLedger = await resolveLedger(tx, 'Purchases', 'EXPENSES') || await resolveLedger(tx, 'Purchase', 'EXPENSES');
                const cogsLedger = await resolveLedger(tx, 'Cost of Goods Sold', 'EXPENSES') || await resolveLedger(tx, 'COGS', 'EXPENSES');

                const finalDebitLedger = inventoryLedger || purchaseLedger;
                if (finalDebitLedger && cogsLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(date),
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-REV-${existing.autoVoucherNo}`,
                            debitLedgerId: finalDebitLedger.id,
                            creditLedgerId: cogsLedger.id,
                            amount: totalReturnCOGS,
                            narration: `COGS Reversal for Return: ${returnNumber}`,
                            companyId: parseInt(companyId),
                        }
                    });

                    await tx.ledger.update({ where: { id: finalDebitLedger.id }, data: { currentBalance: { increment: totalReturnCOGS } } });
                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { decrement: totalReturnCOGS } } });
                }
            }

            return updated;
        }, { timeout: 90000 });

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Sales Return Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Sales Return
const deleteReturn = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const salesReturn = await prisma.salesreturn.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { salesreturnitem: true, customer: true }
        });

        if (!salesReturn) {
            return res.status(404).json({ success: false, message: 'Sales return not found' });
        }

        await prisma.$transaction(async (tx) => {
            // 1. Reverse Inventory Logic (Decrement Stock)
            for (const item of salesReturn.salesreturnitem) {
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

                await tx.inventorytransaction.deleteMany({
                    where: {
                        productId: item.productId,
                        toWarehouseId: item.warehouseId,
                        reason: `Sales Return: ${salesReturn.returnNumber}`,
                        companyId: parseInt(companyId)
                    }
                });
            }

            // 2. Reverse Invoice Balance update if linked
            let existingPosInvoiceId = null;
            if (salesReturn.customFields) {
                try {
                    const parsedCF = typeof salesReturn.customFields === 'string'
                        ? JSON.parse(salesReturn.customFields)
                        : salesReturn.customFields;
                    if (parsedCF && parsedCF.posInvoiceId) {
                        existingPosInvoiceId = parseInt(parsedCF.posInvoiceId);
                    }
                } catch (e) {
                    console.error("Error parsing salesReturn customFields on delete:", e);
                }
            }

            if (existingPosInvoiceId) {
                const invoice = await tx.posinvoice.findUnique({ where: { id: existingPosInvoiceId } });
                if (invoice) {
                    const revBalance = Math.min(invoice.totalAmount - invoice.paidAmount, invoice.balanceAmount + salesReturn.totalAmount);

                    await tx.posinvoice.update({
                        where: { id: invoice.id },
                        data: {
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'Paid' : (invoice.paidAmount > 0 ? 'Partial' : 'Due')
                        }
                    });
                }
            } else if (salesReturn.invoiceId) {
                const invoice = await tx.invoice.findUnique({ where: { id: salesReturn.invoiceId } });
                if (invoice) {
                    const revBalance = Math.min(invoice.totalAmount - invoice.paidAmount, invoice.balanceAmount + salesReturn.totalAmount);

                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'PAID' : (invoice.paidAmount > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // 3. Reverse Accounting Entry
            const resolveLedger = async (txOrPrisma, namePattern, type) => {
                let ledger = await txOrPrisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await txOrPrisma.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await txOrPrisma.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(companyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            const returnLedger = await resolveLedger(tx, 'Sales Return', 'EXPENSES') || await resolveLedger(tx, 'Sales Return', 'INCOME');
            const taxLedger = await resolveLedger(tx, 'Tax', 'LIABILITIES');
            const discountAllowedLedger = await resolveLedger(tx, 'Discount Allowed on Sale', 'EXPENSES');

            let oldSubtotal = 0;
            let oldTax = 0;
            let oldDiscount = 0;
            for (const item of salesReturn.salesreturnitem) {
                const qty = item.quantity || 0;
                const rate = item.rate || 0;
                const discount = item.discount || 0;
                const taxRate = item.taxRate || 0;
                const taxable = Math.max(0, (qty * rate) - discount);
                const taxAmt = (taxable * taxRate) / 100;
                
                oldSubtotal += (qty * rate);
                oldDiscount += discount;
                oldTax += taxAmt;
            }

            if (returnLedger) {
                await tx.ledger.update({
                    where: { id: returnLedger.id },
                    data: { currentBalance: { decrement: oldSubtotal } }
                });
            }

            if (salesReturn.customer && salesReturn.customer.ledgerId) {
                await tx.ledger.update({
                    where: { id: salesReturn.customer.ledgerId },
                    data: { currentBalance: { increment: salesReturn.totalAmount } }
                });
            }

            if (oldTax > 0 && taxLedger) {
                await tx.ledger.update({
                    where: { id: taxLedger.id },
                    data: { currentBalance: { increment: oldTax } }
                });
            }

            if (oldDiscount > 0 && discountAllowedLedger) {
                await tx.ledger.update({
                    where: { id: discountAllowedLedger.id },
                    data: { currentBalance: { increment: oldDiscount } }
                });
            }


            // Reverse COGS Reversal entries if they exist
            const cogsRevTrans = await tx.transaction.findFirst({
                where: {
                    companyId: parseInt(companyId),
                    voucherNumber: `COGS-REV-${salesReturn.autoVoucherNo}`,
                    voucherType: 'JOURNAL'
                }
            });

            if (cogsRevTrans) {
                await tx.ledger.update({
                    where: { id: cogsRevTrans.debitLedgerId },
                    data: { currentBalance: { decrement: cogsRevTrans.amount } }
                });
                await tx.ledger.update({
                    where: { id: cogsRevTrans.creditLedgerId },
                    data: { currentBalance: { increment: cogsRevTrans.amount } }
                });

                await tx.transaction.delete({
                    where: { id: cogsRevTrans.id }
                });
            }

            // 4. Delete Transactions and Sales Return
            await tx.transaction.deleteMany({
                where: {
                    voucherNumber: salesReturn.autoVoucherNo,
                    voucherType: 'SALES_RETURN',
                    companyId: parseInt(companyId)
                }
            });

            await tx.salesreturnitem.deleteMany({
                where: { salesReturnId: parseInt(id) }
            });

            await tx.salesreturn.delete({
                where: { id: parseInt(id) }
            });
        }, {
            timeout: 90000
        });

        res.status(200).json({ success: true, message: 'Sales return deleted successfully' });
    } catch (error) {
        console.error('Sales Return Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteSalesReturnHelper = async (tx, salesReturn, companyId) => {
    // 1. Reverse Inventory Logic (Decrement Stock)
    for (const item of salesReturn.salesreturnitem) {
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

        await tx.inventorytransaction.deleteMany({
            where: {
                productId: item.productId,
                toWarehouseId: item.warehouseId,
                reason: `Sales Return: ${salesReturn.returnNumber}`,
                companyId: parseInt(companyId)
            }
        });
    }

    // 2. Accounting Entry Reversion
    const resolveLedger = async (txOrPrisma, namePattern, type) => {
        let ledger = await txOrPrisma.ledger.findFirst({
            where: { companyId: parseInt(companyId), name: { contains: namePattern } }
        });
        if (!ledger) {
            const group = await txOrPrisma.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
            if (group) {
                ledger = await txOrPrisma.ledger.create({
                    data: {
                        name: namePattern,
                        groupId: group.id,
                        companyId: parseInt(companyId),
                        isControlAccount: true
                    }
                });
            }
        }
        return ledger;
    };

    const returnLedger = await resolveLedger(tx, 'Sales Return', 'EXPENSES') || await resolveLedger(tx, 'Sales Return', 'INCOME');
    const taxLedger = await resolveLedger(tx, 'Tax', 'LIABILITIES');
    const discountAllowedLedger = await resolveLedger(tx, 'Discount Allowed on Sale', 'EXPENSES');

    let oldSubtotal = 0;
    let oldTax = 0;
    let oldDiscount = 0;
    for (const item of salesReturn.salesreturnitem) {
        const qty = item.quantity || 0;
        const rate = item.rate || 0;
        const discount = item.discount || 0;
        const taxRate = item.taxRate || 0;
        const taxable = Math.max(0, (qty * rate) - discount);
        const taxAmt = (taxable * taxRate) / 100;
        
        oldSubtotal += (qty * rate);
        oldDiscount += discount;
        oldTax += taxAmt;
    }

    if (returnLedger) {
        await tx.ledger.update({
            where: { id: returnLedger.id },
            data: { currentBalance: { decrement: oldSubtotal } }
        });
    }

    if (salesReturn.customer && salesReturn.customer.ledgerId) {
        await tx.ledger.update({
            where: { id: salesReturn.customer.ledgerId },
            data: { currentBalance: { increment: salesReturn.totalAmount } }
        });
    }

    if (oldTax > 0 && taxLedger) {
        await tx.ledger.update({
            where: { id: taxLedger.id },
            data: { currentBalance: { increment: oldTax } }
        });
    }

    if (oldDiscount > 0 && discountAllowedLedger) {
        await tx.ledger.update({
            where: { id: discountAllowedLedger.id },
            data: { currentBalance: { increment: oldDiscount } }
        });
    }

    // Reverse COGS Reversal entries
    const cogsRevTrans = await tx.transaction.findFirst({
        where: {
            companyId: parseInt(companyId),
            voucherNumber: `COGS-REV-${salesReturn.autoVoucherNo}`,
            voucherType: 'JOURNAL'
        }
    });

    if (cogsRevTrans) {
        await tx.ledger.update({
            where: { id: cogsRevTrans.debitLedgerId },
            data: { currentBalance: { decrement: cogsRevTrans.amount } }
        });
        await tx.ledger.update({
            where: { id: cogsRevTrans.creditLedgerId },
            data: { currentBalance: { increment: cogsRevTrans.amount } }
        });

        await tx.transaction.delete({
            where: { id: cogsRevTrans.id }
        });
    }

    // Delete Transactions and Sales Return Items/Record
    await tx.transaction.deleteMany({
        where: {
            voucherNumber: salesReturn.autoVoucherNo,
            voucherType: 'SALES_RETURN',
            companyId: parseInt(companyId)
        }
    });

    await tx.salesreturnitem.deleteMany({
        where: { salesReturnId: salesReturn.id }
    });

    await tx.salesreturn.delete({
        where: { id: salesReturn.id }
    });
};

module.exports = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturn,
    deleteReturn,
    deleteSalesReturnHelper
};
