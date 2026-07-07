const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getSalespersons = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const salespersons = await prisma.salesperson.findMany({
            where: { companyId: parseInt(companyId) },
            orderBy: { name: 'asc' }
        });
        return res.status(200).json({ success: true, data: salespersons });
    } catch (error) {
        console.error("Error getting salespersons:", error);
        return res.status(500).json({ success: false, message: 'Error getting salespersons' });
    }
};

const createSalesperson = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const { name, phone, email } = req.body;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        if (!name) {
            return res.status(400).json({ success: false, message: 'Salesperson name is required' });
        }
        const salesperson = await prisma.salesperson.create({
            data: {
                name,
                phone: phone || null,
                email: email || null,
                companyId: parseInt(companyId)
            }
        });
        return res.status(201).json({ success: true, data: salesperson });
    } catch (error) {
        console.error("Error creating salesperson:", error);
        return res.status(500).json({ success: false, message: 'Error creating salesperson' });
    }
};

const updateSalesperson = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const existing = await prisma.salesperson.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Salesperson not found' });
        }
        const updated = await prisma.salesperson.update({
            where: { id: parseInt(id) },
            data: {
                name: name || undefined,
                phone: phone !== undefined ? phone : undefined,
                email: email !== undefined ? email : undefined
            }
        });
        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Error updating salesperson:", error);
        return res.status(500).json({ success: false, message: 'Error updating salesperson' });
    }
};

const deleteSalesperson = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const existing = await prisma.salesperson.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Salesperson not found' });
        }
        await prisma.salesperson.delete({
            where: { id: parseInt(id) }
        });
        return res.status(200).json({ success: true, message: 'Salesperson deleted successfully' });
    } catch (error) {
        console.error("Error deleting salesperson:", error);
        return res.status(500).json({ success: false, message: 'Error deleting salesperson' });
    }
};

module.exports = {
    getSalespersons,
    createSalesperson,
    updateSalesperson,
    deleteSalesperson
};
