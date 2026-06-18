const prisma = require('../config/prisma');

// Create Customer with Automatic Ledger Creation
const createCustomer = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const customerData = req.body;

        // Validate required fields
        if (!customerData.name) {
            return res.status(400).json({
                success: false,
                message: 'Customer name is required'
            });
        }

        // Find Accounts Receivable SubGroup
        const accountsReceivableSubGroup = await prisma.accountsubgroup.findFirst({
            where: {
                companyId: companyId,
                name: 'Accounts Receivable'
            },
            include: {
                accountgroup: true
            }
        });

        if (!accountsReceivableSubGroup) {
            return res.status(404).json({
                success: false,
                message: 'Accounts Receivable sub-group not found. Please initialize Chart of Accounts first.'
            });
        }

        // Check if customer with same name/email already exists in the same company
        const existingCustomer = await prisma.customer.findFirst({
            where: {
                companyId: companyId,
                OR: [
                    { name: customerData.name },
                    { email: customerData.email && customerData.email !== '' ? customerData.email : undefined }
                ].filter(Boolean)
            }
        });

        if (existingCustomer) {
            return res.status(409).json({
                success: false,
                message: 'A customer with this name or email already exists in this company.'
            });
        }

        // Check if a ledger with same name already exists in this company
        const existingLedger = await prisma.ledger.findFirst({
            where: {
                companyId: companyId,
                name: customerData.name
            }
        });

        if (existingLedger) {
            return res.status(409).json({
                success: false,
                message: 'A ledger with this name already exists. Please use a unique name.'
            });
        }

        // Create Customer and Ledger in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const ledgerName = customerData.name;

            // Create Customer with nested Ledger
            const customer = await tx.customer.create({
                data: {
                    name: customerData.name,
                    nameArabic: customerData.nameArabic,
                    companyName: customerData.companyName,
                    companyLocation: customerData.companyLocation,
                    profileImage: customerData.profileImage,
                    anyFile: customerData.anyFile,
                    accountType: customerData.accountType,
                    balanceType: customerData.balanceType || 'Debit',
                    accountName: ledgerName,
                    accountBalance: parseFloat(customerData.accountBalance) || 0,
                    creationDate: customerData.creationDate ? new Date(customerData.creationDate) : new Date(),
                    bankAccountNumber: customerData.bankAccountNumber,
                    bankIFSC: customerData.bankIFSC,
                    bankNameBranch: customerData.bankNameBranch,
                    phone: customerData.phone,
                    email: customerData.email,
                    creditPeriod: customerData.creditPeriod ? parseInt(customerData.creditPeriod) : null,
                    gstNumber: customerData.gstNumber,
                    gstEnabled: customerData.gstEnabled || false,

                    // Billing Address
                    billingName: customerData.billingName,
                    billingPhone: customerData.billingPhone,
                    billingAddress: customerData.billingAddress,
                    billingCity: customerData.billingCity,
                    billingState: customerData.billingState,
                    billingCountry: customerData.billingCountry,
                    billingZipCode: customerData.billingZipCode,

                    // Shipping Address (Legacy fields)
                    shippingSameAsBilling: customerData.shippingSameAsBilling || false,
                    shippingName: customerData.shippingName,
                    shippingPhone: customerData.shippingPhone,
                    shippingAddress: customerData.shippingAddress,
                    shippingCity: customerData.shippingCity,
                    shippingState: customerData.shippingState,
                    shippingCountry: customerData.shippingCountry,
                    shippingZipCode: customerData.shippingZipCode,

                    companyId: companyId,

                    // Link Ledger via nested create
                    ledger: {
                        create: {
                            name: ledgerName,
                            groupId: accountsReceivableSubGroup.groupId,
                            subGroupId: accountsReceivableSubGroup.id,
                            companyId: companyId,
                            openingBalance: parseFloat(customerData.accountBalance) || 0,
                            currentBalance: parseFloat(customerData.accountBalance) || 0,
                            isControlAccount: false,
                            isEnabled: true,
                            description: `Customer Ledger for ${ledgerName}`
                        }
                    },

                    // Multiple Shipping Addresses
                    shippingaddress: {
                        create: (customerData.shippingAddresses && Array.isArray(customerData.shippingAddresses)) ? customerData.shippingAddresses.map(addr => ({
                            name: addr.name,
                            phone: addr.phone,
                            address: addr.address,
                            city: addr.city,
                            state: addr.state,
                            country: addr.country,
                            zipCode: addr.zipCode,
                            isDefault: addr.isDefault || false
                        })) : []
                    }
                },
                include: {
                    ledger: true
                }
            });

            // Update cross-references within the same transaction
            const ledgerId = customer.ledger.id;
            const customerId = customer.id;

            // Use direct SQL or faster non-circular updates if possible? 
            // In Prisma, we just do them sequentially but quickly.
            await tx.customer.update({
                where: { id: customerId },
                data: { ledgerId: ledgerId }
            });

            await tx.ledger.update({
                where: { id: ledgerId },
                data: { customerId: customerId }
            });

            return { customer: { ...customer, ledgerId }, ledger: { ...customer.ledger, customerId } };
        }, {
            timeout: 15000, // 15 seconds
            maxWait: 5000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'Customer', result.customer.id, `Customer ${result.customer.name} created`);
        res.status(201).json({
            success: true,
            message: 'Customer created successfully with linked ledger',
            data: result
        });
    } catch (error) {
        console.error('Error creating customer:', error);
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Customer with this email already exists'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create customer'
        });
    }
};

