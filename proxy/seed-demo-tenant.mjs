// Fills an EMULATOR tenant with a coherent shop, so every screen has something
// real to show without anyone typing for an hour.
//
//   node proxy/seed-demo-tenant.mjs --uid <ownerUid> [--reset]
//
// WHY THIS EXISTS
//
// Twice now a local dataset built by hand has been lost -- once when the
// emulator holding it was killed to free a port (DESIGN-landed-costs.md §18.6).
// A hand-made fixture is also a fixture nobody else can reproduce, so a defect
// found against it cannot be handed to anyone. Spec §16 asks for the same
// thing from the product side: "populate the prototype ... so reports are
// meaningful immediately".
//
// IT CANNOT TOUCH PRODUCTION, AND THAT IS THE POINT
//
// This writes sales, stock and balances. Against the live project it would
// corrupt eight real businesses. So it refuses to run unless
// FIRESTORE_EMULATOR_HOST is set AND that host answers as a Firestore emulator:
// the Admin SDK only ever speaks to the emulator when that variable is set, so
// an accidental production run is not a matter of care, it is unreachable. The
// probe is belt and braces for the case where the variable points somewhere
// unexpected.
//
// THE DATA RECONCILES, WHICH IS THE HARD PART
//
// A seed that produces incoherent numbers is worse than no seed: every report
// reads wrong and the next person spends a day chasing a defect that is only in
// the fixture. So this maintains, by construction:
//
//   - every product's quantity equals the sum of its stock movements, and each
//     movement's quantityAfter chains from the one before it;
//   - the weighted average cost is computed from the opening stock and the
//     landed cost of each delivery, in date order, and written to
//     /productCostHistory with effectiveFrom timestamps BEFORE the sales that
//     consume them -- so COGS resolves the way costInForceAt() expects;
//   - each supplier's balanceOwed equals what was left unpaid on their
//     deliveries, less payments, less the value of goods sent back;
//   - each customer's balanceOwed equals their unpaid credit sales.
//
// The names are the ones spec §16 asks for.
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { get as httpGet } from "node:http";

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1];
};

const OWNER_UID = value("uid");
const PROJECT_ID = value("project") || "sanitaryflow-erp";
const RESET = flag("reset");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!OWNER_UID) {
  die([
    "No --uid given.",
    "",
    "  This needs the owner's Firebase Auth uid -- the account you sign into the",
    "  local app with. Read it from the browser console on http://localhost:5173:",
    "",
    "      (await firebase.auth().currentUser).uid",
    "",
    "  then:  node proxy/seed-demo-tenant.mjs --uid <that value>"
  ].join("\n"));
}

// ------------------------------------------------------------ the hard gate
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!EMULATOR_HOST) {
  die([
    "FIRESTORE_EMULATOR_HOST is not set, so this refuses to run.",
    "",
    "  This script writes sales, stock and balances. Against the live project it",
    "  would corrupt eight real shops. The Admin SDK only talks to the emulator",
    "  when this variable is set, so the variable IS the safety.",
    "",
    "  Start the emulator, then:",
    "",
    "      FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \\",
    "        node proxy/seed-demo-tenant.mjs --uid <ownerUid>"
  ].join("\n"));
}

// Belt and braces: confirm the host really is an emulator before writing.
// FIRESTORE_EMULATOR_HOST could point anywhere, including a proxy in front of
// something real.
//
// Deliberately node:http with `agent: false` rather than fetch(). A refusal has
// to halt the process immediately -- it is a safety gate, so nothing may run
// after it -- and fetch() leaves its connection in a keep-alive pool, which
// makes that immediate process.exit() trip a libuv assertion on Windows. The
// refusal printed correctly and was then followed by what looks like a crash,
// which is exactly how someone talks themselves into bypassing the guard.
// An unpooled socket closes with the request and exits clean.
function probeEmulator(hostPort) {
  const [host, port] = hostPort.split(":");
  return new Promise((resolve) => {
    const request = httpGet(
      { host, port: Number(port) || 80, path: "/", agent: false, timeout: 4000 },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve({
          reached: true,
          isEmulator: (response.statusCode || 500) < 400 && body.toLowerCase().includes("ok")
        }));
      }
    );
    request.on("timeout", () => { request.destroy(); resolve({ reached: false, why: "timed out" }); });
    request.on("error", (error) => resolve({ reached: false, why: error.message }));
  });
}

