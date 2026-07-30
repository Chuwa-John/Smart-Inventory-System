// Boots the real proxy against the Firestore emulator and exercises
// /api/staff/invite-preview -- the unauthenticated endpoint the acceptance page
// calls to show who is inviting whom before anyone types a password.
//
//   firebase emulators:exec --only firestore --project sanitaryflow-erp \
//     "node invite-preview.test.mjs"
//
// It is unauthenticated by necessity (the invitee has no account yet), so the
// things worth pinning down are what it refuses to say: no raw email, no
// storeIds, no token material, and the same answer for a wrong token as for an
// invite id that does not exist.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";

const PORT = 8795;
const BASE = `http://127.0.0.1:${PORT}`;
const PROJECT_ID = "sanitaryflow-erp";
const EMULATOR = "127.0.0.1:8085";
const OWNER = "owner_preview_uid";
const BUSINESS = "Kilimanjaro Hardware";

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : "\n      " + detail}`);
}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const linkTokenFor = (inviteId, token) =>
  Buffer.from(`${OWNER}:${inviteId}:${token}`, "utf8").toString("base64url");

const preview = (linkToken) =>
  fetch(`${BASE}/api/staff/invite-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkToken })
  });

// --- seed the emulator ------------------------------------------------------
const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: "127.0.0.1", port: 8085, rules: "service cloud.firestore { match /databases/{db}/documents { match /{d=**} { allow read, write: if true; } } }" }
});
await testEnv.clearFirestore();

const liveToken = randomBytes(32).toString("hex");
const usedToken = randomBytes(32).toString("hex");
const expiredToken = randomBytes(32).toString("hex");

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "users", OWNER), { businessName: BUSINESS, email: "owner@example.com" });
  await setDoc(doc(db, "users", OWNER, "invites", "live"), {
    email: "pascalchuwa3434@gmail.com", role: "cashier", storeIds: ["all"],
    tokenHash: hashToken(liveToken), ownerUid: OWNER, used: false,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600 * 1000)
  });
  await setDoc(doc(db, "users", OWNER, "invites", "spent"), {
    email: "spent@example.com", role: "manager", storeIds: ["all"],
    tokenHash: hashToken(usedToken), ownerUid: OWNER, used: true,
    createdAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600 * 1000)
  });
  await setDoc(doc(db, "users", OWNER, "invites", "stale"), {
    email: "stale@example.com", role: "cashier", storeIds: ["all"],
    tokenHash: hashToken(expiredToken), ownerUid: OWNER, used: false,
    createdAt: new Date(Date.now() - 96 * 3600 * 1000),
    expiresAt: new Date(Date.now() - 3600 * 1000)
  });
});

// --- boot the proxy ---------------------------------------------------------
// cert() wants a well-formed key; the emulator never actually verifies it.
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
const serviceAccount = Buffer.from(JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  private_key_id: "test",
  private_key: privateKey,
  client_email: `test@${PROJECT_ID}.iam.gserviceaccount.com`,
  client_id: "1"
}), "utf8").toString("base64");

const server = spawn(process.execPath, ["server.js"], {
  cwd: new URL("../proxy/", import.meta.url),
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: "test_dummy_key",
    PORT: String(PORT),
    NODE_ENV: "development",
    REQUIRE_FIREBASE_AUTH: "false",
    CORS_ORIGINS: "https://sanitaryflow-erp.web.app",
    FIREBASE_PROJECT_ID: PROJECT_ID,
    FIREBASE_SERVICE_ACCOUNT_KEY_BASE64: serviceAccount,
    FIRESTORE_EMULATOR_HOST: EMULATOR
  },
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
  try { if ((await fetch(`${BASE}/health`)).ok) { up = true; break; } } catch {}
  await sleep(250);
}
if (!up) {
  console.error(`Proxy failed to start on ${PORT} (exit=${server.exitCode}).`);
  console.error(serverOutput || "(no output)");
  process.exit(1);
}

// --- the happy path ---------------------------------------------------------
console.log("\n=== a live invitation identifies its sender ===");
{
  const r = await preview(linkTokenFor("live", liveToken));
  const body = await r.json();
  check("live invite returns 200", r.status === 200, `got ${r.status}`);
  check("names the inviting business", body.businessName === BUSINESS, JSON.stringify(body));
  check("states the role", body.role === "cashier", JSON.stringify(body));
  check("carries an expiry", typeof body.expiresAt === "number" && body.expiresAt > Date.now());
  check("works with no Authorization header", body.ok === true);

  const raw = JSON.stringify(body);
  const hint = String(body.emailHint || "");
  check("masks the invited email",
    hint.startsWith("pa") && hint.includes("•") && hint.endsWith("@gmail.com") && !hint.includes("scalchuwa"),
    `emailHint=${hint}`);
  check("never returns the raw address", !raw.includes("pascalchuwa3434@gmail.com"), raw);
  check("never returns token material", !raw.includes("tokenHash") && !raw.includes(liveToken), raw);
  check("never returns storeIds", !raw.includes("storeIds"), raw);
}

// --- what it refuses --------------------------------------------------------
console.log("\n=== dead and forged links ===");
{
  const wrongToken = await preview(linkTokenFor("live", randomBytes(32).toString("hex")));
  const wrongBody = await wrongToken.json();
  check("wrong token is rejected", wrongToken.status === 404, `got ${wrongToken.status}`);

  const unknownId = await preview(linkTokenFor("no_such_invite", liveToken));
  const unknownBody = await unknownId.json();
  check("unknown invite id is rejected", unknownId.status === 404, `got ${unknownId.status}`);
  check("wrong token and unknown id are indistinguishable",
    wrongToken.status === unknownId.status && wrongBody.error === unknownBody.error,
    `${JSON.stringify(wrongBody)} vs ${JSON.stringify(unknownBody)}`);

  const used = await preview(linkTokenFor("spent", usedToken));
  const usedBody = await used.json();
  check("used invite returns 410 code:used", used.status === 410 && usedBody.code === "used",
    `${used.status} ${JSON.stringify(usedBody)}`);
  check("used invite does not leak the business", !JSON.stringify(usedBody).includes(BUSINESS));

  const expired = await preview(linkTokenFor("stale", expiredToken));
  const expiredBody = await expired.json();
  check("expired invite returns 410 code:expired", expired.status === 410 && expiredBody.code === "expired",
    `${expired.status} ${JSON.stringify(expiredBody)}`);

  const malformed = await preview("not-a-real-token");
  check("malformed link returns 400", malformed.status === 400, `got ${malformed.status}`);

  const wrongType = await fetch(`${BASE}/api/staff/invite-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkToken: ["array", "smuggling"] })
  });
  check("non-string linkToken returns 400", wrongType.status === 400, `got ${wrongType.status}`);
}

// The acceptance page only treats invalid/used/expired as a verdict; anything
// else keeps the form open. That matters because Hosting and Render deploy
// separately, so the page can be live against a proxy that predates this route
// -- and a bare 404 must not be mistaken for "your invitation is dead".
console.log("\n=== an unknown route stays distinguishable from a dead invite ===");
{
  const r = await fetch(`${BASE}/api/staff/invite-preview-that-does-not-exist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ linkToken: "x" })
  });
  const body = await r.json().catch(() => ({}));
  check("missing route 404s without a verdict code", r.status === 404 && !body.code,
    `${r.status} ${JSON.stringify(body)}`);
}

server.kill();
await testEnv.cleanup();

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
