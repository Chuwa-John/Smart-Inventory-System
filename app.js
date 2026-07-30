import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";

const state = {
  products: [],
  cart: [],
  paymentMethod: "cash",
  discountType: "none",
  discountValue: 0,
  sortKey: "name",
  sortDirection: 1,
  authMode: "signup",
  firebaseReady: false,
  db: null,
  auth: null,
  user: null,
  unsubscribeProducts: null,
  pendingBusinessName: "",
  cachedProfile: null,
  chatHistory: [],
  cartHistory: [],
  lastSale: null,
  sales: [],
  unsubscribeSales: null,
  salesRangePreset: "month",
  salesRangeFrom: "",
  salesRangeTo: "",
  stores: [],
  currentStoreId: "",
  unsubscribeStores: null,
  staff: [],
  unsubscribeStaff: null,
  selectedStaffId: "",
  members: [],
  unsubscribeMembers: null,
  pendingInviteLinkToken: "",
  pendingInviteRoleLabel: "",
  businessOwnerUid: "",
  currentUserRole: null,
  // Epoch ms when the anonymise-and-purge becomes due, or null when the tenant
  // is active. Read from users/{ownerUid}.deletionScheduledFor at sign-in.
  deletionScheduledFor: null,
  pendingTransferProductId: null,
  pendingRestockProductId: null,
  stockAlertPopupEnabled: true,
  overridePasswordSet: false,
  overridePasswordNudgeDismissed: false,
  productsInitialized: false,
  stockAlertQueue: [],
  stockAlertPopupOpen: false,
  language: localStorage.getItem("dukasmart:lang") || localStorage.getItem("sanitaryflow:lang") || "en",
  monthlyReports: [],
  unsubscribeMonthlyReports: null,
  reportMonthSelection: new Date().toISOString().slice(0, 7),
  openMonthlyReportId: null,
  barcodeScanTarget: null,
  barcodeScannerInstance: null,
  lastReceiptSale: null,
  pendingReturnSaleId: null,
  purchaseOrderGroups: [],
  customers: [],
  unsubscribeCustomers: null,
  pendingPaymentCustomerId: null,
  transfers: [],
  unsubscribeTransfers: null,
  productMovementProductId: null,
  lastActivityAt: Date.now(),
  idleCheckIntervalId: null
};

const MAX_CHAT_HISTORY = 20;
let cachedStoreProducts = null;
let cachedStoreProductsSource = null;
let cachedStoreProductsStoreId = null;
let scheduledRenderFrame = null;
let aiProxyWarmupTriggered = false;

const BUSINESS_TYPE_OPTIONS = [
  { key: "duka", en: "Duka / General store", sw: "Duka la Jumla" },
  { key: "salon", en: "Salon / Beauty", sw: "Saluni" },
  { key: "hardware", en: "Hardware store", sw: "Duka la Vifaa vya Ujenzi" },
  { key: "pharmacy", en: "Pharmacy", sw: "Famasi" },
  { key: "bar", en: "Bar / Restaurant", sw: "Baa / Mkahawa" },
  { key: "general", en: "Other / General merchandise", sw: "Nyingine / Jumla" }
];

const CATEGORY_TEMPLATES = {
  duka: ["Groceries", "Beverages", "Snacks", "Household Items", "Toiletries", "Airtime & Data", "Cleaning Supplies", "Cooking Oil & Fats", "Grains & Flour"],
  salon: ["Hair Products", "Skin Care", "Nail Products", "Salon Tools & Equipment", "Extensions & Wigs", "Cosmetics"],
  hardware: ["Tools", "Plumbing Supplies", "Electrical Supplies", "Paints & Coatings", "Fasteners & Fittings", "Building Materials"],
  pharmacy: ["Prescription Medicine", "Over-the-Counter Medicine", "First Aid", "Baby & Maternal Care", "Vitamins & Supplements", "Medical Devices"],
  bar: ["Beer", "Spirits", "Wine", "Soft Drinks", "Snacks & Bites", "Bar Supplies"],
  general: []
};

// NOTE: Swahili strings below are machine-assisted, not reviewed by a native
// speaker. Please have a fluent Swahili speaker verify before production use.
const QUESTION_TEMPLATES = {
  duka: [
    { label: { en: "Restock soon", sw: "Agiza upya" }, question: { en: "Which fast-moving items should I restock soon?", sw: "Ni bidhaa gani zinazouzwa haraka ninazopaswa kuagiza tena hivi karibuni?" } },
    { label: { en: "Slow movers", sw: "Zinazouzwa polepole" }, question: { en: "What slow-moving stock should I discount or stop ordering?", sw: "Ni hisa gani inayouzwa polepole ninayopaswa kupunguza bei au kuacha kuagiza?" } },
    { label: { en: "Top suppliers", sw: "Wasambazaji wakuu" }, question: { en: "Which suppliers do I rely on most?", sw: "Ninategemea zaidi wasambazaji gani?" } },
    { label: { en: "Reorder plan", sw: "Mpango wa kuagiza" }, question: { en: "What should I reorder this week?", sw: "Nini ninapaswa kuagiza tena wiki hii?" } }
  ],
  salon: [
    { label: { en: "Low stock", sw: "Hisa chache" }, question: { en: "Which hair or skin products are almost out of stock?", sw: "Ni bidhaa gani za nywele au ngozi zinazokaribia kuisha?" } },
    { label: { en: "Promote this week", sw: "Tangaza wiki hii" }, question: { en: "What retail products should I promote to clients this week?", sw: "Ni bidhaa gani za rejareja ninazopaswa kutangaza kwa wateja wiki hii?" } },
    { label: { en: "Tools to reorder", sw: "Vifaa vya kuagiza" }, question: { en: "Which salon tools or equipment need reordering?", sw: "Ni vifaa gani vya saluni vinavyohitaji kuagizwa tena?" } },
    { label: { en: "Best category", sw: "Aina bora" }, question: { en: "What's my best-selling product category?", sw: "Ni aina gani ya bidhaa inayouzwa zaidi?" } }
  ],
  hardware: [
    { label: { en: "Running low", sw: "Vinavyopungua" }, question: { en: "Which tools or materials are running low?", sw: "Ni zana au vifaa gani vinavyopungua?" } },
    { label: { en: "Before next job", sw: "Kabla ya kazi" }, question: { en: "What building materials should I reorder before the next big job?", sw: "Ni vifaa gani vya ujenzi ninavyopaswa kuagiza kabla ya kazi kubwa ijayo?" } },
    { label: { en: "Long lead times", sw: "Muda mrefu wa usambazaji" }, question: { en: "Which products have long supplier lead times I should plan around?", sw: "Ni bidhaa gani zenye muda mrefu wa usambazaji ninazopaswa kuzipangia mapema?" } },
    { label: { en: "Slow movers", sw: "Zinazouzwa polepole" }, question: { en: "What slow-moving stock is tying up my shelf space?", sw: "Ni hisa gani inayouzwa polepole inayochukua nafasi ya rafu?" } }
  ],
  pharmacy: [
    { label: { en: "Meds running low", sw: "Dawa chache" }, question: { en: "Which medicines are close to running out?", sw: "Ni dawa gani zinazokaribia kuisha?" } },
    { label: { en: "Fastest OTC", sw: "OTC za haraka" }, question: { en: "What over-the-counter products sell fastest?", sw: "Ni bidhaa gani zisizohitaji dawa za daktari zinazouzwa haraka zaidi?" } },
    { label: { en: "Urgent Rx reorder", sw: "Rx za haraka" }, question: { en: "Which prescription items need urgent reorder?", sw: "Ni dawa gani za agizo la daktari zinazohitaji kuagizwa tena haraka?" } },
    { label: { en: "Stockout risk", sw: "Hatari ya kuisha" }, question: { en: "What's my stockout risk this week?", sw: "Hatari yangu ya kuishiwa na hisa ni kiasi gani wiki hii?" } }
  ],
  bar: [
    { label: { en: "Low stock drinks", sw: "Vinywaji vichache" }, question: { en: "Which drinks are almost out of stock?", sw: "Ni vinywaji gani vinavyokaribia kuisha?" } },
    { label: { en: "Best seller", sw: "Kinachouzwa zaidi" }, question: { en: "What's my best-selling drink this month?", sw: "Ni kinywaji gani kinachouzwa zaidi mwezi huu?" } },
    { label: { en: "Bar supplies", sw: "Vifaa vya baa" }, question: { en: "Which bar supplies do I need to reorder?", sw: "Ni vifaa gani vya baa ninavyohitaji kuagiza tena?" } },
    { label: { en: "Slow movers", sw: "Zinazouzwa polepole" }, question: { en: "What slow-moving stock should I stop ordering?", sw: "Ni hisa gani inayouzwa polepole ninayopaswa kuacha kuagiza?" } }
  ],
  general: [
    { label: { en: "Stockout risk", sw: "Hatari ya kuisha" }, question: { en: "Which products will run out soon?", sw: "Ni bidhaa gani zitakazoisha hivi karibuni?" } },
    { label: { en: "Reorder plan", sw: "Mpango wa kuagiza" }, question: { en: "What should I reorder this week?", sw: "Nini ninapaswa kuagiza tena wiki hii?" } },
    { label: { en: "Highest stock", sw: "Hisa nyingi zaidi" }, question: { en: "Which products have the most stock?", sw: "Ni bidhaa gani zenye hisa nyingi zaidi?" } },
    { label: { en: "No sales recorded", sw: "Hakuna mauzo" }, question: { en: "Which products have no sales recorded?", sw: "Ni bidhaa gani hazina mauzo yaliyorekodiwa?" } }
  ]
};

const BUSINESS_TIPS = {
  duka: { en: "For general stores, focus on keeping fast-moving grocery and household items in stock \u2014 stockouts on daily basics send customers to competitors.", sw: "Kwa maduka ya jumla, zingatia kuweka bidhaa za nyumbani na vyakula zinazouzwa haraka \u2014 kuishiwa na bidhaa za kila siku huwapeleka wateja kwa washindani." },
  salon: { en: "For salons, retail products (not just service supplies) often carry the best margins \u2014 keep your top sellers visible and in stock.", sw: "Kwa saluni, bidhaa za rejareja (si tu vifaa vya huduma) mara nyingi huwa na faida kubwa \u2014 hakikisha zinazouzwa zaidi zinaonekana na zipo." },
  hardware: { en: "For hardware stores, plan reorders around supplier lead times \u2014 building materials often take longer to restock than everyday items.", sw: "Kwa maduka ya vifaa vya ujenzi, panga kuagiza tena kulingana na muda wa usambazaji \u2014 vifaa vya ujenzi mara nyingi huchukua muda mrefu kuliko bidhaa za kawaida." },
  pharmacy: { en: "For pharmacies, prioritize prescription and first-aid items in your reorder plan \u2014 stockouts here directly affect customer health needs.", sw: "Kwa famasi, zingatia dawa za agizo la daktari na huduma ya kwanza katika mpango wako wa kuagiza \u2014 kuishiwa hapa kunaathiri moja kwa moja mahitaji ya afya ya wateja." },
  bar: { en: "For bars and restaurants, track your best-selling drinks closely \u2014 running out of a popular item on a busy night costs real revenue.", sw: "Kwa baa na mikahawa, fuatilia kwa karibu vinywaji vinavyouzwa zaidi \u2014 kuishiwa na kinywaji maarufu usiku wa shughuli nyingi hupoteza mapato halisi." },
  general: { en: "Keep an eye on both your fastest and slowest movers \u2014 reorder the former promptly and reconsider stocking the latter.", sw: "Angalia bidhaa zinazouzwa haraka na zile zinazouzwa polepole \u2014 agiza tena za haraka mapema na fikiria upya kuhusu zile za polepole." }
};

function currentBusinessType() {
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  return store?.businessType || "general";
}

function currentCurrencyCode() {
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  return store?.currencyCode || "TZS";
}

function money(amount) {
  return `${currentCurrencyCode()} ${Number(amount || 0).toLocaleString()}`;
}

function moneyForStore(amount, storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  const code = store?.currencyCode || "TZS";
  return `${code} ${Number(amount || 0).toLocaleString()}`;
}

function paymentMethodLabel(method) {
  return t(`pos.${method}`);
}

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

