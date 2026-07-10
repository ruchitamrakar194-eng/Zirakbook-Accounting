const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const getDeliveryPersons = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const deliverypersons = await prisma.deliveryperson.findMany({
            where: { companyId: parseInt(companyId) },
            orderBy: { name: 'asc' }
        });
        return res.status(200).json({ success: true, data: deliverypersons });
    } catch (error) {
        console.error("Error getting delivery persons:", error);
        return res.status(500).json({ success: false, message: 'Error getting delivery persons' });
    }
};

const createDeliveryPerson = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const { name, phone, email } = req.body;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        if (!name) {
            return res.status(400).json({ success: false, message: 'Delivery person name is required' });
        }
        const deliveryperson = await prisma.deliveryperson.create({
            data: {
                name,
                phone: phone || null,
                email: email || null,
                companyId: parseInt(companyId)
            }
        });
        return res.status(201).json({ success: true, data: deliveryperson });
    } catch (error) {
        console.error("Error creating delivery person:", error);
        return res.status(500).json({ success: false, message: 'Error creating delivery person' });
    }
};

const updateDeliveryPerson = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email } = req.body;
        const companyId = req.user?.companyId || req.body.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const existing = await prisma.deliveryperson.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Delivery person not found' });
        }
        const updated = await prisma.deliveryperson.update({
            where: { id: parseInt(id) },
            data: {
                name: name || undefined,
                phone: phone !== undefined ? phone : undefined,
                email: email !== undefined ? email : undefined
            }
        });
        return res.status(200).json({ success: true, data: updated });
    } catch (error) {
        console.error("Error updating delivery person:", error);
        return res.status(500).json({ success: false, message: 'Error updating delivery person' });
    }
};

const deleteDeliveryPerson = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is missing' });
        }
        const existing = await prisma.deliveryperson.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Delivery person not found' });
        }
        await prisma.deliveryperson.delete({
            where: { id: parseInt(id) }
        });
        return res.status(200).json({ success: true, message: 'Delivery person deleted successfully' });
    } catch (error) {
        console.error("Error deleting delivery person:", error);
        return res.status(500).json({ success: false, message: 'Error deleting delivery person' });
    }
};

module.exports = {
    getDeliveryPersons,
    createDeliveryPerson,
    updateDeliveryPerson,
    deleteDeliveryPerson
};
