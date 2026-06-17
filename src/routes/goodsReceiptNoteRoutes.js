const express = require('express');
const router = express.Router();
const goodsReceiptNoteController = require('../controllers/goodsReceiptNoteController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/', goodsReceiptNoteController.createGRN);
router.get('/', goodsReceiptNoteController.getGRNs);
router.get('/:id', goodsReceiptNoteController.getGRNById);
router.put('/:id', goodsReceiptNoteController.updateGRN);
router.delete('/:id', goodsReceiptNoteController.deleteGRN);

module.exports = router;