const probe = await probeEmulator(EMULATOR_HOST);
if (!probe.reached) {
  die(`Could not reach a Firestore emulator at ${EMULATOR_HOST} (${probe.why}). Start it first.`);
}
if (!probe.isEmulator) {
  die(`${EMULATOR_HOST} answered, but not the way the Firestore emulator does. Refusing to write.`);
}

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const root = db.collection("users").doc(OWNER_UID);

console.log(`\n  emulator : ${EMULATOR_HOST}`);
console.log(`  project  : ${PROJECT_ID}`);
console.log(`  tenant   : users/${OWNER_UID}\n`);

// -------------------------------------------------------------- the fixture
// A timeline, not a heap. The profit chart buckets by week and month, so the
// data has to be spread over real dates or every chart shows one bar.
const DAY = 86400000;
const now = Date.now();
const at = (daysAgo, hour = 10) => new Date(now - daysAgo * DAY + hour * 3600000 - 10 * 3600000);
const ts = (d) => Timestamp.fromDate(d);
const money = (n) => Math.round(n);

const STORE_ID = "seedMainBranch";

// Spec §16's names.
const SUPPLIERS = [
  { id: "seedSupABC", name: "ABC Traders", phone: "0712000111", tin: "101-201-301" },
  { id: "seedSupXYZ", name: "XYZ Distributors", phone: "0713000222", tin: "102-202-302" },
  { id: "seedSupSun", name: "Sunrise Suppliers", phone: "0714000333", tin: "103-203-303" }
];

// openingQty at openingCost, then deliveries. Selling price is what the shelf
// label says; the average cost is DERIVED below, never typed.
const PRODUCTS = [
  { id: "seedWater", name: "Water 500ml", category: "Drinks", unit: "bottle",
    sellingPrice: 2500, reorderLevel: 40, openingQty: 50, openingCost: 1800 },
  { id: "seedSoda", name: "Soda 500ml", category: "Drinks", unit: "bottle",
    sellingPrice: 2000, reorderLevel: 30, openingQty: 0, openingCost: 0 },
  { id: "seedJuice", name: "Juice 500ml", category: "Drinks", unit: "bottle",
    sellingPrice: 3000, reorderLevel: 25, openingQty: 30, openingCost: 2000 },
  { id: "seedRice", name: "Rice 25kg", category: "Food", unit: "bag",
    sellingPrice: 78000, reorderLevel: 8, openingQty: 0, openingCost: 0 },
  { id: "seedSugar", name: "Sugar 1kg", category: "Food", unit: "packet",
    sellingPrice: 3500, reorderLevel: 20, openingQty: 12, openingCost: 2600 }
];

// Each delivery: a supplier, a date, what was paid, and its lines. `freight` is
// the additional cost that gets allocated across the lines by value -- the same
// basis the app's own allocation uses.
const DELIVERIES = [
  { id: "seedDel1", supplier: "seedSupABC", ref: "ABC-1041", daysAgo: 34, freight: 24000,
    // Paid in full on the day.
    paid: "full", method: "cash",
    lines: [
      { product: "seedWater", qty: 100, goodsCost: 190000 },
      { product: "seedSoda", qty: 80, goodsCost: 120000 }
    ] },
  { id: "seedDel2", supplier: "seedSupXYZ", ref: "XYZ-2207", daysAgo: 21, freight: 45000,
    // Part-paid: the rest sits on the supplier's balance.
    paid: 500000, method: "bank",
    lines: [
      { product: "seedRice", qty: 40, goodsCost: 2600000 },
      { product: "seedSugar", qty: 60, goodsCost: 150000 }
    ] },
  { id: "seedDel3", supplier: "seedSupSun", ref: "SUN-0088", daysAgo: 12, freight: 8000,
    // Wholly on credit.
    paid: 0, method: "credit",
    lines: [
      { product: "seedJuice", qty: 50, goodsCost: 96000 }
    ] }
];

const CUSTOMERS = [
  { id: "seedCustA", name: "Customer A", phone: "0755000111" },
  { id: "seedCustB", name: "Customer B", phone: "0755000222" }
];

