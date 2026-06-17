-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `role` ENUM('SUPERADMIN', 'ADMIN', 'COMPANY', 'USER') NOT NULL DEFAULT 'USER',
    `companyId` INTEGER NULL,
    `avatar` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Company` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `logo` LONGTEXT NULL,
    `startDate` DATETIME(3) NULL,
    `endDate` DATETIME(3) NULL,
    `invoiceTemplate` VARCHAR(191) NOT NULL DEFAULT 'New York',
    `invoiceColor` VARCHAR(191) NOT NULL DEFAULT '#000000',
    `showQrCode` BOOLEAN NOT NULL DEFAULT true,
    `invoiceLogo` LONGTEXT NULL,
    `planName` VARCHAR(191) NULL,
    `planId` INTEGER NULL,
    `planType` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `website` VARCHAR(191) NULL,
    `address` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `zip` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `currency` VARCHAR(191) NULL DEFAULT 'USD',
    `bankName` VARCHAR(191) NULL,
    `accountHolder` VARCHAR(191) NULL,
    `accountNumber` VARCHAR(191) NULL,
    `ifsc` VARCHAR(191) NULL,
    `terms` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Company_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PasswordRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `basePrice` DOUBLE NOT NULL DEFAULT 0,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'USD',
    `invoiceLimit` VARCHAR(191) NOT NULL DEFAULT '0',
    `additionalInvoicePrice` DOUBLE NOT NULL DEFAULT 0,
    `userLimit` VARCHAR(191) NOT NULL DEFAULT '0',
    `storageCapacity` VARCHAR(191) NOT NULL DEFAULT '0',
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `modules` JSON NULL,
    `totalPrice` DOUBLE NOT NULL DEFAULT 0,
    `descriptions` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `companyName` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `planId` INTEGER NULL,
    `planName` VARCHAR(191) NULL,
    `billingCycle` VARCHAR(191) NOT NULL DEFAULT 'Monthly',
    `startDate` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transactionId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customer` VARCHAR(191) NOT NULL,
    `paymentMethod` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PaymentRecord_transactionId_key`(`transactionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DashboardAnnouncement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `type` ENUM('ASSETS', 'LIABILITIES', 'INCOME', 'EXPENSES', 'EQUITY') NOT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountGroup_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountSubGroup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AccountSubGroup_companyId_groupId_name_key`(`companyId`, `groupId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ledger` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `groupId` INTEGER NOT NULL,
    `subGroupId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `openingBalance` DOUBLE NOT NULL DEFAULT 0,
    `currentBalance` DOUBLE NOT NULL DEFAULT 0,
    `isControlAccount` BOOLEAN NOT NULL DEFAULT false,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `description` TEXT NULL,
    `parentLedgerId` INTEGER NULL,
    `customerId` INTEGER NULL,
    `vendorId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Ledger_customerId_key`(`customerId`),
    UNIQUE INDEX `Ledger_vendorId_key`(`vendorId`),
    UNIQUE INDEX `Ledger_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `nameArabic` VARCHAR(191) NULL,
    `companyName` VARCHAR(191) NULL,
    `companyLocation` TEXT NULL,
    `profileImage` LONGTEXT NULL,
    `anyFile` LONGTEXT NULL,
    `accountType` VARCHAR(191) NULL,
    `balanceType` VARCHAR(191) NOT NULL DEFAULT 'Debit',
    `accountName` VARCHAR(191) NULL,
    `accountBalance` DOUBLE NOT NULL DEFAULT 0,
    `creationDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bankAccountNumber` VARCHAR(191) NULL,
    `bankIFSC` VARCHAR(191) NULL,
    `bankNameBranch` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `creditPeriod` INTEGER NULL,
    `gstNumber` VARCHAR(191) NULL,
    `gstEnabled` BOOLEAN NOT NULL DEFAULT false,
    `billingName` VARCHAR(191) NULL,
    `billingPhone` VARCHAR(191) NULL,
    `billingAddress` TEXT NULL,
    `billingCity` VARCHAR(191) NULL,
    `billingState` VARCHAR(191) NULL,
    `billingCountry` VARCHAR(191) NULL,
    `billingZipCode` VARCHAR(191) NULL,
    `shippingSameAsBilling` BOOLEAN NOT NULL DEFAULT false,
    `shippingName` VARCHAR(191) NULL,
    `shippingPhone` VARCHAR(191) NULL,
    `shippingAddress` TEXT NULL,
    `shippingCity` VARCHAR(191) NULL,
    `shippingState` VARCHAR(191) NULL,
    `shippingCountry` VARCHAR(191) NULL,
    `shippingZipCode` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `ledgerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Customer_companyId_email_key`(`companyId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Vendor` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `nameArabic` VARCHAR(191) NULL,
    `companyName` VARCHAR(191) NULL,
    `companyLocation` TEXT NULL,
    `profileImage` LONGTEXT NULL,
    `anyFile` LONGTEXT NULL,
    `accountType` VARCHAR(191) NULL,
    `balanceType` VARCHAR(191) NOT NULL DEFAULT 'Credit',
    `accountName` VARCHAR(191) NULL,
    `accountBalance` DOUBLE NOT NULL DEFAULT 0,
    `creationDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bankAccountNumber` VARCHAR(191) NULL,
    `bankIFSC` VARCHAR(191) NULL,
    `bankNameBranch` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `creditPeriod` INTEGER NULL,
    `gstNumber` VARCHAR(191) NULL,
    `gstEnabled` BOOLEAN NOT NULL DEFAULT false,
    `billingName` VARCHAR(191) NULL,
    `billingPhone` VARCHAR(191) NULL,
    `billingAddress` TEXT NULL,
    `billingCity` VARCHAR(191) NULL,
    `billingState` VARCHAR(191) NULL,
    `billingCountry` VARCHAR(191) NULL,
    `billingZipCode` VARCHAR(191) NULL,
    `shippingSameAsBilling` BOOLEAN NOT NULL DEFAULT false,
    `shippingName` VARCHAR(191) NULL,
    `shippingPhone` VARCHAR(191) NULL,
    `shippingAddress` TEXT NULL,
    `shippingCity` VARCHAR(191) NULL,
    `shippingState` VARCHAR(191) NULL,
    `shippingCountry` VARCHAR(191) NULL,
    `shippingZipCode` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `ledgerId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Vendor_companyId_email_key`(`companyId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Transaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `debitLedgerId` INTEGER NOT NULL,
    `creditLedgerId` INTEGER NOT NULL,
    `amount` DOUBLE NOT NULL,
    `narration` TEXT NULL,
    `voucherType` ENUM('JOURNAL', 'SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'EXPENSE', 'INCOME', 'QUOTATION', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'SALES_RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE') NOT NULL,
    `voucherNumber` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `journalEntryId` INTEGER NULL,
    `invoiceId` INTEGER NULL,
    `purchaseBillId` INTEGER NULL,
    `receiptId` INTEGER NULL,
    `paymentId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `JournalEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `voucherNumber` VARCHAR(191) NOT NULL,
    `narration` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `JournalEntry_companyId_voucherNumber_key`(`companyId`, `voucherNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `customerId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `balanceAmount` DOUBLE NOT NULL,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'UNPAID',
    `salesOrderId` INTEGER NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Invoice_companyId_invoiceNumber_key`(`companyId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InvoiceItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `serviceId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseBill` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `billNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `dueDate` DATETIME(3) NULL,
    `vendorId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `balanceAmount` DOUBLE NOT NULL,
    `status` ENUM('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED') NOT NULL DEFAULT 'UNPAID',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseBill_companyId_billNumber_key`(`companyId`, `billNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseBillItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseBillId` INTEGER NOT NULL,
    `description` VARCHAR(191) NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Receipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customerId` INTEGER NOT NULL,
    `invoiceId` INTEGER NULL,
    `amount` DOUBLE NOT NULL,
    `paymentMode` ENUM('CASH', 'BANK', 'CARD', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `referenceNumber` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Receipt_companyId_receiptNumber_key`(`companyId`, `receiptNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vendorId` INTEGER NOT NULL,
    `purchaseBillId` INTEGER NULL,
    `amount` DOUBLE NOT NULL,
    `paymentMode` ENUM('CASH', 'BANK', 'CARD', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `referenceNumber` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Payment_companyId_paymentNumber_key`(`companyId`, `paymentNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ExpenseEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expenseType` ENUM('DIRECT', 'INDIRECT') NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paymentMode` ENUM('CASH', 'BANK', 'CARD', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `description` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `IncomeEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `incomeType` ENUM('PRODUCT_SALES', 'SERVICE_INCOME', 'OTHER_INCOME') NOT NULL,
    `amount` DOUBLE NOT NULL,
    `paymentMode` ENUM('CASH', 'BANK', 'CARD', 'UPI', 'CHEQUE', 'OTHER') NOT NULL,
    `description` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `accountName` VARCHAR(191) NOT NULL,
    `accountNumber` VARCHAR(191) NOT NULL,
    `bankName` VARCHAR(191) NOT NULL,
    `branchName` VARCHAR(191) NULL,
    `ifscCode` VARCHAR(191) NULL,
    `openingBalance` DOUBLE NOT NULL DEFAULT 0,
    `currentBalance` DOUBLE NOT NULL DEFAULT 0,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `BankAccount_companyId_accountNumber_key`(`companyId`, `accountNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BankTransaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `bankAccountId` INTEGER NOT NULL,
    `transactionType` ENUM('DEPOSIT', 'WITHDRAWAL', 'TRANSFER') NOT NULL,
    `amount` DOUBLE NOT NULL,
    `description` TEXT NULL,
    `referenceNumber` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warehouse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `addressLine1` VARCHAR(191) NULL,
    `addressLine2` VARCHAR(191) NULL,
    `city` VARCHAR(191) NULL,
    `state` VARCHAR(191) NULL,
    `postalCode` VARCHAR(191) NULL,
    `country` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Warehouse_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryTransaction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` ENUM('OPENING_STOCK', 'TRANSFER', 'ADJUSTMENT', 'PURCHASE', 'SALE', 'RETURN') NOT NULL,
    `productId` INTEGER NOT NULL,
    `fromWarehouseId` INTEGER NULL,
    `toWarehouseId` INTEGER NULL,
    `quantity` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NULL,
    `hsn` VARCHAR(191) NULL,
    `barcode` VARCHAR(191) NULL,
    `image` LONGTEXT NULL,
    `categoryId` INTEGER NULL,
    `uomId` INTEGER NULL,
    `unit` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `asOfDate` DATETIME(3) NULL,
    `taxAccount` VARCHAR(191) NULL,
    `initialCost` DOUBLE NOT NULL DEFAULT 0,
    `salePrice` DOUBLE NOT NULL DEFAULT 0,
    `purchasePrice` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `remarks` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Stock` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `warehouseId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 0,
    `minOrderQty` DOUBLE NOT NULL DEFAULT 0,
    `initialQty` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Stock_warehouseId_productId_key`(`warehouseId`, `productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UOM` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category` VARCHAR(191) NOT NULL,
    `unitName` VARCHAR(191) NOT NULL,
    `weightPerUnit` VARCHAR(191) NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `UOM_companyId_category_unitName_key`(`companyId`, `category`, `unitName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Service` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `uomId` INTEGER NOT NULL,
    `price` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `allowInInvoices` BOOLEAN NOT NULL DEFAULT true,
    `remarks` TEXT NULL,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Service_companyId_name_key`(`companyId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransfer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherNo` VARCHAR(191) NOT NULL,
    `manualVoucherNo` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `toWarehouseId` INTEGER NOT NULL,
    `narration` TEXT NULL,
    `totalAmount` DOUBLE NOT NULL DEFAULT 0,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `StockTransfer_companyId_voucherNo_key`(`companyId`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryAdjustment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherNo` VARCHAR(191) NOT NULL,
    `manualVoucherNo` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` ENUM('ADD_STOCK', 'REMOVE_STOCK', 'ADJUST_VALUE') NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `note` TEXT NULL,
    `totalValue` DOUBLE NOT NULL DEFAULT 0,
    `companyId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `InventoryAdjustment_companyId_voucherNo_key`(`companyId`, `voucherNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryAdjustmentItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `inventoryAdjustmentId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `narration` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesQuotation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiryDate` DATETIME(3) NULL,
    `customerId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesQuotation_companyId_quotationNumber_key`(`companyId`, `quotationNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesQuotationItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `serviceId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedDate` DATETIME(3) NULL,
    `customerId` INTEGER NOT NULL,
    `quotationId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `status` ENUM('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesOrder_quotationId_key`(`quotationId`),
    UNIQUE INDEX `SalesOrder_companyId_orderNumber_key`(`companyId`, `orderNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesOrderItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `serviceId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryChallan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `challanNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customerId` INTEGER NOT NULL,
    `salesOrderId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `status` ENUM('PENDING', 'DELIVERED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DeliveryChallan_companyId_challanNumber_key`(`companyId`, `challanNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryChallanItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `challanId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesReturn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customerId` INTEGER NOT NULL,
    `invoiceId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `totalAmount` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SalesReturn_companyId_returnNumber_key`(`companyId`, `returnNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalesReturnItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `salesReturnId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockTransferItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `stockTransferId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `fromWarehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL DEFAULT 0,
    `amount` DOUBLE NOT NULL DEFAULT 0,
    `narration` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordRequest` ADD CONSTRAINT `PasswordRequest_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PasswordRequest` ADD CONSTRAINT `PasswordRequest_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanRequest` ADD CONSTRAINT `PlanRequest_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountGroup` ADD CONSTRAINT `AccountGroup_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountSubGroup` ADD CONSTRAINT `AccountSubGroup_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `AccountGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AccountSubGroup` ADD CONSTRAINT `AccountSubGroup_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `AccountGroup`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_subGroupId_fkey` FOREIGN KEY (`subGroupId`) REFERENCES `AccountSubGroup`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_parentLedgerId_fkey` FOREIGN KEY (`parentLedgerId`) REFERENCES `Ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ledger` ADD CONSTRAINT `Ledger_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Customer` ADD CONSTRAINT `Customer_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Vendor` ADD CONSTRAINT `Vendor_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_debitLedgerId_fkey` FOREIGN KEY (`debitLedgerId`) REFERENCES `Ledger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_creditLedgerId_fkey` FOREIGN KEY (`creditLedgerId`) REFERENCES `Ledger`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_journalEntryId_fkey` FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `Receipt`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transaction` ADD CONSTRAINT `Transaction_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `JournalEntry` ADD CONSTRAINT `JournalEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InvoiceItem` ADD CONSTRAINT `InvoiceItem_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseBillItem` ADD CONSTRAINT `PurchaseBillItem_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Receipt` ADD CONSTRAINT `Receipt_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ExpenseEntry` ADD CONSTRAINT `ExpenseEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `IncomeEntry` ADD CONSTRAINT `IncomeEntry_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankAccount` ADD CONSTRAINT `BankAccount_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankTransaction` ADD CONSTRAINT `BankTransaction_bankAccountId_fkey` FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BankTransaction` ADD CONSTRAINT `BankTransaction_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warehouse` ADD CONSTRAINT `Warehouse_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_fromWarehouseId_fkey` FOREIGN KEY (`fromWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_toWarehouseId_fkey` FOREIGN KEY (`toWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_uomId_fkey` FOREIGN KEY (`uomId`) REFERENCES `UOM`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Stock` ADD CONSTRAINT `Stock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UOM` ADD CONSTRAINT `UOM_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_uomId_fkey` FOREIGN KEY (`uomId`) REFERENCES `UOM`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Service` ADD CONSTRAINT `Service_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_toWarehouseId_fkey` FOREIGN KEY (`toWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransfer` ADD CONSTRAINT `StockTransfer_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustment` ADD CONSTRAINT `InventoryAdjustment_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustmentItem` ADD CONSTRAINT `InventoryAdjustmentItem_inventoryAdjustmentId_fkey` FOREIGN KEY (`inventoryAdjustmentId`) REFERENCES `InventoryAdjustment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustmentItem` ADD CONSTRAINT `InventoryAdjustmentItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryAdjustmentItem` ADD CONSTRAINT `InventoryAdjustmentItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotation` ADD CONSTRAINT `SalesQuotation_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotation` ADD CONSTRAINT `SalesQuotation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotationItem` ADD CONSTRAINT `SalesQuotationItem_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `SalesQuotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotationItem` ADD CONSTRAINT `SalesQuotationItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesQuotationItem` ADD CONSTRAINT `SalesQuotationItem_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `SalesQuotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrder` ADD CONSTRAINT `SalesOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_serviceId_fkey` FOREIGN KEY (`serviceId`) REFERENCES `Service`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallan` ADD CONSTRAINT `DeliveryChallan_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanItem` ADD CONSTRAINT `DeliveryChallanItem_challanId_fkey` FOREIGN KEY (`challanId`) REFERENCES `DeliveryChallan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanItem` ADD CONSTRAINT `DeliveryChallanItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryChallanItem` ADD CONSTRAINT `DeliveryChallanItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturn` ADD CONSTRAINT `SalesReturn_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturnItem` ADD CONSTRAINT `SalesReturnItem_salesReturnId_fkey` FOREIGN KEY (`salesReturnId`) REFERENCES `SalesReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturnItem` ADD CONSTRAINT `SalesReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesReturnItem` ADD CONSTRAINT `SalesReturnItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferItem` ADD CONSTRAINT `StockTransferItem_stockTransferId_fkey` FOREIGN KEY (`stockTransferId`) REFERENCES `StockTransfer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferItem` ADD CONSTRAINT `StockTransferItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockTransferItem` ADD CONSTRAINT `StockTransferItem_fromWarehouseId_fkey` FOREIGN KEY (`fromWarehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
