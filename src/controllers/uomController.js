const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const standardUnitsMap = {
    // Weight
    'microgram': 'Weight', 'milligram': 'Weight', 'gram': 'Weight', 'kilogram (kg)': 'Weight', 'metric ton (tonne)': 'Weight', 'quintal': 'Weight', 'pound (lb)': 'Weight', 'ounce (oz)': 'Weight', 'stone': 'Weight', 'carat': 'Weight',
    // Area
    'square millimeter': 'Area', 'square centimeter': 'Area', 'square meter': 'Area', 'square kilometer': 'Area', 'square inch': 'Area', 'square foot': 'Area', 'square yard': 'Area', 'acre': 'Area', 'hectare': 'Area', 'bigha': 'Area', 'kanal': 'Area', 'cent': 'Area',
    // Volume
    'millilitre (ml)': 'Volume', 'litre (l)': 'Volume', 'cubic centimeter (cc)': 'Volume', 'cubic meter': 'Volume', 'cubic inch': 'Volume', 'cubic foot': 'Volume', 'gallon': 'Volume', 'barrel': 'Volume', 'pint': 'Volume', 'quart': 'Volume', 'fluid ounce': 'Volume',
    // Length
    'nanometer': 'Length', 'micrometer': 'Length', 'millimeter': 'Length', 'centimeter': 'Length', 'meter': 'Length', 'kilometer': 'Length', 'inch': 'Length', 'foot': 'Length', 'yard': 'Length', 'mile': 'Length',
    // Count
    'piece': 'Count', 'unit': 'Count', 'dozen': 'Count', 'pair': 'Count', 'set': 'Count', 'box': 'Count', 'packet': 'Count', 'carton': 'Count', 'bundle': 'Count', 'roll': 'Count', 'strip': 'Count', 'bottle': 'Count', 'bag': 'Count', 'can': 'Count', 'jar': 'Count', 'tube': 'Count'
};

const getCategoryForUnitName = (name, defaultCategory) => {
    if (!name) return defaultCategory;
    const cleanName = String(name).trim().toLowerCase();
    return standardUnitsMap[cleanName] || defaultCategory;
};

