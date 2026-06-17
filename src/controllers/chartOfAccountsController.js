const chartOfAccountsService = require('../services/chartOfAccountsService');

// Initialize Chart of Accounts for a Company
const initializeCOA = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        const result = await chartOfAccountsService.initializeChartOfAccounts(companyId);

        res.status(201).json({
            success: true,
            message: 'Chart of Accounts initialized successfully',
            data: result
        });
    } catch (error) {
        console.error('Error initializing COA:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initialize Chart of Accounts'
        });
    }
};

// Get Chart of Accounts
const getChartOfAccounts = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { startDate, endDate, search } = req.query;

        const chartOfAccounts = await chartOfAccountsService.getChartOfAccounts(companyId, { startDate, endDate, search });

        res.status(200).json({
            success: true,
            data: chartOfAccounts
        });
    } catch (error) {
        console.error('Error fetching COA:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch Chart of Accounts'
        });
    }
};

// Create Account Group
const createAccountGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { name, type } = req.body;

        if (!name || !type) {
            return res.status(400).json({
                success: false,
                message: 'Name and type are required'
            });
        }

        const group = await chartOfAccountsService.createAccountGroup({
            name,
            type,
            companyId
        });

        res.status(201).json({
            success: true,
            message: 'Account group created successfully',
            data: group
        });
    } catch (error) {
        console.error('Error creating account group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create account group'
        });
    }
};

// Create Account Sub Group
const createAccountSubGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { name, groupId } = req.body;

        if (!name || !groupId) {
            return res.status(400).json({
                success: false,
                message: 'Name and groupId are required'
            });
        }

        const subGroup = await chartOfAccountsService.createAccountSubGroup({
            name,
            groupId: parseInt(groupId),
            companyId
        });

        res.status(201).json({
            success: true,
            message: 'Account sub-group created successfully',
            data: subGroup
        });
    } catch (error) {
        console.error('Error creating account sub-group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create account sub-group'
        });
    }
};

// Create Ledger
const createLedger = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        console.log("Create Ledger Payload:", req.body);
        const { name, groupId, subGroupId, openingBalance, isControlAccount, isEnabled, description, parentLedgerId, accountType, date } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }

        const ledger = await chartOfAccountsService.createLedger({
            name,
            groupId: groupId ? parseInt(groupId) : null,
            subGroupId: subGroupId ? parseInt(subGroupId) : null,
            openingBalance: openingBalance || 0,
            isControlAccount: isControlAccount || false,
            isEnabled: isEnabled !== undefined ? isEnabled : true,
            description,
            parentLedgerId: parentLedgerId ? parseInt(parentLedgerId) : null,
            accountType,
            date,
            companyId
        });

        res.status(201).json({
            success: true,
            message: 'Ledger created successfully',
            data: ledger
        });
    } catch (error) {
        console.error('Error creating ledger:', error);
        if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
            return res.status(409).json({
                success: false,
                message: 'Account name already exists. Please use a different name.'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create ledger' // Service throws "Could not resolve Account Group..." which matches this catch
        });
    }
};

// Get Ledger by ID
const getLedger = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        const ledger = await chartOfAccountsService.getLedgerById(id, companyId);

        if (!ledger) {
            return res.status(404).json({
                success: false,
                message: 'Ledger not found'
            });
        }

        res.status(200).json({
            success: true,
            data: ledger
        });
    } catch (error) {
        console.error('Error fetching ledger:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ledger'
        });
    }
};

// Get Ledger Transactions
const getLedgerTransactions = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        const transactions = await chartOfAccountsService.getLedgerTransactions(id, companyId);

        res.status(200).json({
            success: true,
            data: transactions
        });
    } catch (error) {
        console.error('Error fetching ledger transactions:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ledger transactions'
        });
    }
};

// Get Account Group by ID
const getAccountGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        const group = await chartOfAccountsService.getAccountGroupById(id, companyId);

        if (!group) {
            return res.status(404).json({
                success: false,
                message: 'Account group not found'
            });
        }

        res.status(200).json({
            success: true,
            data: group
        });
    } catch (error) {
        console.error('Error fetching account group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch account group'
        });
    }
};

// Update Account Group
const updateAccountGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const { name, type } = req.body;

        if (!name || !type) {
            return res.status(400).json({
                success: false,
                message: 'Name and type are required'
            });
        }

        const group = await chartOfAccountsService.updateAccountGroup(id, companyId, { name, type });

        res.status(200).json({
            success: true,
            message: 'Account group updated successfully',
            data: group
        });
    } catch (error) {
        console.error('Error updating account group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update account group'
        });
    }
};

