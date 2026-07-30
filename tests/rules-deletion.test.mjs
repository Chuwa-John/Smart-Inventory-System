// Deletion-lifecycle rules (SECURITY-AUDIT.md F-1, DATA-DELETION.md).
//
// Asserts the two properties the grace period depends on:
//   1. a frozen tenant accepts no writes, from owner or staff
//   2. no client can set, clear, or forge the deletion status itself --
//      otherwise an owner could escape the purge, or freeze themselves out
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, addDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const LIVE = "owner_live";
const FROZEN = "owner_frozen";
const CASHIER = "cashier_frozen";
const STORE = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const uid of [LIVE, FROZEN]) {
    await setDoc(doc(db, "users", uid, "stores", STORE), { name: "Branch", createdAt: new Date() });
    await setDoc(doc(db, "users", uid, "products", "p1"), {
      name: "Sugar", category: "F", brand: "B", supplier: "S",
      quantity: 10, storeId: STORE, sellingPrice: 100, createdAt: new Date()
    });
    await setDoc(doc(db, "users", uid, "customers", "c1"), {
      name: "Amina", phone: "0700000000", balanceOwed: 0, storeId: STORE, createdAt: new Date()
    });
  }
  await setDoc(doc(db, "users", LIVE), { uid: LIVE, role: "Owner", status: "active" });
  await setDoc(doc(db, "users", FROZEN), {
    uid: FROZEN, role: "Owner", status: "pending_deletion",
    deletedAt: new Date(), deletionScheduledFor: new Date(Date.now() + 30 * 864e5)
  });
  await setDoc(doc(db, "users", FROZEN, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE] });
});

const results = [];
async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn()); else await assertFails(fn());
    results.push({ name, pass: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, pass: false, detail: String(e.message || e).slice(0, 180) });
    console.log(`FAIL  ${name}\n      ${String(e.message || e).slice(0, 180)}`);
  }
}

const live = testEnv.authenticatedContext(LIVE).firestore();
const frozen = testEnv.authenticatedContext(FROZEN).firestore();
const frozenCashier = testEnv.authenticatedContext(CASHIER).firestore();

const sale = (uid, n) => ({
  items: [{ productId: "p1", name: "Sugar", qty: 1, lineTotal: 100, sellingPrice: 100 }],
  total: 100, cashierUid: uid, voided: false, storeId: STORE,
  staffId: "st1", staffName: "M", orderNumber: n, paymentMethod: "cash",
  createdAt: new Date(), cashTendered: 100, changeDue: 0
});

console.log("=== control: an active tenant still works ===");
await check("active owner CAN write a product", true,
  () => setDoc(doc(live, "users", LIVE, "products", "p_new"), {
    name: "New", category: "C", brand: "B", supplier: "S", quantity: 1, storeId: STORE, createdAt: new Date()
  }));
await check("active owner CAN create a sale", true,
  () => setDoc(doc(live, "users", LIVE, "sales", "s_live"), sale(LIVE, "1")));

console.log("\n=== phase 1: frozen tenant is read-only ===");
await check("frozen owner CAN still read own data", true,
  () => getDoc(doc(frozen, "users", FROZEN, "products", "p1")));
await check("frozen owner CANNOT create a product", false,
  () => setDoc(doc(frozen, "users", FROZEN, "products", "p_new"), {
    name: "New", category: "C", brand: "B", supplier: "S", quantity: 1, storeId: STORE, createdAt: new Date()
  }));
await check("frozen owner CANNOT update a product", false,
  () => updateDoc(doc(frozen, "users", FROZEN, "products", "p1"), { quantity: 99, updatedAt: new Date() }));
await check("frozen owner CANNOT delete a product", false,
  () => setDoc(doc(frozen, "users", FROZEN, "products", "p1"), {}).then(() =>
    import("firebase/firestore").then(({ deleteDoc }) => deleteDoc(doc(frozen, "users", FROZEN, "products", "p1")))));
await check("frozen owner CANNOT create a sale", false,
  () => setDoc(doc(frozen, "users", FROZEN, "sales", "s_frozen"), sale(FROZEN, "2")));
await check("frozen owner CANNOT create a store", false,
  () => setDoc(doc(frozen, "users", FROZEN, "stores", "s_new"), { name: "New", createdAt: new Date() }));
