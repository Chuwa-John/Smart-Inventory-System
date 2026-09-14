// Invoicing, phase 1 -- DESIGN-invoicing.md -- against the real rules.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-invoicing.test.mjs"
//
// Three properties carry this feature, and each is asserted in both directions:
//
//   1. A draft is not an invoice. It has no number, owes nothing, and anyone
//      who may invoice can edit it.
//   2. Issuing mints ONE number. The invoice and its counter move in the same
//      commit, so two tills issuing at once cannot claim the same sequence --
//      the loser re-runs against the new counter. A gap, or a duplicate, is the
//      first thing an auditor asks about.
//   3. Money only ever goes on, never off. An issued invoice cannot be edited,
//      cannot be over-paid, and cannot be deleted -- a mistake is corrected by
//      a credit note, or voided while nothing is against it.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_inv";
const MANAGER = "manager_inv";
const MANAGER_B = "manager_inv_b";
const CASHIER_PLAIN = "cashier_plain_inv";
const CASHIER_INV = "cashier_invoicing";
const STORE_A = "storeA";
const STORE_B = "storeB";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: {
    rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    host: "127.0.0.1",
    port: 8085
  }
});
await testEnv.clearFirestore();

const DAY = 24 * 60 * 60 * 1000;
const ISSUE_DATE = new Date("2026-09-13T08:00:00Z");
const DUE_DATE = new Date(ISSUE_DATE.getTime() + 30 * DAY);

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });
  const m = (uid, data) => setDoc(doc(db, "users", OWNER, "members", uid), data);
  await m(MANAGER, { role: "manager", status: "active", storeIds: [STORE_A] });
  await m(MANAGER_B, { role: "manager", status: "active", storeIds: [STORE_B] });
  await m(CASHIER_PLAIN, { role: "cashier", status: "active", storeIds: [STORE_A] });
  await m(CASHIER_INV, { role: "cashier", status: "active", storeIds: [STORE_A], permissions: { issueInvoices: true } });
  await setDoc(doc(db, "users", OWNER, "customers", "c1"),
    // Owing money ON PURPOSE. See the note beside the profile-edit checks: a
    // customer seeded at zero cannot prove anything about a rule that guards
    // the balance, because writing zero onto zero changes nothing.
    { name: "Kariakoo Traders", phone: "255700000001", balanceOwed: 250000, storeId: STORE_A, createdAt: new Date() });
});

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -- " + detail : ""}`);
}
async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn());
    else await assertFails(fn());
    record(name, true);
  } catch (e) {
    record(name, false, String(e.message || e).slice(0, 200));
  }
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const owner = as(OWNER), manager = as(MANAGER), managerB = as(MANAGER_B),
  plain = as(CASHIER_PLAIN), inv = as(CASHIER_INV);

let n = 0;
const id = (p) => `${p}_${++n}`;

// The shape the screen sends. One line, no tax (the business is not registered),
// which is the ordinary duka case.
const draft = (uid, over = {}) => ({
  status: "draft",
  storeId: STORE_A,
  customerId: "c1",
  customerName: "Kariakoo Traders",
  lines: [{ productId: "p1", description: "Rice 25kg", quantity: 4, unitPrice: 78000, lineTotal: 312000 }],
  subtotal: 312000,
  discountAmount: 0,
  total: 312000,
  amountPaid: 0,
  amountCredited: 0,
  issueDate: ISSUE_DATE,
  dueDate: DUE_DATE,
  createdByUid: uid,
  createdAt: new Date(),
  ...over
});

// Seeds an issued invoice past the rules, for the tests that start from one.
async function seedIssued(over = {}) {
  const invoiceId = id("inv");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "invoices", invoiceId), {
      ...draft(OWNER),
      status: "issued",
      number: "INV-2026-0001",
      sequence: 1,
      counterId: "invoice-2026",
      issuedByUid: OWNER,
      issuedAt: new Date(),
      ...over
    });
  });
  return invoiceId;
}

