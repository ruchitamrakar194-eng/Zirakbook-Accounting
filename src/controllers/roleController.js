const { PrismaClient } = require('../../prisma/generated/client');
const prisma = new PrismaClient();

// Create Role
const createRole = async (req, res) => {
    try {
        const { name, permissions } = req.body;
        const companyId = req.user.companyId;

        if (!name || !permissions) {
            return res.status(400).json({ success: false, message: 'Name and permissions are required' });
        }

        const existingRole = await prisma.role.findUnique({
            where: {
                companyId_name: {
                    companyId: parseInt(companyId),
                    name: name
                }
            }
        });

        if (existingRole) {
            return res.status(400).json({ success: false, message: 'Role already exists' });
        }

        const role = await prisma.role.create({
            data: {
                name,
                permissions: JSON.stringify(permissions), // Store as JSON string
                companyId: parseInt(companyId)
            }
        });

        res.status(201).json({ success: true, message: 'Role created successfully', data: role });
    } catch (error) {
        console.error('Create Role Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get All Roles
const getRoles = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const roles = await prisma.role.findMany({
            where: { companyId: parseInt(companyId) },
            orderBy: { createdAt: 'desc' }
        });

        // Parse permissions
        const formattedRoles = roles.map(role => ({
            ...role,
            permissions: JSON.parse(role.permissions || '[]')
        }));

        res.status(200).json({ success: true, data: formattedRoles });
    } catch (error) {
        console.error('Get Roles Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Role By ID
const getRoleById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const role = await prisma.role.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            }
        });

        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        role.permissions = JSON.parse(role.permissions || '[]');

        res.status(200).json({ success: true, data: role });
    } catch (error) {
        console.error('Get Role Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Role
const updateRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions } = req.body;
        const companyId = req.user.companyId;

        const role = await prisma.role.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        const updatedRole = await prisma.role.update({
            where: { id: parseInt(id) },
            data: {
                name,
                permissions: permissions ? JSON.stringify(permissions) : undefined
            }
        });

        res.status(200).json({ success: true, message: 'Role updated successfully', data: updatedRole });
    } catch (error) {
        console.error('Update Role Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Role
const deleteRole = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const role = await prisma.role.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!role) {
            return res.status(404).json({ success: false, message: 'Role not found' });
        }

        await prisma.role.delete({
            where: { id: parseInt(id) }
        });

        res.status(200).json({ success: true, message: 'Role deleted successfully' });
    } catch (error) {
        console.error('Delete Role Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createRole,
    getRoles,
    getRoleById,
    updateRole,
    deleteRole
};