// Get All Customers
const getAllCustomers = async (req, res) => {
    try {
        const rawCompanyId = req.user?.companyId || req.query.companyId;
        if (!rawCompanyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID is required'
            });
        }
        const companyId = parseInt(rawCompanyId);

        const customers = await prisma.customer.findMany({
            where: { companyId },
            include: {
                ledger: true,
                shippingaddress: true,
                invoice: {
                    select: {
                        id: true,
                        invoiceNumber: true,
                        totalAmount: true,
                        balanceAmount: true,
                        status: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.status(200).json({
            success: true,
            data: customers
        });
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customers'
        });
    }
};

// Get Customer by ID
const getCustomerById = async (req, res) => {
    try {
        const rawCompanyId = req.user?.companyId || req.query.companyId;
        if (!rawCompanyId) {
            return res.status(400).json({
                success: false,
                message: 'Company ID is required'
            });
        }
        const companyId = parseInt(rawCompanyId);
        const { id } = req.params;

        const customer = await prisma.customer.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                ledger: true,
                salesquotation: true,
                salesorder: true,
                deliverychallan: true,
                invoice: {
                    include: {
                        invoiceitem: true,
                        receipt: true
                    }
                },
                receipt: true,
                salesreturn: {
                    include: {
                        salesreturnitem: {
                            include: {
                                product: true
                            }
                        }
                    }
                },
                shippingaddress: true
            }
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        res.status(200).json({
            success: true,
            data: customer
        });
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch customer'
        });
    }
};

// Update Customer
const updateCustomer = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const customerData = req.body;

        // Check if customer exists
        const existingCustomer = await prisma.customer.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: { ledger: true }
        });

        if (!existingCustomer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Update in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Update Customer
            const customer = await tx.customer.update({
                where: { id: parseInt(id) },
                data: {
                    name: customerData.name,
                    nameArabic: customerData.nameArabic,
                    companyName: customerData.companyName,
                    companyLocation: customerData.companyLocation,
                    profileImage: customerData.profileImage,
                    anyFile: customerData.anyFile,
                    accountType: customerData.accountType,
                    balanceType: customerData.balanceType,
                    accountBalance: parseFloat(customerData.accountBalance) || 0,
                    bankAccountNumber: customerData.bankAccountNumber,
                    bankIFSC: customerData.bankIFSC,
                    bankNameBranch: customerData.bankNameBranch,
                    phone: customerData.phone,
                    email: customerData.email,
                    creditPeriod: customerData.creditPeriod ? parseInt(customerData.creditPeriod) : null,
                    gstNumber: customerData.gstNumber,
                    gstEnabled: customerData.gstEnabled,

                    // Billing Address
                    billingName: customerData.billingName,
                    billingPhone: customerData.billingPhone,
                    billingAddress: customerData.billingAddress,
                    billingCity: customerData.billingCity,
                    billingState: customerData.billingState,
                    billingCountry: customerData.billingCountry,
                    billingZipCode: customerData.billingZipCode,

                    // Shipping Address
                    shippingSameAsBilling: customerData.shippingSameAsBilling,
                    shippingName: customerData.shippingName,
                    shippingPhone: customerData.shippingPhone,
                    shippingAddress: customerData.shippingAddress,
                    shippingCity: customerData.shippingCity,
                    shippingState: customerData.shippingState,
                    shippingCountry: customerData.shippingCountry,
                    shippingZipCode: customerData.shippingZipCode,

                    // Update Shipping Addresses
                    shippingaddress: {
                        deleteMany: {},
                        create: (customerData.shippingAddresses && Array.isArray(customerData.shippingAddresses)) ? customerData.shippingAddresses.map(addr => ({
                            name: addr.name,
                            phone: addr.phone,
                            address: addr.address,
                            city: addr.city,
                            state: addr.state,
                            country: addr.country,
                            zipCode: addr.zipCode,
                            isDefault: addr.isDefault || false
                        })) : []
                    }
                }
            });

            // Update Ledger name and balance if customer is edited
            if (existingCustomer.ledgerId) {
                const newLedgerName = customerData.name;
                const newBalance = parseFloat(customerData.accountBalance) || 0;
                await tx.ledger.update({
                    where: { id: existingCustomer.ledgerId },
                    data: {
                        name: newLedgerName,
                        description: `Customer Ledger for ${newLedgerName}`,
                        openingBalance: newBalance,
                        currentBalance: newBalance
                    }
                });
            }

            return customer;
        }, {
            maxWait: 5000,
            timeout: 15000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Customer', result.id, `Customer ${result.name} updated`);
        res.status(200).json({
            success: true,
            message: 'Customer updated successfully',
            data: result
        });
    } catch (error) {
        console.error('Error updating customer:', error);
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Customer with this email already exists'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update customer'
        });
    }
};

