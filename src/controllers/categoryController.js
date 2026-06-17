const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create Category
const createCategory = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId;
        const { name } = req.body;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });
        if (!name) return res.status(400).json({ success: false, message: 'Category name is required' });

        const existingCategory = await prisma.category.findFirst({
            where: { companyId: parseInt(companyId), name }
        });

        if (existingCategory) {
            return res.status(400).json({ success: false, message: 'Category already exists' });
        }

        const category = await prisma.category.create({
            data: {
                name,
                companyId: parseInt(companyId)
            }
        });

        res.status(201).json({ success: true, message: 'Category created successfully', data: category });
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Categories
const getCategories = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId;

        const categories = await prisma.category.findMany({
            where: { companyId: parseInt(companyId) },
            orderBy: { name: 'asc' }
        });

        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update Category
const updateCategory = async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;

        const category = await prisma.category.update({
            where: { id: parseInt(id) },
            data: { name }
        });

        res.status(200).json({ success: true, message: 'Category updated successfully', data: category });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Category
const deleteCategory = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.category.delete({
            where: { id: parseInt(id) }
        });

        res.status(200).json({ success: true, message: 'Category deleted successfully' });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCategory,
    getCategories,
    updateCategory,
    deleteCategory
};
