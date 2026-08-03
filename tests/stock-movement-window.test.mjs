// What "sold in the last 30 days" actually means.
//
//   node stock-movement-window.test.mjs
//
// products.sold30 and products.sold90 are named for time windows they have
// never had. Every write to them in app.js is one of three things -- add the
// quantity on a sale, subtract it on a return, subtract it on a void -- and
// nothing anywhere decays them. Not in app.js, not in proxy/server.js, not in
// functions/. They are lifetime net-sold counters with 30- and 90-day names.
//
// Four decisions were being made on that:
//
//   - "Fast moving" is sold30 >= 50, so a product that sold 50 units over three
//     years reads as fast moving forever. The classification only ever moves
//     one way, so given enough time every product becomes fast moving and the
//     movement chart stops meaning anything -- worst for the longest-standing
//     shops, which is exactly backwards.
//   - "Slow moving" is 0 < sold30 < 12, so products age out of it permanently.
//   - Restock ranking sorts by sold30, so old stock outranks genuinely fast
//     stock and the reorder advice drifts.
//   - The AI advisor is handed sold30/sold90 under those names and reasons
//     about "recent demand" from lifetime totals.
//
// unitsSoldInWindow() computes the figure from the sales record instead, which
// is the only place the real answer lives. The stored counters are left alone:
// firestore.rules validates writes against them and they are still a true
// lifetime total -- they were only ever mislabelled, not wrong.
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

