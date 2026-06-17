const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const bcrypt = require('bcryptjs');

const getPasswordRequests = async (req, res) => {
    try {
        const { companyId: userCompanyId, role } = req.user;
        const queryCompanyId = req.query.companyId;

        let requests;

        if (role === 'SUPERADMIN' || role === 'superadmin') {
            // Superadmin sees requests. If companyId is provided in query, filter by it.
            const filter = queryCompanyId ? { companyId: parseInt(queryCompanyId) } : {};
            requests = await prisma.passwordrequest.findMany({
                where: filter,
                include: {
                    user: {
                        select: { email: true, name: true, role: true }
                    },
                    company: {
                        select: { name: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
        } else {
            // Company Admin sees only their company's requests
            // Use the one from token for security, but allow override if explicitly asked for frontend consistency (though token is safer)
            // Actually, for consistency with other routes you asked for, I'll use:
            const effectiveCompanyId = userCompanyId || queryCompanyId;

            if (!effectiveCompanyId) {
                return res.status(400).json({ success: false, message: 'Company ID is required' });
            }

            requests = await prisma.passwordrequest.findMany({
                where: { companyId: parseInt(effectiveCompanyId) },
                include: {
                    user: {
                        select: { email: true, name: true, role: true }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });
        }

        res.json(requests);
    } catch (error) {
        console.error('Get Password Requests Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updateRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, newPassword } = req.body; // Approved or Rejected

        if (status === 'Approved' && newPassword) {
            // Reset Password Logic
            const request = await prisma.passwordrequest.findUnique({ where: { id: parseInt(id) } });

            if (!request) {
                return res.status(404).json({ message: 'Request not found' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            // Transaction: Update User Password AND Request Status
            await prisma.$transaction([
                prisma.user.update({
                    where: { id: request.userId },
                    data: { password: hashedPassword }
                }),
                prisma.passwordrequest.update({
                    where: { id: parseInt(id) },
                    data: { status: 'Approved' }
                })
            ]);

            return res.json({ message: 'Password reset successfully and request approved' });

        } else {
            // Just update status (e.g. Rejected)
            const request = await prisma.passwordrequest.update({
                where: { id: parseInt(id) },
                data: { status }
            });
            res.json({ message: `Request ${status} successfully`, request });
        }
    } catch (error) {
        console.error('Update Request Status Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const createPasswordRequest = async (req, res) => {
    try {
        const userId = req.user.userId;
        const companyId = req.user.companyId;

        // Check if there's already a pending request
        const existingRequest = await prisma.passwordrequest.findFirst({
            where: { userId, status: 'Pending' }
        });

        if (existingRequest) {
            return res.status(400).json({ message: 'You already have a pending password request.' });
        }

        const newRequest = await prisma.passwordrequest.create({
            data: {
                userId,
                companyId,
                status: 'Pending'
            }
        });

        res.status(201).json({ message: 'Password request submitted successfully', request: newRequest });
    } catch (error) {
        console.error('Create Password Request Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    getPasswordRequests,
    updateRequestStatus,
    createPasswordRequest
};
