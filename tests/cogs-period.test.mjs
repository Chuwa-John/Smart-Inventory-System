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
   ${extract("costInForceAtOrEarliest")}
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
    /derivedMark = incomplete\([\s\S]{0,140}Math\.max\(result\.uncostedAtOpening, result\.uncostedAtClosing\)/.test(body),
    "it is the difference between the two, so it is only as sound as the weaker one");
  check("a fully priced period carries no qualifier at all",
    /const incomplete = \(count, which\) => count[\s\S]{0,40}\?/.test(body),
    "the mark must be absent, not an empty badge, when nothing was left out");
  check("the discounts line says it is not captured rather than implying a real zero",
    /discountsAreCaptured \? "" :/.test(body));
  for (const key of ["cogs.incompleteMark", "cogs.notCaptured"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length === 2);
  }
}

console.log("\n=== an impossible figure is withheld, not badged ===");
{
  const render = src.slice(src.indexOf("async function generateCogsReport("));
  const body = render.slice(0, render.indexOf("\n}\n"));

  // Seen on live data 2026-09-23 at minus 13,010,450, after backfilling costs
  // priced the closing stock and left the opening at zero. Not an edge case:
  // effectiveFrom is always stamped now, so ANY period beginning before a cost
  // was recorded values one end and not the other.
  check("negative AND incomplete is what withholds it",
    /const cogsUnstatable = result\.cogs < 0 && !result\.complete;/.test(body),
    "incomplete means understated; negative means impossible, and only the second is unusable");
  // — is the em dash ITSELF in a regex literal, not the four characters
  // "—". app.js writes the character directly, as the stock-at-cost and
  // margin placeholders next to it do.
  check("the figure is replaced by a dash rather than printed",
    /cogsUnstatable \? "—" : money\(result\.cogs\)/.test(body),
    "a badge saying incomplete on a number that means impossible tells the reader the wrong thing");
  check("...and the cell says it cannot be stated",
    /cogs\.cogsUnstatable/.test(body));
  check("the explanation leads the caveats",
    body.indexOf("warnNegativeIncomplete") < body.indexOf("warnLedgerShort"),
    "why a figure is MISSING comes before why the others are approximate");

  // A negative with everything priced is a real event, not a broken sum: stock
  // rose by more than was bought. The owner should see the figure that reveals
  // it.
  check("negative WITH everything priced is still shown",
    /else if \(result\.cogs < 0\) warnings\.push\(t\("cogs\.warnNegativeComplete"\)\)/.test(body),
    "an upward stock adjustment with no matching purchase is worth surfacing, not hiding");
  for (const key of ["cogs.cogsUnstatable", "cogs.warnNegativeIncomplete", "cogs.warnNegativeComplete"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length === 2);
  }
}

console.log("\n=== the engine still reports the raw figure either way ===");
{
  // The withholding is a PRESENTATION decision. The engine keeps returning the
  // arithmetic, so the rule can be changed in one place without the number
  // going missing from the model as well.
  const products = [{ id: "p1", name: "Priced", storeId: "s1", quantity: 1000 }];
  const idx = buildCostIndex([
    { productId: "p1", costPrice: 5000, effectiveFrom: new Date("2020-01-01T00:00:00Z") }
  ]);
  const r = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements: [{ productId: "p1", storeId: "s1", delta: 1000, createdAt: new Date("2026-01-10T00:00:00Z") }],
    costIndex: idx, purchases: [], purchaseReturns: []
  });
  check("stock arriving with no purchase drives COGS negative", r.cogs < 0,
    `got ${r.cogs}`);
  check("...and the engine reports it rather than clamping to zero",
    typeof r.cogs === "number" && Number.isFinite(r.cogs),
    "clamping in the engine would hide the anomaly from every caller, not just this screen");
}

