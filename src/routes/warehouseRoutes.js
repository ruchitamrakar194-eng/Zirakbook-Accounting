const express = require('express');
const router = express.Router();
const { createWarehouse, getWarehouses, updateWarehouse, deleteWarehouse, getWarehouseById } = require('../controllers/warehouseController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, createWarehouse);
router.get('/', authenticateToken, getWarehouses);
router.get('/:id', authenticateToken, getWarehouseById);
router.put('/:id', authenticateToken, updateWarehouse);
router.delete('/:id', authenticateToken, deleteWarehouse);

module.exports = router;