// Sales across the weeks. A walk-in has no customer; a credit sale leaves a
// balance behind. Quantities are checked against stock below before anything
// is written.
const SALES = [
  { daysAgo: 30, method: "cash", lines: [["seedWater", 8], ["seedSoda", 4]] },
  { daysAgo: 27, method: "mobile", lines: [["seedSugar", 5]] },
  { daysAgo: 22, method: "cash", lines: [["seedWater", 6], ["seedJuice", 3]] },
  { daysAgo: 18, method: "bank", lines: [["seedRice", 2]] },
  { daysAgo: 15, method: "cash", lines: [["seedSoda", 6], ["seedSugar", 4]] },
  { daysAgo: 11, method: "credit", customer: "seedCustA", paidNow: 0, lines: [["seedRice", 3]] },
  { daysAgo: 8, method: "cash", lines: [["seedWater", 4], ["seedJuice", 2]] },
  { daysAgo: 6, method: "mobile", lines: [["seedSoda", 2], ["seedSugar", 6]] },
  { daysAgo: 4, method: "credit", customer: "seedCustB", paidNow: 20000, lines: [["seedRice", 1], ["seedJuice", 3]] },
  { daysAgo: 2, method: "cash", lines: [["seedWater", 2], ["seedSugar", 3]] },
  { daysAgo: 1, method: "bank", lines: [["seedSoda", 3]] }
];

const EXPENSES = [
  { daysAgo: 30, category: "rent", amount: 300000, nature: "indirect", paidFrom: "other" },
  { daysAgo: 28, category: "utilities", amount: 45000, nature: "indirect", paidFrom: "till" },
  { daysAgo: 24, category: "transport", amount: 18000, nature: "direct", paidFrom: "till", note: "Boda, customer delivery" },
  { daysAgo: 16, category: "wages", amount: 220000, nature: "indirect", paidFrom: "other" },
  { daysAgo: 9, category: "transport", amount: 12000, nature: "direct", paidFrom: "till" },
  { daysAgo: 5, category: "utilities", amount: 38000, nature: "indirect", paidFrom: "other" },
  { daysAgo: 3, category: "other", amount: 25000, nature: "indirect", paidFrom: "till", note: "Shelf repair" }
];

// Paid against ABC's balance after the fact, and goods sent back to XYZ.
const SUPPLIER_PAYMENTS = [
  { supplier: "seedSupXYZ", daysAgo: 7, amount: 400000, method: "bank", reference: "TRF-9912" }
];
const PURCHASE_RETURNS = [
  { supplier: "seedSupXYZ", product: "seedSugar", delivery: "seedDel2", daysAgo: 5, qty: 4,
    reason: "Four packets split in transit" }
];
const ADJUSTMENTS = [
  { product: "seedWater", daysAgo: 6, delta: -5, reason: "damaged", note: "Crate dropped" },
  { product: "seedJuice", daysAgo: 3, delta: -2, reason: "expired" }
];

// ------------------------------------------------------- build the movements
// Everything that moves stock, in date order, so the chain can be computed
// once rather than patched afterwards.
const productById = new Map(PRODUCTS.map((p) => [p.id, p]));
const supplierById = new Map(SUPPLIERS.map((s) => [s.id, s]));

const events = [];

for (const p of PRODUCTS) {
  if (p.openingQty > 0) {
    events.push({ kind: "opening", daysAgo: 40, product: p.id, delta: p.openingQty });
  }
}

// Allocate each delivery's freight across its lines by value, exactly as the
// app does, so the seeded unit costs match what the app would have produced.
for (const d of DELIVERIES) {
  const goods = d.lines.reduce((sum, l) => sum + l.goodsCost, 0);
  let allocated = 0;
  d.computed = d.lines.map((l, i) => {
    const share = i === d.lines.length - 1
      ? d.freight - allocated                       // residual to the last line
      : Math.round((l.goodsCost / goods) * d.freight);
    allocated += share;
    const landedTotal = l.goodsCost + share;
    return { ...l, landedCost: share, totalPaid: landedTotal, unitCost: landedTotal / l.qty };
  });
  d.goodsTotal = goods;
  d.totalCost = goods + d.freight;
  d.amountPaid = d.paid === "full" ? d.totalCost : d.paid;
  for (const l of d.computed) {
    events.push({ kind: "delivery", daysAgo: d.daysAgo, product: l.product, delta: l.qty, delivery: d.id });
  }
}

