const express = require('express');
const router = express.Router();
const { createIncome, getIncome, deleteIncome, updateIncome } = require('../controllers/incomeController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, createIncome);
router.get('/', authenticateToken, getIncome);
router.delete('/:voucherNumber', authenticateToken, deleteIncome);
router.put('/:voucherNumber', authenticateToken, updateIncome);

module.exports = router;
