// Guards QA-002: the client must not accept input that an authority will refuse.
//
//   node validation-limits.test.mjs
//
// Three separate places enforce length in this system, and they deploy
// independently: the browser (app.html maxlength + app.js constants), the
// proxy on Render (proxy/server.js), and Firestore rules. Nothing linked them,
// so they drifted -- the AI box accepted 2,000 characters against a server that
// rejects at 700, and every product text field was unbounded against rules that
// cap them. Both failures land as a refusal the user cannot act on, after the
// work of typing.
//
// A shared constants module can't fix this: the browser bundle and the proxy are
// different deploy units, and rules are a fourth language entirely. So this test
// reads the real numbers out of all three sources and fails when they disagree.
// Change a cap anywhere and this tells you what else has to move.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy/server.js", import.meta.url), "utf8");
const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// --- read the authorities -------------------------------------------------

// Every <input>/<textarea> in the shell, keyed by id (falling back to name).
const fields = new Map();
for (const tag of html.match(/<(?:input|textarea)\b[^>]*>/g) || []) {
  const key = (tag.match(/id="([^"]*)"/) || tag.match(/name="([^"]*)"/) || [])[1];
  if (!key) continue;
  const type = (tag.match(/type="([^"]*)"/) || [, "text"])[1];
  const max = tag.match(/maxlength="(\d+)"/);
  fields.set(key, { type, maxlength: max ? Number(max[1]) : null });
}

// Pulls a real function out of app.js by brace-matching, so the test exercises
// the shipped code rather than a reimplementation of it.
function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = app.indexOf("{", start);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

