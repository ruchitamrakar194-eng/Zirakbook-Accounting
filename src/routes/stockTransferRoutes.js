const express = require('express');
const router = express.Router();
const stockTransferController = require('../controllers/stockTransferController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, stockTransferController.getStockTransfers);
router.get('/next-number', authenticateToken, stockTransferController.getNextNumber);
router.get('/:id', authenticateToken, stockTransferController.getStockTransferById);
router.post('/', authenticateToken, stockTransferController.createStockTransfer);
router.put('/:id', authenticateToken, stockTransferController.updateStockTransfer);
router.delete('/:id', authenticateToken, stockTransferController.deleteStockTransfer);

module.exports = router;