// NOTE: Swahili strings below are machine-assisted using standard East African
// business/retail terminology, not reviewed by a native speaker. Please have a
// fluent Swahili speaker verify before relying on this in production.
const DICTIONARY = {
  en: {
    "nav.dashboard": "Dashboard", "nav.inventory": "Inventory", "nav.pos": "Point of Sale",
    "nav.reports": "Reports", "nav.ai": "AI Advisor",
    "brand.tagline": "AI Inventory ERP",
    "sidebar.connectionHintSignedOut": "Sign in to sync inventory",
    "topbar.searchPlaceholder": "Search your products...",
    "topbar.signOut": "Sign out", "topbar.addProduct": "Add Product", "topbar.langToggle": "Kiswahili",
    "dashboard.eyebrowToday": "Today", "dashboard.title": "Operations Command Center",
    "dashboard.addStore": "+ Store", "dashboard.analyticsEyebrow": "Inventory analytics",
    "dashboard.stockLevelsTitle": "Stock levels", "dashboard.chartQuantity": "Quantity",
    "dashboard.alertsEyebrow": "Smart alerts", "dashboard.needsAttention": "Needs attention",
    "dashboard.popupAlerts": "Popup alerts", "dashboard.movementTitle": "Movement classes",
    "dashboard.aiEngineEyebrow": "AI reorder engine", "dashboard.recommendationsTitle": "Purchase recommendations",
    "inventory.eyebrow": "Stock control", "inventory.title": "Inventory Management",
    "inventory.exportCsv": "Export CSV", "inventory.addProduct": "Add Product",
    "inventory.stockAll": "All stock states", "inventory.stockLow": "Low stock",
    "inventory.stockOut": "Out of stock", "inventory.stockHealthy": "Healthy",
    "inventory.thProduct": "Product", "inventory.thCategory": "Category", "inventory.thBrand": "Brand",
    "inventory.thSupplier": "Supplier", "inventory.thQty": "Qty", "inventory.thStatus": "Status",
    "inventory.thActions": "Actions",
    "pos.eyebrow": "Fast checkout", "pos.title": "Point of Sale", "pos.productSearch": "Product Search",
    "pos.searchPlaceholder": "Search products", "pos.currentSale": "Current Sale",
    "pos.undoAction": "Undo Last Action", "pos.clearCart": "Clear Cart", "pos.total": "Total",
    "pos.cash": "Cash", "pos.mobile": "Mobile Money", "pos.card": "Card",
    "pos.amountTendered": "Amount tendered", "pos.tenderedPlaceholder": "Enter cash received",
    "pos.changeDue": "Change due", "pos.completeSale": "Complete Sale", "pos.undoSale": "Undo Last Sale",
    "pos.staffLabel": "Staff member", "pos.selectStaffPlaceholder": "Select staff",
    "pos.addStaff": "+ Staff", "pos.removeStaff": "Remove Staff",
    "pos.orderNumberLabel": "Order number (from sales sheet)", "pos.orderNumberPlaceholder": "e.g. 8097",
    "reports.staffBreakdownTitle": "Sales by Staff", "reports.staffColumn": "Staff",
    "reports.ordersColumn": "Orders", "reports.allStaffRow": "All staff",
    "reports.searchOrderPlaceholder": "Search order number", "reports.orderNotFound": "No sale found for that order number.",
    "reports.orderFoundLabel": "Order #{orderNumber} \u2014 {name}, {date}, {method}, {total}",
    "reports.staffOrderLookupTitle": "Order Lookup",
    "reports.staffOrderLookupDateLabel": "Date",
    "reports.staffOrderLookupOrderLabel": "Order number",
    "reports.staffOrderLookupButton": "Find Order",
    "reports.staffOrderLookupEmpty": "Select a staff member, date, and order number, then click Find Order.",
    "reports.staffOrderLookupNotFound": "No matching order found for that staff member, date, and order number.",
    "reports.staffOrderLookupTimeLabel": "Time",
    "reports.staffOrderLookupPaymentLabel": "Payment Method",
    "reports.staffOrderLookupTotalLabel": "Order Total",
    "reports.staffOrderLookupColItem": "Item",
    "reports.staffOrderLookupColQty": "Qty",
    "reports.staffOrderLookupColUnitPrice": "Unit Price",
    "reports.staffOrderLookupColLineTotal": "Line Total",
    "reports.dailyStaffReportTitle": "Daily Staff Report",
    "reports.dailyStaffReportButton": "Generate Daily Report",
    "reports.dailyStaffReportEmpty": "Choose a date and click Generate Daily Report.",
    "reports.dailyStaffReportNoSales": "No sales recorded for this date.",
    "reports.dailyStaffReportItemsLabel": "Items",
    "reports.dailyStaffReportOrderColumn": "Order #",
    "reports.dailyStaffReportGrandTotal": "Grand Total (All Staff)",
    "reports.staffOrderLookupAllButton": "Generate All Orders",
    "reports.staffOrderLookupNoOrders": "No orders found for this staff member.",
    "reports.staffOrderLookupSelectStaffDate": "Select a staff member and date first.",
    "reports.eyebrow": "Business intelligence", "reports.title": "Reports",
    "reports.financialEyebrow": "Financial tracking", "reports.salesTitle": "Sales & Payment Reports",
    "reports.rangeToday": "Today", "reports.rangeWeek": "This week", "reports.rangeMonth": "This month",
    "reports.rangeAll": "All time", "reports.rangeCustom": "Custom range",
    "reports.from": "From", "reports.to": "To", "reports.exportCsv": "Export CSV", "reports.exportPdf": "Export PDF",
    "ai.eyebrow": "Smart insights", "ai.title": "Ask About Your Business",
    "ai.questionPlaceholder": "Ask about your inventory, stock levels, sales, or forecasts...",
    "ai.askButton": "Ask AI Advisor", "ai.conversation": "Conversation", "ai.clear": "Clear",
    "product.nameLabel": "Product name", "product.categoryLabel": "Category", "product.brandLabel": "Brand",
    "product.supplierLabel": "Suppliers", "product.quantityLabel": "Quantity",
    "product.priceLabel": "Selling price", "product.priceTypeLabel": "Price type",
    "product.priceFixed": "Fixed price", "product.priceDynamic": "Flexible / dynamic price",
    "product.reorderLabel": "Low stock threshold", "product.reorderPlaceholder": "e.g. 10",
    "product.cancel": "Cancel", "product.save": "Save Product",
    "auth.eyebrow": "Account access",
    "auth.copy": "Create an account or sign in to manage your own inventory, stock levels, sales, and AI recommendations.",
    "auth.businessName": "Business name", "auth.email": "Email", "auth.password": "Password", "auth.forgotPassword": "Forgot password?",
    "auth.confirmPassword": "Confirm password",
    "auth.consentPrefix": "I agree to the", "auth.consentTerms": "Terms & Conditions",
    "auth.consentAnd": "and", "auth.consentPrivacy": "Privacy Policy", "auth.consentSuffix": ".",
    "auth.whyTitle": "Why DukaSmart",
    "auth.whyMultiStore": "Track inventory across every branch from one dashboard.",
    "auth.whyOffline": "Keep selling even when the internet drops \u2014 it syncs automatically once you're back online.",
    "auth.whyReceipts": "Print or share receipts on WhatsApp, with cash, mobile money, and card tracking built in.",
    "auth.whyAi": "Ask the built-in AI Advisor which products to reorder, in English or Swahili.",
    "stockAlert.title": "Stock Alert", "stockAlert.ok": "OK",
    "command.placeholder": "Type a command or module name",
    "dialog.overridePasswordPrompt": "Enter the price override password:",
    "settings.overridePasswordOpenButton": "Discount Password",
    "settings.overridePasswordTitle": "Discount Override Password",
    "settings.overridePasswordDescription": "Set a password staff must enter to apply discounts or price overrides. Only you can see or change it.",
    "settings.overridePasswordTitleCreate": "Create Discount Password",
    "settings.overridePasswordTitleChange": "Change Discount Password",
    "settings.overridePasswordDescriptionCreate": "Choose a password your staff must enter to apply a discount or price override. You have not set one yet, so just pick a new password below. Only you can change it later.",
    "settings.overridePasswordDescriptionChange": "Enter your current discount password, then choose a new one. Only you can change it.",
    "settings.overridePasswordCreateButton": "Create Password",
    "settings.overridePasswordCurrentNowRequired": "This account already has a discount password. Enter the current one to change it.",
    "settings.overridePasswordCurrentLabel": "Current discount password",
    "settings.overridePasswordNewLabel": "New password",
    "settings.overridePasswordConfirmLabel": "Confirm password",
    "settings.overridePasswordReauthLabel": "Your account password",
    "settings.overridePasswordSaveButton": "Save Password",
    "settings.overridePasswordMismatch": "Passwords don't match.",
    "settings.overridePasswordTooShort": "Password must be at least 4 characters.",
    "settings.overridePasswordCurrentRequired": "Enter your current discount password.",
    "settings.overridePasswordCurrentIncorrect": "Current discount password is incorrect.",
    "settings.overridePasswordReauthRequired": "Enter your account password to confirm it's you.",
    "settings.overridePasswordReauthFailed": "Incorrect account password. Please try again.",
    "nudge.overridePasswordText": "Set a password for price discounts and overrides so only trusted staff can use them.",
    "nudge.overridePasswordSetButton": "Set it now",
    "nudge.overridePasswordDismissButton": "Dismiss",
    "dialog.newStoreNamePrompt": "New store name (e.g. Mombasa Road Branch):",
    "dialog.businessTypePrompt": "Choose a business type for this store:\n{list}\n\nEnter the number:",
    "dialog.transferDestinationPrompt": "Transfer \"{name}\" to which store?\n{list}\n\nEnter the number:",
    "dialog.transferQuantityPrompt": "How many units of \"{name}\" to transfer? (Available: {quantity})",
    "dialog.transferTitle": "Transfer Stock", "dialog.transferDestinationLabel": "Destination store",
    "dialog.transferQuantityLabel": "Quantity to transfer", "dialog.transferConfirm": "Transfer",
    "dialog.transferProductLabel": "{name} \u2014 {quantity} available at {store}",
    "restock.dialogTitle": "Restock Product",
    "restock.productLabel": "{name} \u2014 current stock: {quantity}",
    "restock.qtyLabel": "Quantity received",
    "restock.qtyPlaceholder": "e.g. 20",
    "restock.confirmButton": "Add to Stock",
    "dialog.deleteConfirm": "Delete {name} from inventory?",
    "dialog.undoSaleConfirm": "Undo the last completed sale? This will restore stock quantities.",
    "dialog.editPricePrompt": "Enter new price for {name} ({currency}):",
    "dialog.newStaffNamePrompt": "New staff member's name:",
    "dialog.removeStaffConfirm": "Remove \"{name}\" from staff? Past sales will keep their name on record.",
    "dialog.duplicateOrderConfirm": "Order #{orderNumber} is already recorded for {name}. Record it again anyway?",
    "connection.firebaseConnected": "Firebase connected",
    "connection.createAccountToBegin": "Create an account to begin",
    "connection.inventorySyncing": "Your inventory is syncing",
    "connection.signedInFallback": "Signed in",
    "verifyEmail.bannerText": "Please verify your email address to keep full access to your account.",
    "verifyEmail.resendButton": "Resend verification email",
    "txerror.sourceProductGone": "Source product no longer exists.",
    "txerror.notEnoughStockTransfer": "Not enough stock to transfer.",
    "txerror.saleNotFound": "Sale record not found; it may already be voided.",
    "txerror.saleAlreadyUndone": "This sale was already undone.",
    "txerror.itemGone": "{name} no longer exists.",
    "txerror.notEnoughStockItem": "Not enough stock for {name}. Only {quantity} left.",
    "txerror.duplicateOrderSubmission": "Order #{orderNumber} was already recorded. Check Reports before submitting again.",
    "chart.emptyPrompt": "Add products to see stock levels here.",
    "stockAlert.outOfStockDetail": "This product is out of stock (reorder level: {reorderLevel}).",
    "stockAlert.remainingDetail": "Remaining quantity: {quantity} (reorder level: {reorderLevel}).",
    "stockAlert.suggestedReorder": "Suggested reorder amount: {qty} units.",
    "stockAlert.noSuggestion": "No reorder quantity suggested yet.",
    "stockAlert.queueNoteOne": "1 more alert waiting.",
    "stockAlert.queueNoteMany": "{count} more alerts waiting.",
    "report.inventorySummary": "Inventory Summary", "report.stockQuantityReport": "Stock Quantity Report",
    "report.supplierList": "Supplier List", "report.lowStockReport": "Low Stock Report",
    "report.outOfStockReport": "Out of Stock Report", "report.csvExportCard": "CSV Export",
    "report.exportFormatsHint": "Export PDF, Excel, or CSV",
    "report.colName": "Name", "report.colCategory": "Category", "report.colBrand": "Brand",
    "report.colSupplier": "Supplier", "report.colQuantity": "Quantity",
    "report.colReorderLevel": "Reorder Level", "report.colStatus": "Status",
    "report.statusOut": "Out of stock", "report.statusLow": "Low stock", "report.statusHealthy": "Healthy",
    "storeSwitcher.allStores": "All Stores (combined)", "storeSwitcher.fallbackName": "Store",
    "ai.modeGuide": "Guide", "ai.modeClaude": "Claude", "ai.modeLocal": "Local",
    "ai.analyzing": "Analyzing inventory, sales velocity, and supplier lead times...",
    "command.openDashboard": "Open Dashboard", "command.openInventory": "Open Inventory",
    "command.openPos": "Open Point of Sale", "command.openReports": "Open Reports",
    "command.openAi": "Open AI Advisor",
    "txerror.aiRequestTimedOut": "request timed out", "txerror.aiNetworkError": "network error",
    "txerror.aiMalformedResponse": "malformed response",
    "store.defaultName": "Main Branch",
    "monthlyReport.generating": "Generating monthly report...",
    "monthlyReport.generated": "Monthly report generated.",
    "monthlyReport.noSalesData": "No sales recorded for this period yet.",
    "monthlyReport.failedGeneric": "Could not save the monthly report.",
    "monthlyReport.couldNotLoad": "Could not load monthly reports.",
    "monthlyReport.revenueLine": "For {period}: {revenue} in revenue across {count} transactions.",
    "monthlyReport.topProductsLine": "Top sellers: {list}.",
    "monthlyReport.noTopProducts": "No product sales recorded this period.",
    "monthlyReport.stockLine": "{low} products are low on stock and {out} are out of stock.",
    "monthlyReport.localFallbackNote": "(Local summary \u2014 the AI proxy was unavailable for this report.)",
    "monthlyReport.sectionEyebrow": "AI-generated",
    "monthlyReport.sectionTitle": "Monthly Reports",
    "monthlyReport.monthLabel": "Month",
    "monthlyReport.generateButton": "Generate Report",
    "monthlyReport.emptyState": "No monthly reports yet. Pick a month and generate one.",
    "monthlyReport.detailRevenue": "Revenue", "monthlyReport.detailTransactions": "Transactions",
    "monthlyReport.detailAvgSale": "Average Sale", "monthlyReport.detailUnitsSold": "Units Sold",
    "monthlyReport.detailLowStock": "Low Stock Items", "monthlyReport.detailOutOfStock": "Out of Stock Items",
    "monthlyReport.detailSummaryLabel": "Summary",
    "monthlyReport.exportPdfButton": "Export PDF",
    "reports.revenueTrendTitle": "Revenue Trend",
    "reports.revenueTrendEmpty": "No sales recorded for this period yet.",
    "localAi.headerWithQuestion": "Local recommendation for: \"{question}\"",
    "localAi.headerNoQuestion": "Local recommendation: focus this week on stock availability and clean inventory records.",
    "localAi.urgentReorder": "Urgent reorder: {list}.",
    "localAi.mostUrgent": "Most urgent: {name} is estimated to run out in {days} days.",
    "localAi.movementSummary": "Movement snapshot: {fast} fast-moving, {slow} slow-moving, {none} with no recorded sales.",
    "localAi.highestStocked": "Highest stocked products: {list}.",
    "localAi.businessTip": "Tip: {tip}",
    "localAi.supplierNote": "Supplier fields come only from products you add to this account.",
    "localAi.disclaimer": "(This advisor uses only your signed-in inventory snapshot. The AI proxy is unavailable, so this is a local, rule-based summary.)",
    "dashboard.renameStore": "Rename", "dashboard.archiveStore": "Archive", "dashboard.setBusinessType": "Business Type",
    "dialog.renameStorePrompt": "New name for this store:",
    "dialog.archiveStoreConfirm": "Archive \"{name}\"? It will be hidden from the store switcher but its history is kept.",
    "toast.selectSpecificStore": "Select a specific store first.",
    "toast.storeRenamed": "Store renamed to {name}.", "toast.couldNotRenameStore": "Could not rename store.",
    "toast.businessTypeSet": "Business type updated. Category suggestions will reflect it.",
    "toast.storeArchived": "{name} archived.", "toast.couldNotArchiveStore": "Could not archive store.",
    "toast.cannotArchiveLastStore": "You need at least one active store; archive another store first.",
    "kpi.totalProducts": "Total Products", "kpi.totalProductsDelta": "Your account",
    "kpi.totalQuantity": "Total Quantity", "kpi.totalQuantityDelta": "Units in stock",
    "kpi.categories": "Categories", "kpi.categoriesDelta": "Product groups",
    "kpi.suppliers": "Suppliers", "kpi.suppliersDelta": "From your products",
    "kpi.lowStock": "Low Stock Items", "kpi.lowStockDelta": "Reorder now",
    "kpi.outStock": "Out of Stock Items", "kpi.outStockDelta": "Urgent",
    "alert.belowMinimum": "Below minimum stock. Current stock: {quantity}.",
    "alert.allClearTitle": "All clear", "alert.allClearBody": "No low stock or out-of-stock products.",
    "rec.reorderNow": "Reorder {qty} units now.", "rec.estimatedStockout": "Estimated stockout in {days} days.",
    "movement.fastMoving": "Fast-moving products", "movement.slowMoving": "Slow-moving products",
    "movement.noSales": "No sales recorded", "movement.healthyCoverage": "Healthy stock coverage",
    "pos.available": "{quantity} available", "pos.qtyAriaLabel": "Quantity for {name}",
    "pos.pricePerUnitPlaceholder": "Price/unit", "pos.addButton": "Add",
    "cart.editPrice": "Edit price", "cart.decreaseAriaLabel": "Decrease quantity",
    "cart.qtyAriaLabel": "Edit quantity for {name}", "cart.increaseAriaLabel": "Increase quantity",
    "cart.removeAriaLabel": "Remove item", "cart.removeButton": "Remove", "cart.empty": "No items in cart.",
    "report.transaction": "transaction", "report.transactions": "transactions", "report.avg": "avg",
    "report.topItems": "Top items", "report.none": "none", "report.combinedTotal": "Combined total",
    "report.share": "share", "report.totalTransactions": "Total transactions", "report.perStoreTotals": "Per-store totals",
    "report.colPaymentMethod": "Payment Method", "report.colTransactions": "Transactions",
    "report.colTotalTZS": "Total", "report.colAvgSaleTZS": "Average Sale",
    "report.colTopItems": "Top Items", "report.combined": "Combined", "report.storePrefix": "Store: {name}",
    "tutorial.pos": "How to use Point of Sale:\n1. Open the POS tab and search or browse for a product.\n2. Set the quantity, then click Add. Products flagged as flexible/dynamic price ask for a price per unit first.\n3. Adjust quantities in the cart with +/-, the qty box, or Remove. Use Undo Last Action if you make a mistake.\n4. Pick the staff member making the sale, and enter the order number from their physical sales sheet.\n5. Pick a payment method (Cash, Mobile Money, Card). For cash, enter the amount tendered to see change due.\n6. Click Complete Sale. If you need to reverse it, use Undo Last Sale right after \u2014 stock is restored automatically.",
    "tutorial.inventory": "How to manage inventory:\n1. Go to Inventory and click Add Product (or use the Dashboard button). Fill in name, category, quantity, and selling price.\n2. Set a Low stock threshold so the product shows up in Smart alerts and reorder recommendations once it dips below that number.\n3. Choose Fixed price for normal items, or Flexible/dynamic price if the price varies per sale.\n4. Use Edit on any row to update details, or Delete to remove a product. If you have 2+ stores, Transfer moves stock between them.\n5. Use the category and stock-status filters above the table, or the search bar, to find items quickly.",
    "tutorial.reports": "How to read your reports:\n1. The Reports tab breaks sales down by payment method \u2014 cash, mobile money, and card \u2014 with totals, counts, and top items each.\n2. Pick a date range preset (today, week, month, all time) or choose Custom range for specific dates.\n3. If you're viewing All Stores, a per-store breakdown appears below the combined summary.\n4. Use Export CSV or Export PDF to save the payment report. The Inventory Summary cards further down export stock data separately.",
    "tutorial.stores": "How to work with multiple stores:\n1. Use the store switcher on the Dashboard to change which store you're viewing or working in.\n2. Click + Store to add a new branch. Once you have 2+ stores, an \"All Stores (combined)\" option appears for read-only overviews.\n3. While All Stores is selected, adding products, adding to cart, and completing sales are disabled \u2014 switch to one specific store first.\n4. Use the Transfer button on an inventory row to move stock from one store to another; matching SKUs merge automatically.",
    "chat.emptyState": "Ask a question about your inventory to get started \u2014 in any language.",
    "auth.createAccount": "Create account", "auth.signIn": "Sign in",
    "auth.haveAccount": "I already have an account", "auth.newAccount": "Create a new account",
    "auth.errorRequired": "This field is required.",
    "auth.errorEmailInvalid": "Enter a valid email address.",
    "auth.errorPasswordShort": "Password must be at least 6 characters.",
    "auth.errorPasswordMismatch": "Passwords do not match.",
    "auth.errorConsentRequired": "Please accept the Terms & Conditions and Privacy Policy.",
    "theme.light": "Light", "theme.dark": "Dark",
    "product.editTitle": "Edit Inventory Product", "product.addTitle": "Add Inventory Product",
    "inventory.edit": "Edit", "inventory.transfer": "Transfer", "inventory.restock": "Restock", "inventory.delete": "Delete",
    "inventory.emptyState": "No inventory yet. Add your first material or product to start tracking stock.",
    "toast.incorrectPassword": "Incorrect password. Price change cancelled.",
    "toast.overrideNotConfigured": "Price overrides aren't set up yet. Ask your admin to configure them.",
    "toast.overrideNetworkError": "Couldn't reach the override service. Check your connection and try again.",
    "toast.overridePasswordSaved": "Discount password saved.",
    "toast.overridePasswordSaveFailed": "Couldn't save the password. Try again.",
    "toast.nothingToUndo": "Nothing to undo.", "toast.lastCartActionUndone": "Last cart action undone.",
    "toast.pdfLibraryFailed": "PDF library did not load. Check your connection and try again.",
    "toast.excelLibraryFailed": "Excel library did not load. Check your connection and try again.",
    "toast.aiProxyUnavailable": "AI proxy unavailable ({message}). Showing local recommendation.",
    "toast.noInventoryData": "No inventory data to export yet.",
    "toast.selectStoreBeforeAdd": "Select a specific store before adding a new product.",
    "toast.productSaved": "{name} saved to inventory.",
    "toast.savedLocallyFirestoreFailed": "Saved locally. Firestore write failed.",
    "toast.needTwoStoresTransfer": "You need at least 2 stores to transfer stock.",
    "toast.signInToTransfer": "Sign in to transfer stock.",
    "toast.signInToAddStore": "Sign in to add a store.",
    "toast.invalidStoreSelection": "Invalid store selection.",
    "toast.invalidTransferQuantity": "Invalid transfer quantity.",
    "toast.transferred": "Transferred {qty} {unit} of {name} to {store}.",
    "toast.unitSingular": "unit", "toast.unitPlural": "units",
    "toast.transferFailed": "Transfer failed.",
    "toast.restockInvalidQuantity": "Enter a valid quantity to add.",
    "toast.restocked": "Added {qty} units of {name}. New stock: {quantity}.",
    "toast.restockFailed": "Could not update stock. Please try again.",
    "toast.deletedLocallyFirestoreFailed": "Deleted locally. Firestore delete failed.",
    "toast.productDeleted": "{name} deleted.",
    "toast.noRecentSale": "No recent sale to undo.", "toast.couldNotUndoSale": "Could not undo sale.",
    "toast.saleUndone": "Last sale undone and stock restored.",
    "toast.firebaseConnectionFailed": "Firebase config found, but connection failed.",
    "toast.couldNotLoadInventory": "Could not load your inventory.",
    "toast.couldNotLoadSales": "Could not load sales history.",
    "toast.couldNotCreateFirstStore": "Could not create your first store.",
    "toast.couldNotLoadStores": "Could not load your stores.",
    "toast.storeAdded": "{name} added.", "toast.couldNotCreateStore": "Could not create store.",
    "toast.signInToAddStaff": "Sign in to add staff.", "toast.staffAdded": "{name} added to staff.",
    "toast.couldNotAddStaff": "Could not add staff member.", "toast.staffRemoved": "{name} removed from staff.",
    "toast.couldNotRemoveStaff": "Could not remove staff member.", "toast.selectStaffFirst": "Select a staff member first.",
    "toast.orderNumberRequired": "Enter the order number from the sales sheet.",
    "toast.orderNumberInvalid": "Order number must contain digits only.",
    "toast.couldNotSaveAlertSetting": "Could not save alert popup setting.",
    "toast.tooManyFailedAttempts": "Too many failed attempts for this email. Please wait 15 minutes and try again.",
    "toast.accountCreated": "Account created. Add your first inventory item.",
    "toast.signedIn": "Signed in.", "toast.signedOut": "Signed out.",
    "toast.firebaseNotConnected": "Firebase is not connected yet.",
    "toast.authFailedGeneric": "Authentication failed. Check your details and try again.",
    "toast.authEmailInUse": "That email already has an account. Sign in instead.",
    "toast.authInvalidCredential": "Email or password is incorrect.",
    "toast.authWeakPassword": "Use a password with at least 6 characters.",
    "toast.authOperationNotAllowed": "Enable Email/Password sign-in in Firebase Auth.",
    "toast.passwordResetSent": "If an account exists for that email, a password reset link has been sent.",
    "toast.verificationEmailSent": "Verification email sent. Please check your inbox.",
    "toast.verificationEmailFailed": "Could not send the verification email. Please try again shortly.",
    "toast.idleSignOut": "You were signed out after a period of inactivity.",
    "toast.authTooManyRequests": "Too many attempts. Please wait a while and try again.",
    "toast.consentRequired": "Please accept the Terms & Conditions and Privacy Policy to create an account.",
    "toast.passwordMismatch": "Passwords do not match.",
    "toast.outOfStock": "This product is out of stock.",
    "toast.selectStoreToSell": "Select a specific store to make a sale.",
    "toast.enterPricePerUnit": "Enter a price per unit for this product.",
    "toast.notEnoughStockQty": "Not enough stock available for this quantity.",
    "toast.cartLimitReached": "This sale has reached the 40 line-item limit. Complete this sale and start a new one.",
    "toast.noMoreStock": "No more stock available for this product.",
    "toast.invalidPrice": "Invalid price.", "toast.onlyUnitsAvailable": "Only {quantity} units available.",
    "toast.addProductsFirst": "Add products to the cart first.",
    "toast.loadingStore": "Loading your store - please try again in a moment.",
    "toast.selectStoreBeforeSale": "Select a specific store before completing a sale.",
    "toast.cashLessThanTotal": "Cash tendered is less than the sale total.",
    "toast.saleFailedGeneric": "Sale failed. Please recheck stock and try again.",
    "toast.saleCompletedChange": "Sale completed. Give {change} change.",
    "toast.saleCompleted": "Sale completed and inventory updated.",
    "toast.quantityPriceInvalid": "Quantity and price fields must be zero or positive numbers.",
    "toast.fieldTooLong": "{field} must be {max} characters or fewer.",
    "product.barcodeLabel": "Barcode", "product.scanButton": "Scan",
    "pos.scanBarcode": "Scan Barcode",
    "barcodeScanner.title": "Scan Barcode",
    "barcodeScanner.hint": "Point your camera at the barcode.",
    "barcodeScanner.cancel": "Cancel",
    "toast.barcodeLibraryFailed": "Barcode scanner library did not load. Check your connection and try again.",
    "toast.cameraAccessFailed": "Could not access the camera. Check permissions and try again.",
    "toast.barcodeCaptured": "Barcode captured.",
    "toast.barcodeNoMatch": "No product found for barcode {code}.",
    "toast.barcodeAdded": "{name} added from barcode scan.",
    "receipt.title": "Receipt", "receipt.printButton": "Print",
    "receipt.downloadButton": "Download PDF", "receipt.close": "Close",
    "receipt.dateLabel": "Date", "receipt.thankYou": "Thank you for your business!",
    "toast.popupBlocked": "Could not open print window. Check your browser's popup blocker.",
    "pos.customerName": "Customer name (optional)",
    "pos.customerPhone": "Customer phone (optional)",
    "pos.customerNamePlaceholder": "e.g. Amina",
    "pos.customerPhonePlaceholder": "e.g. 07XXXXXXXX",
    "receipt.customerLabel": "Customer",
    "reports.topCustomersTitle": "Top Customers",
    "reports.topCustomersEmpty": "No customer sales recorded yet for this range.",
    "reports.colCustomerName": "Customer",
    "reports.colCustomerPhone": "Phone",
    "reports.colTotalSpent": "Total Spent",
    "reports.colLastVisit": "Last Visit",
    "dashboard.askAiButton": "Ask AI about this",
    "dashboard.askAiQuestionAlerts": "Which of my low-stock or out-of-stock products should I reorder first, and how much?",
    "dashboard.askAiQuestionRecommendations": "Explain my current purchase recommendations and what I should order this week.",
    "deleteAccount.button": "Delete Account",
    "deleteAccount.title": "Delete Account",
    "deleteAccount.warning": "Your account will be locked immediately and scheduled for permanent deletion in 30 days. You can restore it by signing in at any time during those 30 days. After that, all personal details — your staff and customer names, phone numbers and emails — are erased permanently and cannot be recovered. Sales and financial records are kept in anonymised form for the period required by law, as described in the Terms & Conditions.",
    "deleteAccount.passwordLabel": "Confirm your password",
    "deleteAccount.typeDeleteLabel": "Type DELETE to confirm",
    "deleteAccount.confirmButton": "Schedule Account Deletion",
    "deleteAccount.confirmTextMismatch": "Type DELETE exactly to confirm.",
    "deleteAccount.passwordRequired": "Enter your password to confirm.",
    "deleteAccount.reauthFailed": "Incorrect password. Please try again.",
    "deleteAccount.alreadyScheduled": "This account is already scheduled for deletion.",
    "deleteAccount.ownerOnly": "Only the business owner can delete the business account.",
    "deleteAccount.pendingBanner": "This account is scheduled for permanent deletion in {days} day(s). It is locked and cannot be changed until you restore it.",
    "deleteAccount.restoreButton": "Restore my account",
    "deleteAccount.restoreConfirm": "Restore this account and cancel the scheduled deletion?",
    "deleteAccount.restored": "Account restored. The scheduled deletion has been cancelled.",
    "deleteAccount.restoreFailed": "Could not restore the account. Please try again.",
    "deleteAccount.gracePeriodOver": "The 30-day grace period has ended and this account can no longer be restored.",
    "toast.accountDeletionScheduled": "Account locked and scheduled for deletion in {days} days. Sign in during that time to restore it.",
    "toast.accountDeleted": "Your account has been deleted.",
    "toast.accountDeleteFailed": "Could not delete your account. Please try again.",
    "backup.button": "Download Backup",
    "toast.backupPreparing": "Preparing your account backup...",
    "toast.backupDownloaded": "Backup downloaded. Store this file securely.",
    "toast.backupFailed": "Could not create the backup. Please try again.",
    "pos.discountLabel": "Discount",
    "pos.discountNone": "No discount",
    "pos.discountPercent": "Percentage (%)",
    "pos.discountFixed": "Fixed amount",
    "pos.discountValuePlaceholder": "Enter value",
    "pos.applyDiscount": "Apply",
    "pos.clearDiscount": "Clear",
    "pos.subtotal": "Subtotal",
    "pos.discountAppliedLabel": "Discount",
    "receipt.subtotalLabel": "Subtotal",
    "receipt.discountLabel": "Discount",
    "toast.discountInvalidValue": "Enter a valid discount value.",
    "toast.discountPercentTooHigh": "Percentage discount cannot exceed 100%.",
    "toast.discountExceedsSubtotal": "Fixed discount cannot exceed the subtotal.",
    "toast.discountApplied": "Discount applied.",
    "toast.discountCleared": "Discount cleared.",
    "product.expiryLabel": "Expiry date (optional)",
    "inventory.thExpiry": "Expiry",
    "expiry.statusExpired": "Expired",
    "expiry.statusSoon": "Expiring soon",
    "expiry.statusOk": "OK",
    "expiry.none": "-",
    "alert.expiredDetail": "Expired on {date}.",
    "alert.expiringSoonDetail": "Expires in {days} days ({date}).",
    "report.colExpiryDate": "Expiry Date",
    "report.colExpiryStatus": "Expiry Status",
    "returns.title": "Process Return / Refund",
    "returns.processButton": "Return / Refund",
    "returns.colItem": "Item",
    "returns.colAvailable": "Available to return",
    "returns.colQty": "Qty",
    "returns.maxReturnable": "{qty} returnable",
    "returns.confirmButton": "Process Refund",
    "returns.noItemsSelected": "All items on this order have already been returned.",
    "returns.refundedLabel": "Refunded",
    "toast.returnNoSelection": "Enter a quantity to return for at least one item.",
    "toast.returnProcessed": "Refund of {amount} processed and stock restored.",
    "toast.returnFailed": "Could not process the return. Please try again.",
    "inventory.generatePoButton": "Generate Purchase Orders",
    "po.dialogTitle": "Draft Purchase Orders",
    "po.noRecommendations": "No products currently need reordering.",
    "po.unassignedSupplier": "Unassigned Supplier",
    "po.colProduct": "Product",
    "po.colCurrentStock": "Current Stock",
    "po.colReorderQty": "Reorder Qty",
    "po.sendWhatsApp": "Send via WhatsApp",
    "po.downloadPdf": "Download PDF",
    "po.excludeAll": "Exclude group",
    "po.generatedOn": "Generated on {date}",
    "po.messageIntro": "Purchase order request for {supplier}:",
    "po.messageClosing": "Please confirm availability and pricing. Thank you.",
    "toast.poAllQuantitiesZero": "All quantities for this supplier are zero. Adjust quantities before sending.",
    "pos.credit": "Credit",
    "pos.amountPaidNow": "Amount paid now (optional)",
    "pos.amountPaidPlaceholder": "0 if fully on credit",
    "pos.amountPaidMethod": "Method for amount paid now",
    "pos.balanceDueLabel": "Balance due",
    "toast.creditNeedsPhone": "Enter the customer's phone number for a credit sale.",
    "toast.creditAmountPaidInvalid": "Amount paid cannot exceed the sale total.",
    "receipt.amountPaidLabel": "Amount Paid",
    "receipt.balanceDueLabel": "Balance Due",
    "customers.sectionTitle": "Customer Accounts (Credit)",
    "customers.sectionEyebrow": "Accounts receivable",
    "customers.colName": "Customer",
    "customers.colPhone": "Phone",
    "customers.colBalance": "Balance Owed",
    "customers.colActions": "Actions",
    "customers.recordPayment": "Record Payment",
    "customers.emptyState": "No customers currently owe a balance.",
    "customers.totalOwed": "Total outstanding",
    "payment.dialogTitle": "Record Payment",
    "payment.currentBalanceLabel": "Current balance",
    "payment.amountLabel": "Payment amount",
    "payment.noteLabel": "Note (optional)",
    "payment.confirmButton": "Record Payment",
    "toast.paymentInvalidAmount": "Enter a valid payment amount.",
    "toast.paymentExceedsBalance": "Payment cannot exceed the current balance.",
    "toast.paymentRecorded": "Payment of {amount} recorded. New balance: {balance}.",
    "toast.paymentFailed": "Could not record the payment. Please try again.",
    "customers.colDaysOutstanding": "Days Outstanding",
    "customers.colRemind": "Remind",
    "customers.agingCurrent": "Current",
    "customers.aging30": "31-60 days",
    "customers.aging60": "61-90 days",
    "customers.aging90": "90+ days",
    "customers.remindButton": "Remind via WhatsApp",
    "reminder.messageLine1": "Hello {name}, this is a friendly reminder from {business} that your account has an outstanding balance of {balance}.",
    "reminder.messageLine2": "This balance has been outstanding for {days} days.",
    "reminder.messageClosing": "Kindly settle at your earliest convenience. Thank you for your business!",
    "toast.reminderNoPhone": "This customer has no phone number on file.",
    "customers.colCreditLimit": "Credit Limit",
    "customers.setLimitButton": "Set Limit",
    "customers.noLimit": "No limit",
    "dialog.creditLimitPrompt": "Enter a credit limit for {name} in {currency} (leave blank for no limit):",
    "toast.creditLimitInvalid": "Enter a valid credit limit, or leave blank for no limit.",
    "toast.creditLimitSet": "{name}'s credit limit set to {limit}.",
    "toast.creditLimitCleared": "{name}'s credit limit removed.",
    "toast.creditLimitFailed": "Could not update the credit limit. Please try again.",
    "dialog.creditLimitExceededConfirm": "{name} already owes {currentBalance}. This sale would add {newBalanceDue}, bringing their balance to {projectedTotal}, over their {limit} limit. Proceed anyway?",
    "dashboard.setCurrency": "Currency",
    "dialog.currencyCodePrompt": "Enter a 3-letter currency code for this store (e.g. TZS, USD, KES, UGX):",
    "toast.currencyInvalid": "Enter a valid 3-letter currency code (letters only).",
    "toast.currencySet": "Store currency set to {code}.",
    "dialog.transferStaffLabel": "Name of the person making this transfer",
    "dialog.transferStaffPlaceholder": "e.g. Juma Ally",
    "toast.transferStaffRequired": "Enter the name of the person making this transfer.",
    "movement.title": "Product Movement",
    "movement.subtitle": "Sales and transfer history for {name}",
    "movement.salesSectionTitle": "Sales History",
    "movement.transfersSectionTitle": "Transfer History",
    "movement.noSales": "No sales recorded for this product yet.",
    "movement.noTransfers": "No transfers recorded for this product yet.",
    "movement.colDate": "Date",
    "movement.colStaff": "Staff",
    "movement.colQty": "Qty",
    "movement.colOrder": "Order #",
    "movement.colFrom": "From",
    "movement.colTo": "To",
    "movement.colTransferBy": "Transferred by",
    "movement.viewButton": "View Movement",
    "movement.close": "Close",
    "staff.rosterButton": "Staff Roster",
    "staff.rosterTitle": "Staff Roster",
    "staff.inviteButton": "Invite Staff",
    "staff.inviteDialogTitle": "Invite Staff Member",
    "staff.inviteEmailLabel": "Staff email",
    "staff.roleCashier": "Cashier",
    "staff.roleManager": "Manager",
    "staff.inviteStoresLabel": "Store access",
    "staff.inviteAllStores": "All stores (roaming access)",
    "staff.sendInviteButton": "Send Invite",
    "staff.inviteEmailInvalid": "Enter a valid staff email address.",
    "staff.inviteStoresRequired": "Select at least one store, or All stores.",
    "staff.inviteFailed": "Could not create the invite. Please try again.",
    "staff.inviteNetworkError": "Could not reach the invite service. Check your connection and try again.",
    "staff.inviteResultText": "Invite created for {email} as {role}. Share the link below \u2014 it expires in 48 hours and can only be used once.",
    "staff.copyLinkButton": "Copy Link",
    "staff.sendWhatsAppButton": "Send via WhatsApp",
    "staff.linkCopied": "Invite link copied.",
    "staff.copyFailed": "Could not copy the link. Please try again.",
    "staff.colEmail": "Email",
    "staff.colRole": "Role",
    "staff.colStores": "Stores",
    "staff.colActions": "Actions",
    "staff.revokeButton": "Revoke",
    "staff.rosterEmpty": "No staff members have accepted an invite yet.",
    "staff.allStoresLabel": "All stores",
    "staff.revokeConfirm": "Revoke access for {email}? They will be immediately signed out of this business's data.",
    "staff.revokeSuccess": "Access revoked for {email}.",
    "staff.revokeFailed": "Could not revoke access. Please try again."
  },
  sw: {
    "nav.dashboard": "Dashibodi", "nav.inventory": "Hisa", "nav.pos": "Mauzo",
    "nav.reports": "Ripoti", "nav.ai": "Mshauri wa AI",
    "brand.tagline": "ERP ya Hisa yenye AI",
    "sidebar.connectionHintSignedOut": "Ingia ili kusawazisha hisa yako",
    "topbar.searchPlaceholder": "Tafuta bidhaa zako...",
    "topbar.signOut": "Toka", "topbar.addProduct": "Ongeza Bidhaa", "topbar.langToggle": "English",
    "dashboard.eyebrowToday": "Leo", "dashboard.title": "Kituo cha Uendeshaji",
    "dashboard.addStore": "+ Duka", "dashboard.analyticsEyebrow": "Uchambuzi wa hisa",
    "dashboard.stockLevelsTitle": "Kiwango cha hisa", "dashboard.chartQuantity": "Kiasi",
    "dashboard.alertsEyebrow": "Arifa muhimu", "dashboard.needsAttention": "Yanayohitaji uangalizi",
    "dashboard.popupAlerts": "Arifa za dirisha ibukizi", "dashboard.movementTitle": "Mwendo wa bidhaa",
    "dashboard.aiEngineEyebrow": "Injini ya kuagiza upya ya AI", "dashboard.recommendationsTitle": "Mapendekezo ya ununuzi",
    "inventory.eyebrow": "Udhibiti wa hisa", "inventory.title": "Usimamizi wa Hisa",
    "inventory.exportCsv": "Hamisha CSV", "inventory.addProduct": "Ongeza Bidhaa",
    "inventory.stockAll": "Hali zote za hisa", "inventory.stockLow": "Hisa chache",
    "inventory.stockOut": "Hazipo", "inventory.stockHealthy": "Nzuri",
    "inventory.thProduct": "Bidhaa", "inventory.thCategory": "Aina", "inventory.thBrand": "Chapa",
    "inventory.thSupplier": "Msambazaji", "inventory.thQty": "Kiasi", "inventory.thStatus": "Hali",
    "inventory.thActions": "Vitendo",
    "pos.eyebrow": "Malipo ya haraka", "pos.title": "Sehemu ya Mauzo", "pos.productSearch": "Tafuta Bidhaa",
    "pos.searchPlaceholder": "Tafuta bidhaa", "pos.currentSale": "Mauzo ya Sasa",
    "pos.undoAction": "Tengua Kitendo cha Mwisho", "pos.clearCart": "Futa Kikapu", "pos.total": "Jumla",
    "pos.cash": "Fedha Taslimu", "pos.mobile": "Pesa za Simu", "pos.card": "Kadi",
    "pos.amountTendered": "Kiasi kilicholipwa", "pos.tenderedPlaceholder": "Weka fedha zilizopokelewa",
    "pos.changeDue": "Chenji", "pos.completeSale": "Kamilisha Mauzo", "pos.undoSale": "Tengua Mauzo ya Mwisho",
    "pos.staffLabel": "Mfanyakazi", "pos.selectStaffPlaceholder": "Chagua mfanyakazi",
    "pos.addStaff": "+ Mfanyakazi", "pos.removeStaff": "Ondoa Mfanyakazi",
    "pos.orderNumberLabel": "Nambari ya oda (kutoka karatasi ya mauzo)", "pos.orderNumberPlaceholder": "mfano 8097",
    "reports.staffBreakdownTitle": "Mauzo kwa Mfanyakazi", "reports.staffColumn": "Mfanyakazi",
    "reports.ordersColumn": "Oda", "reports.allStaffRow": "Wafanyakazi wote",
    "reports.searchOrderPlaceholder": "Tafuta nambari ya oda", "reports.orderNotFound": "Hakuna mauzo yaliyopatikana kwa nambari hiyo ya oda.",
    "reports.orderFoundLabel": "Oda #{orderNumber} \u2014 {name}, {date}, {method}, {total}",
    "reports.staffOrderLookupTitle": "Tafuta Oda",
    "reports.staffOrderLookupDateLabel": "Tarehe",
    "reports.staffOrderLookupOrderLabel": "Nambari ya oda",
    "reports.staffOrderLookupButton": "Tafuta Oda",
    "reports.staffOrderLookupEmpty": "Chagua mfanyakazi, tarehe, na nambari ya oda, kisha bofya Tafuta Oda.",
    "reports.staffOrderLookupNotFound": "Hakuna oda iliyopatikana kwa mfanyakazi, tarehe, na nambari hiyo.",
    "reports.staffOrderLookupTimeLabel": "Muda",
    "reports.staffOrderLookupPaymentLabel": "Njia ya Malipo",
    "reports.staffOrderLookupTotalLabel": "Jumla ya Oda",
    "reports.staffOrderLookupColItem": "Bidhaa",
    "reports.staffOrderLookupColQty": "Kiasi",
    "reports.staffOrderLookupColUnitPrice": "Bei kwa Kitengo",
    "reports.staffOrderLookupColLineTotal": "Jumla ya Bidhaa",
    "reports.dailyStaffReportTitle": "Ripoti ya Wafanyakazi ya Siku",
    "reports.dailyStaffReportButton": "Tengeneza Ripoti ya Siku",
    "reports.dailyStaffReportEmpty": "Chagua tarehe kisha bofya Tengeneza Ripoti ya Siku.",
    "reports.dailyStaffReportNoSales": "Hakuna mauzo yaliyorekodiwa kwa tarehe hii.",
    "reports.dailyStaffReportItemsLabel": "Bidhaa",
    "reports.dailyStaffReportOrderColumn": "Oda #",
    "reports.dailyStaffReportGrandTotal": "Jumla Kuu (Wafanyakazi Wote)",
    "reports.staffOrderLookupAllButton": "Tengeneza Oda Zote",
    "reports.staffOrderLookupNoOrders": "Hakuna oda zilizopatikana kwa mfanyakazi huyu.",
    "reports.staffOrderLookupSelectStaffDate": "Chagua mfanyakazi kwanza.",
    "reports.staffOrderLookupDateHint": "Acha tarehe zote wazi kuona oda zote za mfanyakazi huyu.",
    "reports.eyebrow": "Taarifa za biashara", "reports.title": "Ripoti",
    "reports.financialEyebrow": "Ufuatiliaji wa fedha", "reports.salesTitle": "Ripoti za Mauzo na Malipo",
    "reports.rangeToday": "Leo", "reports.rangeWeek": "Wiki hii", "reports.rangeMonth": "Mwezi huu",
    "reports.rangeAll": "Muda wote", "reports.rangeCustom": "Muda maalum",
    "reports.from": "Kutoka", "reports.to": "Hadi", "reports.exportCsv": "Hamisha CSV", "reports.exportPdf": "Hamisha PDF",
    "ai.eyebrow": "Ufahamu Mahiri", "ai.title": "Uliza Kuhusu Biashara Yako",
    "ai.questionPlaceholder": "Uliza kuhusu hisa, kiwango cha bidhaa, mauzo, au utabiri...",
    "ai.askButton": "Uliza Mshauri wa AI", "ai.conversation": "Mazungumzo", "ai.clear": "Futa",
    "product.nameLabel": "Jina la bidhaa", "product.categoryLabel": "Aina", "product.brandLabel": "Chapa",
    "product.supplierLabel": "Wasambazaji", "product.quantityLabel": "Kiasi",
    "product.priceLabel": "Bei ya kuuza", "product.priceTypeLabel": "Aina ya bei",
    "product.priceFixed": "Bei maalum", "product.priceDynamic": "Bei inayobadilika",
    "product.reorderLabel": "Kiwango cha chini cha hisa", "product.reorderPlaceholder": "mfano, 10",
    "product.cancel": "Ghairi", "product.save": "Hifadhi Bidhaa",
    "auth.eyebrow": "Ufikiaji wa akaunti",
    "auth.copy": "Fungua akaunti au ingia ili kusimamia hisa yako, viwango vya bidhaa, mauzo, na mapendekezo ya AI.",
    "auth.businessName": "Jina la biashara", "auth.email": "Barua pepe", "auth.password": "Nenosiri", "auth.forgotPassword": "Umesahau nenosiri?",
    "auth.confirmPassword": "Thibitisha nenosiri",
    "auth.consentPrefix": "Nakubali", "auth.consentTerms": "Sheria na Masharti",
    "auth.consentAnd": "na", "auth.consentPrivacy": "Sera ya Faragha", "auth.consentSuffix": ".",
    "auth.whyTitle": "Kwa Nini DukaSmart",
    "auth.whyMultiStore": "Fuatilia hisa ya matawi yako yote kwenye dashibodi moja.",
    "auth.whyOffline": "Endelea kuuza hata mtandao ukikatika \u2014 hujisawazisha kiotomatiki ukirudi mtandaoni.",
    "auth.whyReceipts": "Chapisha au shiriki risiti kupitia WhatsApp, ukiwa na ufuatiliaji wa fedha taslimu, pesa za simu, na kadi.",
    "auth.whyAi": "Uliza Mshauri wa AI ni bidhaa zipi za kuagiza tena, kwa Kiingereza au Kiswahili.",
    "stockAlert.title": "Arifa ya Hisa", "stockAlert.ok": "Sawa",
    "command.placeholder": "Andika amri au jina la sehemu",
    "dialog.overridePasswordPrompt": "Weka nenosiri la kubadilisha bei:",
    "settings.overridePasswordOpenButton": "Nenosiri la Punguzo",
    "settings.overridePasswordTitle": "Nenosiri la Kubadilisha Bei",
    "settings.overridePasswordDescription": "Weka nenosiri ambalo wafanyakazi watalitumia kutoa punguzo au kubadilisha bei. Wewe pekee unaweza kuliona au kulibadilisha.",
    "settings.overridePasswordTitleCreate": "Weka Nenosiri la Punguzo",
    "settings.overridePasswordTitleChange": "Badilisha Nenosiri la Punguzo",
    "settings.overridePasswordDescriptionCreate": "Chagua nenosiri ambalo wafanyakazi wako watalitumia kutoa punguzo au kubadilisha bei. Bado hujaweka nenosiri, kwa hiyo chagua nenosiri jipya hapa chini. Wewe pekee unaweza kulibadilisha baadaye.",
    "settings.overridePasswordDescriptionChange": "Weka nenosiri lako la sasa la punguzo, kisha chagua jipya. Wewe pekee unaweza kulibadilisha.",
    "settings.overridePasswordCreateButton": "Weka Nenosiri",
    "settings.overridePasswordCurrentNowRequired": "Akaunti hii ina nenosiri la punguzo tayari. Weka nenosiri la sasa ili kulibadilisha.",
    "settings.overridePasswordCurrentLabel": "Nenosiri la sasa la punguzo",
    "settings.overridePasswordNewLabel": "Nenosiri jipya",
    "settings.overridePasswordConfirmLabel": "Thibitisha nenosiri",
    "settings.overridePasswordReauthLabel": "Nenosiri lako la akaunti",
    "settings.overridePasswordSaveButton": "Hifadhi Nenosiri",
    "settings.overridePasswordMismatch": "Manenosiri hayafanani.",
    "settings.overridePasswordTooShort": "Nenosiri linapaswa kuwa na angalau herufi 4.",
    "settings.overridePasswordCurrentRequired": "Weka nenosiri lako la sasa la punguzo.",
    "settings.overridePasswordCurrentIncorrect": "Nenosiri la sasa la punguzo si sahihi.",
    "settings.overridePasswordReauthRequired": "Weka nenosiri lako la akaunti kuthibitisha ni wewe.",
    "settings.overridePasswordReauthFailed": "Nenosiri la akaunti si sahihi. Tafadhali jaribu tena.",
    "nudge.overridePasswordText": "Weka nenosiri la punguzo na kubadilisha bei ili wafanyakazi wanaoaminika pekee waweze kulitumia.",
    "nudge.overridePasswordSetButton": "Weka sasa",
    "nudge.overridePasswordDismissButton": "Ondoa",
    "dialog.newStoreNamePrompt": "Jina la duka jipya (mfano, Tawi la Mombasa Road):",
    "dialog.businessTypePrompt": "Chagua aina ya biashara kwa duka hili:\n{list}\n\nWeka nambari:",
    "dialog.transferDestinationPrompt": "Hamisha \"{name}\" kwenda duka gani?\n{list}\n\nWeka nambari:",
    "dialog.transferQuantityPrompt": "Vitengo vingapi vya \"{name}\" kuhamisha? (Vinavyopatikana: {quantity})",
    "dialog.transferTitle": "Hamisha Hisa", "dialog.transferDestinationLabel": "Duka la kupokea",
    "dialog.transferQuantityLabel": "Kiasi cha kuhamisha", "dialog.transferConfirm": "Hamisha",
    "dialog.transferProductLabel": "{name} \u2014 {quantity} zinapatikana katika {store}",
    "restock.dialogTitle": "Ongeza Hisa ya Bidhaa",
    "restock.productLabel": "{name} \u2014 hisa ya sasa: {quantity}",
    "restock.qtyLabel": "Kiasi kilichopokelewa",
    "restock.qtyPlaceholder": "mfano, 20",
    "restock.confirmButton": "Ongeza kwenye Hisa",
    "dialog.deleteConfirm": "Futa {name} kutoka kwenye hisa?",
    "dialog.undoSaleConfirm": "Tengua mauzo ya mwisho yaliyokamilika? Hii itarejesha kiasi cha hisa.",
    "dialog.editPricePrompt": "Weka bei mpya ya {name} ({currency}):",
    "dialog.newStaffNamePrompt": "Jina la mfanyakazi mpya:",
    "dialog.removeStaffConfirm": "Ondoa \"{name}\" kwenye orodha ya wafanyakazi? Mauzo ya awali yatabaki na jina lake.",
    "dialog.duplicateOrderConfirm": "Oda #{orderNumber} tayari imesajiliwa kwa {name}. Uisajili tena?",
    "connection.firebaseConnected": "Firebase imeunganishwa",
    "connection.createAccountToBegin": "Fungua akaunti kuanza",
    "connection.inventorySyncing": "Hisa yako inasawazishwa",
    "connection.signedInFallback": "Umeingia",
    "verifyEmail.bannerText": "Tafadhali thibitisha barua pepe yako ili kuendelea kutumia akaunti yako kikamilifu.",
    "verifyEmail.resendButton": "Tuma tena barua pepe ya uthibitisho",
    "txerror.sourceProductGone": "Bidhaa chanzi haipo tena.",
    "txerror.notEnoughStockTransfer": "Hisa haitoshi kuhamisha.",
    "txerror.saleNotFound": "Rekodi ya mauzo haikupatikana; huenda tayari imetenguliwa.",
    "txerror.saleAlreadyUndone": "Mauzo haya tayari yametenguliwa.",
    "txerror.itemGone": "{name} haipo tena.",
    "txerror.notEnoughStockItem": "Hisa haitoshi kwa {name}. {quantity} tu zimebaki.",
    "txerror.duplicateOrderSubmission": "Oda #{orderNumber} tayari imesajiliwa. Angalia Ripoti kabla ya kutuma tena.",
    "chart.emptyPrompt": "Ongeza bidhaa ili kuona kiwango cha hisa hapa.",
    "stockAlert.outOfStockDetail": "Bidhaa hii haipo kwenye hisa (kiwango cha chini: {reorderLevel}).",
    "stockAlert.remainingDetail": "Kiasi kilichobaki: {quantity} (kiwango cha chini: {reorderLevel}).",
    "stockAlert.suggestedReorder": "Kiasi kinachopendekezwa kuagiza: vitengo {qty}.",
    "stockAlert.noSuggestion": "Hakuna pendekezo la kuagiza upya bado.",
    "stockAlert.queueNoteOne": "Arifa 1 zaidi inasubiri.",
    "stockAlert.queueNoteMany": "Arifa {count} zaidi zinasubiri.",
    "report.inventorySummary": "Muhtasari wa Hisa", "report.stockQuantityReport": "Ripoti ya Kiasi cha Hisa",
    "report.supplierList": "Orodha ya Wasambazaji", "report.lowStockReport": "Ripoti ya Hisa Chache",
    "report.outOfStockReport": "Ripoti ya Bidhaa Zilizoisha", "report.csvExportCard": "Hamisha CSV",
    "report.exportFormatsHint": "Hamisha kwa PDF, Excel, au CSV",
    "report.colName": "Jina", "report.colCategory": "Aina", "report.colBrand": "Chapa",
    "report.colSupplier": "Msambazaji", "report.colQuantity": "Kiasi",
    "report.colReorderLevel": "Kiwango cha Kuagiza Upya", "report.colStatus": "Hali",
    "report.statusOut": "Haipo", "report.statusLow": "Hisa chache", "report.statusHealthy": "Nzuri",
    "storeSwitcher.allStores": "Maduka Yote (pamoja)", "storeSwitcher.fallbackName": "Duka",
    "ai.modeGuide": "Mwongozo", "ai.modeClaude": "Claude", "ai.modeLocal": "Ndani",
    "ai.analyzing": "Inachambua hisa, kasi ya mauzo, na muda wa usambazaji...",
    "command.openDashboard": "Fungua Dashibodi", "command.openInventory": "Fungua Hisa",
    "command.openPos": "Fungua Sehemu ya Mauzo", "command.openReports": "Fungua Ripoti",
    "command.openAi": "Fungua Mshauri wa AI",
    "txerror.aiRequestTimedOut": "muda wa ombi umeisha", "txerror.aiNetworkError": "hitilafu ya mtandao",
    "txerror.aiMalformedResponse": "jibu halikuwa sahihi",
    "store.defaultName": "Tawi Kuu",
    "monthlyReport.generating": "Inatengeneza ripoti ya mwezi...",
    "monthlyReport.generated": "Ripoti ya mwezi imetengenezwa.",
    "monthlyReport.noSalesData": "Hakuna mauzo yaliyorekodiwa kwa kipindi hiki bado.",
    "monthlyReport.failedGeneric": "Imeshindwa kuhifadhi ripoti ya mwezi.",
    "monthlyReport.couldNotLoad": "Imeshindwa kupakia ripoti za mwezi.",
    "monthlyReport.revenueLine": "Kwa {period}: {revenue} mapato kutoka miamala {count}.",
    "monthlyReport.topProductsLine": "Bidhaa bora zilizouzwa: {list}.",
    "monthlyReport.noTopProducts": "Hakuna mauzo ya bidhaa yaliyorekodiwa kipindi hiki.",
    "monthlyReport.stockLine": "Bidhaa {low} zina hisa chache na {out} hazipo kabisa.",
    "monthlyReport.localFallbackNote": "(Muhtasari wa ndani \u2014 proksi ya AI haikupatikana kwa ripoti hii.)",
    "monthlyReport.sectionEyebrow": "Imetengenezwa na AI",
    "monthlyReport.sectionTitle": "Ripoti za Kila Mwezi",
    "monthlyReport.monthLabel": "Mwezi",
    "monthlyReport.generateButton": "Tengeneza Ripoti",
    "monthlyReport.emptyState": "Hakuna ripoti za mwezi bado. Chagua mwezi na utengeneze moja.",
    "monthlyReport.detailRevenue": "Mapato", "monthlyReport.detailTransactions": "Miamala",
    "monthlyReport.detailAvgSale": "Wastani wa Mauzo", "monthlyReport.detailUnitsSold": "Vitengo Vilivyouzwa",
    "monthlyReport.detailLowStock": "Bidhaa zenye Hisa Chache", "monthlyReport.detailOutOfStock": "Bidhaa Zilizoisha",
    "monthlyReport.detailSummaryLabel": "Muhtasari",
    "monthlyReport.exportPdfButton": "Hamisha PDF",
    "reports.revenueTrendTitle": "Mwelekeo wa Mapato",
    "reports.revenueTrendEmpty": "Hakuna mauzo yaliyorekodiwa kwa kipindi hiki bado.",
    "localAi.headerWithQuestion": "Pendekezo la ndani kwa: \"{question}\"",
    "localAi.headerNoQuestion": "Pendekezo la ndani: zingatia upatikanaji wa hisa na kusafisha kumbukumbu za hisa wiki hii.",
    "localAi.urgentReorder": "Agiza upya haraka: {list}.",
    "localAi.mostUrgent": "Ya haraka zaidi: {name} inakadiriwa kuisha kwa siku {days}.",
    "localAi.movementSummary": "Muhtasari wa mwendo: {fast} zinazouzwa haraka, {slow} zinazouzwa polepole, {none} bila mauzo yaliyorekodiwa.",
    "localAi.highestStocked": "Bidhaa zenye hisa nyingi zaidi: {list}.",
    "localAi.businessTip": "Kidokezo: {tip}",
    "localAi.supplierNote": "Taarifa za wasambazaji zinatoka tu kwenye bidhaa ulizoongeza kwenye akaunti hii.",
    "localAi.disclaimer": "(Mshauri huyu hutumia tu picha ya hisa ya akaunti uliyoingia. Proksi ya AI haipatikani, hivyo huu ni muhtasari wa ndani, wa kanuni.)",
    "dashboard.renameStore": "Badilisha Jina", "dashboard.archiveStore": "Hifadhi Kumbukumbu", "dashboard.setBusinessType": "Aina ya Biashara",
    "dialog.renameStorePrompt": "Jina jipya la duka hili:",
    "dialog.archiveStoreConfirm": "Hifadhi kumbukumbu ya \"{name}\"? Litafichwa kwenye kibadilishaji duka lakini historia yake itabaki.",
    "toast.selectSpecificStore": "Chagua duka mahususi kwanza.",
    "toast.storeRenamed": "Jina la duka limebadilishwa kuwa {name}.", "toast.couldNotRenameStore": "Imeshindwa kubadilisha jina la duka.",
    "toast.businessTypeSet": "Aina ya biashara imesasishwa. Mapendekezo ya aina za bidhaa yatabadilika.",
    "toast.storeArchived": "{name} imehifadhiwa kumbukumbu.", "toast.couldNotArchiveStore": "Imeshindwa kuhifadhi kumbukumbu ya duka.",
    "toast.cannotArchiveLastStore": "Unahitaji angalau duka moja linalofanya kazi; hifadhi kumbukumbu ya duka lingine kwanza.",
    "kpi.totalProducts": "Jumla ya Bidhaa", "kpi.totalProductsDelta": "Akaunti yako",
    "kpi.totalQuantity": "Jumla ya Kiasi", "kpi.totalQuantityDelta": "Vitengo vilivyopo",
    "kpi.categories": "Aina za Bidhaa", "kpi.categoriesDelta": "Makundi ya bidhaa",
    "kpi.suppliers": "Wasambazaji", "kpi.suppliersDelta": "Kutoka bidhaa zako",
    "kpi.lowStock": "Bidhaa zenye Hisa Chache", "kpi.lowStockDelta": "Agiza upya sasa",
    "kpi.outStock": "Bidhaa Zilizoisha", "kpi.outStockDelta": "Haraka",
    "alert.belowMinimum": "Hisa iko chini ya kiwango cha chini. Hisa ya sasa: {quantity}.",
    "alert.allClearTitle": "Hakuna tatizo", "alert.allClearBody": "Hakuna bidhaa zenye hisa chache au zilizoisha.",
    "rec.reorderNow": "Agiza vitengo {qty} sasa.", "rec.estimatedStockout": "Inakadiriwa kuisha kwa siku {days}.",
    "movement.fastMoving": "Bidhaa zinazouzwa haraka", "movement.slowMoving": "Bidhaa zinazouzwa polepole",
    "movement.noSales": "Hakuna mauzo yaliyorekodiwa", "movement.healthyCoverage": "Hisa iliyo katika hali nzuri",
    "pos.available": "{quantity} zinapatikana", "pos.qtyAriaLabel": "Kiasi cha {name}",
    "pos.pricePerUnitPlaceholder": "Bei/kitengo", "pos.addButton": "Ongeza",
    "cart.editPrice": "Hariri bei", "cart.decreaseAriaLabel": "Punguza kiasi",
    "cart.qtyAriaLabel": "Hariri kiasi cha {name}", "cart.increaseAriaLabel": "Ongeza kiasi",
    "cart.removeAriaLabel": "Ondoa bidhaa", "cart.removeButton": "Ondoa", "cart.empty": "Hakuna bidhaa kwenye kikapu.",
    "report.transaction": "muamala", "report.transactions": "miamala", "report.avg": "wastani",
    "report.topItems": "Bidhaa bora", "report.none": "hakuna", "report.combinedTotal": "Jumla ya pamoja",
    "report.share": "sehemu", "report.totalTransactions": "Jumla ya miamala", "report.perStoreTotals": "Jumla za kila duka",
    "report.colPaymentMethod": "Njia ya Malipo", "report.colTransactions": "Miamala",
    "report.colTotalTZS": "Jumla", "report.colAvgSaleTZS": "Wastani wa Mauzo",
    "report.colTopItems": "Bidhaa Bora", "report.combined": "Jumla", "report.storePrefix": "Duka: {name}",
    "tutorial.pos": "Jinsi ya kutumia Sehemu ya Mauzo (POS):\n1. Fungua kichupo cha POS na utafute au uvinjari bidhaa.\n2. Weka kiasi, kisha bofya Ongeza. Bidhaa zenye bei inayobadilika huuliza bei kwa kila kitengo kwanza.\n3. Rekebisha kiasi kwenye kikapu kwa +/-, kisanduku cha kiasi, au Ondoa. Tumia Tengua Kitendo cha Mwisho ukikosea.\n4. Chagua mfanyakazi anayefanya mauzo, na uweke nambari ya oda kutoka kwenye karatasi yake ya mauzo.\n5. Chagua njia ya malipo (Fedha Taslimu, Pesa za Simu, Kadi). Kwa fedha taslimu, weka kiasi kilicholipwa ili kuona chenji.\n6. Bofya Kamilisha Mauzo. Ukihitaji kutengua, tumia Tengua Mauzo ya Mwisho mara moja \u2014 hisa hurejeshwa kiotomatiki.",
    "tutorial.inventory": "Jinsi ya kusimamia hisa:\n1. Nenda kwenye Hisa na bofya Ongeza Bidhaa (au tumia kitufe cha Dashibodi). Jaza jina, aina, kiasi, na bei ya kuuza.\n2. Weka Kiwango cha chini cha hisa ili bidhaa ionekane kwenye Arifa muhimu na mapendekezo ya kuagiza upya ikipungua chini ya kiwango hicho.\n3. Chagua Bei maalum kwa bidhaa za kawaida, au Bei inayobadilika ikiwa bei hubadilika kwa kila mauzo.\n4. Tumia Hariri kwenye safu yoyote kubadilisha maelezo, au Futa kuondoa bidhaa. Ukiwa na maduka 2 au zaidi, Hamisha huhamisha hisa kati yao.\n5. Tumia vichujio vya aina na hali ya hisa juu ya jedwali, au sanduku la utafutaji, kupata bidhaa haraka.",
    "tutorial.reports": "Jinsi ya kusoma ripoti zako:\n1. Kichupo cha Ripoti kinagawanya mauzo kwa njia ya malipo \u2014 fedha taslimu, pesa za simu, na kadi \u2014 na jumla, idadi, na bidhaa bora za kila moja.\n2. Chagua muda maalum uliowekwa (leo, wiki, mwezi, muda wote) au chagua Muda maalum kwa tarehe mahususi.\n3. Ukiwa unaangalia Maduka Yote, mchanganuo wa kila duka unaonekana chini ya muhtasari wa pamoja.\n4. Tumia Hamisha CSV au Hamisha PDF kuhifadhi ripoti ya malipo. Kadi za Muhtasari wa Hisa chini zaidi huhamisha data ya hisa kando.",
    "tutorial.stores": "Jinsi ya kufanya kazi na maduka mengi:\n1. Tumia kibadilishaji duka kwenye Dashibodi kubadilisha duka unaloangalia au kufanyia kazi.\n2. Bofya + Duka kuongeza tawi jipya. Ukiwa na maduka 2 au zaidi, chaguo la \"Maduka Yote (pamoja)\" litaonekana kwa muhtasari wa kusoma tu.\n3. Wakati Maduka Yote limechaguliwa, kuongeza bidhaa, kuongeza kwenye kikapu, na kukamilisha mauzo hazitafanya kazi \u2014 badilisha kwenda duka mahususi kwanza.\n4. Tumia kitufe cha Hamisha kwenye safu ya hisa kuhamisha hisa kutoka duka moja kwenda lingine; SKU zinazolingana huungana kiotomatiki.",
    "chat.emptyState": "Uliza swali kuhusu hisa yako kuanza \u2014 kwa lugha yoyote.",
    "auth.createAccount": "Fungua akaunti", "auth.signIn": "Ingia",
    "auth.haveAccount": "Nina akaunti tayari", "auth.newAccount": "Fungua akaunti mpya",
    "auth.errorRequired": "Sehemu hii inahitajika.",
    "auth.errorEmailInvalid": "Weka barua pepe sahihi.",
    "auth.errorPasswordShort": "Nenosiri liwe na angalau herufi 6.",
    "auth.errorPasswordMismatch": "Manenosiri hayafanani.",
    "auth.errorConsentRequired": "Tafadhali kubali Sheria na Masharti na Sera ya Faragha.",
    "theme.light": "Mwanga", "theme.dark": "Giza",
    "product.editTitle": "Hariri Bidhaa ya Hisa", "product.addTitle": "Ongeza Bidhaa ya Hisa",
    "inventory.edit": "Hariri", "inventory.transfer": "Hamisha", "inventory.restock": "Ongeza Hisa", "inventory.delete": "Futa",
    "inventory.emptyState": "Hakuna hisa bado. Ongeza bidhaa yako ya kwanza kuanza kufuatilia hisa.",
    "toast.incorrectPassword": "Nenosiri si sahihi. Mabadiliko ya bei yamesitishwa.",
    "toast.overrideNotConfigured": "Mabadiliko ya bei ya ziada bado hayajawekwa. Muulize msimamizi wako ayaweke.",
    "toast.overrideNetworkError": "Imeshindwa kufikia huduma ya ruhusa. Angalia muunganisho wako na ujaribu tena.",
    "toast.overridePasswordSaved": "Nenosiri la punguzo limehifadhiwa.",
    "toast.overridePasswordSaveFailed": "Imeshindwa kuhifadhi nenosiri. Jaribu tena.",
    "toast.nothingToUndo": "Hakuna cha kutengua.", "toast.lastCartActionUndone": "Kitendo cha mwisho cha kikapu kimetenguliwa.",
    "toast.pdfLibraryFailed": "Maktaba ya PDF haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.excelLibraryFailed": "Maktaba ya Excel haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.aiProxyUnavailable": "Proksi ya AI haipatikani ({message}). Inaonyesha pendekezo la ndani.",
    "toast.noInventoryData": "Hakuna data ya hisa ya kuhamisha bado.",
    "toast.selectStoreBeforeAdd": "Chagua duka mahususi kabla ya kuongeza bidhaa mpya.",
    "toast.productSaved": "{name} imehifadhiwa kwenye hisa.",
    "toast.savedLocallyFirestoreFailed": "Imehifadhiwa kwa ndani. Uandishi wa Firestore umeshindwa.",
    "toast.needTwoStoresTransfer": "Unahitaji maduka 2 angalau kuhamisha hisa.",
    "toast.signInToTransfer": "Ingia ili kuhamisha hisa.",
    "toast.signInToAddStore": "Ingia ili kuongeza duka.",
    "toast.invalidStoreSelection": "Uchaguzi wa duka si sahihi.",
    "toast.invalidTransferQuantity": "Kiasi cha kuhamisha si sahihi.",
    "toast.transferred": "Vitengo {qty} vya {name} vimehamishwa kwenda {store}.",
    "toast.unitSingular": "kitengo", "toast.unitPlural": "vitengo",
    "toast.transferFailed": "Uhamishaji umeshindwa.",
    "toast.restockInvalidQuantity": "Weka kiasi sahihi cha kuongeza.",
    "toast.restocked": "Vitengo {qty} vya {name} vimeongezwa. Hisa mpya: {quantity}.",
    "toast.restockFailed": "Imeshindwa kusasisha hisa. Tafadhali jaribu tena.",
    "toast.deletedLocallyFirestoreFailed": "Imefutwa kwa ndani. Ufutaji wa Firestore umeshindwa.",
    "toast.productDeleted": "{name} imefutwa.",
    "toast.noRecentSale": "Hakuna mauzo ya karibuni ya kutengua.", "toast.couldNotUndoSale": "Imeshindwa kutengua mauzo.",
    "toast.saleUndone": "Mauzo ya mwisho yametenguliwa na hisa imerejeshwa.",
    "toast.firebaseConnectionFailed": "Mipangilio ya Firebase imepatikana, lakini muunganisho umeshindwa.",
    "toast.couldNotLoadInventory": "Imeshindwa kupakia hisa yako.",
    "toast.couldNotLoadSales": "Imeshindwa kupakia historia ya mauzo.",
    "toast.couldNotCreateFirstStore": "Imeshindwa kuunda duka lako la kwanza.",
    "toast.couldNotLoadStores": "Imeshindwa kupakia maduka yako.",
    "toast.storeAdded": "{name} imeongezwa.", "toast.couldNotCreateStore": "Imeshindwa kuunda duka.",
    "toast.signInToAddStaff": "Ingia ili kuongeza mfanyakazi.", "toast.staffAdded": "{name} ameongezwa kwenye wafanyakazi.",
    "toast.couldNotAddStaff": "Imeshindwa kuongeza mfanyakazi.", "toast.staffRemoved": "{name} ameondolewa kwenye wafanyakazi.",
    "toast.couldNotRemoveStaff": "Imeshindwa kuondoa mfanyakazi.", "toast.selectStaffFirst": "Chagua mfanyakazi kwanza.",
    "toast.orderNumberRequired": "Weka nambari ya oda kutoka kwenye karatasi ya mauzo.",
    "toast.orderNumberInvalid": "Nambari ya oda lazima iwe na tarakimu pekee.",
    "toast.couldNotSaveAlertSetting": "Imeshindwa kuhifadhi mpangilio wa arifa ibukizi.",
    "toast.tooManyFailedAttempts": "Majaribio mengi yameshindwa kwa barua pepe hii. Tafadhali subiri dakika 15 na ujaribu tena.",
    "toast.accountCreated": "Akaunti imefunguliwa. Ongeza bidhaa yako ya kwanza ya hisa.",
    "toast.signedIn": "Umeingia.", "toast.signedOut": "Umetoka.",
    "toast.firebaseNotConnected": "Firebase haijaunganishwa bado.",
    "toast.authFailedGeneric": "Uthibitishaji umeshindwa. Angalia maelezo yako na ujaribu tena.",
    "toast.authEmailInUse": "Barua pepe hiyo tayari ina akaunti. Ingia badala yake.",
    "toast.authInvalidCredential": "Barua pepe au nenosiri si sahihi.",
    "toast.authWeakPassword": "Tumia nenosiri lenye angalau herufi 6.",
    "toast.authOperationNotAllowed": "Wezesha kuingia kwa Barua pepe/Nenosiri kwenye Firebase Auth.",
    "toast.passwordResetSent": "Kama akaunti ipo kwa barua pepe hiyo, kiungo cha kubadilisha nenosiri kimetumwa.",
    "toast.verificationEmailSent": "Barua pepe ya uthibitisho imetumwa. Tafadhali angalia kikasha chako.",
    "toast.verificationEmailFailed": "Imeshindwa kutuma barua pepe ya uthibitisho. Tafadhali jaribu tena baadaye.",
    "toast.idleSignOut": "Umetolewa nje baada ya muda wa kutotumika.",
    "toast.authTooManyRequests": "Majaribio mengi sana. Tafadhali subiri kidogo kisha ujaribu tena.",
    "toast.consentRequired": "Tafadhali kubali Sheria na Masharti na Sera ya Faragha kabla ya kufungua akaunti.",
    "toast.passwordMismatch": "Manenosiri hayafanani.",
    "toast.outOfStock": "Bidhaa hii haipo kwenye hisa.",
    "toast.selectStoreToSell": "Chagua duka mahususi kufanya mauzo.",
    "toast.enterPricePerUnit": "Weka bei kwa kila kitengo cha bidhaa hii.",
    "toast.notEnoughStockQty": "Hisa haitoshi kwa kiasi hiki.",
    "toast.cartLimitReached": "Mauzo haya yamefikia kikomo cha bidhaa 40. Kamilisha mauzo haya na uanze mengine.",
    "toast.noMoreStock": "Hakuna hisa zaidi ya bidhaa hii.",
    "toast.invalidPrice": "Bei si sahihi.", "toast.onlyUnitsAvailable": "Vitengo {quantity} tu vinapatikana.",
    "toast.addProductsFirst": "Ongeza bidhaa kwenye kikapu kwanza.",
    "toast.loadingStore": "Duka lako linapakia - tafadhali jaribu tena baada ya muda mfupi.",
    "toast.selectStoreBeforeSale": "Chagua duka mahususi kabla ya kukamilisha mauzo.",
    "toast.cashLessThanTotal": "Fedha zilizolipwa ni chini ya jumla ya mauzo.",
    "toast.saleFailedGeneric": "Mauzo yameshindwa. Angalia hisa tena na ujaribu tena.",
    "toast.saleCompletedChange": "Mauzo yamekamilika. Toa chenji ya {change}.",
    "toast.saleCompleted": "Mauzo yamekamilika na hisa imesasishwa.",
    "toast.quantityPriceInvalid": "Sehemu za kiasi na bei lazima ziwe sifuri au chanya.",
    "toast.fieldTooLong": "{field} lazima iwe na herufi {max} au chache.",
    "product.barcodeLabel": "Msimbo pau", "product.scanButton": "Changanua",
    "pos.scanBarcode": "Changanua Msimbo Pau",
    "barcodeScanner.title": "Changanua Msimbo Pau",
    "barcodeScanner.hint": "Elekeza kamera yako kwenye msimbo pau.",
    "barcodeScanner.cancel": "Ghairi",
    "toast.barcodeLibraryFailed": "Maktaba ya kichanganuzi haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.cameraAccessFailed": "Imeshindwa kufikia kamera. Angalia ruhusa na ujaribu tena.",
    "toast.barcodeCaptured": "Msimbo pau umepatikana.",
    "toast.barcodeNoMatch": "Hakuna bidhaa iliyopatikana kwa msimbo pau {code}.",
    "toast.barcodeAdded": "{name} imeongezwa kwa kuchanganua msimbo pau.",
    "receipt.title": "Risiti", "receipt.printButton": "Chapisha",
    "receipt.downloadButton": "Pakua PDF", "receipt.close": "Funga",
    "receipt.dateLabel": "Tarehe", "receipt.thankYou": "Asante kwa biashara yako!",
    "toast.popupBlocked": "Imeshindwa kufungua dirisha la kuchapisha. Angalia kizuizi cha madirisha ibukizi cha kivinjari chako.",
    "pos.customerName": "Jina la mteja (hiari)",
    "pos.customerPhone": "Namba ya simu ya mteja (hiari)",
    "pos.customerNamePlaceholder": "mfano, Amina",
    "pos.customerPhonePlaceholder": "mfano, 07XXXXXXXX",
    "receipt.customerLabel": "Mteja",
    "reports.topCustomersTitle": "Wateja Bora",
    "reports.topCustomersEmpty": "Hakuna mauzo ya wateja yaliyorekodiwa kwa muda huu.",
    "reports.colCustomerName": "Mteja",
    "reports.colCustomerPhone": "Simu",
    "reports.colTotalSpent": "Jumla Aliyotumia",
    "reports.colLastVisit": "Ziara ya Mwisho",
    "receipt.whatsappButton": "Shiriki kupitia WhatsApp",
    "dialog.customerPhonePrompt": "Weka namba ya simu ya mteja kushiriki risiti hii:",
    "toast.invalidPhoneNumber": "Weka namba sahihi ya simu ya Tanzania (mfano 07XXXXXXXX).",
    "dashboard.askAiButton": "Uliza AI kuhusu hili",
    "dashboard.askAiQuestionAlerts": "Ni bidhaa zipi zenye hisa chache au zilizoisha ninazopaswa kuagiza kwanza, na kiasi gani?",
    "dashboard.askAiQuestionRecommendations": "Eleza mapendekezo yangu ya sasa ya ununuzi na nini ninachopaswa kuagiza wiki hii.",
    "deleteAccount.button": "Futa Akaunti",
    "deleteAccount.title": "Futa Akaunti",
    "deleteAccount.warning": "Akaunti yako itafungwa mara moja na kupangwa kufutwa kabisa baada ya siku 30. Unaweza kuirejesha kwa kuingia wakati wowote katika siku hizo 30. Baada ya hapo, taarifa zote za kibinafsi — majina ya wafanyakazi na wateja, namba za simu na barua pepe — zitafutwa kabisa na haziwezi kurejeshwa. Kumbukumbu za mauzo na fedha zitabaki bila majina kwa kipindi kinachohitajika kisheria, kama ilivyoelezwa kwenye Sheria na Masharti.",
    "deleteAccount.passwordLabel": "Thibitisha nenosiri lako",
    "deleteAccount.typeDeleteLabel": "Andika DELETE kuthibitisha",
    "deleteAccount.confirmButton": "Panga Kufuta Akaunti",
    "deleteAccount.confirmTextMismatch": "Andika DELETE sawasawa kuthibitisha.",
    "deleteAccount.passwordRequired": "Weka nenosiri lako kuthibitisha.",
    "deleteAccount.reauthFailed": "Nenosiri si sahihi. Tafadhali jaribu tena.",
    "deleteAccount.alreadyScheduled": "Akaunti hii imepangwa kufutwa tayari.",
    "deleteAccount.ownerOnly": "Mmiliki wa biashara peke yake anaweza kufuta akaunti ya biashara.",
    "deleteAccount.pendingBanner": "Akaunti hii imepangwa kufutwa kabisa baada ya siku {days}. Imefungwa na haiwezi kubadilishwa hadi uirejeshe.",
    "deleteAccount.restoreButton": "Rejesha akaunti yangu",
    "deleteAccount.restoreConfirm": "Rejesha akaunti hii na kusitisha kufutwa kulikopangwa?",
    "deleteAccount.restored": "Akaunti imerejeshwa. Kufutwa kulikopangwa kumesitishwa.",
    "deleteAccount.restoreFailed": "Imeshindwa kurejesha akaunti. Tafadhali jaribu tena.",
    "deleteAccount.gracePeriodOver": "Kipindi cha siku 30 kimeisha na akaunti hii haiwezi kurejeshwa.",
    "toast.accountDeletionScheduled": "Akaunti imefungwa na imepangwa kufutwa baada ya siku {days}. Ingia katika kipindi hicho kuirejesha.",
    "toast.accountDeleted": "Akaunti yako imefutwa.",
    "toast.accountDeleteFailed": "Imeshindwa kufuta akaunti yako. Tafadhali jaribu tena.",
    "backup.button": "Pakua Nakala",
    "toast.backupPreparing": "Inaandaa nakala ya akaunti yako...",
    "toast.backupDownloaded": "Nakala imepakuliwa. Hifadhi faili hili kwa usalama.",
    "toast.backupFailed": "Imeshindwa kuunda nakala. Tafadhali jaribu tena.",
    "pos.discountLabel": "Punguzo",
    "pos.discountNone": "Hakuna punguzo",
    "pos.discountPercent": "Asilimia (%)",
    "pos.discountFixed": "Kiasi maalum",
    "pos.discountValuePlaceholder": "Weka kiasi",
    "pos.applyDiscount": "Tumia",
    "pos.clearDiscount": "Futa",
    "pos.subtotal": "Jumla Ndogo",
    "pos.discountAppliedLabel": "Punguzo",
    "receipt.subtotalLabel": "Jumla Ndogo",
    "receipt.discountLabel": "Punguzo",
    "toast.discountInvalidValue": "Weka kiasi sahihi cha punguzo.",
    "toast.discountPercentTooHigh": "Punguzo la asilimia haliwezi kuzidi 100%.",
    "toast.discountExceedsSubtotal": "Punguzo maalum haliwezi kuzidi jumla ndogo.",
    "toast.discountApplied": "Punguzo limetumika.",
    "toast.discountCleared": "Punguzo limefutwa.",
    "product.expiryLabel": "Tarehe ya mwisho wa matumizi (hiari)",
    "inventory.thExpiry": "Mwisho wa Matumizi",
    "expiry.statusExpired": "Imeisha muda",
    "expiry.statusSoon": "Inakaribia kuisha",
    "expiry.statusOk": "Sawa",
    "expiry.none": "-",
    "alert.expiredDetail": "Imeisha muda tarehe {date}.",
    "alert.expiringSoonDetail": "Inaisha muda baada ya siku {days} (tarehe {date}).",
    "report.colExpiryDate": "Tarehe ya Mwisho",
    "report.colExpiryStatus": "Hali ya Mwisho wa Matumizi",
    "returns.title": "Fanya Marejesho / Kurejesha Fedha",
    "returns.processButton": "Rejesha / Kurejesha Fedha",
    "returns.colItem": "Bidhaa",
    "returns.colAvailable": "Zinazoweza kurejeshwa",
    "returns.colQty": "Kiasi",
    "returns.maxReturnable": "{qty} zinaweza kurejeshwa",
    "returns.confirmButton": "Kamilisha Kurejesha Fedha",
    "returns.noItemsSelected": "Bidhaa zote za oda hii tayari zimerejeshwa.",
    "returns.refundedLabel": "Fedha Iliyorejeshwa",
    "toast.returnNoSelection": "Weka kiasi cha kurejesha kwa angalau bidhaa moja.",
    "toast.returnProcessed": "Kurejesha fedha kwa {amount} kumekamilika na hisa imerejeshwa.",
    "toast.returnFailed": "Imeshindwa kufanya marejesho. Tafadhali jaribu tena.",
    "inventory.generatePoButton": "Tengeneza Oda za Ununuzi",
    "po.dialogTitle": "Rasimu za Oda za Ununuzi",
    "po.noRecommendations": "Hakuna bidhaa zinazohitaji kuagizwa tena kwa sasa.",
    "po.unassignedSupplier": "Msambazaji Hajabainishwa",
    "po.colProduct": "Bidhaa",
    "po.colCurrentStock": "Hisa ya Sasa",
    "po.colReorderQty": "Kiasi cha Kuagiza",
    "po.sendWhatsApp": "Tuma kupitia WhatsApp",
    "po.downloadPdf": "Pakua PDF",
    "po.excludeAll": "Ondoa kikundi",
    "po.generatedOn": "Imetengenezwa tarehe {date}",
    "po.messageIntro": "Ombi la oda ya ununuzi kwa {supplier}:",
    "po.messageClosing": "Tafadhali thibitisha upatikanaji na bei. Asante.",
    "toast.poAllQuantitiesZero": "Kiasi chote kwa msambazaji huyu ni sifuri. Rekebisha kiasi kabla ya kutuma.",
    "pos.credit": "Deni",
    "pos.amountPaidNow": "Kiasi kilicholipwa sasa (hiari)",
    "pos.amountPaidPlaceholder": "0 kama ni deni kamili",
    "pos.amountPaidMethod": "Njia ya kiasi kilicholipwa sasa",
    "pos.balanceDueLabel": "Deni lililobaki",
    "toast.creditNeedsPhone": "Weka namba ya simu ya mteja kwa mauzo ya deni.",
    "toast.creditAmountPaidInvalid": "Kiasi kilicholipwa hakiwezi kuzidi jumla ya mauzo.",
    "receipt.amountPaidLabel": "Kiasi Kilicholipwa",
    "receipt.balanceDueLabel": "Deni Lililobaki",
    "customers.sectionTitle": "Akaunti za Wateja (Deni)",
    "customers.sectionEyebrow": "Madeni ya wateja",
    "customers.colName": "Mteja",
    "customers.colPhone": "Simu",
    "customers.colBalance": "Deni Analodaiwa",
    "customers.colActions": "Vitendo",
    "customers.recordPayment": "Rekodi Malipo",
    "customers.emptyState": "Hakuna mteja anayedaiwa deni kwa sasa.",
    "customers.totalOwed": "Jumla ya deni",
    "payment.dialogTitle": "Rekodi Malipo",
    "payment.currentBalanceLabel": "Deni la sasa",
    "payment.amountLabel": "Kiasi cha malipo",
    "payment.noteLabel": "Maelezo (hiari)",
    "payment.confirmButton": "Rekodi Malipo",
    "toast.paymentInvalidAmount": "Weka kiasi sahihi cha malipo.",
    "toast.paymentExceedsBalance": "Malipo hayawezi kuzidi deni la sasa.",
    "toast.paymentRecorded": "Malipo ya {amount} yamerekodiwa. Deni jipya: {balance}.",
    "toast.paymentFailed": "Imeshindwa kurekodi malipo. Tafadhali jaribu tena.",
    "customers.colDaysOutstanding": "Siku za Deni",
    "customers.colRemind": "Kumbusha",
    "customers.agingCurrent": "Sasa hivi",
    "customers.aging30": "Siku 31-60",
    "customers.aging60": "Siku 61-90",
    "customers.aging90": "Zaidi ya siku 90",
    "customers.remindButton": "Kumbusha kupitia WhatsApp",
    "reminder.messageLine1": "Habari {name}, hii ni kumbusho la kirafiki kutoka {business} kuwa akaunti yako ina deni la {balance}.",
    "reminder.messageLine2": "Deni hili limekuwa wazi kwa siku {days}.",
    "reminder.messageClosing": "Tafadhali lipa mapema iwezekanavyo. Asante kwa biashara yako!",
    "toast.reminderNoPhone": "Mteja huyu hana namba ya simu iliyorekodiwa.",
    "customers.colCreditLimit": "Kikomo cha Deni",
    "customers.setLimitButton": "Weka Kikomo",
    "customers.noLimit": "Hakuna kikomo",
    "dialog.creditLimitPrompt": "Weka kikomo cha deni kwa {name} kwa {currency} (acha wazi kama hakuna kikomo):",
    "toast.creditLimitInvalid": "Weka kikomo sahihi cha deni, au acha wazi kama hakuna kikomo.",
    "toast.creditLimitSet": "Kikomo cha deni cha {name} kimewekwa kuwa {limit}.",
    "toast.creditLimitCleared": "Kikomo cha deni cha {name} kimeondolewa.",
    "toast.creditLimitFailed": "Imeshindwa kusasisha kikomo cha deni. Tafadhali jaribu tena.",
    "dialog.creditLimitExceededConfirm": "{name} tayari anadaiwa {currentBalance}. Mauzo haya yataongeza {newBalanceDue}, na kufanya deni lake kuwa {projectedTotal}, zaidi ya kikomo chake cha {limit}. Uendelee?",
    "dashboard.setCurrency": "Sarafu",
    "dialog.currencyCodePrompt": "Weka msimbo wa herufi 3 wa sarafu ya duka hili (mfano, TZS, USD, KES, UGX):",
    "toast.currencyInvalid": "Weka msimbo sahihi wa herufi 3 za sarafu (herufi pekee).",
    "toast.currencySet": "Sarafu ya duka imewekwa kuwa {code}.",
    "dialog.transferStaffLabel": "Jina la mtu anayefanya uhamishaji huu",
    "dialog.transferStaffPlaceholder": "mfano, Juma Ally",
    "toast.transferStaffRequired": "Weka jina la mtu anayefanya uhamishaji huu.",
    "movement.title": "Mwendo wa Bidhaa",
    "movement.subtitle": "Historia ya mauzo na uhamishaji wa {name}",
    "movement.salesSectionTitle": "Historia ya Mauzo",
    "movement.transfersSectionTitle": "Historia ya Uhamishaji",
    "movement.noSales": "Hakuna mauzo yaliyorekodiwa kwa bidhaa hii bado.",
    "movement.noTransfers": "Hakuna uhamishaji uliorekodiwa kwa bidhaa hii bado.",
    "movement.colDate": "Tarehe",
    "movement.colStaff": "Mfanyakazi",
    "movement.colQty": "Kiasi",
    "movement.colOrder": "Oda #",
    "movement.colFrom": "Kutoka",
    "movement.colTo": "Kwenda",
    "movement.colTransferBy": "Alihamisha",
    "movement.viewButton": "Ona Mwendo",
    "movement.close": "Funga",
    "staff.rosterButton": "Orodha ya Wafanyakazi",
    "staff.rosterTitle": "Orodha ya Wafanyakazi",
    "staff.inviteButton": "Alika Mfanyakazi",
    "staff.inviteDialogTitle": "Alika Mfanyakazi",
    "staff.inviteEmailLabel": "Barua pepe ya mfanyakazi",
    "staff.roleCashier": "Mfanya Mauzo",
    "staff.roleManager": "Meneja",
    "staff.inviteStoresLabel": "Ufikiaji wa maduka",
    "staff.inviteAllStores": "Maduka yote (ufikiaji wa kuzunguka)",
    "staff.sendInviteButton": "Tuma Mwaliko",
    "staff.inviteEmailInvalid": "Weka barua pepe sahihi ya mfanyakazi.",
    "staff.inviteStoresRequired": "Chagua duka moja angalau, au Maduka yote.",
    "staff.inviteFailed": "Imeshindwa kuunda mwaliko. Tafadhali jaribu tena.",
    "staff.inviteNetworkError": "Imeshindwa kufikia huduma ya mwaliko. Angalia muunganisho wako na ujaribu tena.",
    "staff.inviteResultText": "Mwaliko umeundwa kwa {email} kama {role}. Shiriki kiungo hapa chini \u2014 kinaisha baada ya masaa 48 na kinaweza kutumika mara moja tu.",
    "staff.copyLinkButton": "Nakili Kiungo",
    "staff.sendWhatsAppButton": "Tuma kupitia WhatsApp",
    "staff.linkCopied": "Kiungo cha mwaliko kimenakiliwa.",
    "staff.copyFailed": "Imeshindwa kunakili kiungo. Tafadhali jaribu tena.",
    "staff.colEmail": "Barua Pepe",
    "staff.colRole": "Wadhifa",
    "staff.colStores": "Maduka",
    "staff.colActions": "Vitendo",
    "staff.revokeButton": "Ondoa",
    "staff.rosterEmpty": "Hakuna mfanyakazi aliyekubali mwaliko bado.",
    "staff.allStoresLabel": "Maduka yote",
    "staff.revokeConfirm": "Ondoa ufikiaji wa {email}? Watatolewa mara moja kwenye data ya biashara hii.",
    "staff.revokeSuccess": "Ufikiaji umeondolewa kwa {email}.",
    "staff.revokeFailed": "Imeshindwa kuondoa ufikiaji. Tafadhali jaribu tena."
  }
};

