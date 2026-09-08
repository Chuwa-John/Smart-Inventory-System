// The Receive Stock screen, rendered in a real browser.
//
//   npx playwright install --with-deps chromium   (once)
//   node deliveries.headless.mjs
//
// Why this exists rather than another source-grep. The centrepiece of
// DESIGN-landed-costs.md phase 4 is a LIVE PREVIEW: the docx section 6 table,
// recomputed on every keystroke by prepareDelivery() -- the same function the
// write path calls. Two things can be wrong about that which no amount of
// reading the source will show:
//
//   the numbers it puts on screen, and
//   whether the table is legible once the CSS has had its say.
//
// A shop reconciles the TOTAL row against its supplier's invoice. If that row
// says 11,800,000 in the test and 11,800,000.00 wrapped across two lines on a
// laptop, the test was not measuring the thing that matters.
//
// The real functions are lifted out of app.js -- the purchases.test.mjs
// convention -- with the real DICTIONARY, the real esc(), the real money(), and
// the real styles.css. What is stubbed is only what reaches Firestore or the
// signed-in session: qs() is the DOM, state is a fixture, storeProducts()
// returns three products.
//
// Nothing here is deployed.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const src = await readFile(join(ROOT, "app.js"), "utf8");
const appHtml = await readFile(join(ROOT, "app.html"), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("playwright is not installed. Run: npm ci && npx playwright install --with-deps chromium");
  process.exit(1);
}

