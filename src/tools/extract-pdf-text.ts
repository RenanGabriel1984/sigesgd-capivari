import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import * as path from "path";
import * as pdfjsLib from "pdfjs-dist";

// pdfjs-dist global build for Node/undici environments.
const pdfjs = (pdfjsLib as any).global ?? pdfjsLib;

pdfjs.GlobalWorkerOptions.workerSrc = `//localhost:${process.env.VITE_PORT ?? 3001}/node_modules/pdfjs-dist/build/pdf.worker.min.mjs`;

const srcDir = path.resolve("src/__tests__/fixtures");
const tmpDir = path.resolve("tmp");

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

const pdfPath = path.join(srcDir, "incotech-company.pdf");
const textLayerPath = path.join(tmpDir, "danfe-incotech-textlayer.txt");

console.log("pdfPath:", pdfPath);
console.log("exists:", existsSync(pdfPath));

if (!existsSync(pdfPath)) {
  console.error("Arquivo PDF não encontrado:", pdfPath);
  process.exit(1);
}

const data = readFileSync(pdfPath);
const pdfData = new Uint8Array(data);

const doc = await pdfjs.getDocument({ data: pdfData }).promise;
const numPages = doc.numPages;
console.log("number of pages:", numPages);

const pageTexts: string[] = [];
for (let i = 1; i <= numPages; i++) {
  const page = await doc.getPage(i);
  const textContent = await page.getTextContent();
  const strings = textContent.items
    .map((item: any) => (item?.str ?? ""))
    .filter((s: string) => s.length > 0);
  const pageText = strings.join(" ");
  pageTexts.push(pageText);
  console.log(`\npágina ${i} (length=${pageText.length}):`);
  console.log(pageText);
}

const fullText = pageTexts.join("\n\n");

writeFileSync(textLayerPath, fullText);
console.log("\nText layer salvo em:", textLayerPath);
