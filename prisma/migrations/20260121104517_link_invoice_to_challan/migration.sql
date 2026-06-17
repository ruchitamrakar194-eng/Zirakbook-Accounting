-- AlterTable
ALTER TABLE `invoice` ADD COLUMN `deliveryChallanId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Invoice` ADD CONSTRAINT `Invoice_deliveryChallanId_fkey` FOREIGN KEY (`deliveryChallanId`) REFERENCES `DeliveryChallan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
