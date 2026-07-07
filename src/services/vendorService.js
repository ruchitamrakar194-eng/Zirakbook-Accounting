const prisma = require('../config/prisma');
const { getConversionRate, getCompanyCurrency, getCompanyHistoricalCurrency } = require('../utils/currencyConverter');

// Create Vendor with Auto-Ledger Creation
const createVendor = async (data) => {
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Find Accounts Payable subgroup
            const accountsPayableSubGroup = await tx.accountSubGroup.findFirst({
                where: {
                    companyId: data.companyId,
                    name: 'Accounts Payable'
                },
                include: {
                    group: true
                }
            });

            if (!accountsPayableSubGroup) {
                throw new Error('Accounts Payable subgroup not found. Please initialize Chart of Accounts first.');
            }

            // Create Vendor
            const vendor = await tx.vendor.create({
                data: {
                    name: data.name,
                    companyName: data.companyName,
                    email: data.email,
                    phone: data.phone,
                    address: data.address,
                    gstNumber: data.gstNumber,
                    companyId: data.companyId
                }
            });

            const ledger = await tx.ledger.create({
                data: {
                    name: data.name,
                    groupId: accountsPayableSubGroup.groupId,
                    subGroupId: accountsPayableSubGroup.id,
                    companyId: data.companyId,
                    openingBalance: data.openingBalance || 0,
                    currentBalance: data.openingBalance || 0,
                    isControlAccount: false,
                    vendorId: vendor.id
                }
            });

            const openingBal = parseFloat(data.openingBalance || 0);
            if (openingBal !== 0) {
                let obeLedger = await tx.ledger.findFirst({
                    where: { companyId: data.companyId, name: 'Opening Balance Equity' }
                });

                if (!obeLedger) {
                    const equityGroup = await tx.accountgroup.findFirst({
                        where: { companyId: data.companyId, type: 'EQUITY' }
                    });
                    if (equityGroup) {
                        obeLedger = await tx.ledger.create({
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
                    const isDrNormal = ['ASSETS', 'EXPENSES'].includes(accountsPayableSubGroup.group?.type || 'ASSETS');
                    await tx.transaction.create({
                        data: {
                            date: new Date(),
                            amount: Math.abs(openingBal),
                            debitLedgerId: isDrNormal ? ledger.id : obeLedger.id,
                            creditLedgerId: isDrNormal ? obeLedger.id : ledger.id,
                            voucherType: 'JOURNAL',
                            voucherNumber: `OB-${ledger.id}`,
                            narration: `Opening Balance for ${ledger.name}`,
                            companyId: data.companyId
                        }
                    });
                }
            }

            // Update vendor with ledger ID
            const updatedVendor = await tx.vendor.update({
                where: { id: vendor.id },
                data: { ledgerId: ledger.id },
                include: {
                    ledger: true
                }
            });

            return updatedVendor;
        });

        return result;
    } catch (error) {
        console.error('Error creating vendor:', error);
        throw error;
    }
};