for (const [i, s] of SALES.entries()) {
  for (const [product, qty] of s.lines) {
    events.push({ kind: "sale", daysAgo: s.daysAgo, product, delta: -qty, saleIndex: i });
  }
}
for (const r of PURCHASE_RETURNS) {
  events.push({ kind: "supplier-return", daysAgo: r.daysAgo, product: r.product, delta: -r.qty });
}
for (const a of ADJUSTMENTS) {
  events.push({ kind: "adjustment", daysAgo: a.daysAgo, product: a.product, delta: a.delta, reason: a.reason, note: a.note });
}

events.sort((a, b) => b.daysAgo - a.daysAgo);

// Walk the timeline: chain each movement and refuse to seed a shelf that would
// go negative. A fixture that oversells is a fixture that makes the stock
// ledger reconciliation report a defect that is not in the app.
const shelf = new Map(PRODUCTS.map((p) => [p.id, 0]));
const movements = [];
for (const e of events) {
  const before = shelf.get(e.product);
  const after = before + e.delta;
  if (after < 0) {
    die(`Fixture is inconsistent: ${productById.get(e.product).name} would go to ${after} `
      + `on the ${e.kind} ${e.daysAgo} days ago. Fix the quantities above.`);
  }
  shelf.set(e.product, after);
  movements.push({ ...e, quantityBefore: before, quantityAfter: after });
}

// ------------------------------------------------------------ costing, in order
// Weighted average, recomputed at each stock-in exactly as nextUnitCost() does,
// so /productCostHistory carries the same series the app would have written.
const costHistory = [];
const costNow = new Map(PRODUCTS.map((p) => [p.id, { qty: 0, unitCost: 0 }]));

for (const m of movements) {
  if (m.kind === "opening") {
    const p = productById.get(m.product);
    costNow.set(m.product, { qty: m.delta, unitCost: p.openingCost });
    costHistory.push({ product: m.product, daysAgo: m.daysAgo, unitCost: p.openingCost, reason: "opening" });
  } else if (m.kind === "delivery") {
    const d = DELIVERIES.find((x) => x.id === m.delivery);
    const line = d.computed.find((l) => l.product === m.product);
    const cur = costNow.get(m.product);
    const totalUnits = cur.qty + line.qty;
    const blended = totalUnits > 0
      ? (cur.qty * cur.unitCost + line.totalPaid) / totalUnits
      : line.unitCost;
    costNow.set(m.product, { qty: totalUnits, unitCost: blended });
    costHistory.push({ product: m.product, daysAgo: m.daysAgo, unitCost: blended, reason: "purchase" });
  } else {
    // Stock leaving does not change the average.
    const cur = costNow.get(m.product);
    costNow.set(m.product, { qty: cur.qty + m.delta, unitCost: cur.unitCost });
  }
}

// -------------------------------------------------------------- the balances
// Derived from the documents, never typed, so the seeded figure is the figure
// the app would have arrived at.
const supplierOwed = new Map(SUPPLIERS.map((s) => [s.id, 0]));
for (const d of DELIVERIES) {
  supplierOwed.set(d.supplier, supplierOwed.get(d.supplier) + (d.totalCost - d.amountPaid));
}
for (const p of SUPPLIER_PAYMENTS) {
  supplierOwed.set(p.supplier, Math.max(supplierOwed.get(p.supplier) - p.amount, 0));
}
for (const r of PURCHASE_RETURNS) {
  const d = DELIVERIES.find((x) => x.id === r.delivery);
  const line = d.computed.find((l) => l.product === r.product);
  const credit = money(line.unitCost * r.qty);
  r.amount = credit;
  supplierOwed.set(r.supplier, Math.max(supplierOwed.get(r.supplier) - credit, 0));
}

const customerOwed = new Map(CUSTOMERS.map((c) => [c.id, 0]));
const saleTotals = SALES.map((s) => {
  const total = s.lines.reduce((sum, [product, qty]) =>
    sum + productById.get(product).sellingPrice * qty, 0);
  if (s.method === "credit" && s.customer) {
    const due = total - (s.paidNow || 0);
    customerOwed.set(s.customer, customerOwed.get(s.customer) + due);
  }
  return total;
});

// ------------------------------------------------------------------- writing
async function wipe() {
  const collections = ["products", "productCosts", "productCostHistory", "purchases",
                       "deliveries", "sales", "expenses", "stockMovements",
                       "suppliers", "customers", "purchaseReturns", "stores"];
  for (const name of collections) {
    const snap = await root.collection(name).get();
    // Subcollections (a supplier's payments) do not go with their parent.
    for (const doc of snap.docs) {
      for (const sub of await doc.ref.listCollections()) {
        const subSnap = await sub.get();
        await Promise.all(subSnap.docs.map((d) => d.ref.delete()));
      }
    }
    let batch = db.batch();
    let n = 0;
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    if (n % 400 !== 0) await batch.commit();
    if (snap.size) console.log(`  cleared ${String(snap.size).padStart(4)}  ${name}`);
  }
}

