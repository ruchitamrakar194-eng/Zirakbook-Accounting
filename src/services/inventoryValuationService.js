/**
 * Inventory Valuation Service
 * Supports: FIFO (First In First Out) and WAC (Weighted Average Cost)
 * 
 * This service handles:
 * - Stock In: on purchase bill creation (FIFO batch layers, WAC average cost update)
 * - Stock Out: on sales invoice creation (FIFO layer consumption, WAC deduction)
 * - Reversal: on bill/invoice deletion or update
 */

const prisma = require('../config/prisma');

/**
 * Get the company's inventory configuration
 * @param {number} companyId
 * @returns {Object} inventoryConfig
 */
const getInventoryConfig = async (companyId) => {
    const company = await prisma.company.findUnique({
        where: { id: parseInt(companyId) },
        select: { inventoryConfig: true }
    });
    if (company && company.inventoryConfig) {
        try {
            return typeof company.inventoryConfig === 'string'
                ? JSON.parse(company.inventoryConfig)
                : company.inventoryConfig;
        } catch (e) {}
    }
    return {};
};

/**
 * Record Stock In - called when a purchase bill is created
 * Handles both FIFO batch layers and WAC average cost update
 * 
 * @param {PrismaClient} tx - Prisma transaction client
 * @param {Object} params
 * @param {number} params.companyId
 * @param {number} params.productId
 * @param {number} params.warehouseId
 * @param {number} params.quantity
 * @param {number} params.rate - Net rate (after item discount)
 * @param {number|null} params.purchaseBillId
 * @param {string} params.method - 'FIFO' or 'WAC'
 * @param {boolean} params.isOpeningStock
 */
const recordStockIn = async (tx, { companyId, productId, warehouseId, quantity, rate, purchaseBillId = null, method = 'WAC', isOpeningStock = false }) => {
    const qty = parseFloat(quantity);
    const unitRate = parseFloat(rate);

    if (isNaN(qty) || qty <= 0 || isNaN(unitRate)) return;

    // 1. FIFO: Always create a new inventory batch layer
    await tx.inventory_batch.create({
        data: {
            productId: parseInt(productId),
            warehouseId: parseInt(warehouseId),
            purchaseBillId: purchaseBillId ? parseInt(purchaseBillId) : null,
            qtyReceived: qty,
            qtyRemaining: qty,
            rate: unitRate,
        }
    });

    // 2. WAC: Always update the weighted average cost on the product
    const currentProduct = await tx.product.findUnique({
        where: { id: parseInt(productId) },
        select: { totalQty: true, totalInventoryValue: true, averageCost: true }
    });

    const currentQty = parseFloat(currentProduct?.totalQty || 0);
    const currentValue = parseFloat(currentProduct?.totalInventoryValue || 0);

    const newTotalQty = currentQty + qty;
    const newTotalValue = currentValue + (qty * unitRate);
    const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

    await tx.product.update({
        where: { id: parseInt(productId) },
        data: {
            totalQty: newTotalQty,
            totalInventoryValue: newTotalValue,
            averageCost: newAverageCost,
        }
    });
};

/**
 * Consume Stock Out - called when a sales invoice is created
 * Returns total COGS (Cost of Goods Sold) amount
 * 
 * @param {PrismaClient} tx - Prisma transaction client
 * @param {Object} params
 * @param {number} params.companyId
 * @param {number} params.productId
 * @param {number} params.warehouseId
 * @param {number} params.quantity
 * @param {number} params.invoiceId
 * @param {string} params.method - 'FIFO' or 'WAC'
 * @param {boolean} params.negativeStockAllow
 * @returns {number} totalCOGS
 */
