const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const createPlan = async (req, res) => {
    try {
        const {
            name,
            basePrice,
            currency,
            invoiceLimit,
            additionalInvoicePrice,
            userLimit,
            storageCapacity,
            billingCycle,
            status,
            modules,
            totalPrice,
            descriptions
        } = req.body;

        const plan = await prisma.plan.create({
            data: {
                name,
                basePrice: parseFloat(basePrice) || 0,
                currency,
                invoiceLimit,
                additionalInvoicePrice: parseFloat(additionalInvoicePrice) || 0,
                userLimit,
                storageCapacity,
                billingCycle,
                status,
                modules: modules ? (typeof modules === 'object' ? JSON.stringify(modules) : modules) : "[]",
                totalPrice: parseFloat(totalPrice) || 0,
                descriptions: descriptions ? (typeof descriptions === 'object' ? JSON.stringify(descriptions) : descriptions) : "[]"
            }
        });

        res.status(201).json(plan);
    } catch (error) {
        console.error('Create Plan Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPlans = async (req, res) => {
    try {
        const plans = await prisma.plan.findMany({
            include: {
                _count: {
                    select: { company: true }
                }
            }
        });

        // Parse JSON fields
        const parsedPlans = plans.map(plan => ({
            ...plan,
            modules: plan.modules ? JSON.parse(plan.modules) : [],
            descriptions: plan.descriptions ? JSON.parse(plan.descriptions) : []
        }));

        res.json(parsedPlans);
    } catch (error) {
        console.error('Get Plans Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getPlanById = async (req, res) => {
    try {
        const plan = await prisma.plan.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                _count: {
                    select: { company: true }
                }
            }
        });
        if (!plan) return res.status(404).json({ message: 'Plan not found' });

        // Parse JSON fields
        const parsedPlan = {
            ...plan,
            modules: plan.modules ? JSON.parse(plan.modules) : [],
            descriptions: plan.descriptions ? JSON.parse(plan.descriptions) : []
        };

        res.json(parsedPlan);
    } catch (error) {
        console.error('Get Plan By ID Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const updatePlan = async (req, res) => {
    try {
        const {
            name,
            basePrice,
            currency,
            invoiceLimit,
            additionalInvoicePrice,
            userLimit,
            storageCapacity,
            billingCycle,
            status,
            modules,
            totalPrice,
            descriptions
        } = req.body;

        const plan = await prisma.plan.update({
            where: { id: parseInt(req.params.id) },
            data: {
                name,
                basePrice: parseFloat(basePrice) || 0,
                currency,
                invoiceLimit,
                additionalInvoicePrice: parseFloat(additionalInvoicePrice) || 0,
                userLimit,
                storageCapacity,
                billingCycle,
                status,
                modules: modules ? (typeof modules === 'object' ? JSON.stringify(modules) : modules) : "[]",
                totalPrice: parseFloat(totalPrice) || 0,
                descriptions: descriptions ? (typeof descriptions === 'object' ? JSON.stringify(descriptions) : descriptions) : "[]"
            }
        });

        res.json(plan);
    } catch (error) {
        console.error('Update Plan Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const deletePlan = async (req, res) => {
    try {
        await prisma.plan.delete({
            where: { id: parseInt(req.params.id) }
        });
        res.json({ message: 'Plan deleted successfully' });
    } catch (error) {
        console.error('Delete Plan Error:', error);
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    createPlan,
    getPlans,
    getPlanById,
    updatePlan,
    deletePlan
};
