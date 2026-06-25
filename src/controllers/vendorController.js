const prisma = require('../config/prisma');

// Create Vendor with Automatic Ledger Creation
const createVendor = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const vendorData = req.body;

        // Validate required fields
        if (!vendorData.name) {
            return res.status(400).json({
                success: false,
                message: 'Vendor name is required'
            });
        }

        // Find Accounts Payable SubGroup
        const accountsPayableSubGroup = await prisma.accountsubgroup.findFirst({
            where: {
                companyId: companyId,
                name: 'Accounts Payable'
            },
            include: {
                accountgroup: true
            }
        });

        if (!accountsPayableSubGroup) {
            return res.status(404).json({
                success: false,
                message: 'Accounts Payable sub-group not found. Please initialize Chart of Accounts first.'
            });
        }

        // Check if vendor with same name/email already exists in the same company
        const existingVendor = await prisma.vendor.findFirst({
            where: {
                companyId: companyId,
                OR: [
                    { name: vendorData.name },
                    { email: vendorData.email && vendorData.email !== '' ? vendorData.email : undefined }
                ].filter(Boolean)
            }
        });

        if (existingVendor) {
            return res.status(409).json({
                success: false,
                message: 'A vendor with this name or email already exists in this company.'
            });
        }

        // Check if a ledger with same name already exists in this company
        const existingLedger = await prisma.ledger.findFirst({
            where: {
                companyId: companyId,
                name: vendorData.name
            }
        });

        if (existingLedger) {
            return res.status(409).json({
                success: false,
                message: 'A ledger with this name already exists. Please use a unique name.'
            });
        }

        // Create Vendor and Ledger in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const ledgerName = vendorData.name;
            
            // Create Vendor with nested Ledger
            const vendor = await tx.vendor.create({
                data: {
                    name: vendorData.name,
                    nameArabic: vendorData.nameArabic,
                    companyName: vendorData.companyName,
                    companyLocation: vendorData.companyLocation,
                    profileImage: vendorData.profileImage,
                    anyFile: vendorData.anyFile,
                    accountType: vendorData.accountType,
                    balanceType: vendorData.balanceType || 'Credit',
                    accountName: ledgerName,
                    accountBalance: parseFloat(vendorData.accountBalance) || 0,
                    creationDate: vendorData.creationDate ? new Date(vendorData.creationDate) : new Date(),
                    bankAccountNumber: vendorData.bankAccountNumber,
                    bankIFSC: vendorData.bankIFSC,
                    bankNameBranch: vendorData.bankNameBranch,
                    phone: vendorData.phone,
                    email: vendorData.email,
                    creditPeriod: vendorData.creditPeriod ? parseInt(vendorData.creditPeriod) : null,
                    gstNumber: vendorData.gstNumber,
                    gstEnabled: vendorData.gstEnabled || false,

                    // Billing Address
                    billingName: vendorData.billingName,
                    billingPhone: vendorData.billingPhone,
                    billingAddress: vendorData.billingAddress,
                    billingCity: vendorData.billingCity,
                    billingState: vendorData.billingState,
                    billingCountry: vendorData.billingCountry,
                    billingZipCode: vendorData.billingZipCode,

                    // Shipping Address (Legacy fields)
                    shippingSameAsBilling: vendorData.shippingSameAsBilling || false,
                    shippingName: vendorData.shippingName,
                    shippingPhone: vendorData.shippingPhone,
                    shippingAddress: vendorData.shippingAddress,
                    shippingCity: vendorData.shippingCity,
                    shippingState: vendorData.shippingState,
                    shippingCountry: vendorData.shippingCountry,
                    shippingZipCode: vendorData.shippingZipCode,

                    companyId: companyId,
                    
                    // Link Ledger via nested create
                    ledger: {
                        create: {
                            name: ledgerName,
                            groupId: accountsPayableSubGroup.groupId,
                            subGroupId: accountsPayableSubGroup.id,
                            companyId: companyId,
                            openingBalance: parseFloat(vendorData.accountBalance) || 0,
                            currentBalance: parseFloat(vendorData.accountBalance) || 0,
                            isControlAccount: false,
                            isEnabled: true,
                            description: `Vendor Ledger for ${ledgerName}`
                        }
                    },

                    // Multiple Shipping Addresses
                    shippingaddress: {
                        create: (vendorData.shippingAddresses && Array.isArray(vendorData.shippingAddresses)) ? vendorData.shippingAddresses.map(addr => ({
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
            const ledgerId = vendor.ledger.id;
            const vendorId = vendor.id;

            await tx.vendor.update({
                where: { id: vendorId },
                data: { ledgerId: ledgerId }
            });

            await tx.ledger.update({
                where: { id: ledgerId },
                data: { vendorId: vendorId }
            });

            return { vendor: { ...vendor, ledgerId }, ledger: { ...vendor.ledger, vendorId } };
        }, {
            timeout: 15000, 
            maxWait: 5000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'CREATE', 'Vendor', result.vendor.id, `Vendor ${result.vendor.name} created`);
        res.status(201).json({
            success: true,
            message: 'Vendor created successfully with linked ledger',
            data: result
        });
    } catch (error) {
        console.error('Error creating vendor:', error);
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Vendor with this email already exists'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create vendor'
        });
    }
};

// Get All Vendors
const getAllVendors = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        const vendors = await prisma.vendor.findMany({
            where: { companyId },
            include: {
                ledger: true,
                shippingaddress: true,
                purchasebill: {
                    select: {
                        id: true,
                        billNumber: true,
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
            data: vendors
        });
    } catch (error) {
        console.error('Error fetching vendors:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch vendors'
        });
    }
};

// Get Vendor by ID
const getVendorById = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        const vendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                ledger: {
                    include: {
                        transaction_transaction_debitLedgerIdToledger: {
                            orderBy: { date: 'desc' },
                            take: 50
                        },
                        transaction_transaction_creditLedgerIdToledger: {
                            orderBy: { date: 'desc' },
                            take: 50
                        }
                    }
                },
                purchasebill: {
                    include: {
                        purchasebillitem: true,
                        payment: true
                    }
                },
                purchaseorder: {
                    orderBy: { date: 'desc' }
                },
                purchasequotation: {
                    orderBy: { date: 'desc' }
                },
                goodsreceiptnote: true,
                payment: {
                    orderBy: { date: 'desc' }
                },
                purchasereturn: {
                    orderBy: { date: 'desc' }
                },
                shippingaddress: true
            }
        });

        if (!vendor) {
            return res.status(404).json({
                success: false,
                message: 'Vendor not found'
            });
        }

        res.status(200).json({
            success: true,
            data: vendor
        });
    } catch (error) {
        console.error('Error fetching vendor detailed:', error); // Log full error including Prisma relation errors
        res.status(500).json({
            success: false,
            message: `Failed to fetch vendor: ${error.message}` // Send error message to frontend for easier debugging
        });
    }
};

