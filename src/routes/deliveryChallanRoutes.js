const express = require('express');
const router = express.Router();
const deliveryChallanController = require('../controllers/deliveryChallanController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.post('/', authenticateToken, deliveryChallanController.createChallan);
router.get('/', authenticateToken, deliveryChallanController.getChallans);
router.get('/:id', authenticateToken, deliveryChallanController.getChallanById);
router.put('/:id', authenticateToken, deliveryChallanController.updateChallan);
router.delete('/:id', authenticateToken, deliveryChallanController.deleteChallan);
router.post('/convert-multiple', authenticateToken, deliveryChallanController.convertMultipleToInvoice);
router.post('/:id/convert', authenticateToken, deliveryChallanController.convertToInvoice);

module.exports = router;