function proxyConst(name) {
  const m = proxy.match(new RegExp(`const ${name} = (\\d+)`));
  if (!m) throw new Error(`${name} not found in proxy/server.js`);
  return Number(m[1]);
}
function appConst(name) {
  const m = app.match(new RegExp(`const ${name} = (\\d+)`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return Number(m[1]);
}
// Caps inside one rules function, so the product `name` cap is not confused with
// the store or staff `name` cap -- all three exist and all three differ.
function rulesCaps(fnName) {
  const start = rules.indexOf(`function ${fnName}(`);
  if (start === -1) throw new Error(`${fnName} not found in firestore.rules`);
  let depth = 0;
  let i = rules.indexOf("{", start);
  for (; i < rules.length; i++) {
    if (rules[i] === "{") depth++;
    else if (rules[i] === "}") { depth--; if (depth === 0) break; }
  }
  const body = rules.slice(start, i + 1);
  const caps = new Map();
  for (const m of body.matchAll(/([a-zA-Z]+)\.size\(\) *<= *(\d+)/g)) {
    caps.set(m[1], Number(m[2]));
  }
  return caps;
}

const MAX_MESSAGE_LENGTH = proxyConst("MAX_MESSAGE_LENGTH");
const AI_QUESTION_MAX_CHARS = appConst("AI_QUESTION_MAX_CHARS");
const EMAIL_MAX = Number((proxy.match(/email\.length > (\d+)/) || [])[1]);
const productCaps = rulesCaps("validProduct");

console.log("=== the authorities were found, not assumed ===");
check("proxy MAX_MESSAGE_LENGTH read from source", MAX_MESSAGE_LENGTH > 0, String(MAX_MESSAGE_LENGTH));
check("proxy email cap read from source", EMAIL_MAX > 0, String(EMAIL_MAX));
check("app AI_QUESTION_MAX_CHARS read from source", AI_QUESTION_MAX_CHARS > 0, String(AI_QUESTION_MAX_CHARS));
check("validProduct caps read from rules", productCaps.size >= 5,
  `got ${[...productCaps].map(([k, v]) => `${k}=${v}`).join(", ")}`);
check("the shell's fields were parsed", fields.size >= 15, `${fields.size} fields`);

console.log("\n=== the AI box cannot accept what the proxy refuses ===");
{
  // This is the drift that shipped: 2000 in the client, 700 at the proxy.
  check("AI_QUESTION_MAX_CHARS does not exceed MAX_MESSAGE_LENGTH",
    AI_QUESTION_MAX_CHARS <= MAX_MESSAGE_LENGTH,
    `client accepts ${AI_QUESTION_MAX_CHARS}, proxy rejects above ${MAX_MESSAGE_LENGTH}`);

  const box = fields.get("aiQuestion");
  check("the question box is bounded in markup", box && box.maxlength !== null);
  check("its maxlength matches the constant the code checks",
    box && box.maxlength === AI_QUESTION_MAX_CHARS,
    `maxlength=${box && box.maxlength} vs AI_QUESTION_MAX_CHARS=${AI_QUESTION_MAX_CHARS}`);
  check("askAi refuses an over-long question instead of truncating it",
    /question\.length > AI_QUESTION_MAX_CHARS/.test(app));
  check("the refusal is translated, not a raw string",
    /toast\.aiQuestionTooLong/.test(app));
  for (const lang of ['"toast.aiQuestionTooLong": "That', '"toast.aiQuestionTooLong": "Swali']) {
    check(`the message exists in ${lang.includes("That") ? "en" : "sw"}`, app.includes(lang));
  }
}

console.log("\n=== product fields cannot exceed what rules will store ===");
{
  // Field name in the form -> the rules key that governs it. The form's `name`
  // is a product name, so it takes validProduct's 120 and not the store's 60.
  const governed = [
    ["name", "name"],
    ["category", "category"],
    ["brand", "brand"],
    ["supplier", "supplier"],
    ["barcode", "barcode"]
  ];
  for (const [field, ruleKey] of governed) {
    const f = fields.get(field);
    const cap = productCaps.get(ruleKey);
    check(`"${field}" is bounded in markup`, Boolean(f && f.maxlength !== null),
      "unbounded -- rules will reject the write with permission-denied");
    check(`"${field}" maxlength (${f && f.maxlength}) is within the rules cap (${cap})`,
      Boolean(f && cap && f.maxlength <= cap));
  }
}

console.log("\n=== email fields cannot exceed the proxy's cap ===");
{
  for (const id of ["authEmail", "inviteStaffEmail"]) {
    const f = fields.get(id);
    check(`"${id}" is bounded`, Boolean(f && f.maxlength !== null));
    check(`"${id}" maxlength (${f && f.maxlength}) is within ${EMAIL_MAX}`,
      Boolean(f && f.maxlength <= EMAIL_MAX));
  }
}

console.log("\n=== fields already bounded stayed correct ===");
{
  // These were right before this change; the test pins them so a later edit
  // can't quietly widen one past its authority.
  const pinned = [
    ["posCustomerName", 80, "customer name"],
    ["posCustomerPhone", 20, "phone"],
    ["paymentNoteInput", 200, "note"],
    ["transferStaffNameInput", 80, "staffName"],
    ["businessName", 120, "clampString on businessName"]
  ];
  for (const [id, cap, why] of pinned) {
    const f = fields.get(id);
    check(`"${id}" is still capped at ${cap} (${why})`, Boolean(f && f.maxlength === cap),
      `got ${f && f.maxlength}`);
  }
}

console.log("\n=== the client's own copy of the string caps agrees with rules ===");
{
  // A third copy of the same numbers lives in app.js and drives the toast that
  // names the limit. It can drift from both the markup and the rules.
  const block = app.slice(app.indexOf("const PRODUCT_FIELD_LIMITS"),
    app.indexOf("};", app.indexOf("const PRODUCT_FIELD_LIMITS")) + 2);
  const clientLimits = new Map(
    [...block.matchAll(/(\w+): (\d+)/g)].map((m) => [m[1], Number(m[2])])
  );
  check("PRODUCT_FIELD_LIMITS was found", clientLimits.size >= 5, block.slice(0, 60));
  for (const [field, limit] of clientLimits) {
    const cap = productCaps.get(field);
    check(`PRODUCT_FIELD_LIMITS.${field} (${limit}) matches the rules cap (${cap})`, limit === cap);
    const f = fields.get(field);
    check(`...and the markup for "${field}" agrees too`, Boolean(f && f.maxlength === limit),
      `maxlength=${f && f.maxlength}`);
  }
}

console.log("\n=== numbers are bounded above, not just below (QA-003) ===");
{
  // Measured against the emulator before this fix: rules accepted Infinity as
  // both a quantity and a price, because `is number` and `>= 0` are both true
  // of Infinity. An upper bound excludes it as a side effect. Values past 2^53
  // were accepted too and silently stopped being exact integers.
  const ruleCeilings = new Map();
  for (const fn of ["countInRange", "moneyInRange", "totalInRange"]) {
    const m = rules.match(new RegExp(`function ${fn}\\(v\\) \\{[^}]*v <= (\\d+)`));
    ruleCeilings.set(fn, m ? Number(m[1]) : null);
  }
  for (const [fn, ceiling] of ruleCeilings) {
    check(`rules define an upper bound in ${fn}`, ceiling !== null);
  }

  const MAX_COUNT = appConst("MAX_COUNT");
  const MAX_MONEY = appConst("MAX_MONEY");
  check("app MAX_COUNT matches rules countInRange", MAX_COUNT === ruleCeilings.get("countInRange"),
    `${MAX_COUNT} vs ${ruleCeilings.get("countInRange")}`);
  check("app MAX_MONEY matches rules moneyInRange", MAX_MONEY === ruleCeilings.get("moneyInRange"),
    `${MAX_MONEY} vs ${ruleCeilings.get("moneyInRange")}`);

  // Every ceiling must leave the arithmetic exact. 40 is the rules cap on sale
  // line items.
  const worstSale = 40 * ruleCeilings.get("countInRange") * ruleCeilings.get("moneyInRange");
  check("a sale ceiling exists that keeps totals exact",
    ruleCeilings.get("totalInRange") <= Number.MAX_SAFE_INTEGER,
    `totalInRange=${ruleCeilings.get("totalInRange")} exceeds 2^53`);
  check("the total ceiling is what keeps 40 max-value lines from losing precision",
    worstSale > Number.MAX_SAFE_INTEGER && ruleCeilings.get("totalInRange") < Number.MAX_SAFE_INTEGER,
    `unbounded worst case ${worstSale} vs safe ${Number.MAX_SAFE_INTEGER}`);

  // Infinity must be excluded by the bound, in the client helper too.
  const { clampNonNegativeNumber } = new Function(
    `const MAX_COUNT = ${MAX_COUNT};\n${extractFn("clampNonNegativeNumber")}\nreturn { clampNonNegativeNumber };`
  )();
  const rejected = [Infinity, -Infinity, NaN, -1, MAX_COUNT + 1, 1e308];
  for (const value of rejected) {
    check(`clampNonNegativeNumber rejects ${value}`, clampNonNegativeNumber(value, MAX_COUNT) === null);
  }
  check("it still accepts an ordinary count", clampNonNegativeNumber(50, MAX_COUNT) === 50);
  check("it accepts exactly the ceiling", clampNonNegativeNumber(MAX_COUNT, MAX_COUNT) === MAX_COUNT);
  check("a price at the money ceiling is accepted", clampNonNegativeNumber(MAX_MONEY, MAX_MONEY) === MAX_MONEY);
  check("a price above the money ceiling is refused", clampNonNegativeNumber(MAX_MONEY + 1, MAX_MONEY) === null);

  // The markup bound should agree with the constant the code enforces.
  for (const [field, expected] of [["quantity", MAX_COUNT], ["sellingPrice", MAX_MONEY], ["reorderLevel", MAX_COUNT]]) {
    const tag = (html.match(new RegExp(`<input name="${field}" type="number"[^>]*>`)) || [""])[0];
    const max = (tag.match(/max="(\d+)"/) || [])[1];
    check(`"${field}" carries max="${expected}" in markup`, Number(max) === expected, `got ${max}`);
  }

  check("the refusal names the field and the limit",
    /toast\.numberOutOfRange/.test(app) && app.includes('"toast.numberOutOfRange": "{field}'));
  check("the refusal exists in sw", /"toast\.numberOutOfRange": "\{field\} lazima/.test(app));
}

console.log("\n=== no free-text field escapes a bound ===");
{
  // Anything typed and persisted should be capped. Numbers, dates and controls
  // are bounded by their input type; the command palette and the delete-account
  // confirmation are never written to Firestore. `search` is exempt as a class --
  // globalSearch, posSearch and orderNumberSearch only filter what is already on
  // screen, so an over-long term costs a wasted keystroke, not a failed write.
  const exempt = new Set(["commandInput", "deleteAccountConfirmText", "id"]);
  const boundedByType = new Set(["number", "date", "month", "checkbox", "radio", "hidden", "file", "password", "search"]);
  const unbounded = [...fields]
    .filter(([id, f]) => !exempt.has(id) && !boundedByType.has(f.type) && f.maxlength === null)
    .map(([id]) => id);
  check("every persisted free-text field carries a maxlength", unbounded.length === 0,
    `unbounded: ${unbounded.join(", ")}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
