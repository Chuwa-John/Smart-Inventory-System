// Phase 1 of DESIGN-landed-costs.md: the allocation arithmetic.
//
//   node landed-costs.test.mjs
//
// Evaluated out of app.js rather than reimplemented here -- the purchases.test.mjs
// convention. A reimplementation only proves the copy agrees with itself.
//
// The suite is built around one invariant, because everything else in this
// feature is downstream of it:
//
//   sum(allocated landed costs) === additionalTotal, EXACTLY.
//
// If that fails, the delivery does not reconcile to the supplier's invoice, the
// weighted average it feeds is wrong, and COGS -- and therefore every margin the
// shop prices against -- is wrong with it. Section 4.2.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

// Walks the PARAMETER list to its closing paren before looking for the body.
// Both functions under test take a destructured object, so the one-liner that
// takes the first `{` after the name would hand new Function() the destructuring
// pattern as the whole function. Same reason purchases.test.mjs carries its own.
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("(", start);
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) break; }
  }
  i = src.indexOf("{", i);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function extractConst(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  const end = src.indexOf("];", start);
  if (end === -1) throw new Error(`${name} is not an array literal`);
  return src.slice(start, end + 2);
}

// The three numeric ceilings prepareDelivery() enforces live at app.js top
// level, so they are read out of the source too rather than restated here — a
// restated constant is one that can drift from the one that ships.
function constant(name) {
  const m = src.match(new RegExp("const " + name + " = (\\d+)"));
  if (!m) throw new Error(name + " not found in app.js");
  return m[1];
}

const { allocateLandedCosts, deliveryAdditionalTotal, DELIVERY_COST_TYPES, prepareDelivery } =
  new Function(`
    ${extract("safeNumber")}
    ${extractConst("DELIVERY_COST_TYPES")}
    const MAX_COUNT = ${constant("MAX_COUNT")};
    const MAX_MONEY = ${constant("MAX_MONEY")};
    const DELIVERY_MAX_LINES = ${constant("DELIVERY_MAX_LINES")};
    ${extract("deliveryAdditionalTotal")}
    ${extract("allocateLandedCosts")}
    ${extract("prepareDelivery")}
    return { allocateLandedCosts, deliveryAdditionalTotal, DELIVERY_COST_TYPES, prepareDelivery };
  `)();

let failures = 0;
let checks = 0;

