// The two locales, checked against each other and against the code that uses
// them.
//
//   node i18n-dictionary.test.mjs
//
// Nothing checked DICTIONARY as a whole, and it had drifted in a way that is
// invisible by inspection: "movement.noSales" was defined TWICE in each locale,
// once as a category label on the dashboard ("No sales recorded") and once as
// the product dialog's empty state ("No sales recorded for this product yet.").
// A later duplicate key silently wins in a JS object literal, so the dashboard's
// Movement classes panel printed a whole sentence where a two-word label
// belonged -- shipped, live, and unnoticed, because both strings are plausible
// English and neither is missing.
//
// A duplicate key cannot be caught by reading the file: the two definitions were
// a thousand lines apart. It has to be counted.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../app.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass && detail) console.log(`      ${detail}`);
}

// --- read the two locale blocks out of the source --------------------------
const dictStart = src.indexOf("const DICTIONARY = {");
if (dictStart === -1) throw new Error("DICTIONARY not found in app.js");
const enStart = src.indexOf("\n  en: {", dictStart);
const swStart = src.indexOf("\n  sw: {", enStart);
let end = swStart;
let depth = 0;
for (let i = swStart + 3; i < src.length; i++) {
  if (src[i] === "{") depth++;
  else if (src[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
}
const blocks = {
  en: src.slice(enStart, swStart),
  sw: src.slice(swStart, end)
};

// Keys as WRITTEN, duplicates included -- the whole point is to count them,
// so this deliberately does not go through an object.
const keysIn = (block) => [...block.matchAll(/"([a-zA-Z0-9_.]+)":\s*(?:"|`)/g)].map((m) => m[1]);

console.log("=== the dictionary was readable at all ===");
{
  check("both locale blocks were found", enStart !== -1 && swStart !== -1 && end > swStart);
  check("en has a plausible number of keys", keysIn(blocks.en).length > 500,
    `${keysIn(blocks.en).length} keys`);
}

console.log("\n=== no key is defined twice in a locale ===");
{
  for (const locale of ["en", "sw"]) {
    const keys = keysIn(blocks[locale]);
    const seen = new Map();
    for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([k, n]) => `${k} (x${n})`);
    // The later definition wins silently, so the earlier one's screen shows the
    // wrong words with nothing missing and nothing logged.
    check(`${locale} has no duplicate keys`, dupes.length === 0, dupes.join(", "));
  }
}

console.log("\n=== the two locales describe the same app ===");
{
  const en = new Set(keysIn(blocks.en));
  const sw = new Set(keysIn(blocks.sw));
  const missingSw = [...en].filter((k) => !sw.has(k));
  const missingEn = [...sw].filter((k) => !en.has(k));
  // A key missing from sw falls back to the key itself, so a Kiswahili user
  // sees "settings.changeNameButton" on a button.
  check("every English key has a Kiswahili twin", missingSw.length === 0,
    `${missingSw.length} missing from sw: ${missingSw.slice(0, 12).join(", ")}`);
  check("and nothing exists only in Kiswahili", missingEn.length === 0,
    `${missingEn.length} missing from en: ${missingEn.slice(0, 12).join(", ")}`);
}

console.log("\n=== every string the code asks for exists ===");
{
  const en = new Set(keysIn(blocks.en));
  // t("...") with a literal key. A key ending in "." is the literal half of a
  // computed one -- t("vatRecord.reason." + reason) -- which cannot be resolved
  // statically, so it is skipped rather than reported as missing. Its real
  // variants are still covered by the en/sw parity check above.
  const used = new Set(
    [...src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"\s*[,)]/g)].map((m) => m[1])
      .filter((k) => !k.endsWith("."))
  );
  const undefined_ = [...used].filter((k) => !en.has(k));
  check("no t() call names a key that does not exist", undefined_.length === 0,
    undefined_.slice(0, 12).join(", "));

  // data-i18n in the markup is the other consumer: translateStaticDom() assigns
  // el.textContent for each one, so a missing key blanks or key-names an element.
  const html = readFileSync(new URL("../app.html", import.meta.url), "utf8");
  const marked = new Set([...html.matchAll(/data-i18n="([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]));
  const missingMarkup = [...marked].filter((k) => !en.has(k));
  check("no data-i18n names a key that does not exist", missingMarkup.length === 0,
    missingMarkup.slice(0, 12).join(", "));
}

console.log("\n=== the keys that were just un-shadowed stay separate ===");
{
  const en = keysIn(blocks.en);
  const count = (k) => en.filter((x) => x === k).length;
  // The dashboard's Movement classes label.
  check("movement.noSales is the short category label", count("movement.noSales") === 1);
  // The product dialog's empty state, which used to overwrite it.
  check("movement.noSalesForProduct is its own key", count("movement.noSalesForProduct") === 1);
  const short = blocks.en.match(/"movement\.noSales":\s*"([^"]*)"/)?.[1] || "";
  check("...and the label did not inherit the sentence",
    short === "No sales recorded", `got "${short}"`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
