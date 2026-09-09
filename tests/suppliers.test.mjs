// Suppliers as records rather than retyped strings.
//
//   node suppliers.test.mjs
//
// Spec 5.4 (AviaSmart_Prototype_Specification.docx). Until now a supplier was
// free text on each purchase, so "Twiga Cement", "Twiga cement" and "TWIGA"
// were three suppliers to any report grouping by them, and there was nowhere to
// hold a phone number, a TIN, or what is owed.
//
// The whole risk here is the eight live shops. Every purchase they have ever
// written carries only `supplierName`, so this must be additive: `supplierId`
// is optional, an unmatched name still writes exactly what it wrote before, and
// nothing is migrated. Those are the properties asserted hardest.
//
// Functions are evaluated out of app.js rather than reimplemented -- the
// purchases.test.mjs convention.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

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
const body = (name) => extract(name).replace(/\/\/[^\n]*/g, "");

// The real helpers, over a controlled supplier list.
const load = (suppliers) => new Function("state", `
  ${extract("supplierLinkFor")}
  ${extract("supplierById")}
  ${extract("activeSuppliers")}
  ${extract("purchaseSupplierLabel")}
  return { supplierLinkFor, supplierById, activeSuppliers, purchaseSupplierLabel };
`)({ suppliers });

const SUPPLIERS = [
  { id: "sup-1", name: "Twiga Cement", active: true },
  { id: "sup-2", name: "Simba Hardware", active: false },
  { id: "sup-3", name: "Nyati Traders" }
];

console.log("=== a typed name finds the record ===");
{
  const { supplierLinkFor } = load(SUPPLIERS);
  check("an exact name links", supplierLinkFor("Twiga Cement"), { supplierId: "sup-1" });
  // The entire point: these three were three suppliers yesterday.
  check("case does not matter", supplierLinkFor("twiga cement"), { supplierId: "sup-1" });
  check("neither does surrounding space", supplierLinkFor("  Twiga Cement  "), { supplierId: "sup-1" });

  // An unmatched name must write EXACTLY what it wrote before this existed.
  // Anything else and a shop mid-flow in the delivery form starts failing.
  check("an unknown name links to nothing", supplierLinkFor("Someone New"), {});
  check("a blank name links to nothing", supplierLinkFor(""), {});
  check("undefined links to nothing", supplierLinkFor(undefined), {});
  check("whitespace alone links to nothing", supplierLinkFor("   "), {});

  // Partial matches must NOT link: "Twiga" is a different supplier from
  // "Twiga Cement" until someone says otherwise.
  check("a partial name does not link", supplierLinkFor("Twiga"), {});
}

console.log("\n=== inactive suppliers leave the pickers, not the books ===");
{
  const { activeSuppliers, supplierById } = load(SUPPLIERS);
  check("an inactive supplier is not offered",
    activeSuppliers().map((s) => s.id), ["sup-1", "sup-3"]);
  // A record written before `active` existed has no flag; absent must read as
  // active, or every supplier vanishes from the picker at once.
  check("a missing active flag reads as active",
    activeSuppliers().some((s) => s.id === "sup-3"), true);
  // Still resolvable: purchases already attached to them must keep their name.
  check("an inactive supplier is still resolvable by id",
    supplierById("sup-2")?.name, "Simba Hardware");
}

console.log("\n=== what a purchase is labelled with ===");
{
  const { purchaseSupplierLabel } = load(SUPPLIERS);
  // A linked purchase follows the record, so renaming a supplier renames their
  // history rather than splitting it.
  check("a linked purchase shows the record's name",
    purchaseSupplierLabel({ supplierId: "sup-1", supplierName: "old typo" }), "Twiga Cement");
  // The legacy case: every purchase the eight shops hold.
  check("an unlinked purchase still shows its typed name",
    purchaseSupplierLabel({ supplierName: "Someone New" }), "Someone New");
  check("a purchase with neither shows nothing", purchaseSupplierLabel({}), "");
  check("a null purchase does not throw", purchaseSupplierLabel(null), "");
  // A dangling id (supplier deleted from another device) must fall back rather
  // than render blank.
  check("a dangling supplierId falls back to the typed name",
    purchaseSupplierLabel({ supplierId: "gone", supplierName: "Twiga Cement" }), "Twiga Cement");
}