function t(key, vars) {
  const template = (DICTIONARY[state.language] && DICTIONARY[state.language][key]) || DICTIONARY.en[key] || key;
  if (!vars) return template;
  return Object.entries(vars).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), template);
}

const CURRENCY_SUFFIX_LABEL_KEYS = new Set(["product.priceLabel", "payment.amountLabel", "pos.discountFixed"]);

function translateStaticDom() {
  document.documentElement.lang = state.language;
  const code = currentCurrencyCode();
  qsa("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    el.textContent = CURRENCY_SUFFIX_LABEL_KEYS.has(key) ? `${t(key)} (${code})` : t(key);
  });
  qsa("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  const langButton = qs("#langToggleButton");
  if (langButton) langButton.textContent = t("topbar.langToggle");
}

function setLanguage(nextLanguage) {
  state.language = nextLanguage;
  try {
    localStorage.setItem("dukasmart:lang", nextLanguage);
  } catch (error) {
    console.warn(error);
  }
  translateStaticDom();
  renderStoreSwitcher();
  renderAll();
  renderChatLog();
  renderMonthlyReportsList();
}

// NOTE: price overrides are authorized server-side only. verifyOverridePassword()
// below calls the Render proxy's /api/ai/override-verify endpoint, which checks the
// code against a bcrypt hash stored in Render's environment variables (never shipped
// in this bundle). Do not reintroduce a client-side password/hash check here — any
// value shipped in app.js is readable in DevTools and can be brute-forced offline
// instantly. (An earlier version of this file had exactly that: a sha256Hex() helper
// compared against priceConfig.overridePasswordHash from price-config.js. Both are
// gone; price-config.js is now a deprecated stub excluded from Hosting deploys.)

async function verifyOverridePassword() {
  const input = window.prompt(t("dialog.overridePasswordPrompt"));
  if (input === null) return false;
  try {
    const token = await state.user.getIdToken(/* forceRefresh */ true);
    const response = await fetch(aiConfig.overrideVerifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: input })
    });
    if (response.status === 503) {
      // Distinguish "not configured" from "wrong password" so admins don't chase
      // a typo that isn't the real problem — see PRICE_OVERRIDE_PASSWORD_HASH in
      // proxy/.env.example. The proxy itself returns 503 specifically for this case.
      showToast(t("toast.overrideNotConfigured"));
      return false;
    }
    if (!response.ok) {
      showToast(t("toast.incorrectPassword"));
      return false;
    }
    const { authorized } = await response.json();
    if (!authorized) {
      showToast(t("toast.incorrectPassword"));
      return false;
    }
    return true;
  } catch (error) {
    console.warn(error);
    showToast(t("toast.overrideNetworkError"));
    return false;
  }
}

function pushCartHistory() {
  state.cartHistory.push(JSON.parse(JSON.stringify(state.cart)));
  if (state.cartHistory.length > 20) state.cartHistory.shift();
}

function undoLastCartAction() {
  if (!state.cartHistory.length) return showToast(t("toast.nothingToUndo"));
  state.cart = state.cartHistory.pop();
  renderCart();
  showToast(t("toast.lastCartActionUndone"));
}

function productStoreId(product) {
  return product.storeId || state.stores[0]?.id || "";
}

function saleStoreId(sale) {
  return sale.storeId || state.stores[0]?.id || "";
}

function activeStores() {
  return state.stores.filter((store) => !store.archived);
}

function storeProducts() {
  if (!state.db) return state.products;
  if (!state.currentStoreId) return [];
  if (state.currentStoreId === "all") return state.products;
  if (cachedStoreProductsSource === state.products && cachedStoreProductsStoreId === state.currentStoreId) {
    return cachedStoreProducts;
  }
  cachedStoreProducts = state.products.filter((product) => productStoreId(product) === state.currentStoreId);
  cachedStoreProductsSource = state.products;
  cachedStoreProductsStoreId = state.currentStoreId;
  return cachedStoreProducts;
}

function stockStatus(product) {
  if (product.quantity <= 0) return "out";
  if (product.quantity <= product.reorderLevel) return "low";
  return "healthy";
}

const EXPIRY_WARNING_DAYS = 30;