async function seed() {
  let batch = db.batch();
  let writes = 0;
  const put = (ref, data) => {
    batch.set(ref, data);
    if (++writes % 400 === 0) return batch.commit().then(() => { batch = db.batch(); });
    return null;
  };

  put(root.collection("stores").doc(STORE_ID), { name: "Main Branch", createdAt: ts(at(45)) });

  for (const s of SUPPLIERS) {
    put(root.collection("suppliers").doc(s.id), {
      name: s.name, phone: s.phone, tin: s.tin, storeId: STORE_ID,
      openingBalance: 0, balanceOwed: money(supplierOwed.get(s.id)),
      active: true, createdAt: ts(at(42)), updatedAt: ts(at(42))
    });
  }

  for (const c of CUSTOMERS) {
    const owed = money(customerOwed.get(c.id));
    put(root.collection("customers").doc(c.id), {
      name: c.name, phone: c.phone, storeId: STORE_ID,
      balanceOwed: owed,
      ...(owed > 0 ? { oldestUnpaidAt: ts(at(11)) } : {}),
      createdAt: ts(at(38))
    });
  }

  for (const p of PRODUCTS) {
    const cost = costNow.get(p.id);
    put(root.collection("products").doc(p.id), {
      name: p.name, category: p.category, brand: "", supplier: "",
      unit: p.unit, active: true,
      sku: p.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 18),
      quantity: shelf.get(p.id),
      sellingPrice: p.sellingPrice, reorderLevel: p.reorderLevel,
      storeId: STORE_ID, createdAt: ts(at(41)), updatedAt: ts(at(1))
    });
    if (cost.unitCost > 0) {
      put(root.collection("productCosts").doc(p.id), {
        storeId: STORE_ID, costPrice: cost.unitCost,
        costKnownFrom: ts(at(40)), updatedAt: ts(at(1))
      });
    }
  }

  for (const h of costHistory) {
    put(root.collection("productCostHistory").doc(), {
      productId: h.product, storeId: STORE_ID, costPrice: h.unitCost,
      effectiveFrom: ts(at(h.daysAgo, 8)), reason: h.reason, createdAt: ts(at(h.daysAgo, 8))
    });
  }

  for (const d of DELIVERIES) {
    const s = supplierById.get(d.supplier);
    put(root.collection("deliveries").doc(d.id), {
      storeId: STORE_ID, reference: d.ref,
      supplierName: s.name, supplierId: d.supplier,
      receivedAt: ts(at(d.daysAgo)),
      goodsCost: d.goodsTotal,
      freight: d.freight, importDuty: 0, clearing: 0, transport: 0,
      handling: 0, insurance: 0, otherCost: 0,
      additionalTotal: d.freight, totalCost: d.totalCost,
      allocationBasis: "value", lineCount: d.lines.length,
      amountPaid: d.amountPaid, paymentMethod: d.method,
      recordedByUid: OWNER_UID, createdAt: ts(at(d.daysAgo))
    });
    for (const l of d.computed) {
      put(root.collection("purchases").doc(), {
        storeId: STORE_ID, productId: l.product,
        productName: productById.get(l.product).name,
        quantity: l.qty, totalPaid: money(l.totalPaid), unitCost: l.unitCost,
        goodsCost: l.goodsCost, landedCost: l.landedCost,
        deliveryId: d.id, supplierName: s.name, supplierId: d.supplier,
        hasFiscalReceipt: true, receiptNumber: d.ref,
        recordedByUid: OWNER_UID, createdAt: ts(at(d.daysAgo))
      });
    }
  }

  for (const p of SUPPLIER_PAYMENTS) {
    put(root.collection("suppliers").doc(p.supplier).collection("payments").doc(), {
      amount: p.amount, method: p.method, reference: p.reference,
      recordedByUid: OWNER_UID, createdAt: ts(at(p.daysAgo))
    });
  }

  for (const r of PURCHASE_RETURNS) {
    put(root.collection("purchaseReturns").doc(), {
      storeId: STORE_ID, purchaseId: "", productId: r.product,
      productName: productById.get(r.product).name,
      quantity: r.qty, amount: r.amount,
      supplierId: r.supplier, supplierName: supplierById.get(r.supplier).name,
      reason: r.reason, recordedByUid: OWNER_UID, createdAt: ts(at(r.daysAgo))
    });
  }

  SALES.forEach((s, i) => {
    const total = saleTotals[i];
    const items = s.lines.map(([product, qty]) => {
      const p = productById.get(product);
      return { productId: product, name: p.name, qty, sellingPrice: p.sellingPrice,
               lineTotal: p.sellingPrice * qty };
    });
    put(root.collection("sales").doc(), {
      storeId: STORE_ID, items, total, subtotal: total, discountAmount: 0,
      paymentMethod: s.method,
      ...(s.customer ? {
        customerId: s.customer,
        customerName: CUSTOMERS.find((c) => c.id === s.customer).name,
        amountPaid: s.paidNow || 0,
        balanceDue: total - (s.paidNow || 0)
      } : {}),
      cashierUid: OWNER_UID, staffId: OWNER_UID, staffName: "Owner",
      orderNumber: String(100400 + i), voided: false,
      createdAt: ts(at(s.daysAgo, 14))
    });
  });

  for (const e of EXPENSES) {
    put(root.collection("expenses").doc(), {
      storeId: STORE_ID, category: e.category, amount: e.amount,
      paidFrom: e.paidFrom, nature: e.nature,
      spentAt: ts(at(e.daysAgo, 9)),
      ...(e.note ? { note: e.note } : {}),
      recordedByUid: OWNER_UID, createdAt: ts(at(e.daysAgo, 9))
    });
  }

  const LEDGER_REASON = {
    opening: "adjustment", delivery: "restock", sale: "sale",
    "supplier-return": "supplier-return", adjustment: "adjustment"
  };
  for (const m of movements) {
    put(root.collection("stockMovements").doc(), {
      productId: m.product, productName: productById.get(m.product).name,
      storeId: STORE_ID, reason: LEDGER_REASON[m.kind], delta: m.delta,
      quantityBefore: m.quantityBefore, quantityAfter: m.quantityAfter,
      ...(m.kind === "opening" ? { adjustmentReason: "opening" } : {}),
      ...(m.kind === "adjustment" ? { adjustmentReason: m.reason } : {}),
      ...(m.note ? { note: m.note } : {}),
      uid: OWNER_UID, createdAt: ts(at(m.daysAgo, 11))
    });
  }

  await batch.commit();
  return writes;
}

