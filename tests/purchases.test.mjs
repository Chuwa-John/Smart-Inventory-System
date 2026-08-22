// Phase B of DESIGN-purchases.md: the weighted average, and the restock path
// that feeds it.
//
//   node purchases.test.mjs
//
// The arithmetic is evaluated out of app.js rather than reimplemented here --
// a reimplementation only proves the copy agrees with itself.
//
// Two things carry the most risk and get the most cases:
//
//   nextUnitCost()  divides. Stock in this system can be NEGATIVE, deliberately
//                   (stockCountInRange permits -1,000,000: an offline oversell
//                   is taken and flagged rather than refused). At exactly
//                   oldQuantity === -delivered the denominator is zero, and a
//                   division by zero on the restock path is a till-adjacent
//                   outage.
//
//   FIRST purchase  must SET the cost, not average against an absent one. Every
//                   product in production today has no costPrice at all, so
//                   reading absent as zero would understate cost and overstate
//                   profit on a shop's very first delivery.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

// Deliberately not the one-liner the other suites use. That version takes the
// first `{` after the name as the body -- which is true for every function it
// was written against, and false for nextUnitCost(), whose parameter is a
// destructured object. It would return the destructuring pattern as the whole
// function and hand new Function() a fragment that does not parse. So: walk the
// PARAMETER list to its closing paren first, then take the body.
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

// Slices one function out of the comment-stripped source, up to the next
// top-level declaration. renderPurchases is not async, so an "\nasync function "
// anchor alone would run past it.
function body(header, from = src) {
  const noC = from.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const start = noC.indexOf(header);
  if (start === -1) return "";
  const rest = noC.slice(start + header.length);
  const next = rest.search(/\n(?:async )?function |\nconst [A-Z_]+ =/);
  return rest.slice(0, next === -1 ? rest.length : next);
}

const { nextUnitCost, productCostKnown, summarisePurchases, purchasedAt, localMonthKey } = new Function(
  `${extract("safeNumber")}
   ${extract("localMonthKey")}
   ${extract("nextUnitCost")}
   ${extract("productCostKnown")}
   ${extract("purchasedAt")}
   ${extract("summarisePurchases")}
   return { nextUnitCost, productCostKnown, summarisePurchases, purchasedAt, localMonthKey };`
)();

