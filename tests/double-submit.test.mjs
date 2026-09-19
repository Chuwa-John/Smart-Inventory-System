// One tap, one write.
//
//   node double-submit.test.mjs
//
// The tills run on cheap Android handsets where a repaint lags behind the
// finger. A button that has already been pressed still looks unpressed, gets
// pressed again, and the handler runs twice. Nothing on screen says so, and
// nothing in the database refuses it: two payments of the same amount are two
// legitimate payments, two stock adjustments are two legitimate corrections.
// The only place this can be stopped is the click.
//
// These checks are about the WRITE paths where a double costs money or moves
// the shelf. A double-tapped "open dialog" is harmless and is not covered.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

function bodyOf(name) {
  const start = src.indexOf(name);
  if (start === -1) return "";
  const end = src.indexOf("\n}\n", start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

console.log("=== the guard itself ===");
{
  const body = bodyOf("async function guardedClick(");
  check("guardedClick() exists", body.length > 0);
  check("a second press while the first is running does nothing",
    /if \(button\.disabled\) return;/.test(body),
    "this is the whole point: the second tap must not run the handler again");
  check("the button is disabled before the handler runs",
    body.indexOf("button.disabled = true") < body.indexOf("return await run()"),
    "disabled after the await is a guard that guards nothing");
  check("the handler is awaited",
    /return await run\(\);/.test(body),
    "without the await the guard releases while the write is still in flight");

  // A till that locks its own button after a dropped connection is worse than
  // the double it was guarding against.
  check("the button is released in a finally, so a failed write stays retryable",
    /\} finally \{[\s\S]{0,80}button\.disabled = false;/.test(body));

  // Callers that pass no button must still run, or guarding a path with no
  // button silently drops the write.
  check("a missing button runs the handler rather than swallowing it",
    /if \(!button\) return run\(\);/.test(body));
}

console.log("\n=== every write where a double costs money or moves stock ===");
{
  // Each entry is a call site, not a function body: the guard is applied where
  // the click is handled, which keeps the writers themselves pure.
  const guarded = [
    ["a payment", /guardedClick\(event\.currentTarget, confirmRecordPayment\)/,
      "two taps would record the money twice, and neither payment is individually wrong"],
    ["issuing an invoice", /guardedClick\(issue, \(\) => issueInvoice\(/,
      "it mints a gapless number, moves the stock and creates the debt"],
    ["voiding an invoice", /guardedClick\(voidIt, \(\) => voidInvoice\(/,
      "a second void would put the stock back twice"],
    ["a stock adjustment", /guardedClick\(event\.submitter, \(\) => recordStockAdjustment\(/,
      "two taps correct the shelf twice, and reconcileProductStock() then reports the gap as unaccounted"],
    ["saving an invoice draft", /guardedClick\(event\.submitter, \(\) => saveInvoiceDraft\(/,
      "two drafts for one invoice"]
  ];
  for (const [what, pattern, why] of guarded) {
    check(`${what} is guarded against a double tap`, pattern.test(src), why);
  }

  // The form submitters read their fields BEFORE awaiting. The guard disables
  // the submitter and the write may close the dialog, so a handler that
  // re-read the form afterwards would read a form that is no longer there.
  for (const form of ["invoiceForm", "stockAdjustForm"]) {
    const handler = src.slice(src.indexOf(`qs("#${form}")?.addEventListener("submit"`));
    const body = handler.slice(0, handler.indexOf("});"));
    check(`${form} reads its fields before the guard awaits`,
      body.indexOf("new FormData") < body.indexOf("guardedClick("),
      "reading the form after the await reads a dialog the write may have closed");
  }
}

console.log("\n=== the paths that already guarded themselves still do ===");
{
  // These predate guardedClick() and use the same shape inline. They are not
  // being converted -- the point is that they must not LOSE the guard.
  check("a stock transfer still guards its confirm button",
    /const confirmButton = qs\("#confirmTransferButton"\);[\s\S]{0,120}confirmButton\.disabled = true;/.test(src),
    "one SKU on two shelves is the failure this prevents");
  check("saving an expense still guards its button",
    /disabled = true/.test(bodyOf("async function saveExpense(")));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
