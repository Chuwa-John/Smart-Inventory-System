// Phases 2 and 3 of DESIGN-landed-costs.md: the goods received note, the landed
// split on the purchase line, and the payloads the client actually builds.
//
//   node rules-deliveries.test.mjs        (against a running emulator on 8085)
//
// Three things this file is actually protecting.
//
//   THE BOOK MUST ADD UP. A delivery header states goodsCost, seven named
//   additional costs, additionalTotal and totalCost. If the rules let those
//   disagree, the header is a document that contradicts itself and every report
//   downstream inherits the contradiction. Same for the line: goodsCost +
//   landedCost must come back to totalPaid, because totalPaid is what unitCost
//   -- and therefore COGS, and therefore every margin -- is derived from.
//
//   THE DISCLOSURE IS THE SAME ONE /purchases CARRIES. A delivery header says
//   what a shipment cost. A cashier who reads it knows the margin on everything
//   in it, so this collection is scoped exactly like the Purchase Book and not
//   one notch looser.
//
//   THE CLIENT AND THE RULES MUST AGREE. The last group evaluates
//   prepareDelivery() out of app.js and writes its ACTUAL output through the
//   ruleset. Every other case here is a payload this file typed by hand, which
//   proves the rules refuse what they should and accept what a test author
//   believes the client sends -- not that the client sends it. Where those two
//   drift, a shop finds out inside a transaction after typing a whole delivery
//   in; this finds out on the way past.
//
// DELETE was refused in phase 2 and is open in phase 3. Phase 2 pinned the
// refusal because /purchases pairs deletion with a PURCHASE_DELETED audit entry
// and there was no DELIVERY_DELETED -- no client could write one, and rules
// deploy ahead of clients, so the permission would have been live before
// anything could record its use. deleteDelivery() writes that entry now, and the
// pinned assertions were flipped deliberately rather than deleted.
//
// Nothing here is deployed.
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

  // A delivery that already exists, for the read/update/delete cases.
  await setDoc(doc(db, "users", OWNER, "deliveries", "delSeed"), {
    storeId: STORE_A, reference: "INV-001", supplierName: "Festive Ltd",
    receivedAt: SEEDED_AT, goodsCost: 10000000,
    freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000,
    handling: 0, insurance: 0, otherCost: 0,
    additionalTotal: 1800000, totalCost: 11800000,
    allocationBasis: "value", lineCount: 3,
    recordedByUid: OWNER, createdAt: SEEDED_AT
  });
  await setDoc(doc(db, "users", OWNER, "deliveries", "delSeedB"), {
    storeId: STORE_B, receivedAt: SEEDED_AT, goodsCost: 500000,
    freight: 0, importDuty: 0, clearing: 0, transport: 0,
    handling: 0, insurance: 0, otherCost: 0,
    additionalTotal: 0, totalCost: 500000,
    allocationBasis: "value", lineCount: 1,
    recordedByUid: OWNER, createdAt: SEEDED_AT
  });
  // A purchase line carrying the landed split, for the immutability cases.
  await setDoc(doc(db, "users", OWNER, "purchases", "purLanded"), {
    storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
    quantity: 500, totalPaid: 5900000, unitCost: 11800,
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 900000,
    recordedByUid: OWNER, createdAt: SEEDED_AT
  });
  // And one written the old way, with no landed fields at all.
  await setDoc(doc(db, "users", OWNER, "purchases", "purLegacy"), {
    storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
    quantity: 200, totalPaid: 400000, unitCost: 2000,
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

// The docx section 5/6 delivery, which is the shape everything else varies from.
const del = (uid, over = {}) => ({
  storeId: STORE_A, reference: "INV-77", supplierName: "Festive Ltd",
  receivedAt: new Date(), goodsCost: 10000000,
  freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000,
  handling: 0, insurance: 0, otherCost: 0,
  additionalTotal: 1800000, totalCost: 11800000,
  allocationBasis: "value", lineCount: 3,
  recordedByUid: uid, createdAt: new Date(), ...over
});

const pur = (uid, over = {}) => ({
  storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
  quantity: 500, totalPaid: 5900000, unitCost: 11800,
  recordedByUid: uid, createdAt: new Date(), ...over
});

let n = 0;
const id = (p) => `${p}_${++n}`;

// ===========================================================================
console.log("=== the docx delivery is accepted, by the people who receive one ===");
await check("owner records a delivery", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER)));
await check("manager records a delivery in their own branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "deliveries", id("d")), del(MANAGER)));
await check("a delivery with no additional costs at all is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    freight: 0, importDuty: 0, clearing: 0, transport: 0,
    additionalTotal: 0, totalCost: 10000000
  })));
