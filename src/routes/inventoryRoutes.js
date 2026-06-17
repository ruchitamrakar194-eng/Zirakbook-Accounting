const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/transfer', authenticateToken, inventoryController.transferStock);
router.post('/adjust', authenticateToken, inventoryController.adjustStock);
router.get('/history', authenticateToken, inventoryController.getInventoryHistory);
router.post('/recalculate', authenticateToken, inventoryController.recalculateInventory);

module.exports = router;
