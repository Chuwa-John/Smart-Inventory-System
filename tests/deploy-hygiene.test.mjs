// Phase 8 — QA-132, QA-118, QA-125, QA-124: what ships, and what happens to a
// request for something that does not.
//
//   node deploy-hygiene.test.mjs
//
// `"public": "."` deploys the whole working directory minus an ignore list, so
// the ignore list is the only thing standing between a developer scratch file
// and the public internet. structure.txt — a 3.6 MB, 46,363-line Windows
// `tree /f` dump — was being served at /structure.txt with HTTP 200, publishing
// a complete inventory of proxy/node_modules (80 references) and disclosing
// that proxy/.env exists. No secret values, but a ready-made list for anyone
// checking which of your dependencies has a known advisory.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
const hosting = config.hosting ?? {};
const ignore = hosting.ignore ?? [];

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : `\n      ${detail}`}`);
}

console.log("=== nothing large or private rides along with the app (QA-132) ===");
{
  check("the whole directory is the deploy root", hosting.public === ".",
    "which is what makes the ignore list load-bearing rather than tidy");
  check("text dumps are excluded", ignore.includes("*.txt"),
    "structure.txt shipped at 3.6 MB per fetch on a Spark-plan bandwidth budget");

  // Anything sizeable that is not an app asset should be excluded. Checked by
  // measuring the tree rather than by naming the one file already found.
  const assetExt = /\.(html|css|js|png|jpg|jpeg|svg|ico|json|webmanifest|mjs)$/i;
  const covered = (name) =>
    ignore.some((pattern) =>
      pattern === name
      || (pattern.startsWith("*.") && name.endsWith(pattern.slice(1)))
      || (pattern.endsWith("/**") && name === pattern.slice(0, -3)));

  const oversized = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (assetExt.test(name) || covered(name)) continue;
    const size = statSync(new URL(`../${name}`, import.meta.url)).size;
    if (size > 200 * 1024) oversized.push(`${name} (${Math.round(size / 1024)} KB)`);
  }
  check("no large non-asset file is left deployable", oversized.length === 0,
    `${oversized.join(", ")} — add it to the firebase.json ignore list`);

  check("proxy source never ships", ignore.includes("proxy/**"));
  check("tests never ship", ignore.includes("tests/**"));
  check("dotfiles never ship", ignore.includes("**/.*"),
    "this is what keeps .env and .firebaserc off the public site");
}

console.log("\n=== a file whose comment claims it is excluded, is (QA-125) ===");
{
  const src = readFileSync(new URL("../price-config.js", import.meta.url), "utf8");
  const claims = /excluded from Firebase Hosting deploys/.test(src);
  check("price-config.js still claims exclusion", claims, "if the claim went, drop this check");
  check("...and the claim is now true", !claims || ignore.includes("price-config.js"),
    "a comment asserting a protection that does not exist is worse than no comment");
}

console.log("\n=== a missing asset 404s instead of bricking the device (QA-118) ===");
{
  // The catch-all rewrite answered EVERY unmatched path with index.html and
  // HTTP 200 — including a missing or not-yet-propagated /app.js?v=…, which the
  // blanket js|css rule then stamped `immutable`. With nosniff the HTML never
  // executes as script, and the device holds that dead response for a year: a
  // bricked till that no deploy can reach until the version string moves.
  const rewrites = hosting.rewrites ?? [];
  check("a rewrite still exists", rewrites.length > 0);
  const catchAll = rewrites.find((r) => r.destination === "/index.html");
  check("the SPA rewrite is still there", Boolean(catchAll));
  check("...but no longer swallows every path", catchAll.source !== "**",
    "`**` catches a missing .js and answers it with HTML under an immutable header");
  for (const ext of ["js", "css", "json", "map"]) {
    check(`...and specifically excludes .${ext}`, catchAll.source.includes(ext),
      `a missing .${ext} must reach the 404 handler, not the rewrite`);
  }

  const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
  check("a 404 page exists to receive them", pages.includes("404.html"),
    "without one Firebase serves its own default, which is at least honest about the status");
  const notFound = readFileSync(new URL("../404.html", import.meta.url), "utf8");
  check("...and it is bilingual, like the rest of the app", /lang="sw"/.test(notFound));
  check("...and offers a way back", /href="\//.test(notFound));
  check("...and carries no versioned asset", !/\?v=/.test(notFound),
    "a 404 page that references a versioned bundle needs bumping on every release for no reason");
}

console.log("\n=== the README describes THIS product (QA-124) ===");
{
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check("it is not still called SanitaryFlow", !/SanitaryFlow/.test(readme),
    "it is the first file anyone opens, and it described a plumbing supplier");
  check("it names the product", /SaviaSmart/.test(readme));

  // The capabilities it omitted entirely.
  for (const topic of ["VAT", "Offline", "branch", "Roles", "Shift", "credit"]) {
    check(`it mentions ${topic}`, new RegExp(topic, "i").test(readme),
      "a reader who trusts this file would not know the feature exists");
  }
  check("it points at the operations document", /OPERATIONS\.md/.test(readme));
  check("it points at the limitations register", /KNOWN-LIMITATIONS\.md/.test(readme));
  check("it warns about the version stamp", /bump/i.test(readme) && /stamp/i.test(readme),
    "the two rules most likely to be broken by someone new");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
