const express = require('express');
const router = express.Router();
const serviceController = require('../controllers/serviceController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, serviceController.getServices);
router.get('/:id', authenticateToken, serviceController.getServiceById);
router.post('/', authenticateToken, serviceController.createService);
router.put('/:id', authenticateToken, serviceController.updateService);
router.delete('/:id', authenticateToken, serviceController.deleteService);

module.exports = router;
