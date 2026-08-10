// The landing page and the app must be one product, not two that share a name.
//
//   node brand-coherence.test.mjs
//
// They drifted apart once already: the landing page was built with its own
// palette -- cream paper, brick red -- while the app is a cool grey and green.
// Someone clicking "Get started" crossed a visible seam into what looked like a
// different company.
//
// The palette now comes from the app's light theme, but it is COPIED into
// landing.html rather than shared, because extracting a token file would mean
// restructuring the stylesheet of a live system for a cosmetic gain. Copies
// drift. So this pins them, the same way validation-limits.test.mjs pins the
// length limits that live in three deploy units.
//
// It also checks the two pages actually reach each other. A landing page whose
// call to action goes nowhere is a brochure.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const landing = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const index = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const invite = readFileSync(new URL("../accept-invite.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// --- the app's light theme, which is the brand ------------------------------
function appLightToken(name) {
  const block = css.slice(css.indexOf('[data-theme="light"]'));
  const m = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}
function landingToken(name) {
  const block = landing.slice(landing.indexOf(":root"), landing.indexOf("*, *::before"));
  const m = block.match(new RegExp(`--${name}:\\s*([^;/]+)`));
  return m ? m[1].trim() : null;
}

console.log("=== the landing page wears the product's colours ===");
{
  // Each pair is landing token -> the app light-theme token it must equal.
  const pairs = [
    ["paper", "bg", "page background"],
    ["paper-warm", "panel-soft", "alternating band"],
    ["ink", "text", "body text"],
    ["ink-faint", "muted", "secondary text"],
    ["rule", "line", "hairlines"],
    ["accent", "accent", "the one action colour"],
    ["red", "red", "a drawer that is short"]
  ];
  for (const [land, appName, what] of pairs) {
    const a = landingToken(land);
    const b = appLightToken(appName);
    check(`${what}: landing --${land} matches app --${appName}`, Boolean(a && b && a === b),
      `landing "${a}" vs app "${b}"`);
  }
  check("the accent is the app's, not a second green",
    landingToken("accent") === appLightToken("accent"),
    "two greens read as two companies");
}

console.log("\n=== the two pages reach each other ===");
{
  check("every landing call to action enters the app",
    !/href="#start"/.test(landing),
    "a CTA pointing at an anchor on its own page goes nowhere");
  check("there is a way to start", /href="\.\/app\.html"/.test(landing));
  check("there is a separate way in for people who already have an account",
    /href="\.\/app\.html\?mode=signin"/.test(landing));
  check("the app can be deep-linked into sign-in",
    /URLSearchParams\(location\.search\)\.get\("mode"\) === "signin"/.test(app),
    "otherwise the Sign in link lands on a signup form");
  check("signup is still the default for a bare visit",
    /\? "signin" : "signup"/.test(app));
  check("the app links back to what the product is",
    /href="\.\/"/.test(index));
  check("that link is translated like everything else",
    /data-i18n="auth\.aboutLink"/.test(index) &&
    (app.match(/"auth\.aboutLink":/g) || []).length === 2);
}

console.log("\n=== the sign-in screen is part of the same story ===");
{
  check("the auth panel is split into an argument and a form",
    /class="auth-brand"/.test(index) && /class="auth-fields"/.test(index));
  check("it repeats the figures the landing page opens with",
    /class="auth-ledger"/.test(index));
  // The split was a wrap, not a rebuild: every field kept its id and stayed
  // inside the form. That is what made it safe to touch an auth screen at all.
  for (const id of ["businessName", "authEmail", "authPassword", "authConfirmPassword",
                    "authConsent", "authSubmitButton", "authModeButton"]) {
    const inForm = index.slice(index.indexOf('id="authForm"'), index.indexOf("</form>", index.indexOf('id="authForm"')));
    check(`#${id} is still inside the form`, inForm.includes(`id="${id}"`));
  }
  check("the pitch is hidden on a phone, where the form is all that is wanted",
    /@media \(max-width: 900px\)[\s\S]{0,400}\.auth-brand \{ display: none; \}/.test(css));
}

console.log("\n=== the invite page is laid out by its own rules ===");
{
  // This is the regression, not a style preference. accept-invite.html was
  // written when .auth-panel was a centred card and kept the class after the
  // sign-in gate was rebuilt as a two-pane grid. Its plain <div>s were then
  // auto-placed into two columns -- heading top-left, invite context
  // top-right, fields underneath, no card at all -- and nothing failed,
  // because no test knew the two pages shared a class.
  check("it does not borrow the sign-in gate's grid",
    !/class="auth-panel"/.test(invite) && !/class="auth-gate"/.test(invite),
    "those are shaped for a two-pane pitch and will scatter this page's children");
  check("it has a container of its own",
    /class="invite-gate"/.test(invite) && /class="invite-panel"/.test(invite));
  check("that container is a single column",
    /\.invite-panel \{[^}]*display: grid;/.test(css) &&
    !/\.invite-panel \{[^}]*grid-template-columns/.test(css));
  // The whole point of the page. .auth-brand is display:none below 900px, so
  // laying this out with it would hide who invited you and as what -- on the
  // phone the invitation email was opened on, which is where most staff are.
  check("nothing on it is hidden on a phone",
    !/class="auth-brand"/.test(invite),
    "who invited you, and as what, is the one thing this page must say");
  check("the fields carry their own spacing",
    /class="invite-fields" id="acceptInviteFormFields"/.test(invite) &&
    /class="invite-fields" id="inviteVerifySection"/.test(invite));
  // Same rule as the sign-in gate above: this was a re-wrap, not a rebuild.
  // accept-invite.js reaches every one of these by id and nothing by position.
  const inviteForm = invite.slice(invite.indexOf('id="acceptInviteForm"'),
    invite.indexOf("</form>", invite.indexOf('id="acceptInviteForm"')));
  for (const id of ["acceptInviteIntro", "inviteContextBox", "inviteContextHeading",
                    "inviteContextText", "inviteFullName", "inviteEmail", "invitePassword",
                    "inviteConfirmPassword", "inviteConfirmPasswordRow", "acceptInviteError",
                    "acceptInviteSubmitButton", "inviteVerifySection", "inviteVerifyError",
                    "inviteVerifyContinueButton", "inviteResendVerificationButton"]) {
    check(`#${id} is still inside the form`, inviteForm.includes(`id="${id}"`));
  }
}

console.log("\n=== the landing page is a real page, not a mock ===");
{
  check("it ships in the repo, not only as an artifact", landing.length > 4000);
  check("it carries a description for search and sharing",
    /<meta name="description"/.test(landing));
  check("it declares a language", /<html lang="en">/.test(landing));
  check("it loads nothing from outside this origin",
    !/https?:\/\/(?!schema)/.test(landing.replace(/<!--[\s\S]*?-->/g, "")),
    "an external font or script would be blocked by the production CSP");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
