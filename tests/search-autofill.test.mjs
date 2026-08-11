// The browser must not be able to type into the product search.
//
//   node search-autofill.test.mjs
//
// This cost a real shop a day of believing their stock had not saved.
//
// Chrome autofilled the account's email address into #globalSearch. Nothing
// was broken and nothing was lost -- but filteredProducts() narrows the table
// by that box, no product matches an email, and the inventory list went empty.
// The dashboard KPIs kept reading 2 products, because calculateMetrics() goes
// through storeProducts() and never applies the search term. Two views of the
// same data disagreeing, with a stray email as the only visible clue, reads
// exactly like "my products did not save".
//
// The fix is autocomplete="off" on every field the browser might fill. That is
// dull and easy to drop off a new input, which is why it is asserted here
// rather than remembered. The class of bug is worse than the search box alone:
// the product form has an input named "name", and a browser filling THAT would
// silently put the shop owner's own name on a product.
//
// The second half is recovery. A filter that hides everything must offer a way
// out in one press -- the message alone was already there and was not enough.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const invite = readFileSync(new URL("../accept-invite.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const noComments = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Fields the browser has no business filling. Checkboxes and the like are
// excluded because autofill does not target them.
function fillableInputs(markup) {
  return (markup.match(/<input\b[^>]*>/g) || [])
    .filter((tag) => !/type="(checkbox|radio|hidden|number|date|file)"/.test(tag));
}

console.log("=== nothing the browser can fill is left undeclared ===");
{
  for (const [label, markup] of [["the app", html], ["the invite page", invite]]) {
    const missing = fillableInputs(markup).filter((tag) => !/autocomplete=/.test(tag));
    check(`${label} declares autocomplete on every fillable input`, missing.length === 0,
      missing.map((t) => t.replace(/\s+/g, " ").slice(0, 90)).join("\n      "));
  }
}

console.log("\n=== the fields that actually caused it ===");
{
  // Search boxes are the dangerous ones: filling them hides data rather than
  // showing something wrong, so nothing looks like an error.
  for (const id of ["globalSearch", "posSearch", "orderNumberSearch", "commandInput"]) {
    const tag = (html.match(new RegExp(`<input id="${id}"[^>]*>`)) || [""])[0];
    check(`#${id} refuses autofill`, /autocomplete="off"/.test(tag),
      "a value the browser typed here silently empties a list");
  }
  // A product named after the shop owner, courtesy of the browser.
  for (const field of ["name", "category", "brand", "supplier", "barcode"]) {
    const tag = (html.match(new RegExp(`<input name="${field}"[^>]*>`)) || [""])[0];
    check(`the product form's "${field}" refuses autofill`, /autocomplete="off"/.test(tag));
  }
  // A sale attributed to whoever the browser had on file.
  for (const id of ["posCustomerName", "posCustomerPhone", "posOrderNumber"]) {
    const tag = (html.match(new RegExp(`<input id="${id}"[^>]*>`)) || [""])[0];
    check(`#${id} refuses autofill`, /autocomplete="off"/.test(tag));
  }
  // The credential fields are the exception and must KEEP their real values --
  // a blanket sweep that turned these off would break the password manager
  // people rely on to sign in.
  const authEmail = (html.match(/<input id="authEmail"[^>]*>/) || [""])[0];
  const authPassword = (html.match(/<input id="authPassword"[^>]*>/) || [""])[0];
  check("the sign-in email still autofills", /autocomplete="email"/.test(authEmail));
  check("the sign-in password still autofills", /autocomplete="current-password"/.test(authPassword));
}

console.log("\n=== the two views that disagreed ===");
{
  // The asymmetry is not a bug in itself -- a KPI counting the whole shop and a
  // table showing a search result are both correct. It is pinned because it is
  // what made the symptom so confusing, and because anyone changing one of
  // these should see the other.
  check("the table narrows by the search box",
    /const term = qs\("#globalSearch"\)\.value\.trim\(\)\.toLowerCase\(\);/.test(noComments) &&
    /function filteredProducts\(\)/.test(noComments));
  check("the KPI row does not",
    /function calculateMetrics\(\) \{\s*const products = storeProducts\(\);/.test(noComments),
    "which is why Total Products read 2 while the table read none");
}

console.log("\n=== a filter that hides everything offers a way out ===");
{
  check("the empty state says a filter is responsible",
    /if \(inventoryFiltersActive\(\)\) return t\("inventory\.noMatchesState"\);/.test(noComments));
  check("...and offers a control, not just the sentence",
    /inventoryFiltersActive\(\)[\s\S]{0,200}id="clearInventoryFilters"/.test(noComments));
  check("the control clears the search and both filters",
    /#clearInventoryFilters[\s\S]{0,400}globalSearch[\s\S]{0,200}categoryFilter[\s\S]{0,200}stockFilter/.test(noComments));
  check("...and re-renders every view that reads them",
    /#clearInventoryFilters[\s\S]{0,600}renderAll\(\);/.test(noComments),
    "the same box narrows the POS list too");
  check("inventory.clearFilters exists in both languages",
    (src.match(/"inventory\.clearFilters"/g) || []).length >= 3);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
