// Firestore rules for shifts and cash reconciliation.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-shifts.test.mjs"
//
// A shift record is what an owner reconciles a drawer against, so the rules
// have to hold two things that are not obvious:
//
//   1. A close may not rewrite how the shift opened. Otherwise a short drawer
//      is reconciled away after the fact by raising the float it claims to have
//      started with -- the exact move this feature exists to make visible.
//   2. Letting staff hold the one-open-shift-per-store pointer must not become
//      a general licence to edit the store. A cashier who can write to the
//      store document can rename a branch or change its currency.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_shift";
const CASHIER = "cashier_shift";
const MANAGER = "manager_shift";
const OUTSIDER = "cashier_other_store";
const STORE_A = "storeA";
const STORE_B = "storeB";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", currencyCode: "TZS" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", currencyCode: "TZS" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A, STORE_B] });
  await setDoc(doc(db, "users", OWNER, "members", OUTSIDER), { role: "cashier", status: "active", storeIds: [STORE_B] });
  // An already-open shift to exercise the close path against.
  await setDoc(doc(db, "users", OWNER, "shifts", "openShift"), {
    storeId: STORE_A, status: "open", openingFloat: 20000,
    openedByUid: CASHIER, openedByName: "Asha", openedAt: new Date()
  });
  await setDoc(doc(db, "users", OWNER, "shifts", "closedShift"), {
    storeId: STORE_A, status: "closed", openingFloat: 20000,
    openedByUid: CASHIER, openedByName: "Asha", openedAt: new Date(),
    closedByUid: CASHIER, closedByName: "Asha", closedAt: new Date(),
    countedCash: 50000, expectedCash: 50000, variance: 0
  });
});

const results = [];
async function check(name, promise) {
  try { await promise; results.push({ name, pass: true }); console.log(`PASS  ${name}`); }
  catch (error) { results.push({ name, pass: false }); console.log(`FAIL  ${name}\n      ${String(error).slice(0, 120)}`); }
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const openPayload = (storeId, uid, name) => ({
  storeId, status: "open", openingFloat: 20000,
  openedByUid: uid, openedByName: name, openedAt: new Date()
});
// EXACTLY the fields closeShift() writes, and no others. An earlier version of
// this helper also sent storeId, openingFloat and openedAt -- with openedAt set
// to a different value than the stored one. Every fraud assertion below then
// passed because the rule rejected the changed openedAt, not because it
// rejected the thing each test claims to be about. The legitimate close failed
// for the same reason, which is what gave it away.
const closePayload = (over = {}) => ({
  status: "closed",
  countedCash: 48000, expectedCash: 50000, variance: -2000,
  cashSales: 30000, cashRefunds: 0, cashRepayments: 0,
  closedByUid: CASHIER, closedByName: "Asha", closedAt: new Date(),
  note: "", ...over
});

console.log("=== opening a shift ===");
await check("a cashier may open a shift on their own till",
  assertSucceeds(setDoc(doc(as(CASHIER), "users", OWNER, "shifts", "s1"), openPayload(STORE_A, CASHIER, "Asha"))));
await check("a manager may open a shift on a till they cover",
  assertSucceeds(setDoc(doc(as(MANAGER), "users", OWNER, "shifts", "s2"), openPayload(STORE_B, MANAGER, "Juma"))));
await check("the owner may open a shift",
  assertSucceeds(setDoc(doc(as(OWNER), "users", OWNER, "shifts", "s3"), openPayload(STORE_A, OWNER, "Owner"))));
await check("a cashier may NOT open a shift on a till they do not cover",
  assertFails(setDoc(doc(as(OUTSIDER), "users", OWNER, "shifts", "s4"), openPayload(STORE_A, OUTSIDER, "Other"))));
await check("a shift may not be opened in someone else's name",
  assertFails(setDoc(doc(as(CASHIER), "users", OWNER, "shifts", "s5"), openPayload(STORE_A, MANAGER, "Juma"))));
await check("a negative opening float is refused",
  assertFails(setDoc(doc(as(CASHIER), "users", OWNER, "shifts", "s6"),
    { ...openPayload(STORE_A, CASHIER, "Asha"), openingFloat: -1 })));
await check("an opening float of Infinity is refused",
  assertFails(setDoc(doc(as(CASHIER), "users", OWNER, "shifts", "s7"),
    { ...openPayload(STORE_A, CASHIER, "Asha"), openingFloat: Infinity })));
await check("a shift cannot be created already closed",
  assertFails(setDoc(doc(as(CASHIER), "users", OWNER, "shifts", "s8"),
    { ...openPayload(STORE_A, CASHIER, "Asha"), status: "closed" })));

console.log("\n=== closing a shift ===");
await check("a cashier may close an open shift on their till",
  assertSucceeds(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "openShift"), closePayload())));