await check("frozen owner CANNOT write a customer", false,
  () => setDoc(doc(frozen, "users", FROZEN, "customers", "c_new"), {
    name: "X", phone: "0700000001", balanceOwed: 0, storeId: STORE, createdAt: new Date()
  }));
await check("frozen owner CANNOT write a member", false,
  () => setDoc(doc(frozen, "users", FROZEN, "members", "someone"), { role: "cashier", status: "active", storeIds: [STORE] }));

console.log("\n=== phase 1: staff of a frozen tenant cannot write ===");
await check("frozen tenant's cashier CANNOT sell", false,
  () => setDoc(doc(frozenCashier, "users", FROZEN, "sales", "s_cashier"), sale(CASHIER, "3")));
await check("frozen tenant's cashier CANNOT move stock", false,
  () => updateDoc(doc(frozenCashier, "users", FROZEN, "products", "p1"), { quantity: 5, movementReason: "sale", updatedAt: new Date() }));
await check("frozen tenant's cashier CANNOT record a payment", false,
  () => addDoc(collection(frozenCashier, "users", FROZEN, "customers", "c1", "payments"), { amount: 100 }));

console.log("\n=== audit log stays writable while frozen (evidence trail) ===");
await check("frozen owner CAN still append an audit entry", true,
  () => addDoc(collection(frozen, "users", FROZEN, "auditLogs"), {
    uid: FROZEN, action: "ACCOUNT_ACCESS_DURING_GRACE", createdAt: new Date()
  }));
await check("audit entries remain immutable", false,
  () => updateDoc(doc(frozen, "users", FROZEN, "auditLogs", "nonexistent"), { action: "x" }));

console.log("\n=== deletion status is Admin-SDK-only ===");
await check("owner CANNOT freeze their own tenant", false,
  () => setDoc(doc(live, "users", LIVE), { uid: LIVE, role: "Owner", status: "pending_deletion" }, { merge: true }));
await check("frozen owner CANNOT clear status to escape the purge", false,
  () => setDoc(doc(frozen, "users", FROZEN), { uid: FROZEN, role: "Owner", status: "active" }, { merge: true }));
await check("frozen owner CANNOT push deletionScheduledFor further out", false,
  () => setDoc(doc(frozen, "users", FROZEN), {
    uid: FROZEN, role: "Owner", deletionScheduledFor: new Date(Date.now() + 900 * 864e5)
  }, { merge: true }));
await check("frozen owner CANNOT clear deletedAt", false,
  () => setDoc(doc(frozen, "users", FROZEN), { uid: FROZEN, role: "Owner", deletedAt: null }, { merge: true }));
await check("owner CAN still update unrelated profile fields", true,
  () => setDoc(doc(live, "users", LIVE), { businessName: "Renamed" }, { merge: true }));

console.log("\n=== movementReason (F-4 audit-trail field) ===");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", LIVE, "members", "c2"), { role: "cashier", status: "active", storeIds: [STORE] });
});
const liveCashier = testEnv.authenticatedContext("c2").firestore();
const move = (quantity, extra = {}) =>
  updateDoc(doc(liveCashier, "users", LIVE, "products", "p1"), { quantity, updatedAt: new Date(), ...extra });

for (const reason of ["sale", "restock", "return", "void"]) {
  await check(`'${reason}' is an accepted movementReason`, true, () => move(12, { movementReason: reason }));
}
await check("an unrecognised movementReason is rejected", false, () => move(19, { movementReason: "shrinkage" }));
await check("a non-string movementReason is rejected", false, () => move(19, { movementReason: 7 }));

// Regression guards for two rule designs that were tried and rejected.
// Presence-based direction checking left a persisted "restock" rejecting the
// next sale (till offline for any client on a cached bundle); affectedKeys-based
// checking skipped consecutive same-value writes, i.e. every normal sale.
await check("omitting movementReason still works after a 'restock' write", true,
  () => move(30, { movementReason: "restock" }).then(() => move(4)));
await check("consecutive 'sale' writes are both still validated", true,
  () => move(3, { movementReason: "sale" }).then(() => move(2, { movementReason: "sale" })));
await check("movementReason cannot smuggle in a price change", false,
  () => move(1, { movementReason: "sale", sellingPrice: 1 }));

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
