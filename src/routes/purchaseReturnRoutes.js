const express = require('express');
const router = express.Router();
const purchaseReturnController = require('../controllers/purchaseReturnController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/', purchaseReturnController.createReturn);
router.get('/', purchaseReturnController.getReturns);
router.get('/:id', purchaseReturnController.getReturnById);
router.put('/:id', purchaseReturnController.updateReturn);
router.delete('/:id', purchaseReturnController.deleteReturn);

module.exports = router;