// --- lift the real code out of app.js ---------------------------------------
function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = src.indexOf("(", start), parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) break; }
  }
  i = src.indexOf("{", i);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function block(text, startsWith, endsWith) {
  const a = text.indexOf(startsWith);
  if (a === -1) throw new Error(`${startsWith} not found`);
  const b = text.indexOf(endsWith, a);
  if (b === -1) throw new Error(`end of ${startsWith} not found`);
  return text.slice(a, b + endsWith.length);
}
const constant = (name) => src.match(new RegExp(`const ${name} = (\\d+)`))[1];
// A top-level object literal, for the tables the render functions read --
// lifted rather than restated, so a change to one cannot silently pass here.
function objectLiteral(name) {
  const start = src.indexOf(`const ${name} = {`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  return src.slice(start, src.indexOf("};", start) + 2);
}

// The dialog's markup, taken from app.html itself rather than retyped -- a
// retyped copy is a copy that can drift from the one that ships.
const dialogMarkup = block(appHtml, '<dialog id="deliveryDialog"', "</dialog>");

// The phase 5 landed-cost panel, and the expense totals container it must stay
// out of -- both taken from app.html rather than retyped.
const landedMarkup = block(appHtml, '<article class="panel" id="expenseLandedPanel"', "</article>");

// The Profit Report's containers -- phase 6. renderProfit() writes the docx
// section 9 statement into #profitGrid and its caveat into #profitNote.
// The <section id="profit"> wrapper matters: renderProfit() reads it and returns
// early if it is missing, which renders an empty statement and looks like the
// statement being broken rather than the harness being incomplete.
// The statement's containers plus the phase 7 drill-down panel, taken from
// app.html rather than retyped.
const drillMarkup = block(appHtml, '<article class="panel" id="profitProductPanel"', "</article>");
// The deliveries list and the phase 7 cost-reports panel, for the role group:
// what matters there is that a wrong role EMPTIES these containers, so they have
// to exist to be emptied.
const deliveriesListMarkup =
  '<div class="kpi-grid" id="deliveryTotals"></div>'
  + '<input id="deliveryMonthInput" type="month">'
  + '<table><tbody id="deliveriesTable"></tbody></table>';
const costReportsMarkup = block(appHtml, '<article class="panel" id="costReportsPanel"', "</article>");
const profitMarkup = '<section id="profit">'
  + '<div class="statement-wrap" id="profitGrid"></div>'
  + '<p class="muted" id="profitNote"></p>'
  + drillMarkup + '</section>';

// The English dictionary, so a missing key shows up as a bare "deliveries.x"
// on screen and is caught below instead of shipping.
const dictionary = block(src, "const DICTIONARY = {", "\n};");

const harness = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="/styles.css">
</head><body>
<main class="main" style="padding:24px">${dialogMarkup}
<div class="kpi-grid" id="expenseTotals"></div>
${landedMarkup}
${profitMarkup}
${deliveriesListMarkup}
${costReportsMarkup}</main>
<script>
${dictionary}
const state = {
  language: "en",
  // The real isOwnerRole()/isManagerOrOwnerRole() read this. Owner by default so
  // every earlier group renders; the role group below varies it deliberately.
  currentUserRole: "owner",
  stores: [{ id: "s1", name: "Branch A", currencyCode: "TZS" }],
  currentStoreId: "s1",
  products: [
    { id: "a", name: "Product A", storeId: "s1" },
    { id: "b", name: "Product B", storeId: "s1" },
    { id: "c", name: "Product C", storeId: "s1" }
  ],
  deliveryDraft: null
};
const qs = (sel) => document.querySelector(sel);
const currentCurrencyCode = () => "TZS";
const storeProducts = () => state.products;
${extract("safeNumber")}
${extract("esc")}
${extract("formatAmount")}
${extract("money")}
${extract("t")}
${src.slice(src.indexOf("const DELIVERY_COST_TYPES = "), src.indexOf("];", src.indexOf("const DELIVERY_COST_TYPES = ")) + 2)}
const MAX_COUNT = ${constant("MAX_COUNT")};
const MAX_MONEY = ${constant("MAX_MONEY")};
const DELIVERY_MAX_LINES = ${constant("DELIVERY_MAX_LINES")};
${extract("deliveryAdditionalTotal")}
${extract("allocateLandedCosts")}
${extract("prepareDelivery")}
${extract("productNameById")}
${extract("emptyDeliveryDraft")}
${extract("deliveryErrorMessage")}
${extract("deliveryDraftLines")}
${extract("renderDeliveryLines")}
${extract("renderDeliveryCostFields")}
${extract("renderDeliveryPreview")}
${extract("renderDeliveryDialog")}
${extract("localMonthKey")}
${extract("deliveryReceivedAt")}
${extract("summariseLandedForMonth")}
${extract("renderLandedCostSection")}
${extract("summariseDeliveries")}
${extract("deliveryBasisLabel")}
${extract("renderDeliveries")}
${extract("summariseStockValuation")}
${extract("purchasedAt")}
${extract("summariseSuppliers")}
${extract("expenseSpentAt")}
${objectLiteral("EXPENSE_NATURE_BY_CATEGORY")}
${extract("expenseNature")}
${extract("expenseCategoryLabel")}
${extract("summariseExpensesByNature")}
${extract("productCostMap")}
${extract("renderCostReports")}
let deliveriesFixture = [];
const storeDeliveries = () => deliveriesFixture;

// The Profit Report. Everything renderProfit() reaches for that is not the DOM.
let profitInput = null;
let coverageFrom = null;
// The REAL role helpers, both of which read state.currentUserRole -- so the role
// tests drive the same code the app does rather than a stub of it.
${extract("isOwnerRole")}
${extract("isManagerOrOwnerRole")}
${extract("canOpenView")}
const CASHIER_ALLOWED_VIEWS = ["pos"];
const storeSellsServices = () => false;
const vatSettings = () => ({ registered: false });
const salesCoverageFromMs = () => coverageFrom;
const storeExpenses = () => profitInput.expenses;
const saleStoreId = (sale) => sale.storeId || "s1";
const buildCostIndex = () => profitInput.costIndex;
const summariseProfit = (args) => profitInput.summary(args);
${extract("controlTile")}
${extract("landedRatioByProduct")}
${extract("saleReturnedQtyMap")}
${extract("summariseProductProfit")}
${extract("isServiceLine")}
${extract("saleTimestamp")}
${extract("costInForceAt")}
let purchasesFixture = [];
const storePurchases = () => purchasesFixture;
${extract("renderProductProfit")}
${extract("renderProfit")}

window.harness = {
  open(draft) {
    state.deliveryDraft = Object.assign(emptyDeliveryDraft(), draft || {});
    renderDeliveryDialog();
    qs("#deliveryDialog").show();
  },
  render: () => renderDeliveryDialog(),
  setBasis(basis) { state.deliveryDraft.basis = basis; renderDeliveryDialog(); },
  // The phase 6 Profit Report. summariseProfit() is exercised by
  // purchases.test.mjs; what is under test HERE is the statement it renders.
  showProfit(summary, fixture) {
    state.sales = (fixture && fixture.sales) || [];
    purchasesFixture = (fixture && fixture.purchases) || [];
    profitInput = { summary: () => summary, expenses: [],
                    costIndex: (fixture && fixture.costIndex) || new Map() };
    state.profitMonthTouched = true;
    state.profitMonthSelection = "2026-09";
    renderProfit();
  },
  // The docx section 9 figures.
  profit() {
    this.showProfit({
      outsideWindow: false, monthKey: "2026-09",
      revenue: 45000000, salesCount: 12, cogs: 27000000,
      costedLines: 12, uncostedLines: 0, anyCostKnown: true, allCostKnown: true,
      grossProfit: 18000000, grossMarginPct: 40,
      expenses: 10000000, expenseCount: 2,
      directExpenses: 2000000, indirectExpenses: 8000000,
      netProfit: 8000000, anyExpensesRecorded: true
    });
  },
  // The phase 7 drill-down, on the docx section 6/7 numbers.
  drill() {
    const at = (d) => new Date(2026, 8, d, 12, 0, 0);
    this.showProfit({
      outsideWindow: false, monthKey: "2026-09",
      revenue: 1500000, salesCount: 1, cogs: 1180000,
      costedLines: 1, uncostedLines: 0, anyCostKnown: true, allCostKnown: true,
      grossProfit: 320000, grossMarginPct: 21,
      expenses: 0, expenseCount: 0, directExpenses: 0, indirectExpenses: 0,
      netProfit: 320000, anyExpensesRecorded: false
    }, {
      sales: [{ createdAt: at(10), storeId: "s1", items: [
        { productId: "a", name: "Product A", qty: 100, lineTotal: 1500000 }] }],
      purchases: [{ productId: "a", goodsCost: 5000000, landedCost: 900000,
                    totalPaid: 5900000, quantity: 500, createdAt: at(1) }],
      costIndex: new Map([["a", [{ at: at(1).getTime(), costPrice: 11800 }]]])
    });
  },
  profitNoCost() {
    this.showProfit({
      outsideWindow: false, monthKey: "2026-09",
      revenue: 100000, salesCount: 1, cogs: 0,
      costedLines: 0, uncostedLines: 3, anyCostKnown: false, allCostKnown: false,
      grossProfit: 100000, grossMarginPct: 100,
      expenses: 10000, expenseCount: 1,
      directExpenses: 0, indirectExpenses: 10000,
      netProfit: 90000, anyExpensesRecorded: true
    });
  },
  profitOutsideWindow() {
    coverageFrom = new Date(2026, 8, 1).getTime();
    this.showProfit({ outsideWindow: true, monthKey: "2026-01" });
  },
  // The phase 5 expenses screen: the landed-cost panel, fed by deliveries.
  expenses(deliveries) {
    deliveriesFixture = deliveries === undefined ? [{
      receivedAt: new Date(2026, 8, 3, 12, 0, 0),
      additionalTotal: 1800000, totalCost: 11800000,
      freight: 800000, importDuty: 500000, clearing: 300000, transport: 200000,
      handling: 0, insurance: 0, otherCost: 0
    }] : deliveries;
    renderLandedCostSection("2026-09");
  },
  // The docx section 5/6 delivery.
  docx() {
    this.open({
      lines: [
        { productId: "a", quantity: "500", goodsCost: "5000000", manual: "" },
        { productId: "b", quantity: "200", goodsCost: "3000000", manual: "" },
        { productId: "c", quantity: "100", goodsCost: "2000000", manual: "" }
      ],
      costs: { freight: "800000", importDuty: "500000", clearing: "300000",
               transport: "200000", handling: "", insurance: "", otherCost: "" },
      basis: "value"
    });
  }
};
</script>
</body></html>`;

// --- static server ----------------------------------------------------------
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
  // The harness route is matched on the RAW path, before normalize(). On Windows
  // normalize("/harness.html") returns "\harness.html", so a comparison against
  // "/harness.html" never matches and the server 404s its own harness page --
  // which surfaces as `window.harness is undefined` and looks like a bug in the
  // page rather than in the server serving it.
  const raw = decodeURIComponent(req.url.split("?")[0]);
  const rel = normalize(raw).replace(/^(\.\.[/\\])+/, "");
  if (raw === "/" || raw === "/harness.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(harness);
    return;
  }
  try {
    const body = await readFile(join(ROOT, rel));
    res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e.message || e)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
// Nothing external: no Firebase, no fonts, no CDN. The DOM and the stylesheet
// are what is under test.
await page.route("**://**", (route) =>
  route.request().url().includes(`127.0.0.1:${port}`) ? route.continue() : route.abort());
await page.goto(`http://127.0.0.1:${port}/harness.html`);

check("the harness loaded with no page errors", consoleErrors.length === 0, consoleErrors.join("\n      "));

// ============================================================================
console.log("\n=== the docx section 6 table, as a shop actually sees it ===");
await page.evaluate(() => window.harness.docx());

const preview = await page.evaluate(() =>
  [...document.querySelectorAll("#deliveryPreviewTable tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent.trim())));

check("the preview has three product rows and a total", preview.length === 4,
  `got ${preview.length} rows: ${JSON.stringify(preview)}`);

const expected = [
  ["Product A", "500", "TZS 5,000,000.00", "TZS 900,000.00", "TZS 5,900,000.00", "TZS 11,800.00"],
  ["Product B", "200", "TZS 3,000,000.00", "TZS 540,000.00", "TZS 3,540,000.00", "TZS 17,700.00"],
  ["Product C", "100", "TZS 2,000,000.00", "TZS 360,000.00", "TZS 2,360,000.00", "TZS 23,600.00"],
  ["TOTAL", "800", "TZS 10,000,000.00", "TZS 1,800,000.00", "TZS 11,800,000.00", ""]
];
for (const [i, row] of expected.entries()) {
  check(`preview row ${i + 1} matches the docx`,
    JSON.stringify(preview[i]) === JSON.stringify(row),
    `got  ${JSON.stringify(preview[i])}\n      want ${JSON.stringify(row)}`);
}

// The number the docx section 7 turns on, on screen rather than in a unit test.
check("Product A's unit cost reads 11,800 and not 10,000",
  preview[0]?.[5] === "TZS 11,800.00", `got ${preview[0]?.[5]}`);

const totals = await page.evaluate(() => ({
  goods: document.querySelector("#deliveryGoodsTotal").textContent.trim(),
  additional: document.querySelector("#deliveryAdditionalTotal").textContent.trim(),
  error: document.querySelector("#deliveryFormError").textContent.trim(),
  saveDisabled: document.querySelector("#saveDeliveryButton").disabled
}));
check("the goods total is stated", totals.goods.includes("10,000,000.00"), totals.goods);
check("the additional total is stated", totals.additional.includes("1,800,000.00"), totals.additional);
check("no error is shown for a valid delivery", totals.error === "", totals.error);
check("Record delivery is enabled", totals.saveDisabled === false);

// ============================================================================
console.log("\n=== every string on screen is translated ===");
// A missing dictionary key renders as the key itself. Catching that here is the
// difference between a shop seeing "Share of additional" and "deliveries.thAllocation".
const rawKeys = await page.evaluate(() =>
  [...document.querySelectorAll("#deliveryDialog *")]
    .flatMap((el) => [...el.childNodes])
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.trim())
    .filter((s) => /^(deliveries|toast|product)\.[a-zA-Z]+$/.test(s)));
check("no untranslated key is rendered", rawKeys.length === 0, rawKeys.join(", "));

// ============================================================================
console.log("\n=== the manual basis adds a Share box to every line ===");
const before = await page.evaluate(() =>
  document.querySelectorAll('#deliveryLines [data-field="manual"]').length);
check("value basis shows no Share boxes", before === 0, `got ${before}`);

await page.evaluate(() => window.harness.setBasis("manual"));
const after = await page.evaluate(() => ({
  boxes: document.querySelectorAll('#deliveryLines [data-field="manual"]').length,
  hasManualClass: document.querySelectorAll("#deliveryLines .delivery-line.has-manual").length,
  error: document.querySelector("#deliveryFormError").textContent.trim(),
  saveDisabled: document.querySelector("#saveDeliveryButton").disabled
}));
check("manual basis shows one Share box per line", after.boxes === 3, `got ${after.boxes}`);
check("...and the row grid widens for it", after.hasManualClass === 3, `got ${after.hasManualClass}`);
// Switching to manual with no shares typed is a refusal, and it must SAY so
// rather than silently disabling the button.
check("an unbalanced manual split names the shortfall",
  /1,800,000\.00/.test(after.error), `got "${after.error}"`);
check("...and Record delivery is disabled while it does not balance",
  after.saveDisabled === true);

// ============================================================================
console.log("\n=== the refusals reach the screen in words ===");
// The section 11.4 case: a free line among priced ones, spread by value.
await page.evaluate(() => window.harness.open({
  lines: [
    { productId: "a", quantity: "10", goodsCost: "1000", manual: "" },
    { productId: "b", quantity: "10", goodsCost: "0", manual: "" }
  ],
  costs: { freight: "500", importDuty: "", clearing: "", transport: "",
           handling: "", insurance: "", otherCost: "" },
  basis: "value"
}));
const freeLine = await page.evaluate(() => ({
  error: document.querySelector("#deliveryFormError").textContent.trim(),
  saveDisabled: document.querySelector("#saveDeliveryButton").disabled,
  preview: document.querySelector("#deliveryPreviewTable").textContent.trim()
}));
check("a line that would cost nothing is refused on screen",
  freeLine.error.includes("Product B"), `got "${freeLine.error}"`);
check("...the message says how to fix it",
  /quantity/i.test(freeLine.error), `got "${freeLine.error}"`);
check("...Record delivery is disabled", freeLine.saveDisabled === true);
check("...and the stale preview is cleared rather than left beside the error",
  !freeLine.preview.includes("Product A"), freeLine.preview.slice(0, 120));

// The same delivery by quantity is accepted -- the refusal is about the
// outcome, not about free goods being forbidden.
await page.evaluate(() => window.harness.setBasis("quantity"));
const byQty = await page.evaluate(() => ({
  error: document.querySelector("#deliveryFormError").textContent.trim(),
  saveDisabled: document.querySelector("#saveDeliveryButton").disabled,
  rows: document.querySelectorAll("#deliveryPreviewTable tr").length
}));
check("the same delivery spread by quantity is accepted", byQty.error === "", byQty.error);
check("...and shows both products plus a total", byQty.rows === 3, `got ${byQty.rows}`);
check("...with Record delivery enabled", byQty.saveDisabled === false);

// ============================================================================
console.log("\n=== the fallback is announced, not silent ===");
// Free goods with a freight bill: value cannot divide by zero, so the header
// will record `quantity`. A shop that asked for one basis and got another must
// not have to notice on its own.
await page.evaluate(() => window.harness.open({
  lines: [
    { productId: "a", quantity: "10", goodsCost: "0", manual: "" },
    { productId: "b", quantity: "30", goodsCost: "0", manual: "" }
  ],
  costs: { freight: "4000", importDuty: "", clearing: "", transport: "",
           handling: "", insurance: "", otherCost: "" },
  basis: "value"
}));
const fellBack = await page.evaluate(() => {
  const el = document.querySelector("#deliveryBasisFellBack");
  return { hidden: el.hidden, text: el.textContent.trim(),
           rows: [...document.querySelectorAll("#deliveryPreviewTable tr")]
             .map((tr) => [...tr.children].map((td) => td.textContent.trim())) };
});
check("the fallback notice is shown", fellBack.hidden === false);
check("...and explains why", /quantity/i.test(fellBack.text), fellBack.text);
check("10 of 40 units takes 1,000", fellBack.rows[0]?.[4] === "TZS 1,000.00", fellBack.rows[0]?.[4]);
check("30 of 40 units takes 3,000", fellBack.rows[1]?.[4] === "TZS 3,000.00", fellBack.rows[1]?.[4]);

// ============================================================================
console.log("\n=== it is legible, at a desk and on a phone ===");
await page.evaluate(() => window.harness.docx());
const layout = await page.evaluate(() => {
  const total = document.querySelector(".delivery-preview-total");
  const scroll = document.querySelector("#deliveryPreviewTable").closest(".table-scroll");
  return {
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    // Both read off a CELL. The rule is `.delivery-preview-total td`, and the
    // first version of this read fontWeight off the <tr> -- which inherits 400
    // and reported the styling as missing while it was applied correctly one
    // level down. The border passed only because it was already read from a td.
    totalWeight: getComputedStyle(total.querySelector("td")).fontWeight,
    totalBorder: getComputedStyle(total.querySelector("td")).borderTopWidth,
    scrollable: scroll ? getComputedStyle(scroll).overflowX : "none"
  };
});
check("the page does not scroll sideways at 1280px", layout.bodyOverflow <= 0,
  `overflow ${layout.bodyOverflow}px`);
check("the TOTAL row is set apart from the lines above it",
  Number(layout.totalWeight) >= 600 && parseFloat(layout.totalBorder) >= 2,
  `weight ${layout.totalWeight}, border ${layout.totalBorder}`);
check("the preview table scrolls inside its own container",
  layout.scrollable === "auto" || layout.scrollable === "scroll", layout.scrollable);

await page.setViewportSize({ width: 390, height: 844 });
const mobile = await page.evaluate(() => {
  const line = document.querySelector("#deliveryLines .delivery-line");
  return {
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    columns: getComputedStyle(line).gridTemplateColumns.split(" ").length,
    productSpansFullRow: getComputedStyle(line.querySelector("label")).gridColumnStart === "1"
  };
});
check("the page does not scroll sideways on a phone", mobile.bodyOverflow <= 0,
  `overflow ${mobile.bodyOverflow}px`);
check("a delivery line collapses to two columns on a phone", mobile.columns === 2,
  `got ${mobile.columns} columns`);

check("still no page errors after every interaction", consoleErrors.length === 0,
  consoleErrors.join("\n      "));


// ============================================================================
console.log("\n=== phase 5: landed costs shown inside Expenses, and kept apart ===");
// This panel is the one place in the app where delivery money appears on the
// expenses screen, and the whole design of it is a separation: the docx section
// 4 wants these costs VISIBLE for reporting while they are capitalised into
// stock, not charged as an expense. If a reader can mistake the panel for part
// of the expense total, the panel is worse than nothing -- it would have them
// count the freight twice and read their profit as lower than it is.
//
// That is a claim about what is on a screen, so it is checked on a screen.
await page.evaluate(() => window.harness.expenses());

const landed = await page.evaluate(() => {
  const panel = document.querySelector("#expenseLandedPanel");
  const rows = [...panel.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent.trim()));
  return {
    hidden: panel.hidden,
    rows,
    intro: panel.querySelector("p.muted")?.textContent.trim() || "",
    excluded: [...panel.querySelectorAll("p.muted")].pop()?.textContent.trim() || "",
    eyebrow: panel.querySelector(".eyebrow")?.textContent.trim() || "",
    // The expense tiles live in a DIFFERENT container entirely. Nothing about
    // the panel can reach them.
    insideExpenseTotals: !!document.querySelector("#expenseTotals #expenseLandedPanel")
  };
});

check("the landed panel is shown when there are landed costs", landed.hidden === false);
check("it is not inside the expense totals", landed.insideExpenseTotals === false);
check("it is labelled as not an expense", /not an expense/i.test(landed.eyebrow), landed.eyebrow);
check("the breakdown lists four cost types and a total", landed.rows.length === 5,
  JSON.stringify(landed.rows));

const wantLanded = [
  ["Freight", "TZS 800,000.00"],
  ["Import duty", "TZS 500,000.00"],
  ["Clearing charges", "TZS 300,000.00"],
  ["Transport", "TZS 200,000.00"],
  ["TOTAL CAPITALISED", "TZS 1,800,000.00"]
];
for (const [i, row] of wantLanded.entries()) {
  check(`landed row ${i + 1} reads ${row[0]}`,
    JSON.stringify(landed.rows[i]) === JSON.stringify(row),
    `got ${JSON.stringify(landed.rows[i])}`);
}

// The sentence that stops the double count. Without it the panel is a table of
// money on the expenses screen and nothing says it is not spending.
check("the panel says the total is NOT in the expense figures",
  /not included in the expense figures/i.test(landed.excluded), landed.excluded);
check("...and says why", /twice/i.test(landed.excluded), landed.excluded);
check("the intro says the money is held in stock",
  /value of your stock/i.test(landed.intro), landed.intro);

// A shop that has never recorded a landed cost should not meet a distinction it
// has not run into. An empty panel explaining one is noise.
await page.evaluate(() => window.harness.expenses([]));
const empty = await page.evaluate(() => ({
  hidden: document.querySelector("#expenseLandedPanel").hidden,
  body: document.querySelector("#expenseLandedBody").innerHTML
}));
check("the panel hides itself when there is nothing to show", empty.hidden === true);
check("...and empties, rather than leaving stale rows behind", empty.body === "");

// A delivery with goods but no additional costs is not a landed cost.
await page.evaluate(() => window.harness.expenses([
  { receivedAt: new Date(2026, 8, 4, 12, 0, 0), additionalTotal: 0, totalCost: 400000,
    freight: 0, importDuty: 0, clearing: 0, transport: 0, handling: 0, insurance: 0, otherCost: 0 }
]));
check("a delivery with no additional costs leaves the panel hidden",
  await page.evaluate(() => document.querySelector("#expenseLandedPanel").hidden) === true);


// ============================================================================
console.log("\n=== phase 6: the Profit Report, as the docx section 9 statement ===");
// The docx prints a statement, and a statement is a shape: six lines in one
// order, the deductions in brackets, and two subtotals set apart from the lines
// they sum. None of that is checkable by reading the source, and all of it is
// what tells an owner they are reading a profit statement rather than a
// dashboard.
await page.evaluate(() => window.harness.profit());

const statement = await page.evaluate(() =>
  [...document.querySelectorAll("#profitGrid table.statement tbody tr")].map((tr) => ({
    label: tr.querySelector("th").firstChild.textContent.trim(),
    note: tr.querySelector("th span")?.textContent.trim() || "",
    value: tr.querySelector("td").textContent.trim(),
    total: tr.classList.contains("statement-total")
  })));

check("the statement has exactly six lines", statement.length === 6,
  `got ${statement.length}: ${JSON.stringify(statement.map((r) => r.label))}`);

const wantStatement = [
  ["Sales revenue", "TZS 45,000,000.00", false],
  ["Cost of goods sold", "(TZS 27,000,000.00)", false],
  ["GROSS PROFIT", "TZS 18,000,000.00 · 40%", true],
  ["Direct operating expenses", "(TZS 2,000,000.00)", false],
  ["Indirect operating expenses", "(TZS 8,000,000.00)", false],
  ["NET PROFIT", "TZS 8,000,000.00", true]
];
for (const [i, [label, value, total]] of wantStatement.entries()) {
  check(`line ${i + 1} is "${label}"`, statement[i]?.label === label,
    `got "${statement[i]?.label}"`);
  check(`line ${i + 1} reads ${value}`, statement[i]?.value === value,
    `got "${statement[i]?.value}"`);
  check(`line ${i + 1} ${total ? "is" : "is not"} a subtotal`, statement[i]?.total === total);
}

// DESIGN-purchases.md 11 rule 1: gross and net are never summed into one
// headline. As rows they are two, each with its own caption.
check("gross profit carries its own caption", statement[2]?.note.length > 0, statement[2]?.note);
check("net profit carries its own caption", statement[5]?.note.length > 0, statement[5]?.note);
check("...and they say different things", statement[2]?.note !== statement[5]?.note);
check("net profit's caption says it depends on what was entered",
  /complete as what you entered/i.test(statement[5]?.note || ""), statement[5]?.note);

// Deductions are bracketed and totals are not -- the docx convention, and the
// only thing on screen saying which lines are subtracted.
check("only the three deduction lines are bracketed",
  statement.filter((r) => r.value.startsWith("(")).length === 3,
  JSON.stringify(statement.map((r) => r.value)));

const styling = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("#profitGrid table.statement tbody tr")];
  const gross = rows[2], net = rows[5];
  const line = rows[0];
  return {
    grossWeight: getComputedStyle(gross.querySelector("td")).fontWeight,
    lineWeight: getComputedStyle(line.querySelector("td")).fontWeight,
    grossBorder: parseFloat(getComputedStyle(gross.querySelector("td")).borderTopWidth),
    netBorder: parseFloat(getComputedStyle(net.querySelector("td")).borderTopWidth),
    lineBorder: parseFloat(getComputedStyle(line.querySelector("td")).borderTopWidth),
    numeric: getComputedStyle(line.querySelector("td")).fontVariantNumeric,
    align: getComputedStyle(line.querySelector("td")).textAlign,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  };
});
check("subtotals are heavier than the lines they sum",
  Number(styling.grossWeight) > Number(styling.lineWeight),
  `${styling.grossWeight} vs ${styling.lineWeight}`);
