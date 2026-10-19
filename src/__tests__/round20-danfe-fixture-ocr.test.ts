/**
 * RODADA 20 — FIXTURES JSON VERSIONADAS DO OCR REAL (INCOTECH COMPANY LTDA)
 *
 * COMO FORNECER OS RELATÓRIOS ORIGINAIS (pela interface web de edição do
 * projeto): crie os arquivos abaixo com o conteúdo JSON colado do botão
 * "Copiar relatório JSON" de cada diagnóstico (ou cole o texto na tela
 * `/dev/danfe-lab`, que executa o mesmo parser sem gravar nada):
 *
 *   src/__tests__/fixtures/incotech-company-pdf.report.json   ← Incotech Company.pdf
 *   src/__tests__/fixtures/incotech-company-png.report.json   ← Incotech Company.png
 *
 * Enquanto os arquivos não existirem, a suíte de fixtures é EXIBIDA COMO
 * PULADA (nunca passa fingindo que os documentos originais foram testados).
 * A segunda describe testa apenas o MECANISMO de recepção — não o documento.
 *
 * Segurança: fixtures locais apenas; nenhuma mutation, nenhum acesso a banco.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { digitsOnly } from "@/lib/br-validators";
import {
  danfeFieldSummary,
  parseDanfeText,
  validateDanfeFields,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";
import { buildReportText, collectOcrReports, parseReportInput } from "@/lib/ocr-report";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const FIXTURE_DIR = resolve(__dirname, "fixtures");
const EXPECTED_FIXTURES = [
  { file: "incotech-company-pdf.report.json", origem: "Incotech Company.pdf" },
  { file: "incotech-company-png.report.json", origem: "Incotech Company.png" },
] as const;

const presentFixtures = EXPECTED_FIXTURES.filter(({ file }) =>
  existsSync(resolve(FIXTURE_DIR, file)),
);

const norm = (value: string | undefined): string =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();

/** Referência do documento (item 2 da Rodada 20) — falha = divergência real. */
function assertIncotech(p: DanfeParseResult, origem: string): void {
  const item = p.items[0];
  const validations = validateDanfeFields(p);
  const ok = (campo: string) => validations.find((f) => f.campo === campo)?.ok;

  expect(p.accessKey, `${origem}: chave`).toBe(
    "42260922816315000144550010000029671515440064",
  );
  expect(Number(digitsOnly(p.nfeNumber ?? "")), `${origem}: número`).toBe(2967);
  expect(p.series, `${origem}: série`).toBe("001");
  expect(p.series, `${origem}: série ≠ modelo 55`).not.toBe("55");
  expect(p.emissionDate, `${origem}: emissão`).toBe("2026-09-28");

  expect(digitsOnly(p.emitterCnpj ?? ""), `${origem}: CNPJ emitente`).toBe("22816315000144");
  expect(norm(p.emitterName), `${origem}: razão social emitente`).toBe(
    norm("INCOTECH COMPANY LTDA"),
  );
  expect(norm(p.emitterAddress), `${origem}: endereço`).toContain(norm("RUA RUI BARBOSA"));
  expect(norm(p.emitterAddress), `${origem}: número`).toContain("263");
  expect(norm(p.emitterAddress), `${origem}: sala`).toContain("SALA 01");
  expect(norm(p.emitterCity), `${origem}: cidade`).toBe(norm("TUBARÃO"));
  expect(p.emitterState, `${origem}: UF`).toBe("SC");
  expect(p.emitterPostalCode, `${origem}: CEP`).toBe("88701-600");

  expect(digitsOnly(p.receiverCnpj ?? ""), `${origem}: CNPJ destinatário`).toBe(
    "44723674000190",
  );
  expect(norm(p.receiverName), `${origem}: destinatário`).toBe(norm("MUNICIPIO DE CAPIVARI"));

  expect(p.items.length, `${origem}: nº de itens`).toBeGreaterThanOrEqual(1);
  expect(item?.code, `${origem}: código do item`).toBe("231071");
  expect(norm(item?.description), `${origem}: descrição`).toBe(
    norm("KIT TECLADO E MOUSE USB SLIM CHOCO"),
  );
  expect(item?.ncm, `${origem}: NCM`).toBe("84716053");
  expect(item?.unit, `${origem}: unidade`).toBe("PC");
  expect(item?.quantity, `${origem}: quantidade`).toBe(25);
  expect(item?.unitValue, `${origem}: valor unitário`).toBeCloseTo(52.94, 2);
  expect(item?.totalValue, `${origem}: total do item`).toBeCloseTo(1323.5, 2);
  expect(p.totalValue, `${origem}: total da nota`).toBeCloseTo(1323.5, 2);

  expect(p.afNumber, `${origem}: AF`).toBe("2223/2026");
  expect(p.empenhoNumber, `${origem}: empenho (conferir visualmente)`).toBe("7718/2026");

  // Transportadora nunca pode virar emitente nem destinatário.
  const cnpjTransportadora = digitsOnly(p.transporterCnpj ?? "");
  expect(cnpjTransportadora, `${origem}: CNPJ transportadora`).toBe("38306164000114");
  expect(cnpjTransportadora).not.toBe(digitsOnly(p.emitterCnpj ?? ""));
  expect(cnpjTransportadora).not.toBe(digitsOnly(p.receiverCnpj ?? ""));
  expect(digitsOnly(p.emitterCnpj ?? "")).not.toBe(digitsOnly(p.receiverCnpj ?? ""));

  // Validação estrutural: campos sem evidência ficam pendentes, nunca inventados.
  expect(ok("nfeNumber"), `${origem}: validação número`).toBe(true);
  expect(ok("series"), `${origem}: validação série`).toBe(true);
  expect(ok("accessKey"), `${origem}: validação chave`).toBe(true);
  expect(ok("items"), `${origem}: validação itens`).toBe(true);
  expect(danfeFieldSummary(p).found).toBeGreaterThan(0);
}

