const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function inspect() {
    try {
        const products = await prisma.product.findMany({
            include: { stock: true }
        });
        console.log("PRODUCTS:");
        products.forEach(p => {
            console.log(`- ID: ${p.id}, Name: ${p.name}, initialCost: ${p.initialCost}, purchasePrice: ${p.purchasePrice}, salePrice: ${p.salePrice}, averageCost: ${p.averageCost}, totalInventoryValue: ${p.totalInventoryValue}, totalQty: ${p.totalQty}`);
            console.log("  Stock:", p.stock.map(s => `WH: ${s.warehouseId}, Qty: ${s.quantity}`));
        });

        const transactions = await prisma.transaction.findMany();
        console.log("\nTRANSACTIONS:");
        transactions.forEach(t => {
            console.log(`- ID: ${t.id}, Date: ${t.date}, DebitLedger: ${t.debitLedgerId}, CreditLedger: ${t.creditLedgerId}, Amount: ${t.amount}, VoucherNo: ${t.voucherNumber}, Narration: ${t.narration}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

inspect();
