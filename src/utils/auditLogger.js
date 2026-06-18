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

        const rawUserId = req.user.userId !== undefined ? req.user.userId : req.user.id;
        const userId = rawUserId ? parseInt(rawUserId) : null;
        const companyId = req.user.companyId ? parseInt(req.user.companyId) : null;

        if (!companyId) {
            return;
        }

        // Safe conversion of entityId
        const parsedEntityId = entityId ? parseInt(entityId) : null;

        // Non-blocking database insertion
        const logPromise = (async () => {
            let userEmail = req.user.email || null;
            let userName = req.user.name || null;

            // If name or email is not in the token payload, fetch them from the database
            if (userId && (!userEmail || !userName)) {
                try {
                    const dbUser = await prisma.user.findUnique({
                        where: { id: userId },
                        select: { name: true, email: true }
                    });
                    if (dbUser) {
                        userEmail = dbUser.email;
                        userName = dbUser.name;
                    }
                } catch (dbErr) {
                    console.error('[AuditLog Error] Failed to fetch user from DB:', dbErr.message);
                }
            }

            await prisma.auditlog.create({
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
            });
        })();

        logPromise.catch(err => {
            console.error('[AuditLog Error] Failed to insert audit log:', err.message);
        });
    } catch (err) {
        console.error('[AuditLog Error] Failed in logActivity utility:', err.message);
    }
};

module.exports = { logActivity };
