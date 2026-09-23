// The eye on a password box.
//
//   node password-reveal.test.mjs
//
// Staff type these on a phone keyboard, at a till, often from a password read
// out to them. With the characters hidden a mistyped one is indistinguishable
// from a wrong password, and the natural response is to try again -- until
// Firebase answers auth/too-many-requests and locks them out of their shift
// over a typo.
//
// Two properties matter more than the feature itself:
//
//   1. The button must be type=button. Inside a form, a button with no type IS
//      a submit button, so the first press of the eye would try to sign the
//      person in with whatever half-typed password is in the box.
//   2. It must fall back to hidden. A till is shared, and a password left
//      legible for whoever opens the dialog next is a worse problem than the
//      one this solves.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const invite = readFileSync(new URL("../accept-invite.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appHtml = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const inviteHtml = readFileSync(new URL("../accept-invite.html", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

function bodyOf(src, name) {
  const start = src.indexOf(name);
  if (start === -1) return "";
  const end = src.indexOf("\n}\n", start);
  return end === -1 ? src.slice(start) : src.slice(start, end);
}

for (const [label, src] of [["app.js", app], ["accept-invite.js", invite]]) {
  console.log(`\n=== ${label} ===`);
  const body = bodyOf(src, "function enablePasswordReveal(");
  check(`${label}: enablePasswordReveal() exists`, body.length > 0);

  // THE one that would otherwise sign somebody in mid-typing.
  check(`${label}: the toggle is type=button`, /button\.type = "button";/.test(body),
    "a button in a form with no type is a submit button");

  // The input keeps its own identity: a password manager, the id the script
  // reads the value from, and the form validation all depend on it.
  check(`${label}: the input is wrapped, never replaced`,
    /wrapper\.appendChild\(input\)/.test(body) && !/input\.outerHTML|createElement\("input"\)/.test(body),
    "rebuilding it would drop id, name, autocomplete, minlength and required");

  check(`${label}: it can be called twice without stacking buttons`,
    /if \(input\.closest\("\.password-field"\)\) continue;/.test(body));

  // A shared till. This is the property that keeps the feature from becoming a
  // leak of its own.
  check(`${label}: it falls back to hidden when the form is reset`,
    /input\.form\?\.addEventListener\("reset", \(\) => setState\(false\)\)/.test(body),
    "otherwise the next person to open the form sees the last one's password");

  check(`${label}: the pressed state is announced`,
    /aria-pressed/.test(body) && /aria-label/.test(body),
    "a control with only an icon has no accessible name without it");

  check(`${label}: the caret is put back after toggling`,
    /setSelectionRange\(end, end\)/.test(body),
    "selecting the whole value instead would let the next keystroke wipe it");
}

console.log("\n=== the app shell follows the language ===");
{
  const body = bodyOf(app, "function enablePasswordReveal(");
  // translateStaticDom() re-applies [data-i18n-aria-label] on a language
  // change; a bare aria-label would freeze in whichever language was loaded.
  check("the label is declared through data-i18n-aria-label",
    /button\.dataset\.i18nAriaLabel =/.test(body),
    "an English label sitting in a Swahili form is its own bug");
  check("...and translateStaticDom re-applies that attribute",
    /\[data-i18n-aria-label\]/.test(app));
  for (const key of ["auth.showPassword", "auth.hidePassword"]) {
    check(`${key} exists in both languages`,
      (app.match(new RegExp(`"${key.replace(".", "\\.")}":`, "g")) || []).length === 2);
  }
  // Every password box in the shell is static markup, so one pass covers all
  // of them -- including the ones inside dialogs.
  check("it runs at boot, before the labels are applied",
    /enablePasswordReveal\(\);\ntranslateStaticDom\(\);/.test(app),
    "running after would leave the first render of the buttons unlabelled");
}

console.log("\n=== every password box on both pages is covered ===");
{
  const appBoxes = (appHtml.match(/type="password"/g) || []).length;
  const inviteBoxes = (inviteHtml.match(/type="password"/g) || []).length;
  check("the app shell still has password boxes to enhance", appBoxes >= 7, `${appBoxes} found`);
  check("the invite page does too", inviteBoxes >= 2, `${inviteBoxes} found`);
  // The helper selects them all rather than naming ids, so a box added later
  // is covered without anybody remembering to come back here.
  for (const [label, src] of [["app.js", app], ["accept-invite.js", invite]]) {
    check(`${label} selects every password input rather than naming ids`,
      /querySelectorAll\('input\[type="password"\]'\)/.test(src));
  }
}

console.log("\n=== it is styled without pushing the field around ===");
{
  // Comments stripped: the rules below are commented at length, and a window
  // measured from the selector would be measuring the prose.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  check("the wrapper positions the button inside the field",
    /\.password-field \{[\s\S]{0,120}position: relative;/.test(rules),
    "a button added as a grid sibling drops onto its own line on a phone");
  check("the input reserves room so text never runs under the button",
    /\.password-field > input \{[\s\S]{0,160}padding-right:/.test(rules));
  check("the button matches the input's height",
    /\.password-reveal \{[\s\S]{0,200}height: 100%;/.test(rules),
    "the wrapper holds only the input and the button, so 100% is the field height");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f.name}`).join("\n"));
  process.exit(1);
}
