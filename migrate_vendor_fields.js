const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'accounting_db',
    multipleStatements: true
};

async function migrate() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('Connected to database.');

        const alterQueries = [
            "ALTER TABLE `Vendor` ADD COLUMN `nameArabic` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `companyLocation` TEXT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `profileImage` LONGTEXT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `anyFile` LONGTEXT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `accountType` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `balanceType` VARCHAR(191) DEFAULT 'Credit'",
            "ALTER TABLE `Vendor` ADD COLUMN `accountName` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `accountBalance` DOUBLE NOT NULL DEFAULT 0",
            "ALTER TABLE `Vendor` ADD COLUMN `creationDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)",
            "ALTER TABLE `Vendor` ADD COLUMN `bankAccountNumber` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `bankIFSC` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `bankNameBranch` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `creditPeriod` INT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `gstEnabled` BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE `Vendor` ADD COLUMN `billingName` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingPhone` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingAddress` TEXT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingCity` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingState` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingCountry` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `billingZipCode` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingSameAsBilling` BOOLEAN NOT NULL DEFAULT false",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingName` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingPhone` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingAddress` TEXT NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingCity` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingState` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingCountry` VARCHAR(191) NULL",
            "ALTER TABLE `Vendor` ADD COLUMN `shippingZipCode` VARCHAR(191) NULL"
        ];

        for (const query of alterQueries) {
            try {
                await connection.query(query);
                console.log(`Executed: ${query}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`Skipping (already exists): ${query}`);
                } else {
                    console.error(`Error executing ${query}:`, err.message);
                }
            }
        }

        console.log('Migration completed.');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (connection) await connection.end();
    }
}

migrate();
