// A delivery can create the product it is delivering.
//
//   node delivery-creates-product.test.mjs
//
// WHY THIS EXISTS. A client complained of double entry: to receive goods they
// had never stocked, they had to type the product into Inventory first, then
// type the delivery. The delivery is the moment the shop learns of the product,
// so the delivery is now allowed to create it.
//
// WHAT MAKES IT DANGEROUS, and what this suite is really guarding. The product
// is written INSIDE the delivery transaction -- the one that moves stock, cost
// history, weighted-average cost, purchase lines and supplier debt together. An
// invalid product document does not fail by itself: firestore.rules refuses the
// whole write, so the shop loses the stock and the costs with it, and what
// surfaces is a bare permission error. Every field validProduct() requires must
// therefore be present and every field it refuses must be absent, and that is
// checked here against the rules file itself rather than from memory.
//
// prepareDelivery() is evaluated OUT of app.js, the landed-costs.test.mjs
// convention. A reimplementation only proves the copy agrees with itself.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

// Walks the PARAMETER list to its closing paren before looking for the body:
// prepareDelivery takes a destructured object, so the one-liner that takes the
// first `{` after the name would hand new Function() the destructuring pattern
// as the whole function. Same reason landed-costs.test.mjs carries its own.
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("(", start);
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) break; }
  }
  i = src.indexOf("{", i);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

// Comments are stripped before any check that asks whether a thing is ABSENT, or
// which of two things comes FIRST. Prose explaining why a key is deliberately
// not passed contains that key's name, and a test reading the raw source finds
// it there and reports the opposite of the truth. That has happened twice in
// this repo now; it does not happen again.
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function extractConst(name) {
  const start = src.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  const end = src.indexOf("];", start);
  if (end === -1) throw new Error(`${name} is not an array literal`);
  return src.slice(start, end + 2);
}

function constant(name) {
  const m = src.match(new RegExp("const " + name + " = (\\d+)"));
  if (!m) throw new Error(name + " not found in app.js");
  return Number(m[1]);
}

const MAX_MONEY = constant("MAX_MONEY");

const { prepareDelivery, emptyDeliveryLine, DELIVERY_NEW_PRODUCT } = new Function(`
  ${extract("safeNumber")}
  ${extractConst("DELIVERY_COST_TYPES")}
  const MAX_COUNT = ${constant("MAX_COUNT")};
  const MAX_MONEY = ${MAX_MONEY};
  const DELIVERY_MAX_LINES = ${constant("DELIVERY_MAX_LINES")};
  const DELIVERY_NEW_PRODUCT = "${src.match(/const DELIVERY_NEW_PRODUCT = "([^"]+)"/)?.[1]}";
  ${extract("deliveryAdditionalTotal")}
  ${extract("allocateLandedCosts")}
  ${extract("prepareDelivery")}
  ${extract("emptyDeliveryLine")}
  return { prepareDelivery, emptyDeliveryLine, DELIVERY_NEW_PRODUCT };
`)();

let failures = 0;
let checks = 0;

function ok(condition, label) {
  checks++;
  if (condition) return;
  failures++;
  console.error(`  FAIL  ${label}`);
}

