const express = require('express');
const router = express.Router();
const posController = require('../controllers/posController');
const { authenticateToken } = require('../middlewares/authMiddleware'); // Assuming auth middleware exists

router.post('/', authenticateToken, posController.createPOSInvoice);
router.get('/', authenticateToken, posController.getPOSInvoices);
router.get('/next-number', authenticateToken, posController.getNextNumber);
router.get('/:id', authenticateToken, posController.getPOSInvoiceById);
router.get('/public/:id', posController.getPublicPOSInvoiceById);
router.put('/:id', authenticateToken, posController.updatePOSInvoice);
router.delete('/:id', authenticateToken, posController.deletePOSInvoice);

module.exports = router;
