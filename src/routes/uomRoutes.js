const express = require('express');
const router = express.Router();
const uomController = require('../controllers/uomController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, uomController.getUOMs);
router.get('/:id', authenticateToken, uomController.getUOMById);
router.post('/', authenticateToken, uomController.createUOM);
router.put('/:id', authenticateToken, uomController.updateUOM);
router.delete('/:id', authenticateToken, uomController.deleteUOM);

module.exports = router;
