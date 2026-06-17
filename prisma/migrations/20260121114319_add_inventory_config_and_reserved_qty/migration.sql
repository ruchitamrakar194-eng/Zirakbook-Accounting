-- AlterTable
ALTER TABLE `company` ADD COLUMN `inventoryConfig` JSON NULL;

-- AlterTable
ALTER TABLE `stock` ADD COLUMN `reservedQuantity` DOUBLE NOT NULL DEFAULT 0;
