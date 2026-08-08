import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";

// Taken from this module's own ?v= query rather than declared. The release
// procedure already asks for four values to move together; a fifth that only
// matters when something has already gone wrong is the one most likely to be
// forgotten, and a fault report labelled with the wrong build is worse than one
// labelled "unknown".
const APP_VERSION = (() => {
  try { return new URL(import.meta.url).searchParams.get("v") || "dev"; }
  catch { return "unknown"; }
})();

const state = {
  products: [],
  creditOverrides: [],
  faults: [],
  shifts: [],
  openShift: null,
  cart: [],
  paymentMethod: "cash",
  // Connectivity as the app currently understands it; see watchConnection.
  online: true,
  // Sales written on this device that the server has not acknowledged yet
  // (L-9 phase D). Derived from Firestore's own hasPendingWrites rather than
  // counted by us: the SDK owns the queue, and a tally we maintained ourselves
  // would drift the first time a replay was rejected. See subscribeToSales.
  unsyncedSaleCount: 0,
  pendingSaleIds: new Set(),
  // Whether the sales listener has rendered at least once. Without it, a shop
  // with no sales yet never renders the reports' empty state, because the
  // first snapshot of an empty collection reports no document changes.
  salesRenderedOnce: false,
  discountType: "none",
  discountValue: 0,
  // Subtotal a fixed discount was authorised against; see revalidateDiscountForCart.
  discountBasis: 0,
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
  members: [],
  unsubscribeMembers: null,
  unsubscribeOwnMembership: null,
  unsubscribeStockLedger: null,
  // Newest ledger entry per product id. Empty means "nothing checked yet",
  // which is what the whole catalogue reads as until stock next moves.
  stockLedgerLatest: null,
  // Owner-only shift reconciliation results, keyed by shift id. See
  // reconcileShiftCash() -- absence of an entry means "not checked", which is
  // rendered as nothing rather than as a clean bill of health.
  shiftReconciliation: {},
  // One-shot latch so a membership that ends cannot fire the sign-out path
  // repeatedly as the listener settles.
  membershipEnded: false,
  // Latch for the access-during-grace evidence entry (L-6): one per sign-in,
  // not one per render. Cleared alongside membershipEnded.
  graceAccessLogged: false,
  pendingInviteLinkToken: "",
  pendingInviteRoleLabel: "",
  businessOwnerUid: "",
  currentUserRole: null,
  // Who the signed-in account IS on a sale. Sales used to be attributed by
  // picking a name out of a list the owner maintained by hand; every staff
  // member now signs in as themselves, so this is resolved from the account
  // and never chosen at the till.
  currentUserName: "",
  // Auto-issued order number held for the cart currently on screen, so a retry
  // reuses it and stays idempotent. Cleared when the sale completes.
  pendingAutoOrderNumber: "",
  // Epoch ms when the anonymise-and-purge becomes due, or null when the tenant
  // is active. Read from users/{ownerUid}.deletionScheduledFor at sign-in.
  deletionScheduledFor: null,
  pendingTransferProductId: null,
  pendingRestockProductId: null,
  stockAlertPopupEnabled: true,
  overridePasswordSet: false,
  overridePasswordNudgeDismissed: false,
  productsInitialized: false,
  // Distinct from productsInitialized: a listener that errored is not still
  // loading, and a table that says so forever is a lie with a spinner on it.
  productsLoadFailed: false,
  stockAlertQueue: [],
  stockAlertPopupOpen: false,
  language: localStorage.getItem("savia:lang") || localStorage.getItem("sanitaryflow:lang") || "en",
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
  idleCheckIntervalId: null,
  updateReady: false
};

const MAX_CHAT_HISTORY = 20;

// MAX_CHAT_HISTORY bounds what is SENT to the model. This bounds what is KEPT,
// which is a separate cost and the one that grows with the length of a shift:
// renderChatLog() rebuilds the panel from the whole array on every turn, so an
// uncapped log means the owner's twentieth question re-renders the previous
// nineteen exchanges, and the fortieth re-renders thirty-nine. The array was
// only ever emptied by the Clear button or a reload, neither of which a device
// left on all day gets.
//
// Trimming from the FRONT is load-bearing: askAi() writes its answer over the
// last entry by index (the "analyzing" placeholder), so nothing may be removed
// from the end while a request is in flight.
const MAX_CHAT_LOG_MESSAGES = 60;

function pushChatMessage(message) {
  state.chatHistory.push(message);
  const excess = state.chatHistory.length - MAX_CHAT_LOG_MESSAGES;
  if (excess > 0) state.chatHistory.splice(0, excess);
}
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
    "pos.orderNumberLabel": "Order number (optional)", "pos.orderNumberPlaceholder": "Leave blank to auto-generate",
    "pos.servedByLabel": "Served by",
    "control.managerEyebrow": "Shift control",
    "control.managerTitle": "Manager control",
    "control.adminEyebrow": "Business control",
    "control.adminTitle": "Owner control",
    "control.todayScope": "today",
    "control.allStoresScope": "All stores · month to date",
    "control.expectedCash": "Expected in drawer",
    "control.expectedCashNote": "Cash sales plus cash deposits, less refunds",
    "control.netTakings": "Net takings",
    "control.netTakingsNote": "After refunds, excluding voids",
    "control.salesCount": "Sales",
    "control.averageBasket": "Average basket {value}",
    "control.byMethod": "Cash · Mobile",
    "control.cardCredit": "Card · Credit",
    "control.discountsGiven": "Discounts given",
    "control.voidsToday": "Voids today",
    "control.refundsToday": "Refunds today",
    "control.stockAttention": "Low · Out of stock",
    "control.stockAttentionNote": "In this store",
    "control.byStaffToday": "Takings by staff today",
    "control.colStaff": "Staff",
    "control.colSales": "Sales",
    "control.colItems": "Items",
    "control.colDiscount": "Discounts",
    "control.colVoids": "Voids",
    "control.colTakings": "Takings",
    "control.noSalesToday": "No sales recorded yet today.",
    "control.revenueToday": "Revenue today",
    "control.revenueMonth": "Revenue month to date",
    "control.salesCountNote": "{count} sales this month",
    "control.grossMargin": "Gross margin (est.)",
    "control.marginNote": "Revenue less cost of goods sold",
    "control.marginIncomplete": "Incomplete — some items have no cost price",
    "control.stockAtCost": "Stock value at cost",
    "control.stockAtRetail": "At retail {value}",
    "control.creditOwed": "Credit outstanding",
    "control.voidsMonth": "Voids this month",
    "control.refundsMonth": "Refunds this month",
    "control.discountsMonth": "Discounts this month",
    "control.totalMismatches": "Sales whose total disagrees with their items",
    "control.faults": "App faults (7 days)",
    "control.faultsNote": "Something failed on a device. Tell us what the staff were doing.",
    "control.faultsClear": "Nothing has failed this week.",
    "control.totalMismatchNote": "Recomputed from line items. Review these sales.",
    "control.totalMismatchClear": "Every sale matches its line items.",
    "control.byStore": "Performance by store",
    "control.colStore": "Store",
    "control.colToday": "Today",
    "control.colMonth": "Month to date",
    "control.colLowStock": "Low / out",
    "control.colStockValue": "Stock at cost",
    "control.noStores": "No active stores yet.",
    "control.governance": "Governance",
    "control.govTeam": "Team",
    "control.govTeamValue": "{managers} manager(s), {cashiers} cashier(s)",
    "control.govOverride": "Override password",
    "control.govSet": "Set",
    "control.govNotSet": "Not set — voids and returns are blocked",
    "control.govUnnamed": "Staff without a name on file",
    "control.govDeletion": "Account deletion",
    "control.govDeletionPending": "Scheduled",
    "control.govDeletionNone": "Not scheduled",
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
    "auth.accessRemoved": "Your access to this business was removed. Ask the owner if you think this is a mistake.",
    "auth.copy": "Create an account or sign in to manage your own inventory, stock levels, sales, and AI recommendations.",
    "auth.businessName": "Business name", "auth.email": "Email", "auth.password": "Password", "auth.forgotPassword": "Forgot password?",
    "auth.confirmPassword": "Confirm password",
    "auth.consentPrefix": "I agree to the", "auth.consentTerms": "Terms & Conditions",
    "auth.consentAnd": "and", "auth.consentPrivacy": "Privacy Policy", "auth.consentSuffix": ".",
    "auth.whyTitle": "Why SaviaSmart",
    "auth.aboutLink": "What SaviaSmart does →",
    "auth.ledgerExpected": "Should be in the drawer",
    "auth.ledgerCounted": "Counted at close",
    "auth.ledgerDiff": "Difference",
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
    "movement.ledgerGaps": "shelves disagree with the stock ledger (worst: {name}, {units} units)",
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
    "inventory.loadingState": "Loading your stock\u2026 a large catalogue can take a moment on the first sign-in from a device.",
    "inventory.loadFailedState": "Your stock could not be loaded. Check the connection and reload \u2014 nothing has been lost.",
    "inventory.noMatchesState": "No products match this search or filter. Clear it to see the rest of your stock.",
    "toast.incorrectPassword": "Incorrect password. Price change cancelled.",
    "toast.overrideNotConfigured": "Price overrides aren't set up yet. Ask your admin to configure them.",
    "toast.overrideNetworkError": "Couldn't reach the override service. Check your connection and try again.",
    "toast.overridePasswordSaved": "Discount password saved.",
    "toast.overridePasswordSaveFailed": "Couldn't save the password. Try again.",
    "toast.nothingToUndo": "Nothing to undo.", "toast.lastCartActionUndone": "Last cart action undone.",
    "toast.pdfLibraryFailed": "PDF library did not load. Check your connection and try again.",
    "toast.excelLibraryFailed": "Excel library did not load. Check your connection and try again.",
    "toast.aiProxyUnavailable": "AI proxy unavailable ({message}). Showing local recommendation.",
    "toast.aiQuestionTooLong": "That question is too long. Please shorten it to {max} characters or fewer.",
    "a11y.skipToContent": "Skip to main content",
    "a11y.globalSearch": "Search products",
    "a11y.posSearch": "Search products to add to the sale",
    "a11y.orderNumberSearch": "Search by order number",
    "a11y.discountValue": "Discount value",
    "a11y.staffReportDate": "Report date",
    "a11y.aiQuestion": "Ask a question about your business",
    "a11y.commandInput": "Search commands and modules",
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
    "toast.staffIdentityUnavailable": "Could not confirm who is signed in. Sign out and back in, then try again.",
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
    "toast.numberOutOfRange": "{field} must be a number between 0 and {max}.",
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
    "offline.bannerText": "No internet connection. Cash sales are saved on this device and will sync when you reconnect.",
    "toast.offlineCashOnly": "Only cash sales can be recorded while offline. Credit sales need a connection.",
    "toast.saleQueuedOffline": "Sale saved on this device. It will sync when the connection returns.",
    "offline.unsyncedOne": "1 sale is saved on this device and has not reached the server yet. Keep this app installed until it syncs.",
    "offline.unsyncedMany": "{count} sales are saved on this device and have not reached the server yet. Keep this app installed until they sync.",
    "update.readyText": "A new version of the app is ready. Reload when you are not mid-sale.",
    "update.reloadButton": "Reload now",
    "dashboard.vatSettings": "VAT",
    "vat.dialogTitle": "VAT registration",
    "vat.dialogHelp": "Only switch this on if this business is registered for VAT with the TRA. Sales already recorded are not changed.",
    "vat.registeredLabel": "This business is registered for VAT",
    "vat.vrnLabel": "VAT registration number (VRN)",
    "vat.vrnPlaceholder": "e.g. 40-123456-A",
    "vat.tinLabel": "Taxpayer identification number (TIN)",
    "vat.tinPlaceholder": "e.g. 123-456-789",
    "vat.fiscalNote": "This does not replace your EFD. Fiscal receipts still come from your TRA-registered device.",
    "vat.save": "Save",
    "product.taxClassLabel": "VAT treatment",
    "product.taxStandard": "Standard rated (18%)",
    "product.taxZeroRated": "Zero rated (0%)",
    "product.taxExempt": "Exempt",
    "toast.vatVrnRequired": "Enter the VAT registration number before switching VAT on.",
    "toast.vatSaved": "VAT settings saved.",
    "toast.vatNeedsStore": "Add a store before setting up VAT.",
    "receipt.vatNetLabel": "Net of VAT",
    "receipt.vatLabel": "VAT at {rate}%",
    "receipt.vatZeroRatedLabel": "Zero rated",
    "receipt.vatExemptLabel": "Exempt",
    "receipt.vrnLabel": "VRN",
    "receipt.vatInclusiveNote": "Prices include VAT",
    "report.vatTitle": "VAT summary",
    "report.vatNet": "Net of VAT",
    "report.vatDue": "VAT",
    "report.vatStandard": "Standard rated (18%)",
    "report.vatZeroRated": "Zero rated",
    "report.vatExempt": "Exempt",
    "report.vatTaxableTurnover": "Taxable turnover",
    "report.vatSalesOutsideScheme": "Sales before VAT was switched on",
    "report.vatNotRegistered": "This business is not registered for VAT.",
    "report.vatOutsideNote": "{count} sale(s) in this range were recorded before VAT was switched on and are not part of the return.",
    "toast.reportPeriodBeyondHistory": "This period starts before the {date} sales this device has loaded. Generating it would under-report. Narrow the store or period, or generate it earlier in the following month.",
    "report.vatCoverageIncomplete": "Incomplete: this device holds sales back to {date} only. Older sales in this range are not counted and this is not a filing figure.",
    "reports.collectedColumn": "Collected",
    "reports.netSalesColumn": "Net sales",
    "toast.returnAlreadyRefunded": "This sale has already been refunded by someone else. Reopen it to see what is left.",
    "toast.offlineStockUncertain": "Stock for this item may be out of date while offline. The sale is allowed and will be flagged for the owner.",
    "offline.saleMarker": "Rung up offline",
    "offline.salePending": "Not yet synced",
    "offlineReport.eyebrow": "Sold during an outage",
    "offlineReport.title": "Sold While Offline",
    "offlineReport.none": "No sales were recorded offline in this period.",
    "offlineReport.note": "Stock counts for these products are unverified until each one's next movement while online. A negative count means more was sold than the shelf was thought to hold.",
    "offlineReport.colProduct": "Product",
    "offlineReport.colUnits": "Units sold offline",
    "offlineReport.colValue": "Value",
    "offlineReport.colOnHand": "Counted on hand now",
    "offlineReport.salesCount": "{count} offline sale(s)",
    "error.offline": "No internet connection, so this was not saved. Check your signal and try again.",
    "error.timeout": "The connection is too slow to finish this. Please try again.",
    "error.permissionDenied": "Your account is not allowed to do this. Ask the business owner.",
    "error.busy": "The system is busy right now. Please wait a moment and try again.",
    "error.contention": "Someone else changed this at the same time. Please try again.",
    "error.notFound": "That record no longer exists. Refresh and try again.",
    "error.failedPrecondition": "This could not be completed. Refresh and try again.",
    "toast.discountClearedCartChanged": "The cart changed, so the discount was removed. Apply it again if it still applies.",
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
    "toast.paymentMethodInvalid": "Choose how the payment was made.",
    "shift.heading": "Shift & cash",
    "shift.openButton": "Open shift",
    "shift.closeButton": "Close shift",
    "shift.floatLabel": "Opening float",
    "shift.countedLabel": "Cash counted",
    "shift.noteLabel": "Note (optional)",
    "shift.openedBy": "Opened by {name}",
    "shift.noneOpen": "No shift open on this till",
    "shift.closeLockedToOpener": "{name} opened this drawer and counts it down. A manager can close it if they have left.",
    "shift.expected": "Expected in drawer",
    "shift.over": "over",
    "shift.short": "short",
    "shift.variance": "Variance",
    "shift.historyHeading": "Recent shifts",
    "shift.reconciled": "Against sales",
    "shift.reconcileOk": "Checks out",
    "shift.reconcileMismatch": "{amount} unaccounted",
    "shift.reconcileMismatchHelp": "The sales record for this shift does not agree with the figures it was closed on. Worth asking about before assuming anything.",
    "shift.reconcileUnknown": "Not checked — this shift is older than the sales history loaded here.",
    "shift.balanced": "Balanced",
    "shift.selectStore": "Choose a single branch to run a shift",
    "toast.selectStoreBeforeShift": "Choose a single branch before opening a shift.",
    "toast.shiftOpened": "Shift opened with {float} in the drawer.",
    "toast.shiftOpenFailed": "Could not open the shift. Please try again.",
    "toast.shiftCloseFailed": "Could not close the shift. Please try again.",
    "toast.noOpenShift": "There is no open shift on this till.",
    "toast.shiftBalanced": "Shift closed. The drawer balanced exactly.",
    "toast.shiftVariance": "Shift closed. The drawer is {amount} {direction}.",
    "txerror.shiftAlreadyOpen": "A shift is already open on this till.",
    "txerror.shiftAlreadyClosed": "That shift has already been closed.",
    "payment.methodLabel": "Paid by",
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
    "customers.colCreditLimit": "Credit Alert At",
    "customers.setLimitButton": "Set Alert",
    "customers.noLimit": "No alert",
    "dialog.creditLimitPrompt": "Alert when {name} owes more than this, in {currency}. Sales above it need a manager's override password. Leave blank for no alert:",
    "toast.creditLimitInvalid": "Enter a valid credit limit, or leave blank for no limit.",
    "toast.creditLimitSet": "{name}'s credit limit set to {limit}.",
    "toast.creditLimitCleared": "{name}'s credit limit removed.",
    "toast.creditLimitFailed": "Could not update the credit alert. Please try again.",
    "toast.creditLimitOverrideRefused": "Not authorised. The sale was not completed.",
    "control.creditOverrides": "Credit alerts overridden (30 days)",
    "dialog.creditLimitExceededConfirm": "{name} already owes {currentBalance}. This sale adds {newBalanceDue}, bringing them to {projectedTotal} — above the {limit} alert level. Continuing needs a manager override password, and will be recorded. Continue?",
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
    "staff.colName": "Name",
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
    "pos.orderNumberLabel": "Nambari ya oda (si lazima)", "pos.orderNumberPlaceholder": "Acha wazi itatengenezwa yenyewe",
    "pos.servedByLabel": "Amehudumiwa na",
    "control.managerEyebrow": "Udhibiti wa zamu",
    "control.managerTitle": "Udhibiti wa msimamizi",
    "control.adminEyebrow": "Udhibiti wa biashara",
    "control.adminTitle": "Udhibiti wa mmiliki",
    "control.todayScope": "leo",
    "control.allStoresScope": "Maduka yote · mwezi hadi leo",
    "control.expectedCash": "Fedha inayotarajiwa",
    "control.expectedCashNote": "Mauzo ya taslimu na malipo, ukiondoa marejesho",
    "control.netTakings": "Mapato halisi",
    "control.netTakingsNote": "Baada ya marejesho, bila mauzo yaliyofutwa",
    "control.salesCount": "Mauzo",
    "control.averageBasket": "Wastani wa manunuzi {value}",
    "control.byMethod": "Taslimu · Simu",
    "control.cardCredit": "Kadi · Mkopo",
    "control.discountsGiven": "Punguzo lililotolewa",
    "control.voidsToday": "Yaliyofutwa leo",
    "control.refundsToday": "Marejesho leo",
    "control.stockAttention": "Chini · Imeisha",
    "control.stockAttentionNote": "Katika duka hili",
    "control.byStaffToday": "Mapato kwa mfanyakazi leo",
    "control.colStaff": "Mfanyakazi",
    "control.colSales": "Mauzo",
    "control.colItems": "Bidhaa",
    "control.colDiscount": "Punguzo",
    "control.colVoids": "Yaliyofutwa",
    "control.colTakings": "Mapato",
    "control.noSalesToday": "Hakuna mauzo yaliyorekodiwa leo.",
    "control.revenueToday": "Mapato leo",
    "control.revenueMonth": "Mapato mwezi hadi leo",
    "control.salesCountNote": "Mauzo {count} mwezi huu",
    "control.grossMargin": "Faida ghafi (makadirio)",
    "control.marginNote": "Mapato ukiondoa gharama ya bidhaa",
    "control.marginIncomplete": "Haijakamilika — baadhi ya bidhaa hazina bei ya gharama",
    "control.stockAtCost": "Thamani ya hisa kwa gharama",
    "control.stockAtRetail": "Kwa bei ya rejareja {value}",
    "control.creditOwed": "Mkopo unaodaiwa",
    "control.voidsMonth": "Yaliyofutwa mwezi huu",
    "control.refundsMonth": "Marejesho mwezi huu",
    "control.discountsMonth": "Punguzo mwezi huu",
    "control.totalMismatches": "Mauzo yenye jumla isiyolingana na bidhaa zake",
    "control.faults": "Hitilafu za programu (siku 7)",
    "control.faultsNote": "Kitu kilishindikana kwenye kifaa. Tuambie wafanyakazi walikuwa wanafanya nini.",
    "control.faultsClear": "Hakuna kilichoshindikana wiki hii.",
    "control.totalMismatchNote": "Imehesabiwa upya kutoka kwa bidhaa. Kagua mauzo haya.",
    "control.totalMismatchClear": "Kila mauzo yanalingana na bidhaa zake.",
    "control.byStore": "Utendaji kwa duka",
    "control.colStore": "Duka",
    "control.colToday": "Leo",
    "control.colMonth": "Mwezi hadi leo",
    "control.colLowStock": "Chini / imeisha",
    "control.colStockValue": "Hisa kwa gharama",
    "control.noStores": "Hakuna maduka yanayotumika bado.",
    "control.governance": "Usimamizi",
    "control.govTeam": "Timu",
    "control.govTeamValue": "Wasimamizi {managers}, wauzaji {cashiers}",
    "control.govOverride": "Nenosiri la idhini",
    "control.govSet": "Limewekwa",
    "control.govNotSet": "Halijawekwa — kufuta na marejesho hayafanyi kazi",
    "control.govUnnamed": "Wafanyakazi wasio na jina",
    "control.govDeletion": "Kufuta akaunti",
    "control.govDeletionPending": "Kumepangwa",
    "control.govDeletionNone": "Hakujapangwa",
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
    "auth.accessRemoved": "Ufikiaji wako kwa biashara hii umeondolewa. Muulize mmiliki kama unadhani ni makosa.",
    "auth.copy": "Fungua akaunti au ingia ili kusimamia hisa yako, viwango vya bidhaa, mauzo, na mapendekezo ya AI.",
    "auth.businessName": "Jina la biashara", "auth.email": "Barua pepe", "auth.password": "Nenosiri", "auth.forgotPassword": "Umesahau nenosiri?",
    "auth.confirmPassword": "Thibitisha nenosiri",
    "auth.consentPrefix": "Nakubali", "auth.consentTerms": "Sheria na Masharti",
    "auth.consentAnd": "na", "auth.consentPrivacy": "Sera ya Faragha", "auth.consentSuffix": ".",
    "auth.whyTitle": "Kwa Nini SaviaSmart",
    "auth.aboutLink": "SaviaSmart inafanya nini →",
    "auth.ledgerExpected": "Inayotakiwa kuwa kwenye droo",
    "auth.ledgerCounted": "Iliyohesabiwa mwisho",
    "auth.ledgerDiff": "Tofauti",
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
    "movement.ledgerGaps": "rafu hazilingani na leja ya hisa (mbaya zaidi: {name}, vipande {units})",
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
    "inventory.loadingState": "Inapakia hisa zako\u2026 orodha kubwa inaweza kuchukua muda kidogo unapoingia mara ya kwanza kwenye kifaa.",
    "inventory.loadFailedState": "Hisa zako hazikuweza kupakiwa. Angalia muunganisho kisha upakie upya \u2014 hakuna kilichopotea.",
    "inventory.noMatchesState": "Hakuna bidhaa zinazolingana na utafutaji huu. Ondoa kichujio ili kuona hisa zako zote.",
    "toast.incorrectPassword": "Nenosiri si sahihi. Mabadiliko ya bei yamesitishwa.",
    "toast.overrideNotConfigured": "Mabadiliko ya bei ya ziada bado hayajawekwa. Muulize msimamizi wako ayaweke.",
    "toast.overrideNetworkError": "Imeshindwa kufikia huduma ya ruhusa. Angalia muunganisho wako na ujaribu tena.",
    "toast.overridePasswordSaved": "Nenosiri la punguzo limehifadhiwa.",
    "toast.overridePasswordSaveFailed": "Imeshindwa kuhifadhi nenosiri. Jaribu tena.",
    "toast.nothingToUndo": "Hakuna cha kutengua.", "toast.lastCartActionUndone": "Kitendo cha mwisho cha kikapu kimetenguliwa.",
    "toast.pdfLibraryFailed": "Maktaba ya PDF haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.excelLibraryFailed": "Maktaba ya Excel haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.aiProxyUnavailable": "Proksi ya AI haipatikani ({message}). Inaonyesha pendekezo la ndani.",
    "toast.aiQuestionTooLong": "Swali hilo ni refu mno. Tafadhali lifupishe hadi herufi {max} au chini.",
    "a11y.skipToContent": "Rukia maudhui makuu",
    "a11y.globalSearch": "Tafuta bidhaa",
    "a11y.posSearch": "Tafuta bidhaa za kuongeza kwenye mauzo",
    "a11y.orderNumberSearch": "Tafuta kwa namba ya oda",
    "a11y.discountValue": "Kiasi cha punguzo",
    "a11y.staffReportDate": "Tarehe ya ripoti",
    "a11y.aiQuestion": "Uliza swali kuhusu biashara yako",
    "a11y.commandInput": "Tafuta amri na moduli",
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
    "toast.staffIdentityUnavailable": "Imeshindwa kuthibitisha aliyeingia. Toka kisha ingia tena, kisha jaribu tena.",
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
    "toast.numberOutOfRange": "{field} lazima iwe namba kati ya 0 na {max}.",
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
    "offline.bannerText": "Hakuna muunganisho wa intaneti. Mauzo ya taslimu yanahifadhiwa kwenye kifaa hiki na yatasawazishwa muunganisho utakaporudi.",
    "toast.offlineCashOnly": "Ni mauzo ya taslimu pekee yanayoweza kurekodiwa bila mtandao. Mauzo ya mkopo yanahitaji muunganisho.",
    "toast.saleQueuedOffline": "Mauzo yamehifadhiwa kwenye kifaa hiki. Yatasawazishwa muunganisho utakaporudi.",
    "offline.unsyncedOne": "Mauzo 1 yamehifadhiwa kwenye kifaa hiki na bado hayajafika kwenye seva. Usiondoe programu hii hadi yasawazishwe.",
    "offline.unsyncedMany": "Mauzo {count} yamehifadhiwa kwenye kifaa hiki na bado hayajafika kwenye seva. Usiondoe programu hii hadi yasawazishwe.",
    "update.readyText": "Toleo jipya la programu lipo tayari. Pakia upya wakati hauko katikati ya mauzo.",
    "update.reloadButton": "Pakia upya sasa",
    "dashboard.vatSettings": "VAT",
    "vat.dialogTitle": "Usajili wa VAT",
    "vat.dialogHelp": "Washa hii tu kama biashara hii imesajiliwa kwa VAT na TRA. Mauzo yaliyokwisha rekodiwa hayabadilishwi.",
    "vat.registeredLabel": "Biashara hii imesajiliwa kwa VAT",
    "vat.vrnLabel": "Namba ya usajili wa VAT (VRN)",
    "vat.vrnPlaceholder": "mfano, 40-123456-A",
    "vat.tinLabel": "Namba ya utambulisho wa mlipakodi (TIN)",
    "vat.tinPlaceholder": "mfano, 123-456-789",
    "vat.fiscalNote": "Hii haibadilishi EFD yako. Risiti za kodi bado zinatoka kwenye kifaa chako kilichosajiliwa TRA.",
    "vat.save": "Hifadhi",
    "product.taxClassLabel": "Aina ya VAT",
    "product.taxStandard": "Kiwango cha kawaida (18%)",
    "product.taxZeroRated": "Kiwango sifuri (0%)",
    "product.taxExempt": "Haihusiki na VAT",
    "toast.vatVrnRequired": "Weka namba ya usajili wa VAT (VRN) kabla ya kuwasha VAT.",
    "toast.vatSaved": "Mipangilio ya VAT imehifadhiwa.",
    "toast.vatNeedsStore": "Ongeza duka kabla ya kuweka VAT.",
    "receipt.vatNetLabel": "Kabla ya VAT",
    "receipt.vatLabel": "VAT kwa {rate}%",
    "receipt.vatZeroRatedLabel": "Kiwango sifuri",
    "receipt.vatExemptLabel": "Haihusiki na VAT",
    "receipt.vrnLabel": "VRN",
    "receipt.vatInclusiveNote": "Bei zimejumuisha VAT",
    "report.vatTitle": "Muhtasari wa VAT",
    "report.vatNet": "Kabla ya VAT",
    "report.vatDue": "VAT",
    "report.vatStandard": "Kiwango cha kawaida (18%)",
    "report.vatZeroRated": "Kiwango sifuri",
    "report.vatExempt": "Haihusiki na VAT",
    "report.vatTaxableTurnover": "Mauzo yanayotozwa kodi",
    "report.vatSalesOutsideScheme": "Mauzo kabla ya VAT kuwashwa",
    "report.vatNotRegistered": "Biashara hii haijasajiliwa kwa VAT.",
    "report.vatOutsideNote": "Mauzo {count} katika kipindi hiki yalirekodiwa kabla ya VAT kuwashwa na hayahusiki katika marejesho.",
    "toast.reportPeriodBeyondHistory": "Kipindi hiki kinaanza kabla ya mauzo ya {date} yaliyopakiwa kwenye kifaa hiki. Kutengeneza ripoti kutapunguza takwimu. Punguza duka au kipindi, au itengeneze mapema mwezi unaofuata.",
    "report.vatCoverageIncomplete": "Haijakamilika: kifaa hiki kina mauzo tangu {date} pekee. Mauzo ya zamani katika kipindi hiki hayajahesabiwa na hii si takwimu ya kuwasilisha.",
    "reports.collectedColumn": "Zilizopokelewa",
    "reports.netSalesColumn": "Mauzo halisi",
    "toast.returnAlreadyRefunded": "Mauzo haya tayari yamerejeshwa na mtu mwingine. Yafungue tena uone kilichobaki.",
    "toast.offlineStockUncertain": "Idadi ya bidhaa hii inaweza kuwa si sahihi ukiwa nje ya mtandao. Mauzo yanaruhusiwa na yataonyeshwa kwa mmiliki.",
    "offline.saleMarker": "Yaliuzwa bila mtandao",
    "offline.salePending": "Bado hayajasawazishwa",
    "offlineReport.eyebrow": "Yaliyouzwa wakati wa hitilafu ya mtandao",
    "offlineReport.title": "Yaliyouzwa Bila Mtandao",
    "offlineReport.none": "Hakuna mauzo yaliyorekodiwa bila mtandao katika kipindi hiki.",
    "offlineReport.note": "Hesabu za hisa za bidhaa hizi hazijathibitishwa hadi kila moja itakapokuwa na mwendo mwingine ikiwa mtandaoni. Hesabu hasi inamaanisha kuwa kiasi kilichouzwa kilizidi kile kilichodhaniwa kuwepo rafuni.",
    "offlineReport.colProduct": "Bidhaa",
    "offlineReport.colUnits": "Vipimo vilivyouzwa bila mtandao",
    "offlineReport.colValue": "Thamani",
    "offlineReport.colOnHand": "Zilizopo sasa",
    "offlineReport.salesCount": "Mauzo {count} bila mtandao",
    "error.offline": "Hakuna muunganisho wa intaneti, hivyo hii haikuhifadhiwa. Angalia mtandao kisha jaribu tena.",
    "error.timeout": "Muunganisho ni wa polepole sana kukamilisha hili. Tafadhali jaribu tena.",
    "error.permissionDenied": "Akaunti yako hairuhusiwi kufanya hili. Muulize mmiliki wa biashara.",
    "error.busy": "Mfumo una shughuli nyingi kwa sasa. Subiri kidogo kisha jaribu tena.",
    "error.contention": "Mtu mwingine amebadilisha hili wakati mmoja. Tafadhali jaribu tena.",
    "error.notFound": "Rekodi hiyo haipo tena. Onyesha upya kisha jaribu tena.",
    "error.failedPrecondition": "Hili halikuweza kukamilika. Onyesha upya kisha jaribu tena.",
    "toast.discountClearedCartChanged": "Kikapu kimebadilika, hivyo punguzo limeondolewa. Liweke tena kama bado linafaa.",
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
    "toast.paymentMethodInvalid": "Chagua jinsi malipo yalivyofanyika.",
    "shift.heading": "Zamu na fedha",
    "shift.openButton": "Fungua zamu",
    "shift.closeButton": "Funga zamu",
    "shift.floatLabel": "Fedha za kuanzia",
    "shift.countedLabel": "Fedha zilizohesabiwa",
    "shift.noteLabel": "Maelezo (hiari)",
    "shift.openedBy": "Imefunguliwa na {name}",
    "shift.noneOpen": "Hakuna zamu iliyo wazi kwenye kaunta hii",
    "shift.closeLockedToOpener": "{name} alifungua droo hii na ndiye anayeihesabu. Meneja anaweza kuifunga kama ameondoka.",
    "shift.expected": "Inayotarajiwa kwenye droo",
    "shift.over": "zaidi",
    "shift.short": "pungufu",
    "shift.variance": "Tofauti",
    "shift.historyHeading": "Zamu za hivi karibuni",
    "shift.reconciled": "Dhidi ya mauzo",
    "shift.reconcileOk": "Inalingana",
    "shift.reconcileMismatch": "{amount} hazijaelezwa",
    "shift.reconcileMismatchHelp": "Kumbukumbu ya mauzo ya zamu hii hailingani na takwimu zilizotumika kuifunga. Inafaa kuuliza kabla ya kuhitimisha lolote.",
    "shift.reconcileUnknown": "Haijakaguliwa — zamu hii ni ya zamani kuliko historia ya mauzo iliyopakiwa hapa.",
    "shift.balanced": "Sawa kabisa",
    "shift.selectStore": "Chagua tawi moja ili kuendesha zamu",
    "toast.selectStoreBeforeShift": "Chagua tawi moja kabla ya kufungua zamu.",
    "toast.shiftOpened": "Zamu imefunguliwa na {float} kwenye droo.",
    "toast.shiftOpenFailed": "Imeshindwa kufungua zamu. Tafadhali jaribu tena.",
    "toast.shiftCloseFailed": "Imeshindwa kufunga zamu. Tafadhali jaribu tena.",
    "toast.noOpenShift": "Hakuna zamu iliyo wazi kwenye kaunta hii.",
    "toast.shiftBalanced": "Zamu imefungwa. Droo imelingana kabisa.",
    "toast.shiftVariance": "Zamu imefungwa. Droo ina {amount} {direction}.",
    "txerror.shiftAlreadyOpen": "Tayari kuna zamu iliyo wazi kwenye kaunta hii.",
    "txerror.shiftAlreadyClosed": "Zamu hiyo tayari imefungwa.",
    "payment.methodLabel": "Imelipwa kwa",
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
    "customers.colCreditLimit": "Tahadhari ya Deni",
    "customers.setLimitButton": "Weka Tahadhari",
    "customers.noLimit": "Hakuna tahadhari",
    "dialog.creditLimitPrompt": "Toa tahadhari {name} anapodaiwa zaidi ya kiasi hiki, kwa {currency}. Mauzo zaidi ya hapo yanahitaji nenosiri la meneja. Acha wazi kama hakuna tahadhari:",
    "toast.creditLimitInvalid": "Weka kikomo sahihi cha deni, au acha wazi kama hakuna kikomo.",
    "toast.creditLimitSet": "Kikomo cha deni cha {name} kimewekwa kuwa {limit}.",
    "toast.creditLimitCleared": "Kikomo cha deni cha {name} kimeondolewa.",
    "toast.creditLimitFailed": "Imeshindwa kusasisha tahadhari ya deni. Tafadhali jaribu tena.",
    "toast.creditLimitOverrideRefused": "Hujaidhinishwa. Mauzo hayakukamilika.",
    "control.creditOverrides": "Tahadhari za deni zilizopitishwa (siku 30)",
    "dialog.creditLimitExceededConfirm": "{name} tayari anadaiwa {currentBalance}. Mauzo haya yanaongeza {newBalanceDue}, hadi {projectedTotal} — zaidi ya tahadhari ya {limit}. Kuendelea kunahitaji nenosiri la meneja, na kutarekodiwa. Uendelee?",
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
    "staff.colName": "Jina",
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
  // A placeholder is not an accessible name: screen readers may ignore it, and
  // it disappears the moment there is text in the field. Seven inputs had
  // nothing else, so they announced as unlabelled. Translated like every other
  // string -- an English-only aria-label in a Swahili UI is its own bug.
  qsa("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel));
  });
  const langButton = qs("#langToggleButton");
  if (langButton) langButton.textContent = t("topbar.langToggle");
}