await check("a short drawer records a negative variance",
  assertSucceeds(updateDoc(doc(as(OWNER), "users", OWNER, "shifts", "s1"),
    closePayload({ closedByUid: OWNER, variance: -7500, countedCash: 42500 }))));
await check("an already-closed shift cannot be closed again",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "closedShift"), closePayload())));

console.log("\n=== a close cannot rewrite how the shift opened ===");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", OWNER, "shifts", "fraudTarget"), {
    storeId: STORE_A, status: "open", openingFloat: 20000,
    openedByUid: CASHIER, openedByName: "Asha", openedAt: new Date(0)
  });
});
await check("the opening float may not be raised to swallow a shortfall",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "fraudTarget"),
    closePayload({ openingFloat: 999999 }))));
await check("the shift may not be reassigned to someone else",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "fraudTarget"),
    closePayload({ openedByUid: MANAGER }))));
await check("the shift may not be moved to another till",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "fraudTarget"),
    closePayload({ storeId: STORE_B }))));
await check("a close may not be signed in someone else's name",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "shifts", "fraudTarget"),
    closePayload({ closedByUid: MANAGER }))));
await check("a reconciliation record cannot be deleted",
  assertFails(deleteDoc(doc(as(OWNER), "users", OWNER, "shifts", "closedShift"))));

console.log("\n=== the store pointer is not a licence to edit the store ===");
await check("a cashier may set the current shift pointer",
  assertSucceeds(updateDoc(doc(as(CASHIER), "users", OWNER, "stores", STORE_A), { currentShiftId: "s1" })));
await check("a cashier may clear it again",
  assertSucceeds(updateDoc(doc(as(CASHIER), "users", OWNER, "stores", STORE_A), { currentShiftId: null })));
await check("a cashier may NOT rename the branch",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "stores", STORE_A), { name: "Renamed" })));
await check("a cashier may NOT change the branch currency",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "stores", STORE_A), { currencyCode: "USD" })));
await check("a cashier may NOT smuggle a rename alongside the pointer",
  assertFails(updateDoc(doc(as(CASHIER), "users", OWNER, "stores", STORE_A),
    { currentShiftId: "s1", name: "Renamed" })));
await check("a cashier may NOT touch a branch they do not cover",
  assertFails(updateDoc(doc(as(OUTSIDER), "users", OWNER, "stores", STORE_A), { currentShiftId: "x" })));
await check("the owner keeps full control of the store record",
  assertSucceeds(updateDoc(doc(as(OWNER), "users", OWNER, "stores", STORE_A), { name: "Branch A renamed" })));

console.log("\n=== reading shifts ===");
await check("a cashier may read a shift on their own till",
  assertSucceeds(getDoc(doc(as(CASHIER), "users", OWNER, "shifts", "openShift"))));
await check("a cashier may NOT read a shift from a till they do not cover",
  assertFails(getDoc(doc(as(OUTSIDER), "users", OWNER, "shifts", "openShift"))));
await check("the owner may read any shift",
  assertSucceeds(getDoc(doc(as(OWNER), "users", OWNER, "shifts", "closedShift"))));

await testEnv.cleanup();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
