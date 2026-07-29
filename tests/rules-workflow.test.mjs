import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, query, where, setDoc, addDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const CASHIER = "cashier_uid_1";
const MANAGER = "manager_uid_1";
const STORE_A = "storeA";
const STORE_B = "storeB";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"), host: "127.0.0.1", port: 8085 }
});
await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A, STORE_B] });
  await setDoc(doc(db, "users", OWNER, "staff", "st1"), { name: "Michael", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "products", "p1"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  });
  await setDoc(doc(db, "users", OWNER, "products", "pB"), {
    name: "Salt", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_B, sellingPrice: 100, createdAt: new Date()
  });
  await setDoc(doc(db, "users", OWNER, "customers", "c1"), {
    name: "Amina", phone: "0700000000", balanceOwed: 0, storeId: STORE_A, createdAt: new Date()
  });
});

const results = [];
async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn()); else await assertFails(fn());
    results.push({ name, pass: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, pass: false, detail: String(e.message || e).slice(0, 200) });
    console.log(`FAIL  ${name}\n      ${String(e.message || e).slice(0, 200)}`);
  }
}

const cashier = testEnv.authenticatedContext(CASHIER).firestore();
const manager = testEnv.authenticatedContext(MANAGER).firestore();

const saleFor = (uid, storeId, orderNumber) => ({
  items: [{ productId: "p1", name: "Sugar", qty: 1, lineTotal: 100, sellingPrice: 100 }],
  total: 100, subtotal: 100, cashierUid: uid, voided: false, storeId,
  staffId: "st1", staffName: "Michael", orderNumber,
  paymentMethod: "cash", createdAt: new Date(), cashTendered: 100, changeDue: 0
});

console.log("\n=== CORE TILL WORKFLOW (cashier) ===");
await check("cashier CAN complete a sale in its own store", true,
  () => setDoc(doc(cashier, "users", OWNER, "sales", "ord_st1_8097"), saleFor(CASHIER, STORE_A, "8097")));

await check("cashier CANNOT ring a sale into another branch", false,
  () => setDoc(doc(cashier, "users", OWNER, "sales", "ord_st1_8098"), saleFor(CASHIER, STORE_B, "8098")));

await check("cashier CANNOT forge another user's cashierUid on a sale", false,
  () => setDoc(doc(cashier, "users", OWNER, "sales", "ord_st1_8099"), saleFor(MANAGER, STORE_A, "8099")));

await check("cashier CAN write an audit log entry", true,
  () => addDoc(collection(cashier, "users", OWNER, "auditLogs"), { uid: CASHIER, action: "SALE_COMPLETED", createdAt: new Date() }));

await check("cashier CANNOT forge someone else's uid in an audit log", false,
  () => addDoc(collection(cashier, "users", OWNER, "auditLogs"), { uid: OWNER, action: "SALE_COMPLETED", createdAt: new Date() }));

await check("cashier CAN read the staff name list", true,
  () => getDocs(collection(cashier, "users", OWNER, "staff")));

await check("cashier CAN decrement stock on sale (quantity+sold counters)", true,
  () => updateDoc(doc(cashier, "users", OWNER, "products", "p1"), { quantity: 9, sold30: 1, sold90: 1, updatedAt: new Date() }));

await check("cashier CAN restock (quantity only)", true,
  () => updateDoc(doc(cashier, "users", OWNER, "products", "p1"), { quantity: 50, updatedAt: new Date() }));

await check("manager CAN restore stock on a return/void", true,
  () => updateDoc(doc(manager, "users", OWNER, "products", "p1"), { quantity: 51, sold30: 0, sold90: 0, updatedAt: new Date() }));

await check("cashier CANNOT drive stock negative", false,
  () => updateDoc(doc(cashier, "users", OWNER, "products", "p1"), { quantity: -5, updatedAt: new Date() }));

await check("cashier CANNOT smuggle a price change into a stock movement", false,
  () => updateDoc(doc(cashier, "users", OWNER, "products", "p1"), { quantity: 8, sellingPrice: 1, updatedAt: new Date() }));

await check("cashier CANNOT move stock in an unassigned branch", false,
  () => updateDoc(doc(cashier, "users", OWNER, "products", "pB"), { quantity: 1, updatedAt: new Date() }));

