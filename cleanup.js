/**
 * 🧹 Database Cleanup Script
 * Deletes ALL data from the database EXCEPT the SUPERADMIN user.
 * Run with: node cleanup.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanup() {
    console.log('\n🧹 Starting full database cleanup...\n');
    console.log('⚠️  This will delete ALL data EXCEPT the SUPERADMIN user.\n');

    try {
        // ─── Step 1: Delete all leaf/child tables first (to avoid FK constraint errors) ───

        console.log('🗑️  Deleting child records...');

        await prisma.inventory_consumption.deleteMany({});
        console.log('   ✅ inventory_consumption');

        await prisma.inventory_batch.deleteMany({});
        console.log('   ✅ inventory_batch');

        await prisma.inventorytransaction.deleteMany({});
        console.log('   ✅ inventorytransaction');

        await prisma.inventoryadjustment.deleteMany({});
        console.log('   ✅ inventoryadjustment');

        await prisma.stock.deleteMany({});
        console.log('   ✅ stock');

        await prisma.stocktransfer.deleteMany({});
        console.log('   ✅ stocktransfer');

        await prisma.transaction.deleteMany({});
        console.log('   ✅ transaction');

        await prisma.journalentry.deleteMany({});
        console.log('   ✅ journalentry');

        await prisma.banktransaction.deleteMany({});
        console.log('   ✅ banktransaction');

        await prisma.bankaccount.deleteMany({});
        console.log('   ✅ bankaccount');

        await prisma.posinvoiceitem.deleteMany({});
        console.log('   ✅ posinvoiceitem');

        await prisma.posinvoice.deleteMany({});
        console.log('   ✅ posinvoice');

        await prisma.invoiceitem.deleteMany({});
        console.log('   ✅ invoiceitem');

        await prisma.invoice.deleteMany({});
        console.log('   ✅ invoice');

        await prisma.purchasebillitem.deleteMany({});
        console.log('   ✅ purchasebillitem');

        await prisma.purchasebill.deleteMany({});
        console.log('   ✅ purchasebill');

        await prisma.purchaseorderitem.deleteMany({});
        console.log('   ✅ purchaseorderitem');

        await prisma.purchaseorder.deleteMany({});
        console.log('   ✅ purchaseorder');

        await prisma.purchasequotationitem.deleteMany({});
        console.log('   ✅ purchasequotationitem');

        await prisma.purchasequotation.deleteMany({});
        console.log('   ✅ purchasequotation');

        await prisma.purchasereturnitem.deleteMany({});
        console.log('   ✅ purchasereturnitem');

        await prisma.purchasereturn.deleteMany({});
        console.log('   ✅ purchasereturn');

        await prisma.salesorderitem.deleteMany({});
        console.log('   ✅ salesorderitem');

        await prisma.salesorder.deleteMany({});
        console.log('   ✅ salesorder');

        await prisma.salesquotationitem.deleteMany({});
        console.log('   ✅ salesquotationitem');

        await prisma.salesquotation.deleteMany({});
        console.log('   ✅ salesquotation');

        await prisma.salesreturnitem.deleteMany({});
        console.log('   ✅ salesreturnitem');

        await prisma.salesreturn.deleteMany({});
        console.log('   ✅ salesreturn');

        await prisma.deliverychallanitem.deleteMany({});
        console.log('   ✅ deliverychallanitem');

        await prisma.deliverychallan.deleteMany({});
        console.log('   ✅ deliverychallan');

        await prisma.goodsreceiptnoteitem.deleteMany({});
        console.log('   ✅ goodsreceiptnoteitem');

        await prisma.goodsreceiptnote.deleteMany({});
        console.log('   ✅ goodsreceiptnote');

        await prisma.receipt.deleteMany({});
        console.log('   ✅ receipt');

        await prisma.payment.deleteMany({});
        console.log('   ✅ payment');

        await prisma.voucher.deleteMany({});
        console.log('   ✅ voucher');

        await prisma.expenseentry.deleteMany({});
        console.log('   ✅ expenseentry');

        await prisma.incomeentry.deleteMany({});
        console.log('   ✅ incomeentry');

        await prisma.passwordrequest.deleteMany({});
        console.log('   ✅ passwordrequest');

        await prisma.shippingaddress.deleteMany({});
        console.log('   ✅ shippingaddress');

        // ─── Step 2: Delete ledgers (depends on customer/vendor) ───
        await prisma.ledger.deleteMany({});
        console.log('   ✅ ledger');

        await prisma.accountsubgroup.deleteMany({});
        console.log('   ✅ accountsubgroup');

        await prisma.accountgroup.deleteMany({});
        console.log('   ✅ accountgroup');

        // ─── Step 3: Delete products & related ───
        await prisma.product.deleteMany({});
        console.log('   ✅ product');

        await prisma.category.deleteMany({});
        console.log('   ✅ category');

        await prisma.service.deleteMany({});
        console.log('   ✅ service');

        await prisma.uom.deleteMany({});
        console.log('   ✅ uom');

        await prisma.warehouse.deleteMany({});
        console.log('   ✅ warehouse');

        // ─── Step 4: Delete parties (customer / vendor) ───
        await prisma.customer.deleteMany({});
        console.log('   ✅ customer');

        await prisma.vendor.deleteMany({});
        console.log('   ✅ vendor');

        // ─── Step 5: Delete roles ───
        await prisma.role.deleteMany({});
        console.log('   ✅ role');

        // ─── Step 6: Delete non-superadmin users ───
        await prisma.user.deleteMany({
            where: { role: { not: 'SUPERADMIN' } }
        });
        console.log('   ✅ users (non-SUPERADMIN deleted)');

        // ─── Step 7: Delete all companies (will cascade remaining data) ───
        await prisma.company.deleteMany({});
        console.log('   ✅ company (all cascades handled)');

        // ─── Step 8: Delete global / standalone tables ───
        await prisma.dashboardannouncement.deleteMany({});
        console.log('   ✅ dashboardannouncement');

        // ─── Verify superadmin is intact ───
        const superadmin = await prisma.user.findFirst({
            where: { role: 'SUPERADMIN' }
        });

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        if (superadmin) {
            console.log('✅ SUPERADMIN user is INTACT:');
            console.log(`   ID:    ${superadmin.id}`);
            console.log(`   Name:  ${superadmin.name}`);
            console.log(`   Email: ${superadmin.email}`);
            console.log(`   Role:  ${superadmin.role}`);
        } else {
            console.log('⚠️  WARNING: No SUPERADMIN user found! You may need to re-seed.');
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('\n🎉 Database cleanup complete! All data deleted except SUPERADMIN.\n');

    } catch (error) {
        console.error('\n❌ Error during cleanup:', error.message);
        console.error('\nFull error:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

cleanup();