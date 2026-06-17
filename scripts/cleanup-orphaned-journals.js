/**
 * One-time cleanup script:
 * Removes orphaned JournalEntry records that have NO linked transactions.
 * These are leftover from bills that were deleted but whose journal entries
 * weren't fully cleaned up — causing "Voucher Number already in use" errors.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function cleanupOrphanedJournals() {
    console.log('🔍 Scanning for orphaned journal entries...');

    // Find all journal entries that have zero transactions linked
    const orphaned = await prisma.journalentry.findMany({
        where: {
            transactions: { none: {} }
        },
        select: {
            id: true,
            voucherNumber: true,
            narration: true,
            companyId: true,
            date: true
        }
    });

    if (orphaned.length === 0) {
        console.log('✅ No orphaned journal entries found. Database is clean!');
        await prisma.$disconnect();
        return;
    }

    console.log(`⚠️  Found ${orphaned.length} orphaned journal entries:`);
    orphaned.forEach(j => {
        console.log(`   - ID: ${j.id} | Voucher: ${j.voucherNumber} | Narration: ${j.narration}`);
    });

    const ids = orphaned.map(j => j.id);
    const result = await prisma.journalentry.deleteMany({
        where: { id: { in: ids } }
    });

    console.log(`\n🗑️  Deleted ${result.count} orphaned journal entries.`);
    console.log('✅ Cleanup complete! You can now create new bills without voucher conflicts.');

    await prisma.$disconnect();
}

cleanupOrphanedJournals().catch(async (err) => {
    console.error('❌ Error during cleanup:', err.message);
    await prisma.$disconnect();
    process.exit(1);
});
