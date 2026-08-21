// Phase A of DESIGN-purchases.md: the expenses collection and its rules.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-expenses.test.mjs"
//
// An expense is a record of money leaving the business, and the role split is
// the point of the collection rather than a detail of it (DESIGN-purchases.md
// §10):
//
//   - A MANAGER may create one, because a manager is who spends on the shop's
//     behalf, but may not edit or delete. An expense is a book entry, and
//     letting whoever wrote it silently rewrite the amount removes the only
//     control this collection provides.
//   - A CASHIER is refused in both directions. Expenses feed net profit, and
//     `wages` is a category.
//   - Only the OWNER corrects.
//
// The other boundary worth pinning is the closed category set. Free text cannot
// be reported on and cannot be given a tax treatment later, and two of the nine
// carry one already: rent triggers a 10% withholding obligation on the payer,
// and entertainment input VAT is not deductible -- which is why there is no
// entertainment category and such spending goes to `other`.
//
// Nothing here is deployed. The live system is in beta with real businesses on
// it; see the commit message.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, query, where } from "firebase/firestore";
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

// Fixed, because expenseImmutableFieldsUnchanged() pins createdAt across
// updates and the client honours that -- saveExpense() only writes createdAt on
// a create. A helper minting a fresh timestamp per call would fail every
// legitimate update and make this suite look like the rule was broken.
const SEEDED_AT = new Date("2026-01-01T00:00:00Z");
const SPENT_AT = new Date("2026-08-14T09:00:00Z");

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });

  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER_B), { role: "manager", status: "active", storeIds: [STORE_B] });

  await setDoc(doc(db, "users", OWNER, "expenses", "expA"), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: SPENT_AT, recordedByUid: OWNER, note: "Boda", createdAt: SEEDED_AT
  });
  await setDoc(doc(db, "users", OWNER, "expenses", "expB"), {
    storeId: STORE_B, category: "rent", amount: 300000, paidFrom: "other",
    spentAt: SPENT_AT, recordedByUid: OWNER, createdAt: SEEDED_AT
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

const exp = (uid, over = {}) => ({
  storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "other",
  spentAt: SPENT_AT, recordedByUid: uid, createdAt: SEEDED_AT, ...over
});

console.log("=== the owner keeps the book ===");
await check("owner records an expense", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "new1"), exp(OWNER)));
await check("owner reads it back", true, () =>
  getDoc(doc(ownerDb, "users", OWNER, "expenses", "new1")));
await check("owner corrects the amount", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "new1"), exp(OWNER, { amount: 6500 })));
await check("owner adds a note", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "new1"), exp(OWNER, { amount: 6500, note: "Boda to market" })));
await check("owner deletes it", true, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "expenses", "new1")));

console.log("\n=== a manager records but does not correct ===");
await check("manager records an expense in their own branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "expenses", "mgr1"), exp(MANAGER)));
await check("manager reads their branch", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "expenses", "mgr1")));
// The control this collection exists to provide. If this ever passes, the
// person who spent the money can also decide what the book says they spent.
await check("manager cannot edit an expense -- not even their own", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "expenses", "mgr1"), { amount: 1 }));
await check("manager cannot delete an expense", false, () =>
  deleteDoc(doc(managerDb, "users", OWNER, "expenses", "mgr1")));
await check("manager cannot record against a branch they are not assigned", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "expenses", "mgrWrongStore"), exp(MANAGER, { storeId: STORE_B })));
await check("manager cannot read another branch's expense", false, () =>
  getDoc(doc(managerDb, "users", OWNER, "expenses", "expB")));
await check("a manager of the other branch can read that branch", true, () =>
  getDoc(doc(managerBDb, "users", OWNER, "expenses", "expB")));
// recordedByUid is pinned to the caller, so a manager cannot file spending
// under someone else's name.
await check("manager cannot record an expense as somebody else", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "expenses", "mgrImposter"), exp(OWNER)));

console.log("\n=== a cashier is outside this collection entirely ===");
await check("cashier cannot record an expense", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "expenses", "csh1"), exp(CASHIER)));
await check("cashier cannot read one, even in their own branch", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "expenses", "expA")));
await check("cashier cannot list the collection", false, () =>
  getDocs(query(collection(cashierDb, "users", OWNER, "expenses"), where("storeId", "==", STORE_A))));
