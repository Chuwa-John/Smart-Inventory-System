// QA-104/105/112/113: the refund boundary, executed rather than read.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-refund-boundary.test.mjs"
//
// firestore.rules calls the sale update "the single highest-trust write in the
// schema", and it is: a return moves money out of the drawer and stock back
// onto the shelf, and the sale document is what the owner reads afterwards.
//
// The client guards all of this correctly — saleReturnableItems() caps by what
// has already been returned, and the void path nets off prior returns. But the
// client is not the boundary. Anyone with a manager account and a REST client
// bypasses it entirely, and an insider is exactly who would.
//
// An external QA pass raised these from reading the rules and said plainly that
// it had not executed them. That distinction matters — a rules claim that has
// not been run is a hypothesis — so every assertion here drives the real
// emulator against the real rules file.
//
// What is being closed:
//
//   QA-105a  refundedAmount was bounded (0 <= x <= total) but never required to
//            be MONOTONIC. Refund the full total, write refundedAmount: 0 with
//            an empty returns array, refund it again. Repeat indefinitely.
//   QA-105b  validVoidUpdate() never looked at refundedAmount, so a
//            fully-refunded sale could then be voided — a second refund by a
//            different route, since a void restores the whole sale.
//   QA-112   the VAT reconciliation clause is skipped entirely when taxTotal is
//            present without netTotal, so an arbitrary tax figure validates.
//   QA-113   nothing tied subtotal - discountAmount to total. A sale could
//            claim a 1,000,000 subtotal and a 100 total.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_refund";
const MANAGER = "manager_refund";
const CASHIER = "cashier_refund";
const STORE_A = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

const results = [];
async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn());
    else await assertFails(fn());
    results.push({ name, pass: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, pass: false });
    console.log(`FAIL  ${name}\n      ${String(e.message || e).slice(0, 170)}`);
  }
}

const dbOwner = testEnv.authenticatedContext(OWNER).firestore();
const dbManager = testEnv.authenticatedContext(MANAGER).firestore();
const dbCashier = testEnv.authenticatedContext(CASHIER).firestore();

let n = 0;
// Each scenario gets a fresh sale, seeded past the rules so the starting state
// is exactly what is intended rather than whatever the previous test left.
async function seedSale(over = {}) {
  const id = `sale_${n++}`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "sales", id), {
      items: [{ productId: "p1", name: "Sugar", qty: 2, price: 500, lineTotal: 1000 }],
      total: 1000, subtotal: 1000, discountAmount: 0, discountType: "none",
      cashierUid: CASHIER, voided: false, storeId: STORE_A, branchId: STORE_A,
      staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
      paymentMethod: "cash", cashTendered: 1000, changeDue: 0,
      returns: [], refundedAmount: 0, createdAt: new Date(), ...over
    });
  });
  return id;
}

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A" });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER),
    { role: "manager", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "customers", "c1"),
    { name: "Juma", phoneKey: "255700000001", balanceOwed: 50000, storeId: STORE_A, createdAt: new Date() });
});

console.log("=== a legitimate return still works ===");
// Asserted first and deliberately: a rule that is too tight here does not
// reject a field, it stops a manager refunding a customer standing at the till.
{
  const id = await seedSale();
  await check("a manager can record a partial return", true, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id),
      { returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 }));

  await check("...and can return the rest afterwards", true, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id),
      { returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 }));

  const id2 = await seedSale();
  await check("the owner can refund in full in one step", true, () =>
    updateDoc(doc(dbOwner, "users", OWNER, "sales", id2),
      { returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 }));

  const id3 = await seedSale();
  await check("a clean sale can still be voided", true, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id3), { voided: true, voidedAt: new Date() }));
}

console.log("\n=== a refund cannot be rewound and replayed (QA-105a) ===");
{
  const id = await seedSale({ returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 });

  await check("refundedAmount cannot be reduced", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id), { returns: [], refundedAmount: 0 }));

  await check("...not even by the owner", false, () =>
    updateDoc(doc(dbOwner, "users", OWNER, "sales", id), { returns: [], refundedAmount: 0 }));

  await check("...and not partially", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id),
      { returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 }));

  await check("a re-write of the same amount is harmless and allowed", true, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id),
      { returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 }));

  // The drain in one line: without monotonicity this loop never terminates.
  const id2 = await seedSale({ returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 });
  await check("the refund total can never exceed the sale total", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", id2), { refundedAmount: 1500 }));
}

