const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { cloudinary } = require('../utils/cloudinaryConfig');
const { getInventoryConfig, recordStockIn } = require('../services/inventoryValuationService');

// Helper: Upload buffer to Cloudinary
const uploadImageToCloudinary = async (fileBuffer, filename) => {
    if (!fileBuffer) return null;

    try {
        const result = await cloudinary.uploader.upload_stream(
            { folder: 'products', public_id: filename },
            (error, result) => {
                if (error) throw error;
                return result;
            }
        ).end(fileBuffer);

        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw new Error('Image upload failed');
    }
};

// But upload_stream with .end() is callback-based → better to use promisify or use upload with buffer

// ✅ Simpler: Use `upload` with buffer directly
const uploadImageToCloudinaryV2 = async (fileBuffer, filename) => {
    if (!fileBuffer) return null;

    try {
        const result = await cloudinary.uploader.upload(`data:image/png;base64,${fileBuffer.toString('base64')}`, {
            folder: 'products',
            public_id: filename,
            resource_type: 'image'
        });
        return result.secure_url;
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw new Error('Image upload failed');
    }
};

// Create Product
const createProduct = async (req, res) => {
    let imageUrl = null;

    try {
        const companyId = req.user?.companyId || req.body.companyId;
        const {
            name, sku, hsn, barcode, categoryId, uomId, purchaseUomId, salesUomId, unit, description,
            asOfDate, taxAccount, initialCost, salePrice, purchasePrice,
            discount, remarks, warehouseInfo, image
        } = req.body;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }
        if (!name || !sku) {
            return res.status(400).json({ success: false, message: 'Name and SKU are required' });
        }

        const existingProduct = await prisma.product.findFirst({
            where: {
                companyId: parseInt(companyId),
                name: name
            }
        });

        if (existingProduct) {
            return res.status(400).json({
                success: false,
                message: 'A product with this name already exists for your company'
            });
        }

        // Use image URL from frontend (Cloudinary)
        if (image) {
            imageUrl = image;
        }

        let parsedWarehouseInfo = [];
        if (warehouseInfo) {
            try {
                parsedWarehouseInfo = typeof warehouseInfo === 'string'
                    ? JSON.parse(warehouseInfo)
                    : warehouseInfo;
            } catch (e) {
                console.warn('Invalid warehouseInfo format');
            }
        }

        const productData = {
            name,
            sku: sku || null,
            hsn: hsn || null,
            barcode: barcode || null,
            image: imageUrl,
            categoryId: categoryId ? parseInt(categoryId) : null,
            uomId: uomId ? parseInt(uomId) : null,
            purchaseUomId: purchaseUomId ? parseInt(purchaseUomId) : null,
            salesUomId: salesUomId ? parseInt(salesUomId) : null,
            unit: unit || null,
            description: description || null,
            asOfDate: asOfDate ? new Date(asOfDate) : null,
            taxAccount: taxAccount || null,
            initialCost: initialCost ? parseFloat(initialCost) : 0,
            salePrice: salePrice ? parseFloat(salePrice) : 0,
            purchasePrice: purchasePrice ? parseFloat(purchasePrice) : 0,
            discount: discount ? parseFloat(discount) : 0,
            remarks: remarks || null,
            companyId: parseInt(companyId)
        };

        if (Array.isArray(parsedWarehouseInfo) && parsedWarehouseInfo.length > 0) {
            productData.stock = {
                create: parsedWarehouseInfo.map(w => ({
                    warehouseId: parseInt(w.warehouseId),
                    quantity: w.quantity ? parseFloat(w.quantity) : (w.initialQty ? parseFloat(w.initialQty) : 0),
                    minOrderQty: w.minOrderQty ? parseFloat(w.minOrderQty) : 0,
                    initialQty: w.initialQty ? parseFloat(w.initialQty) : 0
                }))
            };

            // Create Inventory Transactions for Opening Stock
            const openingTransactions = parsedWarehouseInfo
                .filter(w => (w.quantity && parseFloat(w.quantity) > 0) || (w.initialQty && parseFloat(w.initialQty) > 0))
                .map(w => ({
                    type: 'OPENING_STOCK',
                    toWarehouseId: parseInt(w.warehouseId),
                    quantity: w.quantity ? parseFloat(w.quantity) : parseFloat(w.initialQty),
                    companyId: parseInt(companyId),
                    reason: 'Opening Stock'
                }));

            if (openingTransactions.length > 0) {
                productData.inventorytransaction = {
                    create: openingTransactions
                };

                // Accounting Integration for Opening Stock
                try {
                    const totalOpeningValue = parsedWarehouseInfo.reduce((sum, w) => {
                        const qty = w.quantity ? parseFloat(w.quantity) : parseFloat(w.initialQty);
                        return sum + (qty * (parseFloat(initialCost) || 0));
                    }, 0);

                    if (totalOpeningValue > 0) {
                        const inventoryAsset = await prisma.ledger.findFirst({
                            where: { companyId: parseInt(companyId), name: 'Inventory Asset' }
                        });
                        const openingEquity = await prisma.ledger.findFirst({
                            where: { companyId: parseInt(companyId), name: 'Opening Balance Equity' }
                        });

                        if (inventoryAsset && openingEquity) {
                            await prisma.transaction.create({
                                data: {
                                    date: asOfDate ? new Date(asOfDate) : new Date(),
                                    debitLedgerId: inventoryAsset.id,
                                    creditLedgerId: openingEquity.id,
                                    amount: totalOpeningValue,
                                    narration: `Opening Stock for Product: ${name}`,
                                    voucherType: 'JOURNAL',
                                    companyId: parseInt(companyId)
                                }
                            });

                            // Update Ledger Balances
                            await prisma.ledger.update({
                                where: { id: inventoryAsset.id },
                                data: { currentBalance: { increment: totalOpeningValue } }
                            });
                            await prisma.ledger.update({
                                where: { id: openingEquity.id },
                                data: { currentBalance: { decrement: totalOpeningValue } }
                            });
                        }
                    }
                } catch (accError) {
                    console.error('Accounting Integration Error (Opening Stock):', accError);
                    // We don't throw here to not break product creation if COA is not initialized
                }
            }
        }

        const product = await prisma.product.create({
            data: productData,
            include: {
                stock: { include: { warehouse: true } },
                category: true,
                uom: { include: { baseUnit: true } },
                purchaseUom: { include: { baseUnit: true } },
                salesUom: { include: { baseUnit: true } }
            }
        });

        // Populate WAC / FIFO layers for Opening Stock
        const invConfig = await getInventoryConfig(companyId);
        const valuationMethod = invConfig.valuationMethod || 'WAC';

        if (Array.isArray(parsedWarehouseInfo) && parsedWarehouseInfo.length > 0) {
            for (const w of parsedWarehouseInfo) {
                const qty = w.quantity ? parseFloat(w.quantity) : (w.initialQty ? parseFloat(w.initialQty) : 0);
                if (qty > 0) {
                    await recordStockIn(prisma, {
                        companyId: parseInt(companyId),
                        productId: product.id,
                        warehouseId: parseInt(w.warehouseId),
                        quantity: qty,
                        rate: parseFloat(initialCost) || 0,
                        method: valuationMethod,
                        isOpeningStock: true
                    });
                }
            }
        }

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'Product', product.id, `Product ${product.name} (SKU: ${product.sku}) created`);

        res.status(201).json({
            success: true,
            message: 'Product created successfully',
            data: product
        });
    } catch (error) {
        console.error('Error creating product:', error);

        // Clean up: delete image from Cloudinary if product creation failed
        if (imageUrl) {
            try {
                const publicId = imageUrl.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`products/${publicId}`);
            } catch (cleanupErr) {
                console.warn('Failed to clean up image:', cleanupErr);
            }
        }

        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'A product with this name already exists for your company'
            });
        }
        if (error.code === 'P2003') {
            return res.status(400).json({
                success: false,
                message: 'Invalid reference: Category, UOM, or Warehouse does not exist'
            });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create product'
        });
    }
};

