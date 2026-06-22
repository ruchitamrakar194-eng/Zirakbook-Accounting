const prisma = require('../config/prisma');
const fs = require('fs');
const path = require('path');

const logDebug = (msg) => {
    try {
        const logFile = path.join(__dirname, '../../search_debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
    } catch (e) {
        console.error('Failed to write to search_debug.log', e);
    }
};

const searchAll = async (req, res) => {
    try {
        const { q, companyId: queryCompanyId } = req.query;
        const rawCompanyId = req.user?.companyId || queryCompanyId;
        const companyId = parseInt(rawCompanyId);

        logDebug(`SEARCH REQUEST - Query: "${q}", req.user: ${JSON.stringify(req.user)}, companyId: ${companyId}`);

        if (!companyId) {
            logDebug(`SEARCH ERROR - Company ID is missing or invalid: "${rawCompanyId}"`);
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!q || q.trim() === '') {
            logDebug(`SEARCH EMPTY - Empty query, returning empty results`);
            return res.status(200).json({
                success: true,
                data: {
                    invoices: [],
                    purchaseBills: [],
                    customers: [],
                    vendors: [],
                    products: [],
                    vouchers: []
                }
            });
        }

        const query = q.trim();
        const queryId = parseInt(query);
        const isNumeric = !isNaN(queryId);

        const [
            invoices,
            purchaseBills,
            customers,
            vendors,
            products,
            vouchers,
            salesQuotations,
            salesOrders,
            deliveryChallans,
            salesReceipts,
            salesReturns,
            purchaseQuotations,
            purchaseOrders,
            goodsReceiptNotes,
            purchasePayments,
            purchaseReturns,
            posInvoices,
            journalVouchers,
            expenses,
            incomes,
            contras,
            addCapitals,
            drawingCapitals,
            journalEntries,
            allTransactions
        ] = await Promise.all([
            // Invoices
            prisma.invoice.findMany({
                where: {
                    companyId,
                    OR: [
                        { invoiceNumber: { contains: query } },
                        { notes: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Purchase Bills
            prisma.purchasebill.findMany({
                where: {
                    companyId,
                    OR: [
                        { billNumber: { contains: query } },
                        { notes: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // Customers
            prisma.customer.findMany({
                where: {
                    companyId,
                    OR: [
                        { name: { contains: query } },
                        { email: { contains: query } },
                        { phone: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Vendors
            prisma.vendor.findMany({
                where: {
                    companyId,
                    OR: [
                        { name: { contains: query } },
                        { email: { contains: query } },
                        { phone: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Products
            prisma.product.findMany({
                where: {
                    companyId,
                    OR: [
                        { name: { contains: query } },
                        { sku: { contains: query } },
                        { barcode: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Vouchers (Legacy fallback, matching everything in voucher table)
            prisma.voucher.findMany({
                where: {
                    companyId,
                    OR: [
                        { voucherNumber: { contains: query } },
                        { notes: { contains: query } },
                        { paidFromAccount: { contains: query } },
                        { paidToParty: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Sales Quotations
            prisma.salesquotation.findMany({
                where: {
                    companyId,
                    OR: [
                        { quotationNumber: { contains: query } },
                        { notes: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Sales Orders
            prisma.salesorder.findMany({
                where: {
                    companyId,
                    OR: [
                        { orderNumber: { contains: query } },
                        { notes: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Delivery Challans
            prisma.deliverychallan.findMany({
                where: {
                    companyId,
                    OR: [
                        { challanNumber: { contains: query } },
                        { notes: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Sales Receipts (customer payments)
            prisma.receipt.findMany({
                where: {
                    companyId,
                    OR: [
                        { receiptNumber: { contains: query } },
                        { notes: { contains: query } },
                        { referenceNumber: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Sales Returns
            prisma.salesreturn.findMany({
                where: {
                    companyId,
                    OR: [
                        { returnNumber: { contains: query } },
                        { reason: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Purchase Quotations
            prisma.purchasequotation.findMany({
                where: {
                    companyId,
                    OR: [
                        { quotationNumber: { contains: query } },
                        { notes: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // Purchase Orders
            prisma.purchaseorder.findMany({
                where: {
                    companyId,
                    OR: [
                        { orderNumber: { contains: query } },
                        { notes: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // Goods Receipt Notes (GRN)
            prisma.goodsreceiptnote.findMany({
                where: {
                    companyId,
                    OR: [
                        { grnNumber: { contains: query } },
                        { notes: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // Purchase Payments (vendor payments)
            prisma.payment.findMany({
                where: {
                    companyId,
                    OR: [
                        { paymentNumber: { contains: query } },
                        { notes: { contains: query } },
                        { referenceNumber: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // Purchase Returns
            prisma.purchasereturn.findMany({
                where: {
                    companyId,
                    OR: [
                        { returnNumber: { contains: query } },
                        { reason: { contains: query } },
                        { vendor: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { vendor: { select: { name: true } } },
                take: 10
            }),
            // POS Invoices
            prisma.posinvoice.findMany({
                where: {
                    companyId,
                    OR: [
                        { invoiceNumber: { contains: query } },
                        { notes: { contains: query } },
                        { customer: { name: { contains: query } } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                include: { customer: { select: { name: true } } },
                take: 10
            }),
            // Journal Vouchers (voucher model, voucherType JOURNAL, paidFromAccount not capital)
            prisma.voucher.findMany({
                where: {
                    companyId,
                    voucherType: 'JOURNAL',
                    AND: [
                        {
                            OR: [
                                { paidFromAccount: null },
                                { paidFromAccount: { notIn: ['CAPITAL_ADD', 'CAPITAL_DRAWING'] } }
                            ]
                        },
                        {
                            OR: [
                                { voucherNumber: { contains: query } },
                                { notes: { contains: query } },
                                ...(isNumeric ? [{ id: queryId }] : [])
                            ]
                        }
                    ]
                },
                take: 10
            }),
            // Expenses (transaction model, voucherType EXPENSE)
            prisma.transaction.findMany({
                where: {
                    companyId,
                    voucherType: 'EXPENSE',
                    OR: [
                        { voucherNumber: { contains: query } },
                        { narration: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Incomes (transaction model, voucherType INCOME)
            prisma.transaction.findMany({
                where: {
                    companyId,
                    voucherType: 'INCOME',
                    OR: [
                        { voucherNumber: { contains: query } },
                        { narration: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Contras (transaction model, voucherType CONTRA)
            prisma.transaction.findMany({
                where: {
                    companyId,
                    voucherType: 'CONTRA',
                    OR: [
                        { voucherNumber: { contains: query } },
                        { narration: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Add Capital (voucher model, voucherType JOURNAL, paidFromAccount CAPITAL_ADD)
            prisma.voucher.findMany({
                where: {
                    companyId,
                    voucherType: 'JOURNAL',
                    paidFromAccount: 'CAPITAL_ADD',
                    OR: [
                        { voucherNumber: { contains: query } },
                        { notes: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Drawing Capital (voucher model, voucherType JOURNAL, paidFromAccount CAPITAL_DRAWING)
            prisma.voucher.findMany({
                where: {
                    companyId,
                    voucherType: 'JOURNAL',
                    paidFromAccount: 'CAPITAL_DRAWING',
                    OR: [
                        { voucherNumber: { contains: query } },
                        { notes: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // Journal Entries (journalentry model - all journal voucher numbers)
            prisma.journalentry.findMany({
                where: {
                    companyId,
                    OR: [
                        { voucherNumber: { contains: query } },
                        { narration: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                take: 10
            }),
            // All Transactions (transaction model - catch-all for any voucherNumber across all types)
            prisma.transaction.findMany({
                where: {
                    companyId,
                    OR: [
                        { voucherNumber: { contains: query } },
                        { narration: { contains: query } },
                        ...(isNumeric ? [{ id: queryId }] : [])
                    ]
                },
                select: { id: true, voucherNumber: true, voucherType: true, narration: true, date: true, companyId: true, amount: true },
                take: 10
            })
        ]);

        logDebug(`SEARCH SUCCESS - Query: "${query}" | companyId: ${companyId} | invoices=${invoices.length} purchaseBills=${purchaseBills.length} customers=${customers.length} vendors=${vendors.length} products=${products.length} vouchers=${vouchers.length} salesQuotations=${salesQuotations.length} salesOrders=${salesOrders.length} deliveryChallans=${deliveryChallans.length} salesReceipts=${salesReceipts.length} salesReturns=${salesReturns.length} purchaseQuotations=${purchaseQuotations.length} purchaseOrders=${purchaseOrders.length} goodsReceiptNotes=${goodsReceiptNotes.length} purchasePayments=${purchasePayments.length} purchaseReturns=${purchaseReturns.length} posInvoices=${posInvoices.length} journalVouchers=${journalVouchers.length} expenses=${expenses.length} incomes=${incomes.length} contras=${contras.length} addCapitals=${addCapitals.length} drawingCapitals=${drawingCapitals.length} journalEntries=${journalEntries.length} allTransactions=${allTransactions.length}`);

        res.status(200).json({
            success: true,
            data: {
                invoices,
                purchaseBills,
                customers,
                vendors,
                products,
                vouchers,
                salesQuotations,
                salesOrders,
                deliveryChallans,
                salesReceipts,
                salesReturns,
                purchaseQuotations,
                purchaseOrders,
                goodsReceiptNotes,
                purchasePayments,
                purchaseReturns,
                posInvoices,
                journalVouchers,
                expenses,
                incomes,
                contras,
                addCapitals,
                drawingCapitals,
                journalEntries,
                allTransactions
            }
        });
    } catch (error) {
        logDebug(`SEARCH EXCEPTION - Error: ${error.message}\n${error.stack}`);
        console.error('Global Search Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { searchAll };

