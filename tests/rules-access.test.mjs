import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, query, orderBy, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const CASHIER = "cashier_uid_1";
const MANAGER = "manager_uid_1";
const ROAMER = "roamer_uid_1";
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

// Seed with rules disabled
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });

  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", ROAMER), { role: "cashier", status: "active", storeIds: ["all"] });

  await setDoc(doc(db, "users", OWNER, "products", "p1"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  });
  await setDoc(doc(db, "users", OWNER, "sales", "s1"), {
    items: [{ productId: "p1", name: "Sugar", qty: 1, lineTotal: 100 }],
    total: 100, cashierUid: CASHIER, voided: false, storeId: STORE_A,
    staffId: "st1", staffName: "Michael", orderNumber: "8097",
    paymentMethod: "cash", createdAt: new Date(), cashTendered: 100, changeDue: 0,
    branchId: null
  });
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
    record(name, false, String(e.message || e).slice(0, 160));
  }
}

const cashierDb = testEnv.authenticatedContext(CASHIER).firestore();
const managerDb = testEnv.authenticatedContext(MANAGER).firestore();
const roamerDb = testEnv.authenticatedContext(ROAMER).firestore();
const ownerDb = testEnv.authenticatedContext(OWNER).firestore();

console.log("\n=== THE CORE HYPOTHESIS: stores LIST vs GET ===");
await check("owner CAN list stores collection", true,
  () => getDocs(query(collection(ownerDb, "users", OWNER, "stores"), orderBy("createdAt", "asc"))));

await check("roaming(all) member CAN list stores collection", true,
  () => getDocs(query(collection(roamerDb, "users", OWNER, "stores"), orderBy("createdAt", "asc"))));

await check("branch-scoped cashier CANNOT list stores collection (the bug)", false,
  () => getDocs(query(collection(cashierDb, "users", OWNER, "stores"), orderBy("createdAt", "asc"))));

await check("branch-scoped manager CANNOT list stores collection (the bug)", false,
  () => getDocs(query(collection(managerDb, "users", OWNER, "stores"), orderBy("createdAt", "asc"))));

await check("branch-scoped cashier CAN get() its own assigned store (the fix)", true,
  () => getDoc(doc(cashierDb, "users", OWNER, "stores", STORE_A)));

await check("branch-scoped manager CAN get() its own assigned store (the fix)", true,
  () => getDoc(doc(managerDb, "users", OWNER, "stores", STORE_A)));

await check("branch-scoped cashier CANNOT get() an unassigned store", false,
  () => getDoc(doc(cashierDb, "users", OWNER, "stores", STORE_B)));

console.log("\n=== members self-read ===");
await check("cashier CAN read own member doc", true,
  () => getDoc(doc(cashierDb, "users", OWNER, "members", CASHIER)));
await check("cashier CANNOT read another member doc", false,
  () => getDoc(doc(cashierDb, "users", OWNER, "members", MANAGER)));

console.log("\n=== void / return scoping ===");
await check("manager CAN void a sale in its store", true,
  () => updateDoc(doc(managerDb, "users", OWNER, "sales", "s1"), { voided: true, voidedAt: new Date() }));
await check("cashier CANNOT void a sale", false,
  () => updateDoc(doc(cashierDb, "users", OWNER, "sales", "s1"), { voided: true, voidedAt: new Date() }));

console.log("\n=== restock (cashier-safe) ===");
await check("cashier CAN restock quantity only", true,
  () => updateDoc(doc(cashierDb, "users", OWNER, "products", "p1"), { quantity: 25, updatedAt: new Date() }));
await check("cashier CANNOT change product price", false,
  () => updateDoc(doc(cashierDb, "users", OWNER, "products", "p1"), { sellingPrice: 1 }));

console.log("\n=== products / sales list scoping ===");
await check("cashier CAN list products filtered to its store", true,
  async () => {
    const { where } = await import("firebase/firestore");
    return getDocs(query(collection(cashierDb, "users", OWNER, "products"), where("storeId", "in", [STORE_A])));
  });
await check("cashier CANNOT list products unfiltered", false,
  () => getDocs(collection(cashierDb, "users", OWNER, "products")));

console.log("\n=== monthlyReports owner-only ===");
await check("cashier CANNOT list monthlyReports", false,
  () => getDocs(collection(cashierDb, "users", OWNER, "monthlyReports")));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + " :: " + f.detail));
  process.exit(1);
}