function eq(actual, expected, label) {
  ok(actual === expected, `${label} -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function group(name, fn) {
  console.log(name);
  fn();
}

// A line creating its own product, with everything valid. Spread over, so a
// field added to the shape later does not silently drop out of these cases.
function newLine(over = {}) {
  return {
    ...emptyDeliveryLine(),
    productId: "11111111-2222-3333-4444-555555555555",
    isNew: true,
    newName: "Nails 3 inch",
    newCategory: "Hardware",
    newSellingPrice: "500",
    quantity: "10",
    goodsCost: "3000",
    ...over
  };
}

// An ordinary line naming a product that already exists.
function oldLine(over = {}) {
  return { ...emptyDeliveryLine(), productId: "existing-1", productName: "Cement", quantity: "4", goodsCost: "40000", ...over };
}

function prep(lines, over = {}) {
  return prepareDelivery({ lines, costs: {}, basis: "value", ...over });
}

// ---------------------------------------------------------------------------

group("the empty line carries the new-product fields", () => {
  const line = emptyDeliveryLine();
  // All three call sites used to spell the shape out by hand. If any of them
  // still does, a field added here is missing from that one and the inline form
  // renders `undefined` into its own inputs.
  for (const field of ["productId", "quantity", "goodsCost", "manual", "isNew", "newName", "newCategory", "newSellingPrice"]) {
    ok(field in line, `emptyDeliveryLine() carries ${field}`);
  }
  eq(line.isNew, false, "a fresh line is not a new-product line");

  const literals = src.match(/productId: "", quantity: "", goodsCost: "", manual: ""/g) || [];
  eq(literals.length, 1, "the line shape is spelled out in exactly one place (emptyDeliveryLine itself)");
});

group("a valid new-product line passes and carries its product", () => {
  const result = prep([newLine()]);
  ok(result.ok, "a new-product line is accepted");
  const line = result.lines?.[0];
  ok(Boolean(line?.newProduct), "the prepared line carries newProduct");
  eq(line?.newProduct?.name, "Nails 3 inch", "the name is carried");
  eq(line?.newProduct?.category, "Hardware", "the category is carried");
  eq(line?.newProduct?.sellingPrice, 500, "the selling price is carried as a number");
  eq(line?.productName, "Nails 3 inch", "productName falls back to the typed name");
  // The flag is what receiveDelivery() branches on. An ordinary line must not
  // carry it, or the delivery would create a document over a live product and
  // reset its brand, barcode, reorder level and everything else to blank.
  const plain = prep([oldLine()]);
  ok(plain.ok, "an ordinary line still passes");
  eq(plain.lines?.[0]?.newProduct, undefined, "an ordinary line carries no newProduct");
});

group("the name is required", () => {
  eq(prep([newLine({ newName: "" })]).error, "missingNewName", "an empty name is refused");
  eq(prep([newLine({ newName: "   " })]).error, "missingNewName", "a whitespace-only name is refused");
  eq(prep([newLine({ newName: undefined })]).error, "missingNewName", "an absent name is refused");
  eq(prep([newLine({ newName: "x".repeat(121) })]).error, "missingNewName",
    "a name past the 120 validProduct() allows is refused HERE, not by the rules");
  ok(prep([newLine({ newName: "x".repeat(120) })]).ok, "exactly 120 is accepted");
  // Trimmed and sliced on the way out, so what reaches the document is what the
  // rules will accept.
  const padded = prep([newLine({ newName: "  Nails  " })]);
  eq(padded.lines?.[0]?.newProduct?.name, "Nails", "the name is trimmed");
});

group("a product the shop already stocks cannot be created again", () => {
  const names = ["Cement", "Nails 3 inch"];
  const clash = prep([newLine()], { existingNames: names });
  eq(clash.error, "newProductExists", "a name already in the catalogue is refused");
  eq(clash.errorIndex, 0, "and the refusal points at the line");

  eq(prep([newLine({ newName: "nails 3 INCH" })], { existingNames: names }).error, "newProductExists",
    "the comparison ignores case");
  eq(prep([newLine({ newName: "  Nails 3 inch " })], { existingNames: names }).error, "newProductExists",
    "and surrounding space");
  ok(prep([newLine({ newName: "Nails 4 inch" })], { existingNames: names }).ok,
    "a genuinely new name passes");

  // Permissive when the caller does not supply a catalogue. The check is a guard
  // against a duplicated catalogue, not a security boundary -- and the write
  // path must not refuse a delivery because a caller omitted an optional input.
  ok(prep([newLine()]).ok, "no catalogue supplied means no collision check");
  ok(prep([newLine()], { existingNames: null }).ok, "and null is treated the same");
  // An ordinary line names a product by id, so the catalogue it is already in
  // must not be read as a clash.
  ok(prep([oldLine()], { existingNames: names }).ok, "an ordinary line is unaffected by the catalogue");
});

group("two lines cannot create the same product", () => {
  // Minted ids differ, so the existing productId duplicate check cannot see
  // this: two lines would create two documents both called Cement, and the shop
  // would have two of everything to count, reconcile and price.
  const twice = prep([
    newLine({ newName: "Rebar", productId: "a" }),
    newLine({ newName: "rebar", productId: "b" })
  ]);
  eq(twice.error, "duplicateNewName", "the same new name twice is refused");
  eq(twice.errorIndex, 1, "and it points at the SECOND line, the one to remove");
  ok(prep([
    newLine({ newName: "Rebar", productId: "a" }),
    newLine({ newName: "Binding wire", productId: "b" })
  ]).ok, "two different new products on one delivery are fine");
  // The id check still has to work for new lines.
  eq(prep([newLine({ productId: "same" }), newLine({ newName: "Other", productId: "same" })]).error,
    "duplicateProduct", "two new lines sharing a minted id are still caught by the id check");
});

group("a new product needs a selling price", () => {
  // A product in the catalogue with no selling price cannot be sold, so the shop
  // would be sent back to Inventory to put one on -- the second entry arriving
  // one step later, which is the whole thing this feature removes.
  eq(prep([newLine({ newSellingPrice: "" })]).error, "badNewPrice", "an empty price is refused");
  eq(prep([newLine({ newSellingPrice: "0" })]).error, "badNewPrice", "zero is refused");
  eq(prep([newLine({ newSellingPrice: "-5" })]).error, "badNewPrice", "a negative price is refused");
  eq(prep([newLine({ newSellingPrice: String(MAX_MONEY + 1) })]).error, "badNewPrice",
    "a price past moneyInRange() is refused HERE rather than by the rules");
  ok(prep([newLine({ newSellingPrice: String(MAX_MONEY) })]).ok, "the ceiling itself is accepted");
  ok(prep([newLine({ newSellingPrice: "0.5" })]).ok, "a fractional price is accepted");
  // An ordinary line has a price already and must not be asked for one.
  ok(prep([oldLine({ newSellingPrice: "" })]).ok, "an ordinary line needs no new price");
});

group("the category is optional but bounded", () => {
  ok(prep([newLine({ newCategory: "" })]).ok, "no category is fine");
  eq(prep([newLine({ newCategory: "" })]).lines[0].newProduct.category, "",
    "and reaches the document as an empty STRING, which is what validProduct() requires");
  eq(prep([newLine({ newCategory: "x".repeat(61) })]).error, "badNewCategory",
    "a category past the 60 validProduct() allows is refused");
  ok(prep([newLine({ newCategory: "x".repeat(60) })]).ok, "exactly 60 is accepted");
});

group("the rest of the delivery arithmetic is untouched", () => {
  // The whole point of minting the id on the form: a new product travels through
  // the allocation as an ordinary line, so freight still splits across it.
  const result = prep(
    [newLine({ goodsCost: "3000" }), oldLine({ goodsCost: "7000" })],
    { costs: { freight: 1000 } }
  );
  ok(result.ok, "a delivery mixing a new product with an existing one is accepted");
  eq(result.header.goodsCost, 10000, "goods cost adds up across both kinds of line");
  eq(result.header.totalCost, 11000, "and the freight reaches the total");
  const allocated = result.lines.reduce((sum, l) => sum + l.landedCost, 0);
  ok(Math.abs(allocated - 1000) < 1e-9, "the landed costs still sum EXACTLY to the additional total");
  eq(result.lines[0].landedCost, 300, "the new product takes its share by value");
  eq(result.lines[1].landedCost, 700, "and so does the existing one");

  // The quantity and cost checks still apply to a new line.
  eq(prep([newLine({ quantity: "0" })]).error, "badQuantity", "a new line still needs a quantity");
  eq(prep([newLine({ quantity: "1.5" })]).error, "badQuantity", "and a whole one");
  eq(prep([newLine({ goodsCost: "-1" })]).error, "badGoodsCost", "and a non-negative cost");
  // Order: the product has to be nameable before anything else about the line
  // can be reported against it, so the new-product checks come first.
  eq(prep([newLine({ newName: "", quantity: "0" })]).error, "missingNewName",
    "a nameless line is reported as nameless, not as a bad quantity");
});

// ---------------------------------------------------------------------------
// The write path. receiveDelivery() needs state, a transaction and Firestore, so
// it is read as source -- but what is read are the exact clauses that decide
// whether the rules accept the document, which is the part that can lose a
// shop's stock.

const receive = extract("receiveDelivery");

group("receiveDelivery writes the product instead of refusing", () => {
  ok(/if \(prep\.lines\[i\]\.newProduct\) continue;/.test(receive),
    "a new-product line is skipped by the itemGone existence check");
  ok(/throw new Error\(t\("txerror\.itemGone"/.test(receive),
    "and every OTHER missing product still takes the whole delivery down");
  ok(/const existed = productSnaps\[i\]\.exists\(\);/.test(receive),
    "existence is read once into a local the write branch uses");
  ok(/const before = existed \? productSnaps\[i\]\.data\(\) : \{\};/.test(receive),
    "a missing snapshot reads as an empty document rather than throwing on .data()");
  ok(/if \(existed\) \{\s*transaction\.update\(refs\[i\]\.product/.test(receive),
    "an existing product is still UPDATED");
  ok(/transaction\.set\(refs\[i\]\.product, \{/.test(receive),
    "and a new one is SET, because there is nothing there to update");
});

group("the created product is exactly what validProduct() accepts", () => {
  // The payload, sliced out of the set() call on the product ref.
  const at = receive.indexOf("transaction.set(refs[i].product, {");
  ok(at > -1, "the created payload is findable");
  const payload = receive.slice(at, receive.indexOf("});", at));

  // Read out of firestore.rules rather than restated. If validProduct() grows a
  // required field, this test fails instead of the shop's delivery.
  const vp = rules.slice(rules.indexOf("function validProduct()"));
  const body = vp.slice(0, vp.indexOf("\n    }"));
  const required = [...body.matchAll(/d\.(\w+) is string && d\.\1\.size\(\) > 0/g)].map((m) => m[1]);
  const presentStrings = [...body.matchAll(/d\.(\w+) is string && d\.\1\.size\(\) <= \d+/g)].map((m) => m[1]);
  // An OPTIONAL field reads exactly the same way inside its guard --
  // `!('sku' in d) || (d.sku is string && ...)` -- so the guarded ones are
  // subtracted rather than demanded. Without this the test asks the payload for
  // barcode, shelf, sku and expiryDate, none of which a delivery knows.
  const guarded = new Set([...body.matchAll(/!\('(\w+)' in d\)/g)].map((m) => m[1]));
  const unconditional = [...new Set([...required, ...presentStrings])].filter((f) => !guarded.has(f));
  ok(unconditional.length >= 4,
    `validProduct() requires unguarded strings: ${unconditional.join(", ") || "NONE FOUND -- the regex has drifted"}`);
  for (const field of unconditional) {
    // Shorthand counts: the payload writes `storeId,`, not `storeId: storeId`.
    ok(new RegExp(`\\b${field}\\s*[:,]`).test(payload),
      `the payload carries ${field}, which validProduct() requires unconditionally`);
  }
  ok(/stockCountInRange\(d\.quantity\)/.test(body) && /\bquantity:/.test(payload),
    "and quantity, which it requires as a number");
  ok(/\bstoreId\s*[:,]/.test(payload), "and storeId, which must be non-empty");

  // The two it refuses outright. Stage 2: cost lives in /productCosts, which a
  // cashier cannot read at all, and Firestore has no field-level read security.
  ok(/!\('costPrice' in d\)/.test(body), "validProduct() still refuses costPrice outright");
  ok(!/costPrice/.test(payload), "so the created payload carries none");
  ok(!/costKnownFrom/.test(payload), "nor costKnownFrom");

  // The cost of these goods is not lost -- it went to the two places it belongs,
  // in the same transaction.
  ok(/transaction\.set\(refs\[i\]\.cost, \{/.test(receive), "the cost still goes to /productCosts");
  ok(/productCostHistory/.test(receive), "and to /productCostHistory");

  // validProduct() allows supplier up to 60; the delivery header allows 80.
  ok(/supplier: String\(input\.supplierName \|\| ""\)\.trim\(\)\.slice\(0, 60\)/.test(payload),
    "supplier is sliced to the 60 the rules allow, not the 80 the header allows");
  ok(/sellingPrice: line\.newProduct\.sellingPrice/.test(payload),
    "the selling price reaches the product, so the till knows what to charge");
  ok(/quantity: line\.quantity/.test(payload),
    "the delivered quantity IS the opening quantity -- the shelf held nothing before");
});

group("the created product can afterwards be SOLD by its owner", () => {
  // THE DEFECT THIS EXISTS FOR, found on the preview 2026-10-28 and not by any
  // test above. The product was created correctly, took its stock and its cost,
  // appeared in Inventory and in the till -- and then the owner could not sell
  // it. Every sale commit came back permission-denied.
  //
  // The cause: productImmutableFieldsUnchanged() compares
  // request.resource.data.id against resource.data.id, so a product document
  // must carry its id as a FIELD, not merely as its path. The create path never
  // calls that function, so the delivery succeeded and the refusal only
  // surfaced later, at the till.
  //
  // Worse than a plain failure, it is ASYMMETRIC: the owner's update branch
  // calls productImmutableFieldsUnchanged() and a member's does not, so a
  // cashier could sell the product while the owner could not -- which is the
  // split firestore.rules already warns is "not a hypothesis anyone reaches
  // quickly".
  const at = receive.indexOf("transaction.set(refs[i].product, {");
  const payload = receive.slice(at, receive.indexOf("});", at));
  ok(/\bid: line\.productId\b/.test(payload),
    "the payload carries its own id as a field, not just as the document path");

  // Read out of the rules, so tightening the comparison fails here first.
  const fn = rules.slice(rules.indexOf("function productImmutableFieldsUnchanged()"));
  const body = fn.slice(0, fn.indexOf("\n    }"));
  const pinned = [...body.matchAll(/request\.resource\.data\.(\w+) == resource\.data\.\1/g)].map((m) => m[1]);
  ok(pinned.includes("id"), `the rule pins id (pins: ${pinned.join(", ")})`);
  for (const field of pinned) {
    ok(new RegExp(`\\b${field}\\s*[:,]`).test(payload),
      `the payload carries ${field}, which productImmutableFieldsUnchanged() compares on every owner update`);
  }

  // saveProduct() is where the convention comes from; the two must agree or the
  // catalogue holds two shapes of product and only one of them is sellable.
  const save = extract("saveProduct");
  ok(/product\.id = product\.id \|\| crypto\.randomUUID\(\)/.test(save),
    "saveProduct() mints the same kind of id");
  ok(/\.\.\.product\b/.test(save),
    "...and spreads it into the document it writes, which is why every other product has the field");
});

group("the stock ledger still explains the new units", () => {
  // Units on a shelf with nothing explaining them cannot be reconciled, and the
  // reason has to come from the closed allowlist the rules enforce.
  ok(/recordStockMovement\(transaction, \{/.test(receive), "a movement is still recorded for every line");
  const movement = receive.slice(receive.indexOf("recordStockMovement(transaction, {"));
  ok(/reason: "restock"/.test(movement.slice(0, 400)),
    "with the existing restock reason, not an invented one");
  ok(/movementReason: "restock"/.test(receive),
    "and the product carries the same reason, so the two agree");
});

// ---------------------------------------------------------------------------
// The form.

group("the picker offers a new product, and the sentinel never escapes it", () => {
  const sentinel = src.match(/const DELIVERY_NEW_PRODUCT = "([^"]+)"/)?.[1];
  ok(Boolean(sentinel), "the sentinel is a named constant, not a scattered literal");
  ok(/<option value="\$\{DELIVERY_NEW_PRODUCT\}"/.test(src),
    "the picker carries it as an option");
  ok(/deliveries\.lineNewProduct/.test(src), "labelled from the dictionary");

  const render = extract("renderDeliveryLines");
  // Last in the list: a shop that stocks the thing should land on it, and an
  // exception at the top of a long list is the one people hit by accident.
  ok(render.indexOf("products.map") < render.indexOf("DELIVERY_NEW_PRODUCT"),
    "and it sits after the real products, not before them");

  // The sentinel must be swapped for a real id the moment it is chosen. If it
  // survived, it would reach the duplicate check, the document path and
  // eventually Firestore.
  ok(/picked === DELIVERY_NEW_PRODUCT/.test(src), "the handler recognises it");
  ok(/line\.productId = newDeliveryProductId\(\);/.test(src),
    "and replaces it with a minted id immediately");
  ok(/crypto\.randomUUID/.test(extract("newDeliveryProductId")),
    "minted the same way saveProduct() mints one");
  // Backing out has to take the id with it, or a real id stays attached to a
  // line now pointing at a different product.
  ok(/line\.isNew = false;[\s\S]{0,200}line\.productId = picked;/.test(src),
    "choosing a real product again clears the new-product state and its id");
});

group("the form sends the catalogue to be checked against", () => {
  ok(/function deliveryExistingNames\(\)/.test(src), "there is one place that builds the catalogue");
  ok(/return storeProducts\(\)/.test(extract("deliveryExistingNames")),
    "scoped to the current store -- a product document names one branch");

  // The preview and the submit must agree. A name the screen accepted and the
  // submit refused would look like the app losing the delivery.
  const preview = extract("renderDeliveryPreview");
  ok(/existingNames: deliveryExistingNames\(\)/.test(preview), "the preview checks against it");
  const submit = extract("submitDelivery");
  const beforeWrite = submit.slice(0, submit.indexOf("if (!result.ok)"));
  ok(/existingNames: deliveryExistingNames\(\)/.test(beforeWrite), "and so does the write");

  // The recount AFTER the delivery landed must NOT, and this is not a style
  // point: by then the listener may have delivered the product this delivery
  // just created, so the name would clash with itself, prep would fail, and the
  // shop would be told it received 0 lines worth 0.
  const afterWrite = code(submit.slice(submit.indexOf("if (!result.ok)")));
  ok(!/existingNames:/.test(afterWrite),
    "the toast's recount does not re-check the catalogue it just added to");
});

group("the typed name reaches every message that names the product", () => {
  const draft = extract("deliveryDraftLines");
  ok(/line\.isNew/.test(draft) && /line\.newName/.test(draft),
    "deliveryDraftLines() uses the typed name for a product state.products has never seen");
  const message = code(extract("deliveryErrorMessage"));
  ok(message.indexOf("lines[index].productName") < message.indexOf("productNameById"),
    "and deliveryErrorMessage() prefers it over the lookup that would come up empty");
  for (const code of ["missingNewName", "newProductExists", "duplicateNewName", "badNewCategory", "badNewPrice"]) {
    ok(new RegExp(`case "${code}":`).test(message), `${code} has a sentence, not a bare key`);
  }
});

group("both languages carry every new string", () => {
  const keys = [
    "deliveries.lineNewProduct", "deliveries.newProductHint", "deliveries.lineNewName",
    "deliveries.lineNewCategory", "deliveries.lineNewPrice",
    "deliveries.errMissingNewName", "deliveries.errNewProductExists",
    "deliveries.errDuplicateNewName", "deliveries.errBadNewCategory", "deliveries.errBadNewPrice"
  ];
  for (const key of keys) {
    const found = (src.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length;
    eq(found, 2, `${key} is present once in English and once in Kiswahili`);
  }
});

group("the rules already allow this, so none were changed", () => {
  // Deliberately asserted rather than assumed. If product creation were owner
  // only, every manager's delivery of a new product would be refused whole --
  // and managers are who receives deliveries in a multi-branch shop.
  const block = rules.slice(rules.indexOf("match /products/{productId}"));
  const create = block.slice(block.indexOf("allow create:"), block.indexOf("allow update:"));
  ok(/memberMayCreateProduct\(userId, request\.resource\.data\.storeId\)/.test(create),
    "an assigned member may create a product in their own store");
  const gate = rules.slice(rules.indexOf("function memberMayCreateProduct("));
  ok(/m\.role == "manager"/.test(gate.slice(0, 400)),
    "and that member must be a manager -- a cashier cannot, and does not receive deliveries");
  ok(/validProduct\(\)/.test(create), "and validProduct() applies to everyone, member or owner");
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) {
  console.error(`${failures} FAILED`);
  process.exit(1);
}
