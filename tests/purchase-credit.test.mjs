// Buying on credit: what is still owed, paying it down, and sending goods back.
//
//   node purchase-credit.test.mjs
//
// Spec §5.1–5.3 and §5.5, phase 2 of DESIGN-suppliers-purchases.md.
//
// Two properties carry the whole design and are asserted hardest:
//
//   1. A delivery written before payment terms existed carries no `amountPaid`,
//      and ABSENT MUST READ AS PAID IN FULL. The live shops already hold such
//      headers; any other reading invents a debt nobody entered, on eight real
//      businesses.
//   2. The balance is STORED, not summed from history at read time. The
//      deliveries and purchases a client holds are capped at
//      ACCOUNTS_HISTORY_LIMIT, so a computed balance would silently understate
//      what is owed to a supplier with more history than the window — and
//      understating a debt is the direction that loses money.
//
// Functions are evaluated out of app.js rather than reimplemented — the
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

const { deliveryPaymentStatus } = new Function("safeNumber", `
  ${extract("deliveryPaymentStatus")}
  return { deliveryPaymentStatus };
`)((n) => Number(n) || 0);

console.log("=== Paid / Partially paid / On credit ===");
{
  const st = (d) => deliveryPaymentStatus(d);

  // THE backward-compatibility case. Every delivery header the eight live shops
  // wrote before today has no amountPaid at all.
  const legacy = st({ totalCost: 500000 });
  check("a delivery with no payment terms reads as PAID", legacy.key, "deliveries.statusPaid");
  check("...owing nothing", legacy.due, 0);
  const nulled = st({ totalCost: 500000, amountPaid: null });
  check("an explicit null reads as paid too", nulled.key, "deliveries.statusPaid");

  check("paid in full is paid", st({ totalCost: 500000, amountPaid: 500000 }).key, "deliveries.statusPaid");

  const partial = st({ totalCost: 500000, amountPaid: 200000 });
  check("something paid is partially paid", partial.key, "deliveries.statusPartial");
  check("...and the balance is the shortfall", partial.due, 300000);

  // Zero paid is NOT the same as no terms entered. This is the distinction the
  // whole thing turns on.
  const credit = st({ totalCost: 500000, amountPaid: 0 });
  check("nothing paid is on credit", credit.key, "deliveries.statusCredit");
  check("...and the whole cost is owed", credit.due, 500000);

  // Defensive: an overpaid header (which the rules refuse) must not produce a
  // negative debt if one somehow exists.
  check("an overpayment never owes a negative amount",
    st({ totalCost: 100, amountPaid: 500 }).due, 0);
  check("a zero-cost delivery does not crash", st({ totalCost: 0 }).due, 0);
  check("a garbage header does not crash", st({}).key, "deliveries.statusPaid");
}

console.log("\n=== how much of a purchase can still go back ===");
{
  const load = (returns) => new Function("state", "safeNumber", `
    ${extract("purchaseReturnedQty")}
    ${extract("purchaseReturnableQty")}
    return { purchaseReturnedQty, purchaseReturnableQty };
  `)({ purchaseReturns: returns }, (n) => Number(n) || 0);

  const { purchaseReturnableQty, purchaseReturnedQty } = load([
    { purchaseId: "p1", quantity: 10 },
    { purchaseId: "p1", quantity: 25 },
    { purchaseId: "p2", quantity: 5 }
  ]);
  check("returns against one purchase add up", purchaseReturnedQty("p1"), 35);
  check("another purchase's returns do not count", purchaseReturnedQty("p2"), 5);
  check("what is left is the remainder",
    purchaseReturnableQty({ id: "p1", quantity: 100 }), 65);
  // 60 returned twice out of 100 is the bug this exists to stop.
  check("a fully returned purchase has nothing left",
    purchaseReturnableQty({ id: "p1", quantity: 35 }), 0);
  check("it never goes negative",
    purchaseReturnableQty({ id: "p1", quantity: 10 }), 0);
  check("an untouched purchase is fully returnable",
    purchaseReturnableQty({ id: "never", quantity: 40 }), 40);
  check("a missing purchase returns nothing", purchaseReturnableQty(null), 0);
}

