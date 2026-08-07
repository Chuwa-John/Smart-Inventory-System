// VAT step 2: turning it on, and classifying stock. DESIGN-vat.md.
//
//   node vat-settings.test.mjs
//
// Two decisions are load-bearing here and neither is obvious from the code.
//
// First, where the setting lives. VAT registration is a BUSINESS fact, but the
// owner document is owner-read-only and a cashier's till has to know whether it
// is charging VAT. So it is denormalised onto every store document, exactly as
// currencyCode already is. The store doc is loaded before the POS renders, so
// this arrives with data the till already waits for rather than adding a
// subscription that could fail on the sale path. The cost of that choice is
// copies that can drift, which is why they are written in one batch.
//
// Second, off by default. Most Tanzanian dukas are under the TZS 200m turnover
// threshold and must not charge VAT at all, so absent settings mean "not
// registered" and a non-registered shop writes no tax fields onto anything.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

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

console.log("=== a shop is not VAT registered until it says so ===");
{
  const state = { stores: [], currentStoreId: null };
  const { vatSettings } = new Function("state",
    `${extractFn("vatSettings")}\nreturn { vatSettings };`)(state);

  check("no stores at all means not registered", vatSettings().registered === false,
    "absent must never read as registered; that would charge tax a shop cannot collect");

  state.stores = [{ id: "s1" }];
  state.currentStoreId = "s1";
  check("a store with no VAT fields means not registered", vatSettings().registered === false);

  // Only an explicit boolean true counts. A truthy string arriving from
  // anywhere must not switch tax on.
  for (const value of ["yes", "true", 1, {}, []]) {
    state.stores = [{ id: "s1", vatRegistered: value }];
    check(`vatRegistered: ${JSON.stringify(value)} does not enable VAT`, vatSettings().registered === false,
      "only an explicit boolean true registers a business");
  }

  state.stores = [{ id: "s1", vatRegistered: true, vrn: "40-123456-A", tin: "123-456-789" }];
  check("an explicitly registered store registers the business", vatSettings().registered === true);
  check("...and carries the VRN", vatSettings().vrn === "40-123456-A");
  check("...and the TIN", vatSettings().tin === "123-456-789");
}

console.log("\n=== the till reads the store it is transacting against ===");
{
  const state = { stores: [], currentStoreId: null };
  const { vatSettings } = new Function("state",
    `${extractFn("vatSettings")}\nreturn { vatSettings };`)(state);

  state.stores = [
    { id: "s1", vatRegistered: true, vrn: "VRN-1" },
    { id: "s2", vatRegistered: true, vrn: "VRN-2" }
  ];
  state.currentStoreId = "s2";
  check("the current store's copy is the one used", vatSettings().vrn === "VRN-2");

  // "All stores" is a reporting view, not a till. Falling back to the first
  // readable store keeps the owner's product form honest rather than blank.
  state.currentStoreId = "all";
  check("the all-stores view still resolves a setting", vatSettings().registered === true);

  // A branch-scoped member may only be able to read one store at all.
  state.stores = [{ id: "s2", vatRegistered: true, vrn: "VRN-2" }];
  state.currentStoreId = "s2";
  check("a member who can see one store still gets the setting", vatSettings().vrn === "VRN-2");
}

