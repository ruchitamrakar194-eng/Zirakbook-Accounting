const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
    console.log('🗑️  Deleting all existing users...');

    // Delete all users first
    await prisma.user.deleteMany({});
    console.log('✅ All users deleted');

    console.log('\n📝 Creating new users...\n');

    // Hash password for all users
    const hashedPassword = await bcrypt.hash('123', 10);

    // 1. Create SUPERADMIN
    const superadmin = await prisma.user.create({
        data: {
            name: 'Super Admin',
            email: 'superadmin@gmail.com',
            password: hashedPassword,
            role: 'SUPERADMIN'
        }
    });
    console.log('✅ Created SUPERADMIN:', {
        id: superadmin.id,
        name: superadmin.name,
        email: superadmin.email,
        role: superadmin.role
    });

    // 2. Create a company first for COMPANY role user
    const company = await prisma.company.create({
        data: {
            name: 'Demo Company',
            email: 'company@gmail.com',
            phone: '+1 234 567 890',
            address: '123 Business Street',
            city: 'New York',
            state: 'NY',
            zip: '10001',
            country: 'United States',
            currency: 'USD'
        }
    });
    console.log('✅ Created Company:', {
        id: company.id,
        name: company.name,
        email: company.email
    });

    // 3. Create COMPANY role user
    const companyUser = await prisma.user.create({
        data: {
            name: 'Company Admin',
            email: 'company@gmail.com',
            password: hashedPassword,
            role: 'COMPANY',
            companyId: company.id
        }
    });
    console.log('✅ Created COMPANY user:', {
        id: companyUser.id,
        name: companyUser.name,
        email: companyUser.email,
        role: companyUser.role,
        companyId: companyUser.companyId
    });

    // 4. Create USER role user
    const regularUser = await prisma.user.create({
        data: {
            name: 'Regular User',
            email: 'user@gmail.com',
            password: hashedPassword,
            role: 'USER',
            companyId: company.id
        }
    });
    console.log('✅ Created USER:', {
        id: regularUser.id,
        name: regularUser.name,
        email: regularUser.email,
        role: regularUser.role,
        companyId: regularUser.companyId
    });

    console.log('\n🎉 Seeding completed successfully!\n');
    console.log('📋 Login Credentials:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('1. SUPERADMIN:');
    console.log('   Email: superadmin@gmail.com');
    console.log('   Password: 123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('2. COMPANY:');
    console.log('   Email: company@gmail.com');
    console.log('   Password: 123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('3. USER:');
    console.log('   Email: user@gmail.com');
    console.log('   Password: 123');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main()
    .catch(err => {
        console.error('❌ Error during seeding:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });