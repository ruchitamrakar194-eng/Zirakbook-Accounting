const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { authenticateToken, authorizeRoles } = require('../middlewares/authMiddleware');

// Super Admin Stats (Existing)
router.get('/stats', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.getSuperAdminDashboardStats);

// Company Stats (New)
router.get('/company-stats', authenticateToken, dashboardController.getCompanyDashboardStats);

// Announcements CRUD
router.post('/announcements', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.createAnnouncement);
router.get('/announcements', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.getAnnouncements);
router.get('/announcements/:id', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.getAnnouncementById);
router.put('/announcements/:id', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.updateAnnouncement);
router.delete('/announcements/:id', authenticateToken, authorizeRoles('SUPERADMIN'), dashboardController.deleteAnnouncement);

module.exports = router;
