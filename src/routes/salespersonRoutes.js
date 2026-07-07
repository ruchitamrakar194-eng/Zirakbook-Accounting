const express = require('express');
const router = express.Router();
const salespersonController = require('../controllers/salespersonController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.use(authenticateToken);

router.get('/', salespersonController.getSalespersons);
router.post('/', salespersonController.createSalesperson);
router.put('/:id', salespersonController.updateSalesperson);
router.delete('/:id', salespersonController.deleteSalesperson);

module.exports = router;
