// The stock alert is a NOTIFICATION, and the two rules that keep it one.
//
// Found on the preview 2026-10-09 while typing in a 32-product opening
// catalogue: every saved product opened a modal announcing that it had run
// out, and one of them landed between saving a product and opening the form
// for the next, eating the press. Two products were silently never created.
//
// detectStockAlertCrossings is run for real here against controlled product
// lists, rather than scanned -- it is a pure function of two arrays and the
// arithmetic is the thing worth pinning. The deferral half is structural and
// is checked by reading the source.

import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const clean = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

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

// The real detector, over a controlled state. stockStatus is the real one too,
// so "healthy" means here exactly what it means on the shelf.
function run(previous, next, { enabled = true, initialised = true } = {}) {
  const queued = [];
  const fn = new Function("state", "stockStatus", "queueStockAlertPopup", `
    ${extract("detectStockAlertCrossings")}
    return detectStockAlertCrossings;
  `)(
    { stockAlertPopupEnabled: enabled, productsInitialized: initialised },
    (product) => {
      const qty = Number(product.quantity || 0);
      const reorder = Number(product.reorderLevel || 0);
      if (qty <= 0) return "out";
      if (qty <= reorder) return "low";
      return "healthy";
    },
    (product) => queued.push(product.name)
  );
  fn(previous, next);
  return queued;
}

const healthy = (id, name) => ({ id, name, quantity: 50, reorderLevel: 10 });
const low = (id, name) => ({ id, name, quantity: 5, reorderLevel: 10 });
const out = (id, name) => ({ id, name, quantity: 0, reorderLevel: 10 });

console.log("\n=== a product that did not exist has not crossed anything ===");
{
  // THE DEFECT. Add Product creates a row with no stock, because stock arrives
  // later under Purchases -- that is what the screen itself tells you to do.
  // Absent read as "was healthy", so every new product announced that it had
  // just run out.
  check("a brand new product with no stock raises nothing",
    run([], [out("a", "Vaseline")]), []);
  check("...and nor does a whole opening catalogue",
    run([], [out("a", "Vaseline"), out("b", "Dettol"), out("c", "Geisha")]), []);

  // A branch switch replaces the list wholesale, so every product in the
  // branch just chosen looks new. Choosing a branch used to open one modal per
  // low-stock product in it.
  check("switching branch raises nothing for the new branch's stock",
    run([healthy("a", "Vaseline")], [low("x", "Omo"), out("y", "Harpic")]), []);
}

console.log("\n=== but stock that actually fell is still announced ===");
{
  // The whole point of the feature, and the thing the fix must not cost.
  check("healthy to low is announced",
    run([healthy("a", "Vaseline")], [low("a", "Vaseline")]), ["Vaseline"]);
  check("healthy to out is announced",
    run([healthy("a", "Vaseline")], [out("a", "Vaseline")]), ["Vaseline"]);
  check("each product that fell is announced once",
    run([healthy("a", "Vaseline"), healthy("b", "Dettol")],
        [low("a", "Vaseline"), out("b", "Dettol")]), ["Vaseline", "Dettol"]);

  // Already below the line is not a crossing -- it would re-announce on every
  // snapshot, which is several times a minute.
  check("low that stays low is not re-announced",
    run([low("a", "Vaseline")], [low("a", "Vaseline")]), []);
  check("out that stays out is not re-announced",
    run([out("a", "Vaseline")], [out("a", "Vaseline")]), []);
  check("restocking back to healthy announces nothing",
    run([out("a", "Vaseline")], [healthy("a", "Vaseline")]), []);

  // Selling the last unit of a product that was already low IS the moment it
  // runs out, but it was not healthy before, so by the crossing rule it is not
  // announced. Pinned as the deliberate behaviour it is: the rule is "fell
  // below the line", and it only falls below once.
  check("low to out is not a second announcement",
    run([low("a", "Vaseline")], [out("a", "Vaseline")]), []);
}

console.log("\n=== the settings toggle and first load still gate it ===");
{
  check("nothing is raised while the popup is switched off",
    run([healthy("a", "Vaseline")], [out("a", "Vaseline")], { enabled: false }), []);
  // The first snapshot is not a change, it is the shop as it stands.
  check("nothing is raised before the catalogue has loaded once",
    run([healthy("a", "Vaseline")], [out("a", "Vaseline")], { initialised: false }), []);
}

console.log("\n=== an alert never seizes a screen already in use ===");
{
  // showModal() on top of an open dialog takes the focus and the clicks off
  // the form the shopkeeper was filling in.
  check("there is a test for another dialog being open",
    /function anotherDialogIsOpen\(\) \{/.test(clean), true);
  check("...which ignores the alert's own dialog",
    /dialog\.id !== "stockAlertDialog"/.test(clean), true);

  const show = extract("showNextStockAlertPopup").replace(/\/\/[^\n]*/g, "");
  check("the alert stands down while something else is open",
    /if \(anotherDialogIsOpen\(\)\) return;/.test(show), true);
  // HELD, not dropped: the deferral must happen before the queue is shifted,
  // or standing down throws the alert away.
  check("...before the queue is shifted, so nothing is lost",
    show.indexOf("anotherDialogIsOpen()") < show.indexOf("stockAlertQueue.shift()"), true);

  // dialog "close" does not bubble, so an ordinary document listener never
  // fires and the held queue would sit there for ever.
  check("the queue is flushed when a dialog closes",
    /document\.addEventListener\("close", \(\) => \{\s*if \(state\.stockAlertQueue\.length\) showNextStockAlertPopup\(\);\s*\}, true\);/.test(clean), true);
  check("...on the capture phase, because close does not bubble",
    /\}, true\);/.test(clean), true);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => "  FAILED: " + f.name).join("\n")); process.exit(1); }