// Get All Vendors
const getVendors = async (companyId) => {
    try {
        const vendors = await prisma.vendor.findMany({
            where: { companyId },
            include: {
                shippingaddress: true,
                ledger: {
                    select: {
                        id: true,
                        name: true,
                        currentBalance: true
                    }
                },
                purchaseBills: {
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

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        return vendors.map(v => {
            if (v.ledger) {
                v.ledger.currentBalance = (v.ledger.currentBalance || 0) * rate;
            }
            if (v.purchaseBills) {
                v.purchaseBills = v.purchaseBills.map(b => ({
                    ...b,
                    totalAmount: (b.totalAmount || 0) * rate,
                    balanceAmount: (b.balanceAmount || 0) * rate
                }));
            }
            return v;
        });
    } catch (error) {
        console.error('Error fetching vendors:', error);
        throw error;
    }
};

// Get Vendor by ID
const getVendorById = async (id, companyId) => {
    try {
        const vendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(id),
                companyId: companyId
            },
            include: {
                ledger: {
                    include: {
                        group: true,
                        subGroup: true
                    }
                },
                purchaseBills: {
                    include: {
                        items: true
                    },
                    orderBy: { date: 'desc' }
                },
                payments: {
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (vendor) {
            const companyCurrency = await getCompanyCurrency(companyId);
            const histCurr = await getCompanyHistoricalCurrency(companyId);
            const rate = await getConversionRate(histCurr, companyCurrency);

            if (vendor.ledger) {
                vendor.ledger.currentBalance = (vendor.ledger.currentBalance || 0) * rate;
            }
            if (vendor.purchaseBills) {
                vendor.purchaseBills = vendor.purchaseBills.map(b => ({
                    ...b,
                    totalAmount: (b.totalAmount || 0) * rate,
                    balanceAmount: (b.balanceAmount || 0) * rate
                }));
            }
        }

        return vendor;
    } catch (error) {
        console.error('Error fetching vendor:', error);
        throw error;
    }
};

// Update Vendor
const updateVendor = async (id, data) => {
    try {
        const vendor = await prisma.vendor.update({
            where: { id: parseInt(id) },
            data: {
                name: data.name,
                companyName: data.companyName,
                email: data.email,
                phone: data.phone,
                address: data.address,
                gstNumber: data.gstNumber
            },
            include: {
                ledger: true
            }
        });

        // Update ledger name if vendor name changed
        if (data.name && vendor.ledgerId) {
            await prisma.ledger.update({
                where: { id: vendor.ledgerId },
                data: { name: data.name }
            });
        }

        return vendor;
    } catch (error) {
        console.error('Error updating vendor:', error);
        throw error;
    }
};

// Delete Vendor
const deleteVendor = async (id) => {
    try {
        // Check if vendor has any purchase bills
        const billCount = await prisma.purchaseBill.count({
            where: { vendorId: parseInt(id) }
        });

        if (billCount > 0) {
            throw new Error('Cannot delete vendor with existing purchase bills');
        }

        // Delete vendor (ledger will be deleted via cascade)
        await prisma.vendor.delete({
            where: { id: parseInt(id) }
        });

        return { success: true, message: 'Vendor deleted successfully' };
    } catch (error) {
        console.error('Error deleting vendor:', error);
        throw error;
    }
};

// Get Vendor Ledger
const getVendorLedger = async (vendorId, companyId) => {
    try {
        const vendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(vendorId),
                companyId: companyId
            },
            include: {
                ledger: {
                    include: {
                        debitTransactions: {
                            include: {
                                creditLedger: true,
                                payment: true
                            },
                            orderBy: { date: 'desc' }
                        },
                        creditTransactions: {
                            include: {
                                debitLedger: true,
                                purchaseBill: true
                            },
                            orderBy: { date: 'desc' }
                        }
                    }
                }
            }
        });

        if (!vendor || !vendor.ledger) {
            throw new Error('Vendor ledger not found');
        }

        // Combine and sort all transactions
        const allTransactions = [
            ...vendor.ledger.debitTransactions.map(t => ({
                ...t,
                type: 'debit',
                particulars: t.creditLedger.name,
                debit: t.amount,
                credit: 0
            })),
            ...vendor.ledger.creditTransactions.map(t => ({
                ...t,
                type: 'credit',
                particulars: t.debitLedger.name,
                debit: 0,
                credit: t.amount
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate running balance
        let balance = vendor.ledger.openingBalance;
        const transactionsWithBalance = allTransactions.map(t => {
            balance = balance + t.debit - t.credit;
            return {
                ...t,
                balance: balance
            };
        });

        return {
            vendor: {
                id: vendor.id,
                name: vendor.name,
                companyName: vendor.companyName
            },
            ledger: {
                id: vendor.ledger.id,
                name: vendor.ledger.name,
                openingBalance: vendor.ledger.openingBalance,
                currentBalance: vendor.ledger.currentBalance
            },
            transactions: transactionsWithBalance
        };
    } catch (error) {
        console.error('Error fetching vendor ledger:', error);
        throw error;
    }
};

// Get Vendor Outstanding
const getVendorOutstanding = async (vendorId, companyId) => {
    try {
        const vendor = await prisma.vendor.findFirst({
            where: {
                id: parseInt(vendorId),
                companyId: companyId
            },
            include: {
                ledger: true,
                purchaseBills: {
                    where: {
                        status: {
                            in: ['UNPAID', 'PARTIAL']
                        }
                    },
                    select: {
                        id: true,
                        billNumber: true,
                        date: true,
                        dueDate: true,
                        totalAmount: true,
                        paidAmount: true,
                        balanceAmount: true,
                        status: true
                    },
                    orderBy: { date: 'asc' }
                }
            }
        });

        if (!vendor) {
            throw new Error('Vendor not found');
        }

        const totalOutstanding = vendor.purchaseBills.reduce((sum, bill) => sum + bill.balanceAmount, 0);

        return {
            vendor: {
                id: vendor.id,
                name: vendor.name,
                companyName: vendor.companyName
            },
            ledgerBalance: vendor.ledger?.currentBalance || 0,
            totalOutstanding: totalOutstanding,
            outstandingBills: vendor.purchaseBills
        };
    } catch (error) {
        console.error('Error fetching vendor outstanding:', error);
        throw error;
    }
};

module.exports = {
    createVendor,
    getVendors,
    getVendorById,
    updateVendor,
    deleteVendor,
    getVendorLedger,
    getVendorOutstanding
};
