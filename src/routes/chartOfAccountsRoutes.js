const express = require('express');
const router = express.Router();
const chartOfAccountsController = require('../controllers/chartOfAccountsController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Apply authentication middleware to all routes
router.use(authenticateToken);

// Chart of Accounts CRUD operations
router.get('/', chartOfAccountsController.getChartOfAccounts);
router.get('/types', chartOfAccountsController.getAccountTypes);
router.post('/initialize', chartOfAccountsController.initializeCOA);

// Account Groups CRUD
router.post('/groups', chartOfAccountsController.createAccountGroup);
router.get('/groups/:id', chartOfAccountsController.getAccountGroup);
router.put('/groups/:id', chartOfAccountsController.updateAccountGroup);
router.delete('/groups/:id', chartOfAccountsController.deleteAccountGroup);

// Account Sub Groups CRUD
router.post('/subgroups', chartOfAccountsController.createAccountSubGroup);
router.get('/subgroups/:id', chartOfAccountsController.getAccountSubGroup);
router.put('/subgroups/:id', chartOfAccountsController.updateAccountSubGroup);
router.delete('/subgroups/:id', chartOfAccountsController.deleteAccountSubGroup);

// Ledgers CRUD
router.post('/ledgers', chartOfAccountsController.createLedger);
router.get('/ledgers', chartOfAccountsController.getAllLedgers);
router.get('/ledgers/:id', chartOfAccountsController.getLedger);
router.put('/ledgers/:id', chartOfAccountsController.updateLedger);
router.delete('/ledgers/:id', chartOfAccountsController.deleteLedger);
router.get('/ledgers/:id/transactions', chartOfAccountsController.getLedgerTransactions);

module.exports = router;