function setLanguage(nextLanguage) {
  state.language = nextLanguage;
  try {
    localStorage.setItem("savia:lang", nextLanguage);
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

// Short, and deliberately far shorter than the AI timeout. This call sits on
// the SALE path -- checkCreditLimitBeforeSale() awaits it after Complete Sale
// has already been disabled -- so its worst case is a till that cannot sell.
// The Render free tier sleeps after about fifteen minutes idle and takes tens
// of seconds to wake, and a bare fetch() has no timeout at all, so a credit
// sale over the limit against a cold proxy froze the button for as long as the
// browser's default allowed: minutes, with a queue at the counter.
//
// Failing closed here is correct. A refused override refuses one sale; a frozen
// till refuses all of them.
const OVERRIDE_VERIFY_TIMEOUT_MS = 8000;

async function verifyOverridePassword() {
  const input = window.prompt(t("dialog.overridePasswordPrompt"));
  if (input === null) return false;
  try {
    const token = await state.user.getIdToken();
    const response = await fetch(aiConfig.overrideVerifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ code: input }),
      signal: AbortSignal.timeout(OVERRIDE_VERIFY_TIMEOUT_MS)
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
    // A timeout and a dead network read the same to the cashier and have the
    // same answer: the override could not be checked, so it was not granted.
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
  // <= 0, not === 0. Since phase A a shelf can hold a negative count, and
  // dividing a negative quantity by demand produced a NEGATIVE number of days
  // until stockout -- for the one product that has most certainly already run
  // out. The shelf being past empty is still "no days left", not "-3 days".
  const daysUntilStockout = quantity <= 0 ? 0 : Math.floor(quantity / Math.max(dailyDemand, 0.1));
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
    [t("movement.fastMoving"), products.filter((p) => productUnitsSold(p, 30) >= 50).length, "#5ed08f"],
    [t("movement.slowMoving"), products.filter((p) => productUnitsSold(p, 30) > 0 && productUnitsSold(p, 30) < 12).length, "#f1b44c"],
    [t("movement.noSales"), products.filter((p) => productUnitsSold(p, 90) === 0).length, "#ef6666"],
    [t("movement.healthyCoverage"), products.filter((p) => stockStatus(p) === "healthy").length, "#6aa7ff"]
  ];
  qs("#movementList").innerHTML = classes
    .map(([label, value, color]) => `<div class="movement-row"><strong style="color:${color}">${value}</strong><span>${label}</span></div>`)
    .join("") + stockLedgerSummaryHtml();
}

// The L-2 control, surfaced. Owner-only, and silent when there is nothing to
// say: no ledger loaded, or nothing checked, renders nothing at all rather than
// a reassuring tick. A shelf that has not moved since the ledger began cannot
// be verified, and saying so in a dashboard tile would be noise -- the finding
// is the disagreement, and only the disagreement.
function stockLedgerSummaryHtml() {
  if (!isOwnerRole()) return "";
  const gaps = stockLedgerDiscrepancies();
  if (gaps === null) return "";
  if (!gaps.length) return "";
  const worst = [...gaps].sort((a, b) => Math.abs(b.result.gap) - Math.abs(a.result.gap))[0];
  return `<div class="movement-row"><strong style="color:#ef6666">${gaps.length}</strong><span>${
    esc(t("movement.ledgerGaps", {
      name: worst.product.name || "",
      units: Math.abs(Math.round(worst.result.gap))
    }))
  }</span></div>`;
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

// Whether the inventory list is being narrowed by anything the user chose.
// An empty table means something different when a filter is on: there IS stock,
// it just does not match. Telling someone "no inventory yet, add your first
// product" while they hold five hundred is the same class of lie as saying it
// while the catalogue is still loading.
function inventoryFiltersActive() {
  return Boolean(qs("#globalSearch")?.value.trim())
    || (qs("#categoryFilter")?.value || "all") !== "all"
    || (qs("#stockFilter")?.value || "all") !== "all";
}

// The four things an empty inventory table can mean, which are not the same
// thing and must not share a message: the load failed, the load has not
// finished, a filter excluded everything, or the shop genuinely has no stock.
// Only the last one should invite an owner to start adding products.
function inventoryEmptyMessage() {
  if (state.productsLoadFailed) return t("inventory.loadFailedState");
  if (!state.productsInitialized) return t("inventory.loadingState");
  if (inventoryFiltersActive()) return t("inventory.noMatchesState");
  return t("inventory.emptyState");
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
    // "No inventory yet. Add your first product" is the correct message for an
    // empty shop and a badly wrong one for a shop still loading. A 10,000-SKU
    // catalogue is 4.55 MB on the wire (measured, L-8), which on a mobile link
    // is tens of seconds of an owner being told their stock is gone and invited
    // to re-enter it. Distinguish the two: until the first snapshot lands,
    // nothing is known, and saying so is the honest answer.
    .join("") || `<tr><td colspan="8" class="empty-state">${esc(inventoryEmptyMessage())}</td></tr>`;
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
    // A blank POS during first sync is not misleading the way the inventory
    // empty state was, but it is still silence at the moment a cashier is
    // waiting to ring something up. Only while the catalogue is still arriving:
    // a genuinely empty search result stays blank, as it should.
    .join("") || (state.productsInitialized ? "" : `<p class="muted">${esc(t("inventory.loadingState"))}</p>`);
}

function cartSubtotal() {
  return state.cart.reduce((sum, item) => sum + item.qty * Number(item.sellingPrice || 0), 0);
}

// Rounded to whole currency units, because a shilling has no working subunit
// and a drawer holds notes and coins, not fractions.
//
// Unrounded, 10%% off 1,333 gave a discount of 133.3 and a total of 1,199.7 --
// an amount that cannot be paid. Change came back as 0.2999999999999545, and
// worse, expected cash at shift close accumulated the fractions: a cashier who
// counted the drawer perfectly still recorded a variance, so the reconciliation
// feature could never balance once a percentage discount had been used.
//
// The refund path already rounded (see processReturn), so the same money was
// being treated two different ways depending on which way it moved. It is one
// way now.
//
// If a currency with a real subunit is ever added, this is the line that has to
// change, along with the rounding in processReturn.
function computeDiscountAmount(subtotal) {
  if (state.discountType === "percent") {
    return Math.round(Math.min(subtotal, subtotal * (Number(state.discountValue || 0) / 100)));
  }
  if (state.discountType === "fixed") {
    return Math.round(Math.min(subtotal, Number(state.discountValue || 0)));
  }
  return 0;
}

function clearDiscount() {
  state.discountType = "none";
  state.discountValue = 0;
  state.discountBasis = 0;
}

// ---------------------------------------------------------------------------
// VAT. Full rationale in DESIGN-vat.md; the parts that matter at the call site:
//
//   - Prices are INCLUSIVE. The shelf price is what is paid and the tax is
//     extracted from inside it, which is how Tanzanian retail quotes prices and
//     is what keeps the payable amount a whole shilling.
//   - `net` is always derived by SUBTRACTION from the amount charged, never by
//     rounding on its own. Round both independently and net + vat stops equal-
//     ling the total, which is a VAT return that does not reconcile to takings.
//   - zeroRated and exempt both carry no tax and are still not the same thing:
//     zero-rated supplies are taxable at 0% and count toward taxable turnover,
//     exempt supplies do not. That is the whole reason there are three classes
//     and not a boolean.
const VAT_RATE = 0.18;
const TAX_CLASSES = ["standard", "zeroRated", "exempt"];

function taxClassOf(product) {
  return TAX_CLASSES.includes(product?.taxClass) ? product.taxClass : "standard";
}

function vatFromInclusive(inclusiveAmount) {
  const amount = Number(inclusiveAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount * VAT_RATE) / (1 + VAT_RATE));
}

// A basket-level discount has to be spread across the lines BEFORE any tax is
// extracted, or a discount on a zero-rated item would reduce the VAT owed on a
// standard-rated one. Largest remainder, so the parts sum to exactly the
// discount -- apportioning each line independently and rounding leaves a
// residue, and the residue is a total that disagrees with its own lines.
function apportionDiscount(lineAmounts, discountAmount) {
  const subtotal = lineAmounts.reduce((sum, amount) => sum + amount, 0);
  const discount = Math.min(Math.max(Number(discountAmount || 0), 0), subtotal);
  if (subtotal <= 0 || discount <= 0) return lineAmounts.map(() => 0);

  const exact = lineAmounts.map((amount) => (amount * discount) / subtotal);
  const shares = exact.map(Math.floor);
  let remaining = discount - shares.reduce((sum, share) => sum + share, 0);

  // The leftover shillings go to the lines with the largest fractional claim,
  // which is what stops a rounding bias always favouring the first line.
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; remaining > 0 && i < byFraction.length; i++) {
    shares[byFraction[i].index] += 1;
    remaining -= 1;
  }
  return shares;
}

// lines: [{ inclusive, taxClass }]. Returns whole shillings throughout, with
// netTotal + taxTotal === total guaranteed for every input.
function computeSaleTax(lines, discountAmount = 0) {
  const amounts = lines.map((line) => Math.max(0, Math.round(Number(line.inclusive || 0))));
  const shares = apportionDiscount(amounts, discountAmount);

  const breakdown = {
    standard: { net: 0, vat: 0 },
    zeroRated: { net: 0, vat: 0 },
    exempt: { net: 0, vat: 0 }
  };

  let total = 0;
  lines.forEach((line, index) => {
    const charged = amounts[index] - shares[index];
    const taxClass = TAX_CLASSES.includes(line.taxClass) ? line.taxClass : "standard";
    const vat = taxClass === "standard" ? vatFromInclusive(charged) : 0;
    breakdown[taxClass].vat += vat;
    breakdown[taxClass].net += charged - vat;
    total += charged;
  });

  const taxTotal = breakdown.standard.vat + breakdown.zeroRated.vat + breakdown.exempt.vat;
  return { total, taxTotal, netTotal: total - taxTotal, breakdown, vatRate: VAT_RATE };
}

