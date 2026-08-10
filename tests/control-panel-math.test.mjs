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

  for (const key of ["control.collectedOnAccount", "control.collectedOnAccountNote",
                     "control.collectedOnAccountUnavailable", "control.expectedCashNoteWithRepayments"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 3, true);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
