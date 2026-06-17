const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const numberingService = require('../services/numberingService');

// Create Sales Return
const createReturn = async (req, res) => {
    try {
        const { returnNumber, date, customerId, invoiceId, items, reason, manualVoucherNo, customFields } = req.body;
        const companyId = req.user.companyId;

        if (!returnNumber || !customerId || !items || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide all required fields' });
        }

        const customer = await prisma.customer.findUnique({
            where: { id: parseInt(customerId) },
            include: { ledger: true }
        });

        // Check customer ledger
        if (!customer || !customer.ledgerId) {
            return res.status(400).json({ success: false, message: 'Customer ledger not found. Please ensure customer has a ledger configured.' });
        }

        let totalAmount = 0;
        const returnItems = items.map(item => {
            const amount = (parseFloat(item.quantity) || 0) * (parseFloat(item.rate) || 0);
            totalAmount += amount;
            return {
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: parseFloat(item.quantity),
                rate: parseFloat(item.rate),
                amount: amount
            };
        });

        const result = await prisma.$transaction(async (tx) => {
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

            // Generate Auto Voucher No (inside transaction for consistency)
            const getAutoVoucherNo = async (companyId) => {
                const count = await tx.transaction.count({
                    where: { companyId: parseInt(companyId), voucherType: 'SALES_RETURN' }
                });
                return `SRT-${String(count + 1).padStart(6, '0')}`;
            };

            const autoVoucherNo = await getAutoVoucherNo(companyId);

            // 1. Create Sales Return
            const salesReturn = await tx.salesreturn.create({
                data: {
                    returnNumber,
                    manualVoucherNo: manualVoucherNo || null,
                    autoVoucherNo: autoVoucherNo,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: invoiceId ? parseInt(invoiceId) : null,
                    companyId: parseInt(companyId),
                    totalAmount,
                    reason,
                    status: 'Pending', // Default status
                    customFields: customFields ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : null,
                    salesreturnitem: {
                        create: returnItems
                    }
                }
            });

            // 2. Inventory IN Logic
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
                        companyId: parseInt(companyId)
                    }
                });
            }

            // 3. Update Invoice Balance if linked
            if (invoiceId) {
                const invoice = await tx.invoice.findUnique({ where: { id: parseInt(invoiceId) } });
                if (invoice) {
                    // Treat return as a "payment" (credit) towards the invoice balance
                    const newPaid = invoice.paidAmount + totalAmount;
                    const newBalance = Math.max(0, invoice.totalAmount - newPaid);

                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            paidAmount: newPaid,
                            balanceAmount: newBalance,
                            status: newBalance <= 0 ? 'PAID' : (newPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // 4. Accounting Entry (Main)
            // DR Sales Return, CR Customer
            await tx.ledger.update({
                where: { id: returnLedger.id },
                data: { currentBalance: { increment: totalAmount } }
            });

            await tx.ledger.update({
                where: { id: customer.ledgerId },
                data: { currentBalance: { decrement: totalAmount } }
            });

            await tx.transaction.create({
                data: {
                    date: new Date(date),
                    voucherType: 'SALES_RETURN',
                    voucherNumber: autoVoucherNo, // Use auto voucher number
                    debitLedgerId: returnLedger.id,
                    creditLedgerId: customer.ledgerId,
                    amount: totalAmount,
                    narration: `Sales Return from ${customer.name}${invoiceId ? ' for Invoice ID: ' + invoiceId : ''}`,
                    companyId: parseInt(companyId),
                    invoiceId: invoiceId ? parseInt(invoiceId) : null
                }
            });

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
                const cogsLedger = await resolveLedger(tx, 'Cost of Goods Sold', 'EXPENSES') || await resolveLedger(tx, 'COGS', 'EXPENSES');

                if (inventoryLedger && cogsLedger) {

                    await tx.transaction.create({
                        data: {
                            date: new Date(date),
                            voucherType: 'JOURNAL',
                            voucherNumber: `COGS-REV-${autoVoucherNo}`,
                            debitLedgerId: inventoryLedger.id,
                            creditLedgerId: cogsLedger.id,
                            amount: totalReturnCOGS,
                            narration: `COGS Reversal for Return: ${returnNumber}`,
                            companyId: parseInt(companyId),
                        }
                    });

                    await tx.ledger.update({ where: { id: inventoryLedger.id }, data: { currentBalance: { increment: totalReturnCOGS } } });
                    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { decrement: totalReturnCOGS } } });
                }
            }


            return salesReturn;
        }, { timeout: 30000 });

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

        res.status(200).json({ success: true, data: returns });
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
            include: { salesreturnitem: true }
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
        const returnItems = items.map(item => {
            const amount = parseFloat(item.quantity) * parseFloat(item.rate);
            totalAmount += amount;
            return {
                productId: parseInt(item.productId),
                warehouseId: parseInt(item.warehouseId),
                quantity: parseFloat(item.quantity),
                rate: parseFloat(item.rate),
                amount: amount
            };
        });

        const result = await prisma.$transaction(async (tx) => {
            // Delete old items
            await tx.salesreturnitem.deleteMany({
                where: { salesReturnId: parseInt(id) }
            });

            // Update sales return
            const updated = await tx.salesreturn.update({
                where: { id: parseInt(id) },
                data: {
                    returnNumber,
                    manualVoucherNo: manualVoucherNo || null,
                    date: new Date(date),
                    customerId: parseInt(customerId),
                    invoiceId: invoiceId ? parseInt(invoiceId) : null,
                    totalAmount,
                    reason,
                    customFields: customFields !== undefined ? (typeof customFields === 'string' ? customFields : JSON.stringify(customFields)) : undefined,
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

            return updated;
        }, { timeout: 30000 });

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
            if (salesReturn.invoiceId) {
                const invoice = await tx.invoice.findUnique({ where: { id: salesReturn.invoiceId } });
                if (invoice) {
                    const revPaid = Math.max(0, (invoice.paidAmount || 0) - salesReturn.totalAmount);
                    const revBalance = (invoice.totalAmount || 0) - revPaid;

                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            paidAmount: revPaid,
                            balanceAmount: revBalance,
                            status: revBalance <= 0 ? 'PAID' : (revPaid > 0 ? 'PARTIAL' : 'UNPAID')
                        }
                    });
                }
            }

            // 3. Reverse Accounting Entry
            let returnLedger = await tx.ledger.findFirst({
                where: { companyId: parseInt(companyId), name: { contains: 'Return' }, accountgroup: { type: 'EXPENSES' } }
            });
            if (!returnLedger) {
                returnLedger = await tx.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: { contains: 'Return' }, accountgroup: { type: 'INCOME' } }
                });
            }

            if (returnLedger) {
                await tx.ledger.update({
                    where: { id: returnLedger.id },
                    data: { currentBalance: { decrement: salesReturn.totalAmount } }
                });
            }

            if (salesReturn.customer && salesReturn.customer.ledgerId) {
                const customerLedger = await tx.ledger.findUnique({ where: { id: salesReturn.customer.ledgerId } });
                if (customerLedger) {
                    await tx.ledger.update({
                        where: { id: salesReturn.customer.ledgerId },
                        data: { currentBalance: { increment: salesReturn.totalAmount } }
                    });
                }
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
            timeout: 30000
        });

        res.status(200).json({ success: true, message: 'Sales return deleted successfully' });
    } catch (error) {
        console.error('Sales Return Delete Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createReturn,
    getReturns,
    getReturnById,
    updateReturn,
    deleteReturn
};