console.log("=== a draft is not an invoice ===");
await check("the owner raises a draft", true, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER)));
await check("a manager raises one in their own branch", true, () =>
  setDoc(doc(manager, "users", OWNER, "invoices", id("inv")), draft(MANAGER)));
await check("...but not in a branch they are not assigned", false, () =>
  setDoc(doc(managerB, "users", OWNER, "invoices", id("inv")), draft(MANAGER_B)));
await check("a cashier with issueInvoices raises one", true, () =>
  setDoc(doc(inv, "users", OWNER, "invoices", id("inv")), draft(CASHIER_INV)));
await check("a cashier without it cannot", false, () =>
  setDoc(doc(plain, "users", OWNER, "invoices", id("inv")), draft(CASHIER_PLAIN)));
await check("a draft cannot arrive already numbered", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")),
    draft(OWNER, { number: "INV-2026-0999", sequence: 999, counterId: "invoice-2026" })));
await check("...nor already owing money", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { amountPaid: 5000 })));
await check("...nor claiming to be issued", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { status: "issued" })));
await check("...nor under somebody else's name", false, () =>
  setDoc(doc(inv, "users", OWNER, "invoices", id("inv")), draft(OWNER)));

console.log("\n=== the money has to add up ===");
await check("a total that disagrees with the lines is refused", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { subtotal: 312000, discountAmount: 0, total: 100 })));
await check("a discount is allowed, and must explain the total", true, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")),
    draft(OWNER, { discountType: "fixed", discountValue: 12000, discountAmount: 12000, total: 300000 })));
await check("...but not a discount that does not", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")),
    draft(OWNER, { discountType: "fixed", discountValue: 12000, discountAmount: 12000, total: 312000 })));
await check("tax and net travel together or not at all", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { taxTotal: 47593 })));
await check("...and must add to the total charged", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")),
    draft(OWNER, { vatRegistered: true, vatRate: 0.18, netTotal: 200000, taxTotal: 47593 })));
await check("a correct VAT decomposition is accepted", true, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")),
    draft(OWNER, { vatRegistered: true, vatRate: 0.18, netTotal: 264407, taxTotal: 47593 })));
await check("an invoice with no lines is refused", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { lines: [] })));
await check("a due date before the issue date is refused", false, () =>
  setDoc(doc(owner, "users", OWNER, "invoices", id("inv")), draft(OWNER, { dueDate: new Date(ISSUE_DATE.getTime() - DAY) })));

console.log("\n=== issuing mints exactly one number ===");
{
  // The real shape: the invoice and its counter in ONE commit.
  const issue = (db, invoiceId, sequence, counterValue, uid) => {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", OWNER, "counters", "invoice-2026"), { value: counterValue, updatedAt: serverTimestamp() });
    batch.update(doc(db, "users", OWNER, "invoices", invoiceId), {
      status: "issued",
      number: `INV-2026-${String(sequence).padStart(4, "0")}`,
      sequence,
      counterId: "invoice-2026",
      issuedByUid: uid,
      issuedAt: serverTimestamp()
    });
    return batch.commit();
  };

  const first = id("inv");
  await setDoc(doc(owner, "users", OWNER, "invoices", first), draft(OWNER));
  await check("the first invoice issues, with the counter alongside it", true, () =>
    issue(owner, first, 1, 1, OWNER));

  const second = id("inv");
  await setDoc(doc(owner, "users", OWNER, "invoices", second), draft(OWNER));
  await check("a second invoice cannot reuse the number", false, () =>
    issue(owner, second, 1, 1, OWNER));
  await check("...and takes the next sequence instead", true, () =>
    issue(owner, second, 2, 2, OWNER));

  const third = id("inv");
  await setDoc(doc(owner, "users", OWNER, "invoices", third), draft(OWNER));
  await check("a number that does not match the counter is refused", false, () =>
    issue(owner, third, 9, 3, OWNER));
  await check("...and neither is a counter that jumps", false, () =>
    issue(owner, third, 7, 7, OWNER));
  await check("issuing without touching the counter at all is refused", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", third), {
      status: "issued", number: "INV-2026-0003", sequence: 3, counterId: "invoice-2026",
      issuedByUid: OWNER, issuedAt: serverTimestamp()
    }));
  await check("a cashier with issueInvoices may issue", true, async () => {
    const own = id("inv");
    await setDoc(doc(inv, "users", OWNER, "invoices", own), draft(CASHIER_INV));
    return issue(inv, own, 3, 3, CASHIER_INV);
  });
}