// Update Product
const updateProduct = async (req, res) => {
    let newImageUrl = null;
    let oldImageUrl = null;

    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        const {
            name, sku, hsn, barcode, categoryId, uomId, purchaseUomId, salesUomId, unit, description,
            asOfDate, taxAccount, initialCost, salePrice, purchasePrice,
            discount, remarks, warehouseInfo, image
        } = req.body;

        const existingProduct = await prisma.product.findUnique({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: { stock: true }
        });

        if (!existingProduct) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (name && name !== existingProduct.name) {
            const duplicate = await prisma.product.findFirst({
                where: {
                    companyId: parseInt(companyId),
                    name,
                    id: { not: parseInt(id) }
                }
            });
            if (duplicate) {
                return res.status(400).json({
                    success: false,
                    message: 'A product with this name already exists for your company'
                });
            }
        }

        // Save old image URL for cleanup
        oldImageUrl = existingProduct.image;

        // Use new image URL if provided
        if (image) {
            newImageUrl = image;
        }

        let parsedWarehouseInfo = [];
        if (warehouseInfo) {
            try {
                parsedWarehouseInfo = typeof warehouseInfo === 'string'
                    ? JSON.parse(warehouseInfo)
                    : warehouseInfo;
            } catch (e) {
                console.warn('Invalid warehouseInfo format');
            }
        }

        // Validate quantities - Mandatory number validation
        if (Array.isArray(parsedWarehouseInfo)) {
            for (const w of parsedWarehouseInfo) {
                const qty = parseFloat(w.quantity !== undefined ? w.quantity : (w.initialQty !== undefined ? w.initialQty : 0));
                if (isNaN(qty) || qty < 0) {
                    return res.status(400).json({ success: false, message: 'Quantity must be a valid positive number' });
                }
            }
        }

        // --- ACCOUNTING INTEGRATION: Revert and Clean Up Old Opening Stock Entries ---
        try {
            // Find old transactions based on existing product name (prior to name change)
            const oldOpeningTxns = await prisma.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    narration: `Opening Stock for Product: ${existingProduct.name}`
                }
            });

            if (oldOpeningTxns.length > 0) {
                const totalAmount = oldOpeningTxns.reduce((sum, t) => sum + t.amount, 0);

                // Find ledgers
                const inventoryAsset = await prisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: 'Inventory Asset' }
                });
                const openingEquity = await prisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: 'Opening Balance Equity' }
                });

                // Delete old transactions
                await prisma.transaction.deleteMany({
                    where: { id: { in: oldOpeningTxns.map(t => t.id) } }
                });

                // Update ledger balances back (Revert)
                if (inventoryAsset) {
                    await prisma.ledger.update({
                        where: { id: inventoryAsset.id },
                        data: { currentBalance: { decrement: totalAmount } }
                    });
                }
                if (openingEquity) {
                    await prisma.ledger.update({
                        where: { id: openingEquity.id },
                        data: { currentBalance: { increment: totalAmount } }
                    });
                }
            }

            // Delete old physical OPENING_STOCK transactions
            await prisma.inventorytransaction.deleteMany({
                where: {
                    productId: parseInt(id),
                    type: 'OPENING_STOCK'
                }
            });

            // Revert old WAC and FIFO opening stock records from DB
            const oldOpeningQty = existingProduct.stock ? existingProduct.stock.reduce((sum, s) => sum + s.quantity, 0) : 0;
            const oldOpeningValue = oldOpeningQty * (existingProduct.initialCost || 0);

            const currentQty = parseFloat(existingProduct.totalQty || 0);
            const currentValue = parseFloat(existingProduct.totalInventoryValue || 0);
            const newTotalQty = Math.max(0, currentQty - oldOpeningQty);
            const newTotalValue = Math.max(0, currentValue - oldOpeningValue);
            const newAverageCost = newTotalQty > 0 ? newTotalValue / newTotalQty : 0;

            await prisma.product.update({
                where: { id: parseInt(id) },
                data: {
                    totalQty: newTotalQty,
                    totalInventoryValue: newTotalValue,
                    averageCost: newAverageCost
                }
            });

            await prisma.inventory_batch.deleteMany({
                where: { productId: parseInt(id), purchaseBillId: null }
            });
        } catch (accError) {
            console.error('Accounting Integration Cleanup Error (Opening Stock Update):', accError);
        }

        // Delete old stocks
        await prisma.stock.deleteMany({ where: { productId: parseInt(id) } });

        const updateData = {
            name: name || existingProduct.name,
            sku: sku || null,
            hsn: hsn || null,
            barcode: barcode || null,
            image: newImageUrl !== null ? newImageUrl : oldImageUrl, // Keep old if no new
            categoryId: categoryId ? parseInt(categoryId) : null,
            uomId: uomId ? parseInt(uomId) : null,
            purchaseUomId: purchaseUomId ? parseInt(purchaseUomId) : null,
            salesUomId: salesUomId ? parseInt(salesUomId) : null,
            unit: unit || null,
            description: description || null,
            asOfDate: asOfDate ? new Date(asOfDate) : null,
            taxAccount: taxAccount || null,
            initialCost: initialCost ? parseFloat(initialCost) : 0,
            salePrice: salePrice ? parseFloat(salePrice) : 0,
            purchasePrice: purchasePrice ? parseFloat(purchasePrice) : 0,
            discount: discount ? parseFloat(discount) : 0,
            remarks: remarks || null
        };

        if (Array.isArray(parsedWarehouseInfo) && parsedWarehouseInfo.length > 0) {
            updateData.stock = {
                create: parsedWarehouseInfo.map(w => ({
                    warehouseId: parseInt(w.warehouseId),
                    quantity: w.quantity ? parseFloat(w.quantity) : 0,
                    minOrderQty: w.minOrderQty ? parseFloat(w.minOrderQty) : 0,
                    initialQty: w.initialQty ? parseFloat(w.initialQty) : 0
                }))
            };

            // Re-create new physical transactions for opening stock if quantity > 0
            const openingTransactions = parsedWarehouseInfo
                .filter(w => (w.quantity && parseFloat(w.quantity) > 0) || (w.initialQty && parseFloat(w.initialQty) > 0))
                .map(w => ({
                    type: 'OPENING_STOCK',
                    toWarehouseId: parseInt(w.warehouseId),
                    quantity: w.quantity ? parseFloat(w.quantity) : parseFloat(w.initialQty),
                    companyId: parseInt(companyId),
                    reason: 'Opening Stock'
                }));

            if (openingTransactions.length > 0) {
                updateData.inventorytransaction = {
                    create: openingTransactions
                };

                // Re-post new Accounting Entries for updated opening stock
                try {
                    const totalOpeningValue = parsedWarehouseInfo.reduce((sum, w) => {
                        const qty = w.quantity ? parseFloat(w.quantity) : parseFloat(w.initialQty);
                        return sum + (qty * (parseFloat(initialCost || existingProduct.initialCost) || 0));
                    }, 0);

                    if (totalOpeningValue > 0) {
                        const inventoryAsset = await prisma.ledger.findFirst({
                            where: { companyId: parseInt(companyId), name: 'Inventory Asset' }
                        });
                        const openingEquity = await prisma.ledger.findFirst({
                            where: { companyId: parseInt(companyId), name: 'Opening Balance Equity' }
                        });

                        if (inventoryAsset && openingEquity) {
                            await prisma.transaction.create({
                                data: {
                                    date: asOfDate ? new Date(asOfDate) : (existingProduct.asOfDate ? new Date(existingProduct.asOfDate) : new Date()),
                                    debitLedgerId: inventoryAsset.id,
                                    creditLedgerId: openingEquity.id,
                                    amount: totalOpeningValue,
                                    narration: `Opening Stock for Product: ${name || existingProduct.name}`,
                                    voucherType: 'JOURNAL',
                                    companyId: parseInt(companyId)
                                }
                            });

                            // Update Ledger Balances with new values
                            await prisma.ledger.update({
                                where: { id: inventoryAsset.id },
                                data: { currentBalance: { increment: totalOpeningValue } }
                            });
                            await prisma.ledger.update({
                                where: { id: openingEquity.id },
                                data: { currentBalance: { decrement: totalOpeningValue } }
                            });
                        }
                    }
                } catch (accError) {
                    console.error('Accounting Integration Error (Opening Stock Re-post):', accError);
                }
            }
        }

        const product = await prisma.product.update({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            data: updateData,
            include: {
                stock: { include: { warehouse: true } },
                category: true,
                uom: { include: { baseUnit: true } },
                purchaseUom: { include: { baseUnit: true } },
                salesUom: { include: { baseUnit: true } }
            }
        });

        // Populate WAC / FIFO layers for Opening Stock
        const invConfig = await getInventoryConfig(companyId);
        const valuationMethod = invConfig.valuationMethod || 'WAC';

        if (Array.isArray(parsedWarehouseInfo) && parsedWarehouseInfo.length > 0) {
            for (const w of parsedWarehouseInfo) {
                const qty = w.quantity ? parseFloat(w.quantity) : (w.initialQty ? parseFloat(w.initialQty) : 0);
                if (qty > 0) {
                    await recordStockIn(prisma, {
                        companyId: parseInt(companyId),
                        productId: product.id,
                        warehouseId: parseInt(w.warehouseId),
                        quantity: qty,
                        rate: parseFloat(initialCost || existingProduct.initialCost) || 0,
                        method: valuationMethod,
                        isOpeningStock: true
                    });
                }
            }
        }

        // ✅ Clean up old image if replaced
        if (newImageUrl && oldImageUrl && oldImageUrl.includes('cloudinary')) {
            try {
                const publicId = oldImageUrl.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`products/${publicId}`);
            } catch (err) {
                console.warn('Failed to delete old image:', err);
            }
        }

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Product', product.id, `Product ${product.name} (SKU: ${product.sku}) updated`);

        res.status(200).json({
            success: true,
            message: 'Product updated successfully',
            data: product
        });
    } catch (error) {
        console.error('Error updating product:', error);

        // Clean up newly uploaded image if update failed
        if (newImageUrl) {
            try {
                const publicId = newImageUrl.split('/').pop().split('.')[0];
                await cloudinary.uploader.destroy(`products/${publicId}`);
            } catch (cleanupErr) {
                console.warn('Failed to clean up new image:', cleanupErr);
            }
        }

        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'A product with this name already exists for your company'
            });
        }
        if (error.code === 'P2003') {
            return res.status(400).json({
                success: false,
                message: 'Invalid reference: Category, UOM, or Warehouse does not exist'
            });
        }
        if (error.code === 'P2025') {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update product'
        });
    }
};