check("...and are ruled off above", styling.grossBorder >= 2 && styling.netBorder >= 2,
  `gross ${styling.grossBorder}, net ${styling.netBorder}`);
check("an ordinary line is not ruled off", styling.lineBorder < 2, `${styling.lineBorder}`);
check("figures are right-aligned", styling.align === "right", styling.align);
check("figures use tabular digits so the column lines up",
  /tabular-nums/.test(styling.numeric), styling.numeric);
check("the page does not scroll sideways", styling.overflow <= 0, `${styling.overflow}`);

// ============================================================================
console.log("\n=== a month with no recorded cost refuses three lines, not one ===");
await page.evaluate(() => window.harness.profitNoCost());
const noCost = await page.evaluate(() =>
  [...document.querySelectorAll("#profitGrid table.statement tbody tr")].map((tr) => ({
    label: tr.querySelector("th").firstChild.textContent.trim(),
    value: tr.querySelector("td").textContent.trim()
  })));
check("revenue is still stated", noCost[0]?.value.includes("100,000"), noCost[0]?.value);
check("cost of goods shows a dash", noCost[1]?.value === "—", noCost[1]?.value);
check("gross profit shows a dash", noCost[2]?.value === "—", noCost[2]?.value);
check("net profit shows a dash", noCost[5]?.value === "—", noCost[5]?.value);
// The expense lines are recorded facts, not derived ones, so they stay.
check("the indirect line is still stated", noCost[4]?.value.includes("10,000"), noCost[4]?.value);
check("no line reports a fabricated profit",
  !noCost.some((r) => /100,000\.00$/.test(r.value) && /PROFIT/.test(r.label)),
  JSON.stringify(noCost));

