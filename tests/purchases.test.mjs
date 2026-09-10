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

// summariseExpenses() has read the category -> nature map since
// DESIGN-landed-costs.md phase 5, and summariseProfit() calls it. Lifted out of
// app.js rather than restated: a restated table can drift from the one that
// ships, and this one decides which line of the Profit Report a cost lands on.
function objectLiteral(name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  return src.slice(start, src.indexOf("};", start) + 2);
}

const { nextUnitCost, productCostKnown, summarisePurchases, purchasedAt, localMonthKey,
        costInForceAt, buildCostIndex, summariseProfit, summariseCostOfGoods,
        summariseProductProfit, summariseStockValuation, summariseSuppliers,
        summariseSalesByProduct } = new Function(
  `${extract("safeNumber")}
   ${extract("localMonthKey")}
   ${extract("nextUnitCost")}
   ${extract("productCostKnown")}
   ${extract("purchasedAt")}
   ${extract("summarisePurchases")}
   ${extract("costInForceAt")}
   ${extract("buildCostIndex")}
   ${extract("isServiceLine")}
   ${extract("saleTimestamp")}
   ${extract("summariseSales")}
   ${extract("saleReturnedQtyMap")}
   ${extract("summariseCostOfGoods")}
   ${extract("expenseSpentAt")}
   ${objectLiteral("EXPENSE_NATURE_BY_CATEGORY")}
   ${extract("expenseNature")}
   ${extract("summariseExpenses")}
   ${extract("summariseProfit")}
   ${extract("landedRatioByProduct")}
   ${extract("summariseProductProfit")}
   ${extract("summariseStockValuation")}
   ${extract("deliveryReceivedAt")}
   ${extract("summariseSuppliers")}
   ${extract("summariseSalesByProduct")}
   return { nextUnitCost, productCostKnown, summarisePurchases, purchasedAt, localMonthKey,
            costInForceAt, buildCostIndex, summariseProfit, summariseCostOfGoods,
            summariseProductProfit, summariseStockValuation, summariseSuppliers, summariseSalesByProduct };`
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
  // The claim, not the literal list -- see the note in expenses.test.mjs. This
  // said `= ["pos"]` and so went red when Settings joined the list, which is a
  // change that does not put a buying price anywhere near a till.
  check("purchases is not in the cashier allowlist",
    /CASHIER_ALLOWED_VIEWS = \[[^\]]*"purchases"/.test(noComments), false);
  check("...nor is deliveries, which carries the same disclosure",
    /CASHIER_ALLOWED_VIEWS = \[[^\]]*"deliveries"/.test(noComments), false);

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
  // Presence in the sign-in path, not adjacency to subscribeToPurchases().
  // Written as an adjacency regex first, which broke the moment
  // DESIGN-landed-costs.md phase 4 inserted subscribeToDeliveries() between the
  // two -- a green-to-red on a change that did not touch the claim at all. The
  // claim is that signing in subscribes to costs; where the call sits among its
  // siblings is not part of it.
  {
    const signIn = body("async function initFirebase(");
    check("signing in subscribes to product costs",
      /subscribeToProductCosts\(\);/.test(signIn), true);
    check("...and to purchases", /subscribeToPurchases\(\);/.test(signIn), true);
    check("...and to the cost history", /subscribeToProductCostHistory\(\);/.test(signIn), true);
  }
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

  // Purchases sat inside an Accounts dropdown for a fortnight. It is top-level
  // again as of 2026-09-10: with Deliveries folded into it there are few enough
  // entries that a menu cost a tap and bought nothing, and a screen a shop uses
  // every time stock arrives should not be two clicks deep. The group machinery
  // that hid and showed it is gone with it -- assertions about that container
  // used to live here, and were removed rather than rewritten because there is
  // no container left to make a claim about. nav-structure.test.mjs holds the
  // whole nav contract now.
  const navHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  check("Purchases is a top-level destination",
    /<button class="nav-item" data-view="purchases">/.test(navHtml), true);
  check("...and nothing hides it behind a group",
    /nav-group|accountsGroupToggle/.test(navHtml + src), false);
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
  // Each call asserted on its own rather than as one adjacency regex. The
  // adjacency form broke when phase 4 inserted subscribeToDeliveries() into the
  // sequence, and it would have gone red for every future collection too --
  // while a genuinely missing call in the middle would look identical to a
  // harmless insertion. Named individually, a missing one names itself.
  for (const fn of ["subscribeToExpenses", "subscribeToPurchases",
                    "subscribeToProductCosts", "subscribeToProductCostHistory"]) {
    check(`promotion re-subscribes via ${fn}()`,
      new RegExp(`${fn}\\(\\);`).test(resub), true);
  }
  for (const key of ["expenses", "purchases", "productCosts", "productCostHistory"]) {
    check(`...and demotion empties state.${key}`,
      new RegExp(`state\\.${key} = \\[\\];`).test(resub), true);
  }
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
console.log("\n=== Phase D: what a thing cost on the day it was sold ===");
{
  const at = (iso) => ({ toDate: () => new Date(iso) });
  const rec = (productId, costPrice, iso) => ({
    productId, storeId: "s1", costPrice, effectiveFrom: at(iso), reason: "purchase"
  });
  const JAN = new Date("2026-01-15T10:00:00Z");
  const JUN = new Date("2026-06-15T10:00:00Z");
  const DEC = new Date("2026-12-15T10:00:00Z");

  const index = buildCostIndex([
    rec("p1", 2000, "2026-01-01T00:00:00Z"),
    rec("p1", 2500, "2026-05-01T00:00:00Z"),
    rec("p1", 3000, "2026-10-01T00:00:00Z"),
  ]);

  // The whole point of the collection: a delivery in October cannot rewrite
  // what January's sales cost. The old records still say what was true then.
  check("a January sale costs what it cost in January", costInForceAt(index, "p1", JAN), 2000);
  check("a June sale costs the May price", costInForceAt(index, "p1", JUN), 2500);
  check("a December sale costs the October price", costInForceAt(index, "p1", DEC), 3000);

  // Absent is UNKNOWN, never free. A sale made before a product had any cost
  // recorded has no cost of goods, and must not be reported as 100% margin.
  check("a sale before the first record has no known cost",
    costInForceAt(index, "p1", new Date("2025-12-31T23:59:59Z")), null);
  check("...and null is not zero", costInForceAt(index, "p1", new Date("2025-01-01")) === 0, false);
  check("a product with no history at all is unknown", costInForceAt(index, "unknown", JUN), null);
  check("an undated sale is unknown rather than assumed", costInForceAt(index, "p1", null), null);
  check("an unparseable date is unknown", costInForceAt(index, "p1", new Date("nonsense")), null);

  // Exactly on the boundary the new cost applies -- the record says it takes
  // effect FROM that moment.
  check("a sale at the exact instant a cost took effect uses the new one",
    costInForceAt(index, "p1", new Date("2026-05-01T00:00:00Z")), 2500);
  check("...and a millisecond earlier uses the old one",
    costInForceAt(index, "p1", new Date("2026-04-30T23:59:59.999Z")), 2000);

  // Records arrive from a snapshot in no particular order.
  // The order here is chosen so that an UNSORTED array gives the wrong answer.
  // costInForceAt scans from the end for the first record at-or-before the sale,
  // so with [Jan, Oct, May] and a December sale it would stop at May and report
  // 2500 when October's 3000 is what applied. An earlier version of this case
  // used an order where both paths happened to agree, and proved nothing.
  const shuffled = buildCostIndex([
    rec("p2", 2000, "2026-01-01T00:00:00Z"),
    rec("p2", 3000, "2026-10-01T00:00:00Z"),
    rec("p2", 2500, "2026-05-01T00:00:00Z"),
  ]);
  check("out-of-order records are sorted before lookup", costInForceAt(shuffled, "p2", DEC), 3000);
  check("...and the unsorted answer really would have been different",
    costInForceAt(shuffled, "p2", DEC) !== 2500, true);

  // A local echo of a write that has not landed has no resolved timestamp.
  // Skipping it means the PREVIOUS cost applies for now, which is honest --
  // treating it as effective-at-epoch would make it win every lookup.
  const withEcho = buildCostIndex([
    rec("p3", 2000, "2026-01-01T00:00:00Z"),
    { productId: "p3", storeId: "s1", costPrice: 9999, effectiveFrom: null, reason: "purchase" },
  ]);
  check("an unresolved timestamp is skipped, not treated as effective now",
    costInForceAt(withEcho, "p3", DEC), 2000);
  check("an empty history yields nothing", costInForceAt(buildCostIndex([]), "p1", JUN), null);
  check("buildCostIndex tolerates undefined", buildCostIndex(undefined).size, 0);
}

console.log("\n=== Phase D: the history is written where the average moves ===");
{
  const restock = body("async function confirmRestock(");
  const transfer = body("async function confirmTransfer(");

  // Appended in the SAME transaction as the average it records, so the current
  // cost and its history cannot disagree.
  // Structural. `if (false) transaction.set(...)` still contains every word a
  // presence regex looks for -- this is the fourth assertion in this file to
  // have that flaw, so it checks the statement is not conditioned as well.
  check("a restock appends a cost record",
    /productCostHistory"\)\), \{[\s\S]{0,400}reason: "purchase"/.test(restock), true);
  check("...unconditionally",
    /if \([^)]*\)\s*transaction\.set\(doc\(collection\([^)]*productCostHistory/.test(restock), false);
  check("...in the same transaction as the average",
    restock.indexOf("productCostHistory") < restock.indexOf("transaction.set(costRef"), true);
  check("a transfer-in appends one too",
    /productCostHistory"\)\), \{[\s\S]{0,400}reason: "transfer-in"/.test(transfer), true);
  check("...unconditionally as well",
    /if \([^)]*\)\s*transaction\.set\(doc\(collection\([^)]*productCostHistory/.test(transfer), false);
  check("...in the same transaction as the destination average",
    transfer.indexOf("productCostHistory") < transfer.indexOf("transaction.set(destinationCostRef"), true);

  // serverTimestamp, not the device clock. This decides which cost applied to a
  // sale, and a sale's createdAt is a serverTimestamp too -- comparing one
  // authority against another is the only way the comparison means anything.
  check("effectiveFrom comes from the server, not the device",
    /effectiveFrom: serverTimestamp\(\)/.test(restock), true);
  check("...on the transfer path as well",
    /effectiveFrom: serverTimestamp\(\)/.test(transfer), true);
  check("the device clock is not used for it",
    /effectiveFrom: Timestamp\.now\(\)/.test(restock + transfer), false);
}

console.log("\n=== Phase D: roles and lifecycle ===");
{
  check("subscribeToProductCostHistory refuses a cashier",
    /if \(!isManagerOrOwnerRole\(\)\) \{\s*state\.productCostHistory = \[\];\s*return;\s*\}/.test(
      body("async function subscribeToProductCostHistory(")), true);
  check("signing in subscribes to it",
    /subscribeToProductCosts\(\);\s*subscribeToProductCostHistory\(\);/.test(noComments), true);
  check("it is detached on sign-out",
    /if \(state\.unsubscribeProductCostHistory\) state\.unsubscribeProductCostHistory\(\);/.test(noComments), true);
  check("...and cleared",
    /state\.unsubscribeProductCostHistory = null;\s*state\.productCostHistory = \[\];/.test(noComments), true);
  check("a role change re-runs it too",
    /unsubscribeProductCostHistory"\]/.test(noComments), true);
}
console.log("\n=== Phase E: three figures, not equally trustworthy ===");
{
  const SOLD = new Date("2026-06-15T10:00:00Z");
  const costIndex = buildCostIndex([
    { productId: "p1", storeId: "s1", costPrice: 600,
      effectiveFrom: { toDate: () => new Date("2026-01-01T00:00:00Z") } }
  ]);
  const sale = (over = {}) => ({
    total: 1000, voided: false, refundedAmount: 0, discountAmount: 0,
    paymentMethod: "cash", createdAt: SOLD, items: [{ productId: "p1", qty: 1 }], ...over
  });
  const expense = (amount) => ({
    amount, category: "transport", paidFrom: "other", spentAt: { toDate: () => SOLD }
  });
  const run = (over = {}) => summariseProfit({
    sales: [sale()], costIndex, expenses: [], monthKey: "2026-06",
    coverageFromMs: null, vatRegistered: false, ...over
  });

  check("revenue is the takings", run().revenue, 1000);
  check("cost of goods comes from the history", run().cogs, 600);
  check("gross profit is revenue less cost", run().grossProfit, 400);
  check("...and the margin is a percentage of revenue", run().grossMarginPct, 40);
  check("net profit is gross less expenses", run({ expenses: [expense(150)] }).netProfit, 250);
  check("...and gross is untouched by expenses", run({ expenses: [expense(150)] }).grossProfit, 400);

  check("a refund reduces revenue", run({ sales: [sale({ refundedAmount: 400 })] }).revenue, 600);
  check("a voided sale is not revenue at all", run({ sales: [sale({ voided: true })] }).revenue, 0);
  check("...and contributes no cost of goods either", run({ sales: [sale({ voided: true })] }).cogs, 0);

  // VAT is the Authority's money passing through, never the shop's margin.
  const vatSale = sale({ total: 1180, netTotal: 1000, taxTotal: 180 });
  const vatSale2 = sale({ total: 1180, netTotal: 1000, taxTotal: 180, refundedAmount: 200 });
  check("a registered business reports revenue net of VAT",
    run({ sales: [vatSale], vatRegistered: true }).revenue, 1000);
  check("an unregistered one reports the whole takings",
    run({ sales: [sale({ total: 1180 })] }).revenue, 1180);
  // A sale from before the business registered carries no netTotal. It is
  // outside the scheme, not taxed at zero, so its total IS its net.
  check("a pre-registration sale counts its total as its net",
    run({ sales: [sale({ total: 1180 })], vatRegistered: true }).revenue, 1180);
  // The VAT branch subtracts refunds itself rather than going through
  // summariseSales, so it needs its own case -- the non-VAT one above does
  // not exercise this line at all.
  check("a refund reduces revenue on the VAT path too",
    run({ sales: [vatSale2], vatRegistered: true }).revenue, 800);
}

console.log("\n=== Phase E: it says what it could not see ===");
{
  const SOLD = new Date("2026-06-15T10:00:00Z");
  const sale = (over = {}) => ({
    total: 1000, voided: false, refundedAmount: 0, discountAmount: 0,
    paymentMethod: "cash", createdAt: SOLD, items: [{ productId: "p1", qty: 1 }], ...over
  });
  const noCost = summariseProfit({
    sales: [sale()], costIndex: buildCostIndex([]), expenses: [], monthKey: "2026-06",
    coverageFromMs: null, vatRegistered: false
  });
  // Section 11 rule 2. With no recorded cost, gross profit would otherwise read
  // as the whole of revenue -- the fabricated-100%-margin defect phase 0
  // removed, wearing a different hat.
  check("with no recorded cost, nothing is claimed to be known", noCost.anyCostKnown, false);
  check("...and the uncosted lines are counted", noCost.uncostedLines, 1);

  const costIndex = buildCostIndex([
    { productId: "p1", storeId: "s1", costPrice: 600,
      effectiveFrom: { toDate: () => new Date("2026-01-01T00:00:00Z") } }
  ]);
  const partial = summariseProfit({
    sales: [sale(), sale({ items: [{ productId: "p2", qty: 1 }] })],
    costIndex, expenses: [], monthKey: "2026-06", coverageFromMs: null, vatRegistered: false
  });
  check("a partly costed month reports a figure", partial.anyCostKnown, true);
  check("...but does not claim to be complete", partial.allCostKnown, false);
  check("...and names how many lines it could not cost", partial.uncostedLines, 1);

  // "Nothing recorded" is not "nothing spent", and the surface must not imply
  // the second. A forgotten expense makes profit look BETTER, which is the
  // direction someone prices and restocks against.
  check("no expenses recorded is reported as such", partial.anyExpensesRecorded, false);
  const withExp = summariseProfit({
    sales: [sale()], costIndex,
    expenses: [{ amount: 100, category: "rent", paidFrom: "other",
                 spentAt: { toDate: () => SOLD } }],
    monthKey: "2026-06", coverageFromMs: null, vatRegistered: false
  });
  check("...and recording one flips it", withExp.anyExpensesRecorded, true);
}

console.log("\n=== Phase E: a month it cannot total, it refuses ===");
{
  const SOLD = new Date("2026-06-15T10:00:00Z");
  const sale = { total: 1000, voided: false, refundedAmount: 0, discountAmount: 0,
                 paymentMethod: "cash", createdAt: SOLD, items: [] };
  // L-11: subscribeToSales holds the newest 1,000 sales. A month that has fallen
  // out of that window totals to LESS than was taken, and a profit statement is
  // exactly the document nobody should be handed a quiet under-count on.
  const outside = summariseProfit({
    sales: [sale], costIndex: buildCostIndex([]), expenses: [], monthKey: "2026-06",
    coverageFromMs: new Date("2026-07-01T00:00:00Z").getTime(), vatRegistered: false
  });
  check("a month starting before the loaded window is refused", outside.outsideWindow, true);
  const inside = summariseProfit({
    sales: [sale], costIndex: buildCostIndex([]), expenses: [], monthKey: "2026-06",
    coverageFromMs: new Date("2026-05-01T00:00:00Z").getTime(), vatRegistered: false
  });
  check("a month inside it is not", inside.outsideWindow, false);
  const unbounded = summariseProfit({
    sales: [sale], costIndex: buildCostIndex([]), expenses: [], monthKey: "2026-06",
    coverageFromMs: null, vatRegistered: false
  });
  check("a full history refuses nothing", unbounded.outsideWindow, false);
}

console.log("\n=== Phase E: the surface, and who may see it ===");
{
  // Owner-strict, decided 2026-08-21: profit exposes buying prices by
  // inference. This is the only view with its own gate in canOpenView().
  check("profit is owner-only in canOpenView",
    /if \(viewId === "profit"\) return isOwnerRole\(\);/.test(noComments), true);
  const render = body("function renderProfit(");
  // The bound was 160 characters until phase 7 added the drill-down's clearing
  // to the same block. Widened rather than dropped: what matters is that the
  // refusal RETURNS without falling through, and an unbounded [\s\S]* would
  // match a `return` anywhere later in the function and prove nothing.
  check("renderProfit refuses a non-owner",
    /if \(!isOwnerRole\(\)\) \{[\s\S]{0,600}return;\s*\}/.test(render), true);
  check("...and empties rather than leaving stale figures",
    /grid\.innerHTML = "";/.test(render), true);
  // Phase 7: the per-product table is the strongest disclosure in the app -- a
  // buying price against a selling price, per product. A demoted owner must not
  // keep it in the DOM behind a hidden attribute.
  check("...and clears the per-product table too",
    /productTable\.innerHTML = "";/.test(render), true);
  check("...and hides its panel",
    /productPanel\.hidden = true;/.test(render), true);
  // The refusal must EXIST and come before any tile is built.
  //
  // Presence is asserted separately because indexOf returns -1 when the text
  // is absent, and -1 is less than every real index -- so an ordering check
  // alone passes precisely when the thing it guards has been deleted. The
  // negative control that removed the whole refusal block came back green on
  // exactly that.
  check("the refusal exists at all", render.indexOf("p.outsideWindow") > -1, true);
  // Re-anchored in DESIGN-landed-costs.md phase 6: the four tiles became the
  // docx section 9 statement, so `grid.innerHTML = [` is gone and `const rows =
  // [` is where the figures start being built. Both halves of the original
  // assertion are kept -- presence AND ordering -- for the reason the comment
  // above gives.
  check("the figures are built somewhere in here at all",
    render.indexOf("const rows = [") > -1, true);
  check("the refusal is reached before any figure is rendered",
    render.indexOf("p.outsideWindow") > -1
    && render.indexOf("const rows = [") > -1
    && render.indexOf("p.outsideWindow") < render.indexOf("const rows = ["), true);
  check("...and it returns rather than falling through",
    /if \(p\.outsideWindow\) \{[\s\S]{0,300}return;\s*\}/.test(render), true);
  // Section 11 rule 1: gross and net are never summed into one headline. As a
  // statement they are two rows with their own captions, which is a stronger
  // form of the same rule than two tiles side by side.
  check("gross and net are separate rows",
    /profit\.stGross"\)[\s\S]*profit\.stNet"\)/.test(render), true);
  // Phase 6: cost of goods is a STATED line, not an intermediate the reader has
  // to infer from revenue minus gross -- the docx section 9 asks for it by name.
  check("cost of goods sold is a line of its own",
    /profit\.stCogs"\)/.test(render), true);
  // ...and the docx section 9 split, which is the whole reason phase 5 captured
  // a nature.
  check("direct operating expenses are their own line",
    /profit\.stDirect"\)/.test(render), true);
  check("indirect operating expenses are their own line",
    /profit\.stIndirect"\)/.test(render), true);
  // UNKNOWN COST BLANKS THREE ROWS, not one. Cost of goods, gross and net are
  // all derived from it; printing revenue against a zero cost reports the whole
  // of revenue as profit, which is the defect DESIGN-purchases.md 2 found live.
  check("cost of goods shows nothing until a cost is known",
    /p\.anyCostKnown \? deduct\(p\.cogs\) : unknown/.test(render), true);
  // The CONDITION, not the formatting beside it. Both margins now render
  // through withMargin(), which drops the percentage rather than printing
  // "undefined%" when it is absent; what this test is about is that gross is
  // not shown at all until there is a cost to work from.
  check("gross shows nothing until a cost is known",
    /p\.anyCostKnown \? [^:]*p\.grossProfit[^:]*: unknown/.test(render), true);
  // Asserted as the CONDITION, not the fallback character. app.js is mixed
  // between the em-dash and its \u2014 escape and both render the same thing;
  // what matters is that net profit is not shown at all until there is a cost
  // to work from, because gross would otherwise read as the whole of revenue.
  // Anchored on the CONDITION alone, not on how the value beside it is
  // formatted. Net profit now prints its margin next to it (spec 10), which is
  // a presentation change; what this test is about is that the figure is not
  // shown at all until there is a cost to work from.
  check("net shows nothing until a cost is known",
    /p\.anyCostKnown \? [^:]*p\.netProfit[^:]*: unknown/.test(render), true);
  check("renderAll repaints it", /renderProfit\(\);/.test(body("function renderAll(")), true);

  for (const key of ["nav.profit", "profit.gross", "profit.net", "profit.grossNoCost",
                     "profit.expensesNone", "profit.outsideWindow", "profit.netNote",
                     // The docx section 9 statement, phase 6.
                     "profit.stRevenue", "profit.stCogs", "profit.stGross",
                     "profit.stDirect", "profit.stIndirect", "profit.stNet",
                     "profit.deduction"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 2, true);
  }
}
// L-13. Expenses, purchases and cost history are feeds -- they grow with
// trading volume and never plateau -- so each must be bounded, and each bounded
// query must have the composite index it needs DECLARED. A bounded query
// missing its index does not degrade: it fails with failed-precondition, and
// only for staff accounts, because the owner's branch carries no where() and
// needs no composite index. That is a bug that reaches production having passed
// every test the owner ever ran.
{
  const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const declared = new Set(indexes.indexes.map((i) =>
    i.collectionGroup + ":" + i.fields.map((f) => f.fieldPath + "@" + f.order).join(",")));

  const feeds = [
    ["subscribeToExpenses", "expenses", "createdAt"],
    ["subscribeToPurchases", "purchases", "createdAt"],
    ["subscribeToProductCostHistory", "productCostHistory", "effectiveFrom"]
  ];

  for (const [fn, collectionName, field] of feeds) {
    const source = body("async function " + fn + "(");
    check(fn + " bounds the feed with a limit",
      source.includes("limit(ACCOUNTS_HISTORY_LIMIT)"), true);
    check(fn + " orders by " + field,
      source.includes('orderBy("' + field + '"'), true);
    check(collectionName + " declares the (storeId, " + field + ") composite index",
      declared.has(collectionName + ":storeId@ASCENDING," + field + "@DESCENDING"), true,
      "the staff branch adds where(storeId in ...) to that orderBy and cannot run without it");
  }

  // The counterpart, asserted so nobody "fixes" it later: /productCosts holds
  // one document per product per store, so it is catalogue-shaped and plateaus.
  // Bounding it would silently drop the cost of whichever products fell outside
  // the window, which is worse than holding them all.
  check("productCosts is deliberately NOT bounded",
    !body("async function subscribeToProductCosts(").includes("limit("), true);
}

// Opening-stock cost on the ADD PRODUCT form. A shop does not start empty:
// someone onboarding types in stock they already own and already have receipts
// for, and before 2026-08-23 the only way to record what they paid was to
// invent a restock. DESIGN-purchases.md 13c deferred this; 13i is where it
// landed.
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  const save = body("async function saveProduct(");
  const gate = body("function renderProductCostFields(");

  check("the add-product form carries a cost section",
    html.includes('id="productCostFields"') && html.includes('id="productTotalPaidInput"'), true);

  // ALWAYS hidden since 2026-09-10, which is strictly stronger than the three
  // conditions this used to assert (hidden on edit, hidden without permission,
  // receipt block additionally needing VAT registration) -- all three are
  // implied by never showing it at all.
  //
  // Inventory records what is on the shelf; cost belongs to Purchases, where a
  // delivery states what was paid and freight is spread across the lines. Two
  // places to enter a cost meant two answers to "what did this cost", and the
  // weighted average had to reconcile both.
  check("the cost section is never shown in Inventory",
    /const fields = qs\("#productCostFields"\);\s*if \(fields\) fields\.hidden = true;/.test(gate), true);
  check("...and neither is the receipt block",
    /const receiptFields = qs\("#productReceiptFields"\);\s*if \(receiptFields\) receiptFields\.hidden = true;/.test(gate), true);
  // The inputs are still cleared, so nothing stale can be submitted from a
  // hidden field if the section is ever shown again.
  check("the hidden inputs are still cleared",
    /node\.value = "";/.test(gate), true);

  // The three documents, in the same shapes the restock transaction writes.
  for (const target of ["productCostHistory", "productCosts", "purchases"]) {
    check(`saving opening stock writes /${target}`,
      save.includes('"' + target + '"'), true);
  }
  check("the history record is reasoned as a purchase",
    save.includes('reason: "purchase"'), true);

  // The invariant firestore.rules enforces on a purchase: unitCost * quantity
  // must equal totalPaid within a shilling. Deriving the unit cost by division
  // is what keeps that true.
  check("unit cost is derived from the total, not entered separately",
    save.includes("costCapture.totalPaid / costCapture.quantity"), true);

  // Cost must never land on the product document itself -- a cashier reads
  // /products in full. This is B2-a, and the new path must not reopen it.
  // Asserted against the payload LITERAL, not against "payload.costPrice".
  // The first version of this check looked for a property assignment and was
  // therefore blind to `costPrice: 1` sitting inside the object literal -- the
  // exact shape the defect would take. The negative control that reintroduced
  // B2-a passed against it, which is the only reason that was caught.
  const payloadStart = save.indexOf("const payload = {");
  const payloadLiteral = payloadStart > -1
    ? save.slice(payloadStart, save.indexOf("};", payloadStart))
    : "";
  check("the product payload literal was found at all", payloadStart > -1, true);
  check("cost is NOT written onto the product document",
    payloadLiteral.length > 0 && !payloadLiteral.includes("costPrice")
      && !payloadLiteral.includes("costKnownFrom"), true);

  // An amount with no quantity cannot become a per-unit cost, and a guess here
  // would sit under every future margin on that product.
  check("an amount with no quantity is refused",
    src.includes("product.totalPaidNeedsQuantity"), true);

  // The product saved but the cost did not is a real outcome, and silence
  // there means pricing against a margin that was never recorded.
  check("a failed cost write is reported, not swallowed",
    save.includes("toast.productSavedWithoutCost"), true);

  for (const key of ["product.costHeading", "product.totalPaidLabel", "product.unitCostHint",
                     "product.totalPaidNeedsQuantity", "toast.productSavedWithoutCost"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\.")}"`, "g")) || []).length >= 2, true);
  }
}


// ===========================================================================
console.log("\n=== phase 6: the docx section 9 statement adds up ===");
{
  // The docx section 9 figures, scaled to a shop: revenue 45m, COGS 27m, gross
  // 18m, direct 2m, indirect 8m, net 8m. Built from real sales and real
  // expenses so the statement is derived, not asserted against itself.
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const sales = [{
    createdAt: at(5), total: 45000000,
    items: [{ productId: "p1", qty: 900, lineTotal: 45000000 }]
  }];
  // 900 units at 30,000 cost each = 27,000,000.
  const costIndex = buildCostIndex([
    { productId: "p1", effectiveFrom: new Date(2026, 7, 1, 12, 0, 0), costPrice: 30000 }
  ]);
  const expenses = [
    { category: "commission", nature: "direct", amount: 2000000, spentAt: at(6), paidFrom: "other" },
    { category: "rent", nature: "indirect", amount: 8000000, spentAt: at(7), paidFrom: "other" }
  ];
  const p = summariseProfit({ sales, costIndex, expenses, monthKey,
                              coverageFromMs: null, vatRegistered: false });

  check("sales revenue", p.revenue, 45000000);
  check("cost of goods sold", p.cogs, 27000000);
  check("GROSS PROFIT", p.grossProfit, 18000000);
  check("direct operating expenses", p.directExpenses, 2000000);
  check("indirect operating expenses", p.indirectExpenses, 8000000);
  check("NET PROFIT", p.netProfit, 8000000);

  // The two arithmetic identities the statement is: each total is the lines
  // above it, and nothing is counted twice.
  check("gross === revenue - cogs", p.grossProfit, p.revenue - p.cogs);
  check("net === gross - direct - indirect",
    p.netProfit, p.grossProfit - p.directExpenses - p.indirectExpenses);
  check("direct + indirect === the expense total",
    p.directExpenses + p.indirectExpenses, p.expenses);

  // THE PROPERTY THAT MAKES THE SPLIT SAFE. Reclassify every expense the other
  // way and the bottom line does not move -- which is why the box is editable
  // and why a shop cannot damage its own profit figure with it.
  const flipped = summariseProfit({
    sales, costIndex, monthKey, coverageFromMs: null, vatRegistered: false,
    expenses: expenses.map((e) => ({ ...e, nature: e.nature === "direct" ? "indirect" : "direct" }))
  });
  check("flipping every classification leaves net profit alone", flipped.netProfit, p.netProfit);
  check("...and gross profit alone", flipped.grossProfit, p.grossProfit);
  check("...while the two lines swap", `${flipped.directExpenses}/${flipped.indirectExpenses}`,
    "8000000/2000000");
}

console.log("\n=== an expense with no nature still lands on a line ===");
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const p = summariseProfit({
    sales: [], costIndex: new Map(), monthKey, coverageFromMs: null, vatRegistered: false,
    // The pre-phase-5 shape: no nature at all.
    expenses: [{ category: "rent", amount: 300000, spentAt: at(2), paidFrom: "other" },
               { category: "commission", amount: 50000, spentAt: at(3), paidFrom: "other" }]
  });
  check("a legacy expense falls to indirect", p.indirectExpenses, 300000);
  check("...and a direct-by-default category to direct", p.directExpenses, 50000);
  check("nothing is lost between the two lines",
    p.directExpenses + p.indirectExpenses, p.expenses);
}

console.log("\n=== unknown cost blanks three lines, not one ===");
{
  // Section 11 rule 3 generalised. Cost of goods, gross and net are all derived
  // from a cost that is not there; reporting revenue against a zero cost would
  // print the whole of revenue as profit, which is the defect
  // DESIGN-purchases.md 2 found live on the control panel.
  const monthKey = "2026-09";
  const p = summariseProfit({
    sales: [{ createdAt: new Date(2026, 8, 5, 12, 0, 0), total: 100000,
              items: [{ productId: "nope", qty: 5, lineTotal: 100000 }] }],
    costIndex: new Map(),
    expenses: [{ category: "rent", nature: "indirect", amount: 10000,
                 spentAt: new Date(2026, 8, 6, 12, 0, 0), paidFrom: "other" }],
    monthKey, coverageFromMs: null, vatRegistered: false
  });
  check("no cost is known", p.anyCostKnown, false);
  check("revenue is still real", p.revenue, 100000);
  // The figures still compute -- the RENDER is what refuses to print them, and
  // purchases.test.mjs asserts that. What must not happen is the summary
  // claiming the cost was known.
  check("cogs sums to zero because nothing could be costed", p.cogs, 0);
  check("...and the surface is told so rather than left to infer it",
    p.anyCostKnown === false && p.uncostedLines > 0, true);
  // The expense lines are unaffected: they are recorded facts, not derived ones.
  check("the indirect line is still stated", p.indirectExpenses, 10000);
}


// ===========================================================================
console.log("\n=== phase 7: the docx section 10 drill-down ===");
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  // The docx section 6/7 delivery, sold: Product A costs 11,800 landed, of which
  // 10,000 was the supplier's price and 1,800 was freight, duty and clearing.
  const purchases = [
    { productId: "a", goodsCost: 5000000, landedCost: 900000, totalPaid: 5900000,
      quantity: 500, createdAt: at(1) },
    { productId: "b", goodsCost: 3000000, landedCost: 540000, totalPaid: 3540000,
      quantity: 200, createdAt: at(1) },
    // Bought before the landed split existed: no goodsCost, no landedCost.
    { productId: "c", totalPaid: 2000000, quantity: 100, createdAt: at(1) }
  ];
  const costIndex = buildCostIndex([
    { productId: "a", effectiveFrom: at(1), costPrice: 11800 },
    { productId: "b", effectiveFrom: at(1), costPrice: 17700 },
    { productId: "c", effectiveFrom: at(1), costPrice: 20000 }
  ]);
  const sales = [{
    createdAt: at(10),
    items: [
      { productId: "a", name: "Product A", qty: 100, lineTotal: 1500000 },
      { productId: "b", name: "Product B", qty: 10, lineTotal: 250000 },
      { productId: "c", name: "Product C", qty: 5, lineTotal: 150000 }
    ]
  }];

  const d = summariseProductProfit({ sales, costIndex, purchases, monthKey });
  const byId = new Map(d.rows.map((r) => [r.productId, r]));
  const a = byId.get("a");

  // The docx section 7 sale, per product this time.
  check("A sold 100 units", a.unitsSold, 100);
  check("A's average cost is the landed unit cost", a.averageCost, 11800);
  check("A's cost of sales", a.cogs, 1180000);
  check("A's revenue", a.revenue, 1500000);
  check("A's gross profit", a.grossProfit, 320000);
  check("A's margin", a.grossMarginPct, 21);

  // The two middle columns the goodsCost/landedCost split exists for. A's
  // lifetime landed share is 900,000 / 5,900,000, applied to its cost of sales.
  check("A's cost of sales splits into goods...", a.cogsGoods, 1180000 * (5000000 / 5900000));
  check("...and landed", a.cogsLanded, 1180000 * (900000 / 5900000));
  check("the split adds back to the cost of sales",
    Math.abs(a.cogsGoods + a.cogsLanded - a.cogs) < 1e-9, true);
  // Sanity against the docx: 100 units carried 1,800 of landed cost each.
  check("A's landed share is 180,000 -- 100 units at 1,800",
    Math.abs(a.cogsLanded - 180000) < 1e-6, true);

  // A product bought before the split has NO attribution, and null is not zero.
  const c = byId.get("c");
  check("C has no landed ratio at all", c.landedRatio, null);
  check("...so its goods column is unknown, not zero", c.cogsGoods, null);
  check("...and its landed column too", c.cogsLanded, null);
  check("...but its cost of sales is still known", c.cogs, 100000);
  check("the surface is told how many products lack the split",
    d.productsWithoutLandedSplit, 1);

  // Totals.
  check("total cost of sales", d.totals.cogs, 1180000 + 177000 + 100000);
  check("total revenue", d.totals.revenue, 1900000);
  check("total gross profit", d.totals.grossProfit, 1900000 - (1180000 + 177000 + 100000));
  check("total units", d.totals.unitsSold, 115);
  // The attributed columns sum only what could be attributed, which is why they
  // do not add to the cost-of-sales total -- and why the note says so.
  check("the attributed columns exclude the unattributable product",
    Math.abs(d.totals.cogsGoods + d.totals.cogsLanded - (1180000 + 177000)) < 1e-9, true);

  // Ordered by cost of sales -- this is a costing table.
  check("rows are ordered by cost of sales", d.rows.map((r) => r.productId).join(","), "a,b,c");
}

console.log("\n=== a product with no cost is named, not dropped ===");
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const d = summariseProductProfit({
    sales: [{ createdAt: at(9), items: [
      { productId: "x", name: "Uncosted", qty: 4, lineTotal: 80000 },
      { productId: "y", name: "Costed", qty: 2, lineTotal: 60000 }
    ] }],
    costIndex: buildCostIndex([{ productId: "y", effectiveFrom: at(1), costPrice: 10000 }]),
    purchases: [], monthKey
  });
  const byId = new Map(d.rows.map((r) => [r.productId, r]));
  check("both products appear", d.rows.length, 2);
  check("the uncosted one is flagged", byId.get("x").costKnown, false);
  check("...its average cost is unknown, not zero", byId.get("x").averageCost, null);
  check("...its gross profit is unknown, not the whole of revenue",
    byId.get("x").grossProfit, null);
  check("...and its margin is unknown, not 100%", byId.get("x").grossMarginPct, null);
  check("...while its revenue is still stated", byId.get("x").revenue, 80000);
  check("the count of uncosted products is reported", d.productsWithoutCost, 1);
  check("the costed one is unaffected", byId.get("y").grossProfit, 40000);
}

console.log("\n=== the drill-down counts only the month, and only goods ===");
{
  const monthKey = "2026-09";
  const d = summariseProductProfit({
    sales: [
      { createdAt: new Date(2026, 8, 5, 12, 0, 0),
        items: [{ productId: "a", name: "A", qty: 1, lineTotal: 100 }] },
      // Another month.
      { createdAt: new Date(2026, 7, 5, 12, 0, 0),
        items: [{ productId: "a", name: "A", qty: 99, lineTotal: 9900 }] },
      // Voided: never counted anywhere.
      { createdAt: new Date(2026, 8, 6, 12, 0, 0), voided: true,
        items: [{ productId: "a", name: "A", qty: 50, lineTotal: 5000 }] },
      // A service line has no product to drill into. Two shapes, because the
      // sale-item builder writes the first and only the second would reach the
      // isServiceLine() guard -- and a fixture with only the first cannot tell
      // the two guards apart.
      { createdAt: new Date(2026, 8, 7, 12, 0, 0),
        items: [{ kind: "service", serviceId: "s1", name: "Braiding", qty: 1, lineTotal: 15000 }] },
      { createdAt: new Date(2026, 8, 8, 12, 0, 0),
        items: [{ kind: "service", serviceId: "s2", productId: "a",
                  name: "Braiding", qty: 7, lineTotal: 70000 }] }
    ],
    costIndex: new Map(), purchases: [], monthKey
  });
  check("only this month's sale is counted", d.totals.unitsSold, 1);
  check("a voided sale contributes nothing", d.totals.revenue, 100);
  check("a service line creates no product row", d.rows.length, 1);
}

console.log("\n=== stock valuation is at COST, and says what it could not value ===");
{
  const products = [
    { id: "a", name: "A", quantity: 10, sellingPrice: 3000 },
    { id: "b", name: "B", quantity: 5, sellingPrice: 1000 },
    // Negative stock is real -- an offline oversell is taken and flagged.
    { id: "c", name: "C", quantity: -3, sellingPrice: 500 }
  ];
  const costById = new Map([["a", 2000], ["c", 100]]);
  const v = summariseStockValuation(products, costById);

  check("value at cost counts only what is costed", v.atCost, 20000);
  check("...and never a negative quantity", v.atCost, 10 * 2000);
  check("retail value is reported separately", v.atRetail, 10 * 3000 + 5 * 1000);
  check("a negative shelf still counts in the unit total", v.units, 12);
  check("products with a cost are counted", v.costedProducts, 2);
  check("products without one are counted too", v.uncostedProducts, 1);
  check("...and the units they represent are named", v.uncostedUnits, 5);
  check("the most valuable line sorts first", v.rows[0].id, "a");
  check("an uncosted line reports null value, not zero", v.rows.find((r) => r.id === "b").value, null);

  const empty = summariseStockValuation([], new Map());
  check("an empty shop values at zero, not NaN", empty.atCost, 0);
}

console.log("\n=== the supplier report totals goods and landed without double counting ===");
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const purchases = [
    // Two lines of one delivery: their goods costs add, and their ALLOCATED
    // landed shares must not be counted -- the header carries the freight.
    { supplierName: "Festive Ltd", goodsCost: 5000000, landedCost: 900000,
      totalPaid: 5900000, createdAt: at(3) },
    { supplierName: "festive ltd ", goodsCost: 3000000, landedCost: 540000,
      totalPaid: 3540000, createdAt: at(3) },
    // A legacy purchase with no split: totalPaid is its goods cost.
    { supplierName: "Kilimo Co", totalPaid: 700000, createdAt: at(4) },
    // Another month.
    { supplierName: "Festive Ltd", goodsCost: 999999, landedCost: 1, totalPaid: 1000000,
      createdAt: new Date(2026, 7, 3, 12, 0, 0) }
  ];
  const deliveries = [
    { supplierName: "Festive Ltd", additionalTotal: 1440000, receivedAt: at(3) }
  ];
  const s = summariseSuppliers(purchases, deliveries, monthKey);

  check("suppliers typed inconsistently are one row", s.rows.length, 2);
  check("the busiest supplier sorts first", s.rows[0].name, "Festive Ltd");
  check("goods costs add across that supplier's lines", s.rows[0].goods, 8000000);
  check("landed comes off the delivery, not the lines", s.rows[0].landed, 1440000);
  check("...so the freight is counted exactly once", s.rows[0].total, 9440000);
  check("a legacy purchase counts its total as goods", s.rows[1].goods, 700000);
  check("...and contributes no landed cost", s.rows[1].landed, 0);
  check("last month is excluded", s.total, 9440000 + 700000);
  check("line counts are reported", s.rows[0].purchases, 2);
  check("delivery counts are reported", s.rows[0].deliveries, 1);

  const blank = summariseSuppliers(
    [{ supplierName: "", totalPaid: 5000, createdAt: at(3) },
     { totalPaid: 5000, createdAt: at(3) }], [], monthKey);
  check("a purchase with no supplier makes no row", blank.rows.length, 0);
}


// ===========================================================================
console.log("\n=== returns come off the COST, not only off the revenue ===");
// Found on a live walkthrough, 2026-09-08. Revenue had always been netted
// (summariseSales does `total - refunded`); the cost side had no equivalent, so
// a partial return reduced revenue and left cost untouched. Gross profit read
// LOW by the cost of the returned goods -- and because those goods go back on
// the shelf, they were counted in stock valuation AND in cost of sales at once.
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const costIndex = buildCostIndex([
    { productId: "a", effectiveFrom: at(1), costPrice: 11800 }
  ]);
  // The walkthrough's numbers: 100 units sold at 15,000, 20 returned.
  const sale = {
    createdAt: at(10), total: 1500000, refundedAmount: 300000,
    items: [{ productId: "a", name: "Product A", qty: 100, lineTotal: 1500000 }],
    returns: [{ items: [{ productId: "a", name: "Product A", qty: 20, lineTotal: 300000 }],
                refundAmount: 300000 }]
  };

  const goods = summariseCostOfGoods([sale], costIndex);
  check("cost of goods counts 80 units, not 100", goods.cogs, 80 * 11800);
  check("...which is 236,000 less than before the fix", 100 * 11800 - goods.cogs, 236000);

  const p = summariseProfit({ sales: [sale], costIndex, expenses: [], monthKey,
                              coverageFromMs: null, vatRegistered: false });
  check("revenue is netted, as it always was", p.revenue, 1200000);
  check("COGS is netted too, which it was not", p.cogs, 944000);
  check("gross profit", p.grossProfit, 256000);

  // THE INVARIANT THE DEFECT BROKE. Units returned to the shelf are counted in
  // stock; they must not also be counted in cost of sales.
  const stillOnShelf = 20;
  check("returned units are not in cost of sales",
    goods.cogs + stillOnShelf * 11800, 100 * 11800);

  // A FULLY returned sale contributes nothing, and is not reported as an
  // uncosted line either -- its costedness says nothing about the month.
  const full = summariseCostOfGoods([{
    createdAt: at(11), total: 150000,
    items: [{ productId: "a", name: "Product A", qty: 10, lineTotal: 150000 }],
    returns: [{ items: [{ productId: "a", qty: 10 }] }]
  }], costIndex);
  check("a wholly returned sale costs nothing", full.cogs, 0);
  check("...and is not counted as a costed line", full.costedLines, 0);
  check("...nor as an uncosted one", full.uncostedLines, 0);

  // Over-returning cannot drive cost negative.
  const over = summariseCostOfGoods([{
    createdAt: at(12), total: 150000,
    items: [{ productId: "a", qty: 10, lineTotal: 150000 }],
    returns: [{ items: [{ productId: "a", qty: 99 }] }]
  }], costIndex);
  check("an over-return floors at zero rather than going negative", over.cogs, 0);

  // THE DUPLICATE-LINE TRAP. saleReturnedQtyMap() totals per PRODUCT across the
  // sale, so a naive subtraction takes the whole returned quantity off EVERY
  // line carrying that product. Two lines of 10, five returned, must cost 15
  // units -- not 10, which is what subtracting 5 from each would give.
  const twoLines = summariseCostOfGoods([{
    createdAt: at(13), total: 300000,
    items: [{ productId: "a", qty: 10, lineTotal: 150000 },
            { productId: "a", qty: 10, lineTotal: 150000 }],
    returns: [{ items: [{ productId: "a", qty: 5 }] }]
  }], costIndex);
  check("a product on two lines nets the return ONCE", twoLines.cogs, 15 * 11800);

  // The case Math.min() actually exists for: a return that SPANS both lines.
  // 20 sold across two lines, 15 returned, so 5 units cost the shop money.
  // Without the min, the first line absorbs all 15, goes negative, is skipped by
  // the <= 0 guard, and the second line is charged in full -- 10 units, double
  // what it should be. A control that removed the min came back GREEN against
  // the single-line fixtures above, which is how this gap was found.
  const spanning = summariseCostOfGoods([{
    createdAt: at(14), total: 300000,
    items: [{ productId: "a", qty: 10, lineTotal: 150000 },
            { productId: "a", qty: 10, lineTotal: 150000 }],
    returns: [{ items: [{ productId: "a", qty: 15 }] }]
  }], costIndex);
  check("a return spanning two lines is applied across them", spanning.cogs, 5 * 11800);
  check("...and does not double-charge the second line", spanning.cogs !== 10 * 11800, true);

  // A void is unaffected: the whole sale is skipped before any of this runs.
  const voided = summariseCostOfGoods([{ ...sale, voided: true }], costIndex);
  check("a voided sale still costs nothing", voided.cogs, 0);
}

console.log("\n=== the drill-down nets BOTH sides, so its margin stays honest ===");
{
  const monthKey = "2026-09";
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const costIndex = buildCostIndex([{ productId: "a", effectiveFrom: at(1), costPrice: 11800 }]);
  const d = summariseProductProfit({
    sales: [{ createdAt: at(10), total: 1500000, refundedAmount: 300000,
      items: [{ productId: "a", name: "Product A", qty: 100, lineTotal: 1500000 }],
      returns: [{ items: [{ productId: "a", qty: 20, lineTotal: 300000 }] }] }],
    costIndex,
    purchases: [{ productId: "a", goodsCost: 5000000, landedCost: 900000, createdAt: at(1) }],
    monthKey
  });
  const row = d.rows[0];
  check("units sold are net of the return", row.unitsSold, 80);
  check("revenue is netted in the same proportion", row.revenue, 1200000);
  check("cost of sales is netted", row.cogs, 80 * 11800);
  check("gross profit follows from both", row.grossProfit, 1200000 - 80 * 11800);
  // The row must be internally consistent: netting only one side would leave a
  // margin that disagrees with the two columns beside it.
  check("margin agrees with the row's own revenue and cost",
    row.grossMarginPct, Math.round(((row.revenue - row.cogs) / row.revenue) * 100));
  check("average cost is unchanged by a return", row.averageCost, 11800);
  // The landed attribution still splits the NETTED cost.
  check("goods and landed still add back to the netted cost",
    Math.abs(row.cogsGoods + row.cogsLanded - row.cogs) < 1e-9, true);
}


console.log("\n=== Sales by Product -- the docx section 12 report that was missing ===");
{
  const at = (d) => new Date(2026, 8, d, 12, 0, 0);
  const sales = [
    { createdAt: at(2), items: [
      { productId: "a", name: "Product A", qty: 10, lineTotal: 150000 },
      { productId: "b", name: "Product B", qty: 2, lineTotal: 50000 } ] },
    { createdAt: at(3), items: [
      { productId: "a", name: "Product A", qty: 5, lineTotal: 75000 } ] },
    // Voided: never counted.
    { createdAt: at(4), voided: true, items: [
      { productId: "a", name: "Product A", qty: 99, lineTotal: 1485000 } ] },
    // A service sells too, and a salon wants it in this list.
    { createdAt: at(5), items: [
      { kind: "service", serviceId: "s1", name: "Braiding", qty: 3, lineTotal: 45000 } ] }
  ];
  const s = summariseSalesByProduct(sales);

  check("a voided sale contributes nothing", s.rows.every((r) => r.units !== 99), true);
  check("the same product across two orders is one row", s.rows.filter((r) => r.name === "Product A").length, 1);
  const a = s.rows.find((r) => r.name === "Product A");
  check("...with its units added", a.units, 15);
  check("...its revenue added", a.revenue, 225000);
  check("...and its order count", a.orders, 2);

  // Ordered by REVENUE. Ordering by units would put the cheapest thing on the
  // shelf at the top of every list, which is the opposite of useful when the
  // question is what to buy again.
  check("rows are ordered by revenue", s.rows.map((r) => r.name).join(","),
    "Product A,Product B,Braiding");

  const svc = s.rows.find((r) => r.name === "Braiding");
  check("a service appears", Boolean(svc), true);
  check("...and is marked as one", svc.isService, true);
  check("a product is not marked as a service",
    s.rows.find((r) => r.name === "Product A").isService, false);

  check("total units", s.totalUnits, 15 + 2 + 3);
  check("total revenue", s.totalRevenue, 225000 + 50000 + 45000);

  // Returns come off, the same way every other surface nets them: a product
  // sold and brought back did not sell.
  const withReturn = summariseSalesByProduct([{
    createdAt: at(6),
    items: [{ productId: "a", name: "Product A", qty: 10, lineTotal: 150000 }],
    returns: [{ items: [{ productId: "a", qty: 4 }] }]
  }]);
  check("returned units are not counted as sold", withReturn.rows[0].units, 6);
  check("...and revenue is netted in the same proportion", withReturn.rows[0].revenue, 90000);

  const fullyReturned = summariseSalesByProduct([{
    createdAt: at(7),
    items: [{ productId: "a", name: "Product A", qty: 5, lineTotal: 75000 }],
    returns: [{ items: [{ productId: "a", qty: 5 }] }]
  }]);
  check("a wholly returned line leaves no row at all", fullyReturned.rows.length, 0);

  check("an empty range totals to zero, not NaN", summariseSalesByProduct([]).totalRevenue, 0);
}

console.log("\n=== ...and it stays out of the cost disclosure ===");
{
  const fn = body("function renderSalesByProduct(");
  check("it is manager-and-owner, not owner-strict",
    /if \(!isManagerOrOwnerRole\(\)\) \{/.test(fn), true);
  check("...and empties rather than merely hiding",
    /table\.innerHTML = "";/.test(fn), true);
  // The whole reason this panel can sit on a manager's screen.
  check("it never reads a cost", /costInForceAt|productCostMap|unitCost|costPrice/.test(fn), false);
  check("it reads the SAME range as the payment panel above it",
    /filteredSales\(\)/.test(fn), true);
  check("it is drawn whenever the reports are",
    /renderSalesByProduct\(\);/.test(noComments), true);
}

console.log("\n=== the pruned panels are gone, root and branch ===");
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  for (const id of ["topCustomersTable", "dailyStaffReportDate", "dailyStaffReportButton",
                    "dailyStaffReportResult"]) {
    check(`#${id} is gone from the markup`, html.includes(id), false);
  }
  for (const fn of ["renderTopCustomers", "computeCustomerBreakdown",
                    "renderDailyStaffReport", "computeDailyStaffReport"]) {
    check(`${fn}() is gone from app.js`, src.includes(fn), false);
  }
  for (const key of ["reports.topCustomersTitle", "reports.dailyStaffReportTitle",
                     "reports.dailyStaffReportGrandTotal"]) {
    check(`the dead key ${key} is gone`, src.includes(key), false);
  }
  // Order Lookup STAYS. It looks like the most redundant of the staff panels and
  // is the only route to Return / Refund -- deleting it would remove the returns
  // function from the app.
  check("Order Lookup survives, because it is the returns entry point",
    html.includes("staffOrderLookupButton") && src.includes("data-return-sale"), true);
  // Sold While Offline STAYS: it names which shelves stopped being trustworthy
  // after an outage, which the unsynced banner does not.
  check("Sold While Offline survives", html.includes("offlineSalesReport"), true);
}


console.log("\n=== the Settings view keeps its gates after the move ===");
{
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  const start = html.indexOf('<section class="view" id="settings"');
  check("the settings view exists", start > -1, true);
  const view = html.slice(start, html.indexOf("</section>", html.indexOf("</article>", start)) + 400);

  // Every control moved off the topbar and the dashboard title row. Same ids,
  // so applyStoreOwnerControlsVisibility() and updateAuthUi() still find them --
  // that is what made a change this wide safe in one pass.
  for (const id of ["signOutButton", "downloadBackupButton", "deleteAccountButton",
                    "overridePasswordSettingsButton", "addStoreButton", "renameStoreButton",
                    "setBusinessTypeButton", "setCurrencyButton", "vatSettingsButton",
                    "archiveStoreButton", "langToggleButton", "themeButton"]) {
    check(`#${id} now lives in Settings`, view.includes(`id="${id}"`), true);
  }

  // ...and are GONE from the topbar, or the move only duplicated the clutter.
  const topbar = html.slice(html.indexOf('<header class="topbar"'), html.indexOf("</header>"));
  for (const id of ["signOutButton", "downloadBackupButton", "deleteAccountButton",
                    "overridePasswordSettingsButton", "langToggleButton", "themeButton"]) {
    check(`#${id} is gone from the topbar`, topbar.includes(id), false);
  }
  check("the topbar keeps the identity chip", topbar.includes('id="userEmail"'), true);
  // Add Product was in the topbar AND in the Inventory title row -- the same
  // dialog behind two buttons. The topbar copy is gone: adding a product is an
  // inventory action and belongs on the inventory screen. That styles.css
  // already hid the topbar copy on mobile is the tell that it was always the
  // redundant one.
  check("the duplicate Add Product is gone from the topbar",
    topbar.includes("newProductButton"), false);
  const inventory = html.slice(html.indexOf('<section class="view" id="inventory"'),
                               html.indexOf('<div class="filters">'));
  check("...and Add Product survives where it belongs, on Inventory",
    inventory.includes('id="inventoryAddButton"'), true);
  check("the dead topbar.addProduct key went with it",
    src.includes("topbar.addProduct"), false);

  // The store SWITCHER stays on the dashboard: it scopes every screen and is not
  // a setting. Its six configuration buttons went.
  const dash = html.slice(html.indexOf('<section class="view active" id="dashboard"'),
                          html.indexOf('<div class="kpi-grid" id="kpiGrid">'));
  check("the dashboard keeps the store switcher", dash.includes('id="storeSwitcher"'), true);
  check("...and lost the branch configuration buttons", dash.includes("renameStoreButton"), false);

  // THE GATE ITSELF. The owner-only list is keyed by id, so a button that moved
  // house keeps its gate -- but only while the id stays in this list.
  const gate = body("function applyStoreOwnerControlsVisibility(");
  for (const id of ["renameStoreButton", "setBusinessTypeButton", "setCurrencyButton",
                    "archiveStoreButton", "overridePasswordSettingsButton",
                    "vatSettingsButton", "downloadBackupButton"]) {
    check(`${id} is still owner-gated`, gate.includes(`"${id}"`), true);
  }
  // Sign out and language are deliberately NOT gated: a cashier needs both.
  check("sign out is not owner-gated", gate.includes("signOutButton"), false);
  check("the language toggle is not owner-gated", gate.includes("langToggleButton"), false);
  // The staff panel is owner-only, because /members is owner-only in the rules.
  check("the settings staff panel is hidden for non-owners",
    /settingsStaffPanel[\s\S]{0,120}hidden = !isOwner/.test(noComments), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
