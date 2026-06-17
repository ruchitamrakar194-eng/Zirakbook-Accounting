const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
        // Calculate Summary Stats
        const now = new Date();
        const summary = salesReport.reduce((acc, inv) => {
            const total = inv.totalAmount || 0;
            // Assuming balanceAmount tracks unpaid amount. 
            // If invoice is fully paid, balance is 0.
            const unpaid = inv.balanceAmount || 0;
            const paid = total - unpaid;

            acc.totalAmount += total;
            acc.totalPaid += paid;
            acc.totalUnpaid += unpaid;

            // Overdue check: if dueDate exists, is past today, and still has unpaid balance
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

        res.status(200).json({ success: true, data: salesReport, summary });

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
                invoice: { select: { date: true, invoiceNumber: true } }
            }
        });

        const grouped = invoiceItems.reduce((acc, item) => {
            const productId = item.productId || 'service-' + (item.serviceId || 'unknown');
            const productName = item.product?.name || item.description || 'Unknown';

            if (!acc[productId]) {
                acc[productId] = {
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
            acc[productId].invoiceIds.add(item.invoiceId);
            acc[productId].totalQty += item.quantity;
            acc[productId].totalAmount += item.amount;
            return acc;
        }, {});

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

        const grouped = allInvoices.reduce((acc, inv) => {
            const customerId = inv.customerId || 'walk-in';
            const customerName = inv.customer?.name || 'Walk-in Customer';

            if (!acc[customerId]) {
                acc[customerId] = {
                    customerId,
                    customerName,
                    totalInvoices: 0,
                    totalSales: 0,
                    totalPaid: 0,
                    totalPending: 0
                };
            }
            acc[customerId].totalInvoices += 1;
            acc[customerId].totalSales += inv.totalAmount;
            acc[customerId].totalPaid += inv.paidAmount || 0;
            acc[customerId].totalPending += inv.balanceAmount || 0;
            return acc;
        }, {});

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
        const grouped = allInvoices.reduce((acc, inv) => {
            // Note: salesman tracking requires a 'createdBy' field on the invoice model.
            // Not currently in schema — grouped under 'Administrator' until field is added.
            const salesman = 'Administrator';
            if (!acc[salesman]) {
                acc[salesman] = { salesman, totalInvoices: 0, totalSales: 0, totalPaid: 0, totalPending: 0 };
            }
            acc[salesman].totalInvoices += 1;
            acc[salesman].totalSales += inv.totalAmount;
            acc[salesman].totalPaid += inv.paidAmount || 0;
            acc[salesman].totalPending += inv.balanceAmount || 0;
            return acc;
        }, {});

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

        // Calculate Summary Stats
        const now = new Date();
        const summary = purchaseReport.reduce((acc, bill) => {
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

        res.status(200).json({ success: true, data: purchaseReport, summary });
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
                purchasebill: { select: { date: true, billNumber: true } }
            }
        });

        const grouped = billItems.reduce((acc, item) => {
            const productId = item.productId || 'unknown';
            const productName = item.product?.name || item.description || 'Unknown';

            if (!acc[productId]) {
                acc[productId] = {
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
            acc[productId].billIds.add(item.purchaseBillId);
            acc[productId].totalQty += item.quantity;
            acc[productId].totalAmount += item.amount;
            return acc;
        }, {});

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

        const grouped = bills.reduce((acc, bill) => {
            const vendorId = bill.vendorId || 'unknown';
            const vendorName = bill.vendor?.name || 'Unknown Vendor';

            if (!acc[vendorId]) {
                acc[vendorId] = {
                    vendorId,
                    vendorName,
                    totalBills: 0,
                    totalPurchases: 0,
                    totalPaid: 0,
                    totalPending: 0
                };
            }
            acc[vendorId].totalBills += 1;
            acc[vendorId].totalPurchases += bill.totalAmount;
            acc[vendorId].totalPaid += (bill.totalAmount - bill.balanceAmount);
            acc[vendorId].totalPending += bill.balanceAmount;
            return acc;
        }, {});

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

        // Calculate Stats
        const summary = posReport.reduce((acc, inv) => {
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

        res.status(200).json({ success: true, data: posReport, summary });
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

        // Initialize Arrays (12 months)
        const incomeStats = {
            CGST: Array(12).fill(0),
            SGST: Array(12).fill(0),
            IGST: Array(12).fill(0)
        };

        const processTax = (amount, date, entityState, targetStats) => {
            const month = new Date(date).getMonth(); // 0-11
            const tax = parseFloat(amount || 0);

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

        invoices.forEach(inv => processTax(inv.taxAmount, inv.date, inv.customer?.billingState, incomeStats));
        posInvoices.forEach(pos => processTax(pos.taxAmount, pos.createdAt, pos.customer?.billingState || companyState, incomeStats)); // Default POS to local if no cust

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

        bills.forEach(bill => processTax(bill.taxAmount, bill.date, bill.vendor?.billingState, expenseStats));

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

        // Get All Stocks
        const stocks = await prisma.stock.findMany({
            where: { product: { companyId: parseInt(companyId) } },
            include: {
                product: { include: { category: true } },
                warehouse: true
            }
        });

        // Calculate movements based on transactions? 
        // Or simplified: Stock table holds current (closing).
        // Opening = Closing - Inward + Outward (Logic depends on date range, but "summary" usually means current status).
        // If user wants historical range, we need InventoryTransaction table. 
        // Assuming "Current Status" report for now as per UI "Track stock movements and CURRENT status".
        // But the UI shows "Opening, Inward, Outward". This implies a period (e.g. today, this month).
        // Let's assume period is "All Time" or "Current Accounting Period".
        // Better: Use InventoryTransaction to sum Inwards/Outwards.

        // Let's fetch transaction aggregates per product/warehouse
        const transactions = await prisma.inventorytransaction.findMany({
            where: { companyId: parseInt(companyId) }
        });

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
                warehouse: stk.warehouse.name,
                price: stk.product.salePrice || 0,
                closing: stk.quantity, // Current quantity found in stock table is Closing for "today"
                opening: 0,
                inward: 0,
                outward: 0,
                status: 'In Stock'
            };
        });

        // If specific date range provided, we'd need complex "As Of" calculation.
        // For now, let's treat "Inward" as Purchases/Returns In, "Outward" as Sales/Returns Out.
        // And "Opening" as what?
        // Let's calculate Inward/Outward from transactions. 
        // Issue: Closing is known. Opening = Closing - In + Out.

        transactions.forEach(txn => {
            // Logic:
            // Type: PURCHASE, RETURN (In from Cust), GRN, ADJUSTMENT(Add), OPENING_STOCK, TRANSFER(In) -> Inward
            // Type: SALE, RETURN (Out to Vendor), ADJUSTMENT(Remove), TRANSFER(Out) -> Outward

            // We need to match with the stock keys.
            // Trans has fromWarehouseId and toWarehouseId.

            // Handle OUT from warehouse
            if (txn.fromWarehouseId) {
                const key = `${txn.productId}-${txn.fromWarehouseId}`;
                if (reportMap[key]) {
                    reportMap[key].outward += txn.quantity;
                }
            }

            // Handle IN to warehouse
            if (txn.toWarehouseId) {
                const key = `${txn.productId}-${txn.toWarehouseId}`;
                if (reportMap[key]) {
                    reportMap[key].inward += txn.quantity;
                }
            }
            // Note: Single trans can be transfer (out from A, in to B).
            // Purchase is IN to 'toWarehouse'.
            // Sale is OUT from 'fromWarehouse'.
        });

        // Now Calculate Opening: Opening = Closing - Inward + Outward
        Object.values(reportMap).forEach(item => {
            item.opening = item.closing - item.inward + item.outward;
            item.totalValue = item.closing * item.price;

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

        // --- Dynamic Inventory Value (real-time: quantity × cost from stock table) ---
        const currentInventoryValue = await calculateInventoryValue(companyId);

        ledgers.forEach(ledger => {
            if (ledger.name.toLowerCase().includes('opening balance equity')) {
                return;
            }
            const groupType = ledger.accountgroup?.type;
            const opening = ledger.openingBalance || 0;

            // Calculate Balance
            // ASSETS, EXPENSES: Debit normal (Opening + Debits - Credits)
            // LIABILITIES, EQUITY, INCOME: Credit normal (Opening + Credits - Debits)
            let balance = 0;
            if (groupType === 'ASSETS' && ledger.name.toLowerCase().includes('inventory asset')) {
                // Always override Inventory Asset with live stock value
                balance = currentInventoryValue;
            } else if (['ASSETS', 'EXPENSES'].includes(groupType)) {
                balance = opening + getDebit(ledger.id) - getCredit(ledger.id);
            } else {
                balance = opening + getCredit(ledger.id) - getDebit(ledger.id);
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

        // Helpers
        const getMonthlySum = async (model, dateField = 'date', sumField = 'amount') => {
            const data = await model.groupBy({
                by: [dateField],
                where: {
                    companyId: parseInt(companyId),
                    [dateField]: {
                        gte: new Date(`${year}-01-01`),
                        lte: toEndOfDay(`${year}-12-31`)
                    }
                },
                _sum: { [sumField]: true }
            });

            // Aggregate by month (0-11)
            const monthly = Array(12).fill(0);
            data.forEach(item => {
                const d = new Date(item[dateField]);
                const month = d.getMonth(); // 0-11
                const val = item._sum[sumField] || 0;
                monthly[month] += val;
            });
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
                const openBal = parseFloat(l.openingBalance || 0);
                ledgerValues[l.id] = openBal;

                // Income and Expenses opening balances contribute to the net profit
                if (l.accountgroup.type === 'INCOME') totalIncome += openBal;
                if (l.accountgroup.type === 'EXPENSES') totalExpense += openBal;
            });

            transactions.forEach(txn => {
                const month = new Date(txn.date).getMonth(); // 0-11
                const amount = txn.amount || 0;

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

        // Map Invoices
        invoices.forEach(inv => {
            const taxable = parseFloat(inv.subtotal) || 0;
            const tax = parseFloat(inv.taxAmount) || 0;
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
        });

        // Map POS
        posInvoices.forEach(pos => {
            const taxable = parseFloat(pos.subtotal) || 0;
            const tax = parseFloat(pos.taxAmount) || 0;
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
        });

        // Map Bills
        bills.forEach(bill => {
            const taxable = parseFloat(bill.subtotal) || 0;
            const tax = parseFloat(bill.taxAmount) || 0;
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
        });

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
            }).then(items => items.map(inv => ({
                id: `INV-${inv.id}`,
                date: inv.date,
                voucherType: 'Sales',
                voucherNo: inv.invoiceNumber,
                ledger: inv.customer?.name || 'Unknown',
                description: inv.notes || 'Sales Invoice',
                debit: inv.totalAmount,
                credit: 0,
                source: { type: 'SALES', id: inv.id, link: `/company/sales/invoice/view/${inv.id}` }
            }))));
        }

        // 2. POS Invoices
        if (includeType('SALES') || includeType('POS_INVOICE')) {
            queries.push(prisma.posinvoice.findMany({
                where: {
                    companyId: companyIdInt,
                    createdAt: dateFilter,
                    ...(lId ? { customer: { ledgerId: lId } } : {})
                },
                include: { customer: true }
            }).then(items => items.map(pos => ({
                id: `POS-${pos.id}`,
                date: pos.createdAt,
                voucherType: 'POS Invoice',
                voucherNo: pos.invoiceNumber,
                ledger: pos.customer?.name || 'Walk-in (Cash)',
                description: 'POS Sale',
                debit: pos.totalAmount,
                credit: 0,
                source: { type: 'POS_INVOICE', id: pos.id, link: `/company/pos/view/${pos.id}` }
            }))));
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
            }).then(items => items.map(bill => ({
                id: `BILL-${bill.id}`,
                date: bill.date,
                voucherType: 'Purchase',
                voucherNo: bill.billNumber,
                ledger: bill.vendor?.name || 'Unknown',
                description: bill.notes || 'Purchase Bill',
                debit: 0,
                credit: bill.totalAmount,
                source: { type: 'PURCHASE', id: bill.id, link: `/company/purchase/bill/view/${bill.id}` }
            }))));
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
                    ...(lId ? { transaction: { some: { OR: [{ debitLedgerId: lId }, { creditLedgerId: lId }] } } } : {})
                },
                include: { transaction: { include: { ledger_transaction_debitLedgerIdToledger: true, ledger_transaction_creditLedgerIdToledger: true } } }
            }).then(items => items.map(je => ({
                id: `JE-${je.id}`,
                date: je.date,
                voucherType: 'Journal',
                voucherNo: je.voucherNumber || je.journalNumber || '-',
                ledger: 'Journal Entry',
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

        const reportData = journals.map(entry => {
            let ledgers = [];

            // Each transaction represents a Debit-Credit pair
            entry.transaction.forEach(txn => {
                const amount = parseFloat(txn.amount);

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
        const currentInventoryValue = await calculateInventoryValue(companyId);

        const trialBalance = [];

        for (const ledger of ledgers) {
            const isOBE = ledger.name.toLowerCase().includes('opening balance equity');
            const groupType = ledger.accountgroup?.type;

            // Skip transaction aggregation for OBE — it will be set dynamically below
            let totalDebit = 0;
            let totalCredit = 0;

            if (!isOBE) {
                const txnDebit = debitMap.get(ledger.id) || 0;
                const txnCredit = creditMap.get(ledger.id) || 0;
                const openingBalance = parseFloat(ledger.openingBalance || 0);

                // Assets and Expenses: Debit-normal
                if (groupType === 'ASSETS' || groupType === 'EXPENSES') {
                    totalDebit = openingBalance + txnDebit;
                    totalCredit = txnCredit;
                } else {
                    // Liabilities, Income, Equity: Credit-normal
                    totalCredit = openingBalance + txnCredit;
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
                invoice: true,
                purchasebill: true,
                payment: true,
                receipt: true,
                journalentry: true,
                posinvoice: true
            },
            orderBy: {
                date: 'desc'
            }
        });

        const formattedTransactions = transactions.map(txn => {
            let balanceType = 'Debit';
            let partyName = '-';
            let accountType = '-';
            let voucherNo = txn.voucherNumber || '-';
            let note = txn.description;
            let targetId = null;

            // Resolve Note from source documents if description is empty or generic
            if (!note || note === '-') {
                if (txn.invoice) note = txn.invoice.notes;
                else if (txn.purchasebill) note = txn.purchasebill.notes;
                else if (txn.receipt) note = txn.receipt.notes;
                else if (txn.payment) note = txn.payment.notes;
                else if (txn.journalentry) note = txn.journalentry.narration;
                // else if (txn.posinvoice) note = txn.posinvoice.notes; // Assuming POS has notes, if not leave it
            }

            // Logic to determine "Primary" view for the list
            // Sales (Invoice) -> Impact on Customer -> Debit
            if (txn.voucherType === 'Sales' || txn.invoice) {
                balanceType = 'Debit';
                partyName = txn.ledger_transaction_debitLedgerIdToledger?.name;
                accountType = txn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name || 'Debtors';
                if (txn.invoice) {
                    voucherNo = txn.invoice.invoiceNumber;
                    targetId = txn.invoice.id;
                }
            }
            // Purchase (Bill) -> Impact on Vendor -> Credit
            else if (txn.voucherType === 'Purchase' || txn.purchasebill) {
                balanceType = 'Credit';
                partyName = txn.ledger_transaction_creditLedgerIdToledger?.name;
                accountType = txn.ledger_transaction_creditLedgerIdToledger?.accountgroup?.name || 'Creditors';
                if (txn.purchasebill) {
                    voucherNo = txn.purchasebill.billNumber;
                    targetId = txn.purchasebill.id;
                }
            }
            // Receipt -> Impact on Customer -> Credit
            else if (txn.voucherType === 'Receipt' || txn.receipt) {
                balanceType = 'Credit';
                partyName = txn.ledger_transaction_creditLedgerIdToledger?.name; // Customer is credited
                accountType = txn.ledger_transaction_creditLedgerIdToledger?.accountgroup?.name;
                if (txn.receipt) {
                    voucherNo = txn.receipt.receiptNumber;
                    targetId = txn.receipt.id;
                }
            }
            // Payment -> Impact on Vendor -> Debit
            else if (txn.voucherType === 'Payment' || txn.payment) {
                balanceType = 'Debit';
                partyName = txn.ledger_transaction_debitLedgerIdToledger?.name; // Vendor is debited
                accountType = txn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name;
                if (txn.payment) {
                    voucherNo = txn.payment.paymentNumber;
                    targetId = txn.payment.id;
                }
            }
            // POS
            else if (txn.voucherType === 'POS_INVOICE' || txn.posinvoice) {
                balanceType = 'Debit';
                partyName = txn.ledger_transaction_debitLedgerIdToledger?.name || 'Walk-in';
                accountType = txn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name || 'Debtors';
                if (txn.posinvoice) {
                    voucherNo = txn.posinvoice.invoiceNumber;
                    targetId = txn.posinvoice.id;
                }
            }
            // Journal
            else if (txn.voucherType === 'Journal' || txn.journalentry) {
                balanceType = 'Debit'; // Default view
                partyName = txn.ledger_transaction_debitLedgerIdToledger?.name;
                accountType = txn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name;
                if (txn.journalentry) {
                    voucherNo = txn.journalentry.voucherNumber;
                    targetId = txn.journalentry.id;
                }
                if (!note && txn.journalentry) note = txn.journalentry.narration;
            }
            // Default/Journal/Contra
            else {
                // Show Debit side as primary?
                balanceType = 'Debit';
                partyName = txn.ledger_transaction_debitLedgerIdToledger?.name;
                accountType = txn.ledger_transaction_debitLedgerIdToledger?.accountgroup?.name;
            }

            return {
                id: txn.id,
                date: txn.date,
                transactionId: `TXN-${txn.id.toString().padStart(5, '0')}`,
                targetId,
                balanceType,
                voucherType: txn.voucherType,
                voucherNo,
                amount: parseFloat(txn.amount),
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
