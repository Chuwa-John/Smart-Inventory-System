// Reconciling a shelf against the stock ledger (L-2).
//
//   node stock-ledger-reconciliation.test.mjs
//
// SECURITY-AUDIT.md F-4 concludes that rules cannot bind a stock decrement to a
// sale -- they authorise one write at a time and cannot see the sale document
// created alongside -- so a cashier can write stock down without recording a
// sale. That is still true. The ledger does not prevent it; it makes it
// visible.
//
// Every movement records the shelf on both sides, and firestore.rules requires
// quantityAfter == quantityBefore + delta. So the newest entry for a product
// states what should be on the shelf. Stock that moved without an entry leaves
// the product's own quantity disagreeing with it, by exactly the amount that
// went missing.
//
// The restraint from shift reconciliation applies here with more force. Every
// product predates the ledger, so on the day this ships nothing has an entry
// and nothing can be checked. A view that read "no entry" as "stock missing"
// would accuse the owner of stealing their entire catalogue on first load.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const { reconcileProductStock, latestMovementByProduct } = new Function(
  `${extract("safeNumber")}
   ${extract("reconcileProductStock")}
   ${extract("latestMovementByProduct")}
   return { reconcileProductStock, latestMovementByProduct };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${expected}, got ${actual}`);

const product = (quantity) => ({ id: "p1", name: "Sugar", quantity });
const entry = (over = {}) => ({ productId: "p1", quantityAfter: 17, quantityBefore: 20, delta: -3, ...over });

console.log("=== a shelf that agrees with its ledger ===");
{
  const r = reconcileProductStock(product(17), entry());
  eq("status is matched", r.status, "matched");
  eq("no gap", r.gap, 0);
}

console.log("\n=== THE CASE THIS EXISTS FOR: stock down, nothing recorded ===");
{
  // The ledger's last word was 17. The shelf says 12. Five units left without
  // a sale, a return, a transfer or a correction naming them.
  const r = reconcileProductStock(product(12), entry({ quantityAfter: 17 }));
  eq("status is mismatch", r.status, "mismatch");
  eq("the gap is the missing stock", r.gap, -5);
  eq("what the ledger expected is reported", r.expected, 17);
  eq("and what is actually there", r.onShelf, 12);
}

console.log("\n=== stock appearing is also a discrepancy ===");
{
  // Less obviously theft, but it means stock arrived with nothing recording it,
  // which is how an unrecorded purchase or a miscount hides.
  const r = reconcileProductStock(product(25), entry({ quantityAfter: 17 }));
  eq("status is mismatch", r.status, "mismatch");
  eq("the gap is signed the other way", r.gap, 8);
}

console.log("\n=== RESTRAINT: no entry is not an accusation ===");
{
  const r = reconcileProductStock(product(40), null);
  eq("a product with no ledger entry is unknown", r.status, "unknown");
  eq("and says why", r.reason, "no-ledger-entry");
  check("no gap figure is offered", r.gap === null, `gap was ${r.gap}`);
}
{
  const r = reconcileProductStock(null, entry());
  eq("a missing product is unknown too", r.status, "unknown");
}
{
  // Every product predates the ledger. On first load this is the whole
  // catalogue, and it must all read as unchecked.
  const products = [product(10), { id: "p2", quantity: 5 }, { id: "p3", quantity: 0 }];
  const latest = latestMovementByProduct([]);
  const statuses = products.map((p) => reconcileProductStock(p, latest.get(p.id)).status);
  check("a catalogue with an empty ledger is entirely unknown",
    statuses.every((s) => s === "unknown"), statuses.join(", "));
}

console.log("\n=== zero is a real quantity, not a missing one ===");
eq("an empty shelf matching an empty ledger entry is matched",
  reconcileProductStock(product(0), entry({ quantityAfter: 0 })).status, "matched");
eq("an empty shelf the ledger says should hold stock is a mismatch",
  reconcileProductStock(product(0), entry({ quantityAfter: 9 })).status, "mismatch");

console.log("\n=== malformed data does not become a number nobody can explain ===");
eq("a non-numeric quantity does not produce NaN status",
  reconcileProductStock({ id: "p1", quantity: "lots" }, entry({ quantityAfter: 0 })).status, "matched");
check("a non-numeric gap is still finite",
  Number.isFinite(reconcileProductStock({ id: "p1", quantity: "lots" }, entry()).gap));
eq("a fractional gap is noise, not a finding",
  reconcileProductStock(product(17.4), entry({ quantityAfter: 17 })).status, "matched");

console.log("\n=== picking the newest entry per product ===");
{
  // Entries arrive newest-first, so the first occurrence of each product wins.
  const movements = [
    { productId: "p1", quantityAfter: 5 },
    { productId: "p2", quantityAfter: 30 },
    { productId: "p1", quantityAfter: 99 },
    { productId: "p3", quantityAfter: 1 },
    { productId: "p2", quantityAfter: 77 }
  ];
  const latest = latestMovementByProduct(movements);
  eq("p1 takes its newest entry", latest.get("p1").quantityAfter, 5);
  eq("p2 takes its newest entry", latest.get("p2").quantityAfter, 30);
  eq("p3 is present", latest.get("p3").quantityAfter, 1);
  eq("only the products seen are present", latest.size, 3);
  eq("an empty ledger yields nothing", latestMovementByProduct([]).size, 0);
  eq("a malformed ledger does not throw", latestMovementByProduct(null).size, 0);
  eq("entries without a productId are skipped",
    latestMovementByProduct([{ quantityAfter: 3 }, { productId: "p9", quantityAfter: 4 }]).size, 1);
}

console.log("\n=== every path that moves stock writes to the ledger ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const calls = (noComments.match(/recordStockMovement\(/g) || []).length;
  // Six movement paths plus the function's own definition: sale, restock,
  // return, void, transfer-out, transfer-in, owner adjustment = 7 calls.
  check("all seven movement sites record", calls >= 8,
    `found ${calls} occurrences including the definition -- a stock path that does not record leaves a permanent gap`);
  for (const reason of ["sale", "restock", "return", "void", "transfer-out", "transfer-in", "adjustment"]) {
    check(`the ${reason} path is wired`, new RegExp(`reason: "${reason}"`).test(noComments));
  }
  check("the ledger write is inside the sale transaction",
    /recordStockMovement\(transaction/.test(noComments),
    "a ledger written outside the transaction can be lost by the crash that makes it matter");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
