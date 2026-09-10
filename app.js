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
  // Which report the Reports screen is showing; null means the chooser.
  selectedReport: null,
  // Product costs are fetched on demand, not subscribed. Loaded is false until
  // a cost surface has asked for them and the fetch has landed.
  productCostsLoaded: false,
  productCostsLoading: false,
  products: [],
  // Sellable things with a price and no shelf, for bar/restaurant and salon
  // stores (DESIGN-services.md). Kept apart from products deliberately: a
  // service has no quantity, and storing zero would put every haircut in the
  // low-stock and reorder surfaces forever.
  services: [],
  unsubscribeServices: null,
  creditOverrides: [],
  // null, not [], because "not known" and "none today" are different answers
  // and one of them must not be printed as a money figure.
  repaymentsToday: null,
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
  pendingOwnerName: "",
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
  expenses: [],
  unsubscribeExpenses: null,
  purchases: [],
  unsubscribePurchases: null,
  deliveries: [],
  unsubscribeDeliveries: null,
  reportsCostMonth: localMonthKey(new Date()),
  deliveryMonthSelection: localMonthKey(new Date()),
  deliveryMonthTouched: false,
  // The dialog's working copy. Held on state rather than read out of the DOM on
  // every keystroke, because the preview recomputes from it and a half-typed
  // number in an input is not the same thing as the value the shop means.
  deliveryDraft: null,
  productCosts: [],
  productCostHistory: [],
  unsubscribeProductCostHistory: null,
  profitMonthSelection: localMonthKey(new Date()),
  profitMonthTouched: false,
  purchaseMonthSelection: localMonthKey(new Date()),
  purchaseMonthTouched: false,
  // localMonthKey(), not toISOString().slice(0, 7). Everything that reads
  // this bucket by local month, and a UTC slice disagrees with them between
  // midnight and 03:00 EAT on the 1st -- so a shop opening this screen early
  // on the first of the month would be shown the previous month's total, and
  // an expense recorded that morning would not appear in the list.
  expenseMonthSelection: localMonthKey(new Date()),
  expenseMonthTouched: false,
  reportMonthSelection: new Date().toISOString().slice(0, 7),
  openMonthlyReportId: null,
  barcodeScanTarget: null,
  barcodeScannerInstance: null,
  lastReceiptSale: null,
  pendingReturnSaleId: null,
  purchaseOrderGroups: [],
  customers: [],
  unsubscribeCustomers: null,
  suppliers: [],
  unsubscribeSuppliers: null,
  purchaseReturns: [],
  unsubscribePurchaseReturns: null,
  pendingPaymentCustomerId: null,
  transfers: [],
  unsubscribeTransfers: null,
  productMovementProductId: null,
  lastActivityAt: Date.now(),
  idleCheckIntervalId: null,
  updateReady: false,
  // Firestore's own answer to "can I reach the backend", which is not the same
  // question navigator.onLine answers. null until a live connection has
  // actually been observed -- see watchServerConnection().
  serverReachable: null,
  unsubscribeConnection: null
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

// Two decimal places on every figure, always.
//
// toLocaleString() with no options defaults to maximumFractionDigits: 3, which
// was invisible for as long as every amount was a whole shilling. Cost is a
// weighted average and divides, so the moment Phase 0 made cost real the
// Dashboard started reporting stock at cost as "TZS 1,546,666.667". Three
// decimals is not a currency anyone uses.
//
// The stored value is deliberately NOT rounded -- rounding the average at each
// restock would drift it -- so this is a display concern and belongs here,
// where every figure in the app already passes through.
function formatAmount(amount) {
  return Number(amount || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function money(amount) {
  return `${currentCurrencyCode()} ${formatAmount(amount)}`;
}

function moneyForStore(amount, storeId) {
  const store = state.stores.find((item) => item.id === storeId);
  const code = store?.currencyCode || "TZS";
  return `${code} ${formatAmount(amount)}`;
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
    "nav.expenses": "Expenses",
    "nav.settings": "Settings",
    "settings.eyebrow": "Your account and business",
    "settings.title": "Settings",
    "settings.accountTitle": "Account",
    "settings.signedInAs": "Signed in as",
    "backup.last": "Last backup: {date}.",
    "backup.stale": "Last backup: {date} — {days} days ago. Take a fresh one.",
    "backup.never": "You have never taken a backup. If this phone is lost, so is your business record.",
    "reports.groupFinancial": "Financial", "reports.groupSales": "Sales",
    "reports.groupPurchases": "Purchases", "reports.groupInventory": "Inventory",
    "reports.groupExpenses": "Expenses",
    "reports.hint.profit": "Revenue, what the goods cost, and what you kept",
    "reports.hint.salesPayments": "What came in, and how it was paid",
    "reports.hint.customerCredit": "Who owes you, and how much",
    "reports.hint.expensesByCategory": "What the shop spent, grouped by kind",
    "reports.hint.salesByProduct": "Which products sold, and for how much",
    "reports.hint.salesByStaff": "Who sold what, and what they took",
    "reports.hint.orderLookup": "Find one staff member's orders",
    "reports.hint.salesByCustomer": "Which customers buy the most",
    "reports.hint.salesReturns": "What customers brought back",
    "reports.hint.stockValuation": "What the shelves hold, and what it cost",
    "reports.hint.stockSummary": "What is on the shelves right now",
    "reports.hint.stockAdjustments": "Where stock went when it was not sold",
    "reports.hint.offlineSales": "Sold during an outage — shelves worth recounting",
    "reports.hint.purchaseSummary": "What you bought, less what went back",
    "reports.hint.purchasesByProduct": "What you spent, product by product",
    "reports.hint.purchaseReturns": "What you sent back to suppliers",
    "reports.hint.supplierBalances": "What you still owe each supplier",
    "reports.hint.monthlyReports": "A written summary of the month",
    "reports.hint.exports": "Download your records as CSV, PDF or Excel",
    "reports.hint.vatReport": "What you charged, and what you can claim back",
    "reports.exportsEyebrow": "Downloads",
    "reports.exportsTitle": "Export your records",
    "reports.chooseEyebrow": "Choose a report",
    "reports.chooseTitle": "What do you want to see?",
    "reports.chooseEmpty": "There are no reports you can open yet.",
    "reports.backToAll": "← All reports",
    "reports.group.money": "Money",
    "reports.group.sales": "Sales",
    "reports.group.stock": "Stock",
    "reports.group.buying": "Buying",
    "reports.group.ai": "Ask SaviaSmart",
    "reports.ledgerPendingTitle": "Balance Sheet, Trial Balance, Cash Flow & General Ledger",
    "reports.ledgerPendingBody": "These four are statements of a double-entry ledger, which this system does not keep yet. They will appear under Accounts, which is why that tab is there but not yet open. Profit & Loss is available now, on its own tab, because it is built from the transactions themselves.",
    "reports.openProfit": "Open Profit & Loss",
    "reports.byCustomerTitle": "Sales by Customer",
    "reports.byCustomerIntro": "Uses the range chosen above. Sales with no customer recorded are grouped as walk-in rather than left out.",
    "reports.walkIn": "Walk-in",
    "reports.salesReturnsTitle": "Sales Returns",
    "reports.purchaseSummaryTitle": "Purchase Summary",
    "reports.purchaseGross": "Bought", "reports.purchaseGrossNote": "{count} purchase lines, {units} units.",
    "reports.purchaseReturned": "Sent back",
    "reports.purchaseReturnedNote": "{units} units returned to suppliers.",
    "reports.purchaseReturnedNone": "Nothing returned.",
    "reports.purchaseNet": "Net purchases", "reports.purchaseNetNote": "What was bought, less what went back.",
    "reports.byProductPurchaseTitle": "Purchases by Product",
    "reports.purchaseReturnsTitle": "Purchase Returns",
    "reports.supplierBalancesTitle": "Supplier Balances",
    "reports.supplierBalancesIntro": "What the business still owes. Only suppliers with something outstanding are listed.",
    "reports.supplierBalancesTotal": "TOTAL OWED",
    "reports.stockSummaryTitle": "Stock Summary",
    "reports.adjustmentsTitle": "Stock Adjustments",
    "reports.adjustmentsIntro": "Where stock went when it was not sold. Grouped by the reason given at the time.",
    "reports.adjustmentsNet": "TOTAL",
    "reports.byCategoryTitle": "Expenses by Category",
    "reports.natureDirect": "Direct", "reports.natureIndirect": "Indirect",
    "kpi.receivable": "Owed to you", "kpi.receivableDelta": "Customer credit outstanding",
    "kpi.payable": "You owe suppliers", "kpi.payableDelta": "Unpaid deliveries",
    "product.unitLabel": "Unit", "product.unitPlaceholder": "e.g. piece, crate, kg",
    "product.skuLabel": "SKU (optional)", "product.activeLabel": "Status",
    "product.activeYes": "Active", "product.activeNo": "Inactive — stop selling it",
    "movement.colProduct": "Product",
    "reports.thCustomer": "Customer", "reports.thOrders": "Orders", "reports.thRevenue": "Revenue",
    "reports.thOrder": "Order", "reports.thRefunded": "Refunded",
    "reports.thNetUnits": "Units (net)", "reports.thReturned": "Returned", "reports.thNetSpend": "Spent (net)",
    "reports.thValue": "Value", "reports.thWhy": "Why",
    "reports.thCategory": "Category", "reports.thOnShelf": "On the shelf",
    "reports.thMinimum": "Minimum", "reports.thState": "State",
    "reports.thTimes": "Times", "reports.thNature": "Direct or indirect", "reports.thAmount": "Amount",
    "reports.stockOk": "OK", "reports.stockLow": "Low", "reports.stockOut": "Out",
    "reports.noSalesInRange": "No sales in this range.",
    "reports.noReturnsInRange": "No returns in this range.",
    "reports.noProducts": "No products yet.",
    "reports.noExpenses": "No expenses recorded yet.",
    "reports.noPurchases": "Nothing bought yet.",
    "reports.noPurchaseReturns": "Nothing has been sent back to a supplier.",
    "reports.noSupplierBalances": "You do not owe any supplier right now.",
    "reports.noAdjustments": "No stock adjustments recorded.",
    "product.quantityLocked": "Use Adjust on the inventory row to correct the shelf count, so the change is recorded with a reason.",
    "adjust.action": "Adjust", "adjust.title": "Adjust Stock",
    "adjust.currentLabel": "Currently on the shelf", "adjust.newLabel": "Counted / corrected to",
    "adjust.reasonLabel": "Why", "adjust.noteLabel": "Note (optional)",
    "adjust.saveButton": "Record Adjustment",
    "adjust.qtyInvalid": "Enter the number now on the shelf.",
    "adjust.noChange": "That is the same as the current count, so there is nothing to record.",
    "adjust.deltaNone": "No change.",
    "adjust.deltaUp": "Adds {units} to the shelf.",
    "adjust.deltaDown": "Takes {units} off the shelf.",
    "adjust.reason.count": "Physical stock count", "adjust.reason.damaged": "Damaged",
    "adjust.reason.expired": "Expired", "adjust.reason.lost": "Lost",
    "adjust.reason.theft": "Theft", "adjust.reason.correction": "Correction",
    "adjust.reason.opening": "Opening stock", "adjust.reason.other": "Other",
    "movement.ledgerSectionTitle": "Stock movements",
    "movement.ledgerSubtitle": "Everything that moved this product, oldest first, with the shelf count carried down.",
    "movement.colWhat": "What happened", "movement.colIn": "In", "movement.colOut": "Out",
    "movement.colBalance": "Balance",
    "movement.balanceUnknown": "not recorded",
    "movement.noLedger": "Nothing has moved this product yet.",
    "movement.reason.sale": "Sale", "movement.reason.restock": "Purchase / restock",
    "movement.reason.return": "Customer return", "movement.reason.void": "Sale voided",
    "movement.reason.transfer-in": "Transferred in", "movement.reason.transfer-out": "Transferred out",
    "movement.reason.adjustment": "Adjustment", "movement.reason.supplier-return": "Returned to supplier",
    "purchaseReturn.action": "Return", "purchaseReturn.allReturned": "All returned",
    "purchaseReturn.title": "Return to Supplier",
    "purchaseReturn.summary": "{qty} bought from {supplier}. Up to {max} can still go back.",
    "purchaseReturn.noSupplier": "no supplier recorded",
    "purchaseReturn.qtyLabel": "Units going back",
    "purchaseReturn.reasonLabel": "Why (optional)",
    "purchaseReturn.reasonPlaceholder": "e.g. damaged in transit",
    "purchaseReturn.saveButton": "Record Return",
    "purchaseReturn.qtyInvalid": "Enter how many units are going back.",
    "purchaseReturn.qtyTooMany": "Only {max} of this purchase can still be returned.",
    "purchaseReturn.notEnoughStock": "There is not enough of this product on the shelf to send back. Count the shelf first.",
    "deliveries.thPayment": "Payment",
    "suppliers.thOwed": "You owe them", "suppliers.statement": "Statement",
    "suppliers.payButton": "Pay",
    "suppliers.paymentTitle": "Record Payment",
    "suppliers.paymentAmountLabel": "Amount", "suppliers.paymentMethodLabel": "Paid by",
    "suppliers.paymentReferenceLabel": "Reference (optional)", "suppliers.paymentNoteLabel": "Note (optional)",
    "suppliers.paymentSaveButton": "Record Payment",
    "suppliers.paymentOwedNow": "You currently owe them {amount}.",
    "suppliers.paymentAmountInvalid": "Enter an amount greater than zero.",
    "suppliers.paymentTooMuch": "That is more than you owe them ({owed}). Record what you actually paid.",
    "suppliers.paymentNothingOwed": "Nothing is owed to this supplier any more.",
    "suppliers.statementTitle": "Supplier Statement",
    "suppliers.statementIntro": "What you have bought from {name}, and what you have paid them.",
    "suppliers.statementOpening": "Owed before you started using SaviaSmart",
    "suppliers.statementBought": "Bought from them",
    "suppliers.statementPaidOnDelivery": "Paid when the goods arrived",
    "suppliers.statementPaid": "Paid to them since",
    "suppliers.statementOwed": "STILL OWED",
    "suppliers.statementPurchasesTitle": "Bought", "suppliers.statementPaymentsTitle": "Paid",
    "suppliers.statementColWhat": "What",
    "suppliers.statementNoPurchases": "Nothing bought from them yet.",
    "suppliers.statementNoPayments": "No payments recorded yet.",
    "suppliers.statementBoundedNote": "The lists show recent history. The amount still owed is kept as a running figure, so it stays right even when the history is longer than this.",
    "deliveries.amountPaidLabel": "Amount paid now (optional)",
    "deliveries.amountPaidPlaceholder": "Blank = paid in full",
    "deliveries.paymentMethodLabel": "Paid by",
    "deliveries.amountDueLabel": "Still owed on this delivery",
    "deliveries.statusPaid": "Paid", "deliveries.statusPartial": "Partially paid", "deliveries.statusCredit": "On credit",
    "deliveries.amountPaidInvalid": "Enter 0 or more, and no more than the delivery total.",
    "deliveries.creditNeedsSupplier": "Pick a supplier you have recorded before buying on credit, so the debt has somewhere to go.",
    "txerror.supplierGone": "That supplier record no longer exists.",
    "suppliers.eyebrow": "Who you buy from", "suppliers.title": "Suppliers",
    "suppliers.addButton": "+ Supplier", "suppliers.edit": "Edit",
    "suppliers.intro": "A supplier recorded here can be picked when you buy, so purchases group under one name instead of however it was typed that day.",
    "suppliers.empty": "No suppliers yet. Add the people you buy stock from.",
    "suppliers.thName": "Supplier", "suppliers.thPhone": "Phone", "suppliers.thTin": "TIN",
    "suppliers.thPurchases": "Bought from them", "suppliers.thStatus": "Status", "suppliers.thActions": "Actions",
    "suppliers.dialogTitle": "Add Supplier", "suppliers.dialogTitleEdit": "Edit Supplier",
    "suppliers.nameLabel": "Supplier name", "suppliers.namePlaceholder": "e.g. Twiga Cement",
    "suppliers.phoneLabel": "Phone", "suppliers.emailLabel": "Email", "suppliers.tinLabel": "TIN",
    "suppliers.addressLabel": "Address",
    "suppliers.openingBalanceLabel": "Already owed to them",
    "suppliers.openingBalanceHint": "Leave at 0 unless you already owed them before you started using SaviaSmart.",
    "suppliers.openingBalanceInvalid": "Enter 0 or a positive amount.",
    "suppliers.statusLabel": "Status", "suppliers.statusActive": "Active",
    "suppliers.statusInactive": "Inactive — stop offering them", "suppliers.statusInactiveShort": "Inactive",
    "suppliers.saveButton": "Save Supplier",
    "suppliers.nameRequired": "Enter the supplier's name.",
    "suppliers.nameTaken": "You already have a supplier with this name.",
    "settings.emailLabel": "Email", "settings.changeNameButton": "Change Name",
    "settings.branchEyebrow": "This branch",
    "settings.branchTitle": "Branch & business",
    "settings.branchIntro": "These apply to the branch selected on the dashboard. Currency and VAT change how every figure in the app is shown and filed, so they are the owner's alone.",
    "settings.staffTitle": "Staff",
    "settings.staffIntro": "Who may sign in, and what they may do. The till has its own shortcut to this list, because that is where a sale gets attributed.",
    "settings.securityTitle": "Security",
    "settings.securityIntro": "The discount password is asked for before a price override, a refund or a void, so only trusted staff can approve one.",
    "settings.dataTitle": "Your data",
    "settings.dataIntro": "The backup is a file of everything this account holds, downloaded to this device. Deleting the account is scheduled, not immediate, and can be undone during the grace period.",
    "settings.displayTitle": "Language & appearance",
    "nav.reports": "Reports", "nav.ai": "AI Advisor",
    "brand.tagline": "AI Inventory ERP",
    "sidebar.connectionHintSignedOut": "Sign in to sync inventory",
    "topbar.searchPlaceholder": "Search your products...",
    "topbar.signOut": "Sign out", "topbar.langToggle": "Kiswahili",
    "dashboard.eyebrowToday": "Today", "dashboard.title": "Operations Command Center",
    "dashboard.profitEyebrow": "Performance",
    "dashboard.profitTitle": "Net profit",
    "dashboard.profitNote": "Revenue less what the goods cost and what you spent, for each period. Only as complete as the expenses you have entered — the Profit Report shows the working.",
    "dashboard.chartWeek": "Weekly",
    "dashboard.chartMonth": "Monthly",
    "dashboard.chartYear": "Annual",
    "chart.profitEmpty": "No profit to show yet. Record a sale against a product that has a cost price.",
    "chart.noCost": "no cost",
    "dashboard.addStore": "+ Store", "dashboard.analyticsEyebrow": "Inventory analytics",
    
    "dashboard.alertsEyebrow": "Smart alerts", "dashboard.needsAttention": "Needs attention",
    "dashboard.popupAlerts": "Popup alerts", "dashboard.movementTitle": "Movement classes",
    "dashboard.aiEngineEyebrow": "AI reorder engine", "dashboard.recommendationsTitle": "Purchase recommendations",
    "inventory.intro": "What is on your shelves. Add the stock you already had here \u2014 new stock you buy is recorded under Purchases, where what you paid and the delivery costs are captured together.",
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
    "pos.cash": "Cash", "pos.mobile": "Mobile Money", "pos.card": "Card", "pos.bank": "Bank",
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
    "control.expectedCashNoteWithRepayments": "Cash sales, deposits and debt repaid, less refunds",
    "control.collectedOnAccount": "Collected on account",
    "control.collectedOnAccountNote": "Cash · Mobile · Card — no debt repaid today",
    "control.collectedOnAccountUnavailable": "Owner sign-in only",
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
    "nav.accounts": "Accounts",
    "nav.soon": "Soon",
    "nav.vat": "VAT",
    "report.vatRecordLink": "Open the full VAT record in Accounts",
    "vatRecord.eyebrow": "What you owe, and what you can claim back",
    "vatRecord.title": "VAT record",
    "vatRecord.monthLabel": "Month",
    "vatRecord.intro": "Output VAT is what you charged customers. Input VAT is what you paid suppliers and can reclaim, where you hold a fiscal receipt for it. This is a record to check before you file, not a return.",
    "vatRecord.output": "Output VAT",
    "vatRecord.outputNote": "Charged on {count} sales this month",
    "vatRecord.input": "Input VAT you can reclaim",
    "vatRecord.inputNote": "From {count} purchases with a fiscal receipt",
    "vatRecord.net": "Net payable",
    "vatRecord.netNote": "Output VAT less what you can reclaim",
    "vatRecord.netCreditNote": "You reclaimed more than you charged this month",
    "vatRecord.refundsNotNetted": "Output VAT does not yet reduce for refunds, so it is higher than the true figure. {amount} was refunded this month — see KNOWN-LIMITATIONS L-12.",
    "vatRecord.outsideWindow": "This device can only see records back to {date}, so this month cannot be totalled in full. A VAT figure that is too low is the dangerous one, so it is not shown. Choose a more recent month, or narrow to one branch.",
    "vatRecord.expiringTitle": "Claims you are about to lose",
    "vatRecord.expiringHint": "You have the receipt, but no VAT recorded against it. Add it before the six-month window closes.",
    "vatRecord.blockedTitle": "Spending you cannot reclaim this month",
    "vatRecord.blockedHint": "Shown so you can see why the claim is smaller than the spending, and what to ask for next time.",
    "vatRecord.colDate": "Receipt date",
    "vatRecord.colProduct": "Product",
    "vatRecord.colPaid": "Total paid",
    "vatRecord.colExpires": "Claim closes",
    "vatRecord.colReason": "Why not",
    "vatRecord.reason.noReceipt": "No fiscal receipt — ask the supplier for one",
    "vatRecord.reason.noReceiptDate": "No date recorded from the receipt",
    "vatRecord.reason.noVatAmount": "VAT not recorded from the receipt",
    "vatRecord.reason.expired": "The six-month claim window has closed",
    "vatRecord.reason.exceedsTotal": "Recorded VAT is more than the amount paid",
    "nav.profit": "Profit Report",
    "profit.eyebrow": "What the shop kept",
    "profit.title": "Profit Report",
    "profit.monthLabel": "Month",
    "profit.intro": "Revenue less what the stock cost, less what the shop spent. The first two are worked out from your records; the last one is only as complete as what you have entered.",
    "reports.costEyebrow": "Cost and supply",
    "reports.costMonthLabel": "Month",
    "reports.sbpTitle": "Sales by Product",
    "reports.sbpThProduct": "Product",
    "reports.sbpThUnits": "Units sold",
    "reports.sbpThOrders": "Orders",
    "reports.sbpThRevenue": "Revenue",
    "reports.sbpEmpty": "No sales in this range yet.",
    "reports.sbpService": "(service)",
    "reports.sbpNote": "Units and revenue for the range above, with returns taken off and voided sales excluded. Ordered by what brought the most money in.",
    "reports.stockValuationTitle": "Stock Valuation",
    "reports.stockAtCost": "Stock at cost",
    "reports.stockAtRetail": "If it all sold at list price",
    "reports.stockAtRetailNote": "What the shelves would bring in at today's prices. Not what the stock is worth.",
    "reports.stockComplete": "Every product on the shelf has a recorded cost.",
    "reports.stockPartial": "{missing} products have no recorded cost, covering {units} units — they are missing from this total.",
    "reports.stockEmpty": "No products in this branch yet.",
    "reports.svThProduct": "Product",
    "reports.svThQuantity": "On hand",
    "reports.svThUnitCost": "Unit cost",
    "reports.svThValue": "Value at cost",
    "reports.supplierTitle": "Supplier Report",
    "reports.supplierEmpty": "No purchases recorded against a supplier this month.",
    "reports.supThSupplier": "Supplier",
    "reports.supThLines": "Lines",
    "reports.supThDeliveries": "Deliveries",
    "reports.supThGoods": "Goods",
    "reports.supThLanded": "Landed",
    "reports.supThTotal": "Total paid",
    "reports.expenseNatureTitle": "Direct & Indirect Expense Report",
    "reports.expenseNatureEmpty": "No expenses recorded this month.",
    "reports.enThCategory": "Category",
    "reports.enThAmount": "Amount",
    "profit.pdEyebrow": "Where the profit came from",
    "profit.pdTitle": "By product",
    "profit.pdThProduct": "Product",
    "profit.pdThUnits": "Units sold",
    "profit.pdThAvgCost": "Average cost",
    "profit.pdThCogs": "Cost of sales",
    "profit.pdThGoods": "of which goods",
    "profit.pdThLanded": "of which landed",
    "profit.pdThRevenue": "Revenue",
    "profit.pdThGross": "Gross profit",
    "profit.pdThMargin": "Margin",
    "profit.pdTotal": "TOTAL",
    "profit.pdNoCost": "{count} products have no recorded cost, so their margin cannot be worked out.",
    "profit.pdNoLanded": "{count} products were bought before landed costs were recorded, so nothing is attributed to freight for them.",
    "profit.pdAttribution": "The goods and landed columns split each product's cost of sales in the same proportion as everything ever bought of it — they are an attribution, not a separate measurement.",
    "profit.stRevenue": "Sales revenue",
    "profit.stCogs": "Cost of goods sold",
    "profit.stCogsNote": "What the goods you sold this month cost you, including freight and duty",
    "profit.stGross": "GROSS PROFIT",
    "profit.stDirect": "Direct operating expenses",
    "profit.stDirectNote": "Costs that only happen because something was sold",
    "profit.stIndirect": "Indirect operating expenses",
    "profit.stNet": "NET PROFIT",
    "profit.deduction": "({value})",
    "profit.revenue": "Revenue",
    "profit.revenueNote": "{count} sales, after refunds",
    "profit.revenueNoteOne": "1 sale, after refunds",
    "profit.revenueNoteVat": "{count} sales, after refunds and VAT",
    "profit.revenueNoteVatOne": "1 sale, after refunds and VAT",
    "profit.gross": "Gross profit",
    "profit.grossNote": "Revenue less what those goods cost you",
    "profit.grossPartial": "Incomplete \u2014 {missing} of {total} sold lines have no recorded cost",
    "profit.grossNoCost": "No cost recorded for anything sold this month",
    "profit.expenses": "Expenses",
    "profit.expensesNote": "{count} recorded this month",
    "profit.expensesNone": "Nothing recorded \u2014 this is not the same as nothing spent",
    "profit.net": "What you kept",
    "profit.netNote": "Gross profit less recorded expenses. Only as complete as what you entered.",
    "profit.netNoCost": "Needs a recorded cost before this means anything",
    "profit.complete": "Every sold line has a recorded cost and expenses have been entered for this month.",
    "profit.incomplete": "Treat this as a guide, not a filed figure: it is only as good as the costs and expenses recorded for the month.",
    "profit.outsideWindow": "This month is older than the sales this device has loaded (back to {date}), so it cannot be totalled. Open a more recent month, or narrow to one branch.",
    "nav.purchases": "Purchases",
    "purchases.eyebrow": "Stock bought",
    "purchases.title": "Purchases",
    "purchases.intro": "Every delivery, and what you paid for it. Recorded when you restock \u2014 you enter the total for the batch, and the cost per unit is worked out from it.",
    "purchases.listTitle": "Recorded",
    "purchases.monthLabel": "Month",
    "purchases.thDate": "Date",
    "purchases.thProduct": "Product",
    "purchases.thQty": "Units",
    "purchases.thUnitCost": "Each",
    "purchases.thTotal": "Total paid",
    "purchases.thReceipt": "Fiscal receipt",
    "purchases.monthTotal": "Spent on stock this month",
    "purchases.monthCount": "{count} {delivery}, {units} {unit}",
    "purchases.deliverySingular": "delivery",
    "purchases.deliveryPlural": "deliveries",
    "purchases.noReceipt": "Bought with no fiscal receipt",
    "purchases.noReceiptNote": "You cannot claim the VAT back on this",
    "purchases.allReceipted": "Every delivery has a receipt number",
    "purchases.receiptYes": "Yes",
    "purchases.receiptNo": "None",
    "purchases.thActions": "Actions",
    "purchases.delete": "Delete",
    "purchases.confirmDelete": "Delete this delivery of {name} for {value}? The Purchase Book will no longer show it, and the product's average cost is not recalculated.",
    "toast.purchaseDeleted": "Delivery deleted",
    "toast.purchaseFailed": "Could not delete that delivery. Try again.",
    "purchases.empty": "No deliveries recorded for this month yet.",
    "purchases.emptyNoStore": "Pick a branch to see what it bought.",
    "nav.deliveries": "Deliveries",
    "deliveries.eyebrow": "Goods received",
    "deliveries.title": "Deliveries",
    "deliveries.intro": "One delivery, many products, and the costs of getting it here. Freight, duty, clearing and transport are spread across the goods they brought in, so each item carries what it truly cost — not just what the supplier charged.",
    "deliveries.receiveButton": "Receive delivery",
    "deliveries.listTitle": "Recorded",
    "deliveries.monthLabel": "Month",
    "deliveries.monthTotal": "Received this month",
    "deliveries.monthCount": "{count} {delivery}, {units} {unit}",
    "deliveries.deliverySingular": "delivery",
    "deliveries.deliveryPlural": "deliveries",
    "deliveries.landedTotal": "Landed costs capitalised",
    "deliveries.landedNote": "Freight, duty, clearing and transport, added to what the stock is worth rather than charged as an expense.",
    "deliveries.landedNone": "No additional costs recorded this month.",
    "deliveries.thDate": "Received",
    "deliveries.thReference": "Reference",
    "deliveries.thSupplier": "Supplier",
    "deliveries.thLines": "Products",
    "deliveries.thGoods": "Goods",
    "deliveries.thLanded": "Landed",
    "deliveries.thTotal": "Total cost",
    "deliveries.thBasis": "Spread by",
    "deliveries.thActions": "Actions",
    "deliveries.empty": "No deliveries recorded for this month yet.",
    "deliveries.emptyNoStore": "Pick a branch to record a delivery.",
    "deliveries.basisValue": "Product value",
    "deliveries.basisQuantity": "Quantity",
    "deliveries.basisManual": "Entered by hand",
    "deliveries.deleteButton": "Delete",
    "deliveries.deleteConfirm": "Delete this delivery and its {count} purchase {line}? What it already added to your stock and its cost stays — record a new delivery to correct that.",
    "deliveries.lineSingular": "line",
    "deliveries.linePlural": "lines",
    "deliveries.dialogTitle": "Receive delivery",
    "deliveries.supplierLabel": "Supplier (optional)",
    "deliveries.supplierTinLabel": "Supplier TIN (optional)",
    "deliveries.referenceLabel": "Invoice or reference (optional)",
    "deliveries.receivedAtLabel": "Date received",
    "deliveries.noteLabel": "Note (optional)",
    "deliveries.linesTitle": "What arrived",
    "deliveries.addLineButton": "Add product",
    "deliveries.removeLine": "Remove",
    "deliveries.lineProduct": "Product",
    "deliveries.lineQuantity": "Quantity",
    "deliveries.lineGoodsCost": "Total paid for these",
    "deliveries.linePickProduct": "Choose a product…",
    "deliveries.goodsTotal": "Goods cost: {value}",
    "deliveries.costsTitle": "Additional costs",
    "deliveries.costsIntro": "What it cost to get the goods here and ready to sell. These are added to the value of the stock, not charged as an expense — they become cost of sales when the goods sell.",
    "deliveries.costFreight": "Freight",
    "deliveries.costImportDuty": "Import duty",
    "deliveries.costClearing": "Clearing charges",
    "deliveries.costTransport": "Transport",
    "deliveries.costHandling": "Handling",
    "deliveries.costInsurance": "Insurance",
    "deliveries.costOtherCost": "Other",
    "deliveries.additionalTotal": "Additional costs: {value}",
    "deliveries.basisLabel": "Spread additional costs by",
    "deliveries.basisValueHint": "Each product takes a share in proportion to what it cost. Suits most deliveries.",
    "deliveries.basisQuantityHint": "Each product takes a share in proportion to how many units arrived.",
    "deliveries.basisManualHint": "You decide each share. They must add up to the additional costs exactly.",
    "deliveries.manualLabel": "Share",
    "deliveries.previewTitle": "What each product will cost",
    "deliveries.previewIntro": "Worked out before anything is saved. The last column is what one unit will cost you — and what will be charged to cost of sales when it sells.",
    "deliveries.thOriginal": "Goods cost",
    "deliveries.thAllocation": "Share of additional",
    "deliveries.thFinal": "Final inventory cost",
    "deliveries.thEach": "Each",
    "deliveries.totalRow": "TOTAL",
    "deliveries.totalCost": "Total inventory cost",
    "deliveries.saveButton": "Record delivery",
    "deliveries.emptyPreview": "Add a product to see what the delivery will cost.",
    "deliveries.errNoLines": "Add at least one product before recording the delivery.",
    "deliveries.errTooManyLines": "A delivery can carry at most {max} products. Record the rest as a second delivery.",
    "deliveries.errDuplicateProduct": "{name} is on this delivery twice. Put it on one line with the full quantity.",
    "deliveries.errMissingProduct": "Choose a product for every line.",
    "deliveries.errBadQuantity": "Line {line}: enter how many units arrived, as a whole number.",
    "deliveries.errBadGoodsCost": "Line {line}: enter what you paid for those units.",
    "deliveries.errLineCostsNothing": "{name} would cost nothing at all. Give it a price, or spread the additional costs by quantity so it carries a share.",
    "deliveries.errDeliveryCostsNothing": "This delivery has no cost recorded anywhere.",
    "deliveries.errDeliveryTooLarge": "That total is larger than this app can record.",
    "deliveries.errManualMismatch": "Your shares add up to {short} less than the additional costs. Adjust them so they match exactly.",
    "deliveries.errManualMismatchOver": "Your shares add up to {over} more than the additional costs. Adjust them so they match exactly.",
    "deliveries.errManualLength": "Enter a share for every product.",
    "deliveries.errNegativeAmount": "A share cannot be negative.",
    "deliveries.errNoWeight": "These products have neither a cost nor a quantity to spread the additional costs across.",
    "deliveries.errNoStore": "Pick a single branch before recording a delivery.",
    "deliveries.errNeedsConnection": "A delivery needs a connection — there is nowhere to record it offline.",
    "deliveries.errUnconfirmed": "The delivery was sent but not confirmed. Check the list before recording it again.",
    "deliveries.errTransactionFailed": "Could not record that delivery. Nothing was saved. Try again.",
    "deliveries.errNoDelivery": "That delivery no longer exists.",
    "deliveries.errDeleteFailed": "Could not delete that delivery. Try again.",
    "deliveries.basisFellBack": "These products have no value to spread by, so the additional costs were spread by quantity instead.",
    "toast.deliveryRecorded": "Delivery recorded: {count} {unit}, {value}.",
    "toast.deliveryDeleted": "Delivery deleted.",
    "restock.totalPaidLabel": "Total paid for this delivery (optional)",
    "restock.totalPaidPlaceholder": "e.g. 400000",
    "restock.totalPaidInvalid": "Enter what you paid, or leave it blank.",
    "restock.unitCostHint": "That works out to {value} each.",
    "restock.supplierLabel": "Supplier (optional)",
    "restock.vatAmountLabel": "VAT shown on the receipt",
    "restock.vatAmountHint": "Copy this from the receipt. It is what you can reclaim.",
    "restock.vatAmountInvalid": "The VAT cannot be more than the total you paid.",
    "restock.receiptLabel": "Fiscal receipt number (optional)",
    "restock.receiptHint": "The VAT claim window runs from this date, not the day you record it.",
    "restock.supplierTinLabel": "Supplier TIN (optional)",
    "restock.hasReceiptLabel": "I have a fiscal receipt for this delivery",
    "restock.receiptDateLabel": "Date on the receipt",
    "restock.costNeedsConnection": "Recording what you paid needs a connection. Add the delivery now and the cost later.",
    "expenses.dateTooOld": "That date is more than two years ago. Check the year.",
    "toast.transferNeedsOwnerFirst": "{store} does not stock this yet, and only the owner can add it there. Ask them to add it once, then transfers will work.",
    "toast.restockOffline": "Restocking needs a connection. The delivery will have to wait.",
    "toast.restockUnconfirmed": "That took too long to confirm. Check the stock count before restocking again.",
    "expenses.eyebrow": "Money out",
    "expenses.title": "Expenses",
    "expenses.addButton": "Record Expense",
    "expenses.intro": "What the shop spends, day by day. Rent, power, transport, wages, repairs. These are not stock purchases \u2014 they are the running costs that sit between what you sell for and what you keep.",
    "expenses.listTitle": "Recorded",
    "expenses.monthLabel": "Month",
    "expenses.thDate": "Date",
    "expenses.thCategory": "Category",
    "expenses.thNote": "Note",
    "expenses.thPaidFrom": "Paid from",
    "expenses.thAmount": "Amount",
    "expenses.thActions": "Actions",
    "expenses.dialogTitle": "Record Expense",
    "expenses.editDialogTitle": "Edit Expense",
    "expenses.amountLabel": "Amount",
    "expenses.amountPlaceholder": "e.g. 15000",
    "expenses.categoryLabel": "Category",
    "expenses.dateLabel": "Date spent",
    "expenses.paidFromLabel": "Paid from",
    "expenses.paidFromTill": "The till",
    "expenses.paidFromOther": "Elsewhere (bank, mobile money, pocket)",
    "expenses.noteLabel": "Note (optional)",
    "expenses.notePlaceholder": "e.g. Boda to the market",
    "expenses.saveButton": "Save Expense",
    "expenses.monthTotal": "Spent this month",
    "expenses.monthCount": "{count} recorded",
    "expenses.fromTill": "Paid from the till",
    "expenses.fromTillNote": "Counted separately \u2014 the drawer will be short by this much",
    "expenses.topCategory": "Biggest category",
    "expenses.empty": "Nothing recorded for this month yet.",
    "expenses.emptyNoStore": "Pick a branch to record what it spends.",
    "expenses.amountRequired": "Enter an amount greater than zero.",
    "expenses.dateRequired": "Pick the date the money was spent.",
    "expenses.dateFuture": "That date is in the future.",
    "expenses.edit": "Edit",
    "expenses.delete": "Delete",
    "expenses.confirmDelete": "Delete this expense? The month total will change.",
    "expenses.recordedBy": "by {name}",
    "cat.commission": "Sales commission",
    "cat.delivery": "Delivery to a customer",
    "cat.packaging": "Sales packaging",
    "expenses.natureLabel": "Type of cost",
    "expenses.natureDirect": "Direct — attributable to a sale",
    "expenses.natureIndirect": "Indirect — running the business",
    "expenses.natureDirectHint": "Costs that only happen because something was sold: commission, delivery to a customer, packaging. Shown on its own line under gross profit.",
    "expenses.natureIndirectHint": "Costs of keeping the shop open whether or not you sell today: rent, power, salaries, licences. Shown on its own line under gross profit.",
    "expenses.thNature": "Type",
    "expenses.direct": "Direct expenses",
    "expenses.directNote": "Costs that only happen because something was sold.",
    "expenses.indirect": "Indirect expenses",
    "expenses.indirectNote": "Costs of keeping the shop open, sale or no sale.",
    "expenses.landedEyebrow": "Not an expense",
    "expenses.landedTitle": "Landed costs, capitalised into stock",
    "expenses.landedIntro": "Freight, duty, clearing and transport from {count} {delivery} received this month. This money is not spent — it is held in the value of your stock, and becomes cost of sales when those goods sell.",
    "expenses.landedThType": "Cost",
    "expenses.landedThAmount": "Amount",
    "expenses.landedTotalRow": "TOTAL CAPITALISED",
    "expenses.landedExcluded": "Shown here for reference only. This total is NOT included in the expense figures above — counting it twice would understate your profit.",
    "cat.rent": "Rent",
    "cat.utilities": "Power and water",
    "cat.wages": "Wages",
    "cat.transport": "Transport",
    "cat.supplies": "Shop supplies",
    "cat.repairs": "Repairs",
    "cat.licences": "Licences and fees",
    "cat.marketing": "Marketing",
    "cat.other": "Other",
    "toast.expenseSaved": "Expense recorded",
    "toast.expenseUpdated": "Expense updated",
    "toast.expenseDeleted": "Expense deleted",
    "toast.expenseFailed": "Could not save that expense. Try again.",
    "control.salesCountNote": "{count} sales this month",
    "control.salesCountNoteOne": "1 sale this month",
    "control.grossMargin": "Gross margin (est.)",
    "control.marginNote": "Revenue less cost of goods sold",
    "control.marginIncomplete": "Incomplete — {missing} of {total} sold lines have no cost price",
    "control.marginNoCost": "No cost prices recorded, so margin cannot be worked out",
    "control.showStockValue": "Show stock value",
    "control.stockValueLoading": "Loading…",
    "control.stockAtCost": "Stock value at cost",
    "control.stockAtRetail": "At retail {value}",
    "control.stockAtCostUnknown": "No cost prices recorded. At retail {value}",
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
    "reports.staffOrderLookupDateHint": "Leave both dates blank to see every order for this staff member.",
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
    "product.vatAmountLabel": "VAT shown on the receipt",
    "product.vatAmountHint": "Copy this from the receipt. It is what you can reclaim.",
    "product.vatAmountInvalid": "The VAT cannot be more than the total you paid.",
    "product.costHeading": "What you paid for this stock",
    "product.costHint": "Optional. If you know what this stock cost you, record it here and profit tracking works from day one. Leave it blank and you can add it on the first restock instead.",
    "product.totalPaidLabel": "Total paid for this stock (optional)",
    "product.totalPaidPlaceholder": "e.g. 400000",
    "product.totalPaidInvalid": "Enter what you paid in total, or leave it blank.",
    "product.totalPaidNeedsQuantity": "Enter the quantity you are adding before recording what you paid for it.",
    "product.unitCostHint": "That works out to {each} each.",
    "product.hasReceiptLabel": "I have a fiscal receipt for this stock",
    "product.receiptLabel": "Fiscal receipt number (optional)",
    "product.receiptDateLabel": "Date on the receipt",
    "product.receiptDateHint": "The VAT claim window runs from this date, not the day you record it.",
    "product.nameLabel": "Product name", "product.categoryLabel": "Category", "product.brandLabel": "Brand",
    "product.supplierLabel": "Suppliers", "product.quantityLabel": "Quantity",
    "product.priceLabel": "Selling price", "product.priceTypeLabel": "Price type",
    "product.priceFixed": "Fixed price", "product.priceDynamic": "Flexible / dynamic price",
    "product.reorderLabel": "Low stock threshold", "product.reorderPlaceholder": "e.g. 10",
    "product.cancel": "Cancel", "product.save": "Save Product",
    "auth.eyebrow": "Account access",
    "auth.accessRemoved": "Your access to this business was removed. Ask the owner if you think this is a mistake.",
    "auth.copy": "Create an account or sign in to manage your own inventory, stock levels, sales, and AI recommendations.",
    "auth.ownerName": "Your name",
    "auth.resetSentTitle": "Check your email",
    "auth.resetSentBody": "We have sent a link to {email}. Open it to choose a new password.",
    "auth.resetSentSpam": "If it is not there in a few minutes, look in your spam or promotions folder.",
    "auth.resetSentDismiss": "Back to sign in",
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
    "monthlyReport.revenueLineOne": "For {period}: {revenue} in revenue across 1 transaction.",
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
    "dialog.ownerNamePrompt": "Your name, as it should appear on sales you ring up:",
    "dialog.archiveStoreConfirm": "Archive \"{name}\"? It will be hidden from the store switcher but its history is kept.",
    "toast.selectSpecificStore": "Select a specific store first.",
    "toast.ownerNameSaved": "Your name has been saved.", "toast.couldNotSaveOwnerName": "Could not save your name.",
    "toast.supplierAdded": "{name} added to suppliers.", "toast.supplierUpdated": "{name} updated.",
    "toast.couldNotSaveSupplier": "Could not save supplier.",
    "toast.supplierPaymentRecorded": "Payment to {name} recorded.",
    "toast.couldNotSaveSupplierPayment": "Could not record that payment.",
    "toast.purchaseReturnRecorded": "{qty} x {name} returned to the supplier.",
    "toast.couldNotSavePurchaseReturn": "Could not record that return.",
    "toast.adjustmentRecorded": "Stock adjusted for {name}.",
    "toast.couldNotSaveAdjustment": "Could not record that adjustment.",
    "toast.storeRenamed": "Store renamed to {name}.", "toast.couldNotRenameStore": "Could not rename store.",
    "toast.businessTypeSet": "Business type updated. Category suggestions will reflect it.",
    "toast.storeArchived": "{name} archived.", "toast.couldNotArchiveStore": "Could not archive store.",
    "toast.cannotArchiveLastStore": "You need at least one active store; archive another store first.",
    "kpi.totalProducts": "Total Products", "kpi.totalProductsDelta": "Your account",
    "kpi.totalQuantity": "Total Quantity", "kpi.totalQuantityDelta": "Units in stock",
    "kpi.categories": "Categories", "kpi.categoriesDelta": "Product groups",
    "kpi.suppliers": "Suppliers", "kpi.suppliersDelta": "Who you buy from",
    "kpi.lowStock": "Low Stock Items", "kpi.lowStockDelta": "Reorder now",
    "kpi.outStock": "Out of Stock Items", "kpi.outStockDelta": "Urgent",
    "alert.belowMinimum": "Below minimum stock. Current stock: {quantity}.",
    "alert.allClearTitle": "All clear", "alert.allClearBody": "No low stock or out-of-stock products.",
    "rec.reorderNow": "Reorder {qty} units now.", "rec.estimatedStockout": "Estimated stockout in {days} days.",
    "movement.fastMoving": "Fast-moving products", "movement.slowMoving": "Slow-moving products",
    "movement.noSales": "No sales recorded", "movement.healthyCoverage": "Healthy stock coverage",
    "movement.ledgerGaps": "shelves disagree with the stock ledger (worst: {name}, {units} {unit})",
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
    "inventory.clearFilters": "Clear search and filters",
    "toast.incorrectPassword": "Incorrect password. Price change cancelled.",
    "toast.overrideNotConfigured": "Price overrides aren't set up yet. Ask your admin to configure them.",
    "toast.overrideNetworkError": "Couldn't reach the override service. Check your connection and try again.",
    "toast.overridePasswordSaved": "Discount password saved.",
    "toast.overridePasswordSaveFailed": "Couldn't save the password. Try again.",
    "toast.nothingToUndo": "Nothing to undo.", "toast.lastCartActionUndone": "Last cart action undone.",
    "toast.pdfLibraryFailed": "PDF library did not load. Check your connection and try again.",
    "toast.excelLibraryFailed": "Excel library did not load. Check your connection and try again.",
    "toast.aiProxyUnavailable": "AI proxy unavailable ({message}). Showing local recommendation.",
    "toast.aiQuestionEmpty": "Type a question first.",
    "toast.productSavedWithoutCost": "Product saved, but what you paid could not be recorded. Add it on the first restock.",
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
    "toast.passwordResetOffline": "You are offline, so the reset email cannot be sent. Reconnect and try again.",
    "toast.passwordResetNeedsEmail": "Type your email address in the box above first, then tap Forgot password.",
    "toast.passwordResetFailed": "The reset email could not be sent. Check your connection and try again.",
    "toast.verificationEmailSent": "Verification email sent. Please check your inbox.",
    "toast.verificationEmailFailed": "Could not send the verification email. Please try again shortly.",
    "toast.emailVerified": "Email address verified. Thank you.",
    "toast.idleSignOut": "You were signed out after a period of inactivity.",
    "toast.authTooManyRequests": "Too many attempts. Please wait a while and try again.",
    "toast.consentRequired": "Please accept the Terms & Conditions and Privacy Policy to create an account.",
    "toast.passwordMismatch": "Passwords do not match.",
    "toast.outOfStock": "This product is out of stock.",
    "toast.selectStoreToSell": "Select a specific store to make a sale.",
    "services.title": "Services",
    "services.eyebrow": "Priced work",
    "services.intro": "Things you sell that have a price but no shelf. They ring up in the till beside your stock, and selling one never changes a stock count.",
    "services.addButton": "Add Service",
    "services.thName": "Service",
    "services.thItem": "Item",
    "services.thCategory": "Category",
    "services.thPrice": "Price",
    "services.thStatus": "Status",
    "services.thActions": "Actions",
    "services.statusActive": "On the till",
    "services.statusWithdrawn": "Withdrawn",
    "services.withdrawButton": "Withdraw",
    "services.restoreButton": "Put back",
    "services.withdrawConfirm": "Take {name} off the till? Past sales keep it, and you can put it back at any time.",
    "services.emptyState": "Nothing priced yet. Add your first one.",
    "services.dialogAddTitle": "Add to {label}",
    "services.dialogEditTitle": "Edit {label}",
    "services.nameLabel": "Name",
    "services.namePlaceholder": "e.g. Braiding",
    "services.nameRequired": "Give it a name.",
    "services.priceLabel": "Price",
    "services.pricePlaceholder": "e.g. 15000",
    "services.categoryLabel": "Category",
    "services.categoryPlaceholder": "e.g. Hair",
    "services.taxClassLabel": "Tax class",
    "services.saveButton": "Save Service",
    "toast.serviceAdded": "{name} added.",
    "toast.serviceUpdated": "{name} updated.",
    "toast.serviceWithdrawn": "{name} taken off the till.",
    "toast.serviceRestored": "{name} put back on the till.",
    "toast.serviceSaveFailed": "Could not save that. Please try again.",
    "services.menuTitle": "Menu",
    "services.posEmpty": "No services priced yet.",
    "toast.serviceUnavailable": "That service is no longer on the list.",
    "toast.enterPricePerUnit": "Enter a price per unit for this product.",
    "toast.notEnoughStockQty": "Not enough stock available for this quantity.",
    "toast.cartLimitReached": "This sale has reached the 40 line-item limit. Complete this sale and start a new one.",
    "toast.noMoreStock": "No more stock available for this product.",
    "toast.invalidPrice": "Invalid price.", "toast.onlyUnitsAvailable": "Only {quantity} units available.",
    "toast.addProductsFirst": "Add products to the cart first.",
    "toast.loadingStore": "Loading your store - please try again in a moment.",
    "toast.noStoreAssigned": "No store has been assigned to you yet. Ask the business owner to give you access to a store before adding stock.",
    "toast.selectStoreBeforeSale": "Select a specific store before completing a sale.",
    "toast.cashLessThanTotal": "Cash tendered is less than the sale total.",
    "toast.saleFailedGeneric": "Sale failed. Please recheck stock and try again.",
    "toast.saleCompletedChange": "Sale completed. Give {change} change.",
    "toast.saleCompleted": "Sale completed and inventory updated.",
    "toast.saleCompletedServices": "Sale completed.",
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
    "reports.colCustomerName": "Customer",
    "reports.colCustomerPhone": "Phone",
    "reports.colTotalSpent": "Total Spent",
    "reports.colLastVisit": "Last Visit",
    "receipt.whatsappButton": "Share via WhatsApp",
    "dialog.customerPhonePrompt": "Enter the customer's phone number to share this receipt:",
    "toast.invalidPhoneNumber": "Enter a valid Tanzanian phone number (e.g. 07XXXXXXXX).",
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
    "toast.saleHeldUnconfirmed": "The connection did not answer. The sale is saved on this device and will sync.",
    "toast.saleUnconfirmed": "The connection did not answer, so this sale is not confirmed. Check the sales list before entering it again.",
    "offline.unsyncedOne": "1 sale is saved on this device and has not reached the server yet. Keep this app installed until it syncs.",
    "offline.unsyncedMany": "{count} sales are saved on this device and have not reached the server yet. Keep this app installed until they sync.",
    "update.readyText": "A new version of the app is ready. Reload when you are not mid-sale.",
    "update.reloadButton": "Reload now",
    "dashboard.vatSettings": "VAT",
    "vat.dialogTitle": "VAT registration",
    "vat.classStandard": "Standard rated", "vat.classZeroRated": "Zero rated", "vat.classExempt": "Exempt",
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
    "returns.servicesNotReturnable": "This sale is services only. A service cannot be returned once given — void the whole sale instead.",
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
    "movement.subtitle": "What has happened to {name}: what it sold, where it moved, and what it cost.",
    "movement.salesSectionTitle": "Sales History",
    "movement.purchasesSectionTitle": "Bought / added",
    "movement.purchasesSubtitle": "When this product came in, and what it cost. Newest first.",
    "movement.colSupplier": "Supplier",
    "movement.colTotalPaid": "Total paid",
    "movement.colEach": "Each",
    "movement.colLanded": "of which landed",
    "movement.noLanded": "—",
    "movement.noPurchases": "Nothing recorded yet. Costs are recorded when you receive a delivery or restock with a price.",
    "movement.transfersSectionTitle": "Transfer History",
    "movement.noSalesForProduct": "No sales recorded for this product yet.",
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
    "prompt.title": "Enter a value",
    "prompt.accept": "OK",
    "confirm.title": "Are you sure?",
    "confirm.cancel": "Cancel",
    "confirm.accept": "Yes, continue",
    "staff.inviteLinkLabel": "Invite link",
    "staff.copyFailedUseLink": "Could not copy automatically. The link is shown above — copy it from there.",
    "staff.revokeButton": "Revoke",
    "staff.rosterEmpty": "No staff members have accepted an invite yet.",
    "staff.allStoresLabel": "All stores",
    "staff.revokeConfirm": "Revoke access for {email}? They will be immediately signed out of this business's data.",
    "staff.revokeSuccess": "Access revoked for {email}.",
    "staff.revokeFailed": "Could not revoke access. Please try again."
  },
  sw: {
    "nav.dashboard": "Dashibodi", "nav.inventory": "Hisa", "nav.pos": "Mauzo",
    "nav.expenses": "Matumizi",
    "nav.settings": "Mipangilio",
    "settings.eyebrow": "Akaunti na biashara yako",
    "settings.title": "Mipangilio",
    "settings.accountTitle": "Akaunti",
    "settings.signedInAs": "Umeingia kama",
    "backup.last": "Nakala ya mwisho: {date}.",
    "backup.stale": "Nakala ya mwisho: {date} — siku {days} zilizopita. Chukua mpya.",
    "backup.never": "Hujawahi kuchukua nakala. Simu hii ikipotea, kumbukumbu ya biashara yako inapotea nayo.",
    "reports.groupFinancial": "Fedha", "reports.groupSales": "Mauzo",
    "reports.groupPurchases": "Manunuzi", "reports.groupInventory": "Hisa",
    "reports.groupExpenses": "Matumizi",
    "reports.hint.profit": "Mapato, gharama ya bidhaa, na ulichobakiza",
    "reports.hint.salesPayments": "Kilichoingia, na kililipwaje",
    "reports.hint.customerCredit": "Nani anakudai, na kiasi gani",
    "reports.hint.expensesByCategory": "Duka lilitumia nini, kwa makundi",
    "reports.hint.salesByProduct": "Bidhaa zipi ziliuzwa, na kwa kiasi gani",
    "reports.hint.salesByStaff": "Nani aliuza nini, na alichukua kiasi gani",
    "reports.hint.orderLookup": "Tafuta oda za mfanyakazi mmoja",
    "reports.hint.salesByCustomer": "Wateja gani wananunua zaidi",
    "reports.hint.salesReturns": "Wateja walirudisha nini",
    "reports.hint.stockValuation": "Rafuni zina nini, na iligharimu kiasi gani",
    "reports.hint.stockSummary": "Kilichopo rafuni kwa sasa",
    "reports.hint.stockAdjustments": "Hisa ilikwenda wapi bila kuuzwa",
    "reports.hint.offlineSales": "Iliuzwa wakati wa hitilafu — rafuni za kuhesabu upya",
    "reports.hint.purchaseSummary": "Ulichonunua, ukiondoa kilichorudishwa",
    "reports.hint.purchasesByProduct": "Ulichotumia, bidhaa kwa bidhaa",
    "reports.hint.purchaseReturns": "Ulichorudisha kwa wasambazaji",
    "reports.hint.supplierBalances": "Unachodaiwa na kila msambazaji",
    "reports.hint.monthlyReports": "Muhtasari ulioandikwa wa mwezi",
    "reports.hint.exports": "Pakua kumbukumbu zako kama CSV, PDF au Excel",
    "reports.hint.vatReport": "Ulichotoza, na unachoweza kudai kurudishiwa",
    "reports.exportsEyebrow": "Vipakuliwa",
    "reports.exportsTitle": "Pakua kumbukumbu zako",
    "reports.chooseEyebrow": "Chagua ripoti",
    "reports.chooseTitle": "Unataka kuona nini?",
    "reports.chooseEmpty": "Bado hakuna ripoti unayoweza kufungua.",
    "reports.backToAll": "← Ripoti zote",
    "reports.group.money": "Fedha",
    "reports.group.sales": "Mauzo",
    "reports.group.stock": "Hisa",
    "reports.group.buying": "Manunuzi",
    "reports.group.ai": "Uliza SaviaSmart",
    "reports.ledgerPendingTitle": "Mizania, Salio la Majaribio, Mtiririko wa Fedha na Leja Kuu",
    "reports.ledgerPendingBody": "Hizi nne ni taarifa za leja ya kuingiza mara mbili, ambayo mfumo huu bado hauitunzi. Zitaonekana chini ya Hesabu, ndiyo maana kichupo hicho kipo lakini bado hakijafunguliwa. Faida na Hasara inapatikana sasa, kwenye kichupo chake, kwa sababu inajengwa kutoka kwenye miamala yenyewe.",
    "reports.openProfit": "Fungua Faida na Hasara",
    "reports.byCustomerTitle": "Mauzo kwa Mteja",
    "reports.byCustomerIntro": "Inatumia kipindi kilichochaguliwa hapo juu. Mauzo yasiyo na mteja yamewekwa pamoja kama ya kupita, badala ya kuachwa nje.",
    "reports.walkIn": "Mteja wa kupita",
    "reports.salesReturnsTitle": "Marejesho ya Mauzo",
    "reports.purchaseSummaryTitle": "Muhtasari wa Manunuzi",
    "reports.purchaseGross": "Ulichonunua", "reports.purchaseGrossNote": "Safu {count} za manunuzi, vipande {units}.",
    "reports.purchaseReturned": "Ulichorudisha",
    "reports.purchaseReturnedNote": "Vipande {units} vimerudishwa kwa wasambazaji.",
    "reports.purchaseReturnedNone": "Hakuna kilichorudishwa.",
    "reports.purchaseNet": "Manunuzi halisi", "reports.purchaseNetNote": "Ulichonunua, ukiondoa kilichorudi.",
    "reports.byProductPurchaseTitle": "Manunuzi kwa Bidhaa",
    "reports.purchaseReturnsTitle": "Marejesho ya Manunuzi",
    "reports.supplierBalancesTitle": "Salio za Wasambazaji",
    "reports.supplierBalancesIntro": "Kile biashara inachodaiwa. Wamesajiliwa tu wenye kiasi kilichobaki.",
    "reports.supplierBalancesTotal": "JUMLA INAYODAIWA",
    "reports.stockSummaryTitle": "Muhtasari wa Hisa",
    "reports.adjustmentsTitle": "Marekebisho ya Hisa",
    "reports.adjustmentsIntro": "Hisa ilikoenda pasipo kuuzwa. Imepangwa kwa sababu iliyotolewa wakati huo.",
    "reports.adjustmentsNet": "JUMLA",
    "reports.byCategoryTitle": "Matumizi kwa Aina",
    "reports.natureDirect": "Ya moja kwa moja", "reports.natureIndirect": "Ya jumla",
    "kpi.receivable": "Unachodai", "kpi.receivableDelta": "Deni la wateja lililobaki",
    "kpi.payable": "Unachodaiwa na wasambazaji", "kpi.payableDelta": "Usafirishaji ambao haujalipwa",
    "product.unitLabel": "Kipimo", "product.unitPlaceholder": "mfano kipande, kreti, kg",
    "product.skuLabel": "SKU (hiari)", "product.activeLabel": "Hali",
    "product.activeYes": "Inatumika", "product.activeNo": "Haitumiki — acha kuiuza",
    "movement.colProduct": "Bidhaa",
    "reports.thCustomer": "Mteja", "reports.thOrders": "Oda", "reports.thRevenue": "Mapato",
    "reports.thOrder": "Oda", "reports.thRefunded": "Kilichorejeshwa",
    "reports.thNetUnits": "Vipande (halisi)", "reports.thReturned": "Vilivyorudi", "reports.thNetSpend": "Kilichotumika (halisi)",
    "reports.thValue": "Thamani", "reports.thWhy": "Kwa nini",
    "reports.thCategory": "Aina", "reports.thOnShelf": "Zilizopo rafuni",
    "reports.thMinimum": "Kiwango cha chini", "reports.thState": "Hali",
    "reports.thTimes": "Mara", "reports.thNature": "Moja kwa moja au jumla", "reports.thAmount": "Kiasi",
    "reports.stockOk": "Sawa", "reports.stockLow": "Chache", "reports.stockOut": "Zimeisha",
    "reports.noSalesInRange": "Hakuna mauzo katika kipindi hiki.",
    "reports.noReturnsInRange": "Hakuna marejesho katika kipindi hiki.",
    "reports.noProducts": "Hakuna bidhaa bado.",
    "reports.noExpenses": "Hakuna matumizi yaliyorekodiwa bado.",
    "reports.noPurchases": "Hakuna ulichonunua bado.",
    "reports.noPurchaseReturns": "Hakuna kilichorudishwa kwa msambazaji.",
    "reports.noSupplierBalances": "Huna deni kwa msambazaji yeyote sasa.",
    "reports.noAdjustments": "Hakuna marekebisho ya hisa yaliyorekodiwa.",
    "product.quantityLocked": "Tumia Rekebisha kwenye safu ya bidhaa kusahihisha hesabu ya rafu, ili mabadiliko yarekodiwe na sababu.",
    "adjust.action": "Rekebisha", "adjust.title": "Rekebisha Hisa",
    "adjust.currentLabel": "Zilizopo rafuni sasa", "adjust.newLabel": "Zilizohesabiwa / sahihi ni",
    "adjust.reasonLabel": "Kwa nini", "adjust.noteLabel": "Maelezo (hiari)",
    "adjust.saveButton": "Rekodi Marekebisho",
    "adjust.qtyInvalid": "Weka idadi iliyopo rafuni sasa.",
    "adjust.noChange": "Hiyo ni sawa na hesabu ya sasa, hivyo hakuna cha kurekodi.",
    "adjust.deltaNone": "Hakuna mabadiliko.",
    "adjust.deltaUp": "Inaongeza {units} rafuni.",
    "adjust.deltaDown": "Inaondoa {units} rafuni.",
    "adjust.reason.count": "Hesabu ya hisa", "adjust.reason.damaged": "Zimeharibika",
    "adjust.reason.expired": "Zimeisha muda", "adjust.reason.lost": "Zimepotea",
    "adjust.reason.theft": "Wizi", "adjust.reason.correction": "Marekebisho",
    "adjust.reason.opening": "Hisa ya kuanzia", "adjust.reason.other": "Nyingine",
    "movement.ledgerSectionTitle": "Mienendo ya hisa",
    "movement.ledgerSubtitle": "Kila kilichosogeza bidhaa hii, kuanzia za zamani, na hesabu ya rafu ikishuka nayo.",
    "movement.colWhat": "Kilichotokea", "movement.colIn": "Ndani", "movement.colOut": "Nje",
    "movement.colBalance": "Salio",
    "movement.balanceUnknown": "haikurekodiwa",
    "movement.noLedger": "Hakuna kilichosogeza bidhaa hii bado.",
    "movement.reason.sale": "Mauzo", "movement.reason.restock": "Manunuzi / kujaza",
    "movement.reason.return": "Marejesho ya mteja", "movement.reason.void": "Mauzo yamefutwa",
    "movement.reason.transfer-in": "Imehamishwa ndani", "movement.reason.transfer-out": "Imehamishwa nje",
    "movement.reason.adjustment": "Marekebisho", "movement.reason.supplier-return": "Imerudishwa kwa msambazaji",
    "purchaseReturn.action": "Rudisha", "purchaseReturn.allReturned": "Zote zimerudishwa",
    "purchaseReturn.title": "Rudisha kwa Msambazaji",
    "purchaseReturn.summary": "{qty} zilinunuliwa kwa {supplier}. Hadi {max} bado zinaweza kurudi.",
    "purchaseReturn.noSupplier": "hakuna msambazaji aliyerekodiwa",
    "purchaseReturn.qtyLabel": "Idadi inayorudi",
    "purchaseReturn.reasonLabel": "Kwa nini (hiari)",
    "purchaseReturn.reasonPlaceholder": "mfano ziliharibika njiani",
    "purchaseReturn.saveButton": "Rekodi Marejesho",
    "purchaseReturn.qtyInvalid": "Weka idadi ya vipande vinavyorudi.",
    "purchaseReturn.qtyTooMany": "Ni {max} tu za manunuzi haya zinazoweza kurudishwa.",
    "purchaseReturn.notEnoughStock": "Hakuna bidhaa za kutosha rafuni kuzirudisha. Hesabu rafu kwanza.",
    "deliveries.thPayment": "Malipo",
    "suppliers.thOwed": "Unawadai", "suppliers.statement": "Taarifa",
    "suppliers.payButton": "Lipa",
    "suppliers.paymentTitle": "Rekodi Malipo",
    "suppliers.paymentAmountLabel": "Kiasi", "suppliers.paymentMethodLabel": "Umelipa kwa",
    "suppliers.paymentReferenceLabel": "Kumbukumbu (hiari)", "suppliers.paymentNoteLabel": "Maelezo (hiari)",
    "suppliers.paymentSaveButton": "Rekodi Malipo",
    "suppliers.paymentOwedNow": "Kwa sasa unawadai {amount}.",
    "suppliers.paymentAmountInvalid": "Weka kiasi kikubwa kuliko sifuri.",
    "suppliers.paymentTooMuch": "Hicho ni zaidi ya unavyowadai ({owed}). Rekodi ulicholipa hasa.",
    "suppliers.paymentNothingOwed": "Huna deni tena kwa msambazaji huyu.",
    "suppliers.statementTitle": "Taarifa ya Msambazaji",
    "suppliers.statementIntro": "Ulichonunua kwa {name}, na ulichowalipa.",
    "suppliers.statementOpening": "Deni kabla ya kuanza kutumia SaviaSmart",
    "suppliers.statementBought": "Ulichonunua kwao",
    "suppliers.statementPaidOnDelivery": "Ulicholipa bidhaa zilipofika",
    "suppliers.statementPaid": "Ulichowalipa baadaye",
    "suppliers.statementOwed": "BADO UNADAIWA",
    "suppliers.statementPurchasesTitle": "Manunuzi", "suppliers.statementPaymentsTitle": "Malipo",
    "suppliers.statementColWhat": "Kitu",
    "suppliers.statementNoPurchases": "Hakuna ulichonunua kwao bado.",
    "suppliers.statementNoPayments": "Hakuna malipo yaliyorekodiwa bado.",
    "suppliers.statementBoundedNote": "Orodha zinaonyesha historia ya karibuni. Kiasi kinachodaiwa huhifadhiwa kama namba inayoendelea, hivyo hubaki sahihi hata historia ikiwa ndefu kuliko hii.",
    "deliveries.amountPaidLabel": "Kiasi ulicholipa sasa (hiari)",
    "deliveries.amountPaidPlaceholder": "Wazi = umelipa yote",
    "deliveries.paymentMethodLabel": "Umelipa kwa",
    "deliveries.amountDueLabel": "Bado unadaiwa kwa usafirishaji huu",
    "deliveries.statusPaid": "Imelipwa", "deliveries.statusPartial": "Imelipwa kiasi", "deliveries.statusCredit": "Kwa deni",
    "deliveries.amountPaidInvalid": "Weka 0 au zaidi, na isizidi jumla ya usafirishaji.",
    "deliveries.creditNeedsSupplier": "Chagua msambazaji uliyemrekodi kabla ya kununua kwa deni, ili deni liwe na pa kwenda.",
    "txerror.supplierGone": "Rekodi ya msambazaji huyo haipo tena.",
    "suppliers.eyebrow": "Unaonunua kwao", "suppliers.title": "Wasambazaji",
    "suppliers.addButton": "+ Msambazaji", "suppliers.edit": "Hariri",
    "suppliers.intro": "Msambazaji aliyerekodiwa hapa anaweza kuchaguliwa unaponunua, ili manunuzi yajikusanye chini ya jina moja badala ya jinsi lilivyoandikwa siku hiyo.",
    "suppliers.empty": "Hakuna wasambazaji bado. Ongeza wale unaonunua bidhaa kwao.",
    "suppliers.thName": "Msambazaji", "suppliers.thPhone": "Simu", "suppliers.thTin": "TIN",
    "suppliers.thPurchases": "Ulichonunua kwao", "suppliers.thStatus": "Hali", "suppliers.thActions": "Vitendo",
    "suppliers.dialogTitle": "Ongeza Msambazaji", "suppliers.dialogTitleEdit": "Hariri Msambazaji",
    "suppliers.nameLabel": "Jina la msambazaji", "suppliers.namePlaceholder": "mfano Twiga Cement",
    "suppliers.phoneLabel": "Simu", "suppliers.emailLabel": "Barua pepe", "suppliers.tinLabel": "TIN",
    "suppliers.addressLabel": "Anwani",
    "suppliers.openingBalanceLabel": "Unachodaiwa nao tayari",
    "suppliers.openingBalanceHint": "Acha 0 isipokuwa ulikuwa unawadai kabla ya kuanza kutumia SaviaSmart.",
    "suppliers.openingBalanceInvalid": "Weka 0 au kiasi chanya.",
    "suppliers.statusLabel": "Hali", "suppliers.statusActive": "Anatumika",
    "suppliers.statusInactive": "Hatumiki — acha kumpendekeza", "suppliers.statusInactiveShort": "Hatumiki",
    "suppliers.saveButton": "Hifadhi Msambazaji",
    "suppliers.nameRequired": "Weka jina la msambazaji.",
    "suppliers.nameTaken": "Tayari una msambazaji mwenye jina hili.",
    "settings.emailLabel": "Barua pepe", "settings.changeNameButton": "Badilisha Jina",
    "settings.branchEyebrow": "Tawi hili",
    "settings.branchTitle": "Tawi na biashara",
    "settings.branchIntro": "Haya yanahusu tawi lililochaguliwa kwenye dashibodi. Sarafu na VAT hubadilisha jinsi kila takwimu inavyoonyeshwa na kuwasilishwa, hivyo ni ya mmiliki pekee.",
    "settings.staffTitle": "Wafanyakazi",
    "settings.staffIntro": "Nani anaweza kuingia, na anaweza kufanya nini. Kaunta ina njia yake ya haraka kwenye orodha hii, kwa sababu hapo ndipo mauzo yanapohusishwa.",
    "settings.securityTitle": "Usalama",
    "settings.securityIntro": "Nenosiri la punguzo linaulizwa kabla ya kubadilisha bei, kurejesha fedha au kutengua mauzo, ili wafanyakazi wanaoaminika pekee waweze kuidhinisha.",
    "settings.dataTitle": "Data yako",
    "settings.dataIntro": "Nakala rudufu ni faili la kila kitu akaunti hii inashikilia, linalopakuliwa kwenye kifaa hiki. Kufuta akaunti kunapangwa, si mara moja, na kunaweza kutenguliwa ndani ya kipindi cha neema.",
    "settings.displayTitle": "Lugha na muonekano",
    "nav.reports": "Ripoti", "nav.ai": "Mshauri wa AI",
    "brand.tagline": "ERP ya Hisa yenye AI",
    "sidebar.connectionHintSignedOut": "Ingia ili kusawazisha hisa yako",
    "topbar.searchPlaceholder": "Tafuta bidhaa zako...",
    "topbar.signOut": "Toka", "topbar.langToggle": "English",
    "dashboard.eyebrowToday": "Leo", "dashboard.title": "Kituo cha Uendeshaji",
    "dashboard.profitEyebrow": "Utendaji",
    "dashboard.profitTitle": "Faida halisi",
    "dashboard.profitNote": "Mapato ukiondoa gharama ya bidhaa na matumizi, kwa kila kipindi. Ni kamili kadri ya matumizi uliyoingiza — Ripoti ya Faida inaonyesha hesabu.",
    "dashboard.chartWeek": "Kwa wiki",
    "dashboard.chartMonth": "Kwa mwezi",
    "dashboard.chartYear": "Kwa mwaka",
    "chart.profitEmpty": "Hakuna faida ya kuonyesha bado. Rekodi mauzo ya bidhaa yenye bei ya gharama.",
    "chart.noCost": "hakuna gharama",
    "dashboard.addStore": "+ Duka", "dashboard.analyticsEyebrow": "Uchambuzi wa hisa",
    
    "dashboard.alertsEyebrow": "Arifa muhimu", "dashboard.needsAttention": "Yanayohitaji uangalizi",
    "dashboard.popupAlerts": "Arifa za dirisha ibukizi", "dashboard.movementTitle": "Mwendo wa bidhaa",
    "dashboard.aiEngineEyebrow": "Injini ya kuagiza upya ya AI", "dashboard.recommendationsTitle": "Mapendekezo ya ununuzi",
    "inventory.intro": "Kilichopo rafuni zako. Ongeza hisa uliyokuwa nayo tayari hapa \u2014 hisa mpya unayonunua inarekodiwa chini ya Manunuzi, ambako ulicholipa na gharama za usafirishaji vinachukuliwa pamoja.",
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
    "pos.cash": "Fedha Taslimu", "pos.mobile": "Pesa za Simu", "pos.card": "Kadi", "pos.bank": "Benki",
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
    "control.expectedCashNoteWithRepayments": "Mauzo ya taslimu, malipo ya awali na madeni yaliyolipwa, ukiondoa marejesho",
    "control.collectedOnAccount": "Madeni yaliyolipwa",
    "control.collectedOnAccountNote": "Taslimu · Simu · Kadi — hakuna deni lililolipwa leo",
    "control.collectedOnAccountUnavailable": "Kwa mmiliki pekee",
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
    "nav.accounts": "Hesabu",
    "nav.soon": "Inakuja",
    "nav.vat": "VAT",
    "report.vatRecordLink": "Fungua kumbukumbu kamili ya VAT katika Accounts",
    "vatRecord.eyebrow": "Unachodaiwa, na unachoweza kudai kurudishiwa",
    "vatRecord.title": "Kumbukumbu ya VAT",
    "vatRecord.monthLabel": "Mwezi",
    "vatRecord.intro": "VAT ya mauzo ni uliyowatoza wateja. VAT ya manunuzi ni uliyolipa wasambazaji na unaweza kudai kurudishiwa, pale ulipo na risiti ya kodi. Hii ni kumbukumbu ya kukagua kabla ya kuwasilisha, si fomu ya kuwasilisha.",
    "vatRecord.output": "VAT ya mauzo",
    "vatRecord.outputNote": "Ilitozwa kwenye mauzo {count} mwezi huu",
    "vatRecord.input": "VAT ya manunuzi unayoweza kudai",
    "vatRecord.inputNote": "Kutoka manunuzi {count} yenye risiti ya kodi",
    "vatRecord.net": "Kiasi cha kulipa",
    "vatRecord.netNote": "VAT ya mauzo ukiondoa unayoweza kudai",
    "vatRecord.netCreditNote": "Ulidai zaidi ya ulivyotoza mwezi huu",
    "vatRecord.refundsNotNetted": "VAT ya mauzo bado haipunguzwi kwa marejesho, hivyo ni kubwa kuliko takwimu halisi. {amount} yalirejeshwa mwezi huu — angalia KNOWN-LIMITATIONS L-12.",
    "vatRecord.outsideWindow": "Kifaa hiki kinaona kumbukumbu hadi {date} pekee, hivyo mwezi huu hauwezi kujumlishwa kikamilifu. Takwimu ndogo kuliko halisi ndiyo hatari, hivyo haionyeshwi. Chagua mwezi wa karibuni, au chagua tawi moja.",
    "vatRecord.expiringTitle": "Madai unayokaribia kupoteza",
    "vatRecord.expiringHint": "Una risiti, lakini hujaandika VAT yake. Iandike kabla ya miezi sita kuisha.",
    "vatRecord.blockedTitle": "Matumizi usiyoweza kudai mwezi huu",
    "vatRecord.blockedHint": "Yanaonyeshwa ili uone kwa nini dai ni dogo kuliko matumizi, na uombe nini mara ijayo.",
    "vatRecord.colDate": "Tarehe ya risiti",
    "vatRecord.colProduct": "Bidhaa",
    "vatRecord.colPaid": "Jumla iliyolipwa",
    "vatRecord.colExpires": "Dai linafungwa",
    "vatRecord.colReason": "Kwa nini hapana",
    "vatRecord.reason.noReceipt": "Hakuna risiti ya kodi — mwombe msambazaji",
    "vatRecord.reason.noReceiptDate": "Hakuna tarehe iliyoandikwa kutoka kwenye risiti",
    "vatRecord.reason.noVatAmount": "VAT haijaandikwa kutoka kwenye risiti",
    "vatRecord.reason.expired": "Muda wa miezi sita wa kudai umeisha",
    "vatRecord.reason.exceedsTotal": "VAT iliyoandikwa ni kubwa kuliko kiasi kilicholipwa",
    "nav.profit": "Ripoti ya Faida",
    "profit.eyebrow": "Kilichobaki",
    "profit.title": "Ripoti ya Faida",
    "profit.monthLabel": "Mwezi",
    "profit.intro": "Mapato ukiondoa gharama ya bidhaa, ukiondoa matumizi ya duka. Mbili za kwanza zinahesabiwa kutoka kwenye rekodi zako; ya mwisho ni kamili kadri ulivyoingiza.",
    "reports.costEyebrow": "Gharama na ugavi",
    "reports.costMonthLabel": "Mwezi",
    "reports.sbpTitle": "Mauzo kwa Bidhaa",
    "reports.sbpThProduct": "Bidhaa",
    "reports.sbpThUnits": "Vipande vilivyouzwa",
    "reports.sbpThOrders": "Oda",
    "reports.sbpThRevenue": "Mapato",
    "reports.sbpEmpty": "Hakuna mauzo katika kipindi hiki bado.",
    "reports.sbpService": "(huduma)",
    "reports.sbpNote": "Vipande na mapato kwa kipindi kilicho hapo juu, marejesho yameondolewa na mauzo yaliyotenguliwa hayajajumuishwa. Yamepangwa kwa yaliyoingiza fedha nyingi zaidi.",
    "reports.stockValuationTitle": "Thamani ya Hisa",
    "reports.stockAtCost": "Hisa kwa gharama",
    "reports.stockAtRetail": "Ikiuzwa yote kwa bei ya orodha",
    "reports.stockAtRetailNote": "Kiasi ambacho rafu zingeingiza kwa bei za leo. Si thamani halisi ya hisa.",
    "reports.stockComplete": "Kila bidhaa iliyopo rafuni ina gharama iliyorekodiwa.",
    "reports.stockPartial": "Bidhaa {missing} hazina gharama iliyorekodiwa, zinazohusisha vipande {units} — hazipo kwenye jumla hii.",
    "reports.stockEmpty": "Hakuna bidhaa katika tawi hili bado.",
    "reports.svThProduct": "Bidhaa",
    "reports.svThQuantity": "Zilizopo",
    "reports.svThUnitCost": "Gharama ya kipande",
    "reports.svThValue": "Thamani kwa gharama",
    "reports.supplierTitle": "Ripoti ya Wasambazaji",
    "reports.supplierEmpty": "Hakuna manunuzi yaliyorekodiwa kwa msambazaji mwezi huu.",
    "reports.supThSupplier": "Msambazaji",
    "reports.supThLines": "Safu",
    "reports.supThDeliveries": "Mizigo",
    "reports.supThGoods": "Bidhaa",
    "reports.supThLanded": "Gharama za ziada",
    "reports.supThTotal": "Jumla iliyolipwa",
    "reports.expenseNatureTitle": "Ripoti ya Gharama za Moja kwa Moja na Zisizo",
    "reports.expenseNatureEmpty": "Hakuna matumizi yaliyorekodiwa mwezi huu.",
    "reports.enThCategory": "Kundi",
    "reports.enThAmount": "Kiasi",
    "profit.pdEyebrow": "Faida ilitoka wapi",
    "profit.pdTitle": "Kwa bidhaa",
    "profit.pdThProduct": "Bidhaa",
    "profit.pdThUnits": "Vipande vilivyouzwa",
    "profit.pdThAvgCost": "Gharama ya wastani",
    "profit.pdThCogs": "Gharama ya mauzo",
    "profit.pdThGoods": "kati ya hizo, bidhaa",
    "profit.pdThLanded": "kati ya hizo, gharama za ziada",
    "profit.pdThRevenue": "Mapato",
    "profit.pdThGross": "Faida ghafi",
    "profit.pdThMargin": "Kiwango",
    "profit.pdTotal": "JUMLA",
    "profit.pdNoCost": "Bidhaa {count} hazina gharama iliyorekodiwa, hivyo kiwango chake cha faida hakiwezi kupatikana.",
    "profit.pdNoLanded": "Bidhaa {count} zilinunuliwa kabla gharama za ziada hazijarekodiwa, hivyo hakuna kilichotengwa kwa usafirishaji.",
    "profit.pdAttribution": "Safu za bidhaa na gharama za ziada zinagawanya gharama ya mauzo ya kila bidhaa kwa uwiano sawa na kila kilichowahi kununuliwa — ni ugawaji, si kipimo tofauti.",
    "profit.stRevenue": "Mapato ya mauzo",
    "profit.stCogs": "Gharama ya bidhaa zilizouzwa",
    "profit.stCogsNote": "Gharama ya bidhaa ulizouza mwezi huu, pamoja na usafirishaji na ushuru",
    "profit.stGross": "FAIDA GHAFI",
    "profit.stDirect": "Gharama za uendeshaji za moja kwa moja",
    "profit.stDirectNote": "Gharama zinazotokea kwa sababu tu kitu kimeuzwa",
    "profit.stIndirect": "Gharama za uendeshaji zisizo za moja kwa moja",
    "profit.stNet": "FAIDA HALISI",
    "profit.deduction": "({value})",
    "profit.revenue": "Mapato",
    "profit.revenueNote": "Mauzo {count}, baada ya marejesho",
    "profit.revenueNoteOne": "Mauzo 1, baada ya marejesho",
    "profit.revenueNoteVat": "Mauzo {count}, baada ya marejesho na VAT",
    "profit.revenueNoteVatOne": "Mauzo 1, baada ya marejesho na VAT",
    "profit.gross": "Faida ghafi",
    "profit.grossNote": "Mapato ukiondoa gharama ya bidhaa hizo",
    "profit.grossPartial": "Haijakamilika \u2014 safu {missing} kati ya {total} zilizouzwa hazina gharama iliyorekodiwa",
    "profit.grossNoCost": "Hakuna gharama iliyorekodiwa kwa kilichouzwa mwezi huu",
    "profit.expenses": "Matumizi",
    "profit.expensesNote": "{count} yamerekodiwa mwezi huu",
    "profit.expensesNone": "Hakuna kilichorekodiwa \u2014 si sawa na kutokutumia chochote",
    "profit.net": "Ulichobakiza",
    "profit.netNote": "Faida ghafi ukiondoa matumizi yaliyorekodiwa. Ni kamili kadri ulivyoingiza.",
    "profit.netNoCost": "Inahitaji gharama iliyorekodiwa kabla haijamaanisha kitu",
    "profit.complete": "Kila safu iliyouzwa ina gharama iliyorekodiwa na matumizi yameingizwa kwa mwezi huu.",
    "profit.incomplete": "Ichukulie kama mwongozo, si takwimu ya kuwasilisha: ni nzuri kadri ya gharama na matumizi yaliyorekodiwa mwezi huo.",
    "profit.outsideWindow": "Mwezi huu ni wa zamani kuliko mauzo yaliyopakiwa kwenye kifaa hiki (hadi {date}), hivyo hauwezi kujumlishwa. Fungua mwezi wa karibuni, au chagua tawi moja.",
    "nav.purchases": "Manunuzi",
    "purchases.eyebrow": "Bidhaa zilizonunuliwa",
    "purchases.title": "Manunuzi",
    "purchases.intro": "Kila mzigo, na ulicholipa kwa ajili yake. Hurekodiwa unapojaza stoo \u2014 unaweka jumla ya mzigo, na gharama ya kila kimoja inahesabiwa kutoka hapo.",
    "purchases.listTitle": "Yaliyorekodiwa",
    "purchases.monthLabel": "Mwezi",
    "purchases.thDate": "Tarehe",
    "purchases.thProduct": "Bidhaa",
    "purchases.thQty": "Idadi",
    "purchases.thUnitCost": "Kila moja",
    "purchases.thTotal": "Jumla iliyolipwa",
    "purchases.thReceipt": "Risiti ya kodi",
    "purchases.monthTotal": "Zilizotumika kwa bidhaa mwezi huu",
    "purchases.monthCount": "{delivery} {count}, {unit} {units}",
    "purchases.deliverySingular": "Mzigo",
    "purchases.deliveryPlural": "Mizigo",
    "purchases.noReceipt": "Zilizonunuliwa bila risiti ya kodi",
    "purchases.noReceiptNote": "Huwezi kudai VAT kwa hizi",
    "purchases.allReceipted": "Kila mzigo una namba ya risiti",
    "purchases.receiptYes": "Ndiyo",
    "purchases.receiptNo": "Hakuna",
    "purchases.thActions": "Vitendo",
    "purchases.delete": "Futa",
    "purchases.confirmDelete": "Futa mzigo huu wa {name} wa {value}? Hautaonekana tena kwenye rekodi ya manunuzi, na gharama ya wastani ya bidhaa haitahesabiwa upya.",
    "toast.purchaseDeleted": "Mzigo umefutwa",
    "toast.purchaseFailed": "Imeshindwa kufuta mzigo huo. Jaribu tena.",
    "purchases.empty": "Hakuna mzigo uliorekodiwa mwezi huu bado.",
    "purchases.emptyNoStore": "Chagua tawi ili kuona kilichonunuliwa.",
    "nav.deliveries": "Mizigo",
    "deliveries.eyebrow": "Bidhaa zilizopokelewa",
    "deliveries.title": "Mizigo",
    "deliveries.intro": "Mzigo mmoja, bidhaa nyingi, na gharama za kuufikisha hapa. Usafirishaji, ushuru, uondoshaji bandarini na usafiri vinagawanywa kwa bidhaa vilizoleta, ili kila kitu kibebe gharama yake halisi — si tu kile msambazaji alichotoza.",
    "deliveries.receiveButton": "Pokea mzigo",
    "deliveries.listTitle": "Iliyorekodiwa",
    "deliveries.monthLabel": "Mwezi",
    "deliveries.monthTotal": "Iliyopokelewa mwezi huu",
    "deliveries.monthCount": "{count} {delivery}, {units} {unit}",
    "deliveries.deliverySingular": "mzigo",
    "deliveries.deliveryPlural": "mizigo",
    "deliveries.landedTotal": "Gharama za ziada zilizoongezwa kwenye thamani",
    "deliveries.landedNote": "Usafirishaji, ushuru, uondoshaji na usafiri, vimeongezwa kwenye thamani ya bidhaa badala ya kutozwa kama matumizi.",
    "deliveries.landedNone": "Hakuna gharama za ziada zilizorekodiwa mwezi huu.",
    "deliveries.thDate": "Ilipokelewa",
    "deliveries.thReference": "Kumbukumbu",
    "deliveries.thSupplier": "Msambazaji",
    "deliveries.thLines": "Bidhaa",
    "deliveries.thGoods": "Bidhaa",
    "deliveries.thLanded": "Gharama za ziada",
    "deliveries.thTotal": "Jumla ya gharama",
    "deliveries.thBasis": "Imegawanywa kwa",
    "deliveries.thActions": "Vitendo",
    "deliveries.empty": "Hakuna mzigo uliorekodiwa mwezi huu bado.",
    "deliveries.emptyNoStore": "Chagua tawi ili kurekodi mzigo.",
    "deliveries.basisValue": "Thamani ya bidhaa",
    "deliveries.basisQuantity": "Idadi",
    "deliveries.basisManual": "Imewekwa kwa mkono",
    "deliveries.deleteButton": "Futa",
    "deliveries.deleteConfirm": "Futa mzigo huu na {count} {line} zake za manunuzi? Kile kilichoongezwa kwenye hisa yako na gharama yake kitabaki — rekodi mzigo mpya ili kurekebisha hilo.",
    "deliveries.lineSingular": "safu",
    "deliveries.linePlural": "safu",
    "deliveries.dialogTitle": "Pokea mzigo",
    "deliveries.supplierLabel": "Msambazaji (si lazima)",
    "deliveries.supplierTinLabel": "TIN ya msambazaji (si lazima)",
    "deliveries.referenceLabel": "Ankara au kumbukumbu (si lazima)",
    "deliveries.receivedAtLabel": "Tarehe ya kupokea",
    "deliveries.noteLabel": "Maelezo (si lazima)",
    "deliveries.linesTitle": "Kilichofika",
    "deliveries.addLineButton": "Ongeza bidhaa",
    "deliveries.removeLine": "Ondoa",
    "deliveries.lineProduct": "Bidhaa",
    "deliveries.lineQuantity": "Idadi",
    "deliveries.lineGoodsCost": "Jumla uliyolipa kwa hizi",
    "deliveries.linePickProduct": "Chagua bidhaa…",
    "deliveries.goodsTotal": "Gharama ya bidhaa: {value}",
    "deliveries.costsTitle": "Gharama za ziada",
    "deliveries.costsIntro": "Gharama za kufikisha bidhaa hapa na kuziandaa kuuzwa. Hizi zinaongezwa kwenye thamani ya hisa, hazitozwi kama matumizi — zinakuwa gharama ya mauzo bidhaa zinapouzwa.",
    "deliveries.costFreight": "Usafirishaji",
    "deliveries.costImportDuty": "Ushuru wa forodha",
    "deliveries.costClearing": "Gharama za uondoshaji",
    "deliveries.costTransport": "Usafiri",
    "deliveries.costHandling": "Upakiaji",
    "deliveries.costInsurance": "Bima",
    "deliveries.costOtherCost": "Nyingine",
    "deliveries.additionalTotal": "Gharama za ziada: {value}",
    "deliveries.basisLabel": "Gawanya gharama za ziada kwa",
    "deliveries.basisValueHint": "Kila bidhaa inachukua sehemu kulingana na gharama yake. Inafaa kwa mizigo mingi.",
    "deliveries.basisQuantityHint": "Kila bidhaa inachukua sehemu kulingana na idadi ya vipande vilivyofika.",
    "deliveries.basisManualHint": "Wewe unaamua kila sehemu. Lazima zijumuishe gharama za ziada sawasawa.",
    "deliveries.manualLabel": "Sehemu",
    "deliveries.previewTitle": "Kila bidhaa itagharimu kiasi gani",
    "deliveries.previewIntro": "Imehesabiwa kabla ya kuhifadhi chochote. Safu ya mwisho ni gharama ya kipande kimoja — na ndiyo itakayotozwa kwenye gharama ya mauzo kitakapouzwa.",
    "deliveries.thOriginal": "Gharama ya bidhaa",
    "deliveries.thAllocation": "Sehemu ya gharama za ziada",
    "deliveries.thFinal": "Gharama ya mwisho ya hisa",
    "deliveries.thEach": "Kila kimoja",
    "deliveries.totalRow": "JUMLA",
    "deliveries.totalCost": "Jumla ya gharama ya hisa",
    "deliveries.saveButton": "Rekodi mzigo",
    "deliveries.emptyPreview": "Ongeza bidhaa ili kuona mzigo utagharimu kiasi gani.",
    "deliveries.errNoLines": "Ongeza angalau bidhaa moja kabla ya kurekodi mzigo.",
    "deliveries.errTooManyLines": "Mzigo mmoja unaweza kubeba bidhaa {max} pekee. Rekodi zilizobaki kama mzigo wa pili.",
    "deliveries.errDuplicateProduct": "{name} imo kwenye mzigo huu mara mbili. Iweke kwenye safu moja na idadi kamili.",
    "deliveries.errMissingProduct": "Chagua bidhaa kwa kila safu.",
    "deliveries.errBadQuantity": "Safu {line}: weka idadi ya vipande vilivyofika, kwa namba kamili.",
    "deliveries.errBadGoodsCost": "Safu {line}: weka ulicholipa kwa vipande hivyo.",
    "deliveries.errLineCostsNothing": "{name} isingegharimu chochote. Ipe bei, au gawanya gharama za ziada kwa idadi ili ibebe sehemu.",
    "deliveries.errDeliveryCostsNothing": "Mzigo huu hauna gharama yoyote iliyorekodiwa.",
    "deliveries.errDeliveryTooLarge": "Jumla hiyo ni kubwa kuliko programu hii inavyoweza kurekodi.",
    "deliveries.errManualMismatch": "Sehemu zako zinapungua {short} kutoka gharama za ziada. Zirekebishe zilingane sawasawa.",
    "deliveries.errManualMismatchOver": "Sehemu zako zinazidi {over} kuliko gharama za ziada. Zirekebishe zilingane sawasawa.",
    "deliveries.errManualLength": "Weka sehemu kwa kila bidhaa.",
    "deliveries.errNegativeAmount": "Sehemu haiwezi kuwa hasi.",
    "deliveries.errNoWeight": "Bidhaa hizi hazina gharama wala idadi ya kugawanya gharama za ziada.",
    "deliveries.errNoStore": "Chagua tawi moja kabla ya kurekodi mzigo.",
    "deliveries.errNeedsConnection": "Mzigo unahitaji muunganisho — hakuna pa kuurekodi bila mtandao.",
    "deliveries.errUnconfirmed": "Mzigo ulitumwa lakini haukuthibitishwa. Angalia orodha kabla ya kuurekodi tena.",
    "deliveries.errTransactionFailed": "Haikuwezekana kurekodi mzigo huo. Hakuna kilichohifadhiwa. Jaribu tena.",
    "deliveries.errNoDelivery": "Mzigo huo haupo tena.",
    "deliveries.errDeleteFailed": "Haikuwezekana kufuta mzigo huo. Jaribu tena.",
    "deliveries.basisFellBack": "Bidhaa hizi hazina thamani ya kugawanya, hivyo gharama za ziada zimegawanywa kwa idadi.",
    "toast.deliveryRecorded": "Mzigo umerekodiwa: {count} {unit}, {value}.",
    "toast.deliveryDeleted": "Mzigo umefutwa.",
    "restock.totalPaidLabel": "Jumla uliyolipa kwa mzigo huu (si lazima)",
    "restock.totalPaidPlaceholder": "mfano, 400000",
    "restock.totalPaidInvalid": "Weka ulicholipa, au iache wazi.",
    "restock.unitCostHint": "Hiyo inakuwa {value} kila kimoja.",
    "restock.supplierLabel": "Msambazaji (si lazima)",
    "restock.vatAmountLabel": "VAT iliyoonyeshwa kwenye risiti",
    "restock.vatAmountHint": "Nakili kutoka kwenye risiti. Hiyo ndiyo unayoweza kudai.",
    "restock.vatAmountInvalid": "VAT haiwezi kuzidi jumla uliyolipa.",
    "restock.receiptLabel": "Namba ya risiti ya kodi (si lazima)",
    "restock.receiptHint": "Muda wa kudai VAT huanza tarehe hii, si siku unayorekodi.",
    "restock.supplierTinLabel": "TIN ya msambazaji (si lazima)",
    "restock.hasReceiptLabel": "Nina risiti ya kodi kwa mzigo huu",
    "restock.receiptDateLabel": "Tarehe iliyo kwenye risiti",
    "restock.costNeedsConnection": "Kurekodi ulicholipa kunahitaji mtandao. Ongeza mzigo sasa na gharama baadaye.",
    "expenses.dateTooOld": "Tarehe hiyo ni zaidi ya miaka miwili iliyopita. Angalia mwaka.",
    "toast.transferNeedsOwnerFirst": "{store} halina bidhaa hii bado, na mmiliki pekee ndiye anayeweza kuiongeza. Muombe aiongeze mara moja, kisha uhamisho utafanya kazi.",
    "toast.restockOffline": "Kujaza stoo kunahitaji mtandao. Mzigo utasubiri.",
    "toast.restockUnconfirmed": "Imechukua muda mrefu kuthibitisha. Angalia idadi ya bidhaa kabla ya kujaza tena.",
    "expenses.eyebrow": "Fedha zinazotoka",
    "expenses.title": "Matumizi",
    "expenses.addButton": "Rekodi Matumizi",
    "expenses.intro": "Kile duka linatumia, siku hadi siku. Kodi, umeme, usafiri, mishahara, matengenezo. Haya si manunuzi ya bidhaa \u2014 ni gharama za uendeshaji zilizo kati ya unachouza na unachobakiza.",
    "expenses.listTitle": "Yaliyorekodiwa",
    "expenses.monthLabel": "Mwezi",
    "expenses.thDate": "Tarehe",
    "expenses.thCategory": "Aina",
    "expenses.thNote": "Maelezo",
    "expenses.thPaidFrom": "Yalitolewa",
    "expenses.thAmount": "Kiasi",
    "expenses.thActions": "Vitendo",
    "expenses.dialogTitle": "Rekodi Matumizi",
    "expenses.editDialogTitle": "Hariri Matumizi",
    "expenses.amountLabel": "Kiasi",
    "expenses.amountPlaceholder": "mfano, 15000",
    "expenses.categoryLabel": "Aina",
    "expenses.dateLabel": "Tarehe ya matumizi",
    "expenses.paidFromLabel": "Yalitolewa wapi",
    "expenses.paidFromTill": "Kwenye mashine ya fedha",
    "expenses.paidFromOther": "Kwingine (benki, simu, mfukoni)",
    "expenses.noteLabel": "Maelezo (si lazima)",
    "expenses.notePlaceholder": "mfano, Bodaboda sokoni",
    "expenses.saveButton": "Hifadhi Matumizi",
    "expenses.monthTotal": "Yaliyotumika mwezi huu",
    "expenses.monthCount": "{count} yamerekodiwa",
    "expenses.fromTill": "Yaliyotolewa kwenye mashine",
    "expenses.fromTillNote": "Yanahesabiwa peke yake \u2014 mashine itapungukiwa kwa kiasi hiki",
    "expenses.topCategory": "Aina kubwa zaidi",
    "expenses.empty": "Hakuna kilichorekodiwa mwezi huu bado.",
    "expenses.emptyNoStore": "Chagua tawi ili kurekodi matumizi yake.",
    "expenses.amountRequired": "Weka kiasi kikubwa kuliko sifuri.",
    "expenses.dateRequired": "Chagua tarehe fedha zilipotumika.",
    "expenses.dateFuture": "Tarehe hiyo ipo mbeleni.",
    "expenses.edit": "Hariri",
    "expenses.delete": "Futa",
    "expenses.confirmDelete": "Futa matumizi haya? Jumla ya mwezi itabadilika.",
    "expenses.recordedBy": "na {name}",
    "cat.commission": "Kamisheni ya mauzo",
    "cat.delivery": "Usafirishaji kwa mteja",
    "cat.packaging": "Vifungashio vya mauzo",
    "expenses.natureLabel": "Aina ya gharama",
    "expenses.natureDirect": "Ya moja kwa moja — inatokana na mauzo",
    "expenses.natureIndirect": "Isiyo ya moja kwa moja — uendeshaji wa biashara",
    "expenses.natureDirectHint": "Gharama zinazotokea kwa sababu tu kitu kimeuzwa: kamisheni, usafirishaji kwa mteja, vifungashio. Inaonyeshwa kwenye mstari wake chini ya faida ghafi.",
    "expenses.natureIndirectHint": "Gharama za kuweka duka wazi hata kama hujauza leo: kodi ya pango, umeme, mishahara, leseni. Inaonyeshwa kwenye mstari wake chini ya faida ghafi.",
    "expenses.thNature": "Aina",
    "expenses.direct": "Gharama za moja kwa moja",
    "expenses.directNote": "Gharama zinazotokea kwa sababu tu kitu kimeuzwa.",
    "expenses.indirect": "Gharama zisizo za moja kwa moja",
    "expenses.indirectNote": "Gharama za kuweka duka wazi, uuze au usiuze.",
    "expenses.landedEyebrow": "Si matumizi",
    "expenses.landedTitle": "Gharama za ziada, zimeongezwa kwenye thamani ya hisa",
    "expenses.landedIntro": "Usafirishaji, ushuru, uondoshaji na usafiri kutoka {count} {delivery} iliyopokelewa mwezi huu. Fedha hizi hazijatumika — zimehifadhiwa kwenye thamani ya hisa yako, na zitakuwa gharama ya mauzo bidhaa hizo zitakapouzwa.",
    "expenses.landedThType": "Gharama",
    "expenses.landedThAmount": "Kiasi",
    "expenses.landedTotalRow": "JUMLA ILIYOONGEZWA",
    "expenses.landedExcluded": "Imeonyeshwa hapa kwa kumbukumbu tu. Jumla hii HAIJAJUMUISHWA kwenye takwimu za matumizi hapo juu — kuihesabu mara mbili kungepunguza faida yako.",
    "cat.rent": "Kodi ya pango",
    "cat.utilities": "Umeme na maji",
    "cat.wages": "Mishahara",
    "cat.transport": "Usafiri",
    "cat.supplies": "Vifaa vya duka",
    "cat.repairs": "Matengenezo",
    "cat.licences": "Leseni na ada",
    "cat.marketing": "Matangazo",
    "cat.other": "Mengineyo",
    "toast.expenseSaved": "Matumizi yamerekodiwa",
    "toast.expenseUpdated": "Matumizi yamesasishwa",
    "toast.expenseDeleted": "Matumizi yamefutwa",
    "toast.expenseFailed": "Imeshindwa kuhifadhi matumizi hayo. Jaribu tena.",
    "control.salesCountNote": "Mauzo {count} mwezi huu",
    "control.salesCountNoteOne": "Mauzo 1 mwezi huu",
    "control.grossMargin": "Faida ghafi (makadirio)",
    "control.marginNote": "Mapato ukiondoa gharama ya bidhaa",
    "control.marginIncomplete": "Haijakamilika — safu {missing} kati ya {total} zilizouzwa hazina bei ya gharama",
    "control.marginNoCost": "Hakuna bei za gharama zilizorekodiwa, hivyo faida haiwezi kupigwa hesabu",
    "control.showStockValue": "Onyesha thamani ya hisa",
    "control.stockValueLoading": "Inapakia…",
    "control.stockAtCost": "Thamani ya hisa kwa gharama",
    "control.stockAtRetail": "Kwa bei ya rejareja {value}",
    "control.stockAtCostUnknown": "Hakuna bei za gharama zilizorekodiwa. Kwa bei ya rejareja {value}",
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
    "product.vatAmountLabel": "VAT iliyoonyeshwa kwenye risiti",
    "product.vatAmountHint": "Nakili kutoka kwenye risiti. Hiyo ndiyo unayoweza kudai.",
    "product.vatAmountInvalid": "VAT haiwezi kuzidi jumla uliyolipa.",
    "product.costHeading": "Ulicholipa kwa hisa hii",
    "product.costHint": "Si lazima. Ukijua hisa hii ilikugharimu kiasi gani, iandike hapa na ufuatiliaji wa faida utaanza tangu siku ya kwanza. Ukiacha wazi, unaweza kuiongeza wakati wa kujaza hisa mara ya kwanza.",
    "product.totalPaidLabel": "Jumla uliyolipa kwa hisa hii (si lazima)",
    "product.totalPaidPlaceholder": "mfano 400000",
    "product.totalPaidInvalid": "Weka jumla uliyolipa, au acha wazi.",
    "product.totalPaidNeedsQuantity": "Weka idadi unayoongeza kabla ya kuandika ulicholipa.",
    "product.unitCostHint": "Hiyo ni {each} kwa kila kimoja.",
    "product.hasReceiptLabel": "Nina risiti ya kodi kwa hisa hii",
    "product.receiptLabel": "Namba ya risiti ya kodi (si lazima)",
    "product.receiptDateLabel": "Tarehe iliyo kwenye risiti",
    "product.receiptDateHint": "Muda wa kudai VAT huanza tarehe hii, si siku unayoiandika.",
    "product.nameLabel": "Jina la bidhaa", "product.categoryLabel": "Aina", "product.brandLabel": "Chapa",
    "product.supplierLabel": "Wasambazaji", "product.quantityLabel": "Kiasi",
    "product.priceLabel": "Bei ya kuuza", "product.priceTypeLabel": "Aina ya bei",
    "product.priceFixed": "Bei maalum", "product.priceDynamic": "Bei inayobadilika",
    "product.reorderLabel": "Kiwango cha chini cha hisa", "product.reorderPlaceholder": "mfano, 10",
    "product.cancel": "Ghairi", "product.save": "Hifadhi Bidhaa",
    "auth.eyebrow": "Ufikiaji wa akaunti",
    "auth.accessRemoved": "Ufikiaji wako kwa biashara hii umeondolewa. Muulize mmiliki kama unadhani ni makosa.",
    "auth.copy": "Fungua akaunti au ingia ili kusimamia hisa yako, viwango vya bidhaa, mauzo, na mapendekezo ya AI.",
    "auth.ownerName": "Jina lako",
    "auth.resetSentTitle": "Angalia barua pepe yako",
    "auth.resetSentBody": "Tumetuma kiungo kwa {email}. Kifungue ili uchague nenosiri jipya.",
    "auth.resetSentSpam": "Kama halipo ndani ya dakika chache, angalia kwenye folda ya taka (spam) au matangazo.",
    "auth.resetSentDismiss": "Rudi kuingia",
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
    "monthlyReport.revenueLineOne": "Kwa {period}: {revenue} mapato kutoka muamala 1.",
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
    "dialog.ownerNamePrompt": "Jina lako, kama linavyotakiwa kuonekana kwenye mauzo unayofanya:",
    "dialog.archiveStoreConfirm": "Hifadhi kumbukumbu ya \"{name}\"? Litafichwa kwenye kibadilishaji duka lakini historia yake itabaki.",
    "toast.selectSpecificStore": "Chagua duka mahususi kwanza.",
    "toast.ownerNameSaved": "Jina lako limehifadhiwa.", "toast.couldNotSaveOwnerName": "Imeshindwa kuhifadhi jina lako.",
    "toast.supplierAdded": "{name} ameongezwa kwa wasambazaji.", "toast.supplierUpdated": "{name} amesasishwa.",
    "toast.couldNotSaveSupplier": "Imeshindwa kuhifadhi msambazaji.",
    "toast.supplierPaymentRecorded": "Malipo kwa {name} yamerekodiwa.",
    "toast.couldNotSaveSupplierPayment": "Imeshindwa kurekodi malipo hayo.",
    "toast.purchaseReturnRecorded": "{qty} x {name} zimerudishwa kwa msambazaji.",
    "toast.couldNotSavePurchaseReturn": "Imeshindwa kurekodi marejesho hayo.",
    "toast.adjustmentRecorded": "Hisa ya {name} imerekebishwa.",
    "toast.couldNotSaveAdjustment": "Imeshindwa kurekodi marekebisho hayo.",
    "toast.storeRenamed": "Jina la duka limebadilishwa kuwa {name}.", "toast.couldNotRenameStore": "Imeshindwa kubadilisha jina la duka.",
    "toast.businessTypeSet": "Aina ya biashara imesasishwa. Mapendekezo ya aina za bidhaa yatabadilika.",
    "toast.storeArchived": "{name} imehifadhiwa kumbukumbu.", "toast.couldNotArchiveStore": "Imeshindwa kuhifadhi kumbukumbu ya duka.",
    "toast.cannotArchiveLastStore": "Unahitaji angalau duka moja linalofanya kazi; hifadhi kumbukumbu ya duka lingine kwanza.",
    "kpi.totalProducts": "Jumla ya Bidhaa", "kpi.totalProductsDelta": "Akaunti yako",
    "kpi.totalQuantity": "Jumla ya Kiasi", "kpi.totalQuantityDelta": "Vitengo vilivyopo",
    "kpi.categories": "Aina za Bidhaa", "kpi.categoriesDelta": "Makundi ya bidhaa",
    "kpi.suppliers": "Wasambazaji", "kpi.suppliersDelta": "Unaonunua kutoka kwao",
    "kpi.lowStock": "Bidhaa zenye Hisa Chache", "kpi.lowStockDelta": "Agiza upya sasa",
    "kpi.outStock": "Bidhaa Zilizoisha", "kpi.outStockDelta": "Haraka",
    "alert.belowMinimum": "Hisa iko chini ya kiwango cha chini. Hisa ya sasa: {quantity}.",
    "alert.allClearTitle": "Hakuna tatizo", "alert.allClearBody": "Hakuna bidhaa zenye hisa chache au zilizoisha.",
    "rec.reorderNow": "Agiza vitengo {qty} sasa.", "rec.estimatedStockout": "Inakadiriwa kuisha kwa siku {days}.",
    "movement.fastMoving": "Bidhaa zinazouzwa haraka", "movement.slowMoving": "Bidhaa zinazouzwa polepole",
    "movement.noSales": "Hakuna mauzo yaliyorekodiwa", "movement.healthyCoverage": "Hisa iliyo katika hali nzuri",
    "movement.ledgerGaps": "rafu hazilingani na leja ya hisa (mbaya zaidi: {name}, {unit} {units})",
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
    "inventory.clearFilters": "Ondoa utafutaji na vichujio",
    "toast.incorrectPassword": "Nenosiri si sahihi. Mabadiliko ya bei yamesitishwa.",
    "toast.overrideNotConfigured": "Mabadiliko ya bei ya ziada bado hayajawekwa. Muulize msimamizi wako ayaweke.",
    "toast.overrideNetworkError": "Imeshindwa kufikia huduma ya ruhusa. Angalia muunganisho wako na ujaribu tena.",
    "toast.overridePasswordSaved": "Nenosiri la punguzo limehifadhiwa.",
    "toast.overridePasswordSaveFailed": "Imeshindwa kuhifadhi nenosiri. Jaribu tena.",
    "toast.nothingToUndo": "Hakuna cha kutengua.", "toast.lastCartActionUndone": "Kitendo cha mwisho cha kikapu kimetenguliwa.",
    "toast.pdfLibraryFailed": "Maktaba ya PDF haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.excelLibraryFailed": "Maktaba ya Excel haikupakia. Angalia muunganisho wako na ujaribu tena.",
    "toast.aiProxyUnavailable": "Proksi ya AI haipatikani ({message}). Inaonyesha pendekezo la ndani.",
    "toast.aiQuestionEmpty": "Andika swali kwanza.",
    "toast.productSavedWithoutCost": "Bidhaa imehifadhiwa, lakini ulicholipa hakikuweza kuandikwa. Kiongeze wakati wa kujaza hisa mara ya kwanza.",
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
    "toast.passwordResetOffline": "Hauko mtandaoni, hivyo barua pepe ya kubadilisha nenosiri haiwezi kutumwa. Unganisha kisha ujaribu tena.",
    "toast.passwordResetNeedsEmail": "Andika barua pepe yako kwenye kisanduku hapo juu kwanza, kisha gusa Umesahau nenosiri.",
    "toast.passwordResetFailed": "Barua pepe ya kubadilisha nenosiri haikuweza kutumwa. Angalia muunganisho wako kisha ujaribu tena.",
    "toast.verificationEmailSent": "Barua pepe ya uthibitisho imetumwa. Tafadhali angalia kikasha chako.",
    "toast.verificationEmailFailed": "Imeshindwa kutuma barua pepe ya uthibitisho. Tafadhali jaribu tena baadaye.",
    "toast.emailVerified": "Barua pepe yako imethibitishwa. Asante.",
    "toast.idleSignOut": "Umetolewa nje baada ya muda wa kutotumika.",
    "toast.authTooManyRequests": "Majaribio mengi sana. Tafadhali subiri kidogo kisha ujaribu tena.",
    "toast.consentRequired": "Tafadhali kubali Sheria na Masharti na Sera ya Faragha kabla ya kufungua akaunti.",
    "toast.passwordMismatch": "Manenosiri hayafanani.",
    "toast.outOfStock": "Bidhaa hii haipo kwenye hisa.",
    "toast.selectStoreToSell": "Chagua duka mahususi kufanya mauzo.",
    "services.title": "Huduma",
    "services.eyebrow": "Kazi zenye bei",
    "services.intro": "Vitu unavyouza vyenye bei lakini havina hisa. Vinapigwa kwenye droo pamoja na bidhaa zako, na kuuza kimoja hakubadilishi hesabu ya hisa.",
    "services.addButton": "Ongeza Huduma",
    "services.thName": "Huduma",
    "services.thItem": "Kitu",
    "services.thCategory": "Aina",
    "services.thPrice": "Bei",
    "services.thStatus": "Hali",
    "services.thActions": "Vitendo",
    "services.statusActive": "Iko kwenye droo",
    "services.statusWithdrawn": "Imeondolewa",
    "services.withdrawButton": "Ondoa",
    "services.restoreButton": "Rudisha",
    "services.withdrawConfirm": "Ondoa {name} kwenye droo? Mauzo ya zamani yatabaki nayo, na unaweza kuirudisha wakati wowote.",
    "services.emptyState": "Hakuna kilichowekewa bei bado. Ongeza cha kwanza.",
    "services.dialogAddTitle": "Ongeza kwenye {label}",
    "services.dialogEditTitle": "Hariri {label}",
    "services.nameLabel": "Jina",
    "services.namePlaceholder": "mfano Kusuka",
    "services.nameRequired": "Weka jina.",
    "services.priceLabel": "Bei",
    "services.pricePlaceholder": "mfano 15000",
    "services.categoryLabel": "Aina",
    "services.categoryPlaceholder": "mfano Nywele",
    "services.taxClassLabel": "Aina ya kodi",
    "services.saveButton": "Hifadhi Huduma",
    "toast.serviceAdded": "{name} imeongezwa.",
    "toast.serviceUpdated": "{name} imesasishwa.",
    "toast.serviceWithdrawn": "{name} imeondolewa kwenye droo.",
    "toast.serviceRestored": "{name} imerudishwa kwenye droo.",
    "toast.serviceSaveFailed": "Imeshindwa kuhifadhi. Tafadhali jaribu tena.",
    "services.menuTitle": "Menyu",
    "services.posEmpty": "Hakuna huduma zilizowekewa bei bado.",
    "toast.serviceUnavailable": "Huduma hiyo haipo tena kwenye orodha.",
    "toast.enterPricePerUnit": "Weka bei kwa kila kitengo cha bidhaa hii.",
    "toast.notEnoughStockQty": "Hisa haitoshi kwa kiasi hiki.",
    "toast.cartLimitReached": "Mauzo haya yamefikia kikomo cha bidhaa 40. Kamilisha mauzo haya na uanze mengine.",
    "toast.noMoreStock": "Hakuna hisa zaidi ya bidhaa hii.",
    "toast.invalidPrice": "Bei si sahihi.", "toast.onlyUnitsAvailable": "Vitengo {quantity} tu vinapatikana.",
    "toast.addProductsFirst": "Ongeza bidhaa kwenye kikapu kwanza.",
    "toast.loadingStore": "Duka lako linapakia - tafadhali jaribu tena baada ya muda mfupi.",
    "toast.noStoreAssigned": "Bado hujapangiwa duka. Muombe mmiliki wa biashara akupe ruhusa ya duka kabla ya kuongeza bidhaa.",
    "toast.selectStoreBeforeSale": "Chagua duka mahususi kabla ya kukamilisha mauzo.",
    "toast.cashLessThanTotal": "Fedha zilizolipwa ni chini ya jumla ya mauzo.",
    "toast.saleFailedGeneric": "Mauzo yameshindwa. Angalia hisa tena na ujaribu tena.",
    "toast.saleCompletedChange": "Mauzo yamekamilika. Toa chenji ya {change}.",
    "toast.saleCompleted": "Mauzo yamekamilika na hisa imesasishwa.",
    "toast.saleCompletedServices": "Mauzo yamekamilika.",
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
    "toast.saleHeldUnconfirmed": "Muunganisho haujajibu. Mauzo yamehifadhiwa kwenye kifaa hiki na yatasawazishwa.",
    "toast.saleUnconfirmed": "Muunganisho haujajibu, kwa hiyo mauzo haya hayajathibitishwa. Angalia orodha ya mauzo kabla ya kuyaingiza tena.",
    "offline.unsyncedOne": "Mauzo 1 yamehifadhiwa kwenye kifaa hiki na bado hayajafika kwenye seva. Usiondoe programu hii hadi yasawazishwe.",
    "offline.unsyncedMany": "Mauzo {count} yamehifadhiwa kwenye kifaa hiki na bado hayajafika kwenye seva. Usiondoe programu hii hadi yasawazishwe.",
    "update.readyText": "Toleo jipya la programu lipo tayari. Pakia upya wakati hauko katikati ya mauzo.",
    "update.reloadButton": "Pakia upya sasa",
    "dashboard.vatSettings": "VAT",
    "vat.dialogTitle": "Usajili wa VAT",
    "vat.classStandard": "Kiwango cha kawaida", "vat.classZeroRated": "Kiwango sifuri", "vat.classExempt": "Imesamehewa",
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
    "returns.servicesNotReturnable": "Mauzo haya ni huduma pekee. Huduma haiwezi kurejeshwa ikishatolewa — futa mauzo yote badala yake.",
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
    "movement.subtitle": "Yaliyotokea kwa {name}: iliuzwa kiasi gani, ilihamishwa wapi, na iligharimu kiasi gani.",
    "movement.salesSectionTitle": "Historia ya Mauzo",
    "movement.purchasesSectionTitle": "Zilizonunuliwa / kuongezwa",
    "movement.purchasesSubtitle": "Bidhaa hii iliingia lini, na iligharimu kiasi gani. Mpya kwanza.",
    "movement.colSupplier": "Msambazaji",
    "movement.colTotalPaid": "Jumla iliyolipwa",
    "movement.colEach": "Kila kimoja",
    "movement.colLanded": "kati ya hizo, gharama za ziada",
    "movement.noLanded": "—",
    "movement.noPurchases": "Hakuna kilichorekodiwa bado. Gharama hurekodiwa unapopokea mzigo au kuongeza hisa na bei.",
    "movement.transfersSectionTitle": "Historia ya Uhamishaji",
    "movement.noSalesForProduct": "Hakuna mauzo yaliyorekodiwa kwa bidhaa hii bado.",
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
    "prompt.title": "Weka thamani",
    "prompt.accept": "Sawa",
    "confirm.title": "Una uhakika?",
    "confirm.cancel": "Ghairi",
    "confirm.accept": "Ndiyo, endelea",
    "staff.inviteLinkLabel": "Kiungo cha mwaliko",
    "staff.copyFailedUseLink": "Imeshindwa kunakili yenyewe. Kiungo kimeonyeshwa hapo juu — kinakili kutoka hapo.",
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

// Text that translateStaticDom() must not overwrite.
//
// That function re-applies data-i18n to EVERY element carrying it, so an
// element that is both marked up with a key and written at runtime has two
// authors, and whichever runs last wins. Since translateStaticDom() runs after
// renderAll() on a language change and on a store switch, the runtime value
// lost -- the sidebar told a signed-in owner "Sign in to sync inventory", and
// every dialog title carrying a product or supplier name reverted to its
// generic form.
//
// Reported from the live site as the sidebar line. Eight elements had it.
//
// Pass a key when the text IS a key, and it stays translatable: the translator
// re-applies the same key and agrees with the runtime. Pass none when the text
// is composed -- a title with a name in it cannot be re-derived from a key --
// and the marker is removed so the translator leaves it alone. Such an element
// is rewritten by whatever opens it, so it picks up a language change then.
function setDynamicText(selector, text, i18nKey = null) {
  const el = qs(selector);
  if (!el) return;
  if (i18nKey) el.dataset.i18n = i18nKey;
  else delete el.dataset.i18n;
  el.textContent = text;
}

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
  const input = await askText(t("dialog.overridePasswordPrompt"), { type: "password" });
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

// Which business types sell services at all (DESIGN-services.md §1). A duka or
// a hardware store has stock and nothing else; a salon and a bar have both.
// Per STORE, not per account -- a multi-branch owner may run one salon and one
// duka, and the POS has to change when they switch branches.
const SERVICE_BUSINESS_TYPES = ["salon", "bar"];

function storeSellsServices() {
  return SERVICE_BUSINESS_TYPES.includes(currentBusinessType());
}

// Scoped the same way storeProducts() is, plus withdrawn items dropped. A
// service is deactivated rather than deleted, because sales already reference
// it and deleting would leave that history describing something gone -- so the
// till must filter what it offers, not what exists.
function storeServices() {
  if (!storeSellsServices()) return [];
  if (!state.db) return state.services;
  if (!state.currentStoreId) return [];
  const scoped = state.currentStoreId === "all"
    ? state.services
    : state.services.filter((service) => service.storeId === state.currentStoreId);
  return scoped.filter((service) => service.active !== false);
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
  // Counted from BOTH places a supplier can exist, because there are two and
  // the tile only ever knew about one. Before the suppliers collection existed
  // a supplier was a name typed on a product; now most are real records with a
  // TIN and a balance. Reading only the product field made the dashboard say
  // "Suppliers 0" on the same screen as "You owe suppliers TZS 2,018,836" --
  // found by walking the app on 2026-09-10.
  //
  // The union rather than a swap: the eight shops already live have typed names
  // and no supplier records, and swapping would have taken their count to zero.
  // Matched on the trimmed, lowercased name so a record and a typed name for
  // the same supplier count once.
  const supplierNames = new Set();
  for (const item of products) {
    const name = String(item.supplier || "").trim();
    if (name) supplierNames.add(name.toLowerCase());
  }
  for (const supplier of activeSuppliers()) {
    const name = String(supplier.name || "").trim();
    if (name) supplierNames.add(name.toLowerCase());
  }
  const suppliers = supplierNames.size;

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

  // Spec 11 asks the dashboard for Accounts Receivable and Accounts Payable.
  // Both are owner figures -- one is what the shop is owed, the other what it
  // owes -- and both are STORED running balances rather than sums of the
  // history a client happens to hold, for the reason given in the /suppliers
  // rules. Shown only to an owner, and only once there is something to show:
  // two permanent zeroes on a duka's dashboard are noise.
  if (isOwnerRole()) {
    const receivable = (state.customers || [])
      .reduce((sum, customer) => sum + safeNumber(customer.balanceOwed), 0);
    const payable = (state.suppliers || [])
      .reduce((sum, supplier) => sum + safeNumber(supplier.balanceOwed), 0);
    if (receivable > 0) cards.push([t("kpi.receivable"), money(receivable), t("kpi.receivableDelta")]);
    if (payable > 0) cards.push([t("kpi.payable"), money(payable), t("kpi.payableDelta")]);
  }

  qs("#kpiGrid").innerHTML = cards
    .map(([label, value, delta]) => `<div class="kpi-card"><span class="muted">${label}</span><strong>${value}</strong><span class="delta">${delta}</span></div>`)
    .join("");
}

// Profit over time, bucketed by week, month or year.
//
// This replaced a line chart of stock quantity per product. Stock level is a
// snapshot and a line between two products means nothing -- the slope invited a
// reading ("stock is falling") that the data did not support, because the x axis
// was a list of products, not time. Profit over time is a real series, so a
// chart earns its place, and bars are the honest mark for discrete periods.
//
// NET profit, not gross: "am I making money" is the question a dashboard is
// asked, and gross answers a different one. The caveat DESIGN-purchases.md 11
// attaches to net travels with it -- the panel says the figure is only as
// complete as the expenses entered.
function profitTrendBuckets(period) {
  const now = new Date();
  const buckets = [];
  if (period === "year") {
    for (let i = 4; i >= 0; i--) {
      const y = now.getFullYear() - i;
      buckets.push({ label: String(y), start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) });
    }
  } else if (period === "week") {
    // Weeks run Monday to Monday, which is how a shop talks about a week.
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    for (let i = 7; i >= 0; i--) {
      const start = new Date(monday); start.setDate(start.getDate() - i * 7);
      const end = new Date(start); end.setDate(end.getDate() + 7);
      buckets.push({ label: `${start.getDate()}/${start.getMonth() + 1}`, start, end });
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      buckets.push({ label: start.toLocaleDateString(undefined, { month: "short" }), start, end });
    }
  }
  return buckets;
}

function summariseProfitTrend(period) {
  const buckets = profitTrendBuckets(period);
  const costIndex = buildCostIndex(state.productCostHistory);
  const scopedSales = state.currentStoreId === "all"
    ? (state.sales || [])
    : (state.sales || []).filter((sale) => saleStoreId(sale) === state.currentStoreId);
  const expenses = storeExpenses();

  return buckets.map((bucket) => {
    const from = bucket.start.getTime();
    const to = bucket.end.getTime();
    const sales = scopedSales.filter((sale) => {
      const at = saleTimestamp(sale);
      return at ? at.getTime() >= from && at.getTime() < to : false;
    });
    const takings = summariseSales(sales);
    const goods = summariseCostOfGoods(sales, costIndex);
    const spent = expenses.reduce((sum, expense) => {
      const at = expenseSpentAt(expense);
      return at && at.getTime() >= from && at.getTime() < to ? sum + safeNumber(expense.amount) : sum;
    }, 0);
    return {
      label: bucket.label,
      // Null, not zero, where nothing sold had a recorded cost. Reporting
      // revenue as profit is the defect DESIGN-purchases.md 2 found live on
      // this very screen; a bar drawn from it would put it back.
      net: goods.anyCostKnown ? takings.net - goods.cogs - spent : null,
      hasSales: takings.count > 0,
      costKnown: goods.anyCostKnown
    };
  });
}

function renderChart() {
  const canvas = qs("#salesChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const period = qs("#chartRange")?.value || "month";
  const series = summariseProfitTrend(period);

  const width = canvas.width;
  const height = canvas.height;
  const padLeft = 76;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 52;
  const css = getComputedStyle(document.documentElement);
  const mutedColor = css.getPropertyValue("--muted");
  const lineColor = css.getPropertyValue("--line");

  ctx.clearRect(0, 0, width, height);
  ctx.font = "11px Inter, sans-serif";

  const known = series.filter((b) => b.net !== null).map((b) => b.net);
  if (!known.length) {
    ctx.fillStyle = mutedColor;
    ctx.font = "15px Inter, sans-serif";
    ctx.fillText(t("chart.profitEmpty"), padLeft, height / 2);
    return;
  }

  // A LOSS IS A BAR BELOW THE LINE, not a clipped one. The old chart assumed
  // every value was positive, which is true of a stock count and false of a
  // profit -- so the scale is built from both ends and zero is always on it.
  const rawMax = Math.max(...known, 0);
  const rawMin = Math.min(...known, 0);
  const span = (rawMax - rawMin) || 1;
  const max = rawMax + span * 0.12;
  const min = rawMin - (rawMin < 0 ? span * 0.12 : 0);
  const plotTop = padTop;
  const plotBottom = height - padBottom;
  const yFor = (v) => plotBottom - ((v - min) / (max - min)) * (plotBottom - plotTop);
  const zeroY = yFor(0);

  const gridLines = 5;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1;
  for (let i = 0; i < gridLines; i += 1) {
    const value = max - ((max - min) / (gridLines - 1)) * i;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(width - padRight, y);
    ctx.stroke();
    ctx.fillStyle = mutedColor;
    ctx.textAlign = "right";
    ctx.fillText(compactMoney(value), padLeft - 8, y + 4);
  }

  // The zero line, drawn heavier than the grid: on a chart that can go negative
  // it is the only line that means anything on its own.
  ctx.beginPath();
  ctx.moveTo(padLeft, zeroY);
  ctx.lineTo(width - padRight, zeroY);
  ctx.strokeStyle = mutedColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineWidth = 1;

  const slot = (width - padLeft - padRight) / series.length;
  const barWidth = Math.min(slot * 0.62, 46);

  series.forEach((bucket, index) => {
    const cx = padLeft + slot * index + slot / 2;
    ctx.textAlign = "center";

    if (bucket.net === null) {
      // Nothing sold, or nothing sold with a known cost. An empty slot with its
      // label, never a zero bar -- a zero bar says "no profit", which is a
      // different statement from "we cannot tell".
      ctx.fillStyle = mutedColor;
      ctx.globalAlpha = 0.5;
      ctx.fillText(bucket.hasSales ? t("chart.noCost") : "–", cx, zeroY - 6);
      ctx.globalAlpha = 1;
    } else {
      const y = yFor(bucket.net);
      const top = Math.min(y, zeroY);
      const barHeight = Math.max(Math.abs(y - zeroY), 1);
      ctx.fillStyle = bucket.net < 0 ? "#ef6666" : "#46c2a1";
      ctx.beginPath();
      ctx.roundRect(cx - barWidth / 2, top, barWidth, barHeight, 4);
      ctx.fill();
    }

    ctx.fillStyle = mutedColor;
    ctx.textAlign = "center";
    ctx.fillText(bucket.label, cx, height - padBottom + 18);
  });
  ctx.textAlign = "left";
}

// Axis labels on a money chart: 1,200,000 in a 60px gutter is unreadable, and
// the exact figure is on the Profit Report anyway. The axis is for shape.
function compactMoney(value) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1000000) return `${sign}${(abs / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}k`;
  return `${sign}${Math.round(abs)}`;
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
      units: Math.abs(Math.round(worst.result.gap)),
      unit: t(Math.abs(Math.round(worst.result.gap)) === 1 ? "toast.unitSingular" : "toast.unitPlural")
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
          ${isManagerOrOwnerRole() ? `<button class="ghost-button compact" data-adjust-product="${product.id}">${t("adjust.action")}</button>` : ""}
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
    // The message already says a filter is hiding the stock. This makes it
    // possible to do something about it in one press.
    //
    // Worth the extra control because of how this failed in the field: Chrome
    // autofilled an email address into the product search, the table went
    // empty, and the shop concluded their inventory had not saved. The text
    // alone was there and was not enough -- nobody connects a stray value in a
    // search box with a table that looks broken.
    .join("") || `<tr><td colspan="8" class="empty-state">${esc(inventoryEmptyMessage())}${
      inventoryFiltersActive()
        ? ` <button class="link-button" type="button" id="clearInventoryFilters">${esc(t("inventory.clearFilters"))}</button>`
        : ""
    }</td></tr>`;
}

function renderPosProducts() {
  const term = qs("#posSearch").value.trim().toLowerCase();
  // Spec 4.1. A discontinued line stays in inventory, in reports and on the
  // purchases already made, but stops being offered for sale. `active` is
  // absent on every product that predates the field, so ABSENT MUST READ AS
  // ACTIVE -- the other way round empties the till for all eight live shops.
  const products = storeProducts()
    .filter((product) => product.active !== false)
    .filter((product) => !term || [product.name, product.category, product.brand, product.supplier].join(" ").toLowerCase().includes(term));
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

  renderPosServices(term);
}

// Services in the same till panel as stock, because a bar rings up a beer and a
// plate of food on one bill and should not have to look in two places for them.
// Appended rather than merged into one sorted list: they are priced and sold
// the same way but they are not the same kind of thing, and a cashier scanning
// for "Braiding" among bottles is helped by the split.
//
// Empty for every business type that does not sell services, which is the
// common case -- storeServices() returns [] and this renders nothing at all.
function renderPosServices(term) {
  const panel = qs("#posServices");
  const list = qs("#posServicesList");
  if (!panel || !list) return;

  const services = storeServices().filter((service) =>
    !term || [service.name, service.category].join(" ").toLowerCase().includes(term));

  // Hidden entirely rather than shown empty: a duka has no use for the heading,
  // and a salon with no menu yet is told so by the Services tab, not here.
  panel.hidden = !storeSellsServices();
  if (panel.hidden) return;

  qs("#posServicesTitle").textContent = t(serviceLabelKey());
  list.innerHTML = services
    .slice(0, 8)
    .map((service) => `<div class="pos-product">
      <strong>${esc(service.name)}</strong>
      <span class="muted">${esc(service.category || "-")} - ${money(service.price)}</span>
      <div class="pos-product-controls">
        <input type="number" min="1" value="1" class="pos-qty-input" data-service-qty-input="${esc(service.id)}" aria-label="${esc(t("pos.qtyAriaLabel", { name: service.name }))}" />
        <button class="ghost-button compact" data-add-service="${esc(service.id)}" type="button">${t("pos.addButton")}</button>
      </div>
    </div>`)
    .join("") || `<p class="muted">${esc(t("services.posEmpty"))}</p>`;
}

// "Services" for a salon, "Menu" for a bar. The same list either way -- only
// the word differs, the way CATEGORY_TEMPLATES already varies by business type.
function serviceLabelKey() {
  return currentBusinessType() === "bar" ? "services.menuTitle" : "services.title";
}

// Suggested categories, the way CATEGORY_TEMPLATES does it for stock. A bar
// groups a menu by course and a salon by the kind of work, and neither wants
// the other's list.
const SERVICE_CATEGORY_TEMPLATES = {
  bar: ["Mains", "Grills", "Sides", "Breakfast", "Drinks", "Desserts"],
  salon: ["Hair", "Braiding", "Nails", "Skin & facial", "Barbering", "Massage"]
};

// The tab, and the screen behind it.
//
// Gated per STORE rather than per account: businessType lives on the store
// document, so an owner running a salon and a duka must see the tab appear and
// disappear as they switch branches. That is why this runs from renderAll()
// rather than once at sign-in.
//
// "Hide, don't disable", the same convention applyStoreOwnerControlsVisibility()
// uses -- a duka owner is never shown a tab that would only tell them their
// business type is wrong.
function renderServices() {
  const nav = qs("#servicesNavItem");
  const view = qs("#services");
  if (!nav || !view) return;

  const sells = storeSellsServices();
  // Managers and owners only, matching every other stock-editing surface.
  // canOpenView() is the real gate; this keeps the nav honest about it.
  nav.hidden = !sells || !isManagerOrOwnerRole();

  // A tab that vanishes under the person standing on it would leave them on a
  // blank screen. Send them somewhere real instead.
  if (nav.hidden && view.classList.contains("active")) openView("dashboard");
  if (nav.hidden) return;

  // Writes are owner-only in firestore.rules (allow create/update: isOwner).
  // A manager still sees the list -- knowing the menu is part of running the
  // floor -- but not a control that would be refused. Exactly what
  // renderInventory() does with Edit and Delete on a product row.
  const canEdit = isOwnerRole();
  const addButton = qs("#servicesAddButton");
  if (addButton) addButton.hidden = !canEdit;

  const label = t(serviceLabelKey());
  // The LABEL span, not the button. The nav item carries an inline SVG icon as
  // its first child, and assigning textContent on the button would erase it --
  // the same hazard translateStaticDom() has, which is why every other nav item
  // keeps its data-i18n key on an inner span rather than on the button.
  const navLabel = qs("#servicesNavLabel") || nav;
  navLabel.textContent = label;
  qs("#servicesTitle").textContent = label;
  setDynamicText("#servicesThName", label === t("services.menuTitle")
    ? t("services.thItem")
    : t("services.thName"));

  const rows = storeServicesForEditing();
  qs("#servicesTable").innerHTML = rows
    .map((service) => `<tr>
      <td>${esc(service.name || "")}</td>
      <td>${esc(service.category || "-")}</td>
      <td>${money(service.price)}</td>
      <td><span class="status ${service.active === false ? "out" : "healthy"}">${
        service.active === false ? esc(t("services.statusWithdrawn")) : esc(t("services.statusActive"))
      }</span></td>
      <td class="table-actions">${canEdit ? `
        <button class="ghost-button compact" data-edit-service="${esc(service.id)}">${t("inventory.edit")}</button>
        <button class="ghost-button compact${service.active === false ? "" : " danger"}" data-toggle-service="${esc(service.id)}">${
          service.active === false ? t("services.restoreButton") : t("services.withdrawButton")
        }</button>` : ""}
      </td>
    </tr>`)
    .join("") || `<tr><td colspan="5" class="empty-state">${esc(t("services.emptyState"))}</td></tr>`;
}

// The editing list, which is NOT storeServices(): that one drops withdrawn
// items because the till must not offer them, and this screen is the one place
// they have to remain visible or they could never be brought back.
function storeServicesForEditing() {
  if (!state.currentStoreId) return [];
  const scoped = state.currentStoreId === "all"
    ? state.services
    : state.services.filter((service) => service.storeId === state.currentStoreId);
  return [...scoped].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

function openServiceDialog(service = null) {
  const form = qs("#serviceForm");
  form.reset();
  form.elements.id.value = service?.id || "";
  form.elements.name.value = service?.name || "";
  form.elements.price.value = service?.price ?? "";
  form.elements.category.value = service?.category || "";

  const label = t(serviceLabelKey());
  qs("#serviceDialogTitle").textContent = service
    ? t("services.dialogEditTitle", { label })
    : t("services.dialogAddTitle", { label });

  populateServiceCategorySuggestions();

  // Same rule the product form follows: a shop that is not registered is never
  // asked to classify anything, and the select does not submit a taxClass it
  // was never shown.
  const taxRow = qs("#serviceTaxClassRow");
  const registered = vatSettings().registered;
  taxRow.hidden = !registered;
  if (registered) form.elements.taxClass.value = service?.taxClass || "standard";

  qs("#serviceNameError").textContent = "";
  qs("#servicePriceError").textContent = "";
  qs("#serviceDialog").showModal();
}

function populateServiceCategorySuggestions() {
  const list = qs("#serviceCategorySuggestions");
  if (!list) return;
  const template = SERVICE_CATEGORY_TEMPLATES[currentBusinessType()] || [];
  // What the shop already uses comes first: a category they typed themselves
  // is a better suggestion than one we guessed for their trade.
  const used = state.services.map((service) => service.category).filter(Boolean);
  const seen = new Set();
  const options = [...used, ...template].filter((name) => {
    const key = String(name).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  list.innerHTML = options.map((name) => `<option value="${esc(name)}"></option>`).join("");
}

async function saveService(input) {
  // "all stores" cannot own a document. Same refusal saveProduct() makes, and
  // for the same reason: the record has to name one branch.
  if (!input.id && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreBeforeAdd"));
    return;
  }
  if (!input.id && !state.currentStoreId) {
    showToast(t("toast.loadingStore"));
    return;
  }
  if (!state.db || !state.user || !state.businessOwnerUid) {
    showToast(t("toast.signInToAddStore"));
    return;
  }

  const existing = input.id ? state.services.find((item) => item.id === input.id) : null;
  const name = String(input.name || "").trim().slice(0, 120);
  const price = clampNonNegativeNumber(input.price, MAX_MONEY);
  if (!name) {
    qs("#serviceNameError").textContent = t("services.nameRequired");
    return;
  }
  if (price === null) {
    qs("#servicePriceError").textContent = t("toast.numberOutOfRange", {
      field: t("services.priceLabel"), max: MAX_MONEY.toLocaleString()
    });
    return;
  }

  const saveButton = qs("#saveServiceButton");
  if (saveButton.disabled) return;
  saveButton.disabled = true;

  try {
    const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    const id = existing?.id || doc(collection(state.db, "users", state.businessOwnerUid, "services")).id;
    const payload = {
      id,
      name,
      price,
      category: String(input.category || "").trim().slice(0, 60),
      // An existing service keeps the branch it was created in. Moving one
      // between branches is not a thing this screen offers, and letting the
      // current store silently rewrite it would move a menu item by accident.
      storeId: existing?.storeId || state.currentStoreId,
      active: existing ? existing.active !== false : true,
      updatedAt: serverTimestamp(),
      ...(existing ? {} : { createdAt: serverTimestamp() }),
      ...(vatSettings().registered ? { taxClass: input.taxClass || "standard" } : {})
    };
    await setDoc(doc(state.db, "users", state.businessOwnerUid, "services", id), payload, { merge: true });
    qs("#serviceDialog").close();
    showToast(t(existing ? "toast.serviceUpdated" : "toast.serviceAdded", { name }));
  } catch (error) {
    console.warn(error);
    showToast(describeOperationError(error, "toast.serviceSaveFailed"));
  } finally {
    saveButton.disabled = false;
  }
}

// Withdrawn, never deleted. Sales already reference this document by name and
// price, and deleting it would leave that history describing something gone --
// the same reason a product is archived rather than removed. A withdrawn
// service disappears from the till and stays on this screen so it can come
// back.
async function toggleServiceActive(serviceId) {
  const service = state.services.find((item) => item.id === serviceId);
  if (!service) return;
  if (!state.db || !state.user || !state.businessOwnerUid) return;

  const nextActive = service.active === false;
  if (!nextActive && !await askConfirm(t("services.withdrawConfirm", { name: service.name || "" }))) return;

  try {
    const { doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    await setDoc(
      doc(state.db, "users", state.businessOwnerUid, "services", serviceId),
      { active: nextActive, updatedAt: serverTimestamp() },
      { merge: true }
    );
    showToast(t(nextActive ? "toast.serviceRestored" : "toast.serviceWithdrawn", { name: service.name || "" }));
  } catch (error) {
    console.warn(error);
    showToast(describeOperationError(error, "toast.serviceSaveFailed"));
  }
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
      // A service has no ceiling -- there is no shelf to run out of. Without
      // this the max attribute falls back to the current qty and the input
      // refuses to go past 1, so a bar could not ring up two of the same dish.
      const maxQty = isServiceLine(item) ? "" : (product ? product.quantity : item.qty);
      return `<div class="cart-item">
        <div class="cart-item-info">
          <strong>${esc(item.name)}</strong>
          <span class="muted">${money(item.sellingPrice)} each
            ${item.priceType !== "dynamic" ? `<button class="link-button" data-edit-price="${item.id}" type="button">${t("cart.editPrice")}</button>` : ""}
          </span>
        </div>
        <div class="cart-item-controls">
          <button class="ghost-button compact" data-decrease-cart="${item.id}" type="button" aria-label="${esc(t("cart.decreaseAriaLabel"))}">-</button>
          <input type="number" min="1" ${maxQty === "" ? "" : `max="${maxQty}"`} value="${item.qty}" class="cart-qty-input" data-qty-edit="${item.id}" aria-label="${esc(t("cart.qtyAriaLabel", { name: item.name }))}" />
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
    t(metrics.transactionCount === 1 ? "monthlyReport.revenueLineOne" : "monthlyReport.revenueLine",
      { period: monthKey, revenue: moneyForStore(Math.round(metrics.revenue), storeId), count: metrics.transactionCount }),
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
  setReportRoleVisibility(panel, !vatSettings().registered);
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

// Docx section 12: Sales by Product. The one report on that list that existed
// nowhere, and the most actionable a shop has -- what actually sells is what
// decides what to buy again.
//
// Deliberately NOT a margin report. The Profit Report's drill-down already shows
// cost against price per product and is owner-strict for exactly that reason;
// this is units and revenue, which a manager may see and act on. Keeping cost
// out is what lets this panel sit on a screen managers can open.
//
// Returns are netted the same way summariseCostOfGoods() nets them -- a product
// that was sold and then brought back did not sell. The map is consumed rather
// than read, because it totals per product across the sale.
function summariseSalesByProduct(sales) {
  const rows = new Map();
  for (const sale of sales || []) {
    if (sale.voided) continue;
    const returnedRemaining = saleReturnedQtyMap(sale);
    for (const item of sale.items || []) {
      // Services sell too, and a salon wants them in this list -- so unlike the
      // costing surfaces this one keeps them, and says which is which.
      const key = isServiceLine(item) ? `s:${item.serviceId}` : `p:${item.productId}`;
      if (key === "s:undefined" || key === "p:undefined") continue;
      const soldQty = safeNumber(item.qty);
      const outstanding = safeNumber(returnedRemaining.get(item.productId));
      const returnedHere = Math.min(soldQty, outstanding);
      if (returnedHere > 0) returnedRemaining.set(item.productId, outstanding - returnedHere);
      const qty = soldQty - returnedHere;
      if (qty <= 0) continue;
      const row = rows.get(key) || {
        key, name: String(item.name || "").slice(0, 120),
        isService: isServiceLine(item), units: 0, revenue: 0, orders: 0
      };
      row.units += qty;
      row.revenue += safeNumber(item.lineTotal) * (soldQty > 0 ? qty / soldQty : 0);
      row.orders += 1;
      rows.set(key, row);
    }
  }
  const list = [...rows.values()];
  // By revenue, not by units. A shop deciding what to restock cares which lines
  // bring the money in; ordering by units puts the cheapest thing on the shelf
  // at the top of every list.
  list.sort((a, b) => b.revenue - a.revenue || b.units - a.units);
  return {
    rows: list,
    totalUnits: list.reduce((sum, r) => sum + r.units, 0),
    totalRevenue: list.reduce((sum, r) => sum + r.revenue, 0)
  };
}

function renderSalesByProduct() {
  const table = qs("#salesByProductTable");
  const note = qs("#salesByProductNote");
  if (!table || !note) return;
  // Manager and owner. Units and revenue only -- no cost, so this widens no
  // disclosure over the sales figures those roles already read.
  if (!isManagerOrOwnerRole()) {
    table.innerHTML = "";
    note.textContent = "";
    return;
  }

  // The same range the payment report above it uses, so the two panels always
  // describe the same period. A report that quietly used a different window
  // from the one on screen is worse than no report.
  const summary = summariseSalesByProduct(filteredSales());
  if (!summary.rows.length) {
    table.innerHTML = `<tr><td colspan="4" class="muted">${esc(t("reports.sbpEmpty"))}</td></tr>`;
    note.textContent = "";
    return;
  }

  table.innerHTML = summary.rows.map((row) => `<tr>
    <td>${esc(row.name)}${row.isService ? ` <span class="muted">${esc(t("reports.sbpService"))}</span>` : ""}</td>
    <td>${row.units}</td>
    <td>${row.orders}</td>
    <td><strong>${money(row.revenue)}</strong></td>
  </tr>`).join("") + `<tr class="statement-total">
    <td>${esc(t("profit.pdTotal"))}</td>
    <td>${summary.totalUnits}</td>
    <td></td>
    <td>${money(summary.totalRevenue)}</td>
  </tr>`;
  note.textContent = t("reports.sbpNote");
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
  renderSalesByProduct();
  renderVatReport();
  renderStaffOrderLookupSelect();
  renderCustomerAccounts();
  renderSuppliers();
  renderSpecReports();
  // Last, so it narrows a decision the role gate has already made.
  applyReportSelection();
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
  // Stated, not inferred. The Reports chooser lists this one only when an
  // outage actually put something in it, and the empty state is a sentence --
  // so "does it have text" answered yes on a permanently empty report.
  const panel = qs("#offlineSalesPanel");
  if (panel) panel.dataset.reportEmpty = rows.length ? "0" : "1";

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
      byStaff.set(key, { staffName: sale.staffName || t("report.none"), cash: 0, mobile: 0, card: 0, bank: 0, collected: 0, net: 0, orders: 0 });
    }
    const entry = byStaff.get(key);
    // Two different questions, and collapsing them into one "Total" column was
    // read as an arithmetic error: the row's total counted the whole value of a
    // credit sale while its cash/mobile/card columns held only the deposit, so
    // the row visibly did not add up. It is a real distinction -- sold is not
    // collected -- so it is now two columns rather than one ambiguous number.
    for (const method of ["cash", "mobile", "card", "bank"]) {
      entry[method] += saleAmountForMethod(sale, method);
    }
    // Every method the till offers, or money taken by the one left out simply
    // stops appearing in Collected -- which reads as a staff member who sold
    // and banked nothing.
    entry.collected = entry.cash + entry.mobile + entry.card + entry.bank;
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
      bank: acc.bank + row.bank,
      collected: acc.collected + row.collected,
      net: acc.net + row.net,
      orders: acc.orders + row.orders
    }),
    { cash: 0, mobile: 0, card: 0, bank: 0, collected: 0, net: 0, orders: 0 }
  );

  const bodyRows = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.staffName)}</td>
        <td>${money(row.cash)}</td>
        <td>${money(row.mobile)}</td>
        <td>${money(row.card)}</td>
        <td>${money(row.bank)}</td>
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
        <td><strong>${money(totals.bank)}</strong></td>
        <td><strong>${money(totals.collected)}</strong></td>
        <td><strong>${money(totals.net)}</strong></td>
        <td><strong>${totals.orders}</strong></td>
      </tr>`
    : "";

  tbody.innerHTML = bodyRows + totalRow || `<tr><td colspan="8" class="empty-state">${t("cart.empty")}</td></tr>`;
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

// What a manager may give back, which is goods and only goods.
//
// Service lines are filtered out here rather than at either call site, because
// both the dialog and confirmProcessReturn() read this and a filter applied to
// only one of them would let a service be selected and then silently dropped,
// or refunded with nothing recorded against it.
//
// Not a technical limit -- a decision, taken in DESIGN-services.md §6. "Return
// three of the ten screws" is a real shelf movement. "Return one haircut" is
// not: the service already happened, and what the customer is owed is a refund
// or a goodwill discount, both of which already exist as their own paths. A
// whole-sale void still covers the case where the wrong thing was rung up.
//
// Before this, a service line was tolerated by accident: the transaction's
// productSnaps loop skips a document that does not exist, so the refund total
// counted the service while nothing was restored. Accidental tolerance is not
// the same as a decision, and it reads identically until the day it does not.
function saleReturnableItems(sale) {
  const returnedMap = saleReturnedQtyMap(sale);
  return (sale.items || [])
    .filter((item) => !isServiceLine(item))
    .map((item) => {
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
    // Two different reasons for an empty list, and they must not share a
    // sentence. "Already returned" is true of a sale whose goods have all been
    // given back; said of a services-only sale it is simply false -- nothing
    // was returned, and nothing can be. The same distinction the inventory
    // empty state draws between "no stock" and "a filter is hiding it".
    : `<p class="muted">${t((sale.items || []).some((item) => !isServiceLine(item))
        ? "returns.noItemsSelected"
        : "returns.servicesNotReturnable")}</p>`;
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
        // No service filter here, and that is load-bearing rather than an
        // omission: `selections` is built only from saleReturnableItems(), which
        // drops service lines before a manager can select one. If that filter
        // ever moves or narrows, this line starts building products/undefined
        // again -- so the invariant is asserted in tests/services-sale-path,
        // not merely relied upon.
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

// The model replies in Markdown, and this used to go straight to innerHTML as
// esc(content) with newlines swapped for <br>. That escaped it safely and broke
// the lines, but rendered none of it -- so every answer arrived carrying a
// literal "## ", "### ", "**bold**" and "---" on screen.
//
// The ordering below is the safety property and must not be rearranged: esc()
// runs FIRST, so anything the model returns is inert text by the time this
// function looks at it, and the only tags in the output are ones written here.
// Converting first and escaping after would escape our own markup; skipping
// esc() would put model output into innerHTML, which is the whole reason it was
// on that line to begin with.
//
// Deliberately a small subset -- headings, bold, italic, inline code, bullet
// and numbered lists, horizontal rules. No links and no images: a model-supplied
// href is a phishing vector on a page that holds a shop's till.
function renderChatMarkdown(text) {
  const inline = (value) => value
    .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  const out = [];
  let list = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (kind) => { if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; } };

  for (const rawLine of esc(String(text ?? "")).split("\n")) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { closeList(); out.push("<hr>"); continue; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); out.push(`<div class="chat-heading">${inline(heading[2])}</div>`); continue; }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) { openList("ul"); out.push(`<li>${inline(bullet[1])}</li>`); continue; }
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    if (numbered) { openList("ol"); out.push(`<li>${inline(numbered[1])}</li>`); continue; }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

function renderChatLog() {
  const container = qs("#aiAnswer");
  if (!state.chatHistory.length) {
    container.innerHTML = `<p class="muted">${t("chat.emptyState")}</p>`;
    return;
  }
  container.innerHTML = state.chatHistory
    .map((message) => `<div class="chat-bubble ${message.role}">${renderChatMarkdown(message.content)}</div>`)
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
  // Say so rather than doing nothing. A button that silently ignores you reads
  // as broken, and the next thing someone does is press it again.
  if (!question) {
    showToast(t("toast.aiQuestionEmpty"));
    qs("#aiQuestion").focus();
    return;
  }
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
  // connection, that is the only fact the operator can act on. Asks
  // isOfflineNow() rather than navigator.onLine directly, so a cashier on dead
  // shop wifi is told "no internet" instead of "unavailable" -- the browser
  // still calls that state online.
  if (isOfflineNow()) return t("error.offline");
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
  window.addEventListener("online", syncConnectionState);
  window.addEventListener("offline", syncConnectionState);
  syncConnectionState();
}

function syncConnectionState() {
  state.online = !isOfflineNow();
  renderOfflineBanner();
  renderUnsyncedSalesBanner();
}

// Firestore tells every snapshot whether it came from the server or from the
// local cache, and metadata.fromCache is precisely "am I in touch with the
// backend". One document is enough to hear it: the signed-in user's own
// profile, which every role may read (firestore.rules: `allow read: if
// isOwner(userId)`) and which ensureUserProfile() has already created.
//
// includeMetadataChanges is the point of the listener. Without it the callback
// only fires when the DATA changes, and a connection dropping changes no data
// -- the till would not learn it had gone offline until something happened to
// be written, which offline is exactly when nothing is.
//
// Deliberately one-way until proven. The flag starts null and only reaches
// `false` once a live connection has been SEEN and then lost. A snapshot
// served from cache in the first seconds after load is ordinary startup, not
// an outage, and treating it as one would be its own bug: cash sales queued
// that could have been transacted against a real stock check, and credit sales
// refused with "cash only" on a perfectly good connection. An outage we notice
// a moment late costs nothing; a phantom outage costs a sale.
function watchServerConnection() {
  if (!state.db || !state.user) return;
  if (state.unsubscribeConnection) state.unsubscribeConnection();

  const { doc, onSnapshot } = state.firebaseApi.firestore;
  const profileRef = doc(state.db, "users", state.user.uid);

  state.unsubscribeConnection = onSnapshot(
    profileRef,
    { includeMetadataChanges: true },
    (snapshot) => {
      if (!snapshot.metadata.fromCache) {
        state.serverReachable = true;
      } else if (state.serverReachable === true) {
        state.serverReachable = false;
      } else {
        return;
      }
      syncConnectionState();
    },
    (error) => {
      // A denied or broken listener must not be read as an outage -- that
      // would refuse credit sales for the rest of the session over a rules
      // problem. Fall back to navigator.onLine by returning to "unknown".
      console.warn("Could not watch the database connection; falling back to navigator.onLine.", error);
      state.serverReachable = null;
      syncConnectionState();
    }
  );
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

// A backup older than this is treated as stale. A month is a judgement, not a
// standard: it is short enough that a shop losing everything loses weeks rather
// than a year, and long enough that the warning does not become wallpaper.
const BACKUP_STALE_AFTER_DAYS = 30;

// What Settings says about the one recovery path this plan has. NEVER is called
// out separately from OLD, because they are different conversations: a shop
// with no backup at all needs a phone call, a shop with a stale one needs a
// reminder.
function renderLastBackup() {
  const line = qs("#lastBackupLine");
  if (!line) return;
  if (!isOwnerRole()) { line.hidden = true; return; }
  line.hidden = false;

  const at = state.cachedProfile?.lastBackupAt;
  const taken = at instanceof Date ? at : (at?.toDate?.() || null);
  if (!taken || Number.isNaN(taken.getTime())) {
    line.textContent = t("backup.never");
    line.className = "muted cell-warn";
    return;
  }
  const days = Math.floor((Date.now() - taken.getTime()) / 86400000);
  line.className = days > BACKUP_STALE_AFTER_DAYS ? "muted cell-warn" : "muted";
  line.textContent = days > BACKUP_STALE_AFTER_DAYS
    ? t("backup.stale", { date: taken.toLocaleDateString(), days: String(days) })
    : t("backup.last", { date: taken.toLocaleDateString() });
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
    // EVERY tenant collection except errorLog. This list has now drifted twice:
    // members and shifts were missing once, and by 2026-09-10 it had fallen nine
    // behind -- every collection added since. A business restored from that
    // backup came back with no purchases, no expenses, no supplier balances and,
    // worst of all, no productCosts: COGS is resolved from that collection, so
    // the Profit Report would have had nothing to work from and every margin in
    // the business would have read as unknown.
    //
    // tests/backup-completeness.test.mjs now derives the collections from
    // firestore.rules and fails when one is missing here, so the next addition
    // cannot drift the same way.
    //
    // errorLog is deliberately absent: it is diagnostic, not business data, and
    // restoring last month's faults would help nobody.
    const rootCollections = ["products", "sales", "stores", "staff", "members", "shifts",
                             "customers", "transfers", "auditLogs", "monthlyReports",
                             "purchases", "expenses", "deliveries", "suppliers",
                             "purchaseReturns", "productCosts", "productCostHistory",
                             "stockMovements", "services"];
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

    // Supplier payments live under each supplier, exactly as customer payments
    // live under each customer. Without them a restored business knows what it
    // owes but not a shilling of what it has already paid.
    const supplierPayments = await Promise.all(
      (collections.suppliers || []).map(async (supplier) => {
        const payments = await getDocs(collection(state.db, "users", state.user.uid, "suppliers", supplier.id, "payments"));
        return [supplier.id, payments.docs.map((docSnap) => ({ id: docSnap.id, data: backupSerializable(docSnap.data()) }))];
      })
    );

    const backup = {
      // Bumped: a version 2 file has none of the cost, purchase or supplier
      // collections, so anything restoring one has to know it is incomplete
      // rather than assume those collections were simply empty.
      schemaVersion: 3,
      application: "SaviaSmart ERP",
      exportedAt: new Date().toISOString(),
      accountUid: state.user.uid,
      profile: profileSnap.exists() ? backupSerializable(profileSnap.data()) : null,
      collections,
      customerPayments: Object.fromEntries(customerPayments),
      supplierPayments: Object.fromEntries(supplierPayments)
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `savia-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(t("toast.backupDownloaded"));

    // Recorded only AFTER the file has been handed to the browser. Stamping it
    // earlier would mark a backup that a failed export never produced, and a
    // shop would then be told it was covered when it was not -- which is worse
    // than no record at all.
    //
    // Two writes on purpose. The audit entry is the trail; the stamp on the
    // profile is what Settings and any support query can read without trawling
    // the log. Neither is allowed to fail the download that has already
    // succeeded, so both are caught separately.
    try {
      const { serverTimestamp, setDoc: setProfile } = state.firebaseApi.firestore;
      const documentCount = Object.values(collections).reduce((sum, list) => sum + list.length, 0);
      await Promise.all([
        setProfile(doc(state.db, "users", state.user.uid),
          { lastBackupAt: serverTimestamp() }, { merge: true }),
        setProfile(doc(collection(state.db, "users", state.user.uid, "auditLogs")),
          { action: "BACKUP_DOWNLOADED", uid: state.user.uid,
            itemCount: documentCount, createdAt: serverTimestamp() })
      ]);
      state.cachedProfile = { ...(state.cachedProfile || {}), lastBackupAt: new Date() };
      updateAuthUi();
    } catch (stampError) {
      // The backup itself is on the owner's device and is what matters.
      console.warn("Backup taken, but the record of it could not be written.", stampError);
    }
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

// Services, scoped exactly like products (DESIGN-services.md Phase B).
//
// Subscribed for every business type, not only bar/salon. The gating is a
// display decision -- storeSellsServices() -- and putting it here instead would
// mean a multi-branch owner switching from a duka to their salon would need a
// resubscribe to see the menu, on the one screen where a pause is least
// affordable. An empty collection costs one listener and no documents.
// ---------------------------------------------------------------------------
// Expenses -- DESIGN-purchases.md phase A.
//
// Running costs, not stock purchases: rent, power, transport, wages, repairs.
// A plain create with no read, so it queues offline like any other write with
// no extra machinery -- a shop pays a boda with no signal.
//
// Owner and manager write; a cashier neither reads nor writes, because these
// feed net profit and wages is a category. Corrections are the owner's: an
// expense is a book entry, and letting whoever wrote it silently rewrite the
// amount removes the control the collection exists to provide.
// Two years. Long enough for any real correction, short enough that a mis-keyed
// year is caught at the point of entry rather than discovered as a hole in a
// period report.
const EXPENSE_BACKDATE_LIMIT_DAYS = 730;

// Longer than the sale path's 10s: a restock is a bigger transaction (up to
// four documents) and it is not on the critical path of a customer standing
// at the till, so it can afford to wait a little longer before giving up.
const RESTOCK_TRANSACTION_TIMEOUT_MS = 15000;

// The last three arrived with DESIGN-landed-costs.md 5. The docx section 11
// names sales commission, delivery related to a sale, and sales packaging as
// DIRECT operating expenses, and until phase 5 they had nowhere to go but
// 'other' -- the one category no report can act on.
const EXPENSE_CATEGORIES = ["rent", "utilities", "wages", "transport",
                            "supplies", "repairs", "licences", "marketing", "other",
                            "commission", "delivery", "packaging"];

// What each category is, before anyone overrides it.
//
// Every category that existed before phase 5 defaults to 'indirect', which is
// why an expense with no `nature` at all can be read as indirect with no risk:
// absent and stored agree on the whole of the history. The three new ones are
// direct because that is the only reason they exist.
//
// `transport` and `wages` are the genuinely ambiguous pair -- a boda delivering
// a customer's order is direct and a boda to the bank is not; a sales commission
// is direct and an office salary is not -- and they default to indirect because
// that is the safer half of the guess: the docx section 9 statement subtracts
// both lines from gross profit, so the split is presentational either way, and
// indirect is the reading that does not claim a cost was attributable when
// nobody said so.
const EXPENSE_NATURE_BY_CATEGORY = {
  rent: "indirect", utilities: "indirect", wages: "indirect", transport: "indirect",
  supplies: "indirect", repairs: "indirect", licences: "indirect",
  marketing: "indirect", other: "indirect",
  commission: "direct", delivery: "direct", packaging: "direct"
};

// Direct or indirect, for an expense that may predate the field entirely.
//
// A stored value wins; anything else falls back to the category's default. Not
// a bare "indirect" fallback: those agree today, because every pre-phase-5
// category defaults to indirect -- but they would stop agreeing the moment a
// direct-by-default category is added, and the version that reads the map is the
// one that stays correct.
function expenseNature(expense) {
  const stored = expense?.nature;
  if (stored === "direct" || stored === "indirect") return stored;
  return EXPENSE_NATURE_BY_CATEGORY[expense?.category] || "indirect";
}

function expenseNatureLabel(nature) {
  return t(nature === "direct" ? "expenses.natureDirect" : "expenses.natureIndirect");
}

function expenseCategoryLabel(category) {
  const key = `cat.${category}`;
  const label = t(key);
  // t() falls back to the key itself, which would print "cat.rent" in a table
  // cell. A category from a future build this client does not know about is
  // shown raw rather than as a translation key.
  return label === key ? String(category || "") : label;
}

// spentAt is a Firestore timestamp once the write lands, but it is a plain Date
// for the moment the local echo of an offline write is on screen. Both have to
// render, or an expense recorded with no signal shows a blank date until sync.
function expenseSpentAt(expense) {
  const at = expense?.spentAt;
  if (at?.toDate) return at.toDate();
  if (at instanceof Date) return at;
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function storeExpenses() {
  if (!state.currentStoreId) return [];
  if (state.currentStoreId === "all") return state.expenses;
  return state.expenses.filter((expense) => expense.storeId === state.currentStoreId);
}

// Totals for one month, from a list already scoped to a branch. Pure, so
// tests/expenses.test.mjs can evaluate it rather than a copy of it.
function summariseExpenses(expenses, monthKey) {
  let total = 0;
  let fromTill = 0;
  let count = 0;
  // The docx section 9 statement has a line for each. They add to `total` and
  // never to anything else: the split is a presentation of the same money, not
  // a third category of it.
  let direct = 0;
  let indirect = 0;
  const byCategory = new Map();
  for (const expense of expenses) {
    const at = expenseSpentAt(expense);
    if (!at) continue;
    if (localMonthKey(at) !== monthKey) continue;
    const amount = safeNumber(expense.amount);
    total += amount;
    count += 1;
    if (expenseNature(expense) === "direct") direct += amount; else indirect += amount;
    if (expense.paidFrom === "till") fromTill += amount;
    byCategory.set(expense.category, safeNumber(byCategory.get(expense.category)) + amount);
  }
  let topCategory = null;
  let topAmount = 0;
  for (const [category, amount] of byCategory) {
    if (amount > topAmount) { topCategory = category; topAmount = amount; }
  }
  return { total, fromTill, count, topCategory, topAmount, direct, indirect };
}

// What the deliveries in this month capitalised into stock.
//
// The docx section 4 asks for exactly this: "Inventory/Landed Costs should
// ideally be entered from Inventory -> Receive Stock rather than as a normal
// expense. The Expenses module can still display these costs for reporting."
//
// Display, and nothing else. This figure is NEVER added to the operating
// expense total: the freight is already inside each product's unit cost and
// reaches the profit statement as cost of sales when the goods sell. Counting it
// here as well would charge it twice and understate profit by the whole of it --
// which is the error DESIGN-landed-costs.md 1 exists to prevent, arriving from
// the opposite direction.
function summariseLandedForMonth(deliveries, monthKey) {
  let total = 0;
  let count = 0;
  const byType = new Map();
  for (const delivery of deliveries) {
    const at = deliveryReceivedAt(delivery);
    if (!at || localMonthKey(at) !== monthKey) continue;
    const additional = safeNumber(delivery.additionalTotal);
    if (additional <= 0) continue;
    total += additional;
    count += 1;
    for (const type of DELIVERY_COST_TYPES) {
      const amount = safeNumber(delivery[type]);
      if (amount > 0) byType.set(type, safeNumber(byType.get(type)) + amount);
    }
  }
  return { total, count, byType };
}

async function subscribeToExpenses() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeExpenses) state.unsubscribeExpenses();
  // A cashier is refused this collection by firestore.rules. Subscribing anyway
  // would put a permission-denied in every cashier's console on every sign-in
  // and teach everyone to ignore that error.
  if (!isManagerOrOwnerRole()) {
    state.expenses = [];
    return;
  }
  try {
    const { collection, limit, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const expensesRef = collection(state.db, "users", state.businessOwnerUid, "expenses");
    const queryStoreIds = await resolveQueryStoreIds();
    // Same reasoning as products and services: Firestore rejects an empty `in`
    // filter outright, so a member with no store access subscribes to nothing.
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.expenses = [];
      scheduleRenderAll();
      return;
    }
    // orderBy + where("in") needs a composite index on (storeId asc,
    // createdAt desc); it is declared in firestore.indexes.json and must be
    // deployed BEFORE this build reaches a staff account, or their Accounts
    // screens fail with failed-precondition rather than merely showing less.
    const expensesQuery = queryStoreIds === null
      ? query(expensesRef, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT))
      : query(expensesRef, where("storeId", "in", queryStoreIds),
              orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT));
    state.unsubscribeExpenses = onSnapshot(
      expensesQuery,
      (snapshot) => {
        state.expenses = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        scheduleRenderAll();
      },
      (error) => {
        console.warn("[expenses listener]", error.code || error, "queryStoreIds=", queryStoreIds);
      }
    );
  } catch (error) {
    console.warn(error);
  }
}

// Guarded, because the rest of the expense wiring uses ?. throughout and a
// mixed convention is how a trimmed template turns a validation message into a
// thrown exception.
const EXPENSE_ERROR_SLOTS = ["#expenseAmountError", "#expenseDateError", "#expenseFormError"];

function clearExpenseErrors() {
  for (const id of EXPENSE_ERROR_SLOTS) {
    const node = qs(id);
    if (node) node.textContent = "";
  }
}

function setExpenseError(slot, message) {
  const node = qs(slot);
  if (node) node.textContent = message;
}

// The docx section 4 panel: landed costs, shown in Expenses, capitalised into
// stock, and never in the operating expense total.
//
// It is a separate panel rather than rows in the table on purpose. In the table
// it would sit under the same column headings as spending that DOES reduce this
// month's profit, and the only thing keeping the two apart would be a label in a
// cell. A reader summing the screen by eye must not be able to reach a different
// number from the one the screen reports.
function renderLandedCostSection(monthKey) {
  const panel = qs("#expenseLandedPanel");
  const body = qs("#expenseLandedBody");
  if (!panel || !body) return;

  const summary = summariseLandedForMonth(storeDeliveries(), monthKey);
  // Hidden entirely when there is nothing to show. A shop that has never
  // recorded a landed cost should not be shown an empty panel explaining a
  // distinction it has not met yet.
  panel.hidden = summary.total <= 0;
  if (panel.hidden) {
    body.innerHTML = "";
    return;
  }

  const rows = [...summary.byType.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, amount]) => `<tr>
      <td>${esc(t(`deliveries.cost${type.charAt(0).toUpperCase()}${type.slice(1)}`))}</td>
      <td><strong>${money(amount)}</strong></td>
    </tr>`).join("");

  body.innerHTML = `
    <p class="muted">${esc(t("expenses.landedIntro", {
      count: String(summary.count),
      delivery: t(summary.count === 1 ? "deliveries.deliverySingular" : "deliveries.deliveryPlural")
    }))}</p>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>${esc(t("expenses.landedThType"))}</th>
          <th>${esc(t("expenses.landedThAmount"))}</th>
        </tr></thead>
        <tbody>${rows}
          <tr class="delivery-preview-total">
            <td>${esc(t("expenses.landedTotalRow"))}</td>
            <td>${money(summary.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="muted">${esc(t("expenses.landedExcluded"))}</p>`;
}

// One sentence under the box saying what the choice means for the Profit
// Report, because "direct" and "indirect" are accounting words and the shop
// using this screen did not pick them.
function renderExpenseNatureHint() {
  const hint = qs("#expenseNatureHint");
  const select = qs("#expenseNatureSelect");
  if (!hint || !select) return;
  hint.textContent = t(select.value === "direct"
    ? "expenses.natureDirectHint" : "expenses.natureIndirectHint");
}

function openExpenseDialog(expenseId) {
  const dialog = qs("#expenseDialog");
  const form = qs("#expenseForm");
  if (!dialog || !form) return;

  const existing = expenseId ? state.expenses.find((item) => item.id === expenseId) : null;
  // Editing is owner-only in firestore.rules. Opening the dialog for a manager
  // would let them fill it in and then be refused on save.
  if (existing && !isOwnerRole()) return;
  // Refused before the form rather than after it. A new expense has to name one
  // branch, and discovering that after the amount, category, date and note are
  // typed throws the work away -- every other check in saveExpense() is an
  // inline field error.
  if (!existing && state.currentStoreId === "all") return showToast(t("toast.selectStoreBeforeAdd"));
  if (!existing && !state.currentStoreId) return showToast(t("toast.loadingStore"));

  const select = qs("#expenseCategorySelect");
  if (select) {
    select.innerHTML = EXPENSE_CATEGORIES
      .map((category) => `<option value="${esc(category)}">${esc(expenseCategoryLabel(category))}</option>`)
      .join("");
  }

  form.reset();
  clearExpenseErrors();
  const title = qs("#expenseDialogTitle");
  if (title) title.textContent = t(existing ? "expenses.editDialogTitle" : "expenses.dialogTitle");

  form.elements.id.value = existing?.id || "";
  form.elements.amount.value = existing ? safeNumber(existing.amount) : "";
  form.elements.category.value = existing?.category || "other";
  // An existing expense shows what it was classified as -- including one written
  // before the field existed, which expenseNature() reads from the category's
  // default rather than leaving the box blank.
  if (form.elements.nature) form.elements.nature.value = existing ? expenseNature(existing) : "indirect";
  renderExpenseNatureHint();
  form.elements.paidFrom.value = existing?.paidFrom || "other";
  const at = existing ? expenseSpentAt(existing) : new Date();
  form.elements.spentAt.value = at ? localDateInputValue(at) : "";
  form.elements.note.value = existing?.note || "";

  dialog.showModal();
}

// toISOString() would shift the date by the timezone offset, which for a shop
// recording an evening expense in EAT lands it on the previous day.
// The month bucket, in LOCAL parts. Extracted because three places need to
// agree on it -- the default selection, the totals, and the row filter -- and
// two copies of a date rule is how they drift. toISOString().slice(0, 7) is the
// tempting one-liner and it is wrong for every shop this serves: Tanzania is
// UTC+3, so it reports the previous month for the first three hours of the 1st.
function localMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function localDateInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Every expense and purchase lifecycle event, recorded the same way.
//
// Fields are OMITTED when absent, never set to null. auditStringsBounded() in
// firestore.rules reads `!('x' in d) || d.x is string` -- absent passes, null
// does not, because the key is present and null is not a string. A null in one
// optional field refuses the whole write, and when that write is part of a
// batch it takes the expense or the deletion down with it. That is precisely
// how a null customerId took every credit sale to a new customer down.
function moneyAuditEntry(action, fields) {
  const entry = {
    action,
    uid: state.user?.uid || null,
    createdAt: state.firebaseApi.firestore.serverTimestamp()
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    entry[key] = value;
  }
  return entry;
}

// --- Suppliers. DESIGN-suppliers-purchases.md 4. ---------------------------

function renderSuppliers() {
  const table = qs("#suppliersTable");
  if (!table) return;
  const panel = qs("#suppliersPanel");
  // Purchasing is not a till function, and the write rules agree: owner and
  // manager only. Hidden rather than read-only, because a cashier has nothing
  // to do on this panel at all.
  if (panel) panel.hidden = !isManagerOrOwnerRole();
  if (!isManagerOrOwnerRole()) { table.innerHTML = ""; return; }

  const suppliers = state.suppliers || [];

  // The free-text supplier boxes on the delivery and restock forms offer these
  // names, so a name that already exists gets picked rather than retyped
  // slightly differently -- which is what makes supplierLinkFor() match.
  const options = qs("#supplierNameOptions");
  if (options) {
    options.innerHTML = activeSuppliers()
      .map((supplier) => `<option value="${esc(supplier.name || "")}"></option>`).join("");
  }

  if (!suppliers.length) {
    table.innerHTML = `<tr><td colspan="6" class="empty-state">${t("suppliers.empty")}</td></tr>`;
    return;
  }

  // What has been bought from each. Counts BOTH the linked purchases and the
  // ones that only carry a typed name, so a supplier created today still shows
  // the history that was recorded before they were a record.
  const spendBySupplier = new Map();
  for (const purchase of state.purchases || []) {
    const key = purchase.supplierId || String(purchase.supplierName || "").trim().toLowerCase();
    if (!key) continue;
    spendBySupplier.set(key, safeNumber(spendBySupplier.get(key)) + safeNumber(purchase.totalPaid));
  }

  table.innerHTML = suppliers.map((supplier) => {
    const byId = safeNumber(spendBySupplier.get(supplier.id));
    const byName = safeNumber(spendBySupplier.get(String(supplier.name || "").trim().toLowerCase()));
    const spend = byId + byName;
    const owed = safeNumber(supplier.balanceOwed);
    const active = supplier.active !== false;
    return `<tr>
      <td>${esc(supplier.name || "")}</td>
      <td>${esc(supplier.phone || "-")}</td>
      <td>${esc(supplier.tin || "-")}</td>
      <td>${money(spend)}</td>
      <td>${owed > 0 ? `<strong>${money(owed)}</strong>` : `<span class="muted">-</span>`}</td>
      <td><span class="status ${active ? "healthy" : ""}">${t(active ? "suppliers.statusActive" : "suppliers.statusInactiveShort")}</span></td>
      <td class="table-actions">
        <button class="link-button" type="button" data-supplier-statement="${esc(supplier.id)}">${t("suppliers.statement")}</button>
        ${owed > 0 ? `<button class="ghost-button compact" type="button" data-supplier-pay="${esc(supplier.id)}">${t("suppliers.payButton")}</button>` : ""}
        <button class="link-button" type="button" data-edit-supplier="${esc(supplier.id)}">${t("suppliers.edit")}</button>
      </td>
    </tr>`;
  }).join("");
}

function openSupplierDialog(supplierId) {
  const dialog = qs("#supplierDialog");
  const form = qs("#supplierForm");
  if (!dialog || !form) return;
  const supplier = supplierId ? supplierById(supplierId) : null;
  form.reset();
  qs("#supplierNameError").textContent = "";
  qs("#supplierOpeningBalanceError").textContent = "";
  setDynamicText("#supplierDialogTitle", t(supplier ? "suppliers.dialogTitleEdit" : "suppliers.dialogTitle"), supplier ? "suppliers.dialogTitleEdit" : "suppliers.dialogTitle");
  form.elements.id.value = supplier?.id || "";
  form.elements.name.value = supplier?.name || "";
  form.elements.phone.value = supplier?.phone || "";
  form.elements.email.value = supplier?.email || "";
  form.elements.tin.value = supplier?.tin || "";
  form.elements.address.value = supplier?.address || "";
  form.elements.openingBalance.value = supplier ? safeNumber(supplier.openingBalance) : 0;
  form.elements.active.value = supplier && supplier.active === false ? "false" : "true";
  dialog.showModal();
}

async function saveSupplier(input) {
  const existing = input.id ? supplierById(input.id) : null;

  // "all stores" cannot own a document. The same refusal saveProduct(),
  // saveService() and saveExpense() make.
  if (!existing && state.currentStoreId === "all") return showToast(t("toast.selectStoreBeforeAdd"));
  if (!existing && !state.currentStoreId) return showToast(t("toast.loadingStore"));
  if (!state.db || !state.user || !state.businessOwnerUid) return showToast(t("toast.signInToAddStore"));

  qs("#supplierNameError").textContent = "";
  qs("#supplierOpeningBalanceError").textContent = "";

  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) {
    qs("#supplierNameError").textContent = t("suppliers.nameRequired");
    return;
  }

  // Refused rather than merged: two suppliers with one name is the exact
  // problem this record exists to end, and silently merging would attach a
  // purchase to a supplier the user did not choose.
  const clash = (state.suppliers || []).find((other) =>
    other.id !== (existing?.id || "") &&
    String(other.name || "").trim().toLowerCase() === name.toLowerCase());
  if (clash) {
    qs("#supplierNameError").textContent = t("suppliers.nameTaken");
    return;
  }

  const openingBalance = clampNonNegativeNumber(input.openingBalance || 0, MAX_MONEY);
  if (openingBalance === null) {
    qs("#supplierOpeningBalanceError").textContent = t("suppliers.openingBalanceInvalid");
    return;
  }

  try {
    const { doc, collection, setDoc, serverTimestamp } = state.firebaseApi.firestore;
    const payload = {
      name,
      storeId: existing?.storeId || state.currentStoreId,
      openingBalance,
      // Maintained by phase 2. Set once on creation so the rules' number check
      // passes, and never recomputed here -- what is owed is the sum of
      // purchases and payments, not something typed on this form.
      balanceOwed: existing ? safeNumber(existing.balanceOwed) : openingBalance,
      active: String(input.active) !== "false",
      updatedAt: serverTimestamp()
    };
    // Optional fields are OMITTED when blank rather than written as "": the
    // rules allow absence, and an empty string is a value that would overwrite
    // something set from another device.
    for (const [key, max] of [["phone", 20], ["email", 120], ["address", 200], ["tin", 40]]) {
      const value = String(input[key] || "").trim().slice(0, max);
      if (value) payload[key] = value;
    }
    if (!existing) payload.createdAt = serverTimestamp();

    const ref = existing
      ? doc(state.db, "users", state.businessOwnerUid, "suppliers", existing.id)
      : doc(collection(state.db, "users", state.businessOwnerUid, "suppliers"));
    await setDoc(ref, payload, { merge: true });
    qs("#supplierDialog")?.close();
    showToast(t(existing ? "toast.supplierUpdated" : "toast.supplierAdded", { name }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotSaveSupplier"));
  }
}

// Paying a supplier down. Spec 5.4.
//
// A transaction, because the balance is read and written: two people recording
// payments at once would otherwise both subtract from the same starting figure
// and one of the payments would vanish.
async function recordSupplierPayment(input) {
  const supplier = supplierById(input.supplierId);
  if (!supplier) return showToast(t("toast.couldNotSaveSupplierPayment"));
  if (!state.db || !state.user || !state.businessOwnerUid) return showToast(t("toast.signInToAddStore"));

  const errorEl = qs("#supplierPaymentAmountError");
  if (errorEl) errorEl.textContent = "";

  const amount = clampNonNegativeNumber(input.amount, MAX_MONEY);
  if (amount === null || amount <= 0) {
    if (errorEl) errorEl.textContent = t("suppliers.paymentAmountInvalid");
    return;
  }
  // Paying more than is owed is refused rather than parked as a negative
  // balance. A supplier who owes YOU money is a credit note, which is a
  // different record; a negative balanceOwed would also be refused by the rules.
  if (amount > safeNumber(supplier.balanceOwed)) {
    if (errorEl) errorEl.textContent = t("suppliers.paymentTooMuch", { owed: money(safeNumber(supplier.balanceOwed)) });
    return;
  }

  try {
    const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
    const root = ["users", state.businessOwnerUid];
    const supplierRef = doc(state.db, ...root, "suppliers", supplier.id);
    const paymentRef = doc(collection(state.db, ...root, "suppliers", supplier.id, "payments"));

    await runTransaction(state.db, async (transaction) => {
      const snap = await transaction.get(supplierRef);
      if (!snap.exists()) throw new Error(t("txerror.supplierGone"));
      const current = safeNumber(snap.data().balanceOwed);
      // Re-checked INSIDE the transaction against what is actually stored, not
      // against the copy the dialog opened with.
      const applied = Math.min(amount, current);
      if (applied <= 0) throw new Error(t("suppliers.paymentNothingOwed"));
      transaction.set(paymentRef, {
        amount: applied,
        method: String(input.method || "cash"),
        ...(input.reference ? { reference: String(input.reference).trim().slice(0, 60) } : {}),
        ...(input.note ? { note: String(input.note).trim().slice(0, 200) } : {}),
        recordedByUid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });
      transaction.update(supplierRef, {
        balanceOwed: current - applied,
        updatedAt: serverTimestamp()
      });
    });
    qs("#supplierPaymentDialog")?.close();
    showToast(t("toast.supplierPaymentRecorded", { name: supplier.name || "" }));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotSaveSupplierPayment"));
  }
}

function openSupplierPaymentDialog(supplierId) {
  const supplier = supplierById(supplierId);
  const dialog = qs("#supplierPaymentDialog");
  const form = qs("#supplierPaymentForm");
  if (!supplier || !dialog || !form) return;
  form.reset();
  qs("#supplierPaymentAmountError").textContent = "";
  setDynamicText("#supplierPaymentTitle", `${t("suppliers.paymentTitle")} — ${supplier.name || ""}`);
  qs("#supplierPaymentBalance").textContent =
    t("suppliers.paymentOwedNow", { amount: money(safeNumber(supplier.balanceOwed)) });
  form.elements.supplierId.value = supplier.id;
  dialog.showModal();
}

// Everything bought from a supplier and everything paid to them. Spec 5.4.
//
// The purchases behind it are bounded by ACCOUNTS_HISTORY_LIMIT, so the
// statement says so at the foot rather than implying the rows are the whole
// relationship. The stored balance is the authority, NOT the sum of the rows --
// which is why the summary block is built from balanceOwed and not from
// bought minus paid.
function buildSupplierStatementHtml(supplierId, payments = []) {
  const supplier = supplierById(supplierId);
  if (!supplier) return "";

  const nameKey = String(supplier.name || "").trim().toLowerCase();
  // Linked purchases, plus the ones that only carry a typed name -- a supplier
  // created today should still show what was bought from them before they were
  // a record.
  const purchases = (state.purchases || []).filter((purchase) =>
    purchase.supplierId === supplierId
    || (!purchase.supplierId && String(purchase.supplierName || "").trim().toLowerCase() === nameKey));

  const rows = purchases
    .map((purchase) => ({
      at: purchasedAt(purchase),
      what: purchase.productName || "",
      qty: safeNumber(purchase.quantity),
      amount: safeNumber(purchase.totalPaid)
    }))
    .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));

  const paid_ = [...payments].sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));

  const bought = rows.reduce((sum, row) => sum + row.amount, 0);
  const paid = paid_.reduce((sum, payment) => sum + safeNumber(payment.amount), 0);

  // What was handed over AT DELIVERY. It lives on the delivery header, not in
  // the payments book, so without this line the statement does not reconcile:
  // opening + bought - paid would disagree with the balance by exactly the
  // amount paid on the day, and a statement that visibly fails to add up is
  // worse than no statement at all.
  const paidOnDelivery = (state.deliveries || [])
    .filter((delivery) => delivery.supplierId === supplierId
      || (!delivery.supplierId && String(delivery.supplierName || "").trim().toLowerCase() === nameKey))
    .reduce((sum, delivery) => {
      const status = deliveryPaymentStatus(delivery);
      return sum + safeNumber(status.paid);
    }, 0);

  const purchaseRows = rows.length
    ? rows.map((row) => `<tr>
        <td>${row.at ? row.at.toLocaleDateString() : "-"}</td>
        <td>${esc(row.what)}</td>
        <td>${row.qty}</td>
        <td>${money(row.amount)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">${t("suppliers.statementNoPurchases")}</td></tr>`;

  const paymentRows = paid_.length
    ? paid_.map((payment) => `<tr>
        <td>${payment.at ? payment.at.toLocaleDateString() : "-"}</td>
        <td>${t(`pos.${payment.method || "cash"}`)}</td>
        <td>${esc(payment.reference || "-")}</td>
        <td>${money(safeNumber(payment.amount))}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" class="empty-state">${t("suppliers.statementNoPayments")}</td></tr>`;

  return `
    <p class="muted">${t("suppliers.statementIntro", { name: esc(supplier.name || "") })}</p>
    <table class="statement">
      <tbody>
        <tr><td>${t("suppliers.statementOpening")}</td><td class="statement-figures">${money(safeNumber(supplier.openingBalance))}</td></tr>
        <tr><td>${t("suppliers.statementBought")}</td><td class="statement-figures">${money(bought)}</td></tr>
        <tr><td>${t("suppliers.statementPaidOnDelivery")}</td><td class="statement-figures">${money(paidOnDelivery)}</td></tr>
        <tr><td>${t("suppliers.statementPaid")}</td><td class="statement-figures">${money(paid)}</td></tr>
        <tr class="statement-total"><td>${t("suppliers.statementOwed")}</td><td class="statement-figures">${money(safeNumber(supplier.balanceOwed))}</td></tr>
      </tbody>
    </table>
    <h3>${t("suppliers.statementPurchasesTitle")}</h3>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>${t("movement.colDate")}</th><th>${t("suppliers.statementColWhat")}</th>
        <th>${t("movement.colQty")}</th><th>${t("movement.colTotalPaid")}</th>
      </tr></thead>
      <tbody>${purchaseRows}</tbody>
    </table></div>
    <h3>${t("suppliers.statementPaymentsTitle")}</h3>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>${t("movement.colDate")}</th><th>${t("suppliers.paymentMethodLabel")}</th>
        <th>${t("suppliers.paymentReferenceLabel")}</th><th>${t("suppliers.paymentAmountLabel")}</th>
      </tr></thead>
      <tbody>${paymentRows}</tbody>
    </table></div>
    <p class="muted">${t("suppliers.statementBoundedNote")}</p>
  `;
}

// Payments are fetched for THIS supplier when the statement is opened, rather
// than kept in a live collection-group subscription. A collection group across
// every supplier's payments would need its own composite index and a wider read
// rule, to keep a list warm that is looked at rarely.
async function openSupplierStatement(supplierId) {
  const supplier = supplierById(supplierId);
  const dialog = qs("#supplierStatementDialog");
  if (!supplier || !dialog) return;
  setDynamicText("#supplierStatementTitle", `${t("suppliers.statementTitle")} — ${supplier.name || ""}`);
  // Opened first, with what is already known. The fetch below can be slow on a
  // bad connection and a dialog that appears only after it looks broken.
  qs("#supplierStatementContent").innerHTML = buildSupplierStatementHtml(supplierId, []);
  dialog.showModal();

  let payments = [];
  try {
    const { collection, getDocs, orderBy, query, limit } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "suppliers", supplierId, "payments");
    const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT)));
    payments = snap.docs.map((docSnap) => {
      const data = docSnap.data();
      return { id: docSnap.id, ...data, at: purchasedAt(data) };
    });
  } catch (error) {
    console.warn("Could not load supplier payments.", error);
  }
  // Still open? A slow fetch that lands after the user has closed the dialog
  // must not repaint it.
  if (dialog.open) {
    qs("#supplierStatementContent").innerHTML = buildSupplierStatementHtml(supplierId, payments);
  }
}

// --- Purchase returns. Spec 5.5. -------------------------------------------

// How much of a purchase has already gone back, so a 100-unit purchase cannot
// have 60 returned twice. Counted from the returns themselves rather than
// stamped onto the purchase, because the purchase is a record of what was
// bought and paid and is never rewritten.
function purchaseReturnedQty(purchaseId) {
  return (state.purchaseReturns || [])
    .filter((entry) => entry.purchaseId === purchaseId)
    .reduce((sum, entry) => sum + safeNumber(entry.quantity), 0);
}

function purchaseReturnableQty(purchase) {
  if (!purchase) return 0;
  return Math.max(safeNumber(purchase.quantity) - purchaseReturnedQty(purchase.id), 0);
}

// Sending goods back to a supplier: stock leaves, and what is owed for those
// goods leaves with it.
//
// A transaction, and for two separate reasons: the shelf count is read and
// written (two returns at once would otherwise both subtract from the same
// starting figure), and the supplier balance is too.
async function recordPurchaseReturn(input) {
  const purchase = (state.purchases || []).find((item) => item.id === input.purchaseId);
  if (!purchase) return showToast(t("toast.couldNotSavePurchaseReturn"));
  if (!state.db || !state.user || !state.businessOwnerUid) return showToast(t("toast.signInToAddStore"));

  const errorEl = qs("#purchaseReturnQtyError");
  if (errorEl) errorEl.textContent = "";

  const returnable = purchaseReturnableQty(purchase);
  const quantity = clampNonNegativeNumber(input.quantity, MAX_COUNT);
  if (quantity === null || quantity <= 0) {
    if (errorEl) errorEl.textContent = t("purchaseReturn.qtyInvalid");
    return;
  }
  if (quantity > returnable) {
    if (errorEl) errorEl.textContent = t("purchaseReturn.qtyTooMany", { max: String(returnable) });
    return;
  }

  // Valued at what this purchase actually paid per unit, not at today's
  // weighted average. The supplier credits back what they charged, and the
  // average has since absorbed other deliveries at other prices.
  const unitCost = safeNumber(purchase.quantity) > 0
    ? safeNumber(purchase.totalPaid) / safeNumber(purchase.quantity)
    : 0;
  const amount = Math.round(unitCost * quantity);

  try {
    const { doc, collection, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
    const root = ["users", state.businessOwnerUid];
    const productRef = doc(state.db, ...root, "products", purchase.productId);
    const supplierId = purchase.supplierId || supplierLinkFor(purchase.supplierName).supplierId || "";
    const supplierRef = supplierId ? doc(state.db, ...root, "suppliers", supplierId) : null;

    await runTransaction(state.db, async (transaction) => {
      // Every read before any write -- Firestore refuses a get() after the
      // first write in a transaction.
      const productSnap = await transaction.get(productRef);
      const supplierSnap = supplierRef ? await transaction.get(supplierRef) : null;

      if (!productSnap.exists()) throw new Error(t("txerror.itemGone", { name: purchase.productName || "" }));
      const before = safeNumber(productSnap.data().quantity);
      // You cannot send back stock that is not on the shelf. It may have been
      // sold since; the shop has to reconcile that rather than go negative.
      if (before < quantity) throw new Error(t("purchaseReturn.notEnoughStock"));

      transaction.update(productRef, {
        quantity: before - quantity,
        updatedAt: serverTimestamp(),
        movementReason: "supplier-return"
      });

      recordStockMovement(transaction, {
        productId: purchase.productId,
        productName: purchase.productName || "",
        storeId: purchase.storeId,
        reason: "supplier-return",
        delta: -quantity,
        quantityBefore: before
      });

      transaction.set(doc(collection(state.db, ...root, "purchaseReturns")), {
        storeId: purchase.storeId,
        purchaseId: purchase.id,
        productId: purchase.productId,
        productName: purchase.productName || "",
        quantity,
        amount,
        ...(supplierId ? { supplierId } : {}),
        ...(purchase.supplierName ? { supplierName: String(purchase.supplierName).slice(0, 120) } : {}),
        ...(input.reason ? { reason: String(input.reason).trim().slice(0, 200) } : {}),
        recordedByUid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });

      // Only what is still owed can be cancelled by a return. Goods already
      // paid for come back as cash or a credit note from the supplier, which is
      // a record this app does not keep -- so the balance floors at zero rather
      // than going negative and inventing a debt the supplier owes us.
      if (supplierRef && supplierSnap?.exists()) {
        const owed = safeNumber(supplierSnap.data().balanceOwed);
        const relieved = Math.min(amount, owed);
        if (relieved > 0) {
          transaction.update(supplierRef, {
            balanceOwed: owed - relieved,
            updatedAt: serverTimestamp()
          });
        }
      }
    });

    qs("#purchaseReturnDialog")?.close();
    showToast(t("toast.purchaseReturnRecorded", {
      qty: String(quantity), name: purchase.productName || ""
    }));
  } catch (error) {
    console.warn("[recordPurchaseReturn]", error);
    showToast(error?.message || t("toast.couldNotSavePurchaseReturn"));
  }
}

function openPurchaseReturnDialog(purchaseId) {
  const purchase = (state.purchases || []).find((item) => item.id === purchaseId);
  const dialog = qs("#purchaseReturnDialog");
  const form = qs("#purchaseReturnForm");
  if (!purchase || !dialog || !form) return;
  const returnable = purchaseReturnableQty(purchase);
  form.reset();
  qs("#purchaseReturnQtyError").textContent = "";
  setDynamicText("#purchaseReturnTitle", `${t("purchaseReturn.title")} — ${purchase.productName || ""}`);
  qs("#purchaseReturnSummary").textContent = t("purchaseReturn.summary", {
    qty: String(safeNumber(purchase.quantity)),
    supplier: purchaseSupplierLabel(purchase) || t("purchaseReturn.noSupplier"),
    max: String(returnable)
  });
  form.elements.purchaseId.value = purchase.id;
  form.elements.quantity.max = String(returnable);
  form.elements.quantity.value = String(returnable);
  dialog.showModal();
}

// --- Stock adjustments. Spec 4.4. ------------------------------------------

// A closed set, because this is the field an owner filters on when asking where
// stock went. Free text cannot be counted: "Damaged", "damaged" and "broke it"
// are three answers to one question.
//
// 'opening' is here rather than in a separate module because an opening balance
// IS an adjustment from zero -- spec 4.2 lists Opening Stock as its own increase
// class, and this keeps it in the same ledger as everything else that moves the
// shelf, which is what makes the running balance add up.
const STOCK_ADJUSTMENT_REASONS = [
  "count", "damaged", "expired", "lost", "theft", "correction", "opening", "other"
];

function stockAdjustmentReasonLabel(reason) {
  return STOCK_ADJUSTMENT_REASONS.includes(reason)
    ? t(`adjust.reason.${reason}`)
    : t("adjust.reason.other");
}

// Correcting what the shelf says. Spec 4.4.
//
// The form asks for the NEW quantity and derives the delta, rather than asking
// for a delta: a shop counting a shelf knows what is on it, not how far it has
// drifted. Deriving the difference here is also what lets the ledger record both
// figures honestly.
async function recordStockAdjustment(input) {
  const product = (state.products || []).find((item) => item.id === input.productId);
  if (!product) return showToast(t("toast.couldNotSaveAdjustment"));
  if (!state.db || !state.user || !state.businessOwnerUid) return showToast(t("toast.signInToAddStore"));

  const errorEl = qs("#adjustQtyError");
  if (errorEl) errorEl.textContent = "";

  const newQuantity = clampNonNegativeNumber(input.newQuantity, MAX_COUNT);
  if (newQuantity === null) {
    if (errorEl) errorEl.textContent = t("adjust.qtyInvalid");
    return;
  }
  const reason = STOCK_ADJUSTMENT_REASONS.includes(input.reason) ? input.reason : "other";

  try {
    const { doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
    const root = ["users", state.businessOwnerUid];
    const productRef = doc(state.db, ...root, "products", product.id);

    await runTransaction(state.db, async (transaction) => {
      const snap = await transaction.get(productRef);
      if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: product.name || "" }));

      // Recomputed against what the shelf ACTUALLY holds inside the
      // transaction, not against the number the dialog opened with. Somebody
      // else may have sold from this product while the form sat open, and
      // writing the dialog's delta would undo their sale.
      const before = safeNumber(snap.data().quantity);
      const delta = newQuantity - before;
      if (delta === 0) throw new Error(t("adjust.noChange"));

      transaction.update(productRef, {
        quantity: newQuantity,
        updatedAt: serverTimestamp(),
        movementReason: "adjustment"
      });

      recordStockMovement(transaction, {
        productId: product.id,
        productName: product.name || "",
        storeId: productStoreId(product),
        reason: "adjustment",
        adjustmentReason: reason,
        delta,
        quantityBefore: before,
        ...(input.note ? { note: String(input.note).trim().slice(0, 200) } : {})
      });
    });

    qs("#stockAdjustDialog")?.close();
    showToast(t("toast.adjustmentRecorded", { name: product.name || "" }));
  } catch (error) {
    console.warn("[recordStockAdjustment]", error);
    showToast(error?.message || t("toast.couldNotSaveAdjustment"));
  }
}

function openStockAdjustDialog(productId) {
  const product = (state.products || []).find((item) => item.id === productId);
  const dialog = qs("#stockAdjustDialog");
  const form = qs("#stockAdjustForm");
  if (!product || !dialog || !form) return;
  form.reset();
  qs("#adjustQtyError").textContent = "";
  setDynamicText("#stockAdjustTitle", `${t("adjust.title")} — ${product.name || ""}`);
  form.elements.productId.value = product.id;
  form.elements.currentQuantity.value = String(safeNumber(product.quantity));
  form.elements.newQuantity.value = String(safeNumber(product.quantity));
  renderAdjustDelta();
  dialog.showModal();
}

// The difference, shown live. Spec 4.4 asks for current, adjustment and new
// quantity all on the form; two of the three are typed and the third has to
// follow, or the screen is quietly lying about one of them.
function renderAdjustDelta() {
  const form = qs("#stockAdjustForm");
  const out = qs("#adjustDelta");
  if (!form || !out) return;
  const before = safeNumber(form.elements.currentQuantity?.value);
  const after = safeNumber(form.elements.newQuantity?.value);
  const delta = after - before;
  out.textContent = delta === 0
    ? t("adjust.deltaNone")
    : t(delta > 0 ? "adjust.deltaUp" : "adjust.deltaDown", { units: String(Math.abs(delta)) });
}

// --- Phase 4 reports. Spec §9. ---------------------------------------------
//
// Grouped the way §9 groups them, and built ONLY where real transaction data
// stands behind the figure. The four Financial reports (Balance Sheet, Trial
// Balance, General Ledger, Cash Flow) need a double-entry ledger, which is held
// (DESIGN-suppliers-purchases.md §2.1) -- so they are NAMED AS UNAVAILABLE
// rather than rendered from something that merely resembles them. A report that
// shows a plausible figure it cannot support is worse than an absent one; this
// project has shipped that defect once already, when revenue was drawn as
// profit.

// What was bought in the range, netted of what went back. Spec §9 Purchase
// Summary.
//
// NOT summarisePurchases(): that name was already taken by the month totals on
// the Purchases screen. Two function declarations of one name do not collide
// loudly in JavaScript -- the later one simply wins -- so the first symptom was
// this report quietly reading a different function's shape.
function summarisePurchaseTotals(purchases, returns) {
  let goods = 0;
  let landed = 0;
  let units = 0;
  for (const purchase of purchases) {
    goods += safeNumber(purchase.goodsCost ?? purchase.totalPaid);
    landed += safeNumber(purchase.landedCost);
    units += safeNumber(purchase.quantity);
  }
  let returnedValue = 0;
  let returnedUnits = 0;
  for (const entry of returns) {
    returnedValue += safeNumber(entry.amount);
    returnedUnits += safeNumber(entry.quantity);
  }
  const gross = goods + landed;
  return {
    goods, landed, gross, units,
    returnedValue, returnedUnits,
    // "Net purchases" is the figure the P&L needs, and the one the spec's §10
    // statement subtracts closing inventory from.
    net: gross - returnedValue,
    count: purchases.length
  };
}

// Spec §9 Purchases by Product.
function summarisePurchasesByProduct(purchases, returns) {
  const byProduct = new Map();
  const add = (id, name, patch) => {
    const row = byProduct.get(id) || { productId: id, name, units: 0, spend: 0, returnedUnits: 0, returnedValue: 0 };
    row.units += patch.units || 0;
    row.spend += patch.spend || 0;
    row.returnedUnits += patch.returnedUnits || 0;
    row.returnedValue += patch.returnedValue || 0;
    if (!row.name && name) row.name = name;
    byProduct.set(id, row);
  };
  for (const purchase of purchases) {
    add(purchase.productId, purchase.productName || "", {
      units: safeNumber(purchase.quantity), spend: safeNumber(purchase.totalPaid)
    });
  }
  for (const entry of returns) {
    add(entry.productId, entry.productName || "", {
      returnedUnits: safeNumber(entry.quantity), returnedValue: safeNumber(entry.amount)
    });
  }
  const rows = [...byProduct.values()]
    .map((row) => ({ ...row, netSpend: row.spend - row.returnedValue, netUnits: row.units - row.returnedUnits }))
    .sort((a, b) => b.netSpend - a.netSpend);
  return { rows, totalNet: rows.reduce((sum, row) => sum + row.netSpend, 0) };
}

// Spec §9 Sales by Customer. Walk-in sales carry no customer and are grouped as
// such rather than dropped -- a report that silently omits most of the day's
// takings is worse than one that says "walk-in".
function summariseSalesByCustomer(sales) {
  const byCustomer = new Map();
  for (const sale of sales) {
    if (sale.voided) continue;
    const key = sale.customerId || String(sale.customerName || "").trim().toLowerCase() || "__walkin";
    const name = sale.customerName || "";
    const row = byCustomer.get(key) || { key, name, orders: 0, revenue: 0, isWalkIn: key === "__walkin" };
    row.orders += 1;
    row.revenue += saleNetTotal(sale);
    if (!row.name && name) row.name = name;
    byCustomer.set(key, row);
  }
  const rows = [...byCustomer.values()].sort((a, b) => b.revenue - a.revenue);
  return { rows, total: rows.reduce((sum, row) => sum + row.revenue, 0) };
}

// Spec §9 Sales Returns. Refunds already net through every money surface; this
// report is the list of them, which nothing showed before.
function summariseSalesReturns(sales) {
  const rows = [];
  for (const sale of sales) {
    for (const ret of sale.returns || []) {
      const units = (ret.items || []).reduce((sum, item) => sum + safeNumber(item.qty), 0);
      // The return carries its OWN timestamp -- goods come back days after they
      // were sold, and bucketing a refund on the sale's date puts it in the
      // wrong month.
      const at = ret.createdAt ? new Date(ret.createdAt) : saleTimestamp(sale);
      rows.push({
        at: at && !Number.isNaN(at.getTime()) ? at : saleTimestamp(sale),
        orderNumber: sale.orderNumber || sale.id || "",
        customerName: sale.customerName || "",
        staffName: ret.staffName || "",
        units,
        amount: safeNumber(ret.refundAmount)
      });
    }
  }
  rows.sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
  return {
    rows,
    totalUnits: rows.reduce((sum, row) => sum + row.units, 0),
    totalAmount: rows.reduce((sum, row) => sum + row.amount, 0)
  };
}

// Spec §9 Stock Summary: what is on the shelf, per product, right now.
function summariseStockSummary(products) {
  const rows = products
    .map((product) => ({
      id: product.id,
      name: productDisplayLabel(product),
      category: product.category || "",
      quantity: safeNumber(product.quantity),
      reorderLevel: safeNumber(product.reorderLevel),
      low: safeNumber(product.reorderLevel) > 0 && safeNumber(product.quantity) <= safeNumber(product.reorderLevel)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    rows,
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    lowCount: rows.filter((row) => row.low).length,
    outCount: rows.filter((row) => row.quantity <= 0).length
  };
}

// Spec §9 Stock Adjustments. Grouped by reason, because the question this
// answers is "where is stock going", and one line per correction does not
// answer it.
function summariseStockAdjustments(movements) {
  const byReason = new Map();
  let up = 0;
  let down = 0;
  for (const entry of movements) {
    if (entry.reason !== "adjustment") continue;
    const reason = entry.adjustmentReason || "other";
    const delta = safeNumber(entry.delta);
    const row = byReason.get(reason) || { reason, count: 0, up: 0, down: 0 };
    row.count += 1;
    if (delta >= 0) { row.up += delta; up += delta; } else { row.down += Math.abs(delta); down += Math.abs(delta); }
    byReason.set(reason, row);
  }
  const rows = [...byReason.values()].sort((a, b) => (b.up + b.down) - (a.up + a.down));
  return { rows, up, down, net: up - down };
}

// Spec §9 Supplier Balances: what the business owes, per supplier.
function summariseSupplierBalances(suppliers) {
  const rows = suppliers
    .map((supplier) => ({
      id: supplier.id,
      name: supplier.name || "",
      owed: safeNumber(supplier.balanceOwed),
      active: supplier.active !== false
    }))
    .filter((row) => row.owed > 0)
    .sort((a, b) => b.owed - a.owed);
  return { rows, total: rows.reduce((sum, row) => sum + row.owed, 0) };
}

// Spec §9 Expenses by Category, and by month. Both fall out of one pass.
function summariseExpensesByCategory(expenses) {
  const byCategory = new Map();
  const byMonth = new Map();
  let total = 0;
  for (const expense of expenses) {
    const amount = safeNumber(expense.amount);
    total += amount;
    const category = expense.category || "other";
    const row = byCategory.get(category) || { category, count: 0, amount: 0, nature: expenseNature(expense) };
    row.count += 1;
    row.amount += amount;
    byCategory.set(category, row);

    const at = expenseSpentAt(expense);
    if (at) {
      const key = localMonthKey(at);
      byMonth.set(key, safeNumber(byMonth.get(key)) + amount);
    }
  }
  return {
    categories: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
    months: [...byMonth.entries()].map(([month, amount]) => ({ month, amount })).sort((a, b) => a.month.localeCompare(b.month)),
    total
  };
}

// Everything spec §9 asks for that real transaction data can answer, painted in
// one pass. Owner-and-manager, matching the panels that were already here --
// except the ones that show cost, which stay owner-only.
// ---------------------------------------------------------------------------
// The reports chooser.
//
// Reports used to be eighteen panels on one scrolling page, every one of them
// rendered on every open. That was the slowest screen in the app and the
// hardest to find anything on, on handsets that can least afford either.
//
// Now Reports opens on a menu and shows ONE report. The menu is built from the
// panels themselves at runtime rather than from a list typed here, so the two
// can never disagree: a report cannot appear in the menu while being hidden by
// role, and cannot sit on the page with no way to reach it. Adding a report
// means tagging its panel with data-report and data-report-group -- there is no
// second place to remember.
//
// Role gating is UNCHANGED. renderSpecReports() still sets `hidden` per role,
// and the menu is built from whatever survives that. This layer only ever hides
// further; it never reveals a panel a role was refused.
const REPORT_GROUP_ORDER = ["money", "sales", "stock", "buying", "ai"];

// Profit & Loss is offered here but is NOT one of these panels: it keeps its
// own view so that canOpenView("profit") remains the single owner-strict gate
// on it. Folding its markup into Reports would have dissolved that gate into a
// role check on a menu entry -- a weaker thing in the one place that can least
// afford one, since profit exposes buying prices by inference.
const REPORT_PROFIT_KEY = "__profit";

// The one place a report's ROLE visibility is recorded.
//
// It has to be recorded rather than read back off `hidden`, because the chooser
// also writes `hidden` -- so reading it would mean reading this function's own
// previous output. That is exactly the bug this replaced: the first pass
// recorded the roles correctly and then hid every unselected panel, and the
// second pass read those hidden panels back as "refused by role", so the menu
// emptied itself down to the one entry that is not a panel.
//
// Only the three renderers that actually decide role visibility call this. A
// panel none of them touches is one no role is refused, and defaults to shown.
function setReportRoleVisibility(panel, hiddenByRole) {
  if (!panel) return;
  panel.dataset.reportHiddenByRole = hiddenByRole ? "1" : "0";
  panel.hidden = hiddenByRole;
}

// One icon per GROUP rather than per report: eighteen invented glyphs would be
// eighteen things to guess at, while five say "money / sales / stock / buying /
// ask" at a glance and repeat down the column so the eye can find the section
// it wants without reading.
const REPORT_GROUP_ICONS = {
  money: '<path d="M3 7.6A2.1 2.1 0 0 1 5.1 5.5h12.4a1 1 0 0 1 1 1v2"/><path d="M3 7.6v9.3a2.1 2.1 0 0 0 2.1 2.1h13.4a1 1 0 0 0 1-1v-3.1"/><path d="M21 10.4v4.2h-4.1a2.1 2.1 0 0 1 0-4.2z"/>',
  sales: '<circle cx="9.5" cy="19.5" r="1.5"/><circle cx="18" cy="19.5" r="1.5"/><path d="M2.5 3.5H5l2.3 11.6a1.8 1.8 0 0 0 1.77 1.4h8.3a1.8 1.8 0 0 0 1.76-1.44L21 7.3H5.8"/>',
  stock: '<path d="M21 8.2v7.6a1.8 1.8 0 0 1-.92 1.57l-7.2 3.9a1.8 1.8 0 0 1-1.76 0l-7.2-3.9A1.8 1.8 0 0 1 3 15.8V8.2a1.8 1.8 0 0 1 .92-1.57l7.2-3.9a1.8 1.8 0 0 1 1.76 0l7.2 3.9A1.8 1.8 0 0 1 21 8.2z"/><path d="M3.4 7.2 12 12l8.6-4.8"/><path d="M12 21.4V12"/>',
  buying: '<path d="M5.5 2.8h13v18.4l-2.6-1.5-2.4 1.5-2.5-1.5-2.4 1.5-3.1-1.5z"/><path d="M9 8.4h6M9 12.4h6"/>',
  ai: '<path d="M11.4 3.2 13.1 8l4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8L4.9 9.7 9.7 8z"/><path d="M18.3 15.1l.63 1.72 1.72.63-1.72.63-.63 1.72-.63-1.72-1.72-.63 1.72-.63z"/>'
};

// A one-line answer to "what is this report". The menu's whole job is choosing,
// and a column of bare titles makes the reader open three to find the one they
// meant. Keyed by report so the strings live in the dictionary and translate
// with everything else; a report with no hint simply shows none.
function reportHint(key) {
  const text = t("reports.hint." + key);
  // t() returns the key itself when there is no entry.
  return text === "reports.hint." + key ? "" : text;
}

function reportPanels() {
  return qsa("#reports [data-report]");
}

// A report earns a place in the menu when its panel is not hidden by role AND
// it has something to say. The second half matters for exactly one report:
// "Sold While Offline" is empty except in the days after an outage, and a
// permanent menu entry for a permanently empty screen is noise. When an outage
// HAS happened it is the report the owner most needs, so it appears then.
function reportHasContent(panel) {
  // A report opts out of the menu by stamping data-report-empty="1" when it
  // rendered nothing. Only "Sold While Offline" does today: it is empty except
  // in the days after an outage, and a permanent entry for a permanently empty
  // screen is noise -- while after an outage it is the report the owner most
  // needs, so it appears exactly then.
  return panel.dataset.reportEmpty !== "1";
}

function renderReportsIndex() {
  const list = qs("#reportsIndexList");
  if (!list) return;
  const groups = new Map();
  for (const panel of reportPanels()) {
    if (panel.dataset.reportHiddenByRole === "1") continue;
    if (!reportHasContent(panel)) continue;
    const group = panel.dataset.reportGroup || "money";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({
      key: panel.dataset.report,
      label: panel.querySelector("h2")?.textContent?.trim() || panel.dataset.report
    });
  }
  // Profit sits at the top of Money: it is the report an owner opens Reports to
  // read, and the only one that answers "did I make money".
  if (canOpenView("profit")) {
    if (!groups.has("money")) groups.set("money", []);
    groups.get("money").unshift({ key: REPORT_PROFIT_KEY, label: t("nav.profit") });
  }
  const parts = [];
  for (const group of REPORT_GROUP_ORDER) {
    const entries = groups.get(group);
    if (!entries || !entries.length) continue;
    const icon = REPORT_GROUP_ICONS[group] || "";
    parts.push(`<section class="report-group">
      <p class="report-group-label">${esc(t("reports.group." + group))}</p>
      <div class="report-group-items">${entries
        .map((entry) => {
          const hint = reportHint(entry.key === REPORT_PROFIT_KEY ? "profit" : entry.key);
          return `<button class="report-choice" type="button" data-report-open="${esc(entry.key)}">
            <span class="report-choice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${icon}</svg></span>
            <span class="report-choice-text">
              <span class="report-choice-name">${esc(entry.label)}</span>
              ${hint ? `<span class="report-choice-hint">${esc(hint)}</span>` : ""}
            </span>
            <span class="report-choice-go" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M9 5.5 15.5 12 9 18.5"/></svg></span>
          </button>`;
        })
        .join("")}</div>
    </section>`);
  }
  list.innerHTML = parts.join("") || `<p class="muted">${esc(t("reports.chooseEmpty"))}</p>`;
}

// Applied AFTER every report has rendered and set its own role visibility, so
// the role decision is recorded first and this only narrows it.
function applyReportSelection() {
  const selected = state.selectedReport || null;
  for (const panel of reportPanels()) {
    // Read only. The verdict is written by setReportRoleVisibility(), and a
    // panel no role gate touches defaults to shown.
    const refusedByRole = panel.dataset.reportHiddenByRole === "1";
    panel.hidden = refusedByRole || panel.dataset.report !== selected;
  }
  const index = qs("#reportsIndex");
  const back = qs("#reportsBackRow");
  if (index) index.hidden = Boolean(selected);
  if (back) back.hidden = !selected;
  if (!selected) renderReportsIndex();
}

function openReport(key) {
  if (key === REPORT_PROFIT_KEY) {
    // Straight through the same choke point every other route uses.
    openView("profit");
    return;
  }
  const panel = qs(`#reports [data-report="${CSS.escape(key)}"]`);
  if (!panel || panel.dataset.reportHiddenByRole === "1") return;
  state.selectedReport = key;
  applyReportSelection();
  qs("#reports")?.scrollIntoView({ block: "start" });
}

function closeReport() {
  state.selectedReport = null;
  applyReportSelection();
}

function renderSpecReports() {
  const canSee = isManagerOrOwnerRole();
  const costVisible = isOwnerRole();

  const setPanel = (id, hidden) => {
    setReportRoleVisibility(qs(id), hidden);
  };
  const fill = (id, html) => {
    const el = qs(id);
    if (el) el.innerHTML = html;
  };
  const empty = (cols, key) => `<tr><td colspan="${cols}" class="empty-state">${t(key)}</td></tr>`;

  // Cost lives behind the owner gate, exactly as /purchases does in the rules.
  for (const id of ["#purchaseSummaryPanel", "#purchasesByProductPanel",
                    "#purchaseReturnsPanel", "#supplierBalancesPanel",
                    "#stockAdjustmentsPanel"]) {
    setPanel(id, !costVisible);
  }
  for (const id of ["#salesByCustomerPanel", "#salesReturnsPanel",
                    "#stockSummaryPanel", "#expensesByCategoryPanel"]) {
    setPanel(id, !canSee);
  }

  if (!canSee) {
    // EMPTIED, not merely hidden: a demoted manager's figures would otherwise
    // sit in the DOM behind a CSS rule. The same reason renderDeliveries()
    // gives.
    for (const id of ["#salesByCustomerTable", "#salesReturnsTable", "#stockSummaryTable",
                      "#expensesByCategoryTable", "#purchaseSummaryTotals", "#purchasesByProductTable",
                      "#purchaseReturnsTable", "#supplierBalancesTable", "#stockAdjustmentsTable"]) {
      fill(id, "");
    }
    return;
  }

  const sales = filteredSales();

  // --- Sales group ---------------------------------------------------------
  const byCustomer = summariseSalesByCustomer(sales);
  fill("#salesByCustomerTable", byCustomer.rows.length
    ? byCustomer.rows.map((row) => `<tr>
        <td>${esc(row.isWalkIn ? t("reports.walkIn") : row.name || t("reports.walkIn"))}</td>
        <td>${row.orders}</td>
        <td><strong>${money(row.revenue)}</strong></td>
      </tr>`).join("")
    : empty(3, "reports.noSalesInRange"));

  const salesReturns = summariseSalesReturns(sales);
  fill("#salesReturnsTable", salesReturns.rows.length
    ? salesReturns.rows.map((row) => `<tr>
        <td>${row.at ? row.at.toLocaleDateString() : "-"}</td>
        <td>#${esc(row.orderNumber)}</td>
        <td>${esc(row.staffName || "-")}</td>
        <td>${row.units}</td>
        <td>${money(row.amount)}</td>
      </tr>`).join("")
    : empty(5, "reports.noReturnsInRange"));

  // --- Inventory group -----------------------------------------------------
  const stock = summariseStockSummary(storeProducts());
  fill("#stockSummaryTable", stock.rows.length
    ? stock.rows.map((row) => `<tr>
        <td>${esc(row.name)}</td>
        <td>${esc(row.category || "-")}</td>
        <td>${row.quantity}</td>
        <td>${row.reorderLevel || "-"}</td>
        <td>${row.quantity <= 0
          ? `<span class="status">${t("reports.stockOut")}</span>`
          : row.low ? `<span class="status">${t("reports.stockLow")}</span>`
                    : `<span class="status healthy">${t("reports.stockOk")}</span>`}</td>
      </tr>`).join("")
    : empty(5, "reports.noProducts"));

  // --- Expense group -------------------------------------------------------
  const expenses = summariseExpensesByCategory(storeExpenses());
  fill("#expensesByCategoryTable", expenses.categories.length
    ? expenses.categories.map((row) => `<tr>
        <td>${esc(expenseCategoryLabel(row.category))}</td>
        <td>${t(row.nature === "direct" ? "reports.natureDirect" : "reports.natureIndirect")}</td>
        <td>${row.count}</td>
        <td><strong>${money(row.amount)}</strong></td>
      </tr>`).join("")
    : empty(4, "reports.noExpenses"));

  if (!costVisible) return;

  // --- Purchase group (owner only: every figure here is a cost) ------------
  const purchases = storePurchases();
  const returns = state.purchaseReturns || [];
  const summary = summarisePurchaseTotals(purchases, returns);
  fill("#purchaseSummaryTotals", [
    controlTile(t("reports.purchaseGross"), money(summary.gross), "",
      t("reports.purchaseGrossNote", { count: String(summary.count), units: String(summary.units) })),
    controlTile(t("reports.purchaseReturned"), money(summary.returnedValue), "",
      summary.returnedUnits ? t("reports.purchaseReturnedNote", { units: String(summary.returnedUnits) }) : t("reports.purchaseReturnedNone")),
    controlTile(t("reports.purchaseNet"), money(summary.net), "", t("reports.purchaseNetNote"))
  ].join(""));

  const byProduct = summarisePurchasesByProduct(purchases, returns);
  fill("#purchasesByProductTable", byProduct.rows.length
    ? byProduct.rows.map((row) => `<tr>
        <td>${esc(row.name || "-")}</td>
        <td>${row.netUnits}</td>
        <td>${row.returnedUnits || "-"}</td>
        <td><strong>${money(row.netSpend)}</strong></td>
      </tr>`).join("")
    : empty(4, "reports.noPurchases"));

  fill("#purchaseReturnsTable", returns.length
    ? [...returns]
        .sort((a, b) => (purchasedAt(b)?.getTime() || 0) - (purchasedAt(a)?.getTime() || 0))
        .map((row) => `<tr>
          <td>${purchasedAt(row) ? purchasedAt(row).toLocaleDateString() : "-"}</td>
          <td>${esc(row.productName || "-")}</td>
          <td>${esc(row.supplierName || "-")}</td>
          <td>${safeNumber(row.quantity)}</td>
          <td>${money(safeNumber(row.amount))}</td>
          <td>${esc(row.reason || "-")}</td>
        </tr>`).join("")
    : empty(6, "reports.noPurchaseReturns"));

  const balances = summariseSupplierBalances(state.suppliers || []);
  fill("#supplierBalancesTable", balances.rows.length
    ? balances.rows.map((row) => `<tr>
        <td>${esc(row.name)}</td>
        <td><strong>${money(row.owed)}</strong></td>
      </tr>`).join("")
      + `<tr class="statement-total"><td>${t("reports.supplierBalancesTotal")}</td><td><strong>${money(balances.total)}</strong></td></tr>`
    : empty(2, "reports.noSupplierBalances"));

  // Adjustments are read from the ledger, which is owner-read only. Fetched
  // rather than subscribed for the same reason the product ledger is: it grows
  // without bound and is looked at occasionally.
  renderStockAdjustmentsReport();
}

// Kept separate because it is async -- the panel paints its last known figures
// while the fetch runs rather than flashing empty.
async function renderStockAdjustmentsReport() {
  const table = qs("#stockAdjustmentsTable");
  if (!table || !isOwnerRole() || !state.db || !state.businessOwnerUid) return;
  let movements = [];
  try {
    const { collection, getDocs, orderBy, query, limit } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "stockMovements");
    const snap = await getDocs(query(ref, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT)));
    movements = snap.docs.map((docSnap) => docSnap.data());
  } catch (error) {
    console.warn("Could not load stock adjustments.", error);
    return;
  }
  const summary = summariseStockAdjustments(movements);
  table.innerHTML = summary.rows.length
    ? summary.rows.map((row) => `<tr>
        <td>${esc(stockAdjustmentReasonLabel(row.reason))}</td>
        <td>${row.count}</td>
        <td>${row.up || ""}</td>
        <td>${row.down || ""}</td>
      </tr>`).join("")
      + `<tr class="statement-total"><td>${t("reports.adjustmentsNet")}</td><td></td><td>${summary.up}</td><td>${summary.down}</td></tr>`
    : `<tr><td colspan="4" class="empty-state">${t("reports.noAdjustments")}</td></tr>`;
}

async function saveExpense(input) {
  const existing = input.id ? state.expenses.find((item) => item.id === input.id) : null;

  // "all stores" cannot own a document. Same refusal saveProduct() and
  // saveService() make: the record has to name one branch.
  if (!existing && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreBeforeAdd"));
    return;
  }
  if (!existing && !state.currentStoreId) {
    showToast(t("toast.loadingStore"));
    return;
  }
  if (!state.db || !state.user || !state.businessOwnerUid) {
    showToast(t("toast.signInToAddStore"));
    return;
  }

  clearExpenseErrors();

  // Strictly positive. clampNonNegativeNumber() would accept 0, and a zero
  // expense is a mis-key rather than a record; the rules refuse it too.
  const amount = clampNonNegativeNumber(input.amount, MAX_MONEY);
  if (amount === null || amount <= 0) {
    setExpenseError("#expenseAmountError", t("expenses.amountRequired"));
    return;
  }

  const spentAtRaw = String(input.spentAt || "").trim();
  if (!spentAtRaw) {
    setExpenseError("#expenseDateError", t("expenses.dateRequired"));
    return;
  }
  // Parsed as local midnight, not UTC: new Date("2026-08-21") is UTC midnight,
  // which is the previous day in any timezone west of Greenwich and the wrong
  // month on the 1st for anyone east of it.
  const [y, m, d] = spentAtRaw.split("-").map(Number);
  const spentAt = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
  if (Number.isNaN(spentAt.getTime())) {
    setExpenseError("#expenseDateError", t("expenses.dateRequired"));
    return;
  }
  // Compared date to date, not instant to instant. spentAt is anchored at local
  // noon, so an instant comparison against now + 24h let tomorrow through after
  // midday and refused it before -- the guard's answer depended on the time of
  // day it was asked.
  const todayKey = localDateInputValue(new Date());
  if (localDateInputValue(spentAt) > todayKey) {
    setExpenseError("#expenseDateError", t("expenses.dateFuture"));
    return;
  }
  // A lower bound as well. An expense mis-keyed to 2019 saved, toasted success,
  // and then appeared in no month view at all.
  if (spentAt.getTime() < Date.now() - EXPENSE_BACKDATE_LIMIT_DAYS * 24 * 60 * 60 * 1000) {
    setExpenseError("#expenseDateError", t("expenses.dateTooOld"));
    return;
  }

  const category = EXPENSE_CATEGORIES.includes(input.category) ? input.category : "other";
  // Falls back to the category's default rather than to a fixed "indirect", so a
  // form that somehow submits without the field still classifies a commission as
  // direct. firestore.rules permits only these two values, so anything else
  // would be refused rather than stored.
  const nature = (input.nature === "direct" || input.nature === "indirect")
    ? input.nature
    : (EXPENSE_NATURE_BY_CATEGORY[category] || "indirect");
  const paidFrom = input.paidFrom === "till" ? "till" : "other";
  const note = String(input.note || "").trim().slice(0, 200);

  const saveButton = qs("#saveExpenseButton");
  if (saveButton?.disabled) return;
  if (saveButton) saveButton.disabled = true;

  try {
    const { collection, doc, serverTimestamp, setDoc, Timestamp, writeBatch } = state.firebaseApi.firestore;
    const id = existing?.id || doc(collection(state.db, "users", state.businessOwnerUid, "expenses")).id;
    const payload = {
      // An existing expense keeps the branch and the recorder it was created
      // with -- firestore.rules enforces both, so sending anything else here
      // would be refused rather than silently moving spending between branches.
      storeId: existing?.storeId || state.currentStoreId,
      recordedByUid: existing?.recordedByUid || state.user.uid,
      category,
      // Always written, never omitted. It is one word on a document that is
      // already being written, and an expense that carries it explicitly is one
      // the Profit Report does not have to infer anything about.
      nature,
      amount,
      paidFrom,
      spentAt: Timestamp.fromDate(spentAt),
      ...(note ? { note } : {}),
      ...(existing ? {} : { createdAt: serverTimestamp() })
    };
    // Batched with its audit entry, so the record and the evidence that it was
    // written land together or not at all. A batch queues offline exactly as a
    // single write does.
    //
    // Still not awaited: offline the promise does not settle until reconnect,
    // and awaiting would hang the dialog with no signal -- the state this
    // collection is specifically meant to work in.
    const batch = writeBatch(state.db);
    batch.set(doc(state.db, "users", state.businessOwnerUid, "expenses", id), payload, { merge: true });
    batch.set(doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs")),
      moneyAuditEntry(existing ? "EXPENSE_UPDATED" : "EXPENSE_RECORDED", {
        expenseId: id, storeId: payload.storeId, amount, category
      }));
    batch.commit().catch((error) => {
      console.warn(error);
      showToast(t("toast.expenseFailed"));
    });
    qs("#expenseDialog").close();
    showToast(t(existing ? "toast.expenseUpdated" : "toast.expenseSaved"));
  } catch (error) {
    console.warn(error);
    setExpenseError("#expenseFormError", t("toast.expenseFailed"));
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

async function deleteExpense(expenseId) {
  // Owner-only, matching firestore.rules. A manager records; only the owner
  // corrects.
  if (!isOwnerRole()) return;
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense) return;
  if (!await askConfirm(t("expenses.confirmDelete"))) return;
  try {
    const { collection, doc, writeBatch } = state.firebaseApi.firestore;
    // Deletable by design -- a mis-keyed expense is a human error and the shop
    // must be able to remove it. Which is exactly why the removal is batched
    // with an audit entry: every other money-touching collection refuses
    // deletion outright, and a document that can vanish with no trace is a note
    // rather than a book.
    //
    // Not awaited, for the same reason saveExpense() does not await: offline the
    // promise does not settle until reconnect, so awaiting would swallow the
    // toast entirely. One collection must not have two offline behaviours
    // depending on which button was pressed.
    const batch = writeBatch(state.db);
    batch.delete(doc(state.db, "users", state.businessOwnerUid, "expenses", expenseId));
    batch.set(doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs")),
      moneyAuditEntry("EXPENSE_DELETED", {
        expenseId, storeId: expense.storeId,
        amount: safeNumber(expense.amount), category: expense.category
      }));
    batch.commit().catch((error) => {
      console.warn(error);
      showToast(t("toast.expenseFailed"));
    });
    showToast(t("toast.expenseDeleted"));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.expenseFailed"));
  }
}

// firestore.rules pins recordedByUid to the caller, so this is the one thing an
// owner reviewing a manager's spending can rely on. Blank rather than a raw uid
// when the member is not loaded: a hex string in a table teaches nobody
// anything, and the owner's own entries do not need attributing to themselves.
function recorderName(expense) {
  const uid = expense?.recordedByUid;
  if (!uid || uid === state.businessOwnerUid) return "";
  const member = (state.members || []).find((item) => item.id === uid);
  return String(member?.name || "").trim();
}

function renderExpenses() {
  const view = qs("#expenses");
  const table = qs("#expensesTable");
  const totals = qs("#expenseTotals");
  if (!view || !table || !totals) return;

  // canOpenView() is the real gate -- expenses is absent from
  // CASHIER_ALLOWED_VIEWS -- and applyRoleViewVisibility() hides the nav item.
  // Nothing to render for a cashier, and state.expenses is empty for them
  // anyway because subscribeToExpenses() does not subscribe.
  // Emptied, not merely skipped. A demoted manager's rows would otherwise sit
  // in a section hidden by CSS with every wages figure still in the DOM.
  if (!isManagerOrOwnerRole()) {
    table.innerHTML = "";
    totals.innerHTML = "";
    return;
  }

  const monthInput = qs("#expenseMonthInput");
  if (monthInput && monthInput.value !== state.expenseMonthSelection) {
    monthInput.value = state.expenseMonthSelection;
  }

  const scoped = storeExpenses();
  // Re-anchored while the screen has never been touched, so a till left open
  // across midnight on the 1st does not keep showing last month -- and every
  // expense recorded that morning invisible until someone notices the box.
  if (!state.expenseMonthTouched) state.expenseMonthSelection = localMonthKey(new Date());
  const monthKey = state.expenseMonthSelection;
  const summary = summariseExpenses(scoped, monthKey);

  totals.innerHTML = [
    controlTile(t("expenses.monthTotal"), money(summary.total), summary.total > 0 ? "warn" : "",
      t("expenses.monthCount", { count: String(summary.count) })),
    // The docx section 9 split. Two tiles rather than one, because they are two
    // lines of the statement -- and neither is a subtotal of the other: they add
    // to the month total above and to nothing else.
    controlTile(t("expenses.direct"), money(summary.direct), "",
      t("expenses.directNote")),
    controlTile(t("expenses.indirect"), money(summary.indirect), "",
      t("expenses.indirectNote")),
    // Shown separately because it is the figure that explains a short drawer.
    // Nothing subtracts it from expected cash yet -- DESIGN-purchases.md 8.3 --
    // so the note says what it means rather than implying the shift knows.
    controlTile(t("expenses.fromTill"), money(summary.fromTill), "",
      summary.fromTill > 0 ? t("expenses.fromTillNote") : ""),
    controlTile(t("expenses.topCategory"),
      summary.topCategory ? expenseCategoryLabel(summary.topCategory) : "—",
      "",
      summary.topCategory ? money(summary.topAmount) : "")
  ].join("");

  renderLandedCostSection(monthKey);

  const rows = scoped
    .filter((expense) => {
      const at = expenseSpentAt(expense);
      return at ? localMonthKey(at) === monthKey : false;
    })
    .sort((a, b) => {
      const bt = expenseSpentAt(b)?.getTime() || 0;
      const at = expenseSpentAt(a)?.getTime() || 0;
      return bt - at;
    });

  if (!rows.length) {
    const message = state.currentStoreId ? t("expenses.empty") : t("expenses.emptyNoStore");
    // Seven columns since phase 5 added Nature. A colspan that disagrees with
    // the header leaves the empty-state message boxed under part of the table.
    table.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(message)}</td></tr>`;
    return;
  }

  const canEdit = isOwnerRole();
  table.innerHTML = rows.map((expense) => {
    const at = expenseSpentAt(expense);
    return `<tr>
      <td>${esc(at ? at.toLocaleDateString() : "—")}</td>
      <td>${esc(expenseCategoryLabel(expense.category))}</td>
      <td>${esc(expenseNatureLabel(expenseNature(expense)))}</td>
      <td>${esc(expense.note || "")}${recorderName(expense) ? ` <span class="muted">${esc(t("expenses.recordedBy", { name: recorderName(expense) }))}</span>` : ""}</td>
      <td>${esc(t(expense.paidFrom === "till" ? "expenses.paidFromTill" : "expenses.paidFromOther"))}</td>
      <td><strong>${money(safeNumber(expense.amount))}</strong></td>
      <td>${canEdit ? `
        <button class="ghost-button compact" type="button" data-edit-expense="${esc(expense.id)}">${esc(t("expenses.edit"))}</button>
        <button class="ghost-button compact" type="button" data-delete-expense="${esc(expense.id)}">${esc(t("expenses.delete"))}</button>` : ""}</td>
    </tr>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Purchases -- DESIGN-purchases.md phase B.
//
// A delivery is recorded as a BATCH: how many units, and what was actually paid
// for them. The unit cost is derived and deliberately not rounded (section 3),
// because 100 items for 33,333 is 333.33... and storing 333 loses money against
// the invoice on every delivery, forever.

// The weighted average, and the two ways it can go wrong.
//
// Returns the unit cost the product should carry AFTER this delivery.
// `costKnown` is whether this product has ever had a purchase recorded --
// section 4.3: the FIRST purchase sets the cost outright, later ones average.
// Reading an absent cost as zero and averaging against it would understate cost
// and overstate profit on a shop's very first delivery, because every product in
// production today has no cost at all.
function nextUnitCost({ oldQuantity, oldUnitCost, costKnown, deliveredQuantity, totalPaid }) {
  const delivered = safeNumber(deliveredQuantity);
  const paid = safeNumber(totalPaid);
  // The caller refuses these before writing; the guard is here so the function
  // is total, because it is the one thing standing between a restock and a
  // division by zero.
  if (delivered <= 0) return safeNumber(oldUnitCost);
  const batchUnitCost = paid / delivered;

  // Section 4.3. No history to weight against.
  if (!costKnown) return batchUnitCost;

  // Section 4.2, edge case one. Stock can be NEGATIVE -- stockCountInRange()
  // permits it deliberately, because an offline oversell is taken and flagged
  // rather than refused. With nothing on the shelf there is no old value to
  // weight, and at exactly oldQuantity === -delivered the denominator is zero.
  const oldQty = safeNumber(oldQuantity);
  if (oldQty <= 0) return batchUnitCost;

  const newQuantity = oldQty + delivered;
  if (newQuantity <= 0) return batchUnitCost;
  return (oldQty * safeNumber(oldUnitCost) + paid) / newQuantity;
}

// Landed costs -- DESIGN-landed-costs.md phase 1.
//
// Freight, duty, clearing and transport are paid on a DELIVERY, not on a
// product. Until they are spread across the products that delivery brought in,
// they either reduce profit in the wrong month (logged as an expense) or vanish
// (not logged at all). Both undervalue stock and both make margin read HIGH,
// which is the direction a shop prices against.
//
// Nothing calls these yet. The arithmetic is proven before anything depends on
// it, which is the order DESIGN-vat.md established.

// The seven named cost types from DESIGN-landed-costs.md section 3. A closed set
// of fields rather than a list, so the rules clause that will validate them in
// phase 2 stays flat and constant-cost.
const DELIVERY_COST_TYPES = ["freight", "importDuty", "clearing", "transport",
                             "handling", "insurance", "otherCost"];

// A negative field is FLOORED AT ZERO rather than allowed to subtract. A
// negative freight is a mis-key or a supplier discount; either way, letting it
// reduce the total moves money quietly out of inventory, and section 4.3 refuses
// negatives at the line level for exactly the same reason.
function deliveryAdditionalTotal(costs) {
  let total = 0;
  for (const type of DELIVERY_COST_TYPES) {
    total += Math.max(0, safeNumber(costs?.[type]));
  }
  return total;
}

// Spread `additionalTotal` across the delivery's lines.
//
// Returns { amounts, basis, ok, error }. `amounts` is parallel to `lines`.
// `basis` is the basis ACTUALLY USED, which is not always the one asked for --
// see the value-with-no-value case below. The delivery header records this one,
// because a header claiming 'value' over an allocation done by quantity is a
// book that lies about its own arithmetic.
//
// The invariant the whole feature is judged on, and the reason this function
// exists rather than three lines at the call site:
//
//   sum(amounts) === additionalTotal, EXACTLY.
//
// 1,000,000 across three equal lines is 333,333.33... each, and three of those
// is not 1,000,000. Dropping the difference means the delivery no longer
// reconciles to the invoice -- the same trap DESIGN-purchases.md section 3
// defused for unit cost, arriving from the other direction.
function allocateLandedCosts({ lines, additionalTotal, basis, manualAmounts } = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const zero = rows.map(() => 0);
  const total = safeNumber(additionalTotal);
  const asked = basis === "quantity" || basis === "manual" ? basis : "value";

  if (total < 0) {
    return { amounts: zero, basis: asked, ok: false, error: "negativeTotal" };
  }
  if (!rows.length) {
    // No lines and no money is fine. No lines and money to spread is not: there
    // is nowhere for it to go, and returning ok would lose it.
    return { amounts: zero, basis: asked, ok: total === 0, error: total === 0 ? "" : "noLines" };
  }
  // Section 3.2. A delivery with no additional costs allocates nothing and is
  // byte-identical to what the restock path writes today. This is the case that
  // will be exercised most, so it is the one that short-circuits.
  if (total === 0) return { amounts: zero, basis: asked, ok: true, error: "" };

  if (asked === "manual") {
    const manual = Array.isArray(manualAmounts) ? manualAmounts : [];
    // One amount per line, checked before the sum. A short list would read its
    // missing entries as zero and could still balance -- so a caller that lost a
    // line would get a plausible allocation with a product silently carrying no
    // landed cost, rather than an error. The screen always supplies one box per
    // line; a length that disagrees is a bug, not an input.
    if (manual.length !== rows.length) {
      return { amounts: zero, basis: "manual", ok: false, error: "manualLength" };
    }
    const amounts = rows.map((_, i) => safeNumber(manual[i]));
    if (amounts.some((amount) => amount < 0)) {
      return { amounts: zero, basis: "manual", ok: false, error: "negativeAmount" };
    }
    const sum = amounts.reduce((a, b) => a + b, 0);
    // Refused, never corrected. Silently rescaling a manual allocation to fit
    // would defeat the only reason anyone chooses manual.
    if (Math.abs(sum - total) > 1e-6) {
      return { amounts: zero, basis: "manual", ok: false, error: "manualMismatch", difference: total - sum };
    }
    return { amounts, basis: "manual", ok: true, error: "" };
  }

  // A negative goods cost or a negative quantity is not a delivery line.
  const goods = rows.map((line) => safeNumber(line?.goodsCost));
  const quantities = rows.map((line) => safeNumber(line?.quantity));
  if (goods.some((g) => g < 0) || quantities.some((q) => q < 0)) {
    return { amounts: zero, basis: asked, ok: false, error: "negativeLine" };
  }

  let used = asked;
  let weights = asked === "quantity" ? quantities : goods;
  let weightTotal = weights.reduce((a, b) => a + b, 0);

  // Section 4.3. A delivery of free samples with a freight bill cannot be split
  // by a value that is zero. Fall back to quantity and SAY SO -- the caller
  // writes the returned basis, not the requested one.
  if (weightTotal <= 0 && asked === "value") {
    used = "quantity";
    weights = quantities;
    weightTotal = weights.reduce((a, b) => a + b, 0);
  }
  if (weightTotal <= 0) {
    return { amounts: zero, basis: used, ok: false, error: "noWeight" };
  }

  const amounts = weights.map((w) => (w / weightTotal) * total);

  // The residual. Unrounded shares still miss by float error, and a rounded
  // preview will miss by more. It goes to the LARGEST line: the correction is
  // then the smallest fraction of any line it could land on. Ties break on the
  // lowest index, so two runs on the same delivery produce the same document --
  // an offline replay that disagreed with the write it was replaying would be
  // worse than the drift it was fixing.
  let largest = 0;
  for (let i = 1; i < amounts.length; i++) {
    if (amounts[i] > amounts[largest]) largest = i;
  }
  const drift = total - amounts.reduce((a, b) => a + b, 0);
  amounts[largest] += drift;

  // Asserted HERE, not only in the tests. A pure function that can silently
  // return an allocation which does not reconcile to the invoice is the exact
  // failure this design exists to prevent, and the suite is not present at the
  // till. A negative amount after the correction means the drift exceeded the
  // line it was applied to, which should be impossible -- so it is checked.
  const settled = amounts.reduce((a, b) => a + b, 0);
  if (Math.abs(settled - total) > 1e-6 || amounts.some((a) => a < 0)) {
    return { amounts: zero, basis: used, ok: false, error: "didNotReconcile" };
  }
  return { amounts, basis: used, ok: true, error: "" };
}

// How many product lines one delivery may carry, and the number is arithmetic
// rather than taste.
//
// Receiving a line writes FIVE documents inside the transaction: the product
// itself, its cost, its cost history, the purchase, and the stock movement.
// Firestore caps a transaction at 500 writes. The delivery header and its audit
// entry take two more, and a delivery bought on credit takes a THIRD to move the
// supplier's balance (phase 2):
//
//     80 x 5 + 3 = 403 writes, against a hard ceiling of 500.
//
// Phase 2 set this at 100 in firestore.rules, having counted four writes a line
// and forgotten recordStockMovement(). 100 lines is 502 -- one over the cap, and
// it would have failed at the worst possible moment: after a shop had typed in a
// hundred-line delivery. Corrected in both places; the arithmetic is written
// down here so the next person to raise it can check the sum rather than guess.
// 80 also leaves room for a sixth per-line document without another rules change.
const DELIVERY_MAX_LINES = 80;

// Longer than a restock's 15s: a delivery reads two documents per line and
// writes five, so the wire time is a multiple of one restock's, and it is even
// further from the till than a restock is.
const DELIVERY_TRANSACTION_TIMEOUT_MS = 45000;

// Everything a delivery needs decided BEFORE a transaction opens: the
// allocation, the per-line totals, the header, and every reason to refuse.
//
// Pure, and separate from receiveDelivery() on purpose. A transaction callback
// is re-run by Firestore on contention, so anything that can be decided once
// must be -- and a refusal that only surfaces from inside the transaction
// surfaces after the shop has typed the whole delivery in, as a bare permission
// error with nothing pointing at the cause.
//
// Returns { ok, error, errorIndex, header, lines }. `error` is a code, not a
// sentence: the screen in phase 4 owns the wording.
function prepareDelivery({ lines, costs, basis, manualAmounts } = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const fail = (error, errorIndex = -1) => ({ ok: false, error, errorIndex, header: null, lines: [] });

  if (!rows.length) return fail("noLines");
  if (rows.length > DELIVERY_MAX_LINES) return fail("tooManyLines");

  // Two lines for the same product would each read the same shelf, and the
  // second write would land on top of the first -- so one of the two deliveries
  // would be silently lost, quantity and cost alike, inside a transaction that
  // reported success. Refused rather than merged, because merging two lines the
  // shop deliberately typed separately guesses at which price was meant.
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const productId = String(rows[i]?.productId || "");
    if (!productId) return fail("missingProduct", i);
    if (seen.has(productId)) return fail("duplicateProduct", i);
    seen.add(productId);

    const quantity = safeNumber(rows[i]?.quantity);
    if (!(quantity > 0) || Math.floor(quantity) !== quantity || quantity > MAX_COUNT) {
      return fail("badQuantity", i);
    }
    const goodsCost = safeNumber(rows[i]?.goodsCost);
    if (goodsCost < 0 || goodsCost > MAX_MONEY) return fail("badGoodsCost", i);
  }

  const additionalTotal = deliveryAdditionalTotal(costs);
  const allocation = allocateLandedCosts({
    lines: rows, additionalTotal, basis, manualAmounts
  });
  if (!allocation.ok) {
    return { ok: false, error: allocation.error, errorIndex: -1, header: null, lines: [],
             difference: allocation.difference };
  }

  const prepared = rows.map((line, i) => {
    const quantity = safeNumber(line.quantity);
    const goodsCost = safeNumber(line.goodsCost);
    const landedCost = allocation.amounts[i];
    const totalPaid = goodsCost + landedCost;
    return {
      productId: String(line.productId),
      productName: String(line.productName || "").slice(0, 120),
      quantity,
      goodsCost,
      landedCost,
      totalPaid,
      // Unrounded, on purpose -- DESIGN-purchases.md 3. Rounding loses money
      // against the invoice on every delivery.
      unitCost: totalPaid / quantity
    };
  });

  // DESIGN-landed-costs.md 11.4. A line that ends up costing nothing cannot be
  // written: firestore.rules has required totalPaid > 0 and unitCost > 0 since
  // phase B, and a million units at no cost each is exactly what that rule was
  // written to refuse. It happens when free goods are received alongside priced
  // ones and the basis is `value` -- the free line allocates to zero, correctly,
  // and then has nothing at all to record.
  //
  // Caught HERE rather than at the rules layer, because at the rules layer it
  // takes the whole delivery down after the fact.
  for (let i = 0; i < prepared.length; i++) {
    if (!(prepared[i].totalPaid > 0)) return fail("lineCostsNothing", i);
  }

  const goodsCost = prepared.reduce((sum, line) => sum + line.goodsCost, 0);
  const totalCost = goodsCost + additionalTotal;
  if (!(totalCost > 0)) return fail("deliveryCostsNothing");
  if (totalCost > MAX_MONEY) return fail("deliveryTooLarge");

  // The seven cost types are written explicitly, zeros included -- validDelivery()
  // requires all seven so that its "does this header add up to itself" check is
  // one expression instead of seven conditionals. DESIGN-landed-costs.md 11.1.
  const header = { goodsCost, additionalTotal, totalCost, lineCount: prepared.length,
    // The basis ACTUALLY used, which is not always the one asked for: a delivery
    // of free goods cannot be split by value and falls back to quantity. A header
    // claiming 'value' over an allocation done by quantity is a book that lies
    // about its own arithmetic.
    allocationBasis: allocation.basis };
  for (const type of DELIVERY_COST_TYPES) {
    header[type] = Math.max(0, safeNumber(costs?.[type]));
  }

  return { ok: true, error: "", errorIndex: -1, header, lines: prepared };
}

// Receive a delivery: stock up, cost history, product costs, purchase lines, and
// the header that ties them together -- all in ONE transaction.
//
// Why a transaction and not a writeBatch. DESIGN-purchases.md 13i used a batch
// for cost capture on the product form, correctly, because a product that did
// not exist a moment ago has no shelf count to race against. A delivery is the
// opposite: every line adds to a quantity and averages against a cost that
// another till may be moving underneath it. The restock path has read the shelf
// inside the transaction since phase B for exactly this reason, and a delivery
// is a restock of several products at once.
//
// All reads before any write -- Firestore refuses the other order -- and issued
// CONCURRENTLY. Sequentially, an eighty-line delivery would be 160 round trips
// before the first write, which is how a correct transaction times out anyway.
//
// Returns { ok, error, errorIndex, deliveryId, outcome }. It does not toast and
// does not touch the DOM: phase 4 owns the screen, and a function that both
// decides and renders cannot be tested without one.
async function receiveDelivery(input = {}) {
  const prep = prepareDelivery(input);
  if (!prep.ok) {
    return { ok: false, error: prep.error, errorIndex: prep.errorIndex, difference: prep.difference };
  }

  const storeId = String(input.storeId || "");
  if (!storeId || storeId === "all") return { ok: false, error: "noStore", errorIndex: -1 };
  if (!state.db || !state.user || !state.businessOwnerUid) {
    // The same refusal saveExpense() and the restock cost path make. There is
    // nowhere to put a delivery in local-only mode, and silently dropping what
    // the shop typed is worse than refusing it.
    return { ok: false, error: "needsConnection", errorIndex: -1 };
  }

  const { doc, collection, runTransaction, serverTimestamp, Timestamp } = state.firebaseApi.firestore;
  const root = ["users", state.businessOwnerUid];
  const deliveryRef = doc(collection(state.db, ...root, "deliveries"));

  // Payment terms. Spec 5.1-5.3. Absent amountPaid means PAID IN FULL, which is
  // what recording a delivery meant before terms existed -- the reading that
  // claims no debt nobody entered.
  const totalCost = safeNumber(prep.header.totalCost);
  const amountPaid = input.amountPaid === undefined || input.amountPaid === null || input.amountPaid === ""
    ? totalCost
    : Math.min(Math.max(safeNumber(input.amountPaid), 0), totalCost);
  const amountDue = Math.max(totalCost - amountPaid, 0);

  // Only a delivery linked to a supplier RECORD can move a balance. One with a
  // typed name has nowhere to put the debt, and inventing a supplier here would
  // create records nobody asked for.
  const supplierLink = supplierLinkFor(input.supplierName);
  const supplierRef = supplierLink.supplierId
    ? doc(state.db, ...root, "suppliers", supplierLink.supplierId)
    : null;
  const refs = prep.lines.map((line) => ({
    product: doc(state.db, ...root, "products", line.productId),
    cost: doc(state.db, ...root, "productCosts", line.productId)
  }));

  try {
    const attempt = runTransaction(state.db, async (transaction) => {
      const productSnaps = await Promise.all(refs.map((r) => transaction.get(r.product)));
      const costSnaps = await Promise.all(refs.map((r) => transaction.get(r.cost)));
      // Read in the READ phase with the rest. Firestore refuses a get() after
      // the first write in a transaction, so deferring this to where the
      // balance is written would fail every credit delivery.
      const supplierSnap = supplierRef ? await transaction.get(supplierRef) : null;

      // Every existence check before any write, so a delivery naming a product
      // that has since been deleted refuses whole rather than half-applying.
      for (let i = 0; i < productSnaps.length; i++) {
        if (!productSnaps[i].exists()) {
          throw new Error(t("txerror.itemGone", { name: prep.lines[i].productName }));
        }
      }

      for (let i = 0; i < prep.lines.length; i++) {
        const line = prep.lines[i];
        const before = productSnaps[i].data();
        const currentQuantity = safeNumber(before.quantity);
        const existingCost = costSnaps[i].exists() ? costSnaps[i].data() : null;

        // Recomputed from what the shelf ACTUALLY holds inside the transaction,
        // not from the copy the screen opened with. `totalPaid` here is the
        // LANDED total -- DESIGN-landed-costs.md 3.1 -- which is the whole point:
        // the freight reaches the weighted average, and from there COGS, without
        // the sale path changing at all.
        const unitCost = nextUnitCost({
          oldQuantity: currentQuantity,
          oldUnitCost: safeNumber(existingCost?.costPrice),
          costKnown: productCostKnown(existingCost),
          deliveredQuantity: line.quantity,
          totalPaid: line.totalPaid
        });

        transaction.set(doc(collection(state.db, ...root, "productCostHistory")), {
          productId: line.productId,
          storeId,
          costPrice: unitCost,
          // serverTimestamp, not the device clock: this decides which cost
          // applied to a sale, and a sale's createdAt is a serverTimestamp too.
          effectiveFrom: serverTimestamp(),
          reason: "purchase",
          createdAt: serverTimestamp()
        });
        transaction.set(refs[i].cost, {
          storeId,
          costPrice: unitCost,
          // Carried forward, never restamped -- firestore.rules pins it across
          // updates, so sending anything else is refused rather than silently
          // moving the moment cost became knowable.
          costKnownFrom: existingCost?.costKnownFrom || Timestamp.now(),
          updatedAt: serverTimestamp()
        });
        transaction.set(doc(collection(state.db, ...root, "purchases")), {
          storeId,
          productId: line.productId,
          // Denormalised, like every other purchase: the Purchase Book is a
          // record of what was paid and must survive the product being deleted.
          productName: line.productName,
          quantity: line.quantity,
          // The landed total. goodsCost and landedCost are carried alongside so
          // the drill-down can separate "what the supplier charged" from "what it
          // cost to get it here" -- neither is recoverable from the other.
          totalPaid: line.totalPaid,
          unitCost: line.unitCost,
          goodsCost: line.goodsCost,
          landedCost: line.landedCost,
          deliveryId: deliveryRef.id,
          ...(input.supplierName ? { supplierName: String(input.supplierName).slice(0, 120) } : {}),
          ...supplierLinkFor(input.supplierName),
          ...(input.supplierTin ? { supplierTin: String(input.supplierTin).slice(0, 20) } : {}),
          recordedByUid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
        transaction.update(refs[i].product, {
          quantity: currentQuantity + line.quantity,
          updatedAt: serverTimestamp(),
          // The existing reason, deliberately. A delivery line IS a restock, and
          // validStockMovementUpdate()'s closed reason list already carries it --
          // inventing a "delivery" reason would be a rules change on the one
          // allowlist DESIGN-purchases.md 9 calls the trap.
          movementReason: "restock"
        });
        // The fifth write a line pays for, and the one the DELIVERY_MAX_LINES
        // arithmetic forgot in phase 2. Without it the stock ledger cannot
        // reconcile -- units would appear on a shelf with nothing explaining them.
        recordStockMovement(transaction, {
          productId: line.productId, productName: line.productName, storeId,
          reason: "restock", delta: line.quantity, quantityBefore: currentQuantity
        });
      }

      transaction.set(deliveryRef, {
        storeId,
        ...prep.header,
        receivedAt: Timestamp.fromDate(input.receivedAt instanceof Date ? input.receivedAt : new Date()),
        ...(input.reference ? { reference: String(input.reference).slice(0, 60) } : {}),
        ...(input.supplierName ? { supplierName: String(input.supplierName).slice(0, 120) } : {}),
        ...(input.supplierTin ? { supplierTin: String(input.supplierTin).slice(0, 20) } : {}),
        ...(input.note ? { note: String(input.note).slice(0, 200) } : {}),
        ...supplierLink,
        amountPaid,
        ...(input.paymentMethod ? { paymentMethod: String(input.paymentMethod) } : {}),
        recordedByUid: state.user?.uid || null,
        createdAt: serverTimestamp()
      });

      // What is still owed goes onto the supplier's balance. Stored rather than
      // added up from delivery history at read time, because that history is
      // bounded by ACCOUNTS_HISTORY_LIMIT and a client adding up the deliveries
      // it happens to hold would understate the debt -- see the rules comment
      // on /suppliers/payments.
      if (supplierRef && amountDue > 0) {
        if (!supplierSnap || !supplierSnap.exists()) {
          throw new Error(t("txerror.supplierGone"));
        }
        transaction.update(supplierRef, {
          balanceOwed: safeNumber(supplierSnap.data().balanceOwed) + amountDue,
          updatedAt: serverTimestamp()
        });
      }

      // ONE entry for the delivery, not one per line. Every write in a
      // transaction pays its own rules evaluation, and a per-line entry would be
      // a sixth document each -- for a trail /stockMovements already keeps, per
      // product, and which the stock ledger reconciles against.
      transaction.set(doc(collection(state.db, ...root, "auditLogs")),
        moneyAuditEntry("DELIVERY_RECEIVED", {
          deliveryId: deliveryRef.id,
          storeId,
          amount: prep.header.totalCost,
          itemCount: prep.header.lineCount
        }));
    });

    // Unlike a sale, a delivery that times out is NOT quietly accepted: there is
    // no offline queue behind it, so an unconfirmed transaction may or may not
    // have landed. The shop is told exactly that rather than shown a success it
    // cannot rely on when counting the shelf.
    const outcome = await awaitDeliveryTransaction(attempt);
    if (outcome === "unconfirmed") return { ok: false, error: "unconfirmed", errorIndex: -1 };
  } catch (error) {
    console.warn("[receiveDelivery]", error);
    return { ok: false, error: "transactionFailed", errorIndex: -1, cause: error };
  }

  return { ok: true, error: "", errorIndex: -1, deliveryId: deliveryRef.id };
  // A delivery rewrites the weighted average for every line it carries, so the
  // fetched cost map is stale the moment it commits.
  invalidateProductCosts();
}

async function awaitDeliveryTransaction(attempt) {
  let timeoutId = null;
  try {
    return await Promise.race([
      attempt.then(() => "committed"),
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve("unconfirmed"), DELIVERY_TRANSACTION_TIMEOUT_MS);
      })
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// Removing a mis-keyed delivery takes its purchase lines with it.
//
// Deleting the header alone would leave the Purchase Book holding lines for a
// delivery that no longer exists -- and re-recording the delivery, which is how
// a wrong amount is corrected, would then count the money twice. What CANNOT be
// undone is the weighted average those lines already fed: that is a cached
// derivation computed once inside the transaction above, and DESIGN-purchases.md
// 12 accepted it for /purchases before this. Correcting cost means recording a
// new delivery, not deleting an old one.
//
// A batch rather than a transaction: nothing here is read-modify-write.
async function deleteDelivery(deliveryId) {
  const id = String(deliveryId || "");
  if (!id) return { ok: false, error: "noDelivery" };
  if (!state.db || !state.user || !state.businessOwnerUid) {
    return { ok: false, error: "needsConnection" };
  }
  const { doc, collection, query, where, getDocs, writeBatch } = state.firebaseApi.firestore;
  const root = ["users", state.businessOwnerUid];

  try {
    // Queried rather than read out of state.purchases: the client cache is
    // windowed to the newest N, and a delivery old enough to have fallen out of
    // it would have its lines silently left behind.
    const lines = await getDocs(query(
      collection(state.db, ...root, "purchases"), where("deliveryId", "==", id)));

    const batch = writeBatch(state.db);
    lines.forEach((line) => batch.delete(line.ref));
    batch.delete(doc(state.db, ...root, "deliveries", id));
    // Audited, because this is a money document that can vanish. Every other
    // money-touching collection in firestore.rules refuses deletion outright;
    // deliveries and purchases are deletable by decision, and a document that
    // can vanish without a trace is a note rather than a book.
    batch.set(doc(collection(state.db, ...root, "auditLogs")),
      moneyAuditEntry("DELIVERY_DELETED", { deliveryId: id, itemCount: lines.size }));
    await batch.commit();
    return { ok: true, error: "", lineCount: lines.size };
  } catch (error) {
    console.warn("[deleteDelivery]", error);
    return { ok: false, error: "deleteFailed", cause: error };
  }
}


// ===========================================================================
// The Receive Stock screen -- DESIGN-landed-costs.md phase 4, docx 5 and 6.

// prepareDelivery() returns codes, not sentences, so that the arithmetic can be
// tested without a DOM and translated without touching it. This is the one place
// that turns a code into something a shop can act on. Every code the two
// functions can return is listed; an unrecognised one falls back to the generic
// failure rather than printing a key.
function deliveryErrorMessage(result, lines) {
  const index = Number.isInteger(result?.errorIndex) ? result.errorIndex : -1;
  const named = index >= 0 && lines?.[index]
    ? (productNameById(lines[index].productId) || t("deliveries.linePickProduct"))
    : "";
  switch (result?.error) {
    case "noLines": return t("deliveries.errNoLines");
    case "tooManyLines": return t("deliveries.errTooManyLines", { max: String(DELIVERY_MAX_LINES) });
    case "duplicateProduct": return t("deliveries.errDuplicateProduct", { name: named });
    case "missingProduct": return t("deliveries.errMissingProduct");
    case "badQuantity": return t("deliveries.errBadQuantity", { line: String(index + 1) });
    case "badGoodsCost": return t("deliveries.errBadGoodsCost", { line: String(index + 1) });
    case "lineCostsNothing": return t("deliveries.errLineCostsNothing", { name: named });
    case "deliveryCostsNothing": return t("deliveries.errDeliveryCostsNothing");
    case "deliveryTooLarge": return t("deliveries.errDeliveryTooLarge");
    case "manualLength": return t("deliveries.errManualLength");
    case "negativeAmount": return t("deliveries.errNegativeAmount");
    case "negativeLine": return t("deliveries.errBadGoodsCost", { line: String(index + 1) });
    case "noWeight": return t("deliveries.errNoWeight");
    case "noStore": return t("deliveries.errNoStore");
    case "needsConnection": return t("deliveries.errNeedsConnection");
    case "unconfirmed": return t("deliveries.errUnconfirmed");
    case "noDelivery": return t("deliveries.errNoDelivery");
    case "deleteFailed": return t("deliveries.errDeleteFailed");
    case "manualMismatch": {
      // Signed, and the sign is the whole message: "you are 100 short" and "you
      // are 100 over" are different corrections, and a shop given the wrong one
      // adjusts in the wrong direction.
      const difference = safeNumber(result.difference);
      return difference >= 0
        ? t("deliveries.errManualMismatch", { short: money(difference) })
        : t("deliveries.errManualMismatchOver", { over: money(-difference) });
    }
    default: return t("deliveries.errTransactionFailed");
  }
}

function productNameById(productId) {
  return state.products.find((item) => item.id === productId)?.name || "";
}

function emptyDeliveryDraft() {
  const costs = {};
  for (const type of DELIVERY_COST_TYPES) costs[type] = "";
  return {
    lines: [{ productId: "", quantity: "", goodsCost: "", manual: "" }],
    costs,
    basis: "value"
  };
}

function storeDeliveries() {
  if (!state.currentStoreId) return [];
  if (state.currentStoreId === "all") return state.deliveries;
  return state.deliveries.filter((delivery) => delivery.storeId === state.currentStoreId);
}

function deliveryReceivedAt(delivery) {
  const at = delivery?.receivedAt;
  if (at?.toDate) return at.toDate();
  if (at instanceof Date) return at;
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function deliveryBasisLabel(basis) {
  if (basis === "quantity") return t("deliveries.basisQuantity");
  if (basis === "manual") return t("deliveries.basisManual");
  return t("deliveries.basisValue");
}

async function subscribeToDeliveries() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeDeliveries) state.unsubscribeDeliveries();
  // A cashier is refused this collection by firestore.rules -- a delivery header
  // states what a shipment cost. Subscribing anyway would put a
  // permission-denied in every cashier's console on every sign-in.
  if (!isManagerOrOwnerRole()) {
    state.deliveries = [];
    return;
  }
  try {
    const { collection, limit, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "deliveries");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.deliveries = [];
      scheduleRenderAll();
      return;
    }
    const deliveriesQuery = queryStoreIds === null
      ? query(ref, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT))
      : query(ref, where("storeId", "in", queryStoreIds),
              orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT));
    state.unsubscribeDeliveries = onSnapshot(
      deliveriesQuery,
      (snapshot) => {
        state.deliveries = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        scheduleRenderAll();
      },
      (error) => {
        console.warn("[deliveries listener]", error.code || error, "queryStoreIds=", queryStoreIds);
      }
    );
  } catch (error) {
    console.warn(error);
  }
}

// Paid / Partially paid / On credit, DERIVED from the money rather than stored.
// A status somebody can set by hand is a status that disagrees with the figures.
//
// A delivery written before payment terms existed carries no amountPaid, and
// absent reads as PAID IN FULL -- the reading that claims no debt nobody
// entered. Spec 5.1.
function deliveryPaymentStatus(delivery) {
  const total = safeNumber(delivery?.totalCost);
  const paid = delivery?.amountPaid === undefined || delivery?.amountPaid === null
    ? total
    : safeNumber(delivery.amountPaid);
  const due = Math.max(total - paid, 0);
  if (due <= 0) return { key: "deliveries.statusPaid", due: 0, paid, total };
  if (paid > 0) return { key: "deliveries.statusPartial", due, paid, total };
  return { key: "deliveries.statusCredit", due, paid, total };
}

function summariseDeliveries(deliveries, monthKey) {
  let total = 0;
  let landed = 0;
  let units = 0;
  let count = 0;
  for (const delivery of deliveries) {
    const at = deliveryReceivedAt(delivery);
    if (!at || localMonthKey(at) !== monthKey) continue;
    count++;
    total += safeNumber(delivery.totalCost);
    landed += safeNumber(delivery.additionalTotal);
    units += safeNumber(delivery.lineCount);
  }
  return { total, landed, units, count };
}

function renderDeliveries() {
  const table = qs("#deliveriesTable");
  const totals = qs("#deliveryTotals");
  if (!table || !totals) return;
  // Emptied, not merely skipped: a demoted manager's rows would otherwise sit in
  // a section hidden by CSS with every buying price still in the DOM.
  if (!isManagerOrOwnerRole()) {
    table.innerHTML = "";
    totals.innerHTML = "";
    return;
  }

  if (!state.deliveryMonthTouched) state.deliveryMonthSelection = localMonthKey(new Date());
  const monthInput = qs("#deliveryMonthInput");
  if (monthInput && monthInput.value !== state.deliveryMonthSelection) {
    monthInput.value = state.deliveryMonthSelection;
  }

  const scoped = storeDeliveries();
  const monthKey = state.deliveryMonthSelection;
  const summary = summariseDeliveries(scoped, monthKey);

  totals.innerHTML = [
    controlTile(t("deliveries.monthTotal"), money(summary.total), "",
      t("deliveries.monthCount", {
        count: String(summary.count),
        delivery: t(summary.count === 1 ? "deliveries.deliverySingular" : "deliveries.deliveryPlural"),
        units: String(summary.units),
        unit: t(summary.units === 1 ? "deliveries.lineSingular" : "deliveries.linePlural")
      })),
    // The number this whole design exists to make visible: money that used to
    // have nowhere to go, now sitting in the value of the stock instead of
    // reducing this month's profit.
    controlTile(t("deliveries.landedTotal"), money(summary.landed), "",
      summary.landed > 0 ? t("deliveries.landedNote") : t("deliveries.landedNone"))
  ].join("");

  const canDelete = isOwnerRole();
  const rows = scoped
    .filter((delivery) => {
      const at = deliveryReceivedAt(delivery);
      return at ? localMonthKey(at) === monthKey : false;
    })
    .sort((a, b) => (deliveryReceivedAt(b)?.getTime() || 0) - (deliveryReceivedAt(a)?.getTime() || 0));

  if (!rows.length) {
    table.innerHTML = `<tr><td colspan="10" class="muted">${
      state.currentStoreId ? t("deliveries.empty") : t("deliveries.emptyNoStore")
    }</td></tr>`;
    return;
  }

  table.innerHTML = rows.map((delivery) => {
    const at = deliveryReceivedAt(delivery);
    return `<tr>
      <td>${at ? at.toLocaleDateString() : "-"}</td>
      <td>${esc(delivery.reference || "-")}</td>
      <td>${esc(delivery.supplierName || "-")}</td>
      <td>${safeNumber(delivery.lineCount)}</td>
      <td>${money(safeNumber(delivery.goodsCost))}</td>
      <td>${money(safeNumber(delivery.additionalTotal))}</td>
      <td>${money(safeNumber(delivery.totalCost))}</td>
      <td>${esc(deliveryBasisLabel(delivery.allocationBasis))}</td>
      <td>${(() => {
        const pay = deliveryPaymentStatus(delivery);
        return pay.due > 0
          ? `<span class="status">${t(pay.key)}</span> <span class="muted">${money(pay.due)}</span>`
          : `<span class="status healthy">${t(pay.key)}</span>`;
      })()}</td>
      <td>${canDelete
        ? `<button class="ghost-button compact danger" type="button" data-delete-delivery="${esc(delivery.id)}">${t("deliveries.deleteButton")}</button>`
        : "-"}</td>
    </tr>`;
  }).join("");
}

// --- the dialog ------------------------------------------------------------

function deliveryDraftLines() {
  // The shape prepareDelivery() takes. Strings out of the DOM become numbers
  // exactly once, here, so the preview and the write path cannot disagree about
  // what the shop typed.
  return state.deliveryDraft.lines.map((line) => ({
    productId: line.productId,
    productName: productNameById(line.productId),
    quantity: safeNumber(line.quantity),
    goodsCost: safeNumber(line.goodsCost)
  }));
}

function renderDeliveryLines() {
  const container = qs("#deliveryLines");
  if (!container) return;
  const products = storeProducts()
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const manual = state.deliveryDraft.basis === "manual";

  container.innerHTML = state.deliveryDraft.lines.map((line, index) => {
    const options = [`<option value="">${t("deliveries.linePickProduct")}</option>`]
      .concat(products.map((product) =>
        `<option value="${esc(product.id)}"${product.id === line.productId ? " selected" : ""}>${esc(product.name)}</option>`))
      .join("");
    return `<div class="delivery-line${manual ? " has-manual" : ""}" data-line="${index}">
      <label><span>${t("deliveries.lineProduct")}</span>
        <select data-field="productId">${options}</select>
      </label>
      <label><span>${t("deliveries.lineQuantity")}</span>
        <input data-field="quantity" type="number" min="1" step="1" inputmode="numeric"
               value="${esc(line.quantity)}" autocomplete="off" />
      </label>
      <label><span>${t("deliveries.lineGoodsCost")}</span>
        <input data-field="goodsCost" type="number" min="0" step="1" inputmode="decimal"
               value="${esc(line.goodsCost)}" autocomplete="off" />
      </label>
      ${manual ? `<label><span>${t("deliveries.manualLabel")}</span>
        <input data-field="manual" type="number" min="0" step="1" inputmode="decimal"
               value="${esc(line.manual)}" autocomplete="off" />
      </label>` : ""}
      <button class="icon-button line-remove" type="button" data-remove-line="${index}"
              aria-label="${t("deliveries.removeLine")}">&times;</button>
    </div>`;
  }).join("");
}

function renderDeliveryCostFields() {
  const container = qs("#deliveryCostFields");
  if (!container) return;
  container.innerHTML = DELIVERY_COST_TYPES.map((type) => {
    const key = `deliveries.cost${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    return `<label><span>${t(key)}</span>
      <input data-cost="${type}" type="number" min="0" step="1" inputmode="decimal"
             value="${esc(state.deliveryDraft.costs[type])}" autocomplete="off" />
    </label>`;
  }).join("");
}

// The docx section 6 table, recomputed on every keystroke by the SAME function
// the write path calls. A preview computed a second way is a preview that can
// disagree with what is saved, and the number a shop reconciles against its
// supplier's invoice is exactly the wrong one to have two opinions about.
function renderDeliveryPreview() {
  const table = qs("#deliveryPreviewTable");
  const errorSlot = qs("#deliveryFormError");
  const goodsSlot = qs("#deliveryGoodsTotal");
  const additionalSlot = qs("#deliveryAdditionalTotal");
  const fellBack = qs("#deliveryBasisFellBack");
  const saveButton = qs("#saveDeliveryButton");
  if (!table) return;

  const lines = deliveryDraftLines();
  const costs = state.deliveryDraft.costs;
  const additionalTotal = deliveryAdditionalTotal(costs);
  if (additionalSlot) additionalSlot.textContent = t("deliveries.additionalTotal", { value: money(additionalTotal) });
  if (goodsSlot) {
    goodsSlot.textContent = t("deliveries.goodsTotal", {
      value: money(lines.reduce((sum, line) => sum + line.goodsCost, 0))
    });
  }

  const hint = qs("#deliveryBasisHint");
  if (hint) {
    hint.textContent = t(state.deliveryDraft.basis === "quantity" ? "deliveries.basisQuantityHint"
      : state.deliveryDraft.basis === "manual" ? "deliveries.basisManualHint"
      : "deliveries.basisValueHint");
  }

  const prep = prepareDelivery({
    lines,
    costs,
    basis: state.deliveryDraft.basis,
    manualAmounts: state.deliveryDraft.basis === "manual"
      ? state.deliveryDraft.lines.map((line) => safeNumber(line.manual))
      : undefined
  });

  if (!prep.ok) {
    // The preview is emptied rather than left showing the last valid state. A
    // stale table beside a fresh error reads as though the error is advisory.
    table.innerHTML = `<tr><td colspan="6" class="muted">${t("deliveries.emptyPreview")}</td></tr>`;
    if (errorSlot) {
      // "no lines yet" is the state every dialog opens in. Showing it as an
      // error the moment the dialog opens trains people to ignore the slot.
      errorSlot.textContent = prep.error === "noLines" || prep.error === "missingProduct"
        ? "" : deliveryErrorMessage(prep, lines);
    }
    if (fellBack) fellBack.hidden = true;
    if (saveButton) saveButton.disabled = true;
    return;
  }

  if (errorSlot) errorSlot.textContent = "";
  if (saveButton) saveButton.disabled = false;
  // Said out loud, because the header will record the basis actually used and a
  // shop that asked for one and got another should not have to notice.
  //
  // The TEXT as well as the visibility. The first version toggled `hidden` and
  // never set textContent, so the notice appeared as an empty paragraph -- the
  // fallback was announced by a gap. Caught by rendering it, not by reading it.
  if (fellBack) {
    const swapped = prep.header.allocationBasis !== state.deliveryDraft.basis;
    fellBack.hidden = !swapped;
    fellBack.textContent = swapped ? t("deliveries.basisFellBack") : "";
  }

  const rows = prep.lines.map((line) => `<tr>
    <td>${esc(line.productName || productNameById(line.productId))}</td>
    <td>${line.quantity}</td>
    <td>${money(line.goodsCost)}</td>
    <td>${money(line.landedCost)}</td>
    <td>${money(line.totalPaid)}</td>
    <td>${money(line.unitCost)}</td>
  </tr>`).join("");

  table.innerHTML = rows + `<tr class="delivery-preview-total">
    <td>${t("deliveries.totalRow")}</td>
    <td>${prep.lines.reduce((sum, line) => sum + line.quantity, 0)}</td>
    <td>${money(prep.header.goodsCost)}</td>
    <td>${money(prep.header.additionalTotal)}</td>
    <td>${money(prep.header.totalCost)}</td>
    <td></td>
  </tr>`;
}

function renderDeliveryDialog() {
  renderDeliveryLines();
  renderDeliveryCostFields();
  renderDeliveryPreview();
}

function openDeliveryDialog() {
  const dialog = qs("#deliveryDialog");
  if (!dialog) return;
  if (!isManagerOrOwnerRole()) return;
  // A delivery names one branch. The same refusal saveProduct(), saveService()
  // and saveExpense() make, and it is made HERE rather than on submit so nobody
  // types a twelve-line delivery into a dialog that was never going to save it.
  if (!state.currentStoreId || state.currentStoreId === "all") {
    showToast(t("deliveries.errNoStore"));
    return;
  }
  state.deliveryDraft = emptyDeliveryDraft();
  const form = qs("#deliveryForm");
  if (form) {
    form.reset();
    const dateInput = form.elements.receivedAt;
    if (dateInput) dateInput.value = localDateInputValue(new Date());
  }
  const basisSelect = qs("#deliveryBasis");
  if (basisSelect) basisSelect.value = "value";
  renderDeliveryDialog();
  dialog.showModal();
}

async function submitDelivery() {
  const button = qs("#saveDeliveryButton");
  const errorSlot = qs("#deliveryFormError");
  const form = qs("#deliveryForm");
  if (!button || !form) return;
  // The fourth of these, after #completeSaleButton, #confirmTransferButton and
  // #confirmRestockButton, and for the same reason: the transaction reads each
  // shelf and adds to what it finds, so two runs add the delivery twice and the
  // shop believes it holds stock that never arrived.
  if (button.disabled) return;
  button.disabled = true;

  try {
    // Local parts at midday, the way every other date in this app is parsed.
    // new Date("2026-09-07") is UTC midnight, which is the previous day west of
    // Greenwich and the wrong month on the 1st.
    let receivedAt = new Date();
    const raw = String(form.elements.receivedAt?.value || "").trim();
    if (raw) {
      const [y, m, d] = raw.split("-").map(Number);
      const parsed = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
      if (!Number.isNaN(parsed.getTime())) receivedAt = parsed;
    }

    const result = await receiveDelivery({
      storeId: state.currentStoreId,
      receivedAt,
      supplierName: String(form.elements.supplierName?.value || "").trim(),
      supplierTin: String(form.elements.supplierTin?.value || "").trim(),
      reference: String(form.elements.reference?.value || "").trim(),
      note: String(form.elements.note?.value || "").trim(),
      // Blank stays blank rather than becoming 0. receiveDelivery() reads an
      // empty amountPaid as PAID IN FULL; sending 0 would mean the opposite --
      // the whole delivery on credit -- and silently indebt anyone who ignored
      // the box.
      amountPaid: String(form.elements.amountPaid?.value || "").trim(),
      paymentMethod: String(form.elements.paymentMethod?.value || "").trim(),
      lines: deliveryDraftLines(),
      costs: state.deliveryDraft.costs,
      basis: state.deliveryDraft.basis,
      manualAmounts: state.deliveryDraft.basis === "manual"
        ? state.deliveryDraft.lines.map((line) => safeNumber(line.manual))
        : undefined
    });

    if (!result.ok) {
      if (errorSlot) errorSlot.textContent = deliveryErrorMessage(result, deliveryDraftLines());
      return;
    }

    const prep = prepareDelivery({
      lines: deliveryDraftLines(), costs: state.deliveryDraft.costs,
      basis: state.deliveryDraft.basis,
      manualAmounts: state.deliveryDraft.basis === "manual"
        ? state.deliveryDraft.lines.map((line) => safeNumber(line.manual))
        : undefined
    });
    qs("#deliveryDialog")?.close();
    state.deliveryDraft = emptyDeliveryDraft();
    renderAll();
    showToast(t("toast.deliveryRecorded", {
      count: String(prep.ok ? prep.header.lineCount : 0),
      unit: t((prep.ok ? prep.header.lineCount : 0) === 1 ? "deliveries.lineSingular" : "deliveries.linePlural"),
      value: money(prep.ok ? prep.header.totalCost : 0)
    }));
  } finally {
    // Every path, including the early return an error takes, so a refused
    // delivery cannot leave the next one facing a dead button.
    button.disabled = false;
  }
}

async function confirmDeleteDelivery(deliveryId) {
  const delivery = state.deliveries.find((item) => item.id === deliveryId);
  const lineCount = safeNumber(delivery?.lineCount);
  // Says what survives the deletion as well as what does not. The weighted
  // average this delivery already fed is a cached derivation and nothing
  // recomputes it -- DESIGN-purchases.md 12 -- so a shop that deletes expecting
  // its cost to revert would be wrong, and would find out much later.
  if (!await askConfirm(t("deliveries.deleteConfirm", {
    count: String(lineCount),
    line: t(lineCount === 1 ? "deliveries.lineSingular" : "deliveries.linePlural")
  }))) return;

  const result = await deleteDelivery(deliveryId);
  if (!result.ok) {
    showToast(deliveryErrorMessage(result, []));
    return;
  }
  showToast(t("toast.deliveryDeleted"));
  renderAll();
}

// The existence of a cost document IS the answer. It is created by the first
// purchase and by nothing else, so there is no state where cost is half-known.
//
// Phase B asked the PRODUCT for `costKnownFrom || costPrice > 0`, which could
// disagree with itself -- one field present without the other averaged a full
// shelf against a zero cost and produced a plausible wrong number rather than an
// error. A document cannot half-exist.
function productCostKnown(costDoc) {
  // The stamp, not merely the object. Boolean(costDoc) alone reads `{}` as
  // costed, and a bare truthiness test on a document is exactly the kind of
  // presence-not-value check phase 0 had to remove from the control panel.
  // firestore.rules requires costKnownFrom on every cost document, so a doc
  // without one cannot exist -- but the guard should not depend on that.
  return Boolean(costDoc && costDoc.costKnownFrom);
}

// productId -> the cost changes for that product, oldest first. Built once per
// render rather than per sale line, because a month of sales asks this question
// thousands of times.
function buildCostIndex(history) {
  const index = new Map();
  for (const entry of history || []) {
    const at = entry?.effectiveFrom?.toDate ? entry.effectiveFrom.toDate()
      : (entry?.effectiveFrom instanceof Date ? entry.effectiveFrom : null);
    // A record with no resolved timestamp is a local echo of a write that has
    // not landed yet. Skipping it means the previous cost applies until it does,
    // which is the honest answer.
    //
    // The hazard is treating it as effective NOW: it would then win every
    // lookup for every recent sale, on a figure the server has not confirmed.
    // (Treating it as epoch would be harmless but wrong in the other
    // direction -- it would lose every lookup instead.)
    if (!at) continue;
    if (!index.has(entry.productId)) index.set(entry.productId, []);
    index.get(entry.productId).push({ at: at.getTime(), costPrice: safeNumber(entry.costPrice) });
  }
  for (const list of index.values()) list.sort((a, b) => a.at - b.at);
  return index;
}

// What one unit of this product cost at that moment, or null if nothing was
// known yet. Null is not zero: a sale made before a product had any recorded
// cost has an UNKNOWN cost of goods, and every surface must say so rather than
// reporting a margin of 100%.
//
// This is what replaces a unitCost on the sale line. The line cannot carry it --
// the till is a cashier's and a cashier cannot read cost -- but the sale carries
// its own date, and the history says what was true on that date. A later
// delivery appends a new record and leaves the old one alone, so last month's
// profit cannot be rewritten by this month's prices.
function costInForceAt(index, productId, at) {
  const list = index?.get(productId);
  if (!list || !list.length || !at) return null;
  const t = at instanceof Date ? at.getTime() : Number(at);
  if (!Number.isFinite(t)) return null;
  // Latest record at or before the sale. Linear from the end: a product has a
  // handful of cost changes, and the newest is almost always the answer.
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].at <= t) return list[i].costPrice;
  }
  return null;
}

// productId -> unit cost, for the surfaces that report stock value and margin.
// Quantity still comes from the product; only the money moved.
function productCostMap() {
  return new Map((state.productCosts || []).map((entry) => [entry.id, safeNumber(entry.costPrice)]));
}

// Who may record what a delivery cost. A cashier may restock -- a trusted
// cashier counts stock in when the manager is away -- but never sees the buying
// price, and firestore.rules refuses cost on their write. Showing the field
// would offer something the save is going to reject.
function canRecordCost() {
  return isManagerOrOwnerRole();
}

function storePurchases() {
  if (!state.currentStoreId) return [];
  if (state.currentStoreId === "all") return state.purchases;
  return state.purchases.filter((purchase) => purchase.storeId === state.currentStoreId);
}

function purchasedAt(purchase) {
  const at = purchase?.createdAt;
  if (at?.toDate) return at.toDate();
  if (at instanceof Date) return at;
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

// Totals for one month, from a list already scoped to a branch. Pure, so
// tests/purchases.test.mjs evaluates it rather than a copy of it.
function summarisePurchases(purchases, monthKey) {
  let total = 0;
  let units = 0;
  let count = 0;
  let withReceipt = 0;
  for (const purchase of purchases) {
    const at = purchasedAt(purchase);
    if (!at) continue;
    if (localMonthKey(at) !== monthKey) continue;
    total += safeNumber(purchase.totalPaid);
    units += safeNumber(purchase.quantity);
    count += 1;
    if (purchase.hasFiscalReceipt) withReceipt += safeNumber(purchase.totalPaid);
  }
  return { total, units, count, withReceipt, withoutReceipt: total - withReceipt };
}

// Cost is kept in its own collection precisely so this subscription can be
// refused to a cashier. /products cannot be -- the POS needs it -- and Firestore
// cannot withhold a single field, so a costPrice stored there is readable by
// every till. DESIGN-purchases.md 10.
// Product costs, fetched WHEN A COST IS ASKED FOR rather than held live.
//
// There is one cost document per product, so this collection is the same size
// as the catalogue -- and with a live listener every manager and owner paid for
// all of it on every session. Measured at 2,000 SKUs across 3 branches that was
// half of a 12,000-document cold start; at the 10,000-SKU catalogue this is
// being sold into it is 10,000 documents an owner loaded to render one tile.
//
// Only two surfaces ever read it: the Stock Valuation report, and the stock
// value tile on the owner's dashboard. Both now ask for it, and both say so
// while it is coming. A till never loads it at all -- a cashier cannot read
// these documents anyway, which is the whole reason cost lives in its own
// collection rather than on the product.
//
// Fetched, not subscribed: a cost changes when a delivery or a restock is
// recorded, both of which are actions taken in this app, so the cache is
// dropped at those points instead of being kept live all day for a figure
// nobody is looking at.
async function loadProductCosts() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (!isManagerOrOwnerRole()) {
    state.productCosts = [];
    state.productCostsLoaded = false;
    return;
  }
  if (state.productCostsLoading) return;
  state.productCostsLoading = true;
  try {
    const { collection, getDocs, query, where } = state.firebaseApi.firestore;
    const costsRef = collection(state.db, "users", state.businessOwnerUid, "productCosts");
    const queryStoreIds = await catalogueStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.productCosts = [];
      state.productCostsLoaded = true;
      scheduleRenderAll();
      return;
    }
    const costsQuery = queryStoreIds === null
      ? costsRef
      : query(costsRef, where("storeId", "in", queryStoreIds));
    const snapshot = await getDocs(costsQuery);
    state.productCosts = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    state.productCostsLoaded = true;
  } catch (error) {
    // Left unloaded rather than marked loaded-and-empty. An empty cost map
    // reads as "no cost recorded anywhere", which is a claim about the
    // business; not loaded reads as "not fetched", which is the truth.
    console.warn("[productCosts]", error.code || error);
    state.productCostsLoaded = false;
  } finally {
    state.productCostsLoading = false;
    scheduleRenderAll();
  }
}

// Idempotent, and safe to call from a render. Returns nothing: the answer
// arrives as a re-render once the fetch lands.
function ensureProductCosts() {
  if (state.productCostsLoaded || state.productCostsLoading) return;
  loadProductCosts();
}

// Dropped when something changes what a cost IS, so the next surface that
// wants one fetches it again.
function invalidateProductCosts() {
  state.productCostsLoaded = false;
  state.productCosts = [];
}

async function subscribeToProductCostHistory() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeProductCostHistory) state.unsubscribeProductCostHistory();
  if (!isManagerOrOwnerRole()) {
    state.productCostHistory = [];
    return;
  }
  try {
    const { collection, limit, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "productCostHistory");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.productCostHistory = [];
      scheduleRenderAll();
      return;
    }
    // Ordered by effectiveFrom, not createdAt: effectiveFrom is what
    // costInForceAt() searches, so the newest N by that field is the window
    // that actually answers the question. Truncation here is the dangerous
    // one -- a missing record does not under-report a total, it answers with
    // the WRONG cost -- so costHistoryCoverageFromMs() below turns a sale
    // older than the window into "cost unknown" rather than a wrong figure.
    const historyQuery = queryStoreIds === null
      ? query(ref, orderBy("effectiveFrom", "desc"), limit(ACCOUNTS_HISTORY_LIMIT))
      : query(ref, where("storeId", "in", queryStoreIds),
              orderBy("effectiveFrom", "desc"), limit(ACCOUNTS_HISTORY_LIMIT));
    state.unsubscribeProductCostHistory = onSnapshot(
      historyQuery,
      (snapshot) => {
        state.productCostHistory = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        scheduleRenderAll();
      },
      (error) => {
        console.warn("[productCostHistory listener]", error.code || error, "queryStoreIds=", queryStoreIds);
      }
    );
  } catch (error) {
    console.warn(error);
  }
}

async function subscribeToPurchases() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribePurchases) state.unsubscribePurchases();
  // A cashier is refused this collection by firestore.rules. Subscribing anyway
  // would put a permission-denied in every cashier's console on every sign-in.
  if (!isManagerOrOwnerRole()) {
    state.purchases = [];
    return;
  }
  try {
    const { collection, limit, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const purchasesRef = collection(state.db, "users", state.businessOwnerUid, "purchases");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.purchases = [];
      scheduleRenderAll();
      return;
    }
    const purchasesQuery = queryStoreIds === null
      ? query(purchasesRef, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT))
      : query(purchasesRef, where("storeId", "in", queryStoreIds),
              orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT));
    state.unsubscribePurchases = onSnapshot(
      purchasesQuery,
      (snapshot) => {
        state.purchases = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        scheduleRenderAll();
      },
      (error) => {
        console.warn("[purchases listener]", error.code || error, "queryStoreIds=", queryStoreIds);
      }
    );
  } catch (error) {
    console.warn(error);
  }
}

// Owner-only, matching firestore.rules. A purchase has already moved the
// product's weighted average by the time anyone deletes it -- the average is a
// cached derivation and nothing recomputes it here -- so the audit entry is the
// only record that the delivery was ever recorded at all.
async function deletePurchase(purchaseId) {
  if (!isOwnerRole()) return;
  const purchase = state.purchases.find((item) => item.id === purchaseId);
  if (!purchase) return;
  if (!await askConfirm(t("purchases.confirmDelete", {
    name: purchase.productName || "",
    value: money(safeNumber(purchase.totalPaid))
  }))) return;
  try {
    const { collection, doc, writeBatch } = state.firebaseApi.firestore;
    const batch = writeBatch(state.db);
    batch.delete(doc(state.db, "users", state.businessOwnerUid, "purchases", purchaseId));
    batch.set(doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs")),
      moneyAuditEntry("PURCHASE_DELETED", {
        purchaseId, storeId: purchase.storeId, productId: purchase.productId,
        name: purchase.productName, amount: safeNumber(purchase.totalPaid),
        qtyAdded: safeNumber(purchase.quantity)
      }));
    batch.commit().catch((error) => {
      console.warn(error);
      showToast(t("toast.purchaseFailed"));
    });
    showToast(t("toast.purchaseDeleted"));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.purchaseFailed"));
  }
}

// ---------------------------------------------------------------------------
// Profit -- DESIGN-purchases.md phase E.
//
// Three figures, and section 11's whole point is that they are not equally
// trustworthy:
//
//   Revenue        computed from sales the system wrote. Trustworthy.
//   Gross profit   revenue less cost of goods. Trustworthy WHERE cost is known,
//                  and the coverage says where that is.
//   Net profit     gross less expenses. Only as complete as what the owner
//                  typed, and it fails in the DANGEROUS direction -- a forgotten
//                  expense makes profit look BETTER. L-12 overstates VAT owed,
//                  which is safe; this overstates what the shop kept, which is
//                  what someone prices and restocks against.
//
// So gross and net are never summed into one headline, and this function reports
// what it could not see rather than quietly leaving it out.
// Input VAT is a CLAIM, and a claim has conditions. This returns why a purchase
// cannot be claimed as well as whether it can, because an owner who sees a
// claim smaller than their spending needs to know which receipts cost them it.
//
// The four conditions are in DESIGN-vat.md. Three are checked here; the fourth
// -- that the purchase is on or after registration -- enforces itself, because
// the VAT amount field is only ever shown to a registered business, so a
// purchase from before registration simply carries no vatAmount.
const INPUT_VAT_WINDOW_MONTHS = 6;

function inputVatClaimExpiresAt(receiptDate) {
  if (!(receiptDate instanceof Date) || Number.isNaN(receiptDate.getTime())) return null;
  const expiry = new Date(receiptDate.getTime());
  expiry.setMonth(expiry.getMonth() + INPUT_VAT_WINDOW_MONTHS);
  return expiry;
}

function purchaseReceiptDate(purchase) {
  const raw = purchase?.receiptDate;
  if (!raw) return null;
  if (raw.toDate) return raw.toDate();
  if (raw instanceof Date) return raw;
  return null;
}

// Ordered deliberately: the reason returned is the FIRST thing the shop would
// have to fix, so "ask the supplier for a fiscal receipt" outranks "type in the
// VAT" -- there is no point typing a figure off a receipt that does not exist.
function inputVatClaimStatus(purchase, nowMs) {
  const amount = safeNumber(purchase?.vatAmount);
  if (!purchase?.hasFiscalReceipt) return { claimable: false, reason: "noReceipt", amount: 0 };
  const receiptDate = purchaseReceiptDate(purchase);
  if (!receiptDate) return { claimable: false, reason: "noReceiptDate", amount: 0 };
  const expiresAt = inputVatClaimExpiresAt(receiptDate);
  if (expiresAt && Number.isFinite(nowMs) && expiresAt.getTime() < nowMs) {
    return { claimable: false, reason: "expired", amount: 0, expiresAt };
  }
  if (!(amount > 0)) return { claimable: false, reason: "noVatAmount", amount: 0, expiresAt };
  // A claim can never exceed what was paid. A figure above it is a typo, and
  // claiming it would be an overclaim on a filed return.
  if (amount > safeNumber(purchase.totalPaid)) {
    return { claimable: false, reason: "exceedsTotal", amount: 0, expiresAt };
  }
  return { claimable: true, reason: null, amount, expiresAt };
}

// The period record. Output is what was charged, input is what may be reclaimed,
// and the difference is what the business owes.
function summariseVatPeriod({
  sales, purchases, monthKey, vatRegistered,
  salesCoverageFromMs, purchasesCoverageFromMs, nowMs, expirySoonDays = 60
}) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  const periodStart = (year && month) ? new Date(year, month - 1, 1, 0, 0, 0) : null;

  // L-11 on both sides. A period that begins before either loaded window would
  // total to LESS than was traded -- and a VAT return that is too low is the
  // dangerous direction, because it is filed.
  const outsideWindow = Boolean(periodStart && (
    (salesCoverageFromMs !== null && salesCoverageFromMs !== undefined
      && periodStart.getTime() < salesCoverageFromMs)
    || (purchasesCoverageFromMs !== null && purchasesCoverageFromMs !== undefined
      && periodStart.getTime() < purchasesCoverageFromMs)
  ));

  const monthSales = (sales || []).filter((sale) => {
    const at = saleTimestamp(sale);
    return at && !sale.voided ? localMonthKey(at) === monthKey : false;
  });

  const outputVat = monthSales.reduce((sum, sale) => sum + safeNumber(sale.taxTotal), 0);
  // L-12: refunds do not reduce the VAT owed on them, so output is
  // conservatively HIGH. Surfaced rather than buried -- the screen names this
  // so whoever files can see the size of the discrepancy.
  const refundsNotNetted = monthSales.reduce((sum, sale) => sum + safeNumber(sale.refundedAmount), 0);

  // A purchase belongs to the period its RECEIPT is dated in, not the day it
  // was typed in. RESEARCH-accounts.md 5.3 -- the window runs from the receipt.
  const all = purchases || [];
  const inPeriod = all.filter((p) => {
    const d = purchaseReceiptDate(p);
    return d ? localMonthKey(d) === monthKey : false;
  });

  let inputVat = 0;
  const blocked = [];
  for (const p of inPeriod) {
    const status = inputVatClaimStatus(p, nowMs);
    if (status.claimable) inputVat += status.amount;
    else blocked.push({ purchase: p, reason: status.reason });
  }

  // The money-losing case, and the reason this screen is worth building: a
  // receipt the shop HAS, inside a window that is still open, with no VAT
  // recorded against it. Nothing else in the app would ever mention it, and it
  // silently stops being claimable on a date nobody is watching.
  const soonMs = Number.isFinite(nowMs) ? nowMs + expirySoonDays * 86400000 : null;
  const expiringClaims = all
    .map((p) => ({ purchase: p, status: inputVatClaimStatus(p, nowMs) }))
    .filter(({ status }) => status.reason === "noVatAmount" && status.expiresAt
      && soonMs !== null && status.expiresAt.getTime() <= soonMs)
    .sort((a, b) => a.status.expiresAt.getTime() - b.status.expiresAt.getTime());

  return {
    monthKey,
    vatRegistered,
    outsideWindow,
    outputVat,
    refundsNotNetted,
    salesCount: monthSales.length,
    inputVat,
    claimedCount: inPeriod.length - blocked.length,
    blocked,
    expiringClaims,
    netPayable: outputVat - inputVat
  };
}

function purchasesCoverageFromMs() {
  const list = state.purchases || [];
  if (list.length < ACCOUNTS_HISTORY_LIMIT) return null;
  let oldest = null;
  for (const p of list) {
    const at = p.createdAt?.toDate ? p.createdAt.toDate().getTime() : null;
    if (at === null) continue;
    if (oldest === null || at < oldest) oldest = at;
  }
  return oldest;
}

function renderVatNav() {
  const item = qs('.nav-item[data-view="vat"]');
  // Hidden outright for a business that does not collect VAT. DESIGN-vat.md
  // decision 4: an unregistered duka must not be shown a scheme it is not in.
  if (item) item.hidden = !vatSettings().registered || !isManagerOrOwnerRole();
}

function renderVatRecord() {
  const view = qs("#vat");
  const grid = qs("#vatGrid");
  const note = qs("#vatNote");
  if (!view || !grid || !note) return;
  const expiringCard = qs("#vatExpiringCard");
  const blockedCard = qs("#vatBlockedCard");

  if (!isManagerOrOwnerRole() || !vatSettings().registered) {
    grid.innerHTML = "";
    note.textContent = "";
    if (expiringCard) expiringCard.hidden = true;
    if (blockedCard) blockedCard.hidden = true;
    return;
  }

  const input = qs("#vatMonthInput");
  if (input && !input.value) input.value = localMonthKey(new Date());
  const monthKey = input?.value || localMonthKey(new Date());

  const r = summariseVatPeriod({
    sales: state.sales,
    purchases: state.purchases,
    monthKey,
    vatRegistered: true,
    salesCoverageFromMs: salesCoverageFromMs(),
    purchasesCoverageFromMs: purchasesCoverageFromMs(),
    nowMs: Date.now()
  });

  // Refuses rather than under-reporting. A VAT return computed from a partial
  // window is too LOW, and that is the direction that gets filed and then
  // corrected by someone else.
  if (r.outsideWindow) {
    grid.innerHTML = "";
    if (expiringCard) expiringCard.hidden = true;
    if (blockedCard) blockedCard.hidden = true;
    note.textContent = t("vatRecord.outsideWindow", {
      date: new Date(salesCoverageFromMs() || purchasesCoverageFromMs()).toLocaleDateString()
    });
    return;
  }

  grid.innerHTML = [
    controlTile(t("vatRecord.output"), money(r.outputVat), "",
      t("vatRecord.outputNote", { count: String(r.salesCount) })),
    controlTile(t("vatRecord.input"), money(r.inputVat), "accent",
      t("vatRecord.inputNote", { count: String(r.claimedCount) })),
    controlTile(t("vatRecord.net"), money(r.netPayable),
      r.netPayable >= 0 ? "" : "accent",
      r.netPayable >= 0 ? t("vatRecord.netNote") : t("vatRecord.netCreditNote"))
  ].join("");

  // L-12, disclosed rather than buried. The output figure does not net refunds,
  // so it is conservatively HIGH -- and whoever files should see by how much
  // rather than meet it in an audit.
  note.textContent = r.refundsNotNetted > 0
    ? t("vatRecord.refundsNotNetted", { amount: money(r.refundsNotNetted) })
    : "";

  const expiringRows = r.expiringClaims.map(({ purchase, status }) => `<tr>
    <td>${esc(purchaseReceiptDate(purchase)?.toLocaleDateString() || "")}</td>
    <td>${esc(purchase.productName || "")}</td>
    <td>${esc(money(purchase.totalPaid))}</td>
    <td>${esc(status.expiresAt?.toLocaleDateString() || "")}</td>
  </tr>`).join("");
  if (expiringCard) expiringCard.hidden = expiringRows.length === 0;
  const expiringBody = qs("#vatExpiringBody");
  if (expiringBody) expiringBody.innerHTML = expiringRows;

  const blockedRows = r.blocked.map(({ purchase, reason }) => `<tr>
    <td>${esc(purchaseReceiptDate(purchase)?.toLocaleDateString() || "")}</td>
    <td>${esc(purchase.productName || "")}</td>
    <td>${esc(money(purchase.totalPaid))}</td>
    <td>${esc(t("vatRecord.reason." + reason))}</td>
  </tr>`).join("");
  if (blockedCard) blockedCard.hidden = blockedRows.length === 0;
  const blockedBody = qs("#vatBlockedBody");
  if (blockedBody) blockedBody.innerHTML = blockedRows;
}

function summariseProfit({ sales, costIndex, expenses, monthKey, coverageFromMs, vatRegistered }) {
  const monthSales = (sales || []).filter((sale) => {
    const at = saleTimestamp(sale);
    return at ? localMonthKey(at) === monthKey : false;
  });

  // L-11, applied before anything is computed rather than after. A period that
  // begins before the loaded sales window cannot be totalled at all, and a
  // confident partial figure on a profit statement is worse than a refusal --
  // the monthly report already refuses for exactly this reason.
  const [year, month] = String(monthKey || "").split("-").map(Number);
  const periodStart = (year && month) ? new Date(year, month - 1, 1, 0, 0, 0) : null;
  const outsideWindow = Boolean(
    periodStart && coverageFromMs !== null && coverageFromMs !== undefined
    && periodStart.getTime() < coverageFromMs
  );

  const takings = summariseSales(monthSales);
  // Net of refunds, and net of VAT where the business collects it -- VAT is the
  // Authority's money passing through, never the shop's margin.
  const revenue = vatRegistered
    ? monthSales.reduce((sum, sale) => {
        if (sale.voided) return sum;
        const net = safeNumber(sale.netTotal);
        const total = safeNumber(sale.total) - safeNumber(sale.refundedAmount);
        // A sale from before the business registered carries no netTotal. It is
        // outside the scheme, not taxed at zero, so its total IS its net.
        return sum + (sale.netTotal === undefined ? total : net - safeNumber(sale.refundedAmount));
      }, 0)
    : takings.net;

  const goods = summariseCostOfGoods(monthSales, costIndex);
  const spending = summariseExpenses(expenses || [], monthKey);

  const grossProfit = revenue - goods.cogs;
  const netProfit = grossProfit - spending.total;

  return {
    outsideWindow,
    monthKey,
    revenue,
    salesCount: takings.count,
    cogs: goods.cogs,
    costedLines: goods.costedLines,
    uncostedLines: goods.uncostedLines,
    anyCostKnown: goods.anyCostKnown,
    allCostKnown: goods.allCostKnown,
    grossProfit,
    grossMarginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 100) : 0,
    // Spec 10 prints both margins. Guarded on revenue rather than computed
    // blindly: with no sales this is 0/0, and a dashboard reading "NaN%" is how
    // an owner stops trusting the whole statement.
    netMarginPct: revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0,
    expenses: spending.total,
    expenseCount: spending.count,
    // The two lines the docx section 9 statement puts under gross profit.
    // They add to `expenses` and to nothing else -- the split is a presentation
    // of the same money, so net profit is unchanged by it and a shop that
    // classifies everything wrongly still gets the right bottom line.
    directExpenses: spending.direct,
    indirectExpenses: spending.indirect,
    netProfit,
    // Deliberately separate from anyCostKnown. A month with no expenses recorded
    // is not the same as a month with none spent, and the surface must not imply
    // the second.
    anyExpensesRecorded: spending.count > 0
  };
}

// The docx section 10 drill-down: what each product contributed, for the period.
//
// The two middle columns -- "original inventory cost" and "landed costs" -- are
// the reason DESIGN-landed-costs.md 3.1 kept `goodsCost` and `landedCost` on the
// purchase line rather than only the landed total. Neither is recoverable from
// the other, and without them this table cannot answer the question the docx
// asks it to.
//
// HOW THE SPLIT IS ATTRIBUTED, and why it is a ratio rather than a sum.
//
// goodsCost and landedCost are properties of what was BOUGHT. Units sold are a
// property of what was SOLD. Putting a period's purchases beside the same
// period's sales on one row would be a category error -- a delivery received on
// the 30th would appear in full against a month of sales it barely touched.
//
// So the split is applied as a PROPORTION. Across everything ever recorded for a
// product, landedCost / (goodsCost + landedCost) is the share of its unit cost
// that is freight, duty and clearing rather than the supplier's price. Applying
// that share to the period's cost of sales answers the question a shop actually
// has: "of the cost of goods I sold, how much of it was getting them here?"
//
// It is an attribution, not a measurement, and the surface says so. A product
// whose purchases predate the landed split has a ratio of zero, which is exactly
// true of it: nothing was ever capitalised onto those units.
function landedRatioByProduct(purchases) {
  const totals = new Map();
  for (const purchase of purchases || []) {
    // Both-or-neither on the document, so testing one is enough -- and a
    // purchase without them contributes to neither side, rather than dragging
    // the ratio toward zero as though its freight had been zero.
    if (purchase?.goodsCost === undefined || purchase?.landedCost === undefined) continue;
    const goods = safeNumber(purchase.goodsCost);
    const landed = safeNumber(purchase.landedCost);
    const key = purchase.productId;
    if (!key) continue;
    const entry = totals.get(key) || { goods: 0, landed: 0 };
    entry.goods += goods;
    entry.landed += landed;
    totals.set(key, entry);
  }
  const ratios = new Map();
  for (const [productId, { goods, landed }] of totals) {
    const total = goods + landed;
    // A batch that cost nothing cannot have a landed share. Skipped rather than
    // stored as zero, so the surface can tell "no landed cost" from "no data".
    if (total > 0) ratios.set(productId, landed / total);
  }
  return ratios;
}

// One row per product sold in the period, ordered by what it contributed.
//
// Owner-strict at the render, like the statement above it -- this is the
// strongest disclosure in the app: it names a buying price against a selling
// price, per product, in one table.
function summariseProductProfit({ sales, costIndex, purchases, monthKey }) {
  const rows = new Map();
  const ratios = landedRatioByProduct(purchases);

  for (const sale of sales || []) {
    if (sale.voided) continue;
    const soldAt = saleTimestamp(sale);
    if (!soldAt || localMonthKey(soldAt) !== monthKey) continue;
    // Netted the same way summariseCostOfGoods() nets it, and for the same
    // reason -- see the long note there. BOTH sides are netted here, cost and
    // revenue, because this table shows them beside each other: netting only the
    // cost would leave a row whose margin disagrees with its own two columns.
    const returnedRemaining = saleReturnedQtyMap(sale);
    for (const item of sale.items || []) {
      // A haircut has no cost of goods and no product to drill into.
      //
      // REDUNDANT HERE, and kept deliberately. The sale-item builder gives a
      // service line `serviceId` and omits `productId` entirely, so the guard
      // below already excludes every service; a negative control that deleted
      // this line changed no behaviour, which is how that was established.
      // summariseCostOfGoods() needs its copy for a reason this function does
      // not -- there the cost lookup runs before any productId test, so a
      // service would count as an uncosted line and report every salon month as
      // incomplete. Left in place so the two functions read alike and so a
      // future line shape that does carry both cannot quietly slip through.
      if (isServiceLine(item)) continue;
      const productId = item.productId;
      if (!productId) continue;
      const row = rows.get(productId) || {
        productId,
        productName: String(item.name || "").slice(0, 120),
        unitsSold: 0, revenue: 0, cogs: 0,
        costedLines: 0, uncostedLines: 0
      };
      // The name from the newest line wins only if the row has none: a product
      // renamed mid-month should not flicker between two labels.
      if (!row.productName && item.name) row.productName = String(item.name).slice(0, 120);
      const soldQty = safeNumber(item.qty);
      const outstanding = safeNumber(returnedRemaining.get(productId));
      const returnedHere = Math.min(soldQty, outstanding);
      if (returnedHere > 0) returnedRemaining.set(productId, outstanding - returnedHere);
      const qty = soldQty - returnedHere;
      if (qty <= 0) continue;
      // Revenue netted in the same PROPORTION as the units, because lineTotal is
      // qty x sellingPrice and the returned units came off that line. Taking the
      // refund amount instead would mix a post-discount figure into a
      // pre-discount column.
      row.unitsSold += qty;
      row.revenue += safeNumber(item.lineTotal) * (soldQty > 0 ? qty / soldQty : 0);
      const unitCost = costInForceAt(costIndex, productId, soldAt);
      if (unitCost !== null && unitCost > 0) {
        row.cogs += unitCost * qty;
        row.costedLines += 1;
      } else {
        row.uncostedLines += 1;
      }
      rows.set(productId, row);
    }
  }

  const list = [...rows.values()].map((row) => {
    const costKnown = row.costedLines > 0;
    const costComplete = costKnown && row.uncostedLines === 0;
    const ratio = ratios.has(row.productId) ? ratios.get(row.productId) : null;
    const grossProfit = row.revenue - row.cogs;
    return {
      ...row,
      costKnown,
      costComplete,
      // Null, not zero: "we do not know" and "it cost nothing" are different
      // statements and the surface must not conflate them.
      averageCost: costKnown && row.unitsSold > 0 ? row.cogs / row.unitsSold : null,
      landedRatio: ratio,
      // The docx section 10 middle columns, attributed per the note above.
      cogsLanded: ratio === null ? null : row.cogs * ratio,
      cogsGoods: ratio === null ? null : row.cogs * (1 - ratio),
      grossProfit: costKnown ? grossProfit : null,
      grossMarginPct: costKnown && row.revenue > 0
        ? Math.round((grossProfit / row.revenue) * 100)
        : null
    };
  });

  // By cost of sales, not by revenue: this is a costing table, and the product
  // that consumed the most stock value is the one worth looking at first. A
  // product with no known cost sorts by revenue among its own kind rather than
  // being dropped -- it is precisely the row someone needs to notice.
  list.sort((a, b) => (b.cogs - a.cogs) || (b.revenue - a.revenue));

  const totals = list.reduce((sum, row) => ({
    unitsSold: sum.unitsSold + row.unitsSold,
    revenue: sum.revenue + row.revenue,
    cogs: sum.cogs + row.cogs,
    cogsLanded: sum.cogsLanded + safeNumber(row.cogsLanded),
    cogsGoods: sum.cogsGoods + safeNumber(row.cogsGoods)
  }), { unitsSold: 0, revenue: 0, cogs: 0, cogsLanded: 0, cogsGoods: 0 });

  return {
    rows: list,
    totals: { ...totals, grossProfit: totals.revenue - totals.cogs },
    // How much of the table can be trusted, stated rather than assumed --
    // DESIGN-purchases.md 11 rule 2, applied per product.
    productsWithoutCost: list.filter((row) => !row.costKnown).length,
    productsWithoutLandedSplit: list.filter((row) => row.landedRatio === null).length
  };
}

// The docx section 10 table, under the statement it explains.
//
// Owner-strict by inheritance: it lives inside #profit, and canOpenView() gates
// that on isOwnerRole(). renderProfit() checks the role again before this is
// reached, for the same reason it did before -- the nav is not the security
// boundary.
function renderProductProfit(p, monthKey) {
  const panel = qs("#profitProductPanel");
  const table = qs("#profitProductTable");
  const note = qs("#profitProductNote");
  if (!panel || !table || !note) return;

  const scopedSales = state.currentStoreId === "all"
    ? state.sales
    : (state.sales || []).filter((sale) => saleStoreId(sale) === state.currentStoreId);

  const d = summariseProductProfit({
    sales: scopedSales,
    costIndex: buildCostIndex(state.productCostHistory),
    purchases: storePurchases(),
    monthKey
  });

  // Nothing sold, or a month the statement already refused: no table at all,
  // rather than an empty one implying the month was quiet when it was unloaded.
  panel.hidden = p.outsideWindow || d.rows.length === 0;
  if (panel.hidden) {
    table.innerHTML = "";
    note.textContent = "";
    return;
  }

  const dash = "—";
  const cell = (value, render) => (value === null || value === undefined ? dash : render(value));

  table.innerHTML = d.rows.map((row) => `<tr>
    <td>${esc(row.productName || row.productId)}</td>
    <td>${row.unitsSold}</td>
    <td>${cell(row.averageCost, money)}</td>
    <td>${cell(row.costKnown ? row.cogs : null, money)}</td>
    <td>${cell(row.cogsGoods, money)}</td>
    <td>${cell(row.cogsLanded, money)}</td>
    <td>${money(row.revenue)}</td>
    <td class="${row.grossProfit !== null && row.grossProfit <= 0 ? "danger" : ""}">${
      cell(row.grossProfit, money)}</td>
    <td>${cell(row.grossMarginPct, (v) => `${v}%`)}</td>
  </tr>`).join("") + `<tr class="statement-total">
    <td>${esc(t("profit.pdTotal"))}</td>
    <td>${d.totals.unitsSold}</td>
    <td></td>
    <td>${money(d.totals.cogs)}</td>
    <td>${money(d.totals.cogsGoods)}</td>
    <td>${money(d.totals.cogsLanded)}</td>
    <td>${money(d.totals.revenue)}</td>
    <td>${money(d.totals.grossProfit)}</td>
    <td></td>
  </tr>`;

  // Two different incompletenesses, said separately because they mean different
  // things: a product with no cost at all cannot be judged, while one with no
  // landed split simply never had freight capitalised onto it.
  const parts = [];
  if (d.productsWithoutCost > 0) {
    parts.push(t("profit.pdNoCost", { count: String(d.productsWithoutCost) }));
  }
  if (d.productsWithoutLandedSplit > 0) {
    parts.push(t("profit.pdNoLanded", { count: String(d.productsWithoutLandedSplit) }));
  }
  parts.push(t("profit.pdAttribution"));
  note.textContent = parts.join(" ");
}

// Docx section 12: Stock Valuation. What the shelves are worth AT COST, which is
// the figure a balance sheet would carry and the one no screen stated before.
//
// Retail value is deliberately NOT the headline. A shop asked what its stock is
// worth means what it paid, not what it hopes to sell for -- and reporting the
// latter as "value" is how inventory gets overstated.
function summariseStockValuation(products, costById) {
  let atCost = 0;
  let atRetail = 0;
  let costedProducts = 0;
  let uncostedProducts = 0;
  let uncostedUnits = 0;
  let units = 0;
  const rows = [];
  for (const product of products || []) {
    const quantity = safeNumber(product.quantity);
    // Negative stock is real here -- an offline oversell is taken and flagged --
    // but it cannot contribute negative VALUE to a valuation without making the
    // total meaningless. Counted in the unit total, excluded from the money.
    const valuedQuantity = Math.max(0, quantity);
    const unitCost = safeNumber(costById.get(product.id));
    units += quantity;
    atRetail += valuedQuantity * safeNumber(product.sellingPrice);
    if (unitCost > 0) {
      atCost += valuedQuantity * unitCost;
      costedProducts += 1;
      rows.push({ id: product.id, name: product.name || "", quantity,
                  unitCost, value: valuedQuantity * unitCost });
    } else {
      uncostedProducts += 1;
      uncostedUnits += valuedQuantity;
      rows.push({ id: product.id, name: product.name || "", quantity,
                  unitCost: null, value: null });
    }
  }
  rows.sort((a, b) => safeNumber(b.value) - safeNumber(a.value));
  return { atCost, atRetail, units, costedProducts, uncostedProducts, uncostedUnits, rows };
}

// Docx section 12: Supplier Report. What each supplier was paid, across both the
// Purchase Book and the delivery headers.
//
// Keyed on the supplier NAME as typed, because that is all this design captures
// -- DESIGN-purchases.md 3 has supplierName as free text and there is no
// supplier record to join to. Trimmed and case-folded so "Festive Ltd" and
// "festive ltd " are one row rather than two, which is the whole of what can be
// done without inventing a supplier collection.
function summariseSuppliers(purchases, deliveries, monthKey) {
  const rows = new Map();
  const key = (name) => String(name || "").trim().toLowerCase();
  const add = (name, amount, kind) => {
    const k = key(name);
    if (!k) return;
    const row = rows.get(k) || { name: String(name).trim(), goods: 0, landed: 0, deliveries: 0, purchases: 0 };
    if (kind === "delivery") { row.landed += amount; row.deliveries += 1; }
    else { row.goods += amount; row.purchases += 1; }
    rows.set(k, row);
  };

  for (const purchase of purchases || []) {
    const at = purchasedAt(purchase);
    if (!at || localMonthKey(at) !== monthKey) continue;
    // goodsCost where the line carries the split, totalPaid where it does not --
    // which is exactly true of a purchase recorded before landed costs existed.
    const goods = purchase.goodsCost === undefined
      ? safeNumber(purchase.totalPaid)
      : safeNumber(purchase.goodsCost);
    add(purchase.supplierName, goods, "purchase");
  }
  // Landed cost comes off the DELIVERY, not off its lines: the lines carry an
  // allocated share each, and summing both would count the freight twice.
  for (const delivery of deliveries || []) {
    const at = deliveryReceivedAt(delivery);
    if (!at || localMonthKey(at) !== monthKey) continue;
    add(delivery.supplierName, safeNumber(delivery.additionalTotal), "delivery");
  }

  const list = [...rows.values()].map((row) => ({ ...row, total: row.goods + row.landed }));
  list.sort((a, b) => b.total - a.total);
  return { rows: list, total: list.reduce((sum, row) => sum + row.total, 0) };
}

// Docx section 12: the Direct and Indirect Expense Reports. Phase 5 put the two
// totals on the Expenses screen; this is the breakdown inside each of them,
// which is what makes a total actionable rather than merely true.
function summariseExpensesByNature(expenses, monthKey) {
  const buckets = { direct: new Map(), indirect: new Map() };
  const totals = { direct: 0, indirect: 0 };
  for (const expense of expenses || []) {
    const at = expenseSpentAt(expense);
    if (!at || localMonthKey(at) !== monthKey) continue;
    const nature = expenseNature(expense);
    const amount = safeNumber(expense.amount);
    totals[nature] += amount;
    const bucket = buckets[nature];
    bucket.set(expense.category, safeNumber(bucket.get(expense.category)) + amount);
  }
  const listOf = (nature) => [...buckets[nature].entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
  return {
    direct: { total: totals.direct, rows: listOf("direct") },
    indirect: { total: totals.indirect, rows: listOf("indirect") },
    total: totals.direct + totals.indirect
  };
}

// The three phase 7 reports, on the Reports screen. Manager and owner, which is
// the same gate /purchases and /productCosts already carry -- each of these is
// built from a collection those roles can already read, so none of them widens
// a disclosure.
function renderCostReports() {
  const panel = qs("#costReportsPanel");
  if (!panel) return;
  setReportRoleVisibility(panel, !isManagerOrOwnerRole());
  if (panel.hidden) {
    // Emptied as well as hidden, for the reason every other money surface in
    // this file is: a demoted manager must not keep buying prices in the DOM.
    for (const id of ["#stockValuationTable", "#supplierReportTable", "#expenseNatureTable"]) {
      const el = qs(id);
      if (el) el.innerHTML = "";
    }
    return;
  }

  const monthKey = state.reportsCostMonth || localMonthKey(new Date());
  const monthInput = qs("#costReportMonthInput");
  if (monthInput && monthInput.value !== monthKey) monthInput.value = monthKey;

  // --- Stock valuation ---------------------------------------------------
  // Only when this report is the one actually on screen. renderCostReports()
  // runs inside renderAll(), so an unconditional request here fetched the whole
  // cost map on every session regardless -- the exact cost this change removes,
  // moved from a listener into a render. Caught by opening the dashboard and
  // finding the tile already saying "Loading".
  if (state.selectedReport === "stockValuation") ensureProductCosts();
  const valuation = summariseStockValuation(storeProducts(), productCostMap());
  const valuationTotals = qs("#stockValuationTotals");
  if (valuationTotals) {
    valuationTotals.innerHTML = [
      // At cost is the headline. What a shop paid is what its stock is worth;
      // what it hopes to sell for is a different question, and reporting the
      // second as "value" is how inventory gets overstated.
      controlTile(t("reports.stockAtCost"),
        valuation.costedProducts > 0 ? money(valuation.atCost) : "—",
        "",
        valuation.uncostedProducts > 0
          ? t("reports.stockPartial", {
              missing: String(valuation.uncostedProducts),
              units: String(valuation.uncostedUnits)
            })
          : t("reports.stockComplete")),
      controlTile(t("reports.stockAtRetail"), money(valuation.atRetail), "",
        t("reports.stockAtRetailNote"))
    ].join("");
  }
  const valuationTable = qs("#stockValuationTable");
  if (valuationTable) {
    valuationTable.innerHTML = valuation.rows.length
      ? valuation.rows.map((row) => `<tr>
          <td>${esc(row.name)}</td>
          <td>${row.quantity}</td>
          <td>${row.unitCost === null ? "—" : money(row.unitCost)}</td>
          <td>${row.value === null ? "—" : money(row.value)}</td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="muted">${esc(t("reports.stockEmpty"))}</td></tr>`;
  }

  // --- Supplier report ---------------------------------------------------
  const suppliers = summariseSuppliers(storePurchases(), storeDeliveries(), monthKey);
  const supplierTable = qs("#supplierReportTable");
  if (supplierTable) {
    supplierTable.innerHTML = suppliers.rows.length
      ? suppliers.rows.map((row) => `<tr>
          <td>${esc(row.name)}</td>
          <td>${row.purchases}</td>
          <td>${row.deliveries}</td>
          <td>${money(row.goods)}</td>
          <td>${money(row.landed)}</td>
          <td><strong>${money(row.total)}</strong></td>
        </tr>`).join("") + `<tr class="statement-total">
          <td>${esc(t("profit.pdTotal"))}</td><td></td><td></td><td></td><td></td>
          <td>${money(suppliers.total)}</td>
        </tr>`
      : `<tr><td colspan="6" class="muted">${esc(t("reports.supplierEmpty"))}</td></tr>`;
  }

  // --- Direct and indirect expense reports -------------------------------
  const byNature = summariseExpensesByNature(storeExpenses(), monthKey);
  const natureTable = qs("#expenseNatureTable");
  if (natureTable) {
    const section = (nature, group) => {
      if (!group.rows.length) return "";
      return `<tr class="statement-total">
        <td>${esc(t(nature === "direct" ? "expenses.direct" : "expenses.indirect"))}</td>
        <td>${money(group.total)}</td>
      </tr>` + group.rows.map((row) => `<tr>
        <td>${esc(expenseCategoryLabel(row.category))}</td>
        <td>${money(row.amount)}</td>
      </tr>`).join("");
    };
    const body = section("direct", byNature.direct) + section("indirect", byNature.indirect);
    natureTable.innerHTML = body
      || `<tr><td colspan="2" class="muted">${esc(t("reports.expenseNatureEmpty"))}</td></tr>`;
  }
}

// A percentage only when there is a real one to show. summariseProfit() always
// supplies both margins, but this renders onto a money screen and an absent
// field would print "undefined%" beside a correct figure -- which is how a
// reader stops trusting the number next to it. Demonstrated by a test fixture
// that omitted the field.
function withMargin(amount, pct) {
  return Number.isFinite(pct) ? `${amount} · ${pct}%` : amount;
}

function renderProfit() {
  const view = qs("#profit");
  const grid = qs("#profitGrid");
  const note = qs("#profitNote");
  if (!view || !grid || !note) return;
  // Owner-strict, decided 2026-08-21: profit exposes buying prices by
  // inference. canOpenView() is the real gate; this keeps the screen honest if
  // it is ever reached another way.
  if (!isOwnerRole()) {
    grid.innerHTML = "";
    note.textContent = "";
    // Emptied, not merely hidden. A demoted owner's per-product buying prices
    // would otherwise sit in a panel hidden by CSS with every figure still in
    // the DOM -- the same rule renderExpenses() and renderDeliveries() follow.
    const productPanel = qs("#profitProductPanel");
    if (productPanel) productPanel.hidden = true;
    const productTable = qs("#profitProductTable");
    if (productTable) productTable.innerHTML = "";
    return;
  }

  const monthInput = qs("#profitMonthInput");
  if (!state.profitMonthTouched) state.profitMonthSelection = localMonthKey(new Date());
  if (monthInput && monthInput.value !== state.profitMonthSelection) {
    monthInput.value = state.profitMonthSelection;
  }

  const scopedSales = state.currentStoreId === "all"
    ? state.sales
    : (state.sales || []).filter((sale) => saleStoreId(sale) === state.currentStoreId);

  const p = summariseProfit({
    sales: scopedSales,
    costIndex: buildCostIndex(state.productCostHistory),
    expenses: storeExpenses(),
    monthKey: state.profitMonthSelection,
    coverageFromMs: salesCoverageFromMs(),
    vatRegistered: vatSettings().registered
  });

  // Refuses rather than estimating. Section 11 rule 3, and the L-11 precedent:
  // a month that has fallen out of the loaded window would total to LESS than
  // was taken, and a profit statement is exactly the document nobody should be
  // handed a quiet under-count on.
  if (p.outsideWindow) {
    grid.innerHTML = "";
    note.textContent = t("profit.outsideWindow", {
      date: new Date(salesCoverageFromMs()).toLocaleDateString()
    });
    // The drill-down goes with it. A month the statement refuses to total must
    // not be shown a product table built from the same unloaded window -- it
    // would be a confident breakdown of an admittedly incomplete period.
    renderProductProfit(p, state.profitMonthSelection);
    return;
  }

  // The docx section 9 statement, in its order, as a statement rather than four
  // tiles:
  //
  //     Sales Revenue                        45,000,000
  //     Cost of Goods Sold                 (27,000,000)
  //     GROSS PROFIT                         18,000,000
  //     Direct Operating Expenses           (2,000,000)
  //     Indirect Operating Expenses         (8,000,000)
  //     NET PROFIT                            8,000,000
  //
  // Every trust rule from DESIGN-purchases.md 11 survives the change, and two of
  // them are easier to honour as a statement than they were as tiles: gross and
  // net are rows with their own captions and are never summed into one headline,
  // and a figure that cannot be computed shows a dash on its own row rather than
  // being quietly folded into a neighbour.
  //
  // UNKNOWN COST BLANKS THREE ROWS, not one. Cost of goods, gross profit and net
  // profit are all derived from it, and printing revenue against a zero cost
  // would report the whole of revenue as profit -- which is exactly the defect
  // DESIGN-purchases.md 2 found live on the control panel.
  const unknown = "—";
  // Parenthesised, per the docx. Through t() rather than hard-coded brackets,
  // because it is punctuation carrying meaning -- "this is subtracted" -- and
  // that is a translatable decision.
  const deduct = (value) => t("profit.deduction", { value: money(value) });

  const rows = [
    { label: t("profit.stRevenue"), value: money(p.revenue),
      note: t(p.salesCount === 1
        ? (vatSettings().registered ? "profit.revenueNoteVatOne" : "profit.revenueNoteOne")
        : (vatSettings().registered ? "profit.revenueNoteVat" : "profit.revenueNote"),
        { count: String(p.salesCount) }) },
    // Cost of goods is now a STATED LINE rather than an intermediate the reader
    // has to infer from revenue minus gross. It carries the completeness caption
    // because it is the figure the completeness is about.
    { label: t("profit.stCogs"),
      value: p.anyCostKnown ? deduct(p.cogs) : unknown,
      note: !p.anyCostKnown
        ? t("profit.grossNoCost")
        : p.allCostKnown
          ? t("profit.stCogsNote")
          : t("profit.grossPartial", {
              missing: String(p.uncostedLines),
              total: String(p.costedLines + p.uncostedLines)
            }) },
    { label: t("profit.stGross"), total: true,
      value: p.anyCostKnown ? withMargin(money(p.grossProfit), p.grossMarginPct) : unknown,
      tone: p.anyCostKnown && p.grossProfit <= 0 && p.revenue > 0 ? "danger" : "",
      note: p.anyCostKnown ? t("profit.grossNote") : "" },
    { label: t("profit.stDirect"), value: deduct(p.directExpenses),
      note: t("profit.stDirectNote") },
    { label: t("profit.stIndirect"), value: deduct(p.indirectExpenses),
      note: p.anyExpensesRecorded
        ? t("profit.expensesNote", { count: String(p.expenseCount) })
        : t("profit.expensesNone") },
    // Net: never shown as a confident figure while the cost underneath it is
    // unknown. A forgotten expense makes this look BETTER, which is the
    // direction that gets acted on.
    { label: t("profit.stNet"), total: true, bottom: true,
      // Shown with its margin, the way the gross line above it is, because spec
      // 10 prints both -- and a percentage is what makes two months comparable
      // when takings differ.
      value: p.anyCostKnown ? withMargin(money(p.netProfit), p.netMarginPct) : unknown,
      tone: p.anyCostKnown && p.netProfit <= 0 ? "warn" : "",
      note: p.anyCostKnown ? t("profit.netNote") : t("profit.netNoCost") }
  ];

  // A real <table>: this is tabular data with a row header and a figure, and a
  // screen reader should be able to say "Gross profit, 18,000,000" rather than
  // read two unrelated columns of text.
  grid.innerHTML = `<table class="statement">
    <tbody>${rows.map((row) => `<tr class="${row.total ? "statement-total" : ""}${
      row.bottom ? " statement-bottom" : ""}">
      <th scope="row">${esc(row.label)}${
        row.note ? `<span class="muted">${esc(row.note)}</span>` : ""}</th>
      <td class="${row.tone || ""}">${esc(row.value)}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  note.textContent = p.anyCostKnown && p.allCostKnown && p.anyExpensesRecorded
    ? t("profit.complete")
    : t("profit.incomplete");

  // The docx section 10 drill-down, under the statement it explains.
  renderProductProfit(p, state.profitMonthSelection);
}

function renderPurchases() {
  const view = qs("#purchases");
  const table = qs("#purchasesTable");
  const totals = qs("#purchaseTotals");
  if (!view || !table || !totals) return;
  if (!isManagerOrOwnerRole()) {
    table.innerHTML = "";
    totals.innerHTML = "";
    return;
  }

  const monthInput = qs("#purchaseMonthInput");
  if (monthInput && monthInput.value !== state.purchaseMonthSelection) {
    monthInput.value = state.purchaseMonthSelection;
  }

  const scoped = storePurchases();
  if (!state.purchaseMonthTouched) state.purchaseMonthSelection = localMonthKey(new Date());
  const monthKey = state.purchaseMonthSelection;
  const summary = summarisePurchases(scoped, monthKey);

  totals.innerHTML = [
    controlTile(t("purchases.monthTotal"), money(summary.total), "",
      t("purchases.monthCount", {
        count: String(summary.count),
        delivery: t(summary.count === 1 ? "purchases.deliverySingular" : "purchases.deliveryPlural"),
        units: String(summary.units),
        unit: t(summary.units === 1 ? "toast.unitSingular" : "toast.unitPlural")
      })),
    // VAT-registered only. The money whose input tax cannot be reclaimed is a
    // real and useful warning to a registered business, and meaningless to a
    // duka that does not collect VAT -- DESIGN-vat.md decision 4.
    ...(vatSettings().registered ? [
      controlTile(t("purchases.noReceipt"), money(summary.withoutReceipt),
        summary.withoutReceipt > 0 ? "warn" : "",
        summary.withoutReceipt > 0 ? t("purchases.noReceiptNote") : t("purchases.allReceipted"))
    ] : [])
  ].join("");

  const canDelete = isOwnerRole();
  const rows = scoped
    .filter((purchase) => {
      const at = purchasedAt(purchase);
      return at ? localMonthKey(at) === monthKey : false;
    })
    .sort((a, b) => (purchasedAt(b)?.getTime() || 0) - (purchasedAt(a)?.getTime() || 0));

  if (!rows.length) {
    const message = state.currentStoreId ? t("purchases.empty") : t("purchases.emptyNoStore");
    table.innerHTML = `<tr><td colspan="7" class="empty-state">${esc(message)}</td></tr>`;
    return;
  }

  table.innerHTML = rows.map((purchase) => {
    const at = purchasedAt(purchase);
    const receipted = Boolean(purchase.hasFiscalReceipt);
    return `<tr>
      <td>${esc(at ? at.toLocaleDateString() : "—")}</td>
      <td>${esc(purchase.productName || "")}</td>
      <td>${esc(String(safeNumber(purchase.quantity)))}</td>
      <td>${money(Math.round(safeNumber(purchase.unitCost)))}</td>
      <td><strong>${money(safeNumber(purchase.totalPaid))}</strong></td>
      <td class="${receipted ? "" : "cell-warn"}">${esc(receipted
        ? (purchase.receiptNumber || t("purchases.receiptYes"))
        : t("purchases.receiptNo"))}</td>
      <td class="table-actions">
        ${purchaseReturnableQty(purchase) > 0
          ? `<button class="link-button" type="button" data-return-purchase="${esc(purchase.id)}">${esc(t("purchaseReturn.action"))}</button>`
          : `<span class="muted">${esc(t("purchaseReturn.allReturned"))}</span>`}
        ${canDelete ? `<button class="ghost-button compact" type="button" data-delete-purchase="${esc(purchase.id)}">${esc(t("purchases.delete"))}</button>` : ""}
      </td>
    </tr>`;
  }).join("");
}

async function subscribeToServices() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeServices) state.unsubscribeServices();
  try {
    const { collection, onSnapshot, query, where } = state.firebaseApi.firestore;
    const servicesRef = collection(state.db, "users", state.businessOwnerUid, "services");
    const queryStoreIds = await resolveQueryStoreIds();
    // Same reasoning as products: an empty `in` filter is rejected by Firestore
    // outright, so a member with no store access subscribes to nothing rather
    // than sending one.
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.services = [];
      scheduleRenderAll();
      return;
    }
    const servicesQuery = queryStoreIds === null
      ? servicesRef
      : query(servicesRef, where("storeId", "in", queryStoreIds));
    state.unsubscribeServices = onSnapshot(
      servicesQuery,
      (snapshot) => {
        state.services = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        scheduleRenderAll();
      },
      (error) => {
        // Named in the console like the products listener, because the two fail
        // for the same reasons and a silent menu is as confusing as silent
        // stock. Not toasted: a shop with no services yet is the normal case.
        console.warn("[services listener]", error.code || error, "queryStoreIds=", queryStoreIds);
      }
    );
  } catch (error) {
    console.warn(error);
  }
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
      scheduleRenderAll();
      return;
    }
    const customersQuery = queryStoreIds === null
      ? query(customersRef, orderBy("createdAt", "asc"))
      : query(customersRef, where("storeId", "in", queryStoreIds), orderBy("createdAt", "asc"));
    state.unsubscribeCustomers = onSnapshot(customersQuery, (snapshot) => {
      state.customers = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderCustomerAccounts();
      // The owner panel's "Credit outstanding" is summed from these very
      // documents, and this was the only subscription that repainted just its
      // own view. So a repayment lowered the balance, Customer Accounts showed
      // the new figure, and the control panel went on displaying the old debt
      // until some unrelated snapshot happened to trigger a full render -- or
      // the page was reloaded. Reported as credit not clearing after payment.
      //
      // scheduleRenderAll(), not renderAll(): the same once-per-frame
      // coalescing every other subscription uses, so a burst of customer
      // updates still costs one render.
      scheduleRenderAll();
    });
  } catch (error) {
    console.warn(error);
  }
}

// Suppliers. DESIGN-suppliers-purchases.md 4.
//
// Ordered by name rather than createdAt, unlike /customers: a supplier list is
// something you scan for a name you already know, not a feed of who was added
// when. That also means it needs no composite index -- name is the only
// ordering, and the storeId filter is an equality.
async function subscribeToSuppliers() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeSuppliers) state.unsubscribeSuppliers();
  try {
    const { collection, onSnapshot, orderBy, query, where } = state.firebaseApi.firestore;
    const suppliersRef = collection(state.db, "users", state.businessOwnerUid, "suppliers");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.suppliers = [];
      scheduleRenderAll();
      return;
    }
    const suppliersQuery = queryStoreIds === null
      ? query(suppliersRef, orderBy("name", "asc"))
      : query(suppliersRef, where("storeId", "in", queryStoreIds), orderBy("name", "asc"));
    state.unsubscribeSuppliers = onSnapshot(suppliersQuery, (snapshot) => {
      state.suppliers = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      scheduleRenderAll();
    });
  } catch (error) {
    console.warn(error);
  }
}

// Goods sent back to suppliers. Manager-and-owner, like /purchases itself: the
// rules have no cashier branch, and subscribing anyway would put a
// permission-denied in every cashier's console on every sign-in.
async function subscribeToPurchaseReturns() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribePurchaseReturns) state.unsubscribePurchaseReturns();
  if (!isManagerOrOwnerRole()) {
    state.purchaseReturns = [];
    return;
  }
  try {
    const { collection, onSnapshot, orderBy, query, where, limit } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "purchaseReturns");
    const queryStoreIds = await resolveQueryStoreIds();
    if (queryStoreIds !== null && queryStoreIds.length === 0) {
      state.purchaseReturns = [];
      scheduleRenderAll();
      return;
    }
    const returnsQuery = queryStoreIds === null
      ? query(ref, orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT))
      : query(ref, where("storeId", "in", queryStoreIds),
              orderBy("createdAt", "desc"), limit(ACCOUNTS_HISTORY_LIMIT));
    state.unsubscribePurchaseReturns = onSnapshot(returnsQuery, (snapshot) => {
      state.purchaseReturns = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      scheduleRenderAll();
    }, (error) => {
      console.warn("[purchaseReturns listener]", error.code || error);
    });
  } catch (error) {
    console.warn(error);
  }
}

// Active suppliers, for the pickers. An inactive supplier stays in reports and
// on the purchases it is already attached to -- it is only kept out of lists
// where someone is choosing who to buy from next.
function activeSuppliers() {
  return (state.suppliers || []).filter((supplier) => supplier.active !== false);
}

// Links a purchase to a supplier RECORD when the typed name matches one.
//
// A match, deliberately, rather than a required picker. The delivery, restock
// and product forms have always taken free text; eight shops are mid-flow in
// them, and a device that has been offline may not hold the supplier list yet.
// An unmatched name still writes supplierName exactly as it always did, so
// nothing that works today stops working -- DESIGN-suppliers-purchases.md 4.3.
function supplierLinkFor(name) {
  const wanted = String(name || "").trim().toLowerCase();
  if (!wanted) return {};
  const match = (state.suppliers || []).find(
    (supplier) => String(supplier.name || "").trim().toLowerCase() === wanted);
  return match ? { supplierId: match.id } : {};
}

function supplierById(supplierId) {
  if (!supplierId) return null;
  return (state.suppliers || []).find((supplier) => supplier.id === supplierId) || null;
}

// The name to show for a purchase. supplierId wins when the purchase was
// recorded against a real supplier record, because the record can be renamed
// and the purchase should follow; supplierName is what every purchase written
// before this design has, and is the only thing those will ever have.
function purchaseSupplierLabel(purchase) {
  const linked = supplierById(purchase?.supplierId);
  return linked?.name || purchase?.supplierName || "";
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
  // The money is in the drawer now, so the panel has to say so. Nothing else
  // re-renders this: the customer document changes, but the repayment figure
  // comes from the audit log, which is not subscribed.
  invalidateRepaymentsToday();
  renderManagerControl();
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

  const raw = await askText(
    t("dialog.creditLimitPrompt", { name: customer.name || customer.phone || "", currency: currentCurrencyCode() }),
    { defaultValue: customer.creditLimit != null ? String(customer.creditLimit) : "", numeric: true });
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
      const previousLimit = customer.creditLimit;
      await setDoc(doc(state.db, "users", state.businessOwnerUid, "customers", customerId), { creditLimit: nextLimit }, { merge: true });
      try {
        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        // Omitted, never nulled -- the same rule moneyAuditEntry() follows, and
        // for the same reason. A null is a PRESENT key whose value is not a
        // number, so the moment anyone gives previousLimit a type check the way
        // customerId, category and expenseId already have one, every first-time
        // credit limit would be refused. That is not hypothetical here: a null
        // customerId in an audit entry is what took every credit sale to a new
        // customer down, and this is the same shape one tightening away.
        //
        // previousLimit is absent when the customer never had a limit, and
        // newLimit is absent when the owner is clearing one.
        const entry = {
          action: "CREDIT_LIMIT_CHANGED",
          customerId,
          createdAt: serverTimestamp()
        };
        if (Number.isFinite(previousLimit)) entry.previousLimit = previousLimit;
        if (Number.isFinite(nextLimit)) entry.newLimit = nextLimit;
        if (state.user?.uid) entry.uid = state.user.uid;
        await setDoc(auditRef, entry);
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
  const acknowledged = await askConfirm(t("dialog.creditLimitExceededConfirm", {
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

// When this product was bought or otherwise added, and what it cost.
//
// The dialog already answered "where did it go" -- sales and transfers -- and
// said nothing about where it CAME from, which is the other half of a stock
// question and the half that carries the money.
//
// Read from the Purchase Book, so a delivery line, a costed restock and the
// cost captured on a product form all appear here in one list without this
// function knowing which was which. A cashier restock records no purchase and
// so does not appear; that is the same gap DESIGN-purchases.md 12 accepts
// everywhere else, and the stock ledger is where an uncosted addition shows up.
function productPurchaseEntries(productId) {
  return (state.purchases || [])
    .filter((purchase) => purchase.productId === productId)
    .map((purchase) => ({
      date: purchasedAt(purchase),
      supplierName: purchase.supplierName || "",
      qty: safeNumber(purchase.quantity),
      totalPaid: safeNumber(purchase.totalPaid),
      unitCost: safeNumber(purchase.unitCost),
      // Present only on a line that came in on a delivery, which is what tells
      // a reader the freight in the unit cost is real rather than assumed.
      landedCost: purchase.landedCost === undefined ? null : safeNumber(purchase.landedCost),
      fromDelivery: Boolean(purchase.deliveryId)
    }))
    .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
}

// One line per thing that moved this product, oldest first, with the shelf
// count carried down the page. Spec 4.3.
//
// Oldest first is the whole point: a running balance read top to bottom only
// makes sense forwards, and every other list in this app is newest first
// precisely because it is NOT cumulative.
//
// The balance column is the LEDGER's own quantityAfter, not a total this
// function adds up. An entry written offline carries no chain (L-9), and
// inventing a balance for it would be a guess wearing the authority of a
// measurement -- so those rows say so instead.
function buildStockLedgerRows(movements) {
  const ordered = [...movements].sort((a, b) => (a.at?.getTime() || 0) - (b.at?.getTime() || 0));
  return ordered.map((entry) => {
    const delta = safeNumber(entry.delta);
    const label = entry.reason === "adjustment" && entry.adjustmentReason
      ? `${t("movement.reason.adjustment")} \u2014 ${stockAdjustmentReasonLabel(entry.adjustmentReason)}`
      : t(`movement.reason.${entry.reason}`);
    const balance = entry.offline || entry.quantityAfter === undefined || entry.quantityAfter === null
      ? `<span class="muted">${t("movement.balanceUnknown")}</span>`
      : String(safeNumber(entry.quantityAfter));
    return `<tr>
      <td>${entry.at ? entry.at.toLocaleString() : "-"}</td>
      <td>${esc(label)}</td>
      <td>${delta > 0 ? delta : ""}</td>
      <td>${delta < 0 ? Math.abs(delta) : ""}</td>
      <td>${balance}</td>
    </tr>`;
  }).join("");
}

function buildProductMovementHtml(productId, movements = null) {
  const product = state.products.find((item) => item.id === productId);
  const productName = product ? esc(productDisplayLabel(product)) : "";
  const sales = productSalesEntries(productId);
  const transfers = productTransferEntries(productId);
  // Cost is manager-and-owner, exactly as /purchases is in firestore.rules --
  // and state.purchases is empty for a cashier anyway, because
  // subscribeToPurchases() refuses to subscribe for one. The role test is here
  // so the section is absent rather than empty, which says something different.
  const purchases = isManagerOrOwnerRole() ? productPurchaseEntries(productId) : [];
  const showPurchases = isManagerOrOwnerRole();

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

  const purchaseRows = purchases
    .map(
      (entry) => `<tr>
        <td>${entry.date ? entry.date.toLocaleString() : "-"}</td>
        <td>${esc(entry.supplierName || "-")}</td>
        <td>${entry.qty}</td>
        <td>${money(entry.totalPaid)}</td>
        <td>${money(entry.unitCost)}</td>
        <td>${entry.landedCost === null
          ? `<span class="muted">${esc(t("movement.noLanded"))}</span>`
          : money(entry.landedCost)}</td>
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
      <tbody>${salesRows || `<tr><td colspan="5" class="empty-state">${t("movement.noSalesForProduct")}</td></tr>`}</tbody>
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
    ${movements === null ? "" : `<h3>${t("movement.ledgerSectionTitle")}</h3>
    <p class="muted">${t("movement.ledgerSubtitle")}</p>
    <div class="table-scroll"><table>
      <thead><tr>
        <th>${t("movement.colDate")}</th>
        <th>${t("movement.colWhat")}</th>
        <th>${t("movement.colIn")}</th>
        <th>${t("movement.colOut")}</th>
        <th>${t("movement.colBalance")}</th>
      </tr></thead>
      <tbody>${buildStockLedgerRows(movements)
        || `<tr><td colspan="5" class="empty-state">${t("movement.noLedger")}</td></tr>`}</tbody>
    </table></div>`}
    ${showPurchases ? `<h3>${t("movement.purchasesSectionTitle")}</h3>
    <p class="muted">${t("movement.purchasesSubtitle")}</p>
    <table>
      <thead>
        <tr>
          <th>${t("movement.colDate")}</th>
          <th>${t("movement.colSupplier")}</th>
          <th>${t("movement.colQty")}</th>
          <th>${t("movement.colTotalPaid")}</th>
          <th>${t("movement.colEach")}</th>
          <th>${t("movement.colLanded")}</th>
        </tr>
      </thead>
      <tbody>${purchaseRows || `<tr><td colspan="6" class="empty-state">${t("movement.noPurchases")}</td></tr>`}</tbody>
    </table>` : ""}
  `;
}

function renderProductMovementDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  setDynamicText("#productMovementDialogTitle", product ? `${t("movement.title")} \u2014 ${productDisplayLabel(product)}` : t("movement.title"));
  qs("#productMovementContent").innerHTML = buildProductMovementHtml(productId);
}

// The ledger is fetched for THIS product when the dialog opens rather than kept
// in a live subscription: /stockMovements is owner-read only and grows without
// bound, so keeping every product's history warm would be a large payload for a
// panel that is opened occasionally.
async function loadProductStockLedger(productId) {
  if (!state.db || !state.businessOwnerUid || !isOwnerRole()) return null;
  try {
    const { collection, getDocs, orderBy, query, where, limit } = state.firebaseApi.firestore;
    const ref = collection(state.db, "users", state.businessOwnerUid, "stockMovements");
    const snap = await getDocs(query(ref,
      where("productId", "==", productId),
      orderBy("createdAt", "desc"),
      limit(200)));
    return snap.docs.map((docSnap) => {
      const data = docSnap.data();
      return { id: docSnap.id, ...data, at: purchasedAt(data) };
    });
  } catch (error) {
    console.warn("Could not load the stock ledger for this product.", error);
    return null;
  }
}

async function openProductMovementDialog(productId) {
  state.productMovementProductId = productId;
  // Opened first, with everything already in memory. The ledger fetch below can
  // be slow on a bad connection, and a dialog that appears only after it looks
  // like a broken button.
  renderProductMovementDialog(productId);
  qs("#productMovementDialog").showModal();

  const movements = await loadProductStockLedger(productId);
  // Still the same product? A slow fetch that lands after the user has closed
  // the dialog, or opened a different product, must not repaint over them.
  if (movements && state.productMovementProductId === productId && qs("#productMovementDialog")?.open) {
    qs("#productMovementContent").innerHTML = buildProductMovementHtml(productId, movements);
  }
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

async function sendPurchaseOrderWhatsApp(groupIndex) {
  const group = currentPoGroupQuantities(groupIndex);
  if (!group || !group.items.length) return showToast(t("toast.poAllQuantitiesZero"));

  const rawPhone = await askText(t("dialog.customerPhonePrompt"));
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

  // Spec 4.2. On an EXISTING product the shelf count is read-only: it is
  // derived from movements, and Adjust is the path that records who changed it
  // and why. On a new one it stays editable, because that number is the
  // opening stock and there is no ledger to derive it from yet.
  const quantityInput = form.elements.quantity;
  const lockNote = qs("#productQuantityLockNote");
  if (quantityInput) {
    quantityInput.readOnly = Boolean(product);
    if (lockNote) lockNote.hidden = !product;
  }
  renderProductCostFields(Boolean(product));
  qs("#productDialog").showModal();
}

// Opening-stock cost, and ONLY when adding. On an edit this stays hidden: cost
// is forward-only, so a box here would either do nothing or append a cost
// record every time someone corrected a spelling. Correcting a cost that is
// already recorded is a restock, which is where the weighted average lives.
//
// Hidden from a cashier for the same reason the restock block is -- though a
// cashier cannot reach this form at all, since /products create is owner or
// manager. Belt and braces, because the day that changes this should not
// quietly start offering cost to a till.
function renderProductCostFields(isEdit) {
  // ALWAYS hidden since 2026-09-10. Inventory records what is on the shelf --
  // typically stock that was already there when the shop started using this --
  // and cost now belongs to Purchases, where a delivery states what was paid
  // and freight is spread across the lines. Two places to enter a cost meant
  // two answers to "what did this cost", and the weighted average had to
  // reconcile both.
  //
  // The fields and their write path are HIDDEN rather than deleted: an owner
  // may want opening-stock cost back, and hiding is reversible in one line
  // where removing the capture path is not. They are cleared below, so nothing
  // stale is ever submitted from them.
  //
  // The consequence is real and is the honest one: opening stock carries no
  // cost, so its margin reads as unknown until that product is bought again
  // through Purchases. The Profit Report already refuses to treat an unknown
  // cost as zero -- it blanks the row rather than reporting revenue as profit.
  const fields = qs("#productCostFields");
  if (fields) fields.hidden = true;
  const receiptFields = qs("#productReceiptFields");
  if (receiptFields) receiptFields.hidden = true;
  const hasReceipt = qs("#productHasReceiptInput");
  if (hasReceipt) hasReceipt.checked = false;
  for (const id of ["#productTotalPaidInput", "#productReceiptInput", "#productReceiptDateInput",
                    "#productVatAmountInput"]) {
    const node = qs(id);
    if (node) node.value = "";
  }
  const error = qs("#productTotalPaidError");
  if (error) error.textContent = "";
  renderProductUnitCostHint();
}

// The same live per-unit readout the restock dialog shows, and for the same
// reason: the per-unit figure is what a shopkeeper actually reasons about, so
// showing it is how a mis-keyed total gets caught before it becomes the cost
// basis for every sale of that product.
function renderProductUnitCostHint() {
  const hint = qs("#productUnitCostHint");
  if (!hint) return;
  const total = safeNumber(qs("#productTotalPaidInput")?.value);
  const qty = safeNumber(qs("#productForm")?.elements?.quantity?.value);
  hint.textContent = (total > 0 && qty > 0)
    ? t("product.unitCostHint", { each: money(total / qty) })
    : "";
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

async function saveProduct(product, costCapture = null) {
  const existing = product.id ? state.products.find((item) => item.id === product.id) : null;
  if (!existing && state.db && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreBeforeAdd"));
    return;
  }
  // No store at all is a different condition from "all stores", and it was the
  // only one of the two this path did not refuse -- completeSale() has always
  // checked both. Without it the line below falls through every falsy branch
  // and writes storeId: "", which no scoped view can ever show:
  //
  //   - the person who added it sees nothing, because a staff subscription
  //     filters where("storeId","in",[their stores]) and "" is in no list
  //   - the owner sees it appear in whichever store happens to be first,
  //     because productStoreId() falls back to state.stores[0]
  //
  // Reported as stock added by a new user landing in the older account and
  // never showing in their own. The usual cause is a staff member with no
  // store assigned, whose store list resolves empty -- so this refuses rather
  // than filing the product somewhere nobody chose.
  if (!existing && state.db && !state.currentStoreId) {
    // Two different situations reach here and they need different answers. A
    // staff member with no store assigned will never succeed by waiting, and
    // "try again in a moment" sends them round that loop indefinitely -- the
    // owner has to grant them a store. An owner with no store yet really is
    // mid-load, because ensureDefaultStore() creates one.
    const staffWithoutStore = state.user && state.user.uid !== state.businessOwnerUid && !state.stores.length;
    showToast(staffWithoutStore ? t("toast.noStoreAssigned") : t("toast.loadingStore"));
    return;
  }
  product.id = product.id || crypto.randomUUID();
  // existing?.storeId is deliberately still first, and deliberately still a
  // falsy check: a product already saved with an empty storeId is repaired by
  // the next edit rather than keeping the broken value forever.
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

      // Opening stock that the shop already owns and already has a receipt for.
      // Written AFTER the product exists, in one batch, and only on a create --
      // see renderProductCostFields() for why this is never offered on an edit.
      //
      // The document shapes are deliberately identical to the ones the restock
      // transaction writes. A second dialect of "purchase" would be a second
      // thing for the Purchase Book and costInForceAt() to understand, and the
      // first one to drift would be the one nobody was testing.
      //
      // Not a transaction: unlike a restock there is no read-modify-write of a
      // shelf count, so there is nothing to race against. This product did not
      // exist a moment ago, so it has no prior cost to average against either --
      // the batch price IS the cost, which is nextUnitCost()'s empty-shelf case.
      if (costCapture) {
        try {
          const { Timestamp, serverTimestamp: stamp, writeBatch } = state.firebaseApi.firestore;
          const unitCost = costCapture.totalPaid / costCapture.quantity;
          const storeId = productStoreId(product);
          const batch = writeBatch(state.db);

          batch.set(doc(collection(state.db, "users", state.businessOwnerUid, "productCostHistory")), {
            productId: product.id,
            storeId,
            costPrice: unitCost,
            effectiveFrom: stamp(),
            reason: "purchase",
            createdAt: stamp()
          });
          batch.set(doc(state.db, "users", state.businessOwnerUid, "productCosts", product.id), {
            storeId,
            costPrice: unitCost,
            costKnownFrom: Timestamp.now(),
            updatedAt: stamp()
          });
          batch.set(doc(collection(state.db, "users", state.businessOwnerUid, "purchases")), {
            storeId,
            productId: product.id,
            // Denormalised, like the restock path: the Purchase Book is a record
            // of what was paid and must survive the product being deleted.
            productName: product.name || "",
            quantity: costCapture.quantity,
            totalPaid: costCapture.totalPaid,
            // Unrounded on purpose -- rounding loses money against the invoice.
            unitCost,
            hasFiscalReceipt: costCapture.hasFiscalReceipt,
            ...(costCapture.receiptNumber ? { receiptNumber: costCapture.receiptNumber } : {}),
            ...(costCapture.supplierName ? { supplierName: costCapture.supplierName } : {}),
            ...supplierLinkFor(costCapture.supplierName),
            ...(costCapture.receiptDate ? { receiptDate: Timestamp.fromDate(costCapture.receiptDate) } : {}),
            ...(costCapture.vatAmount ? { vatAmount: costCapture.vatAmount } : {}),
            recordedByUid: state.user.uid,
            createdAt: stamp()
          });

          await batch.commit();
        } catch (costError) {
          // The product saved; only the cost did not. Say so rather than
          // failing silently -- a shop that believes it recorded what it paid
          // and did not will price against a margin that is not there.
          console.warn(costError);
          showToast(t("toast.productSavedWithoutCost"));
        }
      }
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
  // A cost was just written, so the fetched map is out of date. Dropped
  // rather than refetched: nothing may be looking at a cost right now, and
  // the next surface that wants one will ask.
  invalidateProductCosts();
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

  // Same guard, and for the same reason, as #completeSaleButton below. Nothing
  // above this line awaits, so the only window a second click can land in is
  // the one that opens here -- and it is a wide one: a lookup, then a
  // transaction, over shop wifi. The dialog stays open and interactive for all
  // of it, which is exactly when somebody presses Transfer again.
  //
  // A second run is not a harmless repeat. It moves the stock twice, writes two
  // rows into transfer history, and where the destination has no matching SKU
  // yet, both runs read that as empty outside the transaction and each creates
  // its own destination product -- one SKU, two shelves, in a system whose
  // whole job is knowing where the stock is.
  const confirmButton = qs("#confirmTransferButton");
  if (confirmButton.disabled) return;
  confirmButton.disabled = true;

  try {
    const { collection, doc, runTransaction, serverTimestamp, query, where, getDocs, Timestamp } = state.firebaseApi.firestore;
    const productsRef = collection(state.db, "users", state.businessOwnerUid, "products");
    const sourceRef = doc(productsRef, product.id);

    const matchQuery = query(productsRef, where("storeId", "==", destinationStore.id), where("sku", "==", product.sku));
    const matchSnapOutsideTx = await getDocs(matchQuery);
    const destinationRef = matchSnapOutsideTx.empty ? doc(productsRef) : matchSnapOutsideTx.docs[0].ref;
    const destinationExisted = !matchSnapOutsideTx.empty;
    const transferRef = doc(collection(state.db, "users", state.businessOwnerUid, "transfers"));

    // A first transfer into a branch CREATES a product there, and
    // firestore.rules has always carried `allow create: if isOwner(userId)` on
    // /products -- so this has never worked for a manager. It failed with a
    // bare "your account is not allowed to do this" AFTER the dialog had taken
    // the quantity, which reads as the app being broken rather than as a
    // permission they do not have. Refused here, with a message that says what
    // to do about it. KNOWN-LIMITATIONS.md L-14.
    if (!destinationExisted && !isOwnerRole()) {
      showToast(t("toast.transferNeedsOwnerFirst", { store: destinationStore.name || "" }));
      return;
    }

    const costsRef = collection(state.db, "users", state.businessOwnerUid, "productCosts");
    const sourceCostRef = doc(costsRef, product.id);
    const destinationCostRef = doc(costsRef, destinationRef.id);

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

      // Every read before any write. Firestore refuses a transaction that
      // reads after writing, and this one now reads up to four documents.
      const sourceCostSnap = await transaction.get(sourceCostRef);
      const destinationCostSnap = destinationExisted
        ? await transaction.get(destinationCostRef)
        : null;

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

      // A transfer-in is stock ARRIVING at a known cost -- the same event as a
      // restock, and the destination's weighted average has to move for it.
      // Before this, transfer-in added units and touched no cost at all: 100
      // units costing 2,000 landing in a branch holding 100 at 500 left that
      // branch reporting 200 x 500 = 100,000 of stock value against 300,000
      // actually paid. DESIGN-purchases.md section 7.
      //
      // It is NOT a purchase. Nothing is written to /purchases, or the Purchase
      // Book would count the group's buying twice.
      const sourceCost = sourceCostSnap.exists() ? sourceCostSnap.data() : null;
      if (sourceCost && safeNumber(sourceCost.costPrice) > 0) {
        const existingDestCost = destinationCostSnap?.exists() ? destinationCostSnap.data() : null;
        const unitCost = nextUnitCost({
          oldQuantity: destinationQty,
          oldUnitCost: safeNumber(existingDestCost?.costPrice),
          costKnown: productCostKnown(existingDestCost),
          deliveredQuantity: qty,
          // The source's average IS the batch price for this arrival.
          totalPaid: safeNumber(sourceCost.costPrice) * qty
        });
        transaction.set(doc(collection(state.db, "users", state.businessOwnerUid, "productCostHistory")), {
          productId: destinationRef.id,
          storeId: destinationStore.id,
          costPrice: unitCost,
          effectiveFrom: serverTimestamp(),
          reason: "transfer-in",
          createdAt: serverTimestamp()
        });
        transaction.set(destinationCostRef, {
          storeId: destinationStore.id,
          costPrice: unitCost,
          // Stamped NOW for a branch receiving costed stock for the first time:
          // this is the moment cost became knowable HERE. An existing stamp is
          // carried forward, because the rules pin it.
          costKnownFrom: existingDestCost?.costKnownFrom || Timestamp.now(),
          updatedAt: serverTimestamp()
        });
      }
      // The SOURCE's average is deliberately untouched. Removing units at the
      // prevailing average does not change the average; only its own purchases
      // do.

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
  } finally {
    // Every path, so neither a failure nor a close can leave the next transfer
    // facing a dead button.
    confirmButton.disabled = false;
  }
}

function openRestockDialog(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  state.pendingRestockProductId = productId;
  qs("#restockProductLabel").textContent = t("restock.productLabel", { name: product.name, quantity: product.quantity });
  renderRestockCostFields();
  qs("#restockQuantityInput").value = "";
  qs("#restockDialog").showModal();
}

// The cost block is hidden for a cashier, not disabled. firestore.rules refuses
// costPrice on a cashier's product update, so offering the field would present
// something the save is going to reject -- and "hide, don't disable" is the same
// convention renderServices() uses for a tab a duka must never see.
function renderRestockCostFields() {
  const fields = qs("#restockCostFields");
  if (fields) fields.hidden = !canRecordCost();
  // DESIGN-vat.md decision 4: VAT is per business, forward-only, off by default.
  // A shop that does not collect it must not be told it is losing a claim it was
  // never entitled to make.
  const receiptFields = qs("#restockReceiptFields");
  if (receiptFields) receiptFields.hidden = !canRecordCost() || !vatSettings().registered;
  const hasReceipt = qs("#restockHasReceiptInput");
  if (hasReceipt) hasReceipt.checked = false;
  for (const id of ["#restockTotalPaidInput", "#restockSupplierInput", "#restockReceiptInput",
                    "#restockVatAmountInput"]) {
    const node = qs(id);
    if (node) node.value = "";
  }
  const error = qs("#restockTotalPaidError");
  if (error) error.textContent = "";
  renderRestockUnitCostHint();
}

// Shows what the batch works out to per unit while it is being typed. This is
// the number the shop actually reasons about, and showing it is how a mis-keyed
// total gets caught before it moves the weighted average.
function renderRestockUnitCostHint() {
  const hint = qs("#restockUnitCostHint");
  if (!hint) return;
  const qty = Math.floor(safeNumber(qs("#restockQuantityInput")?.value));
  const paid = safeNumber(qs("#restockTotalPaidInput")?.value);
  if (!(qty > 0) || !(paid > 0)) {
    hint.textContent = "";
    return;
  }
  hint.textContent = t("restock.unitCostHint", { value: money(Math.round(paid / qty)) });
}

// Same shape as awaitSaleTransaction(), and for the same reason: a transaction
// over shop wifi can hang indefinitely, and a hung promise leaves the button
// disabled behind it for the rest of the session.
async function awaitRestockTransaction(attempt) {
  let timeoutId = null;
  try {
    return await Promise.race([
      attempt.then(() => "committed"),
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve("unconfirmed"), RESTOCK_TRANSACTION_TIMEOUT_MS);
      })
    ]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function confirmRestock() {
  const productId = state.pendingRestockProductId;
  const product = state.products.find((item) => item.id === productId);
  if (!product) return qs("#restockDialog").close();

  const qty = Math.floor(Number(qs("#restockQuantityInput").value));
  if (!Number.isFinite(qty) || qty <= 0) return showToast(t("toast.restockInvalidQuantity"));

  // OFFLINE-CAPABILITIES.md line 52 promises "Restocking -- refused until the
  // connection returns", and until now nothing implemented it. A restock is a
  // runTransaction, which cannot complete without a server: the promise never
  // settled, the finally never ran, and the Confirm button stayed disabled
  // until the page was reloaded. That is the same failure app.js:8015 records
  // for the sale path, which is why the sale path has both a guard and a
  // timeout. This is the guard.
  if (isOfflineNow()) return showToast(t("toast.restockOffline"));

  // Cost is optional on every restock. A cashier cannot record it at all, and a
  // manager who does not know the invoice yet should still be able to count the
  // delivery in -- those units are absorbed at the prevailing average, which is
  // the bounded inaccuracy DESIGN-purchases.md 12 accepts.
  const recordingCost = canRecordCost();
  const totalPaidRaw = recordingCost ? String(qs("#restockTotalPaidInput")?.value || "").trim() : "";
  // Read ONCE, here, outside the transaction. These used to be read inside
  // runTransaction's callback, which Firestore re-runs on contention -- and the
  // dialog stays open and interactive for all of it, so a retry could pick up
  // fields another dialog had already blanked and write the purchase with the
  // supplier and receipt gone.
  const receiptNumber = recordingCost ? String(qs("#restockReceiptInput")?.value || "").trim().slice(0, 60) : "";
  const supplierName = recordingCost ? String(qs("#restockSupplierInput")?.value || "").trim().slice(0, 120) : "";
  const supplierTin = recordingCost ? String(qs("#restockSupplierTinInput")?.value || "").trim().slice(0, 20) : "";
  const receiptDateRaw = recordingCost ? String(qs("#restockReceiptDateInput")?.value || "").trim() : "";
  // Asserted, not inferred. hasFiscalReceipt used to be Boolean(receiptNumber),
  // which was wrong both ways: a manager holding a receipt who did not type the
  // number was counted as having lost a VAT claim they actually have, and
  // anything typed in the box -- "n/a" included -- asserted one exists.
  const hasFiscalReceipt = recordingCost && Boolean(qs("#restockHasReceiptInput")?.checked);
  // Copied off the receipt rather than derived -- DESIGN-vat.md. Only meaningful
  // for a registered business, so it is only read for one.
  const vatAmount = (recordingCost && vatSettings().registered)
    ? clampNonNegativeNumber(String(qs("#restockVatAmountInput")?.value || "").trim() || "0", MAX_MONEY)
    : null;
  const totalPaid = totalPaidRaw ? clampNonNegativeNumber(totalPaidRaw, MAX_MONEY) : null;
  const errorSlot = qs("#restockTotalPaidError");
  if (errorSlot) errorSlot.textContent = "";
  // Local parts at midday, the same way an expense date is parsed -- new
  // Date("2026-08-21") is UTC midnight, which is the previous day west of
  // Greenwich.
  let receiptDate = null;
  if (receiptDateRaw) {
    const [ry, rm, rd] = receiptDateRaw.split("-").map(Number);
    const parsed = new Date(ry, (rm || 1) - 1, rd || 1, 12, 0, 0);
    if (!Number.isNaN(parsed.getTime())) receiptDate = parsed;
  }
  if (totalPaidRaw && (totalPaid === null || totalPaid <= 0)) {
    if (errorSlot) errorSlot.textContent = t("restock.totalPaidInvalid");
    return;
  }
  // Refused, not clamped. A VAT figure above the total is a typo, and silently
  // reducing it would file a number the receipt does not say.
  const vatSlot = qs("#restockVatAmountError");
  if (vatSlot) vatSlot.textContent = "";
  if (vatAmount && totalPaid && vatAmount > totalPaid) {
    if (vatSlot) vatSlot.textContent = t("restock.vatAmountInvalid");
    return;
  }

  const newQuantityDisplay = Number(product.quantity || 0) + qty;

  // The third of these, after #completeSaleButton and #confirmTransferButton.
  // A restock is the same shape of risk as a transfer running twice: the
  // transaction reads the shelf and adds to what it finds, so two runs add the
  // delivery twice and the shop believes it holds stock that was never
  // delivered. Nothing above this line awaits, so this is where the window
  // opens; the finally below closes it on every path, including the render.
  const confirmButton = qs("#confirmRestockButton");
  if (confirmButton.disabled) return;
  confirmButton.disabled = true;

  try {

  if (state.db && state.user && state.businessOwnerUid) {
    try {
      const { doc, collection, runTransaction, serverTimestamp, Timestamp } = state.firebaseApi.firestore;
      const productRef = doc(state.db, "users", state.businessOwnerUid, "products", productId);
      // Keyed by productId, so this is a direct read rather than a query.
      const costRef = doc(state.db, "users", state.businessOwnerUid, "productCosts", productId);
      const purchaseRef = totalPaid
        ? doc(collection(state.db, "users", state.businessOwnerUid, "purchases"))
        : null;
      // ...and this is the timeout. The guard above only catches a connection
      // the device KNOWS is down. The case that hangs is shop wifi up and the
      // uplink dead -- navigator.onLine stays true, serverReachable has not
      // flipped yet, and runTransaction waits forever. Bounded, so the dialog
      // and the button come back either way.
      const attempt = runTransaction(state.db, async (transaction) => {
        const snap = await transaction.get(productRef);
        if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: product.name }));
        // Both reads before any write: Firestore refuses a transaction that
        // reads after writing, and this one now reads two documents.
        const costSnap = totalPaid ? await transaction.get(costRef) : null;
        const before = snap.data();
        const currentQuantity = Number(before.quantity || 0);
        const productUpdate = {
          quantity: currentQuantity + qty,
          updatedAt: serverTimestamp(),
          movementReason: "restock"
        };

        // The weighted average, recomputed from what the shelf ACTUALLY holds
        // inside the transaction -- not from the cached copy the dialog opened
        // with, which another till may have moved. This is the read the whole
        // costing method depends on, and it is free here because the restock
        // transaction already had to make it.
        if (totalPaid && purchaseRef) {
          const existingCost = costSnap?.exists() ? costSnap.data() : null;
          const unitCost = nextUnitCost({
            oldQuantity: currentQuantity,
            oldUnitCost: safeNumber(existingCost?.costPrice),
            costKnown: productCostKnown(existingCost),
            deliveredQuantity: qty,
            totalPaid
          });
          // Appended in the same transaction as the average it records, so the
          // current cost and its history cannot disagree. This is what replaces
          // a unitCost on the sale line -- DESIGN-purchases.md 13f.
          transaction.set(doc(collection(state.db, "users", state.businessOwnerUid, "productCostHistory")), {
            productId,
            storeId: productStoreId(product),
            costPrice: unitCost,
            // serverTimestamp, not the device clock: this decides which cost
            // applied to a sale, and a sale's createdAt is a serverTimestamp
            // too. Comparing one authority against another is the only way the
            // comparison means anything.
            effectiveFrom: serverTimestamp(),
            reason: "purchase",
            createdAt: serverTimestamp()
          });
          transaction.set(costRef, {
            storeId: productStoreId(product),
            costPrice: unitCost,
            // Carried forward, never restamped. firestore.rules pins it across
            // updates, so sending anything else here would be refused rather
            // than silently moving the moment cost became knowable.
            costKnownFrom: existingCost?.costKnownFrom || Timestamp.now(),
            updatedAt: serverTimestamp()
          });

          transaction.set(purchaseRef, {
            storeId: productStoreId(product),
            productId,
            // Denormalised so the Purchase Book survives the product being
            // deleted -- the book is a record of what was paid, and it must not
            // become a list of blanks because a line was tidied off the shelf.
            productName: product.name || "",
            quantity: qty,
            totalPaid,
            // Unrounded, on purpose. Rounding here loses money against the
            // invoice on every delivery. DESIGN-purchases.md 3.
            unitCost: totalPaid / qty,
            hasFiscalReceipt,
            // Omitted when blank, never written empty: firestore.rules bounds
            // these as strings and the Purchase Book reads them.
            ...(receiptNumber ? { receiptNumber } : {}),
            ...(supplierName ? { supplierName } : {}),
            ...(supplierTin ? { supplierTin } : {}),
            // The field the six-month input-VAT window actually runs from.
            // RESEARCH-accounts.md 5.3 -- a purchase recorded without it loses a
            // claim the shop was entitled to, and until now it was in the schema,
            // permitted by the rules, and written by nothing.
            ...(receiptDate ? { receiptDate: Timestamp.fromDate(receiptDate) } : {}),
            // Omitted when absent, never written as zero: a zero would read as
            // "the supplier charged no VAT", which is a different claim from
            // "nobody has recorded it yet" -- and the VAT record distinguishes
            // them.
            ...(vatAmount ? { vatAmount } : {}),
            recordedByUid: state.user?.uid || null,
            createdAt: serverTimestamp()
          });
        }

        transaction.update(productRef, productUpdate);
        recordStockMovement(transaction, {
          productId, productName: product.name, storeId: productStoreId(product),
          reason: "restock", delta: qty, quantityBefore: currentQuantity
        });

        const auditRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
        // The purchase and its money ride on the entry the restock already
        // writes, rather than a second entry. Every write in a transaction pays
        // its own rules evaluation, and this transaction is already four
        // documents deep for a manager -- who pays a member read on each.
        //
        // Both fields are OMITTED when no cost was recorded, never nulled:
        // auditStringsBounded() refuses a present-but-null purchaseId, and that
        // would take the whole restock down with it.
        transaction.set(auditRef, {
          action: "PRODUCT_RESTOCKED",
          productId,
          name: product.name || "",
          qtyAdded: qty,
          ...(purchaseRef && totalPaid ? { purchaseId: purchaseRef.id, amount: totalPaid } : {}),
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
      });
      // Unlike a sale, a restock that times out is NOT quietly accepted: there
      // is no offline queue behind it, so an unconfirmed transaction may or may
      // not have landed. The shop is told exactly that, rather than being shown
      // a success it cannot rely on when counting the shelf.
      const outcome = await awaitRestockTransaction(attempt);
      if (outcome === "unconfirmed") {
        showToast(t("toast.restockUnconfirmed"));
        return;
      }
    } catch (error) {
      console.warn(error);
      showToast(describeOperationError(error, "toast.restockFailed"));
      return;
    }
  } else {
    // Local-only mode: Firebase failed to load and the app is running against
    // memory. A quantity-only restock is still meaningful there, but a cost is
    // not -- there is nowhere to put the purchase, and silently dropping the
    // money the manager typed is worse than refusing it. saveExpense() refuses
    // in the same situation.
    if (totalPaid) {
      if (errorSlot) errorSlot.textContent = t("restock.costNeedsConnection");
      return;
    }
    product.quantity = newQuantityDisplay;
  }

  qs("#restockDialog").close();
  renderAll();
  showToast(t("toast.restocked", { qty, name: product.name, quantity: newQuantityDisplay }));

  } finally {
    // Every path, including the early return the transaction's catch takes, so
    // a failed delivery cannot leave the next one facing a dead button.
    confirmButton.disabled = false;
  }
  // A cost was just written, so the fetched map is out of date. Dropped
  // rather than refetched: nothing may be looking at a cost right now, and
  // the next surface that wants one will ask.
  invalidateProductCosts();
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
    // kind is written on every cart line, products included. The sale path
    // branches on it, and a line that simply omitted it would be read as a
    // product by the default -- correct here, but only by luck. Stating it on
    // both makes the discriminator real rather than an absence.
    state.cart.push({ ...product, kind: "product", qty: requestedQty, sellingPrice: unitPrice });
  }
  renderCart();
  return { success: true, product };
}

// The service half of addProductToCartById(). Deliberately a separate function
// rather than a branch inside it: almost everything that one does is about
// stock -- the out-of-stock refusal, the offline staleness warning, the
// available-quantity ceiling, dynamic pricing -- and none of it applies to a
// haircut. Threading a `kind` flag through all of that would leave the reader
// checking which half of the function they are in.
function addServiceToCartById(serviceId, options = {}) {
  const service = storeServices().find((item) => item.id === serviceId);
  if (!service) {
    showToast(t("toast.serviceUnavailable"));
    return { failed: true };
  }
  if (state.db && state.currentStoreId === "all") {
    showToast(t("toast.selectStoreToSell"));
    return { failed: true };
  }

  const requestedQty = Math.max(1, Math.floor(Number(options.qty || 1)));
  const existingCartItem = state.cart.find((item) => item.id === service.id);

  // The same 40-line cap the product path enforces, and for the same reason:
  // firestore.rules caps sale.items at 40, so a 41st line is a sale the server
  // will refuse after the cashier has already taken the money.
  if (!existingCartItem && state.cart.length >= 40) {
    showToast(t("toast.cartLimitReached"));
    return { failed: true };
  }

  pushCartHistory();
  if (existingCartItem) {
    existingCartItem.qty += requestedQty;
  } else {
    // sellingPrice, not price: the cart, the totals, the discount apportioning
    // and the tax computation all read sellingPrice, and renaming it here would
    // mean touching every one of them to gain nothing.
    state.cart.push({
      ...service,
      kind: "service",
      qty: requestedQty,
      sellingPrice: Number(service.price || 0)
    });
  }
  renderCart();
  return { success: true, service };
}

// One place that answers "is this a thing on a shelf". Works on a cart line and
// on a saved sale item alike, because both carry `kind`. Defaults to product
// when it is absent, which is what every sale recorded before this existed
// looks like -- so no migration, and no historical sale is reinterpreted.
function isServiceLine(item) {
  return item?.kind === "service";
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

async function shareReceiptWhatsApp() {
  const sale = state.lastReceiptSale;
  if (!sale) return;

  let rawPhone = sale.customerPhone;
  if (!rawPhone) {
    rawPhone = await askText(t("dialog.customerPhonePrompt"));
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
  if (!await askConfirm(t("dialog.deleteConfirm", { name: product.name }))) return;

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
  if (!await askConfirm(t("deleteAccount.restoreConfirm"))) return;
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
  if (!await askConfirm(t("dialog.undoSaleConfirm"))) return;

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

        // Stock lines only (DESIGN-services.md §3). A void still voids the
        // WHOLE sale, services included -- the sale document is marked voided
        // and drops out of every takings figure by its own flag, so a service
        // needs no undoing of its own. What it must not do is send
        // products/undefined to the server.
        //
        // This path tolerated a service by accident before: the exists() check
        // below skips a document that is not there. It was the right outcome
        // reached by luck, and the index arithmetic underneath it was already
        // wrong -- productSnaps is aligned with productRefs, so reading
        // sale.items[index] pairs a snapshot with the following line the moment
        // a service sits earlier in the basket, restoring the wrong quantity to
        // the wrong shelf without raising anything.
        const stockItems = (sale.items || []).filter((item) => !isServiceLine(item));
        const productRefs = stockItems.map((item) => doc(state.db, "users", state.businessOwnerUid, "products", item.productId));
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
          const item = stockItems[index];
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
  // The owner's own name first. displayName below it is the BUSINESS name on
  // every account created before that field existed, so an owner without one
  // still rings sales up under the shop name exactly as they did before --
  // this changes what new accounts record, not what old ones already recorded.
  return clean(state.cachedProfile?.ownerName)
    || clean(user.displayName)
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
    cash: 0, mobile: 0, card: 0, bank: 0, credit: 0,
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
  const { collection, query, where, orderBy, limit, getDocs } = state.firebaseApi.firestore;
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

// Debt repaid today, for the manager panel.
//
// A repayment used to leave no trace on this screen: it cleared the customer's
// balance and vanished. The money was real and it was in the drawer, but the
// only places that knew were Customer Accounts and -- for cash alone -- the
// shift reconciliation.
//
// This is deliberately NOT added to any revenue figure. A credit sale books its
// FULL total as revenue on the day it is made (saleNetTotal), and only the
// deposit counts toward a payment method; the balance becomes a receivable.
// The repayment is that receivable being collected, so adding it to takings
// would count one trade twice -- the exact class of disagreement QA-103 was
// fixed to end. Money received and revenue earned are different questions, and
// this answers the first one.
//
// Same source as shiftCashRepayments(): the audit log, one collection with an
// index that already exists, rather than a collection-group query across every
// customer's payments subcollection.
//
// Owner-only in practice. firestore.rules makes auditLogs owner-read, so a
// manager's query is denied and this fails quiet, exactly like the credit
// override tile beside it -- the panel must still show the cash.
let repaymentFetchKey = null;

function ensureRepaymentsLoaded() {
  if (!state.db || !state.businessOwnerUid) return;
  // Keyed by day as well as business: unlike the override count, this figure
  // is "today" and a till left open overnight must not keep yesterday's.
  const key = `${state.businessOwnerUid}:${new Date().toDateString()}`;
  if (repaymentFetchKey === key) return;
  repaymentFetchKey = key;
  loadRepaymentsToday().then(() => renderManagerControl());
}

// Called after a repayment is recorded. Without it the cashier takes the money,
// the balance clears, and the tile they are watching still says nothing --
// which is the complaint this whole thing exists to answer.
function invalidateRepaymentsToday() {
  repaymentFetchKey = null;
}

async function loadRepaymentsToday() {
  if (!state.db || !state.businessOwnerUid) return;
  const { collection, query, where, orderBy, limit, getDocs } = state.firebaseApi.firestore;
  try {
    const snapshot = await getDocs(query(
      collection(state.db, "users", state.businessOwnerUid, "auditLogs"),
      where("action", "==", "PAYMENT_RECORDED"),
      orderBy("createdAt", "desc"),
      limit(300)
    ));
    const now = new Date();
    state.repaymentsToday = snapshot.docs
      .map((entry) => entry.data())
      .filter((row) => {
        const at = row.createdAt?.toDate ? row.createdAt.toDate() : null;
        return at !== null && isSameDay(at, now);
      });
  } catch (error) {
    console.warn("Could not load debt repayments.", error);
    state.repaymentsToday = null;
  }
}

// null means "not known" -- denied, failed, or not yet loaded -- and every
// caller has to tell that apart from zero, because a tile that says 0 when it
// means "I could not look" is a lie about the drawer.
function repaymentTotalsToday(scopedToStore) {
  const rows = state.repaymentsToday;
  if (!Array.isArray(rows)) return null;
  const totals = { cash: 0, mobile: 0, card: 0, total: 0, count: 0 };
  for (const row of rows) {
    if (scopedToStore && row.storeId !== state.currentStoreId) continue;
    // Entries written before repayments recorded a method are treated as cash,
    // matching shiftCashRepayments() rather than inventing a second rule for
    // the same rows.
    const method = ["cash", "mobile", "card"].includes(row.method) ? row.method : "cash";
    const amount = safeNumber(row.amount);
    totals[method] += amount;
    totals.total += amount;
    totals.count += 1;
  }
  return totals;
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

// L-13. Expenses, purchases and cost history are FEEDS, not catalogues: they
// grow monotonically with trading volume and never plateau, which is the same
// curve as sales and the reason sales has a limit at all. Both screens already
// filter to one month, so nothing on screen needs the whole history.
//
// /productCosts is deliberately NOT bounded by this: it holds one document per
// product per store, so it is catalogue-shaped and plateaus with the range a
// shop stocks -- the L-8 argument for /products applies to it unchanged.
const ACCOUNTS_HISTORY_LIMIT = 1000;

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
  // Why the shelf was corrected, and any words the person added. Spec 4.4.
  // Both optional and both validated by the rules, so a typo here is refused
  // rather than stored as an uncountable category.
  if (fields.adjustmentReason) entry.adjustmentReason = String(fields.adjustmentReason);
  if (fields.note) entry.note = String(fields.note).slice(0, 200);
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
// "Offline" has to mean "the database is unreachable", because that is the
// condition the sale path branches on -- and navigator.onLine does not mean
// that. It reports whether the device has a network interface with a route, so
// it stays true on shop wifi whose uplink has died, behind a captive portal,
// and when DNS stops resolving.
//
// That last one is not hypothetical. It is what the UAT console log was full
// of: ERR_QUIC_PROTOCOL_ERROR, then run after run of ERR_NAME_NOT_RESOLVED
// against firestore.googleapis.com, while the browser went on reporting that
// it was online.
//
// That gap is what made "sales don't work offline" true. isOfflineNow() said
// online, so the sale skipped the queue and went to runTransaction(), which
// cannot complete without a server. The promise never settled, the Complete
// Sale button stayed disabled behind it, and the till stopped serving -- the
// exact outcome the whole offline feature exists to prevent, reached by the
// one route it was not watching.
//
// state.serverReachable is Firestore's own view, which is authoritative here
// because it is the same fact that decides whether a transaction can complete.
function isOfflineNow() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return state.serverReachable === false;
}

// Only cash sales are queued offline (L-9 phase C). A credit sale needs the
// customer's real balance and, past the limit, an override the proxy has to
// authorise -- offline it could silently blow a credit limit with no trail. It
// is refused with its own message rather than left to fail as a generic error.
function shouldQueueSaleOffline(paymentMethod) {
  return isOfflineNow() && paymentMethod === "cash";
}

// How long a sale transaction is given before the till stops waiting on it.
//
// Phase F closed the case where the outage was already known when the sale
// started. This closes the one where it begins mid-transaction: runTransaction()
// needs a server round trip, so if the connection dies after it starts, the
// promise does not settle and #completeSaleButton stays disabled behind it. The
// shop stops selling until somebody reloads the page.
//
// Ten seconds is chosen to be well clear of a slow-but-working sale -- a
// transaction on poor mobile data lands in one to three -- because the cost of
// giving up early is real: the fallback is a queued write, which has no
// server-side stock check, so a premature timeout trades the oversell guard for
// nothing. The cost of waiting slightly too long is only that the cashier looks
// at a dimmed button for a moment longer.
const SALE_TRANSACTION_TIMEOUT_MS = 10000;

// Resolves to "committed" or "unconfirmed"; a rejection still rejects, so the
// existing catch keeps reporting real failures exactly as it did.
//
// "unconfirmed" is deliberately not an error. The transaction may still be in
// flight and may still land, so the only true statement is that we stopped
// waiting -- and the caller has to treat that differently from "no".
async function awaitSaleTransaction(attempt) {
  let timeoutId = null;
  try {
    return await Promise.race([
      attempt.then(() => "committed"),
      new Promise((resolve) => {
        timeoutId = window.setTimeout(() => resolve("unconfirmed"), SALE_TRANSACTION_TIMEOUT_MS);
      })
    ]);
  } finally {
    // A till runs for a whole shift; a timer left per sale is a leak.
    window.clearTimeout(timeoutId);
  }
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
  // The caller mints the id, because completeSale() has to decide it before the
  // offline and online paths diverge -- the timeout fallback records a sale the
  // transaction may also still be trying to record, and they are only safe
  // sharing one id. The local computation stays as a fallback so a future caller
  // that forgets still gets a deterministic id rather than a random one.
  const dedupeSaleId = `ord_${args.staffId}_${args.orderNumber}`;
  const saleId = args.saleId || (args.duplicate ? `${dedupeSaleId}_dup${Date.now()}` : dedupeSaleId);

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

  // Stock lines only (DESIGN-services.md §3, Phase D). This is the quietest of
  // the four call sites and the reason the design named it the riskiest to
  // skip: update() on a document that does not exist fails the write, the
  // whole batch is atomic, and nothing here is awaited -- so a queued sale with
  // one service line in it would take the sale, every stock decrement and every
  // ledger entry down with it, hours later, with no toast and no cashier
  // watching. The only trace would be the fault log, if it caught it.
  //
  // The sale document above deliberately still carries ALL the lines, services
  // included: what was sold is what was sold, and the takings must not change
  // because of how the stock is accounted.
  for (const item of args.items) {
    if (isServiceLine(item)) continue;
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
    // The variance is a cash discrepancy, and until 2026-08-23 it existed only
    // on the shift document. Written after the transaction commits, and in its
    // own try: a failed audit write must not undo a close that already
    // succeeded, which is the same shape every other audit site here uses.
    try {
      const { collection, doc: auditDoc, setDoc, serverTimestamp: stamp } = state.firebaseApi.firestore;
      const entry = {
        action: "SHIFT_CLOSED",
        shiftId: shift.id,
        storeId: shift.storeId,
        expectedCash: totals.expected,
        countedCash: counted,
        variance,
        createdAt: stamp()
      };
      if (state.user?.uid) entry.uid = state.user.uid;
      await setDoc(auditDoc(collection(state.db, "users", state.businessOwnerUid, "auditLogs")), entry);
    } catch (auditError) {
      console.warn(auditError);
    }

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
  ensureRepaymentsLoaded();
  ensureShiftsLoaded();
  renderShiftPanel();
  const scopedOverrides = (state.creditOverrides || []).filter((row) =>
    !scopedToStore || row.storeId === state.currentStoreId);

  // Cash repaid against old debt is in the drawer just as surely as a cash
  // sale, and computeShiftExpectedCash() has always counted it -- so this tile
  // and the shift panel below it were showing two different expected-cash
  // figures on the same screen, differing by exactly the day's repayments.
  // When the figure is unknown (a manager, whom the rules refuse) the note
  // stops claiming repayments are in it rather than quietly overstating.
  const repayments = repaymentTotalsToday(scopedToStore);
  const drawerCash = s.drawerCash + (repayments?.cash || 0);

  qs("#managerControlGrid").innerHTML = [
    controlTile(t("control.expectedCash"), money(drawerCash), "accent",
      repayments ? t("control.expectedCashNoteWithRepayments") : t("control.expectedCashNote")),
    controlTile(t("control.netTakings"), money(s.net), "", t("control.netTakingsNote")),
    // Beside the takings, never inside them: this money was already counted as
    // revenue on the day the credit sale was made.
    controlTile(t("control.collectedOnAccount"),
      repayments === null ? "—" : money(repayments.total),
      repayments && repayments.total > 0 ? "accent" : "",
      repayments === null
        ? t("control.collectedOnAccountUnavailable")
        : (repayments.total > 0
          // Named, not three bare figures: every neighbouring tile says which
          // method it means, and a split the reader has to guess at is not a
          // figure they can act on. Measured at the panel's 216px column --
          // it wraps to two lines and lands at the same tile height as the
          // drawer note beside it.
          ? `${t("pos.cash")} ${money(repayments.cash)} · ${t("pos.mobile")} ${money(repayments.mobile)} · ${t("pos.card")} ${money(repayments.card)}`
          : t("control.collectedOnAccountNote"))),
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

// Cost of goods for a set of sales, given the cost the catalogue currently
// carries for each product. Extracted from renderAdminControl() so the
// arithmetic can be tested without a DOM -- tests/control-panel-math.test.mjs
// evaluates this function itself rather than a copy of it.
//
// It reports coverage as well as a total, because the caller cannot tell a
// genuine zero from an unknown otherwise, and that distinction is the whole
// point of the guard: DESIGN-purchases.md 4.3.
function summariseCostOfGoods(sales, costIndex) {
  let cogs = 0;
  let costedLines = 0;
  let uncostedLines = 0;
  for (const sale of sales) {
    if (sale.voided) continue;
    // The sale's own date decides which cost applied. This is the whole point of
    // the history: a delivery next week appends a record and leaves this one
    // alone, so this month's margin still reads the same next month.
    const soldAt = saleTimestamp(sale);
    // RETURNS COME OFF THE COST, not only off the revenue.
    //
    // Revenue has always been netted -- summariseSales() does `total - refunded`
    // -- and until 2026-09-08 the cost side had no equivalent, so a return
    // reduced revenue and left cost untouched. Gross profit read LOW by the cost
    // of the returned goods, and because those goods go back on the shelf they
    // were counted in stock valuation AND in cost of sales at the same time.
    // Measured on a live walkthrough: returning 20 units at 11,800 understated
    // gross profit by 236,000 and overstated inventory by the same 236,000.
    //
    // A void was always handled correctly -- the whole sale is skipped above --
    // which is why this only ever showed up on a partial return.
    //
    // The map is consumed rather than read, because it totals per PRODUCT across
    // the sale. A product on two lines of one sale would otherwise have the full
    // returned quantity subtracted from each of them.
    const returnedRemaining = saleReturnedQtyMap(sale);
    for (const item of sale.items || []) {
      // A haircut has no cost of goods, so it is not a gap in the data.
      // Counting it as one would report every bar and salon month incomplete.
      if (isServiceLine(item)) continue;
      const soldQty = safeNumber(item.qty);
      const outstanding = safeNumber(returnedRemaining.get(item.productId));
      const returnedHere = Math.min(soldQty, outstanding);
      if (returnedHere > 0) returnedRemaining.set(item.productId, outstanding - returnedHere);
      const netQty = soldQty - returnedHere;
      // Wholly returned: it cost the shop nothing this period and its
      // costedness says nothing about the month, so it is not counted as either
      // a costed or an uncosted line.
      if (netQty <= 0) continue;
      const unitCost = costInForceAt(costIndex, item.productId, soldAt);
      if (unitCost !== null && unitCost > 0) {
        cogs += unitCost * netQty;
        costedLines += 1;
      } else {
        uncostedLines += 1;
      }
    }
  }
  return {
    cogs,
    costedLines,
    uncostedLines,
    anyCostKnown: costedLines > 0,
    allCostKnown: costedLines > 0 && uncostedLines === 0
  };
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
  // accounts, which is why the tile says estimated. DESIGN-purchases.md phase D
  // puts the cost on the sale line and closes that.
  //
  // The coverage guard asks whether a cost is KNOWN, not whether the product is
  // still in the catalogue. It used to ask costById.has(productId), which is
  // presence -- and at the time costPrice had no input anywhere in the app, so
  // every product carried an absent cost that safeNumber() reads as 0, every
  // lookup passed, and this panel reported cost of goods as zero, gross margin
  // as 100% of revenue, and captioned it "Revenue less cost of goods sold"
  // rather than incomplete. An absent cost means unknown, never free.
  //
  // The map now comes from /productCosts rather than from the product, because
  // a cashier can read every product document and Firestore cannot withhold a
  // single field. A product with no cost document is simply absent from it,
  // which is the same 'unknown' this guard already handles.
  const costById = productCostMap();
  // Stock value uses the CURRENT average, because that is what the shelf is
  // worth now. Cost of goods uses the history, because that is what the
  // things already sold actually cost.
  const goods = summariseCostOfGoods(monthSales, buildCostIndex(state.productCostHistory));
  const cogs = goods.cogs;
  const margin = month.net - cogs;
  const marginPct = month.net > 0 ? Math.round((margin / month.net) * 100) : 0;

  // The same rule for the stock tiles. With no cost prices recorded anywhere,
  // "TZS 0" is a claim that the shelves are worthless, not an absence of data.
  // Only meaningful once the costs have actually been fetched. An unloaded map
  // makes every product look uncosted, which is indistinguishable from a shop
  // that has never recorded a buying price.
  const anyProductCosted = state.productCostsLoaded
    && state.products.some((p) => safeNumber(costById.get(p.id)) > 0);
  const stockAtCost = state.products.reduce(
    (sum, p) => sum + safeNumber(p.quantity) * safeNumber(costById.get(p.id)), 0);
  const stockAtRetail = state.products.reduce((sum, p) => sum + safeNumber(p.quantity) * safeNumber(p.sellingPrice), 0);
  const creditOwed = state.customers.reduce((sum, c) => sum + safeNumber(c.balanceOwed), 0);

  ensureFaultsLoaded();
  const totalMismatches = saleTotalMismatches(state.sales);

  qs("#adminControlGrid").innerHTML = [
    controlTile(t("control.revenueToday"), money(today.net)),
    controlTile(t("control.revenueMonth"), money(month.net), "accent",
      t(month.count === 1 ? "control.salesCountNoteOne" : "control.salesCountNote",
        { count: String(month.count) })),
    // No known cost at all means there is no margin to show -- not a margin of
    // 100%. The dash is the honest value; the note says why it is a dash.
    controlTile(t("control.grossMargin"),
      goods.anyCostKnown ? `${money(margin)} · ${marginPct}%` : "—",
      goods.anyCostKnown && margin <= 0 && month.net > 0 ? "danger" : "",
      !goods.anyCostKnown
        ? t("control.marginNoCost")
        : goods.allCostKnown
          ? t("control.marginNote")
          : t("control.marginIncomplete", {
              missing: String(goods.uncostedLines),
              total: String(goods.costedLines + goods.uncostedLines)
            })),
    // Retail value is known either way and stays in the note, so the tile is
    // still worth reading when cost is not.
    // Costs are no longer held live -- one document per product, loaded by
    // every owner on every session to render this one tile. Until they are
    // asked for, the tile offers to fetch them and says nothing about cost.
    // The distinction matters: "no cost prices recorded" is a claim about the
    // business, and saying it while the figures are merely unfetched would be
    // the app reporting its own laziness as the shop's bookkeeping.
    (state.productCostsLoaded
      ? controlTile(t("control.stockAtCost"),
          anyProductCosted ? money(stockAtCost) : "—", "",
          anyProductCosted
            ? t("control.stockAtRetail", { value: money(stockAtRetail) })
            : t("control.stockAtCostUnknown", { value: money(stockAtRetail) }))
      : `<div class="control-tile">
          <span class="control-tile-label">${esc(t("control.stockAtCost"))}</span>
          <strong class="control-tile-value">${esc(state.productCostsLoading ? t("control.stockValueLoading") : "—")}</strong>
          <span class="control-tile-note">${esc(t("control.stockAtRetail", { value: money(stockAtRetail) }))}</span>
          <button class="ghost-button compact" type="button" id="showStockValueButton"${state.productCostsLoading ? " disabled" : ""}>${esc(t("control.showStockValue"))}</button>
        </div>`),
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
        const cost = storeProducts.reduce(
          (sum, p) => sum + safeNumber(p.quantity) * safeNumber(costById.get(p.id)), 0);
        const storeCosted = storeProducts.some((p) => safeNumber(costById.get(p.id)) > 0);
        return `<tr>
          <td>${esc(store.name || t("storeSwitcher.fallbackName"))}</td>
          <td>${money(storeToday.net)}</td>
          <td><strong>${money(storeMonth.net)}</strong></td>
          <td class="${out > 0 ? "cell-danger" : (low > 0 ? "cell-warn" : "")}">${low} / ${out}</td>
          <td>${storeCosted ? money(cost) : "—"}</td>
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

// Expenses, purchases and product costs are subscribed only for a manager or
// owner -- a cashier is refused them by firestore.rules, so subscribing would
// put a permission-denied in every cashier console on every sign-in. The catch
// is that the role arrives AFTER sign-in and can change mid-session:
//
//   promoted   the early return already ran, no listener was ever created, and
//              nothing re-runs it. The nav reveals the screens and they render
//              empty forever. Recording an expense succeeds server-side and the
//              row never appears. Only a reload fixes it.
//   demoted    the listener keeps running and the arrays keep every wages
//              figure, in a section hidden by CSS rather than emptied.
//
// So the membership watcher calls this on every role change, in both
// directions. Money must not outlive the role that was allowed to see it.
function resubscribeRoleGatedCollections() {
  for (const key of ["unsubscribeExpenses", "unsubscribePurchases", "unsubscribeDeliveries",
                     "unsubscribeProductCostHistory"]) {
    if (state[key]) state[key]();
    state[key] = null;
  }
  state.expenses = [];
  state.purchases = [];
  // Deliveries too. subscribeToDeliveries() empties it for a cashier anyway, so
  // this is belt and braces -- but the belt is what this block is: a demoted
  // manager must not keep a screenful of buying prices in memory because a
  // subscribe call happened to take an early return.
  state.deliveries = [];
  state.productCosts = [];
  state.productCostHistory = [];
  // Cleared before the re-subscribe so a demotion empties the screens even
  // though the calls below will return early for a cashier.
  subscribeToExpenses();
  subscribeToPurchases();
  subscribeToDeliveries();
  invalidateProductCosts();
  subscribeToProductCostHistory();
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
          resubscribeRoleGatedCollections();
          renderAll();
        }
      },
      (error) => {
        // Fails closed. A dead listener cannot be told apart from a demotion,
        // so drop to the most restrictive role rather than trusting a cached
        // one -- the same reasoning as resolveCurrentUserRole()'s default.
        console.warn("Could not watch membership; assuming least privilege.", error);
        state.currentUserRole = "cashier";
        resubscribeRoleGatedCollections();
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
      // App Check debug token, and ONLY on a machine serving this locally.
      //
      // The reCAPTCHA site key is registered for the deployed domain, so on
      // localhost the token exchange fails with appCheck/recaptcha-error, and
      // because App Check is ENFORCED on Firebase Auth every sign-in then comes
      // back 401 auth/firebase-app-check-token-is-invalid. That makes the app
      // impossible to exercise locally before a release -- which is exactly
      // when it most needs exercising.
      //
      // This is Firebase's documented mechanism for that, not a bypass: the
      // flag makes the SDK mint a debug token and print it to the console, and
      // the token does nothing at all until the project owner registers it in
      // Firebase Console -> App Check -> Apps -> Manage debug tokens.
      //
      // The hostname guard is what makes it safe to ship. On the deployed
      // domain the condition is false, so the flag is never set and production
      // verifies through reCAPTCHA exactly as before. Someone serving a copy of
      // this file from their own localhost would get a debug token that no
      // project has registered, which authorises nothing.
      const servedLocally = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
      if (servedLocally) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;

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
    setDynamicText("#connectionHint", t("connection.createAccountToBegin"), "connection.createAccountToBegin");

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
        // ensureUserProfile() is what learns the owner's name -- from the
        // sign-up form, or read back off the stored profile on a later
        // sign-in. It runs AFTER the first resolve above, so re-resolve here
        // rather than moving that call: the first one is what lets the app
        // paint at all, and the two surfaces that show a name are cheap to
        // redraw on their own.
        state.currentUserName = await resolveCurrentUserName(user, state.businessOwnerUid);
        renderStaffSelect();
        updateAuthUi();
        state.pendingBusinessName = "";
        state.pendingOwnerName = "";
        subscribeToProducts();
        subscribeToSales();
        subscribeToStores();
        subscribeToStaff();
        subscribeToMembers();
        subscribeToOwnMembership();
        subscribeToStockLedger();
        subscribeToMonthlyReports();
        subscribeToCustomers();
        subscribeToSuppliers();
        subscribeToPurchaseReturns();
        subscribeToTransfers();
        subscribeToServices();
        subscribeToExpenses();
        subscribeToPurchases();
        subscribeToDeliveries();
        invalidateProductCosts();
        subscribeToProductCostHistory();
        watchServerConnection();
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
        if (state.unsubscribeSuppliers) state.unsubscribeSuppliers();
        state.unsubscribeSuppliers = null;
        if (state.unsubscribePurchaseReturns) state.unsubscribePurchaseReturns();
        state.unsubscribePurchaseReturns = null;
        if (state.unsubscribeTransfers) state.unsubscribeTransfers();
        state.unsubscribeTransfers = null;
        if (state.unsubscribeServices) state.unsubscribeServices();
        state.unsubscribeServices = null;
        state.services = [];
        if (state.unsubscribeExpenses) state.unsubscribeExpenses();
        state.unsubscribeExpenses = null;
        state.expenses = [];
        if (state.unsubscribePurchases) state.unsubscribePurchases();
        state.unsubscribePurchases = null;
        state.purchases = [];
        if (state.unsubscribeDeliveries) state.unsubscribeDeliveries();
        state.unsubscribeDeliveries = null;
        state.deliveries = [];
        // No listener to detach any more -- costs are fetched on demand. The
        // figures still go, and so does the loaded flag: an empty map that
        // still says "loaded" reads as a business with no cost prices
        // recorded, which is a claim rather than an absence.
        invalidateProductCosts();
        if (state.unsubscribeProductCostHistory) state.unsubscribeProductCostHistory();
        state.unsubscribeProductCostHistory = null;
        state.productCostHistory = [];
        if (state.unsubscribeConnection) state.unsubscribeConnection();
        state.unsubscribeConnection = null;
        // Money figures must not outlive the session that fetched them: the
        // next sign-in may be a different business on the same device.
        state.repaymentsToday = null;
        invalidateRepaymentsToday();
        // Back to unknown, not offline: the next sign-in must not inherit a
        // verdict about a connection this session had.
        state.serverReachable = null;
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

// Which stores the CATALOGUE subscription should cover.
//
// resolveQueryStoreIds() answers "what is this person allowed to read", which
// for an owner or a roaming manager is everything. That is the right answer for
// permission and the wrong one for the catalogue: `products` and `productCosts`
// are the only two live subscriptions that grow with the size of the business,
// and an owner was loading every branch on every cold start even while looking
// at one branch. Measured at 2,000 SKUs across 3 branches that is 12,000
// documents -- 24% of a day's Spark read quota spent by one person opening the
// app once, and the same 12,000 objects parsed and held in a browser on a cheap
// Android. At the 10,000-SKU catalogue this is being sold into, one cold start
// exceeds the whole daily quota.
//
// So the catalogue follows the BRANCH SWITCHER. Nothing on screen changes:
// storeProducts() already shows only the selected branch, so a scoped
// subscription holds exactly what was already being displayed. "All branches"
// still loads everything, because that is the reporting view and is where an
// owner goes when they need to see across branches.
//
// Permission is untouched. This only ever NARROWS what resolveQueryStoreIds()
// already permitted, and firestore.rules is unchanged.
async function catalogueStoreIds() {
  const allowed = await resolveQueryStoreIds();
  const selected = state.currentStoreId;
  // Not scoped yet, or deliberately looking across branches.
  if (!selected || selected === "all") return allowed;
  // A single-branch business is never scoped, for two reasons that point the
  // same way. There is nothing to save -- one branch's catalogue IS the
  // catalogue -- and it is exactly where the risk lives: productStoreId()
  // falls back to the first store when a product carries no storeId at all,
  // which says plainly that such products exist, and a where("storeId","==")
  // can never match a document that has no storeId field. Scoping one of those
  // shops would not shrink its till, it would EMPTY it.
  //
  // A business with several branches created them deliberately, and its
  // products were written with a branch. The saving lands where it matters and
  // the hazard is left alone.
  if ((state.stores || []).length <= 1) return allowed;
  // Staff already carry a narrow scope. Narrowing it to a branch they cannot
  // read would hand back an empty catalogue rather than a smaller one.
  if (allowed !== null && !allowed.includes(selected)) return allowed;
  return [selected];
}

async function subscribeToProducts() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  if (state.unsubscribeProducts) state.unsubscribeProducts();
  state.productsInitialized = false;
  state.productsLoadFailed = false;
  try {
    const { collection, onSnapshot, query, where } = state.firebaseApi.firestore;
    const productsRef = collection(state.db, "users", state.businessOwnerUid, "products");
    const queryStoreIds = await catalogueStoreIds();
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
  const previousStoreId = state.currentStoreId;
  if (!state.currentStoreId || (state.currentStoreId !== "all" && !state.stores.some((store) => store.id === state.currentStoreId))) {
    state.currentStoreId = activeStores()[0]?.id || state.stores[0]?.id || "";
  }
  // The branch is settled HERE on a cold start, not by the switcher: products
  // subscribe before the stores snapshot arrives, so at that moment there is no
  // selected branch and catalogueStoreIds() can only fall back to everything.
  // Without this the scoping would work when someone changed branch and never
  // on the load that actually costs the reads.
  if (state.currentStoreId && state.currentStoreId !== previousStoreId) resubscribeCatalogue();
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

 async function promptBusinessTypeSelection(currentKey) {
  const list = BUSINESS_TYPE_OPTIONS
    .map((option, index) => `${index + 1}. ${state.language === "sw" ? option.sw : option.en}`)
    .join("\n");
  const promptText = t("dialog.businessTypePrompt", { list });
  const defaultValue = currentKey ? String(BUSINESS_TYPE_OPTIONS.findIndex((o) => o.key === currentKey) + 1) : "";
  const raw = await askText(promptText, { defaultValue });
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
  const raw = await askText(t("dialog.currencyCodePrompt"), { defaultValue: store.currencyCode || "TZS" });
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
  const nextType = await promptBusinessTypeSelection(store.businessType);
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
  const name = await askText(t("dialog.newStoreNamePrompt"));
  if (!name || !name.trim()) return;
  if (!state.db || !state.user) return showToast(t("toast.signInToAddStore"));
  const businessType = (await promptBusinessTypeSelection()) || "general";
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
  const name = await askText(t("dialog.renameStorePrompt"), { defaultValue: store.name || "" });
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

// Without this the name is reachable only by signing up again: every account
// that already exists predates the sign-up field. Owner only -- a staff name is
// the owner's record, set from the invitation.
async function changeOwnerName() {
  if (!state.db || !state.user) return showToast(t("toast.firebaseNotConnected"));
  const current = state.cachedProfile?.ownerName || "";
  const entered = await askText(t("dialog.ownerNamePrompt"), { defaultValue: current });
  if (entered === null) return;
  const name = entered.trim().slice(0, 80);
  if (!name) return;
  try {
    const { doc, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", state.user.uid), { ownerName: name }, { merge: true });
    // The cache is what every reader consults; the write above only makes it
    // survive a reload.
    state.cachedProfile = { ...(state.cachedProfile || {}), ownerName: name };
    state.currentUserName = name;
    renderStaffSelect();
    updateAuthUi();
    showToast(t("toast.ownerNameSaved"));
  } catch (error) {
    console.warn(error);
    showToast(t("toast.couldNotSaveOwnerName"));
  }
}

async function archiveStore() {
  if (!state.currentStoreId || state.currentStoreId === "all") return showToast(t("toast.selectSpecificStore"));
  const store = state.stores.find((item) => item.id === state.currentStoreId);
  if (!store) return;
  if (activeStores().length <= 1) return showToast(t("toast.cannotArchiveLastStore"));
  if (!await askConfirm(t("dialog.archiveStoreConfirm", { name: store.name || "" }))) return;
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
  // The catalogue is scoped to the selected branch, so changing branch changes
  // what has to be loaded. Re-subscribed rather than re-filtered: the products
  // for the branch just chosen may never have been fetched at all.
  resubscribeCatalogue();
}

// Products and their costs, re-fetched for the branch now selected. Deliberately
// separate from resubscribeRoleGatedCollections(), which exists for a different
// event -- a role changing underneath someone -- and clears collections this
// must not touch.
function resubscribeCatalogue() {
  if (!state.db || !state.user || !state.businessOwnerUid) return;
  subscribeToProducts();
  invalidateProductCosts();
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
  if (!await askConfirm(t("staff.revokeConfirm", { email: member.email || "" }))) return;
  try {
    const { doc, deleteDoc } = state.firebaseApi.firestore;
    await deleteDoc(doc(state.db, "users", state.user.uid, "members", memberId));
    showToast(t("staff.revokeSuccess", { email: member.email || "" }));
  } catch (error) {
    console.warn(error);
    showToast(t("staff.revokeFailed"));
  }
}

// The app's own confirmation, replacing window.confirm().
//
// A browser may decline to show a native dialog and return false without
// asking anybody. Chrome offers "Prevent this page from creating additional
// dialogs" after a few in quick succession, and a shopkeeper on a busy till
// who ticks it turns every Delete, Revoke, Undo and Archive in this app into a
// button that does nothing at all -- silently, until they restart the browser.
// Failing safe is right; failing silently is not, and this app has treated
// that shape as a defect everywhere else it appeared.
//
// Resolves true only if the person pressed the confirm button. Cancel, the
// close cross, Escape, and the dialog being closed by anything else all
// resolve false, so the caller's `if (!ok) return;` keeps reading the same way
// it did with confirm().
// The app's own text prompt, replacing window.prompt().
//
// Same reason as askConfirm beside it: a browser may decline to show a native
// dialog and hand back null, and every caller here reads null as "cancelled".
// Ten buttons therefore did nothing at all, silently -- among them the till's
// price override and the override PASSWORD, which is the control standing
// between a cashier and discounting stock to nothing.
//
// It also fixes something window.prompt cannot do: a password typed into a
// native prompt is displayed in clear text on the screen, in a shop, at a
// counter. options.type === "password" masks it here.
//
// Resolves the entered string, or null for cancel, the close cross, Escape,
// and a dialog closed by anything else -- so `if (raw === null) return;` keeps
// reading exactly as it did.
function askText(message, options = {}) {
  const dialog = qs("#promptDialog");
  // No dialog means no way to ask. Null is "cancelled", which is the safe
  // reading -- the alternative is proceeding with a value nobody typed.
  if (!dialog) return Promise.resolve(null);

  const form = qs("#promptDialogForm");
  const input = qs("#promptDialogInput");
  const messageEl = qs("#promptDialogMessage");
  const titleEl = qs("#promptDialogTitle");
  if (messageEl) messageEl.textContent = message;
  if (titleEl) titleEl.textContent = options.title || t("prompt.title");
  if (input) {
    input.type = options.type === "password" ? "password" : "text";
    input.value = options.defaultValue === undefined || options.defaultValue === null
      ? ""
      : String(options.defaultValue);
    input.inputMode = options.numeric ? "decimal" : "text";
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      form?.removeEventListener("submit", onSubmit);
      qs("#promptDialogCancel")?.removeEventListener("click", onCancel);
      qs("#promptDialogClose")?.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      // Never leave a typed password sitting in the DOM for the next caller.
      if (input) input.value = "";
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onSubmit = (event) => { event.preventDefault(); finish(input ? input.value : ""); };
    const onCancel = () => finish(null);
    // Escape closes a <dialog> without firing any control, and only the
    // browser's own close event reports it. Without this the caller would await
    // a submit that can no longer happen -- the dead button again, by another
    // route.
    const onClose = () => finish(null);

    form?.addEventListener("submit", onSubmit);
    qs("#promptDialogCancel")?.addEventListener("click", onCancel);
    qs("#promptDialogClose")?.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    input?.focus();
    input?.select?.();
  });
}

function askConfirm(message, options = {}) {
  const dialog = qs("#confirmDialog");
  // If the markup is somehow missing, refuse rather than silently proceeding
  // with a destructive action nobody agreed to.
  if (!dialog) return Promise.resolve(false);

  const messageEl = qs("#confirmDialogMessage");
  const acceptButton = qs("#confirmDialogAccept");
  const titleEl = qs("#confirmDialogTitle");
  if (messageEl) messageEl.textContent = message;
  if (titleEl) titleEl.textContent = options.title || t("confirm.title");
  if (acceptButton) {
    acceptButton.textContent = options.confirmLabel || t("confirm.accept");
    // Destructive by default: everything routed here today removes something.
    acceptButton.classList.toggle("danger", options.danger !== false);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      // Listeners are removed before resolving, so a dialog reused a moment
      // later cannot resolve the promise of the question before it.
      acceptButton?.removeEventListener("click", onAccept);
      qs("#confirmDialogCancel")?.removeEventListener("click", onCancel);
      qs("#confirmDialogClose")?.removeEventListener("click", onCancel);
      dialog.removeEventListener("close", onClose);
      if (dialog.open) dialog.close();
      resolve(value);
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    // Escape closes a <dialog> without firing any button, and the browser's
    // own close event is the only thing that reports it.
    const onClose = () => finish(false);

    acceptButton?.addEventListener("click", onAccept);
    qs("#confirmDialogCancel")?.addEventListener("click", onCancel);
    qs("#confirmDialogClose")?.addEventListener("click", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    // Focus the safe choice, not the destructive one: a stray Enter should not
    // delete a product.
    qs("#confirmDialogCancel")?.focus();
  });
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
    // Shown, not only copyable: the clipboard can refuse and WhatsApp may not
    // be installed, and without this the owner would have no route to a link
    // the server has already issued.
    const linkField = qs("#inviteLinkText");
    if (linkField) linkField.value = buildStaffInviteAcceptUrl(payload.linkToken);
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
  // A rejected clipboard write is common and not the owner's fault -- it needs
  // a focused document, and fails with NotAllowedError otherwise. Saying only
  // "could not copy" left them stuck; the link is on screen, so say so and put
  // the cursor in it ready to be copied by hand.
  navigator.clipboard?.writeText(acceptUrl)
    .then(() => showToast(t("staff.linkCopied")))
    .catch(() => {
      showToast(t("staff.copyFailedUseLink"));
      const field = qs("#inviteLinkText");
      if (field) { field.focus(); field.select?.(); }
    });
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
  const cached = state.user?.uid === user.uid ? state.cachedProfile : null;

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
    const stored = existing?.exists() ? existing.data() : null;

    // The owner's OWN name, captured on the sign-up form. It is deliberately
    // not displayName: three call sites read displayName as the business-name
    // fallback for accounts created before this field existed, so pointing it
    // at the person would silently rename those businesses.
    //
    // Read back off the stored profile whenever the form did not supply one,
    // which is every sign-in after the first and every other device. Without
    // that this field would exist only in the tab that created it.
    const ownerName = String(state.pendingOwnerName || stored?.ownerName || "").trim().slice(0, 80);

    // Same read-back for the business name, for a narrower reason: it is
    // derived from displayName, and a merge write of "" would erase a name
    // already on the record. The fallback only fires where the value would
    // otherwise be blanked.
    const businessName = String(
      state.pendingBusinessName || user.displayName || stored?.businessName || ""
    );

    // Read back rather than recomputed: nothing in this function sets it, so
    // without this a sign-in would drop the stamp and Settings would report a
    // backed-up business as never backed up.
    const lastBackupAt = stored?.lastBackupAt?.toDate?.() || stored?.lastBackupAt || null;

    const unchanged = cached
      && cached.email === (user.email || "")
      && cached.businessName === businessName
      && cached.ownerName === ownerName;
    if (unchanged) return;

    const isBusinessOwner = !state.businessOwnerUid || user.uid === state.businessOwnerUid;
    const rolePayload = existing?.exists() ? {} : { role: isBusinessOwner ? "Owner" : "Staff" };

    await setDoc(profileRef, {
      uid: user.uid,
      email: user.email || "",
      businessName,
      // Absent rather than empty: a merge write of "" is a write, and would
      // clear a name the owner had set from another device.
      ...(ownerName ? { ownerName } : {}),
      ...rolePayload,
      authProvider: "password",
      updatedAt: serverTimestamp(),
      ...consentPayload
    }, { merge: true });
    state.cachedProfile = { email: user.email || "", businessName, ownerName, lastBackupAt };
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
  // Key-based, so the translator re-applies the RIGHT one instead of the one
  // baked into the markup. This is the line that told a signed-in owner to
  // sign in.
  const hintKey = signedIn ? "connection.inventorySyncing" : "sidebar.connectionHintSignedOut";
  setDynamicText("#connectionHint", t(hintKey), hintKey);
  qs("#verifyBanner").hidden = !signedIn || Boolean(state.user?.emailVerified);
  // Staff invites/roster are owner-only actions -- the members collection
  // read is owner-only in firestore.rules (a collection-level query can't
  // be scoped to "just my own doc" the way a single get() can), so showing
  // this button to staff would both mislead them and hit a denied query.
  const isOwner = signedIn && state.user.uid === state.businessOwnerUid;
  // Settings shows the same identity the topbar chip does, and hides the staff
  // panel for the same reason the till's roster button is hidden: the members
  // collection is owner-only in firestore.rules, so showing it to staff both
  // misleads them and hits a denied query.
  const settingsName = qs("#settingsUserName");
  if (settingsName) {
    // The name, not the email. The email stays on its own line below: it is
    // which account you are in, which still matters when someone has two.
    settingsName.textContent = state.currentUserName
      || state.cachedProfile?.ownerName
      || t("connection.signedInFallback");
  }
  const settingsEmail = qs("#settingsUserEmail");
  if (settingsEmail) settingsEmail.textContent = state.user?.email || "";
  // Staff names come from the invitation they accepted and are the owner's
  // record, not theirs to edit here.
  const changeNameButton = qs("#changeOwnerNameButton");
  if (changeNameButton) changeNameButton.hidden = !isOwner;
  renderLastBackup();
  const settingsStaffPanel = qs("#settingsStaffPanel");
  if (settingsStaffPanel) settingsStaffPanel.hidden = !isOwner;
  const rosterButton = qs("#staffRosterButton");
  if (rosterButton) rosterButton.hidden = !isOwner;
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";
  qs("#authSubmitButton").textContent = isSignup ? t("auth.createAccount") : t("auth.signIn");
  qs("#authModeButton").textContent = isSignup ? t("auth.haveAccount") : t("auth.newAccount");
  qs("#businessName").closest("label").hidden = !isSignup;
  const ownerNameRow = qs("#authOwnerNameRow");
  if (ownerNameRow) ownerNameRow.hidden = !isSignup;
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

// Errors that must NOT be distinguished from success, because telling them
// apart is exactly what lets someone test whether an address has an account
// here. Everything else is a genuine failure the person needs to know about.
const PASSWORD_RESET_SILENT_CODES = new Set([
  "auth/user-not-found",
  "auth/invalid-recipient-email",
  "auth/email-not-found"
]);

async function handleForgotPassword() {
  if (!state.auth) return showToast(t("toast.firebaseNotConnected"));
  // A field error ALONE is not enough here. It lands under the email box --
  // a different element from the link that was pressed, and often off-screen
  // on a phone -- so pressing "Forgot password?" with the box empty looked
  // exactly like a dead button. Reported as precisely that.
  //
  // The field error still marks the box; this says the same thing where the
  // eye already is, and puts the cursor in the field so the next tap types.
  if (!validateAuthEmail()) {
    const emailInput = qs("#authEmail");
    emailInput?.focus();
    emailInput?.scrollIntoView({ block: "center", behavior: "smooth" });
    return showToast(t("toast.passwordResetNeedsEmail"));
  }
  const email = qs("#authEmail").value.trim();
  const button = qs("#authForgotPasswordButton");

  // Said before firing rather than after failing. Offline this request cannot
  // possibly succeed, and the old code answered "a link has been sent" -- so
  // the shop waited on an email that was never sent, on the one screen where
  // they are already locked out and have no other way in.
  if (isOfflineNow()) return showToast(t("toast.passwordResetOffline"));

  button.disabled = true;
  try {
    // Where the link lands after the password is changed. Without this the
    // reset finishes on Firebase's own page -- English only, no branding, and
    // no way back -- which for a shopkeeper on a phone is a dead end at the
    // exact moment they are trying to get back in.
    //
    // The continue URL must be an AUTHORISED DOMAIN on the Firebase project. If
    // it is not, sendPasswordResetEmail rejects the whole request, so a domain
    // nobody remembered to authorise would break password reset outright. Hence
    // the retry below: the link is a courtesy, getting the email sent is not.
    const actionCodeSettings = { url: `${location.origin}/app.html`, handleCodeInApp: false };
    try {
      await state.firebaseApi.auth.sendPasswordResetEmail(state.auth, email, actionCodeSettings);
    } catch (error) {
      if (error?.code === "auth/unauthorized-continue-uri" || error?.code === "auth/invalid-continue-uri") {
        console.warn("Continue URL not authorised for this project; sending without one.", error);
        await state.firebaseApi.auth.sendPasswordResetEmail(state.auth, email);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.warn("[handleForgotPassword]", error);
    button.disabled = false;

    // A real failure is REPORTED, not dressed up as success. The old code
    // caught everything and still said "a link has been sent", so a blocked
    // App Check token, a dead uplink or a misconfigured project all looked
    // exactly like a delivered email -- the same misleading-success failure the
    // sign-in screen had, on the screen where being stuck is worst.
    if (error?.code === "auth/too-many-requests") return showToast(t("toast.authTooManyRequests"));
    if (error?.code === "auth/invalid-email") return setFieldError("authEmailError", t("auth.errorEmailInvalid"));
    if (error?.code === "auth/network-request-failed") return showToast(t("toast.passwordResetOffline"));
    // Whether this address has an account is not disclosed -- that distinction
    // is the enumeration hole.
    // Indistinguishable from success, and that has to include the STANDING
    // NOTICE as well as the toast. Showing the panel only for addresses that
    // exist would turn it into the enumeration oracle the neutral wording was
    // written to avoid -- press the button, watch for the panel, learn whether
    // that address banks here. Caught by its own test.
    if (PASSWORD_RESET_SILENT_CODES.has(error?.code)) {
      showToast(t("toast.passwordResetSent"));
      showResetSentNotice(email);
      return;
    }
    return showToast(t("toast.passwordResetFailed"));
  }
  // The toast stays for continuity, but the panel is what actually tells them:
  // it survives the trip to the inbox, names the address, and points at the
  // spam folder, which is where Firebase's default sender usually lands.
  showToast(t("toast.passwordResetSent"));
  showResetSentNotice(email);
  button.disabled = false;
}

// Shown until dismissed. Named with the address so somebody who mistyped it can
// see that they did -- the commonest reason a reset "never arrives".
function showResetSentNotice(email) {
  const notice = qs("#authResetSent");
  const body = qs("#authResetSentBody");
  if (!notice || !body) return;
  body.textContent = t("auth.resetSentBody", { email });
  notice.hidden = false;
  notice.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function hideResetSentNotice() {
  const notice = qs("#authResetSent");
  if (notice) notice.hidden = true;
}

// The verification link is opened somewhere else -- a second tab, or the phone
// the email arrived on -- so nothing in this tab ever hears about it. The
// Firebase user object caches emailVerified from sign-in and
// onAuthStateChanged does not fire again for a verification, which left the
// amber banner standing until someone happened to reload the whole app. Asking
// again when the tab comes back to the front costs one request at the exact
// moment somebody has returned from their inbox.
const VERIFICATION_RECHECK_GAP_MS = 5000;

let lastVerificationCheckMs = 0;

async function refreshEmailVerification() {
  // Nothing to learn: signed out, already verified, or no connection to ask
  // over. Once it flips this stops running for the rest of the session, so the
  // steady state after verifying is no requests at all.
  if (!state.user || state.user.emailVerified) return;
  if (!navigator.onLine) return;
  // Switching tabs is not a rare event and each check is a round trip.
  const now = Date.now();
  if (now - lastVerificationCheckMs < VERIFICATION_RECHECK_GAP_MS) return;
  lastVerificationCheckMs = now;

  try {
    await state.user.reload();
  } catch (error) {
    console.warn("Could not refresh email verification status:", error);
    return;
  }
  if (!state.user.emailVerified) return;

  // reload() refreshes the account record, but the ID token still carries the
  // old email_verified claim until it is forced. The proxy checks the claim on
  // the token rather than the record (proxy/server.js), so without this the
  // banner would come down while the server went on turning the account away.
  try {
    await state.user.getIdToken(true);
  } catch (tokenError) {
    console.warn("Could not refresh the ID token after verification:", tokenError);
  }
  updateAuthUi();
  showToast(t("toast.emailVerified"));
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
  const ownerName = String(form.get("ownerName") || "").trim().slice(0, 80);

  const submitButton = qs("#authSubmitButton");
  submitButton.disabled = true;

  try {
    await checkAuthAttemptLimit(email);
    const authApi = state.firebaseApi.auth;
    if (state.authMode === "signup") {
      state.pendingBusinessName = businessName;
      state.pendingOwnerName = ownerName;
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
      state.pendingOwnerName = "";
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
// Settings is open to everyone who can sign in. It carries Sign out and the
// language toggle, which a cashier needs and which are not owner business;
// every owner-only control inside it is hidden by id, the same way it was
// hidden when these buttons lived in the topbar.
const CASHIER_ALLOWED_VIEWS = ["pos", "settings"];

const VAT_VIEW_ENABLED = false;

function canOpenView(viewId) {
  // The services screen is gated by business type as well as by role. The nav
  // item is hidden for a duka, but openView() is also reached from the command
  // palette and from a stale click handler, and this is the choke point that
  // makes hiding it mean something.
  if (viewId === "services" && !storeSellsServices()) return false;
  // Profit is owner-strict, decided 2026-08-21: it exposes buying prices by
  // inference, and a manager already sees revenue, shift variance and staff
  // performance without it.
  if (viewId === "profit") return isOwnerRole();
  // Manager and owner, unlike Profit: a VAT record states what was charged and
  // what may be reclaimed, and carries no buying-price-against-selling-price
  // inference. Refused outright for a business that is not registered.
  // VAT is switched OFF at the owner's request on 2026-09-10, ahead of the
  // fiscalisation work rather than because anything is wrong with it. The
  // registration gate is kept beneath the flag rather than deleted, so turning
  // it back on is this one constant and nothing else. Everything the VAT screen
  // reads -- the per-product rates, the recorded output and input tax -- keeps
  // being written by the sale path meanwhile, so no history is lost while it is
  // dark, and a shop that switches it on later sees a complete record.
  if (viewId === "vat") return VAT_VIEW_ENABLED && isManagerOrOwnerRole() && vatSettings().registered;
  return isManagerOrOwnerRole() || CASHIER_ALLOWED_VIEWS.includes(viewId);
}

// Which screens a role may open. The nav is only the visible half of this;
// openView() asks the same question, because the command palette and any
// stale handler route through it too.

function applyRoleViewVisibility() {
  qsa(".nav-item").forEach((item) => {
    // A dormant item -- today only Accounts -- names a section that is coming
    // but has no screen behind it yet. It carries no data-view, so asking
    // canOpenView() about it would be asking about `undefined`, which falls
    // through to the manager check and would put an empty shelf in front of
    // staff. Owner only: it is a statement about where this is going, and
    // that is the owner's business.
    if (item.dataset.navPlaceholder) {
      item.hidden = !isOwnerRole();
      return;
    }
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
  // Profit is opened from the Reports chooser and has no nav item, so Reports
  // stays lit while it is on screen -- otherwise the sidebar shows nothing
  // selected and the screen reads as having fallen out of the app.
  const navView = viewId === "profit" ? "reports" : viewId;
  qsa(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === navView));
  qs(".sidebar").classList.remove("open");
  // Keep the Accounts menu honest about what is on screen. Reached from the
  // command palette and from the role redirect as well as from a nav click, so
  // it belongs here rather than on the toggle's own handler.
  if (viewId === "reports") {
    state.selectedReport = null;
    applyReportSelection();
  }
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
  renderServices();
  renderExpenses();
  renderPurchases();
  renderDeliveries();
  renderProfit();
  renderCostReports();
  renderVatNav();
  renderVatRecord();
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
  // Delegated, because the menu is rebuilt whenever roles or content change and
  // per-button listeners would be re-attached to elements that no longer exist.
  qs("#reportsIndexList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-open]");
    if (button) openReport(button.dataset.reportOpen);
  });
  qs("#reportsBackButton")?.addEventListener("click", closeReport);
  // Delegated: the tile is re-rendered on every dashboard render, so a listener
  // bound directly to the button would be attached to an element that no longer
  // exists by the time it is pressed.
  document.addEventListener("click", (event) => {
    if (event.target.closest("#showStockValueButton")) ensureProductCosts();
  });
  qs("#profitBackButton")?.addEventListener("click", () => openView("reports"));
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
  qs("#changeOwnerNameButton")?.addEventListener("click", changeOwnerName);
  qs("#archiveStoreButton")?.addEventListener("click", archiveStore);
  qs("#setBusinessTypeButton")?.addEventListener("click", setStoreBusinessType);
  qs("#setCurrencyButton")?.addEventListener("click", setStoreCurrency);
  qs("#vatSettingsButton")?.addEventListener("click", openVatSettingsDialog);
  qs("#saveVatSettingsButton")?.addEventListener("click", saveVatSettings);
  qs("#closeVatSettingsDialog")?.addEventListener("click", () => qs("#vatSettingsDialog").close());
  qs("#cancelVatSettingsDialog")?.addEventListener("click", () => qs("#vatSettingsDialog").close());
  qs("#staffRosterButton")?.addEventListener("click", () => { renderStaffRoster(); qs("#staffRosterDialog").showModal(); });
  qs("#settingsStaffRosterButton")?.addEventListener("click", () => { renderStaffRoster(); qs("#staffRosterDialog").showModal(); });
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
  qs("#langToggleButton").addEventListener("click", () => setLanguage(state.language === "en" ? "sw" : "en"));
  qs("#stockAlertPopupToggle").addEventListener("change", (event) => setStockAlertPopupEnabled(event.target.checked));
  qs("#stockAlertPopupClose").addEventListener("click", closeStockAlertPopup);
  qs("#stockAlertPopupOk").addEventListener("click", closeStockAlertPopup);
  qs("#stockAlertDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeStockAlertPopup();
  });
  qs("#inventoryAddButton").addEventListener("click", () => openProductDialog());
  // The per-unit readout depends on BOTH boxes, so both have to feed it --
  // wiring only the amount would leave a stale figure on screen the moment
  // someone corrected the quantity, which is worse than showing none.
  qs("#productTotalPaidInput")?.addEventListener("input", renderProductUnitCostHint);
  qs("#productForm")?.elements?.quantity?.addEventListener("input", renderProductUnitCostHint);
  qs("#closeProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#cancelProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#closeTransferDialog")?.addEventListener("click", () => qs("#transferDialog").close());
  qs("#cancelTransferDialog")?.addEventListener("click", () => qs("#transferDialog").close());
  qs("#confirmTransferButton")?.addEventListener("click", confirmTransfer);
  qs("#expenseAddButton")?.addEventListener("click", () => openExpenseDialog());
  // Choosing a category RESETS the type of cost to that category's default,
  // every time -- rather than tracking whether the box has been touched.
  // Predictable beats clever here: "pick a category, then correct the type if it
  // is wrong" is one rule a shop can hold, and the alternative silently keeps a
  // classification chosen for a different category.
  qs("#expenseCategorySelect")?.addEventListener("change", (event) => {
    const nature = qs("#expenseNatureSelect");
    if (nature) nature.value = EXPENSE_NATURE_BY_CATEGORY[event.currentTarget.value] || "indirect";
    renderExpenseNatureHint();
  });
  qs("#expenseNatureSelect")?.addEventListener("change", renderExpenseNatureHint);
  qs("#closeExpenseDialog")?.addEventListener("click", () => qs("#expenseDialog").close());
  qs("#cancelExpenseDialog")?.addEventListener("click", () => qs("#expenseDialog").close());
  qs("#expenseForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveExpense(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  qs("#purchasesTable")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-purchase]");
    if (remove) return deletePurchase(remove.dataset.deletePurchase);
    const ret = event.target.closest("[data-return-purchase]");
    if (ret) openPurchaseReturnDialog(ret.dataset.returnPurchase);
  });
  qs("#addSupplierButton")?.addEventListener("click", () => openSupplierDialog(""));
  qs("#closeSupplierDialog")?.addEventListener("click", () => qs("#supplierDialog").close());
  qs("#cancelSupplierDialog")?.addEventListener("click", () => qs("#supplierDialog").close());
  qs("#supplierForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSupplier(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  qs("#suppliersTable")?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-supplier]");
    if (edit) return openSupplierDialog(edit.dataset.editSupplier);
    const pay = event.target.closest("[data-supplier-pay]");
    if (pay) return openSupplierPaymentDialog(pay.dataset.supplierPay);
    const statement = event.target.closest("[data-supplier-statement]");
    if (statement) openSupplierStatement(statement.dataset.supplierStatement);
  });
  qs("#closeStockAdjustDialog")?.addEventListener("click", () => qs("#stockAdjustDialog").close());
  qs("#cancelStockAdjustDialog")?.addEventListener("click", () => qs("#stockAdjustDialog").close());
  qs("#stockAdjustForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    recordStockAdjustment(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  qs("#stockAdjustForm")?.addEventListener("input", (event) => {
    if (event.target?.name === "newQuantity") renderAdjustDelta();
  });
  qs("#closePurchaseReturnDialog")?.addEventListener("click", () => qs("#purchaseReturnDialog").close());
  qs("#cancelPurchaseReturnDialog")?.addEventListener("click", () => qs("#purchaseReturnDialog").close());
  qs("#purchaseReturnForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    recordPurchaseReturn(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  qs("#closeSupplierPaymentDialog")?.addEventListener("click", () => qs("#supplierPaymentDialog").close());
  qs("#cancelSupplierPaymentDialog")?.addEventListener("click", () => qs("#supplierPaymentDialog").close());
  qs("#supplierPaymentForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    recordSupplierPayment(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  qs("#closeSupplierStatementDialog")?.addEventListener("click", () => qs("#supplierStatementDialog").close());
  qs("#doneSupplierStatementDialog")?.addEventListener("click", () => qs("#supplierStatementDialog").close());
  qs("#vatMonthInput")?.addEventListener("change", () => renderVatRecord());
  qs("#openVatRecordLink")?.addEventListener("click", () => openView("vat"));
  qs("#profitMonthInput")?.addEventListener("change", (event) => {
    state.profitMonthSelection = event.currentTarget.value || state.profitMonthSelection;
    state.profitMonthTouched = true;
    renderProfit();
  });
  qs("#purchaseMonthInput")?.addEventListener("change", (event) => {
    state.purchaseMonthSelection = event.currentTarget.value || state.purchaseMonthSelection;
    state.purchaseMonthTouched = true;
    renderPurchases();
  });
  // Deliveries -- DESIGN-landed-costs.md phase 4.
  qs("#costReportMonthInput")?.addEventListener("change", (event) => {
    state.reportsCostMonth = event.currentTarget.value || state.reportsCostMonth;
    renderCostReports();
  });
  qs("#openDeliveryDialog")?.addEventListener("click", openDeliveryDialog);
  qs("#closeDeliveryDialog")?.addEventListener("click", () => qs("#deliveryDialog").close());
  qs("#cancelDeliveryDialog")?.addEventListener("click", () => qs("#deliveryDialog").close());
  qs("#deliveryMonthInput")?.addEventListener("change", (event) => {
    state.deliveryMonthSelection = event.currentTarget.value || state.deliveryMonthSelection;
    state.deliveryMonthTouched = true;
    renderDeliveries();
  });
  qs("#deliveriesTable")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-delete-delivery]");
    if (remove) confirmDeleteDelivery(remove.dataset.deleteDelivery);
  });
  qs("#addDeliveryLine")?.addEventListener("click", () => {
    if (state.deliveryDraft.lines.length >= DELIVERY_MAX_LINES) {
      const slot = qs("#deliveryFormError");
      if (slot) slot.textContent = t("deliveries.errTooManyLines", { max: String(DELIVERY_MAX_LINES) });
      return;
    }
    state.deliveryDraft.lines.push({ productId: "", quantity: "", goodsCost: "", manual: "" });
    renderDeliveryDialog();
  });
  // Delegated, and on `input` rather than `change`: the preview is the point of
  // this screen, and a shop should see what a delivery will cost as it types
  // rather than after it tabs away.
  //
  // The rows are re-rendered whenever a line is added or removed, so per-field
  // listeners would be re-bound on every keystroke's render and leak.
  qs("#deliveryLines")?.addEventListener("input", (event) => {
    const row = event.target.closest("[data-line]");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    const line = state.deliveryDraft.lines[Number(row.dataset.line)];
    if (!line) return;
    line[field] = event.target.value;
    // The preview only, not the whole dialog: re-rendering the rows mid-keystroke
    // would rebuild the input the caret is sitting in and lose the caret with it.
    renderDeliveryPreview();
  });
  qs("#deliveryLines")?.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-line]");
    if (!remove) return;
    // Never below one row. An empty dialog offers nothing to type into and no
    // way back to a row, and "add a product" is a worse first instruction than
    // an empty line already waiting.
    if (state.deliveryDraft.lines.length <= 1) {
      state.deliveryDraft.lines = [{ productId: "", quantity: "", goodsCost: "", manual: "" }];
    } else {
      state.deliveryDraft.lines.splice(Number(remove.dataset.removeLine), 1);
    }
    renderDeliveryDialog();
  });
  qs("#deliveryCostFields")?.addEventListener("input", (event) => {
    const type = event.target.dataset.cost;
    if (!type) return;
    state.deliveryDraft.costs[type] = event.target.value;
    renderDeliveryPreview();
  });
  qs("#deliveryBasis")?.addEventListener("change", (event) => {
    state.deliveryDraft.basis = event.currentTarget.value;
    // The whole dialog, not just the preview: switching to manual adds a Share
    // box to every row, and switching away removes it.
    renderDeliveryDialog();
  });
  qs("#deliveryForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    submitDelivery();
  });
  qs("#restockTotalPaidInput")?.addEventListener("input", renderRestockUnitCostHint);
  qs("#restockQuantityInput")?.addEventListener("input", renderRestockUnitCostHint);
  qs("#expenseMonthInput")?.addEventListener("change", (event) => {
    state.expenseMonthSelection = event.currentTarget.value || state.expenseMonthSelection;
    state.expenseMonthTouched = true;
    renderExpenses();
  });
  // Delegated: the rows are re-rendered on every snapshot, so per-row listeners
  // would be re-bound on each one and leak.
  qs("#expensesTable")?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-expense]");
    if (edit) return openExpenseDialog(edit.dataset.editExpense);
    const remove = event.target.closest("[data-delete-expense]");
    if (remove) deleteExpense(remove.dataset.deleteExpense);
  });
  qs("#servicesAddButton")?.addEventListener("click", () => openServiceDialog());
  qs("#closeServiceDialog")?.addEventListener("click", () => qs("#serviceDialog").close());
  qs("#cancelServiceDialog")?.addEventListener("click", () => qs("#serviceDialog").close());
  qs("#serviceForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    saveService(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
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
  qs("#authResetSentDismiss")?.addEventListener("click", hideResetSentNotice);
  qs("#authEmail")?.addEventListener("input", hideResetSentNotice);
  qs("#authModeButton")?.addEventListener("click", hideResetSentNotice);
  qs("#authForgotPasswordButton").addEventListener("click", handleForgotPassword);
  qs("#signOutButton").addEventListener("click", async () => {
    if (!state.auth) return;
    const { signOut } = state.firebaseApi.auth;
    await signOut(state.auth);
    showToast(t("toast.signedOut"));
  });
  qs("#resendVerificationButton")?.addEventListener("click", handleResendVerification);
  // Both fire on a tab switch and refreshEmailVerification() throttles, so the
  // pair costs nothing: visibilitychange catches coming back from the inbox in
  // another tab, focus catches the window itself regaining it, and online
  // catches a link opened on a phone while this till had no connection.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshEmailVerification(); });
  window.addEventListener("focus", refreshEmailVerification);
  window.addEventListener("online", refreshEmailVerification);
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

    const serviceButton = event.target.closest("[data-add-service]");
    if (serviceButton) {
      const serviceId = serviceButton.dataset.addService;
      const qtyInput = qs(`[data-service-qty-input="${serviceId}"]`);
      const requestedQty = Math.max(1, Math.floor(Number(qtyInput?.value || 1)));
      const result = addServiceToCartById(serviceId, { qty: requestedQty });
      if (!result?.success) return;
      if (qtyInput) qtyInput.value = 1;
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
      // A service has no matching product document, so the `cartItem && product`
      // guard below would silently do nothing and the + button would look
      // broken. Handled first, with no stock ceiling to check.
      if (isServiceLine(cartItem)) {
        pushCartHistory();
        cartItem.qty += 1;
        renderCart();
        return;
      }
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
      const rawPrice = await askText(
        t("dialog.editPricePrompt", { name: cartItem.name, currency: currentCurrencyCode() }),
        { defaultValue: cartItem.sellingPrice, numeric: true });
      // Cancelling must not change the price. Number(null) is 0, and 0 clears
      // both checks below, so backing out of a price override handed the
      // customer the item for nothing -- and the override password had already
      // been entered by then, so it looked authorised. An empty box is the same
      // thing typed rather than clicked.
      if (rawPrice === null || String(rawPrice).trim() === "") return;
      const newPrice = Number(rawPrice);
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

    if (event.target.closest("#clearInventoryFilters")) {
      const search = qs("#globalSearch");
      if (search) search.value = "";
      const category = qs("#categoryFilter");
      if (category) category.value = "all";
      const stock = qs("#stockFilter");
      if (stock) stock.value = "all";
      // renderAll, not renderInventory: the same search box narrows the POS
      // list and the KPI row reads its own unfiltered source, so clearing it
      // here has to put every view back in agreement.
      renderAll();
      return;
    }

    const editServiceButton = event.target.closest("[data-edit-service]");
    if (editServiceButton) {
      const service = state.services.find((item) => item.id === editServiceButton.dataset.editService);
      if (service) openServiceDialog(service);
      return;
    }

    const toggleServiceButton = event.target.closest("[data-toggle-service]");
    if (toggleServiceButton) {
      toggleServiceActive(toggleServiceButton.dataset.toggleService);
      return;
    }

    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      const product = state.products.find((item) => item.id === editButton.dataset.editProduct);
      if (product) openProductDialog(product);
      return;
    }

    const adjustButton = event.target.closest("[data-adjust-product]");
    if (adjustButton) {
      openStockAdjustDialog(adjustButton.dataset.adjustProduct);
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
      // Same reason as the + button: no product document, no stock ceiling, and
      // the joint guard below would otherwise reject the edit outright.
      if (isServiceLine(cartItem)) {
        pushCartHistory();
        cartItem.qty = Math.max(1, Math.floor(Number(qtyEditInput.value || 1)));
        renderCart();
        return;
      }
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
        const proceed = await askConfirm(t("dialog.duplicateOrderConfirm", { orderNumber: orderNumberRaw, name: seller.name }));
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
      // Written on every line, products included, so the discriminator is a
      // value rather than an absence. Every sale recorded before this existed
      // has no `kind` at all and is read as a product by isServiceLine()'s
      // default, which is correct and needs no migration.
      kind: isServiceLine(cartItem) ? "service" : "product",
      // productId names a document in `products`. A service line has none, so
      // it carries serviceId instead and productId is omitted -- not set to
      // null, because every stock path reaches for products/{productId} and a
      // null would build the path `products/null` rather than failing loudly.
      ...(isServiceLine(cartItem)
        ? { serviceId: cartItem.id }
        : { productId: cartItem.id }),
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

    // Minted once, here, and used by whichever path ends up recording the sale.
    //
    // Both paths derive this from staffId + orderNumber, which is what makes a
    // retry idempotent -- but the duplicate case appends Date.now(), so
    // computing it separately in each path would hand a sale that started
    // online and finished queued two DIFFERENT ids, and let both commit. That
    // is the precise double-sale the deterministic id exists to prevent, so the
    // timeout fallback below is only safe because the id is decided before the
    // paths diverge.
    const dedupeSaleId = `ord_${seller.id}_${orderNumber}`;
    const saleId = duplicate ? `${dedupeSaleId}_dup${Date.now()}` : dedupeSaleId;

    if (state.db && state.user && state.businessOwnerUid && shouldQueueSaleOffline(paymentMethod)) {
      queueOfflineSale({
        saleId,
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
        // Idempotency: the sale document is keyed deterministically on staffId +
        // the staff-entered order number instead of a random auto-id (minted
        // above, before the offline and online paths diverge). A retried
        // submission (flaky network, double-tap after a hang, etc.) for the same
        // order number resolves to the SAME document path, so Firestore's
        // create-vs-update rule semantics reject the retry instead of silently
        // creating a second sale and double-decrementing stock. If the cashier
        // already confirmed "record again anyway" above (duplicate === true),
        // that deliberate re-entry gets its own distinct id so it isn't blocked.
        const saleRef = doc(state.db, "users", state.businessOwnerUid, "sales", saleId);
        let creditCustomerId = null;
        if (paymentMethod === "credit") {
          creditCustomerId = await findOrCreateCustomerForCredit(customerName, creditPhoneKey);
        }
        const creditCustomerRef = creditCustomerId ? doc(state.db, "users", state.businessOwnerUid, "customers", creditCustomerId) : null;
        // Set once the timeout below has already given up on this transaction,
        // so its late settlement is logged rather than reported twice.
        let unconfirmed = false;
        const attempt = runTransaction(state.db, async (transaction) => {
          const existingSaleSnap = await transaction.get(saleRef);
          if (existingSaleSnap.exists()) {
            throw new Error(t("txerror.duplicateOrderSubmission", { orderNumber }));
          }

          // Stock lines only (DESIGN-services.md §3). A service has no product
          // document, so an unfiltered map built products/undefined and the
          // exists() check below then threw txerror.itemGone -- which failed
          // not just that line but the whole transaction, taking every real
          // product in the same basket with it. A bar ringing up a plate of
          // food beside a bottled beer is the first sale this feature ever
          // processes, and that is the sale that used to fail.
          //
          // stockCart is indexed in step with productRefs/productSnaps below;
          // `cart` is not, once a service is in it. Reusing `cart` for those
          // indexes is the mistake this variable exists to prevent.
          const stockCart = cart.filter((cartItem) => !isServiceLine(cartItem));
          const productRefs = stockCart.map((cartItem) => doc(state.db, "users", state.businessOwnerUid, "products", cartItem.id));
          const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));
          const creditCustomerSnap = creditCustomerRef ? await transaction.get(creditCustomerRef) : null;

          productSnaps.forEach((snap, index) => {
            const cartItem = stockCart[index];
            if (!snap.exists()) throw new Error(t("txerror.itemGone", { name: cartItem.name }));
            const currentQuantity = Number(snap.data().quantity || 0);
            if (currentQuantity < cartItem.qty) {
              throw new Error(t("txerror.notEnoughStockItem", { name: cartItem.name, quantity: currentQuantity }));
            }
          });

          productSnaps.forEach((snap, index) => {
            const cartItem = stockCart[index];
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
            // OMITTED, not null. auditStringsBounded() in firestore.rules reads
            // `!('customerId' in d) || d.customerId is string` -- absent is
            // fine, null is refused, because the key is present and null is not
            // a string. That refusal took the WHOLE credit sale down with it:
            // all six writes are one transaction, so an audit entry the rules
            // will not accept means no sale, no stock movement, no customer
            // balance, and a cashier told "your account is not allowed to do
            // this" with a customer standing in front of them.
            //
            // It fired on exactly the case this entry exists to record: a
            // first-time credit customer, whose document is created moments
            // later and so is not in local state when the limit check runs, and
            // a cashier serving another branch's customer (QA-110). An
            // established customer with no limit set sends a real customerId,
            // which is why the other unchecked path always worked and this one
            // never did.
            //
            // validSale() does allow customerId: null, which is what made the
            // asymmetry easy to miss -- the sale document and the audit
            // document disagree about how to say "nobody".
            const uncheckedEntry = {
              action: "CREDIT_LIMIT_UNCHECKED",
              reason: creditLimitDecision.uncheckedReason || "unknown",
              saleTotal: total,
              storeId: state.currentStoreId,
              uid: state.user?.uid || null,
              createdAt: serverTimestamp()
            };
            if (creditLimitDecision.customerId) uncheckedEntry.customerId = creditLimitDecision.customerId;
            if (customerName) uncheckedEntry.customerName = customerName;
            // A number field, and auditStringsBounded() does not type-check it,
            // so null would pass -- omitted anyway so "not known" is expressed
            // one way throughout this entry rather than two.
            if (creditLimitDecision.previousBalance != null) {
              uncheckedEntry.previousBalance = creditLimitDecision.previousBalance;
            }
            transaction.set(uncheckedRef, uncheckedEntry);
          }

          // Written in the same transaction as the sale it justifies. A record
          // of an override whose sale rolled back would be worse than none.
          if (creditLimitDecision.overridden) {
            const overrideRef = doc(collection(state.db, "users", state.businessOwnerUid, "auditLogs"));
            transaction.set(overrideRef, {
              action: "CREDIT_LIMIT_EXCEEDED",
              customerId: creditLimitDecision.customerId,
              // Spread, not `|| null`. Same rule, same failure as the unchecked
              // entry below it: auditStringsBounded() types customerName as a
              // string when the key is present, so a crossing recorded for a
              // customer whose name nobody typed would be refused -- and this
              // write is inside the sale transaction, so the sale goes with it.
              ...(customerName ? { customerName } : {}),
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

        // Promise.race leaves the loser running, and a rejection with nobody
        // listening is an unhandled rejection the browser reports as a crash.
        // Attached before the race so it cannot be missed. Only speaks up once
        // the timeout has given up -- otherwise the catch below has it.
        attempt.catch((lateError) => {
          if (!unconfirmed) return;
          console.warn("A sale transaction that had already timed out then failed.", lateError);
          try { reportFault("rejection", `timed-out sale later failed: ${lateError?.code || lateError}`, "completeSale"); }
          catch (reportError) { console.warn(reportError); }
        });

        const outcome = await awaitSaleTransaction(attempt);

        if (outcome === "unconfirmed") {
          unconfirmed = true;
          // Cash can be held on the device, so it is -- under the SAME sale id
          // the transaction is using. Whichever reaches the server first wins:
          // if the transaction commits, this batch's set() on an existing sale
          // is an update, which firestore.rules only permits in void or return
          // shape, so the batch is refused WHOLE and the stock is not
          // decremented twice. If the batch lands first, the transaction's own
          // exists() check throws. Exactly one sale either way.
          if (paymentMethod === "cash") {
            queueOfflineSale({
              saleId,
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
            showToast(t("toast.saleHeldUnconfirmed"));
          } else {
            // Not queueable: a credit sale needs the customer's real balance and
            // an authorised override, neither of which exists here. And it must
            // not be reported as failed, because the transaction may still
            // commit. Unknown is the honest answer, so the cashier is told to
            // look before re-entering -- and if they do re-enter, the shared id
            // means the rules refuse the second one.
            showToast(t("toast.saleUnconfirmed"));
            return;
          }
        } else {
          state.lastSale = { mode: "firestore", saleId: saleRef.id, items: saleItems, paymentMethod, total, ...taxFields };
        }
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
      // A services-only sale moves no stock, so saying "inventory updated"
      // describes something that did not happen. Small, but the till is where
      // staff learn what the system does, and a message that is wrong in the
      // easy case is not trusted in the hard one.
      const movedStock = (saleItems || []).some((line) => line.kind !== "service");
      showToast(changeDue > 0
        ? t("toast.saleCompletedChange", { change: money(changeDue) })
        : t(movedStock ? "toast.saleCompleted" : "toast.saleCompletedServices"));
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
    // user neither which box was wrong nor what would be accepted.
    //
    // costPrice is deliberately NOT here any more. It never had an input in
    // this form, and firestore.rules now refuses it on a product document
    // outright -- cost lives in /productCosts, out of a cashier's reach.
    const numericFields = [
      ["quantity", product.quantity, MAX_COUNT, "product.quantityLabel"],
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
    // Spec 4.1. A <select> hands back the STRING "true"/"false"; the rules
    // require a real boolean, so without this every save is refused.
    product.active = String(product.active) !== "false";
    product.unit = String(product.unit || "").trim().slice(0, 20);
    // Omitted rather than written empty, so an untouched unit does not clear one
    // set from another device on a merge write.
    if (!product.unit) delete product.unit;
    product.shelf = product.shelf || "";
    product.expiryDate = product.expiryDate || "";
    // Opening-stock cost. Only on a create, only for someone allowed to record
    // cost, and only when they actually typed an amount -- everything below is
    // skipped entirely otherwise, so the ordinary path is unchanged.
    let costCapture = null;
    const isNewProduct = !product.id;
    if (isNewProduct && canRecordCost()) {
      const totalPaidRaw = String(qs("#productTotalPaidInput")?.value || "").trim();
      const errorSlot = qs("#productTotalPaidError");
      if (errorSlot) errorSlot.textContent = "";
      if (totalPaidRaw) {
        const totalPaid = clampNonNegativeNumber(totalPaidRaw, MAX_MONEY);
        if (totalPaid === null || totalPaid <= 0) {
          if (errorSlot) errorSlot.textContent = t("product.totalPaidInvalid");
          return;
        }
        // A total with no quantity cannot become a per-unit cost, and guessing
        // one would put a fabricated figure under every future margin.
        const openingQty = safeNumber(product.quantity);
        if (openingQty <= 0) {
          if (errorSlot) errorSlot.textContent = t("product.totalPaidNeedsQuantity");
          return;
        }
        const receiptDateRaw = String(qs("#productReceiptDateInput")?.value || "").trim();
        let receiptDate = null;
        if (receiptDateRaw) {
          // Local parts at midday -- new Date("2026-08-21") is UTC midnight,
          // which is the previous day west of Greenwich.
          const [ry, rm, rd] = receiptDateRaw.split("-").map(Number);
          const parsed = new Date(ry, (rm || 1) - 1, rd || 1, 12, 0, 0);
          if (!Number.isNaN(parsed.getTime())) receiptDate = parsed;
        }
        const vatRaw = vatSettings().registered
          ? clampNonNegativeNumber(String(qs("#productVatAmountInput")?.value || "").trim() || "0", MAX_MONEY)
          : null;
        const vatSlot = qs("#productVatAmountError");
        if (vatSlot) vatSlot.textContent = "";
        if (vatRaw && vatRaw > totalPaid) {
          if (vatSlot) vatSlot.textContent = t("product.vatAmountInvalid");
          return;
        }
        costCapture = {
          totalPaid,
          vatAmount: vatRaw,
          quantity: openingQty,
          hasFiscalReceipt: Boolean(qs("#productHasReceiptInput")?.checked),
          receiptNumber: String(qs("#productReceiptInput")?.value || "").trim().slice(0, 60),
          supplierName: String(product.supplier || "").trim().slice(0, 120),
          receiptDate
        };
      }
    }
    saveProduct(product, costCapture);
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
