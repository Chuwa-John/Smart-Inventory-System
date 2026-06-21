import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";

const demoProducts = [
  {
    id: "pvc-001",
    name: "PVC Pipe 1 inch",
    sku: "PVC-1IN-001",
    barcode: "600100000001",
    category: "PVC Pipes",
    brand: "FlowMax",
    supplier: "AquaLine Distributors",
    description: "Class C pressure pipe, 6 meter length.",
    costPrice: 520,
    sellingPrice: 760,
    quantity: 12,
    reorderLevel: 20,
    warehouse: "Main Warehouse",
    shelf: "A1-03",
    sold30: 88,
    sold90: 240,
    leadTimeDays: 7
  },
  {
    id: "ppr-075",
    name: "PPR Pipe 3/4 inch",
    sku: "PPR-075-014",
    barcode: "600100000014",
    category: "PPR Pipes",
    brand: "ThermoFit",
    supplier: "Prime Plumbing Imports",
    description: "Hot and cold water PPR pipe.",
    costPrice: 430,
    sellingPrice: 690,
    quantity: 56,
    reorderLevel: 25,
    warehouse: "Main Warehouse",
    shelf: "B2-01",
    sold30: 102,
    sold90: 308,
    leadTimeDays: 10
  },
  {
    id: "valve-012",
    name: "Brass Ball Valve 1/2 inch",
    sku: "VAL-BR-012",
    barcode: "600100000212",
    category: "Valves",
    brand: "ValvePro",
    supplier: "AquaLine Distributors",
    description: "Full bore brass valve.",
    costPrice: 350,
    sellingPrice: 590,
    quantity: 0,
    reorderLevel: 15,
    warehouse: "Main Warehouse",
    shelf: "C4-08",
    sold30: 61,
    sold90: 188,
    leadTimeDays: 5
  },
  {
    id: "tank-500",
    name: "Water Tank 500L",
    sku: "TNK-500-001",
    barcode: "600100000500",
    category: "Water Tanks",
    brand: "Kentank",
    supplier: "TankWorld Kenya",
    description: "Food grade vertical water tank.",
    costPrice: 6200,
    sellingPrice: 8750,
    quantity: 8,
    reorderLevel: 5,
    warehouse: "Yard",
    shelf: "Outdoor-2",
    sold30: 12,
    sold90: 32,
    leadTimeDays: 14
  },
  {
    id: "tap-004",
    name: "Chrome Basin Mixer",
    sku: "TAP-MIX-004",
    barcode: "600100000604",
    category: "Taps and Mixers",
    brand: "CasaLux",
    supplier: "Prime Plumbing Imports",
    description: "Single lever basin mixer.",
    costPrice: 1450,
    sellingPrice: 2380,
    quantity: 22,
    reorderLevel: 12,
    warehouse: "Showroom",
    shelf: "D1-05",
    sold30: 18,
    sold90: 53,
    leadTimeDays: 21
  },
  {
    id: "toilet-eco",
    name: "Dual Flush Toilet Set",
    sku: "SAN-WC-ECO",
    barcode: "600100000704",
    category: "Toilets",
    brand: "PureBath",
    supplier: "Sanitary Hub",
    description: "Close coupled ceramic toilet with dual flush.",
    costPrice: 6400,
    sellingPrice: 9950,
    quantity: 3,
    reorderLevel: 6,
    warehouse: "Showroom",
    shelf: "Display-1",
    sold30: 4,
    sold90: 17,
    leadTimeDays: 15
  },
  {
    id: "pump-075",
    name: "Peripheral Water Pump 0.75HP",
    sku: "PMP-PER-075",
    barcode: "600100000904",
    category: "Water Pumps",
    brand: "HydroLift",
    supplier: "PumpTech Supplies",
    description: "Domestic pressure boosting pump.",
    costPrice: 5200,
    sellingPrice: 7850,
    quantity: 14,
    reorderLevel: 8,
    warehouse: "Main Warehouse",
    shelf: "E2-07",
    sold30: 20,
    sold90: 49,
    leadTimeDays: 9
  },
  {
    id: "sink-900",
    name: "Stainless Kitchen Sink 900mm",
    sku: "SNK-SS-900",
    barcode: "600100000804",
    category: "Sinks",
    brand: "CasaLux",
    supplier: "Sanitary Hub",
    description: "Double bowl stainless steel sink.",
    costPrice: 3100,
    sellingPrice: 4950,
    quantity: 17,
    reorderLevel: 10,
    warehouse: "Showroom",
    shelf: "D4-02",
    sold30: 8,
    sold90: 29,
    leadTimeDays: 12
  }
];

