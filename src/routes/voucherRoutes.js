const express = require('express');
const router = express.Router();
const voucherController = require('../controllers/voucherController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/', voucherController.createVoucher);
router.get('/', voucherController.getVouchers);
router.get('/next-number', voucherController.getNextNumber);
router.get('/:id', voucherController.getVoucherById);
router.put('/:id', voucherController.updateVoucher);
router.delete('/:id', voucherController.deleteVoucher);

module.exports = router;
