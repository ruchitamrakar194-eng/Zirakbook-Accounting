const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Create new invoice
exports.create = async (req, res) => {
    try {
        const {
            customerId,
            date,
            dueDate,
            salesOrderId,
            deliveryChallanId,
            items,
            notes,
            invoiceNumber
        } = req.body;

        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Calculate totals
        const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
        const discountAmount = items.reduce((sum, item) => sum + (item.discount || 0), 0);

        let taxAmount = 0;
        items.forEach(item => {
            const taxable = (item.quantity * item.rate) - (item.discount || 0);
            taxAmount += (taxable * (item.taxRate || 0)) / 100;
        });

        const totalAmount = subtotal - discountAmount + taxAmount;

        // Use provided invoiceNumber or generate one
        const finalInvoiceNumber = invoiceNumber || `INV-${Date.now()}`;

        const newInvoice = await prisma.invoice.create({
            data: {
                companyId: parseInt(companyId),
                customerId: parseInt(customerId),
                invoiceNumber: finalInvoiceNumber,
                date: new Date(date),
                dueDate: dueDate ? new Date(dueDate) : null,
                salesOrderId: salesOrderId ? parseInt(salesOrderId) : null,
                deliveryChallanId: deliveryChallanId ? parseInt(deliveryChallanId) : null,
                notes,
                subtotal,
                discountAmount,
                taxAmount,
                totalAmount,
                balanceAmount: totalAmount,
                status: 'UNPAID',
                invoiceitem: {
                    create: items.map(item => ({
                        productId: item.productId ? parseInt(item.productId) : null,
                        serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                        warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                        description: item.description,
                        quantity: item.quantity,
                        rate: item.rate,
                        discount: item.discount || 0,
                        taxRate: item.taxRate || 0,
                        amount: ((item.quantity * item.rate) - (item.discount || 0)) + (((item.quantity * item.rate) - (item.discount || 0)) * (item.taxRate || 0) / 100)
                    }))
                }
            },
            include: {
                invoiceitem: true,
                customer: true
            }
        });

        res.status(201).json({ success: true, data: newInvoice });
    } catch (error) {
        console.error('Error creating invoice:', error);
        res.status(500).json({ success: false, error: 'Failed to create invoice' });
    }
};

// Get all invoices (with companyId filter)
exports.getAll = async (req, res) => {
    try {
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const invoices = await prisma.invoice.findMany({
            where: { companyId: parseInt(companyId) },
            include: {
                customer: true,
                invoiceitem: {
                    include: {
                        product: true,
                        service: true,
                        warehouse: true
                    }
                },
                salesorder: {
                    select: { orderNumber: true }
                },
                deliverychallan: {
                    select: { challanNumber: true }
                }
            },
            orderBy: {
                date: 'desc'
            }
        });
        res.json({ success: true, data: invoices });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch invoices' });
    }
};

// Get single invoice by ID
exports.getById = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const invoice = await prisma.invoice.findFirst({
            where: {
                id: parseInt(id),
                companyId: parseInt(companyId)
            },
            include: {
                customer: true,
                invoiceitem: {
                    include: {
                        product: true,
                        service: true,
                        warehouse: true
                    }
                },
                salesorder: true,
                deliverychallan: true
            }
        });

        if (!invoice) {
            return res.status(404).json({ success: false, error: 'Invoice not found' });
        }

        res.json({ success: true, data: invoice });
    } catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch invoice' });
    }
};

// Update invoice
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            customerId,
            date,
            dueDate,
            items,
            notes,
            invoiceNumber
        } = req.body;

        const companyId = req.user?.companyId || req.query.companyId || req.body.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.invoice.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.rate), 0);
        const discountAmount = items.reduce((sum, item) => sum + (item.discount || 0), 0);

        let taxAmount = 0;
        items.forEach(item => {
            const taxable = (item.quantity * item.rate) - (item.discount || 0);
            taxAmount += (taxable * (item.taxRate || 0)) / 100;
        });

        const totalAmount = subtotal - discountAmount + taxAmount;

        const updatedInvoice = await prisma.$transaction(async (tx) => {
            await tx.invoiceitem.deleteMany({
                where: { invoiceId: parseInt(id) }
            });

            return tx.invoice.update({
                where: { id: parseInt(id), companyId: parseInt(companyId) },
                data: {
                    customerId: parseInt(customerId),
                    date: new Date(date),
                    dueDate: dueDate ? new Date(dueDate) : null,
                    invoiceNumber,
                    notes,
                    subtotal,
                    discountAmount,
                    taxAmount,
                    totalAmount,
                    invoiceitem: {
                        create: items.map(item => ({
                            productId: item.productId ? parseInt(item.productId) : null,
                            serviceId: item.serviceId ? parseInt(item.serviceId) : null,
                            warehouseId: item.warehouseId ? parseInt(item.warehouseId) : null,
                            description: item.description,
                            quantity: item.quantity,
                            rate: item.rate,
                            discount: item.discount || 0,
                            taxRate: item.taxRate || 0,
                            amount: ((item.quantity * item.rate) - (item.discount || 0)) + (((item.quantity * item.rate) - (item.discount || 0)) * (item.taxRate || 0) / 100)
                        }))
                    }
                },
                include: {
                    invoiceitem: true
                }
            });
        });

        res.json({ success: true, data: updatedInvoice });
    } catch (error) {
        console.error('Error updating invoice:', error);
        res.status(500).json({ success: false, error: 'Failed to update invoice' });
    }
};

// Delete invoice
exports.delete = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user?.companyId || req.query.companyId;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const existing = await prisma.invoice.findFirst({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        await prisma.invoice.delete({
            where: { id: parseInt(id), companyId: parseInt(companyId) }
        });

        res.json({ success: true, message: 'Invoice deleted successfully' });
    } catch (error) {
        console.error('Error deleting invoice:', error);
        res.status(500).json({ success: false, error: 'Failed to delete invoice' });
    }
};
