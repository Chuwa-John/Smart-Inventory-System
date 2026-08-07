// L-9 phase E: what actually happens when a queued sale replays.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node offline-replay.test.mjs"
//
// Phases A-D are asserted structurally: that the client queues, does not await,
// uses increment(), marks its entries. Every one of those tests reads app.js as
// text. That is worth having -- five of the guards in offline-selling.test.mjs
// exist because a sale-breaking bug shipped green -- but none of it executes a
// replay, and the whole feature rests on what the SERVER does when four queued
// writes land hours late against a shelf that has moved underneath them.
//
// This file runs those writes against the emulator.
//
// What it does NOT prove, and cannot: that Firestore's own queue survives a
// real outage on a real phone. The writes here are issued directly rather than
// replayed by the SDK, so this verifies the DESIGN and the RULES hold at replay
// time. The airplane-mode trial is still owed, and the Phase C bug is the
// argument for why a green suite is not the same as a working till.
//
// The shapes below mirror queueOfflineSale() rather than importing it: that
// logic lives inside a DOM event handler and cannot be imported, the same
// constraint concurrency-integrity.test.mjs works under and says so.
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, collection, setDoc, getDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_replay";
const TILL_A = "till_a";
const TILL_B = "till_b";
const STORE = "storeA";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: {
    rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    host: "127.0.0.1",
    port: 8085
  }
});

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

async function seed(quantity) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
    await setDoc(doc(db, "users", OWNER, "stores", STORE), { name: "Branch A" });
    for (const uid of [TILL_A, TILL_B]) {
      await setDoc(doc(db, "users", OWNER, "members", uid), {
        role: "cashier", status: "active", storeIds: [STORE]
      });
    }
    await setDoc(doc(db, "users", OWNER, "products", "p1"), {
      name: "Sukari", category: "Food", brand: "X", supplier: "Y",
      quantity, storeId: STORE, sellingPrice: 1500, createdAt: new Date()
    });
  });
}

async function stockNow() {
  let q = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "users", OWNER, "products", "p1"));
    q = snap.data()?.quantity ?? null;
  });
  return q;
}

// The three writes a queued cash sale carries, in the shape queueOfflineSale
// produces them: a relative stock update, an offline ledger entry with a delta
// and no chain, and the sale itself under a deterministic id.
function replayStock(uid, qty) {
  return updateDoc(doc(as(uid), "users", OWNER, "products", "p1"), {
    quantity: increment(-qty),
    sold30: increment(qty),
    sold90: increment(qty),
    updatedAt: serverTimestamp(),
    movementReason: "sale"
  });
}

function replayLedger(uid, qty, saleId) {
  return setDoc(doc(collection(as(uid), "users", OWNER, "stockMovements")), {
    productId: "p1", productName: "Sukari", storeId: STORE,
    reason: "sale", delta: -qty, offline: true, saleId,
    uid, createdAt: serverTimestamp()
  });
}

function replaySale(uid, orderNumber, qty) {
  const saleId = `ord_${uid}_${orderNumber}`;
  return setDoc(doc(as(uid), "users", OWNER, "sales", saleId), {
    items: [{ productId: "p1", name: "Sukari", qty, sellingPrice: 1500, lineTotal: 1500 * qty }],
    subtotal: 1500 * qty, total: 1500 * qty,
    discountType: "none", discountValue: 0, discountAmount: 0,
    paymentMethod: "cash", cashTendered: 1500 * qty, changeDue: 0,
    customerId: null, amountPaid: null, balanceDue: null,
    branchId: STORE, storeId: STORE,
    cashierUid: uid, staffId: uid, staffName: "Amina",
    orderNumber: String(orderNumber), customerName: "", customerPhone: "",
    voided: false, madeOffline: true, createdAt: serverTimestamp()
  });
}

console.log("=== a queued sale lands against a shelf that moved under it ===");
{
  // The cashier's cached count said 10 when they rang up 3. By the time the
  // queue drains another till has legitimately sold 4, so the server says 6.
  //
  // increment() gives 3. A read-then-write replay -- which is what a
  // transaction, or any "quantity: cached - qty" write, amounts to -- would
  // write 7 and silently restore four units that were genuinely sold. That
  // difference is the entire reason the offline path is not a transaction.
  await seed(10);
  await replayStock(TILL_B, 4);                       // the other till, online
  await replayStock(TILL_A, 3);                       // the queue drains
  const left = await stockNow();
  check("the queued sale applies relatively, not from its stale cache",
    left === 3,
    `quantity is ${left}; 7 would mean the replay overwrote the other till's sale`);
}

console.log("=== two tills both sold the last unit while offline ===");
{
  // The case phase A was loosened for. Online, concurrency-integrity asserts
  // exactly one of these succeeds and stock lands on zero -- that guard still
  // holds and is asserted there. Offline neither till could see the other, both
  // customers have already walked out with a tin, and the honest record is a
  // shelf at -1. Losing one of these writes would be losing a completed sale.
  await seed(1);
  const outcomes = await Promise.allSettled([replayStock(TILL_A, 1), replayStock(TILL_B, 1)]);
  const landed = outcomes.filter((o) => o.status === "fulfilled").length;
  const left = await stockNow();
  check("both queued sales land -- neither is dropped on replay",
    landed === 2,
    `${landed} landed; a lost one is a sale the shop made and cannot see`);
  check("the shelf reads -1, which is the truth rather than a clamp",
    left === -1,
    `quantity is ${left}; 0 would be hiding an oversell the owner needs to act on`);
}