// Other functions (getProducts, getProductById, deleteProduct) remain unchanged
// Get Products
const getProducts = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const products = await prisma.product.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                category: true,
                uom: { include: { baseUnit: true } },
                purchaseUom: { include: { baseUnit: true } },
                salesUom: { include: { baseUnit: true } },
                stock: {
                    include: {
                        warehouse: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        // Add total quantity to each product
        const productsWithStats = products.map(p => ({
            ...p,
            totalQuantity: p.stock.reduce((sum, s) => sum + s.quantity, 0)
        }));

        res.status(200).json({ success: true, data: productsWithStats });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get Product By ID
const getProductById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;
        if (!id) {
            return res.status(400).json({ success: false, message: 'Product ID is required' });
        }
        const productId = parseInt(id);
        if (isNaN(productId)) {
            return res.status(400).json({ success: false, message: 'Invalid Product ID' });
        }

        const product = await prisma.product.findUnique({
            where: {
                id: productId,
                companyId: parseInt(companyId)
            },
            include: {
                category: true,
                uom: { include: { baseUnit: true } },
                purchaseUom: { include: { baseUnit: true } },
                salesUom: { include: { baseUnit: true } },
                stock: {
                    include: {
                        warehouse: true
                    }
                },
                inventorytransaction: {
                    include: {
                        warehouse_inventorytransaction_fromWarehouseIdTowarehouse: { select: { name: true } },
                        warehouse_inventorytransaction_toWarehouseIdTowarehouse: { select: { name: true } }
                    },
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (!product) return res.status(404).json({ success: false, message: 'Product not found' });

        res.status(200).json({ success: true, data: product });
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Product
const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        const product = await prisma.product.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            }
        });

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        // Clean up Opening Stock transactions for this product
        try {
            const openingStockTxns = await prisma.transaction.findMany({
                where: {
                    companyId: parseInt(companyId),
                    narration: `Opening Stock for Product: ${product.name}`
                }
            });

            if (openingStockTxns.length > 0) {
                const totalAmount = openingStockTxns.reduce((sum, t) => sum + t.amount, 0);

                // Find ledgers
                const inventoryAsset = await prisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: 'Inventory Asset' }
                });
                const openingEquity = await prisma.ledger.findFirst({
                    where: { companyId: parseInt(companyId), name: 'Opening Balance Equity' }
                });

                // Delete those transactions
                await prisma.transaction.deleteMany({
                    where: {
                        id: { in: openingStockTxns.map(t => t.id) }
                    }
                });

                // Update ledger balances back
                if (inventoryAsset) {
                    await prisma.ledger.update({
                        where: { id: inventoryAsset.id },
                        data: { currentBalance: { decrement: totalAmount } }
                    });
                }
                if (openingEquity) {
                    await prisma.ledger.update({
                        where: { id: openingEquity.id },
                        data: { currentBalance: { increment: totalAmount } }
                    });
                }
            }
        } catch (accError) {
            console.error('Accounting Integration Cleanup Error (Opening Stock):', accError);
        }

        await prisma.product.delete({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            }
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Product', product.id, `Product ${product.name} (SKU: ${product.sku}) deleted`);

        res.status(200).json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Generate Cloudinary Signature for Frontend Upload
const getCloudinarySignature = async (req, res) => {
    try {
        const timestamp = Math.round((new Date).getTime() / 1000);
        const folder = 'products'; // Optional: organize in a folder

        const signature = cloudinary.utils.api_sign_request({
            timestamp: timestamp,
            folder: folder
        }, cloudinary.config().api_secret);

        res.status(200).json({
            success: true,
            signature,
            timestamp,
            apiKey: cloudinary.config().api_key,
            cloudName: cloudinary.config().cloud_name,
            folder
        });
    } catch (error) {
        console.error('Error generating signature:', error);
        res.status(500).json({ success: false, message: 'Could not generate upload signature' });
    }
};

module.exports = {
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct,
    getCloudinarySignature
};