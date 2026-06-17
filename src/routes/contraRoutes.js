const express = require('express');
const router = express.Router();
const { createContra, getContra, deleteContra, updateContra } = require('../controllers/contraController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, createContra);
router.get('/', authenticateToken, getContra);
router.delete('/:voucherNumber', authenticateToken, deleteContra);
router.put('/:voucherNumber', authenticateToken, updateContra);

module.exports = router;
