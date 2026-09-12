// Cashier permissions -- DESIGN-permissions.md -- against the real rules.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-permissions.test.mjs"
//
// The permissions are a map of booleans on the member document, and an absent
// map or key means the DEFAULT. Every member document on the eight live shops
// has no map at all, so the first thing asserted here is that a cashier with no
// map behaves exactly as one did before this file existed. A permissions change
// that quietly withdrew credit from every cashier would stop a till, not fail a
// report.
//
// Each grant is then asserted in both directions -- granted it succeeds, not
// granted it is refused -- and each record-only permission is asserted to be
// record-only: a cashier who records expenses still cannot read the book.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy,
  writeBatch, serverTimestamp
} from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_perm";
const PLAIN = "cashier_plain";        // no permissions map at all
const EXP = "cashier_expenses";       // recordExpenses
const DEL = "cashier_deliveries";     // receiveDeliveries
const RET = "cashier_returns";        // processReturns
const STRICT = "cashier_strict";      // sellOnCredit and takeRepayments withdrawn
const EXP_B = "cashier_expenses_b";   // recordExpenses, but in branch B
const MANAGER = "manager_perm";       // a manager whose map says no -- ignored
const MANAGER_B = "manager_perm_b";
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

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = () => new Date();

const member = (role, storeIds, permissions) => ({
  role, status: "active", storeIds, ...(permissions ? { permissions } : {})
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });
  const m = (uid, data) => setDoc(doc(db, "users", OWNER, "members", uid), data);
  await m(PLAIN, member("cashier", [STORE_A]));
  await m(EXP, member("cashier", [STORE_A], { recordExpenses: true }));
  await m(DEL, member("cashier", [STORE_A], { receiveDeliveries: true }));
  await m(RET, member("cashier", [STORE_A], { processReturns: true }));
  await m(STRICT, member("cashier", [STORE_A], { sellOnCredit: false, takeRepayments: false }));
  await m(EXP_B, member("cashier", [STORE_B], { recordExpenses: true }));
  await m(MANAGER, member("manager", [STORE_A], { sellOnCredit: false, takeRepayments: false, recordExpenses: false }));
  await m(MANAGER_B, member("manager", [STORE_B]));

  const e = (id, data) => setDoc(doc(db, "users", OWNER, "expenses", id), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: new Date(), ...data
  });
  await e("ownersExpense", { recordedByUid: OWNER, createdAt: new Date(Date.now() - 2 * DAY) });
  await e("mineToday", { recordedByUid: EXP, createdAt: new Date(Date.now() - 2 * HOUR) });
  await e("mineOld", { recordedByUid: EXP, createdAt: new Date(Date.now() - 3 * DAY), spentAt: new Date(Date.now() - 3 * DAY) });
  await e("managersToday", { recordedByUid: MANAGER, createdAt: new Date(Date.now() - HOUR) });
  await e("managersOld", { recordedByUid: MANAGER, createdAt: new Date(Date.now() - 2 * DAY), spentAt: new Date(Date.now() - 2 * DAY) });

  await setDoc(doc(db, "users", OWNER, "customers", "c1"),
    { name: "Juma", phone: "255700000001", balanceOwed: 50000, storeId: STORE_A, createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "customers", "c1", "payments", "seedPay"), { amount: 100, createdAt: new Date() });
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
const owner = as(OWNER), plain = as(PLAIN), exp = as(EXP), del = as(DEL), ret = as(RET),
  strict = as(STRICT), expB = as(EXP_B), manager = as(MANAGER), managerB = as(MANAGER_B);

let n = 0;
const id = (p) => `${p}_${++n}`;

const sale = (uid, over = {}) => ({
  items: [{ productId: "p1", name: "Sugar", qty: 2, lineTotal: 1000 }],
  total: 1000, subtotal: 1000, discountAmount: 0, discountType: "none",
  cashierUid: uid, voided: false, storeId: STORE_A,
  staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
  paymentMethod: "cash", cashTendered: 1000, changeDue: 0, createdAt: new Date(), ...over
});
async function seedSale(over = {}) {
  const saleId = id("sale");
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "sales", saleId),
      sale(PLAIN, { returns: [], refundedAmount: 0, ...over }));
  });
  return saleId;
}

const expense = (uid, over = {}) => ({
  storeId: STORE_A, category: "transport", amount: 3000, paidFrom: "till",
  spentAt: new Date(), recordedByUid: uid, createdAt: serverTimestamp(), ...over
});