console.log("=== the ledger entry a replay writes is accepted, and stays honest ===");
{
  await seed(5);
  let ok = true;
  try { await replayLedger(TILL_A, 2, "ord_till_a_41"); } catch { ok = false; }
  check("an offline entry with a delta and no chain is accepted at replay time",
    ok,
    "if the rules refused this the sale's stock would move with no ledger record, which L-2 reads as theft");

  // The two shapes stay mutually exclusive under replay, not just at write
  // time: an entry cannot claim it was made blind AND report the shelf.
  check("an entry claiming offline while carrying a chain is still refused",
    await assertFails(setDoc(doc(collection(as(TILL_A), "users", OWNER, "stockMovements")), {
      productId: "p1", storeId: STORE, reason: "sale", delta: -2,
      offline: true, quantityBefore: 5, quantityAfter: 3,
      uid: TILL_A, createdAt: serverTimestamp()
    })).then(() => true).catch(() => false),
    "a guess wearing the authority of a measurement");
}

console.log("=== the same order number cannot become two sales ===");
{
  // Replay safety comes from the deterministic id rather than from any
  // de-duplication logic: a queue flushed twice resolves to the same document
  // path. The second write is then an UPDATE, and sales may only be updated by
  // a void or a return -- so the rules refuse it without needing to know that a
  // replay is what produced it.
  await seed(10);
  let first = true;
  try { await replaySale(TILL_A, 77, 1); } catch { first = false; }
  check("the first flush records the sale", first);

  const second = await assertFails(replaySale(TILL_A, 77, 1)).then(() => true).catch(() => false);
  check("a second flush of the same order number is refused",
    second,
    "without this a drained-twice queue would double the day's takings");
}

console.log("=== a large queue draining does not stall the till ===");
{
  // The load question phase E asks. A market-day outage does not produce three
  // queued sales, it produces a hundred and fifty, and they all replay at once
  // the moment the signal returns.
  //
  // The budget is deliberately loose: this measures the emulator on whatever
  // machine runs it, not a phone, so a tight threshold would fail for reasons
  // that say nothing about the product. What it catches is an order-of-
  // magnitude regression -- a per-write read, or a rule that starts doing a
  // get() per entry.
  await seed(1000);
  const QUEUE = 150;
  const started = Date.now();
  await Promise.all(Array.from({ length: QUEUE }, (_, i) => replayStock(TILL_A, 1)));
  const elapsed = Date.now() - started;
  const left = await stockNow();

  // Assert the measurement is real before asserting it is small. A budget a
  // zero can satisfy is not a budget -- the same trap as the memory check that
  // once passed on a NEGATIVE heap delta because GC ran mid-measure.
  check("the measurement is real", elapsed > 0, `elapsed was ${elapsed}ms`);
  check(`${QUEUE} queued writes drain in reasonable time`,
    elapsed < 30000,
    `took ${elapsed}ms`);
  check("every one of them landed",
    left === 1000 - QUEUE,
    `quantity is ${left}, expected ${1000 - QUEUE} -- a shortfall means replays were silently lost`);
}

console.log("=== madeOffline is a flag, not free text ===");
{
  // Filed in DESIGN §13 and deferred only because no emulator was available to
  // re-run the rules suites at the time. The field decides whether a shelf
  // count can be trusted, and it was type-free: a client writing
  // madeOffline: "no" would have been accepted, and any downstream truthiness
  // check would then read a perfectly ordinary sale as rung up blind.
  await seed(20);
  const withFlag = (value, id) =>
    setDoc(doc(as(TILL_A), "users", OWNER, "sales", id), {
      items: [{ productId: "p1", name: "Sukari", qty: 1, sellingPrice: 1500, lineTotal: 1500 }],
      subtotal: 1500, total: 1500,
      discountType: "none", discountValue: 0, discountAmount: 0,
      paymentMethod: "cash", cashTendered: 1500, changeDue: 0,
      customerId: null, amountPaid: null, balanceDue: null,
      branchId: STORE, storeId: STORE,
      cashierUid: TILL_A, staffId: TILL_A, staffName: "Amina",
      orderNumber: "9990001", customerName: "", customerPhone: "",
      voided: false, madeOffline: value, createdAt: serverTimestamp()
    });

  const accepted = await withFlag(true, "ord_flag_bool").then(() => true).catch(() => false);
  check("a boolean flag is accepted", accepted);

  const stringRefused = await assertFails(withFlag("no", "ord_flag_string"))
    .then(() => true).catch(() => false);
  check("a string that looks like a flag is refused", stringRefused,
    'madeOffline: "no" is truthy, and would mark an ordinary sale as rung up blind');

  const numberRefused = await assertFails(withFlag(1, "ord_flag_number"))
    .then(() => true).catch(() => false);
  check("a number standing in for a flag is refused", numberRefused);
}

console.log("=== the bound still holds at replay time ===");
{
  // Phase A loosened the guard to bounded negative, not to unbounded. A replay
  // is exactly where an absent bound would show up, since nothing on the client
  // re-checks it.
  await seed(-999999);
  const refused = await assertFails(replayStock(TILL_A, 100)).then(() => true).catch(() => false);
  check("a replay cannot drive stock past the negative bound",
    refused,
    "bounded negative was the deliberate choice; unbounded was not");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
await testEnv.cleanup();