const demoSuppliers = [
  { name: "AquaLine Distributors", contact: "+254 700 010 100", terms: "Net 30", delivery: 6, reliability: 94, spend: 284000 },
  { name: "Prime Plumbing Imports", contact: "+254 711 232 900", terms: "Net 45", delivery: 14, reliability: 88, spend: 361000 },
  { name: "Sanitary Hub", contact: "+254 733 900 111", terms: "COD", delivery: 9, reliability: 91, spend: 197000 },
  { name: "PumpTech Supplies", contact: "+254 722 560 909", terms: "Net 14", delivery: 7, reliability: 96, spend: 122000 }
];

const demoCustomers = [
  { name: "Mwangi Construction Ltd", type: "Construction Company", balance: 48500, limit: 150000, purchases: 38 },
  { name: "BuildRight Contractors", type: "Contractor", balance: 0, limit: 80000, purchases: 21 },
  { name: "Kileleshwa Hardware", type: "Hardware Retailer", balance: 12600, limit: 60000, purchases: 44 },
  { name: "Walk-In Customers", type: "Retail", balance: 0, limit: 0, purchases: 312 }
];

const demoPurchases = [
  { po: "PO-1042", supplier: "AquaLine Distributors", status: "Awaiting delivery", expected: "2026-06-27", total: 87400 },
  { po: "PO-1043", supplier: "Prime Plumbing Imports", status: "Pending approval", expected: "2026-07-05", total: 146900 },
  { po: "PO-1044", supplier: "PumpTech Supplies", status: "Partially received", expected: "2026-06-24", total: 62800 }
];

const state = {
  products: [...demoProducts],
  cart: [],
  sortKey: "name",
  sortDirection: 1,
  authMode: "signup",
  firebaseReady: false,
  db: null,
  auth: null,
  user: null,
  unsubscribeProducts: null,
  pendingBusinessName: ""
};

const currency = new Intl.NumberFormat("en-KE", {
  style: "currency",
  currency: "KES",
  maximumFractionDigits: 0
});

const qs = (selector) => document.querySelector(selector);
const qsa = (selector) => [...document.querySelectorAll(selector)];

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return currency.format(value);
}

function stockStatus(product) {
  if (product.quantity <= 0) return "out";
  if (product.quantity <= product.reorderLevel) return "low";
  return "healthy";
}

function calculateMetrics() {
  const inventoryValue = state.products.reduce((sum, item) => sum + item.costPrice * item.quantity, 0);
  const potentialRevenue = state.products.reduce((sum, item) => sum + item.sellingPrice * Math.min(item.quantity, item.sold30), 0);
  const grossProfit = state.products.reduce((sum, item) => sum + (item.sellingPrice - item.costPrice) * item.sold30, 0);
  const lowStock = state.products.filter((item) => stockStatus(item) === "low").length;
  const out = state.products.filter((item) => stockStatus(item) === "out").length;

  return {
    todaySales: potentialRevenue / 30,
    weeklyRevenue: potentialRevenue / 4.2,
    monthlyRevenue: potentialRevenue,
    grossProfit,
    netProfit: grossProfit * 0.72,
    inventoryValue,
    totalProducts: state.products.length,
    lowStock,
    out,
    pendingPO: state.user ? 0 : demoPurchases.length
  };
}