// Get Customer Statement (Ledger History)
const getCustomerStatement = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, invoiceId } = req.query;
        const companyId = req.user.companyId;

        const customer = await prisma.customer.findFirst({
            where: { id: parseInt(id), companyId: companyId },
            include: { ledger: true }
        });

        if (!customer || !customer.ledgerId) {
            return res.status(404).json({ success: false, message: 'Customer or Ledger not found' });
        }

        const dateRange = {};
        if (startDate) dateRange.gte = new Date(startDate);
        if (endDate) dateRange.lte = new Date(endDate);

        const whereClause = {
            companyId: companyId,
            date: Object.keys(dateRange).length > 0 ? dateRange : undefined,
            OR: [
                { debitLedgerId: customer.ledgerId },
                { creditLedgerId: customer.ledgerId }
            ]
        };

        if (invoiceId) {
            whereClause.invoiceId = parseInt(invoiceId);
        }

        const transactions = await prisma.transaction.findMany({
            where: whereClause,
            include: {
                invoice: { select: { invoiceNumber: true, totalAmount: true } },
                receipt: { select: { receiptNumber: true, amount: true } },
                posinvoice: { select: { invoiceNumber: true, totalAmount: true } },
                journalentry: true
            },
            orderBy: { date: 'asc' }
        });

        // Calculate Statements with Running Balance
        let runningBalance = invoiceId ? 0 : customer.ledger.openingBalance;
        const statement = transactions.map(tx => {
            const isDebit = tx.debitLedgerId === customer.ledgerId;
            const amount = tx.amount;

            // For Customers (Assets), Debit increases (+) and Credit decreases (-)
            if (isDebit) {
                runningBalance += amount;
            } else {
                runningBalance -= amount;
            }

            return {
                id: tx.id,
                date: tx.date,
                voucherType: tx.voucherType,
                voucherNumber: tx.voucherNumber,
                narration: tx.narration,
                debit: isDebit ? amount : 0,
                credit: !isDebit ? amount : 0,
                balance: runningBalance,
                invoiceId: tx.invoiceId || null,
                receiptId: tx.receiptId || null,
                posInvoiceId: tx.posInvoiceId || null,
                salesReturnId: tx.salesReturnId || null,
                purchaseBillId: tx.purchaseBillId || null,
                purchaseReturnId: tx.purchaseReturnId || null,
                referenceDoc: tx.invoice || tx.receipt || tx.posinvoice || tx.salesreturn || null
            };
        });

        res.status(200).json({
            success: true,
            data: {
                customer: {
                    name: customer.name,
                    ledgerName: customer.ledger.name,
                    openingBalance: customer.ledger.openingBalance
                },
                statement
            }
        });
    } catch (error) {
        console.error('Statement Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Customer
const deleteCustomer = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        // Check if customer exists
        const customer = await prisma.customer.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                invoice: true,
                salesorder: true,
                salesquotation: true,
                receipt: true,
                deliverychallan: true,
                ledger: true
            }
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Check for dependencies
        const dependencies = [];
        if (customer.invoice && customer.invoice.length > 0) dependencies.push('invoices');
        if (customer.salesorder && customer.salesorder.length > 0) dependencies.push('sales orders');
        if (customer.salesquotation && customer.salesquotation.length > 0) dependencies.push('sales quotations');
        if (customer.receipt && customer.receipt.length > 0) dependencies.push('receipts');
        if (customer.deliverychallan && customer.deliverychallan.length > 0) dependencies.push('delivery challans');

        if (dependencies.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete customer with existing ${dependencies.join(', ')}. Please delete them first.`
            });
        }

        // Delete in transaction
        await prisma.$transaction(async (tx) => {
            let ledgerExists = false;
            if (customer.ledgerId) {
                const ledger = await tx.ledger.findUnique({
                    where: { id: customer.ledgerId }
                });
                if (ledger) {
                    ledgerExists = true;
                }
            }

            // 1. Nullify references to avoid FK constraints during deletion
            if (ledgerExists) {
                // Update customer to remove ledger reference
                await tx.customer.update({
                    where: { id: customer.id },
                    data: { ledgerId: null }
                });

                // Update ledger to remove customer reference
                await tx.ledger.update({
                    where: { id: customer.ledgerId },
                    data: { customerId: null }
                });
            }

            // 2. Delete Customer
            await tx.customer.delete({
                where: { id: customer.id }
            });

            // 3. Delete associated Ledger if exists
            if (ledgerExists) {
                await tx.ledger.delete({
                    where: { id: customer.ledgerId }
                });
            }
        }, {
            timeout: 15000,
            maxWait: 5000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Customer', customer.id, `Customer ${customer.name} deleted`);
        res.status(200).json({
            success: true,
            message: 'Customer deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting customer details:', error);
        res.status(500).json({
            success: false,
            message: `Failed to delete customer: ${error.message}`
        });
    }
};

// Recalculate Customer Ledger Balance
const recalculateBalance = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const customer = await prisma.customer.findFirst({
            where: { id: parseInt(id), companyId: companyId },
            include: { ledger: true }
        });

        if (!customer || !customer.ledgerId) {
            return res.status(404).json({ success: false, message: 'Customer or Ledger not found' });
        }

        const transactions = await prisma.transaction.findMany({
            where: {
                companyId: companyId,
                OR: [
                    { debitLedgerId: customer.ledgerId },
                    { creditLedgerId: customer.ledgerId }
                ]
            }
        });

        let newBalance = customer.ledger.openingBalance;
        for (const tx of transactions) {
            if (tx.debitLedgerId === customer.ledgerId) {
                newBalance += tx.amount;
            } else {
                newBalance -= tx.amount;
            }
        }

        // Update both Ledger and Customer model for consistency
        await prisma.ledger.update({
            where: { id: customer.ledgerId },
            data: { currentBalance: newBalance }
        });

        await prisma.customer.update({
            where: { id: customer.id },
            data: { accountBalance: newBalance }
        });

        res.status(200).json({
            success: true,
            message: 'Balance recalculated successfully',
            data: {
                oldBalance: customer.ledger.currentBalance,
                newBalance: newBalance
            }
        });
    } catch (error) {
        console.error('Recalculate Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Recalculate All Customers Ledger Balances
const recalculateAllBalances = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        // Fetch all customers for this company, including their ledgers
        const customers = await prisma.customer.findMany({
            where: { companyId: companyId },
            include: { ledger: true }
        });

        const results = [];

        await prisma.$transaction(async (tx) => {
            for (const customer of customers) {
                if (!customer.ledgerId) continue;

                // Query all transactions involving the customer's ledger
                const transactions = await tx.transaction.findMany({
                    where: {
                        companyId: companyId,
                        OR: [
                            { debitLedgerId: customer.ledgerId },
                            { creditLedgerId: customer.ledgerId }
                        ]
                    }
                });

                let newBalance = customer.ledger.openingBalance || 0;
                for (const txn of transactions) {
                    if (txn.debitLedgerId === customer.ledgerId) {
                        newBalance += txn.amount;
                    } else {
                        newBalance -= txn.amount;
                    }
                }

                // Update ledger currentBalance
                await tx.ledger.update({
                    where: { id: customer.ledgerId },
                    data: { currentBalance: newBalance }
                });

                // Update customer accountBalance
                await tx.customer.update({
                    where: { id: customer.id },
                    data: { accountBalance: newBalance }
                });

                results.push({
                    customerId: customer.id,
                    customerName: customer.name,
                    oldBalance: customer.accountBalance,
                    newBalance: newBalance
                });
            }
        });

        res.status(200).json({
            success: true,
            message: 'All customer balances recalculated successfully',
            data: results
        });
    } catch (error) {
        console.error('Recalculate All Balances Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to recalculate balances' });
    }
};

module.exports = {
    createCustomer,
    getAllCustomers,
    getCustomerById,
    updateCustomer,
    deleteCustomer,
    getCustomerStatement,
    recalculateBalance,
    recalculateAllBalances
};
