import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const port = Number(process.env.PORT || 8787);
const corsOrigins = String(process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const requireFirebaseAuth = String(process.env.REQUIRE_FIREBASE_AUTH || "false") === "true";
const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || "";
const firebaseIssuer = firebaseProjectId ? `https://securetoken.google.com/${firebaseProjectId}` : "";
const firebaseJwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com")
);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required.");
}

if (requireFirebaseAuth && !firebaseProjectId) {
  throw new Error("FIREBASE_PROJECT_ID is required when REQUIRE_FIREBASE_AUTH=true.");
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

const MAX_HISTORY_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;

function sanitizeConversation(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list
    .filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")
    .map((message) => ({ role: message.role, content: message.content.trim() }))
    .filter((message) => message.content.length > 0 && message.content.length <= MAX_MESSAGE_LENGTH)
    .slice(-MAX_HISTORY_MESSAGES);
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
    businessType: typeof snapshot.businessType === "string" ? snapshot.businessType.slice(0, 40) : "general",
    language: snapshot.language === "sw" ? "sw" : "en",
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
    const { payload } = await jwtVerify(token, firebaseJwks, {
      issuer: firebaseIssuer,
      audience: firebaseProjectId
    });
    req.user = {
      uid: payload.sub,
      email: payload.email || null,
      firebase: payload.firebase || null
    };
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid Firebase auth token." });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dukasmart-ai-proxy" });
});

app.post("/api/ai/advisor", verifyFirebaseToken, async (req, res) => {
  const conversation = sanitizeConversation(req.body?.messages);
  const lastMessage = conversation[conversation.length - 1];

  if (!conversation.length || !lastMessage || lastMessage.role !== "user") {
    return res.status(400).json({
      error: "Please enter a question (up to 700 characters)."
    });
  }

  const snapshot = compactSnapshot(req.body?.snapshot);

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 900,
      temperature: 0.2,
      system: [
        "You are the DukaSmart ERP AI advisor for small and medium Tanzanian retail businesses.",
        `This account's business type is "${snapshot.businessType}" (one of: duka/general store, salon, hardware store, pharmacy, bar/restaurant, or general merchandise). Tailor your answers to the realities of that specific business type \u2014 for example, a pharmacy cares about prescription stockouts, a bar cares about drink velocity, a salon cares about retail product margins.`,
        "Only answer questions about this business's inventory management: inventory, POS, stockouts, reorder quantities, supplier performance, purchase orders, customers, warehouse, reports, pricing, profit, revenue, and day-to-day retail operations relevant to the stated business type.",
        "If the user asks outside those areas, refuse briefly and redirect them to DukaSmart ERP tasks.",
        "Do not invent exact quantities, suppliers, revenue, or customer facts beyond the provided snapshot.",
        "Return concise, practical recommendations with bullets when useful.",
        `Respond in ${snapshot.language === "sw" ? "Swahili" : "English"} only, regardless of what language the user's question is written in \u2014 this matches the app's current display language setting.`,
        "Judge topic relevance by meaning, not by exact keywords \u2014 a question can be on-topic even if phrased in an unusual way, a different language, or with typos.",
        "This is an ongoing conversation \u2014 use earlier turns for context when relevant.",
        `Current business snapshot (JSON): ${JSON.stringify(snapshot)}`
      ].join(" "),
      messages: conversation
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
  console.log(`DukaSmart AI proxy listening on http://localhost:${port}`);
});
