import { firebaseConfig } from "./firebase-config.js";
import { aiConfig } from "./ai-config.js";

const state = {
  products: [],
  cart: [],
  paymentMethod: "cash",
  sortKey: "name",
  sortDirection: 1,
  authMode: "signup",
  firebaseReady: false,
  db: null,
  auth: null,
  user: null,
  unsubscribeProducts: null,
  pendingBusinessName: "",
  cachedProfile: null
};

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

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), delay);
  };
}

function stockStatus(product) {
  if (product.quantity <= 0) return "out";
  if (product.quantity <= product.reorderLevel) return "low";
  return "healthy";
}

function calculateMetrics() {
  const totalQuantity = state.products.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const lowStock = state.products.filter((item) => stockStatus(item) === "low").length;
  const out = state.products.filter((item) => stockStatus(item) === "out").length;
  const categories = new Set(state.products.map((item) => item.category).filter(Boolean)).size;
  const suppliers = new Set(state.products.map((item) => item.supplier).filter(Boolean)).size;

  return {
    totalQuantity,
    totalProducts: state.products.length,
    categories,
    suppliers,
    lowStock,
    out
  };
}

function renderKpis() {
  const metrics = calculateMetrics();
  const cards = [
    ["Total Products", metrics.totalProducts, "Your account"],
    ["Total Quantity", metrics.totalQuantity, "Units in stock"],
    ["Categories", metrics.categories, "Product groups"],
    ["Suppliers", metrics.suppliers, "From your products"],
    ["Low Stock Items", metrics.lowStock, "Reorder now"],
    ["Out of Stock Items", metrics.out, "Urgent"]
  ];

  qs("#kpiGrid").innerHTML = cards
    .map(([label, value, delta]) => `<div class="kpi-card"><span class="muted">${label}</span><strong>${value}</strong><span class="delta">${delta}</span></div>`)
    .join("");
}