console.log("\n=== the badge names the products, it does not just count them ===");
{
  // A count tells an owner there is a problem. The names tell them what to do
  // about it -- and without this they would reconstruct the list by hand,
  // across Inventory and the cost history, to find which products to price.
  const products = [
    { id: "p1", name: "Nivea massage oil", storeId: "s1", quantity: 391 },
    { id: "p2", name: "Hair Oil 200ml", storeId: "s1", quantity: 3 },
    { id: "p3", name: "Nail Polish", storeId: "s1", quantity: 300 }
  ];
  const idx = buildCostIndex([
    { productId: "p3", costPrice: 16933, effectiveFrom: new Date("2020-01-01T00:00:00Z") }
  ]);
  const r = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements: [], costIndex: idx, purchases: [], purchaseReturns: []
  });

  check("the unpriced products are returned by name",
    r.uncostedClosingList.map((row) => row.name).sort().join("|")
      === "Hair Oil 200ml|Nivea massage oil",
    JSON.stringify(r.uncostedClosingList));
  check("...with the stock being carried for each",
    r.uncostedClosingList.every((row) => typeof row.quantity === "number"),
    "an owner deciding what to price first needs to know how much is sitting there");
  check("the count still agrees with the list",
    r.uncostedAtClosing === r.uncostedClosingList.length);
  check("a priced product is not in the list",
    !r.uncostedClosingList.some((row) => row.name === "Nail Polish"));

  // A product with no stock at that date is not a problem to solve: it needs no
  // cost because it contributes nothing to the value either way.
  const noStock = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products: [{ id: "p9", name: "Discontinued", storeId: "s1", quantity: 0 }],
    movements: [], costIndex: idx, purchases: [], purchaseReturns: []
  });
  check("a product holding no stock is not reported as unpriced",
    noStock.uncostedAtClosing === 0,
    "it would be a chore with no effect on the figure");
}

console.log("\n=== the badge is a control, not a label ===");
{
  const render = src.slice(src.indexOf("async function generateCogsReport("));
  const body = render.slice(0, render.indexOf("\n}\n"));
  check("the mark is rendered as a button",
    /<button type="button" class="link-button" data-cogs-unpriced="\$\{which\}">/.test(body),
    "a span cannot be reached by keyboard and says nothing to a screen reader");
  check("the held list is rebuilt on every generate",
    /state\.cogsUnpriced = \{/.test(body),
    "a list left over from a previous period would name the wrong products");
  check("...and any open list is cleared with it",
    /unpricedHost\.hidden = true;/.test(body));

  const listFn = src.slice(src.indexOf("function renderCogsUnpricedList("));
  const listBody = listFn.slice(0, listFn.indexOf("\n}\n"));
  check("an empty list hides the box rather than showing an empty table",
    /if \(!rows\.length\)[\s\S]{0,80}host\.hidden = true;/.test(listBody));
  check("product names are escaped",
    /esc\(row\.name\)/.test(listBody),
    "a product name is user text and this builds HTML");
  check("the heading says which date the list belongs to",
    /which === "opening" \? held\.fromLabel : held\.toLabel/.test(listBody),
    "opening and closing can differ, and an undated list belongs to neither");

  check("the handler is delegated from the table",
    /data-cogs-unpriced\]"\)/.test(src),
    "the badges are rebuilt on every generate; per-badge listeners would leak");
  for (const key of ["cogs.unpricedAtOpening", "cogs.unpricedColProduct", "cogs.unpricedHint"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length === 2);
  }
}

