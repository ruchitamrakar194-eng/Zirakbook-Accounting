const express = require('express');
const router = express.Router();
const salesReceiptController = require('../controllers/salesReceiptController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, salesReceiptController.createReceipt);
router.get('/', authenticateToken, salesReceiptController.getReceipts);
router.get('/:id', authenticateToken, salesReceiptController.getReceiptById);
router.put('/:id', authenticateToken, salesReceiptController.updateReceipt);
router.delete('/:id', authenticateToken, salesReceiptController.deleteReceipt);

module.exports = router;
