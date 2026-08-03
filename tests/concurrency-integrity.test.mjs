// Phases 24 and 20: concurrency, and data integrity under it.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node concurrency-integrity.test.mjs"
//
// Two cashiers selling the last item is the race this shop will actually hit,
// and the failure is silent: stock goes to -1, or two customers walk out with
// one tin. Reading the code says the sale transaction re-reads the product and
// checks quantity, which is the right shape -- but a race is not something you
// verify by reading. These run genuinely concurrent transactions against the
// emulator and check what survived.
//
// The transactions here mirror the shape of the sale path in app.js (read the
// product inside the transaction, refuse if stock moved under you, decrement).
// They are not the client's own code: that logic lives inside a DOM event
// handler and cannot be imported. So this proves the DESIGN holds under
// contention and that the rules refuse the corrupt outcomes; sale-lifecycle
// covers the client's arithmetic separately.
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, runTransaction, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const OWNER = "owner_conc";
const CASHIER_A = "cashier_a";
const CASHIER_B = "cashier_b";
const STORE_A = "storeA";
const STORE_B = "storeB";

const testEnv = await initializeTestEnvironment({
  projectId: "sanitaryflow-erp",
  firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
               host: "127.0.0.1", port: 8085 }
});

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}
async function checkAsync(name, promise, detail = "") {
  try { await promise; check(name, true); }
  catch (error) { check(name, false, detail || String(error).slice(0, 120)); }
}

const as = (uid) => testEnv.authenticatedContext(uid).firestore();

async function seed(quantity) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER), { uid: OWNER, role: "Owner" });
    await setDoc(doc(db, "users", OWNER, "stores", STORE_A), { name: "Branch A" });
    await setDoc(doc(db, "users", OWNER, "stores", STORE_B), { name: "Branch B" });
    for (const uid of [CASHIER_A, CASHIER_B]) {
      await setDoc(doc(db, "users", OWNER, "members", uid), {
        role: "cashier", status: "active", storeIds: [STORE_A]
      });
    }
    await setDoc(doc(db, "users", OWNER, "products", "p1"), {
      name: "Sukari", category: "Food", brand: "X", supplier: "Y",
      quantity, storeId: STORE_A, sellingPrice: 1500, createdAt: new Date()
    });
  });
}

// The sale path's shape: read inside the transaction, refuse if stock moved.
function sellOne(uid, qty = 1) {
  const db = as(uid);
  const ref = doc(db, "users", OWNER, "products", "p1");
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = Number(snap.data()?.quantity ?? 0);
    if (current < qty) throw new Error("NOT_ENOUGH_STOCK");
    tx.update(ref, { quantity: current - qty, sold30: Number(snap.data()?.sold30 ?? 0) + qty, movementReason: "sale" });
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

console.log("=== two cashiers, one tin left ===");
{
  await seed(1);
  const outcomes = await Promise.allSettled([sellOne(CASHIER_A), sellOne(CASHIER_B)]);
  const ok = outcomes.filter((o) => o.status === "fulfilled").length;
  const left = await stockNow();
  check("exactly one sale succeeds", ok === 1, `${ok} succeeded — two would mean the tin sold twice`);
  check("stock lands on zero, never negative", left === 0, `quantity is ${left}`);
  check("the loser is refused rather than silently dropped",
    outcomes.some((o) => o.status === "rejected"));
}

console.log("\n=== ten cashiers, three tins ===");
{
  // Contention well past the two-till case, to catch a retry loop that resolves
  // one race but not several.
  await seed(3);
  const attempts = Array.from({ length: 10 }, (_, i) => sellOne(i % 2 ? CASHIER_A : CASHIER_B));
  const outcomes = await Promise.allSettled(attempts);
  const ok = outcomes.filter((o) => o.status === "fulfilled").length;
  const left = await stockNow();
  check("exactly three succeed", ok === 3, `${ok} succeeded against 3 in stock`);
  check("stock lands on zero", left === 0, `quantity is ${left}`);
  check("no oversell reached the database", left >= 0);
}

console.log("\n=== a sale for more than is on the shelf ===");
{
  await seed(2);
  const outcomes = await Promise.allSettled([sellOne(CASHIER_A, 5)]);
  check("a five-unit sale against two in stock is refused",
    outcomes[0].status === "rejected");
  check("stock is untouched by the refusal", (await stockNow()) === 2);
}

console.log("\n=== negative stock is permitted by rules, refused by the sale path ===");
{
  await seed(1);
  // Changed deliberately in L-9 phase A. This previously asserted that the
  // rules were a second line of defence against negative stock, on the basis
  // that the client guard might be bypassed.
  //
  // That layer had to go, and it is worth being precise about what was traded.
  // Offline selling works against a cached count, so a queued sale can land on
  // stock the server already knows is gone. While the rules refused it, that
  // sale was rejected at REPLAY time -- silently, hours later, after the
  // customer had left with the goods and the cash was in the drawer. The agreed
  // policy is to take the sale and flag it.
  //
  // What still protects stock ONLINE is the sale path itself, asserted above:
  // "a five-unit sale against two in stock is refused" runs inside a
  // transaction that reads the real quantity first. That is the guard that
  // matters while connected, and it is unchanged.
  await checkAsync("a direct write to negative quantity is now permitted",
    assertSucceeds(updateDoc(doc(as(CASHIER_A), "users", OWNER, "products", "p1"),
      { quantity: -1, movementReason: "sale" })));
  check("the negative value is what was actually stored", (await stockNow()) === -1);

  await seed(1);
  await checkAsync("the bound still holds, so a typo or a loop cannot write nonsense",
    assertFails(updateDoc(doc(as(CASHIER_A), "users", OWNER, "products", "p1"),
      { quantity: -99999999, movementReason: "sale" })));
  check("stock is untouched by the refusal", (await stockNow()) === 1);
}

console.log("\n=== two managers editing the same product ===");
{
  await seed(10);
  // Concurrent stock movements from two staff must compose, not clobber: the
  // classic read-modify-write bug leaves 9 instead of 8.
  const outcomes = await Promise.allSettled([sellOne(CASHIER_A, 1), sellOne(CASHIER_B, 1)]);
  const ok = outcomes.filter((o) => o.status === "fulfilled").length;
  const left = await stockNow();
  check("both movements are applied", ok === 2, `${ok} of 2 committed`);
  check("they compose rather than clobber", left === 8,
    `quantity is ${left} — 9 would mean one write overwrote the other`);
}

console.log("\n=== branch inventory stays isolated ===");
{
  await seed(5);
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", OWNER, "products", "pB"), {
      name: "Salt", category: "Food", brand: "X", supplier: "Y",
      quantity: 5, storeId: STORE_B, sellingPrice: 900, createdAt: new Date()
    });
  });
  await checkAsync("a Branch A cashier cannot move Branch B stock",
    assertFails(updateDoc(doc(as(CASHIER_A), "users", OWNER, "products", "pB"),
      { quantity: 0, movementReason: "sale" })));
  let bStock = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    bStock = (await getDoc(doc(ctx.firestore(), "users", OWNER, "products", "pB"))).data()?.quantity;
  });
  check("Branch B stock is unchanged", bStock === 5, `quantity is ${bStock}`);
}


