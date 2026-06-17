const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Simple in-memory cache for company expiry checks
const expiryCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Access token required' });
    }

    try {
        const user = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check for company plan expiration
        if (user.role !== 'SUPERADMIN' && user.companyId) {
            const now = Date.now();
            const cached = expiryCache.get(user.companyId);

            let isExpired = false;
            let expiryDate = null;

            if (cached && (now - cached.timestamp < CACHE_DURATION)) {
                isExpired = cached.isExpired;
            } else {
                const company = await prisma.company.findUnique({
                    where: { id: parseInt(user.companyId) },
                    select: { endDate: true }
                });

                if (company && company.endDate) {
                    expiryDate = new Date(company.endDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    isExpired = expiryDate < today;
                }

                // Update cache
                expiryCache.set(user.companyId, { timestamp: now, isExpired });
            }

            if (isExpired) {
                return res.status(403).json({ 
                    message: 'Your company plan has expired. Please contact super admin to renew your plan.',
                    isExpired: true 
                });
            }
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Invalid or expired token' });
    }
};

const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied: Insufficient permissions' });
        }
        next();
    };
};

const getSpecificModule = (path, requiredPermission) => {
    const url = path.toLowerCase();
    
    // Purchases
    if (url.includes('purchase-quotation') || url.includes('purchasequotation')) return 'purchase quotation';
    if (url.includes('purchase-order') || url.includes('purchaseorder')) return 'purchase order';
    if (url.includes('goods-receipt') || url.includes('goodsreceipt') || url.includes('receipt')) return 'goods receipt';
    if (url.includes('purchase-bill') || url.includes('purchasebill') || url.includes('bill')) return 'purchase bill';
    if (url.includes('purchase-payment') || url.includes('purchasepayment')) return 'purchase payment';
    if (url.includes('purchase-return') || url.includes('purchasereturn')) return 'purchase return';
    
    // Sales
    if (url.includes('sales-quotation') || url.includes('salesquotation')) return 'sales quotation';
    if (url.includes('sales-order') || url.includes('salesorder')) return 'sales order';
    if (url.includes('delivery-challan') || url.includes('deliverychallan') || url.includes('challan')) return 'delivery challan';
    if (url.includes('sales-invoice') || url.includes('salesinvoice') || url.includes('invoice')) return 'sales invoice';
    if (url.includes('sales-payment') || url.includes('salespayment') || url.includes('payment')) return 'sales payment';
    if (url.includes('sales-return') || url.includes('salesreturn')) return 'sales return';

    // Accounts
    if (url.includes('chart')) return 'charts of accounts';
    if (url.includes('customer')) return 'customers';
    if (url.includes('vendor')) return 'vendors';
    
    // Inventory
    if (url.includes('warehouse')) return 'warehouse';
    if (url.includes('uom')) return 'uom';
    if (url.includes('product')) return 'products';
    if (url.includes('service')) return 'services';
    if (url.includes('stock-transfer') || url.includes('stocktransfer') || url.includes('transfer')) return 'stock transfer';
    if (url.includes('inventory-adjustment') || url.includes('inventoryadjustment') || url.includes('adjustment')) return 'inventory adjustment';
    
    // POS
    if (url.includes('pos')) return 'pos';
    
    // Voucher
    if (url.includes('voucher') && (url.includes('journal') || url.includes('create'))) return 'journal voucher';
    if (url.includes('voucher') && url.includes('contra')) return 'contra voucher';
    if (url.includes('expense')) return 'expenses';
    if (url.includes('income')) return 'income';
    
    // User & Role
    if (url.includes('role')) return 'role';
    if (url.includes('user')) return 'user';
    
    return null;
};

const authorizePermissions = (requiredPermission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        // Superadmin and Company Owner bypass all permission checks
        if (req.user.role === 'SUPERADMIN' || req.user.role === 'COMPANY') {
            return next();
        }

        const permissions = req.user.permissions || [];
        
        // 1. Direct check
        if (permissions.includes(requiredPermission)) {
            return next();
        }

        // 2. General fallback check
        if (requiredPermission.startsWith('manage ')) {
            const viewPerm = requiredPermission.replace('manage ', 'view ');
            if (permissions.includes(viewPerm)) return next();
        }

        // 3. Route specific module fallback check
        const path = req.originalUrl || req.baseUrl;
        const specificModule = getSpecificModule(path, requiredPermission);

        if (specificModule) {
            const parts = requiredPermission.split(' ');
            if (parts.length >= 2) {
                const action = parts[0]; // e.g. "create", "view", "edit", "delete", "show"
                const normalizedAction = action === 'show' ? 'view' : action;
                
                const specificCheckPerm = `${normalizedAction} ${specificModule}`;
                const specificManagePerm = `manage ${specificModule}`;

                if (permissions.includes(specificCheckPerm) || permissions.includes(specificManagePerm)) {
                    return next();
                }
            }
        }

        return res.status(403).json({ 
            message: `Access denied: You do not have permission to ${requiredPermission}`,
            requiredPermission 
        });
    };
};

module.exports = { authenticateToken, authorizeRoles, authorizePermissions };
