import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import helmet from "helmet";

const app = express();
const port = Number(process.env.PORT || 8787);
const corsOrigins = String(process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const requireFirebaseAuth = String(process.env.REQUIRE_FIREBASE_AUTH || "false") === "true";
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required.");
}

if (requireFirebaseAuth && admin.apps.length === 0) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID
  });
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

app.set("trust proxy", 1);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed."));
    }
  })
);
app.use(express.json({ limit: "120kb" }));
app.use(
  "/api/",
  rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-7",
    legacyHeaders: false
  })
);

const allowedTopics = [
  "inventory",
  "stock",
  "reorder",
  "supplier",
  "purchase",
  "sales",
  "profit",
  "revenue",
  "customer",
  "warehouse",
  "branch",
  "pos",
  "barcode",
  "plumbing",
  "sanitary",
  "pipe",
  "valve",
  "fitting",
  "tank",
  "sink",
  "toilet",
  "tap",
  "mixer",
  "pump",
  "report",
  "forecast",
  "dead stock",
  "slow-moving",
  "fast-moving",
  "pricing"
];

function isQuestionInScope(question) {
  const normalized = String(question || "").toLowerCase();
  if (normalized.length < 3 || normalized.length > 700) return false;
  return allowedTopics.some((topic) => normalized.includes(topic));
}

function compactProduct(product) {
  return {
    name: product.name,
    sku: product.sku,
    category: product.category,
    supplier: product.supplier,
    costPrice: Number(product.costPrice || 0),
    sellingPrice: Number(product.sellingPrice || 0),
    quantity: Number(product.quantity || 0),
    reorderLevel: Number(product.reorderLevel || 0),
    sold30: Number(product.sold30 || 0),
    sold90: Number(product.sold90 || 0),
    leadTimeDays: Number(product.leadTimeDays || 0)
  };
}

function compactSnapshot(snapshot = {}) {
  return {
    metrics: snapshot.metrics || {},
    products: Array.isArray(snapshot.products) ? snapshot.products.slice(0, 80).map(compactProduct) : [],
    suppliers: Array.isArray(snapshot.suppliers) ? snapshot.suppliers.slice(0, 30) : [],
    purchases: Array.isArray(snapshot.purchases) ? snapshot.purchases.slice(0, 30) : []
  };
}

async function verifyFirebaseToken(req, res, next) {
  if (!requireFirebaseAuth) return next();

  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing Firebase auth token." });
    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid Firebase auth token." });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "sanitaryflow-ai-proxy" });
});

app.post("/api/ai/advisor", verifyFirebaseToken, async (req, res) => {
  const question = String(req.body?.question || "").trim();
  if (!isQuestionInScope(question)) {
    return res.status(400).json({
      error: "Ask a question about SanitaryFlow inventory, sales, purchasing, suppliers, customers, warehouse, reports, or plumbing and sanitary stock."
    });
  }

  const snapshot = compactSnapshot(req.body?.snapshot);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 900,
      temperature: 0.2,
      system: [
        "You are the SanitaryFlow ERP AI advisor.",
        "Only answer questions about this plumbing and sanitary inventory management system.",
        "Allowed areas: inventory, POS, stockouts, reorder quantities, supplier performance, purchase orders, customers, warehouse, reports, pricing, profit, revenue, and plumbing or sanitary product operations.",
        "If the user asks outside those areas, refuse briefly and redirect them to SanitaryFlow ERP tasks.",
        "Use only the provided business snapshot. Do not invent exact quantities, suppliers, revenue, or customer facts.",
        "Return concise, practical recommendations with bullets when useful."
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify({ question, snapshot })
        }
      ]
    });

    const answer = response.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");

    return res.json({ answer });
  } catch (error) {
    console.error("Anthropic request failed:", error);
    return res.status(502).json({ error: "AI provider request failed." });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(port, () => {
  console.log(`SanitaryFlow AI proxy listening on http://localhost:${port}`);
});
