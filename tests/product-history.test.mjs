// Clicking a product in Inventory: what has happened to this thing.
//
//   node product-history.test.mjs
//
// The dialog used to show TRANSFERS ONLY, which answers "where did it go" and
// neither of the two questions an owner actually opens it with: what has it
// sold, and what did we pay for it. It now carries three sections -- sales,
// transfers, and purchases/additions.
//
// The purchase section is the sensitive one. It is the only place in the app
// outside the cost reports where a unit cost is rendered next to a product
// name, so it must not appear for a cashier: /purchases in firestore.rules has
// no cashier branch, and subscribeToPurchases() refuses to subscribe for one.
// The section is ABSENT rather than empty for them, because an empty table
// makes a claim ("nothing was bought") that is different from "not yours to
// see".
//
// Functions are evaluated out of app.js rather than reimplemented -- the
// purchases.test.mjs convention.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const PRODUCT = "prod-1";
const at = (d) => new Date(2026, 8, d, 10, 30);

// The real renderer, with everything it leans on injected. Only the role and
// the three data sets vary between cases.
function render({ role, purchases = [], sales = [], transfers = [] }) {
  return new Function(
    "state", "esc", "productDisplayLabel", "productSalesEntries",
    "productTransferEntries", "isManagerOrOwnerRole", "purchasedAt",
    "safeNumber", "money", "paymentMethodLabel", "t", `
    ${extract("productPurchaseEntries")}
    ${extract("buildProductMovementHtml")}
    return buildProductMovementHtml;
  `)(
    { products: [{ id: PRODUCT, name: "Cement 50kg" }], purchases },
    (s) => String(s),
    (p) => p.name,
    () => sales,
    () => transfers,
    () => role !== "cashier",
    (p) => p.at,
    (n) => Number(n) || 0,
    (n) => `TZS ${Number(n).toLocaleString("en-US")}`,
    (m) => m || "-",
    // Keys are echoed back so a missing section is visible as a missing key
    // rather than as an empty string that reads like deliberate absence.
    (key) => key
  )(PRODUCT);
}

console.log("\n=== all three histories are there ===");
{
  const out = render({
    role: "owner",
    sales: [{ date: at(4), staffName: "Asha", qty: 3, orderNumber: "1042", paymentMethod: "cash" }],
    transfers: [{ date: at(3), sourceStoreName: "Main", destinationStoreName: "Branch B", qty: 10, staffName: "Juma" }],
    purchases: [{ productId: PRODUCT, at: at(1), supplierName: "Twiga", quantity: 100,
                  totalPaid: 1500000, unitCost: 15600, landedCost: 60000, deliveryId: "d1" }]
  });
  check("the sales history is shown", out.includes("movement.salesSectionTitle"), true);
  check("the transfer history is shown", out.includes("movement.transfersSectionTitle"), true);
  // The one the user asked for that did not exist.
  check("the purchase history is shown", out.includes("movement.purchasesSectionTitle"), true);

  check("a sale's staff, quantity and order number are all there",
    out.includes("Asha") && out.includes(">3<") && out.includes("#1042"), true);
  check("a transfer names both ends",
    out.includes("Main") && out.includes("Branch B"), true);
  check("a purchase names the supplier and what was paid",
    out.includes("Twiga") && out.includes("TZS 1,500,000"), true);
  check("...and the unit cost it works out at", out.includes("TZS 15,600"), true);
  // The whole point of the landed-cost work: freight in the unit cost is real
  // on a delivery line, not assumed.
  check("...and the landed cost, when the line came in on a delivery",
    out.includes("TZS 60,000"), true);
}

