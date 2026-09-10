// The app's own confirmation.
//
//   node confirm-dialog.test.mjs
//
// Every destructive action here used to gate on window.confirm(). A browser may
// decline to show a native dialog and return false without asking anybody --
// Chrome offers "Prevent this page from creating additional dialogs" after a
// few in quick succession -- and from that moment Delete, Revoke, Undo and
// Archive all did nothing at all, silently, until the browser was restarted.
// Found on 2026-09-10 when Revoke "did not work" and the console held
// seventeen suppressed prompts.
//
// Failing safe is right. Failing silently is not, and the same shape has been
// treated as a defect everywhere else in this codebase.
//
// askConfirm() is evaluated out of app.js rather than reimplemented.
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

// A minimal DOM: enough for the real function to run against.
function makeDom({ withDialog = true } = {}) {
  const listeners = new Map();
  const el = (id) => ({
    id, textContent: "", open: false, focused: false,
    classList: { toggle(cls, on) { this[cls] = on; } },
    addEventListener(ev, fn) { listeners.set(id + ":" + ev, fn); },
    removeEventListener(ev) { listeners.delete(id + ":" + ev); },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; const fn = listeners.get("#confirmDialog:close"); if (fn) fn(); }
  });
  const nodes = {
    "#confirmDialog": withDialog ? el("#confirmDialog") : null,
    "#confirmDialogMessage": el("#confirmDialogMessage"),
    "#confirmDialogAccept": el("#confirmDialogAccept"),
    "#confirmDialogCancel": el("#confirmDialogCancel"),
    "#confirmDialogClose": el("#confirmDialogClose"),
    "#confirmDialogTitle": el("#confirmDialogTitle")
  };
  const askConfirm = new Function("qs", "t", `
    ${extract("askConfirm")}
    return askConfirm;
  `)((sel) => nodes[sel], (k) => k);
  const fire = (id, ev) => { const fn = listeners.get(id + ":" + ev); if (fn) fn(); };
  return { askConfirm, nodes, fire, listeners };
}

