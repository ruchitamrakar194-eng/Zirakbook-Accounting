const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const chartOfAccountsService = require('../services/chartOfAccountsService');
const numberingService = require('../services/numberingService');
const { isCloudinaryConfigured } = require('../utils/cloudinaryConfig');

const createCompany = async (req, res) => {
    try {
        const { name, email, phone, address, startDate, endDate, planId, planType, password } = req.body;

        let logoUrl = null;
        if (req.file) {
            if (isCloudinaryConfigured) {
                logoUrl = req.file.path; // Cloudinary URL
            } else {
                console.warn('File received but Cloudinary not configured. Logo not saved.');
            }
        }

        // Check if company or user already exists
        const existingCompany = await prisma.company.findUnique({ where: { email } });
        if (existingCompany) return res.status(400).json({ error: 'Company with this email already exists' });

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ error: 'User with this email already exists' });

        // Hash password for the company admin
        if (!password) {
            return res.status(400).json({ error: 'Password is required for creating a company account' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create Company and Admin User in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: {
                    name,
                    email,
                    phone,
                    address,
                    startDate: startDate ? new Date(startDate) : null,
                    endDate: endDate ? new Date(endDate) : null,
                    planId: planId ? parseInt(planId) : null,
                    planType,
                    logo: logoUrl
                }
            });

            // Derive permissions from Plan Modules
            let modulesArray = [];
            try {
                if (planId) {
                    const plan = await tx.plan.findUnique({ where: { id: parseInt(planId) } });
                    if (plan && plan.modules) {
                        modulesArray = JSON.parse(plan.modules);
                    }
                }
            } catch (e) {
                console.error("Module parse error:", e);
            }

            const enabledModules = modulesArray.filter(m => m.enabled).map(m => (m.name || m.module_name || "").toLowerCase());

            // Base permissions (always included for company admin - requested default menus)
            let defaultPermissions = [
                "show dashboard",
                "manage voucher", "create voucher", "edit voucher", "delete voucher",
                "manage reports", "view reports",
                "manage user", "create user", "edit user", "delete user",
                "manage role", "create role", "edit role", "delete role",
                "manage settings", "edit settings", "view settings"
            ];

            // Module specific mapping (gated menus)
            const moduleMapping = {
                'account': ["manage accounts", "create accounts", "edit accounts", "delete accounts", "view accounts"],
                'accounts': ["manage accounts", "create accounts", "edit accounts", "delete accounts", "view accounts"],
                'inventory': ["manage inventory", "create inventory", "edit inventory", "delete inventory", "view inventory"],
                'sales': ["manage sales", "create sales", "edit sales", "delete sales", "show sales", "send sales", "view sales"],
                'purchase': ["manage purchases", "create purchases", "edit purchases", "delete purchases", "view purchases"],
                'purchases': ["manage purchases", "create purchases", "edit purchases", "delete purchases", "view purchases"],
                'pos': ["manage pos", "create pos", "edit pos", "delete pos", "view pos"]
            };

            enabledModules.forEach(modName => {
                for (const key in moduleMapping) {
                    if (modName.includes(key)) {
                        defaultPermissions = [...new Set([...defaultPermissions, ...moduleMapping[key]])];
                    }
                }
            });

            const role = await tx.role.create({
                data: {
                    name: 'COMPANY',
                    companyId: company.id,
                    permissions: JSON.stringify(defaultPermissions)
                }
            });

            const user = await tx.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    role: 'COMPANY',
                    roleId: role.id,
                    companyId: company.id
                }
            });

            return { company, user };
        }, {
            timeout: 15000
        });

        // Initialize Chart of Accounts for the new company
        try {
            await chartOfAccountsService.initializeChartOfAccounts(result.company.id);
        } catch (coaError) {
            console.error('COA Initialization Error (Skipping):', coaError);
        }

        res.status(201).json(result.company);
    } catch (error) {
        console.error('Create Company Error:', error);
        res.status(500).json({
            error: error.message || 'Internal Server Error'
        });
    }
};