function daysUntilExpiry(product) {
  if (!product.expiryDate) return null;
  const expiry = new Date(`${product.expiryDate}T23:59:59`);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryStatus(product) {
  const days = daysUntilExpiry(product);
  if (days === null) return "none";
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "soon";
  return "ok";
}

function expiryBadgeHtml(product) {
  const status = expiryStatus(product);
  if (status === "none") return `<span class="muted">${t("expiry.none")}</span>`;
  const label = status === "expired" ? t("expiry.statusExpired") : status === "soon" ? t("expiry.statusSoon") : t("expiry.statusOk");
  const cls = status === "expired" ? "out" : status === "soon" ? "low" : "healthy";
  return `<span class="status ${cls}">${label}</span> <span class="muted">${esc(product.expiryDate)}</span>`;
}

function productDisplayLabel(product) {
  const parts = [product.category, product.brand].filter(Boolean);
  return parts.length ? `${product.name} (${parts.join(" \u2022 ")})` : product.name;
}

function calculateMetrics() {
  const products = storeProducts();
  const totalQuantity = products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const lowStock = products.filter((item) => stockStatus(item) === "low").length;
  const out = products.filter((item) => stockStatus(item) === "out").length;
  const categories = new Set(products.map((item) => item.category).filter(Boolean)).size;
  const suppliers = new Set(products.map((item) => item.supplier).filter(Boolean)).size;

  return {
    totalQuantity,
    totalProducts: products.length,
    categories,
    suppliers,
    lowStock,
    out
  };
}

function renderKpis() {
  const metrics = calculateMetrics();
  const cards = [
    [t("kpi.totalProducts"), metrics.totalProducts, t("kpi.totalProductsDelta")],
    [t("kpi.totalQuantity"), metrics.totalQuantity, t("kpi.totalQuantityDelta")],
    [t("kpi.categories"), metrics.categories, t("kpi.categoriesDelta")],
    [t("kpi.suppliers"), metrics.suppliers, t("kpi.suppliersDelta")],
    [t("kpi.lowStock"), metrics.lowStock, t("kpi.lowStockDelta")],
    [t("kpi.outStock"), metrics.out, t("kpi.outStockDelta")]
  ];

  qs("#kpiGrid").innerHTML = cards
    .map(([label, value, delta]) => `<div class="kpi-card"><span class="muted">${label}</span><strong>${value}</strong><span class="delta">${delta}</span></div>`)
    .join("");
}

function renderChart() {
  const canvas = qs("#salesChart");
  const ctx = canvas.getContext("2d");
  const chartProducts = storeProducts().slice(0, 12);
  const labels = chartProducts.map((product) => {
    const parts = [product.name, product.brand, product.category].filter(Boolean);
    return parts.join(" \u2022 ").slice(0, 28);
  });
  const data = chartProducts.map((product) => Number(product.quantity || 0));
  const width = canvas.width;
  const height = canvas.height;
  const padLeft = 56;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 78;
  const max = Math.max(...data, 1) * 1.18;
  const mutedColor = getComputedStyle(document.documentElement).getPropertyValue("--muted");

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line");
  ctx.lineWidth = 1;

  const gridLines = 5;
  for (let i = 0; i < gridLines; i += 1) {
    const y = padTop + ((height - padTop - padBottom) / (gridLines - 1)) * i;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();

    const value = Math.round(max - (max / (gridLines - 1)) * i);
    ctx.fillStyle = mutedColor;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(String(value), padLeft - 8, y + 4);
  }
  ctx.textAlign = "left";

  if (!data.length) {
    ctx.fillStyle = mutedColor;
    ctx.font = "15px Inter, sans-serif";
    ctx.fillText(t("chart.emptyPrompt"), padLeft, height / 2);
    return;
  }

  const points = data.map((value, index) => ({
    x: padLeft + ((width - padLeft - padRight) / Math.max(data.length - 1, 1)) * index,
    y: height - padBottom - (value / max) * (height - padTop - padBottom)
  }));

  const gradient = ctx.createLinearGradient(0, padTop, 0, height - padBottom);
  gradient.addColorStop(0, "rgba(70, 194, 161, 0.35)");
  gradient.addColorStop(1, "rgba(106, 167, 255, 0.02)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - padBottom);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height - padBottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "#46c2a1";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = mutedColor;
  ctx.font = "11px Inter, sans-serif";
  labels.forEach((label, index) => {
    ctx.save();
    ctx.translate(points[index].x, height - padBottom + 14);
    ctx.rotate(-Math.PI / 5);
    ctx.textAlign = "right";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  });
}

function renderRevenueChart() {
  const canvas = qs("#revenueChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const { labels, values } = computeRevenueTrend();
  const width = canvas.width;
  const height = canvas.height;
  const pad = 44;
  const max = Math.max(...values, 1) * 1.18;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line");
  ctx.lineWidth = 1;
  for (let i = 0; i < 4; i += 1) {
    const y = pad + ((height - pad * 2) / 3) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  if (!values.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
    ctx.font = "15px Inter, sans-serif";
    ctx.fillText(t("reports.revenueTrendEmpty"), pad, height / 2);
    return;
  }

  const points = values.map((value, index) => ({
    x: pad + ((width - pad * 2) / Math.max(values.length - 1, 1)) * index,
    y: height - pad - (value / max) * (height - pad * 2)
  }));

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, "rgba(106, 167, 255, 0.32)");
  gradient.addColorStop(1, "rgba(106, 167, 255, 0.02)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - pad);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "#6aa7ff";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
  ctx.font = "12px Inter, sans-serif";
  const labelStep = Math.max(1, Math.ceil(labels.length / 10));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0) return;
    ctx.fillText(label, points[index].x - 14, height - 14);
  });
}

function reorderRecommendation(product) {
  const dailyDemand = Number(product.sold90 || 0) / 90;
  const safetyStock = Math.ceil(dailyDemand * 7);
  const expectedDemandDuringLeadTime = Math.ceil(dailyDemand * Number(product.leadTimeDays || 10));
  const reorderLevel = Number(product.reorderLevel || 0);
  const quantity = Number(product.quantity || 0);
  const targetStock = reorderLevel + expectedDemandDuringLeadTime + safetyStock;
  const recommendedQty = Math.max(0, targetStock - quantity);
  const daysUntilStockout = quantity === 0 ? 0 : Math.floor(quantity / Math.max(dailyDemand, 0.1));
  return { recommendedQty, daysUntilStockout, expectedDemandDuringLeadTime };
}

function detectStockAlertCrossings(previousProducts, nextProducts) {
  if (!state.stockAlertPopupEnabled || !state.productsInitialized) return;
  const previousMap = new Map(previousProducts.map((product) => [product.id, product]));
  nextProducts.forEach((product) => {
    const status = stockStatus(product);
    if (status === "healthy") return;
    const previous = previousMap.get(product.id);
    const previousStatus = previous ? stockStatus(previous) : "healthy";
    if (previousStatus === "healthy") queueStockAlertPopup(product);
  });
}

function queueStockAlertPopup(product) {
  const rec = reorderRecommendation(product);
  state.stockAlertQueue.push({
    name: product.name,
    quantity: Number(product.quantity || 0),
    reorderLevel: Number(product.reorderLevel || 0),
    recommendedQty: rec.recommendedQty
  });
  showNextStockAlertPopup();
}

function showNextStockAlertPopup() {
  if (state.stockAlertPopupOpen) return;
  const next = state.stockAlertQueue.shift();
  if (!next) return;
  state.stockAlertPopupOpen = true;
  qs("#stockAlertProductName").textContent = next.name;
  qs("#stockAlertDetail").textContent = next.quantity <= 0
    ? t("stockAlert.outOfStockDetail", { reorderLevel: next.reorderLevel })
    : t("stockAlert.remainingDetail", { quantity: next.quantity, reorderLevel: next.reorderLevel });
  qs("#stockAlertSuggestion").textContent = next.recommendedQty > 0
    ? t("stockAlert.suggestedReorder", { qty: next.recommendedQty })
    : t("stockAlert.noSuggestion");
  const remaining = state.stockAlertQueue.length;
  qs("#stockAlertQueueNote").textContent = remaining
    ? (remaining === 1 ? t("stockAlert.queueNoteOne") : t("stockAlert.queueNoteMany", { count: remaining }))
    : "";
  qs("#stockAlertDialog").showModal();
}

function closeStockAlertPopup() {
  qs("#stockAlertDialog").close();
  state.stockAlertPopupOpen = false;
  if (state.stockAlertQueue.length) showNextStockAlertPopup();
}

function renderAlertsAndRecommendations() {
  const risky = storeProducts().filter((product) => stockStatus(product) !== "healthy");
  const expiring = storeProducts().filter((product) => ["expired", "soon"].includes(expiryStatus(product)));
  qs("#alertCount").textContent = risky.length + expiring.length;

  const stockAlertsHtml = risky
    .map((product) => {
      const status = stockStatus(product);
      return `<div class="alert-item ${status === "out" ? "red" : "amber"}" data-view-movement="${product.id}" style="cursor:pointer">
        <strong>${esc(productDisplayLabel(product))}</strong>
        <span class="muted">${status === "out" ? t("inventory.stockOut") : t("alert.belowMinimum", { quantity: product.quantity })}</span>
        <span class="muted">${t("movement.viewButton")}</span>
      </div>`;
    })
    .join("");

  const expiryAlertsHtml = expiring
    .map((product) => {
      const status = expiryStatus(product);
      const days = daysUntilExpiry(product);
      const detail = status === "expired"
        ? t("alert.expiredDetail", { date: product.expiryDate })
        : t("alert.expiringSoonDetail", { days, date: product.expiryDate });
      return `<div class="alert-item ${status === "expired" ? "red" : "amber"}" data-view-movement="${product.id}" style="cursor:pointer">
        <strong>${esc(productDisplayLabel(product))}</strong>
        <span class="muted">${detail}</span>
        <span class="muted">${t("movement.viewButton")}</span>
      </div>`;
    })
    .join("");

  qs("#alertList").innerHTML = stockAlertsHtml + expiryAlertsHtml || `<div class="alert-item"><strong>${t("alert.allClearTitle")}</strong><span class="muted">${t("alert.allClearBody")}</span></div>`;

  const recs = storeProducts()
    .map((product) => ({ product, rec: reorderRecommendation(product) }))
    .filter(({ rec }) => rec.recommendedQty > 0)
    .sort((a, b) => a.rec.daysUntilStockout - b.rec.daysUntilStockout)
    .slice(0, 4);

  qs("#recommendationList").innerHTML = recs
    .map(({ product, rec }) => `<div class="recommendation">
      <strong>${esc(productDisplayLabel(product))}</strong>
      <span>${t("rec.reorderNow", { qty: rec.recommendedQty })}</span>
      <small class="muted">${t("rec.estimatedStockout", { days: rec.daysUntilStockout })}</small>
    </div>`)
    .join("");
}

function renderMovement() {
  const products = storeProducts();
  const classes = [
    [t("movement.fastMoving"), products.filter((p) => Number(p.sold30 || 0) >= 50).length, "#5ed08f"],
    [t("movement.slowMoving"), products.filter((p) => Number(p.sold30 || 0) > 0 && Number(p.sold30 || 0) < 12).length, "#f1b44c"],
    [t("movement.noSales"), products.filter((p) => Number(p.sold90 || 0) === 0).length, "#ef6666"],
    [t("movement.healthyCoverage"), products.filter((p) => stockStatus(p) === "healthy").length, "#6aa7ff"]
  ];
  qs("#movementList").innerHTML = classes
    .map(([label, value, color]) => `<div class="movement-row"><strong style="color:${color}">${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderFilters() {
  const selectedCategory = qs("#categoryFilter")?.value || "all";
  const seen = new Map();
  storeProducts().forEach((product) => {
    const raw = String(product.category || "").trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  });
  const categories = ["all", ...seen.values()];
  qs("#categoryFilter").innerHTML = categories.map((category) => `<option value="${esc(category)}">${category === "all" ? "All categories" : esc(category)}</option>`).join("");
  qs("#categoryFilter").value = categories.includes(selectedCategory) ? selectedCategory : "all";
}

function filteredProducts() {
  const term = qs("#globalSearch").value.trim().toLowerCase();
  const category = qs("#categoryFilter")?.value || "all";
  const stock = qs("#stockFilter")?.value || "all";
  return storeProducts()
    .filter((product) => {
      const haystack = [product.name, product.sku, product.category, product.brand, product.supplier].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    })
    .filter((product) => category === "all" || String(product.category || "").trim().toLowerCase() === category.trim().toLowerCase())
    .filter((product) => stock === "all" || stockStatus(product) === stock)
    .sort((a, b) => {
      const left = a[state.sortKey];
      const right = b[state.sortKey];
      if (typeof left === "number") return (left - right) * state.sortDirection;
      return String(left).localeCompare(String(right)) * state.sortDirection;
    });
}

function renderInventory() {
  const products = filteredProducts();
  qs("#inventoryTable").innerHTML = products
    .map((product) => {
      const status = stockStatus(product);
      const label = status === "out" ? t("inventory.stockOut") : status === "low" ? t("inventory.stockLow") : t("inventory.stockHealthy");
      return `<tr>
        <td><button class="link-button" type="button" data-view-movement="${product.id}">${esc(productDisplayLabel(product))}</button></td>
        <td>${esc(product.category)}</td>
        <td>${esc(product.brand || "-")}</td>
        <td>${esc(product.supplier || "-")}</td>
        <td>${product.quantity}</td>
        <td><span class="status ${status}">${label}</span></td>
        <td>${expiryBadgeHtml(product)}</td>
        <td class="table-actions">
          ${isOwnerRole() ? `<button class="ghost-button compact" data-edit-product="${product.id}">${t("inventory.edit")}</button>` : ""}
          <button class="ghost-button compact" data-restock-product="${product.id}">${t("inventory.restock")}</button>
          ${activeStores().length > 1 && isManagerOrOwnerRole() ? `<button class="ghost-button compact" data-transfer-product="${product.id}">${t("inventory.transfer")}</button>` : ""}
          ${isOwnerRole() ? `<button class="ghost-button compact danger" data-delete-product="${product.id}">${t("inventory.delete")}</button>` : ""}
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="8" class="empty-state">${t("inventory.emptyState")}</td></tr>`;
}

function renderPosProducts() {
  const term = qs("#posSearch").value.trim().toLowerCase();
  const products = storeProducts().filter((product) => !term || [product.name, product.category, product.brand, product.supplier].join(" ").toLowerCase().includes(term));
  qs("#posProducts").innerHTML = products
    .slice(0, 8)
    .map((product) => `<div class="pos-product">
      <strong>${esc(product.name)}</strong>
      <span class="muted">${esc(product.category)} \u2022 ${esc(product.brand || "-")} - ${money(product.sellingPrice)} - ${t("pos.available", { quantity: product.quantity })}</span>
      <div class="pos-product-controls">
        <input type="number" min="1" max="${product.quantity}" value="1" class="pos-qty-input" data-qty-input="${product.id}" aria-label="${esc(t("pos.qtyAriaLabel", { name: product.name }))}" />
        ${product.priceType === "dynamic" ? `<input type="number" min="0" step="0.01" class="pos-price-input" data-price-input="${product.id}" placeholder="${esc(t("pos.pricePerUnitPlaceholder"))}" />` : ""}
        <button class="ghost-button compact" data-add-cart="${product.id}" type="button">${t("pos.addButton")}</button>
      </div>
    </div>`)
    .join("");
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.qty * Number(item.sellingPrice || 0), 0);
}

function computeDiscountAmount(subtotal) {
  if (state.discountType === "percent") {
    return Math.min(subtotal, subtotal * (Number(state.discountValue || 0) / 100));
  }
  if (state.discountType === "fixed") {
    return Math.min(subtotal, Number(state.discountValue || 0));
  }
  return 0;
}

function clearDiscount() {
  state.discountType = "none";
  state.discountValue = 0;
}

async function applyDiscount() {
  const type = qs("#discountTypeSelect")?.value || "none";
  if (type === "none") {
    clearDiscountAndRender();
    return;
  }
  const rawValue = Number(qs("#discountValueInput")?.value || 0);
  if (!Number.isFinite(rawValue) || rawValue <= 0) return showToast(t("toast.discountInvalidValue"));
  if (type === "percent" && rawValue > 100) return showToast(t("toast.discountPercentTooHigh"));
  if (type === "fixed" && rawValue > cartSubtotal()) return showToast(t("toast.discountExceedsSubtotal"));

  const authorized = await verifyOverridePassword();
  if (!authorized) return;

  state.discountType = type;
  state.discountValue = rawValue;
  renderCart();
  showToast(t("toast.discountApplied"));
}

function clearDiscountAndRender() {
  clearDiscount();
  const discountValueInput = qs("#discountValueInput");
  if (discountValueInput) discountValueInput.value = "";
  renderCart();
  showToast(t("toast.discountCleared"));
}

function renderCart() {
  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartSubtotal();
  const discountAmount = computeDiscountAmount(subtotal);
  const totalAmount = Math.max(0, subtotal - discountAmount);

  qs("#cartCount").textContent = totalQty;
  qs("#cartItems").innerHTML = state.cart
    .map((item) => {
      const product = state.products.find((p) => p.id === item.id);
      const maxQty = product ? product.quantity : item.qty;
      return `<div class="cart-item">
        <div class="cart-item-info">
          <strong>${esc(item.name)}</strong>
          <span class="muted">${money(item.sellingPrice)} each
            ${item.priceType !== "dynamic" ? `<button class="link-button" data-edit-price="${item.id}" type="button">${t("cart.editPrice")}</button>` : ""}
          </span>
        </div>
        <div class="cart-item-controls">
          <button class="ghost-button compact" data-decrease-cart="${item.id}" type="button" aria-label="${esc(t("cart.decreaseAriaLabel"))}">-</button>
          <input type="number" min="1" max="${maxQty}" value="${item.qty}" class="cart-qty-input" data-qty-edit="${item.id}" aria-label="${esc(t("cart.qtyAriaLabel", { name: item.name }))}" />
          <button class="ghost-button compact" data-increase-cart="${item.id}" type="button" aria-label="${esc(t("cart.increaseAriaLabel"))}">+</button>
          <button class="ghost-button compact danger" data-remove-cart="${item.id}" type="button" aria-label="${esc(t("cart.removeAriaLabel"))}">${t("cart.removeButton")}</button>
        </div>
        <strong class="cart-item-total">${money(item.qty * Number(item.sellingPrice || 0))}</strong>
      </div>`;
    })
    .join("") || `<span class="muted">${t("cart.empty")}</span>`;

  const subtotalRow = qs("#cartSubtotalRow");
  if (subtotalRow) subtotalRow.hidden = state.discountType === "none";
  const subtotalLabel = qs("#cartSubtotalValue");
  if (subtotalLabel) subtotalLabel.textContent = money(subtotal);
  const discountRow = qs("#cartDiscountRow");
  if (discountRow) discountRow.hidden = state.discountType === "none";
  const discountLabel = qs("#cartDiscountValue");
  if (discountLabel) discountLabel.textContent = `- ${money(discountAmount)}`;

  qs("#cartTotal").textContent = money(totalAmount);

  const discountTypeSelect = qs("#discountTypeSelect");
  if (discountTypeSelect) discountTypeSelect.value = state.discountType;
  const discountValueInput = qs("#discountValueInput");
  if (discountValueInput && document.activeElement !== discountValueInput) {
    discountValueInput.value = state.discountValue || "";
  }
  const discountValueRow = qs("#discountValueRow");
  if (discountValueRow) discountValueRow.hidden = state.discountType === "none";
  const clearDiscountButton = qs("#clearDiscountButton");
  if (clearDiscountButton) clearDiscountButton.hidden = state.discountType === "none";

  const cashTenderRow = qs("#cashTenderRow");
  cashTenderRow.hidden = state.paymentMethod !== "cash";
  const tendered = Number(qs("#cashTendered")?.value || 0);
  const change = Math.max(0, tendered - totalAmount);
  qs("#changeDue").textContent = money(change);

  const undoCartButton = qs("#undoCartButton");
  if (undoCartButton) undoCartButton.disabled = !state.cartHistory.length;
  const undoSaleButton = qs("#undoSaleButton");
  if (undoSaleButton) {
    undoSaleButton.hidden = !isManagerOrOwnerRole();
    undoSaleButton.disabled = !state.lastSale;
  }
}

function renderPos() {
  renderPosProducts();
  renderCart();
  renderStaffSelect();
}

function getSalesRangeBounds() {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const preset = state.salesRangePreset;

  if (preset === "today") return { start: startOfToday, end: null };
  if (preset === "week") {
    const start = new Date(startOfToday);
    start.setDate(start.getDate() - start.getDay());
    return { start, end: null };
  }
  if (preset === "month") return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
  if (preset === "custom") {
    const start = state.salesRangeFrom ? new Date(state.salesRangeFrom) : null;
    const end = state.salesRangeTo ? new Date(`${state.salesRangeTo}T23:59:59`) : null;
    return { start, end };
  }
  return { start: null, end: null };
}

function saleDate(sale) {
  if (!sale.createdAt) return null;
  if (typeof sale.createdAt.toDate === "function") return sale.createdAt.toDate();
  return new Date(sale.createdAt);
}

function filteredSales() {
  const { start, end } = getSalesRangeBounds();
  if (state.db && !state.currentStoreId) return [];
  return state.sales.filter((sale) => {
    if (sale.voided) return false;
    if (state.db && state.currentStoreId !== "all" && saleStoreId(sale) !== state.currentStoreId) return false;
    const date = saleDate(sale);
    if (start && (!date || date < start)) return false;
    if (end && (!date || date > end)) return false;
    return true;
  });
}

function saleAmountForMethod(sale, method) {
  const paymentMethod = sale.paymentMethod || "cash";
  if (paymentMethod === "credit") {
    // Only the portion actually received (amountPaid) counts toward a
    // cash/mobile/card bucket; the remaining balanceDue is a receivable,
    // tracked separately in Customer Accounts, not "revenue by method".
    const paidMethod = sale.amountPaidMethod || "cash";
    return paidMethod === method ? Number(sale.amountPaid || 0) : 0;
  }
  return paymentMethod === method ? Number(sale.total || 0) : 0;
}

function computeMethodBreakdown(sales, method) {
  const contributing = sales
    .map((sale) => ({ sale, amount: saleAmountForMethod(sale, method) }))
    .filter((entry) => entry.amount > 0);
  const total = contributing.reduce((sum, entry) => sum + entry.amount, 0);
  const count = contributing.length;
  const average = count ? total / count : 0;

  const itemTotals = new Map();
  contributing.forEach(({ sale }) => {
    (sale.items || []).forEach((item) => {
      const key = item.name || "Unknown";
      itemTotals.set(key, (itemTotals.get(key) || 0) + Number(item.qty || 0));
    });
  });
  const topItems = [...itemTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, qty]) => `${name} (${qty})`);

  return { method, total, count, average, topItems };
}

function computePaymentReport() {
  const sales = filteredSales();
  const breakdown = ["cash", "mobile", "card"].map((method) => computeMethodBreakdown(sales, method));
  const grandTotal = breakdown.reduce((sum, entry) => sum + entry.total, 0);
  return { breakdown, grandTotal, transactionCount: sales.length };
}

function monthKeyToRange(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 0, 23, 59, 59);
  return { periodStart, periodEnd };
}

function computeMonthlyMetrics(monthKey, storeId) {
  const { periodStart, periodEnd } = monthKeyToRange(monthKey);
  const scopedSales = state.sales.filter((sale) => {
    if (sale.voided) return false;
    if (storeId !== "all" && saleStoreId(sale) !== storeId) return false;
    const date = saleDate(sale);
    return date && date >= periodStart && date <= periodEnd;
  });

  const revenue = scopedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const transactionCount = scopedSales.length;
  const avgSale = transactionCount ? revenue / transactionCount : 0;
  const unitsSold = scopedSales.reduce((sum, sale) => sum + (sale.items || []).reduce((itemSum, item) => itemSum + Number(item.qty || 0), 0), 0);

  const itemTotals = new Map();
  scopedSales.forEach((sale) => {
    (sale.items || []).forEach((item) => {
      const key = item.name || "Unknown";
      itemTotals.set(key, (itemTotals.get(key) || 0) + Number(item.qty || 0));
    });
  });
  const topProducts = [...itemTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));

  const scopedProducts = storeId === "all" ? state.products : state.products.filter((product) => productStoreId(product) === storeId);
  const lowStockCount = scopedProducts.filter((product) => stockStatus(product) === "low").length;
  const outOfStockCount = scopedProducts.filter((product) => stockStatus(product) === "out").length;

  return { periodStart, periodEnd, revenue, transactionCount, avgSale, unitsSold, topProducts, lowStockCount, outOfStockCount };
}

function localMonthlyReportNarrative(monthKey, metrics, storeId) {
  const topLine = metrics.topProducts.length
    ? t("monthlyReport.topProductsLine", { list: metrics.topProducts.map((product) => `${product.name} (${product.qty})`).join(", ") })
    : t("monthlyReport.noTopProducts");
  const lines = [
    t("monthlyReport.revenueLine", { period: monthKey, revenue: moneyForStore(Math.round(metrics.revenue), storeId), count: metrics.transactionCount }),
    topLine,
    t("monthlyReport.stockLine", { low: metrics.lowStockCount, out: metrics.outOfStockCount }),
    t("monthlyReport.localFallbackNote")
  ];
  return lines.join("\n");
}

async function generateMonthlyReportNarrative(monthKey, metrics, storeId) {
  if (!aiConfig.proxyUrl) throw new Error(t("txerror.aiNetworkError"));
  const languageName = state.language === "sw" ? "Swahili" : "English";
  const promptLines = [
    `Write a concise monthly business performance summary in ${languageName} for the period ${monthKey}.`,
    `Revenue: ${moneyForStore(metrics.revenue, storeId)}. Transactions: ${metrics.transactionCount}. Average sale: ${moneyForStore(Math.round(metrics.avgSale), storeId)}. Units sold: ${metrics.unitsSold}.`,
    `Top products: ${metrics.topProducts.map((product) => `${product.name} (${product.qty})`).join(", ") || "none"}.`,
    `Low stock items: ${metrics.lowStockCount}. Out-of-stock items: ${metrics.outOfStockCount}.`,
    "Include 2-3 short, specific action recommendations. Keep the whole response under 150 words."
  ];
  return postToAiProxy([{ role: "user", content: promptLines.join("\n") }], { products: [], metrics: {} });
}

function renderMonthlyReportsList() {
  const container = qs("#monthlyReportsList");
  if (!container) return;
  container.innerHTML = state.monthlyReports
    .map((report) => `<article class="report-card" data-view-monthly-report="${report.id}" style="cursor:pointer">
        <strong>${esc(report.periodLabel)}</strong>
        <span class="muted">${money(report.metrics?.revenue || 0)} \u2014 ${Number(report.metrics?.transactionCount || 0)} ${report.metrics?.transactionCount === 1 ? t("report.transaction") : t("report.transactions")}</span>
      </article>`)
    .join("") || `<p class="muted">${t("monthlyReport.emptyState")}</p>`;
}

function openMonthlyReportDetail(reportId) {
  const report = state.monthlyReports.find((item) => item.id === reportId);
  if (!report) return;
  state.openMonthlyReportId = reportId;
  const metrics = report.metrics || {};
  qs("#monthlyReportDialogTitle").textContent = report.periodLabel;
  qs("#monthlyReportDetailKpis").innerHTML = [
    [t("monthlyReport.detailRevenue"), moneyForStore(metrics.revenue || 0, report.storeId)],
    [t("monthlyReport.detailTransactions"), Number(metrics.transactionCount || 0)],
    [t("monthlyReport.detailAvgSale"), moneyForStore(Math.round(Number(metrics.avgSale || 0)), report.storeId)],
    [t("monthlyReport.detailUnitsSold"), Number(metrics.unitsSold || 0)],
    [t("monthlyReport.detailLowStock"), Number(metrics.lowStockCount || 0)],
    [t("monthlyReport.detailOutOfStock"), Number(metrics.outOfStockCount || 0)]
  ].map(([label, value]) => `<div class="kpi-card"><span class="muted">${label}</span><strong>${value}</strong></div>`).join("");
  qs("#monthlyReportDetailSummary").textContent = report.aiSummary || "";
  qs("#monthlyReportDialog").showModal();
}

function exportMonthlyReportPdf() {
  const report = state.monthlyReports.find((item) => item.id === state.openMonthlyReportId);
  if (!report) return;
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const metrics = report.metrics || {};
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text(`DukaSmart Monthly Report \u2014 ${report.periodLabel}`, 14, 16);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 22);

  const kpiRows = [
    [t("monthlyReport.detailRevenue"), moneyForStore(metrics.revenue || 0, report.storeId)],
    [t("monthlyReport.detailTransactions"), String(Number(metrics.transactionCount || 0))],
    [t("monthlyReport.detailAvgSale"), moneyForStore(Math.round(Number(metrics.avgSale || 0)), report.storeId)],
    [t("monthlyReport.detailUnitsSold"), String(Number(metrics.unitsSold || 0))],
    [t("monthlyReport.detailLowStock"), String(Number(metrics.lowStockCount || 0))],
    [t("monthlyReport.detailOutOfStock"), String(Number(metrics.outOfStockCount || 0))]
  ];

  let y = 30;
  if (typeof doc.autoTable === "function") {
    doc.autoTable({ body: kpiRows, startY: y, theme: "plain" });
    y = doc.lastAutoTable.finalY + 10;
  } else {
    kpiRows.forEach((row) => {
      doc.text(row.join(": "), 14, y);
      y += 6;
    });
    y += 6;
  }

  doc.setFontSize(11);
  doc.text(t("monthlyReport.detailSummaryLabel"), 14, y);
  y += 6;
  doc.setFontSize(10);
  const summaryLines = doc.splitTextToSize(report.aiSummary || "", 180);
  doc.text(summaryLines, 14, y);

  doc.save(`dukasmart-monthly-report-${report.periodLabel}.pdf`);
}

async function subscribeToMonthlyReports() {
  // Owner-only: firestore.rules grants monthlyReports read to isOwner(userId)
  // only, no manager/cashier branch -- these are business-performance
  // summaries, not something day-to-day staff need or should see.
  if (!state.db || !state.user || state.user.uid !== state.businessOwnerUid) return;
  if (state.unsubscribeMonthlyReports) state.unsubscribeMonthlyReports();
  try {
    const { collection, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const reportsQuery = query(collection(state.db, "users", state.businessOwnerUid, "monthlyReports"), orderBy("periodLabel", "desc"));
    state.unsubscribeMonthlyReports = onSnapshot(reportsQuery, (snapshot) => {
      state.monthlyReports = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderMonthlyReportsList();
    });
  } catch (error) {
    console.warn(error);
    showToast(t("monthlyReport.couldNotLoad"));
  }
}

async function generateMonthlyReport(monthKey, storeIdOverride) {
  if (!state.db || !state.user) return showToast(t("toast.firebaseNotConnected"));
  const storeId = storeIdOverride || state.currentStoreId;
  if (!storeId || storeId === "all") return showToast(t("toast.selectStoreBeforeSale"));

  const metrics = computeMonthlyMetrics(monthKey, storeId);
  if (metrics.transactionCount === 0) return showToast(t("monthlyReport.noSalesData"));

  // Keep the button showing progress for the whole async chain, not just the
  // 2.6s toast — report generation calls the AI proxy, which can take up to a
  // minute on a cold start (see AI_PROXY_TIMEOUT_MS / warmUpAiProxy). Without
  // this the button looked idle/broken for the entire wait.
  const generateButton = qs("#generateMonthlyReportButton");
  const originalButtonLabel = generateButton ? generateButton.textContent : "";
  if (generateButton) {
    generateButton.disabled = true;
    generateButton.textContent = t("monthlyReport.generating");
  }
  showToast(t("monthlyReport.generating"));

  try {
    let aiSummary;
    try {
      aiSummary = await generateMonthlyReportNarrative(monthKey, metrics, storeId);
    } catch (error) {
      console.warn(error);
      aiSummary = localMonthlyReportNarrative(monthKey, metrics, storeId);
    }

    try {
      const { doc, serverTimestamp, Timestamp, setDoc } = state.firebaseApi.firestore;
      const docId = `${storeId}_${monthKey}`;
      const reportRef = doc(state.db, "users", state.user.uid, "monthlyReports", docId);
      await setDoc(reportRef, {
        storeId,
        periodLabel: monthKey,
        periodStart: Timestamp.fromDate(metrics.periodStart),
        periodEnd: Timestamp.fromDate(metrics.periodEnd),
        generatedBy: state.user.uid,
        metrics: {
          revenue: metrics.revenue,
          transactionCount: metrics.transactionCount,
          avgSale: metrics.avgSale,
          unitsSold: metrics.unitsSold,
          topProducts: metrics.topProducts,
          lowStockCount: metrics.lowStockCount,
          outOfStockCount: metrics.outOfStockCount
        },
        aiSummary,
        generatedAt: serverTimestamp()
      });
      showToast(t("monthlyReport.generated"));
    } catch (error) {
      console.warn(error);
      showToast(t("monthlyReport.failedGeneric"));
    }
  } finally {
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.textContent = originalButtonLabel;
    }
  }
}

function renderPaymentReports() {
  const grid = qs("#paymentMethodGrid");
  const summary = qs("#paymentSummary");
  if (!grid || !summary) return;

  renderRevenueChart();

  const { breakdown, grandTotal, transactionCount } = computePaymentReport();

  grid.innerHTML = breakdown
    .map((entry) => `<div class="payment-method-card">
      <span class="muted">${paymentMethodLabel(entry.method)}</span>
      <strong class="method-total">${money(entry.total)}</strong>
      <span class="muted">${entry.count} ${entry.count === 1 ? t("report.transaction") : t("report.transactions")} - ${t("report.avg")} ${money(Math.round(entry.average))}</span>
      <span class="muted">${t("report.topItems")}: ${entry.topItems.join(", ") || t("report.none")}</span>
    </div>`)
    .join("");

  summary.innerHTML = `
    <div class="payment-summary-row"><strong>${t("report.combinedTotal")}</strong><strong>${money(grandTotal)}</strong></div>
    ${breakdown
      .map((entry) => `<div class="payment-summary-row"><span>${paymentMethodLabel(entry.method)} ${t("report.share")}</span><span>${grandTotal ? Math.round((entry.total / grandTotal) * 100) : 0}%</span></div>`)
      .join("")}
    <div class="payment-summary-row"><span>${t("report.totalTransactions")}</span><span>${transactionCount}</span></div>
  `;
  renderStoreBreakdown();
  renderStaffBreakdown();
  renderTopCustomers();
  renderStaffOrderLookupSelect();
  renderCustomerAccounts();
}

function computeStoreBreakdown() {
  const sales = filteredSales();
  return state.stores
    .map((store) => {
      const storeSales = sales.filter((sale) => saleStoreId(sale) === store.id);
      const total = storeSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
      return { store, total, count: storeSales.length };
    })
    .sort((a, b) => b.total - a.total);
}

function computeRevenueTrend() {
  const sales = filteredSales();
  const groupByMonth = state.salesRangePreset === "all";
  const buckets = new Map();

  sales.forEach((sale) => {
    const date = saleDate(sale);
    if (!date) return;
    const key = groupByMonth
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) || 0) + Number(sale.total || 0));
  });

  const sortedKeys = [...buckets.keys()].sort();
  const labels = sortedKeys.map((key) => (groupByMonth ? key : key.slice(5)));
  const values = sortedKeys.map((key) => buckets.get(key));
  return { labels, values };
}

function renderStoreBreakdown() {
  const container = qs("#storeBreakdown");
  if (!container) return;
  const showBreakdown = state.currentStoreId === "all" && state.stores.length > 1;
  container.hidden = !showBreakdown;
  if (!showBreakdown) return;
  const rows = computeStoreBreakdown();
  container.innerHTML = `<strong>${t("report.perStoreTotals")}</strong>` + rows
    .map(({ store, total, count }) => `<div class="payment-summary-row"><span>${esc(store.name || "Store")}</span><span>${moneyForStore(total, store.id)} (${count})</span></div>`)
    .join("");
}

function computeStaffBreakdown() {
  const sales = filteredSales();
  const byStaff = new Map();
  sales.forEach((sale) => {
    const key = sale.staffId || "unassigned";
    if (!byStaff.has(key)) {
      byStaff.set(key, { staffName: sale.staffName || t("report.none"), cash: 0, mobile: 0, card: 0, total: 0, orders: 0 });
    }
    const entry = byStaff.get(key);
    const method = sale.paymentMethod || "cash";
    if (method === "credit") {
      const paidAmount = Number(sale.amountPaid || 0);
      const paidMethod = sale.amountPaidMethod || "cash";
      if (paidMethod === "cash") entry.cash += paidAmount;
      else if (paidMethod === "mobile") entry.mobile += paidAmount;
      else if (paidMethod === "card") entry.card += paidAmount;
    } else {
      const amount = Number(sale.total || 0);
      if (method === "cash") entry.cash += amount;
      else if (method === "mobile") entry.mobile += amount;
      else if (method === "card") entry.card += amount;
    }
    entry.total += Number(sale.total || 0);
    entry.orders += 1;
  });
  return [...byStaff.values()].sort((a, b) => b.total - a.total);
}

function renderStaffBreakdown() {
  const tbody = qs("#staffBreakdownTable");
  if (!tbody) return;
  const rows = computeStaffBreakdown();
  const totals = rows.reduce(
    (acc, row) => ({
      cash: acc.cash + row.cash,
      mobile: acc.mobile + row.mobile,
      card: acc.card + row.card,
      total: acc.total + row.total,
      orders: acc.orders + row.orders
    }),
    { cash: 0, mobile: 0, card: 0, total: 0, orders: 0 }
  );

  const bodyRows = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.staffName)}</td>
        <td>${money(row.cash)}</td>
        <td>${money(row.mobile)}</td>
        <td>${money(row.card)}</td>
        <td><strong>${money(row.total)}</strong></td>
        <td>${row.orders}</td>
      </tr>`
    )
    .join("");

  const totalRow = rows.length
    ? `<tr>
        <td><strong>${t("reports.allStaffRow")}</strong></td>
        <td><strong>${money(totals.cash)}</strong></td>
        <td><strong>${money(totals.mobile)}</strong></td>
        <td><strong>${money(totals.card)}</strong></td>
        <td><strong>${money(totals.total)}</strong></td>
        <td><strong>${totals.orders}</strong></td>
      </tr>`
    : "";

  tbody.innerHTML = bodyRows + totalRow || `<tr><td colspan="6" class="empty-state">${t("cart.empty")}</td></tr>`;
}

function computeCustomerBreakdown() {
  const sales = filteredSales();
  const byCustomer = new Map();
  sales.forEach((sale) => {
    const phone = String(sale.customerPhone || "").trim();
    const name = String(sale.customerName || "").trim();
    if (!phone && !name) return;
    const key = phone || `name:${name.toLowerCase()}`;
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { name: "", phone: "", orders: 0, total: 0, lastVisit: null });
    }
    const entry = byCustomer.get(key);
    if (name && !entry.name) entry.name = name;
    if (phone && !entry.phone) entry.phone = phone;
    entry.orders += 1;
    entry.total += Number(sale.total || 0);
    const date = saleDate(sale);
    if (date && (!entry.lastVisit || date > entry.lastVisit)) entry.lastVisit = date;
  });
  return [...byCustomer.values()].sort((a, b) => b.total - a.total);
}

function renderTopCustomers() {
  const tbody = qs("#topCustomersTable");
  if (!tbody) return;
  const rows = computeCustomerBreakdown().slice(0, 10);
  tbody.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.name || t("report.none"))}</td>
        <td>${esc(row.phone || "-")}</td>
        <td>${row.orders}</td>
        <td><strong>${money(row.total)}</strong></td>
        <td>${row.lastVisit ? row.lastVisit.toLocaleDateString() : "-"}</td>
      </tr>`
    )
    .join("") || `<tr><td colspan="5" class="empty-state">${t("reports.topCustomersEmpty")}</td></tr>`;
}

function saleMatchesDate(sale, dateStr) {
  if (!dateStr) return false;
  const date = saleDate(sale);
  if (!date) return false;
  const localDateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return localDateStr === dateStr;
}

function knownStaffOptions() {
  const map = new Map();
  activeStaff().forEach((member) => map.set(member.id, member.name || ""));
  state.sales.forEach((sale) => {
    if (sale.staffId && !map.has(sale.staffId)) map.set(sale.staffId, sale.staffName || "");
  });
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

function renderStaffOrderLookupSelect() {
  const select = qs("#staffOrderLookupStaff");
  if (!select) return;
  const previousValue = select.value;
  const options = knownStaffOptions();
  select.innerHTML = options.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("") || `<option value="">${t("pos.selectStaffPlaceholder")}</option>`;
  if (options.some((o) => o.id === previousValue)) select.value = previousValue;
  renderStaffOrderNumberOptions();
}

function findStaffSalesInRange(staffId, fromStr, toStr) {
  if (!staffId) return [];
  const fromDate = fromStr ? new Date(fromStr) : null;
  const toDate = toStr ? new Date(`${toStr}T23:59:59`) : null;
  return state.sales
    .filter((sale) => {
      if (sale.voided || sale.staffId !== staffId) return false;
      const date = saleDate(sale);
      if (!date) return false;
      if (fromDate && date < fromDate) return false;
      if (toDate && date > toDate) return false;
      return true;
    })
    .sort((a, b) => (saleDate(a)?.getTime() || 0) - (saleDate(b)?.getTime() || 0));
}

function saleReturnedQtyMap(sale) {
  const map = new Map();
  (sale.returns || []).forEach((entry) => {
    (entry.items || []).forEach((item) => {
      map.set(item.productId, (map.get(item.productId) || 0) + Number(item.qty || 0));
    });
  });
  return map;
}

function saleReturnableItems(sale) {
  const returnedMap = saleReturnedQtyMap(sale);
  return (sale.items || []).map((item) => {
    const alreadyReturned = returnedMap.get(item.productId) || 0;
    const remaining = Math.max(0, Number(item.qty || 0) - alreadyReturned);
    return { ...item, alreadyReturned, remaining };
  });
}

function buildStaffOrderCard(sale) {
  const date = saleDate(sale);
  const itemRows = (sale.items || [])
    .map((item) => `<tr>
      <td>${esc(item.name)}</td>
      <td>${Number(item.qty || 0)}</td>
      <td>${money(item.sellingPrice)}</td>
      <td>${money(item.lineTotal)}</td>
    </tr>`)
    .join("");
  return `<div class="staff-order-card">
    <div class="payment-summary-row"><strong>${t("reports.staffOrderLookupOrderLabel")}</strong><span>#${esc(sale.orderNumber || "")}</span></div>
    <div class="payment-summary-row"><span>${t("reports.staffOrderLookupTimeLabel")}</span><span>${date ? date.toLocaleString() : "-"}</span></div>
    <div class="payment-summary-row"><span>${t("reports.staffOrderLookupPaymentLabel")}</span><span>${paymentMethodLabel(sale.paymentMethod || "cash")}</span></div>
    <table>
      <thead>
        <tr>
          <th>${t("reports.staffOrderLookupColItem")}</th>
          <th>${t("reports.staffOrderLookupColQty")}</th>
          <th>${t("reports.staffOrderLookupColUnitPrice")}</th>
          <th>${t("reports.staffOrderLookupColLineTotal")}</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    ${
      Number(sale.refundedAmount || 0) > 0
        ? `<div class="payment-summary-row"><span>${t("returns.refundedLabel")}</span><span>- ${money(sale.refundedAmount)}</span></div>`
        : ""
    }
    <div class="payment-summary-row"><strong>${t("reports.staffOrderLookupTotalLabel")}</strong><strong>${money(sale.total)}</strong></div>
    ${
      !sale.voided && isManagerOrOwnerRole()
        ? `<div class="button-row end"><button class="ghost-button compact" type="button" data-return-sale="${esc(sale.id)}">${t("returns.processButton")}</button></div>`
        : ""
    }
  </div>`;
}

function openReturnDialog(saleId) {
  const sale = state.sales.find((entry) => entry.id === saleId);
  if (!sale) return;
  state.pendingReturnSaleId = saleId;
  const returnableItems = saleReturnableItems(sale);
  qs("#returnOrderLabel").textContent = `#${sale.orderNumber || ""}`;
  qs("#returnItemsList").innerHTML = returnableItems.length
    ? returnableItems
        .map(
          (item) => `<div class="return-item-row">
      <span>${esc(item.name)}</span>
      <span class="muted">${t("returns.maxReturnable", { qty: item.remaining })}</span>
      <input type="number" min="0" max="${item.remaining}" value="0" class="return-qty-input" data-return-item="${esc(item.productId)}" ${item.remaining <= 0 ? "disabled" : ""} />
    </div>`
        )
        .join("")
    : `<p class="muted">${t("returns.noItemsSelected")}</p>`;
  qs("#returnDialog").showModal();
}

