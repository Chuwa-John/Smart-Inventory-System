// The landing page speaks Kiswahili, and the trades marquee rolls.
//
//   node landing-language.test.mjs
//
// Kiswahili on the landing page is a commercial decision, not a nicety. The
// people this product is for read Kiswahili first, and a page that greets them
// in English is asking them to work before it has earned anything.
//
// The mechanism is deliberately the smallest thing that could work: the English
// lives in the document, the Kiswahili in a data-sw attribute beside it, and a
// short script swaps textContent. No dictionary file, because a dictionary is a
// second place for a string to live and therefore a second place for it to
// drift out of step with the first.
//
// What this file guards is that the pairing stays complete, that the swap is
// reversible, and that the marquee's duplication -- which exists so the loop
// closes without a jump -- cannot silently double a translation.
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../landing.js", import.meta.url), "utf8");

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

// Every element carrying a translation, with the English the document shows.
const pairs = [...html.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-sw="([^"]*)"[^>]*>([\s\S]*?)<\/\1>/g)]
  .map((m) => ({ tag: m[1], sw: m[2], en: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() }));

console.log("=== every visible string has a Kiswahili twin ===");
{
  const count = (html.match(/data-sw="/g) || []).length;
  check("the page is substantially translated", count >= 100, `${count} translated strings`);
  check("the pairs parse", pairs.length >= 90, `${pairs.length} matched`);

  const empty = pairs.filter((p) => !p.sw.trim());
  check("no translation is blank", empty.length === 0,
    empty.map((p) => p.en.slice(0, 50)).join(" | "));

  // A Kiswahili value identical to the English is almost always a string that
  // was copied and never translated. Two are legitimately the same -- the
  // phrase is already Kiswahili -- so they are named rather than excluded by a
  // rule that would hide the next real one.
  const allowedSame = ["Kiswahili na Kiingereza", "Mini market"];
  const untranslated = pairs.filter((p) => p.sw.trim() === p.en.trim() && !allowedSame.includes(p.en.trim()));
  check("nothing was left in English by accident", untranslated.length === 0,
    untranslated.map((p) => p.en.slice(0, 50)).join(" | "));
}

console.log("\n=== the swap is reversible ===");
{
  // The English is captured from the DOM on first run rather than duplicated
  // into the markup. If it were not captured, switching to Kiswahili would
  // destroy the original and the button would only work once.
  check("the English is captured before the first swap",
    /el\.getAttribute\("data-en"\) === null/.test(js) &&
    /el\.setAttribute\("data-en", el\.textContent\)/.test(js),
    "without this, switching away from English throws the English away");
  check("switching back reads the captured English",
    /lang === SW \? el\.getAttribute\("data-sw"\) : el\.getAttribute\("data-en"\)/.test(js));
  check("a missing translation leaves the text alone",
    /if \(next !== null\) el\.textContent = next;/.test(js),
    "a null here would blank the element rather than leave it in English");
}

console.log("\n=== it remembers, and it guesses well the first time ===");
{
  check("the choice is stored", /localStorage\.setItem\(STORAGE_KEY, lang\)/.test(js));
  check("storage failure does not break the switch",
    /try \{[\s\S]{0,120}localStorage\.setItem[\s\S]{0,200}catch/.test(js),
    "private browsing must cost the memory, not the button");
  check("a Kiswahili phone lands on Kiswahili",
    /navigator\.languages/.test(js) && /\/\^sw\\b\/i/.test(js),
    "the reader this page is for should not have to hunt for the button");
  check("anything else stays English", /return EN;/.test(js));
}

console.log("\n=== the page stops the browser translating over the top ===");
{
  // The same fault the app hit: setting <html lang="sw"> is the signal Chrome
  // watches, so a browser set to translate Swahili replaces the real Kiswahili
  // with machine English.
  check("the language is actually set on the document",
    /document\.documentElement\.lang = lang;/.test(js));
  check("and the page opts out of machine translation",
    /<html lang="en" translate="no">/.test(html) &&
    /<meta name="google" content="notranslate" \/>/.test(html));
  check("the toggle names the language you would switch TO",
    /lang === SW \? "English" : "Kiswahili"/.test(js),
    "labelling the current language is unreadable to whoever needs the button");
}

console.log("\n=== the trades marquee ===");
{
  const trades = (html.match(/class="trade"/g) || []).length;
  check("there are many trades, which is what makes a roll worth having",
    trades >= 20, `${trades} trades`);
  check("the list is authored once and duplicated in script",
    /cloneNode\(true\)/.test(js) && /track\.appendChild\(copy\)/.test(js),
    "duplicating in markup would mean translating each trade twice");
  check("the duplicate is hidden from assistive technology",
    /copy\.setAttribute\("aria-hidden", "true"\)/.test(js),
    "a screen reader should not read the same list twice");
  check("the clones are translated too",
    /nodes = \[\]\.slice\.call\(document\.querySelectorAll\("\[data-sw\]"\)\);[\s\S]{0,80}\}\s*apply\(/.test(js),
    "the node list has to be re-read after cloning, or the copies stay English");

  check("it rolls vertically", /transform: translateY\(-50%\)/.test(html),
    "-50% is what makes the loop close on the start of the duplicate");
  check("the window is cropped so the roll has an edge",
    /\.trades-window \{[\s\S]{0,260}overflow: hidden;/.test(html));
  check("motion stops for anyone who asked for less",
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,300}\.trades-track \{ animation: none; \}/.test(html),
    "it is decoration, and decoration is the first thing that should stop");
  check("and the rows then wrap instead of being cropped",
    /@media \(prefers-reduced-motion: reduce\) \{[\s\S]{0,400}flex-wrap: wrap;/.test(html),
    "a stopped marquee in a cropped window shows a slice of a list");
}

console.log("\n=== it stays a page that loads on a cheap phone ===");
{
  check("the script is same-origin, not inline",
    /<script src="\.\/landing\.js\?v=[0-9a-z]+"><\/script>/.test(html),
    "the production CSP is script-src 'self' with no unsafe-inline");
  check("nothing is fetched from another origin",
    !/https?:\/\/(?!schema)/.test(html.replace(/<!--[\s\S]*?-->/g, "")),
    "a web font or an icon CDN would be blocked by default-src 'self'");
  check("no framework was dragged in", !/import |require\(/.test(js));
  check("the script is small", js.length < 6000, `${js.length} bytes`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("FAILURES:");
  failed.forEach((f) => console.log(" - " + f.name));
  process.exit(1);
}
