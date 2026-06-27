const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getInventoryConfig, consumeStock } = require('../services/inventoryValuationService');
const numberingService = require('../services/numberingService');

// Create POS Invoice
const createPOSInvoice = async (req, res) => {
    try {
        const {
            invoiceNumber,
            companyId,
            customerId, // Optional (for walk-in)
            items,
            paymentMode,
            discountAmount,
            notes,
            receivedAmount, // The actual amount paid by customer
            accountId,   // Explicit ledger selection for payment (Cash/Bank)
            dueAccountId, // Explicit ledger selection for the sale debit (Customer/Receivable)
            payments,
            customFields,
            manualStatus,
            status
        } = req.body;

        const currentCompanyId = req.user?.companyId || companyId;

        if (!currentCompanyId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid data provided' });
        }

        let resolvedInvoiceNumber = invoiceNumber;
        if (!resolvedInvoiceNumber) {
            const nextNumObj = await numberingService.getNextNumber(currentCompanyId, 'posinvoice');
            resolvedInvoiceNumber = nextNumObj.formattedNumber;
        }

        // 1. Calculate Totals
        let subtotal = 0;
        let totalTax = 0;
        const processedItems = items.map(item => {
            const qty = parseFloat(item.quantity);
            const rate = parseFloat(item.rate);
            const disc = parseFloat(item.discount || 0);
            const tax = parseFloat(item.taxRate || 0);

            const gross = qty * rate;
            const taxable = gross - disc;
            const taxAmt = (taxable * tax) / 100;
            const total = taxable + taxAmt;

            subtotal += gross;
            totalTax += taxAmt;

            return {
                ...item,
                qty, rate, disc, tax, taxAmt, total, taxable,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const invoiceTotal = parseFloat((subtotal - (parseFloat(discountAmount) || 0) + totalTax).toFixed(2));
        const finalDiscount = parseFloat(discountAmount) || 0;
        const finalReceived = parseFloat(receivedAmount) || 0;
        const balance = parseFloat((invoiceTotal - finalReceived).toFixed(2));

        // 2. Start Transaction
        const result = await prisma.$transaction(async (tx) => {

            // Helper to resolve or create ledgers inside tx
            const resolveLedger = async (namePattern, type) => {
                let ledger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(currentCompanyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: type } });
                    if (group) {
                        ledger = await tx.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(currentCompanyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            // A. Generate Invoice Number
            const invoiceNumber = resolvedInvoiceNumber;

            // B. Find/Create Ledgers

            // Sales Ledger (Income)
            let salesLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(currentCompanyId), name: { contains: 'Sales' }, accountgroup: { type: 'INCOME' } }
            });

            if (!salesLedger) {
                let refGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'INCOME' } });
                if (!refGroup) {
                    refGroup = await tx.accountgroup.create({
                        data: { name: 'Direct Income', type: 'INCOME', companyId: parseInt(currentCompanyId) }
                    });
                }
                salesLedger = await tx.ledger.create({
                    data: {
                        name: 'Sales Income (POS)',
                        groupId: refGroup.id,
                        companyId: parseInt(currentCompanyId)
                    }
                });
            }

            // Debit Ledger (Who owes us? / Customer Receivable)
            let debitLedgerId = dueAccountId ? parseInt(dueAccountId) : null;

            if (!debitLedgerId && customerId) {
                const customer = await tx.customer.findUnique({ where: { id: parseInt(customerId) } });
                if (customer?.ledgerId) {
                    debitLedgerId = customer.ledgerId;
                }
            }

            // If still no debitLedgerId (Walk-in), use/create a generic one
            if (!debitLedgerId) {
                let walkinLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(currentCompanyId), name: { contains: 'Walk-in' } }
                });
                if (!walkinLedger) {
                    let assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'ASSETS' } });
                    if (!assetGroup) {
                        assetGroup = await tx.accountgroup.create({
                            data: { name: 'Current Assets', type: 'ASSETS', companyId: parseInt(currentCompanyId) }
                        });
                    }
                    walkinLedger = await tx.ledger.create({
                        data: { name: 'Walk-in Customer Ledger', groupId: assetGroup.id, companyId: parseInt(currentCompanyId) }
                    });
                }
                debitLedgerId = walkinLedger.id;
            }

            // C. Create POS Invoice
            const posInvoice = await tx.posinvoice.create({
                data: {
                    invoiceNumber,
                    companyId: parseInt(currentCompanyId),
                    customerId: customerId ? parseInt(customerId) : null,
                    subtotal: subtotal,
                    discountAmount: finalDiscount,
                    taxAmount: totalTax,
                    totalAmount: invoiceTotal,
                    paidAmount: finalReceived,
                    balanceAmount: balance,
                    paymentMode: paymentMode || 'CASH',
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : (balance <= 0 ? 'Paid' : (finalReceived > 0 ? 'Partial' : 'Due')),
                    updatedAt: new Date(),
                    notes: notes || null,
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    posinvoiceitem: {
                        create: processedItems.map(i => ({
                            productId: parseInt(i.productId),
                            warehouseId: parseInt(i.warehouseId),
                            description: i.description || 'POS Item',
                            quantity: i.qty,
                            rate: i.rate,
                            amount: parseFloat(i.total),
                            taxRate: parseFloat(i.tax),
                            uomId: i.uomId ? parseInt(i.uomId) : null,
                            updatedAt: new Date()
                        }))
                    }
                }
            });

            // D. Inventory Update & COGS Calculation
            let totalCOGS = 0;
            const invConfig = await getInventoryConfig(currentCompanyId);
            const valuationMethod = invConfig.valuationMethod || 'WAC';
            const autoCogsEntry = invConfig.autoCogsEntry !== false; // default ON
            const negativeStockAllow = invConfig.negativeStockAllow !== false; // default ON

            for (const item of processedItems) {
                const wId = parseInt(item.warehouseId);
                const pId = parseInt(item.productId);

                if (isNaN(wId) || isNaN(pId)) {
                    throw new Error(`Invalid warehouseId (${item.warehouseId}) or productId (${item.productId}) for item ${item.description || 'unknown'}`);
                }

                // Fetch Product with Base UoM
                const prod = await tx.product.findUnique({
                    where: { id: pId },
                    include: { uom: true }
                });
                const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                const baseUom = prod?.uom;

                const { convertToBaseQuantity } = require('../services/uomConversionService');
                const baseQty = convertToBaseQuantity(item.qty, transUom, baseUom);

                const stock = await tx.stock.findUnique({
                    where: { warehouseId_productId: { warehouseId: wId, productId: pId } }
                });

                if (stock) {
                    await tx.stock.update({
                        where: { id: stock.id },
                        data: { quantity: { decrement: baseQty } }
                    });
                } else {
                    await tx.stock.create({
                        data: {
                            warehouseId: wId,
                            productId: pId,
                            quantity: -baseQty,
                            updatedAt: new Date()
                        }
                    });
                }

                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(),
                        type: 'SALE',
                        productId: pId,
                        fromWarehouseId: wId,
                        quantity: baseQty,
                        reason: `POS Sale: ${invoiceNumber}`,
                        companyId: parseInt(currentCompanyId),
                        userId: req.user?.userId || null,
                        updatedAt: new Date()
                    }
                });

                // Calculate and consume stock valuation for COGS using baseQty
                const itemCOGS = await consumeStock(tx, {
                    companyId: currentCompanyId,
                    productId: pId,
                    warehouseId: wId,
                    quantity: baseQty,
                    invoiceId: null, // No standard invoiceId
                    method: valuationMethod,
                    negativeStockAllow,
                    isPOS: true // Bypass inventory_consumption table due to foreign key constraints
                });
                totalCOGS += itemCOGS;
            }

            // E. Accounting Entries

            // 1. Initial Sale (Dr Customer/Walk-in, Cr Sales)
            const saleAmount = parseFloat((invoiceTotal - totalTax).toFixed(2));
            await tx.transaction.create({
                data: {
                    date: new Date(),
                    voucherType: 'POS_INVOICE',
                    voucherNumber: invoiceNumber,
                    companyId: parseInt(currentCompanyId),
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: salesLedger.id,
                    amount: saleAmount,
                    narration: `POS Sale generated - ${invoiceNumber}`,
                    posInvoiceId: posInvoice.id,
                    updatedAt: new Date()
                }
            });

            await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { increment: saleAmount } } });
            await tx.ledger.update({ where: { id: salesLedger.id }, data: { currentBalance: { increment: saleAmount } } });

            // 2. Tax Entry (Dr Customer/Walk-in, Cr Tax Payable)
            if (totalTax > 0) {
                const taxLedger = await resolveLedger('Tax', 'LIABILITIES');
                if (taxLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            voucherType: 'POS_INVOICE',
                            voucherNumber: invoiceNumber,
                            companyId: parseInt(currentCompanyId),
                            debitLedgerId: debitLedgerId,
                            creditLedgerId: taxLedger.id,
                            amount: totalTax,
                            narration: `Tax on POS Sale - ${invoiceNumber}`,
                            posInvoiceId: posInvoice.id,
                            updatedAt: new Date()
                        }
                    });
                    await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { increment: totalTax } } });
                    await tx.ledger.update({ where: { id: taxLedger.id }, data: { currentBalance: { increment: totalTax } } });
                }
            }

            // 2. Receipt Entry (Recording actual payment - supports multiple/split payments)
            const paymentsToProcess = payments && payments.length > 0 ? payments : (
                finalReceived > 0 ? [{ amount: finalReceived, paymentMode: paymentMode || 'CASH', accountId }] : []
            );

            for (const payment of paymentsToProcess) {
                const amt = parseFloat(payment.amount || 0);
                if (amt <= 0) continue;

                let receiptLedgerId = payment.accountId ? parseInt(payment.accountId) : null;
                if (!receiptLedgerId) {
                    const modeName = payment.paymentMode === 'CASH' ? 'Cash' : 'Bank';
                    let fallbackLedger = await tx.ledger.findFirst({
                        where: { companyId: parseInt(currentCompanyId), name: { contains: modeName }, accountgroup: { type: 'ASSETS' } }
                    });
                    if (!fallbackLedger) {
                        const assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'ASSETS' } });
                        fallbackLedger = await tx.ledger.create({
                            data: { name: `${modeName} Account`, groupId: assetGroup.id, companyId: parseInt(currentCompanyId) }
                        });
                    }
                    receiptLedgerId = fallbackLedger.id;
                }

                await tx.transaction.create({
                    data: {
                        date: new Date(),
                        voucherType: 'RECEIPT',
                        voucherNumber: `RCP-${invoiceNumber}`,
                        companyId: parseInt(currentCompanyId),
                        debitLedgerId: receiptLedgerId, // Money enters this account
                        creditLedgerId: debitLedgerId,    // Money leaves customer owing
                        amount: amt,
                        narration: `Payment received for POS ${invoiceNumber} via ${payment.paymentMode}`,
                        posInvoiceId: posInvoice.id,
                        updatedAt: new Date()
                    }
                });

                await tx.ledger.update({ where: { id: receiptLedgerId }, data: { currentBalance: { increment: amt } } });
                await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { decrement: amt } } });
            }

            // 3. Post COGS journal entry (Debit COGS / Credit Purchases)
            if (autoCogsEntry && totalCOGS > 0) {
                const cogsLedger = await resolveLedger('Point Of Sale', 'EXPENSES');
                const inventoryAssetLedger = await resolveLedger('Inventory Asset', 'ASSETS') || await resolveLedger('Inventory', 'ASSETS');
                const purchaseLedger = await resolveLedger('Purchases', 'EXPENSES') || await resolveLedger('Purchase', 'EXPENSES');

                const finalCreditLedger = inventoryAssetLedger || purchaseLedger;
                if (cogsLedger && finalCreditLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-${invoiceNumber}`,
                            debitLedgerId: cogsLedger.id,
                            creditLedgerId: finalCreditLedger.id,
                            amount: totalCOGS,
                            narration: `COGS for POS Sale: ${invoiceNumber}`,
                            companyId: parseInt(currentCompanyId),
                            posInvoiceId: posInvoice.id,
                            updatedAt: new Date()
                        }
                    });

                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { increment: totalCOGS } } });
                    await tx.ledger.update({ where: { id: finalCreditLedger.id }, data: { currentBalance: { decrement: totalCOGS } } });
                }
            }

            // Sync customer balance to customer table for consistency
            if (customerId) {
                const customer = await tx.customer.findUnique({ where: { id: parseInt(customerId) } });
                if (customer && customer.ledgerId) {
                    const ledger = await tx.ledger.findUnique({ where: { id: customer.ledgerId } });
                    if (ledger) {
                        await tx.customer.update({
                            where: { id: customer.id },
                            data: { accountBalance: ledger.currentBalance }
                        });
                    }
                }
            }

            return posInvoice;
        }, {
            maxWait: 15000,
            timeout: 90000
        });

        await numberingService.incrementNumber(currentCompanyId, 'posinvoice', resolvedInvoiceNumber);
        
        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'POS', result.id, `POS Invoice #${result.invoiceNumber} created with amount ${result.totalAmount}`);

        res.status(201).json({ success: true, data: result });

    } catch (error) {
        console.error('Create POS Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All POS
const getPOSInvoices = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const invoices = await prisma.posinvoice.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: true,
                posinvoiceitem: { include: { product: true, warehouse: true } },
                transaction: {
                    include: {
                        ledger_transaction_debitLedgerIdToledger: { select: { id: true, name: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const salesReturns = await prisma.salesreturn.findMany({
            where: { companyId: parseInt(companyId), invoiceId: null },
            include: {
                salesreturnitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                }
            }
        });

        const { adjustInvoiceWithReturns } = require('./salesInvoiceController');
        const mappedInvoices = invoices.map(inv => {
            const posReturns = salesReturns.filter(ret => {
                if (ret.customFields) {
                    try {
                        const parsedCF = typeof ret.customFields === 'string'
                            ? JSON.parse(ret.customFields)
                            : ret.customFields;
                        return parsedCF && parseInt(parsedCF.posInvoiceId) === inv.id;
                    } catch (e) {
                        return false;
                    }
                }
                return false;
            });
            return adjustInvoiceWithReturns({
                ...inv,
                type: 'POS_INVOICE',
                salesreturn: posReturns
            });
        });

        res.status(200).json({ success: true, data: mappedInvoices });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Single POS
const getPOSInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const invoice = await prisma.posinvoice.findUnique({
            where: { id: parseInt(id) },
            include: {
                customer: true,
                posinvoiceitem: { include: { product: true, warehouse: true } },
                transaction: {
                    include: {
                        ledger_transaction_debitLedgerIdToledger: { select: { id: true, name: true } }
                    }
                }
            }
        });

        if (!invoice || invoice.companyId !== parseInt(companyId)) {
            return res.status(404).json({ success: false, message: 'POS Invoice not found' });
        }

        const receiptTransactions = invoice.transaction?.filter(t => t.voucherType === 'RECEIPT') || [];
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

        const salesReturns = await prisma.salesreturn.findMany({
            where: { companyId: parseInt(companyId), invoiceId: null },
            include: {
                salesreturnitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                }
            }
        });

        const { adjustInvoiceWithReturns } = require('./salesInvoiceController');
        const posReturns = salesReturns.filter(ret => {
            if (ret.customFields) {
                try {
                    const parsedCF = typeof ret.customFields === 'string'
                        ? JSON.parse(ret.customFields)
                        : ret.customFields;
                    return parsedCF && parseInt(parsedCF.posInvoiceId) === invoice.id;
                } catch (e) {
                    return false;
                }
            }
            return false;
        });

        const adjustedInvoice = adjustInvoiceWithReturns({
            ...invoice,
            type: 'POS_INVOICE',
            salesreturn: posReturns
        });

        res.status(200).json({
            success: true,
            data: {
                ...adjustedInvoice,
                receipt: mappedReceipts
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete POS (Void)
const deletePOSInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        // Implementation of Void/Delete
        // 1. Reverse Stock
        // 2. Reverse Ledgers? Or just delete if testing?
        // User asked for "delete".
        // Robust way: Delete Transaction entries (reverse ledger balances first), then delete Invoice.

        let invoiceToDelete = null;
        await prisma.$transaction(async (tx) => {
            const invoice = await tx.posinvoice.findUnique({
                where: { id: parseInt(id) },
                include: { posinvoiceitem: true, transaction: true }
            });

            if (!invoice || invoice.companyId !== parseInt(companyId)) {
                throw new Error('Invoice not found or unauthorized');
            }

            const { deleteSalesReturnHelper } = require('./salesReturnController');

            // Find and delete linked sales returns
            const candidateReturns = await tx.salesreturn.findMany({
                where: { companyId: parseInt(companyId), invoiceId: null },
                include: { salesreturnitem: true }
            });
            for (const ret of candidateReturns) {
                if (ret.customFields) {
                    try {
                        const parsedCF = typeof ret.customFields === 'string'
                            ? JSON.parse(ret.customFields)
                            : ret.customFields;
                        if (parsedCF && parseInt(parsedCF.posInvoiceId) === invoice.id) {
                            await deleteSalesReturnHelper(tx, ret, companyId);
                        }
                    } catch (e) {
                        console.error("Error parsing salesReturn customFields inside deletePOSInvoice:", e);
                    }
                }
            }

            // 1. Reverse Accounting
            // Loop transactions and reverse balances
            for (const t of invoice.transaction) {
                if (t.voucherNumber && t.voucherNumber.startsWith('COGS-')) {
                    await tx.ledger.update({ where: { id: t.debitLedgerId }, data: { currentBalance: { decrement: t.amount } } });
                    await tx.ledger.update({ where: { id: t.creditLedgerId }, data: { currentBalance: { increment: t.amount } } });
                } else {
                    const dLedger = await tx.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
                    const cLedger = await tx.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });

                    const isDrDebitNormal = dLedger?.accountgroup ? ['ASSETS', 'EXPENSES'].includes(dLedger.accountgroup.type) : true;
                    const isCrDebitNormal = cLedger?.accountgroup ? ['ASSETS', 'EXPENSES'].includes(cLedger.accountgroup.type) : true;

                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: isDrDebitNormal ? { decrement: t.amount } : { increment: t.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: t.creditLedgerId },
                        data: { currentBalance: isCrDebitNormal ? { increment: t.amount } : { decrement: t.amount } }
                    });
                }

                await tx.transaction.delete({ where: { id: t.id } });
            }

            // 2. Reverse Stock & Product WAC Valuation
            const { convertToBaseQuantity } = require('../services/uomConversionService');

            for (const item of invoice.posinvoiceitem) {
                if (item.productId && item.warehouseId) {
                    const prod = await tx.product.findUnique({
                        where: { id: item.productId },
                        include: { uom: true }
                    });
                    const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                    const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                    // Restore physical stock
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        data: { quantity: { increment: baseQty } }
                    });

                    // Restore WAC inventory tracking
                    const currentProduct = await tx.product.findUnique({
                        where: { id: parseInt(item.productId) },
                        select: { totalQty: true, totalInventoryValue: true, averageCost: true }
                    });

                    if (currentProduct) {
                        const averageCost = parseFloat(currentProduct.averageCost || 0);
                        const restorationValue = baseQty * averageCost;

                        const newTotalQty = parseFloat(currentProduct.totalQty || 0) + baseQty;
                        const newTotalValue = parseFloat(currentProduct.totalInventoryValue || 0) + restorationValue;

                        await tx.product.update({
                            where: { id: parseInt(item.productId) },
                            data: {
                                totalQty: newTotalQty,
                                totalInventoryValue: newTotalValue,
                                averageCost: newTotalQty > 0 ? newTotalValue / newTotalQty : averageCost
                            }
                        });
                    }
                }
            }

            // Delete original inventory transactions matching this POS invoice
            await tx.inventorytransaction.deleteMany({
                where: {
                    companyId: parseInt(companyId || invoice.companyId),
                    reason: { contains: invoice.invoiceNumber }
                }
            });

            // 3. Delete Invoice
            await tx.posinvoice.delete({ where: { id: parseInt(id) } });
            invoiceToDelete = invoice;
        }, {
            maxWait: 15000,
            timeout: 90000
        });

        // Sync customer.accountBalance from ledger after POS invoice delete
        try {
            if (invoiceToDelete && invoiceToDelete.customerId) {
                const customer = await prisma.customer.findUnique({
                    where: { id: invoiceToDelete.customerId },
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
            console.error('Customer balance sync error after POS invoice delete:', syncErr);
        }

        const { logActivity } = require('../utils/auditLogger');
        if (invoiceToDelete) {
            logActivity(req, 'DELETE', 'POS', invoiceToDelete.id, `POS Invoice #${invoiceToDelete.invoiceNumber} deleted/voided`);
        }

        res.status(200).json({ success: true, message: 'POS Invoice deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPublicPOSInvoiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const invoice = await prisma.posinvoice.findUnique({
            where: { id: parseInt(id) },
            include: {
                customer: true,
                posinvoiceitem: { include: { product: true, warehouse: true } },
                company: true
            }
        });

        if (!invoice) return res.status(404).json({ success: false, message: 'POS Invoice not found' });

        const salesReturns = await prisma.salesreturn.findMany({
            where: { companyId: invoice.companyId, invoiceId: null },
            include: {
                salesreturnitem: {
                    include: {
                        product: true,
                        warehouse: true
                    }
                }
            }
        });

        const posReturns = salesReturns.filter(ret => {
            if (ret.customFields) {
                try {
                    const parsedCF = typeof ret.customFields === 'string'
                        ? JSON.parse(ret.customFields)
                        : ret.customFields;
                    return parsedCF && parseInt(parsedCF.posInvoiceId) === invoice.id;
                } catch (e) {
                    return false;
                }
            }
            return false;
        });

        res.status(200).json({
            success: true,
            data: {
                ...invoice,
                salesreturn: posReturns
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update POS Invoice
const updatePOSInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            companyId,
            customerId,
            items,
            paymentMode,
            discountAmount,
            notes,
            receivedAmount,
            accountId,
            dueAccountId,
            payments,
            customFields,
            manualStatus,
            status,
            onlyUpdateStatus
        } = req.body;

        const currentCompanyId = req.user?.companyId || companyId;

        if (onlyUpdateStatus === true || onlyUpdateStatus === 'true') {
            const updated = await prisma.posinvoice.update({
                where: { id: parseInt(id) },
                data: {
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: status
                }
            });
            return res.status(200).json({ success: true, data: updated });
        }

        if (!currentCompanyId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Invalid data provided' });
        }

        // 1. Calculate New Totals
        let subtotal = 0;
        let totalTax = 0;
        const processedItems = items.map(item => {
            const qty = parseFloat(item.quantity);
            const rate = parseFloat(item.rate);
            const disc = parseFloat(item.discount || 0);
            const tax = parseFloat(item.taxRate || 0);

            const gross = qty * rate;
            const taxable = gross - disc;
            const taxAmt = (taxable * tax) / 100;
            const total = taxable + taxAmt;

            subtotal += gross;
            totalTax += taxAmt;

            return {
                ...item,
                qty, rate, disc, tax, taxAmt, total, taxable,
                uomId: item.uomId ? parseInt(item.uomId) : null
            };
        });

        const invoiceTotal = parseFloat((subtotal - (parseFloat(discountAmount) || 0) + totalTax).toFixed(2));
        const finalDiscount = parseFloat(discountAmount) || 0;
        const finalReceived = parseFloat(receivedAmount) || 0;
        const balance = parseFloat((invoiceTotal - finalReceived).toFixed(2));

        // 2. Start Transaction
        const result = await prisma.$transaction(async (tx) => {

            // Helper to resolve or create ledgers inside tx
            const resolveLedger = async (namePattern, type) => {
                let ledger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(currentCompanyId), name: { contains: namePattern } }
                });
                if (!ledger) {
                    const group = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: type } });
                    if (group) {
                        ledger = await tx.ledger.create({
                            data: {
                                name: namePattern,
                                groupId: group.id,
                                companyId: parseInt(currentCompanyId),
                                isControlAccount: true
                            }
                        });
                    }
                }
                return ledger;
            };

            // A. Fetch Existing Invoice
            const existingInvoice = await tx.posinvoice.findUnique({
                where: { id: parseInt(id) },
                include: { posinvoiceitem: true, transaction: true }
            });

            if (!existingInvoice || existingInvoice.companyId !== parseInt(currentCompanyId)) {
                throw new Error('POS Invoice not found or unauthorized');
            }

            // B. Reverse Old Accounting Entries (Loop and reverse balances)
            for (const t of existingInvoice.transaction) {
                if (t.voucherNumber && t.voucherNumber.startsWith('COGS-')) {
                    await tx.ledger.update({ where: { id: t.debitLedgerId }, data: { currentBalance: { decrement: t.amount } } });
                    await tx.ledger.update({ where: { id: t.creditLedgerId }, data: { currentBalance: { increment: t.amount } } });
                } else {
                    const dLedger = await tx.ledger.findUnique({ where: { id: t.debitLedgerId }, include: { accountgroup: true } });
                    const cLedger = await tx.ledger.findUnique({ where: { id: t.creditLedgerId }, include: { accountgroup: true } });

                    const isDrDebitNormal = dLedger?.accountgroup ? ['ASSETS', 'EXPENSES'].includes(dLedger.accountgroup.type) : true;
                    const isCrDebitNormal = cLedger?.accountgroup ? ['ASSETS', 'EXPENSES'].includes(cLedger.accountgroup.type) : true;

                    await tx.ledger.update({
                        where: { id: t.debitLedgerId },
                        data: { currentBalance: isDrDebitNormal ? { decrement: t.amount } : { increment: t.amount } }
                    });
                    await tx.ledger.update({
                        where: { id: t.creditLedgerId },
                        data: { currentBalance: isCrDebitNormal ? { increment: t.amount } : { decrement: t.amount } }
                    });
                }
                await tx.transaction.delete({ where: { id: t.id } });
            }

            // C. Reverse Old Stock & Product WAC Valuation
            const { convertToBaseQuantity } = require('../services/uomConversionService');

            for (const item of existingInvoice.posinvoiceitem) {
                if (item.productId && item.warehouseId) {
                    const prod = await tx.product.findUnique({
                        where: { id: item.productId },
                        include: { uom: true }
                    });
                    const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                    const baseQty = convertToBaseQuantity(item.quantity, transUom, prod?.uom);

                    // Restore physical stock
                    await tx.stock.update({
                        where: { warehouseId_productId: { warehouseId: item.warehouseId, productId: item.productId } },
                        data: { quantity: { increment: baseQty } }
                    });

                    // Log return transaction
                    await tx.inventorytransaction.create({
                        data: {
                            date: new Date(),
                            type: 'RETURN',
                            productId: item.productId,
                            toWarehouseId: item.warehouseId,
                            quantity: baseQty,
                            reason: `Void Items on Update POS: ${existingInvoice.invoiceNumber}`,
                            companyId: parseInt(currentCompanyId),
                            userId: req.user?.userId || null
                        }
                    });

                    // Restore WAC inventory tracking
                    const currentProduct = await tx.product.findUnique({
                        where: { id: parseInt(item.productId) },
                        select: { totalQty: true, totalInventoryValue: true, averageCost: true }
                    });

                    if (currentProduct) {
                        const averageCost = parseFloat(currentProduct.averageCost || 0);
                        const restorationValue = baseQty * averageCost;

                        const newTotalQty = parseFloat(currentProduct.totalQty || 0) + baseQty;
                        const newTotalValue = parseFloat(currentProduct.totalInventoryValue || 0) + restorationValue;

                        await tx.product.update({
                            where: { id: parseInt(item.productId) },
                            data: {
                                totalQty: newTotalQty,
                                totalInventoryValue: newTotalValue,
                                averageCost: newTotalQty > 0 ? newTotalValue / newTotalQty : averageCost
                            }
                        });
                    }
                }
            }

            // D. Delete Existing Items
            await tx.posinvoiceitem.deleteMany({
                where: { posInvoiceId: parseInt(id) }
            });

            // E. Resolve Sales Ledger & Debit Ledger for the new entries
            let salesLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(currentCompanyId), name: { contains: 'Sales' }, accountgroup: { type: 'INCOME' } }
            });

            if (!salesLedger) {
                let refGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'INCOME' } });
                if (!refGroup) {
                    refGroup = await tx.accountgroup.create({
                        data: { name: 'Direct Income', type: 'INCOME', companyId: parseInt(currentCompanyId) }
                    });
                }
                salesLedger = await tx.ledger.create({
                    data: {
                        name: 'Sales Income (POS)',
                        groupId: refGroup.id,
                        companyId: parseInt(currentCompanyId)
                    }
                });
            }

            // Debit Ledger (Customer Receivable)
            let debitLedgerId = dueAccountId ? parseInt(dueAccountId) : null;
            if (!debitLedgerId && customerId) {
                const customer = await tx.customer.findUnique({ where: { id: parseInt(customerId) } });
                if (customer?.ledgerId) {
                    debitLedgerId = customer.ledgerId;
                }
            }
            if (!debitLedgerId) {
                let walkinLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(currentCompanyId), name: { contains: 'Walk-in' } }
                });
                if (!walkinLedger) {
                    let assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'ASSETS' } });
                    if (!assetGroup) {
                        assetGroup = await tx.accountgroup.create({
                            data: { name: 'Current Assets', type: 'ASSETS', companyId: parseInt(currentCompanyId) }
                        });
                    }
                    walkinLedger = await tx.ledger.create({
                        data: { name: 'Walk-in Customer Ledger', groupId: assetGroup.id, companyId: parseInt(currentCompanyId) }
                    });
                }
                debitLedgerId = walkinLedger.id;
            }

            // F. Update POS Invoice Header and Re-create Items
            const updatedInvoice = await tx.posinvoice.update({
                where: { id: parseInt(id) },
                data: {
                    customerId: customerId ? parseInt(customerId) : null,
                    subtotal: subtotal,
                    discountAmount: finalDiscount,
                    taxAmount: totalTax,
                    totalAmount: invoiceTotal,
                    paidAmount: finalReceived,
                    balanceAmount: balance,
                    paymentMode: paymentMode || 'CASH',
                    manualStatus: manualStatus === true || manualStatus === 'true',
                    status: (manualStatus === true || manualStatus === 'true') && status ? status : (balance <= 0 ? 'Paid' : (finalReceived > 0 ? 'Partial' : 'Due')),
                    updatedAt: new Date(),
                    notes: notes || null,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
                    posinvoiceitem: {
                        create: processedItems.map(i => ({
                            productId: parseInt(i.productId),
                            warehouseId: parseInt(i.warehouseId),
                            description: i.description || 'POS Item',
                            quantity: i.qty,
                            rate: i.rate,
                            amount: parseFloat(i.total),
                            taxRate: parseFloat(i.tax),
                            uomId: i.uomId ? parseInt(i.uomId) : null,
                            updatedAt: new Date()
                        }))
                    }
                }
            });

            // G. Deduct New Stock & Run WAC Valuation
            let totalCOGS = 0;
            const invConfig = await getInventoryConfig(currentCompanyId);
            const valuationMethod = invConfig.valuationMethod || 'WAC';
            const autoCogsEntry = invConfig.autoCogsEntry !== false;
            const negativeStockAllow = invConfig.negativeStockAllow !== false;

            for (const item of processedItems) {
                const wId = parseInt(item.warehouseId);
                const pId = parseInt(item.productId);

                // Fetch Product UOM conversion
                const prod = await tx.product.findUnique({
                    where: { id: pId },
                    include: { uom: true }
                });
                const transUom = item.uomId ? await tx.uom.findUnique({ where: { id: item.uomId } }) : null;
                const baseQty = convertToBaseQuantity(item.qty, transUom, prod?.uom);

                const stock = await tx.stock.findUnique({
                    where: { warehouseId_productId: { warehouseId: wId, productId: pId } }
                });

                if (stock) {
                    await tx.stock.update({
                        where: { id: stock.id },
                        data: { quantity: { decrement: baseQty } }
                    });
                } else {
                    await tx.stock.create({
                        data: {
                            warehouseId: wId,
                            productId: pId,
                            quantity: -baseQty,
                            updatedAt: new Date()
                        }
                    });
                }

                await tx.inventorytransaction.create({
                    data: {
                        date: new Date(),
                        type: 'SALE',
                        productId: pId,
                        fromWarehouseId: wId,
                        quantity: baseQty,
                        reason: `POS Sale Update: ${existingInvoice.invoiceNumber}`,
                        companyId: parseInt(currentCompanyId),
                        userId: req.user?.userId || null,
                        updatedAt: new Date()
                    }
                });

                const itemCOGS = await consumeStock(tx, {
                    companyId: currentCompanyId,
                    productId: pId,
                    warehouseId: wId,
                    quantity: baseQty,
                    invoiceId: null,
                    method: valuationMethod,
                    negativeStockAllow,
                    isPOS: true
                });
                totalCOGS += itemCOGS;
            }

            // H. New Accounting Entries

            // 1. Initial Sale (Dr Customer/Walk-in, Cr Sales)
            const saleAmount = parseFloat((invoiceTotal - totalTax).toFixed(2));
            await tx.transaction.create({
                data: {
                    date: new Date(),
                    voucherType: 'POS_INVOICE',
                    voucherNumber: existingInvoice.invoiceNumber,
                    companyId: parseInt(currentCompanyId),
                    debitLedgerId: debitLedgerId,
                    creditLedgerId: salesLedger.id,
                    amount: saleAmount,
                    narration: `POS Sale updated - ${existingInvoice.invoiceNumber}`,
                    posInvoiceId: updatedInvoice.id,
                    updatedAt: new Date()
                }
            });

            await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { increment: saleAmount } } });
            await tx.ledger.update({ where: { id: salesLedger.id }, data: { currentBalance: { increment: saleAmount } } });

            // 2. Tax Entry
            if (totalTax > 0) {
                const taxLedger = await resolveLedger('Tax', 'LIABILITIES');
                if (taxLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            voucherType: 'POS_INVOICE',
                            voucherNumber: existingInvoice.invoiceNumber,
                            companyId: parseInt(currentCompanyId),
                            debitLedgerId: debitLedgerId,
                            creditLedgerId: taxLedger.id,
                            amount: totalTax,
                            narration: `Tax on POS Sale - ${existingInvoice.invoiceNumber}`,
                            posInvoiceId: updatedInvoice.id,
                            updatedAt: new Date()
                        }
                    });
                    await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { increment: totalTax } } });
                    await tx.ledger.update({ where: { id: taxLedger.id }, data: { currentBalance: { increment: totalTax } } });
                }
            }

            // 3. Receipt Entries (Split/Multiple Payments)
            const paymentsToProcess = payments && payments.length > 0 ? payments : (
                finalReceived > 0 ? [{ amount: finalReceived, paymentMode: paymentMode || 'CASH', accountId }] : []
            );

            for (const payment of paymentsToProcess) {
                const amt = parseFloat(payment.amount || 0);
                if (amt <= 0) continue;

                let receiptLedgerId = payment.accountId ? parseInt(payment.accountId) : null;
                if (!receiptLedgerId) {
                    const modeName = payment.paymentMode === 'CASH' ? 'Cash' : 'Bank';
                    let fallbackLedger = await tx.ledger.findFirst({
                        where: { companyId: parseInt(currentCompanyId), name: { contains: modeName }, accountgroup: { type: 'ASSETS' } }
                    });
                    if (!fallbackLedger) {
                        const assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(currentCompanyId), type: 'ASSETS' } });
                        fallbackLedger = await tx.ledger.create({
                            data: { name: `${modeName} Account`, groupId: assetGroup.id, companyId: parseInt(currentCompanyId) }
                        });
                    }
                    receiptLedgerId = fallbackLedger.id;
                }

                await tx.transaction.create({
                    data: {
                        date: new Date(),
                        voucherType: 'RECEIPT',
                        voucherNumber: `RCP-${existingInvoice.invoiceNumber}`,
                        companyId: parseInt(currentCompanyId),
                        debitLedgerId: receiptLedgerId,
                        creditLedgerId: debitLedgerId,
                        amount: amt,
                        narration: `Payment received for POS ${existingInvoice.invoiceNumber} via ${payment.paymentMode} (Updated)`,
                        posInvoiceId: updatedInvoice.id,
                        updatedAt: new Date()
                    }
                });

                await tx.ledger.update({ where: { id: receiptLedgerId }, data: { currentBalance: { increment: amt } } });
                await tx.ledger.update({ where: { id: debitLedgerId }, data: { currentBalance: { decrement: amt } } });
            }

            // 4. COGS entry
            if (autoCogsEntry && totalCOGS > 0) {
                const cogsLedger = await resolveLedger('Point Of Sale', 'EXPENSES');
                const inventoryAssetLedger = await resolveLedger('Inventory Asset', 'ASSETS') || await resolveLedger('Inventory', 'ASSETS');
                const purchaseLedger = await resolveLedger('Purchases', 'EXPENSES') || await resolveLedger('Purchase', 'EXPENSES');

                const finalCreditLedger = inventoryAssetLedger || purchaseLedger;
                if (cogsLedger && finalCreditLedger) {
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-${existingInvoice.invoiceNumber}`,
                            debitLedgerId: cogsLedger.id,
                            creditLedgerId: finalCreditLedger.id,
                            amount: totalCOGS,
                            narration: `COGS for POS Sale: ${existingInvoice.invoiceNumber} (Updated)`,
                            companyId: parseInt(currentCompanyId),
                            posInvoiceId: updatedInvoice.id,
                            updatedAt: new Date()
                        }
                    });

                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { increment: totalCOGS } } });
                    await tx.ledger.update({ where: { id: finalCreditLedger.id }, data: { currentBalance: { decrement: totalCOGS } } });
                }
            }

            // Sync customer balance to customer table for consistency
            const finalCustId = customerId !== undefined ? customerId : existingInvoice.customerId;
            if (finalCustId) {
                const customer = await tx.customer.findUnique({ where: { id: parseInt(finalCustId) } });
                if (customer && customer.ledgerId) {
                    const ledger = await tx.ledger.findUnique({ where: { id: customer.ledgerId } });
                    if (ledger) {
                        await tx.customer.update({
                            where: { id: customer.id },
                            data: { accountBalance: ledger.currentBalance }
                        });
                    }
                }
            }

            return updatedInvoice;
        }, {
            maxWait: 15000,
            timeout: 90000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'POS', result.id, `POS Invoice #${result.invoiceNumber} updated with amount ${result.totalAmount}`);

        res.status(200).json({ success: true, data: result });

    } catch (error) {
        console.error('Update POS Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextNumber = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID Missing' });

        const result = await numberingService.getNextNumber(companyId, 'posinvoice');
        res.status(200).json({ success: true, nextNumber: result.formattedNumber });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const recordPOSPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            amount,
            paymentMode,
            accountId,
            referenceNumber,
            date,
            notes
        } = req.body;

        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID missing' });
        }

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid payment amount' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const invoice = await tx.posinvoice.findUnique({
                where: { id: parseInt(id) },
                include: { transaction: true }
            });

            if (!invoice || invoice.companyId !== parseInt(companyId)) {
                throw new Error('POS Invoice not found or unauthorized');
            }

            if (invoice.balanceAmount <= 0) {
                throw new Error('This invoice is already fully paid');
            }

            const tolerance = 0.01;
            if (parsedAmount > invoice.balanceAmount + tolerance) {
                throw new Error(`Payment amount (${parsedAmount}) exceeds outstanding balance (${invoice.balanceAmount})`);
            }

            const saleTx = invoice.transaction.find(t => t.voucherType === 'POS_INVOICE');
            let customerLedgerId = saleTx?.debitLedgerId;

            if (!customerLedgerId) {
                if (invoice.customerId) {
                    const customer = await tx.customer.findUnique({ where: { id: invoice.customerId } });
                    customerLedgerId = customer?.ledgerId;
                }
                if (!customerLedgerId) {
                    let walkinLedger = await tx.ledger.findFirst({
                        where: { companyId: parseInt(companyId), name: { contains: 'Walk-in' } }
                    });
                    if (!walkinLedger) {
                        let assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: 'ASSETS' } });
                        if (!assetGroup) {
                            assetGroup = await tx.accountgroup.create({
                                data: { name: 'Current Assets', type: 'ASSETS', companyId: parseInt(companyId) }
                            });
                        }
                        walkinLedger = await tx.ledger.create({
                            data: { name: 'Walk-in Customer Ledger', groupId: assetGroup.id, companyId: parseInt(companyId) }
                        });
                    }
                    customerLedgerId = walkinLedger.id;
                }
            }

            let receiptLedgerId = accountId ? parseInt(accountId) : null;
            if (!receiptLedgerId) {
                const modeName = paymentMode === 'CASH' ? 'Cash' : 'Bank';
                let fallbackLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: modeName }, accountgroup: { type: 'ASSETS' } }
                });
                if (!fallbackLedger) {
                    const assetGroup = await tx.accountgroup.findFirst({ where: { companyId: parseInt(companyId), type: 'ASSETS' } });
                    fallbackLedger = await tx.ledger.create({
                        data: { name: `${modeName} Account`, groupId: assetGroup.id, companyId: parseInt(companyId) }
                    });
                }
                receiptLedgerId = fallbackLedger.id;
            }

            await tx.transaction.create({
                data: {
                    date: date ? new Date(date) : new Date(),
                    voucherType: 'RECEIPT',
                    voucherNumber: referenceNumber || `RCP-${invoice.invoiceNumber}`,
                    companyId: parseInt(companyId),
                    debitLedgerId: receiptLedgerId,
                    creditLedgerId: customerLedgerId,
                    amount: parsedAmount,
                    narration: notes || `Payment received for POS ${invoice.invoiceNumber} via ${paymentMode || 'CASH'}`,
                    posInvoiceId: invoice.id,
                    updatedAt: new Date()
                }
            });

            await tx.ledger.update({ where: { id: receiptLedgerId }, data: { currentBalance: { increment: parsedAmount } } });
            await tx.ledger.update({ where: { id: customerLedgerId }, data: { currentBalance: { decrement: parsedAmount } } });

            const newPaidAmount = parseFloat((invoice.paidAmount + parsedAmount).toFixed(2));
            const newBalanceAmount = parseFloat((invoice.totalAmount - newPaidAmount).toFixed(2));
            const newStatus = newBalanceAmount <= tolerance ? 'Paid' : 'Partial';

            const updatedInvoice = await tx.posinvoice.update({
                where: { id: invoice.id },
                data: {
                    paidAmount: newPaidAmount,
                    balanceAmount: newBalanceAmount,
                    status: newStatus,
                    updatedAt: new Date()
                }
            });

            // Sync customer balance to customer table for consistency
            if (invoice.customerId) {
                const customer = await tx.customer.findUnique({ where: { id: invoice.customerId } });
                if (customer && customer.ledgerId) {
                    const ledger = await tx.ledger.findUnique({ where: { id: customer.ledgerId } });
                    if (ledger) {
                        await tx.customer.update({
                            where: { id: customer.id },
                            data: { accountBalance: ledger.currentBalance }
                        });
                    }
                }
            }

            return updatedInvoice;
        }, {
            maxWait: 15000,
            timeout: 90000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'POS', result.id, `Payment of ${parsedAmount} recorded for POS Invoice #${result.invoiceNumber}`);

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        console.error('Record POS Payment Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createPOSInvoice,
    getPOSInvoices,
    getPOSInvoiceById,
    deletePOSInvoice,
    getPublicPOSInvoiceById,
    updatePOSInvoice,
    getNextNumber,
    recordPOSPayment
};