await check("free goods with a freight bill, allocated by quantity", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    goodsCost: 0, freight: 4000, importDuty: 0, clearing: 0, transport: 0,
    additionalTotal: 4000, totalCost: 4000, allocationBasis: "quantity"
  })));
await check("a manual allocation basis is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { allocationBasis: "manual" })));
// Sums of unrounded allocations do not come back exact in float64, which is why
// the header invariants are bounded to a shilling rather than tested for
// equality. A rule that demanded equality would refuse ordinary deliveries.
await check("a header out by half a shilling is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    totalCost: 11800000.5
  })));
await check("the optional paperwork can all be absent", true, () => {
  const { reference, supplierName, ...rest } = del(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), rest);
});

console.log("\n=== the header must add up to itself ===");
await check("additionalTotal that disagrees with its parts is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { additionalTotal: 900000 })));
await check("totalCost that disagrees with goods + additional is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { totalCost: 10000000 })));
await check("a cost line omitted from additionalTotal is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    handling: 50000  // not added into additionalTotal or totalCost
  })));
await check("a delivery that cost nothing is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    goodsCost: 0, freight: 0, importDuty: 0, clearing: 0, transport: 0,
    additionalTotal: 0, totalCost: 0
  })));
await check("a negative additional cost is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    freight: -800000, additionalTotal: 200000, totalCost: 10200000
  })));
await check("a negative goods cost is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    goodsCost: -1, totalCost: 1799999
  })));
await check("a cost above the money ceiling is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    goodsCost: 1000000001, totalCost: 1000000001
  })));

console.log("\n=== the seven cost types are required, and closed ===");
// Required rather than optional so the sum above is one expression instead of
// seven conditionals -- see the note above validDelivery().
for (const field of ["freight", "importDuty", "clearing", "transport",
                     "handling", "insurance", "otherCost"]) {
  await check(`a delivery missing ${field} is refused`, false, () => {
    const body = del(OWNER);
    delete body[field];
    return setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), body);
  });
}
await check("an invented cost type is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { demurrage: 100 })));
await check("a string amount is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { freight: "800000" })));

console.log("\n=== the allocation basis is a closed set, and excludes weight ===");
await check("basis 'weight' is refused -- section 2 excludes it", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { allocationBasis: "weight" })));
await check("an invented basis is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { allocationBasis: "vibes" })));
await check("a missing basis is refused", false, () => {
  const { allocationBasis, ...rest } = del(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), rest);
});

console.log("\n=== lineCount is bounded by the transaction, not by taste ===");
// CORRECTED IN PHASE 3. Phase 2 set this at 100, having counted four writes a
// line and forgotten recordStockMovement(). Receiving a line writes FIVE
// documents -- product, cost, cost history, purchase, movement -- and the header
// and its audit entry take two more, so 100 lines is 502 against Firestore's
// 500-write transaction cap. It would have failed only after a shop had typed in
// a hundred-line delivery.  80 x 5 + 2 = 402.
await check("80 lines is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { lineCount: 80 })));
await check("81 lines is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { lineCount: 81 })));
// The phase 2 ceiling, pinned as refused so the correction cannot silently drift
// back to a number that overruns the transaction.
await check("100 lines -- the phase 2 ceiling -- is now refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { lineCount: 100 })));
await check("zero lines is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { lineCount: 0 })));
await check("a fractional line count is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { lineCount: 2.5 })));

console.log("\n=== receivedAt is a date, and not a future one ===");
await check("a string receivedAt is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { receivedAt: "2026-09-01" })));
await check("a missing receivedAt is refused", false, () => {
  const { receivedAt, ...rest } = del(OWNER);
  return setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), rest);
});
// Two days of slack, like spentAt: receivedAt is anchored at local noon, which
// in Tanzania is 09:00 UTC, so a delivery recorded at 08:00 local is legitimately
// stamped ahead of request.time.
await check("a delivery dated tomorrow is accepted (local-noon slack)", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    receivedAt: new Date(Date.now() + 20 * 60 * 60 * 1000)
  })));
await check("a delivery dated next month is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, {
    receivedAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  })));
