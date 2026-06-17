const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
    log: ['error', 'warn'],
});

// Helper to format a date to a timezone-safe YYYY-MM-DD string
const getLocalDateString = (dateObj) => {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Helper to format a date nicely for error messages
const getFormattedDate = (dateObj) => {
    const d = new Date(dateObj);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

// Global Prisma middleware to validate transaction dates
prisma.$use(async (params, next) => {
    if (params.model === 'transaction' && (params.action === 'create' || params.action === 'createMany' || params.action === 'update')) {
        let transactions = [];
        if (params.action === 'create') {
            transactions = [params.args.data];
        } else if (params.action === 'createMany') {
            transactions = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
        } else if (params.action === 'update') {
            // Fetch the existing transaction to merge updated fields
            const existingTx = await prisma.transaction.findUnique({
                where: params.args.where
            });
            if (existingTx) {
                transactions = [{
                    ...existingTx,
                    ...params.args.data
                }];
            }
        }

        for (const txData of transactions) {
            if (!txData) continue;

            const txDate = txData.date ? new Date(txData.date) : new Date();
            const txDateStr = getLocalDateString(txDate);
            if (!txDateStr) continue;

            // Fetch and check debit and credit ledgers
            const ledgerIds = [txData.debitLedgerId, txData.creditLedgerId].filter(id => id !== undefined && id !== null);

            for (const ledgerId of ledgerIds) {
                const ledger = await prisma.ledger.findUnique({
                    where: { id: parseInt(ledgerId) },
                    include: {
                        customer: true,
                        vendor: true
                    }
                });

                if (ledger) {
                    // Check Ledger (Account) date
                    if (ledger.date) {
                        const ledgerDateStr = getLocalDateString(ledger.date);
                        if (ledgerDateStr && txDateStr < ledgerDateStr) {
                            throw new Error(`Transaction date (${getFormattedDate(txDate)}) cannot be before Account '${ledger.name}' creation date (${getFormattedDate(ledger.date)})`);
                        }
                    }

                    // Check Customer Account creation date
                    if (ledger.customer && ledger.customer.creationDate) {
                        const custDateStr = getLocalDateString(ledger.customer.creationDate);
                        if (custDateStr && txDateStr < custDateStr) {
                            throw new Error(`Transaction date (${getFormattedDate(txDate)}) cannot be before Customer '${ledger.customer.name}' creation date (${getFormattedDate(ledger.customer.creationDate)})`);
                        }
                    }

                    // Check Vendor Account creation date
                    if (ledger.vendor && ledger.vendor.creationDate) {
                        const vendDateStr = getLocalDateString(ledger.vendor.creationDate);
                        if (vendDateStr && txDateStr < vendDateStr) {
                            throw new Error(`Transaction date (${getFormattedDate(txDate)}) cannot be before Vendor '${ledger.vendor.name}' creation date (${getFormattedDate(ledger.vendor.creationDate)})`);
                        }
                    }
                }
            }
        }
    }

    return next(params);
});

module.exports = prisma;