async function confirmProcessReturn() {
  const saleId = state.pendingReturnSaleId;
  const sale = state.sales.find((entry) => entry.id === saleId);
  if (!sale) return qs("#returnDialog").close();

  const returnableItems = saleReturnableItems(sale);
  const selections = [];
  qsa("[data-return-item]").forEach((input) => {
    const qty = Math.floor(Number(input.value || 0));
    if (qty > 0) {
      const item = returnableItems.find((entry) => entry.productId === input.dataset.returnItem);
      if (item && qty <= item.remaining) selections.push({ ...item, qty });
    }
  });

  if (!selections.length) return showToast(t("toast.returnNoSelection"));

  const authorized = await verifyOverridePassword();
  if (!authorized) return;

  const subtotalReturned = selections.reduce((sum, item) => sum + item.qty * Number(item.sellingPrice || 0), 0);
  const saleDiscountAmount = Number(sale.discountAmount || 0);
  const saleSubtotal = Number(sale.subtotal || sale.total || 0);
  const discountShare = saleSubtotal > 0 ? Math.min(saleDiscountAmount, saleDiscountAmount * (subtotalReturned / saleSubtotal)) : 0;
  const refundAmount = Math.max(0, Math.round(subtotalReturned - discountShare));

  const returnRecord = {
    items: selections.map((item) => ({ productId: item.productId, name: item.name, qty: item.qty, lineTotal: item.qty * Number(item.sellingPrice || 0) })),
    subtotalReturned,
    discountShare: Math.round(discountShare),
    refundAmount,
    staffId: state.selectedStaffId || "",
    staffName: (state.staff.find((member) => member.id === state.selectedStaffId) || {}).name || "",
    createdAt: new Date().toISOString()
  };

  const nextReturns = [...(sale.returns || []), returnRecord];
  const nextRefundedAmount = Number(sale.refundedAmount || 0) + refundAmount;

  if (state.db && state.user && !String(saleId).startsWith("local-")) {
    try {
      const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      await runTransaction(state.db, async (transaction) => {
        const saleRef = doc(state.db, "users", state.businessOwnerUid, "sales", saleId);
        const productRefs = selections.map((item) => doc(state.db, "users", state.businessOwnerUid, "products", item.productId));
        const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

        transaction.update(saleRef, { returns: nextReturns, refundedAmount: nextRefundedAmount });

        productSnaps.forEach((snap, index) => {
          if (!snap.exists()) return;
          const item = selections[index];
          const currentQuantity = Number(snap.data().quantity || 0);
          const currentSold30 = Number(snap.data().sold30 || 0);
          const currentSold90 = Number(snap.data().sold90 || 0);
          transaction.update(productRefs[index], {
            quantity: currentQuantity + item.qty,
            sold30: Math.max(0, currentSold30 - item.qty),
            sold90: Math.max(0, currentSold90 - item.qty),
            updatedAt: serverTimestamp(),
            movementReason: "return"
          });
        });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        transaction.set(auditRef, {
          action: "RETURN_PROCESSED",
          saleId,
          refundAmount,
          itemCount: selections.length,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
    } catch (error) {
      console.warn(error);
      showToast(t("toast.returnFailed"));
      return;
    }
  } else {
    sale.returns = nextReturns;
    sale.refundedAmount = nextRefundedAmount;
    selections.forEach((item) => {
      const product = state.products.find((p) => p.id === item.productId);
      if (product) {
        product.quantity += item.qty;
        product.sold30 = Math.max(0, Number(product.sold30 || 0) - item.qty);
        product.sold90 = Math.max(0, Number(product.sold90 || 0) - item.qty);
      }
    });
  }

  qs("#returnDialog").close();
  renderAll();
  renderStaffOrderLookupResult();
  showToast(t("toast.returnProcessed", { amount: money(refundAmount) }));
}

function renderStaffOrderNumberOptions() {
  const select = qs("#staffOrderLookupOrderNumber");
  if (!select) return;
  const staffId = qs("#staffOrderLookupStaff")?.value || "";
  const fromStr = qs("#staffOrderLookupDateFrom")?.value || "";
  const toStr = qs("#staffOrderLookupDateTo")?.value || "";
  const sales = findStaffSalesInRange(staffId, fromStr, toStr);
  const previousValue = select.value;

  if (!staffId || !sales.length) {
    select.innerHTML = `<option value="">${t("reports.staffOrderLookupNoOrders")}</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = sales
    .map((sale) => {
      const date = saleDate(sale);
      const dateLabel = date ? date.toLocaleDateString() : "";
      const timeLabel = date ? date.toLocaleTimeString() : "";
      return `<option value="${esc(sale.id)}">#${esc(sale.orderNumber || "")} \u2014 ${money(sale.total)} (${dateLabel} ${timeLabel})</option>`;
    })
    .join("");
  if (sales.some((sale) => sale.id === previousValue)) select.value = previousValue;
}

function renderStaffOrderLookupResult() {
  const container = qs("#staffOrderLookupResult");
  if (!container) return;
  const staffId = qs("#staffOrderLookupStaff")?.value || "";
  const fromStr = qs("#staffOrderLookupDateFrom")?.value || "";
  const toStr = qs("#staffOrderLookupDateTo")?.value || "";
  const saleId = qs("#staffOrderLookupOrderNumber")?.value || "";

  if (!staffId) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupSelectStaffDate")}</p>`;
    return;
  }
  if (!saleId) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupNoOrders")}</p>`;
    return;
  }

  const match = findStaffSalesInRange(staffId, fromStr, toStr).find((sale) => sale.id === saleId);
  if (!match) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupNotFound")}</p>`;
    return;
  }

  container.innerHTML = buildStaffOrderCard(match);
}

function renderStaffAllOrdersResult() {
  const container = qs("#staffOrderLookupResult");
  if (!container) return;
  const staffId = qs("#staffOrderLookupStaff")?.value || "";
  const fromStr = qs("#staffOrderLookupDateFrom")?.value || "";
  const toStr = qs("#staffOrderLookupDateTo")?.value || "";

  if (!staffId) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupSelectStaffDate")}</p>`;
    return;
  }

  const sales = findStaffSalesInRange(staffId, fromStr, toStr);
  if (!sales.length) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupNoOrders")}</p>`;
    return;
  }

  const staffName = sales[0].staffName || t("report.none");
  const rangeTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cards = sales.map((sale) => buildStaffOrderCard(sale)).join("");

  container.innerHTML = `<div class="payment-summary-row"><strong>${esc(staffName)}</strong><strong>${money(rangeTotal)}</strong></div>` + cards;
}

function computeDailyStaffReport(dateStr) {
  if (!dateStr) return { staffEntries: [], grandTotal: 0 };
  const scoped = state.sales.filter((sale) => {
    if (sale.voided) return false;
    if (state.db && state.currentStoreId !== "all" && saleStoreId(sale) !== state.currentStoreId) return false;
    return saleMatchesDate(sale, dateStr);
  });

  const byStaff = new Map();
  scoped.forEach((sale) => {
    const key = sale.staffId || "unassigned";
    if (!byStaff.has(key)) byStaff.set(key, { staffName: sale.staffName || t("report.none"), sales: [], total: 0 });
    const entry = byStaff.get(key);
    entry.sales.push(sale);
    entry.total += Number(sale.total || 0);
  });

  const staffEntries = [...byStaff.values()].sort((a, b) => b.total - a.total);
  const grandTotal = staffEntries.reduce((sum, entry) => sum + entry.total, 0);
  return { staffEntries, grandTotal };
}

function renderDailyStaffReport() {
  const container = qs("#dailyStaffReportResult");
  if (!container) return;
  const dateStr = qs("#dailyStaffReportDate")?.value || "";
  if (!dateStr) {
    container.innerHTML = `<p class="muted">${t("reports.dailyStaffReportEmpty")}</p>`;
    return;
  }

  const { staffEntries, grandTotal } = computeDailyStaffReport(dateStr);
  if (!staffEntries.length) {
    container.innerHTML = `<p class="muted">${t("reports.dailyStaffReportNoSales")}</p>`;
    return;
  }

  container.innerHTML = staffEntries
    .map((entry) => {
      const orderRows = entry.sales
        .map((sale) => {
          const date = saleDate(sale);
          const itemsSummary = (sale.items || []).map((item) => `${item.name} (${item.qty})`).join(", ");
          return `<tr>
            <td>#${esc(sale.orderNumber || "")}</td>
            <td>${date ? date.toLocaleTimeString() : "-"}</td>
            <td>${paymentMethodLabel(sale.paymentMethod || "cash")}</td>
            <td>${esc(itemsSummary)}</td>
            <td>${money(sale.total)}</td>
          </tr>`;
        })
        .join("");
      return `<div class="daily-staff-card">
        <div class="payment-summary-row"><strong>${esc(entry.staffName)}</strong><strong>${money(entry.total)}</strong></div>
        <table>
          <thead>
            <tr>
              <th>${t("reports.dailyStaffReportOrderColumn")}</th>
              <th>${t("reports.staffOrderLookupTimeLabel")}</th>
              <th>${t("report.colPaymentMethod")}</th>
              <th>${t("reports.dailyStaffReportItemsLabel")}</th>
              <th>${t("pos.total")}</th>
            </tr>
          </thead>
          <tbody>${orderRows}</tbody>
        </table>
      </div>`;
    })
    .join("") + `<div class="payment-summary-row"><strong>${t("reports.dailyStaffReportGrandTotal")}</strong><strong>${money(grandTotal)}</strong></div>`;
}

function searchOrderNumber() {
  const resultBox = qs("#orderNumberSearchResult");
  if (!resultBox) return;
  const term = qs("#orderNumberSearch").value.trim();
  if (!term) {
    resultBox.hidden = true;
    return;
  }
  const matches = state.sales.filter((sale) => !sale.voided && String(sale.orderNumber || "") === term);
  if (!matches.length) {
    resultBox.hidden = false;
    resultBox.textContent = t("reports.orderNotFound");
    return;
  }
  resultBox.hidden = false;
  resultBox.innerHTML = matches
    .map((sale) => {
      const date = saleDate(sale);
      return t("reports.orderFoundLabel", {
        orderNumber: sale.orderNumber,
        name: sale.staffName || t("report.none"),
        date: date ? date.toLocaleDateString() : "-",
        method: paymentMethodLabel(sale.paymentMethod || "cash"),
        total: money(sale.total)
      });
    })
    .join("<br>");
}

function buildPaymentReportRows() {
  const { breakdown, grandTotal, transactionCount } = computePaymentReport();
  const colPaymentMethod = t("report.colPaymentMethod");
  const colTransactions = t("report.colTransactions");
  const colTotalTZS = `${t("report.colTotalTZS")} (${currentCurrencyCode()})`;
  const colAvgSaleTZS = `${t("report.colAvgSaleTZS")} (${currentCurrencyCode()})`;
  const colTopItems = t("report.colTopItems");
  const rows = breakdown.map((entry) => ({
    [colPaymentMethod]: paymentMethodLabel(entry.method),
    [colTransactions]: entry.count,
    [colTotalTZS]: entry.total,
    [colAvgSaleTZS]: Math.round(entry.average),
    [colTopItems]: entry.topItems.join("; ") || t("report.none")
  }));
  rows.push({
    [colPaymentMethod]: t("report.combined"),
    [colTransactions]: transactionCount,
    [colTotalTZS]: grandTotal,
    [colAvgSaleTZS]: transactionCount ? Math.round(grandTotal / transactionCount) : 0,
    [colTopItems]: ""
  });
  if (state.currentStoreId === "all" && state.stores.length > 1) {
    computeStoreBreakdown().forEach(({ store, total, count }) => {
      rows.push({
        [colPaymentMethod]: t("report.storePrefix", { name: store.name || "Store" }),
        [colTransactions]: count,
        [colTotalTZS]: total,
        [colAvgSaleTZS]: count ? Math.round(total / count) : 0,
        [colTopItems]: ""
      });
    });
  }
  computeStaffBreakdown().forEach((entry) => {
    rows.push({
      [colPaymentMethod]: `${t("reports.staffColumn")}: ${entry.staffName}`,
      [colTransactions]: entry.orders,
      [colTotalTZS]: entry.total,
      [colAvgSaleTZS]: entry.orders ? Math.round(entry.total / entry.orders) : 0,
      [colTopItems]: `${t("pos.cash")} ${money(entry.cash)} / ${t("pos.mobile")} ${money(entry.mobile)} / ${t("pos.card")} ${money(entry.card)}`
    });
  });
  return rows;
}

function exportPaymentReportCsv() {
  const rows = buildPaymentReportRows();
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dukasmart-payment-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportPaymentReportPdf() {
  const rows = buildPaymentReportRows();
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text("DukaSmart Payment Report", 14, 16);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 22);
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => String(row[header])));
  if (typeof doc.autoTable === "function") {
    doc.autoTable({ head: [headers], body, startY: 28 });
  } else {
    let y = 30;
    doc.text(headers.join(" | "), 14, y);
    rows.forEach((row) => {
      y += 6;
      doc.text(headers.map((header) => String(row[header])).join(" | "), 14, y);
    });
  }
  doc.save("dukasmart-payment-report.pdf");
}

function renderCards() {
  const reports = [t("report.inventorySummary"), t("report.stockQuantityReport"), t("report.supplierList"), t("report.lowStockReport"), t("report.outOfStockReport"), t("report.csvExportCard")];
  qs("#reportGrid").innerHTML = reports
    .map(
      (report) => `<article class="report-card">
        <strong>${report}</strong>
        <span class="muted">${t("report.exportFormatsHint")}</span>
        <div class="report-actions">
          <button class="ghost-button compact" data-generate-report="csv">CSV</button>
          <button class="ghost-button compact" data-generate-report="pdf">PDF</button>
          <button class="ghost-button compact" data-generate-report="xlsx">Excel</button>
        </div>
      </article>`
    )
    .join("");
}

function localAiAnswerText(question) {
  const products = storeProducts();
  const low = products.filter((product) => stockStatus(product) !== "healthy");
  const highStock = [...products].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0)).slice(0, 3);
  const recs = low
    .map((product) => ({ product, rec: reorderRecommendation(product) }))
    .sort((a, b) => a.rec.daysUntilStockout - b.rec.daysUntilStockout);

  const fastMoving = products.filter((p) => Number(p.sold30 || 0) >= 50).length;
  const slowMoving = products.filter((p) => Number(p.sold30 || 0) > 0 && Number(p.sold30 || 0) < 12).length;
  const noSales = products.filter((p) => Number(p.sold90 || 0) === 0).length;

  const tipEntry = BUSINESS_TIPS[currentBusinessType()] || BUSINESS_TIPS.general;
  const tip = tipEntry[state.language] || tipEntry.en;

  const lines = [
    question ? t("localAi.headerWithQuestion", { question }) : t("localAi.headerNoQuestion"),
    t("localAi.urgentReorder", { list: recs.map(({ product, rec }) => `${product.name} (${rec.recommendedQty})`).join(", ") || t("report.none") })
  ];

  if (recs.length && recs[0].rec.daysUntilStockout > 0) {
    lines.push(t("localAi.mostUrgent", { name: recs[0].product.name, days: recs[0].rec.daysUntilStockout }));
  }

  lines.push(
    t("localAi.movementSummary", { fast: fastMoving, slow: slowMoving, none: noSales }),
    t("localAi.highestStocked", { list: highStock.map((product) => product.name).join(", ") || t("report.none") }),
    t("localAi.businessTip", { tip }),
    t("localAi.supplierNote"),
    t("localAi.disclaimer")
  );
  return lines.join("\n");
}

function tutorialGuideText(topic) {
  return t(`tutorial.${topic}`);
}

function matchTutorialTopic(question) {
  const normalized = question.toLowerCase().trim();
  const enTrigger = /^(how do i|how to|how can i|guide me|walk me through)\b/.test(normalized);
  const swTrigger = /^(jinsi ya|jinsi gani|ninawezaje|vipi|nielekeze|naomba mwongozo)\b/.test(normalized);
  if (!enTrigger && !swTrigger) return null;
  const topics = [
    { key: "pos", keywords: ["pos", "point of sale", "checkout", "cart", "complete a sale", "make a sale", "sehemu ya mauzo", "kikapu", "kamilisha mauzo", "fanya mauzo"] },
    { key: "reports", keywords: ["report", "export", "csv", "pdf", "payment", "ripoti", "hamisha csv", "hamisha pdf"] },
    { key: "stores", keywords: ["store", "branch", "transfer", "multiple location", "duka", "tawi", "hamisha hisa", "maduka mengi"] },
    { key: "inventory", keywords: ["inventory", "stock", "product", "reorder level", "sku", "category", "hisa", "bidhaa", "kiwango cha chini", "aina ya bidhaa"] }
  ];
  for (const topic of topics) {
    if (topic.keywords.some((keyword) => normalized.includes(keyword))) return topic.key;
  }
  return null;
}

function renderAiQuestionSuggestions() {
  const container = qs("#aiSmartQuestions");
  if (!container) return;
  const questions = QUESTION_TEMPLATES[currentBusinessType()] || QUESTION_TEMPLATES.general;
  container.innerHTML = questions
    .map((item) => `<button data-question="${esc(item.question[state.language] || item.question.en)}">${esc(item.label[state.language] || item.label.en)}</button>`)
    .join("");
}

function renderChatLog() {
  const container = qs("#aiAnswer");
  if (!state.chatHistory.length) {
    container.innerHTML = `<p class="muted">${t("chat.emptyState")}</p>`;
    return;
  }
  container.innerHTML = state.chatHistory
    .map((message) => `<div class="chat-bubble ${message.role}">${esc(message.content).replaceAll("\n", "<br>")}</div>`)
    .join("");
  container.scrollTop = container.scrollHeight;
}

const AI_PROXY_TIMEOUT_MS = 60000;

const AI_QUESTION_MAX_CHARS = 2000;
const AI_SNAPSHOT_MAX_PRODUCTS = 500;

function sanitizeAiMessages(messages) {
  return messages
    .filter((m) => typeof m.content === "string")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, AI_QUESTION_MAX_CHARS)
    }));
}

function sanitizeAiSnapshot(snapshot) {
  return {
    ...snapshot,
    products: Array.isArray(snapshot.products) ? snapshot.products.slice(0, AI_SNAPSHOT_MAX_PRODUCTS) : []
  };
}

async function postToAiProxy(messages, snapshot) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
  let response;
  try {
    if (!state.user) throw new Error(t("txerror.aiNetworkError"));
    // Firebase returns a cached, still-valid token here and refreshes it only
    // when needed. Forcing a refresh for every question adds a network round
    // trip and makes the advisor less resilient on weak connections.
    const token = await state.user.getIdToken();
    response = await fetch(aiConfig.proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ messages: sanitizeAiMessages(messages), snapshot: sanitizeAiSnapshot(snapshot) }),
      signal: controller.signal
    });
  } catch (networkError) {
    window.clearTimeout(timeoutId);
    if (networkError.name === "AbortError") throw new Error(t("txerror.aiRequestTimedOut"));
    throw new Error(t("txerror.aiNetworkError"));
  }
  window.clearTimeout(timeoutId);

  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    throw new Error(t("txerror.aiMalformedResponse"));
  }

  if (!response.ok) {
    throw new Error((payload && payload.error) || `status ${response.status}`);
  }
  if (!payload || typeof payload.answer !== "string") {
    throw new Error(t("txerror.aiMalformedResponse"));
  }
  return payload.answer;
}

async function callAiProxy(historyForRequest) {
  return postToAiProxy(historyForRequest, {
    businessType: currentBusinessType(),
    language: state.language,
    products: storeProducts().map((product) => ({
      name: product.name,
      category: product.category,
      quantity: Number(product.quantity || 0),
      reorderLevel: Number(product.reorderLevel || 0),
      sold30: Number(product.sold30 || 0),
      sold90: Number(product.sold90 || 0),
      leadTimeDays: Number(product.leadTimeDays || 10)
    })),
    metrics: calculateMetrics()
  });
}

async function askAi() {
  const question = qs("#aiQuestion").value.trim();
  if (!question) return;
  qs("#aiQuestion").value = "";

  state.chatHistory.push({ role: "user", content: question });

  const tutorialTopic = matchTutorialTopic(question);
  if (tutorialTopic) {
    state.chatHistory.push({ role: "assistant", content: tutorialGuideText(tutorialTopic) });
    qs("#aiMode").textContent = t("ai.modeGuide");
    renderChatLog();
    return;
  }

  state.chatHistory.push({ role: "assistant", content: t("ai.analyzing") });
  renderChatLog();

  const historyForRequest = state.chatHistory.slice(0, -1).slice(-MAX_CHAT_HISTORY);

  if (aiConfig.proxyUrl) {
    try {
      const answer = await callAiProxy(historyForRequest);
      qs("#aiMode").textContent = t("ai.modeClaude");
      state.chatHistory[state.chatHistory.length - 1] = { role: "assistant", content: answer };
      renderChatLog();
      return;
    } catch (error) {
      console.warn(error);
      showToast(t("toast.aiProxyUnavailable", { message: error.message }));
    }
  }

  qs("#aiMode").textContent = t("ai.modeLocal");
  state.chatHistory[state.chatHistory.length - 1] = { role: "assistant", content: localAiAnswerText(question) };
  renderChatLog();
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function exportCsv() {
  const headers = ["name", "category", "brand", "supplier", "quantity"];
  const rows = state.products.map((product) => headers.map((header) => JSON.stringify(product[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dukasmart-inventory.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function backupSerializable(value) {
  if (value == null || typeof value !== "object") return value;
  if (typeof value.toDate === "function" && Number.isInteger(value.seconds)) {
    return { __type: "firestoreTimestamp", seconds: value.seconds, nanoseconds: value.nanoseconds || 0 };
  }
  if (Array.isArray(value)) return value.map(backupSerializable);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, backupSerializable(entry)]));
}

async function downloadAccountBackup() {
  if (!state.db || !state.user) return showToast(t("toast.firebaseNotConnected"));
  const button = qs("#downloadBackupButton");
  if (button) button.disabled = true;
  showToast(t("toast.backupPreparing"));

  try {
    const { collection, doc, getDoc, getDocs } = state.firebaseApi.firestore;
    const rootCollections = ["products", "sales", "stores", "staff", "customers", "transfers", "auditLogs", "monthlyReports"];
    const [profileSnap, ...collectionSnaps] = await Promise.all([
      getDoc(doc(state.db, "users", state.user.uid)),
      ...rootCollections.map((name) => getDocs(collection(state.db, "users", state.user.uid, name)))
    ]);
    const collections = Object.fromEntries(collectionSnaps.map((snapshot, index) => [
      rootCollections[index],
      snapshot.docs.map((docSnap) => ({ id: docSnap.id, data: backupSerializable(docSnap.data()) }))
    ]));
    const customerPayments = await Promise.all(
      collections.customers.map(async (customer) => {
        const payments = await getDocs(collection(state.db, "users", state.user.uid, "customers", customer.id, "payments"));
        return [customer.id, payments.docs.map((docSnap) => ({ id: docSnap.id, data: backupSerializable(docSnap.data()) }))];
      })
    );

    const backup = {
      schemaVersion: 1,
      application: "DukaSmart ERP",
      exportedAt: new Date().toISOString(),
      accountUid: state.user.uid,
      profile: profileSnap.exists() ? backupSerializable(profileSnap.data()) : null,
      collections,
      customerPayments: Object.fromEntries(customerPayments)
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dukasmart-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(t("toast.backupDownloaded"));
  } catch (error) {
    console.warn("Account backup failed:", error);
    showToast(t("toast.backupFailed"));
  } finally {
    if (button) button.disabled = false;
  }
}

function buildReportRows() {
  return storeProducts().map((product) => {
    const status = stockStatus(product);
    const label = status === "out" ? t("report.statusOut") : status === "low" ? t("report.statusLow") : t("report.statusHealthy");
    const expStatus = expiryStatus(product);
    const expLabel = expStatus === "none" ? "-" : expStatus === "expired" ? t("expiry.statusExpired") : expStatus === "soon" ? t("expiry.statusSoon") : t("expiry.statusOk");
    return {
      [t("report.colName")]: product.name || "",
      [t("report.colCategory")]: product.category || "",
      [t("report.colBrand")]: product.brand || "-",
      [t("report.colSupplier")]: product.supplier || "-",
      [t("report.colQuantity")]: Number(product.quantity || 0),
      [t("report.colReorderLevel")]: Number(product.reorderLevel || 0),
      [t("report.colStatus")]: label,
      [t("report.colExpiryDate")]: product.expiryDate || "-",
      [t("report.colExpiryStatus")]: expLabel
    };
  });
}

function generateReportCsv() {
  const rows = buildReportRows();
  if (!rows.length) return showToast(t("toast.noInventoryData"));
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dukasmart-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function generateReportPdf() {
  const rows = buildReportRows();
  if (!rows.length) return showToast(t("toast.noInventoryData"));
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text("DukaSmart Inventory Report", 14, 16);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 22);
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => String(row[header])));
  if (typeof doc.autoTable === "function") {
    doc.autoTable({ head: [headers], body, startY: 28 });
  } else {
    let y = 30;
    doc.text(headers.join(" | "), 14, y);
    rows.forEach((row) => {
      y += 6;
      doc.text(headers.map((header) => String(row[header])).join(" | "), 14, y);
    });
  }
  doc.save("dukasmart-report.pdf");
}

function generateReportXlsx() {
  const rows = buildReportRows();
  if (!rows.length) return showToast(t("toast.noInventoryData"));
  if (!window.XLSX) return showToast(t("toast.excelLibraryFailed"));
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
  window.XLSX.writeFile(workbook, "dukasmart-report.xlsx");
}

function generateReport(format) {
  if (format === "csv") return generateReportCsv();
  if (format === "pdf") return generateReportPdf();
  if (format === "xlsx") return generateReportXlsx();
}

function normalizeCustomerPhoneKey(rawPhone) {
  return normalizeTzPhoneForWhatsApp(rawPhone);
}

function findCustomerByPhone(phoneKey) {
  return state.customers.find((customer) => customer.phone === phoneKey);
}

function renderCustomerAccounts() {
  const container = qs("#customerAccountsTable");
  if (!container) return;
  const owing = state.customers.filter((customer) => Number(customer.balanceOwed || 0) > 0).sort((a, b) => Number(b.balanceOwed || 0) - Number(a.balanceOwed || 0));
  const total = owing.reduce((sum, customer) => sum + Number(customer.balanceOwed || 0), 0);

  container.innerHTML = owing
    .map((customer) => {
      const days = customerDaysOutstanding(customer);
      const bucket = customerAgingBucket(days);
      const statusClass = agingBucketStatusClass(bucket);
      const bucketLabelKey = bucket === "current" ? "agingCurrent" : bucket;
      const daysLabel = days === null ? "-" : `${days} \u2014 ${t(`customers.${bucketLabelKey}`)}`;
      return `<tr>
        <td>${esc(customer.name || "-")}</td>
        <td>${esc(customer.phone || "-")}</td>
        <td><strong>${money(customer.balanceOwed)}</strong></td>
        <td><span class="status ${statusClass}">${daysLabel}</span></td>
        <td>${customer.creditLimit != null ? money(customer.creditLimit) : t("customers.noLimit")}</td>
        <td class="table-actions">
          <button class="ghost-button compact" type="button" data-record-payment="${customer.id}">${t("customers.recordPayment")}</button>
          <button class="ghost-button compact" type="button" data-remind-customer="${customer.id}">${t("customers.remindButton")}</button>
          ${isManagerOrOwnerRole() ? `<button class="ghost-button compact" type="button" data-set-credit-limit="${customer.id}">${t("customers.setLimitButton")}</button>` : ""}
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="6" class="empty-state">${t("customers.emptyState")}</td></tr>`;

  const totalEl = qs("#customerAccountsTotal");
  if (totalEl) totalEl.textContent = `${t("customers.totalOwed")}: ${money(total)}`;
}

async function subscribeToCustomers() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeCustomers) state.unsubscribeCustomers();
  try {
    const { collection, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const customersRef = collection(state.db, "users", state.businessOwnerUid, "customers");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.customers = [];
      renderCustomerAccounts();
      return;
    }
    const customersQuery = queryStoreIds === null
      ? query(customersRef, orderBy("createdAt", "asc"))
      : query(customersRef, where("storeId", "in", queryStoreIds), orderBy("createdAt", "asc"));
    state.unsubscribeCustomers = onSnapshot(customersQuery, (snapshot) => {
      state.customers = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderCustomerAccounts();
    });
  } catch (error) {
    console.warn(error);
  }
}

async function subscribeToTransfers() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeTransfers) state.unsubscribeTransfers();
  try {
    const { collection, onSnapshot, orderBy, query, limit, where } = state.firebaseApi.firestore;
    const transfersRef = collection(state.db, "users", state.businessOwnerUid, "transfers");
    const queryStoreIds = await resolveQueryStoreIds();

    if (queryStoreIds === null) {
      const transfersQuery = query(transfersRef, orderBy("createdAt", "desc"), limit(2000));
      state.unsubscribeTransfers = onSnapshot(transfersQuery, (snapshot) => {
        state.transfers = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        if (state.productMovementProductId) renderProductMovementDialog(state.productMovementProductId);
      });
      return;
    }
    if (queryStoreIds.length === 0) {
      state.transfers = [];
      if (state.productMovementProductId) renderProductMovementDialog(state.productMovementProductId);
      return;
    }

    // firestore.rules grants a transfer if the staff can reach EITHER the
    // source OR the destination store -- Firestore can't OR across two
    // fields in one query, so run both filtered queries and merge by id,
    // deduped (a same-branch transfer would otherwise appear in both).
    let sourceDocs = [];
    let destDocs = [];
    const mergeAndSet = () => {
      const merged = new Map();
      [...sourceDocs, ...destDocs].forEach((docSnap) => merged.set(docSnap.id, { id: docSnap.id, ...docSnap.data() }));
      state.transfers = [...merged.values()].sort((a, b) => (transferDate(b)?.getTime() || 0) - (transferDate(a)?.getTime() || 0));
      if (state.productMovementProductId) renderProductMovementDialog(state.productMovementProductId);
    };

    const sourceQuery = query(transfersRef, where("sourceStoreId", "in", queryStoreIds), orderBy("createdAt", "desc"), limit(2000));
    const destQuery = query(transfersRef, where("destinationStoreId", "in", queryStoreIds), orderBy("createdAt", "desc"), limit(2000));
    const unsubSource = onSnapshot(sourceQuery, (snapshot) => { sourceDocs = snapshot.docs; mergeAndSet(); });
    const unsubDest = onSnapshot(destQuery, (snapshot) => { destDocs = snapshot.docs; mergeAndSet(); });
    state.unsubscribeTransfers = () => { unsubSource(); unsubDest(); };
  } catch (error) {
    console.warn(error);
  }
}

function openRecordPaymentDialog(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;
  state.pendingPaymentCustomerId = customerId;
  qs("#paymentCustomerName").textContent = `${customer.name || "-"} (${customer.phone || "-"})`;
  qs("#paymentCurrentBalance").textContent = money(customer.balanceOwed);
  qs("#paymentAmountInput").value = "";
  qs("#paymentNoteInput").value = "";
  qs("#paymentDialog").showModal();
}

async function confirmRecordPayment() {
  const customerId = state.pendingPaymentCustomerId;
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return qs("#paymentDialog").close();

  const amount = Number(qs("#paymentAmountInput")?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return showToast(t("toast.paymentInvalidAmount"));
  if (amount > Number(customer.balanceOwed || 0)) return showToast(t("toast.paymentExceedsBalance"));
  const note = (qs("#paymentNoteInput")?.value || "").trim().slice(0, 200);
  if (note.length > 200) return showToast(t("toast.fieldTooLong", { field: t("payment.noteLabel"), max: 200 }));

  const newBalance = Math.max(0, Number(customer.balanceOwed || 0) - amount);

  if (state.db && state.user && state.businessOwnerUid) {
    try {
      const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      const customerRef = doc(state.db, "users", state.businessOwnerUid, "customers", customerId);
      const paymentRef = doc(collection(state.db, "users", state.businessOwnerUid, "customers", customerId, "payments"));
      await runTransaction(state.db, async (transaction) => {
        const snap = await transaction.get(customerRef);
        if (!snap.exists()) throw new Error("customer gone");
        const currentBalance = Number(snap.data().balanceOwed || 0);
        if (amount > currentBalance) throw new Error(t("toast.paymentExceedsBalance"));
        const nextBalance = currentBalance - amount;
        const customerUpdate = { balanceOwed: nextBalance, updatedAt: serverTimestamp() };
        if (nextBalance <= 0) customerUpdate.oldestUnpaidAt = null;
        transaction.update(customerRef, customerUpdate);
        transaction.set(paymentRef, { amount, note, createdAt: serverTimestamp() });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        transaction.set(auditRef, {
          action: "PAYMENT_RECORDED",
          customerId,
          amount,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
    } catch (error) {
      console.warn(error);
      showToast(error.message || t("toast.paymentFailed"));
      return;
    }
  } else {
    customer.balanceOwed = newBalance;
    if (newBalance <= 0) customer.oldestUnpaidAt = null;
  }

  qs("#paymentDialog").close();
  showToast(t("toast.paymentRecorded", { amount: money(amount), balance: money(newBalance) }));
}

async function findOrCreateCustomerForCredit(name, phoneKey) {
  const existing = findCustomerByPhone(phoneKey, state.currentStoreId);
  if (existing) return existing.id;

  if (state.db && state.user && state.businessOwnerUid) {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const customerRef = doc(collection(state.db, "users", state.businessOwnerUid, "customers"));
    await setDoc(customerRef, { name: name || "", phone: phoneKey, balanceOwed: 0, storeId: state.currentStoreId, createdAt: serverTimestamp() });
    return customerRef.id;
  }

  const localId = `local-customer-${Date.now()}`;
  state.customers.push({ id: localId, name: name || "", phone: phoneKey, balanceOwed: 0, storeId: state.currentStoreId });
  return localId;
}

function customerOldestUnpaidDate(customer) {
  if (!customer.oldestUnpaidAt) return null;
  if (typeof customer.oldestUnpaidAt.toDate === "function") return customer.oldestUnpaidAt.toDate();
  return new Date(customer.oldestUnpaidAt);
}

function customerDaysOutstanding(customer) {
  const date = customerOldestUnpaidDate(customer);
  if (!date) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)));
}

function customerAgingBucket(days) {
  if (days === null || days <= 30) return "current";
  if (days <= 60) return "aging30";
  if (days <= 90) return "aging60";
  return "aging90";
}

function agingBucketStatusClass(bucket) {
  if (bucket === "current") return "healthy";
  if (bucket === "aging90") return "out";
  return "low";
}

function buildReminderTextLines(customer) {
  const days = customerDaysOutstanding(customer);
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "DukaSmart";
  const lines = [
    t("reminder.messageLine1", { name: customer.name || "", business: businessName, balance: money(customer.balanceOwed) })
  ];
  if (days) lines.push(t("reminder.messageLine2", { days }));
  lines.push(t("reminder.messageClosing"));
  return lines;
}

function sendPaymentReminderWhatsApp(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;
  const normalized = normalizeTzPhoneForWhatsApp(customer.phone);
  if (!normalized) return showToast(t("toast.reminderNoPhone"));
  const text = buildReminderTextLines(customer).join(" ");
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(text)}`, "_blank");
}

async function setCustomerCreditLimit(customerId) {
  const customer = state.customers.find((item) => item.id === customerId);
  if (!customer) return;

  const raw = window.prompt(
    t("dialog.creditLimitPrompt", { name: customer.name || customer.phone || "", currency: currentCurrencyCode() }),
    customer.creditLimit != null ? String(customer.creditLimit) : ""
  );
  if (raw === null) return;

  const trimmed = raw.trim();
  let nextLimit = null;
  if (trimmed !== "") {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return showToast(t("toast.creditLimitInvalid"));
    nextLimit = parsed;
  }

  if (state.db && state.user && state.businessOwnerUid) {
    try {
      const { doc, setDoc, collection, serverTimestamp } = state.firebaseApi.firestore;
      const previousLimit = customer.creditLimit ?? null;
      await setDoc(doc(state.db, "users", state.businessOwnerUid, "customers", customerId), { creditLimit: nextLimit }, { merge: true });
      try {
        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        await setDoc(auditRef, {
          action: "CREDIT_LIMIT_CHANGED",
          customerId,
          previousLimit,
          newLimit: nextLimit,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      } catch (auditError) {
        console.warn(auditError);
      }
    } catch (error) {
      console.warn(error);
      showToast(t("toast.creditLimitFailed"));
      return;
    }
  } else {
    customer.creditLimit = nextLimit;
  }

  showToast(nextLimit === null ? t("toast.creditLimitCleared", { name: customer.name || "" }) : t("toast.creditLimitSet", { name: customer.name || "", limit: money(nextLimit) }));
}

function checkCreditLimitBeforeSale(customerName, phoneKey, newBalanceDue) {
  const existing = findCustomerByPhone(phoneKey, state.currentStoreId);
  const limit = existing?.creditLimit;
  if (limit == null) return true;

  const currentBalance = Number(existing.balanceOwed || 0);
  const projectedTotal = currentBalance + newBalanceDue;
  if (projectedTotal <= limit) return true;

  return window.confirm(t("dialog.creditLimitExceededConfirm", {
    name: existing.name || customerName || phoneKey,
    currentBalance: money(currentBalance),
    newBalanceDue: money(newBalanceDue),
    projectedTotal: money(projectedTotal),
    limit: money(limit)
  }));
}

function transferDate(transfer) {
  if (!transfer.createdAt) return null;
  if (typeof transfer.createdAt.toDate === "function") return transfer.createdAt.toDate();
  return new Date(transfer.createdAt);
}

function productSalesEntries(productId) {
  const entries = [];
  state.sales.forEach((sale) => {
    if (sale.voided) return;
    (sale.items || []).forEach((item) => {
      if (item.productId !== productId) return;
      entries.push({
        date: saleDate(sale),
        staffName: sale.staffName || t("report.none"),
        qty: Number(item.qty || 0),
        orderNumber: sale.orderNumber || "",
        paymentMethod: sale.paymentMethod || "cash"
      });
    });
  });
  return entries.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

function productTransferEntries(productId) {
  return state.transfers
    .filter((transfer) => transfer.productId === productId || transfer.destinationProductId === productId)
    .map((transfer) => ({
      date: transferDate(transfer),
      staffName: transfer.staffName || t("report.none"),
      qty: Number(transfer.quantity || 0),
      sourceStoreName: transfer.sourceStoreName || t("storeSwitcher.fallbackName"),
      destinationStoreName: transfer.destinationStoreName || t("storeSwitcher.fallbackName")
    }))
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

function buildProductMovementHtml(productId) {
  const product = state.products.find((item) => item.id === productId);
  const productName = product ? esc(productDisplayLabel(product)) : "";
  const sales = productSalesEntries(productId);
  const transfers = productTransferEntries(productId);

  const salesRows = sales
    .map(
      (entry) => `<tr>
        <td>${entry.date ? entry.date.toLocaleString() : "-"}</td>
        <td>${esc(entry.staffName)}</td>
        <td>${entry.qty}</td>
        <td>#${esc(entry.orderNumber)}</td>
        <td>${paymentMethodLabel(entry.paymentMethod)}</td>
      </tr>`
    )
    .join("");

  const transferRows = transfers
    .map(
      (entry) => `<tr>
        <td>${entry.date ? entry.date.toLocaleString() : "-"}</td>
        <td>${esc(entry.sourceStoreName)}</td>
        <td>${esc(entry.destinationStoreName)}</td>
        <td>${entry.qty}</td>
        <td>${esc(entry.staffName)}</td>
      </tr>`
    )
    .join("");

  return `
    <p class="muted">${t("movement.subtitle", { name: productName })}</p>
    <h3>${t("movement.salesSectionTitle")}</h3>
    <table>
      <thead>
        <tr>
          <th>${t("movement.colDate")}</th>
          <th>${t("movement.colStaff")}</th>
          <th>${t("movement.colQty")}</th>
          <th>${t("movement.colOrder")}</th>
          <th>${t("report.colPaymentMethod")}</th>
        </tr>
      </thead>
      <tbody>${salesRows || `<tr><td colspan="5" class="empty-state">${t("movement.noSales")}</td></tr>`}</tbody>
    </table>
    <h3>${t("movement.transfersSectionTitle")}</h3>
    <table>
      <thead>
        <tr>
          <th>${t("movement.colDate")}</th>
          <th>${t("movement.colFrom")}</th>
          <th>${t("movement.colTo")}</th>
          <th>${t("movement.colQty")}</th>
          <th>${t("movement.colTransferBy")}</th>
        </tr>
      </thead>
      <tbody>${transferRows || `<tr><td colspan="5" class="empty-state">${t("movement.noTransfers")}</td></tr>`}</tbody>
    </table>
  `;
}

function renderProductMovementDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  qs("#productMovementDialogTitle").textContent = product ? `${t("movement.title")} \u2014 ${productDisplayLabel(product)}` : t("movement.title");
  qs("#productMovementContent").innerHTML = buildProductMovementHtml(productId);
}

function openProductMovementDialog(productId) {
  state.productMovementProductId = productId;
  renderProductMovementDialog(productId);
  qs("#productMovementDialog").showModal();
}

function buildPurchaseOrderGroups() {
  const recs = storeProducts()
    .map((product) => ({ product, rec: reorderRecommendation(product) }))
    .filter(({ rec }) => rec.recommendedQty > 0);

  const bySupplier = new Map();
  recs.forEach(({ product, rec }) => {
    const supplierName = String(product.supplier || "").trim() || t("po.unassignedSupplier");
    if (!bySupplier.has(supplierName)) bySupplier.set(supplierName, []);
    bySupplier.get(supplierName).push({
      productId: product.id,
      name: product.name,
      quantity: Number(product.quantity || 0),
      reorderQty: rec.recommendedQty
    });
  });

  return [...bySupplier.entries()]
    .map(([supplier, items]) => ({ supplier, items }))
    .sort((a, b) => a.supplier.localeCompare(b.supplier));
}

function renderPurchaseOrderDialog() {
  const container = qs("#purchaseOrderGroups");
  if (!container) return;
  if (!state.purchaseOrderGroups.length) {
    container.innerHTML = `<p class="muted">${t("po.noRecommendations")}</p>`;
    return;
  }

  container.innerHTML = state.purchaseOrderGroups
    .map(
      (group, groupIndex) => `<div class="po-supplier-group">
      <div class="po-supplier-head">
        <strong>${esc(group.supplier)}</strong>
        <button class="ghost-button compact danger" type="button" data-po-exclude-group="${groupIndex}">${t("po.excludeAll")}</button>
      </div>
      <div class="po-item-row po-item-header">
        <strong>${t("po.colProduct")}</strong>
        <strong>${t("po.colCurrentStock")}</strong>
        <strong>${t("po.colReorderQty")}</strong>
      </div>
      ${group.items
        .map(
          (item, itemIndex) => `<div class="po-item-row">
        <span>${esc(item.name)}</span>
        <span class="muted">${item.quantity}</span>
        <input type="number" min="0" value="${item.reorderQty}" class="po-qty-input" data-po-qty="${groupIndex}:${itemIndex}" />
      </div>`
        )
        .join("")}
      <div class="button-row end">
        <button class="ghost-button compact" type="button" data-po-download="${groupIndex}">${t("po.downloadPdf")}</button>
        <button class="primary-button compact" type="button" data-po-send="${groupIndex}">${t("po.sendWhatsApp")}</button>
      </div>
    </div>`
    )
    .join("");
}

function openPurchaseOrderDialog() {
  state.purchaseOrderGroups = buildPurchaseOrderGroups();
  renderPurchaseOrderDialog();
  qs("#purchaseOrderDialog").showModal();
}

function currentPoGroupQuantities(groupIndex) {
  const group = state.purchaseOrderGroups[groupIndex];
  if (!group) return null;
  const items = group.items.map((item, itemIndex) => {
    const input = qs(`[data-po-qty="${groupIndex}:${itemIndex}"]`);
    const qty = Math.max(0, Math.floor(Number(input?.value ?? item.reorderQty)));
    return { ...item, reorderQty: qty };
  });
  return { supplier: group.supplier, items: items.filter((item) => item.reorderQty > 0) };
}

function buildPurchaseOrderTextLines(group) {
  const dateLabel = new Date().toLocaleDateString();
  const lines = [t("po.messageIntro", { supplier: group.supplier }), t("po.generatedOn", { date: dateLabel }), ""];
  group.items.forEach((item) => {
    lines.push(`- ${item.name}: ${item.reorderQty}`);
  });
  lines.push("", t("po.messageClosing"));
  return lines;
}

function sendPurchaseOrderWhatsApp(groupIndex) {
  const group = currentPoGroupQuantities(groupIndex);
  if (!group || !group.items.length) return showToast(t("toast.poAllQuantitiesZero"));

  const rawPhone = window.prompt(t("dialog.customerPhonePrompt"));
  if (rawPhone === null) return;
  const normalized = normalizeTzPhoneForWhatsApp(rawPhone);
  if (!normalized) return showToast(t("toast.invalidPhoneNumber"));

  const text = buildPurchaseOrderTextLines(group).join("\n");
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(text)}`, "_blank");
}

