const prisma = require('../config/prisma');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
    try {
        const { name, email, password, role, companyId } = req.body;

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                role: role || 'USER', // Default to USER if not provided
                companyId: companyId ? parseInt(companyId) : undefined,
            },
        });

        res.status(201).json({ message: 'User created successfully', user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.toLowerCase();

        const user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
            include: {
                company: {
                    include: {
                        plan: true
                    }
                }
            }
        });
        if (!user) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        if (user.loginEnabled === false) {
            return res.status(403).json({ message: 'Your account has been disabled. Please contact your administrator.' });
        }

        // Check for company plan expiration
        if (user.role !== 'SUPERADMIN' && user.company && user.company.endDate) {
            const expiryDate = new Date(user.company.endDate);
            const today = new Date();
            // Set today to start of day for accurate comparison if endDate is just a date
            today.setHours(0, 0, 0, 0);
            
            if (expiryDate < today) {
                return res.status(403).json({ 
                    message: 'Your company plan has expired. Please contact super admin to renew your plan.',
                    isExpired: true 
                });
            }
        }

        let permissions = [];
        let planModules = [];

        try {
            // Fetch Role Permissions
            if (user.role && user.role !== 'SUPERADMIN') {
                const whereClause = {
                    companyId: user.companyId
                };

                if (user.roleId) {
                    whereClause.id = user.roleId;
                } else {
                    whereClause.name = user.role;
                }

                const roleData = await prisma.role.findFirst({
                    where: whereClause
                });

                if (roleData && roleData.permissions) {
                    permissions = JSON.parse(roleData.permissions);
                }
            }

            // Extract Plan Modules if available
            if (user.company && user.company.plan && user.company.plan.modules) {
                try {
                    planModules = JSON.parse(user.company.plan.modules);
                } catch (pe) {
                    console.error("Plan module parse error", pe);
                }
            }
        } catch (e) {
            console.log("Perm fetch error", e);
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                role: user.role, 
                companyId: user.companyId,
                permissions: permissions,
                planModules: planModules
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                company: user.company,
                permissions: permissions,
                planModules: planModules
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

const impersonate = async (req, res) => {
    try {
        const { companyId } = req.body;
        
        if (!companyId) {
            return res.status(400).json({ message: 'Company ID is required' });
        }

        // Find the admin user (role='COMPANY') for this company
        const user = await prisma.user.findFirst({
            where: { 
                companyId: parseInt(companyId),
                role: 'COMPANY'
            },
            include: {
                company: {
                    include: {
                        plan: true
                    }
                }
            }
        });

        if (!user) {
            return res.status(404).json({ message: 'No admin user found for this company' });
        }

        // Check for company plan expiration during impersonation
        if (user.company && user.company.endDate) {
            const expiryDate = new Date(user.company.endDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (expiryDate < today) {
                return res.status(403).json({ 
                    message: 'Cannot login: This company plan has expired.',
                    isExpired: true 
                });
            }
        }

        let permissions = [];
        let planModules = [];

        try {
            const roleData = await prisma.role.findFirst({
                where: { 
                    companyId: user.companyId,
                    name: 'COMPANY'
                }
            });

            if (roleData && roleData.permissions) {
                permissions = JSON.parse(roleData.permissions);
            }

            if (user.company && user.company.plan && user.company.plan.modules) {
                planModules = JSON.parse(user.company.plan.modules);
            }
        } catch (e) {
            console.error("Perm fetch error in impersonate:", e);
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                role: user.role, 
                companyId: user.companyId,
                permissions: permissions,
                planModules: planModules,
                isImpersonated: true
            },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            message: 'Impersonation successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                companyId: user.companyId,
                company: user.company,
                permissions: permissions,
                planModules: planModules
            },
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = { register, login, impersonate };