const { unitsSoldInWindow, unitsSoldByProduct } = new Function(
  `${extract("safeNumber")}
   ${extract("unitsSoldByProduct")}
   ${extract("unitsSoldInWindow")}
   return { unitsSoldInWindow, unitsSoldByProduct };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
const eq = (name, actual, expected) =>
  check(name, actual === expected, `expected ${expected}, got ${actual}`);

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-02T12:00:00Z").getTime();
const FROM = NOW - 30 * DAY;
const at = (ms) => ({ toDate: () => new Date(ms) });

const sale = (over = {}) => ({
  storeId: "storeA", voided: false, createdAt: at(NOW - DAY),
  items: [{ productId: "p1", qty: 3 }],
  ...over
});

const sold = (sales, id = "p1") => unitsSoldInWindow(sales, id, FROM, NOW);

console.log("=== counting what was sold ===");
eq("a single sale counts its quantity", sold([sale()]), 3);
eq("several sales add up", sold([sale(), sale(), sale()]), 9);
eq("other products are not counted", sold([sale({ items: [{ productId: "p2", qty: 99 }] })]), 0);
eq("multiple line items in one sale are counted separately",
  sold([sale({ items: [{ productId: "p1", qty: 2 }, { productId: "p2", qty: 40 }, { productId: "p1", qty: 5 }] })]), 7);

console.log("\n=== the window is the point ===");
eq("a sale before the window is excluded", sold([sale({ createdAt: at(NOW - 31 * DAY) })]), 0);
eq("a sale long before the window is excluded -- this is the whole bug",
  sold([sale({ createdAt: at(NOW - 3 * 365 * DAY), items: [{ productId: "p1", qty: 500 }] })]), 0);
eq("a sale exactly on the boundary is included", sold([sale({ createdAt: at(FROM) })]), 3);
eq("a sale in the future is excluded", sold([sale({ createdAt: at(NOW + DAY) })]), 0);

console.log("\n=== a sale that did not really happen does not count ===");
eq("a voided sale is excluded", sold([sale({ voided: true })]), 0);
eq("a voided sale among live ones is excluded", sold([sale(), sale({ voided: true }), sale()]), 6);

console.log("\n=== returns come back off ===");
eq("a fully returned line nets to zero",
  sold([sale({ returns: [{ items: [{ productId: "p1", qty: 3 }] }] })]), 0);
eq("a partial return nets down",
  sold([sale({ items: [{ productId: "p1", qty: 10 }], returns: [{ items: [{ productId: "p1", qty: 4 }] }] })]), 6);
eq("several returns against one sale all count",
  sold([sale({ items: [{ productId: "p1", qty: 10 }],
    returns: [{ items: [{ productId: "p1", qty: 2 }] }, { items: [{ productId: "p1", qty: 3 }] }] })]), 5);
eq("a return of a different product does not reduce this one",
  sold([sale({ returns: [{ items: [{ productId: "p2", qty: 3 }] }] })]), 3);
check("returns cannot drive the figure negative",
  sold([sale({ items: [{ productId: "p1", qty: 1 }], returns: [{ items: [{ productId: "p1", qty: 99 }] }] })]) >= 0,
  "a negative units-sold figure would classify a product as never sold");

console.log("\n=== malformed data does not become a number nobody can explain ===");
eq("no sales at all is zero", sold([]), 0);
eq("a sale with no items is zero", sold([sale({ items: undefined })]), 0);
eq("a sale with no timestamp is skipped", sold([sale({ createdAt: null })]), 0);
eq("a non-numeric quantity does not produce NaN",
  sold([sale({ items: [{ productId: "p1", qty: "three" }] })]), 0);
eq("a malformed returns field is ignored, not fatal",
  sold([sale({ returns: "yesterday" })]), 3);

console.log("\n=== the mislabelled counters are no longer what decisions read ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The classification and ranking sites must go through the window function.
  check("movement classification no longer reads product.sold30 directly",
    !/filter\(\(p\) => Number\(p\.sold30/.test(noComments),
    "renderMovement/dashboard still classify on the lifetime counter");
  check("the AI payload sends a real window, not the counter",
    !/sold30: Number\(product\.sold30 \|\| 0\)/.test(noComments),
    "the advisor is still told a lifetime total under a 30-day name");
  check("unitsSoldInWindow is actually used", /unitsSoldInWindow\(/.test(noComments));
  // The stored counters stay: rules validate stock writes against them.
  check("the sale path still maintains the stored counter",
    /sold30: currentSold30 \+ cartItem\.qty/.test(noComments),
    "validStockMovementUpdate in firestore.rules expects these fields to keep moving");
}

console.log("\n=== one pass over the sales, not one per product ===");
{
  // The movement panel and the dashboard each classify every product three
  // times. When that meant rescanning every sale per product, a 200-product
  // shop with 1000 sales cost 201ms per render and 2000 products cost 1.2s --
  // with renderAll() firing on every snapshot. The map version is O(sales)
  // regardless of catalogue size, so the two must agree exactly.
  const DAY2 = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const many = Array.from({ length: 400 }, (_, i) => ({
    voided: i % 17 === 0,
    createdAt: { toDate: () => new Date(now - (i % 45) * DAY2) },
    items: [{ productId: `p${i % 25}`, qty: 2 }, { productId: `p${(i * 3) % 25}`, qty: 1 }],
    returns: i % 11 === 0 ? [{ items: [{ productId: `p${i % 25}`, qty: 1 }] }] : []
  }));
  const from = now - 30 * DAY2;
  const map = unitsSoldByProduct(many, from, now);
  let agreed = true;
  for (let i = 0; i < 25; i++) {
    const id = `p${i}`;
    if (Math.max(0, map.get(id) || 0) !== unitsSoldInWindow(many, id, from, now)) agreed = false;
  }
  check("the map and the single-product read agree on every product", agreed,
    "the two must not be able to drift about what a return or a void means");
  check("products never sold are simply absent", !map.has("p_never_sold"));

  // Guards the O(sales) property itself: 40x the catalogue must not cost 40x.
  const products = Array.from({ length: 40 }, (_, i) => `p${i % 25}`);
  const t0 = performance.now();
  const m = unitsSoldByProduct(many, from, now);
  for (const id of products) m.get(id);
  const oncePass = performance.now() - t0;
  const t1 = performance.now();
  for (const id of products) unitsSoldInWindow(many, id, from, now);
  const perProduct = performance.now() - t1;
  check("reading 40 products from one map beats 40 rescans", oncePass < perProduct,
    `map ${oncePass.toFixed(1)}ms vs rescan ${perProduct.toFixed(1)}ms`);
}

console.log("\n=== the classification sites use the cached read ===");
{
  const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  check("productUnitsSold caches per sales snapshot",
    /unitsSoldCache/.test(noComments) && /unitsSoldCache\.sales !== sales/.test(noComments),
    "without a cache each classification rebuilds the map from scratch");
  check("no classification site calls unitsSoldInWindow in a loop",
    !/filter\(\(p\) => unitsSoldInWindow/.test(noComments),
    "unitsSoldInWindow builds a whole map per call and must not be used per product");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
