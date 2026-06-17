const express = require('express');
const router = express.Router();
const salesInvoiceController = require('../controllers/salesInvoiceController');
const { authenticateToken, authorizePermissions } = require('../middlewares/authMiddleware');

router.post('/cleanup-orphaned-journals', authenticateToken, salesInvoiceController.cleanupOrphanedJournals);
router.post('/', authenticateToken, authorizePermissions('create sales'), salesInvoiceController.createInvoice);
router.get('/', authenticateToken, authorizePermissions('view sales'), salesInvoiceController.getInvoices);
router.get('/next-number', authenticateToken, salesInvoiceController.getNextNumber);
router.get('/:id', authenticateToken, authorizePermissions('view sales'), salesInvoiceController.getInvoiceById);
router.get('/public/:id', salesInvoiceController.getPublicInvoiceById);
router.put('/:id', authenticateToken, authorizePermissions('edit sales'), salesInvoiceController.updateInvoice);
router.delete('/:id', authenticateToken, authorizePermissions('delete sales'), salesInvoiceController.deleteInvoice);

module.exports = router;
