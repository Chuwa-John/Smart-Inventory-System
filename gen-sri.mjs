import { createHash } from "node:crypto";

const urls = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js"
];

for (const url of urls) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(url);
  console.log(`  sha384-${createHash("sha384").update(buf).digest("base64")}\n`);
}