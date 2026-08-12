// Phase A of DESIGN-services.md: the services collection and its rules.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-services.test.mjs"
//
// A bar/restaurant or salon sells things that have a price and no shelf -- a
// haircut, a plate of food. Those cannot live in `products`: validProduct()
// requires stockCountInRange(d.quantity) on every write, and a service has no
// quantity. Not zero -- none. Storing zero would be worse than a separate
// collection, because stockStatus() reads zero as permanently out of stock and
// every reorder surface would carry a haircut forever.
//
// This file pins the boundary that decision creates, and one asymmetry that is
// easy to "fix" wrongly later: services are owner-write with NO staff branch.
// products has one only because selling decrements stock, so a cashier must
// touch the document mid-sale. Selling a service writes nothing back to it, so
// no staff write is needed and the narrower rule is the correct one. Anyone
// widening it should have to delete an assertion that says why.
//
// Nothing here is deployed. Phase A is rules-only and the live system is in
// beta with real businesses on it; see the commit message.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const CASHIER = "cashier_uid_1";
const MANAGER = "manager_uid_1";
const OUTSIDER = "outsider_uid_1";
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

// Shared by the seed and by every update assertion below, because
// serviceImmutableFieldsUnchanged() pins createdAt across updates.
const SEEDED_AT = new Date("2026-01-01T00:00:00Z");

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", businessType: "salon", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", businessType: "bar", createdAt: new Date() });

  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });

  await setDoc(doc(db, "users", OWNER, "services", "svcA"), {
    id: "svcA", name: "Braiding", price: 25000, storeId: STORE_A,
    category: "Hair", active: true, createdAt: SEEDED_AT
  });
  await setDoc(doc(db, "users", OWNER, "services", "svcB"), {
    id: "svcB", name: "Chicken and Chips", price: 12000, storeId: STORE_B,
    category: "Mains", active: true, createdAt: SEEDED_AT
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

const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
const cashierDb = testEnv.authenticatedContext(CASHIER).firestore();
const managerDb = testEnv.authenticatedContext(MANAGER).firestore();
const outsiderDb = testEnv.authenticatedContext(OUTSIDER).firestore();
const anonDb = testEnv.unauthenticatedContext().firestore();

// Fixed, not `new Date()` per call. serviceImmutableFieldsUnchanged() pins
// createdAt across updates, and the real client honours that -- saveProduct()
// writes `createdAt: existing?.createdAt || serverTimestamp()`. A helper that
// minted a fresh timestamp per call would fail every legitimate update and make
// this suite look like the rule was broken when it was the test that was.
const svc = (over = {}) => ({
  id: "new1", name: "Manicure", price: 8000, storeId: STORE_A,
  category: "Nails", active: true, createdAt: SEEDED_AT, ...over
});

console.log("=== the owner owns the price list ===");
await check("owner creates a service", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "new1"), svc()));
await check("owner reads it back", true, () =>
  getDoc(doc(ownerDb, "users", OWNER, "services", "new1")));
await check("owner updates the price", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "new1"), svc({ price: 9000 })));
await check("owner withdraws it from the menu", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "new1"), svc({ price: 9000, active: false })));
await check("owner deletes it", true, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "services", "new1")));

console.log("\n=== staff may read the menu for their own store, and no other ===");
await check("cashier reads a service in their store", true, () =>
  getDoc(doc(cashierDb, "users", OWNER, "services", "svcA")));
await check("manager reads a service in their store", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "services", "svcA")));
await check("cashier cannot read another branch's menu", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "services", "svcB")));
// The client subscribes with where("storeId","in",[...]) exactly as it does for
// products, because storeId lives in the document body and a bare list query
// cannot be proved per-document.
await check("a store-scoped list query is allowed", true, () =>
  getDocs(query(collection(cashierDb, "users", OWNER, "services"), where("storeId", "in", [STORE_A]))));
await check("an unscoped list query is refused", false, () =>
  getDocs(collection(cashierDb, "users", OWNER, "services")));

console.log("\n=== pricing the menu is not a staff action ===");
// The asymmetry with products, and the reason for it: a sale decrements stock,
// so a cashier must be able to write a product mid-sale. A sale writes nothing
// back to a service, so there is no such need and no such branch.
await check("cashier cannot create a service", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "services", "cashierMade"), svc({ id: "cashierMade" })));
await check("cashier cannot reprice a service", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "services", "svcA"), { price: 1 }));
await check("manager cannot reprice a service either", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "services", "svcA"), { price: 1 }));
await check("cashier cannot delete a service", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "services", "svcA")));

