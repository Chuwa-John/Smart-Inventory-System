// Boots the real proxy in-process and exercises its security controls over
// HTTP. No mocks: if a limiter, validator or auth gate regresses, this fails.
//
//   node tests/proxy-security.test.mjs
//
// REQUIRE_FIREBASE_AUTH is left false so the authenticated routes are
// reachable without minting real Firebase tokens; the auth-gate behaviour
// itself is asserted separately via the production-refusal check below.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8794;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : "\n      " + detail}`);
}

const post = (path, body, headers = {}) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("../proxy/", import.meta.url),
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: "test_dummy_key",
    PORT: String(PORT),
    NODE_ENV: "development",
    REQUIRE_FIREBASE_AUTH: "false",
    CORS_ORIGINS: "https://sanitaryflow-erp.web.app",
    DELETION_JOB_SECRET: "test_job_secret_value"
  },
  // Captured, not discarded: a harness that swallows the server's own startup
  // error reports "connection refused" and leaves you guessing why.
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (d) => (serverOutput += d));
server.stderr.on("data", (d) => (serverOutput += d));
server.on("error", (e) => (serverOutput += `spawn error: ${e.message}\n`));

process.on("exit", () => server.kill());

let up = false;
for (let i = 0; i < 60; i++) {
  if (server.exitCode !== null) break;
  try {
    const r = await fetch(BASE + "/health");
    if (r.ok) { up = true; break; }
  } catch {}
  await sleep(250);
}

if (!up) {
  console.error(`Proxy failed to start on port ${PORT} (exit=${server.exitCode}).`);
  console.error("--- server output ---");
  console.error(serverOutput || "(no output)");
  server.kill();
  process.exit(1);
}

console.log("=== transport / headers ===");
{
  const r = await fetch(BASE + "/health");
  const h = r.headers;
  check("health responds 200", r.status === 200);
  check("HSTS header present with 1-year max-age",
    (h.get("strict-transport-security") || "").includes("max-age=31536000"));
  check("X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
  check("helmet removes x-powered-by", !h.get("x-powered-by"));
}

console.log("\n=== payload limits / malformed input ===");
{
  const huge = JSON.stringify({ email: "a@b.com", pad: "x".repeat(200 * 1024) });
  const r = await post("/api/auth/check-limit", huge);
  check("oversized body rejected with 413", r.status === 413, `got ${r.status}`);
}
{
  const r = await post("/api/auth/check-limit", "{not valid json");
  check("malformed JSON rejected (4xx)", r.status >= 400 && r.status < 500, `got ${r.status}`);
}
{
  const r = await fetch(BASE + "/api/auth/check-limit", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "email=a@b.com"
  });
  check("non-JSON content-type not parsed as JSON", r.status >= 400, `got ${r.status}`);
}

console.log("\n=== input validation ===");
for (const [label, email] of [
  ["missing email", undefined],
  ["not an email", "notanemail"],
  ["oversized email", "a".repeat(250) + "@b.com"],
  ["wrong type (array)", ["a@b.com"]],
  ["wrong type (object)", { a: 1 }]
]) {
  const r = await post("/api/auth/check-limit", { email });
  check(`rejects ${label}`, r.status === 400, `got ${r.status}`);
}

console.log("\n=== 404 / error shape ===");
{
  const r = await fetch(BASE + "/definitely-not-a-route");
  const body = await r.json().catch(() => ({}));
  check("unknown route returns JSON 404", r.status === 404 && Boolean(body.error));
  check("404 body leaks no stack trace", !JSON.stringify(body).toLowerCase().includes("at "));
}

// Validation is asserted BEFORE the rate-limit tests. The advisor limiter is
// keyed on ip here (no auth in this harness), so exhausting it first would
// make every later request 429 and silently mask a broken validator.
console.log("\n=== advisor payload validation ===");
for (const [label, body] of [
  ["empty messages", { messages: [] }],
  ["too many messages", { messages: Array.from({ length: 25 }, () => ({ role: "user", content: "x" })) }],
  ["oversized message", { messages: [{ role: "user", content: "x".repeat(1200) }] }],
  ["bad role", { messages: [{ role: "system", content: "x" }] }],
  ["non-string content", { messages: [{ role: "user", content: { a: 1 } }] }],
  ["snapshot as array", { messages: [{ role: "user", content: "hi" }], snapshot: [1, 2] }]
]) {
  const r = await post("/api/ai/advisor", body);
  check(`advisor rejects ${label}`, r.status === 400, `got ${r.status}`);
}

