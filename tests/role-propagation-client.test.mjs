// The client must WATCH its own membership, not read it once.
//
//   node role-propagation-client.test.mjs
//
// rules-role-propagation.test.mjs proves the boundary moves the instant an
// owner changes a member document. This file covers the half that rules cannot
// see: whether the browser in front of the cashier notices.
//
// It did not. state.currentUserRole was resolved once at sign-in and never
// again, so an owner demoting a manager mid-shift changed nothing visible --
// firestore.rules refused the writes, but the till kept offering void, return
// and credit-limit controls until someone reloaded. "Hide, don't disable"
// exists precisely so a control that will be refused is never shown; a stale
// role turns the whole gating layer into disable-by-failure at the one moment
// trust has just been withdrawn. A POS tab can stay open all day.
//
// Structural assertions, like lazy-libraries and brand-coherence: they cannot
// run the app, but they can prove the wiring is still there. Every check below
// corresponds to a way this regressed or could regress.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

const fn = (name) => {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) return null;
  // Far enough to cover the body without parsing braces.
  return app.slice(start, start + 2600);
};

console.log("=== the subscription exists and is wired into sign-in ===");
const sub = fn("subscribeToOwnMembership");
check("subscribeToOwnMembership() is defined", Boolean(sub));
check("it is called during the signed-in branch", /\n\s*subscribeToOwnMembership\(\);/.test(app),
  "defined but never called -- the listener would never start");
check("it is torn down on sign-out", app.includes("state.unsubscribeOwnMembership = null"),
  "a listener that survives sign-out leaks, and can fire against the next user");
check("state carries the unsubscribe handle", /unsubscribeOwnMembership:\s*null/.test(app));

console.log("\n=== it watches, rather than reads once ===");
check("it uses onSnapshot", Boolean(sub && sub.includes("onSnapshot")),
  "a getDoc here would reintroduce the original defect exactly");
check("it targets the member's own document", Boolean(sub &&
  /"users",\s*state\.businessOwnerUid,\s*"members",\s*state\.user\.uid/.test(sub)),
  "must be the single self-doc: the members COLLECTION is owner-only by rule");

console.log("\n=== a role change reaches the UI ===");
check("it assigns state.currentUserRole", Boolean(sub && /state\.currentUserRole\s*=/.test(sub)));
check("it re-renders after a change", Boolean(sub && sub.includes("renderAll()")),
  "updating the role without re-rendering leaves the stale buttons on screen");
check("it clears the member doc cache on change", Boolean(sub && sub.includes("clearMemberDocCache()")),
  "a cached member doc would serve the old storeIds to query scoping");

console.log("\n=== losing access ends the session ===");
const ended = fn("handleMembershipEnded");
check("handleMembershipEnded() is defined", Boolean(ended));
check("a missing or non-active member triggers it", Boolean(sub &&
  /status\s*!==\s*"active"/.test(sub) && sub.includes("handleMembershipEnded()")),
  "revocation is a hard delete and suspension flips status -- both must end the session");
check("it signs the user out", Boolean(ended && ended.includes("signOut")),
  "leaving them signed in gives a till that looks alive and refuses every touch");
check("it is latched so it fires once", Boolean(ended && ended.includes("state.membershipEnded")),
  "without a latch the listener can re-enter sign-out as it settles");
check("the latch is cleared on sign-in", /state\.membershipEnded\s*=\s*false/.test(app),
  "a reinstated member must be able to sign in again without reloading the page");

console.log("\n=== it fails closed ===");
check("a listener error drops to the most restrictive role", Boolean(sub &&
  /console\.warn\([^)]*membership[\s\S]{0,220}state\.currentUserRole\s*=\s*"cashier"/i.test(sub)),
  "a dead listener cannot be told apart from a demotion, so it must not keep the cached role");
check("the owner is skipped", Boolean(sub && sub.includes("state.user.uid === state.businessOwnerUid")),
  "the owner has no member document; subscribing would fail for every owner");

console.log("\n=== the message exists in both languages ===");
const keyCount = (app.match(/"auth\.accessRemoved"/g) || []).length;
check("auth.accessRemoved is defined in English and Kiswahili", keyCount >= 2,
  `found ${keyCount} definition(s) -- both dictionaries need it or one language shows a raw key`);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
