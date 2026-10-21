import { readFileSync, resolve } from "node:path";
import { parseDanfeText } from "./src/lib/danfe-ocr.ts";
import { buildReportText, parseReportInput } from "./src/lib/ocr-report.ts";

const pngReportPath = resolve("src/__tests__/fixtures/incotech-company-png.report.json");
const raw = readFileSync(pngReportPath, "utf8") as string;
const { reports } = parseReportInput(raw) as { reports: any[] };

for (const payload of reports) {
  const { text, source } = buildReportText(payload as any);
  console.log("source:", source);
  console.log("text length:", text.length);
  console.log("text:");
  console.log(text);
  console.log("\n===== Parser =====");
  const parsed = parseDanfeText(text);
  console.log("items:", parsed.items.length);
  console.log("emitterCnpj:", parsed.emitterCnpj);
  console.log("emitterName:", parsed.emitterName);
  console.log("receiverCnpj:", parsed.receiverCnpj);
  console.log("receiverName:", parsed.receiverName);
  console.log("nfeNumber:", parsed.nfeNumber);
  console.log("series:", parsed.series);
  console.log("emissionDate:", parsed.emissionDate);
  console.log("accessKey:", parsed.accessKey);
  console.log("totalValue:", parsed.totalValue);
  if (parsed.items[0]) {
    console.log("item[0]:", JSON.stringify(parsed.items[0], null, 2));
  }
}