function ok(condition, label) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${label}`);
}

function near(actual, expected, label, tolerance = 1e-9) {
  ok(Math.abs(actual - expected) <= tolerance,
    `${label} -- expected ${expected}, got ${actual}`);
}

function group(name, fn) {
  console.log(name);
  fn();
}

const sum = (list) => list.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------

group("deliveryAdditionalTotal -- the seven named cost types", () => {
  ok(DELIVERY_COST_TYPES.length === 7, "seven cost types, per section 3");
  for (const type of ["freight", "importDuty", "clearing", "transport",
                      "handling", "insurance", "otherCost"]) {
    ok(DELIVERY_COST_TYPES.includes(type), `${type} is a delivery cost type`);
  }

  // The docx section 5 example, exactly.
  near(deliveryAdditionalTotal({
    freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000
  }), 1800000, "docx section 5 additional costs total 1,800,000");

  near(deliveryAdditionalTotal({}), 0, "no additional costs is zero");
  near(deliveryAdditionalTotal(null), 0, "a missing cost object is zero");
  near(deliveryAdditionalTotal({ freight: "800000" }), 800000,
    "a numeric string is coerced, like every other money field");

  // A negative field must not subtract. Section 3's note: it would move money
  // quietly OUT of inventory.
  near(deliveryAdditionalTotal({ freight: 800000, clearing: -500000 }), 800000,
    "a negative cost is floored at zero rather than subtracting");
  near(deliveryAdditionalTotal({ freight: Number.NaN, clearing: 300000 }), 300000,
    "a non-finite cost is zero, not NaN");
  near(deliveryAdditionalTotal({ freight: 100, unknownCost: 999999 }), 100,
    "a field outside the closed set is ignored");
});

// ---------------------------------------------------------------------------

group("the docx section 6 allocation table, reproduced", () => {
  const lines = [
    { productName: "A", quantity: 500, goodsCost: 5000000 },
    { productName: "B", quantity: 200, goodsCost: 3000000 },
    { productName: "C", quantity: 100, goodsCost: 2000000 }
  ];
  const result = allocateLandedCosts({ lines, additionalTotal: 1800000, basis: "value" });

  ok(result.ok, "the docx delivery allocates");
  ok(result.basis === "value", "by product value, as asked");
  near(result.amounts[0], 900000, "A takes 900,000");
  near(result.amounts[1], 540000, "B takes 540,000");
  near(result.amounts[2], 360000, "C takes 360,000");

  const finalCost = lines.map((line, i) => line.goodsCost + result.amounts[i]);
  near(finalCost[0], 5900000, "A final inventory cost 5,900,000");
  near(finalCost[1], 3540000, "B final inventory cost 3,540,000");
  near(finalCost[2], 2360000, "C final inventory cost 2,360,000");
  near(sum(finalCost), 11800000, "TOTAL INVENTORY COST = 11,800,000");
});

group("the docx section 7 sale follows from it", () => {
  const lines = [
    { quantity: 500, goodsCost: 5000000 },
    { quantity: 200, goodsCost: 3000000 },
    { quantity: 100, goodsCost: 2000000 }
  ];
  const { amounts } = allocateLandedCosts({ lines, additionalTotal: 1800000, basis: "value" });

  // Section 3.1: unitCost is the LANDED unit cost, which is what flows into COGS.
  const unitCostA = (lines[0].goodsCost + amounts[0]) / lines[0].quantity;
  near(unitCostA, 11800, "Product A costs 11,800 a unit, not 10,000");

  const revenue = 100 * 15000;
  const cogs = 100 * unitCostA;
  near(revenue, 1500000, "sales revenue 1,500,000");
  near(cogs, 1180000, "COGS 1,180,000");
  near(revenue - cogs, 320000, "gross profit 320,000");
  near((500 - 100) * unitCostA, 4720000, "remaining inventory 4,720,000");

  // The number the docx is warning about: costing at the supplier price alone
  // overstates gross profit by the whole of the allocated freight.
  const naiveCogs = 100 * (lines[0].goodsCost / lines[0].quantity);
  near(revenue - naiveCogs, 500000, "ignoring landed cost would report 500,000");
  ok(revenue - naiveCogs > revenue - cogs,
    "ignoring landed cost overstates profit -- the dangerous direction");
});

// ---------------------------------------------------------------------------

group("the residual invariant -- section 4.2", () => {
  // Every one of these is chosen because it does NOT divide evenly. Dropping the
  // residual on any of them loses money against the invoice.
  const cases = [
    { label: "1,000,000 across three equal lines",
      lines: [{ quantity: 1, goodsCost: 100 }, { quantity: 1, goodsCost: 100 }, { quantity: 1, goodsCost: 100 }],
      additionalTotal: 1000000 },
    { label: "a prime total across prime weights",
      lines: [{ quantity: 7, goodsCost: 7 }, { quantity: 11, goodsCost: 11 }, { quantity: 13, goodsCost: 13 }],
      additionalTotal: 9973 },
    { label: "33,333 across 100 units -- the DESIGN-purchases section 3 shape",
      lines: [{ quantity: 100, goodsCost: 33333 }, { quantity: 1, goodsCost: 1 }],
      additionalTotal: 33333 },
    { label: "a fractional total",
      lines: [{ quantity: 3, goodsCost: 1 }, { quantity: 3, goodsCost: 2 }],
      additionalTotal: 0.07 },
    { label: "many lines",
      lines: Array.from({ length: 17 }, (_, i) => ({ quantity: i + 1, goodsCost: (i + 1) * 999 })),
      additionalTotal: 123457 },
    { label: "one enormous line and one tiny one",
      lines: [{ quantity: 1000000, goodsCost: 999999999 }, { quantity: 1, goodsCost: 1 }],
      additionalTotal: 7 }
  ];

  // EXACT equality, not near(). The first version of this used a 1e-9 tolerance
  // and a negative control that DELETED the residual correction passed against
  // it -- the measured drift on a realistic delivery is around 1.5e-11, which
  // sits comfortably inside any tolerance a reader would think generous. The
  // invariant says exactly; the assertion has to say exactly too.
  let sawDrift = false;
  for (const basis of ["value", "quantity"]) {
    for (const testCase of cases) {
      const result = allocateLandedCosts({ ...testCase, basis });
      ok(result.ok, `${basis}: ${testCase.label} allocates`);
      checks++;
      if (sum(result.amounts) !== testCase.additionalTotal) {
        failures++;
        console.error(`  FAIL  ${basis}: ${testCase.label} does not sum EXACTLY to ` +
          `${testCase.additionalTotal} -- got ${sum(result.amounts)}`);
      }
      ok(result.amounts.every((a) => a >= 0),
        `${basis}: ${testCase.label} allocates nothing negative`);

      // The uncorrected shares, to confirm at least one case in this table
      // genuinely needs the correction. A suite where the raw sum is always
      // exact would pass with the residual logic deleted and prove nothing.
      const weights = basis === "quantity"
        ? testCase.lines.map((l) => l.quantity)
        : testCase.lines.map((l) => l.goodsCost);
      const weightTotal = sum(weights);
      const raw = weights.map((w) => (w / weightTotal) * testCase.additionalTotal);
      if (sum(raw) !== testCase.additionalTotal) sawDrift = true;
    }
  }
  ok(sawDrift, "at least one case in this table drifts without the correction -- " +
    "otherwise the residual logic is untested by it");

  // The invariant restated the way the shop sees it: line totals add up to what
  // was actually paid.
  const lines = [{ quantity: 3, goodsCost: 1000 }, { quantity: 3, goodsCost: 1000 }, { quantity: 3, goodsCost: 1000 }];
  const { amounts } = allocateLandedCosts({ lines, additionalTotal: 1000000, basis: "value" });
  const totalPaid = lines.map((line, i) => line.goodsCost + amounts[i]);
  near(sum(totalPaid), 3000 + 1000000, "line totals sum to goodsCost + additionalTotal");
});

group("the residual lands on the largest line, deterministically", () => {
  // This fixture is chosen because its raw shares DO drift -- 17 lines over
  // 123,457 misses by about 1.5e-11. A fixture whose shares happen to sum
  // exactly cannot tell "residual on the largest line" apart from "residual on
  // the first line", or from no residual at all, and the first version of this
  // test used one that did.
  const lines = Array.from({ length: 17 }, (_, i) => ({
    productName: `p${i}`, quantity: i + 1, goodsCost: (i + 1) * 999
  }));
  const additionalTotal = 123457;
  const raw = lines.map((line) =>
    (line.goodsCost / sum(lines.map((l) => l.goodsCost))) * additionalTotal);
  ok(sum(raw) !== additionalTotal,
    "the fixture genuinely drifts without the correction, so this group tests something");

  const a = allocateLandedCosts({ lines, additionalTotal, basis: "value" });
  const b = allocateLandedCosts({ lines, additionalTotal, basis: "value" });
  ok(a.amounts.every((amount, i) => amount === b.amounts[i]),
    "the same delivery allocates identically twice -- an offline replay must agree with its own write");

  // The largest line is the last one here, so "largest" and "first" give
  // different answers -- which is the point.
  const corrections = a.amounts.map((amount, i) => amount - raw[i]);
  const moved = corrections.map((c, i) => [i, c]).filter(([, c]) => c !== 0);
  ok(moved.length === 1, `exactly one line is corrected -- got ${moved.length}`);
  ok(moved.length === 1 && moved[0][0] === 16,
    `the correction lands on the LARGEST line (index 16), not the first -- got index ${moved[0]?.[0]}`);

  // Reordering must not move the residual to a different PRODUCT. Exact
  // comparison: the difference is float-error sized, so any tolerance hides it.
  const reordered = [...lines].reverse();
  const c = allocateLandedCosts({ lines: reordered, additionalTotal, basis: "value" });
  const byName = new Map(reordered.map((line, i) => [line.productName, c.amounts[i]]));
  for (const [i, line] of lines.entries()) {
    checks++;
    if (byName.get(line.productName) !== a.amounts[i]) {
      failures++;
      console.error(`  FAIL  ${line.productName} allocates differently when the lines are ` +
        `typed in another order: ${a.amounts[i]} vs ${byName.get(line.productName)}`);
    }
  }

  // Ties break on the lowest index, so equal lines are still deterministic.
  const tied = [{ quantity: 1, goodsCost: 100 }, { quantity: 1, goodsCost: 100 }];
  const t1 = allocateLandedCosts({ lines: tied, additionalTotal: 3, basis: "value" });
  const t2 = allocateLandedCosts({ lines: tied, additionalTotal: 3, basis: "value" });
  ok(t1.amounts[0] === t2.amounts[0] && t1.amounts[1] === t2.amounts[1],
    "a tie between equal lines is broken the same way every time");
});

// ---------------------------------------------------------------------------

group("by quantity", () => {
  const lines = [
    { quantity: 500, goodsCost: 5000000 },
    { quantity: 200, goodsCost: 3000000 },
    { quantity: 100, goodsCost: 2000000 }
  ];
  const result = allocateLandedCosts({ lines, additionalTotal: 800000, basis: "quantity" });
  ok(result.ok && result.basis === "quantity", "allocates by quantity");
  near(result.amounts[0], 500000, "500 of 800 units takes 500,000");
  near(result.amounts[1], 200000, "200 of 800 units takes 200,000");
  near(result.amounts[2], 100000, "100 of 800 units takes 100,000");

  // Quantity and value give DIFFERENT answers here, which is the point of
  // offering both -- a test where they agree proves nothing.
  const byValue = allocateLandedCosts({ lines, additionalTotal: 800000, basis: "value" });
  ok(Math.abs(byValue.amounts[0] - result.amounts[0]) > 1,
    "the two bases genuinely disagree on this delivery");
});

group("manual is refused, never corrected -- section 4.3", () => {
  const lines = [{ quantity: 1, goodsCost: 100 }, { quantity: 1, goodsCost: 100 }];

  const balanced = allocateLandedCosts({
    lines, additionalTotal: 1000, basis: "manual", manualAmounts: [700, 300]
  });
  ok(balanced.ok && balanced.basis === "manual", "a manual split that balances is accepted");
  near(balanced.amounts[0], 700, "manual amounts are used verbatim");
  near(sum(balanced.amounts), 1000, "and still satisfy the invariant");

  const short = allocateLandedCosts({
    lines, additionalTotal: 1000, basis: "manual", manualAmounts: [700, 200]
  });
  ok(!short.ok, "a manual split that does not add up is REFUSED");
  ok(short.error === "manualMismatch", "and says why");
  near(short.difference, 100, "and names the shortfall");
  ok(sum(short.amounts) === 0, "a refused allocation returns nothing, not a guess");

  const over = allocateLandedCosts({
    lines, additionalTotal: 1000, basis: "manual", manualAmounts: [700, 400]
  });
  ok(!over.ok, "an over-allocation is refused too");
  near(over.difference, -100, "with a negative difference");

  const missing = allocateLandedCosts({
    lines, additionalTotal: 1000, basis: "manual", manualAmounts: [1000]
  });
  ok(!missing.ok, "a manual list shorter than the lines is refused");

  const negative = allocateLandedCosts({
    lines, additionalTotal: 1000, basis: "manual", manualAmounts: [1100, -100]
  });
  ok(!negative.ok && negative.error === "negativeAmount",
    "a negative manual amount is refused even though it sums correctly");
});

// ---------------------------------------------------------------------------

group("the edge cases -- section 4.3", () => {
  const lines = [{ quantity: 5, goodsCost: 500 }, { quantity: 3, goodsCost: 300 }];

  // Section 3.2: a delivery with no additional costs must be indistinguishable
  // from what the restock path writes today.
  const none = allocateLandedCosts({ lines, additionalTotal: 0, basis: "value" });
  ok(none.ok, "zero additional costs allocates");
  ok(none.amounts.every((a) => a === 0), "and gives every line exactly zero");

  const one = allocateLandedCosts({
    lines: [{ quantity: 10, goodsCost: 1234 }], additionalTotal: 567, basis: "value"
  });
  ok(one.ok, "a single line allocates");
  near(one.amounts[0], 567, "and takes the whole additional total");

  // Free samples with a freight bill. Cannot divide by a zero value -- falls
  // back to quantity, and REPORTS the basis it used.
  const free = allocateLandedCosts({
    lines: [{ quantity: 10, goodsCost: 0 }, { quantity: 30, goodsCost: 0 }],
    additionalTotal: 4000, basis: "value"
  });
  ok(free.ok, "a delivery of free goods with a freight bill still allocates");
  ok(free.basis === "quantity", "by falling back to quantity");
  ok(free.basis !== "value", "and NOT by claiming it used value");
  near(free.amounts[0], 1000, "10 of 40 units takes 1,000");
  near(free.amounts[1], 3000, "30 of 40 units takes 3,000");

  // A free line among priced ones gets nothing by value. Correct, and stated in
  // section 4.3 so it is not mistaken for a bug later.
  const mixed = allocateLandedCosts({
    lines: [{ quantity: 10, goodsCost: 1000 }, { quantity: 10, goodsCost: 0 }],
    additionalTotal: 500, basis: "value"
  });
  ok(mixed.ok && mixed.basis === "value", "a free line among priced ones allocates by value");
  near(mixed.amounts[0], 500, "the priced line carries it all");
  near(mixed.amounts[1], 0, "the free line carries none");

  // Nothing to divide by at all.
  const nothing = allocateLandedCosts({
    lines: [{ quantity: 0, goodsCost: 0 }], additionalTotal: 100, basis: "value"
  });
  ok(!nothing.ok && nothing.error === "noWeight",
    "a line with neither value nor quantity cannot absorb a cost");

  const empty = allocateLandedCosts({ lines: [], additionalTotal: 0, basis: "value" });
  ok(empty.ok, "no lines and no money is fine");
  const orphan = allocateLandedCosts({ lines: [], additionalTotal: 500, basis: "value" });
  ok(!orphan.ok && orphan.error === "noLines",
    "money with no lines to put it on is refused, not dropped");

  const negTotal = allocateLandedCosts({ lines, additionalTotal: -5, basis: "value" });
  ok(!negTotal.ok && negTotal.error === "negativeTotal", "a negative additional total is refused");

  const negLine = allocateLandedCosts({
    lines: [{ quantity: 5, goodsCost: -500 }, { quantity: 3, goodsCost: 300 }],
    additionalTotal: 100, basis: "value"
  });
  ok(!negLine.ok && negLine.error === "negativeLine",
    "a negative goods cost is refused -- a discount belongs in goodsCost, not here");

  const nonFinite = allocateLandedCosts({
    lines: [{ quantity: Number.NaN, goodsCost: 100 }, { quantity: 5, goodsCost: 100 }],
    additionalTotal: 100, basis: "quantity"
  });
  ok(nonFinite.ok, "a non-finite quantity is read as zero, not NaN");
  ok(nonFinite.amounts.every((a) => Number.isFinite(a)), "and no NaN reaches the allocation");
  near(sum(nonFinite.amounts), 100, "the invariant survives a non-finite input");

  const noArgs = allocateLandedCosts();
  ok(noArgs.ok, "called with nothing at all, it does not throw");
  const unknownBasis = allocateLandedCosts({ lines, additionalTotal: 80, basis: "weight" });
  ok(unknownBasis.ok && unknownBasis.basis === "value",
    "an unsupported basis -- weight, which section 2 excludes -- falls back to value");
});

// ---------------------------------------------------------------------------

group("where the arithmetic is wired in", () => {
  // Phase 1 asserted ZERO call sites, so that wiring it up would be a deliberate
  // act rather than a coupling discovered in production. Phase 3 is that act,
  // and this assertion moved with it rather than being deleted: the allocation
  // is called from exactly one place, and a second caller means two paths can
  // disagree about what a delivery cost.
  const callers = src.split("\n").filter((line) =>
    /allocateLandedCosts\(/.test(line) && !/^function allocateLandedCosts/.test(line.trim()));
  ok(callers.length === 1,
    `expected exactly one caller (prepareDelivery) -- found ${callers.length}: ${callers.join(" | ")}`);
  ok(callers.length === 1 && /allocation\s*=\s*allocateLandedCosts/.test(callers[0]),
    "the one caller is prepareDelivery()");

  // THE PROPERTY THIS SCREEN TURNS ON. The preview a shop reads before it
  // commits, and the document that is written when it does, both come from
  // prepareDelivery(). A preview computed a second way is a preview that can
  // disagree with what is saved -- and the number being previewed is the one the
  // shop reconciles against its supplier's invoice.
  const previewStart = src.indexOf("function renderDeliveryPreview");
  ok(previewStart !== -1, "renderDeliveryPreview() exists");
  const preview = src.slice(previewStart, src.indexOf("\nfunction renderDeliveryDialog"));
  ok(/prepareDelivery\(\{/.test(preview),
    "the preview is computed by prepareDelivery(), not by a second implementation");
  ok(!/allocateLandedCosts\(/.test(preview),
    "and it does not reach past prepareDelivery() to the allocation itself");

  // The sale path is STILL untouched, and this matters more now than it did in
  // phase 1, not less: landed cost reaches COGS through the weighted average and
  // the cost history, so the till never had to learn about any of it.
  //
  // ANCHORED ON A NAME THAT EXISTS. Phase 1 wrote this against
  // "async function completeSale", which is not what the sale path is called --
  // there is no such function; the sale transaction is an inline handler inside
  // bindEvents(), and awaitSaleTransaction() is the only stable name near it.
  // indexOf() returned -1, slice(-1, 19999) returned the last character of the
  // file, and the assertion passed against one character for two phases. A test
  // that cannot fail has not been shown to pass.
  const anchor = src.indexOf("await awaitSaleTransaction(attempt)");
  ok(anchor !== -1, "the sale transaction's completion point was found");
  const salePath = src.slice(Math.max(0, anchor - 12000), anchor + 4000);
  ok(salePath.length > 12000, "the sale path window is a real window, not a stub");
  ok(!/allocateLandedCosts|deliveryAdditionalTotal|prepareDelivery|receiveDelivery|deleteDelivery/
      .test(salePath),
    "the sale path does not reference the delivery arithmetic at all");

  // The screen is phase 4's. Until then these have no callers, and saying so
  // here means wiring them up is deliberate rather than discovered.
  // Prose is not a caller. prepareDelivery()'s own comment names
  // receiveDelivery(), and the first version of this counted it as a call site.
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const callsTo = (name) => noComments.split("\n")
    .filter((l) => new RegExp(`(?<!function )\\b${name}\\(`).test(l)).length;
  // WIRED IN PHASE 4, deliberately. Phase 3 asserted zero callers for the two
  // write functions so that connecting a screen to them would be an act rather
  // than a discovery. This is that act, and the counts moved with it.
  //
  // Each write function is still called exactly ONCE. Two call sites for
  // receiveDelivery() would mean two places that can record a delivery, and the
  // second is always the one that forgets a field.
  ok(callsTo("receiveDelivery") === 1,
    `receiveDelivery() should have one caller (submitDelivery) -- found ${callsTo("receiveDelivery")}`);
  ok(callsTo("deleteDelivery") === 1,
    `deleteDelivery() should have one caller (confirmDeleteDelivery) -- found ${callsTo("deleteDelivery")}`);
  // prepareDelivery() has three, all of them the same function on the same
  // input: receiveDelivery() re-validates before writing, the preview recomputes
  // on every keystroke, and submitDelivery() reads the header back for the toast.
  ok(callsTo("prepareDelivery") === 3,
    `prepareDelivery() should have three callers -- found ${callsTo("prepareDelivery")}`);
});

// ---------------------------------------------------------------------------


// ===========================================================================
// Phase 3: prepareDelivery() -- everything decided before a transaction opens.

const line = (over = {}) => ({ productId: "p1", productName: "Lotion", quantity: 10, goodsCost: 1000, ...over });

group("prepareDelivery -- the docx delivery, end to end", () => {
  const r = prepareDelivery({
    lines: [
      { productId: "a", productName: "Product A", quantity: 500, goodsCost: 5000000 },
      { productId: "b", productName: "Product B", quantity: 200, goodsCost: 3000000 },
      { productId: "c", productName: "Product C", quantity: 100, goodsCost: 2000000 }
    ],
    costs: { freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000 },
    basis: "value"
  });

  ok(r.ok, `the docx delivery prepares -- got error "${r.error}"`);
  near(r.header.goodsCost, 10000000, "header goods cost");
  near(r.header.additionalTotal, 1800000, "header additional total");
  near(r.header.totalCost, 11800000, "TOTAL INVENTORY COST = 11,800,000");
  ok(r.header.lineCount === 3, "three lines");
  ok(r.header.allocationBasis === "value", "basis recorded as value");

  // The seven cost types are written explicitly, zeros included -- validDelivery()
  // requires all seven so its self-consistency check is one expression.
  for (const type of DELIVERY_COST_TYPES) {
    ok(Object.prototype.hasOwnProperty.call(r.header, type), `header carries ${type}`);
  }
  near(r.header.handling, 0, "an unused cost type is an explicit zero, not absent");

  near(r.lines[0].landedCost, 900000, "A allocated 900,000");
  near(r.lines[0].totalPaid, 5900000, "A totalPaid is the LANDED total");
  near(r.lines[0].unitCost, 11800, "A unit cost is 11,800, not 10,000");
  near(r.lines[1].totalPaid, 3540000, "B totalPaid");
  near(r.lines[2].totalPaid, 2360000, "C totalPaid");

  // The invariant the rules will check, asserted before the rules ever see it.
  near(r.lines.reduce((s, l) => s + l.totalPaid, 0), r.header.totalCost,
    "line totals sum to the header total");
  near(r.lines.reduce((s, l) => s + l.landedCost, 0), r.header.additionalTotal,
    "allocated landed costs sum to the additional total");
  for (const l of r.lines) {
    near(l.goodsCost + l.landedCost, l.totalPaid, "goodsCost + landedCost == totalPaid");
    near(l.unitCost * l.quantity, l.totalPaid, "unitCost x quantity == totalPaid");
  }
});

group("prepareDelivery -- a delivery with no additional costs", () => {
  const r = prepareDelivery({ lines: [line({ quantity: 200, goodsCost: 400000 })], costs: {}, basis: "value" });
  ok(r.ok, "prepares");
  near(r.header.additionalTotal, 0, "nothing additional");
  near(r.lines[0].landedCost, 0, "nothing allocated");
  near(r.lines[0].totalPaid, 400000, "totalPaid is the goods cost");
  near(r.lines[0].unitCost, 2000, "and the unit cost is what phase B would have written");
});

group("prepareDelivery -- the refusals", () => {
  const two = [line({ productId: "p1" }), line({ productId: "p2" })];

  ok(!prepareDelivery({ lines: [], costs: {} }).ok, "no lines is refused");
  ok(prepareDelivery({ lines: [], costs: {} }).error === "noLines", "and says why");
  ok(!prepareDelivery({}).ok, "called with nothing is refused, not thrown");

  // The trap this exists for: two lines for the same product each read the same
  // shelf, and the second write lands on top of the first -- so one delivery is
  // silently lost inside a transaction that reports success.
  const dupe = prepareDelivery({ lines: [line({ productId: "p1" }), line({ productId: "p1" })], costs: {} });
  ok(!dupe.ok && dupe.error === "duplicateProduct", "the same product twice is refused");
  ok(dupe.errorIndex === 1, "and the second line is named");

  const noId = prepareDelivery({ lines: [line({ productId: "" })], costs: {} });
  ok(!noId.ok && noId.error === "missingProduct", "a line with no product is refused");

  for (const [label, quantity] of [["zero", 0], ["negative", -5], ["fractional", 2.5], ["huge", 1000001]]) {
    const r = prepareDelivery({ lines: [line({ quantity })], costs: {} });
    ok(!r.ok && r.error === "badQuantity", `a ${label} quantity is refused`);
  }
  const negCost = prepareDelivery({ lines: [line({ goodsCost: -1 })], costs: {} });
  ok(!negCost.ok && negCost.error === "badGoodsCost", "a negative goods cost is refused");

  const tooMany = prepareDelivery({
    lines: Array.from({ length: 81 }, (_, i) => line({ productId: `p${i}` })), costs: {}
  });
  ok(!tooMany.ok && tooMany.error === "tooManyLines", "81 lines is refused");
  const atCap = prepareDelivery({
    lines: Array.from({ length: 80 }, (_, i) => line({ productId: `p${i}` })), costs: {}
  });
  ok(atCap.ok, "80 lines -- the cap -- is accepted");

  // Section 11.4. A free line among priced ones allocates to zero by value,
  // correctly, and then has nothing at all to record. firestore.rules has
  // refused totalPaid <= 0 since phase B, so without this check the whole
  // delivery fails inside the transaction after the shop typed it in.
  const free = prepareDelivery({
    lines: [line({ productId: "p1", goodsCost: 1000 }), line({ productId: "p2", goodsCost: 0 })],
    costs: { freight: 500 }, basis: "value"
  });
  ok(!free.ok && free.error === "lineCostsNothing",
    "a line that would cost nothing is refused before the transaction opens");
  ok(free.errorIndex === 1, "and the offending line is named");

  // ...but the same free line IS receivable when the cost is spread by quantity,
  // because then it carries a share. The refusal is about the outcome, not about
  // free goods being forbidden.
  const freeByQty = prepareDelivery({
    lines: [line({ productId: "p1", goodsCost: 1000 }), line({ productId: "p2", goodsCost: 0 })],
    costs: { freight: 500 }, basis: "quantity"
  });
  ok(freeByQty.ok, "the same delivery allocated by quantity is accepted");
  ok(freeByQty.lines[1].totalPaid > 0, "the free line now carries a real cost");

  const nothing = prepareDelivery({ lines: [line({ goodsCost: 0 })], costs: {} });
  ok(!nothing.ok, "a delivery that cost nothing at all is refused");

  const manualShort = prepareDelivery({
    lines: two, costs: { freight: 1000 }, basis: "manual", manualAmounts: [600, 300]
  });
  ok(!manualShort.ok && manualShort.error === "manualMismatch",
    "a manual allocation that does not add up is refused by prepareDelivery too");
  near(manualShort.difference, 100, "and the shortfall survives to the caller");
});

group("prepareDelivery -- the basis it reports is the basis it used", () => {
  const r = prepareDelivery({
    lines: [line({ productId: "p1", quantity: 10, goodsCost: 0 }),
            line({ productId: "p2", quantity: 30, goodsCost: 0 })],
    costs: { freight: 4000 }, basis: "value"
  });
  ok(r.ok, "free goods with a freight bill prepare");
  ok(r.header.allocationBasis === "quantity",
    "the header records the fallback, not the request");
  near(r.lines[0].totalPaid, 1000, "10 of 40 units");
  near(r.lines[1].totalPaid, 3000, "30 of 40 units");
});

group("the write path is shaped the way the rules expect", () => {
  // Source-level, because a runTransaction cannot be evaluated out of app.js.
  // These are the assertions that would have caught the four defects the
  // offline-selling work hit: a field written at one call site and not another.
  const start = src.indexOf("async function receiveDelivery");
  ok(start !== -1, "receiveDelivery() exists");
  const body = src.slice(start, src.indexOf("\nasync function awaitDeliveryTransaction"));

  for (const collectionName of ["productCostHistory", "productCosts", "purchases", "deliveries", "auditLogs"]) {
    ok(body.includes(`"${collectionName}"`), `it writes ${collectionName}`);
  }
  ok(/recordStockMovement\(/.test(body),
    "it records a stock movement -- without one the stock ledger cannot reconcile");
  ok(/movementReason: "restock"/.test(body),
    "it reuses the existing movement reason rather than widening the closed list");

  // The landed split must reach the PURCHASE LINE, or the drill-down has nothing
  // to separate and the rules refuse the document.
  //
  // Scoped to the purchase write, not to the whole function. The first version
  // of the totalPaid assertion below searched the entire body and matched
  // `totalPaid: line.totalPaid` inside the nextUnitCost({...}) call instead --
  // so a negative control that made the purchase record the GOODS cost passed
  // against it. Two writes in this function take a field of that name; an
  // assertion about one of them has to say which.
  const purchaseStart = body.indexOf(`"purchases"`);
  ok(purchaseStart !== -1, "the purchase write was found");
  const purchaseWrite = body.slice(purchaseStart, body.indexOf("transaction.update(", purchaseStart));
  ok(purchaseWrite.length > 200 && purchaseWrite.length < 2500,
    `the purchase write window is the write and not the function -- ${purchaseWrite.length} chars`);

  for (const field of ["goodsCost:", "landedCost:", "deliveryId:", "totalPaid:", "unitCost:"]) {
    ok(purchaseWrite.includes(field), `the purchase line carries ${field.replace(":", "")}`);
  }
  ok(/totalPaid: line\.totalPaid/.test(purchaseWrite),
    "the purchase line's totalPaid is the LANDED total, not a recomputed goods cost");
  ok(/unitCost: line\.unitCost/.test(purchaseWrite),
    "and its unitCost is the landed unit cost prepareDelivery() derived");
  ok(!/totalPaid: line\.goodsCost/.test(purchaseWrite),
    "the goods cost is never written as the total paid");

  // All reads before any write, and issued concurrently. Sequentially an
  // eighty-line delivery is 160 round trips before the first write.
  ok(/Promise\.all\(refs\.map\(\(r\) => transaction\.get\(r\.product\)\)\)/.test(body),
    "product reads are issued concurrently");
  ok(/Promise\.all\(refs\.map\(\(r\) => transaction\.get\(r\.cost\)\)\)/.test(body),
    "cost reads are issued concurrently");
  ok(body.indexOf("transaction.get") < body.indexOf("transaction.set"),
    "every read comes before the first write");

  // The weighted average is recomputed from the shelf INSIDE the transaction,
  // not from the copy the screen opened with.
  ok(/nextUnitCost\(\{/.test(body) && /oldQuantity: currentQuantity/.test(body),
    "the average is recomputed from the quantity read in the transaction");
  ok(/costKnownFrom: existingCost\?\.costKnownFrom \|\| Timestamp\.now\(\)/.test(body),
    "costKnownFrom is carried forward, never restamped");

  // One audit entry, not one per line -- a sixth per-line write would break the
  // DELIVERY_MAX_LINES arithmetic.
  ok((body.match(/moneyAuditEntry\(/g) || []).length === 1,
    "exactly one audit entry per delivery");
  ok(/DELIVERY_RECEIVED/.test(body), "and it is DELIVERY_RECEIVED");
});

group("the line cap is arithmetic, and app.js and the rules agree on it", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const inRules = Number(rules.match(/d\.lineCount <= (\d+)/)?.[1]);
  const inApp = Number(src.match(/const DELIVERY_MAX_LINES = (\d+)/)?.[1]);
  ok(Number.isFinite(inRules) && Number.isFinite(inApp), "both caps found");
  ok(inRules === inApp, `the rules cap (${inRules}) and DELIVERY_MAX_LINES (${inApp}) agree`);

  // Five writes a line, plus the header and the audit entry, against Firestore's
  // 500-write transaction cap. Phase 2 counted four and set 100, which is 502.
  ok(inApp * 5 + 2 <= 500,
    `${inApp} lines is ${inApp * 5 + 2} writes, over Firestore's 500-write transaction cap`);
  ok(101 * 5 + 2 > 500, "the phase 2 cap of 100 really would have exceeded it");
});

