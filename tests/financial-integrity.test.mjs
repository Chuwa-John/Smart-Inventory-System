// Phase 24: financial integrity — the arithmetic a shop is audited on.
//
//   node financial-integrity.test.mjs
//
// The defect this exists for: a percentage discount produced fractions of a
// shilling. 10% off 1,333 gave a total of 1,199.7, an amount that cannot be
// paid, and change of 0.2999999999999545. Worse, expected cash at shift close
// accumulated those fractions, so a cashier who counted the drawer perfectly
// still recorded a variance and the reconciliation could never balance.
//
// The refund path already rounded, so the same money was treated two different
// ways depending on which direction it moved. That inconsistency is the thing
// being pinned here, not just the rounding.
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

// The shipped function, run against a state object it can see.
const state = { discountType: "none", discountValue: 0 };
const { computeDiscountAmount } = new Function("state",
  `${extractFn("computeDiscountAmount")}\nreturn { computeDiscountAmount };`)(state);
const discount = (subtotal, type, value) => {
  state.discountType = type; state.discountValue = value;
  return computeDiscountAmount(subtotal);
};
const isWhole = (n) => Number.isInteger(n);

console.log("=== money lands on amounts that can actually be paid ===");
{
  // The exact case that was broken.
  const d = discount(1333, "percent", 10);
  check("10% off 1,333 gives a whole discount", isWhole(d), `got ${d}`);
  check("...and the total is payable", isWhole(1333 - d), `total ${1333 - d}`);
  check("...and change from 1,200 is exact", 1200 - (1333 - d) === 0, `change ${1200 - (1333 - d)}`);

  // A spread of awkward numbers, since one worked example proves little.
  const awkward = [[1333, 10], [999, 33], [4567, 7.5], [12345, 12.5], [1, 50], [7, 15], [98765, 3.33]];
  const fractional = awkward.filter(([sub, pct]) => {
    const amt = discount(sub, "percent", pct);
    return !isWhole(amt) || !isWhole(sub - amt);
  });
  check("no percentage discount produces a fraction", fractional.length === 0,
    fractional.map(([s, p]) => `${p}% of ${s}`).join(", "));

  check("a fixed discount entered with a fraction is settled too",
    isWhole(discount(5000, "fixed", 133.7)), `got ${discount(5000, "fixed", 133.7)}`);
}

console.log("\n=== a discount cannot exceed what is being bought ===");
{
  check("100% leaves nothing owing", discount(2500, "percent", 100) === 2500);
  check("a fixed discount is capped at the subtotal", discount(500, "fixed", 9999) === 500);
  check("no discount means no discount", discount(2500, "none", 50) === 0);
  check("a discount is never negative", discount(2500, "percent", 0) === 0);
}

console.log("\n=== the drawer can hold what the system expects ===");
{
  // The reconciliation failure this defect caused, reproduced end to end.
  const float = 20000;
  let expected = float;
  for (let i = 0; i < 7; i++) {
    const sub = 1333;
    expected += sub - discount(sub, "percent", 10);
  }
  check("expected cash after seven discounted sales is a whole number",
    isWhole(expected), `expected ${expected}`);
  check("a perfect count therefore balances exactly",
    expected - Math.round(expected) === 0);
}

console.log("\n=== money is settled the same way whichever direction it moves ===");
{
  // The real inconsistency: refunds rounded, sales did not.
  check("the sale total is rounded where the cart is shown",
    /const totalAmount = Math.round\(Math\.max\(0, subtotal - discountAmount\)\)/.test(app));
  check("the sale total is rounded where the sale is written",
    /const total = Math\.round\(Math\.max\(0, subtotal - discountAmount\)\)/.test(app));
  check("the refund is rounded, as it already was",
    /const refundAmount = Math\.max\(0, Math\.round\(subtotalReturned - discountShare\)\)/.test(app));
  check("the discount itself is rounded at source",
    /return Math\.round\(Math\.min\(subtotal, subtotal \* \(Number\(state\.discountValue \|\| 0\) \/ 100\)\)\)/.test(app));
}

console.log("\n=== totals are still the sum of what was bought ===");
{
  // Rounding must not have been bolted on in a way that loses the relationship
  // between the line items and what is charged.
  const cart = [{ qty: 3, price: 1500 }, { qty: 2, price: 899 }, { qty: 1, price: 12345 }];
  const subtotal = cart.reduce((s, i) => s + i.qty * i.price, 0);
  for (const pct of [0, 5, 12.5, 33, 100]) {
    const d = discount(subtotal, "percent", pct);
    const total = Math.round(Math.max(0, subtotal - d));
    check(`at ${pct}% off, total + discount reconciles to the subtotal`,
      total + d === subtotal, `${total} + ${d} != ${subtotal}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
