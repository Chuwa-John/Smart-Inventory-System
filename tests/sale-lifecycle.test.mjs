// Guards QA-006 and QA-007 — two ways the sale lifecycle leaked money or
// invented stock. Both are driven through the REAL functions extracted from
// app.js, along the exact sequences that reproduced them.
//
//   node sale-lifecycle.test.mjs
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

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// --- harness: the app globals these functions close over -------------------
const state = { discountType: "none", discountValue: 0, discountBasis: 0, cart: [] };
const toasts = [];
const env = {
  state,
  cartSubtotal: () => state.cart.reduce((sum, i) => sum + i.qty * i.price, 0),
  qs: () => null,                    // no DOM in this harness
  showToast: (msg) => toasts.push(msg),
  t: (key) => key
};
const build = (names, extra = "") => new Function(
  ...Object.keys(env),
  `${names.map(extract).join("\n")}\n${extra}\nreturn { ${names.join(", ")} };`
)(...Object.values(env));

const { computeDiscountAmount, clearDiscount, revalidateDiscountForCart, saleReturnedQtyMap } =
  build(["computeDiscountAmount", "clearDiscount", "revalidateDiscountForCart", "saleReturnedQtyMap"]);

const totalNow = () => {
  revalidateDiscountForCart();
  const subtotal = env.cartSubtotal();
  return Math.max(0, subtotal - computeDiscountAmount(subtotal));
};

console.log("=== QA-006: a fixed discount must not outlive the basket it was authorised for ===");
{
  state.cart = [{ qty: 1, price: 60000 }];
  state.discountType = "fixed"; state.discountValue = 50000; state.discountBasis = 60000;
  check("as authorised, the discount applies in full", totalNow() === 10000, `total=${totalNow()}`);

  // The reproduction: swap the expensive line for a cheap one.
  state.cart = [{ qty: 1, price: 10000 }];
  const total = totalNow();
  check("shrinking the basket does not make the sale free", total === 10000, `total=${total}`);
  check("the discount was cleared, not merely capped", state.discountType === "none");
  check("the operator is told why", toasts.includes("toast.discountClearedCartChanged"));
  check("the authorising basis is reset too", state.discountBasis === 0);
}

console.log("\n=== the fix must not punish legitimate use ===");
{
  toasts.length = 0;
  state.cart = [{ qty: 1, price: 60000 }];
  state.discountType = "fixed"; state.discountValue = 50000; state.discountBasis = 60000;
  state.cart = [{ qty: 1, price: 60000 }, { qty: 1, price: 5000 }];   // basket GROWS
  check("adding to the basket keeps the discount", totalNow() === 15000, `total=${totalNow()}`);
  check("no spurious warning on a growing basket", toasts.length === 0);

  // Percent scales with the basket, so it is deliberately left alone.
  state.discountType = "percent"; state.discountValue = 50; state.discountBasis = 0;
  state.cart = [{ qty: 1, price: 10000 }];
  check("a percent discount survives a shrinking basket", totalNow() === 5000, `total=${totalNow()}`);
  check("...and is never cleared by revalidation", state.discountType === "percent");
}

console.log("\n=== an authorised 100%-off item still works ===");
{
  state.cart = [{ qty: 1, price: 20000 }];
  state.discountType = "fixed"; state.discountValue = 20000; state.discountBasis = 20000;
  check("free-of-charge stays free when the basket is unchanged", totalNow() === 0);
  check("...and is not cleared", state.discountType === "fixed");
}

