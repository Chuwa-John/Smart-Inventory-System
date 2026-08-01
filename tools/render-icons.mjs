// Renders the Savia mark to the PNG sizes a PWA install needs.
//
//   node tools/render-icons.mjs
//
// Chromium is already a dependency for the contrast and compatibility checks,
// so it does the rasterising too rather than adding an image toolchain for two
// files. Re-run this whenever icons/savia-mark.svg changes.
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const svg = await readFile(new URL("../icons/savia-mark.svg", import.meta.url), "utf8");

// "any" keeps the rounded tile. "maskable" is drawn on a filled square with the
// artwork inside the central 80%, because Android crops maskable icons to
// whatever shape the launcher uses and a rounded tile would lose its corners.
const targets = [
  { file: "icons/icon-192.png", size: 192, maskable: false },
  { file: "icons/icon-512.png", size: 512, maskable: false },
  { file: "icons/icon-maskable-512.png", size: 512, maskable: true },
  { file: "icons/favicon-64.png", size: 64, maskable: false }
];

const browser = await chromium.launch();

for (const { file, size, maskable } of targets) {
  // Maskable: the TILE goes full-bleed with square corners, and only the mark
  // shrinks into the central 80% safe zone. Scaling the whole SVG instead --
  // which is what this did first -- leaves the page colour showing around a
  // gradient square, and the seam is plainly visible once a launcher crops it.
  const artwork = maskable
    ? svg
        .replace(/rx="116"/, 'rx="0"')
        .replace(
          /(<path d="M 330 170[\s\S]*?\/>)/,
          '<g transform="translate(256 256) scale(0.8) translate(-256 -256)">$1</g>'
        )
    : svg;

  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1
  });
  // Transparent page so nothing bleeds around the tile's rounded corners.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}</style>
     ${artwork}`,
    { waitUntil: "load" }
  );
  const buffer = await page.screenshot({ omitBackground: !maskable, type: "png" });
  await writeFile(new URL(file, `file:///${ROOT.replace(/\\/g, "/")}`), buffer);
  console.log(`  wrote ${file} (${size}x${size}${maskable ? ", maskable" : ""}) — ${buffer.length} bytes`);
  await page.close();
}

await browser.close();
console.log("done");
