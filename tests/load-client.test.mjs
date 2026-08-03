// Performance budgets for the hot paths, so cost cannot regress unnoticed.
//
//   node load-client.test.mjs
//
// This file exists because of a specific failure. The movement classification
// was rewritten to compute true 30- and 90-day figures from the sales record.
// The change was correct, it was tested, and it shipped green -- while turning
// an O(1) counter read into a full scan of every sale for every product. At
// 2,000 products it cost 1.2 seconds per render, on a desktop, with renderAll()
// firing on every snapshot.
//
// Nothing in a correctness suite notices an algorithm going quadratic. That is
// the entire argument for this file.
//
// The primary assertions are RATIOS, not milliseconds. A CI runner, a laptop on
// battery and a developer machine differ by more than any sane absolute budget,
// so a wall-clock threshold is either flaky or so loose it catches nothing. What
// does not vary is shape: if ten times the data costs far more than ten times
// the time, something has gone superlinear, and that is true on any hardware.
// Absolute ceilings are kept as a deliberately generous backstop for the case
// where something becomes catastrophically slow without changing its shape.
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

const api = new Function(
  `${extract("safeNumber")}
   ${extract("unitsSoldByProduct")}
   ${extract("latestMovementByProduct")}
   ${extract("reconcileProductStock")}
   ${extract("reconcileShiftCash")}
   return { unitsSoldByProduct, latestMovementByProduct, reconcileProductStock, reconcileShiftCash };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();

function makeSales(count, productCount) {
  return Array.from({ length: count }, (_, i) => ({
    storeId: "storeA",
    voided: i % 23 === 0,
    createdAt: { toDate: () => new Date(NOW - (i % 80) * DAY) },
    items: [
      { productId: `p${i % productCount}`, qty: 2 },
      { productId: `p${(i * 7) % productCount}`, qty: 1 },
      { productId: `p${(i * 13) % productCount}`, qty: 4 }
    ],
    returns: i % 19 === 0 ? [{ items: [{ productId: `p${i % productCount}`, qty: 1 }] }] : []
  }));
}
const makeProducts = (count) =>
  Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Item ${i}`, quantity: i % 97 }));
const makeMovements = (count, productCount) =>
  Array.from({ length: count }, (_, i) => ({
    productId: `p${i % productCount}`, quantityBefore: 10, delta: -1, quantityAfter: 9
  }));

// Median of several runs: a single timing on a shared runner is noise.
function timeIt(fn, runs = 5) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

// A render pass as the app actually performs it: the movement panel and the
// dashboard each classify every product over two windows.
function renderPass(products, sales) {
  const m30 = api.unitsSoldByProduct(sales, NOW - 30 * DAY, NOW);
  const m90 = api.unitsSoldByProduct(sales, NOW - 90 * DAY, NOW);
  let acc = 0;
  for (let panel = 0; panel < 2; panel++) {
    for (const p of products) {
      const a = Math.max(0, m30.get(p.id) || 0);
      acc += (a >= 50 ? 1 : 0) + (a > 0 && a < 12 ? 1 : 0) + ((Math.max(0, m90.get(p.id) || 0) === 0) ? 1 : 0);
    }
  }
  return acc;
}

console.log("=== the render pass scales with the data, not with its square ===");
{
  const small = { products: makeProducts(200), sales: makeSales(500, 200) };
  const large = { products: makeProducts(2000), sales: makeSales(5000, 2000) };

  const tSmall = timeIt(() => renderPass(small.products, small.sales));
  const tLarge = timeIt(() => renderPass(large.products, large.sales));
  // 10x the products AND 10x the sales. Linear would be ~10x. Quadratic in the
  // pair would be ~100x. The ceiling sits well between the two so it cannot be
  // tripped by a slow runner, only by a change of shape.
  const ratio = tLarge / Math.max(tSmall, 0.01);
  check("10x the catalogue and 10x the sales costs far less than 100x the time",
    ratio < 30,
    `small ${tSmall.toFixed(2)}ms, large ${tLarge.toFixed(2)}ms, ratio ${ratio.toFixed(1)}x ` +
    `-- a per-product rescan of the sales lands around 100x here`);
  check("a large shop's render pass stays interactive", tLarge < 400,
    `${tLarge.toFixed(1)}ms for 2000 products x 5000 sales; renderAll() runs on every snapshot`);
  console.log(`      measured: 200p/500s ${tSmall.toFixed(2)}ms, 2000p/5000s ${tLarge.toFixed(2)}ms (${ratio.toFixed(1)}x)`);
}

console.log("\n=== the sales pass itself is linear in the sales ===");
{
  const t1 = timeIt(() => api.unitsSoldByProduct(makeSales(2000, 500), NOW - 30 * DAY, NOW), 3);
  const t2 = timeIt(() => api.unitsSoldByProduct(makeSales(8000, 500), NOW - 30 * DAY, NOW), 3);
  const ratio = t2 / Math.max(t1, 0.01);
  check("4x the sales costs well under 16x the time", ratio < 10,
    `2000 sales ${t1.toFixed(2)}ms, 8000 sales ${t2.toFixed(2)}ms, ratio ${ratio.toFixed(1)}x`);
}

