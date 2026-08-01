// Guards QA-011 and QA-012: what the API says when it says no.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node api-contract.test.mjs"
//
// Two defects, one subject. A GET to a POST-only route matched no handler and
// fell through to "Not found", sending the caller hunting for a typo in a URL
// that was correct. And errors came back in four different shapes -- some with
// `ok`, some with only `error`, some keyed on `authorized` or `allowed` -- so
// no single client check could tell success from failure.
//
// The shapes could not simply be replaced: app.js reads `authorized` by name
// off the override endpoint, and accept-invite.js reads `ok` and `code`. So
// `ok` was ADDED everywhere rather than swapped in, and this test pins both
// halves -- the new envelope and the old discriminators that clients still
// depend on.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";

const PROJECT_ID = "sanitaryflow-erp";
const EMULATOR = "127.0.0.1:8085";
const source = readFileSync(new URL("../proxy/server.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : "\n      " + detail}`);
}

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const serviceAccount = Buffer.from(JSON.stringify({
  type: "service_account", project_id: PROJECT_ID, private_key_id: "test",
  private_key: privateKey, client_email: `test@${PROJECT_ID}.iam.gserviceaccount.com`, client_id: "1"
}), "utf8").toString("base64");

async function boot(port, requireAuth) {
  const server = spawn(process.execPath, ["server.js"], {
    cwd: new URL("../proxy/", import.meta.url),
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "test_dummy_key",
      PORT: String(port),
      NODE_ENV: "development",
      REQUIRE_FIREBASE_AUTH: String(requireAuth),
      CORS_ORIGINS: "https://sanitaryflow-erp.web.app",
      FIREBASE_PROJECT_ID: PROJECT_ID,
      FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: serviceAccount,
      FIRESTORE_EMULATOR_HOST: EMULATOR
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (d) => (output += d));
  server.stderr.on("data", (d) => (output += d));
  process.on("exit", () => server.kill());
  // Same 60s budget as invite-preview.test.mjs, and for the same reason: cold
  // module loading is seconds, and much more on a machine still busy.
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) break;
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return server; } catch {}
    await sleep(500);
  }
  console.error(`Proxy failed to start on ${port} (exit=${server.exitCode}).\n${output || "(no output)"}`);
  process.exit(1);
}

const PORT = 8796;
const BASE = `http://127.0.0.1:${PORT}`;
const server = await boot(PORT, false);

console.log("=== a known path with the wrong method says so (QA-011) ===");
{
  // Previously 404: "Not found" for a path that plainly exists.
  const r = await fetch(`${BASE}/api/staff/invite-preview`, { method: "GET" });
  const body = await r.json().catch(() => ({}));
  check("GET on a POST-only route returns 405, not 404", r.status === 405, `got ${r.status}`);
  check("the response carries an Allow header", r.headers.get("allow") === "POST",
    `Allow: ${r.headers.get("allow")}`);
  check("the message names the method and the alternative",
    /GET/.test(body.error || "") && /POST/.test(body.error || ""), JSON.stringify(body));
  check("it uses the standard envelope", body.ok === false, JSON.stringify(body));

  const post = await fetch(`${BASE}/health`, { method: "POST" });
  check("POST on a GET-only route returns 405", post.status === 405, `got ${post.status}`);
  check("...and advertises GET", post.headers.get("allow") === "GET", `Allow: ${post.headers.get("allow")}`);

  const del = await fetch(`${BASE}/api/ai/advisor`, { method: "DELETE" });
  check("an exotic method on a real route is 405 too", del.status === 405, `got ${del.status}`);
}

console.log("\n=== a genuinely unknown path is still 404 ===");
{
  const r = await fetch(`${BASE}/api/does-not-exist`, { method: "GET" });
  const body = await r.json().catch(() => ({}));
  check("unknown path returns 404", r.status === 404, `got ${r.status}`);
  check("404 carries no Allow header", r.headers.get("allow") === null);
  check("404 uses the standard envelope", body.ok === false && typeof body.error === "string",
    JSON.stringify(body));
}

