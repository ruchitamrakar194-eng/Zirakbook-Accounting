const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { authenticateToken, authorizePermissions } = require('../middlewares/authMiddleware');

// All routes require authentication
router.use(authenticateToken);

// Customer Routes
router.post('/', authorizePermissions('create accounts'), customerController.createCustomer);
router.get('/', authorizePermissions('view accounts'), customerController.getAllCustomers);
// Static action routes MUST come before /:id to avoid routing conflicts
router.post('/recalculate-all', authorizePermissions('edit accounts'), customerController.recalculateAllBalances);
router.get('/:id', authorizePermissions('view accounts'), customerController.getCustomerById);
router.put('/:id', authorizePermissions('edit accounts'), customerController.updateCustomer);
router.delete('/:id', authorizePermissions('delete accounts'), customerController.deleteCustomer);
router.get('/:id/statement', authorizePermissions('view accounts'), customerController.getCustomerStatement);
router.post('/:id/recalculate', authorizePermissions('edit accounts'), customerController.recalculateBalance);

module.exports = router;