console.log("\n=== a sale total is not tied to its items, and that is detected ===");
{
  // Proven against the emulator: the rules accept any total. They cannot do
  // otherwise -- rules cannot iterate or sum a list, and the per-item unrolled
  // version was removed from firestore.rules for blowing the 1000-expression
  // budget on the sale path. So the invariant is detected, not enforced.
  await seed(50);
  const write = (id, total) => setDoc(doc(as(CASHIER_A), "users", OWNER, "sales", id), {
    items: [{ productId: "p1", name: "Sukari", quantity: 10, sellingPrice: 1500 }],
    total, cashierUid: CASHIER_A, voided: false, storeId: STORE_A,
    staffId: "st1", staffName: "Asha", orderNumber: "1234567890",
    paymentMethod: "cash", createdAt: new Date()
  });
  let underReported = false;
  try { await write("under", 1); underReported = true; } catch {}
  check("the gap is real: a 15,000 basket can be recorded as 1", underReported,
    "if this ever fails, rules gained the ability to check totals and the detector can go");

  // The client-side detector is what surfaces it. Extracted from app.js so the
  // shipped function is the one under test.
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const grab = (name) => {
    const start = app.indexOf(`function ${name}(`);
    let depth = 0, i = app.indexOf("{", start);
    for (; i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}") { depth--; if (depth === 0) break; }
    }
    return app.slice(start, i + 1);
  };
  const { saleTotalMismatches } = new Function(
    "safeNumber",
    `const SALE_TOTAL_TOLERANCE = 1;
${grab("saleLineItemsTotal")}
${grab("saleTotalMismatches")}
return { saleTotalMismatches };`
  )((v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; });

  const line = [{ quantity: 10, sellingPrice: 1500 }];   // 15,000
  check("an honest sale is not flagged",
    saleTotalMismatches([{ id: "a", items: line, total: 15000 }]).length === 0);
  check("an under-reported sale is flagged",
    saleTotalMismatches([{ id: "b", items: line, total: 1 }]).length === 1);
  check("an inflated sale is flagged",
    saleTotalMismatches([{ id: "c", items: line, total: 99999 }]).length === 1);
  // A report that cries wolf on every discounted sale is a report nobody reads.
  check("a legitimately discounted sale is NOT flagged",
    saleTotalMismatches([{ id: "d", items: line, total: 13500, discountAmount: 1500 }]).length === 0);
  check("a voided sale is skipped",
    saleTotalMismatches([{ id: "e", items: line, total: 1, voided: true }]).length === 0);
  check("rounding of a shilling is tolerated",
    saleTotalMismatches([{ id: "f", items: line, total: 15001 }]).length === 0);
  check("the gap is reported with the numbers to act on", (() => {
    const [row] = saleTotalMismatches([{ id: "g", items: line, total: 1 }]);
    return row.recorded === 1 && row.expected === 15000 && row.gap === -14999;
  })());
}

await testEnv.cleanup();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
