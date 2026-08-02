// Guards the keyboard and focus behaviour of the command palette and shell.
//
//   node keyboard-focus.test.mjs
//
// The palette is opened with a keyboard shortcut and could not be operated with
// a keyboard. Results were plain <div>s: nothing was focusable, nothing could be
// activated without a mouse. It was also marked aria-hidden="true" in the markup
// with the attribute never updated, so it stayed invisible to assistive
// technology while visibly open -- and focus was moved INTO that hidden subtree,
// which tells a screen reader the element holding focus does not exist.
//
// All 15 <dialog>s use showModal(), which supplies focus trapping, Escape and
// background inertness for free. The palette is a plain div and gets none of it,
// so the behaviour is supplied here and pinned below.
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Walks the parameter list to its closing paren BEFORE looking for the body's
// opening brace. A destructured default like ({ restoreFocus = true } = {})
// puts braces in the signature, and matching from the first one returns the
// parameter object as though it were the function body -- which reads as five
// assertions failing against correct code.
function extractFn(name) {
  const start = app.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in app.js`);
  let i = app.indexOf("(", start);
  let parens = 0;
  for (; i < app.length; i++) {
    if (app[i] === "(") parens++;
    else if (app[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  let depth = 0;
  i = app.indexOf("{", i);
  for (; i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}") { depth--; if (depth === 0) break; }
  }
  return app.slice(start, i + 1);
}

console.log("=== dialogs keep using the platform's own modal behaviour ===");
{
  const dialogs = (html.match(/<dialog/g) || []).length;
  const showModal = (app.match(/\.showModal\(\)/g) || []).length;
  const nonModal = (app.match(/\.show\(\)/g) || []).length;
  check("every dialog in the shell is accounted for", dialogs >= 15, `${dialogs} found`);
  check("all are opened with showModal(), not show()",
    showModal >= dialogs && nonModal === 0,
    `showModal=${showModal}, show=${nonModal} — show() gives no focus trap or Escape`);
}

console.log("\n=== the palette can be operated by the keyboard that opened it ===");
{
  const render = extractFn("renderCommands");
  check("results are buttons, not divs", /<button type="button" class="command-result"/.test(render),
    "a div is not focusable and cannot be activated by Enter or Space");
  check("results are not divs any more", !/<div class="command-result"/.test(render));
  // Deliberately plain buttons rather than listbox/option: real DOM focus moves
  // to each result, so a button is announced correctly and Enter just works.
  // aria-selected is not valid on role=button, and role=option on a button is a
  // mismatch that helps no one.
  check("no invalid roles are bolted onto the buttons",
    !/role="option"/.test(render) && !/aria-selected/.test(render));

  const keys = extractFn("handleCommandPaletteKeys");
  check("ArrowDown and ArrowUp move between results", /ArrowDown/.test(keys) && /ArrowUp/.test(keys));
  check("arrow navigation wraps rather than dead-ending",
    /% items\.length/.test(keys) && /items\.length - 1/.test(keys));
  check("Enter from the search box runs the first match",
    /event\.key === "Enter"[\s\S]{0,160}items\[0\]\.click\(\)/.test(keys));
}

console.log("\n=== focus is trapped, then given back ===");
{
  const keys = extractFn("handleCommandPaletteKeys");
  check("Tab is contained inside the palette", /event\.key === "Tab"/.test(keys));
  check("...forward from the last item wraps to the first",
    /!event\.shiftKey && document\.activeElement === last/.test(keys));
  check("...and Shift+Tab from the first wraps to the last",
    /event\.shiftKey && document\.activeElement === first/.test(keys));

  const open = extractFn("openCommandPalette");
  const close = extractFn("closeCommandPalette");
  check("opening remembers where focus came from",
    /commandPaletteReturnFocus = document\.activeElement/.test(open));
  check("closing puts focus back", /commandPaletteReturnFocus\?\.isConnected[\s\S]{0,60}\.focus\(\)/.test(close));
  check("a removed origin element does not throw", /isConnected/.test(close));
  check("focus never stays inside the hidden subtree",
    /palette\.contains\(document\.activeElement\)[\s\S]{0,60}blur\(\)/.test(close));
  check("choosing a command does not fight the view it just opened",
    /closeCommandPalette\(\{ restoreFocus: false \}\)/.test(app));
}

console.log("\n=== the palette stops lying to assistive technology ===");
{
  const open = extractFn("openCommandPalette");
  const close = extractFn("closeCommandPalette");
  check("aria-hidden is cleared when it opens", /setAttribute\("aria-hidden", "false"\)/.test(open));
  check("aria-hidden is restored when it closes", /setAttribute\("aria-hidden", "true"\)/.test(close));
  check("the markup still starts hidden", /id="commandPalette" aria-hidden="true"/.test(html));
}

console.log("\n=== the palette does not fight an open dialog ===");
{
  check("Ctrl+K is ignored while a modal dialog owns the screen",
    /if \(document\.querySelector\("dialog\[open\]"\)\) return;/.test(app),
    "the palette cannot paint above the top layer, so it opened invisibly");
  check("Escape only acts when the palette is actually open",
    /event\.key === "Escape" && isCommandPaletteOpen\(\)/.test(app),
    "otherwise every Escape in the app ran this, including ones closing a dialog");
}

console.log("\n=== the shell can be skipped past ===");
{
  check("a skip link exists", /class="skip-link" href="#mainContent"/.test(html));
  check("it is the first tab stop, before the shell",
    html.indexOf("skip-link") < html.indexOf('class="app-shell"'));
  check("its target can receive focus", /<main class="main" id="mainContent" tabindex="-1">/.test(html));
  check("it is translated, not English-only",
    /data-i18n="a11y\.skipToContent"/.test(html) &&
    (app.match(/"a11y\.skipToContent":/g) || []).length === 2);
  check("it is hidden until focused", /\.skip-link \{[\s\S]{0,400}translateY\(calc\(-100%/.test(css));
  check("focusing it brings it on screen", /\.skip-link:focus[\s\S]{0,80}translateY\(0\)/.test(css));
}

console.log("\n=== the focus ring survives high-contrast mode ===");
{
  // The app's :focus-visible ring is a box-shadow, and Windows high-contrast
  // strips shadows entirely -- removing the indicator from the users most
  // likely to be navigating by keyboard.
  check("a forced-colors fallback exists", /@media \(forced-colors: active\)/.test(css));
  check("...and it uses outline, which survives", /forced-colors: active\)[\s\S]{0,140}outline: 3px solid/.test(css));
  check("the button reset is applied to results so they still lay out",
    /\.command-result \{[\s\S]{0,200}width: 100%/.test(css));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
