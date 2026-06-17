const { PrismaClient } = require('../../prisma/generated/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

// Create User (Employee)
const createUser = async (req, res) => {
    try {
        const { name, email, password, role, roleId, dateOfBirth, loginEnabled, avatar } = req.body;
        const companyId = req.user?.companyId;

        // Validation
        if (!name || !email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Please provide name, email, password, and role' });
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists with this email' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const userData = {
            name,
            email,
            password: hashedPassword,
            role,
            companyId: parseInt(companyId),
        };

        if (roleId) userData.roleId = parseInt(roleId);
        if (loginEnabled !== undefined) userData.loginEnabled = loginEnabled;
        if (avatar) userData.avatar = avatar;

        const user = await prisma.user.create({
            data: userData
        });

        // Remove password from response
        const { password: _, ...userWithoutPassword } = user;

        res.status(201).json({ success: true, message: 'User created successfully', data: userWithoutPassword });
    } catch (error) {
        console.error('Create User Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Users for Company
const getUsers = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const users = await prisma.user.findMany({
            where: {
                companyId: parseInt(companyId),
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                roleId: true,
                loginEnabled: true,
                avatar: true,
                companyId: true,
                createdAt: true
                // Exclude password
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({ success: true, data: users });
    } catch (error) {
        console.error('Get Users Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get User By ID
const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const user = await prisma.user.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                roleId: true,
                loginEnabled: true,
                avatar: true,
                companyId: true,
                createdAt: true
            }
        });

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ success: true, data: user });
    } catch (error) {
        console.error('Get User Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update User
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, role, roleId, password, loginEnabled, avatar } = req.body;
        const companyId = req.user.companyId;

        const existingUser = await prisma.user.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const updateData = {
            name,
            email,
            role
        };

        if (roleId) updateData.roleId = parseInt(roleId);
        if (loginEnabled !== undefined) updateData.loginEnabled = loginEnabled;
        if (avatar !== undefined) updateData.avatar = avatar;

        if (password && password.trim() !== '') {
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: updateData
        });

        const { password: _, ...userWithoutPassword } = updatedUser;

        res.status(200).json({ success: true, message: 'User updated successfully', data: userWithoutPassword });
    } catch (error) {
        console.error('Update User Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete User
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        // Prevent deleting self? Maybe.
        if (parseInt(id) === req.user.userId) {
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        }

        const existingUser = await prisma.user.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existingUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        await prisma.user.delete({
            where: { id: parseInt(id) }
        });

        res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete User Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createUser,
    getUsers,
    getUserById,
    updateUser,
    deleteUser
};
