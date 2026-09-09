// Stock adjustments, the per-product ledger, and the reports spec §9 asks for.
//
//   node stock-and-reports.test.mjs
//
// Phases 3-5 of DESIGN-suppliers-purchases.md.
//
// The rule this file exists to hold is the one from §2.2: a report is built
// ONLY where real transaction data stands behind it. The four Financial
// reports (Balance Sheet, Trial Balance, General Ledger, Cash Flow) are
// statements of a double-entry ledger this system does not keep, so they must
// be NAMED AS UNAVAILABLE and never rendered from something that resembles
// them. Reporting a figure the data cannot support is the defect this project
// already shipped once, when revenue was drawn as profit.
//
// Functions are evaluated out of app.js rather than reimplemented -- the
// purchases.test.mjs convention.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const body = (name) => extract(name).replace(/\/\/[^\n]*/g, "");

const num = (n) => Number(n) || 0;

console.log("=== stock adjustments (spec 4.4) ===");
{
  const b = body("recordStockAdjustment");
  // The shelf may have moved while the form sat open; writing the dialog's
  // delta would undo whatever happened in between.
  check("the delta is derived inside the transaction",
    /const before = safeNumber\(snap\.data\(\)\.quantity\);\s*const delta = newQuantity - before;/.test(b), true);
  check("a no-op adjustment is refused", /if \(delta === 0\)/.test(b), true);
  check("the reason is forced into the closed set",
    /STOCK_ADJUSTMENT_REASONS\.includes\(input\.reason\) \? input\.reason : "other"/.test(b), true);
  check("it leaves a ledger entry", /recordStockMovement\(transaction/.test(b), true);
  check("...labelled as an adjustment", /reason: "adjustment"/.test(b), true);
  check("...carrying why", /adjustmentReason: reason/.test(b), true);

  const reasons = (src.match(/const STOCK_ADJUSTMENT_REASONS = \[([\s\S]*?)\]/) || [, ""])[1]
    .split(",").map((r) => r.trim().replace(/["']/g, "")).filter(Boolean);
  // Spec 4.4 names these, plus opening stock from 4.2.
  for (const reason of ["count", "damaged", "expired", "lost", "theft", "correction", "opening", "other"]) {
    check(`"${reason}" is an available reason`, reasons.includes(reason), true);
  }
  // The client set and the rules set must agree, or a legal choice is refused
  // on write -- after the shop has counted the shelf.
  const ruleSet = (rules.match(/d\.adjustmentReason in\s*\n?\s*\[([^\]]*)\]/) || [, ""])[1]
    .split(",").map((r) => r.trim().replace(/["']/g, "")).filter(Boolean);
  check("every client reason is accepted by the rules",
    reasons.every((r) => ruleSet.includes(r)), true);
  check("...and the rules allow nothing the client cannot produce",
    ruleSet.every((r) => reasons.includes(r)), true);
}

console.log("\n=== the shelf count is derived, not typed (spec 4.2) ===");
{
  const open = body("openProductDialog");
  // Editable when adding (that number is opening stock), locked when editing.
  check("quantity is read-only on an existing product",
    /quantityInput\.readOnly = Boolean\(product\);/.test(open), true);
  check("...and the reason why is shown", html.includes('id="productQuantityLockNote"'), true);
  check("Adjust is offered on the inventory row", /data-adjust-product=/.test(src), true);
}

console.log("\n=== the per-product ledger (spec 4.3) ===");
{
  const rows = new Function("safeNumber", "esc", "t", "stockAdjustmentReasonLabel", `
    ${extract("buildStockLedgerRows")}
    return buildStockLedgerRows;
  `)(num, (v) => String(v), (k) => k, (r) => r);

  const at = (d) => new Date(2026, 8, d);
  const out = rows([
    { at: at(3), reason: "sale", delta: -2, quantityAfter: 48 },
    { at: at(1), reason: "restock", delta: 50, quantityAfter: 50 },
    { at: at(2), reason: "adjustment", adjustmentReason: "damaged", delta: -1, quantityAfter: 49 }
  ]);
  // Oldest first: a running balance only reads forwards. Every other list in
  // this app is newest first precisely because it is not cumulative.
  check("the ledger runs oldest first",
    out.indexOf(">50<") < out.indexOf(">49<") && out.indexOf(">49<") < out.indexOf(">48<"), true);
  check("an increase lands in the In column", /<td>50<\/td>\s*<td><\/td>/.test(out), true);
  check("a decrease lands in the Out column", /<td><\/td>\s*<td>2<\/td>/.test(out), true);
  check("an adjustment shows the reason it was given",
    out.includes("movement.reason.adjustment") && out.includes("damaged"), true);

  // An offline entry carries no chain (L-9). Inventing a balance for it would
  // be a guess wearing the authority of a measurement.
  const offline = rows([{ at: at(4), reason: "sale", delta: -3, offline: true }]);
  check("an offline entry admits it has no balance",
    offline.includes("movement.balanceUnknown"), true);
  check("...and does not print a made-up one", /<td>0<\/td>\s*<\/tr>/.test(offline), false);
  const missing = rows([{ at: at(5), reason: "sale", delta: -1 }]);
  check("a missing quantityAfter is treated the same way",
    missing.includes("movement.balanceUnknown"), true);
}

console.log("\n=== the ledger query is served by a real index ===");
{
  // A where() paired with an orderBy needs a declared composite index, or it
  // fails only in production -- the emulator builds them on demand.
  const declared = indexes.indexes.filter((i) => i.collectionGroup === "stockMovements");
  check("stockMovements has a composite index", declared.length >= 1, true);
  const fields = declared.flatMap((i) => i.fields.map((f) => `${f.fieldPath}:${f.order}`));
  check("...on productId and createdAt",
    fields.includes("productId:ASCENDING") && fields.includes("createdAt:DESCENDING"), true);
}

console.log("\n=== purchase reporting (spec 9) ===");
{
  const load = new Function("safeNumber", `
    ${extract("summarisePurchaseTotals")}
    ${extract("summarisePurchasesByProduct")}
    return { summarisePurchaseTotals, summarisePurchasesByProduct };
  `)(num);

  const purchases = [
    { productId: "a", productName: "Cement", quantity: 100, totalPaid: 1560000, goodsCost: 1500000, landedCost: 60000 },
    { productId: "b", productName: "Sand", quantity: 20, totalPaid: 200000 }
  ];
  const returns = [{ productId: "a", productName: "Cement", quantity: 10, amount: 156000 }];

  const totals = load.summarisePurchaseTotals(purchases, returns);
  check("goods and landed are counted separately", [totals.goods, totals.landed], [1700000, 60000]);
  check("gross is what was paid in total", totals.gross, 1760000);
  check("what went back is netted off", totals.net, 1760000 - 156000);
  check("returned units are counted", totals.returnedUnits, 10);
  // A purchase written before landed costs existed has neither field.
  const legacy = load.summarisePurchaseTotals([{ quantity: 5, totalPaid: 50000 }], []);
  check("a purchase with no goodsCost falls back to what was paid", legacy.gross, 50000);
  check("an empty range totals zero, not NaN", load.summarisePurchaseTotals([], []).net, 0);

  const byProduct = load.summarisePurchasesByProduct(purchases, returns);
  check("the biggest spend is first", byProduct.rows[0].name, "Cement");
  check("returns reduce that product's net spend", byProduct.rows[0].netSpend, 1560000 - 156000);
  check("...and its net units", byProduct.rows[0].netUnits, 90);
  check("a product with no returns is untouched",
    byProduct.rows.find((r) => r.name === "Sand").netSpend, 200000);
}

console.log("\n=== sales reporting (spec 9) ===");
{
  const load = new Function("safeNumber", "saleNetTotal", "saleTimestamp", `
    ${extract("summariseSalesByCustomer")}
    ${extract("summariseSalesReturns")}
    return { summariseSalesByCustomer, summariseSalesReturns };
  `)(num,
     (sale) => (sale.voided ? 0 : num(sale.total) - num(sale.refundedAmount)),
     (sale) => sale.at);

  const at = (d) => new Date(2026, 8, d);
  const sales = [
    { at: at(1), total: 100000, customerId: "c1", customerName: "Asha" },
    { at: at(2), total: 50000, customerId: "c1", customerName: "Asha" },
    { at: at(3), total: 30000 },
    { at: at(4), total: 999999, voided: true, customerId: "c1" }
  ];
  const byCustomer = load.summariseSalesByCustomer(sales);
  check("one customer's orders group together",
    byCustomer.rows.find((r) => r.name === "Asha").orders, 2);
  check("...and their revenue adds", byCustomer.rows.find((r) => r.name === "Asha").revenue, 150000);
  // A report that silently omits most of a duka's takings is worse than one
  // that says "walk-in".
  check("a sale with no customer is grouped as walk-in",
    byCustomer.rows.some((r) => r.isWalkIn), true);
  check("a voided sale contributes nothing", byCustomer.total, 180000);

  const returned = load.summariseSalesReturns([
    { at: at(1), total: 100000, orderNumber: "1001",
      returns: [{ items: [{ qty: 2 }], refundAmount: 20000, staffName: "Juma", createdAt: at(5).toISOString() }] }
  ]);
  check("a refund is listed", returned.rows.length, 1);
  check("...with its units", returned.totalUnits, 2);
  check("...and its value", returned.totalAmount, 20000);
  // Goods come back days after they were sold; bucketing on the sale's date
  // puts the refund in the wrong month.
  check("the return carries its own date", returned.rows[0].at.getDate(), 5);
}

console.log("\n=== inventory and expense reporting (spec 9) ===");
{
  const load = new Function("safeNumber", "productDisplayLabel", "expenseNature", "expenseSpentAt", "localMonthKey", `
    ${extract("summariseStockSummary")}
    ${extract("summariseStockAdjustments")}
    ${extract("summariseSupplierBalances")}
    ${extract("summariseExpensesByCategory")}
    return { summariseStockSummary, summariseStockAdjustments, summariseSupplierBalances, summariseExpensesByCategory };
  `)(num, (p) => p.name, (e) => e.nature || "indirect", (e) => e.at,
     (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);

  const stock = load.summariseStockSummary([
    { id: "a", name: "Cement", quantity: 50, reorderLevel: 10 },
    { id: "b", name: "Sand", quantity: 5, reorderLevel: 10 },
    { id: "c", name: "Nails", quantity: 0, reorderLevel: 5 }
  ]);
  check("everything on the shelf is counted", stock.totalUnits, 55);
  check("low stock is flagged", stock.lowCount, 2);
  check("out of stock is flagged", stock.outCount, 1);

  const adj = load.summariseStockAdjustments([
    { reason: "adjustment", adjustmentReason: "damaged", delta: -3 },
    { reason: "adjustment", adjustmentReason: "damaged", delta: -2 },
    { reason: "adjustment", adjustmentReason: "count", delta: 4 },
    { reason: "sale", delta: -10 }
  ]);
  check("only adjustments are counted, not sales", adj.up + adj.down, 9);
  check("losses group under their reason",
    adj.rows.find((r) => r.reason === "damaged").down, 5);
  check("...and are counted", adj.rows.find((r) => r.reason === "damaged").count, 2);
  check("gains and losses are kept apart", [adj.up, adj.down], [4, 5]);

  const balances = load.summariseSupplierBalances([
    { id: "s1", name: "Twiga", balanceOwed: 500000 },
    { id: "s2", name: "Simba", balanceOwed: 0 },
    { id: "s3", name: "Nyati", balanceOwed: 120000 }
  ]);
  check("only suppliers owed something are listed", balances.rows.length, 2);
  check("the biggest debt is first", balances.rows[0].name, "Twiga");
  check("the total is what the business owes", balances.total, 620000);

  const expenses = load.summariseExpensesByCategory([
    { category: "rent", amount: 300000, nature: "indirect", at: new Date(2026, 7, 5) },
    { category: "transport", amount: 20000, nature: "direct", at: new Date(2026, 8, 2) },
    { category: "transport", amount: 15000, nature: "direct", at: new Date(2026, 8, 9) }
  ]);
  check("categories group and add", expenses.categories.find((c) => c.category === "transport").amount, 35000);
  check("...and are counted", expenses.categories.find((c) => c.category === "transport").count, 2);
  check("the biggest category is first", expenses.categories[0].category, "rent");
  check("months are separated", expenses.months.length, 2);
  check("the total is everything", expenses.total, 335000);
}

console.log("\n=== the reports that CANNOT be built are named, not faked ===");
{
  // The whole point of §2.2.
  check("the ledger-dependent group is disclosed", html.includes('id="ledgerPendingPanel"'), true);
  check("...naming all four statements",
    html.includes('data-i18n="reports.ledgerPendingTitle"'), true);
  for (const absent of ["balanceSheetTable", "trialBalanceTable", "cashFlowTable", "generalLedgerTable"]) {
    check(`there is no fake ${absent}`, html.includes(absent), false);
  }
  // P&L is real and reachable, because it is built from transactions.
  check("Profit & Loss is offered instead", html.includes('id="openProfitFromReports"'), true);

  // Reports are grouped the way §9 groups them.
  for (const group of ["reports.groupFinancial", "reports.groupSales", "reports.groupPurchases",
                       "reports.groupInventory", "reports.groupExpenses"]) {
    check(`${group} labels a section`, html.includes(`data-i18n="${group}"`), true);
  }
}

console.log("\n=== cost stays behind the owner gate ===");
{
  const b = body("renderSpecReports");
  check("cost panels are owner-only", /const costVisible = isOwnerRole\(\);/.test(b), true);
  check("purchase reporting is behind that gate",
    /#purchaseSummaryPanel[\s\S]*setPanel\(id, !costVisible\)/.test(b), true);
  // Emptied, not merely hidden: a demoted manager's figures must not sit in the
  // DOM behind a CSS rule.
  check("a wrong role empties the tables rather than hiding them",
    /fill\(id, ""\)/.test(b), true);
  check("...and returns before computing anything", b.indexOf('fill(id, "")') < b.indexOf("filteredSales()"), true);
}

console.log("\n=== product fields (spec 4.1) and Bank (spec 6) ===");
{
  for (const field of ["unit", "sku", "active"]) {
    check(`the product form captures ${field}`, new RegExp(`name="${field}"`).test(html), true);
  }
  // A <select> hands back the string "true"; the rules require a boolean.
  check("active is coerced to a real boolean",
    /product\.active = String\(product\.active\) !== "false";/.test(src), true);
  // Absent must read as ACTIVE, or eight live catalogues vanish from the till.
  check("a product with no active flag still sells",
    /\.filter\(\(product\) => product\.active !== false\)/.test(src), true);
  check("the rules accept unit and active",
    /!\('unit' in d\)/.test(rules) && /!\('active' in d\)/.test(rules), true);

  check("Bank is offered at the till", /data-payment="bank"/.test(html), true);
  check("...accepted by the rules", /'cash', 'mobile', 'card', 'bank', 'credit'/.test(rules), true);
  // A method with no slot is silently dropped from the breakdown.
  check("...and counted in the payment summary", /cash: 0, mobile: 0, card: 0, bank: 0, credit: 0/.test(src), true);
}

console.log("\n=== the P&L prints both margins (spec 10) ===");
{
  check("net margin is computed", /netMarginPct: revenue > 0/.test(src), true);
  // 0/0 is NaN, and "NaN%" is how an owner stops trusting the statement.
  check("...guarded against no sales", /netMarginPct: revenue > 0 \? [^:]*: 0/.test(src), true);
  // Matched on the CLAIM, not the separator: app.js is mixed between the
  // literal middle dot and its · escape and both render identically. What
  // matters is that the margin is printed next to the figure.
  // Both margins render through withMargin(), which prints the percentage only
  // when there is a real one -- an absent field would otherwise reach a money
  // screen as "undefined%", which is how a reader stops trusting the figure
  // beside it. A test fixture that omitted the field demonstrated exactly that.
  check("...and shown beside net profit",
    /withMargin\(money\(p\.netProfit\), p\.netMarginPct\)/.test(src), true);
  check("gross uses the same guard",
    /withMargin\(money\(p\.grossProfit\), p\.grossMarginPct\)/.test(src), true);
  check("a missing margin drops the percentage rather than printing undefined",
    /Number\.isFinite\(pct\) \? /.test(src), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["adjust.title", "adjust.reason.theft", "adjust.reason.opening", "adjust.noChange",
                     "movement.ledgerSectionTitle", "movement.balanceUnknown", "movement.reason.supplier-return",
                     "reports.ledgerPendingTitle", "reports.walkIn", "reports.purchaseNet",
                     "reports.supplierBalancesTotal", "reports.noAdjustments",
                     "product.unitLabel", "product.activeNo", "product.quantityLocked",
                     "kpi.receivable", "kpi.payable", "toast.adjustmentRecorded"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
