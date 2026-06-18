const prisma = require('../config/prisma');

/**
 * Log an activity to the audit log database.
 * This runs asynchronously and catches errors internally to prevent blocking the main request flow.
 * 
 * @param {Object} req - The Express request object containing req.user.
 * @param {string} action - The action performed (e.g. "CREATE", "UPDATE", "DELETE").
 * @param {string} entity - The type of entity (e.g. "Invoice", "PurchaseBill", etc.).
 * @param {number|string} entityId - The ID of the entity.
 * @param {Object|string} details - Additional details or description of the action.
 */
const logActivity = (req, action, entity, entityId, details) => {
    try {
        if (!req || !req.user) {
            return;
        }

        const userId = req.user.id ? parseInt(req.user.id) : null;
        const userEmail = req.user.email || null;
        const userName = req.user.name || null;
        const companyId = req.user.companyId ? parseInt(req.user.companyId) : null;

        if (!companyId) {
            return;
        }

        // Safe conversion of entityId
        const parsedEntityId = entityId ? parseInt(entityId) : null;

        // Non-blocking database insertion
        prisma.auditlog.create({
            data: {
                userId,
                userEmail,
                userName,
                action,
                entity,
                entityId: isNaN(parsedEntityId) ? null : parsedEntityId,
                details: typeof details === 'object' ? JSON.stringify(details) : details,
                companyId
            }
        }).catch(err => {
            console.error('[AuditLog Error] Failed to insert audit log:', err.message);
        });
    } catch (err) {
        console.error('[AuditLog Error] Failed in logActivity utility:', err.message);
    }
};

module.exports = { logActivity };
