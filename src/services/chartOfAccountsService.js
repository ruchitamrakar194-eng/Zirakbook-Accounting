const prisma = require('../config/prisma');

const calculateInventoryValue = async (companyId) => {
    try {
        const stocks = await prisma.stock.findMany({
            where: { product: { companyId: parseInt(companyId) } },
            include: { product: true }
        });

        let totalValue = 0;
        stocks.forEach(s => {
            const price = s.product.purchasePrice || s.product.initialCost || 0;
            totalValue += (s.quantity * price);
        });
        return totalValue;
    } catch (error) {
        console.error("Error calculating inventory value:", error);
        return 0;
    }
};

const calculateOpeningBalanceEquityValue = async (companyId, inventoryValue) => {
    try {
        const ledgers = await prisma.ledger.findMany({
            where: { companyId: parseInt(companyId) },
            include: { accountgroup: true }
        });

        let totalCredits = 0;
        let totalDebits = 0;

        ledgers.forEach(l => {
            if (l.name.toLowerCase().includes('opening balance equity')) {
                return;
            }

            const type = l.accountgroup?.type;
            let balance = l.currentBalance || 0;

            if (l.name.toLowerCase().includes('inventory asset')) {
                balance = inventoryValue;
            }

            if (['ASSETS', 'EXPENSES'].includes(type)) {
                totalDebits += balance;
            } else {
                totalCredits += balance;
            }
        });

        return totalCredits - totalDebits;
    } catch (error) {
        console.error("Error calculating opening balance equity:", error);
        return 0;
    }
};

/**
 * Automatic Self-Cleanup: scans the transaction table for any Opening Stock
 * entries that reference products that no longer exist, deletes them, and
 * reverses the stale ledger balance adjustments.
 */
const cleanupStaleOpeningStockTransactions = async (companyId) => {
    try {
        const companyIdInt = parseInt(companyId);

        // Find all opening-stock accounting transactions
        const openingStockTxns = await prisma.transaction.findMany({
            where: {
                companyId: companyIdInt,
                narration: { startsWith: 'Opening Stock for Product:' }
            }
        });

        if (openingStockTxns.length === 0) return;

        // Get all current product names for this company
        const products = await prisma.product.findMany({
            where: { companyId: companyIdInt },
            select: { name: true }
        });
        const productNames = new Set(products.map(p => p.name));

        // Identify stale transactions (product no longer exists)
        const staleTxns = openingStockTxns.filter(t => {
            const productName = t.narration.replace('Opening Stock for Product: ', '').trim();
            return !productNames.has(productName);
        });

        if (staleTxns.length === 0) return;

        console.log(`[COA Cleanup] Found ${staleTxns.length} stale opening-stock transaction(s). Cleaning up...`);

        // Find ledgers once
        const inventoryAsset = await prisma.ledger.findFirst({
            where: { companyId: companyIdInt, name: 'Inventory Asset' }
        });
        const openingEquity = await prisma.ledger.findFirst({
            where: { companyId: companyIdInt, name: 'Opening Balance Equity' }
        });

        const totalStaleAmount = staleTxns.reduce((sum, t) => sum + (t.amount || 0), 0);

        // Delete stale transactions
        await prisma.transaction.deleteMany({
            where: { id: { in: staleTxns.map(t => t.id) } }
        });

        // Reverse ledger balance adjustments
        if (inventoryAsset && totalStaleAmount > 0) {
            await prisma.ledger.update({
                where: { id: inventoryAsset.id },
                data: { currentBalance: { decrement: totalStaleAmount } }
            });
        }
        if (openingEquity && totalStaleAmount > 0) {
            await prisma.ledger.update({
                where: { id: openingEquity.id },
                data: { currentBalance: { increment: totalStaleAmount } }
            });
        }

        console.log(`[COA Cleanup] Removed stale amount: ${totalStaleAmount}. Ledger balances corrected.`);
    } catch (error) {
        // Non-fatal — log and continue
        console.error('[COA Cleanup] Error during stale opening-stock cleanup:', error);
    }
};

/**
 * Calculate fully-dynamic balances for all ledgers using a single-pass
 * groupBy aggregate on the transaction table.  Returns a Map keyed by
 * ledger id whose value is { debitTotal, creditTotal, dynamicBalance }.
 */
const calculateDynamicLedgerBalances = async (companyId, inventoryValue) => {
    try {
        const companyIdInt = parseInt(companyId);

        const ledgers = await prisma.ledger.findMany({
            where: { companyId: companyIdInt },
            include: { accountgroup: true }
        });

        // Single-pass aggregates
        const [debitSums, creditSums] = await Promise.all([
            prisma.transaction.groupBy({
                by: ['debitLedgerId'],
                where: { companyId: companyIdInt },
                _sum: { amount: true }
            }),
            prisma.transaction.groupBy({
                by: ['creditLedgerId'],
                where: { companyId: companyIdInt },
                _sum: { amount: true }
            })
        ]);

        const debitMap = new Map(debitSums.map(d => [d.debitLedgerId, d._sum.amount || 0]));
        const creditMap = new Map(creditSums.map(c => [c.creditLedgerId, c._sum.amount || 0]));

        const balanceMap = new Map();
        let totalAssets = 0;
        let totalLiabilities = 0;
        let totalOtherEquity = 0;
        let totalIncome = 0;
        let totalExpenses = 0;

        ledgers.forEach(l => {
            const isOBE = l.name.toLowerCase().includes('opening balance equity');
            const isInventory = l.name.toLowerCase().includes('inventory asset');
            const isRetainedEarnings = l.name.toLowerCase().includes('retained earnings');
            const groupType = l.accountgroup?.type;
            const opening = l.openingBalance || 0;
            const txnDebit = debitMap.get(l.id) || 0;
            const txnCredit = creditMap.get(l.id) || 0;

            let dynamicBalance;
            if (isInventory) {
                dynamicBalance = inventoryValue;
            } else if (isOBE || isRetainedEarnings) {
                dynamicBalance = 0; // Will be set after totals
            } else if (['ASSETS', 'EXPENSES'].includes(groupType)) {
                dynamicBalance = opening + txnDebit - txnCredit;
            } else {
                dynamicBalance = opening + txnCredit - txnDebit;
            }

            balanceMap.set(l.id, {
                ledger: l,
                dynamicBalance,
                isOBE,
                isInventory,
                isRetainedEarnings,
                groupType
            });

            if (!isOBE && !isRetainedEarnings) {
                if (groupType === 'ASSETS') totalAssets += isInventory ? inventoryValue : dynamicBalance;
                else if (groupType === 'LIABILITIES') totalLiabilities += dynamicBalance;
                else if (groupType === 'EQUITY') totalOtherEquity += dynamicBalance;
                else if (groupType === 'INCOME') totalIncome += dynamicBalance;
                else if (groupType === 'EXPENSES') totalExpenses += dynamicBalance;
            }
        });

        // Calculate dynamic profit/loss and set Retained Earnings
        const netProfit = totalIncome - totalExpenses;
        const reLedger = ledgers.find(l => l.name.toLowerCase().includes('retained earnings'));
        const reOpening = reLedger?.openingBalance || 0;
        const reTxnDebit = reLedger ? (debitMap.get(reLedger.id) || 0) : 0;
        const reTxnCredit = reLedger ? (creditMap.get(reLedger.id) || 0) : 0;
        const dynamicRetainedEarnings = reOpening + reTxnCredit - reTxnDebit + netProfit;

        // Add dynamic Retained Earnings to totalOtherEquity for correct OBE calculation
        totalOtherEquity += dynamicRetainedEarnings;

        // Opening Balance Equity = exact offset to balance the trial balance
        const dynamicOBE = totalAssets - totalLiabilities - totalOtherEquity;

        // Apply OBE and Retained Earnings values back into the map
        for (const [id, entry] of balanceMap) {
            if (entry.isOBE) {
                entry.dynamicBalance = dynamicOBE;
            } else if (entry.isRetainedEarnings) {
                entry.dynamicBalance = dynamicRetainedEarnings;
            }
        }

        return balanceMap;
    } catch (error) {
        console.error('[COA] Error calculating dynamic ledger balances:', error);
        return new Map();
    }
};