const consumeStock = async (tx, { companyId, productId, warehouseId, quantity, invoiceId, method = 'WAC', negativeStockAllow = true, isPOS = false }) => {
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) return 0;

    // ✅ AUTHORITATIVE STOCK CHECK: Always use physical stock table for quantity validation
    // FIFO batches / WAC totalQty can be out of sync for legacy products
    const stockRecord = await tx.stock.findFirst({
        where: { productId: parseInt(productId), warehouseId: parseInt(warehouseId) },
        select: { quantity: true }
    });
    const physicalStock = parseFloat(stockRecord?.quantity || 0);

    if (!negativeStockAllow && physicalStock < qty) {
        throw new Error(`Insufficient stock for product ID ${productId}. Available: ${physicalStock}, Required: ${qty}`);
    }

    // --- 1. FIFO logic (for COST only, not quantity gating) ---
    let fifoCOGS = 0;
    const batches = await tx.inventory_batch.findMany({
        where: {
            productId: parseInt(productId),
            warehouseId: parseInt(warehouseId),
            qtyRemaining: { gt: 0 }
        },
        orderBy: { createdAt: 'asc' }
    });

    let remaining = qty;
    for (const batch of batches) {
        if (remaining <= 0) break;

        const consumeQty = Math.min(batch.qtyRemaining, remaining);
        const consumeCost = consumeQty * batch.rate;

        // Log consumption only for standard invoices (since POS invoices don't use this table)
        if (invoiceId && !isPOS) {
            await tx.inventory_consumption.create({
                data: {
                    invoiceId: parseInt(invoiceId),
                    productId: parseInt(productId),
                    batchId: batch.id,
                    qtyUsed: consumeQty,
                    rateUsed: batch.rate,
                    totalCost: consumeCost
                }
            });
        }

        // Decrement batch remaining quantity
        await tx.inventory_batch.update({
            where: { id: batch.id },
            data: { qtyRemaining: { decrement: consumeQty } }
        });

        fifoCOGS += consumeCost;
        remaining -= consumeQty;
    }

    // --- 2. WAC logic ---
    const currentProduct = await tx.product.findUnique({
        where: { id: parseInt(productId) },
        select: { totalQty: true, totalInventoryValue: true, averageCost: true, purchasePrice: true, initialCost: true }
    });

    const currentQty = parseFloat(currentProduct?.totalQty || 0);
    let averageCost = parseFloat(currentProduct?.averageCost || 0);

    // ✅ FALLBACK: If averageCost is 0, use purchasePrice or initialCost so COGS is never 0
    if (averageCost === 0) {
        averageCost = parseFloat(currentProduct?.purchasePrice || currentProduct?.initialCost || 0);
    }

    const wacCOGS = qty * averageCost;

    // Deduct from WAC tracking fields
    const newTotalQty = Math.max(0, currentQty - qty);
    const newTotalValue = Math.max(0, parseFloat(currentProduct?.totalInventoryValue || 0) - wacCOGS);

    await tx.product.update({
        where: { id: parseInt(productId) },
        data: {
            totalQty: newTotalQty,
            totalInventoryValue: newTotalValue,
            averageCost: newTotalQty > 0 ? newTotalValue / newTotalQty : averageCost,
        }
    });

    // ✅ FIFO FALLBACK: If no batches existed (legacy product), use purchasePrice for FIFO too
    if (method === 'FIFO' && fifoCOGS === 0 && averageCost > 0) {
        fifoCOGS = qty * averageCost;
    }

    // Return the COGS cost based on active valuation setting
    return method === 'FIFO' ? fifoCOGS : wacCOGS;
};


/**
 * Reverse Stock In - called when a purchase bill is deleted or updated (reversion)
 * 
 * @param {PrismaClient} tx - Prisma transaction client
 * @param {Object} params
 * @param {number} params.purchaseBillId
 * @param {Array} params.billItems - array of { productId, warehouseId, quantity, rate }
 * @param {string} params.method - 'FIFO' or 'WAC'
 */
const reverseStockIn = async (tx, { purchaseBillId, billItems = [], method = 'WAC' }) => {
    // 1. FIFO: Delete FIFO batch layers created for this purchase bill
    await tx.inventory_batch.deleteMany({
        where: { purchaseBillId: parseInt(purchaseBillId) }
    });

    // 2. WAC: Reverse the average cost calculation for each item
    for (const item of billItems) {
        if (!item.productId || !item.quantity || !item.rate) continue;

        const qty = parseFloat(item.quantity);
        const rate = parseFloat(item.rate);
        const reversalValue = qty * rate;

        const currentProduct = await tx.product.findUnique({
            where: { id: parseInt(item.productId) },
            select: { totalQty: true, totalInventoryValue: true }
        });

        const newTotalQty = Math.max(0, parseFloat(currentProduct?.totalQty || 0) - qty);
        const newTotalValue = Math.max(0, parseFloat(currentProduct?.totalInventoryValue || 0) - reversalValue);
        const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

        await tx.product.update({
            where: { id: parseInt(item.productId) },
            data: {
                totalQty: newTotalQty,
                totalInventoryValue: newTotalValue,
                averageCost: newAverageCost,
            }
        });
    }
};

/**
 * Reverse Stock Out - called when a sales invoice is deleted or updated (reversion)
 * Restores FIFO batch layers and WAC values
 * 
 * @param {PrismaClient} tx - Prisma transaction client
 * @param {Object} params
 * @param {number} params.invoiceId
 * @param {Array} params.invoiceItems - array of { productId, warehouseId, quantity }
 * @param {string} params.method - 'FIFO' or 'WAC'
 */
const reverseStockOut = async (tx, { invoiceId, invoiceItems = [], method = 'WAC' }) => {
    // 1. FIFO: Restore each batch's qtyRemaining
    const consumptions = await tx.inventory_consumption.findMany({
        where: { invoiceId: parseInt(invoiceId) }
    });

    for (const c of consumptions) {
        await tx.inventory_batch.update({
            where: { id: c.batchId },
            data: { qtyRemaining: { increment: c.qtyUsed } }
        });
    }

    // Delete consumption logs
    await tx.inventory_consumption.deleteMany({
        where: { invoiceId: parseInt(invoiceId) }
    });

    // 2. WAC: Restore the average cost for each product
    for (const item of invoiceItems) {
        if (!item.productId || !item.quantity) continue;

        const qty = parseFloat(item.quantity);

        const currentProduct = await tx.product.findUnique({
            where: { id: parseInt(item.productId) },
            select: { totalQty: true, totalInventoryValue: true, averageCost: true }
        });

        const averageCost = parseFloat(currentProduct?.averageCost || 0);
        const restorationValue = qty * averageCost;

        const newTotalQty = parseFloat(currentProduct?.totalQty || 0) + qty;
        const newTotalValue = parseFloat(currentProduct?.totalInventoryValue || 0) + restorationValue;

        await tx.product.update({
            where: { id: parseInt(item.productId) },
            data: {
                totalQty: newTotalQty,
                totalInventoryValue: newTotalValue,
                averageCost: newTotalQty > 0 ? newTotalValue / newTotalQty : averageCost,
            }
        });
    }
};

