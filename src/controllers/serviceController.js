const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Service
const createService = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const {
            name, sku, description, uomId, price, taxRate, allowInInvoices, remarks
        } = req.body;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        if (!name || !uomId || price === undefined) {
            return res.status(400).json({ success: false, message: 'Service name, UOM, and price are required' });
        }

        const service = await prisma.service.create({
            data: {
                name,
                sku: sku || null,
                description: description || null,
                uomId: parseInt(uomId),
                price: parseFloat(price),
                taxRate: taxRate ? parseFloat(taxRate) : 0,
                allowInInvoices: allowInInvoices !== undefined ? allowInInvoices : true,
                remarks: remarks || null,
                companyId: parseInt(companyId)
            },
            include: {
                uom: true
            }
        });

        res.status(201).json({
            success: true,
            message: 'Service created successfully',
            data: service
        });
    } catch (error) {
        console.error('Error creating service:', error);
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'A service with this name already exists' });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get All Services
const getServices = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const services = await prisma.service.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                uom: true
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({ success: true, data: services });
    } catch (error) {
        console.error('Error fetching services:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Get Service By ID
const getServiceById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const service = await prisma.service.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            include: {
                uom: true
            }
        });

        if (!service) {
            return res.status(404).json({ success: false, message: 'Service not found' });
        }

        res.status(200).json({ success: true, data: service });
    } catch (error) {
        console.error('Error fetching service:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Update Service
const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const {
            name, sku, description, uomId, price, taxRate, allowInInvoices, remarks
        } = req.body;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const service = await prisma.service.update({
            where: { id: parseInt(id), companyId: parseInt(companyId) },
            data: {
                name,
                sku,
                description,
                uomId: uomId ? parseInt(uomId) : undefined,
                price: price !== undefined ? parseFloat(price) : undefined,
                taxRate: taxRate !== undefined ? parseFloat(taxRate) : undefined,
                allowInInvoices: allowInInvoices !== undefined ? allowInInvoices : undefined,
                remarks
            },
            include: {
                uom: true
            }
        });

        res.status(200).json({
            success: true,
            message: 'Service updated successfully',
            data: service
        });
    } catch (error) {
        console.error('Error updating service:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Service not found or unauthorized' });
        }
        if (error.code === 'P2002') {
            return res.status(400).json({ success: false, message: 'A service with this name already exists' });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

// Delete Service
const deleteService = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        await prisma.service.delete({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        res.status(200).json({ success: true, message: 'Service deleted successfully' });
    } catch (error) {
        console.error('Error deleting service:', error);
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Service not found or unauthorized' });
        }
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

module.exports = {
    createService,
    getServices,
    getServiceById,
    updateService,
    deleteService
};