console.log("\n=== malformed input is named, not reported as a fault ===");
{
  const r = await fetch(`${BASE}/api/staff/invite-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json"
  });
  const body = await r.json().catch(() => ({}));
  check("a broken JSON body is 400, not 500", r.status === 400, `got ${r.status}`);
  check("the message says the body is the problem", /JSON/i.test(body.error || ""), JSON.stringify(body));
  check("it uses the standard envelope", body.ok === false);
}

console.log("\n=== every error answers in one shape (QA-012) ===");
{
  // Checked at the source, because most branches need credentials or a
  // provider to reach at runtime.
  const errorResponses = [...source.matchAll(/res\.status\(([^)]*)\)\.json\((\{[^}]*\})\)/g)]
    .filter(([, status]) => /^\s*(4|5)\d{2}\s*$/.test(status) || /\?\s*\d{3}\s*:\s*(4|5)\d{2}/.test(status));
  check("error responses were found in the source", errorResponses.length >= 40,
    `${errorResponses.length} found`);

  const missingOk = errorResponses.filter(([, , body]) => !/\bok\b\s*[,:]/.test(body));
  check("every error response carries ok", missingOk.length === 0,
    missingOk.map(([m]) => m.slice(0, 70)).join("\n      "));

  // Scoped to responses that are ALWAYS an error. One route answers
  // `res.status(ok ? 200 : 401)` from a single expression, so its body is
  // shared with the success case; the client renders its own translated text
  // for a wrong password rather than echoing the server's.
  const alwaysError = errorResponses.filter(([, status]) => /^\s*(4|5)\d{2}\s*$/.test(status));
  const missingMessage = alwaysError.filter(([, , body]) => !/error:/.test(body));
  check("every unconditional error response carries a message", missingMessage.length === 0,
    missingMessage.map(([m]) => m.slice(0, 70)).join("\n      "));

  const dupes = [...source.matchAll(/\{\s*ok:[^}]*\bok:/g)];
  check("no response declares ok twice", dupes.length === 0, `${dupes.length} found`);
}

console.log("\n=== the discriminators clients read by name still exist ===");
{
  // Removing these would silently break flows: app.js destructures
  // `authorized`, accept-invite.js branches on `code`.
  check("the override endpoint still returns authorized", /authorized:\s*(ok|false|true)/.test(source));
  check("the auth-limit endpoint still returns allowed", /allowed:\s*(false|true)/.test(source));
  check("invite failures still carry a code", /code:\s*"(invalid|used|expired)"/.test(source));

  const client = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  check("app.js still reads authorized (so it must keep being sent)",
    /const \{ authorized \} = await response\.json\(\)/.test(client));
  const invite = readFileSync(new URL("../accept-invite.js", import.meta.url), "utf8");
  check("accept-invite.js still reads ok and code",
    /payload\.ok/.test(invite) && /payload\.code/.test(invite));
}

console.log("\n=== auth still answers before method (QA-011 ordering) ===");
{
  // A 405 to an anonymous probe would confirm which paths exist. verifyFirebaseToken
  // is mounted above every /api/ route, so 401 must win -- this is the part of
  // the original report that was correct behaviour, not a defect.
  const AUTH_PORT = 8797;
  const authServer = await boot(AUTH_PORT, true);
  const r = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/ai/advisor`, { method: "GET" });
  check("an unauthenticated GET to a POST-only /api route is 401, not 405",
    r.status === 401, `got ${r.status}`);
  check("no Allow header leaks to an unauthenticated caller",
    r.headers.get("allow") === null, `Allow: ${r.headers.get("allow")}`);

  // Even the deliberately public invite-preview endpoint answers 401 to a GET
  // once auth is required, and that is right. Its exemption comes from the POST
  // route being registered above the auth middleware -- a route matches on path
  // AND method, so a GET never matches it and flows on into verifyFirebaseToken,
  // which covers /api/ for every method. The public hole is exactly one method
  // wide, which is what it should be.
  const open = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/staff/invite-preview`, { method: "GET" });
  check("the public endpoint's exemption is method-specific, so a GET is still 401",
    open.status === 401, `got ${open.status}`);
  const openPost = await fetch(`http://127.0.0.1:${AUTH_PORT}/api/staff/invite-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkToken: "not-a-real-token" })
  });
  check("...while its POST is still reachable without a token",
    openPost.status !== 401, `got ${openPost.status}`);
  authServer.kill();
}

server.kill();

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