console.log("=== an issued invoice is inside the periodic figure and named ===");
{
  // issueInvoice() writes no sale for a fresh invoice, so invoiced goods land
  // in periodic COGS (the shelf is short by them) and never in the perpetual
  // figure. The gap between the two is documented as shrinkage; without this
  // it silently is not.
  const products = [{ id: "p1", storeId: "s1", quantity: 100 }];
  const movements = [
    { productId: "p1", storeId: "s1", delta: -20, createdAt: new Date("2026-01-10T00:00:00Z") }
  ];
  const base = {
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements, costIndex, purchases: [], purchaseReturns: []
  };

  const none = computePeriodCogs(base);
  check("no invoices reports nothing to explain", none.invoicedCount === 0 && none.invoicedCost === 0);

  const issued = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "issued", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("an issued invoice is counted", issued.invoicedCount === 1);
  check("...and priced at the cost in force when it was issued",
    near(issued.invoicedCost, 40000), `got ${issued.invoicedCost}`);
  check("...and the COGS total is unchanged by naming it",
    near(issued.cogs, none.cogs), `${issued.cogs} vs ${none.cogs}`);

  const draft = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "draft", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("a draft moved nothing, so it is not counted", draft.invoicedCount === 0);

  const voided = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "void", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("a void put the stock back, so it is not counted", voided.invoicedCount === 0);

  const fromSale = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "issued", saleId: "sale-1",
      createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("an invoice raised against a sale is in BOTH figures, so not part of the gap",
    fromSale.invoicedCount === 0);

  const otherMonth = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "issued", createdAt: new Date("2026-02-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("an invoice outside the window is not counted", otherMonth.invoicedCount === 0);

  const otherStore = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s2", status: "issued", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "p1", quantity: 20 }]
    }]
  });
  check("another branch's invoice is not counted when scoped", otherStore.invoicedCount === 0);

  const unpriced = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "issued", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ productId: "ghost", quantity: 20 }]
    }]
  });
  check("a line with no cost in force is reported, not valued at zero",
    unpriced.invoicedUncosted === 1 && unpriced.invoicedCost === 0);

  const nonStock = computePeriodCogs({
    ...base,
    invoices: [{
      storeId: "s1", status: "issued", createdAt: new Date("2026-01-10T00:00:00Z"),
      lines: [{ description: "Labour", quantity: 1 }]
    }]
  });
  check("a free-text line moved no stock, so it adds no cost",
    nonStock.invoicedCost === 0 && nonStock.invoicedUncosted === 0);
}