function downloadPurchaseOrderPdf(groupIndex) {
  const group = currentPoGroupQuantities(groupIndex);
  if (!group || !group.items.length) return showToast(t("toast.poAllQuantitiesZero"));

  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));

  const lines = buildPurchaseOrderTextLines(group);
  const doc = new jsPdfCtor({ unit: "mm", format: [80, Math.max(120, 40 + lines.length * 5)] });
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  let y = 8;
  lines.forEach((line) => {
    doc.splitTextToSize(line, 72).forEach((wrapped) => {
      doc.text(wrapped, 4, y);
      y += 4.5;
    });
  });
  doc.save(`purchase-order-${group.supplier.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now()}.pdf`);
}

function excludePurchaseOrderGroup(groupIndex) {
  state.purchaseOrderGroups = state.purchaseOrderGroups.filter((_, index) => index !== groupIndex);
  renderPurchaseOrderDialog();
}

// Builds the WhatsApp text for a staff invite. Explicitly names DukaSmart
// and the inviting business by name in the message itself -- an invite
// link with no context is indistinguishable from a phishing link, and
// staff have no other way to verify who sent it before they've even
// opened the app.
function buildStaffInviteTextLines(linkToken, roleLabel) {
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "your employer";
  const acceptUrl = `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}accept-invite.html?accept-invite=${encodeURIComponent(linkToken)}`;
  return [
    `This is an official DukaSmart ERP invitation from ${businessName}.`,
    `You've been invited to join as a ${roleLabel} on DukaSmart, the inventory and sales system used by ${businessName}.`,
    "",
    `Tap this link to accept and set up your account: ${acceptUrl}`,
    "",
    "This link is valid for 48 hours and can only be used once.",
    "If you weren't expecting this message, you can safely ignore it."
  ];
}

function productCollectionPath() {
  if (!state.db || !state.user || !state.businessOwnerUid) return null;
  return ["users", state.businessOwnerUid, "products"];
}

function openProductDialog(product = null) {
  populateCategorySuggestions();
  const form = qs("#productForm");
  form.reset();
  qs("#productDialogTitle").textContent = product ? t("product.editTitle") : t("product.addTitle");
  form.elements.id.value = product?.id || "";
  if (product) {
    Object.entries(product).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value ?? "";
    });
  }
  qs("#productDialog").showModal();
}

const PRODUCT_FIELD_LIMITS = {
  name: 120,
  category: 60,
  brand: 60,
  supplier: 60,
  barcode: 64
};

const PRODUCT_FIELD_LABEL_KEYS = {
  name: "product.nameLabel",
  category: "product.categoryLabel",
  brand: "product.brandLabel",
  supplier: "product.supplierLabel",
  barcode: "product.barcodeLabel"
};

function validateProductFields(product) {
  for (const [field, maxLength] of Object.entries(PRODUCT_FIELD_LIMITS)) {
    const value = String(product[field] ?? "");
    if (value.length > maxLength) {
      return t("toast.fieldTooLong", { field: t(PRODUCT_FIELD_LABEL_KEYS[field] || field), max: maxLength });
    }
  }
  return null;
}

function clampNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

async function saveProduct(product) {
  const existing = product.id ? state.products.find((item) => item.id === product.id) : null;
  if (!existing && state.db && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreBeforeAdd"));
    return;
  }
  product.id = product.id || crypto.randomUUID();
  product.storeId = existing?.storeId || product.storeId || state.currentStoreId;
  product.sold30 = Number(existing?.sold30 ?? product.sold30 ?? 0);
  product.sold90 = Number(existing?.sold90 ?? product.sold90 ?? 0);
  product.leadTimeDays = Number(existing?.leadTimeDays ?? product.leadTimeDays ?? 10);
  product.priceType = product.priceType === "dynamic" ? "dynamic" : "fixed";

  const localProduct = { ...existing, ...product };
  state.products = existing
    ? state.products.map((item) => (item.id === product.id ? localProduct : item))
    : [...state.products, localProduct];

  if (state.db && state.user) {
    try {
      const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
      const [root, uid, child] = productCollectionPath();
      await setDoc(
        doc(collection(state.db, root, uid, child), product.id),
        {
          ...product,
          createdAt: existing?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
      try {
        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        await setDoc(auditRef, {
          action: existing ? "PRODUCT_EDITED" : "PRODUCT_CREATED",
          productId: product.id,
          name: product.name || "",
          sellingPrice: Number(product.sellingPrice || 0),
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      } catch (auditError) {
        console.warn(auditError);
      }
    } catch (error) {
      console.warn(error);
      showToast(t("toast.savedLocallyFirestoreFailed"));
    }
  }

  renderAll();
  showToast(t("toast.productSaved", { name: product.name }));
}

function openTransferDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  const sourceStoreId = productStoreId(product);
  const otherStores = activeStores().filter((store) => store.id !== sourceStoreId);
  if (!otherStores.length) return showToast(t("toast.needTwoStoresTransfer"));
  if (!state.db || !state.user) return showToast(t("toast.signInToTransfer"));
  if (!qs("#transferDialog")) {
    console.warn("transferDialog markup missing from index.html");
    return showToast(t("toast.transferFailed"));
  }

  state.pendingTransferProductId = productId;
  const sourceStore = state.stores.find((store) => store.id === sourceStoreId);
  qs("#transferProductLabel").textContent = t("dialog.transferProductLabel", {
    name: product.name,
    quantity: product.quantity,
    store: sourceStore?.name || t("storeSwitcher.fallbackName")
  });
  qs("#transferDestinationSelect").innerHTML = otherStores
    .map((store) => `<option value="${store.id}">${esc(store.name || t("storeSwitcher.fallbackName"))}</option>`)
    .join("");
  const transferStaffNameInput = qs("#transferStaffNameInput");
  if (transferStaffNameInput) {
    transferStaffNameInput.value = state.staff.find((member) => member.id === state.selectedStaffId)?.name || "";
  }
  const transferStaffSuggestions = qs("#transferStaffSuggestions");
  if (transferStaffSuggestions) {
    transferStaffSuggestions.innerHTML = activeStaff().map((member) => `<option value="${esc(member.name || "")}"></option>`).join("");
  }
  const qtyInput = qs("#transferQuantityInput");
  qtyInput.max = product.quantity;
  qtyInput.value = Math.min(1, product.quantity);
  qs("#transferDialog").showModal();
}

async function confirmTransfer() {
  const productId = state.pendingTransferProductId;
  const product = state.products.find((item) => item.id === productId);
  if (!product) return qs("#transferDialog").close();

  const destinationStoreId = qs("#transferDestinationSelect").value;
  const destinationStore = state.stores.find((store) => store.id === destinationStoreId);
  if (!destinationStore) return showToast(t("toast.invalidStoreSelection"));

  const transferStaffName = (qs("#transferStaffNameInput")?.value || "").trim().slice(0, 80);
  if (!transferStaffName) return showToast(t("toast.transferStaffRequired"));

  const qty = Math.floor(Number(qs("#transferQuantityInput").value));
  if (!Number.isFinite(qty) || qty <= 0 || qty > product.quantity) return showToast(t("toast.invalidTransferQuantity"));

  const sourceStore = state.stores.find((store) => store.id === productStoreId(product));

  try {
    const { collection, doc, runTransaction, serverTimestamp, query, where, getDocs } = state.firebaseApi.firestore;
    const productsRef = collection(state.db, "users", state.businessOwnerUid, "products");
    const sourceRef = doc(productsRef, product.id);

    const matchQuery = query(productsRef, where("storeId", "==", destinationStore.id), where("sku", "==", product.sku));
    const matchSnapOutsideTx = await getDocs(matchQuery);
    const destinationRef = matchSnapOutsideTx.empty ? doc(productsRef) : matchSnapOutsideTx.docs[0].ref;
    const destinationExisted = !matchSnapOutsideTx.empty;
    const transferRef = doc(collection(state.db, "users", state.businessOwnerUid, "transfers"));

    await runTransaction(state.db, async (transaction) => {
      const sourceSnap = await transaction.get(sourceRef);
      if (!sourceSnap.exists()) throw new Error(t("txerror.sourceProductGone"));
      const sourceQty = Number(sourceSnap.data().quantity || 0);
      if (sourceQty < qty) throw new Error(t("txerror.notEnoughStockTransfer"));

      let destinationQty = 0;
      if (destinationExisted) {
        const destinationSnap = await transaction.get(destinationRef);
        destinationQty = destinationSnap.exists() ? Number(destinationSnap.data().quantity || 0) : 0;
      }

      transaction.update(sourceRef, { quantity: sourceQty - qty, updatedAt: serverTimestamp() });

      if (destinationExisted) {
        transaction.update(destinationRef, { quantity: destinationQty + qty, updatedAt: serverTimestamp() });
      } else {
        const { id, ...rest } = product;
        transaction.set(destinationRef, {
          ...rest,
          id: destinationRef.id,
          storeId: destinationStore.id,
          quantity: qty,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      transaction.set(transferRef, {
        productId: product.id,
        destinationProductId: destinationRef.id,
        productName: product.name,
        quantity: qty,
        sourceStoreId: productStoreId(product),
        sourceStoreName: sourceStore?.name || t("storeSwitcher.fallbackName"),
        destinationStoreId: destinationStore.id,
        destinationStoreName: destinationStore.name || t("storeSwitcher.fallbackName"),
        staffName: transferStaffName,
        performedByUid: state.user.uid,
        createdAt: serverTimestamp()
      });
    });

    showToast(t("toast.transferred", { qty, unit: qty === 1 ? t("toast.unitSingular") : t("toast.unitPlural"), name: product.name, store: destinationStore.name }));
    qs("#transferDialog").close();
  } catch (error) {
    console.warn(error);
    showToast(error.message || t("toast.transferFailed"));
  }
}

function openRestockDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  state.pendingRestockProductId = productId;
  qs("#restockProductLabel").textContent = t("restock.productLabel", { name: product.name, quantity: product.quantity });
  qs("#restockQuantityInput").value = "";
  qs("#restockDialog").showModal();
}

async function confirmRestock() {
  const productId = state.pendingRestockProductId;
  const product = state.products.find((item) => item.id === productId);
  if (!product) return qs("#restockDialog").close();

  const qty = Math.floor(Number(qs("#restockQuantityInput").value));
  if (!Number.isFinite(qty) || qty <= 0) return showToast(t("toast.restockInvalidQuantity"));

  const newQuantityDisplay = Number(product.quantity || 0) + qty;

  if (state.db && state.user && state.businessOwnerUid) {
    try {
      const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      const productRef = doc(state.db, "users", state.businessOwnerUid, "products", productId);
      await runTransaction(state.db, async (transaction) => {
        const snap = await transaction.get(productRef);
        if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: product.name }));
        const currentQuantity = Number(snap.data().quantity || 0);
        transaction.update(productRef, { quantity: currentQuantity + qty, updatedAt: serverTimestamp(), movementReason: "restock" });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        transaction.set(auditRef, {
          action: "PRODUCT_RESTOCKED",
          productId,
          name: product.name || "",
          qtyAdded: qty,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
    } catch (error) {
      console.warn(error);
      showToast(error.message || t("toast.restockFailed"));
      return;
    }
  } else {
    product.quantity = newQuantityDisplay;
  }

  qs("#restockDialog").close();
  renderAll();
  showToast(t("toast.restocked", { qty, name: product.name, quantity: newQuantityDisplay }));
}

function findProductByBarcode(code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) return null;
  return storeProducts().find((product) => String(product.barcode || "").trim() === trimmed) || null;
}

function addProductToCartById(productId, options = {}) {
  const product = state.products.find((item) => item.id === productId);
  if (!product || product.quantity <= 0) {
    showToast(t("toast.outOfStock"));
    return { failed: true };
  }
  if (state.db && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreToSell"));
    return { failed: true };
  }

  const requestedQty = Math.max(1, Math.floor(Number(options.qty || 1)));
  let unitPrice = Number(product.sellingPrice || 0);
  if (product.priceType === "dynamic") {
    if (options.unitPrice && options.unitPrice > 0) {
      unitPrice = options.unitPrice;
    } else {
      return { needsPrice: true, product };
    }
  }

  const existingCartItem = state.cart.find((item) => item.id === product.id);
  const existingQty = existingCartItem?.qty || 0;
  if (existingQty + requestedQty > product.quantity) {
    showToast(t("toast.notEnoughStockQty"));
    return { failed: true };
  }
  if (!existingCartItem && state.cart.length >= 40) {
    showToast(t("toast.cartLimitReached"));
    return { failed: true };
  }

  pushCartHistory();
  if (existingCartItem) {
    existingCartItem.qty += requestedQty;
    if (product.priceType === "dynamic") existingCartItem.sellingPrice = unitPrice;
  } else {
    state.cart.push({ ...product, qty: requestedQty, sellingPrice: unitPrice });
  }
  renderCart();
  return { success: true, product };
}

async function closeBarcodeScanner() {
  const scanner = state.barcodeScannerInstance;
  state.barcodeScannerInstance = null;
  qs("#barcodeScannerDialog").close();
  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (error) {
      console.warn(error);
    }
  }
}

function handleBarcodeScanned(decodedText) {
  const target = state.barcodeScanTarget;
  closeBarcodeScanner();

  if (target === "product") {
    const form = qs("#productForm");
    if (form?.elements.barcode) form.elements.barcode.value = decodedText;
    showToast(t("toast.barcodeCaptured"));
    return;
  }

  const product = findProductByBarcode(decodedText);
  if (!product) {
    qs("#posSearch").value = decodedText;
    renderPosProducts();
    showToast(t("toast.barcodeNoMatch", { code: decodedText }));
    return;
  }

  if (product.priceType === "dynamic") {
    qs("#posSearch").value = product.name;
    renderPosProducts();
    showToast(t("toast.enterPricePerUnit"));
    return;
  }

  const result = addProductToCartById(product.id, { qty: 1 });
  if (result?.success) showToast(t("toast.barcodeAdded", { name: product.name }));
}

function openBarcodeScanner(target) {
  if (!window.Html5Qrcode) return showToast(t("toast.barcodeLibraryFailed"));

  state.barcodeScanTarget = target;
  qs("#barcodeScannerStatus").textContent = "";
  qs("#barcodeScannerDialog").showModal();

  const scanner = new Html5Qrcode("barcodeReaderRegion", {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODABAR,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.QR_CODE
    ],
    verbose: false
  });
  state.barcodeScannerInstance = scanner;

  scanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (decodedText) => handleBarcodeScanned(decodedText),
      () => {}
    )
    .catch((error) => {
      console.warn(error);
      qs("#barcodeScannerStatus").textContent = t("toast.cameraAccessFailed");
    });
}

function receiptMeta(sale) {
  const store = state.stores.find((item) => item.id === (sale.storeId || state.currentStoreId));
  const storeName = store?.name || t("storeSwitcher.fallbackName");
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "DukaSmart";
  const date = sale.createdAt
    ? (typeof sale.createdAt.toDate === "function" ? sale.createdAt.toDate() : new Date(sale.createdAt))
    : new Date();
  return { storeName, businessName, date };
}

function buildReceiptHtml(sale) {
  const { storeName, businessName, date } = receiptMeta(sale);
  const itemRows = (sale.items || [])
    .map(
      (item) => `
      <div class="receipt-row"><span>${esc(item.name)}</span><span>${money(item.lineTotal)}</span></div>
      <div class="receipt-row muted"><span>${Number(item.qty || 0)} x ${money(item.sellingPrice)}</span><span></span></div>`
    )
    .join("");
  return `
    <div class="receipt-center"><strong>${esc(businessName)}</strong></div>
    <div class="receipt-center muted">${esc(storeName)}</div>
    <div class="receipt-divider"></div>
    <div class="receipt-row"><span>${t("receipt.dateLabel")}</span><span>${date.toLocaleString()}</span></div>
    ${sale.staffName ? `<div class="receipt-row"><span>${t("pos.staffLabel")}</span><span>${esc(sale.staffName)}</span></div>` : ""}
    ${sale.customerName ? `<div class="receipt-row"><span>${t("receipt.customerLabel")}</span><span>${esc(sale.customerName)}</span></div>` : ""}
    ${sale.orderNumber ? `<div class="receipt-row"><span>${t("reports.staffOrderLookupOrderLabel")}</span><span>#${esc(sale.orderNumber)}</span></div>` : ""}
    <div class="receipt-row"><span>${t("report.colPaymentMethod")}</span><span>${paymentMethodLabel(sale.paymentMethod || "cash")}</span></div>
    <div class="receipt-divider"></div>
    ${itemRows}
    <div class="receipt-divider"></div>
    ${
      sale.discountType && sale.discountType !== "none"
        ? `<div class="receipt-row"><span>${t("receipt.subtotalLabel")}</span><span>${money(sale.subtotal)}</span></div>
    <div class="receipt-row"><span>${t("receipt.discountLabel")}</span><span>- ${money(sale.discountAmount)}</span></div>`
        : ""
    }
    <div class="receipt-row"><strong>${t("pos.total")}</strong><strong>${money(sale.total)}</strong></div>
    ${
      sale.paymentMethod === "cash" && sale.cashTendered != null
        ? `<div class="receipt-row"><span>${t("pos.amountTendered")}</span><span>${money(sale.cashTendered)}</span></div>
    <div class="receipt-row"><span>${t("pos.changeDue")}</span><span>${money(sale.changeDue)}</span></div>`
        : ""
    }
    ${
      sale.paymentMethod === "credit"
        ? `<div class="receipt-row"><span>${t("receipt.amountPaidLabel")}</span><span>${money(sale.amountPaid)}</span></div>
    <div class="receipt-row"><strong>${t("receipt.balanceDueLabel")}</strong><strong>${money(sale.balanceDue)}</strong></div>`
        : ""
    }
    <div class="receipt-divider"></div>
    <div class="receipt-center muted">${t("receipt.thankYou")}</div>
  `;
}

function openReceiptDialog(sale) {
  state.lastReceiptSale = sale;
  qs("#receiptContent").innerHTML = buildReceiptHtml(sale);
  qs("#receiptDialog").showModal();
}

function printReceipt() {
  const content = qs("#receiptContent")?.innerHTML;
  if (!content) return;
  const printWindow = window.open("", "_blank", "width=380,height=600");
  if (!printWindow) return showToast(t("toast.popupBlocked"));
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title>
    <style>
      body{font-family:'Courier New',monospace;font-size:12px;padding:12px;color:#000;}
      .receipt-row{display:flex;justify-content:space-between;gap:8px;margin:2px 0;}
      .receipt-divider{border-top:1px dashed #000;margin:6px 0;}
      .receipt-center{text-align:center;}
      .muted{color:#444;}
    </style></head><body>${content}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}

function buildReceiptTextLines(sale) {
  const { storeName, businessName, date } = receiptMeta(sale);
  const lines = [businessName, storeName, "", `${t("receipt.dateLabel")}: ${date.toLocaleString()}`];
  if (sale.staffName) lines.push(`${t("pos.staffLabel")}: ${sale.staffName}`);
  if (sale.customerName) lines.push(`${t("receipt.customerLabel")}: ${sale.customerName}`);
  if (sale.orderNumber) lines.push(`${t("reports.staffOrderLookupOrderLabel")}: #${sale.orderNumber}`);
  lines.push(`${t("report.colPaymentMethod")}: ${paymentMethodLabel(sale.paymentMethod || "cash")}`, "--------------------------------");
  (sale.items || []).forEach((item) => {
    lines.push(item.name);
    lines.push(`  ${item.qty} x ${money(item.sellingPrice)} = ${money(item.lineTotal)}`);
  });
  lines.push("--------------------------------");
  if (sale.discountType && sale.discountType !== "none") {
    lines.push(`${t("receipt.subtotalLabel")}: ${money(sale.subtotal)}`);
    lines.push(`${t("receipt.discountLabel")}: - ${money(sale.discountAmount)}`);
  }
  lines.push(`${t("pos.total")}: ${money(sale.total)}`);
  if (sale.paymentMethod === "cash" && sale.cashTendered != null) {
    lines.push(`${t("pos.amountTendered")}: ${money(sale.cashTendered)}`);
    lines.push(`${t("pos.changeDue")}: ${money(sale.changeDue)}`);
  }
  if (sale.paymentMethod === "credit") {
    lines.push(`${t("receipt.amountPaidLabel")}: ${money(sale.amountPaid)}`);
    lines.push(`${t("receipt.balanceDueLabel")}: ${money(sale.balanceDue)}`);
  }
  lines.push("", t("receipt.thankYou"));
  return lines;
}

function normalizeTzPhoneForWhatsApp(rawPhone) {
  const digits = String(rawPhone || "").replace(/[^\d]/g, "");
  if (digits.startsWith("255") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 10) return `255${digits.slice(1)}`;
  if (digits.length === 9) return `255${digits}`;
  return null;
}

function shareReceiptWhatsApp() {
  const sale = state.lastReceiptSale;
  if (!sale) return;

  let rawPhone = sale.customerPhone;
  if (!rawPhone) {
    rawPhone = window.prompt(t("dialog.customerPhonePrompt"));
    if (rawPhone === null) return;
  }

  const normalized = normalizeTzPhoneForWhatsApp(rawPhone);
  if (!normalized) return showToast(t("toast.invalidPhoneNumber"));

  const text = buildReceiptTextLines(sale).join("\n");
  window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(text)}`, "_blank");
}

function downloadReceiptPdf() {
  const sale = state.lastReceiptSale;
  if (!sale) return;
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));

  const lines = buildReceiptTextLines(sale);
  const doc = new jsPdfCtor({ unit: "mm", format: [80, Math.max(120, 40 + lines.length * 5)] });
  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  let y = 8;
  lines.forEach((line) => {
    doc.splitTextToSize(line, 72).forEach((wrapped) => {
      doc.text(wrapped, 4, y);
      y += 4.5;
    });
  });
  doc.save(`receipt-${sale.orderNumber || Date.now()}.pdf`);
}

async function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  if (!window.confirm(t("dialog.deleteConfirm", { name: product.name }))) return;

  state.products = state.products.filter((item) => item.id !== productId);
  state.cart = state.cart.filter((item) => item.id !== productId);
  if (state.db && state.user && state.businessOwnerUid) {
    try {
      const { deleteDoc, doc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
      await deleteDoc(doc(state.db, "users", state.businessOwnerUid, "products", productId));
      try {
        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        await setDoc(auditRef, {
          action: "PRODUCT_DELETED",
          productId,
          name: product.name || "",
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      } catch (auditError) {
        console.warn(auditError);
      }
    } catch (error) {
      console.warn(error);
      showToast(t("toast.deletedLocallyFirestoreFailed"));
    }
  }
  renderAll();
  showToast(t("toast.productDeleted", { name: product.name }));
}

function openDeleteAccountDialog() {
  if (!state.user) return;
  qs("#deleteAccountPassword").value = "";
  qs("#deleteAccountConfirmText").value = "";
  setFieldError("deleteAccountError", "");
  qs("#deleteAccountDialog").showModal();
}

async function confirmDeleteAccount() {
  if (!state.user || !state.auth) return;
  const password = qs("#deleteAccountPassword").value;
  const confirmText = qs("#deleteAccountConfirmText").value.trim();

  if (confirmText !== "DELETE") {
    setFieldError("deleteAccountError", t("deleteAccount.confirmTextMismatch"));
    return;
  }
  if (!password) {
    setFieldError("deleteAccountError", t("deleteAccount.passwordRequired"));
    return;
  }

  const confirmButton = qs("#confirmDeleteAccountButton");
  confirmButton.disabled = true;

  try {
    const { EmailAuthProvider, reauthenticateWithCredential } = state.firebaseApi.auth;
    const credential = EmailAuthProvider.credential(state.user.email, password);
    await reauthenticateWithCredential(state.user, credential);

    // This used to call deleteUser() directly, which removed the login and
    // left the ENTIRE Firestore tree behind -- every product, sale, customer
    // name and phone number orphaned in place with no account able to reach
    // it. That is a GDPR Art. 17 failure and the button did far less than its
    // label implied. Deletion is now server-mediated: the proxy freezes the
    // tenant, kills live sessions, disables staff accounts, and schedules the
    // anonymise-and-purge for after a 30-day grace period during which the
    // owner can still change their mind. See DATA-DELETION.md.
    const token = await state.user.getIdToken(/* forceRefresh */ true);
    const response = await fetch(aiConfig.requestDeletionUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 409) {
      setFieldError("deleteAccountError", t("deleteAccount.alreadyScheduled"));
      return;
    }
    if (response.status === 403) {
      setFieldError("deleteAccountError", t("deleteAccount.ownerOnly"));
      return;
    }
    if (!response.ok || !payload.ok) {
      setFieldError("deleteAccountError", t("toast.accountDeleteFailed"));
      return;
    }

    qs("#deleteAccountDialog").close();
    state.deletionScheduledFor = payload.deletionScheduledFor || null;
    renderDeletionBanner();
    // Sessions were just revoked server-side, so this client is already
    // read-only. Signing out avoids leaving a half-authorised session that
    // fails on its next write with no explanation.
    await state.auth.signOut().catch(() => {});
    showToast(t("toast.accountDeletionScheduled", { days: payload.gracePeriodDays || 30 }));
  } catch (error) {
    console.warn(error);
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      setFieldError("deleteAccountError", t("deleteAccount.reauthFailed"));
    } else {
      setFieldError("deleteAccountError", t("toast.accountDeleteFailed"));
    }
  } finally {
    confirmButton.disabled = false;
  }
}

// Grace-period banner. An owner who signs back in during the 30 days must be
// told plainly that their data is scheduled for irreversible deletion, when,
// and how to stop it -- a frozen account that silently refuses writes is
// indistinguishable from a broken one.
function renderDeletionBanner() {
  const banner = qs("#deletionPendingBanner");
  if (!banner) return;
  const scheduledFor = state.deletionScheduledFor;
  const pending = Boolean(scheduledFor) && state.user?.uid === state.businessOwnerUid;
  banner.hidden = !pending;
  if (!pending) return;
  const daysLeft = Math.max(0, Math.ceil((scheduledFor - Date.now()) / (24 * 60 * 60 * 1000)));
  const label = qs("#deletionPendingText");
  if (label) label.textContent = t("deleteAccount.pendingBanner", { days: daysLeft });
}

async function cancelAccountDeletion() {
  if (!state.user) return;
  if (!window.confirm(t("deleteAccount.restoreConfirm"))) return;
  try {
    const token = await state.user.getIdToken(/* forceRefresh */ true);
    const response = await fetch(aiConfig.cancelDeletionUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}"
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 410) {
      showToast(t("deleteAccount.gracePeriodOver"));
      return;
    }
    if (!response.ok || !payload.ok) {
      showToast(t("deleteAccount.restoreFailed"));
      return;
    }
    state.deletionScheduledFor = null;
    renderDeletionBanner();
    showToast(t("deleteAccount.restored"));
    // The freeze is enforced by firestore.rules against the tenant document,
    // so a full resubscribe is the cleanest way to pick up write access again.
    await subscribeToStores();
    renderAll();
  } catch (error) {
    console.warn(error);
    showToast(t("deleteAccount.restoreFailed"));
  }
}

async function undoLastSale() {
  if (!state.lastSale) return showToast(t("toast.noRecentSale"));
  if (!window.confirm(t("dialog.undoSaleConfirm"))) return;

  const sale = state.lastSale;
  if (sale.mode === "firestore" && state.db && state.user && state.businessOwnerUid) {
    try {
      const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      await runTransaction(state.db, async (transaction) => {
        const saleRef = doc(state.db, "users", state.businessOwnerUid, "sales", sale.saleId);
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) throw new Error(t("txerror.saleNotFound"));
        const saleData = saleSnap.data();
        if (saleData.voided) throw new Error(t("txerror.saleAlreadyUndone"));

        const productRefs = sale.items.map((item) => doc(state.db, "users", state.businessOwnerUid, "products", item.productId));
        const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

        const creditCustomerRef = saleData.paymentMethod === "credit" && saleData.customerId
          ? doc(state.db, "users", state.businessOwnerUid, "customers", saleData.customerId)
          : null;
        const creditCustomerSnap = creditCustomerRef ? await transaction.get(creditCustomerRef) : null;

        productSnaps.forEach((snap, index) => {
          if (!snap.exists()) return;
          const item = sale.items[index];
          const currentQuantity = Number(snap.data().quantity || 0);
          const currentSold30 = Number(snap.data().sold30 || 0);
          const currentSold90 = Number(snap.data().sold90 || 0);
          transaction.update(productRefs[index], {
            quantity: currentQuantity + item.qty,
            sold30: Math.max(0, currentSold30 - item.qty),
            sold90: Math.max(0, currentSold90 - item.qty),
            updatedAt: serverTimestamp(),
            movementReason: "void"
          });
        });

        if (creditCustomerRef && creditCustomerSnap?.exists()) {
          const currentOwed = Number(creditCustomerSnap.data().balanceOwed || 0);
          transaction.update(creditCustomerRef, { balanceOwed: Math.max(0, currentOwed - Number(saleData.balanceDue || 0)), updatedAt: serverTimestamp() });
        }

        transaction.update(saleRef, { voided: true, voidedAt: serverTimestamp() });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        transaction.set(auditRef, {
          action: "SALE_VOIDED",
          saleId: sale.saleId,
          total: saleData.total,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
    } catch (error) {
      console.warn(error);
      showToast(error.message || t("toast.couldNotUndoSale"));
      return;
    }
  } else {
    sale.items.forEach((item) => {
      const product = state.products.find((p) => p.id === item.productId);
      if (product) {
        product.quantity += item.qty;
        product.sold30 = Math.max(0, Number(product.sold30 || 0) - item.qty);
        product.sold90 = Math.max(0, Number(product.sold90 || 0) - item.qty);
      }
    });
    const localSale = [...state.sales].reverse().find((entry) => !entry.voided && entry.id?.startsWith("local-"));
    if (localSale) localSale.voided = true;
  }

  state.lastSale = null;
  renderAll();
  showToast(t("toast.saleUndone"));
}

// Idle/session timeout: signs the user out after a period of no interaction
// so an unattended device (e.g. a shared POS terminal) doesn't stay logged
// into a live account indefinitely. Pure client-side, Spark-plan compatible.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;
const IDLE_ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];

function markActivity() {
  state.lastActivityAt = Date.now();
}

function initIdleActivityTracking() {
  IDLE_ACTIVITY_EVENTS.forEach((eventName) => {
    document.addEventListener(eventName, markActivity, { passive: true });
  });
}

async function checkIdleTimeout() {
  if (!state.user || !state.auth) return;
  if (Date.now() - state.lastActivityAt < IDLE_TIMEOUT_MS) return;
  const { signOut } = state.firebaseApi.auth;
  await signOut(state.auth);
  showToast(t("toast.idleSignOut"));
}

function startIdleWatcher() {
  markActivity();
  if (state.idleCheckIntervalId) return;
  state.idleCheckIntervalId = window.setInterval(checkIdleTimeout, IDLE_CHECK_INTERVAL_MS);
}

function stopIdleWatcher() {
  if (state.idleCheckIntervalId) {
    window.clearInterval(state.idleCheckIntervalId);
    state.idleCheckIntervalId = null;
  }
}

// Phase 3: businessOwnerUid is the routing hint set at accept-invite time
// (see proxy/server.js) -- it is NEVER checked for authorization, only used
// to decide which owner's data tree ("users/{businessOwnerUid}/...") this
// signed-in user should read/write. Absence of the claim means this account
// IS the owner, so it routes to its own uid.
//
// forceRefresh matters here: the claim is set server-side via Admin SDK
// after accept-invite's transaction completes, not through anything the
// client's already-cached ID token knows about. A staff member who just
// accepted an invite and lands on index.html in the same session would
// otherwise read a stale token with no claim yet.
// Phase 3: for staff accounts, list queries against products/sales/
// customers/transfers must carry an explicit where("storeId","in",[...])
// clause, because Firestore rejects (not silently filters) any list query
// whose security rule can't be proven for every possible result doc --
// and memberCanAccessStore() is data-dependent (resource.data.storeId), so
// it doesn't qualify for the path-based exemption stores/{storeId} gets.
// Returns null for the owner (no filter -- full unfiltered access is
// correct), or a concrete array of real store IDs for staff, expanding
// the "all" roaming sentinel via a stores-collection read.
// Session cache for the signed-in user's own member doc. Sign-in fans out into
// six-plus resolver calls (role, stores, products, sales, customers,
// transfers), each of which otherwise re-reads the SAME document -- wasteful
// against Spark-plan quota, slower to first paint, and a source of skew if the
// doc changed mid-fan-out. Cleared on sign-out and whenever the uid/owner pair
// changes. This is a read cache only: it never influences authorization, which
// is always re-evaluated server-side by firestore.rules on every request, so a
// revoked member is still cut off immediately regardless of what's cached here.
let memberDocCache = { key: "", promise: null };

function memberCacheKey() {
  return `${state.user?.uid || ""}|${state.businessOwnerUid || ""}`;
}

function clearMemberDocCache() {
  memberDocCache = { key: "", promise: null };
}

function readOwnMemberDoc() {
  const key = memberCacheKey();
  if (memberDocCache.key === key && memberDocCache.promise) return memberDocCache.promise;
  const promise = state.firebaseApi.firestore
    .getDoc(state.firebaseApi.firestore.doc(state.db, "users", state.businessOwnerUid, "members", state.user.uid))
    .catch((error) => {
      // Don't cache a failure -- a transient network error shouldn't pin this
      // account to "no access" for the rest of the session.
      if (memberDocCache.key === key) clearMemberDocCache();
      throw error;
    });
  memberDocCache = { key, promise };
  return promise;
}

// Raw storeIds straight off the member doc: null for the owner (unrestricted),
// otherwise the array as stored, which MAY still contain the "all" sentinel.
// Callers that need real store IDs should use resolveQueryStoreIds(); callers
// that need to know whether the member is roaming should check for "all" here.
async function resolveMemberStoreIds() {
  if (state.user.uid === state.businessOwnerUid) return null;
  try {
    const memberSnap = await readOwnMemberDoc();
    return memberSnap.exists() ? (memberSnap.data().storeIds || []) : [];
  } catch (error) {
    console.warn("Could not resolve staff store access; defaulting to no access.", error);
    return [];
  }
}

// Firestore caps the `in` operator at 30 values.
const FIRESTORE_IN_LIMIT = 30;

async function resolveQueryStoreIds() {
  const memberStoreIdsList = await resolveMemberStoreIds();
  if (memberStoreIdsList === null) return null;

  // A roaming member needs no filter at all. memberCanAccessStore()
  // short-circuits to true on ("all" in ids) without ever reading storeId, so
  // the rule is provable for an unfiltered list and Firestore permits it
  // (covered by the roaming cases in tests/rules-access.test.mjs). Returning
  // null here rather than expanding "all" into every store id also avoids a
  // stores-collection read per subscription, and sidesteps the 30-value `in`
  // limit that would have broken any business with more than 30 branches.
  if (memberStoreIdsList.includes("all")) return null;

  if (memberStoreIdsList.length > FIRESTORE_IN_LIMIT) {
    // Not silently truncated into a wrong-looking-but-plausible result: the
    // member sees their first 30 branches and the console says why. The fix
    // is to give a member this broad "all" instead of enumerating branches.
    console.warn(
      `Member is assigned ${memberStoreIdsList.length} stores but Firestore only allows ${FIRESTORE_IN_LIMIT} in an "in" query; ` +
      `only the first ${FIRESTORE_IN_LIMIT} will load. Assign the "all" store scope instead.`
    );
    return memberStoreIdsList.slice(0, FIRESTORE_IN_LIMIT);
  }
  return memberStoreIdsList;
}

async function resolveBusinessOwnerUid(user) {
  try {
    const tokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
    const claimOwnerUid = tokenResult.claims?.businessOwnerUid;
    return typeof claimOwnerUid === "string" && claimOwnerUid ? claimOwnerUid : user.uid;
  } catch (error) {
    console.warn("Could not resolve business owner uid; defaulting to own uid.", error);
    return user.uid;
  }
}

// Phase 4: role-aware UI gating needs the CURRENT user's role, not just the
// owner uid. Defaults to "cashier" (most restrictive) on any lookup failure
// or missing doc -- fails closed in the UI. The real boundary is still
// firestore.rules regardless of what this returns; hiding a button here is
// UX only, per the "hide, don't disable" decision.
async function resolveCurrentUserRole(user, ownerUid) {
  if (user.uid === ownerUid) return "owner";
  try {
    const memberSnap = await readOwnMemberDoc();
    return memberSnap.exists() ? (memberSnap.data().role || "cashier") : "cashier";
  } catch (error) {
    console.warn("Could not resolve current user role; defaulting to cashier.", error);
    return "cashier";
  }
}

function isOwnerRole() {
  return state.currentUserRole === "owner";
}

function isManagerOrOwnerRole() {
  return state.currentUserRole === "owner" || state.currentUserRole === "manager";
}

// Static, owner-only store controls (rules: stores update = isOwner only,
// no manager/cashier branch) -- these aren't re-rendered per snapshot like
// table rows, so they need their own visibility pass, called from renderAll().
function applyStoreOwnerControlsVisibility() {
  const ownerOnly = isOwnerRole();
  [
    "renameStoreButton", "setBusinessTypeButton", "setCurrencyButton", "archiveStoreButton", "overridePasswordSettingsButton",
    // Whole-business data export (downloadBackupButton), legacy cashier-name
    // list writes (add/removeStaffButton -- reads stay open to manager/
    // cashier per the staff/{staffId} rule, only writes are owner-only), and
    // monthlyReports generation (no manager/cashier branch in the rules at
    // all, and a non-owner click would still trigger a billed AI proxy call
    // before Firestore ever rejected the write).
    "downloadBackupButton", "addStaffButton", "removeStaffButton", "generateMonthlyReportButton"
  ].forEach((id) => {
    const el = qs(`#${id}`);
    if (el) el.hidden = !ownerOnly;
  });
}

