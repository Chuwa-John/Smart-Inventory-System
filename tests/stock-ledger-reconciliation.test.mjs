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

console.log("\n=== an outage is not evidence of theft (L-9 phase B) ===");
{
  // The single most important assertion in the offline work. An offline entry
  // carries a delta and no chain, so there is nothing to compare the shelf
  // against. Reporting that as a gap would mean this control -- built to catch
  // stock leaving without a sale -- firing on every legitimate sale made while
  // the connection was down.
  const offline = { productId: "p1", delta: -3, offline: true, saleId: "s1" };

  const r = reconcileProductStock(product(9), offline);
  eq("a product whose newest entry was made offline is unknown", r.status, "unknown");
  eq("and says why", r.reason, "offline-entry-pending");
  check("no gap figure is offered", r.gap === null, `gap was ${r.gap}`);

  // The shelf has genuinely moved since the last anchor. That is expected, not
  // suspicious, and must not be reported as a discrepancy however large.
  eq("a wildly different shelf is still only unknown",
    reconcileProductStock(product(-40), offline).status, "unknown");

  // Defensive: the rules forbid an offline entry carrying a chain, but a
  // reader that trusted one anyway would reintroduce exactly the false
  // accusation this exists to prevent.
  eq("an offline entry claiming a chain is still not trusted",
    reconcileProductStock(product(2), { ...offline, quantityBefore: 20, quantityAfter: 17 }).status,
    "unknown");

  // A malformed entry missing its chain is unknown rather than NaN-driven.
  eq("an entry with no quantityAfter at all is unknown",
    reconcileProductStock(product(9), { productId: "p1", delta: -3 }).status, "unknown");
}

console.log("\n=== the chain re-anchors at the next online movement ===");
{
  // Entries arrive newest-first, and a queued write is stamped when it lands.
  // A chained entry is written inside a transaction that read the real shelf,
  // so it anchors everything before it -- including offline entries already
  // applied to that shelf. Checking the newest entry alone is therefore enough.
  const movements = [
    { productId: "p1", quantityBefore: 6, delta: 10, quantityAfter: 16 }, // online restock, newest
    { productId: "p1", delta: -3, offline: true },                        // offline sale, older
    { productId: "p1", quantityBefore: 12, delta: -3, quantityAfter: 9 }
  ];
  const latest = latestMovementByProduct(movements);
  eq("an online movement after an outage restores checking",
    reconcileProductStock(product(16), latest.get("p1")).status, "matched");
  eq("and catches a real discrepancy again",
    reconcileProductStock(product(11), latest.get("p1")).status, "mismatch");
  eq("the discrepancy is measured from the new anchor",
    reconcileProductStock(product(11), latest.get("p1")).gap, -5);

  // The reverse order: the outage is the most recent thing that happened.
  const during = latestMovementByProduct([
    { productId: "p1", delta: -3, offline: true },
    { productId: "p1", quantityBefore: 12, delta: -3, quantityAfter: 9 }
  ]);
  eq("while the newest entry is offline, the product stays unknown",
    reconcileProductStock(product(6), during.get("p1")).status, "unknown");
}

console.log("\n=== a mixed catalogue reports only what it can stand behind ===");
{
  const products = [product(9), { id: "p2", quantity: 5 }, { id: "p3", quantity: 40 }];
  const latest = latestMovementByProduct([
    { productId: "p1", delta: -3, offline: true },
    { productId: "p2", quantityBefore: 8, delta: -3, quantityAfter: 5 },
    { productId: "p3", quantityBefore: 50, delta: -3, quantityAfter: 47 }
  ]);
  const statuses = products.map((p) => reconcileProductStock(p, latest.get(p.id)).status);
  check("offline product unknown, clean product matched, short product mismatch",
    statuses[0] === "unknown" && statuses[1] === "matched" && statuses[2] === "mismatch",
    statuses.join(", "));
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

console.log("\n=== every ledger call names a product that actually exists ===");
{
  // This exists because of a real bug that shipped and that nothing caught.
  //
  // The sale path passed `cartItem.productId`. A cart entry is
  // { ...product, qty, sellingPrice } and a product document carries `id` --
  // there is no productId on it. So the field read undefined, the ledger wrote
  // an empty productId, the rule refused it for size() > 0, and because the
  // entry rides inside the sale transaction the rejection took EVERY ONLINE
  // SALE down with it.
  //
  // No test noticed. The emulator suites assert the write SHAPE against the
  // rules using fixtures they build themselves; they never execute the client's
  // sale code, which lives in a DOM event handler and cannot be imported.
  // Structural checks on the call sites are the only cheap defence.
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  check("no call site reads .productId off a cart entry",
    !/productId: cartItem\.productId/.test(noComments),
    "cart entries have id, not productId -- this is the exact bug");

  // The sale's product refs and its ledger entry must name the same thing. If
  // they ever disagree the entry describes a different shelf than the one that
  // moved, which is worse than no entry at all.
  // Deliberately not tied to the source array's NAME. It was `state.cart` and
  // is now a `cart` snapshot taken before the transaction (QA-119, so a retry
  // cannot decrement a basket that has since been edited). What must hold is
  // that both sides read `.id` off the same entry — pinning the variable name
  // failed this check for a rename that fixed a different bug.
  check("the sale's product refs and ledger entry use the same identifier",
    /productRefs = [A-Za-z.]*cart\.map\(\(cartItem\) => doc\([^)]*cartItem\.id\)\)/.test(noComments) &&
    /recordStockMovement\(transaction, \{\s*productId: cartItem\.id/.test(noComments),
    "productRefs uses cartItem.id; the ledger entry must too");

  check("recordStockMovement refuses a missing product or store outright",
    /if \(!fields\.productId \|\| !fields\.storeId\)[\s\S]{0,120}throw new Error/.test(noComments),
    "failing at the rules layer surfaces as a bare permission error with nothing pointing at the cause");

  // Legacy sales predate the storeId requirement -- the void and return rules
  // both tolerate its absence. Without a fallback those paths cannot write a
  // ledger entry, and the entry is inside the transaction, so the refund fails.
  check("returns fall back to the current store for legacy sales",
    /storeId: sale\.storeId \|\| state\.currentStoreId/.test(noComments));
  check("voids fall back the same way",
    /storeId: saleData\.storeId \|\| state\.currentStoreId/.test(noComments));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
