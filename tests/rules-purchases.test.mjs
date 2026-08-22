// Phase B of DESIGN-purchases.md: the purchases collection, and the one change
// in this whole programme most likely to cause an outage nobody sees in testing.
//
//   node rules-purchases.test.mjs        (against a running emulator on 8085)
//
// THE TRAP (DESIGN-purchases.md §9). A staff product update is allowlisted by
// affected keys. Restock writes quantity/updatedAt/movementReason, all inside
// that list. Adding costPrice to the write WITHOUT widening the allowlist
// refuses every non-owner restock -- while the owner's own testing passes
// cleanly, because isOwner() takes the other branch entirely. That is the exact
// shape of the outage the long comment above validSaleItems() describes:
// invisible to whoever is testing, total for staff.
//
// HOW THAT TRAP WAS CLOSED, in the end: not by widening the allowlist at all.
// An adversarial audit found that a cashier could simply READ costPrice off the
// product -- /products is readable by every till, the POS needs it in full, and
// Firestore has no field-level read security. The write-side split was doing
// real work only against an honest client.
//
// So cost left the product document. It lives in /productCosts, keyed by
// productId, readable by owner and manager only. The product allowlist is one
// list again and there is no cost key a restock could add to it, which removes
// the trap rather than guarding it. This file now pins BOTH halves: cost is
// refused on a product for everyone including the owner, and /productCosts is
// refused to a cashier in both directions.
//
//   CASHIER  restocks quantity only; cannot read or write cost anywhere.
//   MANAGER  restocks, and maintains /productCosts for their branches.
//   OWNER    everything.
//
// Nothing here is deployed.
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

const SEEDED_AT = new Date("2026-01-01T00:00:00Z");
const KNOWN_FROM = new Date("2026-08-20T00:00:00Z");

await testEnv.clearFirestore();

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A", createdAt: new Date() });
  await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B", createdAt: new Date() });

  await setDoc(doc(db, "users", OWNER, "members", CASHIER), { role: "cashier", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER), { role: "manager", status: "active", storeIds: [STORE_A] });
  await setDoc(doc(db, "users", OWNER, "members", MANAGER_B), { role: "manager", status: "active", storeIds: [STORE_B] });

  for (const [id, storeId] of [["prodA", STORE_A], ["prodB", STORE_B]]) {
    await setDoc(doc(db, "users", OWNER, "products", id), {
      id, name: "Body Lotion", category: "Cosmetics", brand: "X", supplier: "Y",
      quantity: 40, storeId, sellingPrice: 3000, createdAt: SEEDED_AT
    });
  }

  await setDoc(doc(db, "users", OWNER, "purchases", "purA"), {
    storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
    quantity: 200, totalPaid: 400000, unitCost: 2000,
    recordedByUid: OWNER, createdAt: SEEDED_AT
  });
  await setDoc(doc(db, "users", OWNER, "purchases", "purB"), {
    storeId: STORE_B, productId: "prodB", productName: "Body Lotion",
    quantity: 100, totalPaid: 220000, unitCost: 2200,
    recordedByUid: OWNER, createdAt: SEEDED_AT
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

const pur = (uid, over = {}) => ({
  storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
  quantity: 200, totalPaid: 400000, unitCost: 2000,
  recordedByUid: uid, createdAt: SEEDED_AT, ...over
});

// ===========================================================================
console.log("=== THE TRAP: a cashier can still count a delivery in ===");
// If this ever goes red, every shop whose deliveries are counted by a cashier
// has silently stopped being able to restock, and the owner's own account will
// not show it.
await check("cashier restocks with quantity only", true, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 60, updatedAt: new Date(), movementReason: "restock"
  }));
await check("cashier restock still refuses an out-of-range quantity", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 99999999, updatedAt: new Date(), movementReason: "restock"
  }));
await check("cashier restock still refuses an invented movement reason", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 61, updatedAt: new Date(), movementReason: "shrinkage"
  }));
await check("cashier still cannot rename a product", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), { name: "Something else" }));
await check("cashier still cannot change the selling price", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), { sellingPrice: 1 }));

console.log("\n=== ...but a cashier never touches cost ===");
// The asymmetry the whole split exists for. A cashier who can write costPrice
// can also read it back, and a cashier who knows the buying price of every item
// knows the margin on every sale.
await check("cashier CANNOT write costPrice", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 62, updatedAt: new Date(), movementReason: "restock", costPrice: 2000
  }));
await check("cashier CANNOT write costKnownFrom", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 63, updatedAt: new Date(), movementReason: "restock", costKnownFrom: KNOWN_FROM
  }));