function renderKpis() {
  const metrics = calculateMetrics();
  const cards = [
    ["Today's Sales", money(metrics.todaySales), "+8.4%"],
    ["Weekly Revenue", money(metrics.weeklyRevenue), "+12.1%"],
    ["Monthly Revenue", money(metrics.monthlyRevenue), "+18.7%"],
    ["Gross Profit", money(metrics.grossProfit), "+9.3%"],
    ["Net Profit", money(metrics.netProfit), "+7.9%"],
    ["Inventory Value", money(metrics.inventoryValue), "Live"],
    ["Total Products", metrics.totalProducts, "Across branches"],
    ["Low Stock Items", metrics.lowStock, "Reorder now"],
    ["Out of Stock Items", metrics.out, "Urgent"],
    ["Pending Purchase Orders", metrics.pendingPO, "Procurement"]
  ];

  qs("#kpiGrid").innerHTML = cards
    .map(([label, value, delta]) => `<div class="kpi-card"><span class="muted">${label}</span><strong>${value}</strong><span class="delta">${delta}</span></div>`)
    .join("");
}

function renderChart() {
  const canvas = qs("#salesChart");
  const ctx = canvas.getContext("2d");
  const range = qs("#chartRange").value;
  const dataSets = {
    daily: [42, 58, 49, 72, 91, 84, 110, 97, 121, 132, 118, 146],
    weekly: [260, 330, 305, 390, 418, 472, 510, 536, 590, 628, 642, 710],
    monthly: [1180, 1410, 1320, 1650, 1840, 2010, 2250, 2380, 2520, 2740, 2910, 3180]
  };
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const data = dataSets[range];
  const width = canvas.width;
  const height = canvas.height;
  const pad = 44;
  const max = Math.max(...data) * 1.18;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--line");
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const y = pad + ((height - pad * 2) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  const points = data.map((value, index) => ({
    x: pad + ((width - pad * 2) / (data.length - 1)) * index,
    y: height - pad - (value / max) * (height - pad * 2)
  }));

  const gradient = ctx.createLinearGradient(0, pad, 0, height - pad);
  gradient.addColorStop(0, "rgba(70, 194, 161, 0.35)");
  gradient.addColorStop(1, "rgba(106, 167, 255, 0.02)");

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - pad);
  points.forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.lineTo(points[points.length - 1].x, height - pad);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = "#46c2a1";
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
  ctx.font = "13px Inter, sans-serif";
  labels.forEach((label, index) => {
    ctx.fillText(label, points[index].x - 10, height - 14);
  });
}

function reorderRecommendation(product) {
  const dailyDemand = product.sold90 / 90;
  const safetyStock = Math.ceil(dailyDemand * 7);
  const expectedDemandDuringLeadTime = Math.ceil(dailyDemand * product.leadTimeDays);
  const targetStock = product.reorderLevel + expectedDemandDuringLeadTime + safetyStock;
  const recommendedQty = Math.max(0, targetStock - product.quantity);
  const daysUntilStockout = product.quantity === 0 ? 0 : Math.floor(product.quantity / Math.max(dailyDemand, 0.1));
  return { recommendedQty, daysUntilStockout, expectedDemandDuringLeadTime };
}

function renderAlertsAndRecommendations() {
  const risky = state.products.filter((product) => stockStatus(product) !== "healthy");
  qs("#alertCount").textContent = risky.length;
  qs("#alertList").innerHTML = risky
    .map((product) => {
      const status = stockStatus(product);
      return `<div class="alert-item ${status === "out" ? "red" : "amber"}">
        <strong>${product.name}</strong>
        <span class="muted">${status === "out" ? "Out of stock" : `Below minimum stock. Current stock: ${product.quantity}, minimum: ${product.reorderLevel}.`}</span>
      </div>`;
    })
    .join("") || `<div class="alert-item"><strong>All clear</strong><span class="muted">No low stock or out-of-stock products.</span></div>`;

  const recs = state.products
    .map((product) => ({ product, rec: reorderRecommendation(product) }))
    .filter(({ rec }) => rec.recommendedQty > 0)
    .sort((a, b) => a.rec.daysUntilStockout - b.rec.daysUntilStockout)
    .slice(0, 4);

  qs("#recommendationList").innerHTML = recs
    .map(({ product, rec }) => `<div class="recommendation">
      <strong>${product.name}</strong>
      <span>Reorder ${rec.recommendedQty} units now.</span>
      <small class="muted">Estimated stockout in ${rec.daysUntilStockout} days. Lead time: ${product.leadTimeDays} days.</small>
    </div>`)
    .join("");
}

