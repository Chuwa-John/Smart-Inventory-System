// The audit log is the control everything else leans on, so it gets checked
// like one.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node rules-audit-log.test.mjs"
//
// SECURITY-AUDIT.md F-4 concludes that rules cannot bind a stock decrement to a
// sale, and names the auditLogs entry as the compensating detective control.
// tests/README.md repeats it. A control that anyone may write anything into is
// not a control -- so this pins three things:
//
//   1. `action` is a closed set, scoped to the role that can actually perform
//      the thing being claimed. A cashier cannot void a sale, so a cashier
//      writing "SALE_VOIDED" is either a bug or someone laying a false trail
//      for the owner to read; either way it should not reach the collection.
//   2. The document shape is closed. Without hasOnly() a staff client can
//      append arbitrary fields of arbitrary size to the owner's collection --
//      billed to the owner, and useful for burying a real entry in noise.
//   3. Free-text fields are bounded, for the same reason errorLog bounds its
//      `message` at 300 characters.
//
// The role->action map below is the point of the file. If it drifts from what
// app.js actually writes, the till starts failing on a write nobody looked at,
// so every action the client can emit is asserted here for the role that emits
// it. The full inventory was taken from the 12 auditLogs write sites in app.js,
// including the ternary at the PRODUCT_CREATED/PRODUCT_EDITED site that a
// naive grep for a literal misses.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, collection } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_uid_1";
const CASHIER = "cashier_uid_1";
const MANAGER = "manager_uid_1";
const STORE_A = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: {
    rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    host: "127.0.0.1",
    port: 8085
  }
});

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });
});

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail && !pass ? "\n      " + detail : ""}`);
}

async function check(name, expectSucceed, fn) {
  try {
    if (expectSucceed) await assertSucceeds(fn());
    else await assertFails(fn());
    record(name, true);
  } catch (e) {
    record(name, false, String(e.message || e).slice(0, 200));
  }
}

const dbs = {
  owner: testEnv.authenticatedContext(OWNER).firestore(),
  manager: testEnv.authenticatedContext(MANAGER).firestore(),
  cashier: testEnv.authenticatedContext(CASHIER).firestore()
};
const uids = { owner: OWNER, manager: MANAGER, cashier: CASHIER };

let n = 0;
const write = (who, data) =>
  setDoc(doc(collection(dbs[who], "users", OWNER, "auditLogs"), `log_${who}_${n++}`), {
    uid: uids[who],
    createdAt: new Date(),
    ...data
  });

// --- the real entries app.js writes, per role --------------------------------
// Each payload mirrors the actual write site, field for field, so a hasOnly()
// that is too tight fails here rather than at a till.
console.log("\n=== every action app.js writes is accepted from the role that writes it ===");

const CASHIER_ACTIONS = [
  ["SALE_COMPLETED", { total: 1000, paymentMethod: "cash", itemCount: 2, discountType: "none", discountAmount: 0 }],
  ["PRODUCT_RESTOCKED", { productId: "p1", name: "Sugar", qtyAdded: 5 }],
  // Added 2026-08-23. A cashier closes the till they opened, so this belongs
  // in the cashier list. The variance here is NEGATIVE on purpose: a short
  // drawer is the entry that matters most, and moneyInRange() -- which every
  // other money field in this file uses -- would have refused it.
  ["SHIFT_CLOSED", {
    shiftId: "shift1", storeId: STORE_A,
    expectedCash: 24000, countedCash: 20000, variance: -4000
  }],
  ["PAYMENT_RECORDED", { customerId: "c1", amount: 500, method: "cash", storeId: STORE_A }],
  ["CREDIT_LIMIT_EXCEEDED", {
    customerId: "c1", customerName: "Asha", limit: 1000, previousBalance: 900,
    projectedTotal: 1500, authorised: true, saleTotal: 600, storeId: STORE_A
  }],
  // Was missing from this file entirely, which is how the live bug below
  // reached eight shops: the action was permitted by the enum and never once
  // written in a test.
  ["CREDIT_LIMIT_UNCHECKED", {
    customerId: "c1", customerName: "Asha", reason: "no-limit-set",
    previousBalance: 900, saleTotal: 600, storeId: STORE_A
  }],
  // The shape a FIRST-TIME credit customer produces: nothing is known about
  // them yet, so the client omits those keys rather than sending null.
  ["CREDIT_LIMIT_UNCHECKED", {
    reason: "customer-not-visible", saleTotal: 600, storeId: STORE_A
  }]
];

const MANAGER_ONLY_ACTIONS = [
  ["SALE_VOIDED", { saleId: "s1", total: 1000 }],
  ["RETURN_PROCESSED", { saleId: "s1", refundAmount: 400, itemCount: 1 }],
  ["CREDIT_LIMIT_CHANGED", { customerId: "c1", previousLimit: 1000, newLimit: 2000 }]
];

const OWNER_ONLY_ACTIONS = [
  ["PRODUCT_CREATED", { productId: "p1", name: "Sugar", sellingPrice: 100 }],
  ["PRODUCT_EDITED", { productId: "p1", name: "Sugar", sellingPrice: 120 }],
  ["PRODUCT_DELETED", { productId: "p1", name: "Sugar" }],
  ["STORE_CURRENCY_CHANGED", { storeId: STORE_A, previousCode: "TZS", newCode: "KES" }],
  ["STORE_ARCHIVED", { storeId: STORE_A, name: "Branch A" }],
  // The deletion-lifecycle evidence trail. ACCOUNT_ACCESS_DURING_GRACE is
  // written by the owner's own client while the tenant is frozen; the other
  // two come from the proxy's Admin SDK, which bypasses rules. All three are
  // pinned here so the enum cannot be tightened without this file objecting --
  // omitting this family is precisely the regression that got past the first
  // draft of the rule and was caught downstream in rules-deletion.
  ["ACCOUNT_ACCESS_DURING_GRACE", {}],
  ["ACCOUNT_DELETION_REQUESTED", {}],
  ["ACCOUNT_DELETION_CANCELLED", {}]
];

for (const [action, fields] of CASHIER_ACTIONS) {
  await check(`cashier CAN log ${action}`, true, () => write("cashier", { action, ...fields }));
  await check(`manager CAN log ${action}`, true, () => write("manager", { action, ...fields }));
  await check(`owner CAN log ${action}`, true, () => write("owner", { action, ...fields }));
}
for (const [action, fields] of MANAGER_ONLY_ACTIONS) {
  await check(`manager CAN log ${action}`, true, () => write("manager", { action, ...fields }));
  await check(`owner CAN log ${action}`, true, () => write("owner", { action, ...fields }));
}
for (const [action, fields] of OWNER_ONLY_ACTIONS) {
  await check(`owner CAN log ${action}`, true, () => write("owner", { action, ...fields }));
}

// --- a false trail is not writable -------------------------------------------
// The point of the role scoping. A cashier cannot void a sale, so a cashier
// claiming to have voided one is noise at best and misdirection at worst.
console.log("\n=== staff cannot log an action their role cannot perform ===");
for (const [action, fields] of MANAGER_ONLY_ACTIONS) {
  await check(`cashier CANNOT log ${action}`, false, () => write("cashier", { action, ...fields }));
}
for (const [action, fields] of OWNER_ONLY_ACTIONS) {
  await check(`cashier CANNOT log ${action}`, false, () => write("cashier", { action, ...fields }));
  await check(`manager CANNOT log ${action}`, false, () => write("manager", { action, ...fields }));
}

// --- the action set is closed ------------------------------------------------
console.log("\n=== action is a closed set ===");
await check("cashier CANNOT log an invented action", false,
  () => write("cashier", { action: "DEFINITELY_NOT_A_REAL_ACTION" }));
await check("cashier CANNOT log an empty action", false, () => write("cashier", { action: "" }));
await check("cashier CANNOT log a non-string action", false, () => write("cashier", { action: 42 }));
await check("owner CANNOT log an invented action either", false,
  () => write("owner", { action: "ARBITRARY" }));

// --- the document shape is closed --------------------------------------------
console.log("\n=== the entry shape is closed and bounded ===");
await check("cashier CANNOT append an unexpected field", false,
  () => write("cashier", { action: "SALE_COMPLETED", total: 1, note: "smuggled" }));
await check("cashier CANNOT write an oversized free-text field", false,
  () => write("cashier", { action: "PRODUCT_RESTOCKED", productId: "p1", name: "x".repeat(5000), qtyAdded: 1 }));
await check("cashier CANNOT omit uid", false, () => {
  const ref = doc(collection(dbs.cashier, "users", OWNER, "auditLogs"), `log_nouid_${n++}`);
  return setDoc(ref, { action: "SALE_COMPLETED", total: 1, createdAt: new Date() });
});
await check("cashier CANNOT forge another user's uid", false,
  () => setDoc(doc(collection(dbs.cashier, "users", OWNER, "auditLogs"), `log_forge_${n++}`),
    { action: "SALE_COMPLETED", total: 1, uid: MANAGER, createdAt: new Date() }));

// --- append-only, unchanged --------------------------------------------------
console.log("\n=== entries remain append-only ===");
await check("cashier CANNOT read the audit log back", false,
  async () => {
    const { getDocs } = await import("firebase/firestore");
    return getDocs(collection(dbs.cashier, "users", OWNER, "auditLogs"));
  });
await check("owner CAN read the audit log", true,
  async () => {
    const { getDocs } = await import("firebase/firestore");
    return getDocs(collection(dbs.owner, "users", OWNER, "auditLogs"));
  });

console.log("");
console.log("=== null is not how this schema says nothing ===");
// Found by selling on credit to a new customer against the live database, and
// it had been live for weeks. A credit sale writes six documents in ONE
// transaction. Five were valid; the sixth was this audit entry carrying
// customerId: null. auditStringsBounded() reads
//
//     !('customerId' in d) || (d.customerId is string && ...)
//
// so an absent key is fine and a null one is refused -- the key IS present and
// null is not a string. The refusal took the whole transaction with it: no
// sale, no stock movement, no customer balance, and a cashier told "your
// account is not allowed to do this" with a customer waiting.
//
// It fired on exactly the case the entry exists to record. reason
// "customer-not-visible" is returned when the customer is not in local state --
// a first-time credit customer, whose document is created moments later, and a
// cashier serving another branch's customer (QA-110). The "no-limit-set" path
// sends a real customerId, which is why one unchecked path always worked and
// the other never did.
//
// The asymmetry worth remembering: validSale() DOES allow customerId: null.
// The sale document and the audit document disagree about how to say "nobody",
// and only one of them says so out loud.
await check("a null customerId is refused, as the rule intends", false,
  () => write("cashier", {
    action: "CREDIT_LIMIT_UNCHECKED",
    customerId: null,
    customerName: "Asha",
    reason: "customer-not-visible",
    saleTotal: 600,
    storeId: STORE_A
  }));

await check("a null customerName is refused too", false,
  () => write("cashier", {
    action: "CREDIT_LIMIT_UNCHECKED",
    customerName: null,
    reason: "customer-not-visible",
    saleTotal: 600,
    storeId: STORE_A
  }));

// And the fix: omitting them is accepted. This is the write a first-time
// credit sale actually makes now, and it is the assertion that would have
// caught the bug on the day it was written.
await check("omitting them instead is accepted", true,
  () => write("cashier", {
    action: "CREDIT_LIMIT_UNCHECKED",
    reason: "customer-not-visible",
    saleTotal: 600,
    storeId: STORE_A
  }));

// Every other id-shaped field in this schema has the same rule, so the same
// mistake is available at each of them.
await check("a null storeId is refused", false,
  () => write("cashier", { action: "SALE_COMPLETED", total: 1000, storeId: null }));
await check("a null saleId is refused", false,
  () => write("manager", { action: "SALE_VOIDED", saleId: null, total: 1000 }));

console.log("\n=== the money trail: expenses and purchases (DESIGN-purchases.md 13d) ===");
// These two collections stay DELETABLE by decision -- a mis-keyed delivery is a
// human error and the shop must be able to remove it. Every other money-touching
// collection in the rules refuses deletion outright, so the audit entry is the
// only thing that makes a removal visible. If these go red, a month of spending
// can be deleted before a period report with nothing anywhere recording it.
await check("a manager records an expense", true,
  () => write("manager", { action: "EXPENSE_RECORDED", expenseId: "e1", storeId: STORE_A, amount: 5000, category: "transport" }));
await check("an owner corrects one", true,
  () => write("owner", { action: "EXPENSE_UPDATED", expenseId: "e1", storeId: STORE_A, amount: 4000, category: "transport" }));
await check("an owner deletes one", true,
  () => write("owner", { action: "EXPENSE_DELETED", expenseId: "e1", storeId: STORE_A, amount: 4000, category: "transport" }));
await check("an owner deletes a delivery", true,
  () => write("owner", { action: "PURCHASE_DELETED", purchaseId: "p1", productId: "prod1", name: "Lotion", storeId: STORE_A, amount: 400000, qtyAdded: 200 }));

// Correcting and removing belong to the owner; a manager may only record.
await check("a manager cannot record an expense correction", false,
  () => write("manager", { action: "EXPENSE_UPDATED", expenseId: "e1", storeId: STORE_A, amount: 1 }));
await check("a manager cannot record an expense deletion", false,
  () => write("manager", { action: "EXPENSE_DELETED", expenseId: "e1", storeId: STORE_A, amount: 1 }));
await check("a manager cannot record a delivery deletion", false,
  () => write("manager", { action: "PURCHASE_DELETED", purchaseId: "p1", storeId: STORE_A, amount: 1 }));

// A cashier is outside both collections, so outside their trail too.
await check("a cashier cannot record an expense", false,
  () => write("cashier", { action: "EXPENSE_RECORDED", expenseId: "e2", storeId: STORE_A, amount: 100, category: "rent" }));
await check("a cashier cannot record a deletion", false,
  () => write("cashier", { action: "EXPENSE_DELETED", expenseId: "e2", storeId: STORE_A, amount: 100 }));

// The restock entry carries the purchase it created, rather than a second entry
// -- every write in that transaction pays its own rules evaluation.
await check("a restock entry carries its purchase and what was paid", true,
  () => write("manager", { action: "PRODUCT_RESTOCKED", productId: "prod1", name: "Lotion", qtyAdded: 200, purchaseId: "p1", amount: 400000 }));
await check("a cashier's restock entry still works without them", true,
  () => write("cashier", { action: "PRODUCT_RESTOCKED", productId: "prod1", name: "Lotion", qtyAdded: 20 }));

console.log("\n=== null in the new fields, the way it took credit sales down ===");
// auditStringsBounded() reads `!('x' in d) || d.x is string`: absent passes,
// null does not, because the key IS present and null is not a string. A null in
// one optional field refuses the whole write -- and these writes are batched
// with the expense or the deletion, so a null here would take the record with
// it. The client omits rather than nulls; these pin that it must.
await check("a null expenseId is refused", false,
  () => write("owner", { action: "EXPENSE_DELETED", expenseId: null, storeId: STORE_A, amount: 100 }));
await check("a null purchaseId is refused", false,
  () => write("owner", { action: "PURCHASE_DELETED", purchaseId: null, storeId: STORE_A, amount: 100 }));
await check("a null category is refused", false,
  () => write("manager", { action: "EXPENSE_RECORDED", expenseId: "e3", storeId: STORE_A, amount: 100, category: null }));
await check("a null purchaseId on a restock entry is refused", false,
  () => write("manager", { action: "PRODUCT_RESTOCKED", productId: "prod1", qtyAdded: 5, purchaseId: null }));
// Absent is the shape the client actually writes, and it must pass.
await check("omitting them entirely is fine", true,
  () => write("manager", { action: "EXPENSE_RECORDED", expenseId: "e4", storeId: STORE_A, amount: 100 }));

await check("an oversized category is refused", false,
  () => write("manager", { action: "EXPENSE_RECORDED", expenseId: "e5", storeId: STORE_A, amount: 100, category: "x".repeat(41) }));
await check("an oversized expenseId is refused", false,
  () => write("manager", { action: "EXPENSE_RECORDED", expenseId: "x".repeat(121), storeId: STORE_A, amount: 100 }));
await check("an invented action is still refused", false,
  () => write("owner", { action: "EXPENSE_ARCHIVED", expenseId: "e6", storeId: STORE_A }));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? " :: " + f.detail : "")));
  process.exit(1);
}