console.log("\n=== auth route rate limiting (5 per 15 min) ===");
{
  const email = `ratelimit_${Date.now()}@example.com`;
  const codes = [];
  for (let i = 0; i < 7; i++) {
    const r = await post("/api/auth/check-limit", { email });
    codes.push(r.status);
  }
  const allowed = codes.filter((c) => c === 200).length;
  const blocked = codes.filter((c) => c === 429).length;
  check("first 5 auth attempts allowed", allowed === 5, `allowed=${allowed} codes=${codes}`);
  check("6th+ auth attempt returns 429", blocked === 2, `blocked=${blocked} codes=${codes}`);
}
{
  // Keyed on email, so a different account must not inherit the block.
  const r = await post("/api/auth/check-limit", { email: `fresh_${Date.now()}@example.com` });
  check("limiter is per-email, not global", r.status === 200, `got ${r.status}`);
}

console.log("\n=== AI cost limiter (8 per min) ===");
{
  const codes = [];
  for (let i = 0; i < 11; i++) {
    const r = await post("/api/ai/advisor", { messages: [{ role: "user", content: "hi" }] });
    codes.push(r.status);
  }
  const rateLimited = codes.filter((c) => c === 429).length;
  check("advisor endpoint enforces a per-minute cap", rateLimited >= 2,
    `429s=${rateLimited} codes=${codes.join(",")}`);
}

console.log("\n=== deletion job authentication ===");
{
  const noSecret = await post("/jobs/process-deletions", {});
  check("deletion job rejects a request with no secret", noSecret.status === 401, `got ${noSecret.status}`);

  const wrongSecret = await fetch(BASE + "/jobs/process-deletions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-deletion-job-secret": "wrong_value_here_x" },
    body: "{}"
  });
  check("deletion job rejects a wrong secret", wrongSecret.status === 401, `got ${wrongSecret.status}`);

  // Same length as the real secret, so this also exercises the timingSafeEqual
  // path rather than short-circuiting on the length check.
  const sameLength = await fetch(BASE + "/jobs/process-deletions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-deletion-job-secret": "x".repeat("test_job_secret_value".length) },
    body: "{}"
  });
  check("deletion job rejects a same-length wrong secret", sameLength.status === 401, `got ${sameLength.status}`);

  // Correct secret: Firestore is unconfigured in this harness, so 503 proves
  // authentication passed and the handler was reached.
  const ok = await fetch(BASE + "/jobs/process-deletions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-deletion-job-secret": "test_job_secret_value" },
    body: "{}"
  });
  check("deletion job accepts the correct secret", ok.status === 503, `got ${ok.status}`);

  // It must not sit behind Firebase auth -- the caller is a scheduler.
  check("deletion job is not behind Firebase token auth", ok.status !== 401);
}

console.log("\n=== account deletion endpoints require auth ===");
for (const path of ["/api/account/request-deletion", "/api/account/cancel-deletion"]) {
  const r = await post(path, {});
  // REQUIRE_FIREBASE_AUTH is false here, so req.user is absent and the
  // handler's own uid check must still refuse the call.
  check(`${path} refuses an unauthenticated call`, r.status === 401 || r.status === 403, `got ${r.status}`);
}

console.log("\n=== CORS ===");
{
  const bad = await fetch(BASE + "/health", { headers: { Origin: "https://evil.example.com" } });
  check("disallowed origin gets no ACAO header",
    !bad.headers.get("access-control-allow-origin"),
    `acao=${bad.headers.get("access-control-allow-origin")}`);
  const good = await fetch(BASE + "/health", { headers: { Origin: "https://sanitaryflow-erp.web.app" } });
  check("allowed origin is echoed",
    good.headers.get("access-control-allow-origin") === "https://sanitaryflow-erp.web.app");
}

server.kill();

console.log("\n=== production refuses to start unauthenticated ===");
{
  const proc = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../proxy/", import.meta.url),
    env: { ...process.env, ANTHROPIC_API_KEY: "k", NODE_ENV: "production", REQUIRE_FIREBASE_AUTH: "false", PORT: "8795" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => proc.on("exit", resolve));
  check("NODE_ENV=production + REQUIRE_FIREBASE_AUTH=false refuses to boot",
    code !== 0 && stderr.includes("REQUIRE_FIREBASE_AUTH must be true"),
    `exit=${code}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