await check("an oversized reference is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { reference: "x".repeat(61) })));
await check("an oversized supplier name is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "deliveries", id("d")), del(OWNER, { supplierName: "x".repeat(121) })));

console.log("\n=== who may see and write a delivery ===");
// The same disclosure /purchases carries: a header says what a shipment cost.
await check("a cashier CANNOT read a delivery", false, () =>
  getDoc(doc(cashierDb, "users", OWNER, "deliveries", "delSeed")));
await check("a cashier CANNOT record a delivery", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "deliveries", id("d")), del(CASHIER)));
await check("a manager can read a delivery in their branch", true, () =>
  getDoc(doc(managerDb, "users", OWNER, "deliveries", "delSeed")));
await check("a manager cannot read a delivery in another branch", false, () =>
  getDoc(doc(managerDb, "users", OWNER, "deliveries", "delSeedB")));
await check("a manager cannot record into a branch they are not assigned", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "deliveries", id("d")), del(MANAGER, { storeId: STORE_B })));
await check("the other branch's manager can", true, () =>
  setDoc(doc(managerBDb, "users", OWNER, "deliveries", id("d")), del(MANAGER_B, { storeId: STORE_B })));
await check("an outsider cannot read", false, () =>
  getDoc(doc(outsiderDb, "users", OWNER, "deliveries", "delSeed")));
await check("an outsider cannot write", false, () =>
  setDoc(doc(outsiderDb, "users", OWNER, "deliveries", id("d")), del(OUTSIDER)));
await check("an unauthenticated caller cannot read", false, () =>
  getDoc(doc(anonDb, "users", OWNER, "deliveries", "delSeed")));
await check("an unauthenticated caller cannot write", false, () =>
  setDoc(doc(anonDb, "users", OWNER, "deliveries", id("d")), del(OWNER)));
// The recorder pin: you may not record a delivery in someone else's name.
await check("a manager cannot record a delivery as the owner", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "deliveries", id("d")), del(OWNER)));

console.log("\n=== a recorded delivery cannot have its money rewritten ===");
await check("the owner may correct the supplier's name", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "deliveries", "delSeed"), { supplierName: "Festive Limited" }));
await check("the owner may add a TIN that turned up later", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "deliveries", "delSeed"), { supplierTin: "123456789" }));
await check("the owner may correct the invoice reference", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "deliveries", "delSeed"), { reference: "INV-0001" }));
for (const [field, value] of [["goodsCost", 9000000], ["freight", 900000],
                              ["additionalTotal", 1900000], ["totalCost", 11900000],
                              ["allocationBasis", "quantity"], ["lineCount", 4],
                              ["storeId", STORE_B], ["receivedAt", new Date()],
                              ["recordedByUid", MANAGER]]) {
  await check(`${field} cannot be edited after the fact`, false, () =>
    updateDoc(doc(ownerDb, "users", OWNER, "deliveries", "delSeed"), { [field]: value }));
}
await check("a manager cannot edit a delivery at all -- corrections are the owner's", false, () =>
  updateDoc(doc(managerDb, "users", OWNER, "deliveries", "delSeed"), { supplierName: "Anything" }));

console.log("\n=== delete, opened in phase 3 with its audit trail ===");
// FLIPPED, deliberately. Phase 2 pinned both of these as refused because there
// was no DELIVERY_DELETED audit action and no client that could write one, and
// rules deploy ahead of clients -- so the permission would have been live before
// anything could record its use. deleteDelivery() in app.js now writes that
// entry and takes the delivery's purchase lines with it.
await check("the owner can delete a delivery", true, () =>
  deleteDoc(doc(ownerDb, "users", OWNER, "deliveries", "delSeedB")));
// Still the owner's alone. A manager records deliveries; removing one rewrites
// the book, which is a correction, and corrections are the owner's throughout
// this file.
await check("a manager still cannot delete a delivery", false, () =>
  deleteDoc(doc(managerDb, "users", OWNER, "deliveries", "delSeed")));
