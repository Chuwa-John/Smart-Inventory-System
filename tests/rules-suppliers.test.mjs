// The suppliers collection and its rules. DESIGN-suppliers-purchases.md §4.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-suppliers.test.mjs"
//
// Spec §5.4. A supplier used to be free text retyped onto every purchase; this
// makes it a record, so purchases can group under one name and a balance can be
// carried against it.
//
// The role split is narrower than /customers, and deliberately so:
//
//   - An OWNER does anything.
//   - A MANAGER creates and edits, because a manager is who buys stock, and only
//     within the branches they are assigned to.
//   - A CASHIER may READ but never write. Purchasing is not a till function.
//     Read is granted because the product list denormalises a supplier name and
//     a denied read would break rendering for someone who is only selling.
//   - Nobody deletes. A supplier is referenced by every purchase ever made from
//     them, so they are deactivated instead.
//
// The other thing pinned here is that `supplierId` is now ACCEPTED on a
// purchase. validPurchase() is a hasOnly() list, so an unlisted field is
// refused outright -- without that widening, every linked purchase would fail
// to write.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, deleteDoc, updateDoc, getDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const CASHIER = "cashier_uid_1";
const MANAGER = "manager_uid_1";
const MANAGER_B = "manager_uid_2";
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

const SEEDED_AT = new Date("2026-01-01T00:00:00Z");

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER_B), { role: "manager", status: "active", storeIds: [STORE_B] });

  await setDoc(doc(db, "users", OWNER, "suppliers", "supA"), {
    name: "Twiga Cement", storeId: STORE_A, openingBalance: 0, balanceOwed: 0,
    active: true, createdAt: SEEDED_AT
  });
  await setDoc(doc(db, "users", OWNER, "suppliers", "supB"), {
    name: "Simba Hardware", storeId: STORE_B, openingBalance: 0, balanceOwed: 0,
    active: true, createdAt: SEEDED_AT
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
const managerBDb = testEnv.authenticatedContext(MANAGER_B).firestore();
const outsiderDb = testEnv.authenticatedContext(OUTSIDER).firestore();
const anonDb = testEnv.unauthenticatedContext().firestore();

const sup = (over = {}) => ({
  name: "New Supplier", storeId: STORE_A, openingBalance: 0, balanceOwed: 0,
  active: true, createdAt: SEEDED_AT, ...over
});

let n = 0;
const id = (p) => `${p}_${++n}`;

console.log("=== who may create a supplier ===");
await check("the owner may", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup()));
await check("a manager may, in their own branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "suppliers", id("s")), sup()));
// Purchasing is not a till function.
await check("a cashier may NOT", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "suppliers", id("s")), sup()));
await check("a manager may not create in a branch they are not assigned to", false, () =>
  setDoc(doc(managerBDb, "users", OWNER, "suppliers", id("s")), sup({ storeId: STORE_A })));
await check("an outsider may not", false, () =>
  setDoc(doc(outsiderDb, "users", OWNER, "suppliers", id("s")), sup()));
await check("a signed-out visitor may not", false, () =>
  setDoc(doc(anonDb, "users", OWNER, "suppliers", id("s")), sup()));

console.log("\n=== a supplier has to be a supplier ===");
await check("a nameless supplier is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ name: "" })));
await check("...and so is one with no branch", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ storeId: "" })));
await check("a name over 80 characters is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ name: "x".repeat(81) })));
await check("a name of exactly 80 is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ name: "x".repeat(80) })));
// A negative balance is not a credit note, it is a bug.
await check("a negative opening balance is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ openingBalance: -1 })));
await check("a negative balance owed is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ balanceOwed: -1 })));
await check("a non-numeric balance is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ balanceOwed: "lots" })));
await check("active must be a boolean", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ active: "yes" })));

console.log("\n=== the optional fields ===");
await check("phone, email, address and TIN are accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")),
    sup({ phone: "0712345678", email: "a@b.com", address: "Nyerere Rd", tin: "123-456-789" })));
// Absent is the normal case -- the client omits blanks rather than writing "".
await check("...and all of them may be absent", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup()));
await check("an over-long phone is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ phone: "0".repeat(21) })));
await check("an over-long TIN is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "suppliers", id("s")), sup({ tin: "9".repeat(41) })));

console.log("\n=== editing ===");
await check("the owner may edit", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "suppliers", "supA"), { name: "Twiga Cement Ltd", phone: "0712000000" }));
await check("a manager may edit in their branch", true, () =>
  updateDoc(doc(managerDb, "users", OWNER, "suppliers", "supA"), { phone: "0713000000" }));
await check("a manager may not edit another branch's supplier", false, () =>
  updateDoc(doc(managerBDb, "users", OWNER, "suppliers", "supA"), { phone: "0714000000" }));
await check("a cashier may not edit", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "suppliers", "supA"), { phone: "0715000000" }));
// An edit still has to leave a valid supplier behind.
await check("an edit cannot blank the name", false, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "suppliers", "supA"), { name: "" }));
await check("an edit cannot drive the balance negative", false, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "suppliers", "supA"), { balanceOwed: -5 }));
// Deactivating is the supported way to retire one.
await check("deactivating is allowed", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "suppliers", "supA"), { active: false }));

console.log("\n=== reading ===");
await check("a cashier may read a supplier in their branch", true, () =>
  getDoc(doc(cashierDb, "users", OWNER, "suppliers", "supA")));
await check("...because the product list shows the name while they sell", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "suppliers", "supA")));
await check("an outsider may not read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "suppliers", "supA")));
await check("a signed-out visitor may not read", false, () =>
  getDoc(doc(anonDb, "users", OWNER, "suppliers", "supA")));

console.log("\n=== nobody deletes a supplier ===");
// Every purchase ever made from them references this document.
await check("the owner may not delete", false, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "suppliers", "supB")));
await check("a manager may not delete", false, () =>
  deleteDoc(doc(managerDb, "users", OWNER, "suppliers", "supA")));
await check("a cashier may not delete", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "suppliers", "supA")));

console.log("\n=== a purchase may now carry the link ===");
const purchase = (over = {}) => ({
  storeId: STORE_A, productId: "p1", productName: "Cement", quantity: 10,
  totalPaid: 150000, unitCost: 15000, recordedByUid: OWNER, createdAt: SEEDED_AT, ...over
});
// validPurchase() is a hasOnly() list: without the widening, this is refused
// and every linked purchase fails to write.
await check("a purchase with supplierId is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), purchase({ supplierId: "supA" })));
// The legacy shape every one of the live shops has written.
await check("a purchase with only a typed name still writes", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), purchase({ supplierName: "Someone New" })));
await check("...and both together", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")),
    purchase({ supplierId: "supA", supplierName: "Twiga Cement" })));
// The hasOnly() list is still a whitelist -- it did not become permissive.
await check("an unknown field on a purchase is still refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), purchase({ supplierNickname: "Twiga" })));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? "  -- " + f.detail : "")));
  process.exit(1);
}
