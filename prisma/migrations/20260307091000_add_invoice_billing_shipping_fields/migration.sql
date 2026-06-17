-- AlterTable
ALTER TABLE `invoice` ADD COLUMN `billingName` VARCHAR(191) NULL,
    ADD COLUMN `billingAddress` TEXT NULL,
    ADD COLUMN `billingCity` VARCHAR(191) NULL,
    ADD COLUMN `billingState` VARCHAR(191) NULL,
    ADD COLUMN `billingZipCode` VARCHAR(191) NULL,
    ADD COLUMN `shippingName` VARCHAR(191) NULL,
    ADD COLUMN `shippingAddress` TEXT NULL,
    ADD COLUMN `shippingCity` VARCHAR(191) NULL,
    ADD COLUMN `shippingState` VARCHAR(191) NULL,
    ADD COLUMN `shippingZipCode` VARCHAR(191) NULL;