// ============================================================================
console.log("\n=== a month outside the loaded window refuses outright ===");
await page.evaluate(() => window.harness.profitOutsideWindow());
const refused = await page.evaluate(() => ({
  rows: document.querySelectorAll("#profitGrid table.statement tbody tr").length,
  html: document.querySelector("#profitGrid").innerHTML.trim(),
  note: document.querySelector("#profitNote").textContent.trim()
}));
check("no statement is printed at all", refused.rows === 0, `${refused.rows} rows`);
check("...and the container is emptied rather than left stale", refused.html === "", refused.html);
check("the reason is given", /older than the sales this device has loaded/i.test(refused.note),
  refused.note);


// ============================================================================
console.log("\n=== phase 7: the docx section 10 drill-down, on screen ===");
// The two middle columns are the reason DESIGN-landed-costs.md 3.1 kept
// goodsCost and landedCost on the purchase line. Rendering them is what shows
// the split actually reached a shop rather than a return value.
await page.evaluate(() => window.harness.drill());

const drill = await page.evaluate(() => ({
  hidden: document.querySelector("#profitProductPanel").hidden,
  rows: [...document.querySelectorAll("#profitProductTable tr")].map((tr) =>
    [...tr.children].map((td) => td.textContent.trim())),
  note: document.querySelector("#profitProductNote").textContent.trim(),
  headers: [...document.querySelectorAll("#profitProductPanel thead th")].map((th) => th.textContent.trim())
}));