// ===========================================================================
console.log("=== no permissions map: every cashier behaves exactly as before ===");
await check("a plain cashier still sells for cash", true, () =>
  setDoc(doc(plain, "users", OWNER, "sales", id("s")), sale(PLAIN)));
await check("a plain cashier still sells on credit (absent means allowed)", true, () =>
  setDoc(doc(plain, "users", OWNER, "sales", id("s")), sale(PLAIN, { paymentMethod: "credit", amountPaid: 0, balanceDue: 1000 })));
await check("a plain cashier still takes a repayment (balance down)", true, () =>
  updateDoc(doc(plain, "users", OWNER, "customers", "c1"), { balanceOwed: 45000, updatedAt: new Date() }));
await check("a plain cashier still records a payment document", true, () =>
  setDoc(doc(plain, "users", OWNER, "customers", "c1", "payments", id("pay")), { amount: 5000, createdAt: new Date() }));
await check("a plain cashier still cannot record an expense", false, () =>
  setDoc(doc(plain, "users", OWNER, "expenses", id("e")), expense(PLAIN)));
await check("a plain cashier still cannot read an expense", false, () =>
  getDoc(doc(plain, "users", OWNER, "expenses", "ownersExpense")));
await check("a plain cashier still cannot process a return", false, async () => {
  const saleId = await seedSale();
  return updateDoc(doc(plain, "users", OWNER, "sales", saleId),
    { returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 });
});
await check("a plain cashier cannot ask for a delivery", false, () =>
  setDoc(doc(plain, "users", OWNER, "deliveryRequests", id("r")), {
    storeId: STORE_A, requestedByUid: PLAIN, requestedByName: "Asha", status: "pending",
    supplierName: "Festive", receivedAt: new Date(), lines: [{ productId: "p1", name: "Sugar", qty: 5 }],
    createdAt: serverTimestamp()
  }));

// ===========================================================================
console.log("\n=== recordExpenses: records and corrects their own, never reads the book ===");
await check("records an expense in their branch", true, () =>
  setDoc(doc(exp, "users", OWNER, "expenses", id("e")), expense(EXP)));
await check("cannot record one under someone else's name", false, () =>
  setDoc(doc(exp, "users", OWNER, "expenses", id("e")), expense(OWNER)));
await check("cannot record in a branch they are not assigned", false, () =>
  setDoc(doc(exp, "users", OWNER, "expenses", id("e")), expense(EXP, { storeId: STORE_B })));
await check("cannot back-date beyond the seven-day window", false, () =>
  setDoc(doc(exp, "users", OWNER, "expenses", id("e")), expense(EXP, { spentAt: new Date(Date.now() - 10 * DAY) })));
await check("reads their own entry", true, () =>
  getDoc(doc(exp, "users", OWNER, "expenses", "mineToday")));
await check("cannot read the owner's entry", false, () =>
  getDoc(doc(exp, "users", OWNER, "expenses", "ownersExpense")));
await check("cannot read a manager's entry", false, () =>
  getDoc(doc(exp, "users", OWNER, "expenses", "managersToday")));
// The query app.js issues. Filtered on recordedByUid, it is provable.
await check("their own-entries query is allowed", true, () =>
  getDocs(query(collection(exp, "users", OWNER, "expenses"),
    where("recordedByUid", "==", EXP), where("storeId", "in", [STORE_A]), orderBy("createdAt", "desc"))));
// And without the filter it is not -- the book is not a query away.
await check("the branch's whole expense book is refused", false, () =>
  getDocs(query(collection(exp, "users", OWNER, "expenses"),
    where("storeId", "in", [STORE_A]), orderBy("createdAt", "desc"))));
await check("corrects their own entry on the day", true, () =>
  updateDoc(doc(exp, "users", OWNER, "expenses", "mineToday"), { amount: 4500 }));
await check("cannot correct their own entry after the day", false, () =>
  updateDoc(doc(exp, "users", OWNER, "expenses", "mineOld"), { amount: 1 }));
await check("cannot correct the owner's entry", false, () =>
  updateDoc(doc(exp, "users", OWNER, "expenses", "ownersExpense"), { amount: 1 }));
await check("cannot move their entry to another branch", false, () =>
  updateDoc(doc(exp, "users", OWNER, "expenses", "mineToday"), { storeId: STORE_B }));
await check("cannot delete even their own entry", false, () =>
  deleteDoc(doc(exp, "users", OWNER, "expenses", "mineToday")));
await check("the same permission in branch B does not reach branch A", false, () =>
  setDoc(doc(expB, "users", OWNER, "expenses", id("e")), expense(EXP_B)));
