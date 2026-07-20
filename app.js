import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";
import { priceConfig } from "./price-config.js";

const state = {
  products: [],
  cart: [],
  paymentMethod: "cash",
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
  pendingTransferProductId: null,
  stockAlertPopupEnabled: true,
  productsInitialized: false,
  stockAlertQueue: [],
  stockAlertPopupOpen: false,
  language: localStorage.getItem("dukasmart:lang") || localStorage.getItem("sanitaryflow:lang") || "en",
  monthlyReports: [],
  unsubscribeMonthlyReports: null,
  reportMonthSelection: new Date().toISOString().slice(0, 7),
  openMonthlyReportId: null
};

const MAX_CHAT_HISTORY = 20;

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
    "reports.orderFoundLabel": "Order #{orderNumber} \u2014 {name}, {date}, {method}, TZS {total}",
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
    "reports.staffOrderLookupNoOrders": "No orders for this staff member on this date.",
    "reports.staffOrderLookupSelectStaffDate": "Select a staff member and date first.",
    "reports.eyebrow": "Business intelligence", "reports.title": "Reports",
    "reports.financialEyebrow": "Financial tracking", "reports.salesTitle": "Sales & Payment Reports",
    "reports.rangeToday": "Today", "reports.rangeWeek": "This week", "reports.rangeMonth": "This month",
    "reports.rangeAll": "All time", "reports.rangeCustom": "Custom range",
    "reports.from": "From", "reports.to": "To", "reports.exportCsv": "Export CSV", "reports.exportPdf": "Export PDF",
    "ai.eyebrow": "Anthropic powered", "ai.title": "AI Business Advisor",
    "ai.questionPlaceholder": "Ask about your inventory, stock levels, sales, or forecasts...",
    "ai.askButton": "Ask AI Advisor", "ai.conversation": "Conversation", "ai.clear": "Clear",
    "product.nameLabel": "Product name", "product.categoryLabel": "Category", "product.brandLabel": "Brand",
    "product.supplierLabel": "Suppliers", "product.quantityLabel": "Quantity",
    "product.priceLabel": "Selling price (TZS)", "product.priceTypeLabel": "Price type",
    "product.priceFixed": "Fixed price", "product.priceDynamic": "Flexible / dynamic price",
    "product.reorderLabel": "Low stock threshold", "product.reorderPlaceholder": "e.g. 10",
    "product.cancel": "Cancel", "product.save": "Save Product",
    "auth.eyebrow": "Account access",
    "auth.copy": "Create an account or sign in to manage your own inventory, stock levels, sales, and AI recommendations.",
    "auth.businessName": "Business name", "auth.email": "Email", "auth.password": "Password",
    "auth.confirmPassword": "Confirm password",
    "auth.consentPrefix": "I agree to the", "auth.consentTerms": "Terms & Conditions",
    "auth.consentAnd": "and", "auth.consentPrivacy": "Privacy Policy", "auth.consentSuffix": ".",
    "stockAlert.title": "Stock Alert", "stockAlert.ok": "OK",
    "command.placeholder": "Type a command or module name",
    "dialog.overridePasswordPrompt": "Enter the price override password:",
    "dialog.newStoreNamePrompt": "New store name (e.g. Mombasa Road Branch):",
    "dialog.businessTypePrompt": "Choose a business type for this store:\n{list}\n\nEnter the number:",
    "dialog.transferDestinationPrompt": "Transfer \"{name}\" to which store?\n{list}\n\nEnter the number:",
    "dialog.transferQuantityPrompt": "How many units of \"{name}\" to transfer? (Available: {quantity})",
    "dialog.transferTitle": "Transfer Stock", "dialog.transferDestinationLabel": "Destination store",
    "dialog.transferQuantityLabel": "Quantity to transfer", "dialog.transferConfirm": "Transfer",
    "dialog.transferProductLabel": "{name} \u2014 {quantity} available at {store}",
    "dialog.deleteConfirm": "Delete {name} from inventory?",
    "dialog.undoSaleConfirm": "Undo the last completed sale? This will restore stock quantities.",
    "dialog.editPricePrompt": "Enter new price for {name} (TZS):",
    "dialog.newStaffNamePrompt": "New staff member's name:",
    "dialog.removeStaffConfirm": "Remove \"{name}\" from staff? Past sales will keep their name on record.",
    "dialog.duplicateOrderConfirm": "Order #{orderNumber} is already recorded for {name}. Record it again anyway?",
    "connection.firebaseConnected": "Firebase connected",
    "connection.createAccountToBegin": "Create an account to begin",
    "connection.inventorySyncing": "Your inventory is syncing",
    "connection.signedInFallback": "Signed in",
    "txerror.sourceProductGone": "Source product no longer exists.",
    "txerror.notEnoughStockTransfer": "Not enough stock to transfer.",
    "txerror.saleNotFound": "Sale record not found; it may already be voided.",
    "txerror.saleAlreadyUndone": "This sale was already undone.",
    "txerror.itemGone": "{name} no longer exists.",
    "txerror.notEnoughStockItem": "Not enough stock for {name}. Only {quantity} left.",
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
    "monthlyReport.revenueLine": "For {period}: TZS {revenue} in revenue across {count} transactions.",
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
    "report.colTotalTZS": "Total (TZS)", "report.colAvgSaleTZS": "Average Sale (TZS)",
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
    "inventory.edit": "Edit", "inventory.transfer": "Transfer", "inventory.delete": "Delete",
    "inventory.emptyState": "No inventory yet. Add your first material or product to start tracking stock.",
    "toast.incorrectPassword": "Incorrect password. Price change cancelled.",
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
    "toast.saleCompletedChange": "Sale completed. Give TZS {change} change.",
    "toast.saleCompleted": "Sale completed and inventory updated.",
    "toast.quantityPriceInvalid": "Quantity and price fields must be zero or positive numbers.",
    "toast.fieldTooLong": "{field} must be {max} characters or fewer."
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
    "reports.orderFoundLabel": "Oda #{orderNumber} \u2014 {name}, {date}, {method}, TZS {total}",
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
    "reports.staffOrderLookupNoOrders": "Hakuna oda za mfanyakazi huyu kwa tarehe hii.",
    "reports.staffOrderLookupSelectStaffDate": "Chagua mfanyakazi na tarehe kwanza.",
    "reports.eyebrow": "Taarifa za biashara", "reports.title": "Ripoti",
    "reports.financialEyebrow": "Ufuatiliaji wa fedha", "reports.salesTitle": "Ripoti za Mauzo na Malipo",
    "reports.rangeToday": "Leo", "reports.rangeWeek": "Wiki hii", "reports.rangeMonth": "Mwezi huu",
    "reports.rangeAll": "Muda wote", "reports.rangeCustom": "Muda maalum",
    "reports.from": "Kutoka", "reports.to": "Hadi", "reports.exportCsv": "Hamisha CSV", "reports.exportPdf": "Hamisha PDF",
    "ai.eyebrow": "Inaendeshwa na Anthropic", "ai.title": "Mshauri wa Biashara wa AI",
    "ai.questionPlaceholder": "Uliza kuhusu hisa, kiwango cha bidhaa, mauzo, au utabiri...",
    "ai.askButton": "Uliza Mshauri wa AI", "ai.conversation": "Mazungumzo", "ai.clear": "Futa",
    "product.nameLabel": "Jina la bidhaa", "product.categoryLabel": "Aina", "product.brandLabel": "Chapa",
    "product.supplierLabel": "Wasambazaji", "product.quantityLabel": "Kiasi",
    "product.priceLabel": "Bei ya kuuza (TZS)", "product.priceTypeLabel": "Aina ya bei",
    "product.priceFixed": "Bei maalum", "product.priceDynamic": "Bei inayobadilika",
    "product.reorderLabel": "Kiwango cha chini cha hisa", "product.reorderPlaceholder": "mfano, 10",
    "product.cancel": "Ghairi", "product.save": "Hifadhi Bidhaa",
    "auth.eyebrow": "Ufikiaji wa akaunti",
    "auth.copy": "Fungua akaunti au ingia ili kusimamia hisa yako, viwango vya bidhaa, mauzo, na mapendekezo ya AI.",
    "auth.businessName": "Jina la biashara", "auth.email": "Barua pepe", "auth.password": "Nenosiri",
    "auth.confirmPassword": "Thibitisha nenosiri",
    "auth.consentPrefix": "Nakubali", "auth.consentTerms": "Sheria na Masharti",
    "auth.consentAnd": "na", "auth.consentPrivacy": "Sera ya Faragha", "auth.consentSuffix": ".",
    "stockAlert.title": "Arifa ya Hisa", "stockAlert.ok": "Sawa",
    "command.placeholder": "Andika amri au jina la sehemu",
    "dialog.overridePasswordPrompt": "Weka nenosiri la kubadilisha bei:",
    "dialog.newStoreNamePrompt": "Jina la duka jipya (mfano, Tawi la Mombasa Road):",
    "dialog.businessTypePrompt": "Chagua aina ya biashara kwa duka hili:\n{list}\n\nWeka nambari:",
    "dialog.transferDestinationPrompt": "Hamisha \"{name}\" kwenda duka gani?\n{list}\n\nWeka nambari:",
    "dialog.transferQuantityPrompt": "Vitengo vingapi vya \"{name}\" kuhamisha? (Vinavyopatikana: {quantity})",
    "dialog.transferTitle": "Hamisha Hisa", "dialog.transferDestinationLabel": "Duka la kupokea",
    "dialog.transferQuantityLabel": "Kiasi cha kuhamisha", "dialog.transferConfirm": "Hamisha",
    "dialog.transferProductLabel": "{name} \u2014 {quantity} zinapatikana katika {store}",
    "dialog.deleteConfirm": "Futa {name} kutoka kwenye hisa?",
    "dialog.undoSaleConfirm": "Tengua mauzo ya mwisho yaliyokamilika? Hii itarejesha kiasi cha hisa.",
    "dialog.editPricePrompt": "Weka bei mpya ya {name} (TZS):",
    "dialog.newStaffNamePrompt": "Jina la mfanyakazi mpya:",
    "dialog.removeStaffConfirm": "Ondoa \"{name}\" kwenye orodha ya wafanyakazi? Mauzo ya awali yatabaki na jina lake.",
    "dialog.duplicateOrderConfirm": "Oda #{orderNumber} tayari imesajiliwa kwa {name}. Uisajili tena?",
    "connection.firebaseConnected": "Firebase imeunganishwa",
    "connection.createAccountToBegin": "Fungua akaunti kuanza",
    "connection.inventorySyncing": "Hisa yako inasawazishwa",
    "connection.signedInFallback": "Umeingia",
    "txerror.sourceProductGone": "Bidhaa chanzi haipo tena.",
    "txerror.notEnoughStockTransfer": "Hisa haitoshi kuhamisha.",
    "txerror.saleNotFound": "Rekodi ya mauzo haikupatikana; huenda tayari imetenguliwa.",
    "txerror.saleAlreadyUndone": "Mauzo haya tayari yametenguliwa.",
    "txerror.itemGone": "{name} haipo tena.",
    "txerror.notEnoughStockItem": "Hisa haitoshi kwa {name}. {quantity} tu zimebaki.",
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
    "monthlyReport.revenueLine": "Kwa {period}: TZS {revenue} mapato kutoka miamala {count}.",
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
    "report.colTotalTZS": "Jumla (TZS)", "report.colAvgSaleTZS": "Wastani wa Mauzo (TZS)",
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
    "inventory.edit": "Hariri", "inventory.transfer": "Hamisha", "inventory.delete": "Futa",
    "inventory.emptyState": "Hakuna hisa bado. Ongeza bidhaa yako ya kwanza kuanza kufuatilia hisa.",
    "toast.incorrectPassword": "Nenosiri si sahihi. Mabadiliko ya bei yamesitishwa.",
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
    "toast.saleCompletedChange": "Mauzo yamekamilika. Toa chenji ya TZS {change}.",
    "toast.saleCompleted": "Mauzo yamekamilika na hisa imesasishwa.",
    "toast.quantityPriceInvalid": "Sehemu za kiasi na bei lazima ziwe sifuri au chanya.",
    "toast.fieldTooLong": "{field} lazima iwe na herufi {max} au chache."
  }
};

