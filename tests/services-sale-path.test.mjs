// Phase B of DESIGN-services.md: a service can be sold, and selling one does
// not touch stock.
//
//   node services-sale-path.test.mjs
//
// The load-bearing assertion in this file is the first one. Before Phase B,
// completeSale()'s transaction mapped EVERY cart line to products/{id} and
// threw txerror.itemGone on the first one that did not exist. A service has no
// product document, so a bar ringing up a plate of food beside a bottled beer
// did not lose the food line -- it lost the whole sale, beer included. That is
// the first sale this feature would ever have processed.
//
// The rest guards the arithmetic staying identical. A service line reaches
// revenue, VAT and payment-method totals through exactly the same fields a
// product line does (lineTotal, total), so nothing downstream of the sale
// record needed changing -- and that is only true while the sale document keeps
// its shape.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0, i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const handlerStart = noComments.indexOf('qs("#completeSaleButton").addEventListener');
const handler = noComments.slice(handlerStart, handlerStart + 16000);

console.log("=== the transaction only reaches for documents that exist ===");
{
  check("stock lines are filtered out of the cart before any product ref",
    /const stockCart = cart\.filter\(\(cartItem\) => !isServiceLine\(cartItem\)\);/.test(handler),
    "an unfiltered map builds products/undefined and throws itemGone for the whole sale");
  check("the product refs are built from the filtered list",
    /const productRefs = stockCart\.map\(/.test(handler));
  check("no product ref is built from the unfiltered cart",
    !/const productRefs = cart\.map\(/.test(handler),
    "this is the exact line that failed a mixed basket");

  // The subtle half. productSnaps is index-aligned with productRefs, which is
  // now stockCart -- reading cart[index] there would pair a snapshot with the
  // wrong line the moment a service sits earlier in the basket, decrementing
  // the wrong product by the wrong amount.
  const txStart = handler.indexOf("const stockCart = cart.filter");
  const txEnd = handler.indexOf("const auditRef", txStart);
  const txBody = handler.slice(txStart, txEnd > txStart ? txEnd : txStart + 3000);
  check("snapshot loops index the filtered list, not the cart",
    (txBody.match(/stockCart\[index\]/g) || []).length >= 2 && !/\bcart\[index\]/.test(txBody),
    "productSnaps is aligned with stockCart; cart[index] would pair the wrong line");
}

console.log("\n=== and the filtered list stays paired with its snapshots ===");
{
  // The quiet half of the same change, run rather than read. productSnaps is
  // built from productRefs, which is built from stockCart -- so the loops must
  // index stockCart. With a service FIRST in the basket, indexing `cart`
  // instead pairs each snapshot with the line after the one it belongs to:
  // no error, no rejection, just the wrong product decremented by the wrong
  // amount. That is the failure this alignment prevents, and it is invisible.
  const isServiceLine = new Function(`${extract("isServiceLine")} return isServiceLine;`)();

  const cart = [
    { id: "svc1", kind: "service", name: "Braiding", qty: 1 },
    { id: "p1", kind: "product", name: "Beer", qty: 3 },
    { id: "svc2", kind: "service", name: "Chips", qty: 2 },
    { id: "p2", kind: "product", name: "Soda", qty: 5 }
  ];
  const stockCart = cart.filter((cartItem) => !isServiceLine(cartItem));

  check("only stock lines reach the product refs",
    stockCart.map((c) => c.id).join(",") === "p1,p2");
  check("no service id is ever used to build a product path",
    !stockCart.some((c) => isServiceLine(c)),
    "products/svc1 does not exist and would throw itemGone for the whole sale");

  // Each snapshot stands for stockCart[i]; pairing by index must name the same
  // line and the same quantity.
  const snapshots = stockCart.map((c) => ({ id: c.id, onShelf: 10 }));
  const decrements = snapshots.map((snap, index) => {
    const cartItem = stockCart[index];
    return { product: cartItem.id, by: cartItem.qty, snapshotWas: snap.id };
  });
  check("every decrement names the product its snapshot came from",
    decrements.every((d) => d.product === d.snapshotWas));
  check("Beer is decremented by 3 and Soda by 5",
    JSON.stringify(decrements.map((d) => `${d.product}:${d.by}`)) === JSON.stringify(["p1:3", "p2:5"]));

  // The control: what indexing the unfiltered cart would have produced.
  const wrong = snapshots.map((snap, index) => `${cart[index].id}:${cart[index].qty}`);
  check("indexing the unfiltered cart would have decremented the wrong lines",
    JSON.stringify(wrong) === JSON.stringify(["svc1:1", "p1:3"]),
    "it would try products/svc1 and short Beer -- silently, with no error raised");
}

console.log("\n=== every sale line says what it is ===");
{
  check("kind is written on every item, not just services",
    /kind: isServiceLine\(cartItem\) \? "service" : "product"/.test(handler),
    "an absent discriminator is read correctly only by luck");
  check("a service line carries serviceId",
    /\{ serviceId: cartItem\.id \}/.test(handler));
  check("a service line does NOT carry productId",
    /\? \{ serviceId: cartItem\.id \}\s*:\s*\{ productId: cartItem\.id \}/.test(handler),
    "productId: null would build the path products/null instead of failing loudly");

  // No migration, and no historical sale reinterpreted.
  const helper = new Function(`${extract("isServiceLine")} return isServiceLine;`)();
  check("a line with no kind is treated as a product", helper({ productId: "p1" }) === false);
  check("a service line is recognised", helper({ kind: "service" }) === true);
  check("an explicit product line is recognised", helper({ kind: "product" }) === false);
  check("a null line does not throw", helper(null) === false);
}

console.log("\n=== a service has no shelf, anywhere it could be mistaken for one ===");
{
  check("the cart quantity input has no max for a service",
    /const maxQty = isServiceLine\(item\) \? "" : \(product \? product\.quantity : item\.qty\);/.test(noComments),
    "falling back to the current qty pins the input at 1 and blocks a second helping");
  check("the max attribute is omitted rather than emitted empty",
    /\$\{maxQty === "" \? "" : `max="\$\{maxQty\}"`\}/.test(noComments));
  check("the + button skips the stock ceiling for a service",
    /if \(isServiceLine\(cartItem\)\) \{[\s\S]{0,200}cartItem\.qty \+= 1;/.test(noComments));
  check("the typed quantity skips the stock ceiling for a service",
    /if \(isServiceLine\(cartItem\)\) \{[\s\S]{0,260}cartItem\.qty = Math\.max\(1, Math\.floor/.test(noComments));

  // The + button and the qty input both used a `cartItem && product` guard.
  // For a service `product` is undefined, so without the branch they did
  // nothing at all and the control looked broken rather than refused.
  check("both guards are reached before the product lookup",
    noComments.indexOf("isServiceLine(cartItem)") <
      noComments.indexOf("const product = state.products.find((item) => item.id === increaseButton.dataset.increaseCart)"),
    "the service branch has to come first or the joint guard swallows it");
}

console.log("\n=== the 40-line cap applies to services too ===");
{
  // firestore.rules caps sale.items at 40. A 41st line is a sale the server
  // refuses after the cashier has already taken the money.
  const fn = noComments.slice(noComments.indexOf("function addServiceToCartById("));
  const body = fn.slice(0, fn.indexOf("\nfunction "));
  check("adding a service respects the cart limit",
    /state\.cart\.length >= 40/.test(body) && /toast\.cartLimitReached/.test(body));
  check("adding a service is refused across all stores",
    /state\.currentStoreId === "all"/.test(body) && /toast\.selectStoreToSell/.test(body));
  check("a withdrawn or unknown service is refused",
    /toast\.serviceUnavailable/.test(body));
  check("it reads the scoped list, not the raw state",
    /storeServices\(\)\.find/.test(body),
    "storeServices() applies store scope and drops inactive items");
}

console.log("\n=== only the two business types that asked for it see any of this ===");
{
  const scoped = new Function("state", "currentBusinessType",
    `const SERVICE_BUSINESS_TYPES = ["salon", "bar"];
     ${extract("storeSellsServices")}
     ${extract("storeServices")}
     return { storeSellsServices, storeServices };`
  );
  const run = (type, services, currentStoreId = "storeA") =>
    scoped({ db: {}, services, currentStoreId }, () => type);

  for (const type of ["salon", "bar"]) {
    check(`${type} sells services`, run(type, []).storeSellsServices() === true);
  }
  for (const type of ["duka", "hardware", "pharmacy", "general"]) {
    check(`${type} does not`, run(type, []).storeSellsServices() === false);
  }
  check("a non-service business gets an empty list even if documents exist",
    run("duka", [{ id: "s1", storeId: "storeA", active: true }]).storeServices().length === 0,
    "belt and braces: the gating is not only in the renderer");

  const rows = [
    { id: "s1", storeId: "storeA", active: true },
    { id: "s2", storeId: "storeB", active: true },
    { id: "s3", storeId: "storeA", active: false }
  ];
  check("another branch's menu is not offered",
    run("salon", rows).storeServices().map((s) => s.id).join(",") === "s1");
  check("a withdrawn service is not offered",
    !run("salon", rows).storeServices().some((s) => s.id === "s3"),
    "deactivated rather than deleted, because sales already reference it");
  check("all-stores shows every branch's active services",
    run("salon", rows, "all").storeServices().map((s) => s.id).join(",") === "s1,s2");
  check("no store selected offers nothing",
    run("salon", rows, "").storeServices().length === 0);
}

console.log("\n=== the till panel and the label ===");
{
  check("the POS has a services section", /id="posServices"/.test(html));
  check("it is hidden in the markup by default", /<div id="posServices" hidden>/.test(html),
    "a duka must never see it, including in the moment before the first render");
  check("the heading is swapped by business type",
    /return currentBusinessType\(\) === "bar" \? "services\.menuTitle" : "services\.title";/.test(noComments));
  check("the panel is hidden for a non-service business at render time",
    /panel\.hidden = !storeSellsServices\(\);/.test(noComments));
  for (const key of ["services.title", "services.menuTitle", "services.posEmpty", "toast.serviceUnavailable"]) {
    check(`${key} exists in both languages`,
      (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}"`, "g")) || []).length >= 3);
  }
}

console.log("\n=== the subscription is scoped like every other one ===");
{
  const fn = noComments.slice(noComments.indexOf("async function subscribeToServices("));
  const body = fn.slice(0, fn.indexOf("\nasync function "));
  check("it scopes by the member's stores", /where\("storeId", "in", queryStoreIds\)/.test(body));
  check("a member with no store access subscribes to nothing",
    /queryStoreIds !== null && queryStoreIds\.length === 0/.test(body),
    "Firestore rejects an empty `in` filter outright");
  check("it repaints through the once-per-frame path", /scheduleRenderAll\(\);/.test(body));
  check("it starts with the other subscriptions",
    /subscribeToTransfers\(\);\s*subscribeToServices\(\);/.test(noComments));
  check("it is torn down on sign-out",
    /state\.unsubscribeServices = null;\s*state\.services = \[\];/.test(noComments),
    "the next business on this device must not inherit the last one's menu");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