await check("...but does work in branch B", true, () =>
  setDoc(doc(expB, "users", OWNER, "expenses", id("e")), expense(EXP_B, { storeId: STORE_B })));

console.log("\n=== the audit trail follows the permission ===");
const audit = (db, action, extra = {}) =>
  setDoc(doc(db, "users", OWNER, "auditLogs", id("a")), { action, uid: auditUid(db), createdAt: new Date(), ...extra });
const uidOf = new Map([[exp, EXP], [plain, PLAIN], [ret, RET], [manager, MANAGER]]);
const auditUid = (db) => uidOf.get(db);
await check("a cashier with recordExpenses logs EXPENSE_RECORDED", true, () =>
  audit(exp, "EXPENSE_RECORDED", { expenseId: "x", amount: 3000, category: "transport", storeId: STORE_A }));
await check("...and EXPENSE_UPDATED with the previous amount", true, () =>
  audit(exp, "EXPENSE_UPDATED", { expenseId: "x", amount: 4500, previousAmount: 3000, category: "transport", storeId: STORE_A }));
await check("a plain cashier cannot log EXPENSE_RECORDED", false, () =>
  audit(plain, "EXPENSE_RECORDED", { expenseId: "x", amount: 3000 }));
await check("a cashier with processReturns logs RETURN_PROCESSED", true, () =>
  audit(ret, "RETURN_PROCESSED", { saleId: "s1", refundAmount: 400, itemCount: 1 }));
await check("a plain cashier still cannot log RETURN_PROCESSED", false, () =>
  audit(plain, "RETURN_PROCESSED", { saleId: "s1", refundAmount: 400, itemCount: 1 }));
await check("no permission lets a cashier log a void", false, () =>
  audit(ret, "SALE_VOIDED", { saleId: "s1", total: 1000 }));
await check("a manager logs EXPENSE_UPDATED", true, () =>
  audit(manager, "EXPENSE_UPDATED", { expenseId: "x", amount: 4500, previousAmount: 3000 }));

// ===========================================================================
console.log("\n=== managers: the same own-record, same-day correction, map ignored ===");
await check("a manager corrects their own entry on the day", true, () =>
  updateDoc(doc(manager, "users", OWNER, "expenses", "managersToday"), { amount: 7000 }));
await check("a manager cannot correct their own entry after the day", false, () =>
  updateDoc(doc(manager, "users", OWNER, "expenses", "managersOld"), { amount: 1 }));
await check("a manager cannot correct a cashier's entry", false, () =>
  updateDoc(doc(manager, "users", OWNER, "expenses", "mineToday"), { amount: 1 }));
await check("a manager still reads the whole branch book", true, () =>
  getDoc(doc(manager, "users", OWNER, "expenses", "ownersExpense")));
await check("a manager still records, whatever the map says", true, () =>
  setDoc(doc(manager, "users", OWNER, "expenses", id("e")), expense(MANAGER)));
await check("a manager still sells on credit, whatever the map says", true, () =>
  setDoc(doc(manager, "users", OWNER, "sales", id("s")), sale(MANAGER, { paymentMethod: "credit", amountPaid: 0, balanceDue: 1000 })));
await check("a manager still takes a repayment, whatever the map says", true, () =>
  updateDoc(doc(manager, "users", OWNER, "customers", "c1"), { balanceOwed: 40000, updatedAt: new Date() }));
await check("the owner still corrects anything, any day", true, () =>
  updateDoc(doc(owner, "users", OWNER, "expenses", "mineOld"), { amount: 2500 }));

// ===========================================================================
console.log("\n=== sellOnCredit and takeRepayments withdrawn ===");
await check("cash still sells", true, () =>
  setDoc(doc(strict, "users", OWNER, "sales", id("s")), sale(STRICT)));
await check("mobile money still sells", true, () =>
  setDoc(doc(strict, "users", OWNER, "sales", id("s")), sale(STRICT, { paymentMethod: "mobile", cashTendered: null, changeDue: null })));
await check("a credit sale is refused", false, () =>
  setDoc(doc(strict, "users", OWNER, "sales", id("s")), sale(STRICT, { paymentMethod: "credit", amountPaid: 0, balanceDue: 1000 })));
await check("a balance DECREASE is refused", false, () =>
  updateDoc(doc(strict, "users", OWNER, "customers", "c1"), { balanceOwed: 1, updatedAt: new Date() }));
await check("a write-off to zero is refused (L-10 narrowed for this cashier)", false, () =>
  updateDoc(doc(strict, "users", OWNER, "customers", "c1"), { balanceOwed: 0, updatedAt: new Date() }));
