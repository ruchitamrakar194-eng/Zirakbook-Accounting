-- AlterTable
ALTER TABLE `accountgroup` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `accountsubgroup` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `bankaccount` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `banktransaction` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `category` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `company` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `customer` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `dashboardannouncement` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `deliverychallan` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `deliverychallanitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `expenseentry` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `goodsreceiptnote` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `goodsreceiptnoteitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `incomeentry` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `inventoryadjustment` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `inventoryadjustmentitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `inventorytransaction` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `invoice` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `invoiceitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `journalentry` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `ledger` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `passwordrequest` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `payment` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `paymentrecord` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `plan` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `planrequest` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `product` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasebill` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasebillitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchaseorder` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchaseorderitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasequotation` ADD COLUMN `attachments` TEXT NULL,
    ADD COLUMN `manualReference` VARCHAR(191) NULL,
    ADD COLUMN `terms` TEXT NULL,
    MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasequotationitem` ADD COLUMN `warehouseId` INTEGER NULL,
    MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasereturn` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `purchasereturnitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `receipt` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesorder` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesorderitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesquotation` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesquotationitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesreturn` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `salesreturnitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `service` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `stock` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `stocktransfer` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `stocktransferitem` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `transaction` ADD COLUMN `posInvoiceId` INTEGER NULL,
    MODIFY `voucherType` ENUM('JOURNAL', 'SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'EXPENSE', 'INCOME', 'QUOTATION', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'SALES_RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_QUOTATION', 'PURCHASE_ORDER', 'GRN', 'PURCHASE_RETURN', 'POS_INVOICE') NOT NULL,
    MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `uom` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `user` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `vendor` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `warehouse` MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `posinvoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customerId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `balanceAmount` DOUBLE NOT NULL DEFAULT 0,
    `paymentMode` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Paid',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PosInvoice_customerId_fkey`(`customerId`),
    UNIQUE INDEX `PosInvoice_companyId_invoiceNumber_key`(`companyId`, `invoiceNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `posinvoiceitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `posInvoiceId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `warehouseId` INTEGER NULL,
    `description` VARCHAR(191) NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PosInvoiceItem_posInvoiceId_fkey`(`posInvoiceId`),
    INDEX `PosInvoiceItem_productId_fkey`(`productId`),
    INDEX `PosInvoiceItem_warehouseId_fkey`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voucher` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherNumber` VARCHAR(191) NOT NULL,
    `voucherType` ENUM('EXPENSE', 'INCOME', 'CONTRA') NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `companyId` INTEGER NOT NULL,
    `companyName` VARCHAR(191) NULL,
    `logo` LONGTEXT NULL,
    `paidFromLedgerId` INTEGER NULL,
    `paidToLedgerId` INTEGER NULL,
    `paidFromAccount` VARCHAR(191) NULL,
    `paidToParty` VARCHAR(191) NULL,
    `vendorId` INTEGER NULL,
    `customerId` INTEGER NULL,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `notes` TEXT NULL,
    `signature` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `voucher_vendorId_idx`(`vendorId`),
    INDEX `voucher_customerId_idx`(`customerId`),
    INDEX `voucher_paidFromLedgerId_idx`(`paidFromLedgerId`),
    INDEX `voucher_paidToLedgerId_idx`(`paidToLedgerId`),
    UNIQUE INDEX `voucher_companyId_voucherNumber_key`(`companyId`, `voucherNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `voucheritem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `voucherId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `productName` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `voucheritem_voucherId_idx`(`voucherId`),
    INDEX `voucheritem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `PurchaseQuotationItem_warehouseId_fkey` ON `purchasequotationitem`(`warehouseId`);

-- CreateIndex
CREATE INDEX `Transaction_posInvoiceId_fkey` ON `transaction`(`posInvoiceId`);

-- AddForeignKey
ALTER TABLE `posinvoice` ADD CONSTRAINT `PosInvoice_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posinvoice` ADD CONSTRAINT `PosInvoice_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posinvoiceitem` ADD CONSTRAINT `PosInvoiceItem_posInvoiceId_fkey` FOREIGN KEY (`posInvoiceId`) REFERENCES `posinvoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posinvoiceitem` ADD CONSTRAINT `PosInvoiceItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posinvoiceitem` ADD CONSTRAINT `PosInvoiceItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `purchasequotationitem` ADD CONSTRAINT `PurchaseQuotationItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transaction` ADD CONSTRAINT `Transaction_posInvoiceId_fkey` FOREIGN KEY (`posInvoiceId`) REFERENCES `posinvoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `vendor`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_paidFromLedgerId_fkey` FOREIGN KEY (`paidFromLedgerId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucher` ADD CONSTRAINT `voucher_paidToLedgerId_fkey` FOREIGN KEY (`paidToLedgerId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucheritem` ADD CONSTRAINT `voucheritem_voucherId_fkey` FOREIGN KEY (`voucherId`) REFERENCES `voucher`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `voucheritem` ADD CONSTRAINT `voucheritem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
