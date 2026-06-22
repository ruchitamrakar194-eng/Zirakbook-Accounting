const { PrismaClient } = require('c:/Users/kiaan/Desktop/Kiaan/ZirakBook Accounting New Latest/Backend-Zirakbook/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function search(companyId, query) {
  const [invoices, purchaseBills, customers, vendors, products, vouchers] = await Promise.all([
      // Invoices
      prisma.invoice.findMany({
          where: {
              companyId,
              OR: [
                  { invoiceNumber: { contains: query } },
                  { notes: { contains: query } },
                  { customer: { name: { contains: query } } }
              ]
          },
          include: { customer: { select: { name: true } } },
          take: 10
      }),
      // Purchase Bills
      prisma.purchasebill.findMany({
          where: {
              companyId,
              OR: [
                  { billNumber: { contains: query } },
                  { notes: { contains: query } },
                  { vendor: { name: { contains: query } } }
              ]
          },
          include: { vendor: { select: { name: true } } },
          take: 10
      }),
      // Customers
      prisma.customer.findMany({
          where: {
              companyId,
              OR: [
                  { name: { contains: query } },
                  { email: { contains: query } },
                  { phone: { contains: query } }
              ]
          },
          take: 10
      }),
      // Vendors
      prisma.vendor.findMany({
          where: {
              companyId,
              OR: [
                  { name: { contains: query } },
                  { email: { contains: query } },
                  { phone: { contains: query } }
              ]
          },
          take: 10
      }),
      // Products
      prisma.product.findMany({
          where: {
              companyId,
              OR: [
                  { name: { contains: query } },
                  { sku: { contains: query } },
                  { barcode: { contains: query } }
              ]
          },
          take: 10
      }),
      // Vouchers
      prisma.voucher.findMany({
          where: {
              companyId,
              OR: [
                  { voucherNumber: { contains: query } },
                  { notes: { contains: query } }
              ]
          },
          take: 10
      })
  ]);
  return { invoices, purchaseBills, customers, vendors, products, vouchers };
}

async function main() {
  const query = 'customer';
  
  console.log("Searching in Company 13 for 'customer'...");
  let res = await search(13, query);
  console.log("Results 13:", JSON.stringify(res, null, 2));

  console.log("\nSearching in Company 13 for 'test'...");
  res = await search(13, 'test');
  console.log("Results 13 for 'test':", JSON.stringify(res, null, 2));

  console.log("\nSearching in Company 15 for 'Waheed'...");
  res = await search(15, 'Waheed');
  console.log("Results 15 for 'Waheed':", JSON.stringify(res, null, 2));
}

main()
  .catch(err => console.error("Error running script:", err))
  .finally(async () => {
    await prisma.$disconnect();
  });