await check("cashier cannot write cost even on its own", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), { costPrice: 1 }));

console.log("\n=== a manager restocks; cost is not part of that write ===");
await check("manager restocks with quantity only", true, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodA"), {
    quantity: 70, updatedAt: new Date(), movementReason: "restock"
  }));
await check("a manager still cannot rename a product", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodA"), { name: "Something else" }));
await check("a manager still cannot change the selling price", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodA"), { sellingPrice: 1 }));
await check("a manager cannot restock a branch they are not assigned", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodB"), {
    quantity: 50, updatedAt: new Date(), movementReason: "restock"
  }));
await check("the other branch's manager can", true, () =>
  updateDoc(doc(managerBDb, "users", OWNER, "products", "prodB"), {
    quantity: 50, updatedAt: new Date(), movementReason: "restock"
  }));

console.log("\n=== cost is refused on a product document, for everyone ===");
// The audit finding this closes: a cashier reads every product document, so a
// costPrice stored there is a costPrice they can read. Refusing it here rather
// than merely not writing it stops it drifting back.
await check("manager cannot write costPrice onto a product", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodA"), {
    quantity: 80, updatedAt: new Date(), movementReason: "restock", costPrice: 2050
  }));
await check("manager cannot write costKnownFrom onto a product", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "products", "prodA"), {
    quantity: 81, updatedAt: new Date(), movementReason: "restock", costKnownFrom: KNOWN_FROM
  }));
await check("cashier cannot either", false, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "prodA"), {
    quantity: 82, updatedAt: new Date(), movementReason: "restock", costPrice: 2050
  }));
// The owner goes through the full product validator, which no longer permits
// the field at all -- so even the owner cannot put cost back on a product.
await check("the OWNER cannot write cost onto a product either", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "prodA"), {
    id: "prodA", name: "Body Lotion", category: "Cosmetics", brand: "X", supplier: "Y",
    quantity: 90, storeId: STORE_A, sellingPrice: 3000, createdAt: SEEDED_AT,
    costPrice: 2000
  }));
await check("...nor costKnownFrom", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "prodA"), {
    id: "prodA", name: "Body Lotion", category: "Cosmetics", brand: "X", supplier: "Y",
    quantity: 90, storeId: STORE_A, sellingPrice: 3000, createdAt: SEEDED_AT,
    costKnownFrom: KNOWN_FROM
  }));
await check("a product with no cost is written normally", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "prodA"), {
    id: "prodA", name: "Body Lotion", category: "Cosmetics", brand: "X", supplier: "Y",
    quantity: 90, storeId: STORE_A, sellingPrice: 3000, createdAt: SEEDED_AT
  }));

console.log("\n=== /productCosts: a cashier cannot reach it at all ===");
const cost = (over = {}) => ({
  storeId: STORE_A, costPrice: 2000, costKnownFrom: KNOWN_FROM, updatedAt: new Date(), ...over
});
await check("owner creates a cost document", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodA"), cost()));
await check("manager updates the average for their branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA"), cost({ costPrice: 2050 })));
await check("manager reads it", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA")));
await check("a fractional average is accepted -- it is not rounded", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA"), cost({ costPrice: 333.3333333333333 })));

// The whole point of the collection.
await check("CASHIER cannot read a cost document", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "productCosts", "prodA")));
await check("cashier cannot list the collection", false, () =>
  getDocs(query(collection(cashierDb, "users", OWNER, "productCosts"), where("storeId", "==", STORE_A))));
await check("cashier cannot write one", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "productCosts", "prodC"), cost()));
await check("cashier cannot delete one", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "productCosts", "prodA")));
await check("an outsider cannot read one", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "productCosts", "prodA")));

console.log("\n=== the moment cost became knowable does not move ===");
// Left mutable, a manager could back-date this and every profit surface would
// believe cost had been known since before the shop recorded any -- reporting a
// confident margin against stock nobody costed.
await check("costKnownFrom cannot be back-dated", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA"),
    cost({ costKnownFrom: new Date("2020-01-01") })));
await check("costKnownFrom cannot be moved forward either", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA"),
    cost({ costKnownFrom: new Date("2027-01-01") })));
