const prisma = require('../config/prisma');
const { getConversionRate, getCompanyCurrency, getCompanyHistoricalCurrency } = require('../utils/currencyConverter');

// Create Customer with Auto-Ledger Creation
const createCustomer = async (data) => {
    try {
        // Start a transaction to ensure atomicity
        const result = await prisma.$transaction(async (tx) => {
            // Find Accounts Receivable subgroup
            const accountsReceivableSubGroup = await tx.accountSubGroup.findFirst({
                where: {
                    companyId: data.companyId,
                    name: 'Accounts Receivable'
                },
                include: {
                    group: true
                }
            });

            if (!accountsReceivableSubGroup) {
                throw new Error('Accounts Receivable subgroup not found. Please initialize Chart of Accounts first.');
            }

            // Create Customer
            const customer = await tx.customer.create({
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
                    groupId: accountsReceivableSubGroup.groupId,
                    subGroupId: accountsReceivableSubGroup.id,
                    companyId: data.companyId,
                    openingBalance: data.openingBalance || 0,
                    currentBalance: data.openingBalance || 0,
                    isControlAccount: false,
                    customerId: customer.id
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
                    const isDrNormal = ['ASSETS', 'EXPENSES'].includes(accountsReceivableSubGroup.group?.type || 'ASSETS');
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

            // Update customer with ledger ID
            const updatedCustomer = await tx.customer.update({
                where: { id: customer.id },
                data: { ledgerId: ledger.id },
                include: {
                    ledger: true
                }
            });

            return updatedCustomer;
        });

        return result;
    } catch (error) {
        console.error('Error creating customer:', error);
        throw error;
    }
};

// Get All Customers
const getCustomers = async (companyId) => {
    try {
        const customers = await prisma.customer.findMany({
            where: { companyId },
            include: {
                ledger: {
                    select: {
                        id: true,
                        name: true,
                        currentBalance: true
                    }
                },
                invoices: {
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

        const companyCurrency = await getCompanyCurrency(companyId);
        const histCurr = await getCompanyHistoricalCurrency(companyId);
        const rate = await getConversionRate(histCurr, companyCurrency);

        return customers.map(c => {
            if (c.ledger) {
                c.ledger.currentBalance = (c.ledger.currentBalance || 0) * rate;
            }
            if (c.invoices) {
                c.invoices = c.invoices.map(inv => ({
                    ...inv,
                    totalAmount: (inv.totalAmount || 0) * rate,
                    balanceAmount: (inv.balanceAmount || 0) * rate
                }));
            }
            return c;
        });
    } catch (error) {
        console.error('Error fetching customers:', error);
        throw error;
    }
};

// Get Customer by ID
const getCustomerById = async (id, companyId) => {
    try {
        const customer = await prisma.customer.findFirst({
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
                invoices: {
                    include: {
                        items: true
                    },
                    orderBy: { date: 'desc' }
                },
                receipts: {
                    orderBy: { date: 'desc' }
                }
            }
        });

        if (customer) {
            const companyCurrency = await getCompanyCurrency(companyId);
            const histCurr = await getCompanyHistoricalCurrency(companyId);
            const rate = await getConversionRate(histCurr, companyCurrency);

            if (customer.ledger) {
                customer.ledger.currentBalance = (customer.ledger.currentBalance || 0) * rate;
            }
            if (customer.invoices) {
                customer.invoices = customer.invoices.map(inv => ({
                    ...inv,
                    totalAmount: (inv.totalAmount || 0) * rate,
                    balanceAmount: (inv.balanceAmount || 0) * rate
                }));
            }
        }

        return customer;
    } catch (error) {
        console.error('Error fetching customer:', error);
        throw error;
    }
};

// Update Customer
const updateCustomer = async (id, data) => {
    try {
        const customer = await prisma.customer.update({
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

        // Update ledger name if customer name changed
        if (data.name && customer.ledgerId) {
            await prisma.ledger.update({
                where: { id: customer.ledgerId },
                data: { name: data.name }
            });
        }

        return customer;
    } catch (error) {
        console.error('Error updating customer:', error);
        throw error;
    }
};

// Delete Customer
const deleteCustomer = async (id) => {
    try {
        // Check if customer has any invoices
        const invoiceCount = await prisma.invoice.count({
            where: { customerId: parseInt(id) }
        });

        if (invoiceCount > 0) {
            throw new Error('Cannot delete customer with existing invoices');
        }

        // Delete customer (ledger will be deleted via cascade)
        await prisma.customer.delete({
            where: { id: parseInt(id) }
        });

        return { success: true, message: 'Customer deleted successfully' };
    } catch (error) {
        console.error('Error deleting customer:', error);
        throw error;
    }
};

// Get Customer Ledger
const getCustomerLedger = async (customerId, companyId) => {
    try {
        const customer = await prisma.customer.findFirst({
            where: {
                id: parseInt(customerId),
                companyId: companyId
            },
            include: {
                ledger: {
                    include: {
                        debitTransactions: {
                            include: {
                                creditLedger: true,
                                invoice: true
                            },
                            orderBy: { date: 'desc' }
                        },
                        creditTransactions: {
                            include: {
                                debitLedger: true,
                                receipt: true
                            },
                            orderBy: { date: 'desc' }
                        }
                    }
                }
            }
        });

        if (!customer || !customer.ledger) {
            throw new Error('Customer ledger not found');
        }

        // Combine and sort all transactions
        const allTransactions = [
            ...customer.ledger.debitTransactions.map(t => ({
                ...t,
                type: 'debit',
                particulars: t.creditLedger.name,
                debit: t.amount,
                credit: 0
            })),
            ...customer.ledger.creditTransactions.map(t => ({
                ...t,
                type: 'credit',
                particulars: t.debitLedger.name,
                debit: 0,
                credit: t.amount
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Calculate running balance
        let balance = customer.ledger.openingBalance;
        const transactionsWithBalance = allTransactions.map(t => {
            balance = balance + t.debit - t.credit;
            return {
                ...t,
                balance: balance
            };
        });

        return {
            customer: {
                id: customer.id,
                name: customer.name,
                companyName: customer.companyName
            },
            ledger: {
                id: customer.ledger.id,
                name: customer.ledger.name,
                openingBalance: customer.ledger.openingBalance,
                currentBalance: customer.ledger.currentBalance
            },
            transactions: transactionsWithBalance
        };
    } catch (error) {
        console.error('Error fetching customer ledger:', error);
        throw error;
    }
};

// Get Customer Outstanding
const getCustomerOutstanding = async (customerId, companyId) => {
    try {
        const customer = await prisma.customer.findFirst({
            where: {
                id: parseInt(customerId),
                companyId: companyId
            },
            include: {
                ledger: true,
                invoices: {
                    where: {
                        status: {
                            in: ['UNPAID', 'PARTIAL']
                        }
                    },
                    select: {
                        id: true,
                        invoiceNumber: true,
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

        if (!customer) {
            throw new Error('Customer not found');
        }

        const totalOutstanding = customer.invoices.reduce((sum, inv) => sum + inv.balanceAmount, 0);

        return {
            customer: {
                id: customer.id,
                name: customer.name,
                companyName: customer.companyName
            },
            ledgerBalance: customer.ledger?.currentBalance || 0,
            totalOutstanding: totalOutstanding,
            outstandingInvoices: customer.invoices
        };
    } catch (error) {
        console.error('Error fetching customer outstanding:', error);
        throw error;
    }
};

module.exports = {
    createCustomer,
    getCustomers,
    getCustomerById,
    updateCustomer,
    deleteCustomer,
    getCustomerLedger,
    getCustomerOutstanding
};