// A fixed discount is authorised against one basket and stays applied while the
// basket changes underneath it. computeDiscountAmount caps it at the subtotal,
// so shrinking the cart quietly turns "50,000 off 60,000" into a 100% discount:
// remove the expensive line, add a cheap one, and the total is zero on a sale
// record that looks ordinary. The override password -- the control that exists
// to stop unauthorised discounting -- was satisfied once, for different goods.
//
// So a fixed discount is tied to the subtotal it was granted against, and
// dropping below that requires re-authorisation. Percent discounts scale with
// the basket and carry no such exposure, so they are deliberately left alone
// rather than adding friction to the common case.
function revalidateDiscountForCart() {
  if (state.discountType !== "fixed") return false;
  if (cartSubtotal() >= Number(state.discountBasis || 0)) return false;
  clearDiscount();
  const select = qs("#discountTypeSelect");
  if (select) select.value = "none";
  const row = qs("#discountValueRow");
  if (row) row.hidden = true;
  showToast(t("toast.discountClearedCartChanged"));
  return true;
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
  // The basket this discount was authorised against. Only meaningful for fixed
  // discounts; percent scales on its own.
  state.discountBasis = type === "fixed" ? cartSubtotal() : 0;
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
  // Runs before the totals are read, so a discount that no longer fits the
  // basket is gone by the time anything is displayed or charged. Re-enters
  // renderCart at most once: clearing sets discountType to "none", which the
  // guard returns on immediately.
  if (revalidateDiscountForCart()) {
    renderCart();
    return;
  }
  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const subtotal = cartSubtotal();
  const discountAmount = computeDiscountAmount(subtotal);
  // Settled here as well: a unit price entered with a fraction would otherwise
  // carry one into the total by a different route than the discount.
  const totalAmount = Math.round(Math.max(0, subtotal - discountAmount));

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

// What a sale ultimately contributed, after anything given back.
//
// Three surfaces netted refunds out and eight did not, so the same trading day
// read differently depending on which tab you were looking at: sell 100,000,
// refund 40,000, and the owner's control panel said 60,000 while the revenue
// chart on the next tab said 100,000. Voids were already excluded everywhere,
// which is what made the inconsistency hard to spot -- the obvious case behaved.
//
// Every revenue figure now comes through here. summariseSales() keeps its own
// gross/net pair because it reports both deliberately; this is the same
// arithmetic, named once.
function saleNetTotal(sale) {
  if (!sale || sale.voided) return 0;
  return safeNumber(sale.total) - safeNumber(sale.refundedAmount);
}

function saleAmountForMethod(sale, method) {
  const paymentMethod = sale.paymentMethod || "cash";
  if (paymentMethod === "credit") {
    // Only the portion actually received (amountPaid) counts toward a
    // cash/mobile/card bucket; the remaining balanceDue is a receivable,
    // tracked separately in Customer Accounts, not "revenue by method".
    const paidMethod = sale.amountPaidMethod || "cash";
    return paidMethod === method ? safeNumber(sale.amountPaid) : 0;
  }
  // Netted: the money went back the way it came. Credit above deliberately does
  // not net, because a refund there reduces the receivable rather than the cash
  // that was handed over -- the same choice summariseSales() makes for
  // drawerCash, mirrored rather than reinvented.
  return paymentMethod === method ? saleNetTotal(sale) : 0;
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

  const revenue = scopedSales.reduce((sum, sale) => sum + saleNetTotal(sale), 0);
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
  return postToAiProxy([{ role: "user", content: promptLines.join("\n") }], { products: [], metrics: {} }, "report");
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

// These four libraries used to load as plain parser-blocking <script> tags on
// every page load: 552 KB gzipped, 1.66 MB parsed. Measured on desktop
// broadband, that cost 1.8s of main-thread parse between domInteractive and
// DOMContentLoaded, and a phone parses JS several times slower than the machine
// those numbers came from.
//
// None of it is needed to open a till. xlsx alone is 315 KB gzipped and exists
// to write a spreadsheet an owner exports occasionally -- every cashier paid
// for it at every shift start. They now load the first time something actually
// needs them.
//
// The SRI hashes travel with the URLs. Do not separate them: they are the only
// thing standing between a compromised CDN and arbitrary code in the till.
const EXTERNAL_LIBRARIES = {
  xlsx: [{
    global: "XLSX",
    url: "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
    integrity: "sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw"
  }],
  // Ordered, not parallel: the autotable plugin attaches itself to an already
  // loaded jsPDF, so racing them leaves the plugin with nothing to attach to.
  pdf: [{
    global: "jspdf",
    url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
    integrity: "sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk"
  }, {
    url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
    integrity: "sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3"
  }],
  scanner: [{
    global: "Html5Qrcode",
    url: "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js",
    integrity: "sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+"
  }]
};

const externalLibraryLoads = new Map();

function loadScriptOnce(spec) {
  if (spec.global && window[spec.global]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = spec.url;
    script.integrity = spec.integrity;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.onload = () => resolve();
    // Fires for a network failure AND for an SRI hash mismatch, which is the
    // case worth caring about: a tampered file is refused rather than run.
    //
    // The dead tag is taken back out because the load is deliberately retried
    // (see loadExternalLibrary). A shop that keeps trying to export while the
    // connection is down would otherwise leave one more unusable <script> in
    // the head on every attempt, for the life of the session.
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${spec.url}`));
    };
    document.head.appendChild(script);
  });
}

function loadExternalLibrary(name) {
  if (!externalLibraryLoads.has(name)) {
    const load = (async () => {
      for (const spec of EXTERNAL_LIBRARIES[name]) await loadScriptOnce(spec);
    })().catch((error) => {
      // A failed load is deliberately NOT cached. On the connections this app
      // runs over, one dropped request must not disable exporting until the
      // page is reloaded -- the next attempt retries.
      externalLibraryLoads.delete(name);
      throw error;
    });
    externalLibraryLoads.set(name, load);
  }
  return externalLibraryLoads.get(name);
}

// The scanner is the one lazy library on the cashier's hot path: opened
// mid-sale, at the till, with a customer waiting. Measured cold it costs about
// 2.9s to fetch -- fine for an owner exporting a PDF, not fine for the first
// scan of a shift.
//
// So it alone is warmed once the app has gone quiet. The exports deliberately
// are not: keeping 431 KB of xlsx and jsPDF off a cashier's phone is the whole
// point of this change, and an export is chosen from a menu where a short wait
// reads as the export starting.
//
// Skipped on a metered or slow connection. Data costs real money to the shops
// running this, and someone on 2G is better served by a fast till than by a
// scanner that is ready three seconds sooner. Failure is swallowed: this is an
// optimisation, and openBarcodeScanner still loads and reports for itself.
function prewarmScannerWhenIdle() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData) return;
  if (/(^|-)2g$/.test(connection?.effectiveType || "")) return;

  const warm = () => { loadExternalLibrary("scanner").catch(() => {}); };
  // requestIdleCallback keeps this off the critical path; the timeout is the
  // fallback for Safari, which still does not implement it.
  if (typeof requestIdleCallback === "function") requestIdleCallback(warm, { timeout: 10000 });
  else setTimeout(warm, 4000);
}

// Returns false and tells the user, so callers keep the early-return shape the
// old `if (!window.XLSX)` guards had.
async function ensureLibrary(name, failureKey) {
  try {
    await loadExternalLibrary(name);
    return true;
  } catch (error) {
    console.warn(error);
    showToast(t(failureKey));
    return false;
  }
}

async function exportMonthlyReportPdf() {
  const report = state.monthlyReports.find((item) => item.id === state.openMonthlyReportId);
  if (!report) return;
  if (!(await ensureLibrary("pdf", "toast.pdfLibraryFailed"))) return;
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const metrics = report.metrics || {};
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text(`SaviaSmart Monthly Report \u2014 ${report.periodLabel}`, 14, 16);
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

  doc.save(`savia-monthly-report-${report.periodLabel}.pdf`);
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

  // Checked BEFORE the empty-month check, because an uncovered month reports
  // zero transactions and "no sales data" would be a confident lie about a
  // month the shop traded.
  //
  // subscribeToSales() holds the newest SALES_HISTORY_LIMIT sales. At 50 sales
  // a day that is twenty trading days, so by the 25th of a busy month the
  // previous month has already fallen out of view. What made this urgent rather
  // than untidy is what happens next: the metrics are narrated by the AI and
  // written to monthlyReports as an authoritative record, so an understated
  // revenue figure -- and the understated VAT liability filed against it --
  // becomes the stored truth, and the owner has no way to tell.
  //
  // salesCoverageFromMs() was built for exactly this and only the shift
  // reconciliation was asking it.
  const coverage = salesCoverageFromMs();
  if (coverage !== null && metrics.periodStart.getTime() < coverage) {
    return showToast(t("toast.reportPeriodBeyondHistory",
      { date: new Date(coverage).toLocaleDateString() }));
  }

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

// The VAT return, over whatever range the reports view is showing.
//
// Two things this deliberately does NOT do. It does not recompute tax from the
// items: each sale carries the tax it was rung up with, at the rate in force
// then, and re-deriving it would silently re-rate last year's trading if TRA
// ever moves the rate. And it does not treat a sale from before registration as
// zero-rated -- those sales are OUTSIDE the scheme, not taxed at nothing, so
// they are counted and named separately rather than folded into the return.
//
// Zero-rated and exempt are reported apart because they are different lines:
// zero-rated supplies are taxable at 0% and belong in taxable turnover, exempt
// supplies do not.
function computeVatReport() {
  const sales = filteredSales().filter((sale) => !sale.voided);
  const inScheme = sales.filter((sale) => sale.vatRegistered === true);
  const outsideScheme = sales.length - inScheme.length;

  const totals = { standard: { net: 0, vat: 0 }, zeroRated: { net: 0 }, exempt: { net: 0 } };
  let netTotal = 0;
  let taxTotal = 0;

  for (const sale of inScheme) {
    const b = sale.taxBreakdown || {};
    totals.standard.net += safeNumber(b.standard?.net);
    totals.standard.vat += safeNumber(b.standard?.vat);
    totals.zeroRated.net += safeNumber(b.zeroRated?.net);
    totals.exempt.net += safeNumber(b.exempt?.net);
    netTotal += safeNumber(sale.netTotal);
    taxTotal += safeNumber(sale.taxTotal);
  }

  // The same boundary, stated rather than enforced. A VAT panel that refused to
  // render would be worse than one that renders and says what it cannot see --
  // the owner still needs the figure for the part that IS covered.
  const boundary = salesCoverageFromMs();
  const { start } = getSalesRangeBounds();
  const coverageComplete = boundary === null || (start !== null && start.getTime() >= boundary);

  return {
    totals,
    netTotal,
    taxTotal,
    coverageComplete,
    coverageBoundary: boundary,
    // What TRA asks for: standard-rated plus zero-rated. Exempt supplies are
    // not taxable turnover and are excluded here on purpose.
    taxableTurnover: totals.standard.net + totals.zeroRated.net,
    saleCount: inScheme.length,
    outsideScheme
  };
}

function renderVatReport() {
  const panel = qs("#vatReportPanel");
  if (!panel) return;
  panel.hidden = !vatSettings().registered;
  if (panel.hidden) return;

  const r = computeVatReport();
  const due = qs("#vatReportDue");
  if (due) due.textContent = money(r.taxTotal);

  const summary = qs("#vatReportSummary");
  if (!summary) return;
  summary.innerHTML = `
    <div class="payment-summary-row"><strong>${t("report.vatDue")}</strong><strong>${money(r.taxTotal)}</strong></div>
    <div class="payment-summary-row"><span>${t("report.vatNet")}</span><span>${money(r.netTotal)}</span></div>
    <div class="payment-summary-row"><span>${t("report.vatStandard")}</span><span>${money(r.totals.standard.net)}</span></div>
    <div class="payment-summary-row"><span>${t("report.vatZeroRated")}</span><span>${money(r.totals.zeroRated.net)}</span></div>
    <div class="payment-summary-row"><span>${t("report.vatExempt")}</span><span>${money(r.totals.exempt.net)}</span></div>
    <div class="payment-summary-row"><strong>${t("report.vatTaxableTurnover")}</strong><strong>${money(r.taxableTurnover)}</strong></div>
    <div class="payment-summary-row"><span>${t("report.totalTransactions")}</span><span>${r.saleCount}</span></div>
    ${r.outsideScheme > 0
      ? `<div class="payment-summary-row muted"><span>${t("report.vatOutsideNote", { count: String(r.outsideScheme) })}</span><span></span></div>`
      : ""}
    ${!r.coverageComplete
      ? `<div class="payment-summary-row"><strong>${t("report.vatCoverageIncomplete", { date: new Date(r.coverageBoundary).toLocaleDateString() })}</strong><span></span></div>`
      : ""}
  `;
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
  renderOfflineSalesReport();
  renderVatReport();
  renderTopCustomers();
  renderStaffOrderLookupSelect();
  renderCustomerAccounts();
}

// Sales rung up during an outage, grouped by the product whose count they made
// doubtful (L-9 phase D).
//
// Grouped by product rather than listed by sale because the product is what the
// owner can act on: the answer to this report is walking to that shelf and
// counting it. A list of sales would say the same thing in a form nobody can
// use.
//
// One pass over the filtered sales, accumulating into a Map, rather than a
// per-product scan. The movement panel's O(products x sales) regression is the
// reason that distinction is spelled out here instead of left to taste.
function computeOfflineSalesReport() {
  const offlineSales = filteredSales().filter((sale) => sale.madeOffline === true);
  const byProduct = new Map();
  let total = 0;

  offlineSales.forEach((sale) => {
    total += Number(sale.total || 0);
    (sale.items || []).forEach((item) => {
      // Cart items carry the product's own id (see the note on productRefs in
      // completeSale) -- a sale item's productId is written from it, so the
      // fallback keeps a legacy item joinable rather than dropping it.
      const productId = item.productId || item.id || "";
      if (!byProduct.has(productId)) {
        byProduct.set(productId, { productId, name: item.name || t("report.none"), units: 0, value: 0 });
      }
      const entry = byProduct.get(productId);
      entry.units += Number(item.qty || 0);
      entry.value += Number(item.lineTotal || 0);
    });
  });

  const rows = [...byProduct.values()]
    .map((entry) => {
      const product = state.products.find((candidate) => candidate.id === entry.productId);
      // null, not 0, when the product is unknown to this device: a shelf we
      // cannot see is not a shelf holding nothing, and the same distinction the
      // inventory table now makes for a loading shop applies here.
      return { ...entry, onHand: product ? Number(product.quantity || 0) : null };
    })
    .sort((a, b) => b.units - a.units);

  return { rows, total, saleCount: offlineSales.length };
}

function renderOfflineSalesReport() {
  const container = qs("#offlineSalesReport");
  const totalLabel = qs("#offlineSalesTotal");
  if (!container) return;

  const { rows, total, saleCount } = computeOfflineSalesReport();
  if (totalLabel) totalLabel.textContent = rows.length ? money(total) : "";

  if (!rows.length) {
    container.innerHTML = `<p class="muted">${t("offlineReport.none")}</p>`;
    return;
  }

  const body = rows
    .map((row) => `<tr>
      <td>${esc(row.name)}</td>
      <td>${row.units}</td>
      <td>${money(row.value)}</td>
      <td>${row.onHand === null ? "-" : row.onHand}</td>
    </tr>`)
    .join("");

  container.innerHTML = `
    <p class="muted">${t("offlineReport.salesCount", { count: saleCount })}</p>
    <div class="table-panel" style="box-shadow:none;border:none">
      <table>
        <thead>
          <tr>
            <th>${t("offlineReport.colProduct")}</th>
            <th>${t("offlineReport.colUnits")}</th>
            <th>${t("offlineReport.colValue")}</th>
            <th>${t("offlineReport.colOnHand")}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="muted">${t("offlineReport.note")}</p>
  `;
}

function computeStoreBreakdown() {
  const sales = filteredSales();
  return state.stores
    .map((store) => {
      const storeSales = sales.filter((sale) => saleStoreId(sale) === store.id);
      const total = storeSales.reduce((sum, sale) => sum + saleNetTotal(sale), 0);
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
    buckets.set(key, (buckets.get(key) || 0) + saleNetTotal(sale));
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
      byStaff.set(key, { staffName: sale.staffName || t("report.none"), cash: 0, mobile: 0, card: 0, collected: 0, net: 0, orders: 0 });
    }
    const entry = byStaff.get(key);
    // Two different questions, and collapsing them into one "Total" column was
    // read as an arithmetic error: the row's total counted the whole value of a
    // credit sale while its cash/mobile/card columns held only the deposit, so
    // the row visibly did not add up. It is a real distinction -- sold is not
    // collected -- so it is now two columns rather than one ambiguous number.
    for (const method of ["cash", "mobile", "card"]) {
      entry[method] += saleAmountForMethod(sale, method);
    }
    entry.collected = entry.cash + entry.mobile + entry.card;
    // Net of anything given back. Judged on the gross figure, a commission
    // rewarded goods that came back.
    entry.net += saleNetTotal(sale);
    entry.orders += 1;
  });
  return [...byStaff.values()].sort((a, b) => b.net - a.net);
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
      collected: acc.collected + row.collected,
      net: acc.net + row.net,
      orders: acc.orders + row.orders
    }),
    { cash: 0, mobile: 0, card: 0, collected: 0, net: 0, orders: 0 }
  );

  const bodyRows = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.staffName)}</td>
        <td>${money(row.cash)}</td>
        <td>${money(row.mobile)}</td>
        <td>${money(row.card)}</td>
        <td>${money(row.collected)}</td>
        <td><strong>${money(row.net)}</strong></td>
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
        <td><strong>${money(totals.collected)}</strong></td>
        <td><strong>${money(totals.net)}</strong></td>
        <td><strong>${totals.orders}</strong></td>
      </tr>`
    : "";

  tbody.innerHTML = bodyRows + totalRow || `<tr><td colspan="7" class="empty-state">${t("cart.empty")}</td></tr>`;
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
  // Two different facts, and collapsing them would hide the one that matters
  // longer (L-9 phase D). madeOffline is permanent: this sale was rung up
  // against a stock count nobody could verify, and it stays worth knowing for
  // as long as the record exists. pendingSync is temporary: it clears itself
  // the moment the server acknowledges the write. A sale can be either, both,
  // or -- once a queue has drained -- offline but fully synced.
  //
  // === true rather than truthiness: the rules do not constrain madeOffline's
  // type (see OFFLINE-CAPABILITIES.md), so a document could carry a string
  // there. Only the value this app actually writes earns the marker.
  const offlineMarker = sale.madeOffline === true
    ? `<div class="payment-summary-row"><span>${t("offline.saleMarker")}</span><span aria-hidden="true">&#9679;</span></div>`
    : "";
  const pendingMarker = state.pendingSaleIds.has(sale.id)
    ? `<div class="payment-summary-row"><span>${t("offline.salePending")}</span><span aria-hidden="true">&#9679;</span></div>`
    : "";
  return `<div class="staff-order-card">
    <div class="payment-summary-row"><strong>${t("reports.staffOrderLookupOrderLabel")}</strong><span>#${esc(sale.orderNumber || "")}</span></div>
    ${offlineMarker}${pendingMarker}
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
    staffId: saleIdentity().id,
    staffName: saleIdentity().name,
    createdAt: new Date().toISOString()
  };

  // Computed from the CLIENT cache, and used only on the offline/local branch
  // below. The Firestore path recomputes them from the server copy inside the
  // transaction -- see there for why.
  const nextReturns = [...(sale.returns || []), returnRecord];
  const nextRefundedAmount = Number(sale.refundedAmount || 0) + refundAmount;

  if (state.db && state.user && !String(saleId).startsWith("local-")) {
    try {
      const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
      await runTransaction(state.db, async (transaction) => {
        const saleRef = doc(state.db, "users", state.businessOwnerUid, "sales", saleId);
        // Read the sale BEFORE writing it. Without this read the update was
        // blind: Firestore had nothing to detect a conflict on for this
        // document, and the amounts were computed from the client cache outside
        // the callback -- so a retry rewrote the same stale values. Two managers
        // refunding the same sale concurrently both took cash out of the drawer
        // and the record showed one refund.
        //
        // The sale path already does exactly this, for the same reason: it
        // reads its own target id first so a retried submission cannot record
        // the sale twice.
        const saleSnap = await transaction.get(saleRef);
        const productRefs = selections.map((item) => doc(state.db, "users", state.businessOwnerUid, "products", item.productId));
        const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

        // Every read is complete before the first write -- Firestore requires
        // that ordering, and adding a read below a write fails the transaction.
        const serverData = saleSnap.exists() ? saleSnap.data() : {};
        const serverReturns = Array.isArray(serverData.returns) ? serverData.returns : [];
        const serverRefunded = Number(serverData.refundedAmount || 0);
        const saleTotal = Number(serverData.total ?? sale.total ?? 0);

        // The server, not the cache, decides whether there is anything left to
        // refund. The rules refuse an over-refund anyway (QA-105a), but a
        // rejected transaction tells the manager nothing useful; this names it.
        if (serverRefunded + refundAmount > saleTotal) {
          throw new Error("REFUND_EXCEEDS_REMAINING");
        }

        transaction.update(saleRef, {
          returns: [...serverReturns, returnRecord],
          refundedAmount: serverRefunded + refundAmount
        });

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
          recordStockMovement(transaction, {
            // Sales predating the storeId requirement still exist -- the void
            // and return rules both tolerate its absence with
            // `!('storeId' in before)`. Without this fallback a legitimate
            // return on an old sale cannot write its ledger entry, and the
            // entry is inside the transaction, so the return itself fails.
            // The current store is the best attribution available and is
            // certainly better than refusing the customer their refund.
            productId: item.productId, productName: item.name,
            storeId: sale.storeId || state.currentStoreId, reason: "return",
            delta: item.qty, quantityBefore: currentQuantity, saleId
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
      if (String(error?.message) === "REFUND_EXCEEDS_REMAINING") {
        showToast(t("toast.returnAlreadyRefunded"));
        return;
      }
      // describeOperationError, not the bare string (L-9 phase E). A return is
      // one of the paths that deliberately stays online-only, and the promise
      // made in OFFLINE-CAPABILITIES.md is that those refuse *honestly* -- the
      // message names the real cause. This one said "could not process the
      // return" whatever went wrong, so the single most likely cause in this
      // market, no signal, was the one it never mentioned. A cashier told that
      // in front of a customer retries it, and retries it again.
      showToast(describeOperationError(error, "toast.returnFailed"));
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
  link.download = "savia-payment-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function exportPaymentReportPdf() {
  const rows = buildPaymentReportRows();
  if (!(await ensureLibrary("pdf", "toast.pdfLibraryFailed"))) return;
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text("SaviaSmart Payment Report", 14, 16);
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
  doc.save("savia-payment-report.pdf");
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

  const fastMoving = products.filter((p) => productUnitsSold(p, 30) >= 50).length;
  const slowMoving = products.filter((p) => productUnitsSold(p, 30) > 0 && productUnitsSold(p, 30) < 12).length;
  const noSales = products.filter((p) => productUnitsSold(p, 90) === 0).length;

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

// Must not exceed MAX_MESSAGE_LENGTH in proxy/server.js. It was 2000 against a
// server that rejects at 700, so a long question was accepted, sent, and refused
// -- after a wait of up to 60 seconds on a cold proxy, for a limit nothing had
// mentioned. tests/validation-limits.test.mjs fails if the two drift again.
const AI_QUESTION_MAX_CHARS = 700;
// Mirrors the server's own cap (compactSnapshot slices products to 80). Sending
// more was doing two kinds of damage at once: at ~400+ products the body passed
// the proxy's 64kb limit and the whole request died with "Payload too large",
// and below that the surplus was simply parsed and thrown away -- up to 85% of
// a mobile upload, on connections where that is the user's own money.
const AI_SNAPSHOT_MAX_PRODUCTS = 80;
const AI_SNAPSHOT_MAX_SUPPLIERS = 30;
const AI_SNAPSHOT_MAX_PURCHASES = 30;

// WHICH 80 matters more than how many. The products subscription has no
// orderBy, so Firestore returns them by document id -- and product ids are
// UUIDs, so "the first 80" was an arbitrary sample. Any shop past 80 products
// was getting reorder advice computed from a random ~16% of its catalogue, with
// nothing in the answer admitting the rest existed. Rank by what the advice
// actually depends on, so the 80 that travel are the 80 worth reasoning about.
function aiProductPriority(product) {
  const quantity = Number(product.quantity || 0);
  const reorderLevel = Number(product.reorderLevel || 0);
  const sold30 = Number(product.sold30 || 0);
  if (quantity <= 0) return 3000000 + sold30;
  if (quantity <= reorderLevel) return 2000000 + sold30;
  return sold30;
}

function sanitizeAiMessages(messages) {
  return messages
    .filter((m) => typeof m.content === "string")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content.slice(0, AI_QUESTION_MAX_CHARS)
    }));
}

// Last line of defence on payload size. callAiProxy already ranks and caps, but
// this runs on every caller — including the monthly report path — so the cap is
// enforced here too rather than trusted upstream.
function sanitizeAiSnapshot(snapshot) {
  return {
    ...snapshot,
    products: Array.isArray(snapshot.products) ? snapshot.products.slice(0, AI_SNAPSHOT_MAX_PRODUCTS) : [],
    suppliers: Array.isArray(snapshot.suppliers) ? snapshot.suppliers.slice(0, AI_SNAPSHOT_MAX_SUPPLIERS) : [],
    purchases: Array.isArray(snapshot.purchases) ? snapshot.purchases.slice(0, AI_SNAPSHOT_MAX_PURCHASES) : []
  };
}

// `kind` selects the server-side usage bucket: "chat" for advisor questions the
// user types, "report" for month-end summaries. They are metered separately so
// a business that has spent its question allowance can still close its month.
async function postToAiProxy(messages, snapshot, kind = "chat") {
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
      body: JSON.stringify({ messages: sanitizeAiMessages(messages), snapshot: sanitizeAiSnapshot(snapshot), kind }),
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
    products: storeProducts()
      .map((product) => ({
        name: product.name,
        category: product.category,
        quantity: Number(product.quantity || 0),
        reorderLevel: Number(product.reorderLevel || 0),
        // Real windows, not the lifetime counters: the advisor is asked about
        // recent demand and these arrive under 30- and 90-day names. Feeding it
        // a three-year total labelled "sold30" is how a model ends up
        // confidently recommending a restock nobody needs. aiProductPriority()
        // ranks on these same values, so the 80 products that travel are now
        // chosen on real movement too.
        sold30: productUnitsSold(product, 30),
        sold90: productUnitsSold(product, 90),
        leadTimeDays: Number(product.leadTimeDays || 10)
      }))
      // Out of stock first, then at-or-below reorder level, then fastest
      // movers. Deterministic given the same data, which also keeps the cached
      // prompt prefix stable across turns of a conversation.
      .sort((a, b) => aiProductPriority(b) - aiProductPriority(a))
      .slice(0, AI_SNAPSHOT_MAX_PRODUCTS),
    metrics: calculateMetrics()
  });
}

async function askAi() {
  const question = qs("#aiQuestion").value.trim();
  if (!question) return;
  // maxlength stops this being reachable by typing or pasting, but the check
  // stays: silently truncating someone's question and answering the wrong one is
  // worse than telling them to shorten it. Caught here rather than after a
  // round trip to a proxy that may take a minute to wake.
  if (question.length > AI_QUESTION_MAX_CHARS) {
    showToast(t("toast.aiQuestionTooLong", { max: String(AI_QUESTION_MAX_CHARS) }));
    return;
  }
  qs("#aiQuestion").value = "";

  pushChatMessage({ role: "user", content: question });

  const tutorialTopic = matchTutorialTopic(question);
  if (tutorialTopic) {
    pushChatMessage({ role: "assistant", content: tutorialGuideText(tutorialTopic) });
    qs("#aiMode").textContent = t("ai.modeGuide");
    renderChatLog();
    return;
  }

  pushChatMessage({ role: "assistant", content: t("ai.analyzing") });
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

// Firestore and Auth failures arrive from the SDK carrying an English `message`
// and a machine-readable `code`. Preferring `message` put strings like "Missing
// or insufficient permissions" and "Failed to get document because the client is
// offline" in front of a cashier who may not read English and can act on
// neither. Errors the app raises itself are already translated -- they were
// built with t() -- and they carry no `code`, which is what tells the two apart
// without having to touch every throw site.
const SDK_ERROR_MESSAGE_KEYS = {
  "unavailable": "error.offline",
  "deadline-exceeded": "error.timeout",
  "permission-denied": "error.permissionDenied",
  "resource-exhausted": "error.busy",
  "aborted": "error.contention",
  "not-found": "error.notFound",
  "failed-precondition": "error.failedPrecondition"
};

function describeOperationError(error, fallbackKey) {
  // Being offline outranks whatever code the SDK attached: when there is no
  // connection, that is the only fact the operator can act on.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return t("error.offline");
  if (error && typeof error.code === "string") {
    return t(SDK_ERROR_MESSAGE_KEYS[error.code] || fallbackKey);
  }
  return (error && error.message) || t(fallbackKey);
}

function renderOfflineBanner() {
  const banner = qs("#offlineBanner");
  if (banner) banner.hidden = state.online !== false;
}

// The count of sales still sitting in the device's queue (L-9 phase D).
//
// This is deliberately NOT the same signal as the offline banner, and folding
// the two together would recreate the gap it exists to close. Connection state
// answers "can I sell right now"; the queue answers "did my earlier sales
// actually land". They separate in both directions -- a device can be back
// online with a queue still draining, and a long outage can end with nothing
// queued at all. The second case is the dangerous one: the cashier reconnects,
// the red banner disappears, and nothing ever confirms the six sales they rang
// up blind. A cashier who cannot answer that question stops trusting the till
// and starts keeping a paper list, which is the failure this whole feature was
// meant to prevent.
//
// It counts sales only, not the stock/ledger/audit writes that ride along with
// them, because a sale is the unit the cashier actually rang up and can count
// back. The four writes queue and replay together.
function renderUnsyncedSalesBanner() {
  const banner = qs("#unsyncedSalesBanner");
  const text = qs("#unsyncedSalesText");
  if (!banner || !text) return;
  const count = Number(state.unsyncedSaleCount || 0);
  banner.hidden = count <= 0;
  if (count > 0) {
    text.textContent = count === 1 ? t("offline.unsyncedOne") : t("offline.unsyncedMany", { count });
  }
}

function watchConnection() {
  const sync = () => {
    state.online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
    renderOfflineBanner();
    renderUnsyncedSalesBanner();
  };
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  sync();
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
  link.download = "savia-inventory.csv";
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
    // members and shifts were missing. members carries every staff member's
    // role and branch assignments, so a business restored without it comes back
    // with nobody able to sign in but the owner -- the backup would look
    // complete and the shop still could not open. shifts carries the cash
    // reconciliation history, which is the record an owner reconciles against
    // and the one thing here that cannot be reconstructed from anything else.
    //
    // errorLog is deliberately absent: it is diagnostic, not business data, and
    // restoring last month's faults would help nobody.
    const rootCollections = ["products", "sales", "stores", "staff", "members", "shifts",
                             "customers", "transfers", "auditLogs", "monthlyReports"];
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
      schemaVersion: 2,
      application: "SaviaSmart ERP",
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
    link.download = `savia-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  link.download = "savia-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function generateReportPdf() {
  const rows = buildReportRows();
  if (!rows.length) return showToast(t("toast.noInventoryData"));
  if (!(await ensureLibrary("pdf", "toast.pdfLibraryFailed"))) return;
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast(t("toast.pdfLibraryFailed"));
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text("SaviaSmart Inventory Report", 14, 16);
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
  doc.save("savia-report.pdf");
}

async function generateReportXlsx() {
  const rows = buildReportRows();
  if (!rows.length) return showToast(t("toast.noInventoryData"));
  if (!(await ensureLibrary("xlsx", "toast.excelLibraryFailed"))) return;
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
  window.XLSX.writeFile(workbook, "savia-report.xlsx");
}

function generateReport(format) {
  if (format === "csv") return generateReportCsv();
  if (format === "pdf") return generateReportPdf();
  if (format === "xlsx") return generateReportXlsx();
}

function normalizeCustomerPhoneKey(rawPhone) {
  return normalizeTzPhoneForWhatsApp(rawPhone);
}

// Deliberately NOT scoped to a store, and it used to be called with a
// state.currentStoreId argument this signature silently discarded. That dead
// argument looked like an unfinished intention; implementing it would have made
// the problem worse. state.customers is already narrowed by the rules to what
// this account may read, so narrowing again only widens the blind spot that
// QA-110 is about -- see checkCreditLimitBeforeSale().
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

  // A repayment in cash lands in the drawer; one on a phone does not. Without
  // this the expected-cash figure understates every till that takes debt
  // repayments, which is most of them.
  const paymentMethod = qs("#paymentMethodSelect")?.value || "cash";
  if (!["cash", "mobile", "card"].includes(paymentMethod)) {
    return showToast(t("toast.paymentMethodInvalid"));
  }
  // Attributed to the customer's own store rather than whatever is on screen,
  // so a manager viewing "all stores" cannot post a repayment to the wrong till.
  const paymentStoreId = customer.storeId || state.currentStoreId || null;

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
        transaction.set(paymentRef, {
          amount, note, method: paymentMethod, storeId: paymentStoreId,
          createdAt: serverTimestamp()
        });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        transaction.set(auditRef, {
          action: "PAYMENT_RECORDED",
          customerId,
          amount,
          method: paymentMethod,
          storeId: paymentStoreId,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
    } catch (error) {
      console.warn(error);
      showToast(describeOperationError(error, "toast.paymentFailed"));
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
  const existing = findCustomerByPhone(phoneKey);
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
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "SaviaSmart";
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

// The threshold is deliberately not a hard block. In this market a refused sale
// to a regular does not prevent the credit -- it moves it off the books, as
// cash or under a duplicate customer record, and the shop keeps the exposure
// while losing sight of it. What was missing was not prevention but
// accountability: any cashier could click through a plain confirm() and nothing
// recorded that they had.
//
// So crossing it now costs the same override password that authorises a price
// override, and the crossing is written to the audit log with the numbers that
// justified it. A cashier alone can no longer extend credit past the ceiling,
// and the owner can see who decided to.
//
// Returns a decision object rather than a boolean because the caller has to
// record WHY it proceeded, not just that it did.
async function checkCreditLimitBeforeSale(customerName, phoneKey, newBalanceDue) {
  const existing = findCustomerByPhone(phoneKey);

  // Two different situations used to return the same silent "allowed".
  //
  // The customer is not visible to this account (QA-110). Customer documents
  // are gated on memberCanAccessStore, so a Branch-B cashier simply cannot see
  // a Branch-A customer -- the lookup misses, and the ceiling was defeated by
  // walking to another branch. The client cannot tell that apart from a genuine
  // new customer, and it must not refuse the sale on a guess, so it proceeds
  // and says plainly that the check did not happen.
  if (!existing) {
    return { allowed: true, overridden: false, limitChecked: false, uncheckedReason: "customer-not-visible" };
  }

  // No ceiling has ever been set for them (QA-120). Cashiers can create
  // customers, so this is the default for every credit account made at the
  // till: unlimited credit, previously with nothing recorded anywhere.
  const limit = existing.creditLimit;
  if (limit == null) {
    return {
      allowed: true, overridden: false, limitChecked: false, uncheckedReason: "no-limit-set",
      customerId: existing.id || null,
      previousBalance: Number(existing.balanceOwed || 0)
    };
  }

  const currentBalance = Number(existing.balanceOwed || 0);
  const projectedTotal = currentBalance + newBalanceDue;
  if (projectedTotal <= limit) return { allowed: true, overridden: false, limitChecked: true };

  // Show the numbers first. Asking for a password before saying why is how
  // people learn to type it without reading.
  const acknowledged = window.confirm(t("dialog.creditLimitExceededConfirm", {
    name: existing.name || customerName || phoneKey,
    currentBalance: money(currentBalance),
    newBalanceDue: money(newBalanceDue),
    projectedTotal: money(projectedTotal),
    limit: money(limit)
  }));
  if (!acknowledged) return { allowed: false, overridden: false };

  const details = {
    customerId: existing.id || null,
    limit,
    previousBalance: currentBalance,
    projectedTotal
  };

  // A business that has never set an override password must not be silently
  // handed a hard block. Demanding a password nobody has would refuse the sale
  // outright -- exactly the behaviour this design rejects, arrived at by
  // accident. Where no password exists the acknowledgement stands on its own
  // and the crossing is still recorded, flagged as unauthorised so the owner
  // can tell the two apart and has a concrete reason to set one.
  if (!state.overridePasswordSet) {
    return { allowed: true, overridden: true, authorised: false, limitChecked: true, ...details };
  }

  const authorized = await verifyOverridePassword();
  if (!authorized) {
    showToast(t("toast.creditLimitOverrideRefused"));
    return { allowed: false, overridden: false };
  }

  return { allowed: true, overridden: true, authorised: true, limitChecked: true, ...details };
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

async function downloadPurchaseOrderPdf(groupIndex) {
  const group = currentPoGroupQuantities(groupIndex);
  if (!group || !group.items.length) return showToast(t("toast.poAllQuantitiesZero"));

  if (!(await ensureLibrary("pdf", "toast.pdfLibraryFailed"))) return;
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

// Builds the WhatsApp text for a staff invite. Explicitly names SaviaSmart
// and the inviting business by name in the message itself -- an invite
// link with no context is indistinguishable from a phishing link, and
// staff have no other way to verify who sent it before they've even
// opened the app.
function buildStaffInviteAcceptUrl(linkToken) {
  return `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, "")}accept-invite.html?accept-invite=${encodeURIComponent(linkToken)}`;
}

function buildStaffInviteTextLines(linkToken, roleLabel) {
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "your employer";
  const acceptUrl = buildStaffInviteAcceptUrl(linkToken);
  return [
    `This is an official SaviaSmart ERP invitation from ${businessName}.`,
    `You've been invited to join as a ${roleLabel} on SaviaSmart, the inventory and sales system used by ${businessName}.`,
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
  // What the stock box was filled with, so saving can tell a deliberate
  // correction from a number the form merely happened to be holding. See
  // saveProduct: without this, editing a price wrote back a stale count and
  // put sold goods back on the shelf.
  state.productFormOpeningQuantity = product ? safeNumber(product.quantity) : null;
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

// Mirrors countInRange / moneyInRange / totalInRange in firestore.rules, which
// are the authority. These exist so an out-of-range figure is refused here with
// a message naming the field and the limit, rather than by rules with a
// permission-denied that reads like the shop lost its access.
// tests/validation-limits.test.mjs fails if the two ever disagree.
const MAX_COUNT = 1000000;
const MAX_MONEY = 1000000000;

function clampNonNegativeNumber(value, max = MAX_COUNT) {
  const number = Number(value);
  // Number.isFinite already rejects Infinity and NaN. The upper bound is the
  // new part: without it a mistyped figure was stored, and anything past 2^53
  // stopped being an exact integer, so stock counts drifted silently.
  if (!Number.isFinite(number) || number < 0 || number > max) return null;
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
  // The select still submits while hidden, so a shop that is not registered
  // would otherwise stamp taxClass onto stock for a tax it does not collect.
  if (!vatSettings().registered) delete product.taxClass;
  else product.taxClass = taxClassOf(product);

  const localProduct = { ...existing, ...product };
  state.products = existing
    ? state.products.map((item) => (item.id === product.id ? localProduct : item))
    : [...state.products, localProduct];

  if (state.db && state.user) {
    try {
      const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
      const [root, uid, child] = productCollectionPath();

      // Stock is only written when the owner actually changed the box.
      //
      // This form carries every field, so saving a PRICE also wrote back
      // whatever quantity the form happened to be holding. If a cashier sold
      // five between the dialog opening and the owner pressing save, those five
      // came back onto the shelf -- verified against the emulator, stock went
      // 40 -> 35 -> 40. Offline it is worse: the write queues and lands hours
      // later, quietly reversing every sale in between.
      //
      // Editing stock here is still legitimate -- an owner who has counted the
      // shelf is correcting it -- so a real change is kept and reasoned as a
      // correction. A number nobody touched is simply not sent, and the server's
      // own count stands.
      const payload = {
        ...product,
        createdAt: existing?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      const opened = state.productFormOpeningQuantity;
      const quantityUntouched = existing && opened !== null && safeNumber(product.quantity) === opened;
      if (quantityUntouched) {
        delete payload.quantity;
        delete payload.sold30;
        delete payload.sold90;
      } else if (existing) {
        payload.movementReason = "correction";
      }

      await setDoc(
        doc(collection(state.db, root, uid, child), product.id),
        payload,
        { merge: true }
      );
      // An owner correcting a counted shelf is a real stock movement, and one
      // the ledger has to carry: without it a legitimate correction reads as
      // stock that moved with nothing to explain it, which is precisely the
      // false accusation the reconciliation view must never make. Only when the
      // count actually changed -- quantityUntouched saves are not movements.
      // recordStockMovement() only needs something with .set(), and setDoc has
      // the same shape as transaction.set, so the non-transactional path reuses
      // it rather than growing a second copy of the chain arithmetic.
      if (!quantityUntouched && existing) {
        try {
          recordStockMovement({ set: setDoc }, {
            productId: product.id, productName: product.name,
            storeId: product.storeId, reason: "adjustment",
            delta: safeNumber(product.quantity) - safeNumber(existing.quantity),
            quantityBefore: safeNumber(existing.quantity)
          });
        } catch (ledgerError) {
          console.warn("Could not record stock correction in the ledger.", ledgerError);
        }
      }
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
    transferStaffNameInput.value = state.currentUserName || "";
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
      recordStockMovement(transaction, {
        productId: product.id, productName: product.name,
        storeId: productStoreId(product), reason: "transfer-out",
        delta: -qty, quantityBefore: sourceQty, transferId: transferRef.id
      });
      // Logged against the destination product id, which for a first transfer
      // into a branch is the document being created on the next line -- the
      // ledger has to name the shelf the stock lands on, not the one it left.
      recordStockMovement(transaction, {
        productId: destinationRef.id, productName: product.name,
        storeId: destinationStore.id, reason: "transfer-in",
        delta: qty, quantityBefore: destinationQty, transferId: transferRef.id
      });

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
    showToast(describeOperationError(error, "toast.transferFailed"));
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
        recordStockMovement(transaction, {
          productId, productName: product.name, storeId: productStoreId(product),
          reason: "restock", delta: qty, quantityBefore: currentQuantity
        });

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
      showToast(describeOperationError(error, "toast.restockFailed"));
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
  if (!product) {
    showToast(t("toast.outOfStock"));
    return { failed: true };
  }
  // Offline, the shelf count on this device is a cache that may be hours old --
  // a restock, or another till's return, will not have reached it. Refusing on
  // it turns a stale number into a refused customer holding the item, which is
  // precisely the outcome L-9 phase A rejected: the rules already permit
  // negative stock so the sale can be taken and flagged instead. Only the cart
  // was still enforcing the old policy, so it applied to the two-till race and
  // not to the single till, which is the common case.
  if (product.quantity <= 0 && !isOfflineNow()) {
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
    if (!isOfflineNow()) {
      showToast(t("toast.notEnoughStockQty"));
      return { failed: true };
    }
    // Taken, and the cashier is told why it might not match the shelf. The
    // owner sees it through the Sold While Offline panel and the reconciliation
    // treats an offline entry as unknown rather than as a discrepancy.
    showToast(t("toast.offlineStockUncertain"));
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

async function openBarcodeScanner(target) {
  if (!(await ensureLibrary("scanner", "toast.barcodeLibraryFailed"))) return;

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
  const businessName = state.cachedProfile?.businessName || state.user?.displayName || "SaviaSmart";
  const date = sale.createdAt
    ? (typeof sale.createdAt.toDate === "function" ? sale.createdAt.toDate() : new Date(sale.createdAt))
    : new Date();
  return { storeName, businessName, date };
}

// The tax lines on a receipt. Only rendered for a sale that was actually rung
// up under the scheme -- a sale from before the business registered carries no
// tax fields, and showing it a confident "VAT 0" would be a false statement on
// a document a shop is audited on. Silence is the honest rendering there.
//
// Because prices are inclusive, the total is stated FIRST and the tax shown as
// a decomposition beneath it. Printing net and VAT above the total invites the
// customer to add them up expecting a larger number.
function receiptVatRows(sale) {
  if (sale?.vatRegistered !== true) return "";
  const rate = Math.round(Number(sale.vatRate || 0) * 100);
  const breakdown = sale.taxBreakdown || {};
  const zeroRated = Number(breakdown.zeroRated?.net || 0);
  const exempt = Number(breakdown.exempt?.net || 0);
  return `
    <div class="receipt-row muted"><span>${t("receipt.vatNetLabel")}</span><span>${money(sale.netTotal)}</span></div>
    <div class="receipt-row muted"><span>${t("receipt.vatLabel", { rate: String(rate) })}</span><span>${money(sale.taxTotal)}</span></div>
    ${zeroRated > 0 ? `<div class="receipt-row muted"><span>${t("receipt.vatZeroRatedLabel")}</span><span>${money(zeroRated)}</span></div>` : ""}
    ${exempt > 0 ? `<div class="receipt-row muted"><span>${t("receipt.vatExemptLabel")}</span><span>${money(exempt)}</span></div>` : ""}
    <div class="receipt-center muted">${t("receipt.vatInclusiveNote")}</div>`;
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
    ${sale.vatRegistered === true && sale.vrn ? `<div class="receipt-center muted">${t("receipt.vrnLabel")}: ${esc(sale.vrn)}</div>` : ""}
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
    ${receiptVatRows(sale)}
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

// Text twin of receiptVatRows(). Same rule: a sale from before the business
// registered prints nothing, because it is outside the scheme rather than taxed
// at zero.
function receiptVatTextLines(sale) {
  if (sale?.vatRegistered !== true) return [];
  const rate = Math.round(Number(sale.vatRate || 0) * 100);
  const breakdown = sale.taxBreakdown || {};
  const zeroRated = Number(breakdown.zeroRated?.net || 0);
  const exempt = Number(breakdown.exempt?.net || 0);
  const lines = [
    `${t("receipt.vatNetLabel")}: ${money(sale.netTotal)}`,
    `${t("receipt.vatLabel", { rate: String(rate) })}: ${money(sale.taxTotal)}`
  ];
  if (zeroRated > 0) lines.push(`${t("receipt.vatZeroRatedLabel")}: ${money(zeroRated)}`);
  if (exempt > 0) lines.push(`${t("receipt.vatExemptLabel")}: ${money(exempt)}`);
  if (sale.vrn) lines.push(`${t("receipt.vrnLabel")}: ${sale.vrn}`);
  lines.push(t("receipt.vatInclusiveNote"));
  return lines;
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
  // The same decomposition the on-screen receipt shows. Without it the PDF and
  // the WhatsApp copy -- the ones a customer actually keeps -- were tax-free
  // even once the dialog was fixed.
  lines.push(...receiptVatTextLines(sale));
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

async function downloadReceiptPdf() {
  const sale = state.lastReceiptSale;
  if (!sale) return;
  if (!(await ensureLibrary("pdf", "toast.pdfLibraryFailed"))) return;
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

        // Net off anything already given back by a return, or the void restores
        // stock a second time and invents inventory that does not exist: sell
        // 10, return 3 (stock +3), void (stock +10) leaves 13 units on the books
        // for a 10-unit sale. The same applies to sold30/sold90, which the
        // return path also decrements -- there the double-count was hidden by
        // the Math.max(0, ...) floor rather than prevented by it.
        //
        // Read from saleData, the server copy, not from state.lastSale: a return
        // processed after the sale completed is on the document and not in the
        // local object.
        const alreadyReturnedByProduct = saleReturnedQtyMap(saleData);

        productSnaps.forEach((snap, index) => {
          if (!snap.exists()) return;
          const item = sale.items[index];
          const alreadyReturned = alreadyReturnedByProduct.get(item.productId) || 0;
          const netQty = Math.max(0, Number(item.qty || 0) - alreadyReturned);
          if (netQty === 0) return;
          const currentQuantity = Number(snap.data().quantity || 0);
          const currentSold30 = Number(snap.data().sold30 || 0);
          const currentSold90 = Number(snap.data().sold90 || 0);
          recordStockMovement(transaction, {
            // Same fallback as the return path: a sale old enough to predate
            // storeId must still be voidable.
            productId: item.productId, productName: item.name,
            storeId: saleData.storeId || state.currentStoreId, reason: "void",
            delta: netQty, quantityBefore: currentQuantity, saleId: sale.saleId
          });
          transaction.update(productRefs[index], {
            quantity: currentQuantity + netQty,
            sold30: Math.max(0, currentSold30 - netQty),
            sold90: Math.max(0, currentSold90 - netQty),
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
      showToast(describeOperationError(error, "toast.couldNotUndoSale"));
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
  // Forced refresh first, because a staff member who has just accepted an
  // invite needs the businessOwnerUid claim that was set seconds ago, and a
  // cached token predates it.
  try {
    const tokenResult = await user.getIdTokenResult(/* forceRefresh */ true);
    const claimOwnerUid = tokenResult.claims?.businessOwnerUid;
    if (typeof claimOwnerUid === "string" && claimOwnerUid) return claimOwnerUid;
    return user.uid;
  } catch (error) {
    console.warn("Could not refresh the ID token; falling back to the cached one.", error);
  }

  // A forced refresh needs the network. Offline it throws, and falling straight
  // through to user.uid quietly points a STAFF member's entire session at their
  // own uid -- a tree they own nothing in. Every subscription then reads an
  // empty shop, which is indistinguishable from a shop with no stock: the
  // cashier is told their inventory is gone, offline, with no way to check.
  // The owner never saw this because their uid IS the business.
  //
  // The cached token already carries the claim. Ask for it without forcing a
  // refresh before giving up on it.
  try {
    const cached = await user.getIdTokenResult(/* forceRefresh */ false);
    const claimOwnerUid = cached.claims?.businessOwnerUid;
    if (typeof claimOwnerUid === "string" && claimOwnerUid) return claimOwnerUid;
  } catch (cachedError) {
    console.warn("Could not read the cached ID token either.", cachedError);
  }
  return user.uid;
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

// The name a sale is attributed to. Staff carry the name they gave when they
// accepted their invitation; the owner falls back through their own account
// details. firestore.rules requires staffName to be a non-empty string of at
// most 80 characters, so every branch must end in something real -- the email
// local part is the last resort rather than an empty string, which the rules
// would reject and which would leave a sale attributed to nobody.
async function resolveCurrentUserName(user, ownerUid) {
  const clean = (value) => String(value || "").trim().slice(0, 80);
  if (user.uid !== ownerUid) {
    try {
      const memberSnap = await readOwnMemberDoc();
      const name = clean(memberSnap.exists() ? memberSnap.data().name : "");
      if (name) return name;
    } catch (error) {
      console.warn("Could not resolve staff name from member doc.", error);
    }
  }
  return clean(user.displayName)
    || clean(state.cachedProfile?.businessName)
    || clean((user.email || "").split("@")[0])
    || "Staff";
}

function isOwnerRole() {
  return state.currentUserRole === "owner";
}

// createdAt arrives as a Firestore Timestamp from a live snapshot, a Date from
// the offline fallback path, and a string from an export. All three reach these
// panels, so normalise once rather than at every call site.
function saleTimestamp(sale) {
  const raw = sale?.createdAt;
  if (!raw) return null;
  if (typeof raw.toDate === "function") return raw.toDate();
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameDay(date, reference) {
  return Boolean(date)
    && date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate();
}

function isSameMonth(date, reference) {
  return Boolean(date)
    && date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth();
}

// Number() turns a malformed field into NaN, and NaN spreads: one sale document
// with a bad total rendered every tile on the panel as "NaN", not just its own.
// These figures are counted against a physical drawer, so a single bad row must
// degrade to zero rather than take the whole panel down.
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// One pass over a set of sales producing everything both panels need. Voided
// sales are counted but excluded from takings; refunds are netted off rather
// than ignored, because a shift that sold 200,000 and refunded 150,000 has not
// taken 200,000 and showing that figure is how a till gets robbed quietly.
function summariseSales(sales) {
  const s = {
    count: 0, gross: 0, net: 0, items: 0, discounts: 0,
    cash: 0, mobile: 0, card: 0, credit: 0,
    voidCount: 0, voidValue: 0, refundCount: 0, refundValue: 0,
    creditOutstanding: 0, drawerCash: 0
  };
  for (const sale of sales) {
    const total = safeNumber(sale.total);
    if (sale.voided) {
      s.voidCount += 1;
      s.voidValue += total;
      continue;
    }
    const refunded = safeNumber(sale.refundedAmount);
    s.count += 1;
    s.gross += total;
    s.net += total - refunded;
    s.discounts += safeNumber(sale.discountAmount);
    s.items += (sale.items || []).reduce((sum, item) => sum + safeNumber(item.qty), 0);
    if (refunded > 0) {
      s.refundCount += 1;
      s.refundValue += refunded;
    }
    const method = sale.paymentMethod || "cash";
    if (method in s) s[method] += total;
    // What should physically be in the drawer: cash sales, plus any deposit
    // taken in cash against a credit sale.
    if (method === "cash") s.drawerCash += total - refunded;
    if (method === "credit") {
      s.creditOutstanding += safeNumber(sale.balanceDue);
      if ((sale.amountPaidMethod || "cash") === "cash") s.drawerCash += safeNumber(sale.amountPaid);
    }
  }
  return s;
}

function controlTile(label, value, tone = "", note = "") {
  return `<div class="control-tile${tone ? ` ${tone}` : ""}">
    <span class="control-tile-label">${esc(label)}</span>
    <strong class="control-tile-value">${esc(value)}</strong>
    ${note ? `<span class="control-tile-note">${esc(note)}</span>` : ""}
  </div>`;
}

// Manager panel: this store, today. A manager is accountable for a floor and a
// shift, so anything wider belongs in Reports or the owner panel below.
// Credit-alert overrides, for the manager panel. Audit logs are not held in
// state -- they are written far more often than they are read, and pulling the
// whole collection into every session would cost reads on every load to show a
// number that is usually zero.
//
// Deliberately fails quiet. This is a supervisory figure beside live till
// totals; if the query fails the panel must still show the cash, so the tile
// reports nothing rather than taking the page down with it.
const CREDIT_OVERRIDE_WINDOW_DAYS = 30;

let creditOverrideFetchKey = null;

// Fetched once per business, not per render: renderManagerControl() runs on
// every data change and a query on each would be a read per keystroke-ish
// event. Store scoping is applied at render time instead, so switching branches
// costs nothing.
function ensureCreditOverridesLoaded() {
  if (!state.db || !state.businessOwnerUid) return;
  if (creditOverrideFetchKey === state.businessOwnerUid) return;
  creditOverrideFetchKey = state.businessOwnerUid;
  loadCreditOverrideCount().then(() => renderManagerControl());
}

async function loadCreditOverrideCount() {
  if (!state.db || !state.businessOwnerUid) return;
  const since = new Date(Date.now() - CREDIT_OVERRIDE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  try {
    const snapshot = await getDocs(query(
      collection(state.db, "users", state.businessOwnerUid, "auditLogs"),
      where("action", "==", "CREDIT_LIMIT_EXCEEDED"),
      orderBy("createdAt", "desc"),
      limit(100)
    ));
    const rows = snapshot.docs
      .map((entry) => entry.data())
      .filter((row) => row.createdAt?.toDate && row.createdAt.toDate() >= since);
    state.creditOverrides = rows;
  } catch (error) {
    console.warn("Could not load credit override history.", error);
    state.creditOverrides = null;
  }
}

// ---- Shifts and cash reconciliation -----------------------------------------
//
// A shift is one till, one person, one stretch of time: opened with a float,
// closed with a physical count, and carrying the difference between what the
// system expected to be in the drawer and what was actually there.
//
// Only one shift may be open per store. Firestore rules cannot express that on
// their own, so the store document carries a currentShiftId and both open and
// close run as transactions against it -- two cashiers opening at the same
// moment, the realistic race at shift change, resolve to one winner rather than
// two open shifts and a drawer nobody can reconcile.

const SHIFT_HISTORY_LIMIT = 20;

// How many sales subscribeToSales() holds. Named because salesCoverageFromMs()
// has to know it: the reconciliation below decides whether a shift is old
// enough to be outside the loaded window by comparing against this exact
// number, and a literal in one place and a comparison in another would drift
// into accusing cashiers of theft the day someone changed it.
const SALES_HISTORY_LIMIT = 1000;

// Units of one product actually sold in a time window, from the sales record.
//
// products.sold30 and sold90 are named for windows they have never had. Every
// write to them adds on a sale and subtracts on a return or a void, and nothing
// anywhere decays them -- so they are lifetime net-sold counters, and reading
// them as "the last 30 days" quietly degrades every decision built on top:
// "fast moving" (sold30 >= 50) is a label a product can only ever gain, so
// given enough trading every product earns it and the movement chart stops
// distinguishing anything. The shops it fails hardest for are the ones trading
// longest.
//
// The stored counters are deliberately left in place. firestore.rules validates
// stock writes against them (validStockMovementUpdate), and as a lifetime total
// they are perfectly true -- they were mislabelled, not wrong. This computes the
// windowed figure from the only place the real answer lives.
//
// Voided sales are skipped whole; returns are netted off, floored at zero so a
// product can never read as sold a negative number of times.
// Appends one entry to the stock ledger inside the caller's transaction (L-2).
//
// Every path that moves stock calls this, and it is deliberately part of the
// same transaction as the movement: a ledger written separately could be
// skipped by a crash, and a ledger with holes in it cannot be replayed. The
// cost of that choice is that a rejected entry rolls back the sale it
// travelled with, which is why every shape this produces is asserted against
// the real rules in tests/rules-stock-ledger.test.mjs before it ships.
//
// quantityAfter is computed here rather than passed in, so the chain the rule
// checks (after == before + delta) can only ever be consistent with what the
// caller actually did to the shelf.
function recordStockMovement(transaction, fields) {
  const { doc, collection, serverTimestamp } = state.firebaseApi.firestore;

  // Fail here, loudly, rather than at the rules layer. A missing productId or
  // storeId produced an empty string, which the rule refuses for size() > 0 --
  // and because this write rides inside the sale transaction, that rejection
  // took the entire sale down with it and surfaced as a bare permission error
  // with nothing pointing at the cause. That is exactly how a mis-named field
  // (cartItem.productId, where a cart entry only has id) stayed invisible.
  if (!fields.productId || !fields.storeId) {
    throw new Error(
      `recordStockMovement: missing ${!fields.productId ? "productId" : "storeId"} for reason "${fields.reason}"`
    );
  }

  const quantityBefore = safeNumber(fields.quantityBefore);
  const delta = safeNumber(fields.delta);
  const ref = doc(collection(state.db, "users", state.businessOwnerUid, "stockMovements"));
  const entry = {
    productId: String(fields.productId || ""),
    storeId: String(fields.storeId || ""),
    reason: fields.reason,
    delta,
    quantityBefore,
    quantityAfter: quantityBefore + delta,
    uid: state.user?.uid || null,
    createdAt: serverTimestamp()
  };
  if (fields.productName) entry.productName = String(fields.productName).slice(0, 120);
  if (fields.saleId) entry.saleId = String(fields.saleId).slice(0, 120);
  if (fields.transferId) entry.transferId = String(fields.transferId).slice(0, 120);
  transaction.set(ref, entry);
}

// Units sold per product across a window, in ONE pass over the sales.
//
// The per-product version below reads a single id out of this map rather than
// rescanning. That distinction is not a micro-optimisation: the movement panel
// and the dashboard each classify every product three times, so a per-product
// scan costs products x sales x 6 and was measured at 201ms for a 200-product
// shop with 1000 sales, 1.2s at 2000 products, 6s at 10000 -- per render, on a
// desktop, with renderAll() firing on every snapshot. This is O(sales) once
// instead, whatever the catalogue size.
function isOfflineNow() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

// Only cash sales are queued offline (L-9 phase C). A credit sale needs the
// customer's real balance and, past the limit, an override the proxy has to
// authorise -- offline it could silently blow a credit limit with no trail. It
// is refused with its own message rather than left to fail as a generic error.
function shouldQueueSaleOffline(paymentMethod) {
  return isOfflineNow() && paymentMethod === "cash";
}

// A sale made with no connection, written as queued relative updates instead of
// a transaction (L-9 phase C).
//
// Three things here are deliberate and easy to undo by accident:
//
// 1. NOTHING IS AWAITED. Firestore resolves a write's promise when the server
//    acknowledges it, so awaiting offline hangs until the connection returns --
//    the cashier would watch a spinner instead of serving the next customer.
//    The write lands in the local cache immediately and the snapshot listeners
//    fire from it, so the UI is correct straight away; the promise is only
//    useful for learning that a replay was ultimately REJECTED, which is what
//    the catch is for.
//
// 2. increment() rather than read-then-write. The client never reads the shelf,
//    so two tills that both sold during the outage merge on replay instead of
//    one overwriting the other. This is why the transaction is not merely
//    unnecessary here but wrong.
//
// 3. The ledger entry carries `offline: true`, a delta, and no chain. Offline
//    the shelf is a possibly-stale cache, and a chain built on it would be a
//    guess wearing the authority of a measurement -- phase B teaches the
//    reconciliation to treat these products as unknown until their next online
//    movement re-anchors them.
//
// Replay safety comes free from the existing deterministic sale id: a queue
// flushed twice resolves to the same document path, and the rules' create
// semantics refuse the second.
function queueOfflineSale(args) {
  const { doc, collection, increment, serverTimestamp, writeBatch } = state.firebaseApi.firestore;
  const root = ["users", state.businessOwnerUid];
  const dedupeSaleId = `ord_${args.staffId}_${args.orderNumber}`;
  const saleId = args.duplicate ? `${dedupeSaleId}_dup${Date.now()}` : dedupeSaleId;

  // A rejection arrives at replay time, long after the cashier has moved on, so
  // it goes to the fault log rather than a toast nobody will connect to it.
  const onReplayFailure = (what) => (error) => {
    console.warn(`Offline ${what} was rejected on replay.`, error);
    try { reportFault("rejection", `offline ${what} rejected: ${error?.code || error}`, "queueOfflineSale"); }
    catch (reportError) { console.warn(reportError); }
  };

  // One batch, not four independent writes (QA-114).
  //
  // These used to be separate queued mutations, which meant they replayed
  // independently and could half-succeed. The realistic case is not exotic: the
  // deterministic sale id already exists, so the rules see an UPDATE where a
  // create was intended and refuse it -- while the increment(-qty) stock writes,
  // which carry no such constraint, land anyway. The shop is then short a full
  // basket with no sale to explain it, and because the ledger entry is
  // offline: true the reconciliation reports it as unknown rather than flagging
  // it, so the only trace is the fault log.
  //
  // A batch is atomic on the server and still queues offline, so the whole sale
  // either replays or does not. It is deliberately NOT awaited, for the same
  // reason the individual writes were not: awaiting a write that cannot resolve
  // until the connection returns is a spinner that never stops at the till.
  const batch = writeBatch(state.db);

  batch.set(doc(state.db, ...root, "sales", saleId), {
    items: args.items,
    subtotal: args.subtotal,
    discountType: args.discountType,
    discountValue: args.discountValue,
    discountAmount: args.discountAmount,
    total: args.total,
    paymentMethod: "cash",
    cashTendered: args.cashTendered,
    changeDue: args.changeDue,
    customerId: null,
    amountPaid: null,
    amountPaidMethod: null,
    balanceDue: null,
    branchId: args.storeId,
    storeId: args.storeId,
    cashierUid: state.user?.uid || null,
    staffId: args.staffId,
    staffName: args.staffName,
    orderNumber: args.orderNumber,
    customerName: args.customerName,
    customerPhone: args.customerPhone,
    voided: false,
    // Marks the sale itself, so the owner's "sold while offline" view and any
    // later investigation can tell which sales were rung up blind.
    madeOffline: true,
    // A sale rung up offline by a registered business is still a taxed sale.
    // Omitting these here would make the VAT return disagree with the takings
    // by exactly the outage.
    ...(args.taxFields || {}),
    createdAt: serverTimestamp()
  });

  for (const item of args.items) {
    batch.update(doc(state.db, ...root, "products", item.productId), {
      quantity: increment(-item.qty),
      sold30: increment(item.qty),
      sold90: increment(item.qty),
      updatedAt: serverTimestamp(),
      movementReason: "sale"
    });

    batch.set(doc(collection(state.db, ...root, "stockMovements")), {
      productId: item.productId,
      productName: item.name,
      storeId: args.storeId,
      reason: "sale",
      delta: -item.qty,
      offline: true,
      saleId,
      uid: state.user?.uid || null,
      createdAt: serverTimestamp()
    });
  }

  batch.set(doc(collection(state.db, ...root, "auditLogs")), {
    action: "SALE_COMPLETED",
    total: args.total,
    paymentMethod: "cash",
    itemCount: args.items.length,
    discountType: args.discountType,
    discountAmount: args.discountAmount,
    uid: state.user?.uid || null,
    createdAt: serverTimestamp()
  });

  // Fire and forget. The whole sale is now one unit: it replays completely or
  // not at all, and a rejection names the sale rather than one fragment of it.
  batch.commit().catch(onReplayFailure("sale"));

  return saleId;
}

function unitsSoldByProduct(sales, fromMs, toMs) {
  const totals = new Map();
  const add = (id, qty) => {
    if (id === undefined || id === null) return;
    totals.set(id, (totals.get(id) || 0) + qty);
  };
  for (const sale of sales || []) {
    if (!sale || sale.voided) continue;
    const at = sale.createdAt?.toDate ? sale.createdAt.toDate().getTime() : null;
    if (at === null || at < fromMs || at > toMs) continue;

    for (const item of Array.isArray(sale.items) ? sale.items : []) {
      add(item?.productId, safeNumber(item.qty));
    }
    for (const entry of Array.isArray(sale.returns) ? sale.returns : []) {
      for (const item of Array.isArray(entry?.items) ? entry.items : []) {
        add(item?.productId, -safeNumber(item.qty));
      }
    }
  }
  return totals;
}

// Single-product convenience, defined in terms of the map so the two can never
// disagree about what a return or a void means. Builds a whole map per call, so
// do not put it in a loop over products -- use unitsSoldByProduct() directly, or
// productUnitsSold(), which caches.
function unitsSoldInWindow(sales, productId, fromMs, toMs) {
  return Math.max(0, unitsSoldByProduct(sales, fromMs, toMs).get(productId) || 0);
}

// The windowed figures the UI and the AI payload should be reading instead of
// product.sold30 / product.sold90. Defined against state.sales, which holds the
// newest SALES_HISTORY_LIMIT sales -- for a window longer than that history the
// figure is a floor rather than an exact count, which understates movement
// rather than inventing it.
// Cached per (sales snapshot, window). state.sales is replaced wholesale by its
// onSnapshot handler, so identity comparison is a sound cache key -- a new array
// means new data. The minute bucket bounds how stale the window edge can get,
// which for a 30-day window is immaterial and keeps a long-open till from
// drifting.
let unitsSoldCache = { sales: null, minute: null, byDays: new Map() };

function productUnitsSold(product, days) {
  const sales = state.sales || [];
  const minute = Math.floor(Date.now() / 60000);
  if (unitsSoldCache.sales !== sales || unitsSoldCache.minute !== minute) {
    unitsSoldCache = { sales, minute, byDays: new Map() };
  }
  if (!unitsSoldCache.byDays.has(days)) {
    const now = Date.now();
    unitsSoldCache.byDays.set(days, unitsSoldByProduct(sales, now - days * 24 * 60 * 60 * 1000, now));
  }
  return Math.max(0, unitsSoldCache.byDays.get(days).get(product?.id) || 0);
}

function shiftCashFromSales(sales, storeId, fromMs, toMs) {
  let cashSales = 0;
  let cashRefunds = 0;
  for (const sale of sales) {
    if (sale.storeId !== storeId) continue;
    const at = sale.createdAt?.toDate ? sale.createdAt.toDate().getTime() : null;
    if (at === null || at < fromMs || at > toMs) continue;
    if (sale.voided) continue;                 // a void took no money in
    if (sale.paymentMethod === "cash") {
      cashSales += safeNumber(sale.total);
      cashRefunds += safeNumber(sale.refundedAmount);
    } else if (sale.paymentMethod === "credit" && (sale.amountPaidMethod || "cash") === "cash") {
      // A deposit paid in cash against a credit sale is still cash in the till.
      cashSales += safeNumber(sale.amountPaid);
    }
  }
  return { cashSales, cashRefunds };
}

// Debt repayments come from the audit log rather than each customer's payments
// subcollection: the log is one collection with an index that already exists,
// where the subcollections would need a collection-group query and its own
// rules surface to reach the same numbers.
async function shiftCashRepayments(storeId, fromMs, toMs) {
  if (!state.db || !state.businessOwnerUid) return 0;
  const { collection, query, where, orderBy, limit, getDocs } = state.firebaseApi.firestore;
  const snapshot = await getDocs(query(
    collection(state.db, "users", state.businessOwnerUid, "auditLogs"),
    where("action", "==", "PAYMENT_RECORDED"),
    orderBy("createdAt", "desc"),
    limit(300)
  ));
  let total = 0;
  for (const entry of snapshot.docs) {
    const row = entry.data();
    if (row.storeId !== storeId) continue;
    // Entries written before repayments recorded a method are treated as cash,
    // which is what they overwhelmingly were. Counting them is closer to the
    // truth than dropping them and telling the cashier the drawer is over.
    if ((row.method || "cash") !== "cash") continue;
    const at = row.createdAt?.toDate ? row.createdAt.toDate().getTime() : null;
    if (at === null || at < fromMs || at > toMs) continue;
    total += safeNumber(row.amount);
  }
  return total;
}

// Owner-side reconciliation of a closed shift against the sales record.
//
// This is the compensating control L-1 names in KNOWN-LIMITATIONS.md.
// firestore.rules can force a shift's closing numbers to agree with each other
// -- expectedCash must equal the float plus cash sales less refunds plus
// repayments, and variance must equal counted minus expected -- but it cannot
// prove cashSales, because rules authorise one write at a time and cannot
// aggregate a shift's sales. A cashier can still understate cashSales, write
// the matching expectedCash, and close a short drawer as balanced. The rules
// change did not close that; it moved the lie into a field the owner can check
// against the sales collection. This is that check.
//
// Restraint is the hard part, not detection. The sales subscription is
// limit(1000), so a shift older than the loaded window is not evidence of
// anything. Reporting it as a discrepancy would accuse a cashier of theft
// because the app had not loaded far enough back -- and a tool that does that
// spends the owner's trust on false positives, then gets ignored on the true
// one. coverageFromMs is the earliest moment the supplied sales are known to
// be complete from; anything opening before it returns "unknown", never
// "mismatch".
//
// Pure and side-effect free so tests/shift-reconciliation.test.mjs can
// exercise the real function rather than a copy of its arithmetic.
// Renders one reconciliation verdict. "unknown" and "not checked" both show a
// neutral dash, never a tick: a shift we could not verify must not read as one
// that passed, or the column becomes a rubber stamp.
function shiftReconciliationCell(shift) {
  const result = state.shiftReconciliation?.[shift.id];
  if (!result || result.status === "unknown" || result.status === "not-closed") {
    return `<span class="muted" title="${esc(t("shift.reconcileUnknown"))}">&mdash;</span>`;
  }
  if (result.status === "matched") return `<span class="muted">${esc(t("shift.reconcileOk"))}</span>`;
  return `<span class="danger" title="${esc(t("shift.reconcileMismatchHelp"))}">${
    esc(t("shift.reconcileMismatch", { amount: money(Math.abs(result.unaccounted)) }))
  }</span>`;
}

// Owner-side reconciliation of one shelf against the stock ledger (L-2).
//
// The ledger records quantityBefore/quantityAfter on every movement and the
// rule requires them to agree with the delta, so the newest entry for a product
// states what the shelf should hold. If the product's own quantity differs,
// stock moved without an entry -- and the difference is exactly how much.
//
// F-4 says rules cannot bind a stock decrement to a sale, and that remains
// true: a client can still decline to write the ledger entry. What it cannot do
// is decline invisibly.
//
// The same restraint as reconcileShiftCash(): a product with no ledger entry in
// the loaded window is "unknown", never a discrepancy. Everything predates the
// ledger, so on the day this ships every product is unknown and stays that way
// until it next moves. A view that read that as theft would be wrong about the
// entire catalogue at once.
function reconcileProductStock(product, latestMovement) {
  if (!product) return { status: "unknown", reason: "no-product", gap: null };
  if (!latestMovement) return { status: "unknown", reason: "no-ledger-entry", gap: null };

  // An entry made offline carries a delta and no chain (L-9 phase A), because
  // offline its idea of the shelf is a possibly-stale cache. There is nothing
  // here to compare the shelf against, and guessing would mean reporting the
  // outage itself as unaccounted stock -- this control accusing a cashier for
  // every sale rung up while the connection was down.
  //
  // Checking only the NEWEST entry is sufficient, and worth explaining. Entries
  // are ordered newest-first by server time, and a queued write is stamped when
  // it lands rather than when it was made. A chained entry is written online,
  // inside a transaction that read the real shelf, so it anchors everything
  // before it -- including offline entries that had already been applied. So a
  // chained newest entry is authoritative even with offline entries behind it,
  // and an offline newest entry means the shelf has moved since the last
  // anchor by an amount nothing has verified.
  //
  // The chain re-establishes itself at the product's next online movement. No
  // repair job, and no rewriting of records the rules make immutable.
  const chainMissing = latestMovement.quantityAfter === undefined || latestMovement.quantityAfter === null;
  if (latestMovement.offline === true || chainMissing) {
    return { status: "unknown", reason: "offline-entry-pending", gap: null };
  }

  const onShelf = safeNumber(product.quantity);
  const expected = safeNumber(latestMovement.quantityAfter);
  const gap = onShelf - expected;
  return {
    // Whole units only: these are counts, and a fractional gap is noise from a
    // malformed document rather than stock anybody moved.
    status: Math.abs(gap) < 1 ? "matched" : "mismatch",
    onShelf,
    expected,
    gap
  };
}

// The newest ledger entry per product, from entries ordered newest-first.
// One pass, first occurrence wins -- the alternative is a query per product,
// which for a real catalogue is hundreds of reads to render one column.
function latestMovementByProduct(movements) {
  const latest = new Map();
  for (const movement of movements || []) {
    if (!movement?.productId) continue;
    if (!latest.has(movement.productId)) latest.set(movement.productId, movement);
  }
  return latest;
}

function reconcileShiftCash(shift, actual, coverageFromMs) {
  if (!shift || shift.status !== "closed") return { status: "not-closed" };

  const openedAt = shift.openedAt?.toDate ? shift.openedAt.toDate().getTime() : null;
  const closedAt = shift.closedAt?.toDate ? shift.closedAt.toDate().getTime() : null;
  const unknown = (reason) => ({ status: "unknown", reason, unaccounted: null });
  if (openedAt === null || closedAt === null) return unknown("no-timestamps");
  if (coverageFromMs !== null && coverageFromMs !== undefined && openedAt < coverageFromMs) {
    return unknown("outside-loaded-history");
  }

  const openingFloat = safeNumber(shift.openingFloat);
  const actualExpected = openingFloat
    + safeNumber(actual?.cashSales)
    - safeNumber(actual?.cashRefunds)
    + safeNumber(actual?.cashRepayments);
  const recordedExpected = safeNumber(shift.expectedCash);
  const counted = safeNumber(shift.countedCash);

  // Positive means the sales record says more should have been in the drawer
  // than the shift accounted for -- the direction that hides a shortfall.
  const unaccounted = actualExpected - recordedExpected;

  return {
    // Sub-unit differences are float noise, not findings. A whole unit is a
    // finding: these are shillings, and the arithmetic is over integers.
    status: Math.abs(unaccounted) < 1 ? "matched" : "mismatch",
    recordedExpected,
    actualExpected,
    recordedVariance: safeNumber(shift.variance),
    actualVariance: counted - actualExpected,
    unaccounted
  };
}

// How far back the loaded sales can be trusted to be complete.
//
// subscribeToSales() asks for the newest SALES_HISTORY_LIMIT sales. If it came
// back full, older sales exist that we do not hold, and the oldest one we DO
// hold is the boundary: before it, absence of a sale is not evidence there was
// none. If it came back short, we have everything and there is no boundary.
// Returning null means "no boundary" -- see reconcileShiftCash().
function salesCoverageFromMs() {
  const sales = state.sales || [];
  if (sales.length < SALES_HISTORY_LIMIT) return null;
  let oldest = null;
  for (const sale of sales) {
    const at = sale.createdAt?.toDate ? sale.createdAt.toDate().getTime() : null;
    if (at === null) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

// Owner-only, and deliberately so: auditLogs is owner-read by rule, so a
// manager running this would only produce "unknown" rows. Kept off the close
// path -- this reconciles history, it never gates a till.
async function computeShiftReconciliations() {
  state.shiftReconciliation = {};
  if (!isOwnerRole()) return;
  const coverage = salesCoverageFromMs();
  for (const shift of state.shifts || []) {
    if (shift.status !== "closed") continue;
    const from = shift.openedAt?.toDate ? shift.openedAt.toDate().getTime() : null;
    const to = shift.closedAt?.toDate ? shift.closedAt.toDate().getTime() : null;
    if (from === null || to === null) {
      state.shiftReconciliation[shift.id] = reconcileShiftCash(shift, null, coverage);
      continue;
    }
    try {
      const { cashSales, cashRefunds } = shiftCashFromSales(state.sales || [], shift.storeId, from, to);
      const cashRepayments = await shiftCashRepayments(shift.storeId, from, to);
      state.shiftReconciliation[shift.id] =
        reconcileShiftCash(shift, { cashSales, cashRefunds, cashRepayments }, coverage);
    } catch (error) {
      // An unreadable source is not a discrepancy. Say nothing rather than
      // something wrong -- see the restraint note on reconcileShiftCash().
      console.warn("Could not reconcile shift.", error);
      state.shiftReconciliation[shift.id] = { status: "unknown", reason: "lookup-failed", unaccounted: null };
    }
  }
}

async function computeShiftExpectedCash(shift) {
  const from = shift.openedAt?.toDate ? shift.openedAt.toDate().getTime() : Date.now();
  const to = Date.now();
  const { cashSales, cashRefunds } = shiftCashFromSales(state.sales, shift.storeId, from, to);
  const cashRepayments = await shiftCashRepayments(shift.storeId, from, to);
  const openingFloat = safeNumber(shift.openingFloat);
  return {
    openingFloat,
    cashSales,
    cashRefunds,
    cashRepayments,
    expected: openingFloat + cashSales - cashRefunds + cashRepayments
  };
}

async function openShift(openingFloat) {
  const storeId = state.currentStoreId;
  if (!state.db || !storeId || storeId === "all") return showToast(t("toast.selectStoreBeforeShift"));
  const float = clampNonNegativeNumber(openingFloat, MAX_MONEY);
  if (float === null) {
    return showToast(t("toast.numberOutOfRange", {
      field: t("shift.floatLabel"), max: MAX_MONEY.toLocaleString()
    }));
  }
  const identity = saleIdentity();
  if (!identity.name) return showToast(t("toast.staffIdentityUnavailable"));

  try {
    const { doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
    const storeRef = doc(state.db, "users", state.businessOwnerUid, "stores", storeId);
    const shiftId = `shift_${storeId}_${Date.now()}`;
    const shiftRef = doc(state.db, "users", state.businessOwnerUid, "shifts", shiftId);
    await runTransaction(state.db, async (transaction) => {
      const storeSnap = await transaction.get(storeRef);
      // The pointer is the lock. Read it inside the transaction so a second
      // cashier opening at the same instant loses rather than both winning.
      if (storeSnap.data()?.currentShiftId) throw new Error(t("txerror.shiftAlreadyOpen"));
      transaction.set(shiftRef, {
        storeId,
        storeName: storeSnap.data()?.name || "",
        status: "open",
        openingFloat: float,
        openedByUid: state.user.uid,
        openedByName: identity.name,
        openedAt: serverTimestamp()
      });
      transaction.update(storeRef, { currentShiftId: shiftId });
    });
    showToast(t("toast.shiftOpened", { float: money(float) }));
    await loadShifts();
  } catch (error) {
    console.warn(error);
    showToast(describeOperationError(error, "toast.shiftOpenFailed"));
  }
}

async function closeShift(countedCash, note) {
  const shift = state.openShift;
  if (!shift) return showToast(t("toast.noOpenShift"));
  const counted = clampNonNegativeNumber(countedCash, MAX_MONEY);
  if (counted === null) {
    return showToast(t("toast.numberOutOfRange", {
      field: t("shift.countedLabel"), max: MAX_MONEY.toLocaleString()
    }));
  }
  const identity = saleIdentity();
  if (!identity.name) return showToast(t("toast.staffIdentityUnavailable"));

  try {
    // Computed before the transaction opens: it reads a query, and a Firestore
    // transaction may not run a query inside it.
    const totals = await computeShiftExpectedCash(shift);
    const variance = counted - totals.expected;
    const { doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
    const storeRef = doc(state.db, "users", state.businessOwnerUid, "stores", shift.storeId);
    const shiftRef = doc(state.db, "users", state.businessOwnerUid, "shifts", shift.id);
    await runTransaction(state.db, async (transaction) => {
      const shiftSnap = await transaction.get(shiftRef);
      if (shiftSnap.data()?.status !== "open") throw new Error(t("txerror.shiftAlreadyClosed"));
      transaction.update(shiftRef, {
        status: "closed",
        countedCash: counted,
        expectedCash: totals.expected,
        variance,
        cashSales: totals.cashSales,
        cashRefunds: totals.cashRefunds,
        cashRepayments: totals.cashRepayments,
        closedByUid: state.user.uid,
        closedByName: identity.name,
        closedAt: serverTimestamp(),
        note: String(note || "").slice(0, 200)
      });
      transaction.update(storeRef, { currentShiftId: null });
    });
    showToast(variance === 0
      ? t("toast.shiftBalanced")
      : t("toast.shiftVariance", {
          amount: money(Math.abs(variance)),
          direction: t(variance > 0 ? "shift.over" : "shift.short")
        }));
    await loadShifts();
  } catch (error) {
    console.warn(error);
    showToast(describeOperationError(error, "toast.shiftCloseFailed"));
  }
}

let shiftFetchKey = null;

function ensureShiftsLoaded() {
  if (!state.db || !state.businessOwnerUid) return;
  const key = state.businessOwnerUid + ":" + state.currentStoreId;
  if (shiftFetchKey === key) return;
  shiftFetchKey = key;
  loadShifts();
}

async function loadShifts() {
  if (!state.db || !state.businessOwnerUid) return;
  const storeId = state.currentStoreId;
  if (!storeId || storeId === "all") {
    state.shifts = [];
    state.openShift = null;
    renderManagerControl();
    return;
  }
  try {
    const { collection, query, where, orderBy, limit, getDocs } = state.firebaseApi.firestore;
    const snapshot = await getDocs(query(
      collection(state.db, "users", state.businessOwnerUid, "shifts"),
      where("storeId", "==", storeId),
      orderBy("openedAt", "desc"),
      limit(SHIFT_HISTORY_LIMIT)
    ));
    state.shifts = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    state.openShift = state.shifts.find((row) => row.status === "open") || null;
    await computeShiftReconciliations();
  } catch (error) {
    // Fails quiet, like the credit-override history: the panel beside this one
    // shows the day's cash and must not go down with it.
    console.warn("Could not load shifts.", error);
    state.shifts = null;
    state.openShift = null;
  }
  renderManagerControl();
}

// Rendered from state rather than kept as static markup, because the panel is
// two different things: an open shift you can close, or a float entry to open
// one. Escaped through esc() -- staff names and notes are user text and
// this builds HTML.
function renderShiftPanel() {
  const host = qs("#shiftPanel");
  if (!host) return;

  if (!state.db || !state.currentStoreId || state.currentStoreId === "all") {
    host.innerHTML = `<p class="muted">${esc(t("shift.selectStore"))}</p>`;
    return;
  }
  if (state.shifts === null) {
    host.innerHTML = `<p class="muted">&mdash;</p>`;
    return;
  }

  const open = state.openShift;
  const history = (state.shifts || []).filter((row) => row.status === "closed").slice(0, 5);

  const openBlock = open
    ? `
      <div class="shift-open">
        <div class="shift-facts">
          <span class="muted">${esc(t("shift.openedBy", { name: open.openedByName || "" }))}</span>
          <span class="muted">${esc(t("shift.floatLabel"))}: <strong>${esc(money(open.openingFloat))}</strong></span>
          <span class="muted" id="shiftExpectedLine">${esc(t("shift.expected"))}: <strong>&hellip;</strong></span>
        </div>
        ${
          canCloseOpenShift(open)
            ? `<div class="shift-actions">
          <label class="shift-field"><span>${esc(t("shift.countedLabel"))}</span>
            <input id="shiftCountedInput" type="number" min="0" max="${MAX_MONEY}" step="1" inputmode="numeric" />
          </label>
          <label class="shift-field"><span>${esc(t("shift.noteLabel"))}</span>
            <input id="shiftNoteInput" type="text" maxlength="200" />
          </label>
          <button class="primary-button compact" type="button" id="closeShiftButton">${esc(t("shift.closeButton"))}</button>
        </div>`
            : `<div class="shift-actions">
          <span class="muted">${esc(t("shift.closeLockedToOpener", { name: open.openedByName || "" }))}</span>
        </div>`
        }
      </div>`
    : `
      <div class="shift-actions">
        <span class="muted">${esc(t("shift.noneOpen"))}</span>
        <label class="shift-field"><span>${esc(t("shift.floatLabel"))}</span>
          <input id="shiftFloatInput" type="number" min="0" max="${MAX_MONEY}" step="1" inputmode="numeric" />
        </label>
        <button class="primary-button compact" type="button" id="openShiftButton">${esc(t("shift.openButton"))}</button>
      </div>`;

  const rows = history.map((row) => {
    const variance = safeNumber(row.variance);
    const tone = variance === 0 ? "" : (variance > 0 ? "warn" : "danger");
    const label = variance === 0
      ? t("shift.balanced")
      : `${money(Math.abs(variance))} ${t(variance > 0 ? "shift.over" : "shift.short")}`;
    const closedAt = row.closedAt?.toDate ? row.closedAt.toDate().toLocaleString() : "";
    return `<tr>
      <td>${esc(closedAt)}</td>
      <td>${esc(row.closedByName || row.openedByName || "")}</td>
      <td class="num">${esc(money(row.expectedCash))}</td>
      <td class="num">${esc(money(row.countedCash))}</td>
      <td class="num ${tone}">${esc(label)}</td>
      ${isOwnerRole() ? `<td class="num">${shiftReconciliationCell(row)}</td>` : ""}
    </tr>`;
  }).join("");

  host.innerHTML = `
    ${openBlock}
    ${history.length ? `
    <div class="table-scroll">
      <table class="control-table">
        <thead><tr>
          <th>${esc(t("shift.historyHeading"))}</th>
          <th>${esc(t("control.colStaff"))}</th>
          <th>${esc(t("shift.expected"))}</th>
          <th>${esc(t("shift.countedLabel"))}</th>
          <th>${esc(t("shift.variance"))}</th>
          ${isOwnerRole() ? `<th>${esc(t("shift.reconciled"))}</th>` : ""}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : ""}`;

  // The expected figure needs a query, so it lands after the panel rather than
  // holding the render behind a network round trip.
  if (open) {
    computeShiftExpectedCash(open)
      .then((totals) => {
        const line = qs("#shiftExpectedLine");
        if (line) line.innerHTML = `${esc(t("shift.expected"))}: <strong>${esc(money(totals.expected))}</strong>`;
      })
      .catch(() => {});
  }
}

function renderManagerControl() {
  const panel = qs("#managerControlPanel");
  if (!panel) return;
  panel.hidden = !isManagerOrOwnerRole();
  if (panel.hidden) return;

  const now = new Date();
  const scopedToStore = state.currentStoreId && state.currentStoreId !== "all";
  const sales = state.sales.filter((sale) => {
    if (!isSameDay(saleTimestamp(sale), now)) return false;
    return !scopedToStore || sale.storeId === state.currentStoreId;
  });
  const s = summariseSales(sales);

  const storeName = scopedToStore
    ? (state.stores.find((store) => store.id === state.currentStoreId)?.name || t("storeSwitcher.fallbackName"))
    : t("staff.allStoresLabel");
  qs("#managerControlScope").textContent = `${storeName} · ${t("control.todayScope")}`;

  const products = scopedToStore ? state.products.filter((p) => p.storeId === state.currentStoreId) : state.products;
  const outOfStock = products.filter((p) => safeNumber(p.quantity) <= 0).length;
  const lowStock = products.filter((p) => {
    const qty = safeNumber(p.quantity);
    return qty > 0 && qty <= safeNumber(p.reorderLevel);
  }).length;

  ensureCreditOverridesLoaded();
  ensureShiftsLoaded();
  renderShiftPanel();
  const scopedOverrides = (state.creditOverrides || []).filter((row) =>
    !scopedToStore || row.storeId === state.currentStoreId);

  qs("#managerControlGrid").innerHTML = [
    controlTile(t("control.expectedCash"), money(s.drawerCash), "accent", t("control.expectedCashNote")),
    controlTile(t("control.netTakings"), money(s.net), "", t("control.netTakingsNote")),
    controlTile(t("control.salesCount"), String(s.count),
      "", s.count ? t("control.averageBasket", { value: money(Math.round(s.net / s.count)) }) : ""),
    controlTile(t("control.byMethod"),
      `${money(s.cash)} · ${money(s.mobile)}`, "", `${t("pos.cash")} · ${t("pos.mobile")}`),
    controlTile(t("control.cardCredit"),
      `${money(s.card)} · ${money(s.credit)}`, "", `${t("pos.card")} · ${t("pos.credit")}`),
    controlTile(t("control.discountsGiven"), money(s.discounts), s.discounts > 0 ? "warn" : ""),
    controlTile(t("control.voidsToday"), `${s.voidCount} · ${money(s.voidValue)}`, s.voidCount > 0 ? "warn" : ""),
    controlTile(t("control.refundsToday"), `${s.refundCount} · ${money(s.refundValue)}`, s.refundCount > 0 ? "warn" : ""),
    controlTile(t("control.stockAttention"), `${lowStock} · ${outOfStock}`,
      outOfStock > 0 ? "danger" : (lowStock > 0 ? "warn" : ""), t("control.stockAttentionNote")),
    // The whole point of making the override accountable: somewhere the owner
    // actually looks. A record nobody reads is not a control.
    controlTile(t("control.creditOverrides"),
      state.creditOverrides === null ? "—" : String(scopedOverrides.length),
      scopedOverrides.length ? "warn" : "",
      scopedOverrides.length
        ? money(scopedOverrides.reduce((sum, row) => sum + safeNumber(row.saleTotal), 0))
        : "")
  ].join("");

  const byStaff = new Map();
  for (const sale of sales) {
    const key = sale.staffId || sale.cashierUid || "-";
    if (!byStaff.has(key)) {
      byStaff.set(key, { name: sale.staffName || t("report.none"), count: 0, items: 0, discounts: 0, voids: 0, net: 0 });
    }
    const row = byStaff.get(key);
    if (sale.voided) {
      row.voids += 1;
      continue;
    }
    row.count += 1;
    row.items += (sale.items || []).reduce((sum, item) => sum + safeNumber(item.qty), 0);
    row.discounts += safeNumber(sale.discountAmount);
    row.net += safeNumber(sale.total) - safeNumber(sale.refundedAmount);
  }

  const rows = [...byStaff.values()].sort((a, b) => b.net - a.net);
  qs("#managerStaffTable").innerHTML = rows.length
    ? rows.map((row) => `<tr>
        <td>${esc(row.name)}</td>
        <td>${row.count}</td>
        <td>${row.items}</td>
        <td>${money(row.discounts)}</td>
        <td class="${row.voids > 0 ? "cell-warn" : ""}">${row.voids}</td>
        <td><strong>${money(row.net)}</strong></td>
      </tr>`).join("")
    : `<tr><td colspan="6" class="empty-state">${t("control.noSalesToday")}</td></tr>`;
}

// Owner panel: whole business, month to date, plus the governance facts an
// owner is accountable for and nobody else can see.
// A sale's total is not tied to its line items anywhere a server can check.
// Firestore rules cannot iterate or sum a list, and the per-item unrolled
// version of this was removed from firestore.rules because it blew the
// 1000-expression evaluation budget on the sale path and took the till offline.
// Measured against the emulator: a basket of 10 x 1,500 can be written with a
// total of 1, or 0, and the rules accept it.
//
// So this is detection rather than prevention, which is the honest answer to an
// invariant that cannot be enforced where it matters. It recomputes each sale
// from its own line items and reports what disagrees, for the owner to act on.
//
// A cash sale under-reported this way also shows up as a drawer that is OVER at
// shift close, so the two controls corroborate each other: one names the sale,
// the other names the shift.
const SALE_TOTAL_TOLERANCE = 1;   // absorbs rounding, not tampering

function saleLineItemsTotal(sale) {
  if (!Array.isArray(sale.items)) return null;
  let sum = 0;
  for (const item of sale.items) {
    const qty = safeNumber(item.quantity ?? item.qty);
    const price = safeNumber(item.sellingPrice ?? item.price);
    sum += qty * price;
  }
  return sum;
}

function saleTotalMismatches(sales) {
  const out = [];
  for (const sale of sales || []) {
    if (sale.voided) continue;
    const lineTotal = saleLineItemsTotal(sale);
    if (lineTotal === null) continue;
    // Discounts legitimately move the total away from the line sum, so they are
    // added back before comparing. Without this every discounted sale would be
    // reported as tampering, and a report that cries wolf is not read.
    const discount = safeNumber(sale.discountAmount);
    const expected = lineTotal - discount;
    const gap = safeNumber(sale.total) - expected;
    if (Math.abs(gap) > SALE_TOTAL_TOLERANCE) {
      out.push({ id: sale.id, orderNumber: sale.orderNumber, recorded: safeNumber(sale.total), expected, gap });
    }
  }
  return out;
}

// ---- Fault reporting -------------------------------------------------------
//
// Before this, 73 console.warn and console.error calls wrote to a browser
// console on a shopkeeper's phone. Nobody opens that. A shop hitting a fault
// reached us only if someone thought to telephone, which means the first report
// of a broken till is an angry call rather than a row in a list.
//
// Deliberately small. This is not crash reporting as a service: it captures
// what broke, where, and under which build, and puts it somewhere the owner
// already looks. No third party, no new dependency, no monthly bill on a
// product whose whole economics are thin.
//
// Three things it must never do: cost more than it is worth, leak a customer's
// details, or break the app it is watching.

const ERROR_LOG_MAX_PER_SESSION = 5;   // a render loop must not write a thousand rows
const ERROR_LOG_MESSAGE_MAX = 300;     // matches the cap in firestore.rules

const reportedFaults = new Set();      // dedupe: the same fault repeats, it is still one fault
let faultsReportedThisSession = 0;

// Error text is written by developers but can carry whatever it was handed --
// a customer name in a thrown message, a phone number in a failed lookup. None
// of that belongs in a log, so it is removed before the message leaves the
// device rather than trusted not to be there.
function scrubFaultText(value) {
  return String(value ?? "")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, "[email]")
    .replace(/\b(?:\+?255|0)\d{8,9}\b/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ERROR_LOG_MESSAGE_MAX);
}

async function reportFault(kind, message, where) {
  try {
    const text = scrubFaultText(message);
    if (!text) return;
    // Dedupe before the session cap, so five DIFFERENT faults are five rows
    // rather than one fault counted five times.
    const key = `${kind}:${text}:${where || ""}`;
    if (reportedFaults.has(key)) return;
    reportedFaults.add(key);
    if (faultsReportedThisSession >= ERROR_LOG_MAX_PER_SESSION) return;
    faultsReportedThisSession += 1;

    if (!state.db || !state.user || !state.businessOwnerUid) return;
    const { collection, doc, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    const ref = doc(collection(state.db, "users", state.businessOwnerUid, "errorLog"));
    await setDoc(ref, {
      kind,
      message: text,
      where: scrubFaultText(where).slice(0, 200) || null,
      uid: state.user.uid,
      storeId: state.currentStoreId && state.currentStoreId !== "all" ? state.currentStoreId : null,
      appVersion: APP_VERSION,
      createdAt: serverTimestamp()
    });
  } catch {
    // A reporter that throws takes down the thing it was meant to watch. It
    // stays silent instead: a missing fault row is a smaller problem than a
    // till that stopped working because logging failed.
  }
}

function installFaultReporting() {
  window.addEventListener("error", (event) => {
    const where = event.filename
      ? `${String(event.filename).split("/").pop()}:${event.lineno || 0}`
      : "";
    reportFault("error", event.message || event.error?.message || "Unknown error", where);
  });

  // A rejected promise nobody caught is the commonest way this app fails --
  // every Firestore call is one -- and it never reaches the handler above.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportFault("rejection", reason?.message || reason?.code || String(reason), "promise");
  });
}

// Read for the owner panel. Bounded and quiet, like the credit overrides tile:
// a supervisory figure must never take down the screen showing the day's cash.
const FAULT_WINDOW_DAYS = 7;
let faultFetchKey = null;

function ensureFaultsLoaded() {
  if (!state.db || !state.businessOwnerUid) return;
  if (faultFetchKey === state.businessOwnerUid) return;
  faultFetchKey = state.businessOwnerUid;
  loadFaults().then(() => renderAdminControl());
}

async function loadFaults() {
  try {
    const { collection, query, orderBy, limit, getDocs } = state.firebaseApi.firestore;
    const snapshot = await getDocs(query(
      collection(state.db, "users", state.businessOwnerUid, "errorLog"),
      orderBy("createdAt", "desc"),
      limit(50)
    ));
    const since = Date.now() - FAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    state.faults = snapshot.docs
      .map((entry) => entry.data())
      .filter((row) => row.createdAt?.toDate && row.createdAt.toDate().getTime() >= since);
  } catch (error) {
    console.warn("Could not load the fault log.", error);
    state.faults = null;
  }
}

function renderAdminControl() {
  const panel = qs("#adminControlPanel");
  if (!panel) return;
  panel.hidden = !isOwnerRole();
  if (panel.hidden) return;

  const now = new Date();
  const monthSales = state.sales.filter((sale) => isSameMonth(saleTimestamp(sale), now));
  const todaySales = monthSales.filter((sale) => isSameDay(saleTimestamp(sale), now));
  const month = summariseSales(monthSales);
  const today = summariseSales(todaySales);

  // Cost of goods is estimated from each product's CURRENT costPrice, because
  // sale items do not carry the cost they were bought at. A price change
  // therefore rewrites history here -- fine for a running indicator, not for
  // accounts, which is why the tile says estimated.
  const costById = new Map(state.products.map((p) => [p.id, safeNumber(p.costPrice)]));
  let cogs = 0;
  let costKnown = true;
  for (const sale of monthSales) {
    if (sale.voided) continue;
    for (const item of sale.items || []) {
      if (!costById.has(item.productId)) costKnown = false;
      cogs += (costById.get(item.productId) || 0) * safeNumber(item.qty);
    }
  }
  const margin = month.net - cogs;
  const marginPct = month.net > 0 ? Math.round((margin / month.net) * 100) : 0;

  const stockAtCost = state.products.reduce((sum, p) => sum + safeNumber(p.quantity) * safeNumber(p.costPrice), 0);
  const stockAtRetail = state.products.reduce((sum, p) => sum + safeNumber(p.quantity) * safeNumber(p.sellingPrice), 0);
  const creditOwed = state.customers.reduce((sum, c) => sum + safeNumber(c.balanceOwed), 0);

  ensureFaultsLoaded();
  const totalMismatches = saleTotalMismatches(state.sales);

  qs("#adminControlGrid").innerHTML = [
    controlTile(t("control.revenueToday"), money(today.net)),
    controlTile(t("control.revenueMonth"), money(month.net), "accent",
      t("control.salesCountNote", { count: String(month.count) })),
    controlTile(t("control.grossMargin"), `${money(margin)} · ${marginPct}%`,
      margin <= 0 && month.net > 0 ? "danger" : "",
      costKnown ? t("control.marginNote") : t("control.marginIncomplete")),
    controlTile(t("control.stockAtCost"), money(stockAtCost), "",
      t("control.stockAtRetail", { value: money(stockAtRetail) })),
    controlTile(t("control.creditOwed"), money(creditOwed), creditOwed > 0 ? "warn" : ""),
    controlTile(t("control.voidsMonth"), `${month.voidCount} · ${money(month.voidValue)}`,
      month.voidCount > 0 ? "warn" : ""),
    controlTile(t("control.refundsMonth"), `${month.refundCount} · ${money(month.refundValue)}`,
      month.refundCount > 0 ? "warn" : ""),
    controlTile(t("control.discountsMonth"), money(month.discounts), month.discounts > 0 ? "warn" : ""),
    // Nothing server-side can prove a total matches its line items, so this
    // reports the ones that do not rather than pretending the check exists.
    // A fault nobody can see is a fault reported by an angry phone call.
    controlTile(t("control.faults"),
      state.faults === null ? "—" : String(state.faults.length),
      state.faults?.length ? "danger" : "",
      state.faults?.length ? t("control.faultsNote") : t("control.faultsClear")),
    controlTile(t("control.totalMismatches"), String(totalMismatches.length),
      totalMismatches.length ? "danger" : "",
      totalMismatches.length ? t("control.totalMismatchNote") : t("control.totalMismatchClear"))
  ].join("");

  const stores = activeStores();
  qs("#adminStoreTable").innerHTML = stores.length
    ? stores.map((store) => {
        const storeMonth = summariseSales(monthSales.filter((sale) => sale.storeId === store.id));
        const storeToday = summariseSales(todaySales.filter((sale) => sale.storeId === store.id));
        const storeProducts = state.products.filter((p) => p.storeId === store.id);
        const out = storeProducts.filter((p) => safeNumber(p.quantity) <= 0).length;
        const low = storeProducts.filter((p) => {
          const qty = safeNumber(p.quantity);
          return qty > 0 && qty <= safeNumber(p.reorderLevel);
        }).length;
        const cost = storeProducts.reduce((sum, p) => sum + safeNumber(p.quantity) * safeNumber(p.costPrice), 0);
        return `<tr>
          <td>${esc(store.name || t("storeSwitcher.fallbackName"))}</td>
          <td>${money(storeToday.net)}</td>
          <td><strong>${money(storeMonth.net)}</strong></td>
          <td class="${out > 0 ? "cell-danger" : (low > 0 ? "cell-warn" : "")}">${low} / ${out}</td>
          <td>${money(cost)}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="empty-state">${t("control.noStores")}</td></tr>`;

  const roleCount = (role) => state.members.filter((m) => m.role === role).length;
  const unnamedMembers = state.members.filter((m) => !String(m.name || "").trim()).length;
  const governance = [
    [t("control.govTeam"), t("control.govTeamValue", {
      managers: String(roleCount("manager")), cashiers: String(roleCount("cashier"))
    }), ""],
    [t("control.govOverride"), state.overridePasswordSet ? t("control.govSet") : t("control.govNotSet"),
      state.overridePasswordSet ? "" : "warn"],
    [t("control.govUnnamed"), String(unnamedMembers), unnamedMembers > 0 ? "warn" : ""],
    [t("control.govDeletion"), state.deletionScheduledFor
      ? t("control.govDeletionPending") : t("control.govDeletionNone"),
      state.deletionScheduledFor ? "danger" : ""]
  ];
  qs("#adminGovernance").innerHTML = governance.map(([label, value, tone]) =>
    `<div class="governance-row${tone ? ` ${tone}` : ""}">
      <span>${esc(label)}</span><strong>${esc(value)}</strong>
    </div>`).join("");
}

// Identity for a sale, return or transfer: always the signed-in account.
function saleIdentity() {
  return {
    id: state.user?.uid || "",
    name: String(state.currentUserName || "").trim().slice(0, 80)
  };
}

function isManagerOrOwnerRole() {
  return state.currentUserRole === "owner" || state.currentUserRole === "manager";
}

// The signed-in member's own role, watched rather than read once.
//
// resolveCurrentUserRole() ran only at sign-in, so an owner who demoted a
// manager mid-shift changed nothing that browser could see. firestore.rules
// refused the writes from the very next request -- proved end to end on one
// unchanged token by tests/rules-role-propagation.test.mjs -- but the till went
// on showing void, return and credit-limit controls until someone happened to
// reload. That inverts "hide, don't disable" at the exact moment a trust
// decision has just been made, and a POS tab can stay open all day.
//
// One document, which the rules already let a member read on their own doc.
// The owner is skipped: they have no member document and their role cannot
// change.
// The stock ledger, owner-only (L-2). firestore.rules makes this collection
// owner-read, so a manager or cashier subscribing would only ever be denied --
// the reconciliation this feeds is an owner's check on their own shop.
//
// Newest-first with a bound, because the ledger grows forever and the view only
// needs each product's most recent entry. Products whose last movement falls
// outside the window read as unchecked rather than as discrepancies.
const STOCK_LEDGER_LIMIT = 500;

function subscribeToStockLedger() {
  if (state.unsubscribeStockLedger) state.unsubscribeStockLedger();
  state.unsubscribeStockLedger = null;
  state.stockLedgerLatest = null;
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (!isOwnerRole()) return;

  try {
    const { collection, onSnapshot, orderBy, query, limit } = state.firebaseApi.firestore;
    state.unsubscribeStockLedger = onSnapshot(
      query(
        collection(state.db, "users", state.businessOwnerUid, "stockMovements"),
        orderBy("createdAt", "desc"),
        limit(STOCK_LEDGER_LIMIT)
      ),
      (snapshot) => {
        state.stockLedgerLatest = latestMovementByProduct(snapshot.docs.map((entry) => entry.data()));
        renderAll();
      },
      (error) => {
        // Fails quiet and unchecked, never as a finding: an unreadable ledger
        // is not evidence that stock is missing.
        console.warn("Could not read the stock ledger.", error);
        state.stockLedgerLatest = null;
        renderAll();
      }
    );
  } catch (error) {
    console.warn("Could not subscribe to the stock ledger.", error);
  }
}

// Products whose shelf disagrees with the ledger. Only ever counts entries that
// were actually checked -- "unknown" is not a finding.
function stockLedgerDiscrepancies() {
  if (!state.stockLedgerLatest) return null;
  return storeProducts()
    .map((product) => ({ product, result: reconcileProductStock(product, state.stockLedgerLatest.get(product.id)) }))
    .filter((row) => row.result.status === "mismatch");
}

function subscribeToOwnMembership() {
  if (state.unsubscribeOwnMembership) state.unsubscribeOwnMembership();
  state.unsubscribeOwnMembership = null;
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.user.uid === state.businessOwnerUid) return;

  try {
    const { doc, onSnapshot } = state.firebaseApi.firestore;
    state.unsubscribeOwnMembership = onSnapshot(
      doc(state.db, "users", state.businessOwnerUid, "members", state.user.uid),
      (snapshot) => {
        const data = snapshot.exists() ? snapshot.data() : null;
        // Revoked or suspended. Access is already gone at the rules layer, so
        // ending the session is the honest outcome -- the alternative is a till
        // that looks alive and refuses every touch, which reads as "the app is
        // broken" rather than "your access was removed".
        if (!data || data.status !== "active") {
          handleMembershipEnded();
          return;
        }
        const nextRole = data.role || "cashier";
        if (nextRole !== state.currentUserRole) {
          state.currentUserRole = nextRole;
          clearMemberDocCache();
          renderAll();
        }
      },
      (error) => {
        // Fails closed. A dead listener cannot be told apart from a demotion,
        // so drop to the most restrictive role rather than trusting a cached
        // one -- the same reasoning as resolveCurrentUserRole()'s default.
        console.warn("Could not watch membership; assuming least privilege.", error);
        state.currentUserRole = "cashier";
        renderAll();
      }
    );
  } catch (error) {
    console.warn("Could not subscribe to membership.", error);
  }
}

async function handleMembershipEnded() {
  if (state.membershipEnded) return;
  state.membershipEnded = true;
  state.currentUserRole = null;
  renderAll();
  showToast(t("auth.accessRemoved"));
  try {
    const { signOut } = state.firebaseApi.auth;
    await signOut(state.auth);
  } catch (error) {
    console.warn("Could not sign out after access removal.", error);
  }
}

// A cashier counts down the drawer they opened, and no one else's; a manager or
// the owner may close any shift on a till they can reach, so a cashier who goes
// home without closing cannot strand it. Mirrors the shifts update rule in
// firestore.rules -- the rule is the boundary, this only decides whether the
// control is worth showing. Hidden rather than disabled, per the same reasoning
// as the rest of the role gating: a visible control that always refuses tells a
// bad actor where to push.
function canCloseOpenShift(shift) {
  if (!shift) return false;
  if (isManagerOrOwnerRole()) return true;
  return Boolean(state.user) && shift.openedByUid === state.user.uid;
}

// Static, owner-only store controls (rules: stores update = isOwner only,
// no manager/cashier branch) -- these aren't re-rendered per snapshot like
// table rows, so they need their own visibility pass, called from renderAll().
function applyStoreOwnerControlsVisibility() {
  const ownerOnly = isOwnerRole();
  [
    "renameStoreButton", "setBusinessTypeButton", "setCurrencyButton", "archiveStoreButton", "overridePasswordSettingsButton",
    "vatSettingsButton",
    // Whole-business data export (downloadBackupButton) and monthlyReports
    // generation (no manager/cashier branch in the rules at all, and a
    // non-owner click would still trigger a billed AI proxy call before
    // Firestore ever rejected the write). The hand-maintained cashier-name
    // list that used to sit here is gone: staff are identified by the account
    // they sign in with.
    "downloadBackupButton", "generateMonthlyReportButton"
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
        // Cleared here, not on sign-out: a member who was revoked and later
        // reinstated must be able to sign in again without a page reload.
        state.membershipEnded = false;
        state.graceAccessLogged = false;
        state.businessOwnerUid = await resolveBusinessOwnerUid(user);
        state.currentUserRole = await resolveCurrentUserRole(user, state.businessOwnerUid);
        state.currentUserName = await resolveCurrentUserName(user, state.businessOwnerUid);
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
        subscribeToOwnMembership();
        subscribeToStockLedger();
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
        if (state.unsubscribeOwnMembership) state.unsubscribeOwnMembership();
        state.unsubscribeOwnMembership = null;
        if (state.unsubscribeStockLedger) state.unsubscribeStockLedger();
        state.unsubscribeStockLedger = null;
        state.stockLedgerLatest = null;
        if (state.unsubscribeMonthlyReports) state.unsubscribeMonthlyReports();
        state.unsubscribeMonthlyReports = null;
        if (state.unsubscribeCustomers) state.unsubscribeCustomers();
        state.unsubscribeCustomers = null;
        if (state.unsubscribeTransfers) state.unsubscribeTransfers();
        state.unsubscribeTransfers = null;
        state.products = [];
        state.cart = [];
        state.sales = [];
        // Cleared with the sales they described, or the banner outlives the
        // session it belonged to and greets the next sign-in with a warning
        // about somebody else's queue.
        state.unsyncedSaleCount = 0;
        state.pendingSaleIds = new Set();
        state.salesRenderedOnce = false;
        state.stores = [];
        state.staff = [];
        state.members = [];
        state.monthlyReports = [];
        state.customers = [];
        state.transfers = [];
        state.currentStoreId = "";
        state.businessOwnerUid = "";
        state.currentUserRole = null;
        state.currentUserName = "";
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
  state.productsLoadFailed = false;
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
        state.productsLoadFailed = false;
        scheduleRenderAll();
      },
      (error) => {
        console.error("[products listener]", error.code || error, "queryStoreIds=", queryStoreIds);
        showToast(t("toast.couldNotLoadInventory"));
        // The toast is seen once and then gone; the table is what someone
        // stares at. Say the load failed rather than pretending it continues.
        state.productsLoadFailed = true;
        scheduleRenderAll();
      }
    );
  } catch (error) {
    console.warn(error);
    state.productsLoadFailed = true;
    scheduleRenderAll();
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
      state.unsyncedSaleCount = 0;
      state.pendingSaleIds = new Set();
      state.salesRenderedOnce = true;
      renderUnsyncedSalesBanner();
      renderPaymentReports();
      return;
    }
    // orderBy + where("in") together need a composite index on
    // (storeId asc, createdAt desc) -- Firestore's console error, if it
    // appears the first time a staff account runs this, includes a direct
    // link to create it; click it once and the query works from then on.
    const salesQuery = queryStoreIds === null
      ? query(salesRef, orderBy("createdAt", "desc"), limit(SALES_HISTORY_LIMIT))
      : query(salesRef, where("storeId", "in", queryStoreIds), orderBy("createdAt", "desc"), limit(SALES_HISTORY_LIMIT));
    // includeMetadataChanges is what makes the unsynced count able to reach
    // zero (L-9 phase D). A queued write's acknowledgement changes no document
    // DATA, only its metadata, so without this the listener never fires again
    // after the replay and the banner would sit there claiming sales are still
    // held long after they landed -- worse than not showing it at all.
    //
    // The cost of asking for those extra callbacks is paid back immediately
    // below: docChanges() excludes metadata-only changes by default, so a
    // metadata-only wake-up updates the count and stops, rather than dragging
    // the whole reports render (chart, breakdowns, customer accounts) through
    // a second pass for a snapshot whose contents are identical.
    state.unsubscribeSales = onSnapshot(
      salesQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        // Which sales are still queued is tracked in its own Set rather than as
        // a field on each sale, and that is load-bearing rather than tidiness.
        // productUnitsSold() caches on state.sales by ARRAY IDENTITY, on the
        // stated grounds that the array is replaced wholesale only when the data
        // changes. Rebuilding it on every metadata wake-up would quietly break
        // that premise and hand the cache a miss per acknowledged write -- a
        // full pass over the sales history for a snapshot whose contents are
        // identical. state.sales is therefore still replaced only when something
        // really changed.
        const pendingIds = new Set();
        snapshot.docs.forEach((docSnap) => {
          if (docSnap.metadata.hasPendingWrites === true) pendingIds.add(docSnap.id);
        });
        state.pendingSaleIds = pendingIds;
        state.unsyncedSaleCount = pendingIds.size;
        renderUnsyncedSalesBanner();
        // docChanges() excludes metadata-only changes by default -- that is what
        // makes asking for them affordable.
        if (snapshot.docChanges().length > 0 || !state.salesRenderedOnce) {
          state.sales = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
          state.salesRenderedOnce = true;
          renderPaymentReports();
        }
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

// VAT registration is a business-wide fact stored on every store document, for
// the reason given in firestore.rules: the owner document is owner-read-only
// and a cashier's till has to know whether it is charging VAT. The store the
// till is transacting against is the copy that decides -- a branch-scoped
// member may not be able to read any of the others at all.
function vatSettings() {
  const store = state.stores.find((item) => item.id === state.currentStoreId) || state.stores[0];
  return {
    registered: store?.vatRegistered === true,
    vrn: String(store?.vrn || ""),
    tin: String(store?.tin || "")
  };
}

function renderVatControls() {
  // A shop under the TZS 200m threshold should never be asked to classify its
  // stock for a tax it does not collect. The VAT button's own owner-only
  // visibility is handled by applyStoreOwnerControlsVisibility() with the rest
  // of the store controls.
  const field = qs("#productTaxClassField");
  if (field) field.hidden = !vatSettings().registered;
}

function openVatSettingsDialog() {
  if (!isOwnerRole()) return;
  if (!state.stores.length) return showToast(t("toast.vatNeedsStore"));
  const current = vatSettings();
  qs("#vatRegisteredInput").checked = current.registered;
  qs("#vatVrnInput").value = current.vrn;
  qs("#vatTinInput").value = current.tin;
  qs("#vatSettingsDialog").showModal();
}

async function saveVatSettings() {
  if (!isOwnerRole() || !state.db || !state.user) return;
  const registered = qs("#vatRegisteredInput").checked;
  const vrn = qs("#vatVrnInput").value.trim();
  const tin = qs("#vatTinInput").value.trim();
  // A registered business without its VRN cannot produce a compliant record,
  // and a half-configured one is worse than one that is plainly off.
  if (registered && !vrn) return showToast(t("toast.vatVrnRequired"));

  try {
    const { doc, collection, setDoc, serverTimestamp, writeBatch } = state.firebaseApi.firestore;
    const previous = vatSettings();
    const batch = writeBatch(state.db);

    // Every store in one batch. The copies exist so a till can read them; the
    // batch is what stops them drifting apart, because a sale stamped with the
    // wrong VRN is a bad record on a document the shop is audited on.
    state.stores.forEach((store) => {
      const payload = { vatRegistered: registered, vrn, tin };
      // Stamped once, when VAT is first switched on, so reports can say from
      // when the scheme applies. Re-stamping on every save would move the
      // boundary and make older taxed sales look like they predate it.
      if (registered && !previous.registered && !store.vatEnabledAt) {
        payload.vatEnabledAt = serverTimestamp();
      }
      batch.set(doc(state.db, "users", state.user.uid, "stores", store.id), payload, { merge: true });
    });
    await batch.commit();

    try {
      await setDoc(doc(collection(state.db, "users", state.user.uid, "auditLogs")), {
        action: registered ? "VAT_REGISTRATION_ENABLED" : "VAT_REGISTRATION_DISABLED",
        vrn,
        previouslyRegistered: previous.registered,
        storeCount: state.stores.length,
        uid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });
    } catch (auditError) {
      console.warn(auditError);
    }

    qs("#vatSettingsDialog").close();
    showToast(t("toast.vatSaved"));
    renderAll();
  } catch (error) {
    console.warn(error);
    showToast(describeOperationError(error));
  }
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
        <td>${esc(member.name || "-")}</td>
        <td>${esc(member.email || "-")}</td>
        <td>${esc(member.role || "-")}</td>
        <td>${esc(storesLabel)}</td>
        <td class="table-actions">
          <button class="ghost-button compact danger" type="button" data-revoke-member="${member.id}">${t("staff.revokeButton")}</button>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="5" class="empty-state">${t("staff.rosterEmpty")}</td></tr>`;
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
    .map((store) => `<label class="checkbox-row"><input type="checkbox" class="invite-store-checkbox" value="${store.id}" /> <span>${esc(store.name || t("storeSwitcher.fallbackName"))}</span></label>`)
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

// Copies the bare accept URL and nothing else, so it can go straight into an
// address bar or a chat box. Anything else here corrupts the link: copying the
// whole message meant an address-bar paste folded "This link is valid for 48
// hours..." into the query string, and the older behaviour of copying the
// message's link LINE still carried a text prefix. Either way the token picked
// up stray characters, failed its hash check, and told the invitee their valid
// invitation was dead. The WhatsApp button still sends the full message with
// the business name and role -- that channel linkifies the URL correctly.
function copyInviteLink() {
  const acceptUrl = buildStaffInviteAcceptUrl(state.pendingInviteLinkToken);
  navigator.clipboard.writeText(acceptUrl)
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

// The hand-maintained users/{owner}/staff name list is no longer written to:
// staff exist because they accepted an invitation and signed in, so there is
// nothing for an owner to add or remove here. The collection is still READ --
// sales recorded before this change carry those staffIds, and Reports resolves
// historical names through it.

// Shows who the till is ringing sales as. This replaced a dropdown of names the
// owner maintained by hand: staff now sign in with their own credentials, so
// the identity is read off the account and cannot be mis-picked at the counter.
function renderStaffSelect() {
  const label = qs("#posStaffIdentity");
  if (!label) return;
  label.textContent = state.currentUserName || "";
}

// Order numbers are optional at the till. When one is left blank the system
// issues it from the clock rather than continuing the highest number on file:
// two tills selling at the same moment would both read the same highest value
// and mint the same number, and nothing in firestore.rules enforces uniqueness.
// The last 10 digits of the epoch millisecond satisfy the rules'
// ^[0-9]{1,10}$ and stay distinct for ~115 days, which is far longer than an
// order number needs to be unambiguous on a sales sheet.
function nextAutoOrderNumber() {
  return String(Date.now()).slice(-10);
}

// The access-during-grace entry (L-6).
//
// firestore.rules deliberately exempts auditLogs from tenantNotFrozen() so that
// "the deletion request itself, the restore, and any access attempt during the
// grace period" stay recordable while everything else is frozen, and
// DATA-DELETION.md describes that trail as policy. Nothing ever wrote the third
// one: the action existed in the rules and in a test that supplied its own
// name, and no production code emitted it. The permission was built and the
// writer never was.
//
// Once per sign-in, not once per render. The alternative -- an entry every time
// the app reloads a frozen tenant -- turns an evidence trail into a flood, and
// the thing worth evidencing is that someone came back during the grace period,
// which one entry per session says exactly.
//
// Owner-only, because a staff account under a frozen tenant has already been
// disabled and had its tokens revoked by the deletion request, and because the
// action is owner-scoped in the rules enum.
async function recordGraceAccess() {
  if (state.graceAccessLogged) return;
  if (!state.db || !state.user || state.user.uid !== state.businessOwnerUid) return;
  state.graceAccessLogged = true;
  try {
    const { doc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    await setDoc(doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs")), {
      action: "ACCOUNT_ACCESS_DURING_GRACE",
      uid: state.user.uid,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    // Never surfaced: a failed evidence entry must not be the reason an owner
    // cannot get back into the account they are trying to recover.
    console.warn("Could not record grace-period access.", error);
  }
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
    if (state.deletionScheduledFor) await recordGraceAccess();
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

// Pre-auth brute-force throttle. FAILS OPEN by design.
//
// This used to throw on any non-OK response or network error, and sign-in
// awaits it -- so whenever the Render free tier had spun down (it sleeps after
// roughly 15 minutes idle) NOBODY could sign in, owner or staff. Render answers
// requests during spin-up with its own error page, which carries no CORS
// headers, so the browser surfaced it as a CORS failure and the throw turned a
// sleeping side-service into a total outage of the product.
//
// Failing open is the right trade here. This check only slows repeated
// guessing; it authenticates nobody. Firebase Auth applies its own independent
// rate limiting, and this throttle is already bypassable by calling Identity
// Toolkit directly (see SECURITY-AUDIT.md F-2) -- App Check enforcement is the
// real control. Losing a bypassable throttle for a few seconds is a far smaller
// harm than locking every user out of the application.
//
// A genuine 429 is still honoured: that is the server deliberately answering.
async function checkAuthAttemptLimit(email) {
  let response;
  try {
    response = await fetch(new URL("/api/auth/check-limit", aiConfig.proxyUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(8000)
    });
  } catch (error) {
    console.warn("Auth throttle unreachable; continuing without it.", error);
    return;
  }

  if (response.status === 429) {
    const error = new Error("Too many authentication attempts.");
    error.code = "auth/too-many-requests";
    throw error;
  }
  if (!response.ok) {
    // 5xx, or a proxy-layer error page during cold start. Not a decision the
    // throttle actually made, so it must not block sign-in.
    console.warn(`Auth throttle returned ${response.status}; continuing without it.`);
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

// A cashier works the till and nothing else. Dashboard, Reports and AI Advisor
// are whole-business performance views (revenue, per-staff breakdowns, advisory
// analysis) that a till operator has no operational need for; Inventory exposes
// stock levels, cost prices and supplier detail across the business. All are
// hidden rather than shown-and-denied. The rules still permit a cashier's
// restock writes, so this is a deliberate product decision about what belongs
// on a till, not a security boundary -- firestore.rules remains that.
const CASHIER_ALLOWED_VIEWS = ["pos"];

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

// The command palette is a plain <div>, not a <dialog>, so none of the modal
// behaviour a browser gives showModal() applies: no focus trap, no inertness,
// no focus restore. It was also marked aria-hidden="true" in the markup and the
// attribute was never updated, so it stayed invisible to assistive technology
// while visibly open -- and focus was moved INTO that hidden subtree, which
// tells a screen reader the element holding focus does not exist.
//
// Rewriting it as a <dialog> would be the cleaner fix, but it is opened from a
// global key handler on every view and closed from four places; this keeps the
// existing shape and supplies the behaviour the element type does not.
let commandPaletteReturnFocus = null;

function isCommandPaletteOpen() {
  return qs("#commandPalette").classList.contains("open");
}

function commandPaletteItems() {
  return qsa("#commandResults .command-result");
}

function openCommandPalette() {
  const palette = qs("#commandPalette");
  // Remember where the user was so Escape can put them back, rather than
  // dropping focus onto <body> and restarting Tab from the top of the document.
  commandPaletteReturnFocus = document.activeElement;
  palette.classList.add("open");
  palette.setAttribute("aria-hidden", "false");
  renderCommands();
  qs("#commandInput").value = "";
  qs("#commandInput").focus();
}

function closeCommandPalette({ restoreFocus = true } = {}) {
  const palette = qs("#commandPalette");
  if (!palette.classList.contains("open")) return;
  palette.classList.remove("open");
  palette.setAttribute("aria-hidden", "true");
  // Focus must leave before the subtree is hidden again, or focus is left on an
  // aria-hidden element -- the same defect in the other direction.
  if (restoreFocus && commandPaletteReturnFocus?.isConnected) {
    commandPaletteReturnFocus.focus();
  } else if (document.activeElement && palette.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  commandPaletteReturnFocus = null;
}

// Arrow keys move through results, Enter runs the focused one, and Tab is
// contained. Without the trap, one Tab from the search box landed on the page
// behind an apparently-modal overlay.
function handleCommandPaletteKeys(event) {
  const items = commandPaletteItems();

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown"
      ? (at + 1) % items.length
      : (at <= 0 ? items.length - 1 : at - 1);
    items[next].focus();
    return;
  }

  // From a result, Enter is the button's own job. From the search box it should
  // run the first match, which is what a command palette is for.
  if (event.key === "Enter" && document.activeElement === qs("#commandInput") && items.length) {
    event.preventDefault();
    items[0].click();
    return;
  }

  if (event.key === "Tab") {
    const focusable = [qs("#commandInput"), ...items];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
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

  // Buttons, not divs. These used to be plain <div>s, so a keyboard shortcut
  // opened a palette that could be typed into but never operated: no result was
  // focusable and none could be activated without a mouse.
  qs("#commandResults").innerHTML = commands
    .map(([view, label]) =>
      `<button type="button" class="command-result" data-command-view="${view}">${label}</button>`)
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
  renderManagerControl();
  renderAdminControl();
  // Depends on the resolved account name, which arrives with the role after
  // sign-in rather than with the staff snapshot.
  renderStaffSelect();
  renderCards();
  renderPaymentReports();
  renderAiQuestionSuggestions();
  renderVatControls();
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
  qs("#vatSettingsButton")?.addEventListener("click", openVatSettingsDialog);
  qs("#saveVatSettingsButton")?.addEventListener("click", saveVatSettings);
  qs("#closeVatSettingsDialog")?.addEventListener("click", () => qs("#vatSettingsDialog").close());
  qs("#cancelVatSettingsDialog")?.addEventListener("click", () => qs("#vatSettingsDialog").close());
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
  qs("#updateReloadButton")?.addEventListener("click", () => location.reload());
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
      closeCommandPalette({ restoreFocus: false });
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

    const seller = saleIdentity();
    if (!seller.id || !seller.name) return showToast(t("toast.staffIdentityUnavailable"));

    // Claimed before the first await, not after it. The credit-alert check
    // awaits a network round trip to verify the override password, and the page
    // stays interactive for the whole of it -- so the button was live during
    // exactly the pause a cashier is most likely to tap it again.
    const completeButton = qs("#completeSaleButton");
    if (completeButton.disabled) return;
    completeButton.disabled = true;
    // Re-enabled in the finally below, so no path can leave the till dead.
    try {

    // Typed order numbers are matched against the sales sheet, so they are still
    // validated -- but the length cap now mirrors firestore.rules exactly. It
    // was ^[0-9]+$ here, which let an 11-digit entry through the client only to
    // be rejected by the rules mid-transaction.
    const orderNumberRaw = qs("#posOrderNumber")?.value.trim() || "";
    if (orderNumberRaw && !/^[0-9]{1,10}$/.test(orderNumberRaw)) return showToast(t("toast.orderNumberInvalid"));

    // Held on state rather than generated per click. The sale document id below
    // is derived from the order number to make retries idempotent, so minting a
    // fresh number on every press would hand a double-tap two different ids and
    // record the sale twice, decrementing stock twice with it. One number per
    // cart, cleared once the sale lands.
    if (!orderNumberRaw && !state.pendingAutoOrderNumber) {
      state.pendingAutoOrderNumber = nextAutoOrderNumber();
    }
    const orderNumber = orderNumberRaw || state.pendingAutoOrderNumber;

    const customerName = (qs("#posCustomerName")?.value || "").trim().slice(0, 80);
    const customerPhone = (qs("#posCustomerPhone")?.value || "").trim().slice(0, 20);

    // Only worth warning about for a number the operator typed; a generated one
    // cannot collide with their own earlier sale.
    let duplicate = null;
    if (orderNumberRaw) {
      duplicate = state.sales.find(
        (sale) => !sale.voided && sale.staffId === seller.id && String(sale.orderNumber || "") === orderNumberRaw
      );
      if (duplicate) {
        const proceed = window.confirm(t("dialog.duplicateOrderConfirm", { orderNumber: orderNumberRaw, name: seller.name }));
        if (!proceed) return;
      }
    }

    // Read once, before anything uses it. Declared further down with the tax
    // computation, the read inside saleItems below sat in the temporal dead
    // zone and threw ReferenceError on EVERY sale, registered or not.
    const vatConfig = vatSettings();

    // Snapshotted once, and everything below uses THIS rather than state.cart.
    // Firestore retries a transaction callback on contention while the POS
    // stays interactive, so a cart edited during a retry decremented different
    // products than the sale record listed -- stock moving for goods no sale
    // mentions, which the ledger chain then reports as unaccounted. saleItems
    // was already a snapshot; the product refs and the tax lines were not.
    const cart = state.cart.map((cartItem) => ({ ...cartItem }));

    const saleItems = cart.map((cartItem) => ({
      productId: cartItem.id,
      name: cartItem.name,
      category: cartItem.category || "",
      brand: cartItem.brand || "",
      supplier: cartItem.supplier || "",
      qty: cartItem.qty,
      sellingPrice: Number(cartItem.sellingPrice || 0),
      lineTotal: cartItem.qty * Number(cartItem.sellingPrice || 0),
      // The class this line was SOLD under, recorded on the line rather than
      // looked up from the product later -- a product reclassified next year
      // must not retrospectively re-rate a sale already made.
      //
      // DESIGN-vat.md claimed this from the start and it was not implemented,
      // which is why the VAT owed on a refund cannot be computed for any sale
      // rung up before this build (see L-12). Written only for a registered
      // business, like every other tax field.
      ...(vatConfig.registered ? { taxClass: taxClassOf(cartItem) } : {})
    }));
    const subtotal = saleItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const discountType = state.discountType || "none";
    const discountAmount = computeDiscountAmount(subtotal);
    const total = Math.round(Math.max(0, subtotal - discountAmount));
    // VAT (DESIGN-vat.md), computed once here so the online path, the offline
    // path and the receipt agree by construction rather than by three copies of
    // the same arithmetic.
    //
    // netTotal is derived from the total ACTUALLY being written, not from the
    // tax helper's own idea of it. The two agree today -- prices are whole
    // shillings, so every lineTotal is an integer and the sums cannot diverge --
    // but the rules enforce netTotal + taxTotal == total, and a divergence would
    // not be a wrong report, it would be a REJECTED sale and a till that has
    // stopped selling. Deriving it makes that impossible rather than unlikely.
    let taxFields = {};
    if (vatConfig.registered) {
      const computed = computeSaleTax(
        cart.map((cartItem) => ({
          inclusive: cartItem.qty * Number(cartItem.sellingPrice || 0),
          taxClass: taxClassOf(cartItem)
        })),
        discountAmount
      );
      const taxTotal = Math.min(Math.max(computed.taxTotal, 0), total);
      taxFields = {
        vatRegistered: true,
        // Stamped onto the sale rather than read live at print time: a receipt
        // reprinted next year is a document the shop is audited on, and it must
        // show the number that was in force when the sale happened, not the one
        // configured today.
        vrn: vatConfig.vrn,
        vatRate: computed.vatRate,
        taxTotal,
        netTotal: total - taxTotal,
        taxBreakdown: computed.breakdown
      };
    }

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
    let creditLimitDecision = { allowed: true, overridden: false };
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
      if (creditBalanceDue > 0) {
        creditLimitDecision = await checkCreditLimitBeforeSale(customerName, creditPhoneKey, creditBalanceDue);
        if (!creditLimitDecision.allowed) return;
      }
    }

    if (!seller.id || !seller.name || !/^[0-9]{1,10}$/.test(orderNumber)) {
      showToast(t("toast.saleFailedGeneric"));
      return;
    }

    // Offline and paying by anything other than cash: refused with a reason of
    // its own rather than dropped into the transaction below to fail as a
    // generic error. See shouldQueueSaleOffline().
    if (state.db && state.user && state.businessOwnerUid && isOfflineNow() && paymentMethod !== "cash") {
      showToast(t("toast.offlineCashOnly"));
      return;
    }

    if (state.db && state.user && state.businessOwnerUid && shouldQueueSaleOffline(paymentMethod)) {
      const saleId = queueOfflineSale({
        items: saleItems,
        subtotal,
        discountType,
        discountValue: Number(state.discountValue || 0),
        discountAmount,
        total,
        cashTendered,
        changeDue,
        storeId: state.currentStoreId,
        staffId: seller.id,
        staffName: seller.name,
        orderNumber,
        customerName,
        customerPhone,
        duplicate,
        taxFields
      });
      state.lastSale = { mode: "firestore", saleId, items: saleItems, paymentMethod, total, ...taxFields };
      showToast(t("toast.saleQueuedOffline"));
    } else if (state.db && state.user && state.businessOwnerUid) {
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
        const dedupeSaleId = `ord_${seller.id}_${orderNumber}`;
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
            throw new Error(t("txerror.duplicateOrderSubmission", { orderNumber }));
          }

          const productRefs = cart.map((cartItem) => doc(state.db, "users", state.businessOwnerUid, "products", cartItem.id));
          const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
          const creditCustomerSnap = creditCustomerRef ? await transaction.get(creditCustomerRef) : null;

          productSnaps.forEach((snap, index) => {
            const cartItem = cart[index];
            if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: cartItem.name }));
            const currentQuantity = Number(snap.data().quantity || 0);
            if (currentQuantity < cartItem.qty) {
              throw new Error(t("txerror.notEnoughStockItem", { name: cartItem.name, quantity: currentQuantity }));
            }
          });

          productSnaps.forEach((snap, index) => {
            const cartItem = cart[index];
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
            // cartItem.id, not cartItem.productId. A cart entry is
            // { ...product, qty, sellingPrice }, and a product document carries
            // `id` -- there is no `productId` on it. This read undefined, the
            // ledger wrote an empty productId, the rule requires size() > 0,
            // and the rejection took the whole sale transaction down with it.
            // productRefs above has always used cartItem.id; these two must
            // name the same product or the entry describes the wrong shelf.
            recordStockMovement(transaction, {
              productId: cartItem.id, productName: cartItem.name,
              storeId: state.currentStoreId, reason: "sale",
              delta: -cartItem.qty, quantityBefore: currentQuantity, saleId
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
            staffId: seller.id,
            staffName: seller.name,
            orderNumber,
            customerName,
            customerPhone,
            voided: false,
            ...taxFields,
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

          // Credit extended without any ceiling check at all. Not a crossing
          // -- nothing was crossed, because nothing was known -- so it is a
          // separate action rather than a CREDIT_LIMIT_EXCEEDED with empty
          // numbers. Without this, the two ways the control silently does not
          // fire left no trace whatsoever.
          if (creditLimitDecision.limitChecked === false && creditBalanceDue > 0) {
            const uncheckedRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
            transaction.set(uncheckedRef, {
              action: "CREDIT_LIMIT_UNCHECKED",
              customerId: creditLimitDecision.customerId || null,
              customerName: customerName || null,
              reason: creditLimitDecision.uncheckedReason || "unknown",
              previousBalance: creditLimitDecision.previousBalance ?? null,
              saleTotal: total,
              storeId: state.currentStoreId,
              uid: state.user?.uid || null,
              createdAt: serverTimestamp()
            });
          }

          // Written in the same transaction as the sale it justifies. A record
          // of an override whose sale rolled back would be worse than none.
          if (creditLimitDecision.overridden) {
            const overrideRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
            transaction.set(overrideRef, {
              action: "CREDIT_LIMIT_EXCEEDED",
              customerId: creditLimitDecision.customerId,
              customerName: customerName || null,
              limit: creditLimitDecision.limit,
              previousBalance: creditLimitDecision.previousBalance,
              projectedTotal: creditLimitDecision.projectedTotal,
              // false means no override password was configured for this
              // business, so nobody was actually asked to authorise it.
              authorised: creditLimitDecision.authorised === true,
              saleTotal: total,
              storeId: state.currentStoreId,
              uid: state.user?.uid || null,
              createdAt: serverTimestamp()
            });
          }
        });

        state.lastSale = { mode: "firestore", saleId: saleRef.id, items: saleItems, paymentMethod, total, ...taxFields };
      } catch (error) {
        console.warn(error);
        showToast(describeOperationError(error, "toast.saleFailedGeneric"));
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
        staffId: seller.id,
        staffName: seller.name,
        orderNumber,
        customerName,
        customerPhone,
        voided: false,
        createdAt: new Date()
      });
      state.lastSale = { mode: "local", items: saleItems, paymentMethod, total, ...taxFields };
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
      staffName: seller.name,
      orderNumber,
      customerName,
      customerPhone,
      storeId: state.currentStoreId,
      // The tax the sale was just written with. Omitted here, every downstream
      // reader tests sale.vatRegistered === true against undefined and prints
      // nothing -- so the arithmetic, the rules and the renderer were all
      // correct and the customer still got a receipt with no VAT on it. A
      // registered business is required to hand over a tax invoice showing the
      // VAT charged and its VRN; this literal is what makes that true.
      ...taxFields,
      createdAt: new Date()
    });

    // The sale landed, so the held auto-number has done its job. The next cart
    // gets a fresh one.
    state.pendingAutoOrderNumber = "";
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
      showToast(changeDue > 0 ? t("toast.saleCompletedChange", { change: money(changeDue) }) : t("toast.saleCompleted"));
    } finally {
      // The till must never be left dead. The re-enable used to sit on two
      // specific paths -- the transaction catch, and the last line of the happy
      // path -- with an unguarded await and a full renderAll() in between.
      // Anything throwing there disabled the button permanently, and since the
      // sale may already have been written the cashier could not tell whether
      // to enter it again.
      completeButton.disabled = false;
    }
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

    // Counts and money have different ceilings, so each field is checked
    // against its own and named in the message. "Quantity or price is invalid"
    // told the user neither which box was wrong nor what would be accepted.
    // Counts and money have different ceilings, so each is checked against its
    // own and named in the message. "Quantity or price is invalid" told the
    // user neither which box was wrong nor what would be accepted. costPrice
    // has no input in this form today and arrives as 0; it is checked anyway so
    // adding the field later cannot quietly skip the bound.
    const numericFields = [
      ["quantity", product.quantity, MAX_COUNT, "product.quantityLabel"],
      ["costPrice", product.costPrice || 0, MAX_MONEY, "product.priceTypeLabel"],
      ["sellingPrice", product.sellingPrice || 0, MAX_MONEY, "product.priceLabel"],
      ["reorderLevel", product.reorderLevel || 0, MAX_COUNT, "product.reorderLabel"]
    ];
    for (const [field, raw, max, labelKey] of numericFields) {
      const value = clampNonNegativeNumber(raw, max);
      if (value === null) {
        showToast(t("toast.numberOutOfRange", {
          field: t(labelKey),
          max: max.toLocaleString()
        }));
        return;
      }
      product[field] = value;
    }
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
      // A modal dialog owns the top layer, so the palette cannot paint above it.
      // Opening anyway put it on screen invisibly, stole nothing (the browser
      // refuses focus outside an open modal), and then surfaced it the moment
      // the dialog closed.
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      openCommandPalette();
      return;
    }
    // Only act when it is actually open. Otherwise every Escape anywhere in the
    // app ran this, including the ones closing a dialog.
    if (event.key === "Escape" && isCommandPaletteOpen()) {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (isCommandPaletteOpen()) handleCommandPaletteKeys(event);
  });

  qs("#commandInput").addEventListener("input", (event) => renderCommands(event.target.value));
  // The shift panel is re-rendered on every data change, so its controls are
  // delegated: binding them directly would leave stale listeners on nodes that
  // no longer exist.
  qs("#shiftPanel")?.addEventListener("click", (event) => {
    if (event.target.closest("#openShiftButton")) {
      openShift(qs("#shiftFloatInput")?.value);
      return;
    }
    if (event.target.closest("#closeShiftButton")) {
      const button = event.target.closest("#closeShiftButton");
      // Counting a drawer twice because the first tap looked unresponsive is
      // exactly how a variance gets recorded against the wrong shift.
      if (button.disabled) return;
      button.disabled = true;
      closeShift(qs("#shiftCountedInput")?.value, qs("#shiftNoteInput")?.value)
        .finally(() => { button.disabled = false; });
    }
  });

  qs("#commandPalette").addEventListener("click", (event) => {
    if (event.target.id === "commandPalette") closeCommandPalette();
  });
}

// The landing page links here with ?mode=signin for "Sign in" and plainly for
// "Get started", so the two are one journey rather than two products that
// happen to share a palette. Signup stays the default for a bare visit.
installFaultReporting();
setAuthMode(new URLSearchParams(location.search).get("mode") === "signin" ? "signin" : "signup");
bindEvents();
initIdleActivityTracking();
watchConnection();
prewarmScannerWhenIdle();
translateStaticDom();
renderAll();
renderChatLog();
// Wake the proxy as soon as the page loads, not when the AI views are first
// opened. The Render free tier sleeps after roughly 15 minutes idle and takes
// tens of seconds to come back, and the pre-auth throttle sits on the sign-in
// path -- so the first person to open the app each morning was the one paying
// that cold-start cost. Fire-and-forget, and the throttle now fails open
// anyway, so this only shortens the window rather than being relied upon.
warmUpAiProxy();
initFirebase();

// How often an open till asks whether a new build exists. The browser only
// re-checks sw.js on navigation, and a shop navigates once a day -- when it
// opens. Without this, a deploy reaches the tills that reload and nobody else,
// which is tolerable for a feature and not tolerable for a fix or a rollback:
// the shop worst affected by a bad build is the one least likely to reload.
const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

function watchForAppUpdate(registration) {
  const check = () => { registration.update().catch(() => {}); };

  window.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
  // The cheap opportunistic checks: coming back to the tab, and regaining a
  // connection. A shop that has been offline for an hour is precisely the one
  // that may be several builds behind.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
  window.addEventListener("online", check);
  check();
}

function renderUpdateReadyBanner() {
  const banner = qs("#updateReadyBanner");
  if (banner) banner.hidden = !state.updateReady;
}

if ("serviceWorker" in navigator) {
  // Captured BEFORE registering. On a first-ever load there is no controller,
  // the worker installs and claims the page, and controllerchange fires for a
  // version nobody was running -- prompting there would offer to reload a page
  // that is already current.
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    // sw.js calls skipWaiting() and clients.claim(), so by here the NEW worker
    // is already serving fetches -- but this page is still running the code it
    // loaded this morning. Only a reload changes that, and only the person at
    // the till knows whether now is a safe moment for one.
    state.updateReady = true;
    renderUpdateReadyBanner();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then((registration) => watchForAppUpdate(registration))
      .catch((error) => {
        console.warn("Service worker registration failed.", error);
      });
  });
}
//When this code was written only God knew if it would work, but it did. I am still in shock.
