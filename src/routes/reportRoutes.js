const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/sales', authenticateToken, reportController.getSalesReport);
router.get('/sales-by-item', authenticateToken, reportController.getSalesByItemReport);
router.get('/sales-by-customer', authenticateToken, reportController.getSalesByCustomerReport);
router.get('/sales-by-salesman', authenticateToken, reportController.getSalesBySalesmanReport);
router.get('/purchase', authenticateToken, reportController.getPurchaseReport);
router.get('/purchase-by-item', authenticateToken, reportController.getPurchaseByItemReport);
router.get('/purchase-by-vendor', authenticateToken, reportController.getPurchaseByVendorReport);
router.get('/pos', authenticateToken, reportController.getPosReport);
router.get('/tax', authenticateToken, reportController.getTaxReport);
router.get('/inventory-summary', authenticateToken, reportController.getInventorySummary);
router.get('/balance-sheet', authenticateToken, reportController.getBalanceSheet);
// Cash Flow
router.get('/cash-flow', authenticateToken, reportController.getCashFlowStatement);
router.get('/profit-loss', authenticateToken, reportController.getProfitLoss);
router.get('/vat', authenticateToken, reportController.getVatReport);
router.get('/daybook', authenticateToken, reportController.getDayBook);
router.get('/journal', authenticateToken, reportController.getJournalReport);
router.get('/trial-balance', authenticateToken, reportController.getTrialBalance);
router.get('/transactions', authenticateToken, reportController.getAllTransactions);

module.exports = router;