const results = [];
function check(name, actual, expected) {
  const pass = Object.is(actual, expected)
    || (typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) < 1e-9);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass ? "" : `\n      expected ${expected}, got ${actual}`}`);
}

const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ===========================================================================
console.log("=== the first purchase sets, it does not average ===");
{
  // The shop's very first delivery of a product that has been on the shelf
  // uncosted since before this feature existed. Averaging 40 "free" units
  // against 200 bought at 2,000 would report 1,667 -- understating cost and
  // overstating profit, on the one figure the whole feature is sold on.
  check("40 uncosted units on the shelf do not drag the first purchase down",
    nextUnitCost({ oldQuantity: 40, oldUnitCost: 0, costKnown: false,
                   deliveredQuantity: 200, totalPaid: 400000 }), 2000);
  check("...and it is emphatically not the weighted answer",
    nextUnitCost({ oldQuantity: 40, oldUnitCost: 0, costKnown: false,
                   deliveredQuantity: 200, totalPaid: 400000 }) === 400000 / 240, false);
  check("a first purchase on an empty shelf is just the batch price",
    nextUnitCost({ oldQuantity: 0, oldUnitCost: 0, costKnown: false,
                   deliveredQuantity: 200, totalPaid: 400000 }), 2000);
}

console.log("\n=== later purchases average, weighted by what is on the shelf ===");
{
  // 100 units at 2,000 already held, 100 more bought at 2,200.
  check("equal quantities average to the midpoint",
    nextUnitCost({ oldQuantity: 100, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 100, totalPaid: 220000 }), 2100);
  // The weighting has to follow the QUANTITY, not the number of deliveries.
  check("a small delivery barely moves a large shelf",
    nextUnitCost({ oldQuantity: 900, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 100, totalPaid: 300000 }), (900 * 2000 + 300000) / 1000);
  check("a large delivery dominates a small shelf",
    nextUnitCost({ oldQuantity: 10, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 990, totalPaid: 990 * 3000 }), (10 * 2000 + 990 * 3000) / 1000);
  check("buying at the same price leaves the average alone",
    nextUnitCost({ oldQuantity: 50, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 50, totalPaid: 100000 }), 2000);

  // The invariant the method is judged on: total stock value equals what was
  // actually paid across a sequence, with nothing sold in between.
  let qty = 0;
  let cost = 0;
  let known = false;
  let paidAltogether = 0;
  for (const [units, paid] of [[200, 400000], [100, 220000], [50, 130000], [7, 20000]]) {
    cost = nextUnitCost({ oldQuantity: qty, oldUnitCost: cost, costKnown: known,
                          deliveredQuantity: units, totalPaid: paid });
    qty += units;
    paidAltogether += paid;
    known = true;
  }
  check("stock value across four deliveries equals what was paid for them",
    Math.abs(qty * cost - paidAltogether) < 1e-6, true);
}

console.log("\n=== the shelf can be negative, and the division must survive it ===");
{
  // stockCountInRange() permits -1,000,000 on purpose: an offline oversell is
  // taken and flagged, not refused. So these are reachable states, not theory.
  // The old cost here is deliberately NOT the batch price. With 2000/2000 the
  // weighted arithmetic happens to land on 2000 as well, so the assertion
  // passed with the guard deleted -- it proved nothing. At 1000 the two paths
  // disagree (weighting gives 2025.64), so only the guard gives 2000.
  check("a negative shelf takes the batch price rather than weighting against it",
    nextUnitCost({ oldQuantity: -5, oldUnitCost: 1000, costKnown: true,
                   deliveredQuantity: 200, totalPaid: 400000 }), 2000);
  check("...and the weighted answer really would have been different",
    Math.abs((-5 * 1000 + 400000) / 195 - 2000) > 1, true);
  // The one that divides by zero if nobody guards it.
  // Two guards stand between this and Infinity: `oldQty <= 0` above, and the
  // `newQuantity <= 0` backstop below it. The backstop is unreachable while the
  // first guard stands -- with delivered > 0, oldQty > 0 cannot produce a
  // non-positive sum -- so no test can single it out. It is kept deliberately so
  // that deleting the first guard degrades to the batch price instead of
  // returning Infinity to the restock transaction.
  check("oldQuantity === -delivered does not divide by zero",
    nextUnitCost({ oldQuantity: -200, oldUnitCost: 1000, costKnown: true,
                   deliveredQuantity: 200, totalPaid: 400000 }), 2000);
  check("...and the result is finite",
    Number.isFinite(nextUnitCost({ oldQuantity: -200, oldUnitCost: 2000, costKnown: true,
                                   deliveredQuantity: 200, totalPaid: 400000 })), true);
  check("a shelf more negative than the delivery is still finite",
    Number.isFinite(nextUnitCost({ oldQuantity: -500, oldUnitCost: 2000, costKnown: true,
                                   deliveredQuantity: 200, totalPaid: 400000 })), true);
  check("a zero shelf takes the batch price",
    nextUnitCost({ oldQuantity: 0, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 200, totalPaid: 400000 }), 2000);
  // Total function: the caller refuses these first, but it must not divide.
  check("a delivery of zero units returns the old cost rather than NaN",
    nextUnitCost({ oldQuantity: 10, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: 0, totalPaid: 400000 }), 2000);
  check("a missing quantity returns the old cost rather than NaN",
    nextUnitCost({ oldQuantity: 10, oldUnitCost: 2000, costKnown: true,
                   deliveredQuantity: undefined, totalPaid: 400000 }), 2000);
}

console.log("\n=== the fraction is kept, because the invoice is the truth ===");
{
  // 33,333 over 100 units. Rounding to 333 loses 33 shillings against the
  // invoice on this delivery alone, and it compounds across a year.
  const unit = nextUnitCost({ oldQuantity: 0, oldUnitCost: 0, costKnown: false,
                              deliveredQuantity: 100, totalPaid: 33333 });
  check("a repeating unit cost is not rounded away", unit, 333.33);
  check("...and the batch still reconciles to what was paid",
    Math.abs(unit * 100 - 33333) < 1e-9, true);
  const third = nextUnitCost({ oldQuantity: 0, oldUnitCost: 0, costKnown: false,
                               deliveredQuantity: 3, totalPaid: 10000 });
  check("10,000 over 3 units keeps the third", Math.abs(third * 3 - 10000) < 1e-9, true);
  check("...and is not an integer", Number.isInteger(third), false);
}

console.log("\n=== absent cost is unknown, never free ===");
{
  // productCostKnown now takes the COST DOCUMENT, not the product. Cost moved
  // to /productCosts so a cashier cannot read it -- /products is readable by
  // every till and Firestore cannot withhold one field of a document.
  //
  // The old form asked the product for `costKnownFrom || costPrice > 0`, which
  // could disagree with itself: one field present without the other averaged a
  // full shelf against a zero cost and produced a plausible wrong number. A
  // document cannot half-exist, so the question is simply whether one is there.
  check("no cost document means not costed", productCostKnown(null), false);
  check("undefined does not throw", productCostKnown(undefined), false);
  // Guards the footgun in the obvious implementation: Boolean(costDoc) alone
  // reads an empty object as costed, which is presence-not-value again.
  check("an empty object is not a cost document", productCostKnown({}), false);
  check("a cost document with the stamp is costed",
    productCostKnown({ costPrice: 1500, costKnownFrom: new Date() }), true);
  check("...even where the average has fallen to zero",
    productCostKnown({ costPrice: 0, costKnownFrom: new Date() }), true);
}

// ===========================================================================
console.log("\n=== the month totals ===");
{
  const at = (d) => ({ toDate: () => d });
  const p = (over = {}) => ({
    createdAt: at(new Date(2026, 7, 14, 10, 0, 0)),
    quantity: 100, totalPaid: 200000, hasFiscalReceipt: false, ...over
  });

  const s1 = summarisePurchases([p(), p({ totalPaid: 50000, quantity: 25 })], "2026-08");
  check("totals add", s1.total, 250000);
  check("units add", s1.units, 125);
  check("deliveries are counted", s1.count, 2);

  const s2 = summarisePurchases([
    p({ hasFiscalReceipt: true }),
    p({ totalPaid: 50000, hasFiscalReceipt: false })
  ], "2026-08");
  check("receipted spending is separated", s2.withReceipt, 200000);
  // This is the number that matters commercially: money whose VAT cannot be
  // reclaimed, because the input tax window runs from the fiscal receipt date.
  check("...and so is the spending with no claim behind it", s2.withoutReceipt, 50000);
  check("the two halves add back to the total", s2.withReceipt + s2.withoutReceipt, s2.total);

  check("another month is excluded",
    summarisePurchases([p({ createdAt: at(new Date(2026, 6, 14)) })], "2026-08").count, 0);
  check("an undated purchase is skipped rather than crashing",
    summarisePurchases([p({ createdAt: null })], "2026-08").count, 0);
  check("an empty month totals zero", summarisePurchases([], "2026-08").total, 0);

  // Local parts, not an ISO slice. Same trap as expenses: Tanzania is UTC+3, so
  // 00:30 on 1 September is 21:30 on 31 August in UTC.
  const lateNight = { toDate: () => ({
    getFullYear: () => 2026, getMonth: () => 8, getDate: () => 1,
    getTime: () => 0, toISOString: () => "2026-08-31T21:30:00.000Z"
  }) };
  check("a purchase just after midnight stays in its LOCAL month",
    summarisePurchases([{ ...p(), createdAt: lateNight }], "2026-09").count, 1);
  check("...and does not appear in the UTC one",
    summarisePurchases([{ ...p(), createdAt: lateNight }], "2026-08").count, 0);
}

// ===========================================================================
console.log("\n=== the restock path writes what the rules expect ===");
{
  const restock = body("async function confirmRestock(");
  check("confirmRestock was located", restock.length > 500, true);

  check("the weighted average is computed inside the transaction",
    /runTransaction[\s\S]*?nextUnitCost\(\{/.test(restock), true);
  // From the transaction's own read, not from the cached product the dialog
  // opened with -- another till may have moved the shelf since.
  check("...from the quantity the transaction read, not the cached copy",
    /oldQuantity: currentQuantity/.test(restock), true);
  check("...and from the cost document the transaction read",
    /oldUnitCost: safeNumber\(existingCost\?\.costPrice\)/.test(restock), true);
  check("the first-purchase rule is asked, not assumed",
    /costKnown: productCostKnown\(existingCost\)/.test(restock), true);
  // Both reads must precede any write: Firestore refuses a transaction that
  // reads after writing, and this one now reads the product and the cost doc.
  check("the cost document is read before anything is written",
    restock.indexOf("transaction.get(costRef)") < restock.indexOf("transaction.set(costRef"), true);
  check("...and the product read comes first of all",
    restock.indexOf("transaction.get(productRef)") < restock.indexOf("transaction.get(costRef)"), true);

  // Carried forward from the existing document, never restamped. The rules pin
  // it across updates, so restamping would be refused rather than silently
  // moving the moment cost became knowable -- which every profit surface reads
  // to decide whether a period can report a complete margin.
  check("costKnownFrom is carried forward, not restamped",
    /costKnownFrom: existingCost\?\.costKnownFrom \|\| Timestamp\.now\(\)/.test(restock), true);
  check("cost is written to the cost document, not to the product",
    /transaction\.set\(costRef, \{/.test(restock), true);
  check("...and the product update carries no cost at all",
    /productUpdate\.costPrice/.test(restock), false);
  check("the unit cost written to the purchase is not rounded",
    /unitCost: totalPaid \/ qty/.test(restock), true);
  // Scoped to the purchase write. recordStockMovement() in the same function
  // also carries productName, so an unscoped regex matched THAT and stayed green
  // with the purchase's own copy blanked -- the same "matched the wrong one of
  // two sites" failure this repo has hit before.
  // Bounded at BOTH ends. Slicing only from the start still ran on past the
  // purchase into recordStockMovement(), which carries its own
  // `productName: product.name` -- so the assertion kept matching that one and
  // stayed green with the purchase's copy blanked. Twice now on the same
  // assertion: an unscoped regex over a function with two similar writes proves
  // nothing about which one it found.
  const purchaseStart = restock.indexOf("transaction.set(purchaseRef");
  const purchaseWrite = restock.slice(
    purchaseStart,
    restock.indexOf("transaction.update(productRef, productUpdate)", purchaseStart));
  check("the purchase write was located", purchaseWrite.length > 100, true);
  check("...and it stops before the stock movement's own copy of the name",
    /recordStockMovement/.test(purchaseWrite), false);
  check("the product name is denormalised onto the purchase",
    /productName: product\.name/.test(purchaseWrite), true);
  check("the purchase and the stock move in one transaction",
    /transaction\.set\(purchaseRef/.test(restock), true);

  // A restock with no cost must still work -- a cashier cannot record cost at
  // all, and a manager may not have the invoice yet.
  check("no purchase document is created when no cost was entered",
    /const purchaseRef = totalPaid[\s\S]{0,120}: null;/.test(restock), true);
  check("cost is only read from the form when the role may record it",
    /const totalPaidRaw = recordingCost \?/.test(restock), true);
  check("a zero or unparseable total is refused rather than written",
    /totalPaidRaw && \(totalPaid === null \|\| totalPaid <= 0\)/.test(restock), true);

  const fields = body("function renderRestockCostFields(");
  check("the cost block is hidden rather than disabled for a cashier",
    /fields\.hidden = !canRecordCost\(\)/.test(fields), true);
  // Re-set on every open, so switching between an owner session and a cashier
  // session on the same device cannot leave the block visible.
  check("...and it is re-evaluated on every open",
    /renderRestockCostFields\(\);/.test(body("function openRestockDialog(")), true);
  check("the fields are cleared on every open, not left holding the last delivery",
    /node\.value = ""/.test(fields), true);
}

console.log("\n=== roles and lifecycle ===");
{
  check("canRecordCost is manager-or-owner",
    /function canRecordCost\(\) \{\s*return isManagerOrOwnerRole\(\);/.test(noComments), true);
  check("subscribeToPurchases refuses a cashier rather than being refused",
    /if \(!isManagerOrOwnerRole\(\)\) \{\s*state\.purchases = \[\];\s*return;\s*\}/.test(
      body("async function subscribeToPurchases(")), true);
  check("renderPurchases refuses a non-manager",
    /if \(!isManagerOrOwnerRole\(\)\) \{[\s\S]{0,200}return;\s*\}/.test(body("function renderPurchases(")), true);
  check("...and empties the table rather than leaving stale rows",
    /table\.innerHTML = "";/.test(body("function renderPurchases(")), true);
  check("purchases is not in the cashier allowlist",
    /CASHIER_ALLOWED_VIEWS = \["pos"\]/.test(noComments), true);

  // Scoped to renderAll's own body. The earlier [\s\S]*? spanned past its
  // closing brace and matched the renderPurchases() call in the month-input
  // listener, so deleting the one in renderAll left the assertion green.
  check("renderAll repaints the purchases screen",
    /renderPurchases\(\);/.test(body("function renderAll(")), true);
  check("signing in subscribes to purchases",
    /subscribeToExpenses\(\);\s*subscribeToPurchases\(\);/.test(noComments), true);
  // Money figures must not outlive the session that fetched them: the next
  // sign-in may be a different business on the same device.
  check("the purchases listener is detached on sign-out",
    /if \(state\.unsubscribePurchases\) state\.unsubscribePurchases\(\);/.test(noComments), true);
  check("...and the purchases themselves are cleared",
    /state\.unsubscribePurchases = null;\s*state\.purchases = \[\];/.test(noComments), true);

  // Cost lives in /productCosts precisely so this subscription can be refused
  // to a cashier. If it ever subscribes for them, the collection's whole reason
  // for existing is gone -- the rules would refuse it, but the attempt puts a
  // permission-denied in every cashier console on every sign-in.
  check("subscribeToProductCosts refuses a cashier",
    /if \(!isManagerOrOwnerRole\(\)\) \{\s*state\.productCosts = \[\];\s*return;\s*\}/.test(
      body("async function subscribeToProductCosts(")), true);
  check("signing in subscribes to product costs",
    /subscribeToPurchases\(\);\s*subscribeToProductCosts\(\);/.test(noComments), true);
  check("the cost listener is detached on sign-out",
    /if \(state\.unsubscribeProductCosts\) state\.unsubscribeProductCosts\(\);/.test(noComments), true);
  check("...and the costs themselves are cleared",
    /state\.unsubscribeProductCosts = null;\s*state\.productCosts = \[\];/.test(noComments), true);

  // The control panel must read cost from the cost collection, not from the
  // product. Reading it off the product is exactly what made it visible to
  // every cashier, and it would silently work -- the numbers would be zero.
  check("the control panel builds its cost map from /productCosts",
    /const costById = productCostMap\(\);/.test(body("function renderAdminControl(")), true);
  check("...and not from the product documents",
    /new Map\(state\.products\.map\(\(p\) => \[p\.id, safeNumber\(p\.costPrice\)\]\)\)/.test(noComments), false);
  check("productCostMap reads the cost collection",
    /state\.productCosts \|\| \[\]/.test(body("function productCostMap(")), true);

  // A real container, so the heading owns exactly its own items. As a bare <p>
  // in a flat <nav> it captured every following .nav-item -- Reports and the AI
  // Advisor were filed under Accounts, which nobody decided.
  check("the Accounts heading follows its own group",
    /group\.hidden = !anyVisible/.test(noComments), true);
  check("...and the group is scoped to its own children",
    /group\.querySelectorAll\("\.nav-item"\)/.test(noComments), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["nav.accounts", "nav.purchases", "purchases.monthTotal",
                     "purchases.noReceipt", "purchases.noReceiptNote",
                     "restock.totalPaidLabel", "restock.unitCostHint",
                     "restock.totalPaidInvalid", "restock.receiptHint"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 2, true);
  }
  check("purchases.monthCount carries both placeholders in both languages",
    (src.match(/"purchases\.monthCount": "[^"]*\{count\}[^"]*\{units\}[^"]*"/g) || []).length, 2);
  check("restock.unitCostHint carries its placeholder in both languages",
    (src.match(/"restock\.unitCostHint": "[^"]*\{value\}[^"]*"/g) || []).length, 2);
}

console.log("\n=== a restock cannot hang the till ===");
{
  const restock = body("async function confirmRestock(");
  // OFFLINE-CAPABILITIES.md line 52 promises restocking is refused until the
  // connection returns. Nothing implemented it: runTransaction cannot complete
  // without a server, so the promise never settled, the finally never ran, and
  // the Confirm button stayed disabled until the page was reloaded.
  check("offline is refused outright", /if \(isOfflineNow\(\)\) return showToast/.test(restock), true);
  check("...before the button is ever disabled",
    restock.indexOf("isOfflineNow()") < restock.indexOf("confirmButton.disabled = true"), true);

  // The guard only catches a connection the device KNOWS is down. Shop wifi up
  // and the uplink dead is the case that hangs: navigator.onLine stays true and
  // serverReachable has not flipped.
  check("the transaction is bounded by a timeout", /awaitRestockTransaction\(attempt\)/.test(restock), true);
  check("...and the promise is not awaited before the race",
    /const attempt = runTransaction\(/.test(restock), true);
  // Unlike a sale there is no offline queue behind a restock, so an unconfirmed
  // transaction may or may not have landed. The shop is told that rather than
  // shown a success it cannot rely on when counting the shelf.
  check("an unconfirmed restock is reported, not claimed as success",
    /outcome === "unconfirmed"[\s\S]{0,160}toast\.restockUnconfirmed/.test(restock), true);

  const helper = body("async function awaitRestockTransaction(");
  check("the timeout helper clears its timer", /window\.clearTimeout\(timeoutId\)/.test(helper), true);
  check("...in a finally, so a rejected attempt does not leak it",
    /finally \{[\s\S]{0,120}clearTimeout/.test(helper), true);
}

console.log("\n=== the delivery paperwork is read once, outside the retry ===");
{
  const restock = body("async function confirmRestock(");
  const txStart = restock.indexOf("runTransaction(");
  // Firestore re-runs a transaction callback on contention, and the dialog stays
  // open and interactive for all of it -- so a retry could pick up fields
  // another dialog had already blanked and write the purchase with the supplier
  // and receipt gone.
  for (const field of ["restockReceiptInput", "restockSupplierInput",
                       "restockSupplierTinInput", "restockHasReceiptInput"]) {
    check(`${field} is read before the transaction, not inside it`,
      restock.indexOf(field) > -1 && restock.indexOf(field) < txStart, true);
  }
  // Asserted, not inferred from whether the number box was typed in.
  check("hasFiscalReceipt is asserted by a checkbox",
    /const hasFiscalReceipt = recordingCost && Boolean\(qs\("#restockHasReceiptInput"\)\?\.checked\)/.test(restock), true);
  check("...and is no longer inferred from the receipt number",
    /hasFiscalReceipt: Boolean\(receiptNumber\)/.test(restock), false);
  // The field the six-month input-VAT window actually runs from. It was in the
  // schema, permitted by the rules, and written by nothing.
  check("the receipt date is written to the purchase",
    /receiptDate: Timestamp\.fromDate\(receiptDate\)/.test(restock), true);
  check("the supplier TIN is written too", /supplierTin \}/.test(restock), true);
  check("both are omitted when blank rather than written empty",
    /\.\.\.\(receiptDate \? \{ receiptDate/.test(restock), true);

  // Local-only mode: Firebase failed to load and the app runs against memory. A
  // quantity-only restock is still meaningful there; a cost is not, because
  // there is nowhere to put the purchase. Dropping the money the manager typed
  // with a "Restocked" toast is worse than refusing it, and saveExpense()
  // refuses in the same situation.
  const fallback = restock.slice(restock.indexOf("} else {"));
  check("the no-database branch was located", fallback.length > 40, true);
  check("a cost entered with no database is refused, not discarded",
    /if \(totalPaid\) \{[\s\S]{0,200}costNeedsConnection[\s\S]{0,60}return;/.test(fallback), true);
  check("...and the quantity-only restock still works there",
    /product\.quantity = newQuantityDisplay;/.test(fallback), true);
}

console.log("\n=== VAT copy is not shown to a shop that does not collect VAT ===");
{
  // DESIGN-vat.md decision 4: per business, forward-only, off by default. A duka
  // that is not registered was being told it had lost a claim it was never
  // entitled to make.
  check("the receipt block is gated on registration",
    /receiptFields\.hidden = !canRecordCost\(\) \|\| !vatSettings\(\)\.registered/.test(
      body("function renderRestockCostFields(")), true);
  check("the no-receipt tile is gated too",
    /vatSettings\(\)\.registered \? \[[\s\S]{0,300}purchases\.noReceipt/.test(
      body("function renderPurchases(")), true);
}

console.log("\n=== a role change re-runs the subscriptions gated on it ===");
{
  const resub = body("function resubscribeRoleGatedCollections(");
  check("promotion re-subscribes expenses, purchases and costs",
    /subscribeToExpenses\(\);\s*subscribeToPurchases\(\);\s*subscribeToProductCosts\(\);/.test(resub), true);
  check("...and demotion empties what was already loaded",
    /state\.expenses = \[\];\s*state\.purchases = \[\];\s*state\.productCosts = \[\];/.test(resub), true);
  check("...and detaches the listeners first",
    resub.indexOf("state[key]()") < resub.indexOf("state.expenses = []"), true);
  check("the membership watcher calls it on a role change",
    /state\.currentUserRole = nextRole;[\s\S]{0,120}resubscribeRoleGatedCollections\(\);/.test(noComments), true);
  check("...and on the fail-closed demotion path too",
    /state\.currentUserRole = "cashier";\s*resubscribeRoleGatedCollections\(\);/.test(noComments), true);
}
console.log("\n=== Phase C: cost travels with the stock ===");
{
  const transfer = body("async function confirmTransfer(");
  check("confirmTransfer was located", transfer.length > 500, true);

  // Before this, transfer-in added units and touched no cost at all: 100 units
  // costing 2,000 landing in a branch holding 100 at 500 left that branch
  // reporting 200 x 500 = 100,000 of stock value against 300,000 actually paid.
  // Structural, not presence. The bare regex matched even with `if (false)`
  // wrapped round the write -- the third time in this file an assertion has
  // tested that text EXISTS rather than that it RUNS. The set must follow the
  // nextUnitCost() call with nothing but whitespace between them.
  check("the destination's average is recomputed",
    /\}\);\s*transaction\.set\(destinationCostRef/.test(transfer), true);
  check("...and nothing conditions it away",
    /if \([^)]*\)\s*transaction\.set\(destinationCostRef/.test(transfer), false);
  check("...through the same weighted-average function a restock uses",
    /nextUnitCost\(\{/.test(transfer), true);
  check("...against what the destination actually holds",
    /oldQuantity: destinationQty/.test(transfer), true);
  // The source's average IS the batch price for this arrival.
  check("the incoming batch is priced at the source's average",
    /totalPaid: safeNumber\(sourceCost\.costPrice\) \* qty/.test(transfer), true);

  // Removing units at the prevailing average does not change the average.
  check("the source's own average is left alone",
    /transaction\.set\(sourceCostRef/.test(transfer), false);
  // A transfer moves cost between branches; it does not create any.
  check("no purchase document is written for a transfer",
    /purchases/.test(transfer), false);

  // Firestore refuses a transaction that reads after writing, and this one now
  // reads up to four documents.
  const firstWrite = Math.min(
    ...["transaction.update(sourceRef", "transaction.set(destinationCostRef", "recordStockMovement(transaction"]
      .map((m) => transfer.indexOf(m)).filter((i) => i > -1));
  for (const read of ["transaction.get(sourceRef", "transaction.get(destinationRef",
                      "transaction.get(sourceCostRef", "transaction.get(destinationCostRef"]) {
    check(`${read.replace("transaction.get(", "")} is read before any write`,
      transfer.indexOf(read) > -1 && transfer.indexOf(read) < firstWrite, true);
  }

  // A source with no cost recorded carries nothing: the destination keeps
  // whatever it had rather than being averaged against a zero.
  check("a source with no cost leaves the destination alone",
    /if \(sourceCost && safeNumber\(sourceCost\.costPrice\) > 0\)/.test(transfer), true);
  check("costKnownFrom is carried forward, or stamped for a first arrival",
    /costKnownFrom: existingDestCost\?\.costKnownFrom \|\| Timestamp\.now\(\)/.test(transfer), true);
}

console.log("\n=== Phase C: the transfer a manager could never complete ===");
{
  const transfer = body("async function confirmTransfer(");
  // A first transfer into a branch CREATES a product there, and /products
  // create has always been owner-only -- so this failed for a manager with a
  // bare "not allowed", AFTER the dialog had taken the quantity. Pre-existing,
  // and live on production. KNOWN-LIMITATIONS.md L-14.
  check("a manager is refused before the transaction, not by it",
    /if \(!destinationExisted && !isOwnerRole\(\)\)/.test(transfer), true);
  check("...and told what to do about it",
    /toast\.transferNeedsOwnerFirst/.test(transfer), true);
  check("...before the button is claimed",
    transfer.indexOf("transferNeedsOwnerFirst") < transfer.indexOf("runTransaction("), true);
  check("the owner is unaffected",
    /!isOwnerRole\(\)/.test(transfer), true);
  check("the message names the branch", /store: destinationStore\.name/.test(transfer), true);
  check("toast.transferNeedsOwnerFirst exists in both languages",
    (src.match(/"toast\.transferNeedsOwnerFirst"/g) || []).length >= 3, true);
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
