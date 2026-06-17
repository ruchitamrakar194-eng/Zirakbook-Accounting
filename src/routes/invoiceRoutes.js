const express = require('express');
const router = express.Router();
const invoiceController = require('../controllers/invoiceController');
// const { authenticateToken } = require('../middleware/authMiddleware'); // Assuming auth middleware exists

// If auth fits, uncomment middleware
// router.use(authenticateToken); 

router.post('/', invoiceController.create);
router.get('/', invoiceController.getAll);
router.get('/:id', invoiceController.getById);
router.put('/:id', invoiceController.update);
router.delete('/:id', invoiceController.delete);

module.exports = router;