console.log("\n=== QA-007: voiding a sale that has returns must not invent stock ===");
{
  // The restore arithmetic now in undoLastSale, applied to the reproduction.
  const restore = (saleData, itemQty, productId) => {
    const alreadyReturned = saleReturnedQtyMap(saleData).get(productId) || 0;
    return Math.max(0, Number(itemQty || 0) - alreadyReturned);
  };

  const sold10 = { items: [{ productId: "p1", qty: 10 }], returns: [] };
  check("a clean sale restores everything it sold", restore(sold10, 10, "p1") === 10);

  const partlyReturned = {
    items: [{ productId: "p1", qty: 10 }],
    returns: [{ items: [{ productId: "p1", qty: 3 }] }]
  };
  const net = restore(partlyReturned, 10, "p1");
  check("a partial return is netted off the void", net === 7, `restored ${net}, expected 7`);
  check("total returned to stock equals what left it", 3 + net === 10, `3 + ${net}`);

  const fullyReturned = {
    items: [{ productId: "p1", qty: 10 }],
    returns: [{ items: [{ productId: "p1", qty: 10 }] }]
  };
  check("a fully returned sale restores nothing further", restore(fullyReturned, 10, "p1") === 0);

  const overReturned = {
    items: [{ productId: "p1", qty: 10 }],
    returns: [{ items: [{ productId: "p1", qty: 4 }] }, { items: [{ productId: "p1", qty: 6 }] }]
  };
  check("returns across several events accumulate", restore(overReturned, 10, "p1") === 0);

  const mixed = {
    items: [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 5 }],
    returns: [{ items: [{ productId: "p2", qty: 5 }] }]
  };
  check("an untouched line is unaffected by another line's return", restore(mixed, 10, "p1") === 10);
  check("the returned line restores nothing", restore(mixed, 5, "p2") === 0);
  check("a sale with no returns array does not throw", restore({ items: [] }, 4, "p1") === 4);
}

console.log("\n=== a return reads the sale before it rewrites it (QA-104) ===");
{
  // The sale path reads its own target id first so a retry cannot record the
  // sale twice. The RETURN path did not: it computed the new returns array and
  // refundedAmount from the client cache OUTSIDE the transaction callback, then
  // issued transaction.update() having never called transaction.get() on that
  // document. With no read there was nothing for Firestore to detect a conflict
  // on, and a retry rewrote the same stale values.
  //
  // Two managers refunding the same sale concurrently therefore both took cash
  // out of the drawer while the record showed one refund — and the stock went
  // back twice, because that half WAS transactional. Reconciliation would show
  // inventory that exists and money that does not.
  const start = src.indexOf("async function confirmProcessReturn(");
  let i = src.indexOf("{", src.indexOf("(", start)), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  const fn = src.slice(start, i + 1).replace(/\/\/[^\n]*/g, "");

  check("the return transaction was located", fn.length > 500, `${fn.length} chars`);
  check("the sale is read inside the transaction", /transaction\.get\(saleRef\)/.test(fn),
    "without a read on this document the write is blind and cannot retry correctly");

  const readAt = fn.indexOf("transaction.get(saleRef)");
  const writeAt = fn.indexOf("transaction.update(saleRef");
  check("...before it is written", readAt !== -1 && writeAt !== -1 && readAt < writeAt,
    "Firestore requires every read before the first write; a read after one fails the transaction");

  // Read out of the update CALL, not the whole function. `serverRefunded +
  // refundAmount` also appears in the over-refund guard a few lines above, so
  // matching it anywhere passed even with the write reverted to the cached
  // value — found by mutating exactly that.
  const updateArgs = (() => {
    const at = fn.indexOf("transaction.update(saleRef");
    let d = 0, j = fn.indexOf("(", at);
    for (let k = j; k < fn.length; k++) {
      if (fn[k] === "(") d++;
      else if (fn[k] === ")") { d--; if (d === 0) { j = k; break; } }
    }
    return fn.slice(at, j + 1);
  })();
  check("the written amount is derived from the server copy",
    /refundedAmount: serverRefunded \+ refundAmount/.test(updateArgs),
    `adding to the cached value reapplies a stale number on every retry. Wrote: ${updateArgs.slice(0, 140)}`);
  check("the written returns list is built on the server copy",
    /returns: \[\.\.\.serverReturns, returnRecord\]/.test(updateArgs),
    "otherwise a concurrent return's record is overwritten and simply disappears");

  // The throw, not the catch that handles it — both mention the same name.
  check("an over-refund is refused by name",
    /throw new Error\("REFUND_EXCEEDS_REMAINING"\)/.test(fn),
    "the rules refuse it anyway, but a rejected transaction tells the manager nothing");
  check("...and the refusal is measured against the server total",
    /serverRefunded \+ refundAmount > saleTotal/.test(fn),
    "measuring against the cached total is the same staleness one layer up");

  const productReadAt = fn.indexOf("productRefs.map((ref) => transaction.get(ref))");
  check("product reads also precede every write", productReadAt !== -1 && productReadAt < writeAt);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
