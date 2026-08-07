// VAT step 4: the sale path. DESIGN-vat.md.
//
//   node vat-sale-path.test.mjs
//
// This is the dangerous step and the reason it gets its own suite. The sale
// path is where phase C shipped a bug that every emulator suite passed over
// (cartItem.productId where the cart holds cartItem.id), and it is where the
// rules expression budget has previously stopped a till selling outright.
//
// The specific hazard here is subtler than either. firestore.rules enforces
//
//     netTotal + taxTotal == total
//
// so if the tax helper's idea of the total ever disagrees with the total
// actually being written, the result is NOT a wrong VAT figure that someone
// notices at month end. It is a REJECTED SALE: the transaction fails, the
// cashier sees an error, and the till has stopped working with a customer
// standing there. The two cannot diverge today -- prices are whole shillings so
// every lineTotal is an integer -- but "cannot diverge today" is a property of
// the price field, not of this code. netTotal is therefore derived by
// subtraction from the total being written, which makes the invariant true by
// construction rather than by coincidence.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// The sale handler is an inline arrow inside bindEvents, so it is sliced by its
// marker and brace-matched rather than extracted by name.
function sliceFrom(marker) {
  const start = app.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  let depth = 0, i = app.indexOf("{", start + marker.length - 1);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
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

const handler = sliceFrom('qs("#completeSaleButton").addEventListener("click"');
const offlineQueue = extractFn("queueOfflineSale");

console.log("=== the sale is computed once, from what it is actually charging ===");
{
  check("the handler was located", handler.length > 2000, `${handler.length} chars`);
  check("tax is computed from the cart", /computeSaleTax\(/.test(handler));
  check("...using each line's own class", /taxClassOf\(cartItem\)/.test(handler),
    "reading the class off anything but the cart item taxes the wrong thing");
  // Checked by reading the call's own arguments, not by finding the word
  // somewhere in the handler. `discountAmount` appears several times nearby, so
  // a looser match passed even when the call was changed to pass 0 — found by
  // mutating exactly that.
  const callStart = handler.indexOf("computeSaleTax(");
  let depth = 0, end = handler.indexOf("(", callStart);
  for (let i = end; i < handler.length; i++) {
    if (handler[i] === "(") depth++;
    else if (handler[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
  }
  const callArgs = handler.slice(callStart, end + 1);
  check("...on the discounted basket", /,\s*discountAmount\s*\)$/.test(callArgs.trim()),
    `tax extracted before the discount overstates what is owed. Call ends: ${callArgs.slice(-60)}`);

  // The cart holds {...product, qty}, and products carry `id`. Phase C shipped
  // cartItem.productId here and every emulator suite passed it.
  check("the cart line is read by id, not productId",
    !/inclusive: cartItem\.productId/.test(handler)
      && /cartItem\.qty \* Number\(cartItem\.sellingPrice/.test(handler),
    "cart items are {...product, qty}; productId is undefined on them");
}

console.log("\n=== net is derived from the total being written ===");
{
  check("netTotal is a subtraction from total", /netTotal: total - taxTotal/.test(handler),
    "computing it independently lets net + tax drift from total, which the rules REJECT — "
    + "that is a stopped till, not a wrong report");
  check("the tax is clamped into the total", /Math\.min\(Math\.max\(computed\.taxTotal, 0\), total\)/.test(handler),
    "an out-of-range tax would produce a negative net and a refused sale");
  check("the rate that was used is recorded", /vatRate: computed\.vatRate/.test(handler));
}

console.log("\n=== the derivation holds even where the helper could disagree ===");
{
  // Exercising the shape of the handler's arithmetic directly, including
  // fractional prices that the price field does not currently allow -- the
  // point is that the invariant survives if it ever does.
  const derive = (total, rawTax) => {
    const taxTotal = Math.min(Math.max(rawTax, 0), total);
    return { taxTotal, netTotal: total - taxTotal };
  };
  const cases = [
    [1180, 180], [1180, 0], [1180, 1180], [0, 0], [0, 500],
    [1000, -50], [1000, 99999], [7, 1], [1, 0], [999999, 152542]
  ];
  const broken = cases.filter(([total, raw]) => {
    const r = derive(total, raw);
    return r.netTotal + r.taxTotal !== total || r.netTotal < 0 || r.taxTotal < 0;
  });
  check("net + tax equals total for every clamped case", broken.length === 0,
    `${broken.length} broke: ${JSON.stringify(broken.slice(0, 3))}`);
}

console.log("\n=== a shop that is not registered writes nothing ===");
{
  check("tax fields start empty", /let taxFields = \{\};/.test(handler));
  check("...and are only filled when registered", /if \(vatConfig\.registered\)/.test(handler),
    "a shop under the threshold must not stamp tax fields onto its sales");
  // Spreading {} adds no keys, so a non-registered sale is byte-identical to
  // one written before VAT existed. That is the forward-only decision holding
  // at the point it matters.
  check("the fields are spread, not assigned individually",
    /\.\.\.taxFields,/.test(handler),
    "spreading an empty object is what makes a non-registered sale unchanged");
}

console.log("\n=== both paths carry it, or the return disagrees with the takings ===");
{
  check("the online sale document carries the fields", /\.\.\.taxFields,\n\s*createdAt: serverTimestamp\(\)/.test(handler),
    "written before createdAt so nothing can overwrite the timestamp");
  check("the offline queue is given them", /taxFields\n?\s*\}\);/.test(handler) || /duplicate,\s*\n\s*taxFields/.test(handler));
  check("the offline sale document writes them", /\.\.\.\(args\.taxFields \|\| \{\}\),/.test(offlineQueue),
    "a sale rung up during an outage is still a taxed sale; omitting it makes the "
    + "VAT return short by exactly the outage");
  check("the offline default is an empty object", /args\.taxFields \|\| \{\}/.test(offlineQueue),
    "an undefined spread would throw inside the queue and lose the sale");
}

console.log("\n=== the receipt is given what it needs ===");
{
  check("lastSale carries the tax fields", /state\.lastSale = \{ mode: "firestore", saleId, items: saleItems, paymentMethod, total, \.\.\.taxFields \}/.test(handler),
    "otherwise the receipt would have to recompute, and two copies of tax arithmetic disagree eventually");
}

console.log("\n=== nothing about the existing sale changed ===");
{
  // The fields are additive. If any of these moved, the regression is in the
  // sale itself rather than in VAT.
  for (const [name, re] of [
    ["the total is still rounded and floored at zero", /const total = Math\.round\(Math\.max\(0, subtotal - discountAmount\)\)/],
    ["cash short of the total is still refused", /cashTendered < total/],
    ["credit is still refused offline", /toast\.offlineCashOnly/],
    ["the deterministic sale id still keys on staff and order", /ord_\$\{args\.staffId\}_\$\{args\.orderNumber\}/]
  ]) {
    check(name, re.test(handler) || re.test(offlineQueue));
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