const getCompanies = async (req, res) => {
    try {
        const companies = await prisma.company.findMany({
            include: {
                user: true,
                plan: true
            }
        });
        const companiesWithStorage = companies.map(company => {
            if (company.inventoryConfig) {
                try {
                    const config = JSON.parse(company.inventoryConfig);
                    company.storageCapacity = config.storageCapacity;
                } catch (e) { }
            }
            return company;
        });
        res.json(companiesWithStorage);
    } catch (error) {
        console.error('Get Companies Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getCompanyById = async (req, res) => {
    try {
        const company = await prisma.company.findUnique({
            where: { id: parseInt(req.params.id) },
            include: {
                user: true,
                plan: true
            }
        });

        logToFile(`📡 getCompanyById ID: ${req.params.id} | company.name: ${company?.name} | company.invoiceLabels: ${company?.invoiceLabels}`);

        if (company && company.inventoryConfig) {
            try {
                const config = JSON.parse(company.inventoryConfig);
                company.storageCapacity = config.storageCapacity;
            } catch (e) { }
        }
        res.json(company);
    } catch (error) {
        logToFile(`❌ getCompanyById error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
};

const fs = require('fs');
const path = require('path');
const logFilePath = path.join(__dirname, '../../debug_logs.txt');

const logToFile = (message) => {
    try {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logFilePath, `[${timestamp}] ${message}\n`);
    } catch (e) {
        console.error('Failed to log to file:', e);
    }
};

const updateCompany = async (req, res) => {
    try {
        logToFile(`📥 Received company update request for ID: ${req.params.id}`);
        logToFile(`Request body fields: ${Object.keys(req.body).join(', ')}`);
        logToFile(`invoiceLabels raw value: ${req.body.invoiceLabels}`);

        const {
            name, email, phone, website, address, city, state, zip, country, currency,
            startDate, endDate, planId, planType,
            invoiceTemplate, invoiceColor, showQrCode,
            bankName, accountHolder, accountNumber,
            ifsc,
            terms,
            termsInvoice,
            termsReceipt,
            termsPurchase,
            termsSalesOrder,
            termsQuotation,
            termsCreditNote,
            notes,
            inventoryConfig,
            storageCapacity,
            invoiceTableHeaders,
            invoiceLabels,
            receiptTemplate,
            receiptColor,
            receiptLabels,
            receiptTableHeaders,
            paymentTemplate,
            paymentColor,
            paymentLabels,
            paymentTableHeaders,
            customFieldsConfig,
            documentTitles
        } = req.body;

        // Fetch current company to get existing inventoryConfig
        const currentCompany = await prisma.company.findUnique({
            where: { id: parseInt(req.params.id) }
        });

        let finalInventoryConfig = currentCompany.inventoryConfig || '{}';
        try {
            let configObj = typeof finalInventoryConfig === 'string' ? JSON.parse(finalInventoryConfig) : finalInventoryConfig;
            if (storageCapacity !== undefined) {
                configObj.storageCapacity = storageCapacity;
            }
            if (inventoryConfig !== undefined) {
                // Merge other inventory config if provided
                const newConfig = typeof inventoryConfig === 'string' ? JSON.parse(inventoryConfig) : inventoryConfig;
                configObj = { ...configObj, ...newConfig };
            }
            finalInventoryConfig = JSON.stringify(configObj);
        } catch (e) {
            logToFile(`Error parsing inventoryConfig: ${e.message}`);
        }

        const updateData = {
            name,
            email,
            phone,
            website,
            address,
            city,
            state,
            zip,
            country,
            currency,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            planId: planId ? parseInt(planId) : undefined,
            planType: planType || undefined,
            invoiceTemplate,
            invoiceColor,
            showQrCode: showQrCode === 'true' || showQrCode === true,
            bankName,
            accountHolder,
            accountNumber,
            ifsc,
            terms,
            termsInvoice,
            termsReceipt,
            termsPurchase,
            termsSalesOrder,
            termsQuotation,
            termsCreditNote,
            notes,
            inventoryConfig: finalInventoryConfig,
            invoiceTableHeaders: invoiceTableHeaders ? (typeof invoiceTableHeaders === 'string' ? invoiceTableHeaders : JSON.stringify(invoiceTableHeaders)) : undefined,
            invoiceLabels: invoiceLabels ? (typeof invoiceLabels === 'string' ? invoiceLabels : JSON.stringify(invoiceLabels)) : undefined,
            receiptTemplate: receiptTemplate || undefined,
            receiptColor: receiptColor || undefined,
            receiptLabels: receiptLabels ? (typeof receiptLabels === 'string' ? receiptLabels : JSON.stringify(receiptLabels)) : undefined,
            receiptTableHeaders: receiptTableHeaders ? (typeof receiptTableHeaders === 'string' ? receiptTableHeaders : JSON.stringify(receiptTableHeaders)) : undefined,
            paymentTemplate: paymentTemplate || undefined,
            paymentColor: paymentColor || undefined,
            paymentLabels: paymentLabels ? (typeof paymentLabels === 'string' ? paymentLabels : JSON.stringify(paymentLabels)) : undefined,
            paymentTableHeaders: paymentTableHeaders ? (typeof paymentTableHeaders === 'string' ? paymentTableHeaders : JSON.stringify(paymentTableHeaders)) : undefined,
            customFieldsConfig: customFieldsConfig !== undefined ? (typeof customFieldsConfig === 'string' ? customFieldsConfig : JSON.stringify(customFieldsConfig)) : undefined,
            documentTitles: documentTitles !== undefined ? (typeof documentTitles === 'string' ? documentTitles : JSON.stringify(documentTitles)) : undefined
        };

        if (req.files) {
            if (req.files.logo && req.files.logo[0]) {
                const logoFile = req.files.logo[0];
                if (isCloudinaryConfigured) {
                    updateData.logo = logoFile.path;
                } else if (logoFile.buffer) {
                    updateData.logo = `data:${logoFile.mimetype};base64,${logoFile.buffer.toString('base64')}`;
                }
            }
            if (req.files.invoiceLogo && req.files.invoiceLogo[0]) {
                const invoiceLogoFile = req.files.invoiceLogo[0];
                if (isCloudinaryConfigured) {
                    updateData.invoiceLogo = invoiceLogoFile.path;
                } else if (invoiceLogoFile.buffer) {
                    updateData.invoiceLogo = `data:${invoiceLogoFile.mimetype};base64,${invoiceLogoFile.buffer.toString('base64')}`;
                }
            }
        }

        logToFile(`💾 Updating company in DB with updateData: ${JSON.stringify(updateData)}`);

        const company = await prisma.company.update({
            where: { id: parseInt(req.params.id) },
            data: updateData,
            include: { plan: true }
        });

        logToFile(`✅ Company updated in DB. company.invoiceLabels value: ${company.invoiceLabels}`);

        // Add storageCapacity to the response object for frontend
        if (company.inventoryConfig) {
            try {
                const config = JSON.parse(company.inventoryConfig);
                company.storageCapacity = config.storageCapacity;
            } catch (e) { }
        }

        res.json(company);
    } catch (error) {
        logToFile(`❌ Update Company Error: ${error.message}`);
        res.status(500).json({
            error: error.message || 'Internal Server Error'
        });
    }
};

const deleteCompany = async (req, res) => {
    try {
        // Transaction to delete company and its users
        await prisma.$transaction(async (tx) => {
            await tx.user.deleteMany({ where: { companyId: parseInt(req.params.id) } });
            await tx.company.delete({ where: { id: parseInt(req.params.id) } });
        });
        res.json({ message: 'Company and its users deleted successfully' });
    } catch (error) {
        console.error('Delete Company Error:', error);
        res.status(500).json({ error: error.message });
    }
};

const getNumberingSettings = async (req, res) => {
    try {
        const companyId = parseInt(req.params.id || req.user?.companyId);
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        // Use raw SQL helpers — works even if prisma client is not regenerated yet
        const existingConfigs = await numberingService.findAllConfigs(companyId);

        const configsMap = {};
        existingConfigs.forEach(cfg => {
            configsMap[cfg.transactionType] = cfg;
        });

        const allTypes = Object.keys(numberingService.TRANSACTION_TYPES);
        const results = await Promise.all(allTypes.map(async (type) => {
            if (configsMap[type]) return configsMap[type];
            const defInfo = numberingService.TRANSACTION_TYPES[type];
            return await numberingService.upsertConfig(companyId, type, {
                prefix: defInfo.defaultPrefix,
                currentNumber: 1,
                paddingLength: 4,
                pattern: 'numeric'
            });
        }));

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('Get Numbering Settings Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateNumberingSettings = async (req, res) => {
    try {
        const companyId = parseInt(req.params.id || req.user?.companyId);
        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }

        const { settings } = req.body;
        if (!Array.isArray(settings)) {
            return res.status(400).json({ success: false, message: 'Settings array is required' });
        }

        const results = [];
        for (const item of settings) {
            const { transactionType, prefix, currentNumber, paddingLength, pattern } = item;
            if (!transactionType) continue;

            const updated = await numberingService.upsertConfig(companyId, transactionType, {
                prefix:        prefix !== undefined ? prefix : '',
                currentNumber: currentNumber !== undefined ? parseInt(currentNumber) : 1,
                paddingLength: paddingLength !== undefined ? parseInt(paddingLength) : 4,
                pattern:       pattern || 'numeric'
            });
            results.push(updated);
        }

        res.json({ success: true, data: results });
    } catch (error) {
        console.error('Update Numbering Settings Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const getNextNumberEndpoint = async (req, res) => {
    try {
        const companyId = parseInt(req.params.id || req.user?.companyId || req.query.companyId);
        const { type } = req.query;

        if (!companyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required' });
        }
        if (!type) {
            return res.status(400).json({ success: false, message: 'Transaction type is required' });
        }

        const result = await numberingService.getNextNumber(companyId, type);
        res.json({ success: true, nextNumber: result.formattedNumber, details: result });
    } catch (error) {
        console.error('Get Next Number Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCompany,
    getCompanies,
    getCompanyById,
    updateCompany,
    deleteCompany,
    getNumberingSettings,
    updateNumberingSettings,
    getNextNumberEndpoint
};