await check("the branch cannot move", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCosts", "prodA"), cost({ storeId: STORE_B })));
await check("a manager cannot touch another branch's cost", false, () =>
  setDoc(doc(managerBDb, "users", OWNER, "productCosts", "prodA"), cost({ costPrice: 1 })));

console.log("\n=== the cost document's shape is pinned ===");
await check("a negative average is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodNeg"), cost({ costPrice: -1 })));
await check("an average above the money ceiling is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodBig"), cost({ costPrice: 1000000001 })));
await check("a missing costKnownFrom is refused", false, () => {
  const { costKnownFrom, ...rest } = cost();
  return setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodNoStamp"), rest);
});
await check("a costKnownFrom that is not a timestamp is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodBadStamp"), cost({ costKnownFrom: 20260820 })));
await check("a missing storeId is refused", false, () => {
  const { storeId, ...rest } = cost();
  return setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodNoStore"), rest);
});
// hasOnly, unlike the purchase and expense validators -- worth having where the
// document is this small and this well defined.
await check("an unexpected field is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCosts", "prodExtra"), cost({ note: "why" })));

// ===========================================================================
console.log("\n=== the Purchase Book: who may keep it ===");
await check("owner records a purchase", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "new1"), pur(OWNER)));
await check("owner reads it back", true, () =>
  getDoc(doc(ownerDb, "users", OWNER, "purchases", "new1")));
// What a delivery cost is settled when it is recorded: the product's weighted
// average is a cached derivation computed once inside the restock transaction
// and never recomputed, so editing the money afterwards leaves the book and the
// average permanently disagreeing. The paperwork that turns up later is exactly
// what stays editable.
await check("owner adds the supplier and receipt after the fact", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "new1"),
    pur(OWNER, { supplierName: "Wholesale Ltd", receiptNumber: "RCT9", hasFiscalReceipt: true })));
await check("owner deletes it", true, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "purchases", "new1")));

await check("manager records a purchase in their own branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "mgr1"), pur(MANAGER)));
await check("manager reads their branch", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "purchases", "mgr1")));
// A purchase has already moved the weighted average by the time anyone edits
// it, so a correction is strictly the owner's.
// The edit has to be otherwise VALID, or the shape check refuses it and this
// assertion passes for the wrong reason. It originally sent { totalPaid: 1 },
// which breaks the batch invariant -- so it stayed green even with `allow
// update` widened to managers, and would have let a real role regression
// through. Same document, same money, one different note: now only the role
// gate can decide.
await check("manager cannot edit a purchase -- not even their own", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "mgr1"),
    pur(MANAGER, { note: "corrected by the person who spent it" })));
// And the shape check is still doing its own job underneath.
await check("...and an incoherent edit is refused on its shape as well", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "mgr1"), pur(MANAGER, { totalPaid: 1 })));
await check("manager cannot delete a purchase", false, () =>
  deleteDoc(doc(managerDb, "users", OWNER, "purchases", "mgr1")));
await check("manager cannot record against a branch they are not assigned", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "mgrWrong"), pur(MANAGER, { storeId: STORE_B, productId: "prodB" })));
await check("manager cannot read another branch's purchase", false, () =>
  getDoc(doc(managerDb, "users", OWNER, "purchases", "purB")));
await check("manager cannot record a purchase as somebody else", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "mgrImposter"), pur(OWNER)));

console.log("\n=== a cashier never sees what stock cost ===");
await check("cashier cannot record a purchase", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "purchases", "csh1"), pur(CASHIER)));
await check("cashier cannot read one, even in their own branch", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "purchases", "purA")));
await check("cashier cannot list the collection", false, () =>
  getDocs(query(collection(cashierDb, "users", OWNER, "purchases"), where("storeId", "==", STORE_A))));
await check("cashier cannot delete one", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "purchases", "purA")));

console.log("\n=== outsiders and anonymous ===");
await check("an outsider cannot read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "purchases", "purA")));
await check("an outsider cannot write", false, () =>
  setDoc(doc(outsiderDb, "users", OWNER, "purchases", "out1"), pur(OUTSIDER)));
await check("an anonymous caller cannot read", false, () =>
  getDoc(doc(anonDb, "users", OWNER, "purchases", "purA")));
await check("an anonymous caller cannot write", false, () =>
  setDoc(doc(anonDb, "users", OWNER, "purchases", "anon1"), pur("nobody")));

// ===========================================================================
console.log("\n=== the batch must agree with itself ===");
// The clause the whole feature is judged on: the money figures cannot disagree
// with the quantity they describe.
await check("a batch whose unit cost does not match what was paid is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad1"), pur(OWNER, { unitCost: 100 })));
await check("...in the other direction too", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad2"), pur(OWNER, { unitCost: 9000 })));
// Within a shilling, not exactly: 33,333 over 100 units is a repeating fraction,
// and 333.33... * 100 does not land exactly on 33,333 in float64. An equality
// test would refuse an ordinary delivery.
await check("a repeating fraction is accepted -- 33,333 over 100 units", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "frac1"),
    pur(OWNER, { quantity: 100, totalPaid: 33333, unitCost: 33333 / 100 })));
