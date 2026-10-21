import { readFileSync } from "node:fs";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//localhost:${process.env.VITE_PORT ?? 3001}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;

const pdfPath = process.argv[2];
const baseDir = process.cwd();

console.log("[pdf-text-extractor] PDF path:", pdfPath);
console.log("[pdf-text-extractor] base dir:", baseDir);

const pdfData = new Uint8Array(readFileSync(pdfPath));

const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
const numPages = doc.numPages;
console.log("[pdf-text-extractor] number of pages:", numPages);

for (let i = 1; i <= numPages; i++) {
  const page = await doc.getPage(i);
  const textContent = await page.getTextContent();
  const strings = textContent.items.map((item: any) => item.str ?? "").filter(Boolean);
  const pageText = strings.join(" ");
  console.log(`[pdf-text-extractor] page ${i}:`);
  console.log(pageText);
  console.log("---");
}
