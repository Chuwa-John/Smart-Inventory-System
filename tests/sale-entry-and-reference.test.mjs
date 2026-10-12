// Two small defects found while testing the busy day on the preview, and the
// rules that keep them fixed. Neither loses money on its own; both put a wrong
// name or a blank where a shop reads a fact.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const clean = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
const body = (name) => extract(name).replace(/\/\/[^\n]*/g, "");

console.log("\n=== a cleared cart takes its customer with it ===");
{
  // THE DEFECT: completing a sale cleared the customer name and phone; Clear
  // Cart did not. The next walk-in inherited the last customer's name, so the
  // sale was filed under somebody who never bought it -- and on credit it
  // would have gone on their account.
  const reset = body("resetSaleEntry");
  check("resetSaleEntry was located", reset.length > 150, true);
  for (const field of ["#cashTendered", "#posOrderNumber", "#posCustomerName",
                       "#posCustomerPhone", "#creditAmountPaidInput"]) {
    check(`it blanks ${field}`, reset.includes(`"${field}"`), true);
  }
  check("...and puts the credit payment method back to cash",
    /creditAmountPaidMethod"\)\.value = "cash"/.test(reset), true);
  check("it empties the basket", /state\.cart = \[\];/.test(reset), true);
  check("...and the undo history with it", /state\.cartHistory = \[\];/.test(reset), true);
  check("...and the discount", /clearDiscount\(\);/.test(reset), true);

  // ONE reset used by both endings, which is what stops them drifting apart
  // again. They drifted once already.
  check("both endings of a sale use it",
    (clean.match(/resetSaleEntry\(\);/g) || []).length, 2);

  // The guard moved onto the undo push, not the clear: a cashier who typed a
  // name and then thought better of it before adding anything still has a name
  // on screen, and Clear Cart is how they would expect to be rid of it.
  const handler = clean.slice(clean.indexOf('qs("#clearCartButton")'));
  check("an empty basket can still be cleared",
    /if \(state\.cart\.length\) pushCartHistory\(\);\s*\n\s*resetSaleEntry\(\);/.test(handler.slice(0, 400)), true);
  check("...and the old early return is gone",
    /if \(!state\.cart\.length\) return;/.test(handler.slice(0, 400)), false);

  // The held order number is NOT this function's business: a retry of the same
  // basket must keep its number. Releasing it belongs to renderCart's
  // empty-cart rule and to the success path, both of which say so themselves.
  check("it does not touch the held order number",
    /pendingAutoOrderNumber/.test(reset), false);
  check("...which the success path still releases on its own",
    /state\.pendingAutoOrderNumber = "";\s*\n\s*resetSaleEntry\(\);/.test(clean), true);
}

console.log("\n=== a delivery's reference reaches its purchase lines ===");
{
  // THE DEFECT: the delivery dialog's "Invoice or reference" is written to the
  // delivery document. The purchase lines it creates never carried it, so the
  // COGS drill-down's Reference column was blank for every delivery ever
  // recorded -- including the three entered on the preview with references on
  // them, which the Deliveries table showed correctly all along.
  const label = body("purchaseReferenceLabel");
  check("purchaseReferenceLabel was located", label.length > 100, true);

  // The fiscal receipt still wins: it is the number VAT is reclaimed against,
  // and a shop that has one means that one.
  check("a fiscal receipt number wins",
    /if \(purchase\?\.receiptNumber\) return purchase\.receiptNumber;/.test(label), true);
  check("...then the purchase's own reference, for anything that has one",
    /if \(purchase\?\.reference\) return purchase\.reference;/.test(label), true);
  check("...then the reference off the delivery that created the line",
    /\(state\.deliveries \|\| \[\]\)\.find\(\(item\) => item\.id === purchase\.deliveryId\)/.test(label), true);

  // Resolved rather than copied onto the line: firestore.rules pins the
  // purchase keys with hasOnly() and does not admit `reference`, and every
  // purchase already written would have stayed blank anyway.
  check("a line with no delivery resolves to blank, not undefined",
    /if \(!purchase\?\.deliveryId\) return "";/.test(label), true);
  check("...and a delivery outside the held window resolves to blank too",
    /return delivery\?\.reference \|\| "";/.test(label), true);

  // Resolved in the RENDERER, not in computePeriodCogs. That function is pure
  // over its arguments -- cogs-period.test.mjs lifts it into a sandbox and runs
  // the spec worked example through it, and caught the state read at once.
  check("the drill-down row resolves the reference",
    /who: purchaseReferenceLabel\(line\),/.test(clean), true);
  check("...and the statement carries the delivery id so it can",
    /deliveryId: purchase\.deliveryId \|\| "",/.test(clean), true);
  check("...while the statement itself stays pure",
    /purchaseReferenceLabel/.test(body("computePeriodCogs")), false);
}

console.log("\n=== the rules were not touched ===");
{
  // Both fixes are deliberately client-side. A rules change to admit a new
  // purchase key would have shipped a migration for eight live shops to fix a
  // blank column, and would not have fixed a single purchase already written.
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  check("the purchase key allowlist still does not admit reference",
    /'reference'/.test(rules.slice(rules.indexOf("function validPurchase()"),
                                   rules.indexOf("function validPurchaseCreate()"))), false);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