await check("...and 10,000 over 3 units", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "frac2"),
    pur(OWNER, { quantity: 3, totalPaid: 10000, unitCost: 10000 / 3 })));
await check("...and a large batch that does not divide evenly", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "frac3"),
    pur(OWNER, { quantity: 7000, totalPaid: 999999999, unitCost: 999999999 / 7000 })));
// The tolerance must not be wide enough to hide a real mis-key.
await check("a unit cost out by ten shillings is still refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad3"),
    pur(OWNER, { quantity: 200, totalPaid: 400000, unitCost: 2010 })));

console.log("\n=== the shape is pinned ===");
await check("a quantity of zero is refused -- a delivery of nothing is not a purchase", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad4"), pur(OWNER, { quantity: 0, totalPaid: 400000, unitCost: 0 })));
await check("a negative quantity is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad5"), pur(OWNER, { quantity: -200, totalPaid: 400000, unitCost: -2000 })));
await check("a totalPaid of zero is refused -- free stock would drag the average to nothing", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad6"), pur(OWNER, { totalPaid: 0, unitCost: 0 })));
await check("a missing productName is refused -- the book must survive a product delete", false, () => {
  const { productName, ...rest } = pur(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad7"), rest);
});
await check("a missing productId is refused", false, () => {
  const { productId, ...rest } = pur(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad8"), rest);
});
await check("a missing storeId is refused", false, () => {
  const { storeId, ...rest } = pur(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad9"), rest);
});
await check("a totalPaid that is a string is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "bad10"), pur(OWNER, { totalPaid: "400000" })));

console.log("\n=== the input-VAT fields, when present ===");
await check("a fiscal receipt number, date and flag are accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "vat1"), pur(OWNER, {
    supplierName: "Wholesale Ltd", supplierTin: "123-456-789",
    receiptNumber: "RCT0001234", receiptDate: SEEDED_AT, hasFiscalReceipt: true
  })));
await check("a purchase with no receipt at all is still valid", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "vat2"), pur(OWNER, { hasFiscalReceipt: false })));
await check("a receiptDate that is a string is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "vat3"), pur(OWNER, { receiptDate: "2026-01-01" })));
await check("an oversized supplier TIN is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "vat4"), pur(OWNER, { supplierTin: "1".repeat(21) })));
await check("an oversized note is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "vat5"), pur(OWNER, { note: "x".repeat(201) })));

console.log("\n=== the batch does not move ===");
await check("owner cannot move a purchase to another branch", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { storeId: STORE_B })));
await check("owner cannot repoint a purchase at another product", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { productId: "prodB" })));
await check("owner cannot reassign who recorded it", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(MANAGER)));
await check("owner cannot rewrite createdAt", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { createdAt: new Date("2020-01-01T00:00:00Z") })));
await check("owner CANNOT rewrite what was paid", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { totalPaid: 420000, unitCost: 2100 })));
await check("owner cannot rewrite the units delivered", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { quantity: 1000, unitCost: 400 })));
await check("owner cannot rewrite the unit cost", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { unitCost: 2000.5 })));
await check("owner cannot rename the product on the book", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { productName: "Something else" })));
// A wrong amount is corrected by deleting the delivery and recording it again,
// which is audited (PURCHASE_DELETED). That is why deletion is allowed.
await check("...and the paperwork is still editable", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purA"), pur(OWNER, { note: "invoice mislaid" })));

console.log("\n=== nothing else moved ===");
await check("a normal owner product write is unaffected", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "products", "stillFine"), {
    name: "Sugar", category: "Food", brand: "X", supplier: "Y",
    quantity: 10, storeId: STORE_A, sellingPrice: 100, createdAt: new Date()
  }));
await check("a cashier can still record a sale movement", true, () =>
  updateDoc(doc(cashierDb, "users", OWNER, "products", "stillFine"), {
    quantity: 8, updatedAt: new Date(), movementReason: "sale"
  }));
await check("an expense write is unaffected", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "expenses", "stillFine"), {
    storeId: STORE_A, category: "transport", amount: 5000, paidFrom: "other",
    spentAt: SEEDED_AT, recordedByUid: OWNER, createdAt: SEEDED_AT
  }));

console.log("\n=== an owner can correct a MANAGER's delivery ===");
// The audit's most serious finding. validPurchase() asserted the recorder is
// the caller and purchaseImmutableFieldsUnchanged() asserted the recorder never
// changes; on an owner-only update of a manager-recorded document those two
// cannot both hold, so every such correction was refused -- and because the
// client does not await the write, the owner saw it succeed and then silently
// revert. The recorder pin now lives in validPurchaseCreate(), on create only.
await check("owner edits the paperwork on a manager's purchase", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "mgr1"),
    pur(MANAGER, { note: "receipt found later" })));
