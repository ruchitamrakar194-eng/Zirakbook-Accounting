const express = require('express');
const router = express.Router();
const salesReturnController = require('../controllers/salesReturnController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, salesReturnController.createReturn);
router.get('/', authenticateToken, salesReturnController.getReturns);
router.get('/:id', authenticateToken, salesReturnController.getReturnById);
router.put('/:id', authenticateToken, salesReturnController.updateReturn);
router.delete('/:id', authenticateToken, salesReturnController.deleteReturn);

module.exports = router;