console.log("\n=== an issued invoice is history ===");
{
  const issued = await seedIssued();
  await check("its lines cannot be edited", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { lines: [{ productId: "p1", description: "More", quantity: 99, unitPrice: 1, lineTotal: 99 }] }));
  await check("its total cannot be edited", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { total: 1 }));
  await check("its number cannot be changed", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { number: "INV-2026-4444" }));
  await check("it cannot be deleted, not even by the owner", false, () =>
    deleteDoc(doc(owner, "users", OWNER, "invoices", issued)));
  await check("it cannot be issued a second time", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { status: "issued", sequence: 5 }));
}

console.log("\n=== money goes on, never off ===");
{
  const issued = await seedIssued();
  await check("a payment is applied", true, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountPaid: 100000, updatedAt: serverTimestamp() }));
  await check("...and another on top of it", true, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountPaid: 200000, updatedAt: serverTimestamp() }));
  await check("a payment cannot be taken back", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountPaid: 50000, updatedAt: serverTimestamp() }));
  await check("an invoice cannot be over-paid", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountPaid: 400000, updatedAt: serverTimestamp() }));
  await check("paid plus credited cannot exceed the total", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountCredited: 200000, updatedAt: serverTimestamp() }));
  await check("a credit note within the total is accepted", true, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountCredited: 112000, updatedAt: serverTimestamp() }));
  await check("settling cannot smuggle in a line change", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", issued), { amountPaid: 250000, total: 999999 }));
  await check("a cashier who may take repayments may apply one", true, async () => {
    const other = await seedIssued();
    return updateDoc(doc(inv, "users", OWNER, "invoices", other), { amountPaid: 1000, updatedAt: serverTimestamp() });
  });
}

console.log("\n=== voiding keeps the number ===");
{
  const clean = await seedIssued();
  await check("a manager cannot void", false, () =>
    updateDoc(doc(manager, "users", OWNER, "invoices", clean), {
      status: "void", voidedByUid: MANAGER, voidedAt: serverTimestamp(), voidReason: "Wrong customer" }));
  await check("a void needs a reason", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", clean), {
      status: "void", voidedByUid: OWNER, voidedAt: serverTimestamp() }));
  await check("the owner voids a clean invoice", true, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", clean), {
      status: "void", voidedByUid: OWNER, voidedAt: serverTimestamp(), voidReason: "Raised against the wrong customer" }));

  const paid = await seedIssued({ amountPaid: 50000 });
  await check("an invoice with money against it cannot be voided", false, () =>
    updateDoc(doc(owner, "users", OWNER, "invoices", paid), {
      status: "void", voidedByUid: OWNER, voidedAt: serverTimestamp(), voidReason: "Changed my mind" }));
}

console.log("\n=== who sees what ===");
{
  const mine = id("inv");
  await setDoc(doc(inv, "users", OWNER, "invoices", mine), draft(CASHIER_INV));
  const managers = id("inv");
  await setDoc(doc(manager, "users", OWNER, "invoices", managers), draft(MANAGER));
  await check("a cashier reads the invoice they raised", true, () =>
    getDoc(doc(inv, "users", OWNER, "invoices", mine)));
  await check("...but not one raised by someone else", false, () =>
    getDoc(doc(inv, "users", OWNER, "invoices", managers)));
  await check("a plain cashier reads none of them", false, () =>
    getDoc(doc(plain, "users", OWNER, "invoices", mine)));
  await check("a manager reads their branch", true, () =>
    getDoc(doc(manager, "users", OWNER, "invoices", mine)));
  await check("a manager of another branch does not", false, () =>
    getDoc(doc(managerB, "users", OWNER, "invoices", mine)));
}

