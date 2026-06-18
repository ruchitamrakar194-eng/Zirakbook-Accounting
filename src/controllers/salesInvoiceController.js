const prisma = require('../config/prisma');
const numberingService = require('../services/numberingService');
const {
    getInventoryConfig,
    consumeStock,
    reverseStockOut
} = require('../services/inventoryValuationService');

// Create Sales Invoice
const createInvoice = async (req, res) => {
    try {
        const { invoiceNumber, date, dueDate, customerId, salesOrderId, deliveryChallanId, items, notes, taxAmount, overallDiscount, overallDiscountType, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, currency, exchangeRate } = req.body;
        // Fallback to req.body.companyId if req.user is missing (custom frontend case)
        const companyId = req.user?.companyId || req.body.companyId;

        const docCurrency = currency || 'USD';
        const docExchangeRate = parseFloat(exchangeRate) || 1.0;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }

        if (!invoiceNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        // Pre-flight: Check if this invoice number / voucher number is already in use
        const existingInvoice = await prisma.invoice.findFirst({
            where: { companyId: parseInt(companyId), invoiceNumber }
        });
        if (existingInvoice) {
            return res.status(400).json({
                success: false,
                message: `Invoice number '${invoiceNumber}' already exists. Please use a unique invoice number.`
            });
        }

        const existingJournal = await prisma.journalentry.findFirst({
            where: { companyId: parseInt(companyId), voucherNumber: invoiceNumber }
        });
        if (existingJournal) {
            return res.status(400).json({
                success: false,
                message: `Voucher number '${invoiceNumber}' is already used by another entry. Please use a unique invoice number.`
            });
        }

        // 1. Get Customer and its Ledger
        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) },
            include: { ledger: true }
        });

        if (!customer) {
            return res.status(400).json({ success: false, message: 'Customer not found' });
        }

        // Date must not be before the customer's account creation date
        if (customer.creationDate && date) {
            const txDate = new Date(date);
            const accountDate = new Date(customer.creationDate);
            txDate.setHours(0, 0, 0, 0);
            accountDate.setHours(0, 0, 0, 0);
            if (txDate < accountDate) {
                return res.status(400).json({
                    success: false,
                    message: `Invoice date (${txDate.toDateString()}) cannot be before the customer's account creation date (${accountDate.toDateString()}).`
                });
            }
        }
        // customer.ledger will be null if the referenced ledger was deleted (orphaned ledgerId)
        // We'll auto-repair this inside the transaction if needed.


        // Ledger resolution happens INSIDE the transaction (see below) to avoid snapshot isolation FK violations


        let subtotal = 0;
        let totalDiscount = 0;
        let lineTaxSum = 0;

        const invoiceItems = items.map(item => {
            const itemQty = parseFloat(item.quantity) || 0;
            const itemRate = parseFloat(item.rate) || 0;
            const itemDiscount = parseFloat(item.discount) || 0;
            const itemTaxRate = parseFloat(item.taxRate) || 0;

            const lineGross = itemQty * itemRate;
            const lineTaxable = lineGross - itemDiscount;
            const lineTax = (lineTaxable * itemTaxRate) / 100;
            const lineTotal = lineTaxable + lineTax;

            subtotal += lineGross;
            totalDiscount += itemDiscount;
            lineTaxSum += lineTax;

            return {
                productId: item.productId ? parseInt(item.productId) : null,
                serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                description: item.description || 'Sales Item',
                quantity: itemQty,
                rate: itemRate,
                discount: itemDiscount,
                amount: lineTotal,
                taxRate: itemTaxRate,
                warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const finalTax = parseFloat(taxAmount) || lineTaxSum;
        const baseTotal = (subtotal - totalDiscount) + finalTax;
        let totalAmount = baseTotal;
        if (overallDiscount && overallDiscountType === 'percentage') {
            totalAmount = baseTotal - (baseTotal * overallDiscount / 100);
        } else if (overallDiscount) {
            totalAmount = baseTotal - overallDiscount;
        }

        const result = await prisma.$transaction(async (tx) => {

            // Resolve Standard Ledgers inside tx to avoid snapshot isolation FK issues
            const resolveLedger = async (namePattern, type) => {
                let ledger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: type } });
                    if (group) {
                        ledger = await tx.ledger.create({
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

            const salesLedger = await resolveLedger('Sales Income', 'INCOME');
            const cogsLedger = await resolveLedger('Cost of Goods Sold', 'EXPENSES');
            const inventoryLedger = await resolveLedger('Inventory Asset', 'ASSETS');
            const taxLedger = await resolveLedger('Tax', 'LIABILITIES');
            const discountAllowedLedger = await resolveLedger('Discount Allowed on Sale', 'EXPENSES');

            if (!salesLedger) throw new Error('Could not resolve or create Sales Income ledger');

            // A. Create Invoice
            const invoice = await tx.invoice.create({
                data: {
                    customFields: req.body.customFields ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : null,
                    invoiceNumber,
                    date: new Date(date),
                    dueDate: dueDate ? new Date(dueDate) : null,
                    customerId: parseInt(customerId),
                    companyId: parseInt(companyId),
                    salesOrderId: salesOrderId ? parseInt(salesOrderId) : null,
                    deliveryChallanId: deliveryChallanId ? parseInt(deliveryChallanId) : null,
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount: finalTax,
                    totalAmount,
                    balanceAmount: totalAmount,
                    currency: docCurrency,
                    exchangeRate: docExchangeRate,
                    notes,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    billingName: req.body.billingName,
                    billingAddress: req.body.billingAddress,
                    billingCity: req.body.billingCity,
                    billingState: req.body.billingState,
                    billingZipCode: billingZipCode,
                    billingCountry: billingCountry,
                    shippingName: shippingName,
                    shippingAddress: shippingAddress,
                    shippingCity: shippingCity,
                    shippingState: shippingState,
                    shippingZipCode: shippingZipCode,
                    shippingCountry: shippingCountry,
                    invoiceitem: {
                        create: invoiceItems.map(i => ({
                            productId: i.productId,
                            serviceId: i.serviceId,
                            description: i.description,
                            quantity: i.quantity,
                            rate: i.rate,
                            discount: i.discount,
                            amount: i.amount,
                            taxRate: i.taxRate,
                            warehouseId: i.warehouseId,
                            uomId: i.uomId
                        }))
                    }
                }
            });

            // Process Advance Adjustments if provided
            let totalAdjustedAmount = 0;
            if (req.body.adjustments && req.body.adjustments.length > 0) {
                for (const adj of req.body.adjustments) {
                    const receipt = await tx.receipt.findUnique({
                        where: { id: parseInt(adj.receiptId) },
                        include: { allocations: true }
                    });
                    if (receipt) {
                        const allocatedSum = receipt.allocations.reduce((sum, a) => sum + a.amount, 0);
                        const availableUnallocated = receipt.amount - allocatedSum;
                        const adjustAmt = Math.min(parseFloat(adj.amount), availableUnallocated);
                        
                        if (adjustAmt > 0) {
                            // Create allocation record
                            await tx.receiptinvoiceallocation.create({
                                data: {
                                    receiptId: receipt.id,
                                    invoiceId: invoice.id,
                                    amount: adjustAmt,
                                    companyId: parseInt(companyId)
                                }
                            });
                            totalAdjustedAmount += adjustAmt;
                        }
                    }
                }
            }

            if (totalAdjustedAmount > 0) {
                const finalPaid = totalAdjustedAmount;
                const finalBalance = totalAmount - finalPaid;
                await tx.invoice.update({
                    where: { id: invoice.id },
                    data: {
                        paidAmount: finalPaid,
                        balanceAmount: finalBalance,
                        status: finalBalance <= 0 ? 'PAID' : 'PARTIAL'
                    }
                });
                invoice.paidAmount = finalPaid;
                invoice.balanceAmount = finalBalance;
                invoice.status = finalBalance <= 0 ? 'PAID' : 'PARTIAL';
            }

            // B. Inventory OUT Logic
            const company = await tx.company.findUnique({ where: { id: parseInt(companyId) } });
            let config = {};
            try {
                config = company?.inventoryConfig
                    ? (typeof company.inventoryConfig === 'string' ? JSON.parse(company.inventoryConfig) : company.inventoryConfig)
                    : {};
            } catch (e) { config = {}; }

            const { convertToBaseQuantity } = require('../services/uomConversionService');

            if (deliveryChallanId) {
                // Invoiced from Challan
                const challan = await tx.deliverychallan.findUnique({
                    where: { id: parseInt(deliveryChallanId) },
                    include: { deliverychallanitem: true }
                });

                if (challan) {
                    await tx.deliverychallan.update({
                        where: { id: challan.id },
                        data: { status: 'DELIVERED' } // Marks as completed
                    });

                    // If Challan only RESERVED, we must ISSUE now
                    if (config.challanAction === 'RESERVE') {
                        for (const item of invoiceItems) {
                            if (item.productId && item.warehouseId) {
                                const prod = await tx.product.findUnique({
                                    where: { id: item.productId },
                                    include: { uom: true }
                                });
                                const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                                const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                                // 1. Clear Challan Reservation
                                await tx.stock.upsert({
                                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                                    create: {
                                        warehouseId: item.warehouseId,
                                        productId: item.productId,
                                        reservedQuantity: -baseQty,
                                        quantity: -baseQty,
                                        initialQty: 0,
                                        minOrderQty: 0
                                    },
                                    update: {
                                        reservedQuantity: { decrement: baseQty },
                                        quantity: { decrement: baseQty }
                                    }
                                });

                                // 2. Log Transaction
                                await tx.inventorytransaction.create({
                                    data: {
                                        type: 'SALE',
                                        productId: item.productId,
                                        fromWarehouseId: item.warehouseId,
                                        quantity: baseQty,
                                        reason: `Invoice from Reserved Challan: ${invoiceNumber}`,
                                        companyId: parseInt(companyId)
                                    }
                                });
                            }
                        }
                    }
                }
            } else if (salesOrderId) {
                // Invoiced from SO (Directly)
                const so = await tx.salesorder.findUnique({
                    where: { id: parseInt(salesOrderId) },
                    include: { salesorderitem: true }
                });

                if (so) {
                    await tx.salesorder.update({
                        where: { id: so.id },
                        data: { status: 'COMPLETED' }
                    });

                    for (const item of invoiceItems) {
                        if (item.productId && item.warehouseId) {
                            const prod = await tx.product.findUnique({
                                where: { id: item.productId },
                                include: { uom: true }
                            });
                            const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                            const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                            // 1. Clear SO Reservation if it was active
                            if (config.reserveOnSO) {
                                await tx.stock.upsert({
                                    where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                                    create: {
                                        warehouseId: item.warehouseId,
                                        productId: item.productId,
                                        reservedQuantity: -baseQty,
                                        quantity: 0,
                                        initialQty: 0,
                                        minOrderQty: 0
                                    },
                                    update: {
                                        reservedQuantity: { decrement: baseQty }
                                    }
                                });
                            }

                            // 2. Decrement Stock
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                                create: {
                                    warehouseId: item.warehouseId,
                                    productId: item.productId,
                                    quantity: -baseQty,
                                    initialQty: 0,
                                    minOrderQty: 0
                                },
                                update: {
                                    quantity: { decrement: baseQty }
                                }
                            });

                            // 3. Log Transaction
                            await tx.inventorytransaction.create({
                                data: {
                                    type: 'SALE',
                                    productId: item.productId,
                                    fromWarehouseId: item.warehouseId,
                                    quantity: baseQty,
                                    reason: `Invoice from SO: ${invoiceNumber}`,
                                    companyId: parseInt(companyId)
                                }
                            });
                        }
                    }
                }
            } else {
                // Direct Invoice
                for (const item of invoiceItems) {
                    if (item.productId && item.warehouseId) {
                        const prod = await tx.product.findUnique({
                            where: { id: item.productId },
                            include: { uom: true }
                        });
                        const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                        const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                        await tx.stock.upsert({
                            where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                            create: {
                                warehouseId: item.warehouseId,
                                productId: item.productId,
                                quantity: -baseQty,
                                initialQty: 0,
                                minOrderQty: 0
                            },
                            update: {
                                quantity: { decrement: baseQty }
                            }
                        });

                        await tx.inventorytransaction.create({
                            data: {
                                type: 'SALE',
                                productId: item.productId,
                                fromWarehouseId: item.warehouseId,
                                companyId: parseInt(companyId),
                                quantity: baseQty,
                                reason: `Direct Invoice: ${invoiceNumber}`
                            }
                        });
                    }
                }
            }

            // C. Accounting Entries (Double Entry)
            const ledgerTotalAmount = totalAmount * docExchangeRate;
            const ledgerSubtotal = subtotal * docExchangeRate;  // Gross before discount
            const ledgerTax = finalTax * docExchangeRate;
            const currentBaseTotal = (subtotal - totalDiscount) + finalTax;
            const overallDiscountAmt = overallDiscountType === 'percentage'
                ? (currentBaseTotal * (parseFloat(overallDiscount) || 0) / 100)
                : (parseFloat(overallDiscount) || 0);
            const ledgerDiscountAmount = (totalDiscount + overallDiscountAmt) * docExchangeRate;

            // Resolve customer's actual ledger ID inside the transaction
            // This self-heals orphaned ledgerId (ledger was deleted but customer still references old ID)
            let customerLedgerId = customer.ledgerId;
            if (customerLedgerId) {
                const existingLedger = await tx.ledger.findUnique({ where: { id: customerLedgerId } });
                if (!existingLedger) {
                    // Ledger was deleted — create a new one and re-link customer
                    const arGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: 'ASSETS' } });
                    if (!arGroup) throw new Error('No ASSETS account group found. Please initialize Chart of Accounts first.');
                    const newLedger = await tx.ledger.create({
                        data: {
                            name: `${customer.name} (Receivable)`,
                            groupId: arGroup.id,
                            companyId: parseInt(companyId),
                            isControlAccount: false
                        }
                    });
                    customerLedgerId = newLedger.id;
                    await tx.customer.update({
                        where: { id: customer.id },
                        data: { ledgerId: customerLedgerId }
                    });
                }
            } else {
                // No ledgerId at all — create one now
                const arGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: 'ASSETS' } });
                if (!arGroup) throw new Error('No ASSETS account group found. Please initialize Chart of Accounts first.');
                const newLedger = await tx.ledger.create({
                    data: {
                        name: `${customer.name} (Receivable)`,
                        groupId: arGroup.id,
                        companyId: parseInt(companyId),
                        isControlAccount: false
                    }
                });
                customerLedgerId = newLedger.id;
                await tx.customer.update({
                    where: { id: customer.id },
                    data: { ledgerId: customerLedgerId }
                });
            }

            // 1. DR Customer (Gross = subtotal + tax), CR Sales Income (gross subtotal)
            //    Then: DR Discount Allowed on Sale, CR Customer (net the discount)
            //    Net Customer Balance = totalAmount = subtotal - discount + tax
            const ledgerGrossCustomer = (subtotal + finalTax) * docExchangeRate; // full gross before discount

            const journal = await tx.journalentry.create({
                data: {
                    voucherNumber: invoiceNumber,
                    date: new Date(date),
                    narration: `Sales Invoice: ${invoiceNumber}`,
                    companyId: parseInt(companyId)
                }
            });

            // Entry 1: DR Customer, CR Sales Income (Revenue portion)
            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'SALES',
                    voucherNumber: invoiceNumber,
                    debitLedgerId: customerLedgerId,
                    creditLedgerId: salesLedger.id,
                    amount: ledgerSubtotal,
                    narration: `Sales to ${customer.name}`,
                    companyId: parseInt(companyId),
                    journalEntryId: journal.id,
                    invoiceId: invoice.id
                }
            });

            // Update Customer Ledger (Asset Increases with Debit - revenue portion)
            await tx.ledger.update({
                where: { id: customerLedgerId },
                data: { currentBalance: { increment: ledgerSubtotal } }
            });

            // Update Sales Ledger (Income Increases with Credit - revenue portion)
            await tx.ledger.update({
                where: { id: salesLedger.id },
                data: { currentBalance: { increment: ledgerSubtotal } }
            });

            // 2. Handle Tax (DR Customer, CR Tax Payable)
            if (finalTax > 0 && taxLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES',
                        voucherNumber: invoiceNumber,
                        debitLedgerId: customerLedgerId,
                        creditLedgerId: taxLedger.id,
                        amount: ledgerTax,
                        narration: `Tax on Sale: ${invoiceNumber}`,
                        companyId: parseInt(companyId),
                        journalEntryId: journal.id,
                        invoiceId: invoice.id
                    }
                });

                // Customer receivable increases by tax amount
                await tx.ledger.update({
                    where: { id: customerLedgerId },
                    data: { currentBalance: { increment: ledgerTax } }
                });

                // Tax Liability increases by tax amount
                await tx.ledger.update({
                    where: { id: taxLedger.id },
                    data: { currentBalance: { increment: ledgerTax } }
                });
            }

            // 3. Handle Discount Allowed on Sale
            //    DR Discount Allowed on Sale (Expense), CR Customer (reduces receivable)
            if (ledgerDiscountAmount > 0 && discountAllowedLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'SALES',
                        voucherNumber: invoiceNumber,
                        debitLedgerId: discountAllowedLedger.id,   // Expense increases with Debit
                        creditLedgerId: customerLedgerId,           // Customer (receivable decreases with Credit)
                        amount: ledgerDiscountAmount,
                        narration: `Discount Allowed on Sale: ${invoiceNumber}`,
                        companyId: parseInt(companyId),
                        journalEntryId: journal.id,
                        invoiceId: invoice.id
                    }
                });

                // Discount Allowed Expense increases (Debit)
                await tx.ledger.update({
                    where: { id: discountAllowedLedger.id },
                    data: { currentBalance: { increment: ledgerDiscountAmount } }
                });

                // Customer receivable decreases (Credit reduces the gross debit)
                await tx.ledger.update({
                    where: { id: customerLedgerId },
                    data: { currentBalance: { decrement: ledgerDiscountAmount } }
                });
            }

            // 3. COGS using Inventory Valuation Method (FIFO or WAC)
            const invConfig = await getInventoryConfig(companyId);
            const valuationMethod = invConfig.valuationMethod || 'WAC';
            const autoCogsEntry = invConfig.autoCogsEntry !== false; // default ON
            const negativeStockAllow = invConfig.negativeStockAllow !== false; // default ON

            let totalCOGS = 0;
            for (const item of invoiceItems) {
                if (item.productId) {
                    // Auto-resolve warehouse if not provided: find first warehouse with stock/batch for this product
                    let resolvedWarehouseId = item.warehouseId;
                    if (!resolvedWarehouseId) {
                        // Try FIFO batch first
                        const firstBatch = await tx.inventory_batch.findFirst({
                            where: { productId: parseInt(item.productId), qtyRemaining: { gt: 0 } },
                            orderBy: { createdAt: 'asc' },
                            select: { warehouseId: true }
                        });
                        if (firstBatch) {
                            resolvedWarehouseId = firstBatch.warehouseId;
                        } else {
                            // Fallback: try stock table
                            const firstStock = await tx.stock.findFirst({
                                where: { productId: parseInt(item.productId), quantity: { gt: 0 } },
                                orderBy: { quantity: 'desc' },
                                select: { warehouseId: true }
                            });
                            if (firstStock) {
                                resolvedWarehouseId = firstStock.warehouseId;
                            }
                        }
                    }

                    const prod = await tx.product.findUnique({
                        where: { id: item.productId },
                        include: { uom: true }
                    });
                    const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                    const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                    if (resolvedWarehouseId) {
                        // Also update stock deduction if original warehouseId was missing
                        if (!item.warehouseId) {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: resolvedWarehouseId, productId: parseInt(item.productId) } },
                                create: {
                                    warehouseId: resolvedWarehouseId,
                                    productId: parseInt(item.productId),
                                    quantity: -baseQty,
                                    initialQty: 0,
                                    minOrderQty: 0
                                },
                                update: {
                                    quantity: { decrement: baseQty }
                                }
                            });
                        }

                        const itemCOGS = await consumeStock(tx, {
                            companyId,
                            productId: item.productId,
                            warehouseId: resolvedWarehouseId,
                            quantity: baseQty,
                            invoiceId: invoice.id,
                            method: valuationMethod,
                            negativeStockAllow
                        });
                        totalCOGS += itemCOGS;
                    } else {
                        // No warehouse at all: still calculate WAC COGS from product averageCost
                        const cost = parseFloat(prod?.averageCost || prod?.purchasePrice || prod?.initialCost || 0);
                        totalCOGS += cost * baseQty;
                    }
                }
            }

            if (autoCogsEntry && totalCOGS > 0 && cogsLedger && inventoryLedger) {
                await tx.transaction.create({
                    data: {
                        date: new Date(date),
                        voucherType: 'JOURNAL',
                        voucherNumber: `COGS-${invoiceNumber}`,
                        debitLedgerId: cogsLedger.id,
                        creditLedgerId: inventoryLedger.id,
                        amount: totalCOGS,
                        narration: `COGS for Invoice: ${invoiceNumber}`,
                        companyId: parseInt(companyId),
                        journalEntryId: journal.id,
                        invoiceId: invoice.id
                    }
                });

                await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { increment: totalCOGS } } });
                await tx.ledger.update({ where: { id: inventoryLedger.id }, data: { currentBalance: { decrement: totalCOGS } } });
            }


            // Update Sales Order status if fully invoiced
            if (salesOrderId) {
                await tx.salesorder.update({
                    where: { id: parseInt(salesOrderId) },
                    data: { status: 'COMPLETED' }
                });
            }

            return invoice;
        }, {
            timeout: 90000 // 90 seconds timeout
        });

        await numberingService.incrementNumber(companyId, 'invoice', invoiceNumber);
        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'Invoice', result.id, `Invoice #${result.invoiceNumber} created for Customer ID ${result.customerId} with amount ${result.totalAmount}`);
        res.status(201).json({ success: true, data: result });
    } catch (error) {
        console.error('Invoice Creation Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Invoices
const getInvoices = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const [invoices, posInvoices] = await Promise.all([
            prisma.invoice.findMany({
                where: { companyId: parseInt(companyId) },
                include: {
                    customer: { select: { id: true, name: true, email: true, ledgerId: true } },
                    invoiceitem: {
                        include: {
                            product: true,
                            service: true,
                            warehouse: true
                        }
                    },
                    salesorder: true,
                    deliverychallan: true,
                    salesreturn: {
                        include: {
                            salesreturnitem: true
                        }
                    },
                    receipt: {
                        include: {
                            cashBankAccount: { select: { id: true, name: true } }
                        }
                    },
                    allocations: {
                        include: {
                            receipt: {
                                include: {
                                    cashBankAccount: { select: { id: true, name: true } }
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            }),
            prisma.posinvoice.findMany({
                where: { companyId: parseInt(companyId) },
                include: {
                    customer: { select: { id: true, name: true, email: true, ledgerId: true } },
                    posinvoiceitem: {
                        include: { product: true, warehouse: true }
                    },
                    transaction: {
                        include: {
                            ledger_transaction_debitLedgerIdToledger: { select: { id: true, name: true } }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            })
        ]);

        // Merge POS invoices into the unified list
        const unifiedInvoices = [
            ...invoices.map(inv => {
                // Map allocations to receipt list to maintain compatibility and show correct allocated amount
                const mappedReceipts = [
                    ...inv.receipt.map(r => ({ ...r })),
                    ...inv.allocations.map(alloc => ({
                        id: alloc.receipt.id,
                        receiptNumber: alloc.receipt.receiptNumber,
                        date: alloc.receipt.date,
                        amount: alloc.amount, // Only the allocated amount
                        paymentMode: alloc.receipt.paymentMode,
                        referenceNumber: alloc.receipt.referenceNumber,
                        cashBankAccount: alloc.receipt.cashBankAccount,
                        notes: alloc.receipt.notes
                    }))
                ];

                const seenIds = new Set();
                const deduplicatedReceipts = [];
                for (const r of mappedReceipts) {
                    if (!seenIds.has(r.id)) {
                        seenIds.add(r.id);
                        deduplicatedReceipts.push(r);
                    }
                }

                return {
                    ...inv,
                    type: 'TAX_INVOICE',
                    receipt: deduplicatedReceipts
                };
            }),
            ...posInvoices.map(pos => {
                const receiptTransactions = pos.transaction?.filter(t => t.voucherType === 'RECEIPT') || [];
                const mappedReceipts = receiptTransactions.map(t => ({
                    id: t.id,
                    receiptNumber: t.voucherNumber || '-',
                    date: t.date,
                    amount: t.amount,
                    cashBankAccount: t.ledger_transaction_debitLedgerIdToledger ? {
                        id: t.ledger_transaction_debitLedgerIdToledger.id,
                        name: t.ledger_transaction_debitLedgerIdToledger.name
                    } : null
                }));

                return {
                    ...pos,
                    type: 'POS_INVOICE',
                    invoiceitem: pos.posinvoiceitem,
                    salesreturn: [],
                    dueDate: pos.date,
                    status: pos.balanceAmount > 0 ? 'PARTIAL' : 'PAID',
                    receipt: mappedReceipts
                };
            })
        ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.status(200).json({ success: true, data: unifiedInvoices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Invoice By ID
const getInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const parsedId = parseInt(id);
        if (isNaN(parsedId)) {
            return res.status(400).json({ success: false, message: 'Invalid Invoice ID format' });
        }

        const invoice = await prisma.invoice.findFirst({
            where: { id: parsedId, companyId: parseInt(companyId) },
            include: {
                invoiceitem: {
                    include: {
                        product: true,
                        service: true,
                        warehouse: true
                    }
                },
                customer: true,
                salesorder: true,
                receipt: {
                    include: {
                        cashBankAccount: true
                    }
                },
                allocations: {
                    include: {
                        receipt: {
                            include: {
                                cashBankAccount: true
                            }
                        }
                    }
                }
            }
        });

        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

        // Map allocations to receipt list to maintain compatibility and show correct allocated amount
        const mappedReceipts = [
            ...invoice.receipt.map(r => ({ ...r })),
            ...invoice.allocations.map(alloc => ({
                id: alloc.receipt.id,
                receiptNumber: alloc.receipt.receiptNumber,
                date: alloc.receipt.date,
                amount: alloc.amount, // Only the allocated amount
                paymentMode: alloc.receipt.paymentMode,
                referenceNumber: alloc.receipt.referenceNumber,
                cashBankAccount: alloc.receipt.cashBankAccount,
                notes: alloc.receipt.notes
            }))
        ];

        const seenIds = new Set();
        const deduplicatedReceipts = [];
        for (const r of mappedReceipts) {
            if (!seenIds.has(r.id)) {
                seenIds.add(r.id);
                deduplicatedReceipts.push(r);
            }
        }

        const mappedInvoice = {
            ...invoice,
            receipt: deduplicatedReceipts
        };

        res.status(200).json({ success: true, data: mappedInvoice });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Invoice
const updateInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const { items, overallDiscount, overallDiscountType, billingName, billingAddress, billingCity, billingState, billingZipCode, billingCountry, shippingName, shippingAddress, shippingCity, shippingState, shippingZipCode, shippingCountry, currency, exchangeRate, ...data } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }

        // 1. Get existing invoice
        const existingInvoice = await prisma.invoice.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: { invoiceitem: true }
        });

        if (!existingInvoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        // 2. Calculate new totals if items are provided
        let subtotal = existingInvoice.subtotal;
        let totalDiscount = existingInvoice.discountAmount;
        let taxAmount = existingInvoice.taxAmount;
        let totalAmount = existingInvoice.totalAmount;

        let invoiceItemsData = undefined;

        if (items) {
            subtotal = 0;
            totalDiscount = 0;
            let lineTaxSum = 0;

            invoiceItemsData = items.map(item => {
                const itemQty = parseFloat(item.quantity) || 0;
                const itemRate = parseFloat(item.rate) || 0;
                const itemDiscount = parseFloat(item.discount) || 0;
                const itemTaxRate = parseFloat(item.taxRate) || 0;

                const lineGross = itemQty * itemRate;
                const lineTaxable = lineGross - itemDiscount;
                const lineTax = (lineTaxable * itemTaxRate) / 100;
                const lineTotal = lineTaxable + lineTax;

                subtotal += lineGross;
                totalDiscount += itemDiscount;
                lineTaxSum += lineTax;

                return {
                    productId: item.productId ? parseInt(item.productId) : null,
                    serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                    description: item.description || 'Sales Item',
                    quantity: itemQty,
                    rate: itemRate,
                    discount: itemDiscount,
                    amount: lineTotal,
                    taxRate: itemTaxRate,
                    warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null
                };
            });

            taxAmount = parseFloat(req.body.taxAmount) || lineTaxSum;
            const baseTotal = (subtotal - totalDiscount) + taxAmount;
            totalAmount = baseTotal;
            if (overallDiscount && overallDiscountType === 'percentage') {
                totalAmount = baseTotal - (baseTotal * overallDiscount / 100);
            } else if (overallDiscount) {
                totalAmount = baseTotal - overallDiscount;
            }
        } else {
            // Recalculate with overall discount if items didn't change but discount did
            const baseTotal = (existingInvoice.subtotal - existingInvoice.discountAmount) + existingInvoice.taxAmount;
            totalAmount = baseTotal;
            const ovDiscount = overallDiscount !== undefined ? overallDiscount : existingInvoice.overallDiscount;
            const ovType = overallDiscountType !== undefined ? overallDiscountType : existingInvoice.overallDiscountType;
            if (ovDiscount && ovType === 'percentage') {
                totalAmount = baseTotal - (baseTotal * ovDiscount / 100);
            } else if (ovDiscount) {
                totalAmount = baseTotal - ovDiscount;
            }
        }

        // 3. Update Invoice in a transaction to handle accounting adjustments
        const result = await prisma.$transaction(async (tx) => {
            // A. Revert old ledger balances
            const oldTransactions = await tx.transaction.findMany({
                where: { invoiceId: parseInt(id) }
            });

            for (const t of oldTransactions) {
                await tx.ledger.update({
                    where: { id: t.debitLedgerId },
                    data: { currentBalance: { decrement: t.amount } }
                });
                await tx.ledger.update({
                    where: { id: t.creditLedgerId },
                    data: { currentBalance: { decrement: t.amount } }
                });
            }

            // B. Revert old stock + FIFO/WAC if items changed
            if (items) {
                // Also reverse old COGS inventory valuation (FIFO batches + WAC)
                await reverseStockOut(tx, {
                    invoiceId: parseInt(id),
                    invoiceItems: existingInvoice.invoiceitem.map(i => ({
                        productId: i.productId,
                        warehouseId: i.warehouseId,
                        quantity: i.quantity
                    }))
                });

                for (const item of existingInvoice.invoiceitem) {
                    if (item.productId) {
                        // Find which warehouse was used (warehouseId may be in item or resolved earlier)
                        const wId = item.warehouseId;
                        if (wId) {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: wId, productId: item.productId } },
                                create: {
                                    warehouseId: wId,
                                    productId: item.productId,
                                    quantity: item.quantity,
                                    initialQty: 0,
                                    minOrderQty: 0
                                },
                                update: {
                                    quantity: { increment: item.quantity }
                                }
                            });
                        }
                    }
                }
            }

            // C. Update Invoice record
            // PRESERVE receipt-linked allocations (these are from Payment Receipts and must not be deleted)
            // Only delete advance-adjustment allocations (where receipt.invoiceId points to a DIFFERENT invoice or null)
            const existingAllocations = await tx.receiptinvoiceallocation.findMany({
                where: { invoiceId: parseInt(id) },
                include: { receipt: true }
            });

            // Split allocations into preserved (receipt payments) vs advance adjustments
            const preservedAllocations = [];
            const advanceAllocations = [];
            for (const alloc of existingAllocations) {
                // If the receipt's primary invoiceId matches this invoice, it's a direct payment receipt - preserve it
                // If the receipt's primary invoiceId is null or different, it could be an advance adjustment
                if (alloc.receipt && alloc.receipt.invoiceId === parseInt(id)) {
                    preservedAllocations.push(alloc);
                } else {
                    advanceAllocations.push(alloc);
                }
            }

            // Delete ONLY the advance allocations, keep the receipt-linked ones
            if (advanceAllocations.length > 0) {
                await tx.receiptinvoiceallocation.deleteMany({
                    where: {
                        id: { in: advanceAllocations.map(a => a.id) }
                    }
                });
            }

            // Sum paidAmount from preserved receipt allocations (cash portion + discount portion)
            let totalPreservedPaid = 0;
            for (const alloc of preservedAllocations) {
                totalPreservedPaid += alloc.amount; // allocation.amount already includes cash + discount
            }

            // Process new adjustments (advance receipts applied to this invoice)
            let totalAdjustedAmount = totalPreservedPaid;
            if (req.body.adjustments && req.body.adjustments.length > 0) {
                for (const adj of req.body.adjustments) {
                    const receipt = await tx.receipt.findUnique({
                        where: { id: parseInt(adj.receiptId) },
                        include: { allocations: true }
                    });
                    if (receipt) {
                        const allocatedSum = receipt.allocations.reduce((sum, a) => sum + a.amount, 0);
                        const availableUnallocated = receipt.amount - allocatedSum;
                        const adjustAmt = Math.min(parseFloat(adj.amount), availableUnallocated);
                        
                        if (adjustAmt > 0) {
                            await tx.receiptinvoiceallocation.create({
                                data: {
                                    receiptId: receipt.id,
                                    invoiceId: parseInt(id),
                                    amount: adjustAmt,
                                    companyId: parseInt(companyId)
                                }
                            });
                            totalAdjustedAmount += adjustAmt;
                        }
                    }
                }
            }

            const updatedInvoice = await tx.invoice.update({
                where: { id: parseInt(id) },
                data: {
                    customFields: req.body.customFields !== undefined ? (typeof req.body.customFields === 'string' ? req.body.customFields : JSON.stringify(req.body.customFields)) : undefined,
                    invoiceNumber: data.invoiceNumber,
                    date: data.date ? new Date(data.date) : undefined,
                    dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
                    customerId: data.customerId ? parseInt(data.customerId) : undefined,
                    notes: data.notes,
                    subtotal,
                    discountAmount: totalDiscount,
                    taxAmount,
                    totalAmount,
                    paidAmount: totalAdjustedAmount,
                    balanceAmount: totalAmount - totalAdjustedAmount,
                    status: (totalAmount - totalAdjustedAmount) <= 0 ? 'PAID' : (totalAdjustedAmount > 0 ? 'PARTIAL' : 'UNPAID'),
                    currency: currency !== undefined ? currency : undefined,
                    exchangeRate: exchangeRate !== undefined ? parseFloat(exchangeRate) : undefined,
                    overallDiscount: parseFloat(overallDiscount) || 0,
                    overallDiscountType: overallDiscountType || 'percentage',
                    billingName: billingName,
                    billingAddress: billingAddress,
                    billingCity: billingCity,
                    billingState: billingState,
                    billingZipCode: billingZipCode,
                    billingCountry: billingCountry,
                    shippingName: shippingName,
                    shippingAddress: shippingAddress,
                    shippingCity: shippingCity,
                    shippingState: shippingState,
                    shippingZipCode: shippingZipCode,
                    shippingCountry: shippingCountry,
                    invoiceitem: items ? {
                        deleteMany: {},
                        create: invoiceItemsData
                    } : undefined
                },
                include: { customer: { include: { ledger: true } } }
            });

            // D. Apply new stock if items changed
            if (items) {
                for (const item of (invoiceItemsData || [])) {
                    if (item.productId) {
                        // Auto-resolve warehouse if not provided
                        let resolvedWId = item.warehouseId;
                        if (!resolvedWId) {
                            const firstBatch = await tx.inventory_batch.findFirst({
                                where: { productId: parseInt(item.productId), qtyRemaining: { gt: 0 } },
                                orderBy: { createdAt: 'asc' },
                                select: { warehouseId: true }
                            });
                            if (firstBatch) {
                                resolvedWId = firstBatch.warehouseId;
                            } else {
                                const firstStock = await tx.stock.findFirst({
                                    where: { productId: parseInt(item.productId), quantity: { gt: 0 } },
                                    orderBy: { quantity: 'desc' },
                                    select: { warehouseId: true }
                                });
                                if (firstStock) resolvedWId = firstStock.warehouseId;
                            }
                        }
                        if (resolvedWId) {
                            await tx.stock.upsert({
                                where: { warehouseId_productId: { warehouseId: resolvedWId, productId: parseInt(item.productId) } },
                                create: {
                                    warehouseId: resolvedWId,
                                    productId: parseInt(item.productId),
                                    quantity: -item.quantity,
                                    initialQty: 0,
                                    minOrderQty: 0
                                },
                                update: {
                                    quantity: { decrement: item.quantity }
                                }
                            });
                        }
                    }
                }
            }

            // E. Update/Create new transactions
            // For simplicity, we delete old and create new
            const oldTxs = await tx.transaction.findMany({ where: { invoiceId: parseInt(id) } });
            const oldJournalIds = oldTxs.map(t => t.journalEntryId).filter(Boolean);

            await tx.transaction.deleteMany({ where: { invoiceId: parseInt(id) } });
            if (oldJournalIds.length > 0) {
                await tx.journalentry.deleteMany({ where: { id: { in: oldJournalIds } } });
            }

            const customer = updatedInvoice.customer;
            // Find Sales Income Ledger (same logic as create)
            let salesLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Sales' }, accountgroup: { type: 'INCOME' } }
            });

            if (customer && customer.ledgerId && salesLedger) {
                const docExchangeRate = updatedInvoice.exchangeRate || 1.0;
                const ledgerSubtotal = subtotal * docExchangeRate;
                const ledgerTaxAmount = (parseFloat(taxAmount) || 0) * docExchangeRate;
                const currentBaseTotal = (subtotal - totalDiscount) + (parseFloat(taxAmount) || 0);
                const currentOverallDiscount = overallDiscount !== undefined ? overallDiscount : existingInvoice.overallDiscount;
                const currentOverallDiscountType = overallDiscountType !== undefined ? overallDiscountType : existingInvoice.overallDiscountType;
                const overallDiscountAmt = currentOverallDiscountType === 'percentage'
                    ? (currentBaseTotal * (parseFloat(currentOverallDiscount) || 0) / 100)
                    : (parseFloat(currentOverallDiscount) || 0);
                const ledgerDiscountAmount = (totalDiscount + overallDiscountAmt) * docExchangeRate;
                // Gross = subtotal + tax (before discount)
                const ledgerGrossCustomer = ledgerSubtotal + ledgerTaxAmount;

                // Create new journal entry for the updated invoice
                const journal = await tx.journalentry.create({
                    data: {
                        voucherNumber: updatedInvoice.invoiceNumber,
                        date: updatedInvoice.date,
                        narration: `Updated Sales Invoice: ${updatedInvoice.invoiceNumber}`,
                        companyId: parseInt(companyId)
                    }
                });

                // Entry 1: DR Customer, CR Sales Income (Revenue portion)
                await tx.transaction.create({
                    data: {
                        date: updatedInvoice.date,
                        voucherType: 'SALES',
                        voucherNumber: updatedInvoice.invoiceNumber,
                        debitLedgerId: customer.ledgerId,
                        creditLedgerId: salesLedger.id,
                        amount: ledgerSubtotal,
                        narration: `Updated Sales to ${customer.name}`,
                        companyId: parseInt(companyId),
                        invoiceId: updatedInvoice.id,
                        journalEntryId: journal.id
                    }
                });

                // Update Customer Ledger (Revenue portion)
                await tx.ledger.update({
                    where: { id: customer.ledgerId },
                    data: { currentBalance: { increment: ledgerSubtotal } }
                });
                // Update Sales Ledger (Revenue portion)
                await tx.ledger.update({
                    where: { id: salesLedger.id },
                    data: { currentBalance: { increment: ledgerSubtotal } }
                });

                // Entry 2: DR Customer, CR Tax (Tax portion)
                if (ledgerTaxAmount > 0) {
                    let taxLedger = await tx.ledger.findFirst({
                        where: { companyId: parseInt(companyId), name: { contains: 'Tax' } }
                    });
                    if (!taxLedger) {
                        const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: 'LIABILITIES' } });
                        if (group) {
                            taxLedger = await tx.ledger.create({
                                data: {
                                    name: 'Tax',
                                    groupId: group.id,
                                    companyId: parseInt(companyId),
                                    isControlAccount: true
                                }
                            });
                        }
                    }
                    if (taxLedger) {
                        await tx.transaction.create({
                            data: {
                                date: updatedInvoice.date,
                                voucherType: 'SALES',
                                voucherNumber: updatedInvoice.invoiceNumber,
                                debitLedgerId: customer.ledgerId,
                                creditLedgerId: taxLedger.id,
                                amount: ledgerTaxAmount,
                                narration: `Tax on Sale: ${updatedInvoice.invoiceNumber}`,
                                companyId: parseInt(companyId),
                                invoiceId: updatedInvoice.id,
                                journalEntryId: journal.id
                            }
                        });
                        await tx.ledger.update({
                            where: { id: customer.ledgerId },
                            data: { currentBalance: { increment: ledgerTaxAmount } }
                        });
                        await tx.ledger.update({
                            where: { id: taxLedger.id },
                            data: { currentBalance: { increment: ledgerTaxAmount } }
                        });
                    }
                }

                // Entry 2: DR Discount Allowed on Sale (Expense), CR Customer (reduces receivable)
                if (ledgerDiscountAmount > 0) {
                    const discountAllowedLedger = await tx.ledger.findFirst({
                        where: { companyId: parseInt(companyId), name: { contains: 'Discount Allowed on Sale' } }
                    });
                    if (discountAllowedLedger) {
                        await tx.transaction.create({
                            data: {
                                date: updatedInvoice.date,
                                voucherType: 'SALES',
                                voucherNumber: updatedInvoice.invoiceNumber,
                                debitLedgerId: discountAllowedLedger.id,
                                creditLedgerId: customer.ledgerId,
                                amount: ledgerDiscountAmount,
                                narration: `Discount Allowed on Sale: ${updatedInvoice.invoiceNumber}`,
                                companyId: parseInt(companyId),
                                invoiceId: updatedInvoice.id,
                                journalEntryId: journal.id
                            }
                        });
                        await tx.ledger.update({
                            where: { id: discountAllowedLedger.id },
                            data: { currentBalance: { increment: ledgerDiscountAmount } }
                        });
                        await tx.ledger.update({
                            where: { id: customer.ledgerId },
                            data: { currentBalance: { decrement: ledgerDiscountAmount } }
                        });
                    }
                }
            }

            // F. Re-post COGS entry (was completely missing from update flow!)
            if (items && invoiceItemsData) {
                const invConfig = await getInventoryConfig(companyId);
                const valuationMethod = invConfig.valuationMethod || 'WAC';
                const autoCogsEntry = invConfig.autoCogsEntry !== false;
                const negativeStockAllow = invConfig.negativeStockAllow !== false;

                // Resolve ledgers
                const cogsLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Cost of Goods Sold' } }
                }) || await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'COGS' } }
                });
                const inventoryLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Inventory Asset' } }
                }) || await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Inventory' } }
                });

                let totalCOGS = 0;
                for (const item of invoiceItemsData) {
                    if (item.productId) {
                        let resolvedWarehouseId = item.warehouseId;
                        if (!resolvedWarehouseId) {
                            const firstBatch = await tx.inventory_batch.findFirst({
                                where: { productId: parseInt(item.productId), qtyRemaining: { gt: 0 } },
                                orderBy: { createdAt: 'asc' },
                                select: { warehouseId: true }
                            });
                            if (firstBatch) {
                                resolvedWarehouseId = firstBatch.warehouseId;
                            } else {
                                const firstStock = await tx.stock.findFirst({
                                    where: { productId: parseInt(item.productId), quantity: { gt: 0 } },
                                    orderBy: { quantity: 'desc' },
                                    select: { warehouseId: true }
                                });
                                if (firstStock) resolvedWarehouseId = firstStock.warehouseId;
                            }
                        }

                        if (resolvedWarehouseId) {
                            const itemCOGS = await consumeStock(tx, {
                                companyId,
                                productId: item.productId,
                                warehouseId: resolvedWarehouseId,
                                quantity: item.quantity,
                                invoiceId: updatedInvoice.id,
                                method: valuationMethod,
                                negativeStockAllow
                            });
                            totalCOGS += itemCOGS;
                        } else {
                            // No warehouse: fallback to product cost
                            const prod = await tx.product.findUnique({
                                where: { id: parseInt(item.productId) },
                                select: { averageCost: true, purchasePrice: true, initialCost: true }
                            });
                            const cost = parseFloat(prod?.averageCost || prod?.purchasePrice || prod?.initialCost || 0);
                            totalCOGS += cost * item.quantity;
                        }
                    }
                }

                if (autoCogsEntry && totalCOGS > 0 && cogsLedger && inventoryLedger) {
                    // Find the journal entry we just created for this invoice
                    const journalForCOGS = await tx.journalentry.findFirst({
                        where: { companyId: parseInt(companyId), voucherNumber: updatedInvoice.invoiceNumber }
                    });

                    await tx.transaction.create({
                        data: {
                            date: updatedInvoice.date,
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-${updatedInvoice.invoiceNumber}`,
                            debitLedgerId: cogsLedger.id,
                            creditLedgerId: inventoryLedger.id,
                            amount: totalCOGS,
                            narration: `COGS for Updated Invoice: ${updatedInvoice.invoiceNumber}`,
                            companyId: parseInt(companyId),
                            invoiceId: updatedInvoice.id,
                            journalEntryId: journalForCOGS?.id || null
                        }
                    });

                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { increment: totalCOGS } } });
                    await tx.ledger.update({ where: { id: inventoryLedger.id }, data: { currentBalance: { decrement: totalCOGS } } });
                }
            }

            return updatedInvoice;
        }, { timeout: 90000 });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Invoice', result.id, `Invoice #${result.invoiceNumber} updated for Customer ID ${result.customerId} with amount ${result.totalAmount}`);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Invoice Update Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Invoice
const deleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        const invoice = await prisma.invoice.findUnique({
            where: { id: parseInt(id) },
            include: { invoiceitem: true, transaction: true }
        });

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        await prisma.$transaction(async (tx) => {
            // Unlink any receipts pointing to this invoice to prevent FK Restrict errors
            await tx.receipt.updateMany({
                where: { invoiceId: invoice.id },
                data: { invoiceId: null }
            });

            // 1. Revert Ledger Balances
            for (const t of invoice.transaction) {
                await tx.ledger.update({
                    where: { id: t.debitLedgerId },
                    data: { currentBalance: { decrement: t.amount } }
                });
                await tx.ledger.update({
                    where: { id: t.creditLedgerId },
                    data: { currentBalance: { decrement: t.amount } }
                });
            }

            // 2. Revert Stock & Valuation Layers
            const { convertToBaseQuantity } = require('../services/uomConversionService');
            const baseItemsForReversal = [];

            for (const item of invoice.invoiceitem) {
                if (item.productId && item.warehouseId) {
                    const prod = await tx.product.findUnique({
                        where: { id: item.productId },
                        include: { uom: true }
                    });
                    const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                    const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                    baseItemsForReversal.push({
                        productId: item.productId,
                        warehouseId: item.warehouseId,
                        quantity: baseQty
                    });

                    await tx.stock.upsert({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        create: {
                            warehouseId: item.warehouseId,
                            productId: item.productId,
                            quantity: baseQty,
                            initialQty: 0,
                            minOrderQty: 0
                        },
                        update: {
                            quantity: { increment: baseQty }
                        }
                    });

                    // Log inventory return
                    await tx.inventorytransaction.create({
                        data: {
                            type: 'RETURN',
                            productId: item.productId,
                            toWarehouseId: item.warehouseId,
                            quantity: baseQty,
                            reason: `Invoice Deleted: ${invoice.invoiceNumber}`,
                            companyId: invoice.companyId
                        }
                    });
                }
            }

            // Call reverseStockOut to restore FIFO batches and update WAC cost
            await reverseStockOut(tx, {
                invoiceId: invoice.id,
                invoiceItems: baseItemsForReversal
            });

            // 3. Delete Transactions, Journal Entries, and Invoice
            const journalEntryIds = [...new Set(invoice.transaction.map(t => t.journalEntryId).filter(Boolean))];

            await tx.transaction.deleteMany({ where: { invoiceId: invoice.id } });

            if (journalEntryIds.length > 0) {
                await tx.journalentry.deleteMany({ where: { id: { in: journalEntryIds } } });
            }

            // Also delete any orphaned journal entries with same voucherNumber (permanent delete guarantee)
            await tx.journalentry.deleteMany({
                where: {
                    companyId: invoice.companyId,
                    voucherNumber: invoice.invoiceNumber,
                    transaction: { none: {} }
                }
            });

            await tx.invoice.delete({ where: { id: invoice.id } });
        }, { timeout: 90000 });

        // Sync customer.accountBalance from ledger after deletion
        try {
            if (invoice.customerId) {
                const customer = await prisma.customer.findUnique({
                    where: { id: invoice.customerId },
                    select: { id: true, ledgerId: true }
                });
                if (customer && customer.ledgerId) {
                    const ledger = await prisma.ledger.findUnique({
                        where: { id: customer.ledgerId },
                        select: { currentBalance: true }
                    });
                    if (ledger) {
                        await prisma.customer.update({
                            where: { id: customer.id },
                            data: { accountBalance: ledger.currentBalance }
                        });
                    }
                }
            }
        } catch (syncErr) {
            console.error('Customer balance sync error after invoice delete:', syncErr);
        }

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Invoice', invoice.id, `Invoice #${invoice.invoiceNumber} deleted for Customer ID ${invoice.customerId} with amount ${invoice.totalAmount}`);
        res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error('Invoice Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Next Invoice Number
const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const result = await numberingService.getNextNumber(companyId, 'invoice');
        res.status(200).json({ success: true, nextNumber: result.formattedNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const getPublicInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const parsedId = parseInt(id);
        if (isNaN(parsedId)) {
            return res.status(400).json({ success: false, message: 'Invalid Invoice ID format' });
        }

        const invoice = await prisma.invoice.findUnique({
            where: { id: parsedId },
            include: {
                invoiceitem: {
                    include: {
                        product: true,
                        service: true,
                        warehouse: true
                    }
                },
                customer: true,
                salesorder: true,
                company: true,
                receipt: {
                    include: {
                        cashBankAccount: true
                    }
                }
            }
        });

        if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
        res.status(200).json({ success: true, data: invoice });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// One-time cleanup: remove orphaned journal entries (no linked transactions)
const cleanupOrphanedJournals = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const whereClause = { transaction: { none: {} } };
        if (companyId) whereClause.companyId = parseInt(companyId);

        const orphaned = await prisma.journalentry.findMany({
            where: whereClause,
            select: { id: true, voucherNumber: true, narration: true }
        });

        if (orphaned.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No orphaned journal entries found. Database is already clean!',
                deletedCount: 0
            });
        }

        const result = await prisma.journalentry.deleteMany({ where: whereClause });

        return res.status(200).json({
            success: true,
            message: `Cleaned up ${result.count} orphaned journal entries.`,
            deletedCount: result.count,
            deleted: orphaned.map(j => ({ id: j.id, voucherNumber: j.voucherNumber }))
        });
    } catch (error) {
        console.error('Cleanup Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createInvoice,
    getInvoices,
    getInvoiceById,
    updateInvoice,
    deleteInvoice,
    getNextNumber,
    getPublicInvoiceById,
    cleanupOrphanedJournals
};