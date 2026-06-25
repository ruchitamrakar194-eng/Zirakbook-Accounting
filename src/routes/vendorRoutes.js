const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const { authenticateToken, authorizePermissions } = require('../middlewares/authMiddleware');

// Protect all routes
router.use(authenticateToken);

// CRUD Routes
router.post('/', authorizePermissions('create accounts'), vendorController.createVendor);
router.get('/', authorizePermissions('view accounts'), vendorController.getAllVendors);
router.post('/recalculate-all', authorizePermissions('edit accounts'), vendorController.recalculateAllBalances);
router.get('/:id', authorizePermissions('view accounts'), vendorController.getVendorById);
router.get('/statement/:id', authorizePermissions('view accounts'), vendorController.getVendorStatement);
router.put('/:id', authorizePermissions('edit accounts'), vendorController.updateVendor);
router.delete('/:id', authorizePermissions('delete accounts'), vendorController.deleteVendor);
router.post('/:id/recalculate', authorizePermissions('edit accounts'), vendorController.recalculateBalance);

module.exports = router;
