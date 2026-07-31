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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
