// The stock ledger's rules (L-2).
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-stock-ledger.test.mjs"
//
// This collection is written inside the same transaction as a sale, so the
// stakes are asymmetric in a way worth stating plainly: a rule that is too
// tight does not merely block a ledger entry, it rolls back the sale it
// travelled with and the till stops selling. Every legitimate write shape the
// client can produce is therefore asserted here BEFORE app.js writes any of
// them, and the shapes below are copied from the six stock-moving transactions
// in app.js -- sale, restock, return, void, transfer out, transfer in -- plus
// an owner adjustment.
//
// The property that makes the ledger a control rather than a log is the chain:
// quantityAfter must equal quantityBefore + delta. Without it an entry could
// claim any resulting shelf, and a replay would agree with whatever it was
// told. With it, the last entry for a product must match that product's
// current quantity, and stock moved without an entry leaves a gap worth
// exactly what went missing.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, deleteDoc, getDocs, collection } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_ledger";
const MANAGER = "manager_ledger";
const CASHIER = "cashier_ledger";
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
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A, STORE_B] });
  await setDoc(doc(db, "users", OWNER, "members", OUTSIDER), { role: "cashier", status: "active", storeIds: [STORE_B] });
  await setDoc(doc(db, "users", OWNER, "stockMovements", "seeded"), {
    productId: "p1", storeId: STORE_A, reason: "sale", delta: -1,
    quantityBefore: 10, quantityAfter: 9, uid: CASHIER, createdAt: new Date()
  });
});

const results = [];
let n = 0;
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

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const write = (uid, over = {}) =>
  setDoc(doc(as(uid), "users", OWNER, "stockMovements", `m_${n++}`), {
    productId: "p1", productName: "Sugar", storeId: STORE_A,
    reason: "sale", delta: -3, quantityBefore: 20, quantityAfter: 17,
    uid, createdAt: new Date(), ...over
  });

// --- the six shapes app.js will actually write ------------------------------
// If any of these fails, the transaction it belongs to fails with it.
console.log("=== every movement the till produces is accepted ===");
await check("a sale decrements", true, () => write(CASHIER, { reason: "sale", delta: -3, quantityBefore: 20, quantityAfter: 17, saleId: "s1" }));
await check("a restock increments", true, () => write(CASHIER, { reason: "restock", delta: 12, quantityBefore: 5, quantityAfter: 17 }));
await check("a return puts stock back", true, () => write(MANAGER, { reason: "return", delta: 2, quantityBefore: 8, quantityAfter: 10, saleId: "s1" }));
await check("a void puts the whole sale back", true, () => write(MANAGER, { reason: "void", delta: 3, quantityBefore: 8, quantityAfter: 11, saleId: "s1" }));
await check("a transfer out decrements the source", true, () => write(MANAGER, { reason: "transfer-out", delta: -4, quantityBefore: 10, quantityAfter: 6, transferId: "t1" }));
await check("a transfer in increments the destination", true, () => write(MANAGER, { reason: "transfer-in", delta: 4, quantityBefore: 0, quantityAfter: 4, transferId: "t1", storeId: STORE_B }));
await check("an owner adjustment is allowed", true, () => write(OWNER, { reason: "adjustment", delta: -2, quantityBefore: 10, quantityAfter: 8 }));
await check("the owner can write any store", true, () => write(OWNER, { storeId: STORE_B }));
await check("a movement to zero stock is fine", true, () => write(CASHIER, { delta: -20, quantityBefore: 20, quantityAfter: 0 }));

console.log("\n=== the chain cannot be faked ===");
await check("quantityAfter must equal before + delta", false,
  () => write(CASHIER, { delta: -3, quantityBefore: 20, quantityAfter: 20 }));
await check("an entry cannot understate what it took", false,
  () => write(CASHIER, { delta: -1, quantityBefore: 20, quantityAfter: 5 }));
await check("a delta of the wrong sign is caught", false,
  () => write(CASHIER, { delta: 3, quantityBefore: 20, quantityAfter: 17 }));
await check("a non-numeric delta is refused", false, () => write(CASHIER, { delta: "three" }));
await check("stock cannot go negative", false,
  () => write(CASHIER, { delta: -30, quantityBefore: 20, quantityAfter: -10 }));
await check("Infinity is refused", false,
  () => write(CASHIER, { delta: Infinity, quantityBefore: 0, quantityAfter: Infinity }));

console.log("\n=== an entry names who and what ===");
await check("the uid cannot be forged", false, () => write(CASHIER, { uid: MANAGER }));
await check("an unknown reason is refused", false, () => write(CASHIER, { reason: "shrinkage" }));
await check("a missing reason is refused", false, () => write(CASHIER, { reason: null }));
await check("an empty productId is refused", false, () => write(CASHIER, { productId: "" }));
await check("an empty storeId is refused", false, () => write(CASHIER, { storeId: "" }));
await check("an oversized product name is refused", false, () => write(CASHIER, { productName: "x".repeat(200) }));

console.log("\n=== store scoping applies here too ===");
await check("a cashier cannot log a movement in another branch", false,
  () => write(CASHIER, { storeId: STORE_B }));
await check("an outsider cannot log into a branch they do not hold", false,
  () => write(OUTSIDER, { storeId: STORE_A }));
await check("a manager can log in either branch they hold", true,
  () => write(MANAGER, { storeId: STORE_B }));

console.log("\n=== the ledger is append-only and owner-read ===");
await check("nobody may edit an entry", false,
  () => updateDoc(doc(as(OWNER), "users", OWNER, "stockMovements", "seeded"), { delta: 0 }));
await check("nobody may delete an entry", false,
  () => deleteDoc(doc(as(OWNER), "users", OWNER, "stockMovements", "seeded")));
await check("a cashier cannot read the ledger back", false,
  () => getDocs(collection(as(CASHIER), "users", OWNER, "stockMovements")));
await check("a manager cannot read the ledger back", false,
  () => getDocs(collection(as(MANAGER), "users", OWNER, "stockMovements")));
await check("the owner can read the ledger", true,
  () => getDocs(collection(as(OWNER), "users", OWNER, "stockMovements")));

console.log("\n=== a stranger gets nothing ===");
await check("an unrelated signed-in user cannot write", false,
  () => setDoc(doc(as("nobody_at_all"), "users", OWNER, "stockMovements", `m_${n++}`), {
    productId: "p1", storeId: STORE_A, reason: "sale", delta: -1,
    quantityBefore: 5, quantityAfter: 4, uid: "nobody_at_all", createdAt: new Date()
  }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
