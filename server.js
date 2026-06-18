require('dotenv').config();

const fs = require('fs');
const path = require('path');

// Database synchronized successfully

const express = require('express');
const cors = require('cors');
const authRoutes = require('./src/routes/authRoutes');
const companyRoutes = require('./src/routes/companyRoutes');
const planRoutes = require('./src/routes/planRoutes');
const planRequestRoutes = require('./src/routes/planRequestRoutes');
const paymentRoutes = require('./src/routes/paymentRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const profileRoutes = require('./src/routes/profileRoutes');
const chartOfAccountsRoutes = require('./src/routes/chartOfAccountsRoutes');
const customerRoutes = require('./src/routes/customerRoutes');
const vendorRoutes = require('./src/routes/vendorRoutes');
const bankTransferRoutes = require('./src/routes/bankTransferRoutes');
const expenseRoutes = require('./src/routes/expenseRoutes');
const incomeRoutes = require('./src/routes/incomeRoutes');
const contraRoutes = require('./src/routes/contraRoutes');
// Warehouse Routes
const warehouseRoutes = require('./src/routes/warehouseRoutes');
const productRoutes = require('./src/routes/productRoutes');
const categoryRoutes = require('./src/routes/categoryRoutes');
const uomRoutes = require('./src/routes/uomRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const serviceRoutes = require('./src/routes/serviceRoutes');
const stockTransferRoutes = require('./src/routes/stockTransferRoutes');
const adjustmentRoutes = require('./src/routes/adjustmentRoutes');
const salesQuotationRoutes = require('./src/routes/salesQuotationRoutes');
const salesOrderRoutes = require('./src/routes/salesOrderRoutes');
const deliveryChallanRoutes = require('./src/routes/deliveryChallanRoutes');
const salesInvoiceRoutes = require('./src/routes/salesInvoiceRoutes');
const salesReceiptRoutes = require('./src/routes/salesReceiptRoutes');
const salesReturnRoutes = require('./src/routes/salesReturnRoutes');
const posRoutes = require('./src/routes/posRoutes');
const passwordRequestRoutes = require('./src/routes/passwordRequestRoutes');
// Purchase Routes
const purchaseQuotationRoutes = require('./src/routes/purchaseQuotationRoutes');
const purchaseOrderRoutes = require('./src/routes/purchaseOrderRoutes');
const goodsReceiptNoteRoutes = require('./src/routes/goodsReceiptNoteRoutes');
const purchaseReturnRoutes = require('./src/routes/purchaseReturnRoutes');
const purchaseBillRoutes = require('./src/routes/purchaseBillRoutes');
const voucherRoutes = require('./src/routes/voucherRoutes');
const roleRoutes = require('./src/routes/roleRoutes');
const userRoutes = require('./src/routes/userRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const uploadRoutes = require('./src/routes/uploadRoutes');
const auditLogRoutes = require('./src/routes/auditLogRoutes');

const prisma = require('./src/config/prisma');

    // Force Restart Triggered - 6
const app = express();
const PORT = process.env.PORT || 8080;

// Debug logging for startup
console.log('--- SERVER STARTUP ---');
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`Port Configured: ${PORT}`);
console.log(`Current Working Directory: ${process.cwd()}`);
console.log(`Database Host Check: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.split('@')[1].split(':')[0] : 'NOT SET'}`);

prisma.$connect()
    .then(() => {
        console.log('✅ Database connected successfully');
        fs.writeFileSync('C:\\Users\\kiaan\\.gemini\\antigravity-ide\\scratch\\db_conn.log', 'SUCCESS: Database connected successfully');
    })
    .catch((err) => {
        console.error('❌ Database connection failed!');
        console.error(err.message);
        fs.writeFileSync('C:\\Users\\kiaan\\.gemini\\antigravity-ide\\scratch\\db_conn.log', `FAILED: ${err.message}\n${err.stack}`);
    });

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! Shutting down...');
    console.error(err.name, err.message);
    console.error(err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});

app.use(cors({
    origin: [
        'https://accounting-news.kiaantechnology.com',
        'https://zirakbook-accounting.wenbear.online',
        'https://zirakbook-accounting.wenbear.online/',
        'https://accounting-news.kiaantechnology.com/',
        'http://localhost:5173',
        'https://new-accounting.netlify.app',
        'http://new-accounting.netlify.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/plan-requests', planRequestRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/superadmin/dashboard', dashboardRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/chart-of-accounts', chartOfAccountsRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/bank-transfers', bankTransferRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/income', incomeRoutes);
app.use('/api/contra', contraRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/uom', uomRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/stock-transfers', stockTransferRoutes);
app.use('/api/adjustments', adjustmentRoutes);
app.use('/api/sales-quotations', salesQuotationRoutes);
app.use('/api/sales-orders', salesOrderRoutes);
app.use('/api/delivery-challans', deliveryChallanRoutes);
app.use('/api/sales-invoices', salesInvoiceRoutes);
app.use('/api/sales-receipts', salesReceiptRoutes);
app.use('/api/sales-returns', salesReturnRoutes);
app.use('/api/pos-invoices', posRoutes);
app.use('/api/password-requests', passwordRequestRoutes);
app.use('/api/purchase-quotations', purchaseQuotationRoutes);
app.use('/api/purchase-orders', purchaseOrderRoutes);
app.use('/api/grns', goodsReceiptNoteRoutes);
app.use('/api/purchase-returns', purchaseReturnRoutes);
app.use('/api/purchase-bills', purchaseBillRoutes);
app.use('/api/purchase-payments', paymentRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/audit-logs', auditLogRoutes);

// Health Check
app.get('/', (req, res) => {
    res.send('Accounting Software Backend is running');
});



// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('--- ERROR START ---');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    if (err.data) console.error('Cloudinary Data:', err.data);
    console.error('--- ERROR END ---');

    const statusCode = err.status || err.statusCode || 500;
    res.status(statusCode).json({
        message: err.message || 'Internal Server Error',
        error: process.env.NODE_ENV === 'development' ? err : {},
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