console.log("\n=== the customer record, now that it is billable ===");
{
  await check("a manager fills in the billing details", true, () =>
    updateDoc(doc(manager, "users", OWNER, "customers", "c1"), {
      tin: "123-456-789", vrn: "40-123456-A", address: "Kariakoo, Dar es Salaam",
      email: "accounts@kariakoo.co.tz", terms: "30 days", updatedAt: serverTimestamp() }));
  // These two SUCCEEDED on the first run and I read it as a hole in the rule.
  // It was not one: the customer was seeded with balanceOwed 0 and these writes
  // send 0, and Firestore's affectedKeys() reports only keys whose value
  // actually CHANGED. So balanceOwed was never in the diff, the writes really
  // were plain profile edits, and the rule was right to take them. The test was
  // asserting nothing. It only bites now because c1 is seeded owing money --
  // a profile edit that can move money would be a way to write off a debt
  // while renaming somebody.
  await check("...but cannot move the balance while doing it", false, () =>
    updateDoc(doc(manager, "users", OWNER, "customers", "c1"), { tin: "999", balanceOwed: 0 }));
  await check("...nor zero it outright under cover of an edit", false, () =>
    updateDoc(doc(manager, "users", OWNER, "customers", "c1"), { name: "Kariakoo Traders Ltd", balanceOwed: 0 }));
  // The other side of it, so the two refusals above cannot be passing merely
  // because the balance is untouchable by a manager. A repayment on its own is
  // still allowed -- the documented L-10 position, memberMayMoveBalance in
  // firestore.rules. What is refused is moving money and editing the record in
  // the same write.
  await check("a manager may still take a repayment on its own", true, () =>
    updateDoc(doc(manager, "users", OWNER, "customers", "c1"),
      { balanceOwed: 150000, updatedAt: serverTimestamp() }));
  await check("a cashier cannot edit the billing details", false, () =>
    updateDoc(doc(inv, "users", OWNER, "customers", "c1"), { tin: "000-000-000" }));
  await check("a payment may name the invoice it settles", true, () =>
    setDoc(doc(owner, "users", OWNER, "customers", "c1", "payments", id("pay")),
      { amount: 100000, invoiceId: "inv_1", createdAt: new Date() }));
  await check("...and one without an invoice still works, as the till writes it", true, () =>
    setDoc(doc(owner, "users", OWNER, "customers", "c1", "payments", id("pay")),
      { amount: 5000, createdAt: new Date() }));
}

console.log("\n=== the counter itself ===");
await check("a counter cannot be started at anything but 1", false, () =>
  setDoc(doc(owner, "users", OWNER, "counters", "quotation-2026"), { value: 7, updatedAt: serverTimestamp() }));
await check("a counter starts at 1", true, () =>
  setDoc(doc(owner, "users", OWNER, "counters", "quotation-2026"), { value: 1, updatedAt: serverTimestamp() }));
await check("a counter cannot go backwards", false, () =>
  setDoc(doc(owner, "users", OWNER, "counters", "quotation-2026"), { value: 0, updatedAt: serverTimestamp() }));
await check("a counter cannot be deleted", false, () =>
  deleteDoc(doc(owner, "users", OWNER, "counters", "quotation-2026")));
await check("a plain cashier cannot move a counter", false, () =>
  setDoc(doc(plain, "users", OWNER, "counters", "quotation-2026"), { value: 2, updatedAt: serverTimestamp() }));

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}${f.detail ? "  -- " + f.detail : ""}`).join("\n"));
  process.exit(1);
}
