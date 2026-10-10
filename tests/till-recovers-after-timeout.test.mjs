// Two defects found by driving a full trading day through the preview till on
// 2026-10-09, and the rules that keep them fixed.
//
// Both are the same shape: a figure the shop can see says one thing, and the
// money went somewhere else. Neither threw, neither logged, and the app told
// the shopkeeper something reassuring in both cases.

import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
// Comments stripped before anything is counted: this file has been caught the
// other way round before, by a comment that NAMED the thing it explained and
// satisfied a scan meant to find the code.
const src = app.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, actual, expected) {
  const pass = actual === expected;
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${expected}, got ${actual}`);
}

// Counts braces from the one that opens the BODY, not from the first `{` in
// the source -- `receiveDelivery(input = {})` has a default in its parameter
// list, and starting at that one captures `async function receiveDelivery(input
// = {}` and nothing else. Every check against the body then passes vacuously,
// which is why "was located" is asserted before any of them. The same trap is
// written up against periodBounds() in profit-chart.test.mjs.
function body(signature) {
  const start = src.indexOf(signature);
  if (start === -1) return "";
  const open = src.indexOf("{", start + signature.lastIndexOf(")"));
  if (open === -1) return "";
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return "";
}

console.log("\n=== one unconfirmed sale must not stop the till ===");
{
  // WHAT HAPPENED: a sale timed out, the client said "not confirmed, check the
  // sales list", and the write had in fact landed. The held auto order number
  // was released only on the success path, so the NEXT cart reused it, the
  // sale id derived from it resolved to the document that already existed, and
  // the sale was refused as a duplicate. Every sale after that failed the same
  // way. Reproduced end to end: the refused sale was absent from Sales by
  // Product and the stock never moved.
  //
  // The number still has to survive a RETRY of the same cart -- that is what
  // makes a double-tap idempotent instead of selling the stock twice. So the
  // rule is about the cart, not about the outcome: an empty cart holds no
  // number, a cart with lines in it keeps the one it has.
  const cart = body("function renderCart() {");
  check("renderCart was located", cart.length > 500, true);
  check("an empty cart releases the held order number",
    /if \(!state\.cart\.length\) state\.pendingAutoOrderNumber = "";/.test(cart), true);

  // Deliberately NOT in clearCart(): the cart also empties by removing the
  // last line and by decrementing it to zero, and a rule that only clearCart
  // knows about is one those two paths do not get.
  check("...and it is the render, not just the Clear Cart button",
    /clearCartButton[\s\S]{0,260}pendingAutoOrderNumber/.test(src), false);

  // The two places a cart is abandoned outright rather than emptied by hand.
  check("switching branch releases it",
    /state\.currentStoreId = storeId;\s*\n\s*state\.pendingAutoOrderNumber = "";/.test(src), true);
  check("signing out releases it",
    /state\.cart = \[\];\s*\n\s*state\.pendingAutoOrderNumber = "";\s*\n\s*state\.sales = \[\];/.test(src), true);

  // The mint is unchanged: one number per cart, reused while that cart stands.
  check("a cart still mints at most one number",
    /if \(!orderNumberRaw && !state\.pendingAutoOrderNumber\) \{/.test(src), true);
  check("...and the sale id is still derived from it, so a retry is idempotent",
    /const saleId = duplicate \? `\$\{dedupeSaleId\}_dup\$\{Date\.now\(\)\}` : dedupeSaleId;/.test(src), true);
}

console.log("\n=== a credit delivery must put its debt somewhere ===");
{
  // WHAT HAPPENED: "You owe suppliers" and Supplier Balances both read the
  // stored supplier.balanceOwed. receiveDelivery only moved that balance when
  // the typed supplier name matched an existing RECORD, and the delivery form
  // takes free text. So a delivery taken on credit from an unmatched name
  // recorded the debt on the delivery document -- the Deliveries table showed
  // "On credit TZS 920,500" -- and it reached no balance at all. Measured:
  // 1,466,500 owed, 580,000 shown.
  const recv = body("async function receiveDelivery(input = {}) {");
  check("receiveDelivery was located", recv.length > 1000, true);

  check("an unmatched name with a debt mints a supplier",
    /const newSupplier = !supplierLink\.supplierId && typedSupplier && amountDue > 0/.test(recv), true);

  // The narrow part, and the reason this is not just "always create one". A
  // delivery paid in full needs no balance, so nothing is minted and a typo
  // stays on one delivery instead of becoming a supplier for ever.
  check("...and a delivery paid in full mints nothing", /amountDue > 0/.test(recv), true);
  check("a blank supplier name still mints nothing",
    /typedSupplier && amountDue > 0/.test(recv), true);

  // Inside the transaction, so a delivery that fails leaves no supplier.
  check("the record is created inside the transaction",
    /} else if \(newSupplier\) \{\s*\n\s*transaction\.set\(supplierRef, \{/.test(recv), true);
  check("...with the whole debt as its balance",
    /openingBalance: 0,\s*\n\s*balanceOwed: amountDue,/.test(recv), true);
  check("...and active, which the rules require",
    /balanceOwed: amountDue,\s*\n\s*active: true,/.test(recv), true);

  // An existing record is still updated, not replaced -- its balance carries.
  check("a matched supplier is still updated, not overwritten",
    /balanceOwed: safeNumber\(supplierSnap\.data\(\)\.balanceOwed\) \+ amountDue,/.test(recv), true);
  // A name that matched a record which has since been deleted is still an
  // error, not a silent new supplier.
  check("a vanished record is still refused",
    /txerror\.supplierGone/.test(recv), true);

  // The delivery and every purchase line carry whichever id we ended with, so
  // a record created here is reachable from the delivery that created it.
  check("the delivery links to the id actually used",
    /\.\.\.supplierLinkOut,\s*\n\s*amountPaid,/.test(recv), true);
  check("...and so does every purchase line",
    /supplierName: String\(input\.supplierName\)\.slice\(0, 120\) \} : \{\}\),\s*\n\s*\.\.\.supplierLinkOut,/.test(recv), true);
  check("nothing still writes the pre-fix link object",
    /\.\.\.supplierLink,/.test(recv), false);
}

console.log("\n=== what the fixes must not have changed ===");
{
  // The stored balance is stored for a reason: subscribeToDeliveries is
  // bounded, so adding up the deliveries a client happens to hold would
  // understate the debt. Nothing here may start summing history instead.
  check("the dashboard tile still reads the stored balance",
    /\.reduce\(\(sum, supplier\) => sum \+ safeNumber\(supplier\.balanceOwed\), 0\)/.test(src), true);
  check("Supplier Balances still reads the stored balance",
    /owed: safeNumber\(supplier\.balanceOwed\)/.test(src), true);
  // Name matching is untouched: an existing record still wins.
  check("supplierLinkFor still matches by name, case-insensitively",
    /String\(supplier\.name \|\| ""\)\.trim\(\)\.toLowerCase\(\) === wanted/.test(src), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
