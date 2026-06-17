const express = require('express');
const {
    createCompany,
    getCompanies,
    getCompanyById,
    updateCompany,
    deleteCompany,
    getNumberingSettings,
    updateNumberingSettings,
    getNextNumberEndpoint
} = require('../controllers/companyController');
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');
const { upload } = require('../utils/cloudinaryConfig');

const router = express.Router();

// Middleware to check if user has access to this company
const checkCompanyAccess = (req, res, next) => {
    const userRole = (req.user.role || '').toUpperCase();

    if (userRole === 'SUPERADMIN') return next();

    // Convert to numbers for safe comparison
    const requestedCompanyId = Number(req.params.id);
    const userCompanyId = Number(req.user.companyId);

    if (userCompanyId === requestedCompanyId) {
        // Allow GET request for all roles within the company (COMPANY, ADMIN, USER, USERS, etc.)
        if (req.method === 'GET') return next();

        // For other requests (like PUT), only allow COMPANY and ADMIN roles
        if (['COMPANY', 'ADMIN'].includes(userRole)) return next();

        return res.status(403).json({
            message: 'Access denied: Your role does not have permission to modify this company',
            debug: { role: userRole, method: req.method }
        });
    }

    return res.status(403).json({
        message: 'Access denied: You do not belong to this company',
        debug: { userCompanyId, requestedCompanyId }
    });
};

// Only Superadmin can create or delete companies
router.post('/', authenticateToken, authorizeRoles('SUPERADMIN'), upload.single('logo'), createCompany);
router.get('/', authenticateToken, authorizeRoles('SUPERADMIN'), getCompanies);
router.delete('/:id', authenticateToken, authorizeRoles('SUPERADMIN'), deleteCompany);

// Both Superadmin and Company Admin can view/update their own company
router.get('/:id', authenticateToken, checkCompanyAccess, getCompanyById);
router.put('/:id', authenticateToken, checkCompanyAccess, upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'invoiceLogo', maxCount: 1 }]), updateCompany);

// Numbering configuration endpoints
router.get('/:id/numbering-settings', authenticateToken, checkCompanyAccess, getNumberingSettings);
router.put('/:id/numbering-settings', authenticateToken, checkCompanyAccess, updateNumberingSettings);
router.get('/:id/next-number', authenticateToken, checkCompanyAccess, getNextNumberEndpoint);

module.exports = router;