// Initialize Default Chart of Accounts for a Company
const initializeChartOfAccounts = async (companyId) => {

    try {
        // 1. Verify Company exists
        const company = await prisma.company.findUnique({
            where: { id: companyId }
        });

        if (!company) {
            return {
                success: false,
                message: `Company with ID ${companyId} not found. Please logout and login again.`
            };
        }

        // 2. Check if already initialized (at least one group exists)
        const existingGroups = await prisma.accountgroup.findFirst({
            where: { companyId }
        });

        if (existingGroups) {
            return {
                success: true,
                message: 'Chart of Accounts already initialized'
            };
        }

        // --- Helper for creating groups, subgroups, and ledgers ---
        const createCOA = async () => {
            // 1. ASSETS
            const assetsGroup = await prisma.accountgroup.create({
                data: { name: 'Assets', type: 'ASSETS', companyId }
            });

            const cashSub = await prisma.accountsubgroup.create({
                data: { name: 'Cash', groupId: assetsGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Cash in Hand', groupId: assetsGroup.id, subGroupId: cashSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const bankSub = await prisma.accountsubgroup.create({
                data: { name: 'Bank Accounts', groupId: assetsGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Main Bank Account', groupId: assetsGroup.id, subGroupId: bankSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const arSub = await prisma.accountsubgroup.create({
                data: { name: 'Accounts Receivable', groupId: assetsGroup.id, companyId }
            });

            const inventorySub = await prisma.accountsubgroup.create({
                data: { name: 'Inventory', groupId: assetsGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Inventory Asset', groupId: assetsGroup.id, subGroupId: inventorySub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const fixedAssetsSub = await prisma.accountsubgroup.create({
                data: { name: 'Fixed Assets', groupId: assetsGroup.id, companyId }
            });

            // 2. LIABILITIES
            const liabilitiesGroup = await prisma.accountgroup.create({
                data: { name: 'Liabilities', type: 'LIABILITIES', companyId }
            });

            const apSub = await prisma.accountsubgroup.create({
                data: { name: 'Accounts Payable', groupId: liabilitiesGroup.id, companyId }
            });

            const taxSub = await prisma.accountsubgroup.create({
                data: { name: 'Duties & Taxes', groupId: liabilitiesGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'VAT / Sales Tax Payable', groupId: liabilitiesGroup.id, subGroupId: taxSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const loansSub = await prisma.accountsubgroup.create({
                data: { name: 'Loans & Borrowings', groupId: liabilitiesGroup.id, companyId }
            });

            // 3. EQUITY
            const equityGroup = await prisma.accountgroup.create({
                data: { name: 'Equity', type: 'EQUITY', companyId }
            });

            const capitalSub = await prisma.accountsubgroup.create({
                data: { name: 'Share Capital', groupId: equityGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Owner Investment / Capital', groupId: equityGroup.id, subGroupId: capitalSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const equityItemsSub = await prisma.accountsubgroup.create({
                data: { name: 'Equity Items', groupId: equityGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Opening Balance Equity', groupId: equityGroup.id, subGroupId: equityItemsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
            await prisma.ledger.create({
                data: { name: 'Retained Earnings', groupId: equityGroup.id, subGroupId: equityItemsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            // 4. INCOME
            const incomeGroup = await prisma.accountgroup.create({
                data: { name: 'Income', type: 'INCOME', companyId }
            });

            const salesSub = await prisma.accountsubgroup.create({
                data: { name: 'Sales Income', groupId: incomeGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Sales Revenue', groupId: incomeGroup.id, subGroupId: salesSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const otherIncomeSub = await prisma.accountsubgroup.create({
                data: { name: 'Other Income', groupId: incomeGroup.id, companyId }
            });
            // Discount Received on Purchase → INCOME (vendor gives us discount)
            await prisma.ledger.create({
                data: { name: 'Discount Received on Purchase', groupId: incomeGroup.id, subGroupId: otherIncomeSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            // 5. EXPENSES
            const expensesGroup = await prisma.accountgroup.create({
                data: { name: 'Expenses', type: 'EXPENSES', companyId }
            });

            const cogsSub = await prisma.accountsubgroup.create({
                data: { name: 'Direct Expenses / COGS', groupId: expensesGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Cost of Goods Sold', groupId: expensesGroup.id, subGroupId: cogsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });

            const operatingSub = await prisma.accountsubgroup.create({
                data: { name: 'Operating Expenses', groupId: expensesGroup.id, companyId }
            });
            await prisma.ledger.create({
                data: { name: 'Rent Expense', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
            await prisma.ledger.create({
                data: { name: 'Electricity & Utilities', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
            await prisma.ledger.create({
                data: { name: 'Salary & Wages', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
            await prisma.ledger.create({
                data: { name: 'Inventory Adjustment Expense', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
            // Discount Allowed on Sale → EXPENSES (we give customer a discount)
            await prisma.ledger.create({
                data: { name: 'Discount Allowed on Sale', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
            });
        };

        await createCOA();

        return {
            success: true,
            message: 'Professional Chart of Accounts initialized successfully'
        };
    } catch (error) {
        console.error('Error initializing COA:', error);
        throw error;
    }
};


// Get Chart of Accounts
const getChartOfAccounts = async (companyId, filters = {}) => {
    try {
        // Auto-cleanup stale opening-stock transactions before reading
        await cleanupStaleOpeningStockTransactions(companyId);

        const { startDate, endDate, search } = filters;

        // Base filter for ledgers
        const ledgerWhere = {
            ...(search ? { name: { contains: search } } : {}),
            ...(startDate || endDate ? {
                createdAt: {
                    ...(startDate ? { gte: new Date(startDate) } : {}),
                    ...(endDate ? { lte: new Date(endDate) } : {})
                }
            } : {})
        };

        const groups = await prisma.accountgroup.findMany({
            where: { companyId },
            include: {
                accountsubgroup: {
                    include: {
                        ledger: {
                            where: { ...ledgerWhere },
                            include: { ledger: true }
                        }
                    }
                },
                ledger: {
                    where: { subGroupId: null, ...ledgerWhere },
                    include: { ledger: true }
                }
            },
            orderBy: { type: 'asc' }
        });

        // --- Fully Dynamic Balances ---
        // Use the single-pass aggregate helper so every ledger reflects
        // live transaction data. This replaces any stale DB currentBalance.
        const inventoryValue = await calculateInventoryValue(companyId);
        const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);

        const applyDynamic = (l) => {
            const entry = balanceMap.get(l.id);
            if (entry) l.currentBalance = entry.dynamicBalance;
        };

        groups.forEach(group => {
            group.ledger?.forEach(applyDynamic);
            group.accountsubgroup?.forEach(sub => sub.ledger?.forEach(applyDynamic));
        });

        return groups;
    } catch (error) {
        console.error('Error fetching COA:', error);
        throw error;
    }
};

// Create Account Group
const createAccountGroup = async (data) => {
    try {
        const group = await prisma.accountgroup.create({
            data: {
                name: data.name,
                type: data.type,
                companyId: data.companyId
            }
        });

        return group;
    } catch (error) {
        console.error('Error creating account group:', error);
        throw error;
    }
};

// Create Account Sub Group
const createAccountSubGroup = async (data) => {
    try {
        const subGroup = await prisma.accountsubgroup.create({
            data: {
                name: data.name,
                groupId: data.groupId,
                companyId: data.companyId
            }
        });

        return subGroup;
    } catch (error) {
        console.error('Error creating account sub group:', error);
        throw error;
    }
};

// Helper to map frontend account types to backend AccountGroup types
const resolveGroupType = (accountType) => {
    const typeMap = {
        'current_asset': 'ASSETS',
        'inventory_asset': 'ASSETS',
        'non_current_asset': 'ASSETS',
        'current_liability': 'LIABILITIES',
        'long_term_liability': 'LIABILITIES',
        'share_capital': 'LIABILITIES',
        'retained_earnings': 'LIABILITIES',
        'owners_equity': 'EQUITY',
        'sales_revenue': 'INCOME',
        'other_revenue': 'INCOME',
        'inventory_gain': 'INCOME',
        'cogs': 'EXPENSES',
        'payroll': 'EXPENSES',
        'general': 'EXPENSES'
    };
    return typeMap[accountType] || null;
};

// Create Ledger
const createLedger = async (data) => {
    try {
        let groupId = data.groupId;

        // Logic to automatically resolve groupId if not provided
        if (!groupId) {
            // Priority: Derive from Account Type (Parent Logic Removed by User Request)
            if (data.accountType) {
                const groupType = resolveGroupType(data.accountType);
                if (groupType) {
                    const group = await prisma.accountgroup.findFirst({
                        where: {
                            companyId: data.companyId,
                            type: groupType
                        }
                    });
                    if (group) {
                        groupId = group.id;
                    } else {
                        console.log(`Debug COA: Group not found. CompanyID: ${data.companyId}, Type: ${groupType}`);
                        // Fallback: Try loose name match if enum types mismatched
                        const looseGroup = await prisma.accountgroup.findFirst({
                            where: { companyId: data.companyId, name: { contains: groupType === 'EXPENSES' ? 'Expense' : groupType } }
                        });
                        if (looseGroup) groupId = looseGroup.id;
                    }
                }
            }
        }

        if (!groupId) {
            throw new Error(`Could not resolve Account Group. Please provide valid Account Type. (Debug: Type=${data.accountType || 'None'})`);
        }

        const ledger = await prisma.ledger.create({
            data: {
                name: data.name,
                groupId: groupId,
                subGroupId: data.subGroupId,
                companyId: data.companyId,
                openingBalance: parseFloat(data.openingBalance || 0),
                currentBalance: parseFloat(data.openingBalance || 0),
                isControlAccount: data.isControlAccount || false,
                isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
                description: data.description,
                parentLedgerId: data.parentLedgerId ? parseInt(data.parentLedgerId) : null,
                date: data.date ? new Date(data.date) : new Date(),
                updatedAt: new Date()
            },
            include: { accountgroup: true }
        });

        // Accounting Logic: Professional systems balance Opening Balances against "Opening Balance Equity"
        const openingBal = parseFloat(data.openingBalance || 0);
        if (openingBal !== 0) {
            try {
                // Find or Create Opening Balance Equity ledger
                let obeLedger = await prisma.ledger.findFirst({
                    where: { companyId: data.companyId, name: 'Opening Balance Equity' }
                });

                if (!obeLedger) {
                    const equityGroup = await prisma.accountgroup.findFirst({ where: { companyId: data.companyId, type: 'EQUITY' } });
                    if (equityGroup) {
                        obeLedger = await prisma.ledger.create({
                            data: {
                                name: 'Opening Balance Equity',
                                groupId: equityGroup.id,
                                companyId: data.companyId,
                                isControlAccount: true
                            }
                        });
                    }
                }

                if (obeLedger) {
                    const isDrNormal = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);

                    await prisma.transaction.create({
                        data: {
                            date: data.date ? new Date(data.date) : new Date(),
                            amount: Math.abs(openingBal),
                            debitLedgerId: isDrNormal ? ledger.id : obeLedger.id,
                            creditLedgerId: isDrNormal ? obeLedger.id : ledger.id,
                            voucherType: 'JOURNAL',
                            voucherNumber: `OB-${ledger.id}`,
                            narration: `Opening Balance for ${ledger.name}`,
                            companyId: data.companyId
                        }
                    });

                    // Update OBE balance
                    const obeChange = isDrNormal ? -openingBal : openingBal;
                    await prisma.ledger.update({
                        where: { id: obeLedger.id },
                        data: { currentBalance: { increment: obeChange } }
                    });
                }
            } catch (obeError) {
                console.error('Failed to create opening balance entry:', obeError);
            }
        }

        return ledger;

    } catch (error) {
        console.error('Error creating ledger:', error);
        throw error;
    }
};

// Get Ledger by ID
const getLedgerById = async (id, companyId) => {
    try {
        // Auto-cleanup stale opening-stock transactions before reading
        await cleanupStaleOpeningStockTransactions(companyId);

        const ledger = await prisma.ledger.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                accountgroup: true,
                accountsubgroup: true,
                ledger: true,
                other_ledger: true,
                transaction_transaction_creditLedgerIdToledger: {
                    include: {
                        ledger_transaction_creditLedgerIdToledger: true
                    }
                },
                transaction_transaction_debitLedgerIdToledger: {
                    include: {
                        ledger_transaction_debitLedgerIdToledger: true
                    }
                }
            }
        });

        // Apply fully-dynamic balance using single-pass aggregate
        if (ledger) {
            const inventoryValue = await calculateInventoryValue(companyId);
            const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);
            const entry = balanceMap.get(ledger.id);
            if (entry) ledger.currentBalance = entry.dynamicBalance;
        }

        return ledger;
    } catch (error) {
        console.error('Error fetching ledger:', error);
        throw error;
    }
};

// Get Ledger Transactions
const getLedgerTransactions = async (ledgerId, companyId) => {
    try {
        // Auto-cleanup stale opening-stock transactions before reading
        await cleanupStaleOpeningStockTransactions(companyId);

        const transactions = await prisma.transaction.findMany({
            where: {
                companyId: companyId,
                OR: [
                    { debitLedgerId: parseInt(ledgerId) },
                    { creditLedgerId: parseInt(ledgerId) }
                ]
            },
            include: {
                ledger_transaction_debitLedgerIdToledger: true,
                ledger_transaction_creditLedgerIdToledger: true,
                invoice: {
                    include: {
                        customer: {
                            select: { id: true, name: true, nameArabic: true, phone: true, email: true }
                        }
                    }
                },
                purchasebill: {
                    include: {
                        vendor: {
                            select: { id: true, name: true, nameArabic: true, phone: true, email: true }
                        }
                    }
                },
                receipt: {
                    include: {
                        customer: {
                            select: { id: true, name: true, nameArabic: true, phone: true, email: true }
                        }
                    }
                },
                payment: {
                    include: {
                        vendor: {
                            select: { id: true, name: true, nameArabic: true, phone: true, email: true }
                        }
                    }
                },
                posinvoice: {
                    include: {
                        customer: {
                            select: { id: true, name: true, nameArabic: true, phone: true, email: true }
                        }
                    }
                },
                journalentry: true
            },
            orderBy: { date: 'desc' }
        });

        // Normalize relation fields to support frontend camelCase access
        const normalized = transactions.map(t => ({
            ...t,
            invoice: t.invoice ?? null,
            purchaseBill: t.purchasebill ?? t.purchaseBill ?? null,
            receipt: t.receipt ?? null,
            payment: t.payment ?? null,
            posInvoice: t.posinvoice ?? null,
            journalEntry: t.journalentry ?? null,
            debitLedger: t.ledger_transaction_debitLedgerIdToledger ?? null,
            creditLedger: t.ledger_transaction_creditLedgerIdToledger ?? null
        }));

        // Dynamic adjustment for Opening Balance Equity and Retained Earnings to match Chart of Accounts
        const inventoryValue = await calculateInventoryValue(companyId);
        const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);
        const entry = balanceMap.get(parseInt(ledgerId));

        if (entry && (entry.isOBE || entry.isRetainedEarnings || entry.isInventory)) {
            const opening = entry.ledger.openingBalance || 0;
            let actualTxnDebit = 0;
            let actualTxnCredit = 0;
            normalized.forEach(t => {
                if (t.debitLedgerId === parseInt(ledgerId)) actualTxnDebit += t.amount || 0;
                if (t.creditLedgerId === parseInt(ledgerId)) actualTxnCredit += t.amount || 0;
            });

            const isDebitNormal = ['ASSETS', 'EXPENSES'].includes(entry.groupType);
            const actualBalance = isDebitNormal
                ? (opening + actualTxnDebit - actualTxnCredit)
                : (opening + actualTxnCredit - actualTxnDebit);

            const diff = entry.dynamicBalance - actualBalance;

            if (Math.abs(diff) > 0.01) {
                const isOBE = entry.isOBE;
                const isInventory = entry.isInventory;
                const adjustmentLedger = { name: isOBE ? 'Trial Balance Adjustment' : (isInventory ? 'Inventory Valuation Adjustment' : 'Income / Expense Summary') };

                let debitId, creditId;
                if (isDebitNormal) {
                    debitId = diff > 0 ? parseInt(ledgerId) : null;
                    creditId = diff < 0 ? parseInt(ledgerId) : null;
                } else {
                    debitId = diff < 0 ? parseInt(ledgerId) : null;
                    creditId = diff > 0 ? parseInt(ledgerId) : null;
                }

                normalized.push({
                    id: isOBE ? 999999 : (isInventory ? 999997 : 999998),
                    date: new Date(),
                    amount: Math.abs(diff),
                    debitLedgerId: debitId,
                    creditLedgerId: creditId,
                    voucherType: 'JOURNAL',
                    voucherNumber: isOBE ? 'BAL-ADJ' : (isInventory ? 'BAL-ADJ' : 'NET-PROFIT'),
                    narration: isOBE
                        ? 'Opening Balance Equity - Balancing Adjustment'
                        : (isInventory
                            ? 'Inventory Valuation - Balancing Adjustment'
                            : 'Retained Earnings - Net Profit/Loss for Period'),
                    companyId: companyId,
                    debitLedger: debitId === parseInt(ledgerId) ? entry.ledger : adjustmentLedger,
                    creditLedger: creditId === parseInt(ledgerId) ? entry.ledger : adjustmentLedger
                });
            }
        }

        return normalized;
    } catch (error) {
        console.error('Error fetching ledger transactions:', error);
        throw error;
    }
};

// Update Ledger Balance
const updateLedgerBalance = async (ledgerId, amount, isDebit) => {
    try {
        const ledger = await prisma.ledger.findUnique({
            where: { id: ledgerId }
        });

        const newBalance = isDebit
            ? ledger.currentBalance + amount
            : ledger.currentBalance - amount;

        await prisma.ledger.update({
            where: { id: ledgerId },
            data: { currentBalance: newBalance, updatedAt: new Date() }
        });

        return newBalance;
    } catch (error) {
        console.error('Error updating ledger balance:', error);
        throw error;
    }
};

// Get Account Group by ID
const getAccountGroupById = async (id, companyId) => {
    try {
        const group = await prisma.accountgroup.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                accountsubgroup: {
                    include: {
                        ledger: true
                    }
                },
                ledger: {
                    where: {
                        subGroupId: null
                    }
                }
            }
        });

        return group;
    } catch (error) {
        console.error('Error fetching account group:', error);
        throw error;
    }
};

// Update Account Group
const updateAccountGroup = async (id, companyId, data) => {
    try {
        const group = await prisma.accountgroup.updateMany({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            data: {
                name: data.name,
                type: data.type,
                updatedAt: new Date()
            }
        });

        if (group.count === 0) {
            throw new Error('Account group not found or no changes made');
        }

        return await prisma.accountgroup.findUnique({
            where: { id: parseInt(id) }
        });
    } catch (error) {
        console.error('Error updating account group:', error);
        throw error;
    }
};

// Delete Account Group
const deleteAccountGroup = async (id, companyId) => {
    try {
        const result = await prisma.accountgroup.deleteMany({
            where: {
                id: parseInt(id),
                companyId: companyId
            }
        });

        if (result.count === 0) {
            throw new Error('Account group not found');
        }

        return true;
    } catch (error) {
        console.error('Error deleting account group:', error);
        throw error;
    }
};

// Get Account Sub Group by ID
const getAccountSubGroupById = async (id, companyId) => {
    try {
        const subGroup = await prisma.accountsubgroup.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                accountgroup: true,
                ledger: true
            }
        });

        return subGroup;
    } catch (error) {
        console.error('Error fetching account sub-group:', error);
        throw error;
    }
};

// Update Account Sub Group
const updateAccountSubGroup = async (id, companyId, data) => {
    try {
        const subGroup = await prisma.accountsubgroup.updateMany({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            data: {
                name: data.name,
                groupId: parseInt(data.groupId),
                updatedAt: new Date()
            }
        });

        if (subGroup.count === 0) {
            throw new Error('Account sub-group not found or no changes made');
        }

        return await prisma.accountsubgroup.findUnique({
            where: { id: parseInt(id) },
            include: { accountgroup: true }
        });
    } catch (error) {
        console.error('Error updating account sub-group:', error);
        throw error;
    }
};

// Delete Account Sub Group
const deleteAccountSubGroup = async (id, companyId) => {
    try {
        const result = await prisma.accountsubgroup.deleteMany({
            where: {
                id: parseInt(id),
                companyId: companyId
            }
        });

        if (result.count === 0) {
            throw new Error('Account sub-group not found');
        }

        return true;
    } catch (error) {
        console.error('Error deleting account sub-group:', error);
        throw error;
    }
};

// Get All Ledgers
const getAllLedgers = async (companyId) => {
    try {
        // Auto-cleanup stale opening-stock transactions before reading
        await cleanupStaleOpeningStockTransactions(companyId);

        const ledgers = await prisma.ledger.findMany({
            where: { companyId },
            include: {
                accountgroup: true,
                accountsubgroup: true,
                ledger: true
            },
            orderBy: { name: 'asc' }
        });

        // Apply fully-dynamic balances using single-pass aggregate
        const inventoryValue = await calculateInventoryValue(companyId);
        const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);

        return ledgers.map(l => {
            const entry = balanceMap.get(l.id);
            return entry ? { ...l, currentBalance: entry.dynamicBalance } : l;
        });
    } catch (error) {
        console.error('Error fetching ledgers:', error);
        throw error;
    }
};

// Update Ledger
const updateLedger = async (id, companyId, data) => {
    try {
        const ledger = await prisma.ledger.updateMany({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            data: {
                name: data.name,
                groupId: data.groupId,
                subGroupId: data.subGroupId,
                openingBalance: data.openingBalance,
                isControlAccount: data.isControlAccount,
                isEnabled: data.isEnabled,
                description: data.description,
                parentLedgerId: data.parentLedgerId ? parseInt(data.parentLedgerId) : null,
                date: data.date ? new Date(data.date) : undefined,
                updatedAt: new Date()
            }
        });

        if (ledger.count === 0) {
            throw new Error('Ledger not found or no changes made');
        }

        return await prisma.ledger.findUnique({
            where: { id: parseInt(id) },
            include: {
                accountgroup: true,
                accountsubgroup: true,
                ledger: true
            }
        });
    } catch (error) {
        console.error('Error updating ledger:', error);
        throw error;
    }
};

// Delete Ledger
const deleteLedger = async (id, companyId) => {
    try {
        const ledgerId = parseInt(id);

        // Fetch the ledger first to see if it is linked to a customer or vendor
        const ledger = await prisma.ledger.findFirst({
            where: {
                id: ledgerId,
                companyId: companyId
            }
        });

        if (!ledger) {
            throw new Error('Ledger not found');
        }

        // 1. Check for associated transactions
        const transactionCount = await prisma.transaction.count({
            where: {
                companyId: companyId,
                OR: [
                    { debitLedgerId: ledgerId },
                    { creditLedgerId: ledgerId }
                ]
            }
        });

        if (transactionCount > 0) {
            throw new Error('Cannot delete account because it has associated transactions. Please delete the transactions first.');
        }

        // 2. Cascade delete linked customer or vendor if applicable
        if (ledger.customerId) {
            // Check for customer invoices
            const invoiceCount = await prisma.invoice.count({
                where: { customerId: ledger.customerId }
            });
            if (invoiceCount > 0) {
                throw new Error('Cannot delete customer account because this customer has associated invoices.');
            }
            await prisma.customer.delete({
                where: { id: ledger.customerId }
            });
            return true;
        }

        if (ledger.vendorId) {
            // Check for vendor purchase bills
            const billCount = await prisma.purchasebill.count({
                where: { vendorId: ledger.vendorId }
            });
            if (billCount > 0) {
                throw new Error('Cannot delete vendor account because this vendor has associated purchase bills.');
            }
            await prisma.vendor.delete({
                where: { id: ledger.vendorId }
            });
            return true;
        }

        // 3. Fallback to normal ledger deletion
        const result = await prisma.ledger.deleteMany({
            where: {
                id: ledgerId,
                companyId: companyId
            }
        });

        if (result.count === 0) {
            throw new Error('Ledger not found');
        }

        return true;
    } catch (error) {
        console.error('Error deleting ledger:', error);
        throw error;
    }
};

module.exports = {
    initializeChartOfAccounts,
    getChartOfAccounts,
    createAccountGroup,
    createAccountSubGroup,
    createLedger,
    getLedgerById,
    getLedgerTransactions,
    updateLedgerBalance,
    getAccountGroupById,
    updateAccountGroup,
    deleteAccountGroup,
    getAccountSubGroupById,
    updateAccountSubGroup,
    deleteAccountSubGroup,
    getAllLedgers,
    updateLedger,
    deleteLedger,
    calculateInventoryValue,
    calculateDynamicLedgerBalances
};







// const prisma = require('../config/prisma');

// const calculateInventoryValue = async (companyId) => {
//     try {
//         const stocks = await prisma.stock.findMany({
//             where: { product: { companyId: parseInt(companyId) } },
//             include: { product: true }
//         });

//         let totalValue = 0;
//         stocks.forEach(s => {
//             const price = s.product.purchasePrice || s.product.initialCost || 0;
//             totalValue += (s.quantity * price);
//         });
//         return totalValue;
//     } catch (error) {
//         console.error("Error calculating inventory value:", error);
//         return 0;
//     }
// };

// const calculateOpeningBalanceEquityValue = async (companyId, inventoryValue) => {
//     try {
//         const ledgers = await prisma.ledger.findMany({
//             where: { companyId: parseInt(companyId) },
//             include: { accountgroup: true }
//         });

//         let totalCredits = 0;
//         let totalDebits = 0;

//         ledgers.forEach(l => {
//             if (l.name.toLowerCase().includes('opening balance equity')) {
//                 return;
//             }

//             const type = l.accountgroup?.type;
//             let balance = l.currentBalance || 0;

//             if (l.name.toLowerCase().includes('inventory asset')) {
//                 balance = inventoryValue;
//             }

//             if (['ASSETS', 'EXPENSES'].includes(type)) {
//                 totalDebits += balance;
//             } else {
//                 totalCredits += balance;
//             }
//         });

//         return totalCredits - totalDebits;
//     } catch (error) {
//         console.error("Error calculating opening balance equity:", error);
//         return 0;
//     }
// };

// /**
//  * Automatic Self-Cleanup: scans the transaction table for any Opening Stock
//  * entries that reference products that no longer exist, deletes them, and
//  * reverses the stale ledger balance adjustments.
//  */
// const cleanupStaleOpeningStockTransactions = async (companyId) => {
//     try {
//         const companyIdInt = parseInt(companyId);

//         // Find all opening-stock accounting transactions
//         const openingStockTxns = await prisma.transaction.findMany({
//             where: {
//                 companyId: companyIdInt,
//                 narration: { startsWith: 'Opening Stock for Product:' }
//             }
//         });

//         if (openingStockTxns.length === 0) return;

//         // Get all current product names for this company
//         const products = await prisma.product.findMany({
//             where: { companyId: companyIdInt },
//             select: { name: true }
//         });
//         const productNames = new Set(products.map(p => p.name));

//         // Identify stale transactions (product no longer exists)
//         const staleTxns = openingStockTxns.filter(t => {
//             const productName = t.narration.replace('Opening Stock for Product: ', '').trim();
//             return !productNames.has(productName);
//         });

//         if (staleTxns.length === 0) return;

//         console.log(`[COA Cleanup] Found ${staleTxns.length} stale opening-stock transaction(s). Cleaning up...`);

//         // Find ledgers once
//         const inventoryAsset = await prisma.ledger.findFirst({
//             where: { companyId: companyIdInt, name: 'Inventory Asset' }
//         });
//         const openingEquity = await prisma.ledger.findFirst({
//             where: { companyId: companyIdInt, name: 'Opening Balance Equity' }
//         });

//         const totalStaleAmount = staleTxns.reduce((sum, t) => sum + (t.amount || 0), 0);

//         // Delete stale transactions
//         await prisma.transaction.deleteMany({
//             where: { id: { in: staleTxns.map(t => t.id) } }
//         });

//         // Only reverse the Inventory Asset balance (OBE is now transaction-based,
//         // so removing the transactions above already adjusts OBE automatically).
//         if (inventoryAsset && totalStaleAmount > 0) {
//             await prisma.ledger.update({
//                 where: { id: inventoryAsset.id },
//                 data: { currentBalance: { decrement: totalStaleAmount } }
//             });
//         }

//         console.log(`[COA Cleanup] Removed stale amount: ${totalStaleAmount}. Inventory Asset balance corrected.`);
//     } catch (error) {
//         // Non-fatal — log and continue
//         console.error('[COA Cleanup] Error during stale opening-stock cleanup:', error);
//     }
// };

// /**
//  * Calculate fully-dynamic balances for all ledgers using a single-pass
//  * groupBy aggregate on the transaction table.  Returns a Map keyed by
//  * ledger id whose value is { debitTotal, creditTotal, dynamicBalance }.
//  */
// const calculateDynamicLedgerBalances = async (companyId, inventoryValue) => {
//     try {
//         const companyIdInt = parseInt(companyId);

//         const ledgers = await prisma.ledger.findMany({
//             where: { companyId: companyIdInt },
//             include: { accountgroup: true }
//         });

//         // Single-pass aggregates
//         const [debitSums, creditSums] = await Promise.all([
//             prisma.transaction.groupBy({
//                 by: ['debitLedgerId'],
//                 where: { companyId: companyIdInt },
//                 _sum: { amount: true }
//             }),
//             prisma.transaction.groupBy({
//                 by: ['creditLedgerId'],
//                 where: { companyId: companyIdInt },
//                 _sum: { amount: true }
//             })
//         ]);

//         const debitMap = new Map(debitSums.map(d => [d.debitLedgerId, d._sum.amount || 0]));
//         const creditMap = new Map(creditSums.map(c => [c.creditLedgerId, c._sum.amount || 0]));

//         const balanceMap = new Map();

//         ledgers.forEach(l => {
//             const isInventory = l.name.toLowerCase().includes('inventory asset');
//             const groupType = l.accountgroup?.type;
//             const opening = l.openingBalance || 0;
//             const txnDebit = debitMap.get(l.id) || 0;
//             const txnCredit = creditMap.get(l.id) || 0;

//             let dynamicBalance;
//             if (isInventory) {
//                 // Override Inventory Asset with live stock quantity × cost value
//                 dynamicBalance = inventoryValue;
//             } else if (['ASSETS', 'EXPENSES'].includes(groupType)) {
//                 // Debit-normal accounts: Opening + Debits − Credits
//                 dynamicBalance = opening + txnDebit - txnCredit;
//             } else {
//                 // Credit-normal accounts (LIABILITIES, EQUITY including OBE, INCOME):
//                 // Opening + Credits − Debits
//                 // OBE is treated like any other equity account — based on actual
//                 // transactions only. This keeps it consistent with the Ledger view.
//                 dynamicBalance = opening + txnCredit - txnDebit;
//             }

//             balanceMap.set(l.id, {
//                 ledger: l,
//                 dynamicBalance,
//                 isInventory,
//                 groupType
//             });
//         });

//         return balanceMap;
//     } catch (error) {
//         console.error('[COA] Error calculating dynamic ledger balances:', error);
//         return new Map();
//     }
// };

// // Initialize Default Chart of Accounts for a Company
// const initializeChartOfAccounts = async (companyId) => {

//     try {
//         // 1. Verify Company exists
//         const company = await prisma.company.findUnique({
//             where: { id: companyId }
//         });

//         if (!company) {
//             return {
//                 success: false,
//                 message: `Company with ID ${companyId} not found. Please logout and login again.`
//             };
//         }

//         // 2. Check if already initialized (at least one group exists)
//         const existingGroups = await prisma.accountgroup.findFirst({
//             where: { companyId }
//         });

//         if (existingGroups) {
//             return {
//                 success: true,
//                 message: 'Chart of Accounts already initialized'
//             };
//         }

//         // --- Helper for creating groups, subgroups, and ledgers ---
//         const createCOA = async () => {
//             // 1. ASSETS
//             const assetsGroup = await prisma.accountgroup.create({
//                 data: { name: 'Assets', type: 'ASSETS', companyId }
//             });

//             const cashSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Cash', groupId: assetsGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Cash in Hand', groupId: assetsGroup.id, subGroupId: cashSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const bankSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Bank Accounts', groupId: assetsGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Main Bank Account', groupId: assetsGroup.id, subGroupId: bankSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const arSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Accounts Receivable', groupId: assetsGroup.id, companyId }
//             });

//             const inventorySub = await prisma.accountsubgroup.create({
//                 data: { name: 'Inventory', groupId: assetsGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Inventory Asset', groupId: assetsGroup.id, subGroupId: inventorySub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const fixedAssetsSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Fixed Assets', groupId: assetsGroup.id, companyId }
//             });

//             // 2. LIABILITIES
//             const liabilitiesGroup = await prisma.accountgroup.create({
//                 data: { name: 'Liabilities', type: 'LIABILITIES', companyId }
//             });

//             const apSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Accounts Payable', groupId: liabilitiesGroup.id, companyId }
//             });

//             const taxSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Duties & Taxes', groupId: liabilitiesGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'VAT / Sales Tax Payable', groupId: liabilitiesGroup.id, subGroupId: taxSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const loansSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Loans & Borrowings', groupId: liabilitiesGroup.id, companyId }
//             });

//             // 3. EQUITY
//             const equityGroup = await prisma.accountgroup.create({
//                 data: { name: 'Equity', type: 'EQUITY', companyId }
//             });

//             const capitalSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Share Capital', groupId: equityGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Owner Investment / Capital', groupId: equityGroup.id, subGroupId: capitalSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const equityItemsSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Equity Items', groupId: equityGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Opening Balance Equity', groupId: equityGroup.id, subGroupId: equityItemsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Retained Earnings', groupId: equityGroup.id, subGroupId: equityItemsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             // 4. INCOME
//             const incomeGroup = await prisma.accountgroup.create({
//                 data: { name: 'Income', type: 'INCOME', companyId }
//             });

//             const salesSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Sales Income', groupId: incomeGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Sales Revenue', groupId: incomeGroup.id, subGroupId: salesSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const otherIncomeSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Other Income', groupId: incomeGroup.id, companyId }
//             });
//             // Discount Received on Purchase → INCOME (vendor gives us discount)
//             await prisma.ledger.create({
//                 data: { name: 'Discount Received on Purchase', groupId: incomeGroup.id, subGroupId: otherIncomeSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             // 5. EXPENSES
//             const expensesGroup = await prisma.accountgroup.create({
//                 data: { name: 'Expenses', type: 'EXPENSES', companyId }
//             });

//             const cogsSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Direct Expenses / COGS', groupId: expensesGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Cost of Goods Sold', groupId: expensesGroup.id, subGroupId: cogsSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });

//             const operatingSub = await prisma.accountsubgroup.create({
//                 data: { name: 'Operating Expenses', groupId: expensesGroup.id, companyId }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Rent Expense', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Electricity & Utilities', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Salary & Wages', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//             await prisma.ledger.create({
//                 data: { name: 'Inventory Adjustment Expense', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//             // Discount Allowed on Sale → EXPENSES (we give customer a discount)
//             await prisma.ledger.create({
//                 data: { name: 'Discount Allowed on Sale', groupId: expensesGroup.id, subGroupId: operatingSub.id, companyId, openingBalance: 0, currentBalance: 0 }
//             });
//         };

//         await createCOA();

//         return {
//             success: true,
//             message: 'Professional Chart of Accounts initialized successfully'
//         };
//     } catch (error) {
//         console.error('Error initializing COA:', error);
//         throw error;
//     }
// };


// // Get Chart of Accounts
// const getChartOfAccounts = async (companyId, filters = {}) => {
//     try {
//         // Auto-cleanup stale opening-stock transactions before reading
//         await cleanupStaleOpeningStockTransactions(companyId);

//         const { startDate, endDate, search } = filters;

//         // Base filter for ledgers
//         const ledgerWhere = {
//             ...(search ? { name: { contains: search } } : {}),
//             ...(startDate || endDate ? {
//                 createdAt: {
//                     ...(startDate ? { gte: new Date(startDate) } : {}),
//                     ...(endDate ? { lte: new Date(endDate) } : {})
//                 }
//             } : {})
//         };

//         const groups = await prisma.accountgroup.findMany({
//             where: { companyId },
//             include: {
//                 accountsubgroup: {
//                     include: {
//                         ledger: {
//                             where: { ...ledgerWhere },
//                             include: { ledger: true }
//                         }
//                     }
//                 },
//                 ledger: {
//                     where: { subGroupId: null, ...ledgerWhere },
//                     include: { ledger: true }
//                 }
//             },
//             orderBy: { type: 'asc' }
//         });

//         // --- Fully Dynamic Balances ---
//         // Use the single-pass aggregate helper so every ledger reflects
//         // live transaction data. This replaces any stale DB currentBalance.
//         const inventoryValue = await calculateInventoryValue(companyId);
//         const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);

//         const applyDynamic = (l) => {
//             const entry = balanceMap.get(l.id);
//             if (entry) l.currentBalance = entry.dynamicBalance;
//         };

//         groups.forEach(group => {
//             group.ledger?.forEach(applyDynamic);
//             group.accountsubgroup?.forEach(sub => sub.ledger?.forEach(applyDynamic));
//         });

//         return groups;
//     } catch (error) {
//         console.error('Error fetching COA:', error);
//         throw error;
//     }
// };

// // Create Account Group
// const createAccountGroup = async (data) => {
//     try {
//         const group = await prisma.accountgroup.create({
//             data: {
//                 name: data.name,
//                 type: data.type,
//                 companyId: data.companyId
//             }
//         });

//         return group;
//     } catch (error) {
//         console.error('Error creating account group:', error);
//         throw error;
//     }
// };

// // Create Account Sub Group
// const createAccountSubGroup = async (data) => {
//     try {
//         const subGroup = await prisma.accountsubgroup.create({
//             data: {
//                 name: data.name,
//                 groupId: data.groupId,
//                 companyId: data.companyId
//             }
//         });

//         return subGroup;
//     } catch (error) {
//         console.error('Error creating account sub group:', error);
//         throw error;
//     }
// };

// // Helper to map frontend account types to backend AccountGroup types
// const resolveGroupType = (accountType) => {
//     const typeMap = {
//         'current_asset': 'ASSETS',
//         'inventory_asset': 'ASSETS',
//         'non_current_asset': 'ASSETS',
//         'current_liability': 'LIABILITIES',
//         'long_term_liability': 'LIABILITIES',
//         'share_capital': 'LIABILITIES',
//         'retained_earnings': 'LIABILITIES',
//         'owners_equity': 'EQUITY',
//         'sales_revenue': 'INCOME',
//         'other_revenue': 'INCOME',
//         'inventory_gain': 'INCOME',
//         'cogs': 'EXPENSES',
//         'payroll': 'EXPENSES',
//         'general': 'EXPENSES'
//     };
//     return typeMap[accountType] || null;
// };

// // Create Ledger
// const createLedger = async (data) => {
//     try {
//         let groupId = data.groupId;

//         // Logic to automatically resolve groupId if not provided
//         if (!groupId) {
//             // Priority: Derive from Account Type (Parent Logic Removed by User Request)
//             if (data.accountType) {
//                 const groupType = resolveGroupType(data.accountType);
//                 if (groupType) {
//                     const group = await prisma.accountgroup.findFirst({
//                         where: {
//                             companyId: data.companyId,
//                             type: groupType
//                         }
//                     });
//                     if (group) {
//                         groupId = group.id;
//                     } else {
//                         console.log(`Debug COA: Group not found. CompanyID: ${data.companyId}, Type: ${groupType}`);
//                         // Fallback: Try loose name match if enum types mismatched
//                         const looseGroup = await prisma.accountgroup.findFirst({
//                             where: { companyId: data.companyId, name: { contains: groupType === 'EXPENSES' ? 'Expense' : groupType } }
//                         });
//                         if (looseGroup) groupId = looseGroup.id;
//                     }
//                 }
//             }
//         }

//         if (!groupId) {
//             throw new Error(`Could not resolve Account Group. Please provide valid Account Type. (Debug: Type=${data.accountType || 'None'})`);
//         }

//         const ledger = await prisma.ledger.create({
//             data: {
//                 name: data.name,
//                 groupId: groupId,
//                 subGroupId: data.subGroupId,
//                 companyId: data.companyId,
//                 openingBalance: parseFloat(data.openingBalance || 0),
//                 currentBalance: parseFloat(data.openingBalance || 0),
//                 isControlAccount: data.isControlAccount || false,
//                 isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
//                 description: data.description,
//                 parentLedgerId: data.parentLedgerId ? parseInt(data.parentLedgerId) : null,
//                 updatedAt: new Date()
//             },
//             include: { accountgroup: true }
//         });

//         // Accounting Logic: Professional systems balance Opening Balances against "Opening Balance Equity"
//         const openingBal = parseFloat(data.openingBalance || 0);
//         if (openingBal !== 0) {
//             try {
//                 // Find or Create Opening Balance Equity ledger
//                 let obeLedger = await prisma.ledger.findFirst({
//                     where: { companyId: data.companyId, name: 'Opening Balance Equity' }
//                 });

//                 if (!obeLedger) {
//                     const equityGroup = await prisma.accountgroup.findFirst({ where: { companyId: data.companyId, type: 'EQUITY' } });
//                     if (equityGroup) {
//                         obeLedger = await prisma.ledger.create({
//                             data: {
//                                 name: 'Opening Balance Equity',
//                                 groupId: equityGroup.id,
//                                 companyId: data.companyId,
//                                 isControlAccount: true
//                             }
//                         });
//                     }
//                 }

//                 if (obeLedger) {
//                     const isDrNormal = ['ASSETS', 'EXPENSES'].includes(ledger.accountgroup.type);
                    
//                     await prisma.transaction.create({
//                         data: {
//                             date: new Date(),
//                             amount: Math.abs(openingBal),
//                             debitLedgerId: isDrNormal ? ledger.id : obeLedger.id,
//                             creditLedgerId: isDrNormal ? obeLedger.id : ledger.id,
//                             voucherType: 'JOURNAL',
//                             voucherNumber: `OB-${ledger.id}`,
//                             narration: `Opening Balance for ${ledger.name}`,
//                             companyId: data.companyId
//                         }
//                     });

//                     // Update OBE balance
//                     const obeChange = isDrNormal ? -openingBal : openingBal;
//                     await prisma.ledger.update({
//                         where: { id: obeLedger.id },
//                         data: { currentBalance: { increment: obeChange } }
//                     });
//                 }
//             } catch (obeError) {
//                 console.error('Failed to create opening balance entry:', obeError);
//             }
//         }

//         return ledger;

//     } catch (error) {
//         console.error('Error creating ledger:', error);
//         throw error;
//     }
// };

// // Get Ledger by ID
// const getLedgerById = async (id, companyId) => {
//     try {
//         // Auto-cleanup stale opening-stock transactions before reading
//         await cleanupStaleOpeningStockTransactions(companyId);

//         const ledger = await prisma.ledger.findFirst({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             include: {
//                 accountgroup: true,
//                 accountsubgroup: true,
//                 ledger: true,
//                 other_ledger: true,
//                 transaction_transaction_creditLedgerIdToledger: {
//                     include: {
//                         ledger_transaction_creditLedgerIdToledger: true
//                     }
//                 },
//                 transaction_transaction_debitLedgerIdToledger: {
//                     include: {
//                         ledger_transaction_debitLedgerIdToledger: true
//                     }
//                 }
//             }
//         });

//         // Apply fully-dynamic balance using single-pass aggregate
//         if (ledger) {
//             const inventoryValue = await calculateInventoryValue(companyId);
//             const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);
//             const entry = balanceMap.get(ledger.id);
//             if (entry) ledger.currentBalance = entry.dynamicBalance;
//         }

//         return ledger;
//     } catch (error) {
//         console.error('Error fetching ledger:', error);
//         throw error;
//     }
// };

// // Get Ledger Transactions
// const getLedgerTransactions = async (ledgerId, companyId) => {
//     try {
//         // Auto-cleanup stale opening-stock transactions before reading
//         await cleanupStaleOpeningStockTransactions(companyId);

//         const transactions = await prisma.transaction.findMany({
//             where: {
//                 companyId: companyId,
//                 OR: [
//                     { debitLedgerId: parseInt(ledgerId) },
//                     { creditLedgerId: parseInt(ledgerId) }
//                 ]
//             },
//             include: {
//                 ledger_transaction_debitLedgerIdToledger: true,
//                 ledger_transaction_creditLedgerIdToledger: true,
//                 invoice: {
//                     include: {
//                         customer: {
//                             select: { id: true, name: true, nameArabic: true, phone: true, email: true }
//                         }
//                     }
//                 },
//                 purchasebill: {
//                     include: {
//                         vendor: {
//                             select: { id: true, name: true, nameArabic: true, phone: true, email: true }
//                         }
//                     }
//                 },
//                 receipt: {
//                     include: {
//                         customer: {
//                             select: { id: true, name: true, nameArabic: true, phone: true, email: true }
//                         }
//                     }
//                 },
//                 payment: {
//                     include: {
//                         vendor: {
//                             select: { id: true, name: true, nameArabic: true, phone: true, email: true }
//                         }
//                     }
//                 }
//             },
//             orderBy: { date: 'asc' }
//         });

//         // Normalize field names so frontend camelCase access works
//         // Prisma uses lowercase relation names (purchasebill) but frontend expects purchaseBill
//         const normalized = transactions.map(t => ({
//             ...t,
//             purchaseBill: t.purchasebill ?? t.purchaseBill ?? null,
//             debitLedger: t.ledger_transaction_debitLedgerIdToledger ?? null,
//             creditLedger: t.ledger_transaction_creditLedgerIdToledger ?? null,
//         }));

//         return normalized;
//     } catch (error) {
//         console.error('Error fetching ledger transactions:', error);
//         throw error;
//     }
// };

// // Update Ledger Balance
// const updateLedgerBalance = async (ledgerId, amount, isDebit) => {
//     try {
//         const ledger = await prisma.ledger.findUnique({
//             where: { id: ledgerId }
//         });

//         const newBalance = isDebit
//             ? ledger.currentBalance + amount
//             : ledger.currentBalance - amount;

//         await prisma.ledger.update({
//             where: { id: ledgerId },
//             data: { currentBalance: newBalance, updatedAt: new Date() }
//         });

//         return newBalance;
//     } catch (error) {
//         console.error('Error updating ledger balance:', error);
//         throw error;
//     }
// };

// // Get Account Group by ID
// const getAccountGroupById = async (id, companyId) => {
//     try {
//         const group = await prisma.accountgroup.findFirst({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             include: {
//                 accountsubgroup: {
//                     include: {
//                         ledger: true
//                     }
//                 },
//                 ledger: {
//                     where: {
//                         subGroupId: null
//                     }
//                 }
//             }
//         });

//         return group;
//     } catch (error) {
//         console.error('Error fetching account group:', error);
//         throw error;
//     }
// };

// // Update Account Group
// const updateAccountGroup = async (id, companyId, data) => {
//     try {
//         const group = await prisma.accountgroup.updateMany({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             data: {
//                 name: data.name,
//                 type: data.type,
//                 updatedAt: new Date()
//             }
//         });

//         if (group.count === 0) {
//             throw new Error('Account group not found or no changes made');
//         }

//         return await prisma.accountgroup.findUnique({
//             where: { id: parseInt(id) }
//         });
//     } catch (error) {
//         console.error('Error updating account group:', error);
//         throw error;
//     }
// };

// // Delete Account Group
// const deleteAccountGroup = async (id, companyId) => {
//     try {
//         const result = await prisma.accountgroup.deleteMany({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             }
//         });

//         if (result.count === 0) {
//             throw new Error('Account group not found');
//         }

//         return true;
//     } catch (error) {
//         console.error('Error deleting account group:', error);
//         throw error;
//     }
// };

// // Get Account Sub Group by ID
// const getAccountSubGroupById = async (id, companyId) => {
//     try {
//         const subGroup = await prisma.accountsubgroup.findFirst({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             include: {
//                 accountgroup: true,
//                 ledger: true
//             }
//         });

//         return subGroup;
//     } catch (error) {
//         console.error('Error fetching account sub-group:', error);
//         throw error;
//     }
// };

// // Update Account Sub Group
// const updateAccountSubGroup = async (id, companyId, data) => {
//     try {
//         const subGroup = await prisma.accountsubgroup.updateMany({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             data: {
//                 name: data.name,
//                 groupId: parseInt(data.groupId),
//                 updatedAt: new Date()
//             }
//         });

//         if (subGroup.count === 0) {
//             throw new Error('Account sub-group not found or no changes made');
//         }

//         return await prisma.accountsubgroup.findUnique({
//             where: { id: parseInt(id) },
//             include: { accountgroup: true }
//         });
//     } catch (error) {
//         console.error('Error updating account sub-group:', error);
//         throw error;
//     }
// };

// // Delete Account Sub Group
// const deleteAccountSubGroup = async (id, companyId) => {
//     try {
//         const result = await prisma.accountsubgroup.deleteMany({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             }
//         });

//         if (result.count === 0) {
//             throw new Error('Account sub-group not found');
//         }

//         return true;
//     } catch (error) {
//         console.error('Error deleting account sub-group:', error);
//         throw error;
//     }
// };

// // Get All Ledgers
// const getAllLedgers = async (companyId) => {
//     try {
//         // Auto-cleanup stale opening-stock transactions before reading
//         await cleanupStaleOpeningStockTransactions(companyId);

//         const ledgers = await prisma.ledger.findMany({
//             where: { companyId },
//             include: {
//                 accountgroup: true,
//                 accountsubgroup: true,
//                 ledger: true
//             },
//             orderBy: { name: 'asc' }
//         });

//         // Apply fully-dynamic balances using single-pass aggregate
//         const inventoryValue = await calculateInventoryValue(companyId);
//         const balanceMap = await calculateDynamicLedgerBalances(companyId, inventoryValue);

//         return ledgers.map(l => {
//             const entry = balanceMap.get(l.id);
//             return entry ? { ...l, currentBalance: entry.dynamicBalance } : l;
//         });
//     } catch (error) {
//         console.error('Error fetching ledgers:', error);
//         throw error;
//     }
// };

// // Update Ledger
// const updateLedger = async (id, companyId, data) => {
//     try {
//         const ledger = await prisma.ledger.updateMany({
//             where: {
//                 id: parseInt(id),
//                 companyId: companyId
//             },
//             data: {
//                 name: data.name,
//                 groupId: data.groupId,
//                 subGroupId: data.subGroupId,
//                 openingBalance: data.openingBalance,
//                 isControlAccount: data.isControlAccount,
//                 isEnabled: data.isEnabled,
//                 description: data.description,
//                 parentLedgerId: data.parentLedgerId ? parseInt(data.parentLedgerId) : null,
//                 updatedAt: new Date()
//             }
//         });

//         if (ledger.count === 0) {
//             throw new Error('Ledger not found or no changes made');
//         }

//         return await prisma.ledger.findUnique({
//             where: { id: parseInt(id) },
//             include: {
//                 accountgroup: true,
//                 accountsubgroup: true,
//                 ledger: true
//             }
//         });
//     } catch (error) {
//         console.error('Error updating ledger:', error);
//         throw error;
//     }
// };

// // Delete Ledger
// const deleteLedger = async (id, companyId) => {
//     try {
//         const ledgerId = parseInt(id);

//         // Fetch the ledger first to see if it is linked to a customer or vendor
//         const ledger = await prisma.ledger.findFirst({
//             where: {
//                 id: ledgerId,
//                 companyId: companyId
//             }
//         });

//         if (!ledger) {
//             throw new Error('Ledger not found');
//         }

//         // 1. Check for associated transactions
//         const transactionCount = await prisma.transaction.count({
//             where: {
//                 companyId: companyId,
//                 OR: [
//                     { debitLedgerId: ledgerId },
//                     { creditLedgerId: ledgerId }
//                 ]
//             }
//         });

//         if (transactionCount > 0) {
//             throw new Error('Cannot delete account because it has associated transactions. Please delete the transactions first.');
//         }

//         // 2. Cascade delete linked customer or vendor if applicable
//         if (ledger.customerId) {
//             // Check for customer invoices
//             const invoiceCount = await prisma.invoice.count({
//                 where: { customerId: ledger.customerId }
//             });
//             if (invoiceCount > 0) {
//                 throw new Error('Cannot delete customer account because this customer has associated invoices.');
//             }
//             await prisma.customer.delete({
//                 where: { id: ledger.customerId }
//             });
//             return true;
//         }

//         if (ledger.vendorId) {
//             // Check for vendor purchase bills
//             const billCount = await prisma.purchasebill.count({
//                 where: { vendorId: ledger.vendorId }
//             });
//             if (billCount > 0) {
//                 throw new Error('Cannot delete vendor account because this vendor has associated purchase bills.');
//             }
//             await prisma.vendor.delete({
//                 where: { id: ledger.vendorId }
//             });
//             return true;
//         }

//         // 3. Fallback to normal ledger deletion
//         const result = await prisma.ledger.deleteMany({
//             where: {
//                 id: ledgerId,
//                 companyId: companyId
//             }
//         });

//         if (result.count === 0) {
//             throw new Error('Ledger not found');
//         }

//         return true;
//     } catch (error) {
//         console.error('Error deleting ledger:', error);
//         throw error;
//     }
// };

// module.exports = {
//     initializeChartOfAccounts,
//     getChartOfAccounts,
//     createAccountGroup,
//     createAccountSubGroup,
//     createLedger,
//     getLedgerById,
//     getLedgerTransactions,
//     updateLedgerBalance,
//     getAccountGroupById,
//     updateAccountGroup,
//     deleteAccountGroup,
//     getAccountSubGroupById,
//     updateAccountSubGroup,
//     deleteAccountSubGroup,
//     getAllLedgers,
//     updateLedger,
//     deleteLedger
// };