check("the drill-down is shown", drill.hidden === false);
check("it has a row per product and a total", drill.rows.length === 2,
  `got ${drill.rows.length}: ${JSON.stringify(drill.rows)}`);
check("the columns are the docx section 10 columns",
  JSON.stringify(drill.headers) === JSON.stringify(["Product", "Units sold", "Average cost",
    "Cost of sales", "of which goods", "of which landed", "Revenue", "Gross profit", "Margin"]),
  JSON.stringify(drill.headers));

const want = ["Product A", "100", "TZS 11,800.00", "TZS 1,180,000.00",
              "TZS 1,000,000.00", "TZS 180,000.00", "TZS 1,500,000.00",
              "TZS 320,000.00", "21%"];
check("Product A's row matches the docx section 7 sale",
  JSON.stringify(drill.rows[0]) === JSON.stringify(want),
  `got ${JSON.stringify(drill.rows[0])} want ${JSON.stringify(want)}`);
// 100 units carried 1,800 of freight, duty and clearing each -- the docx section
// 6 allocation, followed all the way through to a sale.
check("the landed column is 100 units at 1,800", drill.rows[0][5] === "TZS 180,000.00",
  drill.rows[0][5]);
check("goods + landed add back to cost of sales",
  drill.rows[0][4] === "TZS 1,000,000.00" && drill.rows[0][3] === "TZS 1,180,000.00");
