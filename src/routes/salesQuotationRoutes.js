const express = require('express');
const router = express.Router();
const salesQuotationController = require('../controllers/salesQuotationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, salesQuotationController.createQuotation);
router.get('/', authenticateToken, salesQuotationController.getQuotations);
router.get('/:id', authenticateToken, salesQuotationController.getQuotationById);
router.put('/:id', authenticateToken, salesQuotationController.updateQuotation);
router.delete('/:id', authenticateToken, salesQuotationController.deleteQuotation);
router.post('/:id/convert', authenticateToken, salesQuotationController.convertToSalesOrder);

module.exports = router;