console.log("\n=== the copies are written together, not one at a time ===");
{
  const save = extractFn("saveVatSettings");
  check("every store is written", /state\.stores\.forEach/.test(save));
  check("...in a single batch", /writeBatch\(/.test(save) && /batch\.commit\(\)/.test(save),
    "written one at a time, a failure halfway leaves branches disagreeing about the VRN");
  check("turning VAT on requires a VRN", /if \(registered && !vrn\)/.test(save),
    "a registered business with no VRN cannot produce a compliant record");
  check("the change is audited", /VAT_REGISTRATION_ENABLED/.test(save) && /VAT_REGISTRATION_DISABLED/.test(save));
  check("only the owner may write it", /if \(!isOwnerRole\(\)/.test(save));

  // Re-stamping on every save would move the boundary and make older taxed
  // sales look like they predate the scheme.
  check("vatEnabledAt is stamped once, not on every save",
    /!previous\.registered && !store\.vatEnabledAt/.test(save),
    "moving the boundary would misdate which sales the scheme covers");
}

console.log("\n=== a shop that is not registered stamps nothing onto its stock ===");
{
  const save = extractFn("saveProduct");
  check("taxClass is dropped when the business is not registered",
    /if \(!vatSettings\(\)\.registered\) delete product\.taxClass;/.test(save),
    "the select still submits while hidden, so it would tag stock for a tax the shop does not collect");
  check("...and normalised when it is", /product\.taxClass = taxClassOf\(product\)/.test(save),
    "an unrecognised value from anywhere must land on standard rather than be stored");
}

console.log("\n=== the form only asks when the answer matters ===");
{
  check("the tax class field starts hidden", /id="productTaxClassField" hidden/.test(appHtml));
  const render = extractFn("renderVatControls");
  check("...and is shown only for a registered business",
    /field\.hidden = !vatSettings\(\)\.registered/.test(render));
  check("the render pass actually runs", /renderVatControls\(\);/.test(extractFn("renderAll")),
    "otherwise the field's visibility never updates after the setting changes");

  for (const c of ["standard", "zeroRated", "exempt"]) {
    check(`the form offers ${c}`, new RegExp(`value="${c}"`).test(appHtml));
  }
  check("the VAT button is owner-only",
    /"vatSettingsButton"/.test(extractFn("applyStoreOwnerControlsVisibility")),
    "stores update is isOwner-only in the rules, so a non-owner click could only fail");
}

console.log("\n=== both languages, and the EFD is not overclaimed ===");
{
  const keys = ["vat.dialogTitle", "vat.registeredLabel", "vat.vrnLabel", "vat.tinLabel",
    "vat.fiscalNote", "product.taxClassLabel", "product.taxStandard",
    "product.taxZeroRated", "product.taxExempt", "toast.vatVrnRequired"];
  const missing = keys.filter((k) => [...app.matchAll(new RegExp(`"${k.replace(".", "\\.")}":`, "g"))].length !== 2);
  check("every VAT string is defined in English and Swahili", missing.length === 0,
    `not defined twice: ${missing.join(", ")}`);

  // The shop must not be led to believe this makes it compliant. It does not:
  // fiscal receipts come from the TRA-registered device.
  check("the dialog says this does not replace the EFD", /vat\.fiscalNote/.test(appHtml));
  const note = app.match(/"vat\.fiscalNote": "([^"]+)"/)?.[1] ?? "";
  check("...and says so in plain terms", /EFD/.test(note) && /TRA/.test(note), note);
}

console.log("\n=== the rules accept the settings and nothing else ===");
{
  const store = rules.slice(rules.indexOf("function validStore()"));
  const body = store.slice(0, store.indexOf("\n    }"));
  check("vatRegistered must be a bool", /'vatRegistered' in d\) \|\| d\.vatRegistered is bool/.test(body));
  check("the VRN is a bounded string", /'vrn' in d\) \|\| \(d\.vrn is string && d\.vrn\.size\(\) <= \d+\)/.test(body));
  check("the TIN is a bounded string", /'tin' in d\) \|\| \(d\.tin is string && d\.tin\.size\(\) <= \d+\)/.test(body));
  check("vatEnabledAt must be a timestamp", /'vatEnabledAt' in d\) \|\| d\.vatEnabledAt is timestamp/.test(body));
  check("all four stay optional", (body.match(/!\('(vatRegistered|vrn|tin|vatEnabledAt)' in d\)/g) || []).length === 4,
    "making any mandatory would reject every store of every shop under the threshold");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
