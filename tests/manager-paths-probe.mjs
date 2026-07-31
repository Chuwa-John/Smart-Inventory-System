// Exercises the manager-only writes against the real rules, at realistic basket
// sizes. Void and return compare a dozen fields between before and after AND
// pay for the member get()s -- the same combination that blew the expression
// budget on multi-item sales.
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, collection, addDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_m";
const MANAGER = "manager_m";
const CASHIER = "cashier_m";
const STORE_A = "storeA";
const STORE_B = "storeB";
const STORE_C = "storeC";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});

const items = (n) => Array.from({ length: n }, (_, i) => ({
  productId: `p${i}`, name: `Item ${i}`, category: "Milk", brand: "Festive",
  supplier: "Festive Ltd", qty: 5, sellingPrice: 5000, lineTotal: 25000
}));

const saleDoc = (n, storeId) => ({
  items: items(n), subtotal: 25000 * n, total: 25000 * n,
  discountType: "none", discountValue: 0, discountAmount: 0,
  paymentMethod: "cash", cashTendered: 25000 * n, changeDue: 0,
  customerId: null, amountPaid: null, amountPaidMethod: null, balanceDue: null,
  branchId: storeId, storeId, cashierUid: CASHIER, staffId: CASHIER,
  staffName: "John Chuwa", orderNumber: `${1000 + n}`, customerName: "", customerPhone: "",
  voided: false, createdAt: new Date()
});

const results = [];
async function probe(label, expectAllowed, fn) {
  let allowed = true;
  let msg = "";
  try { await fn(); } catch (e) { allowed = false; msg = String(e.message || e); }
  const pass = allowed === expectAllowed;
  const budget = /maximum of 1000 expressions/.test(msg);
  results.push({ label, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : `  -> ${allowed ? "ALLOWED" : (budget ? "BUDGET EXCEEDED" : "DENIED")}`}`);
}

await testEnv.clearFirestore();
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER });
  for (const s of [STORE_A, STORE_B, STORE_C]) {
    await setDoc(doc(db, "users", OWNER, "stores", s), { name: s, createdAt: new Date() });
  }
  await setDoc(doc(db, "users", OWNER, "members", MANAGER),
    { role: "manager", status: "active", storeIds: [STORE_A, STORE_B], name: "Mgr" });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER),
    { role: "cashier", status: "active", storeIds: [STORE_A], name: "Csh" });
  await setDoc(doc(db, "users", OWNER, "customers", "c1"),
    { name: "Amina", phone: "0700000000", balanceOwed: 0, creditLimit: 0, storeId: STORE_A, createdAt: new Date() });
  for (const n of [1, 2, 5, 20, 40]) {
    await setDoc(doc(db, "users", OWNER, "sales", `void_${n}`), saleDoc(n, STORE_A));
    await setDoc(doc(db, "users", OWNER, "sales", `ret_${n}`), saleDoc(n, STORE_A));
  }
  await setDoc(doc(db, "users", OWNER, "sales", "otherStore"), saleDoc(2, STORE_C));
  await setDoc(doc(db, "users", OWNER, "products", "pA"),
    { name: "A", category: "c", brand: "b", supplier: "s", quantity: 100, storeId: STORE_A, sellingPrice: 100, createdAt: new Date() });
});

const mgr = testEnv.authenticatedContext(MANAGER).firestore();
const csh = testEnv.authenticatedContext(CASHIER).firestore();

console.log("\n=== manager voids a sale, by basket size ===");
for (const n of [1, 2, 5, 20, 40]) {
  await probe(`manager CAN void a ${n}-item sale`, true,
    () => updateDoc(doc(mgr, "users", OWNER, "sales", `void_${n}`), { voided: true, voidedAt: new Date() }));
}

console.log("\n=== manager processes a return, by basket size ===");
for (const n of [1, 2, 5, 20, 40]) {
  await probe(`manager CAN return on a ${n}-item sale`, true,
    () => updateDoc(doc(mgr, "users", OWNER, "sales", `ret_${n}`), {
      returns: [{ items: [{ productId: "p0", name: "Item 0", qty: 1, lineTotal: 5000 }],
        subtotalReturned: 5000, discountShare: 0, refundAmount: 5000,
        staffId: MANAGER, staffName: "Mgr", createdAt: new Date().toISOString() }],
      refundedAmount: 5000
    }));
}

console.log("\n=== manager-only boundaries hold ===");
await probe("manager CANNOT void a sale in an unassigned store", false,
  () => updateDoc(doc(mgr, "users", OWNER, "sales", "otherStore"), { voided: true, voidedAt: new Date() }));
await probe("cashier CANNOT void a sale", false,
  () => updateDoc(doc(csh, "users", OWNER, "sales", "void_1"), { voided: true, voidedAt: new Date() }));
await probe("manager CAN set a credit limit", true,
  () => updateDoc(doc(mgr, "users", OWNER, "customers", "c1"), { creditLimit: 500000 }));
await probe("cashier CANNOT set a credit limit", false,
  () => updateDoc(doc(csh, "users", OWNER, "customers", "c1"), { creditLimit: 900000 }));
await probe("manager CAN transfer between two assigned stores", true,
  () => addDoc(collection(mgr, "users", OWNER, "transfers"), {
    productId: "pA", productName: "A", quantity: 5, staffName: "Mgr",
    sourceStoreId: STORE_A, destinationStoreId: STORE_B,
    performedByUid: MANAGER, createdAt: new Date()
  }));
await probe("manager CANNOT transfer into an unassigned store", false,
  () => addDoc(collection(mgr, "users", OWNER, "transfers"), {
    productId: "pA", productName: "A", quantity: 5, staffName: "Mgr",
    sourceStoreId: STORE_A, destinationStoreId: STORE_C,
    performedByUid: MANAGER, createdAt: new Date()
  }));
await probe("manager CANNOT create a product", false,
  () => setDoc(doc(mgr, "users", OWNER, "products", "newP"),
    { name: "New", category: "c", brand: "b", supplier: "s", quantity: 1, storeId: STORE_A, sellingPrice: 10, createdAt: new Date() }));
await probe("manager CAN sell a 40-item basket", true,
  () => setDoc(doc(mgr, "users", OWNER, "sales", "mgr_sale_40"),
    { ...saleDoc(40, STORE_A), cashierUid: MANAGER, staffId: MANAGER, staffName: "Mgr", orderNumber: "7777" }));

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} as expected`);
if (failed.length) { console.log("UNEXPECTED:", failed.map((f) => f.label).join(" | ")); process.exit(1); }