await check("a cashier still cannot delete a delivery", false, () =>
  deleteDoc(doc(cashierDb, "users", OWNER, "deliveries", "delSeed")));
await check("an outsider still cannot delete a delivery", false, () =>
  deleteDoc(doc(outsiderDb, "users", OWNER, "deliveries", "delSeed")));
// The audit entry the deletion rides with has to be writable by the same person,
// or the delete succeeds and the trail does not -- which is worse than refusing
// both, because it is a removal that looks recorded and is not.
await check("the owner can write the DELIVERY_DELETED entry", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "auditLogs", id("a")), {
    action: "DELIVERY_DELETED", deliveryId: "delSeedB", itemCount: 3,
    uid: OWNER, createdAt: new Date()
  }));
await check("a manager can write DELIVERY_RECEIVED", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "auditLogs", id("a")), {
    action: "DELIVERY_RECEIVED", deliveryId: "delSeed", storeId: STORE_A,
    amount: 11800000, itemCount: 3, uid: MANAGER, createdAt: new Date()
  }));
await check("a manager CANNOT write DELIVERY_DELETED -- removal is the owner's", false, () =>
  setDoc(doc(managerDb, "users", OWNER, "auditLogs", id("a")), {
    action: "DELIVERY_DELETED", deliveryId: "delSeed", itemCount: 3,
    uid: MANAGER, createdAt: new Date()
  }));
await check("a cashier cannot write DELIVERY_RECEIVED", false, () =>
  setDoc(doc(cashierDb, "users", OWNER, "auditLogs", id("a")), {
    action: "DELIVERY_RECEIVED", deliveryId: "delSeed", storeId: STORE_A,
    amount: 11800000, itemCount: 3, uid: CASHIER, createdAt: new Date()
  }));

// ===========================================================================
console.log("\n=== the landed split on a purchase line ===");
await check("a line carrying goodsCost + landedCost = totalPaid is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 900000
  })));
await check("a line with a zero landed share is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5900000, landedCost: 0
  })));
// The float tolerance, from the other direction: an allocated share is an
// unrounded fraction and the three fields will not reconcile exactly.
await check("a split out by half a shilling is accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5000000.4, landedCost: 899999.9
  })));
await check("a manager may record a landed line in their branch", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", id("p")), pur(MANAGER, {
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 900000
  })));

console.log("\n=== ...and it must reconcile to what was paid ===");
await check("a split that does not add up to totalPaid is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 100000
  })));
// The specific failure this catches: a client that forgot to fold the landed
// share into totalPaid. unitCost would then be the GOODS unit cost, COGS would
// understate, and every margin would read high -- the dangerous direction.
await check("goodsCost alone equal to totalPaid, with landed on top, is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    totalPaid: 5000000, unitCost: 10000,
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 900000
  })));
await check("goodsCost without landedCost is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5900000
  })));
await check("landedCost without goodsCost is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", landedCost: 900000
  })));
await check("a negative landed share is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 6800000, landedCost: -900000
  })));
await check("an empty deliveryId is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "", goodsCost: 5000000, landedCost: 900000
  })));
await check("an oversized deliveryId is refused", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "x".repeat(121), goodsCost: 5000000, landedCost: 900000
  })));

console.log("\n=== the paths that write no landed fields are untouched ===");
// The restock dialog and the product form still write exactly what they wrote
// before this phase. If this goes red, phase 2 broke the feature phase B built.
await check("a purchase with no landed fields at all is still accepted", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    quantity: 200, totalPaid: 400000, unitCost: 2000
  })));
await check("a manager restock purchase is still accepted", true, () =>
  setDoc(doc(managerDb, "users", OWNER, "purchases", id("p")), pur(MANAGER, {
    quantity: 200, totalPaid: 400000, unitCost: 2000
  })));
await check("the VAT fields still work alongside the landed ones", true, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", id("p")), pur(OWNER, {
    deliveryId: "delSeed", goodsCost: 5000000, landedCost: 900000,
    hasFiscalReceipt: true, receiptNumber: "FR-1", vatAmount: 900000
  })));

