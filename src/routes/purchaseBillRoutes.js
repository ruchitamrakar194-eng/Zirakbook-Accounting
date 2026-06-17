const express = require('express');
const router = express.Router();
const purchaseBillController = require('../controllers/purchaseBillController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.post('/cleanup-orphaned-journals', purchaseBillController.cleanupOrphanedJournals);
router.post('/', purchaseBillController.createBill);
router.get('/', purchaseBillController.getBills);
router.get('/next-number', purchaseBillController.getNextNumber);
router.get('/:id', purchaseBillController.getBillById);
router.put('/:id', purchaseBillController.updateBill);
router.delete('/:id', purchaseBillController.deleteBill);

module.exports = router;