async function initFirebase() {
  const hasConfig = firebaseConfig && !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
  if (!hasConfig) return;

  try {
    const appApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const authApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    const firestoreApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    state.firebaseApi = { app: appApi, auth: authApi, firestore: firestoreApi };

    const app = appApi.initializeApp(firebaseConfig);

    try {
      if (typeof window.process === "undefined") {
        window.process = { env: {} };
      }
      const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js");
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider("6LdtGFEtAAAAABK4HX_ufjUMskc7pix12Lz2NMGd"),
        isTokenAutoRefreshEnabled: true
      });
    } catch (appCheckError) {
      console.warn("App Check failed to initialize; continuing without it.", appCheckError);
    }

    state.auth = authApi.getAuth(app);
    try {
      state.db = firestoreApi.initializeFirestore(app, {
        localCache: firestoreApi.persistentLocalCache({
          tabManager: firestoreApi.persistentMultipleTabManager()
        })
      });
    } catch (persistenceError) {
      console.warn("Firestore offline persistence unavailable; falling back to in-memory cache.", persistenceError);
      state.db = firestoreApi.getFirestore(app);
    }
    state.firebaseReady = true;
    qs(".status-dot").classList.add("connected");
    qs("#connectionLabel").textContent = t("connection.firebaseConnected");
    qs("#connectionHint").textContent = t("connection.createAccountToBegin");

    authApi.onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      if (user) {
        try {
          await user.reload();
        } catch (reloadError) {
          console.warn("Could not refresh email verification status:", reloadError);
        }
      }
      updateAuthUi();
      if (user) {
        clearMemberDocCache();
        state.businessOwnerUid = await resolveBusinessOwnerUid(user);
        state.currentUserRole = await resolveCurrentUserRole(user, state.businessOwnerUid);
        updateAuthUi();
        renderAll();
        startIdleWatcher();
        await ensureUserProfile(user);
        await loadUserSettings(user);
        state.pendingBusinessName = "";
        subscribeToProducts();
        subscribeToSales();
        subscribeToStores();
        subscribeToStaff();
        subscribeToMembers();
        subscribeToMonthlyReports();
        subscribeToCustomers();
        subscribeToTransfers();
      } else {
        stopIdleWatcher();
        if (state.unsubscribeProducts) state.unsubscribeProducts();
        state.unsubscribeProducts = null;
        if (state.unsubscribeSales) state.unsubscribeSales();
        state.unsubscribeSales = null;
        if (state.unsubscribeStores) state.unsubscribeStores();
        state.unsubscribeStores = null;
        if (state.unsubscribeStaff) state.unsubscribeStaff();
        state.unsubscribeStaff = null;
        if (state.unsubscribeMembers) state.unsubscribeMembers();
        state.unsubscribeMembers = null;
        if (state.unsubscribeMonthlyReports) state.unsubscribeMonthlyReports();
        state.unsubscribeMonthlyReports = null;
        if (state.unsubscribeCustomers) state.unsubscribeCustomers();
        state.unsubscribeCustomers = null;
        if (state.unsubscribeTransfers) state.unsubscribeTransfers();
        state.unsubscribeTransfers = null;
        state.products = [];
        state.cart = [];
        state.sales = [];
        state.stores = [];
        state.staff = [];
        state.members = [];
        state.selectedStaffId = "";
        state.monthlyReports = [];
        state.customers = [];
        state.transfers = [];
        state.currentStoreId = "";
        state.businessOwnerUid = "";
        state.currentUserRole = null;
        state.deletionScheduledFor = null;
        renderDeletionBanner();
        clearMemberDocCache();
        state.productsInitialized = false;
        state.stockAlertQueue = [];
        state.stockAlertPopupOpen = false;
        state.overridePasswordSet = false;
        state.overridePasswordNudgeDismissed = false;
        updateOverridePasswordNudgeVisibility();
        clearDiscount();
        renderAll();
      }
    });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.firebaseConnectionFailed"));
  }
}

async function subscribeToProducts() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeProducts) state.unsubscribeProducts();
  state.productsInitialized = false;
  try {
    const { collection, onSnapshot, query, where } = state.firebaseApi.firestore;
    const productsRef = collection(state.db, "users", state.businessOwnerUid, "products");
    const queryStoreIds = await resolveQueryStoreIds();
    // null = owner, unfiltered access is correct. Empty array = staff with
    // no resolvable store access -- subscribe to nothing rather than send
    // an invalid empty `in` filter (Firestore rejects in:[] outright).
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.products = [];
      state.productsInitialized = true;
      scheduleRenderAll();
      return;
    }
    const productsQuery = queryStoreIds === null ? productsRef : query(productsRef, where("storeId", "in", queryStoreIds));
    state.unsubscribeProducts = onSnapshot(
      productsQuery,
      (snapshot) => {
        const nextProducts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        detectStockAlertCrossings(state.products, nextProducts);
        state.products = nextProducts;
        state.productsInitialized = true;
        scheduleRenderAll();
      },
      (error) => {
        console.error("[products listener]", error.code || error, "queryStoreIds=", queryStoreIds);
        showToast(t("toast.couldNotLoadInventory"));
      }
    );
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadInventory"));
  }
}

async function subscribeToSales() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeSales) state.unsubscribeSales();
  try {
    const { collection, onSnapshot, orderBy, query, limit, where } = state.firebaseApi.firestore;
    const salesRef = collection(state.db, "users", state.businessOwnerUid, "sales");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.sales = [];
      renderPaymentReports();
      return;
    }
    // orderBy + where("in") together need a composite index on
    // (storeId asc, createdAt desc) -- Firestore's console error, if it
    // appears the first time a staff account runs this, includes a direct
    // link to create it; click it once and the query works from then on.
    const salesQuery = queryStoreIds === null
      ? query(salesRef, orderBy("createdAt", "desc"), limit(1000))
      : query(salesRef, where("storeId", "in", queryStoreIds), orderBy("createdAt", "desc"), limit(1000));
    state.unsubscribeSales = onSnapshot(
      salesQuery,
      (snapshot) => {
        state.sales = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        renderPaymentReports();
      },
      (error) => console.error("[sales listener]", error.code || error, "queryStoreIds=", queryStoreIds)
    );
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadSales"));
  }
}

async function ensureDefaultStore() {
  // Owner-only: a staff account seeing zero stores means their storeIds
  // haven't resolved yet or the owner hasn't created any -- either way,
  // a staff account must never create the owner's first store under its
  // own uid (this created a phantom, invisible store during testing).
  if (!state.db || !state.user || state.user.uid !== state.businessOwnerUid) return;
  try {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const storeRef = doc(collection(state.db, "users", state.user.uid, "stores"));
    await setDoc(storeRef, { name: t("store.defaultName"), createdAt: serverTimestamp() });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotCreateFirstStore"));
  }
}

function storeSortKey(store) {
  const createdAt = store?.createdAt;
  if (!createdAt) return 0;
  if (typeof createdAt.toMillis === "function") return createdAt.toMillis();
  if (Number.isFinite(createdAt.seconds)) return createdAt.seconds * 1000;
  const parsed = new Date(createdAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

// Shared post-processing for both the owner/roaming list path and the
// branch-scoped per-document path below.
async function applyStoresSnapshot(nextStores, { canCreateDefault }) {
  state.stores = [...nextStores].sort((a, b) => storeSortKey(a) - storeSortKey(b));
  if (!state.stores.length && canCreateDefault) {
    await ensureDefaultStore();
    return;
  }
  if (!state.currentStoreId || (state.currentStoreId !== "all" && !state.stores.some((store) => store.id === state.currentStoreId))) {
    state.currentStoreId = activeStores()[0]?.id || state.stores[0]?.id || "";
  }
  renderStoreSwitcher();
  scheduleRenderAll();
  translateStaticDom();
}

async function subscribeToStores() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeStores) state.unsubscribeStores();
  try {
    const { collection, doc, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const storesRef = collection(state.db, "users", state.businessOwnerUid, "stores");
    const memberStoreIds = await resolveMemberStoreIds();
    const isOwnerAccount = memberStoreIds === null;
    const isRoamingMember = !isOwnerAccount && memberStoreIds.includes("all");

    // A LIST query cannot bind the {storeId} path wildcard -- Firestore has to
    // prove the rule for every document the query could return, and
    // memberCanAccessStore(userId, storeId) is unprovable with storeId
    // unbound, so a branch-scoped member gets permission-denied on the whole
    // collection (which cascaded into an empty store switcher, an empty POS
    // and "can't see my own branch"). The owner is allowed by isOwner(), and a
    // roaming member is allowed because ("all" in ids) short-circuits true
    // without ever touching storeId -- so only those two may list.
    if (isOwnerAccount || isRoamingMember) {
      const storesQuery = query(storesRef, orderBy("createdAt", "asc"));
      state.unsubscribeStores = onSnapshot(
        storesQuery,
        (snapshot) => {
          applyStoresSnapshot(
            snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
            { canCreateDefault: isOwnerAccount }
          );
        },
        (error) => console.error("[stores listener]", error.code || error)
      );
      return;
    }

    const scopedIds = memberStoreIds.filter((id) => typeof id === "string" && id);
    if (!scopedIds.length) {
      console.warn("[stores] member has no assigned storeIds; nothing to show.");
      await applyStoresSnapshot([], { canCreateDefault: false });
      return;
    }

    // Branch-scoped: one get()-style listener per assigned store. A single-doc
    // read DOES bind {storeId}, so memberCanAccessStore() evaluates concretely
    // and the rule is enforced per document exactly as intended.
    const storeById = new Map();
    const seen = new Set();
    const unsubscribers = scopedIds.map((storeId) =>
      onSnapshot(
        doc(storesRef, storeId),
        (docSnap) => {
          if (docSnap.exists()) storeById.set(storeId, { id: docSnap.id, ...docSnap.data() });
          else storeById.delete(storeId);
          seen.add(storeId);
          // Wait for first response from every assigned store before the first
          // render, so the switcher doesn't flicker through partial states.
          if (seen.size === scopedIds.length) {
            applyStoresSnapshot([...storeById.values()], { canCreateDefault: false });
          }
        },
        (error) => {
          console.error("[stores listener]", storeId, error.code || error);
          seen.add(storeId);
          if (seen.size === scopedIds.length) {
            applyStoresSnapshot([...storeById.values()], { canCreateDefault: false });
          }
        }
      )
    );
    state.unsubscribeStores = () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadStores"));
  }
}

 function promptBusinessTypeSelection(currentKey) {
  const list = BUSINESS_TYPE_OPTIONS
    .map((option, index) => `${index + 1}. ${state.language === "sw" ? option.sw : option.en}`)
    .join("\n");
  const promptText = t("dialog.businessTypePrompt", { list });
  const defaultValue = currentKey ? String(BUSINESS_TYPE_OPTIONS.findIndex((o) => o.key === currentKey) + 1) : "";
  const raw = window.prompt(promptText, defaultValue);
  if (raw === null) return null;
  const index = Number(raw.trim()) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= BUSINESS_TYPE_OPTIONS.length) return null;
  return BUSINESS_TYPE_OPTIONS[index].key;
}

function populateCategorySuggestions() {
  const datalist = qs("#categorySuggestions");
  if (!datalist) return;
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  const templateCategories = CATEGORY_TEMPLATES[store?.businessType] || [];
  const existingCategories = [...new Set(state.products.map((product) => String(product.category || "").trim()).filter(Boolean))];
  const merged = [...new Set([...templateCategories, ...existingCategories])];
  datalist.innerHTML = merged.map((category) => `<option value="${esc(category)}"></option>`).join("");
}

async function setStoreCurrency() {
  if (!state.currentStoreId || state.currentStoreId === "all") return showToast(t("toast.selectSpecificStore"));
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  if (!store) return;
  const raw = window.prompt(t("dialog.currencyCodePrompt"), store.currencyCode || "TZS");
  if (raw === null) return;
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return showToast(t("toast.currencyInvalid"));
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  try {
    const { doc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    const previousCode = store.currencyCode || "";
    await setDoc(doc(state.db, "users", state.user.uid, "stores", store.id), { currencyCode: code }, { merge: true });
    try {
      const auditRef = doc(collection(state.db, "users", state.user.uid, "auditLogs"));
      await setDoc(auditRef, {
        action: "STORE_CURRENCY_CHANGED",
        storeId: store.id,
        previousCode,
        newCode: code,
        uid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });
    } catch (auditError) {
      console.warn(auditError);
    }
    showToast(t("toast.currencySet", { code }));
    renderAll();
    translateStaticDom();
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotRenameStore"));
  }
}

async function setStoreBusinessType() {
  if (!state.currentStoreId || state.currentStoreId === "all") return showToast(t("toast.selectSpecificStore"));
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  if (!store) return;
  const nextType = promptBusinessTypeSelection(store.businessType);
  if (!nextType) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  try {
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid, "stores", store.id), { businessType: nextType }, { merge: true });
    showToast(t("toast.businessTypeSet"));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotRenameStore"));
  }
}
async function createStore() {
  const name = window.prompt(t("dialog.newStoreNamePrompt"));
  if (!name || !name.trim()) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  const businessType = promptBusinessTypeSelection() || "general";
  try {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const storeRef = doc(collection(state.db, "users", state.user.uid, "stores"));
    await setDoc(storeRef, { name: name.trim().slice(0, 60), businessType, createdAt: serverTimestamp() });    state.currentStoreId = storeRef.id;
    showToast(t("toast.storeAdded", { name: name.trim() }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotCreateStore"));
  }
}

async function renameStore() {
  if (!state.currentStoreId || state.currentStoreId === "all") return showToast(t("toast.selectSpecificStore"));
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  if (!store) return;
  const name = window.prompt(t("dialog.renameStorePrompt"), store.name || "");
  if (!name || !name.trim()) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  try {
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid, "stores", store.id), { name: name.trim().slice(0, 60) }, { merge: true });
    showToast(t("toast.storeRenamed", { name: name.trim() }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotRenameStore"));
  }
}

async function archiveStore() {
  if (!state.currentStoreId || state.currentStoreId === "all") return showToast(t("toast.selectSpecificStore"));
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  if (!store) return;
  if (activeStores().length <= 1) return showToast(t("toast.cannotArchiveLastStore"));
  if (!window.confirm(t("dialog.archiveStoreConfirm", { name: store.name || "" }))) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  try {
    const { doc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid, "stores", store.id), { archived: true }, { merge: true });
    try {
      const auditRef = doc(collection(state.db, "users", state.user.uid, "auditLogs"));
      await setDoc(auditRef, {
        action: "STORE_ARCHIVED",
        storeId: store.id,
        name: store.name || "",
        uid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });
    } catch (auditError) {
      console.warn(auditError);
    }
    const nextStore = activeStores().find((item) => item.id !== store.id);
    if (nextStore) switchStore(nextStore.id);
    showToast(t("toast.storeArchived", { name: store.name || "" }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotArchiveStore"));
  }
}

function switchStore(storeId) {
  if (storeId === state.currentStoreId) return;
  state.currentStoreId = storeId;
  state.cart = [];
  state.cartHistory = [];
  clearDiscount();
  renderStoreSwitcher();
  renderAll();
  translateStaticDom();
}

function renderStoreSwitcher() {
  const select = qs("#storeSwitcher");
  if (!select) return;
  const active = activeStores();
  const storeOptions = active.map((store) => `<option value="${store.id}">${esc(store.name || t("storeSwitcher.fallbackName"))}</option>`).join("");
  const allOption = active.length > 1 ? `<option value="all">${t("storeSwitcher.allStores")}</option>` : "";
  select.innerHTML = storeOptions + allOption;
  select.value = state.currentStoreId;
}

function activeStaff() {
  return state.staff.filter((member) => !member.archived);
}

async function subscribeToStaff() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeStaff) state.unsubscribeStaff();
  try {
    const { collection, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const staffQuery = query(collection(state.db, "users", state.businessOwnerUid, "staff"), orderBy("createdAt", "asc"));
    state.unsubscribeStaff = onSnapshot(staffQuery, (snapshot) => {
      state.staff = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      if (!state.selectedStaffId || !activeStaff().some((member) => member.id === state.selectedStaffId)) {
        state.selectedStaffId = activeStaff()[0]?.id || "";
      }
      renderStaffSelect();
      renderStaffOrderLookupSelect();
    });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadStores"));
  }
}

// RBAC roster (Phase 2): reads users/{ownerUid}/members, which is the
// authorization source of truth (see memberDocPath() etc. in
// firestore.rules) -- distinct from the legacy `staff` collection above,
// which is only cashier display names for sale attribution.
async function subscribeToMembers() {
  if (!state.db || !state.user || state.user.uid !== state.businessOwnerUid) return;
  if (state.unsubscribeMembers) state.unsubscribeMembers();
  try {
    const { collection, onSnapshot } = state.firebaseApi.firestore;
    state.unsubscribeMembers = onSnapshot(collection(state.db, "users", state.businessOwnerUid, "members"), (snapshot) => {
      state.members = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderStaffRoster();
    });
  } catch (error) {
    console.warn(error);
  }
}

function renderStaffRoster() {
  const tbody = qs("#staffRosterTable");
  if (!tbody) return;
  tbody.innerHTML = state.members
    .map((member) => {
      const storesLabel = (member.storeIds || []).includes("all")
        ? t("staff.allStoresLabel")
        : (member.storeIds || []).map((id) => state.stores.find((s) => s.id === id)?.name || id).join(", ");
      return `<tr>
        <td>${esc(member.email || "-")}</td>
        <td>${esc(member.role || "-")}</td>
        <td>${esc(storesLabel)}</td>
        <td class="table-actions">
          <button class="ghost-button compact danger" type="button" data-revoke-member="${member.id}">${t("staff.revokeButton")}</button>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="4" class="empty-state">${t("staff.rosterEmpty")}</td></tr>`;
}

// Hard delete, matching the "revocation = hard delete" decision -- no
// proxy call needed since firestore.rules already lets isOwner(userId)
// write/delete any members/{staffUid} doc directly.
async function revokeStaffMember(memberId) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;
  if (!window.confirm(t("staff.revokeConfirm", { email: member.email || "" }))) return;
  try {
    const { doc, deleteDoc } = state.firebaseApi.firestore;
    await deleteDoc(doc(state.db, "users", state.user.uid, "members", memberId));
    showToast(t("staff.revokeSuccess", { email: member.email || "" }));
  } catch (error) {
    console.warn(error);
    showToast(t("staff.revokeFailed"));
  }
}

function openInviteStaffDialog() {
  qs("#inviteStaffEmail").value = "";
  qs("#inviteStaffRole").value = "cashier";
  qs("#inviteStaffAllStores").checked = false;
  const storeList = qs("#inviteStaffStoreList");
  storeList.innerHTML = activeStores()
    .map((store) => `<label class="alert-popup-toggle"><input type="checkbox" class="invite-store-checkbox" value="${store.id}" /> <span>${esc(store.name || t("storeSwitcher.fallbackName"))}</span></label>`)
    .join("");
  qsa(".invite-store-checkbox").forEach((cb) => { cb.disabled = false; });
  setFieldError("inviteStaffError", "");
  qs("#inviteStaffFormSection").hidden = false;
  qs("#inviteStaffResultSection").hidden = true;
  qs("#inviteStaffDialog").showModal();
}

// Calls the proxy's owner-only /api/staff/invite (Phase 2). The proxy
// re-validates storeIds against this owner's real stores collection
// server-side regardless of what this form sends -- this client-side
// check is only for a fast, friendly error, not the actual boundary.
async function sendStaffInvite() {
  const email = qs("#inviteStaffEmail").value.trim().toLowerCase();
  const role = qs("#inviteStaffRole").value;
  const allStores = qs("#inviteStaffAllStores").checked;
  const selectedStoreIds = allStores
    ? ["all"]
    : qsa(".invite-store-checkbox:checked").map((cb) => cb.value);

  setFieldError("inviteStaffError", "");
  if (!AUTH_EMAIL_PATTERN.test(email)) return setFieldError("inviteStaffError", t("staff.inviteEmailInvalid"));
  if (!selectedStoreIds.length) return setFieldError("inviteStaffError", t("staff.inviteStoresRequired"));

  const button = qs("#sendInviteStaffButton");
  button.disabled = true;
  try {
    const token = await state.user.getIdToken();
    const response = await fetch(new URL("/api/staff/invite", aiConfig.proxyUrl), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, role, storeIds: selectedStoreIds })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      setFieldError("inviteStaffError", payload.error || t("staff.inviteFailed"));
      return;
    }
    const roleLabel = role === "manager" ? t("staff.roleManager") : t("staff.roleCashier");
    state.pendingInviteLinkToken = payload.linkToken;
    state.pendingInviteRoleLabel = roleLabel;
    qs("#inviteStaffFormSection").hidden = true;
    qs("#inviteStaffResultSection").hidden = false;
    qs("#inviteStaffResultText").textContent = t("staff.inviteResultText", { email, role: roleLabel });
  } catch (error) {
    console.warn(error);
    setFieldError("inviteStaffError", t("staff.inviteNetworkError"));
  } finally {
    button.disabled = false;
  }
}

function copyInviteLink() {
  const lines = buildStaffInviteTextLines(state.pendingInviteLinkToken, state.pendingInviteRoleLabel);
  const acceptUrlLine = lines.find((line) => line.includes("http")) || lines.join("\n");
  navigator.clipboard.writeText(acceptUrlLine)
    .then(() => showToast(t("staff.linkCopied")))
    .catch(() => showToast(t("staff.copyFailed")));
}

// No destination phone number is known at invite time -- wa.me/?text=...
// with no number opens WhatsApp's own contact picker so the owner chooses
// who to send it to, same idea as the purchase-order and payment-reminder
// WhatsApp flows but without a pre-filled recipient.
function sendInviteWhatsApp() {
  const text = buildStaffInviteTextLines(state.pendingInviteLinkToken, state.pendingInviteRoleLabel).join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

async function addStaffMember() {
  const name = window.prompt(t("dialog.newStaffNamePrompt"));
  if (!name || !name.trim()) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStaff"));
  try {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const staffRef = doc(collection(state.db, "users", state.user.uid, "staff"));
    await setDoc(staffRef, { name: name.trim().slice(0, 80), createdAt: serverTimestamp() });
    state.selectedStaffId = staffRef.id;
    showToast(t("toast.staffAdded", { name: name.trim() }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotAddStaff"));
  }
}

async function removeStaffMember() {
  const member = state.staff.find((item) => item.id === state.selectedStaffId);
  if (!member) return showToast(t("toast.selectStaffFirst"));
  if (!window.confirm(t("dialog.removeStaffConfirm", { name: member.name || "" }))) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStaff"));
  try {
    const { doc, deleteDoc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    await deleteDoc(doc(state.db, "users", state.user.uid, "staff", member.id));
    try {
      const auditRef = doc(collection(state.db, "users", state.user.uid, "auditLogs"));
      await setDoc(auditRef, {
        action: "STAFF_REMOVED",
        staffId: member.id,
        name: member.name || "",
        uid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });
    } catch (auditError) {
      console.warn(auditError);
    }
    state.selectedStaffId = "";
    showToast(t("toast.staffRemoved", { name: member.name || "" }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotRemoveStaff"));
  }
}

function renderStaffSelect() {
  const select = qs("#posStaffSelect");
  if (!select) return;
  const options = activeStaff().map((member) => `<option value="${member.id}">${esc(member.name || "")}</option>`).join("");
  select.innerHTML = options || `<option value="">${t("pos.selectStaffPlaceholder")}</option>`;
  select.value = state.selectedStaffId;
}

async function loadUserSettings(user) {
  if (!state.db) return;
  try {
    const { doc, getDoc } = state.firebaseApi.firestore;
    const snap = await getDoc(doc(state.db, "users", user.uid));
    const data = snap.exists() ? snap.data() : null;
    state.stockAlertPopupEnabled = data && typeof data.stockAlertPopupEnabled === "boolean" ? data.stockAlertPopupEnabled : true;
    state.overridePasswordSet = Boolean(data && data.overridePasswordSet === true);
    state.overridePasswordNudgeDismissed = Boolean(data && data.overridePasswordNudgeDismissed === true);
    // Pick up a pending deletion so an owner signing back in during the grace
    // period is told, rather than silently hitting a frozen tenant.
    const scheduled = data && data.status === "pending_deletion" ? data.deletionScheduledFor : null;
    state.deletionScheduledFor = scheduled?.toMillis?.() ?? (scheduled ? new Date(scheduled).getTime() : null);
  } catch (error) {
    console.warn(error);
    state.stockAlertPopupEnabled = true;
    state.overridePasswordSet = false;
    state.overridePasswordNudgeDismissed = false;
    state.deletionScheduledFor = null;
  }
  const toggle = qs("#stockAlertPopupToggle");
  if (toggle) toggle.checked = state.stockAlertPopupEnabled;
  updateOverridePasswordNudgeVisibility();
  renderDeletionBanner();
}

// Shows a dismissible nudge (below the verify-email banner) prompting the
// business owner to set their own per-account discount/override password
// (Phase 9). Hidden once they've set one, or once they explicitly dismiss it.
function updateOverridePasswordNudgeVisibility() {
  const banner = qs("#overridePasswordNudgeBanner");
  if (!banner) return;
  // Owner-only: staff never own the discount password, and showing this to
  // them (as happened during testing) reads as "set up your own account".
  const isOwner = Boolean(state.user) && state.user.uid === state.businessOwnerUid;
  const shouldShow = isOwner && !state.overridePasswordSet && !state.overridePasswordNudgeDismissed;
  banner.hidden = !shouldShow;
}

async function persistOverridePasswordFlags(patch) {
  if (!state.db || !state.user) return;
  try {
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid), patch, { merge: true });
  } catch (error) {
    console.warn(error);
  }
}

function dismissOverridePasswordNudge() {
  state.overridePasswordNudgeDismissed = true;
  updateOverridePasswordNudgeVisibility();
  persistOverridePasswordFlags({ overridePasswordNudgeDismissed: true });
}

// Reflects first-time creation vs. changing an existing password. A first-time
// owner should be told to create one, not asked to confirm a password they have
// never had.
function applyOverridePasswordDialogMode(isSet) {
  const currentRow = qs("#overridePasswordCurrentRow");
  if (currentRow) currentRow.hidden = !isSet;
  const title = qs("#overridePasswordDialogTitle");
  if (title) title.textContent = t(isSet ? "settings.overridePasswordTitleChange" : "settings.overridePasswordTitleCreate");
  const description = qs("#overridePasswordDescription");
  if (description) description.textContent = t(isSet ? "settings.overridePasswordDescriptionChange" : "settings.overridePasswordDescriptionCreate");
  const saveButton = qs("#saveOverridePasswordButton");
  if (saveButton) saveButton.textContent = t(isSet ? "settings.overridePasswordSaveButton" : "settings.overridePasswordCreateButton");
}

async function openOverridePasswordDialog() {
  if (!state.user) return;
  qs("#overridePasswordCurrentInput").value = "";
  qs("#overridePasswordNewInput").value = "";
  qs("#overridePasswordConfirmInput").value = "";
  qs("#overridePasswordReauthInput").value = "";
  setFieldError("overridePasswordError", "");

  // Open immediately on the locally-known value so the dialog never appears to
  // hang on a cold Render instance, then correct it from the server.
  applyOverridePasswordDialogMode(state.overridePasswordSet);
  qs("#overridePasswordDialog").showModal();

  // The server is the only thing that actually knows whether a hash exists.
  // users/{uid}.overridePasswordSet is a client-written mirror and can drift
  // from private/security -- when it wrongly said "set", the current-password
  // field appeared and its client-side required-check blocked submission
  // outright, so a first-time owner could never create a password.
  try {
    const token = await state.user.getIdToken();
    const response = await fetch(aiConfig.overridePasswordStatusUrl, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) return;
    const payload = await response.json();
    if (typeof payload?.isSet !== "boolean") return;
    if (payload.isSet !== state.overridePasswordSet) {
      // Re-sync the local mirror so the nudge banner agrees with reality too.
      state.overridePasswordSet = payload.isSet;
      persistOverridePasswordFlags({ overridePasswordSet: payload.isSet });
      updateOverridePasswordNudgeVisibility();
    }
    applyOverridePasswordDialogMode(payload.isSet);
  } catch (error) {
    // Offline or proxy cold-start: leave the optimistic mode in place. The
    // server still enforces the real rule, and the 401 handler in
    // saveOverridePassword() recovers if we guessed wrong.
    console.warn("Could not confirm discount-password status; using local state.", error);
  }
}

// Calls the Render proxy's POST /api/settings/override-password (Phase 9),
// which bcrypt-hashes the password and stores it at this business's own
// users/{uid}/private/security doc via the Admin SDK -- a path
// firestore.rules denies to every client SDK request. See server.js.
//
// Two independent checks gate a discount-password change, since one signed-in
// session isn't proof enough for either "this is the account owner" or "this
// person is authorized to change the discount password specifically":
//   1. Current discount password (server-side, required only if one is
//      already set) -- proves the caller is authorized to change it.
//   2. Firebase re-authentication with the account's login password, same
//      pattern as confirmDeleteAccount() -- proves the account owner is
//      physically present right now, independent of whether their session
//      token is still valid on an unattended device.
async function saveOverridePassword() {
  if (!state.user || !state.auth) return;
  const currentPassword = qs("#overridePasswordCurrentInput").value;
  const password = qs("#overridePasswordNewInput").value;
  const confirmPassword = qs("#overridePasswordConfirmInput").value;
  const accountPassword = qs("#overridePasswordReauthInput").value;

  // Gate on what the user can actually see, not on state.overridePasswordSet.
  // Keying this off the flag meant that if the flag was wrong -- it is a
  // client-written mirror of private/security, which no client can read -- a
  // first-time owner was told to enter a current discount password while the
  // field for it was hidden, and could never submit. Requiring only a visible,
  // empty field makes that failure mode impossible; the server still enforces
  // the real rule, and the 401 handler below recovers if the field was wrongly
  // hidden.
  const currentPasswordVisible = qs("#overridePasswordCurrentRow")?.hidden === false;
  if (currentPasswordVisible && !currentPassword) {
    setFieldError("overridePasswordError", t("settings.overridePasswordCurrentRequired"));
    return;
  }
  if (password.length < 4 || password.length > 64) {
    setFieldError("overridePasswordError", t("settings.overridePasswordTooShort"));
    return;
  }
  if (password !== confirmPassword) {
    setFieldError("overridePasswordError", t("settings.overridePasswordMismatch"));
    return;
  }
  if (!accountPassword) {
    setFieldError("overridePasswordError", t("settings.overridePasswordReauthRequired"));
    return;
  }
  setFieldError("overridePasswordError", "");

  const saveButton = qs("#saveOverridePasswordButton");
  saveButton.disabled = true;
  try {
    const { EmailAuthProvider, reauthenticateWithCredential } = state.firebaseApi.auth;
    const credential = EmailAuthProvider.credential(state.user.email, accountPassword);
    await reauthenticateWithCredential(state.user, credential);

    const token = await state.user.getIdToken(/* forceRefresh */ true);
    const response = await fetch(aiConfig.overridePasswordUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ password, oldPassword: currentPassword })
    });
    if (response.status === 401) {
      // The account owner is confirmed (reauth above succeeded) but the
      // current discount password didn't match what's on file.
      //
      // If the current-password field was hidden, our status check was wrong
      // (offline, or a cold proxy) and a hash does exist after all. Reveal the
      // field and re-sync rather than leaving a 401 the user cannot act on.
      const currentRow = qs("#overridePasswordCurrentRow");
      if (currentRow?.hidden) {
        state.overridePasswordSet = true;
        persistOverridePasswordFlags({ overridePasswordSet: true });
        applyOverridePasswordDialogMode(true);
        setFieldError("overridePasswordError", t("settings.overridePasswordCurrentNowRequired"));
        return;
      }
      setFieldError("overridePasswordError", t("settings.overridePasswordCurrentIncorrect"));
      return;
    }
    if (response.status === 503) {
      // Mirrors verifyOverridePassword()'s 503 handling: distinguishes "not
      // configured" (FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 missing on the
      // proxy) from a real save failure.
      showToast(t("toast.overrideNotConfigured"));
      return;
    }
    if (!response.ok) {
      showToast(t("toast.overridePasswordSaveFailed"));
      return;
    }
    state.overridePasswordSet = true;
    state.overridePasswordNudgeDismissed = true;
    updateOverridePasswordNudgeVisibility();
    persistOverridePasswordFlags({ overridePasswordSet: true, overridePasswordNudgeDismissed: true });
    qs("#overridePasswordDialog").close();
    showToast(t("toast.overridePasswordSaved"));
  } catch (error) {
    console.warn(error);
    if (error.code === "auth/invalid-credential" || error.code === "auth/wrong-password") {
      setFieldError("overridePasswordError", t("settings.overridePasswordReauthFailed"));
    } else {
      showToast(t("toast.overrideNetworkError"));
    }
  } finally {
    saveButton.disabled = false;
  }
}

async function setStockAlertPopupEnabled(enabled) {
  state.stockAlertPopupEnabled = enabled;
  if (!state.db || !state.user) return;
  try {
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid), { stockAlertPopupEnabled: enabled }, { merge: true });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotSaveAlertSetting"));
  }
}