if (RESET) {
  console.log("  --reset given, clearing the tenant first\n");
  await wipe();
  console.log("");
}

const written = await seed();

// ---------------------------------------------------------------- the report
// Printed so the invariants can be read rather than trusted.
const stockAtCost = PRODUCTS.reduce((sum, p) => sum + shelf.get(p.id) * costNow.get(p.id).unitCost, 0);
const revenue = saleTotals.reduce((a, b) => a + b, 0);
const spent = EXPENSES.reduce((sum, e) => sum + e.amount, 0);

console.log(`  ${written} documents written\n`);
console.log("  shelf, and what it cost");
for (const p of PRODUCTS) {
  const q = shelf.get(p.id);
  const c = costNow.get(p.id).unitCost;
  console.log(`    ${p.name.padEnd(14)} ${String(q).padStart(4)} @ ${money(c).toString().padStart(7)}  = ${money(q * c).toLocaleString("en-US").padStart(11)}`);
}
console.log(`\n  stock at cost      ${money(stockAtCost).toLocaleString("en-US").padStart(12)}`);
console.log(`  revenue            ${revenue.toLocaleString("en-US").padStart(12)}`);
console.log(`  expenses           ${spent.toLocaleString("en-US").padStart(12)}`);
console.log("\n  owed to suppliers");
for (const s of SUPPLIERS) {
  console.log(`    ${s.name.padEnd(20)} ${money(supplierOwed.get(s.id)).toLocaleString("en-US").padStart(10)}`);
}
console.log("\n  owed by customers");
for (const c of CUSTOMERS) {
  console.log(`    ${c.name.padEnd(20)} ${money(customerOwed.get(c.id)).toLocaleString("en-US").padStart(10)}`);
}
console.log(`\n  Sign in as this uid on http://localhost:5173/app.html and pick "Main Branch".\n`);