group("deleteDelivery takes the purchase lines with it", () => {
  const start = src.indexOf("async function deleteDelivery");
  ok(start !== -1, "deleteDelivery() exists");
  const body = src.slice(start, start + 2600);
  ok(/where\("deliveryId", "==", id\)/.test(body),
    "it finds the lines by deliveryId");
  ok(/getDocs\(/.test(body),
    "queried from the server, not read out of the windowed client cache");
  ok(/batch\.delete\(line\.ref\)/.test(body), "it deletes the lines");
  ok(/DELIVERY_DELETED/.test(body), "and audits the removal");
  ok(body.indexOf("batch.delete(doc(") > body.indexOf("batch.delete(line.ref)"),
    "the lines go before the header, so a partial failure cannot orphan them");
});


group("a cashier never subscribes to the delivery book", () => {
  // firestore.rules refuses /deliveries to a cashier, and rules-deliveries.test.mjs
  // proves it. This is the other half: the client must not ASK. A subscription
  // that is refused puts a permission-denied in every cashier's console on every
  // sign-in, which teaches a shop to ignore console errors.
  const sub = src.slice(src.indexOf("async function subscribeToDeliveries"),
                        src.indexOf("function summariseDeliveries"));
  ok(sub.length > 200, "subscribeToDeliveries() found");
  ok(/if \(!isManagerOrOwnerRole\(\)\) \{[\s\S]{0,140}return;\s*\}/.test(sub),
    "it returns early for a cashier, before any query is issued");
  ok(/state\.deliveries = \[\];/.test(sub),
    "...and empties what was already loaded rather than leaving it in memory");
  ok(sub.indexOf("isManagerOrOwnerRole") < sub.indexOf("onSnapshot"),
    "the role check comes BEFORE the listener is attached");

  // A demoted manager: the role-gated resubscribe must clear deliveries too, or
  // a screenful of buying prices survives the demotion in memory.
  const resub = src.slice(src.indexOf("function resubscribeRoleGatedCollections"),
                          src.indexOf("function subscribeToOwnMembership"));
  ok(/state\.deliveries = \[\];/.test(resub), "a demotion empties state.deliveries");
  ok(/subscribeToDeliveries\(\);/.test(resub), "...and a promotion re-subscribes");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