await check("cashier cannot delete one", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "expenses", "expA")));

console.log("\n=== outsiders and anonymous ===");
await check("an outsider cannot read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "expenses", "expA")));
await check("an outsider cannot write", false, () =>
  setDoc(doc(outsiderDb, "users", OWNER, "expenses", "out1"), exp(OUTSIDER)));
await check("an anonymous caller cannot read", false, () =>
  getDoc(doc(anonDb, "users", OWNER, "expenses", "expA")));
await check("an anonymous caller cannot write", false, () =>
  setDoc(doc(anonDb, "users", OWNER, "expenses", "anon1"), exp("nobody")));

console.log("\n=== the shape is pinned ===");
await check("an amount of zero is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad1"), exp(OWNER, { amount: 0 })));
await check("a negative amount is refused -- that is income wearing the wrong hat", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad2"), exp(OWNER, { amount: -5000 })));
await check("an amount above the money ceiling is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad3"), exp(OWNER, { amount: 1000000001 })));
await check("an amount that is not a number is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad4"), exp(OWNER, { amount: "5000" })));
await check("a missing amount is refused", false, () => {
  const { amount, ...rest } = exp(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad5"), rest);
});
await check("a missing storeId is refused", false, () => {
  const { storeId, ...rest } = exp(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad6"), rest);
});
await check("an empty storeId is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad7"), exp(OWNER, { storeId: "" })));
await check("a missing spentAt is refused -- a period report needs the date", false, () => {
  const { spentAt, ...rest } = exp(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad8"), rest);
});
await check("a spentAt that is a string is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad9"), exp(OWNER, { spentAt: "2026-08-14" })));
await check("an oversized note is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad10"), exp(OWNER, { note: "x".repeat(201) })));
await check("a note at the limit is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "ok10"), exp(OWNER, { note: "x".repeat(200) })));
await check("a note that is not a string is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "bad11"), exp(OWNER, { note: 5 })));

console.log("\n=== the category set is closed ===");
for (const category of ["rent", "utilities", "wages", "transport",
                        "supplies", "repairs", "licences", "marketing", "other"]) {
  await check(`category '${category}' is accepted`, true, () =>
    setDoc(doc(ownerDb, "users", OWNER, "expenses", `cat_${category}`), exp(OWNER, { category })));
}
await check("an invented category is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "badCat1"), exp(OWNER, { category: "entertainment" })));
await check("an empty category is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "badCat2"), exp(OWNER, { category: "" })));
await check("a missing category is refused", false, () => {
  const { category, ...rest } = exp(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "expenses", "badCat3"), rest);
});

console.log("\n=== paidFrom is a closed pair ===");
await check("paidFrom 'till' is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "pf1"), exp(OWNER, { paidFrom: "till" })));
await check("paidFrom 'other' is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "pf2"), exp(OWNER, { paidFrom: "other" })));
await check("any other paidFrom is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "pf3"), exp(OWNER, { paidFrom: "bank" })));
await check("a missing paidFrom is refused", false, () => {
  const { paidFrom, ...rest } = exp(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "expenses", "pf4"), rest);
});

console.log("\n=== the branch and the recorder do not move ===");
await check("owner cannot move an expense to another branch", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "expA"), {
    storeId: STORE_B, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: SPENT_AT, recordedByUid: OWNER, createdAt: SEEDED_AT
  }));
await check("owner cannot reassign who recorded it", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "expA"), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: SPENT_AT, recordedByUid: MANAGER, createdAt: SEEDED_AT
  }));
await check("owner cannot rewrite createdAt", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "expA"), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: SPENT_AT, recordedByUid: OWNER, createdAt: new Date("2020-01-01T00:00:00Z")
  }));
// The one field an edit exists for.
await check("owner can change spentAt on a correction", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "expA"), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "till",
    spentAt: new Date("2026-08-15T09:00:00Z"), recordedByUid: OWNER, createdAt: SEEDED_AT
  }));

console.log("\n=== nothing else moved ===");
await check("a normal product write is unaffected", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "stillFine"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  }));
await check("a cashier can still restock -- expenses did not narrow the product path", true, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "stillFine"), {
    quantity: 15, updatedAt: new Date(), movementReason: "restock"
  }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? "  -- " + f.detail : "")));
  process.exit(1);
}