function renderMovement() {
  const classes = [
    ["Fast-moving products", state.products.filter((p) => p.sold30 >= 50).length, "#5ed08f"],
    ["Slow-moving products", state.products.filter((p) => p.sold30 > 0 && p.sold30 < 12).length, "#f1b44c"],
    ["Dead stock products", state.products.filter((p) => p.sold90 === 0).length, "#ef6666"],
    ["Healthy stock coverage", state.products.filter((p) => stockStatus(p) === "healthy").length, "#6aa7ff"]
  ];
  qs("#movementList").innerHTML = classes
    .map(([label, value, color]) => `<div class="movement-row"><strong style="color:${color}">${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderFilters() {
  const selectedCategory = qs("#categoryFilter")?.value || "all";
  const categories = ["all", ...new Set(state.products.map((product) => product.category))];
  qs("#categoryFilter").innerHTML = categories.map((category) => `<option value="${category}">${category === "all" ? "All categories" : category}</option>`).join("");
  qs("#categoryFilter").value = categories.includes(selectedCategory) ? selectedCategory : "all";
}

function filteredProducts() {
  const term = qs("#globalSearch").value.trim().toLowerCase();
  const category = qs("#categoryFilter")?.value || "all";
  const stock = qs("#stockFilter")?.value || "all";
  return state.products
    .filter((product) => {
      const haystack = [product.name, product.sku, product.category, product.brand, product.supplier].join(" ").toLowerCase();
      return !term || haystack.includes(term);
    })
    .filter((product) => category === "all" || product.category === category)
    .filter((product) => stock === "all" || stockStatus(product) === stock)
    .sort((a, b) => {
      const left = a[state.sortKey];
      const right = b[state.sortKey];
      if (typeof left === "number") return (left - right) * state.sortDirection;
      return String(left).localeCompare(String(right)) * state.sortDirection;
    });
}

function renderInventory() {
  const products = filteredProducts();
  qs("#inventoryTable").innerHTML = products
    .map((product) => {
      const status = stockStatus(product);
      const label = status === "out" ? "Out of stock" : status === "low" ? "Low stock" : "Healthy";
      return `<tr>
        <td><strong>${esc(product.name)}</strong><br><small>${esc(product.brand)} - ${esc(product.shelf)}</small></td>
        <td>${esc(product.category)}</td>
        <td>${esc(product.sku)}</td>
        <td>${product.quantity}</td>
        <td>${product.reorderLevel}</td>
        <td>${money(product.sellingPrice)}</td>
        <td><span class="status ${status}">${label}</span></td>
        <td class="table-actions">
          <button class="ghost-button compact" data-edit-product="${product.id}">Edit</button>
          <button class="ghost-button compact danger" data-delete-product="${product.id}">Delete</button>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="8" class="empty-state">No inventory yet. Add your first material or product to start tracking stock.</td></tr>`;
}

function renderPos() {
  const term = qs("#posSearch").value.trim().toLowerCase();
  const products = state.products.filter((product) => !term || [product.name, product.sku, product.barcode].join(" ").toLowerCase().includes(term));
  qs("#posProducts").innerHTML = products
    .slice(0, 8)
    .map((product) => `<button class="pos-product" data-add-cart="${product.id}">
      <strong>${esc(product.name)}</strong>
      <span class="muted">${esc(product.sku)} - ${money(product.sellingPrice)} - ${product.quantity} available</span>
    </button>`)
    .join("");

  qs("#cartCount").textContent = state.cart.reduce((sum, item) => sum + item.qty, 0);
  qs("#cartItems").innerHTML = state.cart
    .map((item) => `<div class="cart-item"><strong>${esc(item.name)}</strong><span class="muted">${item.qty} x ${money(item.sellingPrice)}</span></div>`)
    .join("") || `<span class="muted">No items in cart.</span>`;
  qs("#cartTotal").textContent = money(state.cart.reduce((sum, item) => sum + item.qty * item.sellingPrice, 0));
}

function renderPurchasing() {
  qs("#purchaseTable").innerHTML = demoPurchases
    .map((po) => `<tr><td>${po.po}</td><td>${po.supplier}</td><td>${po.status}</td><td>${po.expected}</td><td>${money(po.total)}</td></tr>`)
    .join("");
}

function renderCards() {
  qs("#supplierCards").innerHTML = demoSuppliers
    .map((supplier) => `<article class="entity-card">
      <strong>${supplier.name}</strong>
      <span class="muted">${supplier.contact} - ${supplier.terms}</span>
      <span>Avg delivery: ${supplier.delivery} days</span>
      <span>Reliability score: ${supplier.reliability}%</span>
      <span>Purchase spend: ${money(supplier.spend)}</span>
    </article>`)
    .join("");

  qs("#customerCards").innerHTML = demoCustomers
    .map((customer) => `<article class="entity-card">
      <strong>${customer.name}</strong>
      <span class="muted">${customer.type}</span>
      <span>Outstanding: ${money(customer.balance)}</span>
      <span>Credit limit: ${money(customer.limit)}</span>
      <span>Purchases: ${customer.purchases}</span>
    </article>`)
    .join("");

  const reports = ["Sales Report", "Profit Report", "Inventory Valuation", "Supplier Scorecard", "Customer Balances", "Branch Performance", "Tax Summary", "Dead Stock Report"];
  qs("#reportGrid").innerHTML = reports.map((report) => `<article class="report-card"><strong>${report}</strong><span class="muted">Export PDF, Excel, or CSV</span><button class="ghost-button">Generate</button></article>`).join("");

  const zones = ["Main Warehouse - Racks A-E", "Showroom - Displays D1-D5", "Yard - Tanks and HDPE", "Branch 2 - Retail Store"];
  qs("#warehouseMap").innerHTML = zones.map((zone, index) => `<div class="warehouse-zone"><strong>${zone}</strong><p class="muted">${24 + index * 11} bins tracked with movement history.</p></div>`).join("");
}

function localAiAnswer(question) {
  const low = state.products.filter((product) => stockStatus(product) !== "healthy");
  const marginLeaders = [...state.products].sort((a, b) => b.sold30 * (b.sellingPrice - b.costPrice) - a.sold30 * (a.sellingPrice - a.costPrice)).slice(0, 3);
  const recs = low.map((product) => ({ product, rec: reorderRecommendation(product) }));

  return `<p><strong>Local recommendation:</strong> ${question || "Focus this week on stock availability and gross margin."}</p>
  <ul>
    <li>Urgent reorder: ${recs.map(({ product, rec }) => `${product.name} (${rec.recommendedQty} units)`).join(", ") || "none"}.</li>
    <li>Top profit products: ${marginLeaders.map((product) => product.name).join(", ")}.</li>
    <li>Supplier watch: Prime Plumbing Imports has the longest lead time, so order earlier for imported fittings and mixers.</li>
  </ul>
  <p class="muted">Spark-plan mode is active. This advisor uses local inventory math; Anthropic needs a separate secure backend or a temporary browser key mode later.</p>`;
}

async function askAi() {
  const question = qs("#aiQuestion").value.trim();
  qs("#aiAnswer").innerHTML = "<p>Analyzing inventory, sales velocity, and supplier lead times...</p>";

  if (aiConfig.proxyUrl) {
    try {
      const token = state.user ? await state.user.getIdToken() : null;
      const response = await fetch(aiConfig.proxyUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          question,
          snapshot: {
            products: state.products,
            suppliers: demoSuppliers,
            purchases: demoPurchases,
            metrics: calculateMetrics()
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "AI proxy request failed.");
      }
      qs("#aiMode").textContent = "Claude";
      qs("#aiAnswer").innerHTML = `<p>${String(payload.answer).replaceAll("\n", "<br>")}</p>`;
      return;
    } catch (error) {
      console.warn(error);
      showToast("AI proxy unavailable. Showing local recommendation.");
    }
  }

  qs("#aiMode").textContent = "Local";
  qs("#aiAnswer").innerHTML = localAiAnswer(question);
}

function showToast(message) {
  const toast = qs("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function exportCsv() {
  const headers = ["name", "sku", "barcode", "category", "brand", "supplier", "costPrice", "sellingPrice", "quantity", "reorderLevel", "warehouse", "shelf"];
  const rows = state.products.map((product) => headers.map((header) => JSON.stringify(product[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sanitaryflow-inventory.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function productCollectionPath() {
  if (!state.db || !state.user) return null;
  return ["users", state.user.uid, "products"];
}

function openProductDialog(product = null) {
  const form = qs("#productForm");
  form.reset();
  qs("#productDialogTitle").textContent = product ? "Edit Inventory Product" : "Add Inventory Product";
  form.elements.id.value = product?.id || "";
  if (product) {
    Object.entries(product).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value ?? "";
    });
  }
  qs("#productDialog").showModal();
}

async function saveProduct(product) {
  const existing = product.id ? state.products.find((item) => item.id === product.id) : null;
  product.id = product.id || crypto.randomUUID();
  product.sold30 = Number(existing?.sold30 ?? product.sold30 ?? 0);
  product.sold90 = Number(existing?.sold90 ?? product.sold90 ?? 0);
  product.leadTimeDays = Number(existing?.leadTimeDays ?? product.leadTimeDays ?? 10);

  const localProduct = { ...existing, ...product };
  state.products = existing
    ? state.products.map((item) => (item.id === product.id ? localProduct : item))
    : [...state.products, localProduct];

  if (state.db && state.user) {
    try {
      const { collection, doc, serverTimestamp, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
      const [root, uid, child] = productCollectionPath();
      await setDoc(
        doc(collection(state.db, root, uid, child), product.id),
        {
          ...product,
          createdAt: existing?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      console.warn(error);
      showToast("Saved locally. Firestore write failed.");
    }
  }

  renderAll();
  showToast(`${product.name} saved to inventory.`);
}

async function deleteProduct(productId) {
  const product = state.products.find((item) => item.id === productId);
  if (!product) return;
  if (!window.confirm(`Delete ${product.name} from inventory?`)) return;

  state.products = state.products.filter((item) => item.id !== productId);
  state.cart = state.cart.filter((item) => item.id !== productId);
  if (state.db && state.user) {
    try {
      const { deleteDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
      await deleteDoc(doc(state.db, "users", state.user.uid, "products", productId));
    } catch (error) {
      console.warn(error);
      showToast("Deleted locally. Firestore delete failed.");
    }
  }
  renderAll();
  showToast(`${product.name} deleted.`);
}

async function initFirebase() {
  const hasConfig = firebaseConfig && !String(firebaseConfig.apiKey || "").startsWith("YOUR_");
  if (!hasConfig) return;

  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const { getAnalytics, isSupported } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-analytics.js");
    const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    const app = initializeApp(firebaseConfig);
    if (firebaseConfig.measurementId && (await isSupported())) {
      getAnalytics(app);
    }
    state.auth = getAuth(app);
    state.db = getFirestore(app);
    state.firebaseReady = true;
    qs(".status-dot").classList.add("connected");
    qs("#connectionLabel").textContent = "Firebase connected";
    qs("#connectionHint").textContent = "Create an account to begin";

    onAuthStateChanged(state.auth, async (user) => {
      state.user = user;
      updateAuthUi();
      if (user) {
        await ensureUserProfile(user);
        state.pendingBusinessName = "";
        subscribeToProducts();
      } else {
        if (state.unsubscribeProducts) state.unsubscribeProducts();
        state.unsubscribeProducts = null;
        state.products = [];
        state.cart = [];
        renderAll();
      }
    });
  } catch (error) {
    console.warn(error);
    showToast("Firebase config found, but connection failed.");
  }
}

async function subscribeToProducts() {
  if (!state.db || !state.user) return;
  if (state.unsubscribeProducts) state.unsubscribeProducts();
  try {
    const { collection, onSnapshot } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    state.unsubscribeProducts = onSnapshot(collection(state.db, "users", state.user.uid, "products"), (snapshot) => {
      state.products = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
      renderAll();
    });
  } catch (error) {
    console.warn(error);
    showToast("Could not load your inventory.");
  }
}

async function ensureUserProfile(user) {
  if (!state.db) return;
  try {
    const { doc, serverTimestamp, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    await setDoc(doc(state.db, "users", user.uid), {
      uid: user.uid,
      email: user.email || "",
      businessName: state.pendingBusinessName || user.displayName || "",
      role: "Owner",
      authProvider: "password",
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.warn(error);
  }
}

function updateAuthUi() {
  const signedIn = Boolean(state.user);
  qs("#authGate").classList.toggle("hidden", signedIn);
  qs("#accountChip").hidden = !signedIn;
  qs("#userEmail").textContent = state.user?.email || "Signed in";
  qs("#connectionHint").textContent = signedIn ? "Your inventory is syncing" : "Sign in to sync inventory";
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isSignup = mode === "signup";
  qs("#authSubmitButton").textContent = isSignup ? "Create account" : "Sign in";
  qs("#authModeButton").textContent = isSignup ? "I already have an account" : "Create a new account";
  qs("#businessName").closest("label").hidden = !isSignup;
  qs("#authPassword").autocomplete = isSignup ? "new-password" : "current-password";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.auth) return showToast("Firebase is not connected yet.");
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const businessName = String(form.get("businessName") || "").trim();

  try {
    const authApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    if (state.authMode === "signup") {
      state.pendingBusinessName = businessName;
      const credential = await authApi.createUserWithEmailAndPassword(state.auth, email, password);
      if (businessName) await authApi.updateProfile(credential.user, { displayName: businessName });
      showToast("Account created. Add your first inventory item.");
    } else {
      state.pendingBusinessName = "";
      await authApi.signInWithEmailAndPassword(state.auth, email, password);
      showToast("Signed in.");
    }
  } catch (error) {
    console.warn(error);
    const messages = {
      "auth/email-already-in-use": "That email already has an account. Sign in instead.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/weak-password": "Use a password with at least 6 characters.",
      "auth/operation-not-allowed": "Enable Email/Password sign-in in Firebase Auth."
    };
    showToast(messages[error.code] || "Authentication failed. Check your details and try again.");
  }
}

function openView(viewId) {
  qsa(".view").forEach((view) => view.classList.toggle("active", view.id === viewId));
  qsa(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === viewId));
  qs(".sidebar").classList.remove("open");
}

function renderCommands(term = "") {
  const commands = [
    ["dashboard", "Open Dashboard"],
    ["inventory", "Open Inventory"],
    ["pos", "Open Point of Sale"],
    ["purchasing", "Open Purchasing"],
    ["suppliers", "Open Suppliers"],
    ["customers", "Open Customers"],
    ["warehouse", "Open Warehouse"],
    ["reports", "Open Reports"],
    ["ai", "Open AI Advisor"]
  ].filter(([, label]) => label.toLowerCase().includes(term.toLowerCase()));

  qs("#commandResults").innerHTML = commands
    .map(([view, label]) => `<div class="command-result" data-command-view="${view}">${label}</div>`)
    .join("");
}

function renderAll() {
  renderFilters();
  renderKpis();
  renderChart();
  renderAlertsAndRecommendations();
  renderMovement();
  renderInventory();
  renderPos();
  renderPurchasing();
  renderCards();
}

function bindEvents() {
  qsa(".nav-item").forEach((button) => button.addEventListener("click", () => openView(button.dataset.view)));
  qs("#mobileMenuButton").addEventListener("click", () => qs(".sidebar").classList.toggle("open"));
  qs("#themeButton").addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "" : "light";
    document.documentElement.dataset.theme = nextTheme;
    qs("#themeButton").textContent = nextTheme === "light" ? "Dark" : "Light";
    renderChart();
  });
  qs("#chartRange").addEventListener("change", renderChart);
  qs("#globalSearch").addEventListener("input", renderInventory);
  qs("#categoryFilter").addEventListener("change", renderInventory);
  qs("#stockFilter").addEventListener("change", renderInventory);
  qs("#posSearch").addEventListener("input", renderPos);
  qs("#exportInventoryButton").addEventListener("click", exportCsv);
  qs("#newProductButton").addEventListener("click", () => openProductDialog());
  qs("#inventoryAddButton").addEventListener("click", () => openProductDialog());
  qs("#closeProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#cancelProductDialog").addEventListener("click", () => qs("#productDialog").close());
  qs("#askAiButton").addEventListener("click", askAi);
  qs("#authForm").addEventListener("submit", handleAuthSubmit);
  qs("#authModeButton").addEventListener("click", () => setAuthMode(state.authMode === "signup" ? "signin" : "signup"));
  qs("#signOutButton").addEventListener("click", async () => {
    if (!state.auth) return;
    const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    await signOut(state.auth);
    showToast("Signed out.");
  });

  qsa("[data-question]").forEach((button) => {
    button.addEventListener("click", () => {
      qs("#aiQuestion").value = button.dataset.question;
      askAi();
    });
  });

  qsa("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const key = header.dataset.sort;
      state.sortDirection = state.sortKey === key ? state.sortDirection * -1 : 1;
      state.sortKey = key;
      renderInventory();
    });
  });

  document.addEventListener("click", (event) => {
    const cartButton = event.target.closest("[data-add-cart]");
    if (cartButton) {
      const product = state.products.find((item) => item.id === cartButton.dataset.addCart);
      if (!product || product.quantity <= 0) return showToast("This product is out of stock.");
      const cartItem = state.cart.find((item) => item.id === product.id);
      if (cartItem) cartItem.qty += 1;
      else state.cart.push({ ...product, qty: 1 });
      renderPos();
    }

    const editButton = event.target.closest("[data-edit-product]");
    if (editButton) {
      const product = state.products.find((item) => item.id === editButton.dataset.editProduct);
      if (product) openProductDialog(product);
    }

    const deleteButton = event.target.closest("[data-delete-product]");
    if (deleteButton) {
      deleteProduct(deleteButton.dataset.deleteProduct);
    }

    const command = event.target.closest("[data-command-view]");
    if (command) {
      openView(command.dataset.commandView);
      qs("#commandPalette").classList.remove("open");
    }
  });

  qs("#completeSaleButton").addEventListener("click", async () => {
    if (!state.cart.length) return showToast("Add products to the cart first.");
    const saleItems = state.cart.map((cartItem) => ({
      productId: cartItem.id,
      name: cartItem.name,
      sku: cartItem.sku,
      qty: cartItem.qty,
      sellingPrice: cartItem.sellingPrice,
      lineTotal: cartItem.qty * cartItem.sellingPrice
    }));
    const total = saleItems.reduce((sum, item) => sum + item.lineTotal, 0);

    state.cart.forEach((cartItem) => {
      const product = state.products.find((item) => item.id === cartItem.id);
      if (product) product.quantity = Math.max(0, product.quantity - cartItem.qty);
    });

    if (state.db) {
      try {
        const { collection, doc, serverTimestamp, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
        const batch = writeBatch(state.db);
        state.cart.forEach((cartItem) => {
          const product = state.products.find((item) => item.id === cartItem.id);
          if (product) {
            batch.update(doc(state.db, "users", state.user.uid, "products", cartItem.id), {
              quantity: product.quantity,
              updatedAt: serverTimestamp()
            });
          }
        });
        const saleRef = doc(collection(state.db, "users", state.user.uid, "sales"));
        batch.set(saleRef, {
          items: saleItems,
          total,
          paymentMethod: "cash",
          branchId: "main",
          cashierUid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
        batch.set(doc(collection(state.db, "users", state.user.uid, "auditLogs")), {
          action: "SALE_COMPLETED",
          total,
          itemCount: saleItems.length,
          uid: state.user?.uid || null,
          createdAt: serverTimestamp()
        });
        await batch.commit();
      } catch (error) {
        console.warn(error);
        showToast("Sale completed locally. Firestore sync failed.");
      }
    }

    state.cart = [];
    renderAll();
    showToast("Sale completed and inventory updated.");
  });

  qs("#productForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const product = Object.fromEntries(form.entries());
    ["costPrice", "sellingPrice", "quantity", "reorderLevel"].forEach((key) => {
      product[key] = Number(product[key]);
    });
    saveProduct(product);
    event.currentTarget.reset();
    qs("#productDialog").close();
  });

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      qs("#commandPalette").classList.add("open");
      qs("#commandInput").focus();
      renderCommands();
    }
    if (event.key === "Escape") qs("#commandPalette").classList.remove("open");
  });

  qs("#commandInput").addEventListener("input", (event) => renderCommands(event.target.value));
  qs("#commandPalette").addEventListener("click", (event) => {
    if (event.target.id === "commandPalette") qs("#commandPalette").classList.remove("open");
  });
}

setAuthMode("signup");
bindEvents();
renderAll();
initFirebase();