describe.skipIf(presentFixtures.length === 0)(
  "R20 — fixtures literais do OCR original (versão no repositório)",
  () => {
    for (const { file, origem } of presentFixtures) {
      it(`${origem}: parser real sobre o JSON literal (${file})`, () => {
        const raw = readFileSync(resolve(FIXTURE_DIR, file), "utf8");
        const { reports } = parseReportInput(raw);
        expect(reports.length, `${origem}: relatórios extraídos`).toBeGreaterThan(0);
        for (const payload of reports) {
          const { text, source } = buildReportText(payload);
          expect(text.trim().length, `${origem}: texto (${source})`).toBeGreaterThan(200);
          assertIncotech(parseDanfeText(text), origem);
        }
      });
    }

    it("os dois relatórios (PDF e PNG) estão versionados", () => {
      expect(presentFixtures.map((f) => f.file)).toEqual(
        EXPECTED_FIXTURES.map((f) => f.file),
      );
    });
  },
);

describe("R20 — mecanismo de recepção (não depende das fixtures)", () => {
  const LAB = read("src/components/DanfeOcrLab.tsx");
  const MAIN = read("src/main.tsx");
  const REPORT_LIB = read("src/lib/ocr-report.ts");

  it("a rota /dev/danfe-lab existe e a tela usa o parser real, sem mutation", () => {
    expect(MAIN).toContain('"/dev/danfe-lab"');
    expect(LAB).toContain("parseDanfeText"); // mesmo parser do diálogo
    expect(LAB).not.toContain("useMutation");
    expect(LAB).not.toContain("ctx.db.");
    expect(LAB).not.toContain("convex/react");
    expect(REPORT_LIB).not.toContain("useMutation");
  });

  it("o extrator reconhece rastreio.* e um array com os dois relatórios", () => {
    const shape = {
      rastreio: { pageOcrText: "PAGINA", regionTexts: ["REGIAO"], mergedOcr: "CONSOLIDADO" },
      parsedOcr: { ok: true },
    };
    const single = collectOcrReports(shape);
    expect(single).toHaveLength(1);
    expect(single[0].mergedOcr).toBe("CONSOLIDADO");
    expect(single[0].pageOcrText).toBe("PAGINA");
    expect(single[0].regionTexts).toEqual(["REGIAO"]);

    const two = collectOcrReports([
      { arquivo: "Incotech Company.pdf", mergedOcr: "PDF" },
      { arquivo: "Incotech Company.png", mergedOcr: "PNG" },
    ]);
    expect(two.map((entry) => entry.label)).toEqual([
      "Incotech Company.pdf",
      "Incotech Company.png",
    ]);

    // Sem textos de OCR a extração falha com mensagem clara (não silêncio).
    expect(() => parseReportInput(JSON.stringify({ qualquer: 1 }))).toThrow(
      /sem textos OCR/i,
    );
  });

  it("sem fixtures versionadas, a suíte de documentos originais fica PULADA", () => {
    // Guarda anti-"sucesso artificial": se os arquivos não existem, os testes
    // de documento real não rodam (describe.skipIf) e ninguém pode confundi-los
    // com uma validação executada.
    if (presentFixtures.length === 0) {
      expect(presentFixtures).toHaveLength(0);
      // Aviso explícito no log da suíte:
      console.warn(
        "[R20] Fixtures do OCR original AUSENTES em src/__tests__/fixtures/ — " +
          "suíte do documento real PULADA. Forneça incotech-company-pdf.report.json " +
          "e incotech-company-png.report.json (ou cole o JSON em /dev/danfe-lab).",
      );
    } else {
      expect(presentFixtures.length).toBeGreaterThan(0);
    }
  });
});