check("the attribution is disclosed rather than implied",
  /attribution, not a separate measurement/i.test(drill.note), drill.note);

// A month the statement refuses must not show a confident product breakdown of
// the same unloaded window.
await page.evaluate(() => window.harness.profitOutsideWindow());
check("a refused month hides the drill-down too",
  await page.evaluate(() => document.querySelector("#profitProductPanel").hidden) === true);
check("...and empties it", await page.evaluate(() =>
  document.querySelector("#profitProductTable").innerHTML) === "");


// ============================================================================
console.log("\n=== staff roles against the new screens ===");
// The rules suite proves what the SERVER refuses. This proves what the CLIENT
// does about it, which is a different question and the one a shop actually
// sees: a screen that is merely hidden by CSS while its figures sit in the DOM
// has not protected anything, and a listener that subscribes for a cashier puts
// a permission-denied in the console on every sign-in.
//
// Both role helpers read one string -- state.currentUserRole -- so the REAL
// functions are used here, not stubs of them.

const roleCases = [
  // view,        owner, manager, cashier
  ["dashboard",   true,  true,  false],
  ["inventory",   true,  true,  false],
  ["pos",         true,  true,  true ],
  ["deliveries",  true,  true,  false],
  ["purchases",   true,  true,  false],
  ["expenses",    true,  true,  false],
  // Owner-strict: the Profit Report exposes buying prices by inference, and the
  // per-product drill-down names one against a selling price outright.
  ["profit",      true,  false, false],
  ["reports",     true,  true,  false]
];
for (const [view, o, m, c] of roleCases) {
  for (const [role, want] of [["owner", o], ["manager", m], ["cashier", c]]) {
    const got = await page.evaluate(([v, r]) => {
      state.currentUserRole = r;
      return canOpenView(v);
    }, [view, role]);
    check(`${role} ${want ? "may" : "may NOT"} open ${view}`, got === want, `got ${got}`);
  }
}

