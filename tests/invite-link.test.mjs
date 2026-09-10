// The staff invite link.
//
//   node invite-link.test.mjs
//
// An invite link that is wrong, or that cannot be got out of the app, is an
// invitation the server has already issued and nobody can accept. Two ways
// that happens:
//
//   1. THE URL POINTS AT THE WRONG PAGE. It is built by replacing the current
//      filename, so it has to survive being generated from /app.html, from a
//      directory root, and from a path with no trailing file at all. Pointing
//      at app.html would land the invitee on a sign-in screen for an account
//      they do not have yet.
//   2. THE OWNER CANNOT REACH IT. Copy Link and WhatsApp were the only routes,
//      and both hand the job to something the browser may refuse -- a
//      clipboard write needs a focused document and otherwise fails with
//      NotAllowedError. Reported on 2026-09-10: the copy silently did nothing
//      and the owner pasted a stale clipboard entry instead, believing the app
//      had generated the wrong link.
//
// The real function is evaluated out of app.js.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");

const results = [];
function check(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function extract(name) {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  if (start === -1) throw new Error(`${name} not found`);
  let i = src.indexOf("{", src.indexOf(")", start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}

const build = (origin, pathname) => new Function("window", `
  ${extract("buildStaffInviteAcceptUrl")}
  return buildStaffInviteAcceptUrl;
`)({ location: { origin, pathname } });

console.log("=== the link points at the page that accepts invites ===");
{
  const cases = [
    ["https://sanitaryflow-erp.web.app", "/app.html"],
    ["https://sanitaryflow-erp.web.app", "/"],
    ["http://localhost:5173", "/app.html"],
    ["https://example.com", "/shop/app.html"]
  ];
  for (const [origin, pathname] of cases) {
    const url = build(origin, pathname)("TOKEN123");
    check(`${origin}${pathname} -> accept-invite.html`,
      url.includes("accept-invite.html?accept-invite=TOKEN123"), true);
    // Landing on app.html would show a sign-in form to somebody who has no
    // account yet, which is exactly what the invite is meant to create.
    check(`...and never app.html`, /\/app\.html\?/.test(url), false);
    check(`...on the right origin`, url.startsWith(origin + "/"), true);
  }
  // A path with no trailing filename must not swallow the last directory.
  check("a directory path keeps its directory",
    build("https://example.com", "/shop/")("T"),
    "https://example.com/shop/accept-invite.html?accept-invite=T");
}

console.log("\n=== the token survives the trip ===");
{
  // Tokens go into a query string and are hash-checked on the server. A stray
  // unencoded character means the invitee is told their valid invite is dead.
  const url = build("https://x.test", "/app.html")("a+b/c=d&e");
  check("it is percent-encoded", url.endsWith("accept-invite=a%2Bb%2Fc%3Dd%26e"), true);
  const fn = extract("buildStaffInviteAcceptUrl");
  check("...by encodeURIComponent", /encodeURIComponent\(linkToken\)/.test(fn), true);
}

console.log("\n=== the owner can always reach the link ===");
{
  // THE fix. Copy Link and WhatsApp both depend on something that can refuse;
  // this cannot.
  check("the link is shown on screen", html.includes('id="inviteLinkText"'), true);
  check("...inside the invite result panel",
    html.indexOf('id="inviteLinkText"') > html.indexOf('id="inviteStaffResultSection"')
    && html.indexOf('id="inviteLinkText"') < html.indexOf('id="copyInviteLinkButton"'), true);
  // Readonly, not disabled: a disabled input cannot be selected or copied,
  // which would defeat the entire point of showing it.
  check("it is readonly", /id="inviteLinkText"[^>]*\breadonly/.test(html), true);
  check("...and not disabled", /id="inviteLinkText"[^>]*\bdisabled/.test(html), false);
  check("it is labelled", html.includes('data-i18n="staff.inviteLinkLabel"'), true);
  // Populated from the same builder the copy button uses, so the shown link
  // and the copied link can never differ.
  check("it is filled from the same builder",
    /linkField\.value = buildStaffInviteAcceptUrl\(payload\.linkToken\)/.test(src), true);
}

console.log("\n=== a refused clipboard is not a dead end ===");
{
  const fn = extract("copyInviteLink");
  check("failure names the shown link", /staff\.copyFailedUseLink/.test(fn), true);
  check("...and puts the cursor in it", /field\.focus\(\)/.test(fn), true);
  // The old message just said it failed, leaving the owner with an invite they
  // could not deliver.
  check("the dead-end message is gone", /staff\.copyFailed"/.test(fn), false);
  // Optional chaining: a browser with no clipboard API at all must not throw
  // an uncaught TypeError over a button press.
  check("a missing clipboard API does not throw",
    /navigator\.clipboard\?\./.test(fn), true);
  // The bare URL, nothing else: pasting a whole message into an address bar
  // folded the surrounding sentence into the query string and broke the token.
  check("only the URL is copied",
    /writeText\(acceptUrl\)/.test(fn), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["staff.inviteLinkLabel", "staff.copyFailedUseLink", "staff.linkCopied"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
