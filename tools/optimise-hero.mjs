// Re-encodes the hero photograph to something a shop on mobile data can afford.
//
//   node tools/optimise-hero.mjs
//
// The source arrived as a 1.4 MB PNG. PNG is lossless and built for flat
// graphics; for a photograph it stores every sensor grain faithfully and costs
// several times what the same picture costs as JPEG. 1.4 MB is more than twice
// the JavaScript payload that was deliberately taken off this page, and it
// would have been paid by every visitor on every first load.
//
// Two outputs, because a phone should not download a desktop-width image:
// a wide one for large screens and a narrow one for phones. Chromium does the
// work, since it is already a dependency for the contrast and compatibility
// checks -- no image toolchain is added for two files.
import { chromium } from "playwright";
import { readFile, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = "images/hero-warehouse.png";

const src = await readFile(new URL(`../${SOURCE}`, import.meta.url));
const before = (await stat(new URL(`../${SOURCE}`, import.meta.url))).size;
const dataUri = `data:image/png;base64,${src.toString("base64")}`;

const targets = [
  { file: "images/hero-warehouse.jpg", width: 1600, quality: 0.72 },
  { file: "images/hero-warehouse-800.jpg", width: 800, quality: 0.70 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<body></body>");

const meta = await page.evaluate(async (uri) => {
  const img = new Image();
  img.src = uri;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}, dataUri);

console.log(`source: ${SOURCE}  ${meta.width}x${meta.height}  ${(before / 1024).toFixed(0)} KB\n`);

for (const { file, width, quality } of targets) {
  const out = await page.evaluate(async ({ uri, width, quality }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();
    const scale = Math.min(1, width / img.naturalWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL("image/jpeg", quality), w: canvas.width, h: canvas.height };
  }, { uri: dataUri, width, quality });

  const buffer = Buffer.from(out.data.split(",")[1], "base64");
  await writeFile(new URL(file, `file:///${ROOT.replace(/\\/g, "/")}`), buffer);
  const pct = ((1 - buffer.length / before) * 100).toFixed(0);
  console.log(`  ${file}  ${out.w}x${out.h}  ${(buffer.length / 1024).toFixed(0)} KB  (${pct}% smaller than the PNG)`);
}

await browser.close();