console.log("\n=== a wrong role EMPTIES the screen, it does not just hide it ===");
// The rule every money surface in app.js follows: emptied, not merely skipped.
// A demoted manager must not keep a screenful of buying prices in the DOM.
{
  // Deliveries: manager may, cashier may not.
  const asManager = await page.evaluate(() => {
    state.currentUserRole = "manager";
    deliveriesFixture = [{ id: "d1", storeId: "s1", reference: "INV-1", supplierName: "Festive Ltd",
      receivedAt: new Date(2026, 8, 3, 12, 0, 0), goodsCost: 10000000, additionalTotal: 1800000,
      totalCost: 11800000, allocationBasis: "value", lineCount: 3 }];
    state.deliveryMonthTouched = true; state.deliveryMonthSelection = "2026-09";
    renderDeliveries();
    return { rows: document.querySelector("#deliveriesTable").innerHTML.length,
             tiles: document.querySelector("#deliveryTotals").innerHTML.length,
             showsSupplier: /Festive Ltd/.test(document.querySelector("#deliveriesTable").innerHTML) };
  });
  check("a manager sees the deliveries list", asManager.rows > 0 && asManager.showsSupplier);
  check("...and its totals", asManager.tiles > 0);

  const asCashier = await page.evaluate(() => {
    state.currentUserRole = "cashier";
    renderDeliveries();
    return { rows: document.querySelector("#deliveriesTable").innerHTML,
             tiles: document.querySelector("#deliveryTotals").innerHTML };
  });
  check("a cashier's deliveries table is EMPTIED", asCashier.rows === "", asCashier.rows.slice(0, 80));
  check("...and so are its totals", asCashier.tiles === "", asCashier.tiles.slice(0, 80));
  check("...leaving no supplier or amount in the DOM",
    !/Festive|11,800,000/.test(asCashier.rows + asCashier.tiles));
}

