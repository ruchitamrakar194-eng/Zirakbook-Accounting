const express = require('express');
const router = express.Router();
const bankTransferController = require('../controllers/bankTransferController');
const { authenticateToken } = require('../middlewares/authMiddleware');

// Base path: /api/bank-transfers/

router.get('/', authenticateToken, bankTransferController.getTransfers);
router.post('/', authenticateToken, bankTransferController.createTransfer);
router.get('/:id', authenticateToken, bankTransferController.getTransferById);
router.put('/:id', authenticateToken, bankTransferController.updateTransfer);
router.delete('/:id', authenticateToken, bankTransferController.deleteTransfer);

module.exports = router;
