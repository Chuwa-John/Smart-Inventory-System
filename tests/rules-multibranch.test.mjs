// Phase 23: multi-branch operations.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-multibranch.test.mjs"
//
// rules-access and rules-workflow already prove the basics: a cashier cannot
// read another branch's products or ring a sale into it. This covers what they
// do not.
//
// The case that matters most is stock LEAVING a branch. A manager who can move
// goods into a branch they do not cover has moved inventory somewhere they
// cannot be audited, and the paper trail follows the goods out of reach.
//
// The second is a regression risk I introduced: store writes were widened so
// staff could hold the one-open-shift pointer. rules-shifts proves a cashier
// cannot use that to rename a branch. A manager has a wider role, so the same
// question has to be asked of them separately.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_mb";
const MGR_AB = "manager_ab";      // covers A and B
const MGR_ALL = "manager_all";    // roaming: storeIds ["all"]
const CASHIER_A = "cashier_a_mb";
const A = "branchA", B = "branchB", C = "branchC";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  for (const [id, name, ccy] of [[A, "Kariakoo", "TZS"], [B, "Mwanza", "TZS"], [C, "Arusha", "TZS"]]) {
    await setDoc(doc(db, "users", OWNER, "stores", id), { name, currencyCode: ccy });
  }
  await setDoc(doc(db, "users", OWNER, "members", MGR_AB), { role: "manager", status: "active", storeIds: [A, B] });
  await setDoc(doc(db, "users", OWNER, "members", MGR_ALL), { role: "manager", status: "active", storeIds: ["all"] });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER_A), { role: "cashier", status: "active", storeIds: [A] });
  for (const [id, store] of [["pA", A], ["pB", B], ["pC", C]]) {
    await setDoc(doc(db, "users", OWNER, "products", id), {
      name: "Sukari", category: "Food", brand: "X", supplier: "Y",
      quantity: 40, storeId: store, sellingPrice: 1500, createdAt: new Date()
    });
  }
});

const results = [];
async function check(name, promise) {
  try { await promise; results.push({ name, pass: true }); console.log(`PASS  ${name}`); }
  catch (e) { results.push({ name, pass: false }); console.log(`FAIL  ${name}\n      ${String(e).slice(0, 110)}`); }
}
const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const transfer = (from, to, uid, name) => ({
  productId: "pA", productName: "Sukari", quantity: 5,
  sourceStoreId: from, destinationStoreId: to,
  staffName: name, performedByUid: uid, createdAt: new Date()
});

console.log("=== stock cannot leave for a branch the mover does not cover ===");
await check("a manager may move stock between two branches they cover",
  assertSucceeds(setDoc(doc(as(MGR_AB), "users", OWNER, "transfers", "t1"), transfer(A, B, MGR_AB, "Juma"))));
await check("a manager may NOT move stock INTO a branch they do not cover",
  assertFails(setDoc(doc(as(MGR_AB), "users", OWNER, "transfers", "t2"), transfer(A, C, MGR_AB, "Juma"))));
await check("a manager may NOT move stock OUT of a branch they do not cover",
  assertFails(setDoc(doc(as(MGR_AB), "users", OWNER, "transfers", "t3"), transfer(C, A, MGR_AB, "Juma"))));
await check("a cashier may not move stock at all",
  assertFails(setDoc(doc(as(CASHIER_A), "users", OWNER, "transfers", "t4"), transfer(A, B, CASHIER_A, "Asha"))));
await check("a transfer cannot be edited after the fact",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "transfers", "t1"), { quantity: 500 })));

console.log("\n=== the roaming manager, and what 'all' actually grants ===");
await check("a manager scoped to all branches may move stock anywhere",
  assertSucceeds(setDoc(doc(as(MGR_ALL), "users", OWNER, "transfers", "t5"), transfer(C, A, MGR_ALL, "Neema"))));
await check("...and may read a branch nobody assigned explicitly",
  assertSucceeds(getDoc(doc(as(MGR_ALL), "users", OWNER, "products", "pC"))));
await check("a branch-scoped manager still cannot read outside their branches",
  assertFails(getDoc(doc(as(MGR_AB), "users", OWNER, "products", "pC"))));

console.log("\n=== headquarters sees across branches; staff do not ===");
await check("the owner reads any branch",
  assertSucceeds(getDoc(doc(as(OWNER), "users", OWNER, "products", "pC"))));
await check("the owner reads any branch's settings",
  assertSucceeds(getDoc(doc(as(OWNER), "users", OWNER, "stores", C))));
await check("a cashier cannot read a branch they are not on",
  assertFails(getDoc(doc(as(CASHIER_A), "users", OWNER, "stores", B))));

console.log("\n=== branch settings survived widening store writes for shifts ===");
// The shift pointer needed staff to write to the store document. That must not
// have become a general licence -- asked of a MANAGER here, since rules-shifts
// only asked it of a cashier and a manager holds the wider role.
await check("a manager may set the current shift pointer on their branch",
  assertSucceeds(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", A), { currentShiftId: "s1" })));
await check("a manager may NOT rename a branch",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", A), { name: "Renamed" })));
await check("a manager may NOT change a branch's currency",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", A), { currencyCode: "USD" })));
await check("a manager may NOT archive a branch",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", A), { archived: true })));
await check("a manager may NOT smuggle a rename alongside the pointer",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", A), { currentShiftId: "s2", name: "Renamed" })));
await check("a manager may NOT touch the pointer on a branch they do not cover",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "stores", C), { currentShiftId: "s3" })));
await check("the owner keeps full control of branch settings",
  assertSucceeds(updateDoc(doc(as(OWNER), "users", OWNER, "stores", A), { name: "Kariakoo Main", currencyCode: "TZS" })));

console.log("\n=== a shift belongs to one branch ===");
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "users", OWNER, "shifts", "shiftC"), {
    storeId: C, status: "open", openingFloat: 10000,
    openedByUid: MGR_ALL, openedByName: "Neema", openedAt: new Date()
  });
});
await check("a manager cannot close a shift on a branch they do not cover",
  assertFails(updateDoc(doc(as(MGR_AB), "users", OWNER, "shifts", "shiftC"), {
    status: "closed", countedCash: 9000, expectedCash: 10000, variance: -1000,
    cashSales: 0, cashRefunds: 0, cashRepayments: 0,
    closedByUid: MGR_AB, closedByName: "Juma", closedAt: new Date(), note: ""
  })));
await check("a manager cannot read a shift from a branch they do not cover",
  assertFails(getDoc(doc(as(MGR_AB), "users", OWNER, "shifts", "shiftC"))));

await testEnv.cleanup();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