console.log("\n=== CREDIT / CUSTOMERS ===");
await check("cashier CAN record a payment against a customer in its store", true,
  () => addDoc(collection(cashier, "users", OWNER, "customers", "c1", "payments"), { amount: 500, note: "part payment" }));

await check("cashier CAN update customer balance only", true,
  () => updateDoc(doc(cashier, "users", OWNER, "customers", "c1"), { balanceOwed: 500, updatedAt: new Date() }));

await check("cashier CANNOT set a credit limit", false,
  () => updateDoc(doc(cashier, "users", OWNER, "customers", "c1"), { creditLimit: 999999 }));

await check("manager CAN set a credit limit", true,
  () => updateDoc(doc(manager, "users", OWNER, "customers", "c1"), { creditLimit: 5000 }));

await check("cashier CANNOT rename a customer while updating balance", false,
  () => updateDoc(doc(cashier, "users", OWNER, "customers", "c1"), { balanceOwed: 10, name: "Hacked" }));

console.log("\n=== TRANSFERS ===");
const transfer = (uid) => ({
  productId: "p1", productName: "Sugar", quantity: 2,
  sourceStoreId: STORE_A, destinationStoreId: STORE_B,
  staffName: "Michael", performedByUid: uid, createdAt: new Date()
});
await check("manager CAN create a transfer between its two stores", true,
  () => addDoc(collection(manager, "users", OWNER, "transfers"), transfer(MANAGER)));
await check("cashier CANNOT create a transfer", false,
  () => addDoc(collection(cashier, "users", OWNER, "transfers"), transfer(CASHIER)));

console.log("\n=== OWNER-ONLY SURFACES ===");
await check("cashier CANNOT create a product", false,
  () => setDoc(doc(cashier, "users", OWNER, "products", "p_new"), {
    name: "New", category: "C", brand: "B", supplier: "S", quantity: 1, storeId: STORE_A, createdAt: new Date()
  }));
await check("manager CANNOT create a product", false,
  () => setDoc(doc(manager, "users", OWNER, "products", "p_new2"), {
    name: "New", category: "C", brand: "B", supplier: "S", quantity: 1, storeId: STORE_A, createdAt: new Date()
  }));
await check("cashier CANNOT write a member doc (privilege escalation)", false,
  () => setDoc(doc(cashier, "users", OWNER, "members", CASHIER), { role: "owner", status: "active", storeIds: ["all"] }));
await check("cashier CANNOT read the private security doc", false,
  () => getDoc(doc(cashier, "users", OWNER, "private", "security")));
await check("owner CANNOT read the private security doc either", false,
  () => getDoc(doc(testEnv.authenticatedContext(OWNER).firestore(), "users", OWNER, "private", "security")));

console.log("\n=== CROSS-TENANT ISOLATION ===");
const outsider = testEnv.authenticatedContext("random_outsider").firestore();
await check("outsider CANNOT read another business's products", false,
  () => getDocs(query(collection(outsider, "users", OWNER, "products"), where("storeId", "in", [STORE_A]))));
await check("outsider CANNOT read another business's stores", false,
  () => getDoc(doc(outsider, "users", OWNER, "stores", STORE_A)));
await check("outsider CANNOT create a sale in another business", false,
  () => setDoc(doc(outsider, "users", OWNER, "sales", "evil"), saleFor("random_outsider", STORE_A, "1")));

console.log("\n=== user profile doc (own settings, not authz) ===");
await check("staff CAN create their own profile doc", true,
  () => setDoc(doc(cashier, "users", CASHIER), { uid: CASHIER, email: "c@x.com", businessName: "", role: "Staff" }));
await check("staff CANNOT change role on their own profile afterwards", false,
  () => setDoc(doc(cashier, "users", CASHIER), { uid: CASHIER, role: "Owner" }, { merge: true }));
await check("staff CAN update other profile fields without resending role", true,
  () => setDoc(doc(cashier, "users", CASHIER), { businessName: "Updated" }, { merge: true }));
await check("staff CANNOT write another user's profile", false,
  () => setDoc(doc(cashier, "users", OWNER), { uid: OWNER, role: "Owner" }, { merge: true }));

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
