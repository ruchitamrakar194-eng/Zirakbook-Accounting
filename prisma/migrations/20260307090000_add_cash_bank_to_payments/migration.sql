-- AlterTable
ALTER TABLE `payment` ADD COLUMN `cashBankAccountId` INTEGER NULL;

-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `cashBankAccountId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Payment_cashBankAccountId_fkey` ON `payment`(`cashBankAccountId`);

-- CreateIndex
CREATE INDEX `Receipt_cashBankAccountId_fkey` ON `receipt`(`cashBankAccountId`);

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `Payment_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `Receipt_cashBankAccountId_fkey` FOREIGN KEY (`cashBankAccountId`) REFERENCES `ledger`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
