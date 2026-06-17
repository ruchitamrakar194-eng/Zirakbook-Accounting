const express = require('express');
const router = express.Router();
const salesOrderController = require('../controllers/salesOrderController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, salesOrderController.createOrder);
router.get('/', authenticateToken, salesOrderController.getOrders);
router.get('/:id', authenticateToken, salesOrderController.getOrderById);
router.put('/:id', authenticateToken, salesOrderController.updateOrder);
router.delete('/:id', authenticateToken, salesOrderController.deleteOrder);

module.exports = router;
