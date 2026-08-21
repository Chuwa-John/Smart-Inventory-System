// Verifies the arithmetic behind the manager and owner control panels by
// evaluating the REAL functions out of app.js -- not a reimplementation, which
// would only prove the copy agrees with itself.
//
//   node control-panel-math.test.mjs
//
// These figures are what a manager counts a drawer against, so the cases that
// matter most are the ones that quietly inflate takings: a voided sale, a
// refunded sale, and a credit sale whose deposit was paid in cash.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  const open = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { summariseSales, saleTimestamp, isSameDay, isSameMonth } = new Function(
  `${extract("safeNumber")}
   ${extract("saleTimestamp")}
   ${extract("isSameDay")}
   ${extract("isSameMonth")}
   ${extract("summariseSales")}
   return { summariseSales, saleTimestamp, isSameDay, isSameMonth };`
)();

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `\n      expected ${expected}, got ${actual}`}`);
}

const sale = (over = {}) => ({
  total: 10000, paymentMethod: "cash", voided: false, refundedAmount: 0,
  discountAmount: 0, items: [{ qty: 2 }], createdAt: new Date(), ...over
});

console.log("=== a clean cash shift ===");
{
  const s = summariseSales([sale(), sale(), sale()]);
  check("three cash sales count", s.count, 3);
  check("gross is the sum", s.gross, 30000);
  check("net equals gross with no refunds", s.net, 30000);
  check("drawer holds all of it", s.drawerCash, 30000);
  check("items are totalled", s.items, 6);
}

console.log("\n=== a voided sale must not inflate takings ===");
{
  const s = summariseSales([sale(), sale({ voided: true })]);
  check("void is excluded from count", s.count, 1);
  check("void is excluded from gross", s.gross, 10000);
  check("void is excluded from the drawer", s.drawerCash, 10000);
  check("void is counted separately", s.voidCount, 1);
  check("void value is reported", s.voidValue, 10000);
}

console.log("\n=== a refund reduces what is really in the drawer ===");
{
  const s = summariseSales([sale({ refundedAmount: 4000 })]);
  check("gross still shows the original sale", s.gross, 10000);
  check("net is reduced by the refund", s.net, 6000);
  check("drawer is reduced by the refund", s.drawerCash, 6000);
  check("refund is counted", s.refundCount, 1);
  check("refund value is reported", s.refundValue, 4000);
}

console.log("\n=== non-cash tenders do not land in the drawer ===");
{
  const s = summariseSales([
    sale({ paymentMethod: "mobile" }),
    sale({ paymentMethod: "card" }),
    sale({ paymentMethod: "cash" })
  ]);
  check("mobile is tracked", s.mobile, 10000);
  check("card is tracked", s.card, 10000);
  check("only the cash sale is in the drawer", s.drawerCash, 10000);
  check("net still covers every tender", s.net, 30000);
}

console.log("\n=== a credit sale with a cash deposit ===");
{
  const s = summariseSales([sale({
    paymentMethod: "credit", total: 10000, amountPaid: 3000,
    amountPaidMethod: "cash", balanceDue: 7000
  })]);
  check("the deposit reaches the drawer", s.drawerCash, 3000);
  check("the balance is tracked as outstanding", s.creditOutstanding, 7000);
  check("credit tender is recorded at full value", s.credit, 10000);
}
{
  const s = summariseSales([sale({
    paymentMethod: "credit", total: 10000, amountPaid: 3000,
    amountPaidMethod: "mobile", balanceDue: 7000
  })]);
  check("a mobile deposit stays out of the drawer", s.drawerCash, 0);
}

console.log("\n=== discounts are surfaced, not hidden in the total ===");
{
  const s = summariseSales([sale({ discountAmount: 2500 }), sale({ discountAmount: 1500 })]);
  check("discounts accumulate", s.discounts, 4000);
}

console.log("\n=== empty and malformed input ===");
{
  const s = summariseSales([]);
  check("no sales yields zero, not NaN", s.net, 0);
  const bad = summariseSales([{ }, { total: "abc", items: null }]);
  check("missing fields do not produce NaN", Number.isNaN(bad.net), false);
}

console.log("\n=== timestamp shapes that actually reach these panels ===");
{
  const now = new Date();
  check("Firestore Timestamp", isSameDay(saleTimestamp({ createdAt: { toDate: () => now } }), now), true);
  check("plain Date", isSameDay(saleTimestamp({ createdAt: now }), now), true);
  check("ISO string", isSameDay(saleTimestamp({ createdAt: now.toISOString() }), now), true);
  check("missing createdAt is not today", isSameDay(saleTimestamp({}), now), false);
  check("unparseable createdAt is not today", isSameDay(saleTimestamp({ createdAt: "nonsense" }), now), false);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  check("last month is not this month", isSameMonth(lastMonth, now), false);
  check("a different year, same month number, is not this month",
    isSameMonth(new Date(now.getFullYear() - 1, now.getMonth(), 1), now), false);
}

console.log("\n=== debt repaid today is money in, and is not revenue ===");
{
  // The shop asked for this: a customer pays off credit and it should show as
  // money taken that day, by the method they paid with, instead of the balance
  // simply disappearing.
  //
  // The trap is that a credit sale already books its FULL total as revenue on
  // the day it was made -- see saleNetTotal and the credit case above, where a
  // 10,000 sale with a 3,000 deposit reports credit 10,000. The repayment is
  // that receivable being collected. Adding it to takings would count one
  // trade twice, so these assertions exist as much to pin what must NOT move.
  const totals = new Function("state", "safeNumber",
    `${extract("repaymentTotalsToday")} return repaymentTotalsToday;`
  );
  const withRows = (rows, currentStoreId = null) =>
    totals({ repaymentsToday: rows, currentStoreId }, (v) => (Number.isFinite(Number(v)) ? Number(v) : 0));

  {
    const r = withRows([
      { amount: 5000, method: "cash", storeId: "A" },
      { amount: 3000, method: "mobile", storeId: "A" },
      { amount: 2000, method: "card", storeId: "A" }
    ])(false);
    check("cash repayments are bucketed", r.cash, 5000);
    check("mobile repayments are bucketed", r.mobile, 3000);
    check("card repayments are bucketed", r.card, 2000);
    check("the total is the sum", r.total, 10000);
    check("the count is the number of repayments", r.count, 3);
  }
  {
    // Matches shiftCashRepayments(), which treats a method-less entry as cash
    // rather than dropping it. Two rules for the same rows would put the drawer
    // tile and the shift panel back into disagreement.
    const r = withRows([{ amount: 4000, storeId: "A" }])(false);
    check("a repayment written before methods existed counts as cash", r.cash, 4000);
    const junk = withRows([{ amount: 4000, method: "barter", storeId: "A" }])(false);
    check("an unrecognised method is not silently dropped", junk.cash, 4000);
    check("...and does not invent a fourth bucket", junk.total, 4000);
  }
  {
    const r = withRows([
      { amount: 5000, method: "cash", storeId: "A" },
      { amount: 9000, method: "cash", storeId: "B" }
    ], "A")(true);
    check("another branch's repayment stays out of this till", r.cash, 5000);
    const all = withRows([
      { amount: 5000, method: "cash", storeId: "A" },
      { amount: 9000, method: "cash", storeId: "B" }
    ], "A")(false);
    check("...and is included when viewing all stores", all.cash, 14000);
  }
  {
    // The distinction the drawer tile depends on. A tile that prints 0 when it
    // means "I could not look" is a lie about the cash, and firestore.rules
    // makes auditLogs owner-read, so a manager genuinely cannot look.
    check("not loaded is null, not zero", withRows(null)(false), null);
    check("denied is null, not zero", withRows(undefined)(false), null);
    const none = withRows([])(false);
    check("genuinely none today is zero, not null", none && none.total, 0);
  }
  {
    // The whole accounting argument in one assertion: a repayment carries no
    // sale, so no revenue figure can move when one is recorded.
    const before = summariseSales([sale({ paymentMethod: "credit", total: 10000, amountPaid: 3000, amountPaidMethod: "cash", balanceDue: 7000 })]);
    const r = withRows([{ amount: 7000, method: "cash", storeId: "A" }])(false);
    check("net takings are unchanged by a repayment", before.net, 10000);
    check("the drawer gains exactly the cash repaid", before.drawerCash + r.cash, 10000);
    check("...which is the deposit plus the settlement, not the sale twice",
      before.drawerCash + r.cash, 3000 + 7000);
  }
}

console.log("\n=== the repayment figure is wired where it is claimed to be ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The end anchor must be searched FROM the start index: "const byStaff = new
  // Map()" also appears earlier in the file, and taking the first one made this
  // slice run backwards and silently match nothing.
  const gridStart = noComments.indexOf("qs(\"#managerControlGrid\").innerHTML");
  const grid = noComments.slice(gridStart, noComments.indexOf("const byStaff = new Map()", gridStart));
  check("the grid was located", grid.length > 500 && grid.length < 6000, true);

  check("the drawer tile adds cash repaid",
    /const drawerCash = s\.drawerCash \+ \(repayments\?\.cash \|\| 0\);/.test(noComments), true);
  check("the drawer note stops claiming repayments when they are unknown",
    /repayments \? t\("control\.expectedCashNoteWithRepayments"\) : t\("control\.expectedCashNote"\)/.test(grid), true);
  check("there is a tile for it", /control\.collectedOnAccount/.test(grid), true);
  check("unknown shows a dash, not a money figure",
    /repayments === null \? "—" : money\(repayments\.total\)/.test(grid), true);

  // The load-bearing negative: no revenue figure may take the repayment in.
  // The netTakings tile alone, matched as one call rather than sliced to the
  // next tile -- the collected-on-account tile now sits between them, and a
  // range that swallowed it read its wording as if it were part of takings.
  const takingsTile = /controlTile\(t\("control\.netTakings"\)[^\n]*/.exec(grid)?.[0] || "";
  check("the takings tile was located", takingsTile.length > 20, true);
  check("net takings is still plain s.net", /money\(s\.net\)/.test(takingsTile), true);
  check("...with no repayment term added", /repayment/i.test(takingsTile), false);

  // Recording a payment has to refresh it, or the cashier takes the money and
  // the tile they are looking at still says nothing.
  const payFn = noComments.slice(noComments.indexOf("async function confirmRecordPayment("));
  const payBody = payFn.slice(0, payFn.indexOf("\nasync function "));
  check("recording a payment invalidates the cache",
    /invalidateRepaymentsToday\(\);/.test(payBody), true);
  check("...and re-renders the panel", /renderManagerControl\(\);/.test(payBody), true);

  // Cached per DAY, not just per business: a till left open overnight must not
  // keep yesterday's collections on screen.
  check("the cache key includes the date",
    /const key = `\$\{state\.businessOwnerUid\}:\$\{new Date\(\)\.toDateString\(\)\}`;/.test(noComments), true);

  // "Credit outstanding" is summed straight from state.customers, so it is only
  // ever as fresh as the last repaint. subscribeToCustomers() used to repaint
  // just its own view, and a repayment writes ONLY to customers and auditLogs --
  // so nothing triggered a full render and the owner panel kept showing debt
  // that had been paid. Reported in UAT as credit not clearing.
  //
  // Sales-derived tiles never showed this because a sale also writes to
  // products, and that subscription does schedule a render; the credit path is
  // the one with no such side effect to ride on.
  const customersFn = noComments.slice(noComments.indexOf("async function subscribeToCustomers("));
  const customersBody = customersFn.slice(0, customersFn.indexOf("\nasync function "));
  check("the owner tile reads live customer balances",
    /const creditOwed = state\.customers\.reduce\(\(sum, c\) => sum \+ safeNumber\(c\.balanceOwed\), 0\);/.test(noComments), true);
  // Sliced to the onSnapshot callback specifically. subscribeToCustomers has an
  // early-return branch that also repaints, and a regex over the whole function
  // matched THAT and passed while the callback -- the one a repayment actually
  // fires -- had no repaint at all.
  const snapshotCallback = customersBody.slice(customersBody.indexOf("onSnapshot(customersQuery"));
  check("the snapshot callback was located", snapshotCallback.length > 80, true);
  check("a customer snapshot repaints the control panels",
    /scheduleRenderAll\(\);/.test(snapshotCallback), true);
  check("both the snapshot and the no-stores branch repaint",
    (customersBody.match(/scheduleRenderAll\(\);/g) || []).length, 2);
  check("...via the once-per-frame path, not a raw renderAll",
    !/[^e]renderAll\(\)/.test(customersBody), true);

  for (const key of ["control.collectedOnAccount", "control.collectedOnAccountNote",
                     "control.collectedOnAccountUnavailable", "control.expectedCashNoteWithRepayments"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 3, true);
  }
}

// ---------------------------------------------------------------------------
// Cost of goods -- DESIGN-purchases.md phase 0.
//
// The bug this replaces: the coverage guard asked costById.has(productId),
// which is presence, not value. costPrice has no input anywhere in the app, so
// every product carried an absent cost that safeNumber() reads as 0, every
// lookup passed, and the panel reported cost of goods as zero, gross margin as
// 100% of revenue, and captioned it "Revenue less cost of goods sold".
//
// The case named "production today" below is the exact shape of that: real
// sales, a real catalogue, and not one cost price anywhere. It must report
// nothing rather than a perfect margin.
const { summariseCostOfGoods } = new Function(
  `${extract("safeNumber")}
   ${extract("isServiceLine")}
   ${extract("summariseCostOfGoods")}
   return { summariseCostOfGoods };`
)();

console.log("\n=== cost of goods: coverage is not presence ===");
{
  const costs = (pairs) => new Map(pairs);
  const line = (productId, qty, over = {}) => ({ productId, qty, ...over });
  const withItems = (items, over = {}) => ({ voided: false, items, ...over });

  // Production today: a catalogue that exists, and no cost price in it.
  const productionToday = summariseCostOfGoods(
    [withItems([line("p1", 3), line("p2", 1)])],
    costs([["p1", 0], ["p2", 0]])
  );
  check("production today: cost of goods is not claimed to be zero",
    productionToday.anyCostKnown, false);
  check("production today: every line counts as uncosted",
    productionToday.uncostedLines, 2);
  check("production today: nothing is treated as costed",
    productionToday.costedLines, 0);
  check("production today: allCostKnown is false, not true",
    productionToday.allCostKnown, false);

  // The negative control for the exact defect: presence must not equal known.
  // A Map that HAS the key with value 0 is the state the old guard passed on.
  check("a cost of exactly zero is unknown, not free",
    summariseCostOfGoods([withItems([line("p1", 1)])], costs([["p1", 0]])).costedLines, 0);

  const fully = summariseCostOfGoods(
    [withItems([line("p1", 3), line("p2", 2)])],
    costs([["p1", 1500], ["p2", 400]])
  );
  check("cost of goods sums unit cost x quantity", fully.cogs, 3 * 1500 + 2 * 400);
  check("a fully costed month reports complete", fully.allCostKnown, true);
  check("...and counts no gaps", fully.uncostedLines, 0);

  const partial = summariseCostOfGoods(
    [withItems([line("p1", 2), line("p2", 5)])],
    costs([["p1", 1000], ["p2", 0]])
  );
  check("a partly costed month counts what it knows", partial.cogs, 2000);
  check("...reports a figure is available", partial.anyCostKnown, true);
  check("...but does not claim to be complete", partial.allCostKnown, false);
  check("...and names how many lines are missing", partial.uncostedLines, 1);
  check("...out of how many", partial.costedLines + partial.uncostedLines, 2);

  check("a voided sale contributes no cost of goods",
    summariseCostOfGoods(
      [withItems([line("p1", 10)], { voided: true })], costs([["p1", 1000]])
    ).cogs, 0);
  check("...and is not counted as a coverage gap either",
    summariseCostOfGoods(
      [withItems([line("p1", 10)], { voided: true })], costs([["p1", 1000]])
    ).uncostedLines, 0);

  // A haircut has no cost of goods. Counting it as unknown would report every
  // bar and salon month incomplete for a gap that does not exist.
  const mixed = summariseCostOfGoods(
    [withItems([line("p1", 1), line("svc1", 1, { kind: "service" })])],
    costs([["p1", 800]])
  );
  check("a service line is skipped, not counted as uncosted", mixed.uncostedLines, 0);
  check("...so a mixed basket can still report complete", mixed.allCostKnown, true);
  check("...and the service adds nothing to cost of goods", mixed.cogs, 800);

  // The old guard's one genuine signal, preserved: a sale referencing a product
  // that is no longer in the catalogue is a real gap.
  check("a product missing from the catalogue is a gap",
    summariseCostOfGoods([withItems([line("gone", 1)])], costs([])).uncostedLines, 1);

  check("an empty month reports nothing known rather than complete",
    summariseCostOfGoods([], costs([])).anyCostKnown, false);
}

console.log("\n=== the tiles say what they know ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  check("the panel calls the extracted function rather than inlining the loop",
    /const goods = summariseCostOfGoods\(monthSales, costById\);/.test(noComments), true);
  check("the old presence test is gone",
    /costById\.has\(/.test(noComments), false);

  const grid = noComments.slice(noComments.indexOf('controlTile(t("control.grossMargin")'));
  check("the margin tile was located", grid.length > 200, true);
  check("with no known cost the margin tile shows a dash, not a percentage",
    /goods\.anyCostKnown \? [^:]+ : "\u2014"/.test(grid), true);
  check("...and captions it as no cost recorded",
    /t\("control\.marginNoCost"\)/.test(grid), true);
  check("the incomplete caption reports the counts it found",
    /control\.marginIncomplete"[\s\S]{0,160}missing:[\s\S]{0,80}total:/.test(grid), true);
  check("the danger tone is suppressed when there is no cost to judge",
    /goods\.anyCostKnown && margin <= 0/.test(grid), true);

  check("stock at cost shows a dash rather than TZS 0 when no cost is recorded",
    /anyProductCosted \? money\(stockAtCost\) : "\u2014"/.test(noComments), true);
  check("...and still reports retail value, which is known either way",
    /control\.stockAtCostUnknown", \{ value: money\(stockAtRetail\) \}/.test(noComments), true);
  check("the per-store column applies the same rule",
    /storeCosted \? money\(cost\) : "\u2014"/.test(noComments), true);

  for (const key of ["control.marginNoCost", "control.stockAtCostUnknown"]) {
    check(`${key} exists in both languages and is used`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 3, true);
  }
  check("control.marginIncomplete carries the placeholders it is called with",
    (src.match(/"control\.marginIncomplete": "[^"]*\{missing\}[^"]*\{total\}[^"]*"/g) || []).length, 2);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
