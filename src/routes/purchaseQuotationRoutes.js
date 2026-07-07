const express = require('express');
const router = express.Router();
const purchaseQuotationController = require('../controllers/purchaseQuotationController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/', purchaseQuotationController.createQuotation);
router.get('/', purchaseQuotationController.getQuotations);
router.get('/:id', purchaseQuotationController.getQuotationById);
router.put('/:id', purchaseQuotationController.updateQuotation);
router.delete('/:id', purchaseQuotationController.deleteQuotation);
router.post('/:id/convert', purchaseQuotationController.convertToPurchaseOrder);

module.exports = router;