console.log("\n=== the landed split settles when the line is written ===");
await check("the owner may still add a receipt number to a landed line", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "purchases", "purLanded"), { receiptNumber: "FR-99" }));
for (const [field, value] of [["goodsCost", 4000000], ["landedCost", 1900000],
                              ["deliveryId", "delSeedB"]]) {
  await check(`${field} cannot be edited after the fact`, false, () =>
    updateDoc(doc(ownerDb, "users", OWNER, "purchases", "purLanded"), { [field]: value }));
}
// The one an `in`-based immutability check would have missed: the fields are
// ABSENT on every purchase written before this design, and a rule that read them
// directly would error rather than refuse. Hence .get() with a sentinel.
await check("landed fields cannot be ADDED to a legacy purchase", false, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "purchases", "purLegacy"), {
    goodsCost: 300000, landedCost: 100000
  }));
await check("a legacy purchase can still have its paperwork corrected", true, () =>
  updateDoc(doc(ownerDb, "users", OWNER, "purchases", "purLegacy"), { supplierName: "Festive Ltd" }));
await check("landed fields cannot be REMOVED from a landed purchase", false, () =>
  setDoc(doc(ownerDb, "users", OWNER, "purchases", "purLanded"), {
    storeId: STORE_A, productId: "prodA", productName: "Body Lotion",
    quantity: 500, totalPaid: 5900000, unitCost: 11800,
    recordedByUid: OWNER, createdAt: SEEDED_AT
  }));


