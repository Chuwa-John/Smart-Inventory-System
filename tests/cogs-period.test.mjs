// Periodic cost of goods sold, per AviaSmart_COGS_Prototype_Specification.docx.
//
//   node cogs-period.test.mjs
//
//   Opening Stock + Net Purchases - Closing Stock = COGS
//
// The real functions are evaluated here, not a copy and not a regex over the
// source, because the whole risk in this feature is arithmetic. Same technique
// control-panel-math.test.mjs uses on summariseCostOfGoods().
//
// The property that matters most is not the sum -- that is four lines of
// addition. It is that the engine reconstructs a PAST shelf position rather
// than reporting today's, and that it refuses to state a figure as fact when it
// cannot. A confidently wrong COGS is worse than no COGS: it goes into a P&L.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

// Deliberately not the extract() in control-panel-math.test.mjs. That one
// counts braces from the first "{" after the name, which for a function taking
// a DESTRUCTURED parameter -- computePeriodCogs({ fromMs, toMs, ... }) -- is the
// brace in the parameter list. It stops at the end of the signature and hands
// back a fragment that will not parse. This walks the parameter list to its
// closing paren first, then counts the body.
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);

  let i = src.indexOf("(", start);
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }

  let depth = 0;
  i = src.indexOf("{", i);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { computePeriodCogs, stockValueAt, buildCostIndex } = new Function(
  `${extract("safeNumber")}
   ${extract("costInForceAt")}
   ${extract("buildCostIndex")}
   ${extract("purchasedAt")}
   ${extract("movementTimeMs")}
   ${extract("stockValueAt")}
   ${extract("computePeriodCogs")}
   return { computePeriodCogs, stockValueAt, buildCostIndex };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}
const near = (a, b) => Math.abs(a - b) < 0.5;

const ms = (iso) => new Date(iso).getTime();
const JAN_FROM = ms("2026-01-01T00:00:00Z");
const JAN_TO = ms("2026-01-31T23:59:59Z");
const FEB_FROM = ms("2026-02-01T00:00:00Z");
const FEB_TO = ms("2026-02-28T23:59:59Z");

// One product, costed long before any of this, so valuation is never the
// variable under test except where it is meant to be.
const costIndex = buildCostIndex([
  { productId: "p1", costPrice: 2000, effectiveFrom: new Date("2020-01-01T00:00:00Z") }
]);

console.log("=== the spec's own worked example, section 3 ===");
{
  // Opening 5,000,000 + purchases 20,000,000 + carriage 1,000,000
  //   - returns 500,000 - discounts 200,000 = net 20,300,000
  //   available 25,300,000 - closing 7,000,000 = COGS 18,300,000
  //
  // Stock is expressed through quantity x unit cost, because that is the only
  // way the engine can produce it: 2,500 units at 2,000 is the 5,000,000 the
  // spec opens with.
  const products = [{ id: "p1", storeId: "s1", quantity: 3500 }];
  const movements = [
    // Opening position is walked back to from today's 3,500 units.
    { productId: "p1", storeId: "s1", delta: 1000, createdAt: new Date("2026-01-15T00:00:00Z") },
    { productId: "p1", storeId: "s1", delta: 0, createdAt: new Date("2025-12-01T00:00:00Z") }
  ];
  const purchases = [{
    storeId: "s1", createdAt: new Date("2026-01-10T00:00:00Z"),
    goodsCost: 20000000, landedCost: 1000000, purchaseDiscount: 200000
  }];
  const purchaseReturns = [{ storeId: "s1", createdAt: new Date("2026-01-20T00:00:00Z"), amount: 500000 }];

  const r = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements, costIndex, purchases, purchaseReturns
  });

  check("opening stock is the shelf at the From date", near(r.openingStock, 5000000),
    `got ${r.openingStock}`);
  check("closing stock is the shelf at the To date", near(r.closingStock, 7000000),
    `got ${r.closingStock}`);
  check("net purchases matches the spec", near(r.netPurchases, 20300000), `got ${r.netPurchases}`);
  check("cost of goods available matches the spec", near(r.goodsAvailable, 25300000),
    `got ${r.goodsAvailable}`);
  check("COGS matches the spec", near(r.cogs, 18300000), `got ${r.cogs}`);
  check("every line of the spec's table is reported", [
    "openingStock", "purchases", "carriageInwards", "purchaseReturns",
    "purchaseDiscounts", "netPurchases", "goodsAvailable", "closingStock", "cogs"
  ].every((key) => key in r));
}

console.log("\n=== a historical report uses the historical shelf, not today's ===");
{
  // Section 6: "The system must not simply use today's inventory balance for a
  // historical report." This is the one that makes the whole thing worth
  // building, and the one a naive implementation gets wrong.
  const products = [{ id: "p1", storeId: "s1", quantity: 100 }];
  const movements = [
    { productId: "p1", storeId: "s1", delta: 900, createdAt: new Date("2026-06-01T00:00:00Z") },
    { productId: "p1", storeId: "s1", delta: -900, createdAt: new Date("2026-07-01T00:00:00Z") }
  ];
  const janClose = stockValueAt(JAN_TO, { products, movements, costIndex, storeId: "s1" });
  check("June and July movements do not touch the January position",
    near(janClose.value, 100 * 2000),
    `got ${janClose.value}, expected the shelf as it stood in January`);
}

console.log("\n=== January's closing becomes February's opening, section 7 ===");
{
  const products = [{ id: "p1", storeId: "s1", quantity: 500 }];
  const movements = [
    { productId: "p1", storeId: "s1", delta: 200, createdAt: new Date("2026-02-10T00:00:00Z") }
  ];
  const jan = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements, costIndex, purchases: [], purchaseReturns: []
  });
  const feb = computePeriodCogs({
    fromMs: FEB_FROM, toMs: FEB_TO, storeId: "s1",
    products, movements, costIndex, purchases: [], purchaseReturns: []
  });
  check("the carry-forward is automatic, not re-entered",
    near(jan.closingStock, feb.openingStock),
    `January closed at ${jan.closingStock}, February opened at ${feb.openingStock}`);
}

console.log("\n=== it refuses to state a figure it cannot stand behind ===");
{
  // An unknown cost is UNKNOWN, not zero. The same rule costInForceAt() holds:
  // a shop with unpriced stock is not a shop with free stock.
  const products = [
    { id: "p1", storeId: "s1", quantity: 100 },
    { id: "p2", storeId: "s1", quantity: 100 }
  ];
  const r = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements: [], costIndex, purchases: [], purchaseReturns: []
  });
  check("a product with no recorded cost is counted, not valued at zero",
    r.uncostedAtClosing === 1, `uncosted ${r.uncostedAtClosing}`);
  check("...and the result is marked incomplete", r.complete === false);

  // The ledger is fetched newest-first under a limit. A period starting before
  // the oldest movement loaded cannot have its opening position reconstructed:
  // the walk back stops early and today's shelf is reported as the opening.
  const shallow = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products: [{ id: "p1", storeId: "s1", quantity: 10 }],
    movements: [{ productId: "p1", storeId: "s1", delta: 5, createdAt: new Date("2026-01-20T00:00:00Z") }],
    costIndex, purchases: [], purchaseReturns: []
  });
  check("a ledger that does not reach the From date says so",
    shallow.ledgerReachesOpening === false,
    "otherwise the opening stock is today's shelf wearing January's label");
}

console.log("\n=== absence and zero are different claims ===");
{
  const noField = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products: [], movements: [], costIndex,
    purchases: [{ storeId: "s1", createdAt: new Date("2026-01-10T00:00:00Z"), goodsCost: 100 }],
    purchaseReturns: []
  });
  check("a purchase with no discount field is flagged as not captured",
    noField.discountsAreCaptured === false,
    "nothing in the app asks for a supplier discount yet");

  const withField = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products: [], movements: [], costIndex,
    purchases: [{ storeId: "s1", createdAt: new Date("2026-01-10T00:00:00Z"), goodsCost: 100, purchaseDiscount: 0 }],
    purchaseReturns: []
  });
  check("...and a recorded discount of zero is a real zero",
    withField.discountsAreCaptured === true);
}

console.log("\n=== scoping and boundaries ===");
{
  const products = [
    { id: "p1", storeId: "s1", quantity: 100 },
    { id: "p1b", storeId: "s2", quantity: 999 }
  ];
  const idx = buildCostIndex([
    { productId: "p1", costPrice: 2000, effectiveFrom: new Date("2020-01-01T00:00:00Z") },
    { productId: "p1b", costPrice: 2000, effectiveFrom: new Date("2020-01-01T00:00:00Z") }
  ]);
  const one = stockValueAt(JAN_TO, { products, movements: [], costIndex: idx, storeId: "s1" });
  const all = stockValueAt(JAN_TO, { products, movements: [], costIndex: idx, storeId: "all" });
  check("a branch report values only that branch", near(one.value, 200000), `got ${one.value}`);
  check("...and all stores values the lot", near(all.value, 2198000), `got ${all.value}`);

  // A movement landing exactly on the boundary belongs to the position being
  // measured, not to what happened after it.
  const onBoundary = stockValueAt(JAN_TO, {
    products: [{ id: "p1", storeId: "s1", quantity: 100 }],
    movements: [{ productId: "p1", storeId: "s1", delta: 50, createdAt: new Date(JAN_TO) }],
    costIndex, storeId: "s1"
  });
  check("a movement exactly on the To date is inside the period",
    near(onBoundary.value, 200000), `got ${onBoundary.value}`);
}

console.log("\n=== a partial figure is shown, and never shown bare ===");
{
  // Found on live data 2026-09-23: opening stock printed 0.00 not because the
  // shelves were empty but because no cost was in force that early, and nothing
  // on the number itself said so. The decision was to keep showing the figure
  // -- cost data is patchy, and a report that refuses to state anything until
  // every product is priced would show nothing most months -- but to carry the
  // qualification on the amount, so a figure lifted into a P&L cannot arrive
  // without it.
  const render = src.slice(src.indexOf("async function generateCogsReport("));
  const body = render.slice(0, render.indexOf("\n}\n"));

  check("the qualifier is attached to the amount cell",
    /\$\{strong \? `<strong>\$\{esc\(amount\)\}<\/strong>` : esc\(amount\)\}\$\{mark\}/.test(body),
    "a caveat only in the note below is lost the moment the number is copied out");
  check("opening stock carries its own count of unpriced products",
    /rowOpening[\s\S]{0,80}openingMark/.test(body));
  check("closing stock carries its own",
    /rowClosing[\s\S]{0,80}closingMark/.test(body));
  check("COGS inherits the doubt from both ends",
    /derivedMark = incomplete\(Math\.max\(result\.uncostedAtOpening, result\.uncostedAtClosing\)\)/.test(body),
    "it is the difference between the two, so it is only as sound as the weaker one");
  check("a fully priced period carries no qualifier at all",
    /const incomplete = \(count\) => count[\s\S]{0,40}\?/.test(body),
    "the mark must be absent, not an empty badge, when nothing was left out");
  check("the discounts line says it is not captured rather than implying a real zero",
    /discountsAreCaptured \? "" :/.test(body));
  for (const key of ["cogs.incompleteMark", "cogs.notCaptured"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length === 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
