
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.AccountgroupScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AccountsubgroupScalarFieldEnum = {
  id: 'id',
  name: 'name',
  groupId: 'groupId',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BankaccountScalarFieldEnum = {
  id: 'id',
  accountName: 'accountName',
  accountNumber: 'accountNumber',
  bankName: 'bankName',
  branchName: 'branchName',
  ifscCode: 'ifscCode',
  openingBalance: 'openingBalance',
  currentBalance: 'currentBalance',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.BanktransactionScalarFieldEnum = {
  id: 'id',
  date: 'date',
  bankAccountId: 'bankAccountId',
  transactionType: 'transactionType',
  amount: 'amount',
  description: 'description',
  referenceNumber: 'referenceNumber',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CategoryScalarFieldEnum = {
  id: 'id',
  name: 'name',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CompanyScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  logo: 'logo',
  startDate: 'startDate',
  endDate: 'endDate',
  invoiceTemplate: 'invoiceTemplate',
  invoiceColor: 'invoiceColor',
  showQrCode: 'showQrCode',
  invoiceLogo: 'invoiceLogo',
  planName: 'planName',
  planId: 'planId',
  planType: 'planType',
  phone: 'phone',
  website: 'website',
  address: 'address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  country: 'country',
  currency: 'currency',
  bankName: 'bankName',
  accountHolder: 'accountHolder',
  accountNumber: 'accountNumber',
  ifsc: 'ifsc',
  terms: 'terms',
  termsInvoice: 'termsInvoice',
  termsReceipt: 'termsReceipt',
  termsPurchase: 'termsPurchase',
  termsSalesOrder: 'termsSalesOrder',
  termsQuotation: 'termsQuotation',
  termsCreditNote: 'termsCreditNote',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  inventoryConfig: 'inventoryConfig',
  invoiceTableHeaders: 'invoiceTableHeaders',
  invoiceLabels: 'invoiceLabels',
  receiptTemplate: 'receiptTemplate',
  receiptColor: 'receiptColor',
  receiptLabels: 'receiptLabels',
  receiptTableHeaders: 'receiptTableHeaders',
  paymentTemplate: 'paymentTemplate',
  paymentColor: 'paymentColor',
  paymentLabels: 'paymentLabels',
  paymentTableHeaders: 'paymentTableHeaders',
  customFieldsConfig: 'customFieldsConfig',
  documentTitles: 'documentTitles'
};

exports.Prisma.CustomerScalarFieldEnum = {
  id: 'id',
  name: 'name',
  nameArabic: 'nameArabic',
  companyName: 'companyName',
  companyLocation: 'companyLocation',
  profileImage: 'profileImage',
  anyFile: 'anyFile',
  accountType: 'accountType',
  balanceType: 'balanceType',
  accountName: 'accountName',
  accountBalance: 'accountBalance',
  creationDate: 'creationDate',
  bankAccountNumber: 'bankAccountNumber',
  bankIFSC: 'bankIFSC',
  bankNameBranch: 'bankNameBranch',
  phone: 'phone',
  email: 'email',
  creditPeriod: 'creditPeriod',
  gstNumber: 'gstNumber',
  gstEnabled: 'gstEnabled',
  billingName: 'billingName',
  billingPhone: 'billingPhone',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingCountry: 'billingCountry',
  billingZipCode: 'billingZipCode',
  shippingSameAsBilling: 'shippingSameAsBilling',
  shippingName: 'shippingName',
  shippingPhone: 'shippingPhone',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingCountry: 'shippingCountry',
  shippingZipCode: 'shippingZipCode',
  companyId: 'companyId',
  ledgerId: 'ledgerId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DashboardannouncementScalarFieldEnum = {
  id: 'id',
  title: 'title',
  content: 'content',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DeliverychallanScalarFieldEnum = {
  id: 'id',
  challanNumber: 'challanNumber',
  manualReference: 'manualReference',
  date: 'date',
  customerId: 'customerId',
  salesOrderId: 'salesOrderId',
  companyId: 'companyId',
  notes: 'notes',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingEmail: 'shippingEmail',
  shippingPhone: 'shippingPhone',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  vehicleNo: 'vehicleNo',
  carrier: 'carrier',
  transportNote: 'transportNote',
  remarks: 'remarks',
  customFields: 'customFields'
};

exports.Prisma.DeliverychallanitemScalarFieldEnum = {
  id: 'id',
  challanId: 'challanId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  quantity: 'quantity',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  description: 'description'
};

exports.Prisma.ExpenseentryScalarFieldEnum = {
  id: 'id',
  date: 'date',
  expenseType: 'expenseType',
  amount: 'amount',
  paymentMode: 'paymentMode',
  description: 'description',
  customFields: 'customFields',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GoodsreceiptnoteScalarFieldEnum = {
  id: 'id',
  grnNumber: 'grnNumber',
  date: 'date',
  vendorId: 'vendorId',
  purchaseOrderId: 'purchaseOrderId',
  companyId: 'companyId',
  notes: 'notes',
  status: 'status',
  customFields: 'customFields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.GoodsreceiptnoteitemScalarFieldEnum = {
  id: 'id',
  grnId: 'grnId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  quantity: 'quantity',
  description: 'description',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.IncomeentryScalarFieldEnum = {
  id: 'id',
  date: 'date',
  incomeType: 'incomeType',
  amount: 'amount',
  paymentMode: 'paymentMode',
  description: 'description',
  customFields: 'customFields',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InventoryadjustmentScalarFieldEnum = {
  id: 'id',
  voucherNo: 'voucherNo',
  manualVoucherNo: 'manualVoucherNo',
  date: 'date',
  type: 'type',
  warehouseId: 'warehouseId',
  note: 'note',
  totalValue: 'totalValue',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InventoryadjustmentitemScalarFieldEnum = {
  id: 'id',
  inventoryAdjustmentId: 'inventoryAdjustmentId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  narration: 'narration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InventorytransactionScalarFieldEnum = {
  id: 'id',
  date: 'date',
  type: 'type',
  productId: 'productId',
  fromWarehouseId: 'fromWarehouseId',
  toWarehouseId: 'toWarehouseId',
  quantity: 'quantity',
  reason: 'reason',
  companyId: 'companyId',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.InvoiceScalarFieldEnum = {
  id: 'id',
  invoiceNumber: 'invoiceNumber',
  date: 'date',
  dueDate: 'dueDate',
  customerId: 'customerId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  paidAmount: 'paidAmount',
  balanceAmount: 'balanceAmount',
  currency: 'currency',
  exchangeRate: 'exchangeRate',
  status: 'status',
  salesOrderId: 'salesOrderId',
  notes: 'notes',
  createdAt: 'createdAt',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  updatedAt: 'updatedAt',
  deliveryChallanId: 'deliveryChallanId',
  billingName: 'billingName',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingZipCode: 'billingZipCode',
  billingCountry: 'billingCountry',
  shippingName: 'shippingName',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  shippingCountry: 'shippingCountry',
  customFields: 'customFields'
};

exports.Prisma.InvoiceitemScalarFieldEnum = {
  id: 'id',
  invoiceId: 'invoiceId',
  productId: 'productId',
  serviceId: 'serviceId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  warehouseId: 'warehouseId',
  uomId: 'uomId'
};

exports.Prisma.JournalentryScalarFieldEnum = {
  id: 'id',
  date: 'date',
  voucherNumber: 'voucherNumber',
  narration: 'narration',
  companyId: 'companyId',
  source: 'source',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LedgerScalarFieldEnum = {
  id: 'id',
  name: 'name',
  groupId: 'groupId',
  subGroupId: 'subGroupId',
  companyId: 'companyId',
  openingBalance: 'openingBalance',
  currentBalance: 'currentBalance',
  isControlAccount: 'isControlAccount',
  isEnabled: 'isEnabled',
  description: 'description',
  parentLedgerId: 'parentLedgerId',
  customerId: 'customerId',
  vendorId: 'vendorId',
  date: 'date',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PasswordrequestScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  status: 'status',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentScalarFieldEnum = {
  id: 'id',
  paymentNumber: 'paymentNumber',
  date: 'date',
  vendorId: 'vendorId',
  purchaseBillId: 'purchaseBillId',
  amount: 'amount',
  paymentMode: 'paymentMode',
  referenceNumber: 'referenceNumber',
  companyId: 'companyId',
  cashBankAccountId: 'cashBankAccountId',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  discountAmount: 'discountAmount',
  discountLedgerId: 'discountLedgerId',
  customFields: 'customFields'
};

exports.Prisma.PaymentrecordScalarFieldEnum = {
  id: 'id',
  transactionId: 'transactionId',
  date: 'date',
  customer: 'customer',
  paymentMethod: 'paymentMethod',
  amount: 'amount',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PlanScalarFieldEnum = {
  id: 'id',
  name: 'name',
  basePrice: 'basePrice',
  currency: 'currency',
  invoiceLimit: 'invoiceLimit',
  additionalInvoicePrice: 'additionalInvoicePrice',
  userLimit: 'userLimit',
  storageCapacity: 'storageCapacity',
  billingCycle: 'billingCycle',
  status: 'status',
  modules: 'modules',
  totalPrice: 'totalPrice',
  descriptions: 'descriptions',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PlanrequestScalarFieldEnum = {
  id: 'id',
  companyName: 'companyName',
  email: 'email',
  phone: 'phone',
  address: 'address',
  logo: 'logo',
  planId: 'planId',
  planName: 'planName',
  billingCycle: 'billingCycle',
  startDate: 'startDate',
  status: 'status',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PosinvoiceScalarFieldEnum = {
  id: 'id',
  invoiceNumber: 'invoiceNumber',
  date: 'date',
  customerId: 'customerId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  paidAmount: 'paidAmount',
  balanceAmount: 'balanceAmount',
  paymentMode: 'paymentMode',
  status: 'status',
  notes: 'notes',
  customFields: 'customFields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PosinvoiceitemScalarFieldEnum = {
  id: 'id',
  posInvoiceId: 'posInvoiceId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  uomId: 'uomId'
};

exports.Prisma.ProductScalarFieldEnum = {
  id: 'id',
  name: 'name',
  sku: 'sku',
  hsn: 'hsn',
  barcode: 'barcode',
  image: 'image',
  categoryId: 'categoryId',
  uomId: 'uomId',
  unit: 'unit',
  description: 'description',
  asOfDate: 'asOfDate',
  taxAccount: 'taxAccount',
  initialCost: 'initialCost',
  salePrice: 'salePrice',
  purchasePrice: 'purchasePrice',
  discount: 'discount',
  remarks: 'remarks',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  purchaseUomId: 'purchaseUomId',
  salesUomId: 'salesUomId',
  totalQty: 'totalQty',
  totalInventoryValue: 'totalInventoryValue',
  averageCost: 'averageCost'
};

exports.Prisma.PurchasebillScalarFieldEnum = {
  id: 'id',
  billNumber: 'billNumber',
  date: 'date',
  dueDate: 'dueDate',
  vendorId: 'vendorId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  paidAmount: 'paidAmount',
  balanceAmount: 'balanceAmount',
  currency: 'currency',
  exchangeRate: 'exchangeRate',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  grnId: 'grnId',
  purchaseOrderId: 'purchaseOrderId',
  billingName: 'billingName',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingZipCode: 'billingZipCode',
  billingCountry: 'billingCountry',
  shippingName: 'shippingName',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  shippingCountry: 'shippingCountry',
  customFields: 'customFields'
};

exports.Prisma.PurchasebillitemScalarFieldEnum = {
  id: 'id',
  purchaseBillId: 'purchaseBillId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  uomId: 'uomId'
};

exports.Prisma.PurchaseorderScalarFieldEnum = {
  id: 'id',
  orderNumber: 'orderNumber',
  date: 'date',
  expectedDate: 'expectedDate',
  vendorId: 'vendorId',
  quotationId: 'quotationId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  status: 'status',
  notes: 'notes',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  billingName: 'billingName',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingZipCode: 'billingZipCode',
  billingCountry: 'billingCountry',
  shippingName: 'shippingName',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  shippingCountry: 'shippingCountry',
  customFields: 'customFields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PurchaseorderitemScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  productId: 'productId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  warehouseId: 'warehouseId'
};

exports.Prisma.PurchasequotationScalarFieldEnum = {
  id: 'id',
  quotationNumber: 'quotationNumber',
  date: 'date',
  expiryDate: 'expiryDate',
  vendorId: 'vendorId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  status: 'status',
  notes: 'notes',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  attachments: 'attachments',
  manualReference: 'manualReference',
  terms: 'terms',
  customFields: 'customFields'
};

exports.Prisma.PurchasequotationitemScalarFieldEnum = {
  id: 'id',
  quotationId: 'quotationId',
  productId: 'productId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  warehouseId: 'warehouseId'
};

exports.Prisma.PurchasereturnScalarFieldEnum = {
  id: 'id',
  returnNumber: 'returnNumber',
  date: 'date',
  vendorId: 'vendorId',
  purchaseBillId: 'purchaseBillId',
  companyId: 'companyId',
  totalAmount: 'totalAmount',
  reason: 'reason',
  status: 'status',
  customFields: 'customFields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PurchasereturnitemScalarFieldEnum = {
  id: 'id',
  purchaseReturnId: 'purchaseReturnId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ReceiptScalarFieldEnum = {
  id: 'id',
  receiptNumber: 'receiptNumber',
  date: 'date',
  customerId: 'customerId',
  invoiceId: 'invoiceId',
  amount: 'amount',
  paymentMode: 'paymentMode',
  referenceNumber: 'referenceNumber',
  companyId: 'companyId',
  cashBankAccountId: 'cashBankAccountId',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  discountAmount: 'discountAmount',
  discountLedgerId: 'discountLedgerId',
  customFields: 'customFields'
};

exports.Prisma.SalesorderScalarFieldEnum = {
  id: 'id',
  orderNumber: 'orderNumber',
  date: 'date',
  expectedDate: 'expectedDate',
  customerId: 'customerId',
  quotationId: 'quotationId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  taxAmount: 'taxAmount',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  totalAmount: 'totalAmount',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  billingName: 'billingName',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingZipCode: 'billingZipCode',
  billingCountry: 'billingCountry',
  shippingName: 'shippingName',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  shippingCountry: 'shippingCountry',
  customFields: 'customFields'
};

exports.Prisma.SalesorderitemScalarFieldEnum = {
  id: 'id',
  orderId: 'orderId',
  productId: 'productId',
  serviceId: 'serviceId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  warehouseId: 'warehouseId'
};

exports.Prisma.SalesquotationScalarFieldEnum = {
  id: 'id',
  quotationNumber: 'quotationNumber',
  date: 'date',
  expiryDate: 'expiryDate',
  customerId: 'customerId',
  companyId: 'companyId',
  subtotal: 'subtotal',
  discountAmount: 'discountAmount',
  overallDiscount: 'overallDiscount',
  overallDiscountType: 'overallDiscountType',
  taxAmount: 'taxAmount',
  totalAmount: 'totalAmount',
  status: 'status',
  notes: 'notes',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  billingName: 'billingName',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingZipCode: 'billingZipCode',
  shippingName: 'shippingName',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingZipCode: 'shippingZipCode',
  customFields: 'customFields'
};

exports.Prisma.SalesquotationitemScalarFieldEnum = {
  id: 'id',
  quotationId: 'quotationId',
  productId: 'productId',
  serviceId: 'serviceId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  discount: 'discount',
  amount: 'amount',
  taxRate: 'taxRate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  warehouseId: 'warehouseId'
};

exports.Prisma.SalesreturnScalarFieldEnum = {
  id: 'id',
  returnNumber: 'returnNumber',
  date: 'date',
  customerId: 'customerId',
  invoiceId: 'invoiceId',
  companyId: 'companyId',
  totalAmount: 'totalAmount',
  reason: 'reason',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  autoVoucherNo: 'autoVoucherNo',
  manualVoucherNo: 'manualVoucherNo',
  status: 'status',
  customFields: 'customFields'
};

exports.Prisma.SalesreturnitemScalarFieldEnum = {
  id: 'id',
  salesReturnId: 'salesReturnId',
  productId: 'productId',
  warehouseId: 'warehouseId',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ServiceScalarFieldEnum = {
  id: 'id',
  name: 'name',
  sku: 'sku',
  description: 'description',
  uomId: 'uomId',
  price: 'price',
  taxRate: 'taxRate',
  allowInInvoices: 'allowInInvoices',
  remarks: 'remarks',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StockScalarFieldEnum = {
  id: 'id',
  warehouseId: 'warehouseId',
  productId: 'productId',
  quantity: 'quantity',
  minOrderQty: 'minOrderQty',
  initialQty: 'initialQty',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  reservedQuantity: 'reservedQuantity'
};

exports.Prisma.StocktransferScalarFieldEnum = {
  id: 'id',
  voucherNo: 'voucherNo',
  manualVoucherNo: 'manualVoucherNo',
  date: 'date',
  toWarehouseId: 'toWarehouseId',
  narration: 'narration',
  totalAmount: 'totalAmount',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.StocktransferitemScalarFieldEnum = {
  id: 'id',
  stockTransferId: 'stockTransferId',
  productId: 'productId',
  fromWarehouseId: 'fromWarehouseId',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  narration: 'narration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TransactionScalarFieldEnum = {
  id: 'id',
  date: 'date',
  debitLedgerId: 'debitLedgerId',
  creditLedgerId: 'creditLedgerId',
  amount: 'amount',
  narration: 'narration',
  voucherType: 'voucherType',
  voucherNumber: 'voucherNumber',
  companyId: 'companyId',
  journalEntryId: 'journalEntryId',
  invoiceId: 'invoiceId',
  purchaseBillId: 'purchaseBillId',
  receiptId: 'receiptId',
  paymentId: 'paymentId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  posInvoiceId: 'posInvoiceId',
  signature: 'signature',
  logo: 'logo',
  customFields: 'customFields'
};

exports.Prisma.UomScalarFieldEnum = {
  id: 'id',
  category: 'category',
  unitName: 'unitName',
  symbol: 'symbol',
  weightPerUnit: 'weightPerUnit',
  uomType: 'uomType',
  baseUnitId: 'baseUnitId',
  conversionRate: 'conversionRate',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  password: 'password',
  role: 'role',
  roleId: 'roleId',
  loginEnabled: 'loginEnabled',
  companyId: 'companyId',
  avatar: 'avatar',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VendorScalarFieldEnum = {
  id: 'id',
  name: 'name',
  nameArabic: 'nameArabic',
  companyName: 'companyName',
  companyLocation: 'companyLocation',
  profileImage: 'profileImage',
  anyFile: 'anyFile',
  accountType: 'accountType',
  balanceType: 'balanceType',
  accountName: 'accountName',
  accountBalance: 'accountBalance',
  creationDate: 'creationDate',
  bankAccountNumber: 'bankAccountNumber',
  bankIFSC: 'bankIFSC',
  bankNameBranch: 'bankNameBranch',
  phone: 'phone',
  email: 'email',
  creditPeriod: 'creditPeriod',
  gstNumber: 'gstNumber',
  gstEnabled: 'gstEnabled',
  billingName: 'billingName',
  billingPhone: 'billingPhone',
  billingAddress: 'billingAddress',
  billingCity: 'billingCity',
  billingState: 'billingState',
  billingCountry: 'billingCountry',
  billingZipCode: 'billingZipCode',
  shippingSameAsBilling: 'shippingSameAsBilling',
  shippingName: 'shippingName',
  shippingPhone: 'shippingPhone',
  shippingAddress: 'shippingAddress',
  shippingCity: 'shippingCity',
  shippingState: 'shippingState',
  shippingCountry: 'shippingCountry',
  shippingZipCode: 'shippingZipCode',
  companyId: 'companyId',
  ledgerId: 'ledgerId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.WarehouseScalarFieldEnum = {
  id: 'id',
  name: 'name',
  location: 'location',
  addressLine1: 'addressLine1',
  addressLine2: 'addressLine2',
  city: 'city',
  state: 'state',
  postalCode: 'postalCode',
  country: 'country',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VoucherScalarFieldEnum = {
  id: 'id',
  voucherNumber: 'voucherNumber',
  voucherType: 'voucherType',
  date: 'date',
  companyId: 'companyId',
  companyName: 'companyName',
  logo: 'logo',
  paidFromLedgerId: 'paidFromLedgerId',
  paidToLedgerId: 'paidToLedgerId',
  paidFromAccount: 'paidFromAccount',
  paidToParty: 'paidToParty',
  vendorId: 'vendorId',
  customerId: 'customerId',
  subtotal: 'subtotal',
  totalAmount: 'totalAmount',
  notes: 'notes',
  signature: 'signature',
  customFields: 'customFields',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.VoucheritemScalarFieldEnum = {
  id: 'id',
  voucherId: 'voucherId',
  productId: 'productId',
  productName: 'productName',
  ledgerName: 'ledgerName',
  ledgerId: 'ledgerId',
  description: 'description',
  quantity: 'quantity',
  rate: 'rate',
  amount: 'amount',
  debit: 'debit',
  credit: 'credit',
  narration: 'narration',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.RoleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  permissions: 'permissions',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.ShippingaddressScalarFieldEnum = {
  id: 'id',
  name: 'name',
  phone: 'phone',
  address: 'address',
  city: 'city',
  state: 'state',
  country: 'country',
  zipCode: 'zipCode',
  isDefault: 'isDefault',
  customerId: 'customerId',
  vendorId: 'vendorId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Inventory_batchScalarFieldEnum = {
  id: 'id',
  productId: 'productId',
  warehouseId: 'warehouseId',
  purchaseBillId: 'purchaseBillId',
  qtyReceived: 'qtyReceived',
  qtyRemaining: 'qtyRemaining',
  rate: 'rate',
  batchNumber: 'batchNumber',
  expiryDate: 'expiryDate',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Inventory_consumptionScalarFieldEnum = {
  id: 'id',
  invoiceId: 'invoiceId',
  productId: 'productId',
  batchId: 'batchId',
  qtyUsed: 'qtyUsed',
  rateUsed: 'rateUsed',
  totalCost: 'totalCost',
  createdAt: 'createdAt'
};

exports.Prisma.ReceiptinvoiceallocationScalarFieldEnum = {
  id: 'id',
  receiptId: 'receiptId',
  invoiceId: 'invoiceId',
  amount: 'amount',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PaymentbillallocationScalarFieldEnum = {
  id: 'id',
  paymentId: 'paymentId',
  purchaseBillId: 'purchaseBillId',
  amount: 'amount',
  companyId: 'companyId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.Transaction_numberingScalarFieldEnum = {
  id: 'id',
  companyId: 'companyId',
  transactionType: 'transactionType',
  prefix: 'prefix',
  currentNumber: 'currentNumber',
  paddingLength: 'paddingLength',
  pattern: 'pattern',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.AuditlogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  userEmail: 'userEmail',
  userName: 'userName',
  action: 'action',
  entity: 'entity',
  entityId: 'entityId',
  details: 'details',
  companyId: 'companyId',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};
exports.accountgroup_type = exports.$Enums.accountgroup_type = {
  ASSETS: 'ASSETS',
  LIABILITIES: 'LIABILITIES',
  INCOME: 'INCOME',
  EXPENSES: 'EXPENSES',
  EQUITY: 'EQUITY'
};

exports.banktransaction_transactionType = exports.$Enums.banktransaction_transactionType = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  TRANSFER: 'TRANSFER'
};

exports.deliverychallan_status = exports.$Enums.deliverychallan_status = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED'
};

exports.expenseentry_expenseType = exports.$Enums.expenseentry_expenseType = {
  DIRECT: 'DIRECT',
  INDIRECT: 'INDIRECT'
};

exports.expenseentry_paymentMode = exports.$Enums.expenseentry_paymentMode = {
  CASH: 'CASH',
  BANK: 'BANK',
  CARD: 'CARD',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER'
};

exports.incomeentry_incomeType = exports.$Enums.incomeentry_incomeType = {
  PRODUCT_SALES: 'PRODUCT_SALES',
  SERVICE_INCOME: 'SERVICE_INCOME',
  OTHER_INCOME: 'OTHER_INCOME'
};

exports.incomeentry_paymentMode = exports.$Enums.incomeentry_paymentMode = {
  CASH: 'CASH',
  BANK: 'BANK',
  CARD: 'CARD',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER'
};

exports.inventoryadjustment_type = exports.$Enums.inventoryadjustment_type = {
  ADD_STOCK: 'ADD_STOCK',
  REMOVE_STOCK: 'REMOVE_STOCK',
  ADJUST_VALUE: 'ADJUST_VALUE'
};

exports.inventorytransaction_type = exports.$Enums.inventorytransaction_type = {
  OPENING_STOCK: 'OPENING_STOCK',
  TRANSFER: 'TRANSFER',
  ADJUSTMENT: 'ADJUSTMENT',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN: 'RETURN',
  GRN: 'GRN'
};

exports.invoice_status = exports.$Enums.invoice_status = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED'
};

exports.payment_paymentMode = exports.$Enums.payment_paymentMode = {
  CASH: 'CASH',
  BANK: 'BANK',
  CARD: 'CARD',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER'
};

exports.purchasebill_status = exports.$Enums.purchasebill_status = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED'
};

exports.purchaseorder_status = exports.$Enums.purchaseorder_status = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

exports.purchasequotation_status = exports.$Enums.purchasequotation_status = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED'
};

exports.purchasereturn_status = exports.$Enums.purchasereturn_status = {
  Pending: 'Pending',
  Processed: 'Processed',
  Rejected: 'Rejected',
  Draft: 'Draft'
};

exports.receipt_paymentMode = exports.$Enums.receipt_paymentMode = {
  CASH: 'CASH',
  BANK: 'BANK',
  CARD: 'CARD',
  UPI: 'UPI',
  CHEQUE: 'CHEQUE',
  OTHER: 'OTHER'
};

exports.salesorder_status = exports.$Enums.salesorder_status = {
  PENDING: 'PENDING',
  PARTIAL: 'PARTIAL',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED'
};

exports.salesquotation_status = exports.$Enums.salesquotation_status = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED'
};

exports.salesreturn_status = exports.$Enums.salesreturn_status = {
  Pending: 'Pending',
  Processed: 'Processed',
  Rejected: 'Rejected',
  Draft: 'Draft'
};

exports.transaction_voucherType = exports.$Enums.transaction_voucherType = {
  JOURNAL: 'JOURNAL',
  SALES: 'SALES',
  PURCHASE: 'PURCHASE',
  RECEIPT: 'RECEIPT',
  PAYMENT: 'PAYMENT',
  CONTRA: 'CONTRA',
  EXPENSE: 'EXPENSE',
  INCOME: 'INCOME',
  QUOTATION: 'QUOTATION',
  SALES_ORDER: 'SALES_ORDER',
  DELIVERY_CHALLAN: 'DELIVERY_CHALLAN',
  SALES_RETURN: 'SALES_RETURN',
  CREDIT_NOTE: 'CREDIT_NOTE',
  DEBIT_NOTE: 'DEBIT_NOTE',
  PURCHASE_QUOTATION: 'PURCHASE_QUOTATION',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  GRN: 'GRN',
  PURCHASE_RETURN: 'PURCHASE_RETURN',
  POS_INVOICE: 'POS_INVOICE'
};

exports.voucher_type = exports.$Enums.voucher_type = {
  EXPENSE: 'EXPENSE',
  INCOME: 'INCOME',
  CONTRA: 'CONTRA',
  JOURNAL: 'JOURNAL'
};

exports.Prisma.ModelName = {
  accountgroup: 'accountgroup',
  accountsubgroup: 'accountsubgroup',
  bankaccount: 'bankaccount',
  banktransaction: 'banktransaction',
  category: 'category',
  company: 'company',
  customer: 'customer',
  dashboardannouncement: 'dashboardannouncement',
  deliverychallan: 'deliverychallan',
  deliverychallanitem: 'deliverychallanitem',
  expenseentry: 'expenseentry',
  goodsreceiptnote: 'goodsreceiptnote',
  goodsreceiptnoteitem: 'goodsreceiptnoteitem',
  incomeentry: 'incomeentry',
  inventoryadjustment: 'inventoryadjustment',
  inventoryadjustmentitem: 'inventoryadjustmentitem',
  inventorytransaction: 'inventorytransaction',
  invoice: 'invoice',
  invoiceitem: 'invoiceitem',
  journalentry: 'journalentry',
  ledger: 'ledger',
  passwordrequest: 'passwordrequest',
  payment: 'payment',
  paymentrecord: 'paymentrecord',
  plan: 'plan',
  planrequest: 'planrequest',
  posinvoice: 'posinvoice',
  posinvoiceitem: 'posinvoiceitem',
  product: 'product',
  purchasebill: 'purchasebill',
  purchasebillitem: 'purchasebillitem',
  purchaseorder: 'purchaseorder',
  purchaseorderitem: 'purchaseorderitem',
  purchasequotation: 'purchasequotation',
  purchasequotationitem: 'purchasequotationitem',
  purchasereturn: 'purchasereturn',
  purchasereturnitem: 'purchasereturnitem',
  receipt: 'receipt',
  salesorder: 'salesorder',
  salesorderitem: 'salesorderitem',
  salesquotation: 'salesquotation',
  salesquotationitem: 'salesquotationitem',
  salesreturn: 'salesreturn',
  salesreturnitem: 'salesreturnitem',
  service: 'service',
  stock: 'stock',
  stocktransfer: 'stocktransfer',
  stocktransferitem: 'stocktransferitem',
  transaction: 'transaction',
  uom: 'uom',
  user: 'user',
  vendor: 'vendor',
  warehouse: 'warehouse',
  voucher: 'voucher',
  voucheritem: 'voucheritem',
  role: 'role',
  shippingaddress: 'shippingaddress',
  inventory_batch: 'inventory_batch',
  inventory_consumption: 'inventory_consumption',
  receiptinvoiceallocation: 'receiptinvoiceallocation',
  paymentbillallocation: 'paymentbillallocation',
  transaction_numbering: 'transaction_numbering',
  auditlog: 'auditlog'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
