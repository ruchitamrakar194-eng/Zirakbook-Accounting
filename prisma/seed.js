const { PrismaClient } = require('./generated/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
    console.log('Start seeding...');

    try {
        // 1. Clean up database
        console.log('Cleaning database...');

        // Delete in order to avoid foreign key constraints (if cascading is not perfect)
        // Adjust these based on your actual schema if needed
        try { await prisma.voucheritem.deleteMany({}); } catch (e) { }
        try { await prisma.voucher.deleteMany({}); } catch (e) { }
        try { await prisma.user.deleteMany({}); } catch (e) { }
        try { await prisma.company.deleteMany({}); } catch (e) { }

        console.log('Database cleaned (User, Company, Voucher only).');

        const password = '123';
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2. Create SUPERADMIN (No specific company requirement usually, or ID independent)
        const superAdmin = await prisma.user.create({
            data: {
                name: 'Super Admin',
                email: 'superadmin@gmail.com',
                password: hashedPassword,
                role: 'SUPERADMIN',
            },
        });
        console.log('Created SUPERADMIN:', superAdmin.email, 'ID:', superAdmin.id);

        // 3. Create COMPANY User *first* to get their ID
        const companyUserInit = await prisma.user.create({
            data: {
                name: 'Company User',
                email: 'company@gmail.com',
                password: hashedPassword,
                role: 'COMPANY',
                // No companyId yet
            },
        });
        console.log('Created Initial COMPANY User ID:', companyUserInit.id);

        // 4. Create Company with the SAME ID as the User
        // We intentionally force the ID to match the user's ID
        const company = await prisma.company.create({
            data: {
                id: companyUserInit.id, // FORCE SAME ID
                name: 'Tech Solutions Ltd.',
                email: 'company@gmail.com',
                phone: '1234567890',
                address: '123 Business St',
                startDate: new Date(),
            }
        });
        console.log('Created Company with FORCED ID:', company.id);

        // 5. Update the COMPANY User to link to this Company
        const companyUserFinal = await prisma.user.update({
            where: { id: companyUserInit.id },
            data: { companyId: company.id }
        });
        console.log('Updated COMPANY User linked to Company ID:', companyUserFinal.companyId);

        // 6. Create Standard USER for this company
        const user = await prisma.user.create({
            data: {
                name: 'Standard User',
                email: 'user@gmail.com',
                password: hashedPassword,
                role: 'USER',
                companyId: company.id // Belong to the same company
            },
        });
        console.log('Created STANDARD USER ID:', user.id, 'linked to Company ID:', user.companyId);

        console.log('Seeding finished.');

    } catch (err) {
        console.error('Error during seeding:', err);
        throw err;
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