await check("...and the recorder is still the manager afterwards", true, async () => {
  const snap = await getDoc(doc(ownerDb, "users", OWNER, "purchases", "mgr1"));
  if (snap.data().recordedByUid !== MANAGER) throw new Error("attribution was lost");
  return snap;
});
await check("owner still cannot reassign who recorded it", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "mgr1"), pur(OWNER)));
await check("a manager still cannot record one as somebody else", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", "forged"), pur(OWNER, { productId: "prodA" })));

console.log("\n=== the date the book buckets on ===");
await check("a purchase with no createdAt is refused", false, () => {
  const { createdAt, ...rest } = pur(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "purchases", "noDate"), rest);
});
await check("a string createdAt is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "strDate"), pur(OWNER, { createdAt: "yesterday" })));

console.log("\n=== a delivery that cost nothing per unit ===");
// The tolerance is absolute, so at totalPaid == 1 a unitCost of 0 satisfied it:
// a million units at no cost each, straight past the totalPaid > 0 guard that
// was written to refuse exactly that.
await check("a million units at unit cost zero is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "freeMillion"),
    pur(OWNER, { quantity: 1000000, totalPaid: 1, unitCost: 0 })));
await check("...but a genuine one-shilling delivery still works", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "tiny"),
    pur(OWNER, { quantity: 1, totalPaid: 1, unitCost: 1 })));
await check("a fractional unit count is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "frac"),
    pur(OWNER, { quantity: 0.5, totalPaid: 1000, unitCost: 2000 })));

console.log("\n=== the document cannot be padded ===");
await check("an unexpected field is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "padded"), pur(OWNER, { junk: "x".repeat(2000) })));

console.log("\n=== Phase D: the cost history is append-only ===");
// This is what replaces a unitCost on the sale line, which is not buildable
// here: the till is a cashier's, a cashier cannot read /productCosts, and a
// cashier CAN read sales -- so the line would be both unwritable and, if
// written, readable by exactly the role cost was moved away from.
//
// Everything a period report says about cost of goods rests on these records,
// so they are held to the /auditLogs rule rather than the deletable-by-decision
// rule /purchases and /expenses carry.
const hist = (over = {}) => ({
  productId: "prodA", storeId: STORE_A, costPrice: 2000,
  effectiveFrom: KNOWN_FROM, reason: "purchase", createdAt: SEEDED_AT, ...over
});
await check("owner appends a cost record", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "h1"), hist()));
await check("manager appends one for their branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCostHistory", "h2"), hist({ reason: "transfer-in" })));
await check("manager reads it back", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "productCostHistory", "h2")));

// The point of the collection. A record of what cost applied in July must still
// say so in December.
await check("even the OWNER cannot edit a record", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "h1"), hist({ costPrice: 1 })));
await check("even the OWNER cannot delete one", false, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "h1")));
await check("a manager cannot delete one either", false, () =>
  deleteDoc(doc(managerDb, "users", OWNER, "productCostHistory", "h2")));

await check("CASHIER cannot read a cost record", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "productCostHistory", "h1")));
await check("cashier cannot list the collection", false, () =>
  getDocs(query(collection(cashierDb, "users", OWNER, "productCostHistory"), where("storeId", "==", STORE_A))));
await check("cashier cannot append one", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "productCostHistory", "csh"), hist()));
await check("a manager cannot append against another branch", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "productCostHistory", "wrong"), hist({ storeId: STORE_B })));
await check("an outsider cannot read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "productCostHistory", "h1")));

console.log("\n=== ...and its shape is pinned ===");
await check("a missing effectiveFrom is refused -- it is the whole record", false, () => {
  const { effectiveFrom, ...rest } = hist();
  return setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad1"), rest);
});
await check("a string effectiveFrom is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad2"), hist({ effectiveFrom: "2026-05-01" })));
await check("an invented reason is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad3"), hist({ reason: "adjustment" })));
await check("a missing productId is refused", false, () => {
  const { productId, ...rest } = hist();
  return setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad4"), rest);
});
await check("a negative cost is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad5"), hist({ costPrice: -1 })));
await check("an unexpected field is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "bad6"), hist({ note: "why" })));
// A weighted average is routinely a repeating fraction and must not be rounded.
await check("a fractional average is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "productCostHistory", "frac"), hist({ costPrice: 333.3333333333333 })));

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? "  -- " + f.detail : "")));
  process.exit(1);
}
