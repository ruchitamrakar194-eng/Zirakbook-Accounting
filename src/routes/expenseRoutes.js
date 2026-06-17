const express = require('express');
const router = express.Router();
const expenseController = require('../controllers/expenseController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, expenseController.getExpenses);
router.post('/', authenticateToken, expenseController.createExpense);
router.delete('/:voucherNumber', authenticateToken, expenseController.deleteExpense);
router.put('/:voucherNumber', authenticateToken, expenseController.updateExpense);

module.exports = router;
