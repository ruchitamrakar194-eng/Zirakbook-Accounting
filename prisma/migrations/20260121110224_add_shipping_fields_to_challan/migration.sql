-- AlterTable
ALTER TABLE `deliverychallan` ADD COLUMN `shippingAddress` TEXT NULL,
    ADD COLUMN `shippingCity` VARCHAR(191) NULL,
    ADD COLUMN `shippingEmail` VARCHAR(191) NULL,
    ADD COLUMN `shippingPhone` VARCHAR(191) NULL,
    ADD COLUMN `shippingState` VARCHAR(191) NULL,
    ADD COLUMN `shippingZipCode` VARCHAR(191) NULL;