{
  // The Profit Report is owner-strict, so a MANAGER is the interesting case --
  // not a cashier. A manager legitimately sees revenue, shift variance and staff
  // performance; what they must not see is cost against price, per product.
  const asOwner = await page.evaluate(() => {
    state.currentUserRole = "owner";
    window.harness.drill();
    return { statementRows: document.querySelectorAll("#profitGrid table.statement tbody tr").length,
             drillHidden: document.querySelector("#profitProductPanel").hidden,
             drillHtml: document.querySelector("#profitProductTable").innerHTML.length };
  });
  check("an owner sees the statement", asOwner.statementRows === 6);
  check("...and the per-product drill-down", asOwner.drillHidden === false && asOwner.drillHtml > 0);

  const asManager = await page.evaluate(() => {
    state.currentUserRole = "manager";
    renderProfit();
    return { statement: document.querySelector("#profitGrid").innerHTML,
             note: document.querySelector("#profitNote").textContent,
             drillHidden: document.querySelector("#profitProductPanel").hidden,
             drillHtml: document.querySelector("#profitProductTable").innerHTML };
  });
  check("a manager's statement is EMPTIED", asManager.statement === "", asManager.statement.slice(0, 80));
  check("...and its note cleared", asManager.note === "", asManager.note.slice(0, 80));
  check("...the drill-down panel is hidden", asManager.drillHidden === true);
  check("...and the drill-down table EMPTIED, not merely hidden",
    asManager.drillHtml === "", asManager.drillHtml.slice(0, 80));
  check("...leaving no buying price in the DOM",
    !/11,800|1,180,000/.test(asManager.statement + asManager.drillHtml));
}

{
  // The three phase 7 reports: manager and owner, cashier never.
  const asManager = await page.evaluate(() => {
    state.currentUserRole = "manager";
    state.reportsCostMonth = "2026-09";
    renderCostReports();
    return { hidden: document.querySelector("#costReportsPanel").hidden,
             valuation: document.querySelector("#stockValuationTable").innerHTML.length,
             supplier: document.querySelector("#supplierReportTable").innerHTML.length };
  });
  check("a manager sees the cost reports panel", asManager.hidden === false);
  check("...with a stock valuation", asManager.valuation > 0);

  const asCashier = await page.evaluate(() => {
    state.currentUserRole = "cashier";
    renderCostReports();
    return { hidden: document.querySelector("#costReportsPanel").hidden,
             valuation: document.querySelector("#stockValuationTable").innerHTML,
             supplier: document.querySelector("#supplierReportTable").innerHTML,
             nature: document.querySelector("#expenseNatureTable").innerHTML };
  });
  check("a cashier's cost reports panel is hidden", asCashier.hidden === true);
  check("...its stock valuation EMPTIED", asCashier.valuation === "", asCashier.valuation.slice(0, 80));
  check("...its supplier report EMPTIED", asCashier.supplier === "", asCashier.supplier.slice(0, 80));
  check("...its expense breakdown EMPTIED", asCashier.nature === "", asCashier.nature.slice(0, 80));
}

// Restore, so anything after this runs as the owner again.
await page.evaluate(() => { state.currentUserRole = "owner"; });

await browser.close();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