console.log("\n=== a refunded sale cannot then be voided (QA-105b) ===");
// A void restores the whole sale, so voiding an already-refunded one refunds it
// a second time by another route.
{
  const refunded = await seedSale({ returns: [{ productId: "p1", qty: 2, amount: 1000 }], refundedAmount: 1000 });
  await check("a fully refunded sale cannot be voided", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", refunded), { voided: true, voidedAt: new Date() }));

  const partial = await seedSale({ returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 });
  await check("a partly refunded sale cannot be voided either", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", partial), { voided: true, voidedAt: new Date() }));

  const clean = await seedSale();
  await check("an unrefunded sale still voids normally", true, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", clean), { voided: true, voidedAt: new Date() }));

  // And a void must not quietly erase the refund record on its way through.
  const partial2 = await seedSale({ returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 });
  await check("a void cannot clear the refund record to get around that", false, () =>
    updateDoc(doc(dbManager, "users", OWNER, "sales", partial2),
      { voided: true, voidedAt: new Date(), returns: [], refundedAmount: 0 }));
}

console.log("\n=== the VAT reconciliation clause cannot be skipped (QA-112) ===");
{
  const vatSale = (over) => setDoc(doc(dbCashier, "users", OWNER, "sales", `vat_${n++}`), {
    items: [{ productId: "p1", name: "Sugar", qty: 1, price: 1180 }],
    total: 1180, subtotal: 1180, discountAmount: 0, discountType: "none",
    cashierUid: CASHIER, voided: false, storeId: STORE_A,
    staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
    paymentMethod: "cash", createdAt: new Date(), vatRegistered: true, vatRate: 0.18, ...over
  });

  await check("a matched pair is accepted", true, () => vatSale({ taxTotal: 180, netTotal: 1000 }));
  await check("a mismatched pair is refused", false, () => vatSale({ taxTotal: 180, netTotal: 999 }));

  // The gap: with only one of the two present the guard short-circuits to true.
  await check("tax without net is refused", false, () => vatSale({ taxTotal: 180 }));
  await check("net without tax is refused", false, () => vatSale({ netTotal: 1000 }));
  await check("neither is still fine — an unregistered shop writes no tax fields", true,
    () => vatSale({ vatRegistered: false }));
}

console.log("\n=== a total must follow from its own subtotal (QA-113) ===");
{
  const priced = (over) => setDoc(doc(dbCashier, "users", OWNER, "sales", `p_${n++}`), {
    items: [{ productId: "p1", name: "Sugar", qty: 1, price: 1000 }],
    cashierUid: CASHIER, voided: false, storeId: STORE_A,
    staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
    paymentMethod: "cash", createdAt: new Date(), ...over
  });

  await check("subtotal minus discount equals total", true,
    () => priced({ subtotal: 1000, discountAmount: 200, total: 800 }));
  await check("no discount, total equals subtotal", true,
    () => priced({ subtotal: 1000, discountAmount: 0, total: 1000 }));
  await check("a total that does not follow is refused", false,
    () => priced({ subtotal: 1000000, discountAmount: 0, total: 100 }));
  await check("a discount that does not account for the gap is refused", false,
    () => priced({ subtotal: 1000, discountAmount: 100, total: 500 }));
  await check("a sale with no subtotal at all is still accepted", true,
    () => priced({ total: 1000 }));
}

console.log("\n=== what the customer balance rule does and does not stop (QA-111) ===");
{
  const asCashier = (data) => updateDoc(doc(dbCashier, "users", OWNER, "customers", "c1"), data);

  // Enforced, and worth keeping asserted.
  await check("a cashier cannot change the credit limit alongside a balance", false,
    () => asCashier({ balanceOwed: 40000, creditLimit: 999999 }));
  await check("a cashier cannot rename a customer alongside a balance", false,
    () => asCashier({ balanceOwed: 40000, name: "Someone Else" }));
  await check("a negative balance is refused", false, () => asCashier({ balanceOwed: -1 }));
  await check("recording a payment against the balance is allowed", true,
    () => asCashier({ balanceOwed: 40000, updatedAt: new Date() }));

  // NOT enforced, and this assertion documents that deliberately.
  //
  // A cashier can set balanceOwed to anything non-negative, including zero,
  // with no payment document anywhere. This is the credit-side twin of L-2:
  // rules authorise one write at a time and cannot bind a balance change to the
  // payment that would justify it. It is recorded as L-10 rather than left
  // implicit.
  //
  // If someone later finds a way to prevent it, THIS TEST WILL FAIL — and that
  // failure is the signal to close L-10 in KNOWN-LIMITATIONS.md rather than to
  // adjust the assertion.
  await check("a cashier CAN still write off a debt with no payment (L-10, by design)", true,
    () => asCashier({ balanceOwed: 0, updatedAt: new Date() }));

  // What makes the detective fix buildable: the payment record cannot be
  // forged after the fact or tidied away.
  await check("a payment cannot be altered once written", false, () =>
    updateDoc(doc(dbCashier, "users", OWNER, "customers", "c1", "payments", "pay1"), { amount: 1 }));
  await check("a payment can be recorded", true, () =>
    setDoc(doc(dbCashier, "users", OWNER, "customers", "c1", "payments", "pay2"), { amount: 5000, createdAt: new Date() }));
  await check("a zero-value payment is refused", false, () =>
    setDoc(doc(dbCashier, "users", OWNER, "customers", "c1", "payments", "pay3"), { amount: 0, createdAt: new Date() }));
}

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
