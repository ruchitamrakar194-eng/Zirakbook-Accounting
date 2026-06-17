const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const chartOfAccountsService = require('../services/chartOfAccountsService');
const prisma = new PrismaClient();

const createPlanRequest = async (req, res) => {
    try {
        const {
            companyName,
            email,
            planId,
            planName,
            billingCycle,
            startDate,
            phone,
            address
        } = req.body;

        let logoUrl = null;
        if (req.file) {
            logoUrl = req.file.path;
        }

        const planRequest = await prisma.planrequest.create({
            data: {
                companyName,
                email,
                phone,
                address,
                logo: logoUrl,
                planId: planId ? parseInt(planId) : null,
                planName,
                billingCycle: billingCycle || 'Monthly',
                startDate: startDate ? new Date(startDate) : new Date(),
                status: 'Pending'
            }
        });

        res.status(201).json(planRequest);
    } catch (error) {
        console.error('Create Plan Request Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPlanRequests = async (req, res) => {
    try {
        const planRequests = await prisma.planrequest.findMany({
            include: {
                plan: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });
        res.json(planRequests);
    } catch (error) {
        console.error('Get Plan Requests Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPlanRequestById = async (req, res) => {
    try {
        const planRequest = await prisma.planrequest.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                plan: true
            }
        });
        if (!planRequest) return res.status(404).json({ message: 'Plan request not found' });
        res.json(planRequest);
    } catch (error) {
        console.error('Get Plan Request By ID Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updatePlanRequest = async (req, res) => {
    try {
        const {
            companyName,
            email,
            planId,
            planName,
            billingCycle,
            startDate,
            status,
            phone,
            address,
            logo
        } = req.body;

        const planRequest = await prisma.planrequest.update({
            where: { id: parseInt(req.params.id) },
            data: {
                companyName,
                email,
                phone,
                address,
                logo,
                planId: planId ? parseInt(planId) : null,
                planName,
                billingCycle,
                startDate: startDate ? new Date(startDate) : undefined,
                status
            }
        });

        res.json(planRequest);
    } catch (error) {
        console.error('Update Plan Request Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const deletePlanRequest = async (req, res) => {
    try {
        await prisma.planrequest.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ message: 'Plan request deleted successfully' });
    } catch (error) {
        console.error('Delete Plan Request Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const approvePlanRequest = async (req, res) => {
    try {
        const requestId = parseInt(req.params.id);

        // 1. Get the plan request details
        const planRequest = await prisma.planrequest.findUnique({
            where: { id: requestId },
            include: { plan: true }
        });

        if (!planRequest) {
            return res.status(404).json({ error: 'Plan request not found' });
        }

        if (planRequest.status === 'Accepted') {
            return res.status(400).json({ error: 'Plan request already accepted' });
        }

        // 2. Check if company or user already exists
        const email = planRequest.email.toLowerCase();
        const existingCompany = await prisma.company.findUnique({ where: { email } });
        const existingUser = await prisma.user.findUnique({ where: { email } });

        if (existingCompany || existingUser) {
            const { password } = req.body;
            if (password) {
                const hashedPassword = await bcrypt.hash(password, 10);
                if (existingUser) {
                    await prisma.user.update({
                        where: { email },
                        data: { password: hashedPassword }
                    });
                }
            }
            const updatedRequest = await prisma.planrequest.update({
                where: { id: requestId },
                data: { status: 'Accepted' }
            });
            return res.json({
                message: 'Plan request accepted, and password updated for existing account.',
                planRequest: updatedRequest
            });
        }

        // 3. Prepare data outside transaction
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password is required to approve and create an account' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        const start = new Date(planRequest.startDate);
        let end = new Date(start);
        if (planRequest.billingCycle === 'Yearly') {
            end.setFullYear(end.getFullYear() + 1);
        } else {
            end.setMonth(end.getMonth() + 1);
        }

        // 4. Run transaction
        const result = await prisma.$transaction(async (tx) => {
            // Create Company
            const company = await tx.company.create({
                data: {
                    name: planRequest.companyName,
                    email: email,
                    phone: planRequest.phone,
                    address: planRequest.address,
                    logo: planRequest.logo,
                    startDate: start,
                    endDate: end,
                    planId: planRequest.planId,
                    planType: planRequest.billingCycle,
                }
            });

            // Derive permissions from Plan Modules
            let modulesArray = [];
            try {
                if (planRequest.plan && planRequest.plan.modules) {
                    modulesArray = JSON.parse(planRequest.plan.modules);
                }
            } catch (e) {
                console.error("Module parse error:", e);
            }

            const enabledModules = modulesArray.filter(m => m.enabled).map(m => (m.name || m.module_name || "").toLowerCase());

            // Base permissions (always included for company admin - requested default menus)
            let defaultPermissions = [
                "show dashboard",
                "manage voucher", "create voucher", "edit voucher", "delete voucher",
                "manage reports", "view reports",
                "manage user", "create user", "edit user", "delete user",
                "manage role", "create role", "edit role", "delete role",
                "manage settings", "edit settings", "view settings"
            ];

            // Module specific mapping (gated menus)
            const moduleMapping = {
                'account': ["manage accounts", "create accounts", "edit accounts", "delete accounts"],
                'accounts': ["manage accounts", "create accounts", "edit accounts", "delete accounts"],
                'inventory': ["manage inventory", "create inventory", "edit inventory", "delete inventory"],
                'sales': ["manage sales", "create sales", "edit sales", "delete sales", "show sales", "send sales"],
                'purchase': ["manage purchases", "create purchases", "edit purchases", "delete purchases"],
                'purchases': ["manage purchases", "create purchases", "edit purchases", "delete purchases"],
                'pos': ["manage pos", "create pos", "edit pos", "delete pos"]
            };

            enabledModules.forEach(modName => {
                // Check direct match or loose match
                for (const key in moduleMapping) {
                    if (modName.includes(key)) {
                        defaultPermissions = [...new Set([...defaultPermissions, ...moduleMapping[key]])];
                    }
                }
            });

            const role = await tx.role.create({
                data: {
                    name: 'COMPANY',
                    companyId: company.id,
                    permissions: JSON.stringify(defaultPermissions)
                }
            });

            // Create Admin User for the company
            const user = await tx.user.create({
                data: {
                    name: planRequest.companyName,
                    email: email,
                    password: hashedPassword,
                    role: 'COMPANY',
                    roleId: role.id, // Link to the COMPANY role
                    companyId: company.id
                }
            });

            // Update Plan Request Status
            const updatedRequest = await tx.planrequest.update({
                where: { id: requestId },
                data: { status: 'Accepted' }
            });

            return { company, user, role, planRequest: updatedRequest };
        }, {
            timeout: 15000 // 15 seconds timeout
        });

        // 5. Initialize Chart of Accounts for the new company (Async)
        try {
            await chartOfAccountsService.initializeChartOfAccounts(result.company.id);
        } catch (coaError) {
            console.error('COA Initialization Error (Skipping):', coaError);
            // We don't want to fail the whole process if COA fail, but it's good to log
        }

        res.json({
            message: 'Plan request approved, company created, and user login ready.',
            data: result
        });
    } catch (error) {
        console.error('Approve Plan Request Error:', error);
        res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};

const rejectPlanRequest = async (req, res) => {
    try {
        const planRequest = await prisma.planrequest.update({
            where: { id: parseInt(req.params.id) },
            data: { status: 'Rejected' }
        });
        res.json(planRequest);
    } catch (error) {
        console.error('Reject Plan Request Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    createPlanRequest,
    getPlanRequests,
    getPlanRequestById,
    updatePlanRequest,
    deletePlanRequest,
    approvePlanRequest,
    rejectPlanRequest
};
