-- AlterTable
ALTER TABLE `salesreturn` ADD COLUMN `autoVoucherNo` VARCHAR(191) NULL,
    ADD COLUMN `manualVoucherNo` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('Pending', 'Processed', 'Rejected', 'Draft') NOT NULL DEFAULT 'Pending';