await check("a payment document is refused", false, () =>
  setDoc(doc(strict, "users", OWNER, "customers", "c1", "payments", id("pay")), { amount: 5000, createdAt: new Date() }));

// ===========================================================================
console.log("\n=== processReturns: returns yes, voids no, same caps as a manager ===");
{
  const saleId = await seedSale();
  await check("a partial return", true, () =>
    updateDoc(doc(ret, "users", OWNER, "sales", saleId),
      { returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 }));
  await check("a refund cannot be rewound", false, () =>
    updateDoc(doc(ret, "users", OWNER, "sales", saleId), { returns: [], refundedAmount: 0 }));
  await check("a refund cannot exceed the sale", false, () =>
    updateDoc(doc(ret, "users", OWNER, "sales", saleId),
      { returns: [{ productId: "p1", qty: 1, amount: 500 }, { productId: "p1", qty: 9, amount: 9000 }], refundedAmount: 9500 }));
  const voidId = await seedSale();
  await check("a void is still refused", false, () =>
    updateDoc(doc(ret, "users", OWNER, "sales", voidId), { voided: true, voidedAt: new Date() }));
  const bSale = await seedSale({ storeId: STORE_B });
  await check("a return in a branch they are not assigned is refused", false, () =>
    updateDoc(doc(ret, "users", OWNER, "sales", bSale),
      { returns: [{ productId: "p1", qty: 1, amount: 500 }], refundedAmount: 500 }));
}

