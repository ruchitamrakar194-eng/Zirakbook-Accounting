const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { authenticateToken, authorizePermissions } = require('../middlewares/authMiddleware');



router.get('/', authenticateToken, authorizePermissions('view inventory'), productController.getProducts);
router.get('/upload-signature', authenticateToken, productController.getCloudinarySignature);
router.get('/:id', authenticateToken, authorizePermissions('view inventory'), productController.getProductById);
router.post('/', authenticateToken, authorizePermissions('create inventory'), productController.createProduct);
router.put('/:id', authenticateToken, authorizePermissions('edit inventory'), productController.updateProduct);
router.delete('/:id', authenticateToken, authorizePermissions('delete inventory'), productController.deleteProduct);

module.exports = router;