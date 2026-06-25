const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Super Admin Dashboard Stats
const getSuperAdminDashboardStats = async (req, res) => {
    try {
        const totalCompanies = await prisma.company.count();
        const totalRequests = await prisma.planrequest.count();

        const payments = await prisma.paymentrecord.findMany({
            where: { status: 'Success' }
        });
        const totalRevenue = payments.reduce((acc, curr) => acc + curr.amount, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todaySignups = await prisma.company.count({
            where: {
                createdAt: {
                    gte: today
                }
            }
        });

        // Monthly signups for charts
        const startOfYear = new Date(new Date().getFullYear(), 0, 1);
        const companies = await prisma.company.findMany({
            where: {
                createdAt: { gte: startOfYear }
            },
            select: { createdAt: true }
        });

        const monthlySignups = Array(12).fill(0);
        companies.forEach(c => {
            const month = new Date(c.createdAt).getMonth();
            monthlySignups[month]++;
        });

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const growthData = months.map((month, index) => ({
            name: month,
            val: monthlySignups[index]
        }));

        // Monthly revenue for charts
        const successfulPayments = await prisma.paymentrecord.findMany({
            where: {
                status: 'Success',
                date: { gte: startOfYear }
            }
        });

        const monthlyRevenue = Array(12).fill(0);
        successfulPayments.forEach(p => {
            const month = new Date(p.date).getMonth();
            monthlyRevenue[month] += p.amount;
        });

        const revenueData = months.map((month, index) => ({
            name: month,
            val: monthlyRevenue[index]
        }));

        res.json({
            stats: {
                totalCompanies,
                totalRequests,
                totalRevenue,
                todaySignups
            },
            charts: {
                growthData,
                revenueData
            }
        });
    } catch (error) {
        console.error('Super Admin Dashboard Stats Error:', error);
        res.status(500).json({ error: error.message });
    }
};

// Company Dashboard Stats
const getCompanyDashboardStats = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.query.companyId || (req.body && req.body.companyId);

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const compId = parseInt(companyId);

        // 1. Fetch INCOME and EXPENSES Ledgers
        const ledgers = await prisma.ledger.findMany({
            where: {
                companyId: compId,
                accountgroup: {
                    type: { in: ['INCOME', 'EXPENSES'] }
                }
            },
            include: {
                accountgroup: true
            }
        });

        // 2. Fetch All Transactions for lifetime total
        const allTransactions = await prisma.transaction.findMany({
            where: {
                companyId: compId
            }
        });

        let totalRevenue = 0;
        let totalExpenses = 0;

        ledgers.forEach(l => {
            const openBal = parseFloat(l.openingBalance || 0);
            if (l.accountgroup.type === 'INCOME') totalRevenue += openBal;
            if (l.accountgroup.type === 'EXPENSES') totalExpenses += openBal;
        });

        allTransactions.forEach(txn => {
            const amount = txn.amount || 0;
            const debitLedger = ledgers.find(l => l.id === txn.debitLedgerId);
            const creditLedger = ledgers.find(l => l.id === txn.creditLedgerId);

            if (debitLedger) {
                if (debitLedger.accountgroup.type === 'EXPENSES') {
                    totalExpenses += amount;
                } else if (debitLedger.accountgroup.type === 'INCOME') {
                    totalRevenue -= amount;
                }
            }

            if (creditLedger) {
                if (creditLedger.accountgroup.type === 'INCOME') {
                    totalRevenue += amount;
                } else if (creditLedger.accountgroup.type === 'EXPENSES') {
                    totalExpenses -= amount;
                }
            }
        });

        // 3. Calculate Net Profit
        const netProfit = totalRevenue - totalExpenses;

        // 3.5. General Counts
        const customerCount = await prisma.customer.count({ where: { companyId: compId } });
        const vendorCount = await prisma.vendor.count({ where: { companyId: compId } });
        const productCount = await prisma.product.count({ where: { companyId: compId } });

        // Count for standard invoices & POS invoices
        const saleInvoiceCount = await prisma.invoice.count({
            where: { companyId: compId, NOT: { status: 'CANCELLED' } }
        }) + await prisma.posinvoice.count({
            where: { companyId: compId }
        });

        const purchaseBillCount = await prisma.purchasebill.count({
            where: { companyId: compId, NOT: { status: 'CANCELLED' } }
        });

        // 4. Recent Transactions (Limit 5)
        const recentTransactions = await prisma.transaction.findMany({
            where: { companyId: compId },
            orderBy: { date: 'desc' },
            take: 5,
            include: {
                ledger_transaction_debitLedgerIdToledger: { select: { name: true } },
                ledger_transaction_creditLedgerIdToledger: { select: { name: true } }
            }
        });

        const formattedTransactions = recentTransactions.map(tx => ({
            id: tx.id,
            date: tx.date,
            description: tx.narration,
            amount: tx.amount,
            type: tx.voucherType,
            status: 'Completed'
        }));

        // 5. Monthly Data for Charts (Based on Current Year's Transactions)
        const monthsList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const currentYear = new Date().getFullYear();
        const startOfYear = new Date(currentYear, 0, 1);
        const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

        const yearTransactions = await prisma.transaction.findMany({
            where: {
                companyId: compId,
                date: { gte: startOfYear, lte: endOfYear }
            }
        });

        const monthlyRevenue = Array(12).fill(0);
        const monthlyExpense = Array(12).fill(0);

        yearTransactions.forEach(txn => {
            const m = new Date(txn.date).getMonth();
            const amount = txn.amount || 0;
            const debitLedger = ledgers.find(l => l.id === txn.debitLedgerId);
            const creditLedger = ledgers.find(l => l.id === txn.creditLedgerId);

            if (debitLedger) {
                if (debitLedger.accountgroup.type === 'EXPENSES') {
                    monthlyExpense[m] += amount;
                } else if (debitLedger.accountgroup.type === 'INCOME') {
                    monthlyRevenue[m] -= amount;
                }
            }

            if (creditLedger) {
                if (creditLedger.accountgroup.type === 'INCOME') {
                    monthlyRevenue[m] += amount;
                } else if (creditLedger.accountgroup.type === 'EXPENSES') {
                    monthlyExpense[m] -= amount;
                }
            }
        });

        const chartData = monthsList.map((m, i) => ({
            name: m,
            revenue: Math.max(0, monthlyRevenue[i]),
            expense: Math.max(0, monthlyExpense[i])
        }));

        // 6. Top Selling Products (Calculated from Invoice Items & POS Invoice Items)
        const topProductItems = await prisma.invoiceitem.groupBy({
            by: ['productId'],
            where: {
                invoice: { companyId: compId, NOT: { status: 'CANCELLED' } },
                productId: { not: null }
            },
            _sum: { quantity: true }
        });

        const topPosProductItems = await prisma.posinvoiceitem.groupBy({
            by: ['productId'],
            where: {
                posinvoice: { companyId: compId },
                productId: { not: null }
            },
            _sum: { quantity: true }
        });

        const productQuantities = {};
        topProductItems.forEach(item => {
            productQuantities[item.productId] = (productQuantities[item.productId] || 0) + (item._sum.quantity || 0);
        });
        topPosProductItems.forEach(item => {
            productQuantities[item.productId] = (productQuantities[item.productId] || 0) + (item._sum.quantity || 0);
        });

        const topProductIds = Object.keys(productQuantities)
            .map(id => ({ productId: parseInt(id), quantity: productQuantities[id] }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        const topProductsRaw = await Promise.all(topProductIds.map(async (item) => {
            const product = await prisma.product.findUnique({
                where: { id: item.productId },
                select: { name: true, salePrice: true, image: true }
            });
            if (!product) return null;
            return {
                ...product,
                quantity: item.quantity
            };
        }));
        const topProducts = topProductsRaw.filter(Boolean);

        // 7. Low Stock Products
        const lowStock = await prisma.stock.findMany({
            where: {
                product: { companyId: compId },
                quantity: { lte: prisma.stock.fields.minOrderQty }
            },
            include: { product: { select: { name: true, image: true } } },
            take: 5
        });

        const lowStockProducts = lowStock.map(s => ({
            name: s.product.name,
            quantity: s.quantity,
            minQty: s.minOrderQty,
            image: s.product.image
        }));

        // 8. Top Customers (By Revenue from Invoices & POS Invoices)
        const topCustomerInvoices = await prisma.invoice.groupBy({
            by: ['customerId'],
            where: { companyId: compId, NOT: { status: 'CANCELLED' } },
            _sum: { totalAmount: true }
        });

        const topCustomerPosInvoices = await prisma.posinvoice.groupBy({
            by: ['customerId'],
            where: { companyId: compId, customerId: { not: null } },
            _sum: { totalAmount: true }
        });

        const customerRevenues = {};
        topCustomerInvoices.forEach(item => {
            if (item.customerId) {
                customerRevenues[item.customerId] = (customerRevenues[item.customerId] || 0) + (item._sum.totalAmount || 0);
            }
        });
        topCustomerPosInvoices.forEach(item => {
            if (item.customerId) {
                customerRevenues[item.customerId] = (customerRevenues[item.customerId] || 0) + (item._sum.totalAmount || 0);
            }
        });

        const topCustomerIds = Object.keys(customerRevenues)
            .map(id => ({ customerId: parseInt(id), totalAmount: customerRevenues[id] }))
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .slice(0, 5);

        const topCustomersRaw = await Promise.all(topCustomerIds.map(async (item) => {
            const customer = await prisma.customer.findUnique({
                where: { id: item.customerId },
                select: { name: true, email: true, profileImage: true }
            });
            if (!customer) return null;
            return {
                ...customer,
                totalSales: item.totalAmount
            };
        }));
        const topCustomers = topCustomersRaw.filter(Boolean);

        res.json({
            success: true,
            data: {
                totalRevenue,
                totalExpenses,
                netProfit,
                customerCount,
                vendorCount,
                productCount,
                saleInvoiceCount,
                purchaseBillCount,
                recentTransactions: formattedTransactions,
                chartData,
                topProducts,
                lowStockProducts,
                topCustomers
            }
        });

    } catch (error) {
        console.error('Company Dashboard Stats Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const createAnnouncement = async (req, res) => {
    try {
        const { title, content, status } = req.body;
        const announcement = await prisma.dashboardannouncement.create({
            data: { title, content, status: status || 'Active' }
        });
        res.status(201).json(announcement);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getAnnouncements = async (req, res) => {
    try {
        const announcements = await prisma.dashboardannouncement.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(announcements);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getAnnouncementById = async (req, res) => {
    try {
        const announcement = await prisma.dashboardannouncement.findUnique({
            where: { id: parseInt(req.params.id) }
        });
        if (!announcement) return res.status(404).json({ message: 'Announcement not found' });
        res.json(announcement);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const updateAnnouncement = async (req, res) => {
    try {
        const { title, content, status } = req.body;
        const announcement = await prisma.dashboardannouncement.update({
            where: { id: parseInt(req.params.id) },
            data: { title, content, status }
        });
        res.json(announcement);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const deleteAnnouncement = async (req, res) => {
    try {
        await prisma.dashboardannouncement.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ message: 'Announcement deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getSuperAdminDashboardStats,
    getCompanyDashboardStats,
    createAnnouncement,
    getAnnouncements,
    getAnnouncementById,
    updateAnnouncement,
    deleteAnnouncement
};
