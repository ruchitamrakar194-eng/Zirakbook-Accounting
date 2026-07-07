const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { getConversionRate, getCompanyCurrency, getCompanyHistoricalCurrency } = require('../utils/currencyConverter');

// Helper to calculate total inventory value for a company as of now
const calculateInventoryValue = async (companyId) => {
    try {
        const stocks = await prisma.stock.findMany({
            where: { product: { companyId: parseInt(companyId) } },
            include: { product: true }
        });

        let totalValue = 0;
        stocks.forEach(s => {
            const price = s.product.purchasePrice || s.product.initialCost || 0;
            totalValue += (s.quantity * price);
        });
        return totalValue;
    } catch (error) {
        console.error("Error calculating inventory value:", error);
        return 0;
    }
};

// Helper to ensure critical inventory ledgers exist
const ensureInventoryLedgers = async (companyId) => {
    try {
        const companyIdInt = parseInt(companyId);

        // Find Groups
        const assetsGroup = await prisma.accountgroup.findFirst({ where: { companyId: companyIdInt, type: 'ASSETS' } });
        const equityGroup = await prisma.accountgroup.findFirst({ where: { companyId: companyIdInt, type: 'EQUITY' } });

        if (!assetsGroup || !equityGroup) return;

        // Check/Create Inventory Asset
        await prisma.ledger.upsert({
            where: { companyId_name: { companyId: companyIdInt, name: 'Inventory Asset' } },
            update: {},
            create: {
                name: 'Inventory Asset',
                groupId: assetsGroup.id,
                companyId: companyIdInt,
                isControlAccount: true
            }
        });

        // Check/Create Opening Balance Equity
        await prisma.ledger.upsert({
            where: { companyId_name: { companyId: companyIdInt, name: 'Opening Balance Equity' } },
            update: {},
            create: {
                name: 'Opening Balance Equity',
                groupId: equityGroup.id,
                companyId: companyIdInt
            }
        });
    } catch (e) {
        console.error("Error ensuring inventory ledgers:", e);
    }
};

// Helper: set time to end of day (23:59:59.999) for inclusive date filtering
const toEndOfDay = (dateStr) => {
    const d = new Date(dateStr);
    d.setHours(23, 59, 59, 999);
    return d;
};

const getSalesReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const { startDate, endDate } = req.query;

        let whereClause = {
            companyId: parseInt(companyId)
        };

        if (startDate && endDate) {
            whereClause.date = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const salesReport = await prisma.invoice.findMany({
            where: whereClause,
            include: {
                customer: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                invoiceitem: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                stock: true
                            }
                        },
                        warehouse: true
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });
        // Calculate Summary Stats & Convert to Base Currency
        const now = new Date();
        const companyCurrency = await getCompanyCurrency(companyId);
        const convertedSalesReport = await Promise.all(salesReport.map(async inv => {
            const rate = await getConversionRate(inv.currency || 'USD', companyCurrency);
            return {
                ...inv,
                subtotal: inv.subtotal * rate,
                discountAmount: inv.discountAmount * rate,
                taxAmount: inv.taxAmount * rate,
                totalAmount: inv.totalAmount * rate,
                paidAmount: inv.paidAmount * rate,
                balanceAmount: inv.balanceAmount * rate,
                invoiceitem: inv.invoiceitem.map(item => ({
                    ...item,
                    rate: item.rate * rate,
                    amount: item.amount * rate
                }))
            };
        }));

        const summary = convertedSalesReport.reduce((acc, inv) => {
            const total = inv.totalAmount || 0;
            const unpaid = inv.balanceAmount || 0;
            const paid = total - unpaid;

            acc.totalAmount += total;
            acc.totalPaid += paid;
            acc.totalUnpaid += unpaid;

            if (inv.dueDate && new Date(inv.dueDate) < now && unpaid > 0) {
                acc.overdue += unpaid;
            }

            return acc;
        }, {
            totalAmount: 0,
            totalPaid: 0,
            totalUnpaid: 0,
            overdue: 0
        });

        res.status(200).json({ success: true, data: convertedSalesReport, summary });

    } catch (error) {
        console.error('Error fetching sales report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const getSalesByItemReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { startDate, endDate } = req.query;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const invoiceItems = await prisma.invoiceitem.findMany({
            where: {
                invoice: { companyId: parseInt(companyId), date: dateFilter }
            },
            include: {
                product: { include: { category: true } },
                invoice: { select: { date: true, invoiceNumber: true, exchangeRate: true, currency: true } }
            }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const grouped = {};
        for (const item of invoiceItems) {
            const productId = item.productId || 'service-' + (item.serviceId || 'unknown');
            const productName = item.product?.name || item.description || 'Unknown';
            const rate = await getConversionRate(item.invoice?.currency || 'USD', companyCurrency);

            if (!grouped[productId]) {
                grouped[productId] = {
                    productId,
                    productName,
                    sku: item.product?.sku || '-',
                    category: item.product?.category?.name || 'Uncategorized',
                    totalQty: 0,
                    totalAmount: 0,
                    invoiceCount: 0,
                    invoiceIds: new Set()
                };
            }
            grouped[productId].invoiceIds.add(item.invoiceId);
            grouped[productId].totalQty += item.quantity;
            grouped[productId].totalAmount += item.amount * rate;
        }

        const result = Object.values(grouped).map(({ invoiceIds, ...item }) => ({
            ...item,
            invoiceCount: invoiceIds.size,
            avgRate: item.totalQty > 0 ? (item.totalAmount / item.totalQty).toFixed(2) : 0
        }));

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSalesByCustomerReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { startDate, endDate } = req.query;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const invoices = await prisma.invoice.findMany({
            where: { companyId: parseInt(companyId), date: dateFilter },
            include: { customer: true }
        });

        const posInvoices = await prisma.posinvoice.findMany({
            where: { companyId: parseInt(companyId), date: dateFilter },
            include: { customer: true }
        });

        const allInvoices = [...invoices, ...posInvoices];

        const companyCurrency = await getCompanyCurrency(companyId);
        const grouped = {};
        for (const inv of allInvoices) {
            const customerId = inv.customerId || 'walk-in';
            const customerName = inv.customer?.name || 'Walk-in Customer';
            const rate = await getConversionRate(inv.currency || 'USD', companyCurrency);

            if (!grouped[customerId]) {
                grouped[customerId] = {
                    customerId,
                    customerName,
                    totalInvoices: 0,
                    totalSales: 0,
                    totalPaid: 0,
                    totalPending: 0
                };
            }
            grouped[customerId].totalInvoices += 1;
            grouped[customerId].totalSales += inv.totalAmount * rate;
            grouped[customerId].totalPaid += (inv.paidAmount || 0) * rate;
            grouped[customerId].totalPending += (inv.balanceAmount || 0) * rate;
        }

        res.status(200).json({ success: true, data: Object.values(grouped) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getSalesBySalesmanReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { startDate, endDate } = req.query;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = { gte: new Date(startDate), lte: toEndOfDay(endDate) };
        }

        const invoices = await prisma.invoice.findMany({
            where: { companyId: parseInt(companyId), date: dateFilter }
        });

        const posInvoices = await prisma.posinvoice.findMany({
            where: { companyId: parseInt(companyId), date: dateFilter }
        });

        const allInvoices = [...invoices, ...posInvoices];
        const companyCurrency = await getCompanyCurrency(companyId);
        const grouped = {};
        for (const inv of allInvoices) {
            const salesman = 'Administrator';
            const rate = await getConversionRate(inv.currency || 'USD', companyCurrency);
            if (!grouped[salesman]) {
                grouped[salesman] = { salesman, totalInvoices: 0, totalSales: 0, totalPaid: 0, totalPending: 0 };
            }
            grouped[salesman].totalInvoices += 1;
            grouped[salesman].totalSales += inv.totalAmount * rate;
            grouped[salesman].totalPaid += (inv.paidAmount || 0) * rate;
            grouped[salesman].totalPending += (inv.balanceAmount || 0) * rate;
        }

        res.status(200).json({ success: true, data: Object.values(grouped) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPurchaseReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const { startDate, endDate } = req.query;

        let whereClause = {
            companyId: parseInt(companyId)
        };

        if (startDate && endDate) {
            whereClause.date = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const purchaseReport = await prisma.purchasebill.findMany({
            where: whereClause,
            include: {
                vendor: {
                    select: {
                        name: true,
                        email: true
                    }
                },
                purchasebillitem: {
                    include: {
                        product: {
                            include: {
                                category: true,
                                stock: true
                            }
                        },
                        warehouse: true
                    }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });

        // Convert to Base Currency
        const companyCurrency = await getCompanyCurrency(companyId);
        const convertedPurchaseReport = await Promise.all(purchaseReport.map(async bill => {
            const rate = await getConversionRate(bill.currency || 'USD', companyCurrency);
            return {
                ...bill,
                subtotal: (bill.subtotal || 0) * rate,
                discountAmount: (bill.discountAmount || 0) * rate,
                taxAmount: (bill.taxAmount || 0) * rate,
                totalAmount: (bill.totalAmount || 0) * rate,
                paidAmount: ((bill.totalAmount || 0) - (bill.balanceAmount || 0)) * rate,
                balanceAmount: (bill.balanceAmount || 0) * rate,
                purchasebillitem: bill.purchasebillitem.map(item => ({
                    ...item,
                    rate: (item.rate || 0) * rate,
                    amount: (item.amount || 0) * rate
                }))
            };
        }));

        // Calculate Summary Stats
        const now = new Date();
        const summary = convertedPurchaseReport.reduce((acc, bill) => {
            const total = bill.totalAmount || 0;
            const unpaid = bill.balanceAmount || 0;
            const paid = total - unpaid;

            acc.totalAmount += total;
            acc.totalPaid += paid;
            acc.totalUnpaid += unpaid;

            if (bill.dueDate && new Date(bill.dueDate) < now && unpaid > 0) {
                acc.overdue += unpaid;
            }

            return acc;
        }, {
            totalAmount: 0,
            totalPaid: 0,
            totalUnpaid: 0,
            overdue: 0
        });

        res.status(200).json({ success: true, data: convertedPurchaseReport, summary });
    } catch (error) {
        console.error('Error fetching purchase report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const getPurchaseByItemReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { startDate, endDate } = req.query;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const billItems = await prisma.purchasebillitem.findMany({
            where: {
                purchasebill: { companyId: parseInt(companyId), date: dateFilter }
            },
            include: {
                product: { include: { category: true } },
                purchasebill: { select: { date: true, billNumber: true, exchangeRate: true, currency: true } }
            }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const grouped = {};
        for (const item of billItems) {
            const productId = item.productId || 'unknown';
            const productName = item.product?.name || item.description || 'Unknown';
            const rate = await getConversionRate(item.purchasebill?.currency || 'USD', companyCurrency);

            if (!grouped[productId]) {
                grouped[productId] = {
                    productId,
                    productName,
                    sku: item.product?.sku || '-',
                    category: item.product?.category?.name || 'Uncategorized',
                    totalQty: 0,
                    totalAmount: 0,
                    billCount: 0,
                    billIds: new Set()
                };
            }
            grouped[productId].billIds.add(item.purchaseBillId);
            grouped[productId].totalQty += item.quantity;
            grouped[productId].totalAmount += item.amount * rate;
        }

        const result = Object.values(grouped).map(({ billIds, ...item }) => ({
            ...item,
            billCount: billIds.size,
            avgRate: item.totalQty > 0 ? (item.totalAmount / item.totalQty).toFixed(2) : 0
        }));

        res.status(200).json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPurchaseByVendorReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const { startDate, endDate } = req.query;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        let dateFilter = {};
        if (startDate && endDate) {
            dateFilter = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const bills = await prisma.purchasebill.findMany({
            where: { companyId: parseInt(companyId), date: dateFilter },
            include: { vendor: true }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const grouped = {};
        for (const bill of bills) {
            const vendorId = bill.vendorId || 'unknown';
            const vendorName = bill.vendor?.name || 'Unknown Vendor';
            const rate = await getConversionRate(bill.currency || 'USD', companyCurrency);

            if (!grouped[vendorId]) {
                grouped[vendorId] = {
                    vendorId,
                    vendorName,
                    totalBills: 0,
                    totalPurchases: 0,
                    totalPaid: 0,
                    totalPending: 0
                };
            }
            grouped[vendorId].totalBills += 1;
            grouped[vendorId].totalPurchases += bill.totalAmount * rate;
            grouped[vendorId].totalPaid += (bill.totalAmount - bill.balanceAmount) * rate;
            grouped[vendorId].totalPending += bill.balanceAmount * rate;
        }

        res.status(200).json({ success: true, data: Object.values(grouped) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPosReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const { startDate, endDate } = req.query;
        let whereClause = { companyId: parseInt(companyId) };

        if (startDate && endDate) {
            whereClause.createdAt = {
                gte: new Date(startDate),
                lte: toEndOfDay(endDate)
            };
        }

        const posReport = await prisma.posinvoice.findMany({
            where: whereClause,
            include: {
                customer: { select: { name: true } },
                posinvoiceitem: {
                    include: {
                        product: { include: { category: true } }
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);

        // Convert amounts to settings base currency
        const convertedReport = [];
        for (const inv of posReport) {
            const rate = await getConversionRate(inv.currency || histCurr, companyCurrency);
            convertedReport.push({
                ...inv,
                totalAmount: (inv.totalAmount || 0) * rate,
                paidAmount: (inv.paidAmount || 0) * rate,
                balanceAmount: (inv.balanceAmount || 0) * rate,
                taxAmount: (inv.taxAmount || 0) * rate,
                posinvoiceitem: (inv.posinvoiceitem || []).map(item => ({
                    ...item,
                    rate: (item.rate || 0) * rate,
                    amount: (item.amount || 0) * rate
                }))
            });
        }

        // Calculate Stats
        const summary = convertedReport.reduce((acc, inv) => {
            const total = inv.totalAmount || 0;
            acc.totalSales += total;

            // Payment Mode Stats
            const mode = (inv.paymentMode || 'CASH').toUpperCase();
            if (mode === 'CASH') acc.totalCash += total;
            else if (mode === 'CARD') acc.totalCard += total;
            else if (mode === 'UPI') acc.totalUPI += total;
            else acc.totalOther += total;

            return acc;
        }, { totalSales: 0, totalCash: 0, totalCard: 0, totalUPI: 0, totalOther: 0 });

        res.status(200).json({ success: true, data: convertedReport, summary });
    } catch (error) {
        console.error('Error fetching POS report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Tax Report (Monthly Breakdown)
const getTaxReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const year = parseInt(req.query.year) || new Date().getFullYear();

        // Fetch Company Details for State comparison
        const company = await prisma.company.findUnique({
            where: { id: parseInt(companyId) },
            select: { state: true }
        });
        const companyState = company?.state?.toLowerCase().trim();

        // --- 1. INCOME TAX (Sales + POS) ---
        // Fetch Invoices
        const invoices = await prisma.invoice.findMany({
            where: {
                companyId: parseInt(companyId),
                date: {
                    gte: new Date(`${year}-01-01`),
                    lte: new Date(`${year}-12-31`)
                }
            },
            include: { customer: { select: { billingState: true } } }
        });

        // Fetch POS Invoices (Assume Intra-state/CGST+SGST for simplicity unless customer is tagged)
        const posInvoices = await prisma.posinvoice.findMany({
            where: {
                companyId: parseInt(companyId),
                createdAt: {
                    gte: new Date(`${year}-01-01`),
                    lte: toEndOfDay(`${year}-12-31`)
                }
            },
            include: { customer: { select: { billingState: true } } }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);

        const processTax = (amount, date, entityState, targetStats, rate = 1.0) => {
            const month = new Date(date).getMonth(); // 0-11
            const tax = parseFloat(amount || 0) * rate;

            if (tax > 0) {
                // Determine Tax Type
                let isInterState = false;
                if (companyState && entityState) {
                    isInterState = companyState !== entityState.toLowerCase().trim();
                }

                if (isInterState) {
                    targetStats.IGST[month] += tax;
                } else {
                    // Split 50-50
                    targetStats.CGST[month] += tax / 2;
                    targetStats.SGST[month] += tax / 2;
                }
            }
        };

        for (const inv of invoices) {
            const rate = await getConversionRate(inv.currency || 'USD', companyCurrency);
            processTax(inv.taxAmount, inv.date, inv.customer?.billingState, incomeStats, rate);
        }

        for (const pos of posInvoices) {
            const rate = await getConversionRate(pos.currency || histCurr, companyCurrency);
            processTax(pos.taxAmount, pos.createdAt, pos.customer?.billingState || companyState, incomeStats, rate);
        }

        // --- 2. EXPENSE TAX (Purchases) ---
        const bills = await prisma.purchasebill.findMany({
            where: {
                companyId: parseInt(companyId),
                date: {
                    gte: new Date(`${year}-01-01`),
                    lte: toEndOfDay(`${year}-12-31`)
                }
            },
            include: { vendor: { select: { billingState: true } } }
        });

        const expenseStats = {
            CGST: Array(12).fill(0),
            SGST: Array(12).fill(0),
            IGST: Array(12).fill(0)
        };

        for (const bill of bills) {
            const rate = await getConversionRate(bill.currency || 'USD', companyCurrency);
            processTax(bill.taxAmount, bill.date, bill.vendor?.billingState, expenseStats, rate);
        }

        res.status(200).json({
            success: true,
            data: {
                income: incomeStats,
                expense: expenseStats
            }
        });

    } catch (error) {
        console.error('Error fetching Tax report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Inventory Summary
const getInventorySummary = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const { startDate, endDate, warehouseId } = req.query;

        // Get All Stocks
        const stockWhere = { product: { companyId: parseInt(companyId) } };
        if (warehouseId && warehouseId !== 'ALL') {
            stockWhere.warehouseId = parseInt(warehouseId);
        }

        const stocks = await prisma.stock.findMany({
            where: stockWhere,
            include: {
                product: { include: { category: true } },
                warehouse: true
            }
        });

        // Get All Transactions
        const txWhere = { companyId: parseInt(companyId) };
        if (warehouseId && warehouseId !== 'ALL') {
            txWhere.OR = [
                { fromWarehouseId: parseInt(warehouseId) },
                { toWarehouseId: parseInt(warehouseId) }
            ];
        }
        const transactions = await prisma.inventorytransaction.findMany({
            where: txWhere
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        // Map data
        const reportMap = {};

        // Initialize from Stock (Current Closing)
        stocks.forEach(stk => {
            const key = `${stk.productId}-${stk.warehouseId}`;
            reportMap[key] = {
                id: stk.id,
                productId: stk.productId,
                productName: stk.product.name,
                sku: stk.product.sku || 'N/A',
                category: stk.product.category?.name || 'Uncategorized',
                warehouseId: stk.warehouseId,
                warehouse: stk.warehouse.name,
                price: (stk.product.salePrice || 0) * rate, // Sale Price
                costPrice: (stk.product.averageCost || stk.product.purchasePrice || stk.product.initialCost || 0) * rate, // Cost Price
                closing: stk.quantity, // starts as current stock, will adjust if date filter is set
                opening: 0,
                inward: 0,
                outward: 0,
                status: 'In Stock'
            };
        });

        // Parse date filters
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        // If dates are provided, we need to adjust the closing/opening stock based on transaction dates.
        transactions.forEach(txn => {
            const txnDate = new Date(txn.date);

            // Handle OUT from warehouse
            if (txn.fromWarehouseId) {
                // If filtering by a specific warehouse, skip if it doesn't match
                if (warehouseId && warehouseId !== 'ALL' && txn.fromWarehouseId !== parseInt(warehouseId)) {
                    // skip
                } else {
                    const key = `${txn.productId}-${txn.fromWarehouseId}`;
                    if (reportMap[key]) {
                        if (end && txnDate > end) {
                            // transaction happened after endDate, so the stock back then was higher
                            reportMap[key].closing += txn.quantity;
                        } else if (start && txnDate >= start && (!end || txnDate <= end)) {
                            reportMap[key].outward += txn.quantity;
                        } else if (!start && (!end || txnDate <= end)) {
                            reportMap[key].outward += txn.quantity;
                        }
                    }
                }
            }

            // Handle IN to warehouse
            if (txn.toWarehouseId) {
                // If filtering by a specific warehouse, skip if it doesn't match
                if (warehouseId && warehouseId !== 'ALL' && txn.toWarehouseId !== parseInt(warehouseId)) {
                    // skip
                } else {
                    const key = `${txn.productId}-${txn.toWarehouseId}`;
                    if (reportMap[key]) {
                        if (end && txnDate > end) {
                            // transaction happened after endDate, so the stock back then was lower
                            reportMap[key].closing -= txn.quantity;
                        } else if (start && txnDate >= start && (!end || txnDate <= end)) {
                            reportMap[key].inward += txn.quantity;
                        } else if (!start && (!end || txnDate <= end)) {
                            reportMap[key].inward += txn.quantity;
                        }
                    }
                }
            }
        });

        // Now Calculate Opening: Opening = Closing - Inward + Outward
        Object.values(reportMap).forEach(item => {
            item.opening = item.closing - item.inward + item.outward;
            item.openingValue = item.opening * item.costPrice;
            item.inwardValue = item.inward * item.costPrice;
            item.outwardValue = item.outward * item.costPrice;
            item.totalValue = item.closing * item.costPrice; // cost-based valuation
            item.salesValue = item.closing * item.price; // salePrice-based valuation

            if (item.closing <= 0) item.status = 'Out of Stock';
            else if (item.closing < 10) item.status = 'Low Stock';
            else item.status = 'In Stock';
        });

        res.status(200).json({ success: true, data: Object.values(reportMap) });

    } catch (error) {
        console.error('Error fetching Inventory Summary:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Balance Sheet
const getBalanceSheet = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        // Ensure date includes end of day
        const endOfDay = new Date(asOfDate);
        endOfDay.setHours(23, 59, 59, 999);

        // 1. Fetch All Ledgers with Groups
        // Filter by createdAt to exclude accounts that didn't exist yet
        const ledgers = await prisma.ledger.findMany({
            where: {
                companyId: parseInt(companyId),
                createdAt: { lte: endOfDay }
            },
            include: { accountgroup: true, accountsubgroup: true }
        });

        // 2. Fetch Transaction Aggregates up to asOfDate
        // We need Sum(amount) grouped by debitLedgerId and creditLedgerId

        const debitSums = await prisma.transaction.groupBy({
            by: ['debitLedgerId'],
            where: {
                companyId: parseInt(companyId),
                date: { lte: endOfDay }
            },
            _sum: { amount: true }
        });

        const creditSums = await prisma.transaction.groupBy({
            by: ['creditLedgerId'],
            where: {
                companyId: parseInt(companyId),
                date: { lte: endOfDay }
            },
            _sum: { amount: true }
        });

        // Helpers
        const getDebit = (id) => debitSums.find(d => d.debitLedgerId === id)?._sum.amount || 0;
        const getCredit = (id) => creditSums.find(c => c.creditLedgerId === id)?._sum.amount || 0;

        const reportData = {
            assets: { current: [], fixed: [], total: 0 },
            liabilities: { current: [], longTerm: [], total: 0 },
            equity: { items: [], total: 0 },
            netProfit: 0
        };

        let totalIncome = 0;
        let totalExpense = 0;

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        // --- Dynamic Inventory Value (real-time: quantity × cost from stock table) ---
        const currentInventoryValue = (await calculateInventoryValue(companyId)) * rate;

        ledgers.forEach(ledger => {
            if (ledger.name.toLowerCase().includes('opening balance equity')) {
                return;
            }
            const groupType = ledger.accountgroup?.type;
            const opening = (ledger.openingBalance || 0) * rate;

            // Calculate Balance
            // ASSETS, EXPENSES: Debit normal (Opening + Debits - Credits)
            // LIABILITIES, EQUITY, INCOME: Credit normal (Opening + Credits - Debits)
            let balance = 0;
            if (groupType === 'ASSETS' && ledger.name.toLowerCase().includes('inventory asset')) {
                // Always override Inventory Asset with live stock value
                balance = currentInventoryValue;
            } else if (['ASSETS', 'EXPENSES'].includes(groupType)) {
                balance = (getDebit(ledger.id) - getCredit(ledger.id)) * rate;
            } else {
                balance = (getCredit(ledger.id) - getDebit(ledger.id)) * rate;
            }

            // Only process non-zero balances (Equity accounts should always show in Balance Sheet)
            if (Math.abs(balance) < 0.01 && !ledger.name.toLowerCase().includes('inventory asset') && groupType !== 'EQUITY') return;

            const name = ledger.name;

            if (groupType === 'ASSETS') {
                // Improved Grouping Logic - Robust classification
                const groupName = ledger.accountgroup.name.toLowerCase();
                const currentAssetKeywords = [
                    'current assets',
                    'bank',
                    'cash',
                    'receivable',
                    'debtor',
                    'stock',
                    'inventory',
                    'advance',
                    'deposit',
                    'prepaid'
                ];
                // Force customer ledgers or ledgers with current keywords into Current Assets
                const isCurrent = currentAssetKeywords.some(s => groupName.includes(s) || name.toLowerCase().includes(s)) || ledger.customerId !== null;

                if (isCurrent) {
                    reportData.assets.current.push({ id: ledger.id, ledgerId: ledger.id, name, value: balance });
                } else {
                    // Default to Fixed if not Current
                    reportData.assets.fixed.push({ id: ledger.id, ledgerId: ledger.id, name, value: balance });
                }
                reportData.assets.total += balance;

            } else if (groupType === 'LIABILITIES') {
                const groupName = ledger.accountgroup.name.toLowerCase();
                const currentLiabilityKeywords = [
                    'current liabilities',
                    'payable',
                    'creditor',
                    'duties',
                    'tax',
                    'provision',
                    'overdraft',
                    'short-term',
                    'salary',
                    'expense payable'
                ];
                // Force vendor ledgers or current liability keywords into Current Liabilities
                const isCurrent = currentLiabilityKeywords.some(s => groupName.includes(s) || name.toLowerCase().includes(s)) || ledger.vendorId !== null;

                if (isCurrent) {
                    reportData.liabilities.current.push({ id: ledger.id, name, value: balance });
                } else {
                    // Long Term Liabilities
                    reportData.liabilities.longTerm.push({ id: ledger.id, name, value: balance });
                }
                reportData.liabilities.total += balance;

            } else if (groupType === 'EQUITY') {
                reportData.equity.items.push({ id: ledger.id, name, value: balance });
                reportData.equity.total += balance;

            } else if (groupType === 'INCOME') {
                totalIncome += balance;
            } else if (groupType === 'EXPENSES') {
                totalExpense += balance;
            }
        });

        // 2. Calculate Net Profit/Loss
        // Since COGS is already calculated on every invoice, P&L Net Profit is simply Income - Expense.
        // We do NOT add currentInventoryValue here to avoid double counting stock as direct profit.
        const finalNetProfit = totalIncome - totalExpense;
        reportData.netProfit = finalNetProfit;

        // Add Net Profit to Equity
        reportData.equity.items.push({
            name: 'Current Year Earnings (Net Profit)',
            value: finalNetProfit,
            isProfitLoss: true
        });
        reportData.equity.total += finalNetProfit;

        // 4. Dynamic Opening Balance Equity Adjustment
        // dynamicOBE is the exact value needed to balance the equation:
        // Assets = Liabilities + OtherEquity + NetProfit + OBE
        const totalLiabilities = reportData.liabilities.total;
        const totalOtherEquity = reportData.equity.total - finalNetProfit; // subtract NP since it was already added
        const dynamicOBE = reportData.assets.total - totalLiabilities - totalOtherEquity - finalNetProfit;

        reportData.equity.items.push({
            name: 'Opening Balance Equity',
            value: dynamicOBE
        });
        reportData.equity.total += dynamicOBE;

        res.status(200).json({ success: true, data: reportData });

    } catch (error) {
        console.error('Error fetching Balance Sheet:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Cash Flow Statement (Monthly Hybrid: Accrual + Cash)
const getCashFlowStatement = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const year = parseInt(req.query.year) || new Date().getFullYear();

        const companyCurrency = await getCompanyCurrency(companyId);

        // Helpers
        const getMonthlySum = async (model, dateField = 'date', sumField = 'amount') => {
            const items = await model.findMany({
                where: {
                    companyId: parseInt(companyId),
                    [dateField]: {
                        gte: new Date(`${year}-01-01`),
                        lte: toEndOfDay(`${year}-12-31`)
                    }
                }
            });

            // Aggregate by month (0-11)
            const monthly = Array(12).fill(0);
            for (const item of items) {
                const d = new Date(item[dateField]);
                const month = d.getMonth(); // 0-11
                const rate = await getConversionRate(item.currency || 'USD', companyCurrency);
                const val = (item[sumField] || 0) * rate;
                monthly[month] += val;
            }
            return monthly;
        };

        // 1. Fetch Income Components
        // Revenue -> Receipts (Cash In)
        const receipts = await getMonthlySum(prisma.receipt, 'date', 'amount');
        // Invoice -> Sales (Accrual)
        const invoices = await getMonthlySum(prisma.invoice, 'date', 'totalAmount');

        // 2. Fetch Expense Components
        // Payment -> Payments (Cash Out)
        const payments = await getMonthlySum(prisma.payment, 'date', 'amount');
        // Bill -> Purchases (Accrual)
        const bills = await getMonthlySum(prisma.purchasebill, 'date', 'totalAmount');

        res.status(200).json({
            success: true,
            data: {
                revenue: receipts,
                invoice: invoices,
                payment: payments,
                bill: bills
            }
        });

    } catch (error) {
        console.error('Error fetching Cash Flow:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Profit & Loss Report
const getProfitLoss = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });


        const { startDate: qStart, endDate: qEnd, year: qYear } = req.query;

        // Determine date range
        let startDate, endDate, year;
        if (qStart && qEnd) {
            startDate = new Date(qStart);
            endDate = new Date(qEnd);
            endDate.setHours(23, 59, 59, 999);
            year = startDate.getFullYear(); // For growth comparison fallback
        } else {
            year = parseInt(qYear) || new Date().getFullYear();
            startDate = new Date(`${year}-01-01`);
            endDate = new Date(`${year}-12-31`);
            endDate.setHours(23, 59, 59, 999);
        }

        const prevYear = year - 1;

        // Helper to fetch ledger balances matching type
        const fetchLedgerData = async (start, end) => {
            // Fetch Ledgers with Group and Sub-Group info
            const ledgers = await prisma.ledger.findMany({
                where: {
                    companyId: parseInt(companyId),
                    accountgroup: {
                        type: { in: ['INCOME', 'EXPENSES'] }
                    }
                },
                include: {
                    accountgroup: true,
                    accountsubgroup: true
                }
            });

            const transactions = await prisma.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    date: { gte: start, lte: end }
                }
            });

            const companyCurrency = await getCompanyCurrency(companyId);
            const histCurr = await getCompanyHistoricalCurrency(companyId);
            const rate = await getConversionRate(histCurr, companyCurrency);

            // Process Data
            let totalIncome = 0;
            let totalExpense = 0;
            const monthlyData = Array(12).fill(0).map(() => ({ income: 0, expense: 0 }));

            // Standard P&L Categories
            const statement = {
                revenue: { items: [], total: 0 },
                cogs: { items: [], total: 0 },
                operatingExpenses: { items: [], total: 0 },
                otherIncome: { items: [], total: 0 },
                otherExpense: { items: [], total: 0 }
            };

            const ledgerValues = {}; // To store net value per ledger
            ledgers.forEach(l => {
                const openBal = parseFloat(l.openingBalance || 0) * rate;
                ledgerValues[l.id] = openBal;

                // Income and Expenses opening balances contribute to the net profit
                if (l.accountgroup.type === 'INCOME') totalIncome += openBal;
                if (l.accountgroup.type === 'EXPENSES') totalExpense += openBal;
            });

            transactions.forEach(txn => {
                const month = new Date(txn.date).getMonth(); // 0-11
                const amount = (txn.amount || 0) * rate;

                const debitLedger = ledgers.find(l => l.id === txn.debitLedgerId);
                const creditLedger = ledgers.find(l => l.id === txn.creditLedgerId);

                // DEBIT SIDE Checks
                if (debitLedger) {
                    if (debitLedger.accountgroup.type === 'EXPENSES') {
                        totalExpense += amount;
                        monthlyData[month].expense += amount;
                        ledgerValues[debitLedger.id] += amount;
                    } else if (debitLedger.accountgroup.type === 'INCOME') {
                        totalIncome -= amount;
                        monthlyData[month].income -= amount;
                        ledgerValues[debitLedger.id] -= amount;
                    }
                }

                // CREDIT SIDE Checks
                if (creditLedger) {
                    if (creditLedger.accountgroup.type === 'INCOME') {
                        totalIncome += amount;
                        monthlyData[month].income += amount;
                        ledgerValues[creditLedger.id] += amount;
                    } else if (creditLedger.accountgroup.type === 'EXPENSES') {
                        totalExpense -= amount;
                        monthlyData[month].expense -= amount;
                        ledgerValues[creditLedger.id] -= amount;
                    }
                }
            });

            // Populate Statement Structure
            ledgers.forEach(ledger => {
                const val = ledgerValues[ledger.id] !== undefined ? ledgerValues[ledger.id] : 0;

                const item = { id: ledger.id, name: ledger.name, value: val };
                const groupType = ledger.accountgroup.type;
                const subGroupName = ledger.accountsubgroup?.name?.toLowerCase() || '';
                const ledgerName = ledger.name.toLowerCase();

                if (groupType === 'INCOME') {
                    if (subGroupName.includes('other')) {
                        statement.otherIncome.items.push(item);
                        statement.otherIncome.total += val;
                    } else {
                        statement.revenue.items.push(item);
                        statement.revenue.total += val;
                    }
                } else if (groupType === 'EXPENSES') {
                    if (subGroupName.includes('direct') ||
                        ledgerName.includes('cost of goods sold') ||
                        ledgerName.includes('cogs') ||
                        ledgerName.includes('purchases')) {
                        statement.cogs.items.push(item);
                        statement.cogs.total += val;
                    } else if (subGroupName.includes('other')) {
                        statement.otherExpense.items.push(item);
                        statement.otherExpense.total += val;
                    } else {
                        statement.operatingExpenses.items.push(item);
                        statement.operatingExpenses.total += val;
                    }
                }
            });

            return {
                totalIncome,
                totalExpense,
                netProfit: totalIncome - totalExpense,
                monthlyData,
                statement
            };
        };

        const currentData = await fetchLedgerData(startDate, endDate);

        // For growth comparison, we use the same dates but in the previous year
        const prevStart = new Date(startDate);
        prevStart.setFullYear(prevStart.getFullYear() - 1);
        const prevEnd = new Date(endDate);
        prevEnd.setFullYear(prevEnd.getFullYear() - 1);
        const prevData = await fetchLedgerData(prevStart, prevEnd);

        // Net Profit = (Income - Expense) as COGS is already posted on sales invoices in real-time.
        // Unsold inventory remains in Balance Sheet Current Assets, not added as a direct income in P&L.

        // Calculate Growth %
        const calcGrowth = (curr, prev) => {
            if (prev === 0) return curr === 0 ? 0 : 100;
            return parseFloat(((curr - prev) / Math.abs(prev) * 100).toFixed(1));
        };

        const summary = {
            totalIncome: currentData.totalIncome,
            totalExpense: currentData.totalExpense,
            netProfit: currentData.netProfit,
            incomeGrowth: calcGrowth(currentData.totalIncome, prevData.totalIncome),
            expenseGrowth: calcGrowth(currentData.totalExpense, prevData.totalExpense),
            profitGrowth: calcGrowth(currentData.netProfit, prevData.netProfit)
        };

        // Format Chart Data
        const chartData = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
        ].map((name, i) => ({
            name,
            income: currentData.monthlyData[i].income,
            expense: currentData.monthlyData[i].expense
        }));

        // Official Statement Totals
        const grossProfit = currentData.statement.revenue.total - currentData.statement.cogs.total;
        const operatingIncome = grossProfit - currentData.statement.operatingExpenses.total;
        const netOther = currentData.statement.otherIncome.total - currentData.statement.otherExpense.total;

        res.status(200).json({
            success: true,
            data: {
                summary,
                chartData,
                statement: currentData.statement,
                calculations: {
                    grossProfit,
                    operatingIncome,
                    netOther,
                    netProfit: currentData.netProfit
                }
            }
        });

    } catch (error) {
        console.error('Error fetching Profit & Loss:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get VAT Report (Detailed Transaction List)
const getVatReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const startDate = new Date(`${year}-01-01`);
        const endDate = new Date(`${year}-12-31`);
        endDate.setHours(23, 59, 59, 999);

        // 1. Fetch Sales (Invoices)
        const invoices = await prisma.invoice.findMany({
            where: {
                companyId: parseInt(companyId),
                date: { gte: startDate, lte: endDate }
            },
            include: { customer: { select: { name: true } } }
        });

        // 2. Fetch POS Sales
        const posInvoices = await prisma.posinvoice.findMany({
            where: {
                companyId: parseInt(companyId),
                createdAt: { gte: startDate, lte: endDate }
            },
            include: { customer: { select: { name: true } } }
        });

        // 3. Fetch Purchases (Bills)
        const bills = await prisma.purchasebill.findMany({
            where: {
                companyId: parseInt(companyId),
                date: { gte: startDate, lte: endDate }
            },
            include: { vendor: { select: { name: true } } }
        });

        // Map to Unified Structure
        let reportData = [];

        const companyCurrency = await getCompanyCurrency(companyId);

        // Map Invoices
        for (const inv of invoices) {
            const exRate = await getConversionRate(inv.currency || 'USD', companyCurrency);
            const taxable = (parseFloat(inv.subtotal) || 0) * exRate;
            const tax = (parseFloat(inv.taxAmount) || 0) * exRate;
            const rate = taxable > 0 ? ((tax / taxable) * 100).toFixed(1) : 0;

            reportData.push({
                id: `INV-${inv.id}`,
                type: 'Sales',
                description: `Invoice #${inv.invoiceNumber} - ${inv.customer.name}`,
                taxableAmount: taxable,
                vatAmount: tax,
                vatRate: rate,
                date: inv.date
            });
        }

        // Map POS
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        for (const pos of posInvoices) {
            const exRate = await getConversionRate(pos.currency || histCurr, companyCurrency);
            const taxable = (parseFloat(pos.subtotal) || 0) * exRate;
            const tax = (parseFloat(pos.taxAmount) || 0) * exRate;
            const rate = taxable > 0 ? ((tax / taxable) * 100).toFixed(1) : 0;
            const custName = pos.customer ? pos.customer.name : 'Walk-in Customer';

            reportData.push({
                id: `POS-${pos.id}`,
                type: 'Sales',
                description: `POS #${pos.invoiceNumber} - ${custName}`,
                taxableAmount: taxable,
                vatAmount: tax,
                vatRate: rate,
                date: pos.createdAt
            });
        }

        // Map Bills
        for (const bill of bills) {
            const exRate = await getConversionRate(bill.currency || 'USD', companyCurrency);
            const taxable = (parseFloat(bill.subtotal) || 0) * exRate;
            const tax = (parseFloat(bill.taxAmount) || 0) * exRate;
            const rate = taxable > 0 ? ((tax / taxable) * 100).toFixed(1) : 0;

            reportData.push({
                id: `BILL-${bill.id}`,
                type: 'Purchase',
                description: `Bill #${bill.billNumber} - ${bill.vendor.name}`,
                taxableAmount: taxable,
                vatAmount: tax,
                vatRate: rate,
                date: bill.date
            });
        }

        // Sort by Date Descending
        reportData.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.status(200).json({ success: true, data: reportData });

    } catch (error) {
        console.error('Error fetching VAT report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Day Book Report (Consolidated from all source tables)
const getDayBook = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const { startDate, endDate, voucherType, ledgerId } = req.query;

        // Date Range Logic
        let dateFilter = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // include full end day
            dateFilter = { gte: start, lte: end };
        } else {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            dateFilter = { gte: today, lt: tomorrow };
        }

        const companyIdInt = parseInt(companyId);
        const lId = ledgerId ? parseInt(ledgerId) : null;

        // Helper to check if a type should be included
        const includeType = (type) => !voucherType || voucherType === 'ALL' || voucherType.toUpperCase() === type.toUpperCase();

        const queries = [];

        // 1. Invoices
        if (includeType('SALES') || includeType('TAX_INVOICE')) {
            queries.push(prisma.invoice.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    ...(lId ? { customer: { ledgerId: lId } } : {})
                },
                include: { customer: true }
            }).then(async items => {
                const companyCurrency = await getCompanyCurrency(companyIdInt);
                return Promise.all(items.map(async inv => {
                    const rate = await getConversionRate(inv.currency || 'USD', companyCurrency);
                    return {
                        id: `INV-${inv.id}`,
                        date: inv.date,
                        voucherType: 'Sales',
                        voucherNo: inv.invoiceNumber,
                        ledger: inv.customer?.name || 'Unknown',
                        ledgerId: inv.customer?.ledgerId || null,
                        description: inv.notes || 'Sales Invoice',
                        debit: inv.totalAmount * rate,
                        credit: 0,
                        source: { type: 'SALES', id: inv.id, link: `/company/sales/invoice/view/${inv.id}` }
                    };
                }));
            }));
        }

        // 2. POS Invoices
        if (includeType('SALES') || includeType('POS_INVOICE')) {
            queries.push(prisma.posinvoice.findMany({
                where: {
                    companyId: companyIdInt,
                    createdAt: dateFilter,
                    ...(lId ? { OR: [{ customer: { ledgerId: lId } }, { transaction: { some: { OR: [{ debitLedgerId: lId }, { creditLedgerId: lId }] } } }] } : {})
                },
                include: { customer: true, transaction: { select: { debitLedgerId: true } } }
            }).then(async items => {
                const companyCurrency = await getCompanyCurrency(companyIdInt);
                const histCurr = await getCompanyHistoricalCurrency(companyIdInt);
                return Promise.all(items.map(async pos => {
                    const ledgerId = pos.customer?.ledgerId || pos.transaction[0]?.debitLedgerId || null;
                    const rate = await getConversionRate(pos.currency || histCurr, companyCurrency);
                    return {
                        id: `POS-${pos.id}`,
                        date: pos.createdAt,
                        voucherType: 'POS Invoice',
                        voucherNo: pos.invoiceNumber,
                        ledger: pos.customer?.name || 'Walk-in (Cash)',
                        ledgerId,
                        description: 'POS Sale',
                        debit: pos.totalAmount * rate,
                        credit: 0,
                        source: { type: 'POS_INVOICE', id: pos.id, link: `/company/pos/view/${pos.id}` }
                    };
                }));
            }));
        }

        // 3. Purchase Bills
        if (includeType('PURCHASE')) {
            queries.push(prisma.purchasebill.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    ...(lId ? { vendor: { ledgerId: lId } } : {})
                },
                include: { vendor: true }
            }).then(async items => {
                const companyCurrency = await getCompanyCurrency(companyIdInt);
                return Promise.all(items.map(async bill => {
                    const rate = await getConversionRate(bill.currency || 'USD', companyCurrency);
                    return {
                        id: `BILL-${bill.id}`,
                        date: bill.date,
                        voucherType: 'Purchase',
                        voucherNo: bill.billNumber,
                        ledger: bill.vendor?.name || 'Unknown',
                        ledgerId: bill.vendor?.ledgerId || null,
                        description: bill.notes || 'Purchase Bill',
                        debit: 0,
                        credit: bill.totalAmount * rate,
                        source: { type: 'PURCHASE', id: bill.id, link: `/company/purchase/bill/view/${bill.id}` }
                    };
                }));
            }));
        }

        // 4. Receipts
        if (includeType('RECEIPT')) {
            queries.push(prisma.receipt.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    ...(lId ? { OR: [{ customer: { ledgerId: lId } }, { cashBankAccountId: lId }] } : {})
                },
                include: { customer: true, cashBankAccount: true }
            }).then(items => items.map(rec => ({
                id: `REC-${rec.id}`,
                date: rec.date,
                voucherType: 'Receipt',
                voucherNo: rec.receiptNumber,
                ledger: rec.customer?.name || rec.cashBankAccount?.name || 'Unknown',
                ledgerId: rec.customer?.ledgerId || rec.cashBankAccountId || null,
                description: 'Payment Received',
                debit: 0,
                credit: rec.amount,
                source: { type: 'RECEIPT', id: rec.id, link: `/company/payment/receipt/view/${rec.id}` }
            }))));
        }

        // 5. Payments
        if (includeType('PAYMENT')) {
            queries.push(prisma.payment.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    ...(lId ? { OR: [{ vendor: { ledgerId: lId } }, { cashBankAccountId: lId }] } : {})
                },
                include: { vendor: true, bankLedger: true }
            }).then(items => items.map(pay => ({
                id: `PAY-${pay.id}`,
                date: pay.date,
                voucherType: 'Payment',
                voucherNo: pay.paymentNumber,
                ledger: pay.vendor?.name || pay.bankLedger?.name || 'Unknown',
                ledgerId: pay.vendor?.ledgerId || pay.cashBankAccountId || null,
                description: 'Payment Made',
                debit: pay.amount,
                credit: 0,
                source: { type: 'PAYMENT', id: pay.id, link: `/company/payment/made/view/${pay.id}` }
            }))));
        }

        // 6. Journal Entries
        if (includeType('JOURNAL')) {
            queries.push(prisma.journalentry.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    source: { not: 'system' },
                    ...(lId ? { transaction: { some: { OR: [{ debitLedgerId: lId }, { creditLedgerId: lId }] } } } : {})
                },
                include: { transaction: { include: { ledger_transaction_debitLedgerIdToledger: true, ledger_transaction_creditLedgerIdToledger: true } } }
            }).then(items => items.map(je => ({
                id: `JE-${je.id}`,
                date: je.date,
                voucherType: 'Journal',
                voucherNo: je.voucherNumber || je.journalNumber || '-',
                ledger: 'Journal Entry',
                ledgerId: null,
                description: je.narration || 'Journal Voucher',
                debit: je.transaction.reduce((sum, t) => sum + (t.debitLedgerId ? t.amount : 0), 0),
                credit: 0, // In Day Book we usually show total magnitude or DR/CR split
                source: { type: 'JOURNAL', id: je.id, link: `/company/journal/view/${je.id}` }
            }))));
        }

        // 7. Vouchers (Expense, Income, Contra)
        if (includeType('EXPENSE') || includeType('INCOME') || includeType('CONTRA')) {
            queries.push(prisma.voucher.findMany({
                where: {
                    companyId: companyIdInt,
                    date: dateFilter,
                    ...(voucherType && voucherType !== 'ALL' ? { voucherType: voucherType.toUpperCase() } : {}),
                    ...(lId ? { OR: [{ paidFromLedgerId: lId }, { paidToLedgerId: lId }, { vendor: { ledgerId: lId } }, { customer: { ledgerId: lId } }] } : {})
                },
                include: { vendor: true, customer: true, paidFromLedger: true, paidToLedger: true }
            }).then(items => items.map(v => ({
                id: `VCH-${v.id}`,
                date: v.date,
                voucherType: v.voucherType,
                voucherNo: v.voucherNumber,
                ledger: v.vendor?.name || v.customer?.name || v.paidToLedger?.name || v.paidFromLedger?.name || 'Unknown',
                ledgerId: v.vendor?.ledgerId || v.customer?.ledgerId || v.paidToLedgerId || v.paidFromLedgerId || null,
                description: v.notes || `${v.voucherType} Voucher`,
                debit: v.voucherType === 'EXPENSE' ? v.totalAmount : (v.voucherType === 'CONTRA' ? v.totalAmount : 0),
                credit: v.voucherType === 'INCOME' ? v.totalAmount : 0,
                source: { type: v.voucherType, id: v.id, link: `/company/vouchers/view/${v.id}` }
            }))));
        }

        const results = await Promise.all(queries);
        const dayBook = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date));

        res.status(200).json({ success: true, data: dayBook });

    } catch (error) {
        console.error('Error fetching Day Book:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Journal Entries
const getJournalReport = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = req.query.month ? parseInt(req.query.month) : new Date().getMonth(); // 0-11

        // Calculate State/End date for the month
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0); // Last day of month
        endDate.setHours(23, 59, 59, 999);

        const journals = await prisma.journalentry.findMany({
            where: {
                companyId: parseInt(companyId),
                date: { gte: startDate, lte: endDate },
                source: 'manual'
            },
            include: {
                transaction: {
                    include: {
                        ledger_transaction_debitLedgerIdToledger: true,
                        ledger_transaction_creditLedgerIdToledger: true
                    }
                }
            },
            orderBy: { date: 'desc' }
        });

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        const reportData = journals.map(entry => {
            let ledgers = [];

            // Each transaction represents a Debit-Credit pair
            entry.transaction.forEach(txn => {
                const amount = parseFloat(txn.amount) * rate;

                // Debit Side
                if (txn.debitLedgerId) {
                    ledgers.push({
                        name: txn.ledger_transaction_debitLedgerIdToledger?.name || 'Unknown',
                        nature: 'Debit',
                        amount: amount
                    });
                }

                // Credit Side
                if (txn.creditLedgerId) {
                    ledgers.push({
                        name: txn.ledger_transaction_creditLedgerIdToledger?.name || 'Unknown',
                        nature: 'Credit',
                        amount: amount
                    });
                }
            });

            return {
                id: entry.id,
                date: entry.date,
                voucherNo: entry.voucherNumber,
                type: 'Journal', // Default type
                narration: entry.narration || '',
                ledgers
            };
        });

        res.status(200).json({ success: true, data: reportData });

    } catch (error) {
        console.error('Error fetching Journal report:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Get Trial Balance
const getTrialBalance = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const endDate = new Date(dateStr);
        endDate.setHours(23, 59, 59, 999);

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        // Fetch all ledgers with their group details
        const ledgers = await prisma.ledger.findMany({
            where: { companyId: parseInt(companyId) },
            include: { accountgroup: true }
        });

        // --- Single-pass transaction aggregates (avoids N+1 queries) ---
        const [debitSums, creditSums] = await Promise.all([
            prisma.transaction.groupBy({
                by: ['debitLedgerId'],
                where: { companyId: parseInt(companyId), date: { lte: endDate } },
                _sum: { amount: true }
            }),
            prisma.transaction.groupBy({
                by: ['creditLedgerId'],
                where: { companyId: parseInt(companyId), date: { lte: endDate } },
                _sum: { amount: true }
            })
        ]);

        const debitMap = new Map(debitSums.map(d => [d.debitLedgerId, d._sum.amount || 0]));
        const creditMap = new Map(creditSums.map(c => [c.creditLedgerId, c._sum.amount || 0]));

        // Calculate dynamic inventory value once
        const currentInventoryValue = (await calculateInventoryValue(companyId)) * rate;

        const trialBalance = [];

        for (const ledger of ledgers) {
            const isOBE = ledger.name.toLowerCase().includes('opening balance equity');
            const groupType = ledger.accountgroup?.type;

            // Skip transaction aggregation for OBE — it will be set dynamically below
            let totalDebit = 0;
            let totalCredit = 0;

            if (!isOBE) {
                const txnDebit = (debitMap.get(ledger.id) || 0) * rate;
                const txnCredit = (creditMap.get(ledger.id) || 0) * rate;
                const openingBalance = parseFloat(ledger.openingBalance || 0) * rate;

                // Assets and Expenses: Debit-normal
                if (groupType === 'ASSETS' || groupType === 'EXPENSES') {
                    totalDebit = txnDebit;
                    totalCredit = txnCredit;
                } else {
                    // Liabilities, Income, Equity: Credit-normal
                    totalCredit = txnCredit;
                    totalDebit = txnDebit;
                }
            }

            // Determine Net Balance
            let netDebit = 0;
            let netCredit = 0;

            if (totalDebit > totalCredit) {
                netDebit = totalDebit - totalCredit;
            } else if (totalCredit > totalDebit) {
                netCredit = totalCredit - totalDebit;
            }

            // Override Inventory Asset with live dynamic stock value
            if (!isOBE && groupType === 'ASSETS' && ledger.name.toLowerCase().includes('inventory asset')) {
                netDebit = currentInventoryValue;
                netCredit = 0;
            }

            // Always include OBE (even with 0 balance — the adjustment below will populate it)
            if (netDebit !== 0 || netCredit !== 0 || isOBE) {
                trialBalance.push({
                    id: ledger.id,
                    name: ledger.name,
                    type: ledger.accountgroup ? ledger.accountgroup.name : 'Uncategorized',
                    debit: netDebit,
                    credit: netCredit
                });
            }
        }

        // Sort by Name
        trialBalance.sort((a, b) => a.name.localeCompare(b.name));

        // Dynamic OBE adjustment — absorb any imbalance so TB always balances
        const totalDebitTB = trialBalance.reduce((sum, item) => sum + item.debit, 0);
        const totalCreditTB = trialBalance.reduce((sum, item) => sum + item.credit, 0);
        const tbDifference = totalDebitTB - totalCreditTB;

        if (Math.abs(tbDifference) > 0.01) {
            const obeIndex = trialBalance.findIndex(item => item.name.toLowerCase().includes('opening balance equity'));

            if (obeIndex !== -1) {
                // Adjust existing OBE to absorb the difference
                if (tbDifference > 0) {
                    trialBalance[obeIndex].credit += tbDifference;
                } else {
                    trialBalance[obeIndex].debit += Math.abs(tbDifference);
                }

                // Convert back to net balance for display
                const net = trialBalance[obeIndex].debit - trialBalance[obeIndex].credit;
                trialBalance[obeIndex].debit = net > 0 ? net : 0;
                trialBalance[obeIndex].credit = net < 0 ? Math.abs(net) : 0;
            } else {
                // Add a new OBE adjustment entry if not present
                trialBalance.push({
                    id: 999997,
                    name: 'Opening Balance Adjustment',
                    type: 'Equity',
                    debit: tbDifference < 0 ? Math.abs(tbDifference) : 0,
                    credit: tbDifference > 0 ? tbDifference : 0
                });
            }
        }

        res.status(200).json({ success: true, data: trialBalance });

    } catch (error) {
        console.error('Error fetching Trial Balance:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};


// Get All Transactions
const getAllTransactions = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const transactions = await prisma.transaction.findMany({
            where: {
                companyId: parseInt(companyId)
            },
            include: {
                ledger_transaction_debitLedgerIdToledger: { include: { accountgroup: true } },
                ledger_transaction_creditLedgerIdToledger: { include: { accountgroup: true } },
                invoice: { include: { customer: true } },
                purchasebill: { include: { vendor: true } },
                payment: { include: { vendor: true, bankLedger: true } },
                receipt: { include: { customer: true, cashBankAccount: true } },
                journalentry: true,
                posinvoice: { include: { customer: true } }
            },
            orderBy: {
                date: 'desc'
            }
        });

        // Retrieve all vouchers for this company to link Journal/Contra/Expense/Income types to voucher.id
        const vouchers = await prisma.voucher.findMany({
            where: {
                companyId: parseInt(companyId)
            },
            select: {
                id: true,
                voucherNumber: true,
                voucherType: true
            }
        });

        const voucherMap = new Map();
        vouchers.forEach(v => {
            const key = `${v.voucherType}_${v.voucherNumber}`;
            voucherMap.set(key, v.id);
        });

        // Retrieve all sales returns for this company to link type to salesreturn.id
        const salesReturns = await prisma.salesreturn.findMany({
            where: {
                companyId: parseInt(companyId)
            },
            select: {
                id: true,
                returnNumber: true,
                autoVoucherNo: true,
                manualVoucherNo: true
            }
        });

        // Retrieve all purchase returns for this company to link type to purchasereturn.id
        const purchaseReturns = await prisma.purchasereturn.findMany({
            where: {
                companyId: parseInt(companyId)
            },
            select: {
                id: true,
                returnNumber: true
            }
        });

        const returnMap = new Map();
        salesReturns.forEach(sr => {
            if (sr.returnNumber) returnMap.set(`SALES_RETURN_${sr.returnNumber}`, sr.id);
            if (sr.autoVoucherNo) returnMap.set(`SALES_RETURN_${sr.autoVoucherNo}`, sr.id);
            if (sr.manualVoucherNo) returnMap.set(`SALES_RETURN_${sr.manualVoucherNo}`, sr.id);
        });
        purchaseReturns.forEach(pr => {
            if (pr.returnNumber) returnMap.set(`PURCHASE_RETURN_${pr.returnNumber}`, pr.id);
        });

        // Group transactions in memory by source document/event to prevent duplicate rows
        const groups = {};
        const groupOrder = [];

        transactions.forEach(txn => {
            let key = '';
            if (txn.voucherType === 'SALES_RETURN' || txn.voucherType === 'PURCHASE_RETURN') {
                key = `${txn.voucherType}_${txn.voucherNumber}`;
            } else if (txn.invoiceId) key = `invoice_${txn.invoiceId}`;
            else if (txn.purchaseBillId) key = `purchasebill_${txn.purchaseBillId}`;
            else if (txn.receiptId) key = `receipt_${txn.receiptId}`;
            else if (txn.paymentId) key = `payment_${txn.paymentId}`;
            else if (txn.posInvoiceId) key = `posinvoice_${txn.posInvoiceId}`;
            else if (txn.journalEntryId) key = `journalentry_${txn.journalEntryId}`;
            else if (txn.voucherNumber) key = `${txn.voucherType}_${txn.voucherNumber}`;
            else key = `other_${txn.id}`;

            if (!groups[key]) {
                groups[key] = [];
                groupOrder.push(key);
            }
            groups[key].push(txn);
        });

        const formattedTransactions = groupOrder.map(key => {
            const txns = groups[key];
            const primaryTxn = txns[0];

            let balanceType = 'Debit';
            let partyName = '-';
            let accountType = '-';
            let voucherNo = primaryTxn.voucherNumber || '-';
            let note = primaryTxn.description;
            let targetId = null;
            let amount = parseFloat(primaryTxn.amount);
            let vType = primaryTxn.voucherType;

            // Resolve Note from source documents if description is empty or generic
            if (!note || note === '-') {
                if (primaryTxn.invoice) note = primaryTxn.invoice.notes;
                else if (primaryTxn.purchasebill) note = primaryTxn.purchasebill.notes;
                else if (primaryTxn.receipt) note = primaryTxn.receipt.notes;
                else if (primaryTxn.payment) note = primaryTxn.payment.notes;
                else if (primaryTxn.journalentry) note = primaryTxn.journalentry.narration;
            }

            // Sales (Invoice) -> Impact on Customer -> Debit
            if (key.startsWith('invoice_') && primaryTxn.invoice) {
                balanceType = 'Debit';
                partyName = primaryTxn.invoice.customer?.name || primaryTxn.ledger_transaction_debitLedgerIdToledger?.name;
                accountType = primaryTxn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name || 'Debtors';
                voucherNo = primaryTxn.invoice.invoiceNumber;
                targetId = primaryTxn.invoice.id;
                amount = parseFloat(primaryTxn.invoice.totalAmount);
                vType = 'SALES_INVOICE';
                if (!note) note = primaryTxn.invoice.notes;
            }
            // Purchase (Bill) -> Impact on Vendor -> Credit
            else if (key.startsWith('purchasebill_') && primaryTxn.purchasebill) {
                balanceType = 'Credit';
                partyName = primaryTxn.purchasebill.vendor?.name || primaryTxn.ledger_transaction_creditLedgerIdToledger?.name;
                accountType = primaryTxn.ledger_transaction_creditLedgerIdToledger?.accountgroup?.name || 'Creditors';
                voucherNo = primaryTxn.purchasebill.billNumber;
                targetId = primaryTxn.purchasebill.id;
                amount = parseFloat(primaryTxn.purchasebill.totalAmount);
                vType = 'PURCHASE_BILL';
                if (!note) note = primaryTxn.purchasebill.notes;
            }
            // Receipt -> Impact on Customer -> Credit
            else if (key.startsWith('receipt_') && primaryTxn.receipt) {
                balanceType = 'Credit';
                partyName = primaryTxn.receipt.customer?.name || primaryTxn.ledger_transaction_creditLedgerIdToledger?.name;
                accountType = primaryTxn.ledger_transaction_creditLedgerIdToledger?.accountgroup?.name;
                voucherNo = primaryTxn.receipt.receiptNumber;
                targetId = primaryTxn.receipt.id;
                amount = parseFloat(primaryTxn.receipt.amount);
                vType = 'RECEIPT';
                if (!note) note = primaryTxn.receipt.notes;
            }
            // Payment -> Impact on Vendor -> Debit
            else if (key.startsWith('payment_') && primaryTxn.payment) {
                balanceType = 'Debit';
                partyName = primaryTxn.payment.vendor?.name || primaryTxn.ledger_transaction_debitLedgerIdToledger?.name;
                accountType = primaryTxn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name;
                voucherNo = primaryTxn.payment.paymentNumber;
                targetId = primaryTxn.payment.id;
                amount = parseFloat(primaryTxn.payment.amount);
                vType = 'PAYMENT';
                if (!note) note = primaryTxn.payment.notes;
            }
            // POS Invoice -> Impact on Customer -> Debit
            else if (key.startsWith('posinvoice_') && primaryTxn.posinvoice) {
                balanceType = 'Debit';
                partyName = primaryTxn.posinvoice.customer?.name || 'Walk-in';
                accountType = primaryTxn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name || 'Debtors';
                voucherNo = primaryTxn.posinvoice.invoiceNumber;
                targetId = primaryTxn.posinvoice.id;
                amount = parseFloat(primaryTxn.posinvoice.totalAmount);
                vType = 'POS_INVOICE';
                if (!note) note = primaryTxn.posinvoice.notes;
            }
            // Journal Voucher -> Default view
            else if (key.startsWith('journalentry_')) {
                balanceType = 'Debit';
                partyName = primaryTxn.ledger_transaction_debitLedgerIdToledger?.name || 'Journal Entry';
                accountType = primaryTxn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name;

                const vNo = primaryTxn.journalentry?.voucherNumber || primaryTxn.voucherNumber;
                voucherNo = vNo || '-';

                // Try to find matching voucher from our Map, fallback to journalentry.id
                const lookupKey = `JOURNAL_${vNo}`;
                targetId = voucherMap.get(lookupKey) || null;
                vType = 'JOURNAL';

                amount = txns.reduce((sum, t) => sum + parseFloat(t.amount), 0);
                if (!note && primaryTxn.journalentry) note = primaryTxn.journalentry.narration;
            }
            // Expense / Income / Contra and other fallbacks
            else {
                if (primaryTxn.voucherType === 'SALES_RETURN') {
                    balanceType = 'Credit';
                } else if (primaryTxn.voucherType === 'PURCHASE_RETURN') {
                    balanceType = 'Debit';
                } else {
                    balanceType = ['INCOME', 'RECEIPT'].includes(primaryTxn.voucherType) ? 'Credit' : 'Debit';
                }

                partyName = balanceType === 'Debit'
                    ? primaryTxn.ledger_transaction_debitLedgerIdToledger?.name
                    : primaryTxn.ledger_transaction_creditLedgerIdToledger?.name;
                accountType = balanceType === 'Debit'
                    ? primaryTxn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name
                    : primaryTxn.ledger_transaction_creditLedgerIdToledger?.accountgroup?.name;

                if (['EXPENSE', 'INCOME', 'CONTRA'].includes(primaryTxn.voucherType)) {
                    targetId = primaryTxn.id;
                    if (primaryTxn.voucherType === 'CONTRA') {
                        const isBankTransfer = !primaryTxn.voucherNumber?.startsWith('CNT-');
                        if (isBankTransfer) {
                            vType = 'BANK_TRANSFER';
                        }
                    }
                } else if (primaryTxn.voucherType === 'JOURNAL') {
                    const lookupKey = `JOURNAL_${primaryTxn.voucherNumber}`;
                    targetId = voucherMap.get(lookupKey) || null;
                } else if (['SALES_RETURN', 'PURCHASE_RETURN'].includes(primaryTxn.voucherType)) {
                    const lookupKey = `${primaryTxn.voucherType}_${primaryTxn.voucherNumber}`;
                    targetId = returnMap.get(lookupKey) || null;
                }
                amount = txns.reduce((sum, t) => sum + parseFloat(t.amount), 0);
            }

            return {
                id: primaryTxn.id,
                date: primaryTxn.date,
                transactionId: `TXN-${primaryTxn.id.toString().padStart(5, '0')}`,
                targetId,
                balanceType,
                voucherType: vType,
                voucherNo,
                amount,
                fromTo: partyName || 'Unknown',
                accountType: accountType || 'General',
                note: note || '-'
            };
        });

        res.status(200).json({ success: true, data: formattedTransactions });

    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = {
    getSalesReport,
    getSalesByItemReport,
    getSalesByCustomerReport,
    getSalesBySalesmanReport,
    getPurchaseReport,
    getPurchaseByItemReport,
    getPurchaseByVendorReport,
    getPosReport,
    getTaxReport,
    getInventorySummary,
    getBalanceSheet,
    getCashFlowStatement,
    getProfitLoss,
    getVatReport,
    getDayBook,
    getJournalReport,
    getTrialBalance,
    getAllTransactions
};
