// Light is the default, and a choice is remembered.
//
//   node theme-default.test.mjs
//
// Two separate claims, and the second one is the one that used to be false: the
// toggle set data-theme and stored nothing, so a shop that wanted dark got the
// default back on the next reload, every time, with nothing to show why.
//
// The default is set by ATTRIBUTE -- :root stays the dark palette and
// [data-theme="light"] stays the override -- so the rule to hold on to is that
// NO attribute means dark. Inverting every token in a live app to change a
// default would be a large change for a small reason.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const css = read("styles.css");
const app = read("app.html");
const boot = read("boot.js");
const src = read("app.js");

const results = [];
function check(name, actual, expected = true) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) console.log(`      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log("=== every page that uses the app stylesheet opens light ===");
{
  // Not just app.html: a staff member accepting an invite, or anyone reading
  // the terms, should not be handed a different theme from the app they are
  // joining.
  for (const page of ["app.html", "terms.html", "privacy-policy.html", "accept-invite.html"]) {
    const html = read(page);
    check(`${page} ships data-theme="light"`,
      /<html[^>]*data-theme="light"/.test(html));
  }
  // The browser chrome is painted from this before any CSS loads, so a dark
  // value here is a dark bar above a light app.
  const lightBg = (css.match(/\[data-theme="light"\][\s\S]{0,200}?--bg:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
  check("the light palette has a background", Boolean(lightBg));
  check("app.html's theme-color matches it",
    new RegExp(`<meta name="theme-color" content="${lightBg}"`, "i").test(app));
}

console.log("\n=== both palettes still exist, and dark is still reachable ===");
{
  check("the dark palette is still :root", /:root \{\s*\n\s*color-scheme: dark;/.test(css));
  check("the light palette is still the override", css.includes('[data-theme="light"]'));
  check("there is still a toggle", /id="themeButton"/.test(app));
  // The button names where it takes you. Light app, so it offers Dark.
  check("it ships saying Dark", /id="themeButton"[^>]*>Dark</.test(app));
  check("...and one function keeps it in step",
    /function syncThemeButtonLabel\(\)/.test(src));
  check("...called on the first paint", /syncThemeButtonLabel\(\);\s*\n\s*qs\("#chartRange"\)/.test(src)
    || /syncThemeButtonLabel\(\);/.test(src));
  // translateStaticDom() cannot help here: the button carries no data-i18n,
  // because app.js owns its text. So a language change has to say so.
  check("...and again on a language change",
    /renderVatControls\(\);\s*\n\s*syncThemeButtonLabel\(\);/.test(src));
}

console.log("\n=== the choice is remembered, and restored before the first paint ===");
{
  check("the toggle writes the choice", /localStorage\.setItem\("savia\.theme"/.test(src));
  check("...and survives storage being blocked", /catch \(error\) \{[\s\S]{0,160}Could not remember the theme/.test(src));

  // In boot.js, not app.js: boot.js is in the <head>, app.js is a large module
  // below it, and restoring the theme there would paint the wrong one first.
  check("boot.js restores it", /localStorage\.getItem\("savia\.theme"\)/.test(boot));
  check("...before the app is revealed",
    boot.indexOf('getItem("savia.theme")') < boot.indexOf('classList.remove("js-pending")'));
  check("...treating only dark as something to undo",
    /savedTheme === "dark"[\s\S]{0,120}removeAttribute\("data-theme"\)/.test(boot));
  // localStorage is writable by anything on this origin, so an unexpected value
  // must fall through to the default rather than be applied.
  check("...and ignoring anything else stored",
    /savedTheme === "light"/.test(boot) && !/dataset\.theme = savedTheme/.test(boot));
  check("boot.js survives storage being blocked", /catch \(error\) \{/.test(boot));

  // The CSP is script-src 'self' with no 'unsafe-inline', so this work cannot
  // move into the page as an inline script -- it would be blocked in silence.
  check("the restore is not an inline script", /<script(?![^>]*src=)[^>]*>[\s\S]*savia\.theme/.test(app), false);
  check("boot.js is still a module, so an old browser keeps the notice",
    /<script type="module" src="\.\/boot\.js/.test(app));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(failed.map((f) => "  FAILED: " + f.name).join("\n"));
  process.exit(1);
}