// Get all UOMs
const getUOMs = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId;
        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });

        const uoms = await prisma.uom.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                baseUnit: true // Include referenced simple unit for compound units
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({ success: true, data: uoms });
    } catch (error) {
        console.error('Error fetching UOMs:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get UOM by ID
const getUOMById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const uom = await prisma.uom.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                baseUnit: true
            }
        });

        if (!uom) return res.status(404).json({ success: false, message: 'UOM not found' });

        res.status(200).json({ success: true, data: uom });
    } catch (error) {
        console.error('Error fetching UOM:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Create UOM
const createUOM = async (req, res) => {
    try {
        const companyId = req.user.companyId || req.body.companyId;
        const { category, unitName, symbol, weightPerUnit, uomType, baseUnitId, conversionRate } = req.body;

        if (!companyId) return res.status(400).json({ success: false, message: 'Company ID is required' });
        if (!category || !unitName) {
            return res.status(400).json({ success: false, message: 'Category and Unit Name are required' });
        }

        // Validate compound unit fields
        const isCompound = uomType === 'Compound';
        let parsedBaseUnitId = null;
        let parsedConversionRate = null;

        if (isCompound) {
            if (!baseUnitId) {
                return res.status(400).json({ success: false, message: 'Base unit is required for compound units' });
            }
            if (!conversionRate || parseFloat(conversionRate) <= 0) {
                return res.status(400).json({ success: false, message: 'A positive conversion rate is required for compound units' });
            }

            parsedConversionRate = parseFloat(conversionRate);

            // If baseUnitId is a string (e.g. standard unit name like "Piece"), find or create it
            if (isNaN(baseUnitId)) {
                const baseUnitName = String(baseUnitId).trim();
                let baseUom = await prisma.uom.findFirst({
                    where: {
                        companyId: parseInt(companyId),
                        unitName: baseUnitName,
                        uomType: 'Simple'
                    }
                });

                if (!baseUom) {
                    const baseUnitCategory = getCategoryForUnitName(baseUnitName, category);
                    baseUom = await prisma.uom.create({
                        data: {
                            category: baseUnitCategory,
                            unitName: baseUnitName,
                            symbol: baseUnitName.slice(0, 3).toUpperCase(),
                            uomType: 'Simple',
                            companyId: parseInt(companyId)
                        }
                    });
                }
                parsedBaseUnitId = baseUom.id;
            } else {
                parsedBaseUnitId = parseInt(baseUnitId);

                // Verify base unit exists, belongs to same company, and is a Simple unit
                const baseUnit = await prisma.uom.findFirst({
                    where: { id: parsedBaseUnitId, companyId: parseInt(companyId) }
                });

                if (!baseUnit) {
                    return res.status(400).json({ success: false, message: 'Select a valid base unit belonging to this company' });
                }
                if (baseUnit.uomType !== 'Simple') {
                    return res.status(400).json({ success: false, message: 'Compound units must convert directly to a Simple unit' });
                }
            }
        }

        const existingUOM = await prisma.uom.findFirst({
            where: { companyId: parseInt(companyId), category, unitName }
        });

        if (existingUOM) {
            return res.status(400).json({ success: false, message: 'UOM already exists for this category' });
        }

        const uom = await prisma.uom.create({
            data: {
                category,
                unitName,
                symbol: symbol || unitName.slice(0, 3).toUpperCase(),
                weightPerUnit,
                uomType: uomType || 'Simple',
                baseUnitId: parsedBaseUnitId,
                conversionRate: parsedConversionRate,
                companyId: parseInt(companyId)
            },
            include: {
                baseUnit: true
            }
        });

        res.status(201).json({ success: true, message: 'UOM created successfully', data: uom });
    } catch (error) {
        console.error('Error creating UOM:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Update UOM
const updateUOM = async (req, res) => {
    try {
        const { id } = req.params;
        const { category, unitName, symbol, weightPerUnit, uomType, baseUnitId, conversionRate } = req.body;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Verify ownership
        const existing = await prisma.uom.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'UOM not found' });
        }

        // Validate compound unit fields
        const isCompound = uomType === 'Compound';
        let parsedBaseUnitId = null;
        let parsedConversionRate = null;

        if (isCompound) {
            if (!baseUnitId) {
                return res.status(400).json({ success: false, message: 'Base unit is required for compound units' });
            }
            if (!conversionRate || parseFloat(conversionRate) <= 0) {
                return res.status(400).json({ success: false, message: 'A positive conversion rate is required for compound units' });
            }

            parsedConversionRate = parseFloat(conversionRate);

            // If baseUnitId is a string (e.g. standard unit name like "Piece"), find or create it
            if (isNaN(baseUnitId)) {
                const baseUnitName = String(baseUnitId).trim();
                let baseUom = await prisma.uom.findFirst({
                    where: {
                        companyId: parseInt(companyId),
                        unitName: baseUnitName,
                        uomType: 'Simple'
                    }
                });

                if (!baseUom) {
                    const baseUnitCategory = getCategoryForUnitName(baseUnitName, category);
                    baseUom = await prisma.uom.create({
                        data: {
                            category: baseUnitCategory,
                            unitName: baseUnitName,
                            symbol: baseUnitName.slice(0, 3).toUpperCase(),
                            uomType: 'Simple',
                            companyId: parseInt(companyId)
                        }
                    });
                }
                parsedBaseUnitId = baseUom.id;
            } else {
                parsedBaseUnitId = parseInt(baseUnitId);

                if (parsedBaseUnitId === parseInt(id)) {
                    return res.status(400).json({ success: false, message: 'A compound unit cannot convert to itself' });
                }

                // Verify base unit exists, belongs to same company, and is a Simple unit
                const baseUnit = await prisma.uom.findFirst({
                    where: { id: parsedBaseUnitId, companyId: parseInt(companyId) }
                });

                if (!baseUnit) {
                    return res.status(400).json({ success: false, message: 'Select a valid base unit belonging to this company' });
                }
                if (baseUnit.uomType !== 'Simple') {
                    return res.status(400).json({ success: false, message: 'Compound units must convert directly to a Simple unit' });
                }
            }
        }

        const uom = await prisma.uom.update({
            where: { id: parseInt(id) },
            data: {
                category,
                unitName,
                symbol: symbol || unitName.slice(0, 3).toUpperCase(),
                weightPerUnit,
                uomType: uomType || 'Simple',
                baseUnitId: parsedBaseUnitId,
                conversionRate: parsedConversionRate
            },
            include: {
                baseUnit: true
            }
        });

        res.status(200).json({ success: true, message: 'UOM updated successfully', data: uom });
    } catch (error) {
        console.error('Error updating UOM:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete UOM
const deleteUOM = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Verify ownership
        const existing = await prisma.uom.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'UOM not found' });
        }

        // Check if other compound UOMs depend on this UOM
        const dependency = await prisma.uom.findFirst({
            where: { baseUnitId: parseInt(id) }
        });

        if (dependency) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete this unit as compound unit '${dependency.unitName}' depends on it.`
            });
        }

        // Check if any products use this UOM as base, purchase, or sales unit
        const productDependency = await prisma.product.findFirst({
            where: {
                OR: [
                    { uomId: parseInt(id) },
                    { purchaseUomId: parseInt(id) },
                    { salesUomId: parseInt(id) }
                ]
            }
        });

        if (productDependency) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete this unit as product '${productDependency.name}' is currently using it.`
            });
        }

        await prisma.uom.delete({
            where: { id: parseInt(id) }
        });

        res.status(200).json({ success: true, message: 'UOM deleted successfully' });
    } catch (error) {
        console.error('Error deleting UOM:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getUOMs,
    getUOMById,
    createUOM,
    updateUOM,
    deleteUOM
};
