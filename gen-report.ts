import { createWorker } from "tesseract.js";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import * as path from "path";

const srcDir = path.resolve("src/__tests__/fixtures");
const tmpDir = path.resolve("tmp");

if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

const pngPath = path.join(srcDir, "incotech-company.png");
const reportPath = path.join(srcDir, "incotech-company-png.report.json");

if (!existsSync(pngPath)) {
  console.error("Arquivo PNG não encontrado:", pngPath);
  process.exit(1);
}

console.log("Iniciando OCR com Tesseract...", pngPath);

const worker = await createWorker("eng+por");

const { data } = await worker.recognize(pngPath);

console.log("OCR concluído. Texto extraído:");
console.log(data.text.slice(0, 1000));

const fullText = data.text;

const pageOcrText = fullText;
const regionTexts = fullText.split("\n\n").filter((line) => line.trim().length > 0);

const mergedOcr = regionTexts.join("\n\n");

const report = {
  rastreio: {
    pageOcrText,
    regionTexts,
    mergedOcr,
  },
  arquivo: "incotech-company-png.png",
  timestamp: new Date().toISOString(),
};

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log("Relatório salvo em:", reportPath);