console.log("\n=== an addition that did not come in on a delivery ===");
{
  // Stock added by hand has no freight to allocate. Zero would be a claim that
  // carriage was free; this says the figure does not exist.
  const out = render({
    role: "owner",
    purchases: [{ productId: PRODUCT, at: at(2), supplierName: "", quantity: 5,
                  totalPaid: 50000, unitCost: 10000 }]
  });
  check("its landed cost is disclosed as absent, not as zero",
    out.includes("movement.noLanded"), true);
  check("...and is not rendered as a money value", /TZS 0/.test(out), false);
  check("a missing supplier is a dash, not blank", out.includes(">-<"), true);
}

console.log("\n=== a cashier is not shown cost ===");
{
  const cashier = render({
    role: "cashier",
    sales: [{ date: at(4), staffName: "Asha", qty: 3, orderNumber: "1042", paymentMethod: "cash" }],
    transfers: [{ date: at(3), sourceStoreName: "Main", destinationStoreName: "B", qty: 10, staffName: "Juma" }],
    purchases: [{ productId: PRODUCT, at: at(1), supplierName: "Twiga", quantity: 100,
                  totalPaid: 1500000, unitCost: 15600, landedCost: 60000, deliveryId: "d1" }]
  });
  // Absent, not empty: an empty table says "nothing was bought", which is a
  // different statement from "not yours to see".
  check("the purchase section is absent entirely",
    cashier.includes("movement.purchasesSectionTitle"), false);
  check("...and so is the empty-state that would hint at it",
    cashier.includes("movement.noPurchases"), false);
  check("no cost figure leaks into the markup",
    cashier.includes("1,500,000") || cashier.includes("15,600") || cashier.includes("60,000"), false);
  // What they SHOULD still see: a cashier needs the sales history at the till.
  check("the sales history is still theirs", cashier.includes("movement.salesSectionTitle"), true);
  check("and so is the transfer history", cashier.includes("movement.transfersSectionTitle"), true);
}

console.log("\n=== a product nothing has happened to ===");
{
  const out = render({ role: "owner" });
  check("each section says it is empty rather than rendering nothing",
    out.includes("movement.noSalesForProduct") && out.includes("movement.noTransfers")
      && out.includes("movement.noPurchases"), true);
  // colspan has to match the header or the empty row breaks the table.
  check("the sales empty row spans its five columns",
    /colspan="5"[^>]*>movement\.noSalesForProduct/.test(out), true);
  check("the purchase empty row spans its six",
    /colspan="6"[^>]*>movement\.noPurchases/.test(out), true);
}

console.log("\n=== ordering and scoping ===");
{
  const out = render({
    role: "owner",
    purchases: [
      { productId: PRODUCT, at: at(1), supplierName: "Older", quantity: 1, totalPaid: 1, unitCost: 1 },
      { productId: PRODUCT, at: at(9), supplierName: "Newest", quantity: 1, totalPaid: 1, unitCost: 1 },
      { productId: PRODUCT, at: at(5), supplierName: "Middle", quantity: 1, totalPaid: 1, unitCost: 1 },
      // Another product's purchase must not appear on this product's history.
      { productId: "prod-2", at: at(9), supplierName: "WrongProduct", quantity: 1, totalPaid: 1, unitCost: 1 }
    ]
  });
  check("most recent purchase first",
    out.indexOf("Newest") < out.indexOf("Middle") && out.indexOf("Middle") < out.indexOf("Older"), true);
  check("another product's purchase stays off this history",
    out.includes("WrongProduct"), false);
}

console.log("\n=== the strings and the dialog exist ===");
{
  check("the dialog is in the markup", html.includes('id="productMovementDialog"'), true);
  check("...and has somewhere to render into", html.includes('id="productMovementContent"'), true);
  for (const key of ["movement.salesSectionTitle", "movement.transfersSectionTitle",
                     "movement.purchasesSectionTitle", "movement.purchasesSubtitle",
                     "movement.noSalesForProduct", "movement.noTransfers", "movement.noPurchases",
                     "movement.noLanded", "movement.colSupplier", "movement.colTotalPaid",
                     "movement.colEach", "movement.colLanded"]) {
    const n = (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
