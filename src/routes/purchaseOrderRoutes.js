const express = require('express');
const router = express.Router();
const purchaseOrderController = require('../controllers/purchaseOrderController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/', purchaseOrderController.createOrder);
router.get('/', purchaseOrderController.getOrders);
router.get('/:id', purchaseOrderController.getOrderById);
router.put('/:id', purchaseOrderController.updateOrder);
router.delete('/:id', purchaseOrderController.deleteOrder);

module.exports = router;
