// Phase 6 — QA-107, QA-119, QA-121: three ways the till stops serving a
// customer who is standing in front of it.
//
//   node sale-path-resilience.test.mjs
//
// QA-110/QA-120 are covered behaviourally in credit-override.test.mjs, and
// QA-114 in offline-selling.test.mjs, next to the assertions they belong with.
//
// The shared shape: each of these is a correct decision applied in the wrong
// place. A timeout that exists on the AI path and not on the sale path. A
// snapshot taken for the sale record but not for the product refs. An oversell
// policy agreed in the rules and never carried into the cart.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = app.indexOf("(", start), parens = 0;
  for (; i < app.length; i++) {
    if (app[i] === "(") parens++;
    else if (app[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  let depth = 0;
  i = app.indexOf("{", i);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

// Comments stripped before every match. Several assertions in this codebase
// have passed by matching an explanatory note instead of the code under it.
const strip = (s) => s.replace(/\/\/[^\n]*/g, "");

console.log("=== nothing on the sale path waits forever (QA-107) ===");
{
  const fn = strip(extractFn("verifyOverridePassword"));

  check("the override check has a timeout", /AbortSignal\.timeout\(/.test(fn),
    "a bare fetch() has none, and this call is awaited AFTER Complete Sale is disabled — "
    + "against a cold Render instance the button froze for minutes with a queue at the counter");

  const budget = Number(app.match(/const OVERRIDE_VERIFY_TIMEOUT_MS = (\d+);/)?.[1] ?? 0);
  check("the budget is short", budget > 0 && budget <= 15000, `${budget}ms`);

  const aiBudget = Number(app.match(/const AI_PROXY_TIMEOUT_MS = (\d+);/)?.[1] ?? 0);
  check("...and much shorter than the AI budget", budget < aiBudget, `${budget}ms vs ${aiBudget}ms`,);
  check("the AI budget was found, so that comparison means something", aiBudget > 0, `${aiBudget}`);

  // A timeout that resolves to "authorised" would be worse than none.
  check("a failure refuses the override", /return false;\n\s*\}$/.test(fn) || /catch \(error\)/.test(fn));
  const catchBlock = fn.slice(fn.indexOf("catch (error)"));
  check("...including a timeout", /return false/.test(catchBlock),
    "failing open here would hand out overrides whenever the proxy is asleep");

  check("the hot path no longer forces a token refresh",
    !/getIdToken\(\/\* forceRefresh \*\/ true\)/.test(fn),
    "an extra round trip on the sale path, and a guaranteed failure with no connection");
}

console.log("\n=== the transaction cannot decrement a cart that has moved (QA-119) ===");
{
  const handler = (() => {
    const marker = 'qs("#completeSaleButton").addEventListener("click"';
    const start = app.indexOf(marker);
    let depth = 0, i = app.indexOf("{", start + marker.length - 1);
    for (; i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}") { depth--; if (depth === 0) break; }
    }
    return strip(app.slice(start, i + 1));
  })();

  check("the cart is snapshotted once", /const cart = state\.cart\.map\(\(cartItem\) => \(\{ \.\.\.cartItem \}\)\)/.test(handler),
    "Firestore retries a transaction callback on contention while the POS stays interactive");

  // The transaction CALLBACK specifically — this is what a retry re-executes.
  // Slicing to the end of the handler instead caught the post-sale cleanup
  // (`state.cart = []`), which is correct code and made this fail for the wrong
  // reason. Brace-matched from the callback's own opening brace.
  const tx = (() => {
    const at = handler.indexOf("runTransaction");
    let depth = 0, i = handler.indexOf("{", handler.indexOf("=>", at));
    for (let k = i; k < handler.length; k++) {
      if (handler[k] === "{") depth++;
      else if (handler[k] === "}") { depth--; if (depth === 0) { i = k; break; } }
    }
    return handler.slice(at, i + 1);
  })();
  check("the transaction callback was located", tx.length > 500 && tx.length < handler.length,
    `${tx.length} of ${handler.length} chars`);
  check("the transaction reads no live cart", !/state\.cart/.test(tx),
    "a cart edited during a retry decremented different products than the sale record listed");
  // Since DESIGN-services.md Phase B the refs map stockCart, which is the
  // snapshot with service lines removed. The property is unchanged: whatever is
  // mapped must derive from the snapshot, never from state.cart.
  check("...and builds its product refs from the snapshot",
    /const stockCart = cart\.filter\(/.test(tx) && /productRefs = stockCart\.map\(\(cartItem\) => doc\(/.test(tx),
    "stockCart must come from the cart snapshot, and the refs from stockCart");
  check("...and indexes the snapshot, not the live array", !/state\.cart\[index\]/.test(tx));

  // The snapshot must be taken before anything derives from it.
  const snapAt = handler.indexOf("const cart = state.cart.map");
  const itemsAt = handler.indexOf("const saleItems = cart.map");
  check("the snapshot precedes the sale lines built from it",
    snapAt !== -1 && itemsAt !== -1 && snapAt < itemsAt);
  check("the tax lines come from the same snapshot", /computeSaleTax\(\s*\n?\s*cart\.map/.test(handler),
    "taxing a different basket than the one being charged is the same bug wearing a different hat");
}

console.log("\n=== offline, a stale shelf count does not refuse a customer (QA-121) ===");
{
  const fn = strip(extractFn("addProductToCartById"));

  check("a zero count only blocks when online", /product\.quantity <= 0 && !isOfflineNow\(\)/.test(fn),
    "offline the count is a cache that may be hours old — refusing on it turns a stale number "
    + "into a refused customer holding the item, which is the outcome L-9 phase A rejected");

  const overBranch = fn.slice(fn.indexOf("existingQty + requestedQty > product.quantity"));
  check("exceeding the cached count is refused online", /if \(!isOfflineNow\(\)\)/.test(overBranch));
  check("...and taken offline, with the cashier told why",
    /toast\.offlineStockUncertain/.test(overBranch),
    "taken silently, the cashier cannot explain a shelf that later disagrees");

  // The policy only works because the rules already allow the shelf to go
  // negative. If that were ever tightened, this would start failing sales.
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  check("the rules still permit a negative shelf", /v >= -1000000/.test(rules),
    "the cart policy depends on it; without it these sales are rejected at replay");

  for (const key of ["toast.offlineStockUncertain"]) {
    const n = [...app.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g"))].length;
    check(`${key} is defined in both languages`, n === 2, `found ${n}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