console.log("=== it cannot be suppressed by the browser ===");
{
  // The whole point. There is no call into the browser's own dialog machinery,
  // so there is nothing for a browser to decline.
  const fn = extract("askConfirm");
  check("askConfirm never calls window.confirm", /window\.confirm\s*\(/.test(fn), false);
  check("...it opens the app's own <dialog>", /showModal\(\)/.test(fn), true);
  check("the dialog exists in the markup", html.includes('id="confirmDialog"'), true);
  // And nothing anywhere still uses the native one. The single remaining
  // mention is the comment above askConfirm explaining what it replaced.
  const calls = (src.match(/window\.confirm\(t\(/g) || []).length;
  check("no call site still uses window.confirm", calls, 0);
}

console.log("\n=== pressing confirm resolves true; everything else resolves false ===");
{
  {
    const { askConfirm, fire } = makeDom();
    const p = askConfirm("delete it?");
    fire("#confirmDialogAccept", "click");
    check("the confirm button resolves true", await p, true);
  }
  {
    const { askConfirm, fire } = makeDom();
    const p = askConfirm("delete it?");
    fire("#confirmDialogCancel", "click");
    check("cancel resolves false", await p, false);
  }
  {
    const { askConfirm, fire } = makeDom();
    const p = askConfirm("delete it?");
    fire("#confirmDialogClose", "click");
    check("the close cross resolves false", await p, false);
  }
  {
    // Escape closes a <dialog> without firing any button. Only the browser's
    // own close event reports it, and without listening for it the promise
    // would never settle -- the caller would hang forever, awaiting a click
    // that can no longer happen, and the button would look dead all over again.
    const { askConfirm, nodes } = makeDom();
    const p = askConfirm("delete it?");
    nodes["#confirmDialog"].close();
    // Raced against a timeout rather than awaited directly: the failure mode
    // here is a promise that NEVER settles, and a bare await turns that into a
    // suite that hangs instead of a suite that goes red. Verified by removing
    // the close listener -- without this race the run stalls forever.
    const settled = await Promise.race([
      p,
      new Promise((r) => setTimeout(() => r("NEVER SETTLED"), 2000))
    ]);
    check("Escape (the close event) resolves false", settled, false);
  }
}

console.log("\n=== it refuses rather than assuming yes ===");
{
  // If the markup were ever missing, proceeding would run a destructive action
  // nobody agreed to. Refusing merely makes the button appear inert -- the
  // safe direction of the two.
  const { askConfirm } = makeDom({ withDialog: false });
  check("a missing dialog resolves false", await askConfirm("delete it?"), false);
}

console.log("\n=== a stray Enter must not delete anything ===");
{
  const { askConfirm, nodes } = makeDom();
  const p = askConfirm("delete it?");
  check("focus goes to Cancel, not the destructive button",
    [nodes["#confirmDialogCancel"].focused, nodes["#confirmDialogAccept"].focused], [true, false]);
  nodes["#confirmDialog"].close();
  await p;
}

console.log("\n=== one question cannot answer another ===");
{
  // The dialog is a single shared element. If the first question's listeners
  // outlived it, a click on the reused dialog would settle both promises --
  // and the stale one would report the answer to a question about a different
  // product.
  const { askConfirm, fire, listeners } = makeDom();
  const first = askConfirm("delete A?");
  fire("#confirmDialogCancel", "click");
  check("the first resolves", await first, false);
  check("...and its listeners are gone", listeners.size, 0);
  const second = askConfirm("delete B?");
  fire("#confirmDialogAccept", "click");
  check("the second answers only itself", await second, true);
}

console.log("\n=== the message is shown, and is the caller's ===");
{
  const { askConfirm, nodes, fire } = makeDom();
  const p = askConfirm("Revoke access for sam@example.com?");
  check("the message is rendered",
    nodes["#confirmDialogMessage"].textContent, "Revoke access for sam@example.com?");
  // textContent, never innerHTML: these strings carry names and emails typed by
  // users, and one of them containing markup must not become markup.
  const fn = extract("askConfirm");
  check("...as text, not markup", /messageEl\.innerHTML/.test(fn), false);
  fire("#confirmDialogCancel", "click");
  await p;
}

console.log("\n=== every destructive action went through ===");
{
  // The eleven call sites, by the function each sits in. If one were missed it
  // would still be suppressible, and would still fail silently.
  const expected = ["toggleServiceActive", "deleteExpense", "confirmDeleteDelivery",
    "deletePurchase", "checkCreditLimitBeforeSale", "deleteProduct",
    "cancelAccountDeletion", "undoLastSale", "archiveStore", "revokeStaffMember"];
  for (const name of expected) {
    check(`${name} asks the app, not the browser`,
      /await askConfirm\(/.test(extract(name)), true);
  }
  check("all eleven sites converted", (src.match(/await askConfirm\(t\(/g) || []).length, 11);
  // Each one still reads the answer as a plain boolean, so the guard clauses
  // did not change shape when the mechanism did.
  check("revoke still refuses on a no",
    /if \(!await askConfirm\(t\("staff\.revokeConfirm"[\s\S]{0,80}?\)\) return;/.test(src), true);
}

console.log("\n=== both languages ===");
{
  for (const key of ["confirm.title", "confirm.cancel", "confirm.accept"]) {
    const n = (src.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g")) || []).length;
    check(`${key} is in en and sw`, n, 2);
  }
}



console.log("\n=== window.prompt is gone too ===");
{
  // Same failure as confirm(): a browser may decline to show a native dialog
  // and hand back null, which every caller reads as "cancelled". Ten buttons
  // did nothing at all -- among them the till's price override and the override
  // PASSWORD, the control standing between a cashier and discounting stock to
  // nothing. Found by clicking every button in the app and reading the console.
  // Counted over code lines only: the comment above askText explains what it
  // replaced and names window.prompt() in prose, which is not a call site.
  const promptCalls = src.split("\n")
    .filter((line) => !line.trim().startsWith("//") && /window\.prompt\(/.test(line));
  check("no call site uses window.prompt", promptCalls, []);
  check("askText exists", /function askText\(/.test(src), true);
  check("every prompt goes through it", (src.match(/await askText\(/g) || []).length, 10);

  const fn = extract("askText");
  // A password typed into a native prompt is displayed in clear text, on a
  // screen, at a counter. This one masks it.
  check("a password prompt is masked",
    /options\.type === "password" \? "password" : "text"/.test(fn), true);
  check("...and the override password asks for that",
    /askText\(t\("dialog\.overridePasswordPrompt"\), \{ type: "password" \}\)/.test(src), true);
  // Never leave a typed password in the DOM for whatever asks next.
  check("the box is cleared when it closes", /if \(input\) input\.value = "";/.test(fn), true);
  // Cancel, the cross and Escape all resolve null, so `if (raw === null) return`
  // keeps reading as it did.
  check("cancel resolves null", /const onCancel = \(\) => finish\(null\);/.test(fn), true);
  check("Escape resolves null via the close event",
    /dialog\.addEventListener\("close", onClose\)/.test(fn), true);
  check("a missing dialog resolves null, not a value",
    /if \(!dialog\) return Promise\.resolve\(null\);/.test(fn), true);
}

console.log("\n=== cancelling a price override must not zero the line ===");
{
  // Number(null) is 0, and 0 clears both the finite and non-negative checks --
  // so backing out of a price override handed the customer the item for
  // nothing, with the override password already entered, which made it look
  // authorised. The same was true of window.prompt before it.
  const handler = src.slice(src.indexOf('const editPriceButton = event.target.closest("[data-edit-price]")'));
  const body = handler.slice(0, handler.indexOf("\n    const paymentButton"));
  check("cancelling returns before the price is touched",
    /if \(rawPrice === null \|\| String\(rawPrice\)\.trim\(\) === ""\) return;/.test(body), true);
  const guardAt = body.indexOf("rawPrice === null");
  const assignAt = body.indexOf("cartItem.sellingPrice = newPrice");
  check("...and the guard comes first", guardAt !== -1 && guardAt < assignAt, true);
  check("the raw value is checked before Number() sees it",
    body.indexOf("rawPrice === null") < body.indexOf("Number(rawPrice)"), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
