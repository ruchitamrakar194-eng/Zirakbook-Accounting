-- AlterTable
ALTER TABLE `salesorderitem` ADD COLUMN `warehouseId` INTEGER NULL;

-- AlterTable
ALTER TABLE `salesquotationitem` ADD COLUMN `warehouseId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `SalesQuotationItem` ADD CONSTRAINT `SalesQuotationItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalesOrderItem` ADD CONSTRAINT `SalesOrderItem_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