console.log("=== the caveat stops claiming the gap is only loss ===");
{
  for (const key of ["cogs.warnInvoiced", "cogs.warnInvoicedUncosted"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\.")}":`, "g")) || []).length === 2);
  }
  check("the shrinkage warning no longer stands alone as the whole story",
    /dashboard margin/.test(src.match(/"cogs\.warnShrinkage": "([^"]*)"/)?.[1] || ""));
  check("the invoiced warning is pushed before the shrinkage one",
    src.indexOf('t("cogs.warnInvoiced"') < src.indexOf('warnings.push(t("cogs.warnShrinkage"))'));
  check("the report passes invoices to the engine",
    /invoices: state\.invoices/.test(src));
}

console.log("=== a period before the shop recorded any prices is still statable ===");
{
  // The live complaint, 2026-10-07: cost of goods sold for earlier months
  // could not be seen at all. effectiveFrom is always stamped now and costs
  // cannot be backdated, so a period starting before the first recorded price
  // valued the closing stock and not the opening, the subtraction went
  // negative, and the figure was withheld. Correct, and permanently unhelpful.
  const lateCost = buildCostIndex([
    { productId: "p1", costPrice: 2000, effectiveFrom: new Date("2026-02-10T00:00:00Z") }
  ]);
  const products = [{ id: "p1", storeId: "s1", quantity: 100 }];
  const movements = [
    { productId: "p1", storeId: "s1", delta: -20, createdAt: new Date("2026-01-20T00:00:00Z") }
  ];

  const jan = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products, movements, costIndex: lateCost, purchases: [], purchaseReturns: []
  });

  // January is entirely before the price existed. Both ends now value on the
  // earliest price ever recorded, so the period reconciles instead of refusing.
  check("the opening stock is valued", jan.openingStock > 0, `got ${jan.openingStock}`);
  check("...at the earliest price ever recorded",
    near(jan.openingStock, 120 * 2000), `got ${jan.openingStock}`);
  check("the closing stock is valued too", near(jan.closingStock, 100 * 2000), `got ${jan.closingStock}`);
  check("and COGS comes out of the subtraction, not withheld",
    near(jan.cogs, 40000), `got ${jan.cogs}`);
  check("nothing is reported as unpriced", jan.uncostedAtOpening === 0 && jan.uncostedAtClosing === 0);

  // The whole point: the reader is told what it rests on.
  check("the assumption is counted at both ends",
    jan.assumedAtOpening === 1 && jan.assumedAtClosing === 1);
  check("...and the products are named",
    jan.assumedOpeningList.length === 1 && jan.assumedOpeningList[0].name === "p1");
  check("an assumed period is NOT reported complete", jan.complete === false,
    "complete drives the negative guard; a guessed opening must not satisfy it");

  // February STRADDLES the price: it opens on the 1st, the price lands on the
  // 10th, so the opening is assumed and the closing is not. Worth asserting --
  // it is the ordinary case for the month a shop starts recording costs.
  const feb = computePeriodCogs({
    fromMs: FEB_FROM, toMs: FEB_TO, storeId: "s1",
    products, movements, costIndex: lateCost, purchases: [], purchaseReturns: []
  });
  check("a period straddling the first price assumes at the opening only",
    feb.assumedAtOpening === 1 && feb.assumedAtClosing === 0);

  // March is wholly after it and assumes nothing.
  const mar = computePeriodCogs({
    fromMs: ms("2026-03-01T00:00:00Z"), toMs: ms("2026-03-31T23:59:59Z"), storeId: "s1",
    products, movements, costIndex: lateCost, purchases: [], purchaseReturns: []
  });
  check("a period wholly after the price assumes nothing",
    mar.assumedAtOpening === 0 && mar.assumedAtClosing === 0);
  check("...and is reported complete", mar.complete === true);

  // A product with no price ANYWHERE is still unknown, not guessed at zero.
  const noneAtAll = computePeriodCogs({
    fromMs: JAN_FROM, toMs: JAN_TO, storeId: "s1",
    products: [{ id: "ghost", storeId: "s1", quantity: 5 }],
    movements: [], costIndex: lateCost, purchases: [], purchaseReturns: []
  });
  check("a product with no recorded price at all stays unpriced",
    noneAtAll.uncostedAtClosing === 1 && noneAtAll.assumedAtClosing === 0,
    "an absent price is unknown, and unknown is not zero");
}

console.log("=== the fallback never reaches a sale ===");
{
  // Valuing a SHELF may assume; pricing a SALE may not. Doing so would rewrite
  // a margin already reported, using a price discovered afterwards.
  // The BODY of each one, not a window of source around its name -- the
  // fallback's own comment explains why a sale must not use it, and a loose
  // window matches that explanation and reports the opposite of the truth.
  //
  // Every function that prices goods ALREADY SOLD is listed. Adding a fourth
  // and forgetting it here is the failure this guards: it would quietly start
  // restating past margins using prices discovered afterwards.
  for (const name of ["summariseCostOfGoods", "summariseProductProfit", "computePeriodCogs"]) {
    const body = extract(name);
    check(`${name} was found`, body.length > 0);
    check(`${name} prices sold goods with the honest lookup`,
      /costInForceAt\(/.test(body), "the perpetual figures must keep their null");
    check(`${name} never falls back to a later price`,
      !/costInForceAtOrEarliest/.test(body));
  }

  // And the one that may.
  check("stockValueAt is the only caller that falls back",
    /costInForceAtOrEarliest/.test(extract("stockValueAt")));
  check("only the valuation path falls back",
    (src.match(/costInForceAtOrEarliest\(/g) || []).length === 2,
    "one definition, one caller -- stockValueAt");
  check("the warning exists in both languages",
    (src.match(/"cogs\.warnAssumed":/g) || []).length === 2);
}

console.log("=== an oversell still costs the period ===");
{
  // stockValueAt lets negative stock carry negative value. summariseStockValuation()
  // clamps it at zero. That is two questions, not a bug: "what did the goods
  // that left cost" against "what is this shelf worth". Pinned so neither gets
  // quietly changed to match the other.
  const r = stockValueAt(ms("2026-01-31T23:59:59Z"), {
    products: [{ id: "p1", storeId: "s1", quantity: -5 }],
    movements: [],
    costIndex,
    storeId: "s1"
  });
  check("negative stock carries negative value in the COGS engine",
    near(r.value, -5 * 2000), `got ${r.value}`);
  check("...and the row agrees with the total",
    r.rows.length === 1 && near(r.rows[0].value, r.value));
  check("...and it is not reported as unpriced", r.uncostedProducts === 0);
}

console.log("=== every line of the statement opens ===");
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

  for (const which of ["opening", "purchases", "carriage", "closing"]) {
    check(`the ${which} line is openable`, new RegExp(`"${which}"\\]`).test(src) || src.includes(`"${which}"`));
    check(`...and has a heading`, new RegExp(`"cogs\\.drillTitle\\.${which}":`).test(src));
  }

  // The sums are NOT openable: net purchases, goods available and COGS are
  // totals of lines already openable, so a control on them would promise
  // something new and show the same rows again.
  check("net purchases is not openable", /rowNetPurchases"\), money\(result\.netPurchases\), true, ""\]/.test(src));
  check("goods available is not openable", /rowAvailable"\), money\(result\.goodsAvailable\), true, openingMark\]/.test(src));

  check("there is somewhere to render it", /id="cogsDrill"/.test(html));
  check("the handler is delegated from the table", /#cogsTable"\)\?\.addEventListener\("click"/.test(src));
  check("clicking the open line closes it", /state\.cogsDrill === which \? null : which/.test(src));

  // Opening a line must not regenerate: generating refetches the whole stock
  // ledger, and the question is about a report already on screen.
  const handler = src.slice(src.indexOf('#cogsTable")?.addEventListener'));
  check("opening a line redraws the drawer, not the report",
    /renderCogsDrill\(\)/.test(handler.slice(0, 700))
      && !/generateCogsReport\(\)/.test(handler.slice(0, 700)));

  // Same contract as the profit drawer.
  check("the rows are added up independently",
    /rows\.reduce\(\(sum, row\) => sum \+ safeNumber\(row\.amount\), 0\)/.test(src));
  check("...and compared with the line they explain",
    (src.match(/Math\.abs\(listed - safeNumber\(expected\)\) < 0\.5/g) || []).length >= 2);
  check("a failed breakdown cannot show the previous one",
    /\[cogsDrill\]/.test(src));

  // Purchases and carriage are split from ONE set of delivery lines, so the
  // two rows cannot drift from each other or from the statement.
  check("purchases and carriage come from the same lines",
    /goodsSide \? line\.goods : line\.carriage/.test(src));
  check("the engine carries those lines", /purchaseLines: purchaseLines/.test(src));
  check("...and the stock rows behind both ends",
    /openingRows: opening\.rows/.test(src) && /closingRows: closing\.rows/.test(src));

  // An assumed price is marked in the list, not just counted in the caveat.
  check("an assumed price is flagged on its row",
    /row\.assumed \? t\("cogs\.drillAssumed"\)/.test(src));

  for (const key of ["cogs.drillColOnHand", "cogs.drillColSupplier", "cogs.drillOnHand",
                     "cogs.drillAssumed", "cogs.drillNoSupplier"]) {
    check(`${key} is in both languages`,
      (src.match(new RegExp('"' + key.replace(/\./g, "\\.") + '":', "g")) || []).length === 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
