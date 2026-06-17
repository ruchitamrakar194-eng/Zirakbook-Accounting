const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { authenticateToken } = require('../middlewares/authMiddleware');

router.get('/', authenticateToken, categoryController.getCategories);
router.post('/', authenticateToken, categoryController.createCategory);
router.put('/:id', authenticateToken, categoryController.updateCategory);
router.delete('/:id', authenticateToken, categoryController.deleteCategory);

module.exports = router;
