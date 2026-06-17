const express = require('express');
const {
    createPlan,
    getPlans,
    getPlanById,
    updatePlan,
    deletePlan
} = require('../controllers/planController');
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

const router = express.Router();

// Only Superadmin can manage plans (except getting list)
router.post('/', authenticateToken, authorizeRoles('SUPERADMIN'), createPlan);
router.get('/', getPlans);
router.get('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), getPlanById);
router.put('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), updatePlan);
router.delete('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), deletePlan);

module.exports = router;
