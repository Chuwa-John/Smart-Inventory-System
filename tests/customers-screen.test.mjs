// The Customers screen. DESIGN-invoicing.md 8.
//
//   node customers-screen.test.mjs
//
// The check this file exists for is the LAST one: a profile edit must never
// carry the balance.
//
// firestore.rules refuses a staff write that changes a profile field and
// `balanceOwed` in the same commit, because a profile edit that could move
// money is a way to write off a debt while renaming somebody. That refusal is
// only half the story: if the client puts `balanceOwed` into an edit payload,
// the rules reject the whole write and the shop sees a screen that cannot save
// a corrected phone number. So the client has to keep the two apart on purpose,
// and this pins that it does.
//
// Everything above it is the ordinary "the screen is actually there and wired"
// checking, which is cheap and catches a half-applied edit.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

console.log("=== the screen exists and the nav reaches it ===");
{
  check("a nav item points at customers", /data-view="customers"/.test(html));
  check("...and a section answers to that id", /<section class="view" id="customers">/.test(html));
  check("the list table is there", /id="customersTable"/.test(html));
  check("...with a search box", /id="customerSearchInput"/.test(html));
  check("...and a way to add one", /id="addCustomerButton"/.test(html));
  check("the add/edit dialog exists", /<dialog id="customerDialog">/.test(html));
  check("the history dialog exists", /<dialog id="customerHistoryDialog">/.test(html));
  check("the screen is rendered by renderAll()",
    /renderAll\(\)[\s\S]{0,2000}?renderCustomers\(\);/.test(src));
}

console.log("\n=== the billing fields the invoice needs are captured ===");
{
  const dialog = html.slice(html.indexOf('<dialog id="customerDialog">'),
                            html.indexOf("</dialog>", html.indexOf('<dialog id="customerDialog">')));
  // Bounds match validCustomer() in firestore.rules. A field the screen lets
  // somebody overrun is a write the rules reject with nothing explaining why.
  for (const [field, max] of [["name", 80], ["phone", 20], ["tin", 40], ["vrn", 20],
                              ["email", 120], ["terms", 60], ["address", 200]]) {
    check(`${field} is present and bounded at ${max}`,
      new RegExp(`name="${field}"[^>]*maxlength="${max}"`).test(dialog),
      `expected name="${field}" with maxlength="${max}" -- the rules cap it there`);
  }
  check("the balance is NOT a field on this form", !/name="balanceOwed"/.test(dialog),
    "what a customer owes moves through a sale, a payment or an invoice -- never a form");
}

console.log("\n=== who the screen is for ===");
{
  // Manager and owner. A cashier's till reads customers in order to sell on
  // credit, but a list of who owes what is the receivables book, and
  // DESIGN-permissions.md is explicit that a cashier records without seeing it.
  check("customers is not a cashier-allowed view",
    /const CASHIER_ALLOWED_VIEWS = \[([^\]]*)\]/.exec(src)?.[1].includes("customers") === false,
    "adding it there would hand a cashier the receivables book");
  const fn = src.slice(src.indexOf("function renderCustomers()"));
  const body = fn.slice(0, fn.indexOf("\n}"));
  check("...and the render refuses to draw rows for anyone else",
    /if \(!isManagerOrOwnerRole\(\)\) \{ table\.innerHTML = ""; return; \}/.test(body));
}

console.log("\n=== the row actions are not wired twice ===");
{
  // Recording a payment, reminding and setting a credit alert are handled by
  // the document-level click delegation, which sees clicks anywhere including
  // this table. Repeating them on #customersTable would fire each twice -- and
  // "record payment" twice is two payments against one debt.
  const listener = src.slice(src.indexOf('qs("#customersTable")?.addEventListener'));
  const body = listener.slice(0, listener.indexOf("\n  });"));
  check("the table listener handles only edit and history",
    /data-edit-customer/.test(body) && /data-customer-history/.test(body));
  for (const action of ["data-record-payment", "data-remind-customer", "data-set-credit-limit"]) {
    check(`...and does not re-handle ${action}`, !body.includes(action),
      `${action} is already handled by the document-level delegation`);
  }
}

console.log("\n=== a profile edit cannot move money (the one that matters) ===");
{
  const start = src.indexOf("async function saveCustomer(");
  check("saveCustomer() was found", start !== -1);
  const body = src.slice(start, src.indexOf("\n}\n", start));

  const editStart = body.indexOf("if (existing) {");
  const elseStart = body.indexOf("} else {", editStart);
  check("it has separate create and edit paths", editStart !== -1 && elseStart > editStart,
    "if these merged, one payload shape would have to satisfy both rule branches");

  const editBranch = body.slice(editStart, elseStart);
  const createBranch = body.slice(elseStart, body.indexOf('qs("#customerDialog")?.close()'));

  // firestore.rules: validCustomerProfileUpdate() permits exactly
  // name/phone/tin/vrn/address/email/terms/updatedAt and pins balanceOwed.
  // Any of these three in the payload puts a key outside that diff and the
  // whole write is refused -- so this is both a money guard and the reason the
  // screen can save at all.
  for (const forbidden of ["balanceOwed", "storeId", "createdAt"]) {
    check(`the edit payload never carries ${forbidden}`, !editBranch.includes(forbidden),
      `found "${forbidden}" in the edit branch:\n      ${editBranch.trim().slice(0, 200)}`);
  }
  check("...and it does send updatedAt", editBranch.includes("updatedAt"));

  // The create side is the opposite: it writes the whole document, and the
  // balance it writes is zero. A customer is created owing nothing.
  check("a new customer is created owing nothing", /balanceOwed:\s*0/.test(createBranch),
    "a form that can set an opening debt is a form that can invent one");
  check("...and is scoped to a store", createBranch.includes("storeId"));
  check("...and stamped with a creation time", createBranch.includes("createdAt"));
}

console.log("\n=== the phone is required, because the till matches on it ===");
{
  const fn = src.slice(src.indexOf("async function saveCustomer("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  check("a blank phone is refused", /customersScreen\.phoneRequired/.test(body));
  // Stored in the same normalised form findCustomerByPhone() compares against,
  // or the next credit sale silently creates the customer a second time.
  check("...and it is normalised the way the till normalises it",
    /normalizeCustomerPhoneKey\(/.test(body));
  check("...and a duplicate number is refused rather than merged",
    /customersScreen\.phoneTaken/.test(body));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