console.log("\n=== the write stays additive ===");
{
  const save = body("saveSupplier");
  // Blank optional fields are omitted, not written as "": a merge write of ""
  // clears a value set from another device.
  check("blank optional fields are omitted from the write",
    /if \(value\) payload\[key\] = value;/.test(save), true);
  check("balanceOwed is not recomputed from this form",
    /balanceOwed: existing \? safeNumber\(existing\.balanceOwed\) : openingBalance/.test(save), true);
  // Two suppliers with one name is the exact problem the record exists to end.
  check("a duplicate name is refused", /suppliers\.nameTaken/.test(save), true);
  check("...comparing case-insensitively", /toLowerCase\(\) === name\.toLowerCase\(\)/.test(save), true);
  check("an edit does not clash with itself",
    /other\.id !== \(existing\?\.id \|\| ""\)/.test(save), true);
  // "all stores" cannot own a document -- the refusal every sibling makes.
  check("it refuses to create against 'all stores'",
    /state\.currentStoreId === "all"/.test(save), true);

  // supplierId reaches the purchase, or the record is decorative.
  check("delivery purchase lines carry the link",
    /\.\.\.supplierLinkFor\(input\.supplierName\)/.test(src), true);
  check("restock and product purchases carry it too",
    /\.\.\.supplierLinkFor\(costCapture\.supplierName\)/.test(src), true);
  // ...but supplierName is still written alongside it, unconditionally.
  check("supplierName is still written next to the link",
    (src.match(/supplierName: String\(input\.supplierName\)\.slice\(0, 120\)/g) || []).length >= 1, true);
}

console.log("\n=== rules ===");
{
  check("there is a suppliers collection", /match \/suppliers\/\{supplierId\}/.test(rules), true);
  const block = rules.slice(rules.indexOf("match /suppliers/{supplierId}"));
  const scoped = block.slice(0, block.indexOf("\n      }\n"));
  check("a supplier must be named", /d\.name is string && d\.name\.size\(\) > 0/.test(scoped), true);
  check("...and scoped to a branch", /d\.storeId is string && d\.storeId\.size\(\) > 0/.test(scoped), true);
  check("balances cannot go negative",
    /d\.balanceOwed is number && d\.balanceOwed >= 0/.test(scoped), true);
  check("...nor can the opening balance",
    /d\.openingBalance is number && d\.openingBalance >= 0/.test(scoped), true);
  // Purchasing is not a till function.
  check("a cashier cannot write a supplier", /\["manager"\]/.test(scoped), true);
  check("...and is not granted write anywhere in the block",
    /allow (create|update)[^;]*"cashier"/.test(scoped), false);
  // A supplier is referenced by every purchase ever made from them.
  check("suppliers are deactivated, never deleted",
    /allow delete: if false;/.test(scoped), true);

  // The purchase schema is a hasOnly() list -- an unlisted field is REFUSED, so
  // writing supplierId without this would break every linked purchase.
  const purchase = rules.slice(rules.indexOf("function validPurchase()"));
  check("validPurchase accepts supplierId",
    /'supplierId'\]\)/.test(purchase.slice(0, purchase.indexOf("&& d.storeId"))), true);
}

console.log("\n=== the screen ===");
{
  check("the panel exists", html.includes('id="suppliersPanel"'), true);
  check("...inside Purchases, not its own nav item",
    html.indexOf('id="suppliersPanel"') > html.indexOf('<section class="view" id="purchases"')
      && html.indexOf('id="suppliersPanel"') < html.indexOf('<section class="view" id="expenses"'), true);
  check("there is a dialog to add one", html.includes('id="supplierDialog"'), true);
  check("the panel is hidden from a cashier",
    /if \(panel\) panel\.hidden = !isManagerOrOwnerRole\(\);/.test(body("renderSuppliers")), true);

  // The datalist is what makes the name match rather than be retyped.
  check("the supplier box offers the recorded names",
    /name="supplierName"[^>]*list="supplierNameOptions"/.test(html), true);
  check("...and that list exists", html.includes('id="supplierNameOptions"'), true);
  const render = body("renderSuppliers");
  check("...and is filled before the empty-list return, so emptying it empties the list",
    render.indexOf("supplierNameOptions") < render.indexOf("suppliers.empty"), true);
  check("only active suppliers are offered",
    /options\.innerHTML = activeSuppliers\(\)/.test(render), true);

  // Every field the spec 5.4 names.
  for (const field of ["name", "phone", "email", "address", "tin", "openingBalance", "active"]) {
    check(`the form captures ${field}`, new RegExp(`name="${field}"`).test(html), true);
  }
}

console.log("\n=== both languages ===");
{
  for (const key of ["suppliers.title", "suppliers.addButton", "suppliers.empty",
                     "suppliers.dialogTitle", "suppliers.dialogTitleEdit", "suppliers.nameTaken",
                     "suppliers.nameRequired", "suppliers.openingBalanceLabel",
                     "suppliers.statusActive", "suppliers.statusInactiveShort",
                     "toast.supplierAdded", "toast.couldNotSaveSupplier"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