async function ensureUserProfile(user) {
  if (!state.db) return;
  const businessName = state.pendingBusinessName || user.displayName || "";
  const cached = state.user?.uid === user.uid ? state.cachedProfile : null;
  const unchanged = cached
    && cached.email === (user.email || "")
    && cached.businessName === businessName;
  if (unchanged) return;

  try {
    const { doc, getDoc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const consentPayload = state.pendingConsent
      ? { legalConsent: { ...state.pendingConsent, acceptedAt: serverTimestamp() } }
      : {};

    // This doc is the user's OWN profile (settings, consent record) and is
    // never an authorization source -- role and store access live in
    // users/{ownerUid}/members/{staffUid} and are resolved server-side by
    // firestore.rules. It used to hardcode role:"Owner" for everyone, so every
    // cashier and manager carried a profile claiming ownership. Nothing reads
    // it for access decisions today, but it is exactly the sort of stale field
    // a later change would trust by mistake.
    //
    // role is written ONLY on first creation: the users/{userId} update rule
    // requires request.resource.data.role == resource.data.role, so sending a
    // corrected role for an existing profile would be denied and would take
    // the rest of this write (including the consent record) down with it.
    const profileRef = doc(state.db, "users", user.uid);
    const existing = await getDoc(profileRef).catch(() => null);
    const isBusinessOwner = !state.businessOwnerUid || user.uid === state.businessOwnerUid;
    const rolePayload = existing?.exists() ? {} : { role: isBusinessOwner ? "Owner" : "Staff" };

    await setDoc(profileRef, {
      uid: user.uid,
      email: user.email || "",
      businessName,
      ...rolePayload,
      authProvider: "password",
      updatedAt: serverTimestamp(),
      ...consentPayload
    }, { merge: true });
    state.cachedProfile = { email: user.email || "", businessName };
    state.pendingConsent = null;
  } catch (error) {
    console.warn(error);
  }
}

function updateAuthUi() {
  const signedIn = Boolean(state.user);
  qs("#authGate").classList.toggle("hidden", signedIn);
  qs("#accountChip").hidden = !signedIn;
  qs("#userEmail").textContent = state.user?.email || t("connection.signedInFallback");
  qs("#connectionHint").textContent = signedIn ? t("connection.inventorySyncing") : t("sidebar.connectionHintSignedOut");
  qs("#verifyBanner").hidden = !signedIn || Boolean(state.user?.emailVerified);
  // Staff invites/roster are owner-only actions -- the members collection
  // read is owner-only in firestore.rules (a collection-level query can't
  // be scoped to "just my own doc" the way a single get() can), so showing
  // this button to staff would both mislead them and hit a denied query.
  const isOwner = signedIn && state.user.uid === state.businessOwnerUid;
  const rosterButton = qs("#staffRosterButton");
  if (rosterButton) rosterButton.hidden = !isOwner;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";
  qs("#authSubmitButton").textContent = isSignup ? t("auth.createAccount") : t("auth.signIn");
  qs("#authModeButton").textContent = isSignup ? t("auth.haveAccount") : t("auth.newAccount");
  qs("#businessName").closest("label").hidden = !isSignup;
  qs("#authPassword").autocomplete = isSignup ? "new-password" : "current-password";
  const consentRow = qs("#authConsentRow");
  if (consentRow) {
    consentRow.hidden = !isSignup;
    qs("#authConsent").required = isSignup;
  }
  const confirmPasswordRow = qs("#authConfirmPasswordRow");
  if (confirmPasswordRow) {
    confirmPasswordRow.hidden = !isSignup;
    qs("#authConfirmPassword").required = isSignup;
    if (!isSignup) qs("#authConfirmPassword").value = "";
  }
  clearAuthFieldErrors();
}

const LEGAL_DOC_VERSION = "2026-07-15";

async function checkAuthAttemptLimit(email) {
  const response = await fetch(new URL("/api/auth/check-limit", aiConfig.proxyUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  if (response.status === 429) {
    const error = new Error("Too many authentication attempts.");
    error.code = "auth/too-many-requests";
    throw error;
  }
  if (!response.ok) {
    const error = new Error("Authentication protection is unavailable.");
    error.code = "auth/network-request-failed";
    throw error;
  }
}

const AUTH_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setFieldError(fieldId, message) {
  const el = qs(`#${fieldId}`);
  if (el) el.textContent = message || "";
}

function clearAuthFieldErrors() {
  qsa(".field-error").forEach((el) => { el.textContent = ""; });
}

function validateAuthEmail() {
  const value = qs("#authEmail").value.trim();
  if (!value) {
    setFieldError("authEmailError", t("auth.errorRequired"));
    return false;
  }
  if (!AUTH_EMAIL_PATTERN.test(value)) {
    setFieldError("authEmailError", t("auth.errorEmailInvalid"));
    return false;
  }
  setFieldError("authEmailError", "");
  return true;
}

function validateAuthPassword() {
  const value = qs("#authPassword").value;
  if (!value) {
    setFieldError("authPasswordError", t("auth.errorRequired"));
    return false;
  }
  if (value.length < 6) {
    setFieldError("authPasswordError", t("auth.errorPasswordShort"));
    return false;
  }
  setFieldError("authPasswordError", "");
  return true;
}

function validateAuthConfirmPassword() {
  if (state.authMode !== "signup") return true;
  const password = qs("#authPassword").value;
  const confirm = qs("#authConfirmPassword").value;
  if (!confirm) {
    setFieldError("authConfirmPasswordError", t("auth.errorRequired"));
    return false;
  }
  if (password !== confirm) {
    setFieldError("authConfirmPasswordError", t("auth.errorPasswordMismatch"));
    return false;
  }
  setFieldError("authConfirmPasswordError", "");
  return true;
}

function validateAuthConsent() {
  if (state.authMode !== "signup") return true;
  const checked = qs("#authConsent").checked;
  setFieldError("authConsentError", checked ? "" : t("auth.errorConsentRequired"));
  return checked;
}

function validateAuthForm() {
  const validEmail = validateAuthEmail();
  const validPassword = validateAuthPassword();
  const validConfirm = validateAuthConfirmPassword();
  const validConsent = validateAuthConsent();
  return validEmail && validPassword && validConfirm && validConsent;
}

async function handleForgotPassword() {
  if (!state.auth) return showToast(t("toast.firebaseNotConnected"));
  if (!validateAuthEmail()) return;
  const email = qs("#authEmail").value.trim();
  const button = qs("#authForgotPasswordButton");
  button.disabled = true;
  try {
    await state.firebaseApi.auth.sendPasswordResetEmail(state.auth, email);
  } catch (error) {
    console.warn(error);
    // Deliberately do not reveal whether the account exists (prevents
    // account enumeration) — only surface genuine client-side problems.
    if (error.code === "auth/too-many-requests") {
      showToast(t("toast.authTooManyRequests"));
      button.disabled = false;
      return;
    }
  }
  showToast(t("toast.passwordResetSent"));
  button.disabled = false;
}

async function handleResendVerification() {
  if (!state.auth || !state.user) return;
  const button = qs("#resendVerificationButton");
  button.disabled = true;
  try {
    await state.firebaseApi.auth.sendEmailVerification(state.user);
    showToast(t("toast.verificationEmailSent"));
  } catch (error) {
    console.warn(error);
    showToast(error.code === "auth/too-many-requests" ? t("toast.authTooManyRequests") : t("toast.verificationEmailFailed"));
  } finally {
    button.disabled = false;
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.auth) return showToast(t("toast.firebaseNotConnected"));

  if (!validateAuthForm()) return;

  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const businessName = String(form.get("businessName") || "").trim();

  const submitButton = qs("#authSubmitButton");
  submitButton.disabled = true;

  try {
    await checkAuthAttemptLimit(email);
    const authApi = state.firebaseApi.auth;
    if (state.authMode === "signup") {
      state.pendingBusinessName = businessName;
      state.pendingConsent = { accepted: true, version: LEGAL_DOC_VERSION, acceptedAt: new Date().toISOString() };
      const credential = await authApi.createUserWithEmailAndPassword(state.auth, email, password);
      if (businessName) await authApi.updateProfile(credential.user, { displayName: businessName });
      try {
        await authApi.sendEmailVerification(credential.user);
      } catch (verificationError) {
        console.warn("Could not send verification email:", verificationError);
      }
      showToast(t("toast.accountCreated"));
    } else {
      state.pendingBusinessName = "";
      await authApi.signInWithEmailAndPassword(state.auth, email, password);
      showToast(t("toast.signedIn"));
    }
  } catch (error) {
    console.warn(error);
    const fieldErrorKeys = {
      "auth/email-already-in-use": "toast.authEmailInUse",
      "auth/invalid-credential": "toast.authInvalidCredential",
      "auth/weak-password": "toast.authWeakPassword"
    };
    if (error.code === "auth/too-many-requests") {
      showToast(t("toast.authTooManyRequests"));
    } else if (fieldErrorKeys[error.code]) {
      setFieldError("authEmailError", t(fieldErrorKeys[error.code]));
    } else {
      showToast(t(error.code === "auth/operation-not-allowed" ? "toast.authOperationNotAllowed" : "toast.authFailedGeneric"));
    }
  } finally {
    submitButton.disabled = false;
  }
}

// Render's free-tier proxy spins down after ~15 min idle and can take up to a
// minute to wake on the next request (this is what AI_PROXY_TIMEOUT_MS=60000
// above is sized for). Firing a harmless /health ping the moment the user opens
// Reports or AI Advisor gives the proxy a head start before they actually click
// Generate Report / Ask AI, instead of the full cold-start delay landing on
// that click. Best-effort only — failures are ignored, this never blocks the UI.
function warmUpAiProxy() {
  if (aiProxyWarmupTriggered || !aiConfig.proxyUrl) return;
  aiProxyWarmupTriggered = true;
  fetch(new URL("/health", aiConfig.proxyUrl)).catch(() => {});
}

// A cashier works the till: POS to sell, Inventory to restock -- the two
// surfaces whose writes the rules actually permit them. Dashboard, Reports and
// AI Advisor are whole-business performance views (revenue, per-staff sales
// breakdowns, advisory analysis); a till operator has no operational need for
// them and shouldn't see other staff members' numbers, so they're hidden
// rather than shown-and-denied.
const CASHIER_ALLOWED_VIEWS = ["inventory", "pos"];

function canOpenView(viewId) {
  return isManagerOrOwnerRole() || CASHIER_ALLOWED_VIEWS.includes(viewId);
}

function applyRoleViewVisibility() {
  qsa(".nav-item").forEach((item) => {
    item.hidden = !canOpenView(item.dataset.view);
  });
  // Only redirect once the role has actually resolved. While it's still null
  // the nav stays hidden (fail closed, harmless), but redirecting here would
  // strand an owner on the POS tab after their real role arrives.
  if (!state.currentUserRole) return;
  const activeView = qs(".view.active");
  if (activeView && !canOpenView(activeView.id)) openView("pos");
}

function openView(viewId) {
  // Guarded, not just hidden: the command palette and any stale click handler
  // route through here too, so this is the single choke point.
  if (!canOpenView(viewId)) return;
  qsa(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  qsa(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  qs(".sidebar").classList.remove("open");
  if (viewId === "reports" || viewId === "ai") warmUpAiProxy();
}

function renderCommands(term = "") {
  const commands = [
    ["dashboard", t("command.openDashboard")],
    ["inventory", t("command.openInventory")],
    ["pos", t("command.openPos")],
    ["reports", t("command.openReports")],
    ["ai", t("command.openAi")]
  ]
    .filter(([view]) => canOpenView(view))
    .filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()));

  qs("#commandResults").innerHTML = commands
    .map(([view, label]) => `<div class="command-result" data-command-view="${view}">${label}</div>`)
    .join("");
}

function renderAll() {
  applyStoreOwnerControlsVisibility();
  applyRoleViewVisibility();
  renderFilters();
  renderKpis();
  renderChart();
  renderAlertsAndRecommendations();
  renderMovement();
  renderInventory();
  renderPos();
  renderCards();
  renderPaymentReports();
  renderAiQuestionSuggestions();
}

// Firestore may deliver several initial snapshots in the same event loop.
// Rendering once per frame keeps large inventories responsive while preserving
// the immediate rendering used by direct user interactions.
function scheduleRenderAll() {
  if (scheduledRenderFrame !== null) return;
  scheduledRenderFrame = window.requestAnimationFrame(() => {
    scheduledRenderFrame = null;
    renderAll();
  });
}

function bindEvents() {
  qsa(".nav-item").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  qs("#mobileMenuButton").addEventListener("click", () => qs(".sidebar").classList.toggle("open"));
  qs("#themeButton").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "" : "light";
    document.documentElement.dataset.theme = nextTheme;
    qs("#themeButton").textContent = nextTheme === "light" ? t("theme.dark") : t("theme.light");
    renderChart();
    renderRevenueChart();
  });
  qs("#chartRange").addEventListener("change", renderChart);
  qs("#globalSearch").addEventListener("input", debounce(renderInventory, 250));
  qs("#categoryFilter").addEventListener("change", renderInventory);
  qs("#stockFilter").addEventListener("change", renderInventory);
  qs("#posSearch").addEventListener("input", debounce(renderPosProducts, 250));
  qs("#undoCartButton").addEventListener("click", undoLastCartAction);
  qs("#clearCartButton").addEventListener("click", () => {
    if (!state.cart.length) return;
    pushCartHistory();
    state.cart = [];
    clearDiscount();
    renderCart();
  });
  qs("#applyDiscountButton")?.addEventListener("click", applyDiscount);
  qs("#clearDiscountButton")?.addEventListener("click", clearDiscountAndRender);
  qs("#discountTypeSelect")?.addEventListener("change", (event) => {
    const discountValueRow = qs("#discountValueRow");
    if (discountValueRow) discountValueRow.hidden = event.target.value === "none";
    if (event.target.value === "none") clearDiscountAndRender();
  });
  qs("#cashTendered").addEventListener("input", renderCart);
  qs("#undoSaleButton").addEventListener("click", undoLastSale);
  qs("#exportInventoryButton").addEventListener("click", exportCsv);
  qs("#downloadBackupButton")?.addEventListener("click", downloadAccountBackup);
  qs("#salesRangePreset").addEventListener("change", (event) => {
    state.salesRangePreset = event.target.value;
    qs("#salesRangeCustom").hidden = state.salesRangePreset !== "custom";
    renderPaymentReports();
  });
  qs("#salesRangeFrom").addEventListener("change", (event) => {
    state.salesRangeFrom = event.target.value;
    renderPaymentReports();
  });
  qs("#salesRangeTo").addEventListener("change", (event) => {
    state.salesRangeTo = event.target.value;
    renderPaymentReports();
  });
  qs("#exportPaymentCsvButton").addEventListener("click", exportPaymentReportCsv);
  qs("#exportPaymentPdfButton").addEventListener("click", exportPaymentReportPdf);
  const monthlyReportMonthInput = qs("#monthlyReportMonth");
  if (monthlyReportMonthInput) {
    monthlyReportMonthInput.value = state.reportMonthSelection;
    monthlyReportMonthInput.addEventListener("change", (event) => {
      state.reportMonthSelection = event.target.value || state.reportMonthSelection;
    });
  }
  qs("#generateMonthlyReportButton")?.addEventListener("click", () => generateMonthlyReport(state.reportMonthSelection));
  qs("#closeMonthlyReportDialog")?.addEventListener("click", () => qs("#monthlyReportDialog").close());
  qs("#closeMonthlyReportDialogBottom")?.addEventListener("click", () => qs("#monthlyReportDialog").close());
  qs("#exportMonthlyReportPdfButton")?.addEventListener("click", exportMonthlyReportPdf);
  qs("#storeSwitcher").addEventListener("change", (event) => switchStore(event.target.value));
  qs("#addStoreButton").addEventListener("click", createStore);
  qs("#renameStoreButton")?.addEventListener("click", renameStore);
  qs("#archiveStoreButton")?.addEventListener("click", archiveStore);
  qs("#setBusinessTypeButton")?.addEventListener("click", setStoreBusinessType);
  qs("#setCurrencyButton")?.addEventListener("click", setStoreCurrency);
  qs("#posStaffSelect")?.addEventListener("change", (event) => {
    state.selectedStaffId = event.target.value;
  });
  qs("#addStaffButton")?.addEventListener("click", addStaffMember);
  qs("#removeStaffButton")?.addEventListener("click", removeStaffMember);
  qs("#staffRosterButton")?.addEventListener("click", () => { renderStaffRoster(); qs("#staffRosterDialog").showModal(); });
  qs("#closeStaffRosterDialog")?.addEventListener("click", () => qs("#staffRosterDialog").close());
  qs("#openInviteStaffButton")?.addEventListener("click", openInviteStaffDialog);
  qs("#closeInviteStaffDialog")?.addEventListener("click", () => qs("#inviteStaffDialog").close());
  qs("#cancelInviteStaffDialog")?.addEventListener("click", () => qs("#inviteStaffDialog").close());
  qs("#sendInviteStaffButton")?.addEventListener("click", sendStaffInvite);
  qs("#doneInviteStaffDialog")?.addEventListener("click", () => qs("#inviteStaffDialog").close());
  qs("#copyInviteLinkButton")?.addEventListener("click", copyInviteLink);
  qs("#sendInviteWhatsAppButton")?.addEventListener("click", sendInviteWhatsApp);
  qs("#inviteStaffAllStores")?.addEventListener("change", (event) => {
    qsa(".invite-store-checkbox").forEach((cb) => { cb.disabled = event.target.checked; });
  });
  qs("#orderNumberSearch")?.addEventListener("input", debounce(searchOrderNumber, 250));
  qs("#staffOrderLookupStaff")?.addEventListener("change", renderStaffOrderNumberOptions);
  qs("#staffOrderLookupDateFrom")?.addEventListener("change", renderStaffOrderNumberOptions);
  qs("#staffOrderLookupDateTo")?.addEventListener("change", renderStaffOrderNumberOptions);
  qs("#staffOrderLookupButton")?.addEventListener("click", renderStaffOrderLookupResult);
  qs("#staffOrderLookupAllButton")?.addEventListener("click", renderStaffAllOrdersResult);
  qs("#dailyStaffReportButton")?.addEventListener("click", renderDailyStaffReport);
  qs("#langToggleButton").addEventListener("click", () => setLanguage(state.language === "en" ? "sw" : "en"));
  qs("#stockAlertPopupToggle").addEventListener("change", (event) => setStockAlertPopupEnabled(event.target.checked));
  qs("#stockAlertPopupClose").addEventListener("click", closeStockAlertPopup);
  qs("#stockAlertPopupOk").addEventListener("click", closeStockAlertPopup);
  qs("#stockAlertDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeStockAlertPopup();
  });
  qs("#newProductButton").addEventListener("click", () => openProductDialog());
  qs("#inventoryAddButton").addEventListener("click", () => openProductDialog());
  qs("#closeProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#cancelProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#closeTransferDialog")?.addEventListener("click", () => qs("#transferDialog").close());
  qs("#cancelTransferDialog")?.addEventListener("click", () => qs("#transferDialog").close());
  qs("#confirmTransferButton")?.addEventListener("click", confirmTransfer);
  qs("#closeRestockDialog")?.addEventListener("click", () => qs("#restockDialog").close());
  qs("#cancelRestockDialog")?.addEventListener("click", () => qs("#restockDialog").close());
  qs("#confirmRestockButton")?.addEventListener("click", confirmRestock);
  qs("#closeReturnDialog")?.addEventListener("click", () => qs("#returnDialog").close());
  qs("#cancelReturnDialog")?.addEventListener("click", () => qs("#returnDialog").close());
  qs("#confirmReturnButton")?.addEventListener("click", confirmProcessReturn);
  qs("#closeProductMovementDialog")?.addEventListener("click", () => qs("#productMovementDialog").close());
  qs("#doneProductMovementDialog")?.addEventListener("click", () => qs("#productMovementDialog").close());
  qs("#generatePoButton")?.addEventListener("click", openPurchaseOrderDialog);
  qs("#closePurchaseOrderDialog")?.addEventListener("click", () => qs("#purchaseOrderDialog").close());
  qs("#donePurchaseOrderDialog")?.addEventListener("click", () => qs("#purchaseOrderDialog").close());
  qs("#closePaymentDialog")?.addEventListener("click", () => qs("#paymentDialog").close());
  qs("#cancelPaymentDialog")?.addEventListener("click", () => qs("#paymentDialog").close());
  qs("#confirmPaymentButton")?.addEventListener("click", confirmRecordPayment);
  qs("#scanProductBarcodeButton")?.addEventListener("click", () => openBarcodeScanner("product"));
  qs("#scanPosBarcodeButton")?.addEventListener("click", () => openBarcodeScanner("pos"));
  qs("#closeBarcodeScannerDialog")?.addEventListener("click", closeBarcodeScanner);
  qs("#cancelBarcodeScannerDialog")?.addEventListener("click", closeBarcodeScanner);
  qs("#barcodeScannerDialog")?.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeBarcodeScanner();
  });
  qs("#printReceiptButton")?.addEventListener("click", printReceipt);
  qs("#downloadReceiptPdfButton")?.addEventListener("click", downloadReceiptPdf);
  qs("#shareReceiptWhatsAppButton")?.addEventListener("click", shareReceiptWhatsApp);
  qs("#closeReceiptDialog")?.addEventListener("click", () => qs("#receiptDialog").close());
  qs("#closeReceiptDialogBottom")?.addEventListener("click", () => qs("#receiptDialog").close());
  qs("#askAiButton").addEventListener("click", askAi);
  qs("#clearChatButton").addEventListener("click", () => {
    state.chatHistory = [];
    renderChatLog();
  });
  qs("#aiQuestion").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askAi();
    }
  });
  qs("#authForm").addEventListener("submit", handleAuthSubmit);
  qs("#authEmail").addEventListener("blur", validateAuthEmail);
  qs("#authEmail").addEventListener("input", () => setFieldError("authEmailError", ""));
  qs("#authPassword").addEventListener("blur", validateAuthPassword);
  qs("#authPassword").addEventListener("input", () => {
    setFieldError("authPasswordError", "");
    if (qs("#authConfirmPassword").value) validateAuthConfirmPassword();
  });
  qs("#authConfirmPassword").addEventListener("input", validateAuthConfirmPassword);
  qs("#authConsent").addEventListener("change", validateAuthConsent);
  qs("#authModeButton").addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "signin" : "signup"));
  qs("#authForgotPasswordButton").addEventListener("click", handleForgotPassword);
  qs("#signOutButton").addEventListener("click", async () => {
    if (!state.auth) return;
    const { signOut } = state.firebaseApi.auth;
    await signOut(state.auth);
    showToast(t("toast.signedOut"));
  });
  qs("#resendVerificationButton")?.addEventListener("click", handleResendVerification);
  qs("#overridePasswordSettingsButton")?.addEventListener("click", openOverridePasswordDialog);
  qs("#overridePasswordNudgeSetButton")?.addEventListener("click", openOverridePasswordDialog);
  qs("#overridePasswordNudgeDismissButton")?.addEventListener("click", dismissOverridePasswordNudge);
  qs("#closeOverridePasswordDialog")?.addEventListener("click", () => qs("#overridePasswordDialog").close());
  qs("#cancelOverridePasswordDialog")?.addEventListener("click", () => qs("#overridePasswordDialog").close());
  qs("#saveOverridePasswordButton")?.addEventListener("click", saveOverridePassword);
  qs("#deleteAccountButton")?.addEventListener("click", openDeleteAccountDialog);
  qs("#closeDeleteAccountDialog")?.addEventListener("click", () => qs("#deleteAccountDialog").close());
  qs("#cancelDeleteAccountDialog")?.addEventListener("click", () => qs("#deleteAccountDialog").close());
  qs("#confirmDeleteAccountButton")?.addEventListener("click", confirmDeleteAccount);
  qs("#cancelDeletionButton")?.addEventListener("click", cancelAccountDeletion);

  qsa("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      state.sortDirection = state.sortKey === key ? state.sortDirection * -1 : 1;
      state.sortKey = key;
      renderInventory();
    });
  });

  document.addEventListener("click", async (event) => {
    const questionButton = event.target.closest("[data-question]");
    if (questionButton) {
      qs("#aiQuestion").value = questionButton.dataset.question;
      askAi();
      return;
    }

    const askAiButton = event.target.closest("[data-ask-ai]");
    if (askAiButton) {
      const question = askAiButton.dataset.askAi === "recommendations"
        ? t("dashboard.askAiQuestionRecommendations")
        : t("dashboard.askAiQuestionAlerts");
      openView("ai");
      qs("#aiQuestion").value = question;
      askAi();
      return;
    }

    const cartButton = event.target.closest("[data-add-cart]");
    if (cartButton) {
      const product = state.products.find((item) => item.id === cartButton.dataset.addCart);
      if (!product) return;

      const qtyInput = qs(`[data-qty-input="${product.id}"]`);
      const requestedQty = Math.max(1, Math.floor(Number(qtyInput?.value || 1)));

      let unitPrice;
      let priceInput = null;
      if (product.priceType === "dynamic") {
        priceInput = qs(`[data-price-input="${product.id}"]`);
        const enteredPrice = Number(priceInput?.value || 0);
        if (!enteredPrice || enteredPrice <= 0) return showToast(t("toast.enterPricePerUnit"));
        unitPrice = enteredPrice;
      }

      const result = addProductToCartById(product.id, { qty: requestedQty, unitPrice });
      if (!result?.success) return;
      if (qtyInput) qtyInput.value = 1;
      if (priceInput) priceInput.value = "";
      return;
    }

    const increaseButton = event.target.closest("[data-increase-cart]");
    if (increaseButton) {
      const cartItem = state.cart.find((item) => item.id === increaseButton.dataset.increaseCart);
      const product = state.products.find((item) => item.id === increaseButton.dataset.increaseCart);
      if (cartItem && product) {
        if (cartItem.qty >= product.quantity) return showToast(t("toast.noMoreStock"));
        pushCartHistory();
        cartItem.qty += 1;
        renderCart();
      }
      return;
    }

    const decreaseButton = event.target.closest("[data-decrease-cart]");
    if (decreaseButton) {
      const cartItem = state.cart.find((item) => item.id === decreaseButton.dataset.decreaseCart);
      if (cartItem) {
        pushCartHistory();
        cartItem.qty -= 1;
        if (cartItem.qty <= 0) {
          state.cart = state.cart.filter((item) => item.id !== decreaseButton.dataset.decreaseCart);
        }
        renderCart();
      }
      return;
    }

    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
      pushCartHistory();
      state.cart = state.cart.filter((item) => item.id !== removeButton.dataset.removeCart);
      renderCart();
      return;
    }

    const editPriceButton = event.target.closest("[data-edit-price]");
    if (editPriceButton) {
      const cartItem = state.cart.find((item) => item.id === editPriceButton.dataset.editPrice);
      if (!cartItem) return;
      const authorized = await verifyOverridePassword();
      if (!authorized) return;
      const newPrice = Number(window.prompt(t("dialog.editPricePrompt", { name: cartItem.name, currency: currentCurrencyCode() }), cartItem.sellingPrice));
      if (!Number.isFinite(newPrice) || newPrice < 0) return showToast(t("toast.invalidPrice"));
      pushCartHistory();
      cartItem.sellingPrice = newPrice;
      renderCart();
      return;
    }

    const paymentButton = event.target.closest("[data-payment]");
    if (paymentButton) {
      state.paymentMethod = paymentButton.dataset.payment;
      qsa("[data-payment]").forEach((button) => button.classList.toggle("active", button.dataset.payment === state.paymentMethod));
      const creditRow = qs("#creditAmountPaidRow");
      if (creditRow) creditRow.hidden = state.paymentMethod !== "credit";
      renderCart();
      return;
    }

    const movementTrigger = event.target.closest("[data-view-movement]");
    if (movementTrigger) {
      openProductMovementDialog(movementTrigger.dataset.viewMovement);
      return;
    }

    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      const product = state.products.find((item) => item.id === editButton.dataset.editProduct);
      if (product) openProductDialog(product);
      return;
    }

    const transferButton = event.target.closest("[data-transfer-product]");
    if (transferButton) {
      openTransferDialog(transferButton.dataset.transferProduct);
      return;
    }

    const restockButton = event.target.closest("[data-restock-product]");
    if (restockButton) {
      openRestockDialog(restockButton.dataset.restockProduct);
      return;
    }

    const returnSaleButton = event.target.closest("[data-return-sale]");
    if (returnSaleButton) {
      openReturnDialog(returnSaleButton.dataset.returnSale);
      return;
    }

    const poSendButton = event.target.closest("[data-po-send]");
    if (poSendButton) {
      sendPurchaseOrderWhatsApp(Number(poSendButton.dataset.poSend));
      return;
    }

    const poDownloadButton = event.target.closest("[data-po-download]");
    if (poDownloadButton) {
      downloadPurchaseOrderPdf(Number(poDownloadButton.dataset.poDownload));
      return;
    }

    const poExcludeButton = event.target.closest("[data-po-exclude-group]");
    if (poExcludeButton) {
      excludePurchaseOrderGroup(Number(poExcludeButton.dataset.poExcludeGroup));
      return;
    }

    const recordPaymentButton = event.target.closest("[data-record-payment]");
    if (recordPaymentButton) {
      openRecordPaymentDialog(recordPaymentButton.dataset.recordPayment);
      return;
    }

    const remindButton = event.target.closest("[data-remind-customer]");
    if (remindButton) {
      sendPaymentReminderWhatsApp(remindButton.dataset.remindCustomer);
      return;
    }

    const setLimitButton = event.target.closest("[data-set-credit-limit]");
    if (setLimitButton) {
      setCustomerCreditLimit(setLimitButton.dataset.setCreditLimit);
      return;
    }

    const revokeMemberButton = event.target.closest("[data-revoke-member]");
    if (revokeMemberButton) {
      revokeStaffMember(revokeMemberButton.dataset.revokeMember);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-product]");
    if (deleteButton) {
      deleteProduct(deleteButton.dataset.deleteProduct);
      return;
    }

    const command = event.target.closest("[data-command-view]");
    if (command) {
      openView(command.dataset.commandView);
      qs("#commandPalette").classList.remove("open");
      return;
    }

    const monthlyReportCard = event.target.closest("[data-view-monthly-report]");
    if (monthlyReportCard) {
      openMonthlyReportDetail(monthlyReportCard.dataset.viewMonthlyReport);
      return;
    }

    const reportButton = event.target.closest("[data-generate-report]");
    if (reportButton) {
      generateReport(reportButton.dataset.generateReport);
    }
  });

  document.addEventListener("change", (event) => {
    const qtyEditInput = event.target.closest("[data-qty-edit]");
    if (qtyEditInput) {
      const id = qtyEditInput.dataset.qtyEdit;
      const cartItem = state.cart.find((item) => item.id === id);
      const product = state.products.find((item) => item.id === id);
      if (!cartItem || !product) return;
      const nextQty = Math.max(1, Math.floor(Number(qtyEditInput.value || 1)));
      if (nextQty > product.quantity) {
        showToast(t("toast.onlyUnitsAvailable", { quantity: product.quantity }));
        qtyEditInput.value = cartItem.qty;
        return;
      }
      pushCartHistory();
      cartItem.qty = nextQty;
      renderCart();
    }
  });

  qs("#completeSaleButton").addEventListener("click", async () => {
    if (!state.cart.length) return showToast(t("toast.addProductsFirst"));
    if (state.db && !state.currentStoreId) return showToast(t("toast.loadingStore"));
    if (state.db && state.currentStoreId === "all") return showToast(t("toast.selectStoreBeforeSale"));

    const staffMember = state.staff.find((member) => member.id === state.selectedStaffId);
    if (!staffMember) return showToast(t("toast.selectStaffFirst"));

    const orderNumberRaw = qs("#posOrderNumber")?.value.trim() || "";
    if (!orderNumberRaw) return showToast(t("toast.orderNumberRequired"));
    if (!/^[0-9]+$/.test(orderNumberRaw)) return showToast(t("toast.orderNumberInvalid"));

    const customerName = (qs("#posCustomerName")?.value || "").trim().slice(0, 80);
    const customerPhone = (qs("#posCustomerPhone")?.value || "").trim().slice(0, 20);

    const duplicate = state.sales.find(
      (sale) => !sale.voided && sale.staffId === staffMember.id && String(sale.orderNumber || "") === orderNumberRaw
    );
    if (duplicate) {
      const proceed = window.confirm(t("dialog.duplicateOrderConfirm", { orderNumber: orderNumberRaw, name: staffMember.name || "" }));
      if (!proceed) return;
    }

    const saleItems = state.cart.map((cartItem) => ({
      productId: cartItem.id,
      name: cartItem.name,
      category: cartItem.category || "",
      brand: cartItem.brand || "",
      supplier: cartItem.supplier || "",
      qty: cartItem.qty,
      sellingPrice: Number(cartItem.sellingPrice || 0),
      lineTotal: cartItem.qty * Number(cartItem.sellingPrice || 0)
    }));
    const subtotal = saleItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discountType = state.discountType || "none";
    const discountAmount = computeDiscountAmount(subtotal);
    const total = Math.max(0, subtotal - discountAmount);
    const paymentMethod = state.paymentMethod || "cash";
    const cashTendered = Number(qs("#cashTendered")?.value || 0);

    if (paymentMethod === "cash" && cashTendered < total) {
      showToast(t("toast.cashLessThanTotal"));
      return;
    }
    const changeDue = paymentMethod === "cash" ? Math.max(0, cashTendered - total) : 0;

    let creditPhoneKey = null;
    let creditAmountPaid = 0;
    let creditAmountPaidMethod = "cash";
    let creditBalanceDue = 0;
    if (paymentMethod === "credit") {
      creditPhoneKey = normalizeCustomerPhoneKey(customerPhone);
      if (!creditPhoneKey) return showToast(t("toast.creditNeedsPhone"));
      creditAmountPaid = Number(qs("#creditAmountPaidInput")?.value || 0);
      if (!Number.isFinite(creditAmountPaid) || creditAmountPaid < 0 || creditAmountPaid > total) {
        showToast(t("toast.creditAmountPaidInvalid"));
        return;
      }
      creditAmountPaidMethod = qs("#creditAmountPaidMethod")?.value || "cash";
      creditBalanceDue = Math.max(0, total - creditAmountPaid);
      if (creditBalanceDue > 0 && !checkCreditLimitBeforeSale(customerName, creditPhoneKey, creditBalanceDue)) {
        return;
      }
    }

    if (!staffMember.id || !String(staffMember.name || "").trim() || !/^[0-9]{1,10}$/.test(orderNumberRaw)) {
      showToast(t("toast.saleFailedGeneric"));
      return;
    }

    const completeButton = qs("#completeSaleButton");
    completeButton.disabled = true;

    if (state.db && state.user && state.businessOwnerUid) {
      try {
        const { collection, doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
        // Idempotency: key the sale document deterministically on staffId + the
        // staff-entered order number instead of a random auto-id. A retried
        // submission (flaky network, double-tap after a hang, etc.) for the same
        // order number now resolves to the SAME document path, so Firestore's
        // create-vs-update rule semantics reject the retry instead of silently
        // creating a second sale and double-decrementing stock. If the cashier
        // already confirmed "record again anyway" above (duplicate === true),
        // give that deliberate re-entry its own distinct id so it isn't blocked.
        const dedupeSaleId = `ord_${staffMember.id}_${orderNumberRaw}`;
        const saleId = duplicate ? `${dedupeSaleId}_dup${Date.now()}` : dedupeSaleId;
        const saleRef = doc(state.db, "users", state.businessOwnerUid, "sales", saleId);
        let creditCustomerId = null;
        if (paymentMethod === "credit") {
          creditCustomerId = await findOrCreateCustomerForCredit(customerName, creditPhoneKey);
        }
        const creditCustomerRef = creditCustomerId ? doc(state.db, "users", state.businessOwnerUid, "customers", creditCustomerId) : null;
        await runTransaction(state.db, async (transaction) => {
          const existingSaleSnap = await transaction.get(saleRef);
          if (existingSaleSnap.exists()) {
            throw new Error(t("txerror.duplicateOrderSubmission", { orderNumber: orderNumberRaw }));
          }

          const productRefs = state.cart.map((cartItem) => doc(state.db, "users", state.businessOwnerUid, "products", cartItem.id));
          const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
          const creditCustomerSnap = creditCustomerRef ? await transaction.get(creditCustomerRef) : null;

          productSnaps.forEach((snap, index) => {
            const cartItem = state.cart[index];
            if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: cartItem.name }));
            const currentQuantity = Number(snap.data().quantity || 0);
            if (currentQuantity < cartItem.qty) {
              throw new Error(t("txerror.notEnoughStockItem", { name: cartItem.name, quantity: currentQuantity }));
            }
          });

          productSnaps.forEach((snap, index) => {
            const cartItem = state.cart[index];
            const currentQuantity = Number(snap.data().quantity || 0);
            const currentSold30 = Number(snap.data().sold30 || 0);
            const currentSold90 = Number(snap.data().sold90 || 0);
            transaction.update(productRefs[index], {
              quantity: currentQuantity - cartItem.qty,
              sold30: currentSold30 + cartItem.qty,
              sold90: currentSold90 + cartItem.qty,
              updatedAt: serverTimestamp(),
              movementReason: "sale"
            });
          });

          transaction.set(saleRef, {
            items: saleItems,
            subtotal,
            discountType,
            discountValue: Number(state.discountValue || 0),
            discountAmount,
            total,
            paymentMethod,
            cashTendered: paymentMethod === "cash" ? cashTendered : null,
            changeDue: paymentMethod === "cash" ? changeDue : null,
            customerId: creditCustomerId,
            amountPaid: paymentMethod === "credit" ? creditAmountPaid : null,
            amountPaidMethod: paymentMethod === "credit" ? creditAmountPaidMethod : null,
            balanceDue: paymentMethod === "credit" ? creditBalanceDue : null,
            branchId: state.currentStoreId,
            storeId: state.currentStoreId,
            cashierUid: state.user?.uid || null,
            staffId: staffMember.id,
            staffName: staffMember.name || "",
            orderNumber: orderNumberRaw,
            customerName,
            customerPhone,
            voided: false,
            createdAt: serverTimestamp()
          });

          if (creditCustomerRef && creditCustomerSnap) {
            const currentOwed = Number(creditCustomerSnap.data()?.balanceOwed || 0);
            const customerUpdate = { balanceOwed: currentOwed + creditBalanceDue, updatedAt: serverTimestamp() };
            if (currentOwed <= 0 && creditBalanceDue > 0) customerUpdate.oldestUnpaidAt = serverTimestamp();
            transaction.update(creditCustomerRef, customerUpdate);
          }

          const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
          transaction.set(auditRef, {
            action: "SALE_COMPLETED",
            total,
            paymentMethod,
            itemCount: saleItems.length,
            discountType,
            discountAmount,
            uid: state.user?.uid || null,
            createdAt: serverTimestamp()
          });
        });

        state.lastSale = { mode: "firestore", saleId: saleRef.id, items: saleItems, paymentMethod, total };
      } catch (error) {
        console.warn(error);
        showToast(error.message || t("toast.saleFailedGeneric"));
        completeButton.disabled = false;
        return;
      }
    } else {
      state.cart.forEach((cartItem) => {
        const product = state.products.find((item) => item.id === cartItem.id);
        if (product) {
          product.quantity = Math.max(0, product.quantity - cartItem.qty);
          product.sold30 = Number(product.sold30 || 0) + cartItem.qty;
          product.sold90 = Number(product.sold90 || 0) + cartItem.qty;
        }
      });
      let localCreditCustomerId = null;
      if (paymentMethod === "credit") {
        localCreditCustomerId = await findOrCreateCustomerForCredit(customerName, creditPhoneKey);
        const localCustomer = state.customers.find((c) => c.id === localCreditCustomerId);
        if (localCustomer) {
          const wasZero = Number(localCustomer.balanceOwed || 0) <= 0;
          localCustomer.balanceOwed = Number(localCustomer.balanceOwed || 0) + creditBalanceDue;
          if (wasZero && creditBalanceDue > 0) localCustomer.oldestUnpaidAt = new Date();
        }
      }
      state.sales.push({
        id: `local-${Date.now()}`,
        items: saleItems,
        subtotal,
        discountType,
        discountValue: Number(state.discountValue || 0),
        discountAmount,
        total,
        paymentMethod,
        cashTendered: paymentMethod === "cash" ? cashTendered : null,
        changeDue: paymentMethod === "cash" ? changeDue : null,
        customerId: localCreditCustomerId,
        amountPaid: paymentMethod === "credit" ? creditAmountPaid : null,
        amountPaidMethod: paymentMethod === "credit" ? creditAmountPaidMethod : null,
        balanceDue: paymentMethod === "credit" ? creditBalanceDue : null,
        staffId: staffMember.id,
        staffName: staffMember.name || "",
        orderNumber: orderNumberRaw,
        customerName,
        customerPhone,
        voided: false,
        createdAt: new Date()
      });
      state.lastSale = { mode: "local", items: saleItems, paymentMethod, total };
    }

    openReceiptDialog({
      items: saleItems,
      subtotal,
      discountType,
      discountAmount,
      total,
      paymentMethod,
      cashTendered: paymentMethod === "cash" ? cashTendered : null,
      changeDue: paymentMethod === "cash" ? changeDue : null,
      amountPaid: paymentMethod === "credit" ? creditAmountPaid : null,
      balanceDue: paymentMethod === "credit" ? creditBalanceDue : null,
      staffName: staffMember.name || "",
      orderNumber: orderNumberRaw,
      customerName,
      customerPhone,
      storeId: state.currentStoreId,
      createdAt: new Date()
    });

    state.cart = [];
    state.cartHistory = [];
    clearDiscount();
    if (qs("#cashTendered")) qs("#cashTendered").value = "";
    if (qs("#posOrderNumber")) qs("#posOrderNumber").value = "";
    if (qs("#posCustomerName")) qs("#posCustomerName").value = "";
    if (qs("#posCustomerPhone")) qs("#posCustomerPhone").value = "";
    if (qs("#creditAmountPaidInput")) qs("#creditAmountPaidInput").value = "";
    if (qs("#creditAmountPaidMethod")) qs("#creditAmountPaidMethod").value = "cash";
    renderAll();
    completeButton.disabled = false;
    showToast(changeDue > 0 ? t("toast.saleCompletedChange", { change: money(changeDue) }) : t("toast.saleCompleted"));
  });

  qs("#productForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const product = Object.fromEntries(form.entries());

    const fieldError = validateProductFields(product);
    if (fieldError) {
      showToast(fieldError);
      return;
    }

    const quantity = clampNonNegativeNumber(product.quantity);
    const costPrice = clampNonNegativeNumber(product.costPrice || 0);
    const sellingPrice = clampNonNegativeNumber(product.sellingPrice || 0);
    const reorderLevel = clampNonNegativeNumber(product.reorderLevel || 0);

    if (quantity === null || costPrice === null || sellingPrice === null || reorderLevel === null) {
      showToast(t("toast.quantityPriceInvalid"));
      return;
    }

    product.quantity = quantity;
    product.costPrice = costPrice;
    product.sellingPrice = sellingPrice;
    product.reorderLevel = reorderLevel;
    product.category = String(product.category || "").trim();
    product.sku = product.sku || `${String(product.name || "ITEM").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "ITEM"}-${Date.now().toString().slice(-6)}`;
    product.barcode = product.barcode || "";
    product.description = product.description || "";
    product.warehouse = product.warehouse || "";
    product.shelf = product.shelf || "";
    product.expiryDate = product.expiryDate || "";
    saveProduct(product);
    event.currentTarget.reset();
    qs("#productDialog").close();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      qs("#commandPalette").classList.add("open");
      qs("#commandInput").focus();
      renderCommands();
    }
    if (event.key === "Escape") qs("#commandPalette").classList.remove("open");
  });

  qs("#commandInput").addEventListener("input", (event) => renderCommands(event.target.value));
  qs("#commandPalette").addEventListener("click", (event) => {
    if (event.target.id === "commandPalette") qs("#commandPalette").classList.remove("open");
  });
}

setAuthMode("signup");
bindEvents();
initIdleActivityTracking();
translateStaticDom();
renderAll();
renderChatLog();
initFirebase();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("Service worker registration failed.", error);
    });
  });
}
//When this code was written only God knew if it would work, but it did. I am still in shock.
