// Opening stock gets a ledger entry.
//
//   node opening-stock-movement.test.mjs
//
// WHY. reconcileProductStock() anchors a shelf against the NEWEST ledger
// entry's quantityAfter, and a product with no entry at all comes back
// "unknown" -- correctly never a discrepancy, but never verified either. So a
// product entered WITH stock sat unverified until it next moved, while the same
// product arriving on a delivery was verified immediately, because
// receiveDelivery() records a restock from an empty shelf.
//
// Two ways to put stock on a shelf should not produce two different
// reconciliation verdicts. That asymmetry is what this closes.
//
// NOT a bug fix: nothing was broken. "unknown" is an honest status, and the
// reconciliation view deliberately refuses to read a missing entry as
// a discrepancy. This moves products from unverified to verified on day one.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

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

// Comments are stripped before any ABSENCE or ORDERING check: prose explaining
// why something is deliberately not done contains the very words such a check
// looks for. See tests/delivery-creates-product.test.mjs for the two times that
// bit in this repo.
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${label}`);
}
function group(name, fn) { console.log(name); fn(); }

const save = code(extract("saveProduct"));

// The opening branch, sliced out so the assertions cannot accidentally read the
// edit-correction branch that sits immediately above it.
const openingAt = save.indexOf("else if (!existing &&");
const openingBranch = openingAt === -1 ? "" : save.slice(openingAt, save.indexOf("\n      }", openingAt));

// ---------------------------------------------------------------------------

group("a product created WITH stock writes an opening entry", () => {
  ok(openingAt > -1, "saveProduct has a create-with-stock branch");
  ok(/recordStockMovement\(\{ set: setDoc \}/.test(openingBranch),
    "it records a stock movement through the same non-transactional shim the correction branch uses");
  ok(/adjustmentReason: "opening"/.test(openingBranch),
    "labelled as opening stock, the way the Adjust dialog labels it");
  ok(/quantityBefore: 0/.test(openingBranch),
    "from an empty shelf -- this product did not exist a moment ago");
  ok(/delta: safeNumber\(product\.quantity\)/.test(openingBranch),
    "and the whole opening quantity is the delta");
});

group("the reason is one firestore.rules actually accepts", () => {
  // Read the allowlist rather than restate it. "opening" is NOT in it, which is
  // the entire reason adjustmentReason exists -- if someone later writes
  // reason: "opening" the rule refuses the write and the entry is silently lost.
  const line = rules.split("\n").find((l) => /d\.reason in \[/.test(l) && /'adjustment'/.test(l));
  ok(Boolean(line), "the stock movement reason allowlist is findable in the rules");
  const allowed = [...(line || "").matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
  ok(allowed.includes("adjustment"), `'adjustment' is allowed (allowlist: ${allowed.join(", ")})`);
  ok(!allowed.includes("opening"),
    "'opening' is NOT allowed as a reason, which is why it rides as adjustmentReason");
  const reasonUsed = openingBranch.match(/reason: "([a-z-]+)"/)?.[1];
  ok(allowed.includes(reasonUsed || ""),
    `the branch writes an allowlisted reason (writes "${reasonUsed}")`);
});

group("it fires only on create, and only above zero", () => {
  ok(/!existing/.test(openingBranch), "guarded on create");
  ok(/safeNumber\(product\.quantity\) > 0/.test(openingBranch), "and on a quantity above zero");
  // A product created at 0 has no units to explain. Since the delivery work the
  // form opens at 0, so this is the common path and must stay silent.
  ok(/else if/.test(save.slice(openingAt - 10, openingAt + 10)),
    "it is an ELSE-IF, so an edit can never fall into the opening branch");
  // The edit branch must be untouched: it is the path every shop already uses.
  ok(/if \(!quantityUntouched && existing\)/.test(save),
    "the existing edit-correction branch is still guarded exactly as before");
  ok(/delta: safeNumber\(product\.quantity\) - safeNumber\(existing\.quantity\)/.test(save),
    "...and still computes its delta from the previous shelf count");
});

group("a failed ledger write cannot cost the shop its product", () => {
  // Non-fatal on purpose, like the correction branch. The product write is a
  // separate setDoc -- there is no shelf to race against, because the product
  // did not exist -- so a failure here leaves the product saved and
  // reconciliation reading "unknown", which is what shipped before this.
  ok(/catch \(ledgerError\)/.test(openingBranch), "the ledger write is wrapped");
  ok(/console\.warn\(/.test(openingBranch), "and the failure is reported rather than swallowed silently");
  ok(!/throw/.test(openingBranch), "it never rethrows into the product save");
});

group("the asymmetry this closes is real", () => {
  // The two facts the whole change rests on, asserted against the source so
  // that if either stops being true this test says so.
  const rec = code(extract("reconcileProductStock"));
  ok(/if \(!latestMovement\) return \{ status: "unknown"/.test(rec),
    "a product with no ledger entry reconciles as unknown, not as a discrepancy");
  ok(/quantityAfter/.test(rec),
    "and a shelf is anchored against the newest entry's quantityAfter");
  const receive = code(extract("receiveDelivery"));
  ok(/quantityBefore: currentQuantity/.test(receive),
    "a delivery already records a movement, which is why delivery-created products were verified and form-created ones were not");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