function renderChart() {
  const canvas = qs("#salesChart");
  const ctx = canvas.getContext("2d");
  const chartProducts = state.products.slice(0, 12);
  const labels = chartProducts.map((product) => String(product.name || "Item").slice(0, 10));
  const data = chartProducts.map((product) => Number(product.quantity || 0));
  const width = canvas.width;
  const height = canvas.height;
  const pad = 44;
  const max = Math.max(...data, 1) * 1.18;

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

  if (!data.length) {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted");
    ctx.font = "15px Inter, sans-serif";
    ctx.fillText("Add products to see stock levels here.", pad, height / 2);
    return;
  }

  const points = data.map((value, index) => ({
    x: pad + ((width - pad * 2) / Math.max(data.length - 1, 1)) * index,
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
  const dailyDemand = Number(product.sold90 || 0) / 90;
  const safetyStock = Math.ceil(dailyDemand * 7);
  const expectedDemandDuringLeadTime = Math.ceil(dailyDemand * Number(product.leadTimeDays || 10));
  const reorderLevel = Number(product.reorderLevel || 0);
  const quantity = Number(product.quantity || 0);
  const targetStock = reorderLevel + expectedDemandDuringLeadTime + safetyStock;
  const recommendedQty = Math.max(0, targetStock - quantity);
  const daysUntilStockout = quantity === 0 ? 0 : Math.floor(quantity / Math.max(dailyDemand, 0.1));
  return { recommendedQty, daysUntilStockout, expectedDemandDuringLeadTime };
}

function renderAlertsAndRecommendations() {
  const risky = state.products.filter((product) => stockStatus(product) !== "healthy");
  qs("#alertCount").textContent = risky.length;
  qs("#alertList").innerHTML = risky
    .map((product) => {
      const status = stockStatus(product);
      return `<div class="alert-item ${status === "out" ? "red" : "amber"}">
        <strong>${esc(product.name)}</strong>
        <span class="muted">${status === "out" ? "Out of stock" : `Below minimum stock. Current stock: ${product.quantity}.`}</span>
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
      <strong>${esc(product.name)}</strong>
      <span>Reorder ${rec.recommendedQty} units now.</span>
      <small class="muted">Estimated stockout in ${rec.daysUntilStockout} days.</small>
    </div>`)
    .join("");
}

function renderMovement() {
  const classes = [
    ["Fast-moving products", state.products.filter((p) => Number(p.sold30 || 0) >= 50).length, "#5ed08f"],
    ["Slow-moving products", state.products.filter((p) => Number(p.sold30 || 0) > 0 && Number(p.sold30 || 0) < 12).length, "#f1b44c"],
    ["No sales recorded", state.products.filter((p) => Number(p.sold90 || 0) === 0).length, "#ef6666"],
    ["Healthy stock coverage", state.products.filter((p) => stockStatus(p) === "healthy").length, "#6aa7ff"]
  ];
  qs("#movementList").innerHTML = classes
    .map(([label, value, color]) => `<div class="movement-row"><strong style="color:${color}">${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderFilters() {
  const selectedCategory = qs("#categoryFilter")?.value || "all";
  const seen = new Map();
  state.products.forEach((product) => {
    const raw = String(product.category || "").trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!seen.has(key)) seen.set(key, raw);
  });
  const categories = ["all", ...seen.values()];
  qs("#categoryFilter").innerHTML = categories.map((category) => `<option value="${esc(category)}">${category === "all" ? "All categories" : esc(category)}</option>`).join("");
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
    .filter((product) => category === "all" || String(product.category || "").trim().toLowerCase() === category.trim().toLowerCase())
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
        <td><strong>${esc(product.name)}</strong></td>
        <td>${esc(product.category)}</td>
        <td>${esc(product.brand || "-")}</td>
        <td>${esc(product.supplier || "-")}</td>
        <td>${product.quantity}</td>
        <td><span class="status ${status}">${label}</span></td>
        <td class="table-actions">
          <button class="ghost-button compact" data-edit-product="${product.id}">Edit</button>
          <button class="ghost-button compact danger" data-delete-product="${product.id}">Delete</button>
        </td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="7" class="empty-state">No inventory yet. Add your first material or product to start tracking stock.</td></tr>`;
}

function renderPos() {
  const term = qs("#posSearch").value.trim().toLowerCase();
  const products = state.products.filter((product) => !term || [product.name, product.category, product.brand, product.supplier].join(" ").toLowerCase().includes(term));
  qs("#posProducts").innerHTML = products
    .slice(0, 8)
    .map((product) => `<button class="pos-product" data-add-cart="${product.id}">
      <strong>${esc(product.name)}</strong>
      <span class="muted">${esc(product.category)} - KES ${Number(product.sellingPrice || 0).toLocaleString()} - ${product.quantity} available</span>
    </button>`)
    .join("");

  const totalQty = state.cart.reduce((sum, item) => sum + item.qty, 0);
  const totalAmount = state.cart.reduce((sum, item) => sum + item.qty * Number(item.sellingPrice || 0), 0);

  qs("#cartCount").textContent = totalQty;
  qs("#cartItems").innerHTML = state.cart
    .map((item) => `<div class="cart-item">
      <div class="cart-item-info">
        <strong>${esc(item.name)}</strong>
        <span class="muted">KES ${Number(item.sellingPrice || 0).toLocaleString()} each</span>
      </div>
      <div class="cart-item-controls">
        <button class="ghost-button compact" data-decrease-cart="${item.id}" type="button" aria-label="Decrease quantity">-</button>
        <span class="cart-item-qty">${item.qty}</span>
        <button class="ghost-button compact" data-increase-cart="${item.id}" type="button" aria-label="Increase quantity">+</button>
        <button class="ghost-button compact danger" data-remove-cart="${item.id}" type="button" aria-label="Remove item">Remove</button>
      </div>
      <strong class="cart-item-total">KES ${(item.qty * Number(item.sellingPrice || 0)).toLocaleString()}</strong>
    </div>`)
    .join("") || `<span class="muted">No items in cart.</span>`;

  qs("#cartTotal").textContent = `KES ${totalAmount.toLocaleString()}`;

  const cashTenderRow = qs("#cashTenderRow");
  cashTenderRow.hidden = state.paymentMethod !== "cash";
  const tendered = Number(qs("#cashTendered")?.value || 0);
  const change = Math.max(0, tendered - totalAmount);
  qs("#changeDue").textContent = `KES ${change.toLocaleString()}`;
}

function renderCards() {
  const reports = ["Inventory Summary", "Stock Quantity Report", "Supplier List", "Low Stock Report", "Out of Stock Report", "CSV Export"];
  qs("#reportGrid").innerHTML = reports
    .map(
      (report) => `<article class="report-card">
        <strong>${report}</strong>
        <span class="muted">Export PDF, Excel, or CSV</span>
        <div class="report-actions">
          <button class="ghost-button compact" data-generate-report="csv">CSV</button>
          <button class="ghost-button compact" data-generate-report="pdf">PDF</button>
          <button class="ghost-button compact" data-generate-report="xlsx">Excel</button>
        </div>
      </article>`
    )
    .join("");
}

function localAiAnswer(question) {
  const low = state.products.filter((product) => stockStatus(product) !== "healthy");
  const highStock = [...state.products].sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0)).slice(0, 3);
  const recs = low.map((product) => ({ product, rec: reorderRecommendation(product) }));

  return `<p><strong>Local recommendation:</strong> ${esc(question) || "Focus this week on stock availability and clean inventory records."}</p>
  <ul>
    <li>Urgent reorder: ${recs.map(({ product, rec }) => `${esc(product.name)} (${rec.recommendedQty} units)`).join(", ") || "none"}.</li>
    <li>Highest stocked products: ${highStock.map((product) => esc(product.name)).join(", ") || "none"}.</li>
    <li>Supplier fields come only from products you add to this account.</li>
  </ul>
  <p class="muted">This advisor uses only your signed-in inventory snapshot.</p>`;
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
            products: state.products.map((product) => ({
              name: product.name,
              category: product.category,
              quantity: Number(product.quantity || 0),
              reorderLevel: Number(product.reorderLevel || 0),
              sold30: Number(product.sold30 || 0),
              sold90: Number(product.sold90 || 0),
              leadTimeDays: Number(product.leadTimeDays || 10)
            })),
            metrics: calculateMetrics()
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "AI proxy request failed.");
      }
      qs("#aiMode").textContent = "Claude";
      qs("#aiAnswer").innerHTML = `<p>${esc(payload.answer).replaceAll("\n", "<br>")}</p>`;
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
  const headers = ["name", "category", "brand", "supplier", "quantity"];
  const rows = state.products.map((product) => headers.map((header) => JSON.stringify(product[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sanitaryflow-inventory.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function buildReportRows() {
  return state.products.map((product) => {
    const status = stockStatus(product);
    const label = status === "out" ? "Out of stock" : status === "low" ? "Low stock" : "Healthy";
    return {
      Name: product.name || "",
      Category: product.category || "",
      Brand: product.brand || "-",
      Supplier: product.supplier || "-",
      Quantity: Number(product.quantity || 0),
      "Reorder Level": Number(product.reorderLevel || 0),
      Status: label
    };
  });
}

function generateReportCsv() {
  const rows = buildReportRows();
  if (!rows.length) return showToast("No inventory data to export yet.");
  const headers = Object.keys(rows[0]);
  const csvRows = rows.map((row) => headers.map((header) => JSON.stringify(row[header] ?? "")).join(","));
  const blob = new Blob([[headers.join(","), ...csvRows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sanitaryflow-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function generateReportPdf() {
  const rows = buildReportRows();
  if (!rows.length) return showToast("No inventory data to export yet.");
  const jsPdfCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPdfCtor) return showToast("PDF library did not load. Check your connection and try again.");
  const doc = new jsPdfCtor();
  doc.setFontSize(14);
  doc.text("SanitaryFlow Inventory Report", 14, 16);
  doc.setFontSize(10);
  doc.text(new Date().toLocaleString(), 14, 22);
  const headers = Object.keys(rows[0]);
  const body = rows.map((row) => headers.map((header) => String(row[header])));
  if (typeof doc.autoTable === "function") {
    doc.autoTable({ head: [headers], body, startY: 28 });
  } else {
    let y = 30;
    doc.text(headers.join(" | "), 14, y);
    rows.forEach((row) => {
      y += 6;
      doc.text(headers.map((header) => String(row[header])).join(" | "), 14, y);
    });
  }
  doc.save("sanitaryflow-report.pdf");
}

function generateReportXlsx() {
  const rows = buildReportRows();
  if (!rows.length) return showToast("No inventory data to export yet.");
  if (!window.XLSX) return showToast("Excel library did not load. Check your connection and try again.");
  const worksheet = window.XLSX.utils.json_to_sheet(rows);
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
  window.XLSX.writeFile(workbook, "sanitaryflow-report.xlsx");
}

function generateReport(format) {
  if (format === "csv") return generateReportCsv();
  if (format === "pdf") return generateReportPdf();
  if (format === "xlsx") return generateReportXlsx();
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

const PRODUCT_FIELD_LIMITS = {
  name: 120,
  category: 60,
  brand: 60,
  supplier: 60
};

function validateProductFields(product) {
  for (const [field, maxLength] of Object.entries(PRODUCT_FIELD_LIMITS)) {
    const value = String(product[field] ?? "");
    if (value.length > maxLength) {
      return `${field.charAt(0).toUpperCase() + field.slice(1)} must be ${maxLength} characters or fewer.`;
    }
  }
  return null;
}

function clampNonNegativeNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
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
      const { collection, doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
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
      const { deleteDoc, doc } = state.firebaseApi.firestore;
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
    const appApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js");
    const authApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js");
    const firestoreApi = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js");
    state.firebaseApi = { app: appApi, auth: authApi, firestore: firestoreApi };

    const app = appApi.initializeApp(firebaseConfig);

    try {
      if (typeof window.process === "undefined") {
        window.process = { env: {} };
      }
      const { initializeAppCheck, ReCaptchaV3Provider } = await import("https://www.gstatic.com/firebasejs/10.12.4/firebase-app-check.js");
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider("6LdtGFEtAAAAABK4HX_ufjUMskc7pix12Lz2NMGd"),
        isTokenAutoRefreshEnabled: true
      });
    } catch (appCheckError) {
      console.warn("App Check failed to initialize; continuing without it.", appCheckError);
    }

    state.auth = authApi.getAuth(app);
    state.db = firestoreApi.getFirestore(app);
    state.firebaseReady = true;
    qs(".status-dot").classList.add("connected");
    qs("#connectionLabel").textContent = "Firebase connected";
    qs("#connectionHint").textContent = "Create an account to begin";

    authApi.onAuthStateChanged(state.auth, async (user) => {
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
    const { collection, onSnapshot } = state.firebaseApi.firestore;
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
  const businessName = state.pendingBusinessName || user.displayName || "";
  const cached = state.user?.uid === user.uid ? state.cachedProfile : null;
  const unchanged = cached
    && cached.email === (user.email || "")
    && cached.businessName === businessName;
  if (unchanged) return;

  try {
    const { doc, serverTimestamp, setDoc } = state.firebaseApi.firestore;
    await setDoc(doc(state.db, "users", user.uid), {
      uid: user.uid,
      email: user.email || "",
      businessName,
      role: "Owner",
      authProvider: "password",
      updatedAt: serverTimestamp()
    }, { merge: true });
    state.cachedProfile = { email: user.email || "", businessName };
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

const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 15 * 60 * 1000;

function authFailureKey(email) {
  return `authFailures:${email.toLowerCase()}`;
}

function getAuthFailures(email) {
  try {
    const raw = sessionStorage.getItem(authFailureKey(email));
    const attempts = raw ? JSON.parse(raw) : [];
    const cutoff = Date.now() - AUTH_WINDOW_MS;
    return attempts.filter((timestamp) => timestamp > cutoff);
  } catch (error) {
    return [];
  }
}

function recordAuthFailure(email) {
  try {
    const attempts = getAuthFailures(email);
    attempts.push(Date.now());
    sessionStorage.setItem(authFailureKey(email), JSON.stringify(attempts));
  } catch (error) {
    console.warn(error);
  }
}

function clearAuthFailures(email) {
  try {
    sessionStorage.removeItem(authFailureKey(email));
  } catch (error) {
    console.warn(error);
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!state.auth) return showToast("Firebase is not connected yet.");
  const form = new FormData(event.currentTarget);
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const businessName = String(form.get("businessName") || "").trim();

  if (email && getAuthFailures(email).length >= AUTH_MAX_ATTEMPTS) {
    showToast("Too many failed attempts for this email. Please wait 15 minutes and try again.");
    return;
  }

  const submitButton = qs("#authSubmitButton");
  submitButton.disabled = true;

  try {
    const authApi = state.firebaseApi.auth;
    if (state.authMode === "signup") {
      state.pendingBusinessName = businessName;
      const credential = await authApi.createUserWithEmailAndPassword(state.auth, email, password);
      if (businessName) await authApi.updateProfile(credential.user, { displayName: businessName });
      clearAuthFailures(email);
      showToast("Account created. Add your first inventory item.");
    } else {
      state.pendingBusinessName = "";
      await authApi.signInWithEmailAndPassword(state.auth, email, password);
      clearAuthFailures(email);
      showToast("Signed in.");
    }
  } catch (error) {
    console.warn(error);
    recordAuthFailure(email);
    const messages = {
      "auth/email-already-in-use": "That email already has an account. Sign in instead.",
      "auth/invalid-credential": "Email or password is incorrect.",
      "auth/weak-password": "Use a password with at least 6 characters.",
      "auth/operation-not-allowed": "Enable Email/Password sign-in in Firebase Auth."
    };
    showToast(messages[error.code] || "Authentication failed. Check your details and try again.");
  } finally {
    submitButton.disabled = false;
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
  qs("#globalSearch").addEventListener("input", debounce(renderInventory, 250));
  qs("#categoryFilter").addEventListener("change", renderInventory);
  qs("#stockFilter").addEventListener("change", renderInventory);
  qs("#posSearch").addEventListener("input", debounce(renderPos, 250));
  qs("#clearCartButton").addEventListener("click", () => {
    if (!state.cart.length) return;
    state.cart = [];
    renderPos();
  });
  qs("#cashTendered").addEventListener("input", renderPos);
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
    const { signOut } = state.firebaseApi.auth;
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
      if (cartItem) {
        if (cartItem.qty >= product.quantity) return showToast("No more stock available for this product.");
        cartItem.qty += 1;
      } else {
        state.cart.push({ ...product, qty: 1 });
      }
      renderPos();
    }

    const increaseButton = event.target.closest("[data-increase-cart]");
    if (increaseButton) {
      const cartItem = state.cart.find((item) => item.id === increaseButton.dataset.increaseCart);
      const product = state.products.find((item) => item.id === increaseButton.dataset.increaseCart);
      if (cartItem && product) {
        if (cartItem.qty >= product.quantity) return showToast("No more stock available for this product.");
        cartItem.qty += 1;
        renderPos();
      }
    }

    const decreaseButton = event.target.closest("[data-decrease-cart]");
    if (decreaseButton) {
      const cartItem = state.cart.find((item) => item.id === decreaseButton.dataset.decreaseCart);
      if (cartItem) {
        cartItem.qty -= 1;
        if (cartItem.qty <= 0) {
          state.cart = state.cart.filter((item) => item.id !== decreaseButton.dataset.decreaseCart);
        }
        renderPos();
      }
    }

    const removeButton = event.target.closest("[data-remove-cart]");
    if (removeButton) {
      state.cart = state.cart.filter((item) => item.id !== removeButton.dataset.removeCart);
      renderPos();
    }

    const paymentButton = event.target.closest("[data-payment]");
    if (paymentButton) {
      state.paymentMethod = paymentButton.dataset.payment;
      qsa("[data-payment]").forEach((button) => button.classList.toggle("active", button.dataset.payment === state.paymentMethod));
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

    const reportButton = event.target.closest("[data-generate-report]");
    if (reportButton) {
      console.log("Report button clicked:", reportButton.dataset.generateReport);
      generateReport(reportButton.dataset.generateReport);
    }
  });

  qs("#completeSaleButton").addEventListener("click", async () => {
    if (!state.cart.length) return showToast("Add products to the cart first.");

    const saleItems = state.cart.map((cartItem) => ({
      productId: cartItem.id,
      name: cartItem.name,
      category: cartItem.category || "",
      brand: cartItem.brand || "",
      supplier: cartItem.supplier || "",
      qty: cartItem.qty,
      sellingPrice: Number(cartItem.sellingPrice || 0),
      lineTotal: cartItem.qty * Number(cartItem.sellingPrice || 0)
    }));
    const total = saleItems.reduce((sum, item) => sum + item.lineTotal, 0);
    const paymentMethod = state.paymentMethod || "cash";
    const cashTendered = Number(qs("#cashTendered")?.value || 0);

    if (paymentMethod === "cash" && cashTendered < total) {
      showToast("Cash tendered is less than the sale total.");
      return;
    }
    const changeDue = paymentMethod === "cash" ? Math.max(0, cashTendered - total) : 0;

    const completeButton = qs("#completeSaleButton");
    completeButton.disabled = true;

    if (state.db && state.user) {
      try {
        const { collection, doc, runTransaction, serverTimestamp } = state.firebaseApi.firestore;
        await runTransaction(state.db, async (transaction) => {
          const productRefs = state.cart.map((cartItem) => doc(state.db, "users", state.user.uid, "products", cartItem.id));
          const productSnaps = await Promise.all(productRefs.map((ref) => transaction.get(ref)));

          productSnaps.forEach((snap, index) => {
            const cartItem = state.cart[index];
            if (!snap.exists()) throw new Error(`${cartItem.name} no longer exists.`);
            const currentQuantity = Number(snap.data().quantity || 0);
            if (currentQuantity < cartItem.qty) {
              throw new Error(`Not enough stock for ${cartItem.name}. Only ${currentQuantity} left.`);
            }
          });

          productSnaps.forEach((snap, index) => {
            const cartItem = state.cart[index];
            const currentQuantity = Number(snap.data().quantity || 0);
            transaction.update(productRefs[index], {
              quantity: currentQuantity - cartItem.qty,
              updatedAt: serverTimestamp()
            });
          });

          const saleRef = doc(collection(state.db, "users", state.user.uid, "sales"));
          transaction.set(saleRef, {
            items: saleItems,
            total,
            paymentMethod,
            cashTendered: paymentMethod === "cash" ? cashTendered : null,
            changeDue: paymentMethod === "cash" ? changeDue : null,
            branchId: "main",
            cashierUid: state.user?.uid || null,
            createdAt: serverTimestamp()
          });

          const auditRef = doc(collection(state.db, "users", state.user.uid, "auditLogs"));
          transaction.set(auditRef, {
            action: "SALE_COMPLETED",
            total,
            paymentMethod,
            itemCount: saleItems.length,
            uid: state.user?.uid || null,
            createdAt: serverTimestamp()
          });
        });
      } catch (error) {
        console.warn(error);
        showToast(error.message || "Sale failed. Please recheck stock and try again.");
        completeButton.disabled = false;
        return;
      }
    } else {
      state.cart.forEach((cartItem) => {
        const product = state.products.find((item) => item.id === cartItem.id);
        if (product) product.quantity = Math.max(0, product.quantity - cartItem.qty);
      });
    }

    state.cart = [];
    if (qs("#cashTendered")) qs("#cashTendered").value = "";
    renderAll();
    completeButton.disabled = false;
    showToast(changeDue > 0 ? `Sale completed. Give KES ${changeDue.toLocaleString()} change.` : "Sale completed and inventory updated.");
  });

  qs("#productForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const product = Object.fromEntries(form.entries());

    const fieldError = validateProductFields(product);
    if (fieldError) {
      showToast(fieldError);
      return;
    }

    const quantity = clampNonNegativeNumber(product.quantity);
    const costPrice = clampNonNegativeNumber(product.costPrice || 0);
    const sellingPrice = clampNonNegativeNumber(product.sellingPrice || 0);
    const reorderLevel = clampNonNegativeNumber(product.reorderLevel || 0);

    if (quantity === null || costPrice === null || sellingPrice === null || reorderLevel === null) {
      showToast("Quantity and price fields must be zero or positive numbers.");
      return;
    }

    product.quantity = quantity;
    product.costPrice = costPrice;
    product.sellingPrice = sellingPrice;
    product.reorderLevel = reorderLevel;
    product.category = String(product.category || "").trim();
    product.sku = product.sku || `${String(product.name || "ITEM").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "ITEM"}-${Date.now().toString().slice(-6)}`;
    product.barcode = product.barcode || "";
    product.description = product.description || "";
    product.warehouse = product.warehouse || "";
    product.shelf = product.shelf || "";
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