// ===========================================================================
console.log("\n=== receiveDeliveries: a request, never a delivery ===");
const request = (over = {}) => ({
  storeId: STORE_A, requestedByUid: DEL, requestedByName: "Neema", status: "pending",
  supplierName: "Festive Ltd", reference: "INV-77", receivedAt: new Date(),
  lines: [{ productId: "p1", name: "Sugar", qty: 50 }], createdAt: serverTimestamp(), ...over
});
await check("records a pending request", true, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", "req1"), request()));
await check("with an optional invoice total", true, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", "req2"), request({ invoiceTotal: 250000 })));
await check("cannot create one already approved", false, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", id("r")), request({ status: "approved" })));
await check("cannot create one under someone else's name", false, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", id("r")), request({ requestedByUid: MANAGER })));
await check("cannot create one with no lines", false, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", id("r")), request({ lines: [] })));
await check("cannot create one in another branch", false, () =>
  setDoc(doc(del, "users", OWNER, "deliveryRequests", id("r")), request({ storeId: STORE_B })));
await check("cannot write a delivery directly", false, () =>
  setDoc(doc(del, "users", OWNER, "deliveries", id("d")), {
    storeId: STORE_A, reference: "INV-77", supplierName: "Festive Ltd", receivedAt: new Date(),
    goodsCost: 1000, freight: 0, importDuty: 0, clearing: 0, transport: 0, handling: 0,
    insurance: 0, otherCost: 0, additionalTotal: 0, totalCost: 1000, allocationBasis: "value",
    lineCount: 1, recordedByUid: DEL, createdAt: new Date()
  }));
await check("reads their own request", true, () =>
  getDoc(doc(del, "users", OWNER, "deliveryRequests", "req1")));
await check("their own-requests query is allowed", true, () =>
  getDocs(query(collection(del, "users", OWNER, "deliveryRequests"),
    where("requestedByUid", "==", DEL), where("storeId", "in", [STORE_A]), orderBy("createdAt", "desc"))));
await check("a plain cashier cannot read the request", false, () =>
  getDoc(doc(plain, "users", OWNER, "deliveryRequests", "req1")));
await check("edits their own while pending", true, () =>
  updateDoc(doc(del, "users", OWNER, "deliveryRequests", "req1"),
    { lines: [{ productId: "p1", name: "Sugar", qty: 48 }], updatedAt: new Date() }));
await check("cannot approve their own", false, () =>
  updateDoc(doc(del, "users", OWNER, "deliveryRequests", "req1"),
    { status: "approved", decidedByUid: DEL, decidedAt: serverTimestamp(), deliveryId: "dX" }));
await check("cancels their own", true, () =>
  updateDoc(doc(del, "users", OWNER, "deliveryRequests", "req2"), { status: "cancelled", updatedAt: new Date() }));
await check("a cancelled request cannot be revived", false, () =>
  updateDoc(doc(del, "users", OWNER, "deliveryRequests", "req2"), { status: "pending" }));
await check("nobody deletes a request, not even the owner", false, () =>
  deleteDoc(doc(owner, "users", OWNER, "deliveryRequests", "req1")));

console.log("\n=== approval is only true together with the delivery it produced ===");
const deliveryHeader = (uid, over = {}) => ({
  storeId: STORE_A, reference: "INV-77", supplierName: "Festive Ltd",
  receivedAt: new Date(), goodsCost: 10000, freight: 0, importDuty: 0, clearing: 0,
  transport: 0, handling: 0, insurance: 0, otherCost: 0, additionalTotal: 0, totalCost: 10000,
  allocationBasis: "value", lineCount: 1, recordedByUid: uid, createdAt: new Date(), ...over
});
await check("a manager in another branch cannot see the request", false, () =>
  getDoc(doc(managerB, "users", OWNER, "deliveryRequests", "req1")));
await check("a manager cannot mark it approved without a delivery", false, () =>
  updateDoc(doc(manager, "users", OWNER, "deliveryRequests", "req1"),
    { status: "approved", decidedByUid: MANAGER, decidedAt: serverTimestamp(), deliveryId: "neverWritten" }));
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", OWNER, "deliveries", "oldDelivery"), deliveryHeader(OWNER));
});
await check("...nor point it at a delivery recorded some other time", false, () =>
  updateDoc(doc(manager, "users", OWNER, "deliveryRequests", "req1"),
    { status: "approved", decidedByUid: MANAGER, decidedAt: serverTimestamp(), deliveryId: "oldDelivery" }));
await check("...nor change the lines while deciding", false, async () => {
  const batch = writeBatch(manager);
  batch.set(doc(manager, "users", OWNER, "deliveries", "dTamper"), deliveryHeader(MANAGER));
  batch.update(doc(manager, "users", OWNER, "deliveryRequests", "req1"), {
    status: "approved", decidedByUid: MANAGER, decidedAt: serverTimestamp(), deliveryId: "dTamper",
    lines: [{ productId: "p1", name: "Sugar", qty: 1 }]
  });
  return batch.commit();
});
await check("a manager approves it in the same write as the delivery", true, async () => {
  const batch = writeBatch(manager);
  batch.set(doc(manager, "users", OWNER, "deliveries", "dApproved"), deliveryHeader(MANAGER));
  batch.update(doc(manager, "users", OWNER, "deliveryRequests", "req1"),
    { status: "approved", decidedByUid: MANAGER, decidedAt: serverTimestamp(), deliveryId: "dApproved" });
  return batch.commit();
});
await check("an approved request cannot be approved again", false, async () => {
  const batch = writeBatch(owner);
  batch.set(doc(owner, "users", OWNER, "deliveries", "dTwice"), deliveryHeader(OWNER));
  batch.update(doc(owner, "users", OWNER, "deliveryRequests", "req1"),
    { status: "approved", decidedByUid: OWNER, decidedAt: serverTimestamp(), deliveryId: "dTwice" });
  return batch.commit();
});
await check("...nor edited by the cashier afterwards", false, () =>
  updateDoc(doc(del, "users", OWNER, "deliveryRequests", "req1"),
    { lines: [{ productId: "p1", name: "Sugar", qty: 999 }] }));
await check("the owner rejects a pending request with a reason", true, async () => {
  await setDoc(doc(del, "users", OWNER, "deliveryRequests", "req3"), request());
  return updateDoc(doc(owner, "users", OWNER, "deliveryRequests", "req3"),
    { status: "rejected", decidedByUid: OWNER, decidedAt: serverTimestamp(), rejectReason: "Wrong supplier" });
});
await check("a rejection needs a reason", false, async () => {
  await setDoc(doc(del, "users", OWNER, "deliveryRequests", "req4"), request());
  return updateDoc(doc(manager, "users", OWNER, "deliveryRequests", "req4"),
    { status: "rejected", decidedByUid: MANAGER, decidedAt: serverTimestamp() });
});

// ===========================================================================
console.log("\n=== a withdrawn permission is gone on the next request ===");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await updateDoc(doc(ctx.firestore(), "users", OWNER, "members", EXP), { permissions: { recordExpenses: false } });
});
await check("recording is refused once the owner withdraws it", false, () =>
  setDoc(doc(exp, "users", OWNER, "expenses", id("e")), expense(EXP)));
await check("...and so is reading their own old entry", false, () =>
  getDoc(doc(exp, "users", OWNER, "expenses", "mineToday")));

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}${f.detail ? "  -- " + f.detail : ""}`).join("\n"));
  process.exit(1);
}
