// Guards QA-001: the AI snapshot must fit the proxy's 64kb body limit, and the
// products that travel must be the ones the advice depends on.
//
//   node ai-snapshot.test.mjs
//
// Two failures were live before this existed. A catalogue past ~400 products
// pushed the request over express.json's 64kb limit and the whole call died with
// "Payload too large". And below that ceiling the server read only the first 80
// of whatever arrived — from a query with no orderBy, over UUID document ids —
// so reorder advice for any shop past 80 products was computed from an
// arbitrary sample, silently omitting the rest.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function extract(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let depth = 0;
  let i = src.indexOf("{", start);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

function constant(name) {
  const m = src.match(new RegExp(`const ${name} = (\\d+);`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return Number(m[1]);
}

const MAX_PRODUCTS = constant("AI_SNAPSHOT_MAX_PRODUCTS");
const { aiProductPriority, sanitizeAiSnapshot } = new Function(
  `const AI_SNAPSHOT_MAX_PRODUCTS = ${MAX_PRODUCTS};
   const AI_SNAPSHOT_MAX_SUPPLIERS = ${constant("AI_SNAPSHOT_MAX_SUPPLIERS")};
   const AI_SNAPSHOT_MAX_PURCHASES = ${constant("AI_SNAPSHOT_MAX_PURCHASES")};
   ${extract("aiProductPriority")}
   ${extract("sanitizeAiSnapshot")}
   return { aiProductPriority, sanitizeAiSnapshot };`
)();

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const SERVER_BODY_LIMIT = 64 * 1024;

// The client shape callAiProxy builds, with a deliberately unkind name length.
const product = (over = {}) => ({
  name: "Bidhaa ya Mfano na Jina Refu Sana kwa Ajili ya Jaribio",
  category: "General", quantity: 120, reorderLevel: 20,
  sold30: 45, sold90: 130, leadTimeDays: 10, ...over
});

console.log("=== the payload fits, with room to spare ===");
{
  const body = JSON.stringify({
    messages: Array.from({ length: 20 }, () => ({ role: "user", content: "x".repeat(700) })),
    kind: "chat",
    snapshot: sanitizeAiSnapshot({
      businessType: "pharmacy", language: "sw",
      products: Array.from({ length: 5000 }, () => product()),
      metrics: { revenue: 1, transactions: 2 }
    })
  });
  check("a 5,000-product catalogue still serialises under 64kb",
    body.length < SERVER_BODY_LIMIT, `${Math.round(body.length / 1024)} KB`);
  check("...with the full 20-message history and max-length questions attached",
    body.length < SERVER_BODY_LIMIT * 0.6, `${Math.round(body.length / 1024)} KB of 64 KB`);
}

console.log("\n=== the cap mirrors the server ===");
{
  const capped = sanitizeAiSnapshot({ products: Array.from({ length: 500 }, () => product()) });
  check("products are capped at the server's own limit", capped.products.length === MAX_PRODUCTS,
    `sent ${capped.products.length}, server reads ${MAX_PRODUCTS}`);
  check("the cap matches the server's slice(0, 80)", MAX_PRODUCTS === 80, `cap=${MAX_PRODUCTS}`);
  const missing = sanitizeAiSnapshot({});
  check("a snapshot with no arrays does not throw", Array.isArray(missing.products));
}

console.log("\n=== the right 80 travel ===");
{
  // 200 healthy fast-movers that would dominate an arbitrary slice, plus the
  // handful that advice actually turns on, deliberately placed last.
  const catalogue = [
    ...Array.from({ length: 200 }, (_, i) => product({ name: `Healthy ${i}`, quantity: 500, sold30: 900 })),
    product({ name: "OUT OF STOCK", quantity: 0, sold30: 5 }),
    product({ name: "BELOW REORDER", quantity: 3, reorderLevel: 20, sold30: 5 })
  ];
  const ranked = [...catalogue].sort((a, b) => aiProductPriority(b) - aiProductPriority(a))
    .slice(0, MAX_PRODUCTS).map((p) => p.name);

  check("an out-of-stock product reaches the model", ranked.includes("OUT OF STOCK"));
  check("a below-reorder product reaches the model", ranked.includes("BELOW REORDER"));
  check("out of stock outranks below reorder", ranked.indexOf("OUT OF STOCK") < ranked.indexOf("BELOW REORDER"));
  check("both outrank healthy fast movers", ranked.indexOf("BELOW REORDER") < 2,
    `position ${ranked.indexOf("BELOW REORDER")}`);
}

console.log("\n=== ranking rules ===");
{
  check("out of stock beats a faster-selling healthy item",
    aiProductPriority({ quantity: 0, sold30: 1 }) > aiProductPriority({ quantity: 900, sold30: 999 }));
  check("at the reorder level counts as low, not healthy",
    aiProductPriority({ quantity: 20, reorderLevel: 20 }) >= 2000000);
  check("one above the reorder level is healthy",
    aiProductPriority({ quantity: 21, reorderLevel: 20 }) < 2000000);
  check("among equals, the faster mover ranks higher",
    aiProductPriority({ quantity: 500, sold30: 90 }) > aiProductPriority({ quantity: 500, sold30: 10 }));
  check("missing fields do not produce NaN",
    Number.isFinite(aiProductPriority({})), String(aiProductPriority({})));
  // Ties must not reshuffle between turns, or the cached prompt prefix misses.
  const tied = Array.from({ length: 30 }, (_, i) => product({ name: `T${i}`, quantity: 500, sold30: 50 }));
  const a = [...tied].sort((x, y) => aiProductPriority(y) - aiProductPriority(x)).map((p) => p.name).join();
  const b = [...tied].sort((x, y) => aiProductPriority(y) - aiProductPriority(x)).map((p) => p.name).join();
  check("ordering is stable across calls (keeps the prompt cache warm)", a === b);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