console.log("\n=== nobody outside the business gets in ===");
await check("an unrelated signed-in user cannot read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "services", "svcA")));
await check("an unrelated signed-in user cannot write", false, () =>
  setDoc(doc(outsiderDb, "users", OWNER, "services", "x"), svc({ id: "x" })));
await check("an anonymous visitor cannot read", false, () =>
  getDoc(doc(anonDb, "users", OWNER, "services", "svcA")));

console.log("\n=== the shape is enforced ===");
await check("a service needs a name", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad1"), svc({ id: "bad1", name: "" })));
await check("a service needs a store", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad2"), svc({ id: "bad2", storeId: "" })));
await check("a service needs a price", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad3"), { id: "bad3", name: "No price", storeId: STORE_A }));
await check("a negative price is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad4"), svc({ id: "bad4", price: -1 })));
await check("a price beyond the money bound is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad5"), svc({ id: "bad5", price: 1000000001 })));
// Infinity satisfies `is number` and `>= 0`; moneyInRange's upper bound is what
// actually stops it, and it is the reason that helper exists.
await check("an infinite price is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad6"), svc({ id: "bad6", price: Infinity })));
await check("a price that is not a number is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad7"), svc({ id: "bad7", price: "8000" })));
await check("an over-long name is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad8"), svc({ id: "bad8", name: "x".repeat(121) })));
await check("an over-long category is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad9"), svc({ id: "bad9", category: "x".repeat(61) })));
await check("a non-boolean active flag is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "bad10"), svc({ id: "bad10", active: "yes" })));

console.log("\n=== tax class follows the product rule exactly ===");
// Same enum, same default. DESIGN-vat.md: absent means standard-rated, because
// defaulting the other way silently under-collects.
for (const cls of ["standard", "zeroRated", "exempt"]) {
  await check(`taxClass "${cls}" is accepted`, true, () =>
    setDoc(doc(ownerDb, "users", OWNER, "services", `tax_${cls}`), svc({ id: `tax_${cls}`, taxClass: cls })));
}
await check("an invented tax class is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "taxbad"), svc({ id: "taxbad", taxClass: "vatFree" })));
await check("no tax class at all is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "taxnone"), svc({ id: "taxnone" })));

console.log("\n=== a service cannot drift between stores ===");
// Same protection productImmutableFieldsUnchanged() gives a product. Moving a
// priced item to another branch by editing one field would silently re-scope
// who can see it, and every sale that already referenced it.
await check("storeId cannot be changed by an update", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "svcA"), {
    id: "svcA", name: "Braiding", price: 25000, storeId: STORE_B,
    category: "Hair", active: true, createdAt: SEEDED_AT
  }));
// Asserted deliberately rather than tripped over. An earlier draft of this file
// sent a fresh createdAt on every update, so the legitimate cases failed and
// this protection was never actually exercised on its own.
await check("createdAt cannot be rewritten by an update", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "svcA"), {
    id: "svcA", name: "Braiding", price: 25000, storeId: STORE_A,
    category: "Hair", active: true, createdAt: new Date("2030-06-01T00:00:00Z")
  }));
await check("id cannot be rewritten by an update", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "svcA"), {
    id: "somethingElse", name: "Braiding", price: 25000, storeId: STORE_A,
    category: "Hair", active: true, createdAt: SEEDED_AT
  }));
await check("a legitimate reprice of the seeded service still works", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "services", "svcA"), {
    id: "svcA", name: "Braiding", price: 27000, storeId: STORE_A,
    category: "Hair", active: true, createdAt: SEEDED_AT
  }));

console.log("\n=== a service is not a product, and the two do not cross ===");
// The whole reason for the separate collection. A service written with the
// stock fields a product carries must not be accepted as a product, and a
// product's own rule is untouched by any of this.
await check("a service document is not writable into products", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "notAProduct"), {
    id: "notAProduct", name: "Braiding", price: 25000, storeId: STORE_A, createdAt: new Date()
  }));
await check("a product still requires its stock count", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "noQty"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  }));
await check("a normal product write is unaffected", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "stillFine"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? "  -- " + f.detail : "")));
  process.exit(1);
}
