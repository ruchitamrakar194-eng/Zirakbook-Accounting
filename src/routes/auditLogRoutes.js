const express = require('express');
const router = express.Router();
const { getAuditLogs } = require('../controllers/auditLogController');
const { authenticateToken, authorizePermissions } = require('../middlewares/authMiddleware');

// Route to fetch audit logs, requires token authentication and settings permission
router.get('/', authenticateToken, authorizePermissions('view settings'), getAuditLogs);

module.exports = router;
