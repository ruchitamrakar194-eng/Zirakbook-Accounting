-- AlterTable
ALTER TABLE `inventorytransaction` MODIFY `type` ENUM('OPENING_STOCK', 'TRANSFER', 'ADJUSTMENT', 'PURCHASE', 'SALE', 'RETURN', 'GRN') NOT NULL;

-- AlterTable
ALTER TABLE `purchasebill` ADD COLUMN `grnId` INTEGER NULL,
    ADD COLUMN `purchaseOrderId` INTEGER NULL;

-- AlterTable
ALTER TABLE `transaction` MODIFY `voucherType` ENUM('JOURNAL', 'SALES', 'PURCHASE', 'RECEIPT', 'PAYMENT', 'CONTRA', 'EXPENSE', 'INCOME', 'QUOTATION', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'SALES_RETURN', 'CREDIT_NOTE', 'DEBIT_NOTE', 'PURCHASE_QUOTATION', 'PURCHASE_ORDER', 'GRN', 'PURCHASE_RETURN') NOT NULL;

-- CreateTable
CREATE TABLE `PurchaseQuotation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiryDate` DATETIME(3) NULL,
    `vendorId` INTEGER NOT NULL,
    `companyId` INTEGER NOT NULL,
    `subtotal` DOUBLE NOT NULL,
    `discountAmount` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `totalAmount` DOUBLE NOT NULL,
    `status` ENUM('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED') NOT NULL DEFAULT 'DRAFT',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseQuotation_companyId_quotationNumber_key`(`companyId`, `quotationNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseQuotationItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quotationId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
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
CREATE TABLE `PurchaseOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expectedDate` DATETIME(3) NULL,
    `vendorId` INTEGER NOT NULL,
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

    UNIQUE INDEX `PurchaseOrder_quotationId_key`(`quotationId`),
    UNIQUE INDEX `PurchaseOrder_companyId_orderNumber_key`(`companyId`, `orderNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseOrderItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `productId` INTEGER NULL,
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
CREATE TABLE `GoodsReceiptNote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grnNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vendorId` INTEGER NOT NULL,
    `purchaseOrderId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `notes` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Received',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GoodsReceiptNote_companyId_grnNumber_key`(`companyId`, `grnNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoodsReceiptNoteItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grnId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `description` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReturn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `returnNumber` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `vendorId` INTEGER NOT NULL,
    `purchaseBillId` INTEGER NULL,
    `companyId` INTEGER NOT NULL,
    `totalAmount` DOUBLE NOT NULL,
    `reason` TEXT NULL,
    `status` ENUM('Pending', 'Processed', 'Rejected', 'Draft') NOT NULL DEFAULT 'Pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PurchaseReturn_companyId_returnNumber_key`(`companyId`, `returnNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PurchaseReturnItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `purchaseReturnId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `warehouseId` INTEGER NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `rate` DOUBLE NOT NULL,
    `amount` DOUBLE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GoodsReceiptNote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseQuotation` ADD CONSTRAINT `PurchaseQuotation_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseQuotation` ADD CONSTRAINT `PurchaseQuotation_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseQuotationItem` ADD CONSTRAINT `PurchaseQuotationItem_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `PurchaseQuotation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseQuotationItem` ADD CONSTRAINT `PurchaseQuotationItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `PurchaseQuotation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrder` ADD CONSTRAINT `PurchaseOrder_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseOrderItem` ADD CONSTRAINT `PurchaseOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNote` ADD CONSTRAINT `GoodsReceiptNote_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNote` ADD CONSTRAINT `GoodsReceiptNote_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNote` ADD CONSTRAINT `GoodsReceiptNote_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNoteItem` ADD CONSTRAINT `GoodsReceiptNoteItem_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `GoodsReceiptNote`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNoteItem` ADD CONSTRAINT `GoodsReceiptNoteItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoodsReceiptNoteItem` ADD CONSTRAINT `GoodsReceiptNoteItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_vendorId_fkey` FOREIGN KEY (`vendorId`) REFERENCES `Vendor`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturn` ADD CONSTRAINT `PurchaseReturn_companyId_fkey` FOREIGN KEY (`companyId`) REFERENCES `Company`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnItem` ADD CONSTRAINT `PurchaseReturnItem_purchaseReturnId_fkey` FOREIGN KEY (`purchaseReturnId`) REFERENCES `PurchaseReturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnItem` ADD CONSTRAINT `PurchaseReturnItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PurchaseReturnItem` ADD CONSTRAINT `PurchaseReturnItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