console.log("\n=== the delivery write ===");
{
  const b = body("receiveDelivery");
  // Blank means paid in full, on the write path as well as the read path.
  check("a blank amountPaid becomes the full cost",
    /input\.amountPaid === undefined \|\| input\.amountPaid === null \|\| input\.amountPaid === ""/.test(b), true);
  check("...and payment is clamped into range",
    /Math\.min\(Math\.max\(safeNumber\(input\.amountPaid\), 0\), totalCost\)/.test(b), true);
  // Firestore refuses a get() after the first write in a transaction.
  check("the supplier is read in the read phase",
    b.indexOf("transaction.get(supplierRef)") < b.indexOf("transaction.set(deliveryRef"), true);
  check("only a shortfall moves the balance", /if \(supplierRef && amountDue > 0\)/.test(b), true);
  check("...and it is added to what was already stored",
    /balanceOwed: safeNumber\(supplierSnap\.data\(\)\.balanceOwed\) \+ amountDue/.test(b), true);
  // A delivery with a typed-only supplier has nowhere to put a debt.
  check("no supplier record means no balance write",
    /const supplierRef = supplierLink\.supplierId/.test(b), true);
  // The form must not send 0 for an empty box.
  check("the form passes the raw string, so blank stays blank",
    /amountPaid: String\(form\.elements\.amountPaid\?\.value \|\| ""\)\.trim\(\)/.test(src), true);
}

console.log("\n=== paying a supplier down ===");
{
  const b = body("recordSupplierPayment");
  check("it runs in a transaction", /runTransaction/.test(b), true);
  // Two people paying at once must not both subtract from the same figure.
  check("the balance is re-read inside the transaction",
    /const snap = await transaction\.get\(supplierRef\)/.test(b), true);
  check("...and re-checked against what is stored, not what the dialog held",
    /const applied = Math\.min\(amount, current\)/.test(b), true);
  check("overpaying is refused up front", /suppliers\.paymentTooMuch/.test(b), true);
  check("a zero or negative payment is refused", /amount <= 0/.test(b), true);
  check("the balance can never be driven negative",
    /balanceOwed: current - applied/.test(b) && /applied <= 0/.test(b), true);
}

console.log("\n=== sending goods back ===");
{
  const b = body("recordPurchaseReturn");
  // Valued at what THIS purchase paid, not today's average.
  check("the credit is valued at the purchase's own unit cost",
    /safeNumber\(purchase\.totalPaid\) \/ safeNumber\(purchase\.quantity\)/.test(b), true);
  check("you cannot return more than remains",
    /if \(quantity > returnable\)/.test(b), true);
  check("you cannot return stock that is not on the shelf",
    /if \(before < quantity\)/.test(b), true);
  check("stock goes down, not up", /quantity: before - quantity/.test(b), true);
  // 'return' means a CUSTOMER bringing goods back, which increases stock.
  // Labelling this one 'return' would make the ledger read backwards.
  check("the movement is its own reason, not a customer return",
    /reason: "supplier-return"/.test(b), true);
  check("...and the delta is negative", /delta: -quantity/.test(b), true);
  check("the ledger entry is written", /recordStockMovement\(transaction/.test(b), true);
  // Goods already paid for come back as cash or a credit note, which this app
  // does not model -- so the balance floors at zero rather than inventing a
  // debt the supplier owes us.
  check("only what is still owed is relieved",
    /const relieved = Math\.min\(amount, owed\)/.test(b), true);
  check("...and the balance never goes negative",
    /if \(relieved > 0\)/.test(b), true);
  check("reads happen before writes",
    b.indexOf("transaction.get(productRef)") < b.indexOf("transaction.update(productRef"), true);
  // The purchase itself is never rewritten.
  check("the purchase document is not edited",
    /transaction\.update\(.*purchases/.test(b), false);
}

console.log("\n=== rules ===");
{
  // Payment terms on the delivery header.
  const del = rules.slice(rules.indexOf("function validDelivery()"));
  const delScoped = del.slice(0, del.indexOf("function ", 40));
  check("a delivery may carry payment terms", /'supplierId', 'amountPaid', 'paymentMethod'\]\)/.test(delScoped), true);
  // Overpaying would drive balanceOwed negative.
  check("you cannot pay more than the delivery cost",
    /d\.amountPaid <= d\.totalCost/.test(delScoped), true);
  check("the payment method is a closed set",
    /d\.paymentMethod in \['cash', 'bank', 'mobile', 'credit'\]/.test(delScoped), true);
  // Absent must stay legal -- the live shops' headers have none of these.
  check("every payment field is optional",
    /!\('amountPaid' in d\)/.test(delScoped) && /!\('paymentMethod' in d\)/.test(delScoped)
      && /!\('supplierId' in d\)/.test(delScoped), true);

  // Supplier payments.
  check("suppliers have a payments book", /match \/payments\/\{paymentId\}/.test(rules), true);
  const pay = rules.slice(rules.indexOf("function validSupplierPayment()"));
  const payScoped = pay.slice(0, pay.indexOf("\n        }"));
  check("a payment must be positive", /d\.amount is number && d\.amount > 0/.test(payScoped), true);
  check("...by a real method", /d\.method in \['cash', 'bank', 'mobile'\]/.test(payScoped), true);

  // Purchase returns.
  check("there is a purchase returns collection", /match \/purchaseReturns\/\{returnId\}/.test(rules), true);
  const ret = rules.slice(rules.indexOf("match /purchaseReturns/{returnId}"));
  const retScoped = ret.slice(0, ret.indexOf("\n      }\n"));
  check("a return must move real units", /d\.quantity is number && d\.quantity > 0/.test(retScoped), true);
  check("a return is never edited or deleted", /allow update, delete: if false;/.test(retScoped), true);
  check("a cashier cannot record one", /"cashier"/.test(retScoped), false);

  // The movement reason had to be allowed in two separate places.
  check("the stock ledger accepts supplier-return",
    /'transfer-out', 'adjustment', 'supplier-return'\]/.test(rules), true);
  check("the product movementReason enum accepts it too",
    /'return', 'void', 'supplier-return'\]/.test(rules), true);
}

