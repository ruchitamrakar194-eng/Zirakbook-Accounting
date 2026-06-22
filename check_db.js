const { PrismaClient } = require('c:/Users/kiaan/Desktop/Kiaan/ZirakBook Accounting New Latest/Backend-Zirakbook/node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Connecting to database...");
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  console.log("Companies:", companies);
  for (const c of companies) {
    const customers = await prisma.customer.findMany({ where: { companyId: c.id } });
    const vendors = await prisma.vendor.findMany({ where: { companyId: c.id } });
    const products = await prisma.product.findMany({ where: { companyId: c.id } });
    const invoices = await prisma.invoice.findMany({ where: { companyId: c.id } });
    console.log(`\nCompany: ${c.name} (ID: ${c.id})`);
    console.log(`- Customers count: ${customers.length}`);
    console.log(`- Vendors count: ${vendors.length}`);
    console.log(`- Products count: ${products.length}`);
    console.log(`- Invoices count: ${invoices.length}`);
    if (customers.length > 0) {
      console.log("  Sample Customers:", customers.slice(0, 5).map(cu => ({ id: cu.id, name: cu.name })));
    }
    if (products.length > 0) {
      console.log("  Sample Products:", products.slice(0, 5).map(p => ({ id: p.id, name: p.name })));
    }
  }
}

main()
  .catch(err => console.error("Error running script:", err))
  .finally(async () => {
    await prisma.$disconnect();
  });
