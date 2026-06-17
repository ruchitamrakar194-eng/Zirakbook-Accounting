-- AlterTable
ALTER TABLE `payment` ADD COLUMN `discountAmount` DOUBLE NOT NULL DEFAULT 0.0,
    ADD COLUMN `discountLedgerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `discountAmount` DOUBLE NOT NULL DEFAULT 0.0,
    ADD COLUMN `discountLedgerId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Payment_discountLedgerId_fkey` ON `payment`(`discountLedgerId`);

-- CreateIndex
CREATE INDEX `Receipt_discountLedgerId_fkey` ON `receipt`(`discountLedgerId`);

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `Payment_discountLedgerId_fkey` FOREIGN KEY (`discountLedgerId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `Receipt_discountLedgerId_fkey` FOREIGN KEY (`discountLedgerId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
