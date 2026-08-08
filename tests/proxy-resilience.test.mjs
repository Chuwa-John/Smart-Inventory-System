// Phase 7 — QA-108, QA-109, QA-115, QA-116: four ways the proxy cost the shop
// something it never agreed to.
//
//   node proxy-resilience.test.mjs
//
// proxy-security.test.mjs boots the real server and drives it over HTTP; it
// covers auth, CORS, headers and the deletion job. These four are not reachable
// that way without either a real Anthropic key or a fifteen-minute wall clock,
// so they are asserted structurally against the source instead. Where a thing
// CAN be executed, it is — the quota bucket arithmetic below is run, not read.
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../proxy/server.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Comments stripped before matching: assertions in this codebase have passed by
// matching an explanatory note rather than the code beneath it.
const code = server.replace(/\/\/[^\n]*/g, "");

function extractFn(name, src = code) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("(", start), parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  let depth = 0;
  i = src.indexOf("{", i);
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

console.log("=== an email alone cannot lock a shop out of its own till (QA-108) ===");
{
  const limiter = code.slice(code.indexOf("const authAttemptLimiter"), code.indexOf("app.post(\"/api/auth/check-limit\""));

  check("the limiter exists and is bounded", /limit: \d+/.test(limiter) && /windowMs/.test(limiter));
  check("the key is not the email alone", !/keyGenerator: \(req\) => readString\(req\.body\?\.email\)\.trim\(\)\.toLowerCase\(\) \|\| req\.ip/.test(limiter),
    "five unauthenticated POSTs with a known address locked that address out for fifteen minutes");
  check("the key combines the address with the source", /req\.ip/.test(limiter) && /email/.test(limiter),
    "email alone lets a third party burn the owner's budget; source alone stops protecting the account");

  // Run the real key generator over the cases that matter.
  const keyGen = new Function("readString", `
    const rateLimit = (opts) => opts;
    ${limiter}
    return authAttemptLimiter.keyGenerator;
  `)((v) => (typeof v === "string" ? v : ""));

  const owner = keyGen({ body: { email: "Owner@Shop.co.tz" }, ip: "1.1.1.1" });
  const attacker = keyGen({ body: { email: "owner@shop.co.tz" }, ip: "9.9.9.9" });
  check("the same email from a different source is a different bucket", owner !== attacker,
    `${owner} vs ${attacker} — if these matched, an attacker would spend the owner's attempts`);
  check("the same email from the same source is the same bucket",
    keyGen({ body: { email: "owner@shop.co.tz" }, ip: "1.1.1.1" }) === owner,
    "otherwise a password guesser gets unlimited tries and the limiter does nothing");
  check("the address is still normalised", owner.startsWith("owner@shop.co.tz"),
    "case-sensitivity would hand out a fresh budget per capitalisation");
  check("a missing address falls back to the source", keyGen({ body: {}, ip: "2.2.2.2" }) === "2.2.2.2",
    "an empty key would put every anonymous caller in one bucket");
}

console.log("\n=== a refund credits the bucket that was charged (QA-109) ===");
{
  const refund = extractFn("refundAiQuestion");

  // Signature only — extractFn slices from `function <name>(`, so the `async`
  // keyword in front of it is never in the extracted text.
  check("the refund takes the bucket it is refunding", /function refundAiQuestion\(ownerUid, periodKey, bucket\)/.test(refund),
    "hardcoding a field cannot be right for two buckets");
  check("...and is still async", /async function refundAiQuestion/.test(code),
    "it runs a transaction; losing await here would drop the refund silently");
  check("it reads the field it was given", /snap\.get\(usedField\)/.test(refund),
    "reading `used` for a report refund reads the wrong counter");
  check("it writes the field it was given", /\[usedField\]: used - 1/.test(refund),
    "writing `used` for a report refund decrements the chat quota — a free question per failure");
  check("neither side hardcodes the chat field", !/snap\.get\("used"\)/.test(refund) && !/\{ used: used - 1 \}/.test(refund));
  check("a missing bucket refuses rather than guessing", /if \(!usedField\)/.test(refund),
    "defaulting to a bucket is how this went wrong in the first place");

  check("the call site passes the bucket", /refundAiQuestion\(ownerUid, reservation\.periodKey, bucket\)/.test(code),
    "the parameter is useless if the one caller does not supply it");

  // The two buckets must genuinely be different fields, or none of this matters.
  const chat = code.match(/chat: \{ usedField: "([^"]+)"/)?.[1];
  const report = code.match(/report: \{ usedField: "([^"]+)"/)?.[1];
  check("chat and report are separate counters", Boolean(chat && report) && chat !== report,
    `chat=${chat} report=${report}`);

  // Symmetry: whatever reserve charges, refund must be able to give back.
  const reserve = extractFn("reserveAiQuestion");
  check("reserve charges by bucket", /bucket\.usedField/.test(reserve));
  check("...and refund refunds by bucket", /usedField/.test(refund),
    "an asymmetry here is a quota that drifts in one direction only");
}

console.log("\n=== the trusted half of the prompt takes no free text (QA-115) ===");
{
  const compact = extractFn("compactSnapshot");

  check("businessType is whitelisted", /AI_BUSINESS_TYPES\.has\(snapshot\.businessType\)/.test(compact),
    "it is interpolated into the TRUSTED instruction block, above the line that marks "
    + "everything after it as untrusted data — truncating to 40 chars bounded the length, not the content");
  check("...and is not merely truncated", !/snapshot\.businessType\.slice\(0, 40\)/.test(compact));
  check("anything unrecognised becomes general", /: "general"/.test(compact));

  const allowed = code.match(/const AI_BUSINESS_TYPES = new Set\(\[([^\]]+)\]\)/)?.[1] ?? "";
  check("the allowed set is small and closed", allowed.split(",").length >= 4 && allowed.length < 200, allowed.trim());
  check("it matches the types the app offers",
    ["duka", "salon", "hardware", "pharmacy", "bar", "general"].every((t) => allowed.includes(`"${t}"`)),
    "a type the app can set but the proxy rejects silently degrades every answer for that shop");

  // language was already whitelisted; this is the pattern being followed.
  check("language is still whitelisted too", /snapshot\.language === "sw" \? "sw" : "en"/.test(compact));
}

console.log("\n=== the model call cannot outlive the client (QA-116) ===");
{
  const budget = Number(code.match(/const ANTHROPIC_TIMEOUT_MS = (\d+);/)?.[1] ?? 0);
  check("the request carries a timeout", /timeout: ANTHROPIC_TIMEOUT_MS/.test(code),
    "the SDK default is ten minutes; the client aborts at 60s, so past that the tokens are "
    + "billed and the quota charged for an answer nobody receives");
  check("the budget is set", budget > 0, `${budget}ms`);
  check("...and is far below the SDK default", budget < 10 * 60 * 1000, `${budget}ms vs 600000ms`);
  check("...and slightly above the client's own abort", budget > 60000 && budget <= 120000,
    `${budget}ms — below the client's 60s and a request that would just make it is cut off by a race`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