console.log("\n=== the screens ===");
{
  check("the delivery form asks what was paid", /name="amountPaid"/.test(html), true);
  check("...and how", /name="paymentMethod"/.test(html), true);
  check("the deliveries list shows payment", html.includes('data-i18n="deliveries.thPayment"'), true);
  check("the suppliers list shows what is owed", html.includes('data-i18n="suppliers.thOwed"'), true);
  check("there is a payment dialog", html.includes('id="supplierPaymentDialog"'), true);
  check("there is a statement dialog", html.includes('id="supplierStatementDialog"'), true);
  check("there is a return dialog", html.includes('id="purchaseReturnDialog"'), true);

  // The status is derived, never typed -- a status somebody can set by hand is
  // a status that disagrees with the money.
  check("no form lets anyone type a payment status",
    /name="paymentStatus"/.test(html), false);

  const st = body("buildSupplierStatementHtml");
  // The stored balance is the authority; the rows are only recent history.
  check("the statement's owed figure comes from the stored balance",
    /money\(safeNumber\(supplier\.balanceOwed\)\)/.test(st), true);
  check("...and it says the lists are bounded",
    /suppliers\.statementBoundedNote/.test(st), true);
  // A supplier created today should still show what was bought before they
  // were a record.
  check("the statement includes purchases that only carry a typed name",
    /String\(purchase\.supplierName \|\| ""\)\.trim\(\)\.toLowerCase\(\) === nameKey/.test(st), true);
  // THE STATEMENT MUST ADD UP ON THE PAGE. Money paid at delivery time lives on
  // the delivery header, not in the payments book, and leaving it out made the
  // statement read: bought 1,560,000, paid 400,000, still owed 600,000 -- three
  // true figures that visibly do not reconcile. Found by opening the screen,
  // not by any assertion that existed at the time.
  check("what was paid on delivery is its own line",
    /suppliers\.statementPaidOnDelivery/.test(st), true);
  check("...summed from the delivery headers, not the payments book",
    /const paidOnDelivery = \(state\.deliveries \|\| \[\]\)/.test(st), true);
  check("...through the same status helper the list uses",
    /deliveryPaymentStatus\(delivery\)/.test(st), true);
  check("...and matched to the supplier by id or by typed name",
    /delivery\.supplierId === supplierId/.test(st)
      && /String\(delivery\.supplierName \|\| ""\)\.trim\(\)\.toLowerCase\(\) === nameKey/.test(st), true);

  const open = body("openSupplierStatement");
  check("a slow payment fetch cannot repaint a closed dialog",
    /if \(dialog\.open\)/.test(open), true);
}

console.log("\n=== the write budget still fits ===");
{
  // A credit delivery now writes a THIRD fixed document: the supplier balance.
  const cap = Number(src.match(/const DELIVERY_MAX_LINES = (\d+)/)?.[1]);
  check("the line cap is a real number", Number.isFinite(cap), true);
  check(`${cap} lines stays inside Firestore's 500-write transaction cap`,
    cap * 5 + 3 <= 500, true);
  check("the arithmetic is written down as three fixed writes",
    /80 x 5 \+ 3 = 403/.test(src), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["deliveries.amountPaidLabel", "deliveries.statusPaid", "deliveries.statusPartial",
                     "deliveries.statusCredit", "deliveries.thPayment", "pos.bank",
                     "suppliers.thOwed", "suppliers.payButton", "suppliers.paymentTooMuch",
                     "suppliers.statementOwed", "suppliers.statementBoundedNote",
                     "purchaseReturn.title", "purchaseReturn.qtyTooMany", "purchaseReturn.notEnoughStock",
                     "toast.supplierPaymentRecorded", "toast.purchaseReturnRecorded",
                     "txerror.supplierGone"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
