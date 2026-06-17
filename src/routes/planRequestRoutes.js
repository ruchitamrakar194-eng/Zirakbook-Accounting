const express = require('express');
const {
    createPlanRequest,
    getPlanRequests,
    getPlanRequestById,
    updatePlanRequest,
    deletePlanRequest,
    approvePlanRequest,
    rejectPlanRequest
} = require('../controllers/planRequestController');
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/cloudinaryConfig');

const router = express.Router();

// Allow public to create plan requests, manage requires Superadmin
router.post('/', upload.single('logo'), createPlanRequest);
router.get('/', authenticateToken, authorizeRoles('SUPERADMIN'), getPlanRequests);
router.get('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), getPlanRequestById);
router.put('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), updatePlanRequest);
router.delete('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), deletePlanRequest);

// New semantic endpoints for Accept/Reject
router.put('/:id/approve', authenticateToken, authorizeRoles('SUPERADMIN'), approvePlanRequest);
router.put('/:id/reject', authenticateToken, authorizeRoles('SUPERADMIN'), rejectPlanRequest);

module.exports = router;