// Update Vendor
const updateVendor = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const vendorData = req.body;

        // Check if vendor exists
        const existingVendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: { ledger: true }
        });

        if (!existingVendor) {
            return res.status(404).json({
                success: false,
                message: 'Vendor not found'
            });
        }

        // Update in transaction
        const result = await prisma.$transaction(async (tx) => {
            const newOpeningBalance = parseFloat(vendorData.accountBalance) || 0;
            let newCurrentBalance = newOpeningBalance;

            if (existingVendor.ledgerId) {
                // Fetch all transactions involving vendor's ledger
                const transactions = await tx.transaction.findMany({
                    where: {
                        companyId: companyId,
                        OR: [
                            { debitLedgerId: existingVendor.ledgerId },
                            { creditLedgerId: existingVendor.ledgerId }
                        ]
                    }
                });

                for (const txn of transactions) {
                    if (txn.creditLedgerId === existingVendor.ledgerId) {
                        newCurrentBalance += txn.amount;
                    } else {
                        newCurrentBalance -= txn.amount;
                    }
                }
            }

            // Update Vendor
            const vendor = await tx.vendor.update({
                where: { id: parseInt(id) },
                data: {
                    name: vendorData.name,
                    nameArabic: vendorData.nameArabic,
                    companyName: vendorData.companyName,
                    companyLocation: vendorData.companyLocation,
                    profileImage: vendorData.profileImage,
                    anyFile: vendorData.anyFile,
                    accountType: vendorData.accountType,
                    balanceType: vendorData.balanceType,
                    accountBalance: newCurrentBalance,
                    bankAccountNumber: vendorData.bankAccountNumber,
                    bankIFSC: vendorData.bankIFSC,
                    bankNameBranch: vendorData.bankNameBranch,
                    phone: vendorData.phone,
                    email: vendorData.email,
                    creditPeriod: vendorData.creditPeriod ? parseInt(vendorData.creditPeriod) : null,
                    gstNumber: vendorData.gstNumber,
                    gstEnabled: vendorData.gstEnabled,

                    // Billing Address
                    billingName: vendorData.billingName,
                    billingPhone: vendorData.billingPhone,
                    billingAddress: vendorData.billingAddress,
                    billingCity: vendorData.billingCity,
                    billingState: vendorData.billingState,
                    billingCountry: vendorData.billingCountry,
                    billingZipCode: vendorData.billingZipCode,

                    // Shipping Address
                    shippingSameAsBilling: vendorData.shippingSameAsBilling,
                    shippingName: vendorData.shippingName,
                    shippingPhone: vendorData.shippingPhone,
                    shippingAddress: vendorData.shippingAddress,
                    shippingCity: vendorData.shippingCity,
                    shippingState: vendorData.shippingState,
                    shippingCountry: vendorData.shippingCountry,
                    shippingZipCode: vendorData.shippingZipCode,

                    // Update Shipping Addresses
                    shippingaddress: {
                        deleteMany: {},
                        create: (vendorData.shippingAddresses && Array.isArray(vendorData.shippingAddresses)) ? vendorData.shippingAddresses.map(addr => ({
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

            // Update Ledger: sync name AND balance when vendor is edited
            if (existingVendor.ledgerId) {
                const newLedgerName = vendorData.name;
                await tx.ledger.update({
                    where: { id: existingVendor.ledgerId },
                    data: {
                        name: newLedgerName,
                        description: `Vendor Ledger for ${newLedgerName}`,
                        openingBalance: newOpeningBalance,
                        currentBalance: newCurrentBalance
                    }
                });
            }

            return vendor;
        }, {
            maxWait: 5000,
            timeout: 15000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'UPDATE', 'Vendor', result.id, `Vendor ${result.name} updated`);
        res.status(200).json({
            success: true,
            message: 'Vendor updated successfully',
            data: result
        });
    } catch (error) {
        console.error('Error updating vendor:', error);
        if (error.code === 'P2002') {
            return res.status(409).json({
                success: false,
                message: 'Vendor with this email already exists'
            });
        }
        res.status(500).json({
            success: false,
            message: 'Failed to update vendor'
        });
    }
};

// Recalculate Vendor Ledger Balance
const recalculateBalance = async (req, res) => {
    try {
        const { id } = req.params;
        const companyId = req.user.companyId;

        const vendor = await prisma.vendor.findFirst({
            where: { id: parseInt(id), companyId: companyId },
            include: { ledger: true }
        });

        if (!vendor || !vendor.ledgerId) {
            return res.status(404).json({ success: false, message: 'Vendor or Ledger not found' });
        }

        const transactions = await prisma.transaction.findMany({
            where: {
                companyId: companyId,
                OR: [
                    { debitLedgerId: vendor.ledgerId },
                    { creditLedgerId: vendor.ledgerId }
                ]
            }
        });

        let newBalance = vendor.ledger.openingBalance || 0;
        for (const tx of transactions) {
            if (tx.creditLedgerId === vendor.ledgerId) {
                newBalance += tx.amount;
            } else {
                newBalance -= tx.amount;
            }
        }

        await prisma.ledger.update({
            where: { id: vendor.ledgerId },
            data: { currentBalance: newBalance }
        });

        await prisma.vendor.update({
            where: { id: vendor.id },
            data: { accountBalance: newBalance }
        });

        res.status(200).json({
            success: true,
            message: 'Balance recalculated successfully',
            data: {
                oldBalance: vendor.ledger.currentBalance,
                newBalance: newBalance
            }
        });
    } catch (error) {
        console.error('Recalculate Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Recalculate All Vendors Ledger Balances
const recalculateAllBalances = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        const vendors = await prisma.vendor.findMany({
            where: { companyId: companyId },
            include: { ledger: true }
        });

        const results = [];

        await prisma.$transaction(async (tx) => {
            for (const vendor of vendors) {
                if (!vendor.ledgerId) continue;

                const transactions = await tx.transaction.findMany({
                    where: {
                        companyId: companyId,
                        OR: [
                            { debitLedgerId: vendor.ledgerId },
                            { creditLedgerId: vendor.ledgerId }
                        ]
                    }
                });

                let newBalance = vendor.ledger.openingBalance || 0;
                for (const txn of transactions) {
                    if (txn.creditLedgerId === vendor.ledgerId) {
                        newBalance += txn.amount;
                    } else {
                        newBalance -= txn.amount;
                    }
                }

                await tx.ledger.update({
                    where: { id: vendor.ledgerId },
                    data: { currentBalance: newBalance }
                });

                await tx.vendor.update({
                    where: { id: vendor.id },
                    data: { accountBalance: newBalance }
                });

                results.push({
                    vendorId: vendor.id,
                    vendorName: vendor.name,
                    oldBalance: vendor.accountBalance,
                    newBalance: newBalance
                });
            }
        });

        res.status(200).json({
            success: true,
            message: 'All vendor balances recalculated successfully',
            data: results
        });
    } catch (error) {
        console.error('Recalculate All Balances Error:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to recalculate balances' });
    }
};

// Get Vendor Statement (Ledger History)
const getVendorStatement = async (req, res) => {
    try {
        const { id } = req.params;
        const { startDate, endDate, billId } = req.query;
        const companyId = req.user.companyId;

        const vendor = await prisma.vendor.findFirst({
            where: { id: parseInt(id), companyId: companyId },
            include: { ledger: true }
        });

        if (!vendor || !vendor.ledgerId) {
            return res.status(404).json({ success: false, message: 'Vendor or Ledger not found' });
        }

        const dateRange = {};
        if (startDate) dateRange.gte = new Date(startDate);
        if (endDate) dateRange.lte = new Date(endDate);

        const whereClause = {
            companyId: companyId,
            date: Object.keys(dateRange).length > 0 ? dateRange : undefined,
            OR: [
                { debitLedgerId: vendor.ledgerId },
                { creditLedgerId: vendor.ledgerId }
            ]
        };

        if (billId) {
            whereClause.purchaseBillId = parseInt(billId);
        }

        const transactions = await prisma.transaction.findMany({
            where: whereClause,
            include: {
                purchasebill: { select: { billNumber: true, totalAmount: true } },
                payment: { select: { paymentNumber: true, amount: true } },
                journalentry: true
            },
            orderBy: { date: 'asc' }
        });

        // Calculate Statements with Running Balance
        let runningBalance = billId ? 0 : vendor.ledger.openingBalance;
        const statement = transactions.map(tx => {
            const isDebit = tx.debitLedgerId === vendor.ledgerId;
            const amount = tx.amount;

            // For Vendors (Liabilities), Credit increases (+) and Debit decreases (-)
            if (isDebit) {
                runningBalance -= amount;
            } else {
                runningBalance += amount;
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
                purchaseBillId: tx.purchaseBillId || null,
                receiptId: tx.receiptId || null,
                purchaseReturnId: tx.purchaseReturnId || null,
                referenceDoc: tx.purchasebill || tx.payment || tx.purchasereturn || null
            };
        });

        res.status(200).json({
            success: true,
            data: {
                vendor: {
                    name: vendor.name,
                    ledgerName: vendor.ledger.name,
                    openingBalance: vendor.ledger.openingBalance
                },
                statement
            }
        });
    } catch (error) {
        console.error('Vendor Statement Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Delete Vendor
const deleteVendor = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        // Check if vendor exists
        const vendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                purchasebill: true,
                purchaseorder: true,
                purchasequotation: true,
                payment: true,
                goodsreceiptnote: true,
                ledger: true
            }
        });

        if (!vendor) {
            return res.status(404).json({
                success: false,
                message: 'Vendor not found'
            });
        }

        // Check for dependencies
        const dependencies = [];
        if (vendor.purchasebill && vendor.purchasebill.length > 0) dependencies.push('purchase bills');
        if (vendor.purchaseorder && vendor.purchaseorder.length > 0) dependencies.push('purchase orders');
        if (vendor.purchasequotation && vendor.purchasequotation.length > 0) dependencies.push('purchase quotations');
        if (vendor.payment && vendor.payment.length > 0) dependencies.push('payments');
        if (vendor.goodsreceiptnote && vendor.goodsreceiptnote.length > 0) dependencies.push('GRNs');

        if (dependencies.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete vendor with existing ${dependencies.join(', ')}. Please delete them first.`
            });
        }

        // Delete in transaction
        await prisma.$transaction(async (tx) => {
            let ledgerExists = false;
            if (vendor.ledgerId) {
                const ledger = await tx.ledger.findUnique({
                    where: { id: vendor.ledgerId }
                });
                if (ledger) {
                    ledgerExists = true;
                }
            }

            // 1. Nullify references to avoid FK constraints during deletion
            if (ledgerExists) {
                // Update vendor to remove ledger reference
                await tx.vendor.update({
                    where: { id: vendor.id },
                    data: { ledgerId: null }
                });

                // Update ledger to remove vendor reference
                await tx.ledger.update({
                    where: { id: vendor.ledgerId },
                    data: { vendorId: null }
                });
            }

            // 2. Delete Vendor
            await tx.vendor.delete({
                where: { id: vendor.id }
            });

            // 3. Delete associated Ledger if exists
            if (ledgerExists) {
                await tx.ledger.delete({
                    where: { id: vendor.ledgerId }
                });
            }
        }, {
            timeout: 15000,
            maxWait: 5000
        });

        const { logActivity } = require('../utils/auditLogger');
        logActivity(req, 'DELETE', 'Vendor', vendor.id, `Vendor ${vendor.name} deleted`);
        res.status(200).json({
            success: true,
            message: 'Vendor deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting vendor details:', error);
        res.status(500).json({
            success: false,
            message: `Failed to delete vendor: ${error.message}`
        });
    }
};

module.exports = {
    createVendor,
    getAllVendors,
    getVendorById,
    updateVendor,
    deleteVendor,
    getVendorStatement,
    recalculateBalance,
    recalculateAllBalances
};
