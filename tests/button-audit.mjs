// Every interactive control in the app, and whether anything is listening.
//
// A dead button is invisible: it renders, it highlights on hover, and nothing
// happens. This walks the markup AND the templates app.js builds at runtime,
// then checks each control against the wiring in app.js.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
const htmlNoComments = strip(html);

// --- 1. Buttons carrying an id --------------------------------------------
const idButtons = [...htmlNoComments.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)]
  .map((m) => ({ id: m[1], tag: m[0] }));

// --- 2. Controls addressed by a data- action attribute --------------------
// Both in the static markup and in the row templates app.js builds.
const dataActionRe = /data-([a-z]+(?:-[a-z]+)*)=/g;
const IGNORE = new Set([
  "i18n", "i18n-placeholder", "view", "payment", "field", "cost", "theme",
  "qty-input", "range", "role", "testid", "i18n-title", "i18n-aria-label"
]);
const dataActions = new Set();
for (const source of [htmlNoComments, app]) {
  for (const m of source.matchAll(dataActionRe)) {
    if (!IGNORE.has(m[1])) dataActions.add(m[1]);
  }
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// --- 3. Is it wired? ------------------------------------------------------
function idWired(id) {
  // A direct listener, or a form this button submits, or a dialog close.
  return new RegExp(`["'#]${id}["'\\)]`).test(app)
    || new RegExp(`getElementById\\(["']${id}["']\\)`).test(app);
}

function dataWired(action) {
  const c = camel(action);
  return new RegExp(`closest\\(["']\\[data-${action}\\]["']\\)`).test(app)
    || new RegExp(`dataset\\.${c}\\b`).test(app)
    || new RegExp(`querySelector(All)?\\(["']\\[data-${action}\\]`).test(app)
    // Selectors built as template literals -- qs(`[data-po-qty="${a}:${b}"]`) --
    // are how the per-row inputs are addressed. A detector that only looked for
    // quoted selectors reported all three of those as dead buttons.
    || new RegExp(`\\[data-${action}=`).test(app);
}

// Buttons that legitimately have no JS listener.
function selfExplaining(tag) {
  return /type="submit"/.test(tag)   // the form's submit handler owns it
      || /formmethod="dialog"/.test(tag);
}

const deadIds = idButtons.filter((b) => !idWired(b.id) && !selfExplaining(b.tag));
const deadData = [...dataActions].filter((a) => !dataWired(a));

console.log(`buttons with an id .......... ${idButtons.length}`);
console.log(`data- action attributes ..... ${dataActions.size}`);
console.log(`\nUNWIRED buttons (${deadIds.length}):`);
for (const b of deadIds) console.log(`  #${b.id}`);
console.log(`\nUNWIRED data- actions (${deadData.length}):`);
for (const a of deadData) console.log(`  data-${a}`);

// --- 4. Nav items resolve to a real view ----------------------------------
const navViews = [...htmlNoComments.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]);
const sections = new Set([...htmlNoComments.matchAll(/<section class="view" id="([a-z]+)"/g)].map((m) => m[1]));
const orphanNav = [...new Set(navViews)].filter((v) => v !== "dashboard" && !sections.has(v));
console.log(`\nnav items ................... ${new Set(navViews).size}`);
console.log(`nav items with no view ...... ${orphanNav.length ? orphanNav.join(", ") : "none"}`);

// --- 5. Every dialog can be closed ----------------------------------------
const dialogs = [...htmlNoComments.matchAll(/<dialog\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
const unclosable = dialogs.filter((id) => !new RegExp(`["']#${id}["']\\)?\\.close\\(\\)`).test(app)
  && !new RegExp(`#${id}[\\s\\S]{0,4000}?\\.close\\(\\)`).test(app));
console.log(`\ndialogs ..................... ${dialogs.length}`);
console.log(`dialogs with no close path .. ${unclosable.length ? unclosable.join(", ") : "none"}`);

const problems = deadIds.length + deadData.length + orphanNav.length + unclosable.length;
console.log(`\n${problems === 0 ? "OK: every control is wired" : problems + " PROBLEM(S)"}`);
process.exit(problems === 0 ? 0 : 1);