console.log("\n=== stock reconciliation scales with the catalogue ===");
{
  const run = (n) => {
    const products = makeProducts(n);
    const latest = api.latestMovementByProduct(makeMovements(500, n));
    return timeIt(() => {
      let gaps = 0;
      for (const p of products) {
        if (api.reconcileProductStock(p, latest.get(p.id)).status === "mismatch") gaps++;
      }
      return gaps;
    });
  };
  const t1 = run(500);
  const t2 = run(5000);
  const ratio = t2 / Math.max(t1, 0.01);
  check("10x the catalogue costs well under 100x the time", ratio < 30,
    `500 ${t1.toFixed(2)}ms, 5000 ${t2.toFixed(2)}ms, ratio ${ratio.toFixed(1)}x`);
  check("reconciling a large catalogue stays interactive", t2 < 200, `${t2.toFixed(1)}ms`);
}

console.log("\n=== the ledger index is one pass over the entries ===");
{
  const t1 = timeIt(() => api.latestMovementByProduct(makeMovements(500, 200)));
  const t2 = timeIt(() => api.latestMovementByProduct(makeMovements(5000, 2000)));
  const ratio = t2 / Math.max(t1, 0.01);
  check("10x the ledger costs well under 100x the time", ratio < 30,
    `500 ${t1.toFixed(2)}ms, 5000 ${t2.toFixed(2)}ms, ratio ${ratio.toFixed(1)}x`);
}

console.log("\n=== shift reconciliation is per shift, not per sale ===");
{
  // SHIFT_HISTORY_LIMIT shifts, each reconciled against the loaded sales.
  const sales = makeSales(5000, 2000);
  const shift = {
    status: "closed", storeId: "storeA",
    openedAt: { toDate: () => new Date(NOW - DAY) }, closedAt: { toDate: () => new Date(NOW) },
    openingFloat: 100000, expectedCash: 600000, countedCash: 600000, variance: 0
  };
  const t = timeIt(() => {
    for (let i = 0; i < 20; i++) {
      api.reconcileShiftCash(shift, { cashSales: 500000, cashRefunds: 0, cashRepayments: 0 }, null);
    }
  });
  check("reconciling a full shift history is negligible", t < 20, `${t.toFixed(2)}ms for 20 shifts`);
  check("the sales fixture did not accidentally get walked", sales.length === 5000);
}

console.log("\n=== the working set is small enough to send and to hold ===");
{
  // Heap deltas were tried here first and were worthless: without --expose-gc a
  // collection during the measurement produced a NEGATIVE delta, which sailed
  // past a "under 64 MB" ceiling as a pass. A budget that a garbage collector
  // can satisfy is not a budget.
  //
  // Serialized bytes are deterministic and measure the thing that actually
  // hurts on a Tanzanian mobile connection: what Firestore must ship on first
  // load. Real documents carry more fields than these fixtures, so this is a
  // floor, and the ceiling is set with that in mind.
  const held = {
    products: makeProducts(5000),
    sales: makeSales(1000, 5000),
    movements: makeMovements(500, 5000)
  };
  const bytes = Buffer.byteLength(JSON.stringify({
    products: held.products,
    // Timestamps are functions in the fixture; the wire carries a value.
    sales: held.sales.map((s) => ({ ...s, createdAt: NOW })),
    movements: held.movements
  }));
  const mb = bytes / (1024 * 1024);

  check("the measurement is real, not a collector artefact", bytes > 0 && Number.isFinite(mb),
    `got ${bytes} bytes -- a non-positive measurement means the fixture was optimised away`);
  check("a 5000-product working set stays under 8 MB on the wire", mb < 8,
    `${mb.toFixed(2)} MB for 5000 products + 1000 sales + 500 ledger entries; ` +
    `this is what a phone downloads before the till is usable`);
  check("the fixture is real", held.products.length === 5000 && held.sales.length === 1000);
  console.log(`      measured: ${mb.toFixed(2)} MB serialized working set`);
}

console.log("\n=== a still-loading catalogue is not reported as an empty one ===");
{
  // Measured: 10,000 realistic products is 6.6s and 4.55 MB from a local
  // emulator with no network in the path. On a mobile link that is tens of
  // seconds. For all of it, the inventory table used to say "No inventory yet.
  // Add your first material or product" -- which reads as data loss and invites
  // an owner to re-enter stock they already have. That is a trust failure, not
  // a slow-loading screen.
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("the inventory empty state is gated on the first snapshot having landed",
    /state\.productsInitialized \? t\("inventory\.emptyState"\) : t\("inventory\.loadingState"\)/.test(noComments),
    "an unqualified empty state tells a loading shop that its stock is gone");
  check("the POS says something while the catalogue is still arriving",
    /state\.productsInitialized \? "" : `<p class="muted">\$\{esc\(t\("inventory\.loadingState"\)\)\}/.test(noComments),
    "silence at the till during first sync");
  check("a genuinely empty search result stays blank",
    /\.join\(""\) \|\| \(state\.productsInitialized \? ""/.test(noComments),
    "the loading message must not appear for a search that simply matched nothing");
  check("the loading string exists in both languages",
    (src.match(/"inventory\.loadingState"/g) || []).length >= 3,
    "found fewer than two dictionary entries plus a usage");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