// Delete Account Group
const deleteAccountGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        await chartOfAccountsService.deleteAccountGroup(id, companyId);

        res.status(200).json({
            success: true,
            message: 'Account group deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting account group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete account group'
        });
    }
};

// Get Account Sub Group by ID
const getAccountSubGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        const subGroup = await chartOfAccountsService.getAccountSubGroupById(id, companyId);

        if (!subGroup) {
            return res.status(404).json({
                success: false,
                message: 'Account sub-group not found'
            });
        }

        res.status(200).json({
            success: true,
            data: subGroup
        });
    } catch (error) {
        console.error('Error fetching account sub-group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch account sub-group'
        });
    }
};

// Update Account Sub Group
const updateAccountSubGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const { name, groupId } = req.body;

        if (!name || !groupId) {
            return res.status(400).json({
                success: false,
                message: 'Name and groupId are required'
            });
        }

        const subGroup = await chartOfAccountsService.updateAccountSubGroup(id, companyId, { name, groupId });

        res.status(200).json({
            success: true,
            message: 'Account sub-group updated successfully',
            data: subGroup
        });
    } catch (error) {
        console.error('Error updating account sub-group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update account sub-group'
        });
    }
};

// Delete Account Sub Group
const deleteAccountSubGroup = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        await chartOfAccountsService.deleteAccountSubGroup(id, companyId);

        res.status(200).json({
            success: true,
            message: 'Account sub-group deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting account sub-group:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete account sub-group'
        });
    }
};

// Get All Ledgers
const getAllLedgers = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        const ledgers = await chartOfAccountsService.getAllLedgers(companyId);

        res.status(200).json({
            success: true,
            data: ledgers
        });
    } catch (error) {
        console.error('Error fetching ledgers:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch ledgers'
        });
    }
};

// Update Ledger
const updateLedger = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;
        const { name, groupId, subGroupId, openingBalance, isControlAccount, isEnabled, description, parentLedgerId, date } = req.body;

        if (!name || !groupId) {
            return res.status(400).json({
                success: false,
                message: 'Name and groupId are required'
            });
        }

        const ledger = await chartOfAccountsService.updateLedger(id, companyId, {
            name,
            groupId: parseInt(groupId),
            subGroupId: subGroupId ? parseInt(subGroupId) : null,
            openingBalance,
            isControlAccount,
            isEnabled,
            description,
            parentLedgerId,
            date
        });

        res.status(200).json({
            success: true,
            message: 'Ledger updated successfully',
            data: ledger
        });
    } catch (error) {
        console.error('Error updating ledger:', error);
        if (error.code === 'P2002' && error.meta?.target?.includes('name')) {
            return res.status(409).json({
                success: false,
                message: 'Account name already exists. Please use a different name.'
            });
        }
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update ledger'
        });
    }
};

// Delete Ledger
const deleteLedger = async (req, res) => {
    try {
        const companyId = req.user.companyId;
        const { id } = req.params;

        await chartOfAccountsService.deleteLedger(id, companyId);

        res.status(200).json({
            success: true,
            message: 'Ledger deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting ledger:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete ledger'
        });
    }
};

// Get Account Types (Dynamic from DB)
const getAccountTypes = async (req, res) => {
    try {
        const companyId = req.user.companyId;

        if (!companyId) {
            return res.status(400).json({
                success: false,
                message: 'User is not associated with any company'
            });
        }

        // Ensure default accounts exist (Lazy Initialization)
        const initResult = await chartOfAccountsService.initializeChartOfAccounts(companyId);

        if (initResult && initResult.success === false) {
            return res.status(404).json({
                success: false,
                message: initResult.message
            });
        }

        const coaData = await chartOfAccountsService.getChartOfAccounts(companyId);

        // Transform to requested format:
        // groupName, groupId
        // accounts: [{ accountTypeName, accountTypeId }]
        const accountTypes = coaData.map(group => ({
            groupName: group.name,
            groupId: group.id,
            accounts: group.accountsubgroup ? group.accountsubgroup.map(sub => ({
                accountTypeName: sub.name,
                accountTypeId: sub.id
            })) : []
        }));

        res.status(200).json({
            success: true,
            data: accountTypes
        });
    } catch (error) {
        console.error('Error fetching account types:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch account types'
        });
    }
};

module.exports = {
    initializeCOA,
    getChartOfAccounts,
    createAccountGroup,
    createAccountSubGroup,
    createLedger,
    getLedger,
    getLedgerTransactions,
    getAccountGroup,
    updateAccountGroup,
    deleteAccountGroup,
    getAccountSubGroup,
    updateAccountSubGroup,
    deleteAccountSubGroup,
    getAllLedgers,
    updateLedger,
    deleteLedger,
    getAccountTypes
};