function t(key, vars) {
  const template = (DICTIONARY[state.language] && DICTIONARY[state.language][key]) || DICTIONARY.en[key] || key;
  if (!vars) return template;
  return Object.entries(vars).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), template);
}

function translateStaticDom() {
  document.documentElement.lang = state.language;
  qsa("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
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

async function sha256Hex(text) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyOverridePassword() {
  const input = window.prompt(t("dialog.overridePasswordPrompt"));
  if (input === null) return false;
  const hash = await sha256Hex(input);
  if (hash !== priceConfig.overridePasswordHash) {
    showToast(t("toast.incorrectPassword"));
    return false;
  }
  return true;
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
  return state.products.filter((product) => productStoreId(product) === state.currentStoreId);
}

function stockStatus(product) {
  if (product.quantity <= 0) return "out";
  if (product.quantity <= product.reorderLevel) return "low";
  return "healthy";
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
  qs("#alertCount").textContent = risky.length;
  qs("#alertList").innerHTML = risky
    .map((product) => {
      const status = stockStatus(product);
      return `<div class="alert-item ${status === "out" ? "red" : "amber"}">
        <strong>${esc(product.name)}</strong>
        <span class="muted">${status === "out" ? t("inventory.stockOut") : t("alert.belowMinimum", { quantity: product.quantity })}</span>
      </div>`;
    })
    .join("") || `<div class="alert-item"><strong>${t("alert.allClearTitle")}</strong><span class="muted">${t("alert.allClearBody")}</span></div>`;

  const recs = storeProducts()
    .map((product) => ({ product, rec: reorderRecommendation(product) }))
    .filter(({ rec }) => rec.recommendedQty > 0)
    .sort((a, b) => a.rec.daysUntilStockout - b.rec.daysUntilStockout)
    .slice(0, 4);

  qs("#recommendationList").innerHTML = recs
    .map(({ product, rec }) => `<div class="recommendation">
      <strong>${esc(product.name)}</strong>
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
        <td><strong>${esc(product.name)}</strong></td>
        <td>${esc(product.category)}</td>
        <td>${esc(product.brand || "-")}</td>
        <td>${esc(product.supplier || "-")}</td>
        <td>${product.quantity}</td>
        <td><span class="status ${status}">${label}</span></td>
        <td class="table-actions">
          <button class="ghost-button compact" data-edit-product="${product.id}">${t("inventory.edit")}</button>
          ${activeStores().length > 1 ? `<button class="ghost-button compact" data-transfer-product="${product.id}">${t("inventory.transfer")}</button>` : ""}
          <button class="ghost-button compact danger" data-delete-product="${product.id}">${t("inventory.delete")}</button>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="7" class="empty-state">${t("inventory.emptyState")}</td></tr>`;
}

function renderPosProducts() {
  const term = qs("#posSearch").value.trim().toLowerCase();
  const products = storeProducts().filter((product) => !term || [product.name, product.category, product.brand, product.supplier].join(" ").toLowerCase().includes(term));
  qs("#posProducts").innerHTML = products
    .slice(0, 8)
    .map((product) => `<div class="pos-product">
      <strong>${esc(product.name)}</strong>
      <span class="muted">${esc(product.category)} \u2022 ${esc(product.brand || "-")} - TZS ${Number(product.sellingPrice || 0).toLocaleString()} - ${t("pos.available", { quantity: product.quantity })}</span>
      <div class="pos-product-controls">
        <input type="number" min="1" max="${product.quantity}" value="1" class="pos-qty-input" data-qty-input="${product.id}" aria-label="${esc(t("pos.qtyAriaLabel", { name: product.name }))}" />
        ${product.priceType === "dynamic" ? `<input type="number" min="0" step="0.01" class="pos-price-input" data-price-input="${product.id}" placeholder="${esc(t("pos.pricePerUnitPlaceholder"))}" />` : ""}
        <button class="ghost-button compact" data-add-cart="${product.id}" type="button">${t("pos.addButton")}</button>
      </div>
    </div>`)
    .join("");
}

function renderCart() {
  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = state.cart.reduce((sum, item) => sum + item.qty * Number(item.sellingPrice || 0), 0);

  qs("#cartCount").textContent = totalQty;
  qs("#cartItems").innerHTML = state.cart
    .map((item) => {
      const product = state.products.find((p) => p.id === item.id);
      const maxQty = product ? product.quantity : item.qty;
      return `<div class="cart-item">
        <div class="cart-item-info">
          <strong>${esc(item.name)}</strong>
          <span class="muted">TZS ${Number(item.sellingPrice || 0).toLocaleString()} each
            ${item.priceType !== "dynamic" ? `<button class="link-button" data-edit-price="${item.id}" type="button">${t("cart.editPrice")}</button>` : ""}
          </span>
        </div>
        <div class="cart-item-controls">
          <button class="ghost-button compact" data-decrease-cart="${item.id}" type="button" aria-label="${esc(t("cart.decreaseAriaLabel"))}">-</button>
          <input type="number" min="1" max="${maxQty}" value="${item.qty}" class="cart-qty-input" data-qty-edit="${item.id}" aria-label="${esc(t("cart.qtyAriaLabel", { name: item.name }))}" />
          <button class="ghost-button compact" data-increase-cart="${item.id}" type="button" aria-label="${esc(t("cart.increaseAriaLabel"))}">+</button>
          <button class="ghost-button compact danger" data-remove-cart="${item.id}" type="button" aria-label="${esc(t("cart.removeAriaLabel"))}">${t("cart.removeButton")}</button>
        </div>
        <strong class="cart-item-total">TZS ${(item.qty * Number(item.sellingPrice || 0)).toLocaleString()}</strong>
      </div>`;
    })
    .join("") || `<span class="muted">${t("cart.empty")}</span>`;

  qs("#cartTotal").textContent = `TZS ${totalAmount.toLocaleString()}`;

  const cashTenderRow = qs("#cashTenderRow");
  cashTenderRow.hidden = state.paymentMethod !== "cash";
  const tendered = Number(qs("#cashTendered")?.value || 0);
  const change = Math.max(0, tendered - totalAmount);
  qs("#changeDue").textContent = `TZS ${change.toLocaleString()}`;

  const undoCartButton = qs("#undoCartButton");
  if (undoCartButton) undoCartButton.disabled = !state.cartHistory.length;
  const undoSaleButton = qs("#undoSaleButton");
  if (undoSaleButton) undoSaleButton.disabled = !state.lastSale;
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

function computeMethodBreakdown(sales, method) {
  const methodSales = sales.filter((sale) => (sale.paymentMethod || "cash") === method);
  const total = methodSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const count = methodSales.length;
  const average = count ? total / count : 0;

  const itemTotals = new Map();
  methodSales.forEach((sale) => {
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

function localMonthlyReportNarrative(monthKey, metrics) {
  const topLine = metrics.topProducts.length
    ? t("monthlyReport.topProductsLine", { list: metrics.topProducts.map((product) => `${product.name} (${product.qty})`).join(", ") })
    : t("monthlyReport.noTopProducts");
  const lines = [
    t("monthlyReport.revenueLine", { period: monthKey, revenue: Math.round(metrics.revenue).toLocaleString(), count: metrics.transactionCount }),
    topLine,
    t("monthlyReport.stockLine", { low: metrics.lowStockCount, out: metrics.outOfStockCount }),
    t("monthlyReport.localFallbackNote")
  ];
  return lines.join("\n");
}

async function generateMonthlyReportNarrative(monthKey, metrics) {
  if (!aiConfig.proxyUrl) throw new Error(t("txerror.aiNetworkError"));
  const languageName = state.language === "sw" ? "Swahili" : "English";
  const promptLines = [
    `Write a concise monthly business performance summary in ${languageName} for the period ${monthKey}.`,
    `Revenue: TZS ${metrics.revenue}. Transactions: ${metrics.transactionCount}. Average sale: TZS ${Math.round(metrics.avgSale)}. Units sold: ${metrics.unitsSold}.`,
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
        <span class="muted">TZS ${Number(report.metrics?.revenue || 0).toLocaleString()} \u2014 ${Number(report.metrics?.transactionCount || 0)} ${report.metrics?.transactionCount === 1 ? t("report.transaction") : t("report.transactions")}</span>
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
    [t("monthlyReport.detailRevenue"), `TZS ${Number(metrics.revenue || 0).toLocaleString()}`],
    [t("monthlyReport.detailTransactions"), Number(metrics.transactionCount || 0)],
    [t("monthlyReport.detailAvgSale"), `TZS ${Math.round(Number(metrics.avgSale || 0)).toLocaleString()}`],
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
    [t("monthlyReport.detailRevenue"), `TZS ${Number(metrics.revenue || 0).toLocaleString()}`],
    [t("monthlyReport.detailTransactions"), String(Number(metrics.transactionCount || 0))],
    [t("monthlyReport.detailAvgSale"), `TZS ${Math.round(Number(metrics.avgSale || 0)).toLocaleString()}`],
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
  if (!state.db || !state.user) return;
  if (state.unsubscribeMonthlyReports) state.unsubscribeMonthlyReports();
  try {
    const { collection, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const reportsQuery = query(collection(state.db, "users", state.user.uid, "monthlyReports"), orderBy("periodLabel", "desc"));
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

  showToast(t("monthlyReport.generating"));

  let aiSummary;
  try {
    aiSummary = await generateMonthlyReportNarrative(monthKey, metrics);
  } catch (error) {
    console.warn(error);
    aiSummary = localMonthlyReportNarrative(monthKey, metrics);
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
      <strong class="method-total">TZS ${entry.total.toLocaleString()}</strong>
      <span class="muted">${entry.count} ${entry.count === 1 ? t("report.transaction") : t("report.transactions")} - ${t("report.avg")} TZS ${Math.round(entry.average).toLocaleString()}</span>
      <span class="muted">${t("report.topItems")}: ${entry.topItems.join(", ") || t("report.none")}</span>
    </div>`)
    .join("");

  summary.innerHTML = `
    <div class="payment-summary-row"><strong>${t("report.combinedTotal")}</strong><strong>TZS ${grandTotal.toLocaleString()}</strong></div>
    ${breakdown
      .map((entry) => `<div class="payment-summary-row"><span>${paymentMethodLabel(entry.method)} ${t("report.share")}</span><span>${grandTotal ? Math.round((entry.total / grandTotal) * 100) : 0}%</span></div>`)
      .join("")}
    <div class="payment-summary-row"><span>${t("report.totalTransactions")}</span><span>${transactionCount}</span></div>
  `;
  renderStoreBreakdown();
  renderStaffBreakdown();
  renderStaffOrderLookupSelect();
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
    .map(({ store, total, count }) => `<div class="payment-summary-row"><span>${esc(store.name || "Store")}</span><span>TZS ${total.toLocaleString()} (${count})</span></div>`)
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
    const amount = Number(sale.total || 0);
    if (method === "cash") entry.cash += amount;
    else if (method === "mobile") entry.mobile += amount;
    else if (method === "card") entry.card += amount;
    entry.total += amount;
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
        <td>TZS ${row.cash.toLocaleString()}</td>
        <td>TZS ${row.mobile.toLocaleString()}</td>
        <td>TZS ${row.card.toLocaleString()}</td>
        <td><strong>TZS ${row.total.toLocaleString()}</strong></td>
        <td>${row.orders}</td>
      </tr>`
    )
    .join("");

  const totalRow = rows.length
    ? `<tr>
        <td><strong>${t("reports.allStaffRow")}</strong></td>
        <td><strong>TZS ${totals.cash.toLocaleString()}</strong></td>
        <td><strong>TZS ${totals.mobile.toLocaleString()}</strong></td>
        <td><strong>TZS ${totals.card.toLocaleString()}</strong></td>
        <td><strong>TZS ${totals.total.toLocaleString()}</strong></td>
        <td><strong>${totals.orders}</strong></td>
      </tr>`
    : "";

  tbody.innerHTML = bodyRows + totalRow || `<tr><td colspan="6" class="empty-state">${t("cart.empty")}</td></tr>`;
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

function findStaffSalesForDay(staffId, dateStr) {
  if (!staffId || !dateStr) return [];
  return state.sales
    .filter((sale) => !sale.voided && sale.staffId === staffId && saleMatchesDate(sale, dateStr))
    .sort((a, b) => (saleDate(a)?.getTime() || 0) - (saleDate(b)?.getTime() || 0));
}

function buildStaffOrderCard(sale) {
  const date = saleDate(sale);
  const itemRows = (sale.items || [])
    .map((item) => `<tr>
      <td>${esc(item.name)}</td>
      <td>${Number(item.qty || 0)}</td>
      <td>TZS ${Number(item.sellingPrice || 0).toLocaleString()}</td>
      <td>TZS ${Number(item.lineTotal || 0).toLocaleString()}</td>
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
    <div class="payment-summary-row"><strong>${t("reports.staffOrderLookupTotalLabel")}</strong><strong>TZS ${Number(sale.total || 0).toLocaleString()}</strong></div>
  </div>`;
}

function renderStaffOrderNumberOptions() {
  const select = qs("#staffOrderLookupOrderNumber");
  if (!select) return;
  const staffId = qs("#staffOrderLookupStaff")?.value || "";
  const dateStr = qs("#staffOrderLookupDate")?.value || "";
  const sales = findStaffSalesForDay(staffId, dateStr);
  const previousValue = select.value;

  if (!staffId || !dateStr || !sales.length) {
    select.innerHTML = `<option value="">${t("reports.staffOrderLookupNoOrders")}</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = sales
    .map((sale) => {
      const date = saleDate(sale);
      const timeLabel = date ? date.toLocaleTimeString() : "";
      return `<option value="${esc(sale.orderNumber || "")}">#${esc(sale.orderNumber || "")} \u2014 TZS ${Number(sale.total || 0).toLocaleString()} (${timeLabel})</option>`;
    })
    .join("");
  if (sales.some((sale) => String(sale.orderNumber || "") === previousValue)) select.value = previousValue;
}

function renderStaffOrderLookupResult() {
  const container = qs("#staffOrderLookupResult");
  if (!container) return;
  const staffId = qs("#staffOrderLookupStaff")?.value || "";
  const dateStr = qs("#staffOrderLookupDate")?.value || "";
  const orderNumber = qs("#staffOrderLookupOrderNumber")?.value || "";

  if (!staffId || !dateStr) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupSelectStaffDate")}</p>`;
    return;
  }
  if (!orderNumber) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupNoOrders")}</p>`;
    return;
  }

  const match = findStaffSalesForDay(staffId, dateStr).find((sale) => String(sale.orderNumber || "") === orderNumber);
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
  const dateStr = qs("#staffOrderLookupDate")?.value || "";

  if (!staffId || !dateStr) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupSelectStaffDate")}</p>`;
    return;
  }

  const sales = findStaffSalesForDay(staffId, dateStr);
  if (!sales.length) {
    container.innerHTML = `<p class="muted">${t("reports.staffOrderLookupNoOrders")}</p>`;
    return;
  }

  const staffName = sales[0].staffName || t("report.none");
  const dayTotal = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cards = sales.map((sale) => buildStaffOrderCard(sale)).join("");

  container.innerHTML = `<div class="payment-summary-row"><strong>${esc(staffName)}</strong><strong>TZS ${dayTotal.toLocaleString()}</strong></div>` + cards;
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
            <td>TZS ${Number(sale.total || 0).toLocaleString()}</td>
          </tr>`;
        })
        .join("");
      return `<div class="daily-staff-card">
        <div class="payment-summary-row"><strong>${esc(entry.staffName)}</strong><strong>TZS ${entry.total.toLocaleString()}</strong></div>
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
    .join("") + `<div class="payment-summary-row"><strong>${t("reports.dailyStaffReportGrandTotal")}</strong><strong>TZS ${grandTotal.toLocaleString()}</strong></div>`;
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
        total: Number(sale.total || 0).toLocaleString()
      });
    })
    .join("<br>");
}

function buildPaymentReportRows() {
  const { breakdown, grandTotal, transactionCount } = computePaymentReport();
  const colPaymentMethod = t("report.colPaymentMethod");
  const colTransactions = t("report.colTransactions");
  const colTotalTZS = t("report.colTotalTZS");
  const colAvgSaleTZS = t("report.colAvgSaleTZS");
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
      [colTopItems]: `${t("pos.cash")} TZS ${entry.cash} / ${t("pos.mobile")} TZS ${entry.mobile} / ${t("pos.card")} TZS ${entry.card}`
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

async function postToAiProxy(messages, snapshot) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), AI_PROXY_TIMEOUT_MS);
  let response;
  try {
    const token = state.user ? await state.user.getIdToken() : null;
    response = await fetch(aiConfig.proxyUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ messages, snapshot }),
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

function buildReportRows() {
  return storeProducts().map((product) => {
    const status = stockStatus(product);
    const label = status === "out" ? t("report.statusOut") : status === "low" ? t("report.statusLow") : t("report.statusHealthy");
    return {
      [t("report.colName")]: product.name || "",
      [t("report.colCategory")]: product.category || "",
      [t("report.colBrand")]: product.brand || "-",
      [t("report.colSupplier")]: product.supplier || "-",
      [t("report.colQuantity")]: Number(product.quantity || 0),
      [t("report.colReorderLevel")]: Number(product.reorderLevel || 0),
      [t("report.colStatus")]: label
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

function productCollectionPath() {
  if (!state.db || !state.user) return null;
  return ["users", state.user.uid, "products"];
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
  supplier: 60
};

const PRODUCT_FIELD_LABEL_KEYS = {
  name: "product.nameLabel",
  category: "product.categoryLabel",
  brand: "product.brandLabel",
  supplier: "product.supplierLabel"
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

  const qty = Math.floor(Number(qs("#transferQuantityInput").value));
  if (!Number.isFinite(qty) || qty <= 0 || qty > product.quantity) return showToast(t("toast.invalidTransferQuantity"));

  try {
    const { collection, doc, runTransaction, serverTimestamp, query, where, getDocs } = state.firebaseApi.firestore;
    const productsRef = collection(state.db, "users", state.user.uid, "products");
    const sourceRef = doc(productsRef, product.id);

    const matchQuery = query(productsRef, where("storeId", "==", destinationStore.id), where("sku", "==", product.sku));
    const matchSnapOutsideTx = await getDocs(matchQuery);
    const destinationRef = matchSnapOutsideTx.empty ? doc(productsRef) : matchSnapOutsideTx.docs[0].ref;
    const destinationExisted = !matchSnapOutsideTx.empty;

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
    });

    showToast(t("toast.transferred", { qty, unit: qty === 1 ? t("toast.unitSingular") : t("toast.unitPlural"), name: product.name, store: destinationStore.name }));
    qs("#transferDialog").close();
  } catch (error) {
    console.warn(error);
    showToast(error.message || t("toast.transferFailed"));
  }
}

async function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  if (!window.confirm(t("dialog.deleteConfirm", { name: product.name }))) return;

  state.products = state.products.filter((item) => item.id !== productId);
  state.cart = state.cart.filter((item) => item.id !== productId);
  if (state.db && state.user) {
    try {
      const { deleteDoc, doc } = state.firebaseApi.firestore;
      await deleteDoc(doc(state.db, "users", state.user.uid, "products", productId));
    } catch (error) {
      console.warn(error);
      showToast(t("toast.deletedLocallyFirestoreFailed"));
    }
  }
  renderAll();
  showToast(t("toast.productDeleted", { name: product.name }));
}

async function undoLastSale() {
  if (!state.lastSale) return showToast(t("toast.noRecentSale"));
  if (!window.confirm(t("dialog.undoSaleConfirm"))) return;

  const sale = state.lastSale;
  if (sale.mode === "firestore" && state.db && state.user) {
    try {
      const { doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      await runTransaction(state.db, async (transaction) => {
        const saleRef = doc(state.db, "users", state.user.uid, "sales", sale.saleId);
        const saleSnap = await transaction.get(saleRef);
        if (!saleSnap.exists()) throw new Error(t("txerror.saleNotFound"));
        if (saleSnap.data().voided) throw new Error(t("txerror.saleAlreadyUndone"));

        const productRefs = sale.items.map((item) => doc(state.db, "users", state.user.uid, "products", item.productId));
        const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

        productSnaps.forEach((snap, index) => {
          if (!snap.exists()) return;
          const item = sale.items[index];
          const currentQuantity = Number(snap.data().quantity || 0);
          transaction.update(productRefs[index], {
            quantity: currentQuantity + item.qty,
            updatedAt: serverTimestamp()
          });
        });

        transaction.update(saleRef, { voided: true, voidedAt: serverTimestamp() });
      });
    } catch (error) {
      console.warn(error);
      showToast(error.message || t("toast.couldNotUndoSale"));
      return;
    }
  } else {
    sale.items.forEach((item) => {
      const product = state.products.find((p) => p.id === item.productId);
      if (product) product.quantity += item.qty;
    });
    const localSale = [...state.sales].reverse().find((entry) => !entry.voided && entry.id?.startsWith("local-"));
    if (localSale) localSale.voided = true;
  }

  state.lastSale = null;
  renderAll();
  showToast(t("toast.saleUndone"));
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
    state.db = firestoreApi.getFirestore(app);
    state.firebaseReady = true;
    qs(".status-dot").classList.add("connected");
    qs("#connectionLabel").textContent = t("connection.firebaseConnected");
    qs("#connectionHint").textContent = t("connection.createAccountToBegin");

    authApi.onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      updateAuthUi();
      if (user) {
        await ensureUserProfile(user);
        await loadUserSettings(user);
        state.pendingBusinessName = "";
        subscribeToProducts();
        subscribeToSales();
        subscribeToStores();
        subscribeToStaff();
        subscribeToMonthlyReports();
      } else {
        if (state.unsubscribeProducts) state.unsubscribeProducts();
        state.unsubscribeProducts = null;
        if (state.unsubscribeSales) state.unsubscribeSales();
        state.unsubscribeSales = null;
        if (state.unsubscribeStores) state.unsubscribeStores();
        state.unsubscribeStores = null;
        if (state.unsubscribeStaff) state.unsubscribeStaff();
        state.unsubscribeStaff = null;
        if (state.unsubscribeMonthlyReports) state.unsubscribeMonthlyReports();
        state.unsubscribeMonthlyReports = null;
        state.products = [];
        state.cart = [];
        state.sales = [];
        state.stores = [];
        state.staff = [];
        state.selectedStaffId = "";
        state.monthlyReports = [];
        state.currentStoreId = "";
        state.productsInitialized = false;
        state.stockAlertQueue = [];
        state.stockAlertPopupOpen = false;
        renderAll();
      }
    });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.firebaseConnectionFailed"));
  }
}

async function subscribeToProducts() {
  if (!state.db || !state.user) return;
  if (state.unsubscribeProducts) state.unsubscribeProducts();
  state.productsInitialized = false;
  try {
    const { collection, onSnapshot } = state.firebaseApi.firestore;
    state.unsubscribeProducts = onSnapshot(collection(state.db, "users", state.user.uid, "products"), (snapshot) => {
      const nextProducts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      detectStockAlertCrossings(state.products, nextProducts);
      state.products = nextProducts;
      state.productsInitialized = true;
      renderAll();
    });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadInventory"));
  }
}

async function subscribeToSales() {
  if (!state.db || !state.user) return;
  if (state.unsubscribeSales) state.unsubscribeSales();
  try {
    const { collection, onSnapshot, orderBy, query, limit } = state.firebaseApi.firestore;
    const salesQuery = query(collection(state.db, "users", state.user.uid, "sales"), orderBy("createdAt", "desc"), limit(1000));
    state.unsubscribeSales = onSnapshot(salesQuery, (snapshot) => {
      state.sales = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderPaymentReports();
    });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotLoadSales"));
  }
}

async function ensureDefaultStore() {
  if (!state.db || !state.user) return;
  try {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const storeRef = doc(collection(state.db, "users", state.user.uid, "stores"));
    await setDoc(storeRef, { name: t("store.defaultName"), createdAt: serverTimestamp() });
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotCreateFirstStore"));
  }
}

async function subscribeToStores() {
  if (!state.db || !state.user) return;
  if (state.unsubscribeStores) state.unsubscribeStores();
  try {
    const { collection, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const storesQuery = query(collection(state.db, "users", state.user.uid, "stores"), orderBy("createdAt", "asc"));
    state.unsubscribeStores = onSnapshot(storesQuery, async (snapshot) => {
      state.stores = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      if (!state.stores.length) {
        await ensureDefaultStore();
        return;
      }
      if (!state.currentStoreId || (state.currentStoreId !== "all" && !state.stores.some((store) => store.id === state.currentStoreId))) {
        state.currentStoreId = activeStores()[0]?.id || state.stores[0].id;
      }
      renderStoreSwitcher();
      renderAll();
    });
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
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid, "stores", store.id), { archived: true }, { merge: true });
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
  renderStoreSwitcher();
  renderAll();
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
  if (!state.db || !state.user) return;
  if (state.unsubscribeStaff) state.unsubscribeStaff();
  try {
    const { collection, onSnapshot, orderBy, query } = state.firebaseApi.firestore;
    const staffQuery = query(collection(state.db, "users", state.user.uid, "staff"), orderBy("createdAt", "asc"));
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
    const { doc, deleteDoc } = state.firebaseApi.firestore;
    await deleteDoc(doc(state.db, "users", state.user.uid, "staff", member.id));
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
  } catch (error) {
    console.warn(error);
    state.stockAlertPopupEnabled = true;
  }
  const toggle = qs("#stockAlertPopupToggle");
  if (toggle) toggle.checked = state.stockAlertPopupEnabled;
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
    const { doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const consentPayload = state.pendingConsent
      ? { legalConsent: { ...state.pendingConsent, acceptedAt: serverTimestamp() } }
      : {};
    await setDoc(doc(state.db, "users", user.uid), {
      uid: user.uid,
      email: user.email || "",
      businessName,
      role: "Owner",
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

const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const LEGAL_DOC_VERSION = "2026-07-15";

function authFailureKey(email) {
  return `authFailures:${email.toLowerCase()}`;
}

function getAuthFailures(email) {
  try {
    const raw = sessionStorage.getItem(authFailureKey(email));
    const attempts = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - AUTH_WINDOW_MS;
    return attempts.filter((timestamp) => timestamp > cutoff);
  } catch (error) {
    return [];
  }
}

function recordAuthFailure(email) {
  try {
    const attempts = getAuthFailures(email);
    attempts.push(Date.now());
    sessionStorage.setItem(authFailureKey(email), JSON.stringify(attempts));
  } catch (error) {
    console.warn(error);
  }
}

function clearAuthFailures(email) {
  try {
    sessionStorage.removeItem(authFailureKey(email));
  } catch (error) {
    console.warn(error);
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

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.auth) return showToast(t("toast.firebaseNotConnected"));

  if (!validateAuthForm()) return;

  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const businessName = String(form.get("businessName") || "").trim();

  if (email && getAuthFailures(email).length >= AUTH_MAX_ATTEMPTS) {
    setFieldError("authEmailError", t("toast.tooManyFailedAttempts"));
    return;
  }

  const submitButton = qs("#authSubmitButton");
  submitButton.disabled = true;

  try {
    const authApi = state.firebaseApi.auth;
    if (state.authMode === "signup") {
      state.pendingBusinessName = businessName;
      state.pendingConsent = { accepted: true, version: LEGAL_DOC_VERSION, acceptedAt: new Date().toISOString() };
      const credential = await authApi.createUserWithEmailAndPassword(state.auth, email, password);
      if (businessName) await authApi.updateProfile(credential.user, { displayName: businessName });
      clearAuthFailures(email);
      showToast(t("toast.accountCreated"));
    } else {
      state.pendingBusinessName = "";
      await authApi.signInWithEmailAndPassword(state.auth, email, password);
      clearAuthFailures(email);
      showToast(t("toast.signedIn"));
    }
  } catch (error) {
    console.warn(error);
    recordAuthFailure(email);
    const fieldErrorKeys = {
      "auth/email-already-in-use": "toast.authEmailInUse",
      "auth/invalid-credential": "toast.authInvalidCredential",
      "auth/weak-password": "toast.authWeakPassword"
    };
    if (fieldErrorKeys[error.code]) {
      setFieldError("authEmailError", t(fieldErrorKeys[error.code]));
    } else {
      showToast(t(error.code === "auth/operation-not-allowed" ? "toast.authOperationNotAllowed" : "toast.authFailedGeneric"));
    }
  } finally {
    submitButton.disabled = false;
  }
}

function openView(viewId) {
  qsa(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  qsa(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  qs(".sidebar").classList.remove("open");
}

function renderCommands(term = "") {
  const commands = [
    ["dashboard", t("command.openDashboard")],
    ["inventory", t("command.openInventory")],
    ["pos", t("command.openPos")],
    ["reports", t("command.openReports")],
    ["ai", t("command.openAi")]
  ].filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()));

  qs("#commandResults").innerHTML = commands
    .map(([view, label]) => `<div class="command-result" data-command-view="${view}">${label}</div>`)
    .join("");
}

function renderAll() {
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
    renderCart();
  });
  qs("#cashTendered").addEventListener("input", renderCart);
  qs("#undoSaleButton").addEventListener("click", undoLastSale);
  qs("#exportInventoryButton").addEventListener("click", exportCsv);
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
  qs("#posStaffSelect")?.addEventListener("change", (event) => {
    state.selectedStaffId = event.target.value;
  });
  qs("#addStaffButton")?.addEventListener("click", addStaffMember);
  qs("#removeStaffButton")?.addEventListener("click", removeStaffMember);
  qs("#orderNumberSearch")?.addEventListener("input", debounce(searchOrderNumber, 250));
  qs("#staffOrderLookupStaff")?.addEventListener("change", renderStaffOrderNumberOptions);
  qs("#staffOrderLookupDate")?.addEventListener("change", renderStaffOrderNumberOptions);
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
  qs("#signOutButton").addEventListener("click", async () => {
    if (!state.auth) return;
    const { signOut } = state.firebaseApi.auth;
    await signOut(state.auth);
    showToast(t("toast.signedOut"));
  });

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

    const cartButton = event.target.closest("[data-add-cart]");
    if (cartButton) {
      const product = state.products.find((item) => item.id === cartButton.dataset.addCart);
      if (!product || product.quantity <= 0) return showToast(t("toast.outOfStock"));
      if (state.db && state.currentStoreId === "all") return showToast(t("toast.selectStoreToSell"));

      const qtyInput = qs(`[data-qty-input="${product.id}"]`);
      const requestedQty = Math.max(1, Math.floor(Number(qtyInput?.value || 1)));

      let unitPrice = Number(product.sellingPrice || 0);
      let priceInput = null;
      if (product.priceType === "dynamic") {
        priceInput = qs(`[data-price-input="${product.id}"]`);
        const enteredPrice = Number(priceInput?.value || 0);
        if (!enteredPrice || enteredPrice <= 0) return showToast(t("toast.enterPricePerUnit"));
        unitPrice = enteredPrice;
      }

      const existingCartItem = state.cart.find((item) => item.id === product.id);
      const existingQty = existingCartItem?.qty || 0;
      if (existingQty + requestedQty > product.quantity) {
        return showToast(t("toast.notEnoughStockQty"));
      }
      if (!existingCartItem && state.cart.length >= 40) {
        return showToast(t("toast.cartLimitReached"));
      }

      pushCartHistory();
      if (existingCartItem) {
        existingCartItem.qty += requestedQty;
        if (product.priceType === "dynamic") existingCartItem.sellingPrice = unitPrice;
      } else {
        state.cart.push({ ...product, qty: requestedQty, sellingPrice: unitPrice });
      }
      renderCart();
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
      const newPrice = Number(window.prompt(t("dialog.editPricePrompt", { name: cartItem.name }), cartItem.sellingPrice));
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
      renderCart();
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
    const total = saleItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const paymentMethod = state.paymentMethod || "cash";
    const cashTendered = Number(qs("#cashTendered")?.value || 0);

    if (paymentMethod === "cash" && cashTendered < total) {
      showToast(t("toast.cashLessThanTotal"));
      return;
    }
    const changeDue = paymentMethod === "cash" ? Math.max(0, cashTendered - total) : 0;

    if (!staffMember.id || !String(staffMember.name || "").trim() || !/^[0-9]{1,10}$/.test(orderNumberRaw)) {
      showToast(t("toast.saleFailedGeneric"));
      return;
    }

    const completeButton = qs("#completeSaleButton");
    completeButton.disabled = true;

    if (state.db && state.user) {
      try {
        const { collection, doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
        const saleRef = doc(collection(state.db, "users", state.user.uid, "sales"));
        await runTransaction(state.db, async (transaction) => {
          const productRefs = state.cart.map((cartItem) => doc(state.db, "users", state.user.uid, "products", cartItem.id));
          const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

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
            transaction.update(productRefs[index], {
              quantity: currentQuantity - cartItem.qty,
              updatedAt: serverTimestamp()
            });
          });

          transaction.set(saleRef, {
            items: saleItems,
            total,
            paymentMethod,
            cashTendered: paymentMethod === "cash" ? cashTendered : null,
            changeDue: paymentMethod === "cash" ? changeDue : null,
            branchId: state.currentStoreId,
            storeId: state.currentStoreId,
            cashierUid: state.user?.uid || null,
            staffId: staffMember.id,
            staffName: staffMember.name || "",
            orderNumber: orderNumberRaw,
            voided: false,
            createdAt: serverTimestamp()
          });

          const auditRef = doc(collection(state.db, "users", state.user.uid, "auditLogs"));
          transaction.set(auditRef, {
            action: "SALE_COMPLETED",
            total,
            paymentMethod,
            itemCount: saleItems.length,
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
        if (product) product.quantity = Math.max(0, product.quantity - cartItem.qty);
      });
      state.sales.push({
        id: `local-${Date.now()}`,
        items: saleItems,
        total,
        paymentMethod,
        cashTendered: paymentMethod === "cash" ? cashTendered : null,
        changeDue: paymentMethod === "cash" ? changeDue : null,
        staffId: staffMember.id,
        staffName: staffMember.name || "",
        orderNumber: orderNumberRaw,
        voided: false,
        createdAt: new Date()
      });
      state.lastSale = { mode: "local", items: saleItems, paymentMethod, total };
    }

    state.cart = [];
    state.cartHistory = [];
    if (qs("#cashTendered")) qs("#cashTendered").value = "";
    if (qs("#posOrderNumber")) qs("#posOrderNumber").value = "";
    renderAll();
    completeButton.disabled = false;
    showToast(changeDue > 0 ? t("toast.saleCompletedChange", { change: changeDue.toLocaleString() }) : t("toast.saleCompleted"));
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
translateStaticDom();
renderAll();
renderChatLog();
initFirebase();