/**
 * Calculate net item rate after applying line-level discount
 * 
 * @param {number} rate - Unit rate
 * @param {number} quantity - Quantity
 * @param {number} lineDiscount - Line-level discount amount
 * @returns {number} Net unit rate after discount
 */
const calculateNetRate = (rate, quantity, lineDiscount = 0) => {
    const totalBeforeDiscount = parseFloat(rate) * parseFloat(quantity);
    const discountedTotal = totalBeforeDiscount - parseFloat(lineDiscount || 0);
    return parseFloat(quantity) > 0 ? discountedTotal / parseFloat(quantity) : parseFloat(rate);
};

/**
 * Post COGS Journal Entry (Dr Cost of Goods Sold / Cr Inventory Asset)
 * 
 * @param {PrismaClient} tx
 * @param {Object} params
 * @param {number} params.companyId
 * @param {number} params.invoiceId
 * @param {string} params.invoiceNumber
 * @param {Date} params.date
 * @param {number} params.cogsAmount
 */
const postCogsEntry = async (tx, { companyId, invoiceId, invoiceNumber, date, cogsAmount }) => {
    if (!cogsAmount || cogsAmount <= 0) return;

    // Resolve ledgers
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

    const cogsLedger = await resolveLedger('Cost of Goods Sold', 'EXPENSES') || await resolveLedger('COGS', 'EXPENSES');
    const inventoryAssetLedger = await resolveLedger('Inventory Asset', 'ASSETS') || await resolveLedger('Inventory', 'ASSETS');

    if (!cogsLedger || !inventoryAssetLedger) return;

    // Create COGS journal entry
    const journalEntry = await tx.journalentry.create({
        data: {
            date: new Date(date),
            voucherNumber: `COGS-${invoiceNumber}`,
            narration: `Cost of Goods Sold - Invoice #${invoiceNumber}`,
            companyId: parseInt(companyId)
        }
    });

    // Dr COGS / Cr Inventory Asset
    await tx.transaction.create({
        data: {
            date: new Date(date),
            amount: cogsAmount,
            debitLedgerId: cogsLedger.id,
            creditLedgerId: inventoryAssetLedger.id,
            voucherType: 'SALES',
            voucherNumber: `COGS-${invoiceNumber}`,
            companyId: parseInt(companyId),
            journalEntryId: journalEntry.id,
            invoiceId: parseInt(invoiceId),
            narration: `COGS for Invoice #${invoiceNumber}`
        }
    });

    // Update ledger balances
    await tx.ledger.update({ where: { id: cogsLedger.id }, data: { currentBalance: { increment: cogsAmount } } });
    await tx.ledger.update({ where: { id: inventoryAssetLedger.id }, data: { currentBalance: { decrement: cogsAmount } } });
};

/**
 * Reverse COGS Journal Entry - called when invoice is deleted/updated
 * 
 * @param {PrismaClient} tx
 * @param {number} invoiceId
 * @param {number} companyId
 */
const reverseCogsEntry = async (tx, invoiceId, companyId) => {
    // Find COGS transactions for this invoice
    const cogsTransactions = await tx.transaction.findMany({
        where: {
            invoiceId: parseInt(invoiceId),
            companyId: parseInt(companyId),
            narration: { contains: 'COGS' }
        }
    });

    for (const trans of cogsTransactions) {
        // Reverse ledger balances
        await tx.ledger.update({ where: { id: trans.debitLedgerId }, data: { currentBalance: { decrement: trans.amount } } });
        await tx.ledger.update({ where: { id: trans.creditLedgerId }, data: { currentBalance: { increment: trans.amount } } });
    }

    // Delete COGS transactions
    await tx.transaction.deleteMany({
        where: {
            invoiceId: parseInt(invoiceId),
            companyId: parseInt(companyId),
            narration: { contains: 'COGS' }
        }
    });

    // Delete COGS journal entries
    const journalEntries = await tx.journalentry.findMany({
        where: {
            companyId: parseInt(companyId),
            voucherNumber: { startsWith: 'COGS-' }
        },
        include: { transaction: true }
    });

    for (const je of journalEntries) {
        if (je.transaction.length === 0) {
            await tx.journalentry.delete({ where: { id: je.id } });
        }
    }
};

module.exports = {
    getInventoryConfig,
    recordStockIn,
    consumeStock,
    reverseStockIn,
    reverseStockOut,
    calculateNetRate,
    postCogsEntry,
    reverseCogsEntry
};