// ===========================================================================
console.log("\n=== the payloads the CLIENT builds, against the REAL rules ===");
// The gap this closes. Every case above is a payload this test file typed by
// hand, which proves the rules refuse what they should and accept what a test
// author thinks the client sends. It does not prove the client sends it.
//
// So: prepareDelivery() is evaluated out of app.js -- the purchases.test.mjs
// convention -- and its actual output is written through the actual ruleset. If
// the two ever disagree, a shop finds out inside a transaction, after typing a
// whole delivery in. This finds out here.
{
  const appSrc = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const extract = (name) => {
    const start = appSrc.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} not found in app.js`);
    let i = appSrc.indexOf("(", start), parens = 0;
    for (; i < appSrc.length; i++) {
      if (appSrc[i] === "(") parens++;
      else if (appSrc[i] === ")") { parens--; if (parens === 0) break; }
    }
    i = appSrc.indexOf("{", i);
    let depth = 0;
    for (; i < appSrc.length; i++) {
      if (appSrc[i] === "{") depth++;
      else if (appSrc[i] === "}") { depth--; if (depth === 0) break; }
    }
    return appSrc.slice(start, i + 1);
  };
  const constant = (name) => appSrc.match(new RegExp("const " + name + " = (\\d+)"))[1];
  const costTypes = appSrc.slice(appSrc.indexOf("const DELIVERY_COST_TYPES = "),
    appSrc.indexOf("];", appSrc.indexOf("const DELIVERY_COST_TYPES = ")) + 2);

  const prepareDelivery = new Function(`
    ${extract("safeNumber")}
    ${costTypes}
    const MAX_COUNT = ${constant("MAX_COUNT")};
    const MAX_MONEY = ${constant("MAX_MONEY")};
    const DELIVERY_MAX_LINES = ${constant("DELIVERY_MAX_LINES")};
    ${extract("deliveryAdditionalTotal")}
    ${extract("allocateLandedCosts")}
    ${extract("prepareDelivery")}
    return prepareDelivery;
  `)();

  // The docx section 5/6 delivery, exactly as the screen will pass it.
  const prep = prepareDelivery({
    lines: [
      { productId: "a", productName: "Product A", quantity: 500, goodsCost: 5000000 },
      { productId: "b", productName: "Product B", quantity: 200, goodsCost: 3000000 },
      { productId: "c", productName: "Product C", quantity: 100, goodsCost: 2000000 }
    ],
    costs: { freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000 },
    basis: "value"
  });
  record("prepareDelivery() accepted the docx delivery", prep.ok, prep.ok ? "" : prep.error);

  const deliveryId = "delFromClient";
  await check("the header prepareDelivery() built is accepted by validDelivery()", true, () =>
    setDoc(doc(ownerDb, "users", OWNER, "deliveries", deliveryId), {
      storeId: STORE_A,
      ...prep.header,
      receivedAt: new Date(),
      reference: "INV-77",
      supplierName: "Festive Ltd",
      recordedByUid: OWNER,
      createdAt: new Date()
    }));

  for (const [i, line] of prep.lines.entries()) {
    await check(`the purchase line prepareDelivery() built for ${line.productName} is accepted`, true, () =>
      setDoc(doc(ownerDb, "users", OWNER, "purchases", `${deliveryId}_${i}`), {
        storeId: STORE_A,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        totalPaid: line.totalPaid,
        unitCost: line.unitCost,
        goodsCost: line.goodsCost,
        landedCost: line.landedCost,
        deliveryId,
        supplierName: "Festive Ltd",
        recordedByUid: OWNER,
        createdAt: new Date()
      }));
  }

  // A manager receives deliveries, so the same payloads must pass for one.
  await check("a manager may write the same header in their own branch", true, () =>
    setDoc(doc(managerDb, "users", OWNER, "deliveries", "delFromManager"), {
      storeId: STORE_A, ...prep.header, receivedAt: new Date(),
      recordedByUid: MANAGER, createdAt: new Date()
    }));
  await check("a manager may write the same purchase line", true, () =>
    setDoc(doc(managerDb, "users", OWNER, "purchases", "purFromManager"), {
      storeId: STORE_A, productId: "a", productName: "Product A",
      quantity: prep.lines[0].quantity, totalPaid: prep.lines[0].totalPaid,
      unitCost: prep.lines[0].unitCost, goodsCost: prep.lines[0].goodsCost,
      landedCost: prep.lines[0].landedCost, deliveryId,
      recordedByUid: MANAGER, createdAt: new Date()
    }));

  // A delivery whose allocation does NOT divide evenly -- the case where the
  // residual correction is load-bearing and where a rules invariant written as
  // equality rather than a tolerance would refuse an ordinary delivery.
  const awkward = prepareDelivery({
    lines: Array.from({ length: 3 }, (_, i) => ({
      productId: `x${i}`, productName: `X${i}`, quantity: 3, goodsCost: 1000
    })),
    costs: { freight: 1000000 },
    basis: "value"
  });
  record("prepareDelivery() accepted the awkward split", awkward.ok, awkward.ok ? "" : awkward.error);
  await check("a header whose allocation does not divide evenly is accepted", true, () =>
    setDoc(doc(ownerDb, "users", OWNER, "deliveries", "delAwkward"), {
      storeId: STORE_A, ...awkward.header, receivedAt: new Date(),
      recordedByUid: OWNER, createdAt: new Date()
    }));
  for (const [i, line] of awkward.lines.entries()) {
    await check(`awkward line ${i} -- a repeating fraction -- is accepted`, true, () =>
      setDoc(doc(ownerDb, "users", OWNER, "purchases", `awkward_${i}`), {
        storeId: STORE_A, productId: line.productId, productName: line.productName,
        quantity: line.quantity, totalPaid: line.totalPaid, unitCost: line.unitCost,
        goodsCost: line.goodsCost, landedCost: line.landedCost, deliveryId: "delAwkward",
        recordedByUid: OWNER, createdAt: new Date()
      }));
  }

  // A delivery at the line cap, to prove the ceiling in the rules and the one in
  // app.js are the same number and that the cap itself is writable.
  const atCap = prepareDelivery({
    lines: Array.from({ length: Number(constant("DELIVERY_MAX_LINES")) }, (_, i) => ({
      productId: `c${i}`, productName: `C${i}`, quantity: 1, goodsCost: 100
    })),
    costs: {}, basis: "value"
  });
  record("prepareDelivery() accepted a delivery at the line cap", atCap.ok, atCap.ok ? "" : atCap.error);
  await check("a header at DELIVERY_MAX_LINES is accepted by the rules", true, () =>
    setDoc(doc(ownerDb, "users", OWNER, "deliveries", "delAtCap"), {
      storeId: STORE_A, ...atCap.header, receivedAt: new Date(),
      recordedByUid: OWNER, createdAt: new Date()
    }));
}

await testEnv.cleanup();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name + (f.detail ? "  -- " + f.detail : "")));
  process.exit(1);
}
