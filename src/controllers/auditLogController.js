const prisma = require('../config/prisma');

/**
 * Get paginated and filtered audit logs for the authenticated user's company.
 */
const getAuditLogs = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        if (!companyId) {
            return res.status(400).json({ message: 'Company ID is required' });
        }

        const { action, entity, startDate, endDate, userId, search, page = 1, limit = 20 } = req.query;

        const where = {
            companyId: parseInt(companyId)
        };

        if (action) {
            where.action = action;
        }

        if (entity) {
            where.entity = entity;
        }

        if (userId) {
            where.userId = parseInt(userId);
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt.gte = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt.lte = end;
            }
        }

        if (search) {
            where.OR = [
                { userName: { contains: search } },
                { userEmail: { contains: search } },
                { details: { contains: search } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [logs, total] = await Promise.all([
            prisma.auditlog.findMany({
                where,
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take,
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            role: true
                        }
                    }
                }
            }),
            prisma.auditlog.count({ where })
        ]);

        res.status(200).json({
            logs,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

module.exports = { getAuditLogs };
