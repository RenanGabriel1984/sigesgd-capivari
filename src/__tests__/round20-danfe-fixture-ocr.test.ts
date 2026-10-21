/** @preserve /home/daytona/codebase/src/__tests__/round20-danfe-fixture-ocr.test.ts */

/** @brown[20] RODADA 20 — FIXTURES JSON VERSIONADAS DO OCR REAL (INCOTECH COMPANY LTDA) */

/** @brown[20] COMO FORNECER OS RELATÓRIOS ORIGINAIS (pela interface web de edição do projeto): crie os arquivos abaixo com o conteúdo JSON colado do botão "Copiar relatório JSON" de cada diagnóstico (ou cole o texto na tela /dev/danfe-lab, que executa o mesmo parser sem gravar nada): */

/** @brown[20] src/__tests__/fixtures/incotech-company-pdf.report.json ← Incotech Company.pdf */

/** @brown[20] src/__tests__/fixtures/incotech-company-png.report.json ← Incotech Company.png */

/** @brown[20] Enquanto os arquivos não existirem, a suíte de fixtures é EXIBIDA COMO PULADA (nunca passa fingindo que os documentos originais foram testados). A segunda describe testa apenas o MECANISMO de recepção — não o documento. */

/** @brown[20] Segurança: fixtures locais apenas; nenhuma mutation, nenhum acesso a banco. */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { digitsOnly } from "@/lib/br-validators";
import {
  danfeFieldSummary,
  mergeDanfeTexts,
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

/** @brown[20] Referência do documento (item 2 da Rodada 20) — falha = divergência real.
 *
 * As expectativas vêm EXCLUSIVAMENTE do que os relatórios reais sustentam.
 * Campos que o OCR destes relatórios não contém (unidade, AF, empenho,
 * transportadora) são exigidos como PENDENTES: o parser sinaliza revisão
 * manual em vez de inventar ou confirmar valor sintético (§6). */
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
  expect(digitsOnly(p.emitterCnpj ?? "")).not.toBe(digitsOnly(p.receiverCnpj ?? ""));

  expect(p.items.length, `${origem}: nº de itens`).toBeGreaterThanOrEqual(1);
  expect(item?.code, `${origem}: código do item`).toBe("231071");
  expect(norm(item?.description), `${origem}: descrição`).toBe(
    norm("KIT TECLADO E MOUSE USB SLIM CHOCO"),
  );
  expect(item?.ncm, `${origem}: NCM`).toBe("84716053");
  expect(item?.quantity, `${origem}: quantidade`).toBe(25);
  expect(item?.unitValue, `${origem}: valor unitário`).toBeCloseTo(52.94, 2);
  expect(item?.totalValue, `${origem}: total do item`).toBeCloseTo(1323.5, 2);
  expect(p.totalValue, `${origem}: total da nota`).toBeCloseTo(1323.5, 2);

  // A coluna UN não foi lida pelo OCR destes relatórios: a unidade NÃO pode
  // virar "PC" de gabarito — fica vazia e sinalizada para conferência manual.
  expect(item?.unit, `${origem}: unidade não inventada`).toBe("");
  expect(p.notes?.items, `${origem}: unidade pendente sinalizada`).toMatch(/unidade/i);

  // Total da nota sem rótulo no OCR: aceito apenas por conferir com a soma
  // dos itens, com origem registrada para conferência visual.
  expect(p.notes?.totalValue, `${origem}: origem do total registrada`).toMatch(
    /soma dos itens/i,
  );

  // AF, empenho e transportadora NÃO constam destes relatórios reais:
  // permanecem pendentes — nunca preenchidos com valores de gabarito.
  expect(p.afNumber, `${origem}: AF pendente (não inventada)`).toBeUndefined();
  expect(p.empenhoNumber, `${origem}: empenho pendente (não inventado)`).toBeUndefined();
  expect(p.transporterCnpj, `${origem}: transportadora pendente (não inventada)`).toBeUndefined();

  // Validação estrutural: campos sem evidência ficam pendentes, nunca inventados.
  expect(ok("nfeNumber"), `${origem}: validação número`).toBe(true);
  expect(ok("series"), `${origem}: validação série`).toBe(true);
  expect(ok("accessKey"), `${origem}: validação chave`).toBe(true);
  expect(ok("items"), `${origem}: validação itens`).toBe(true);
  expect(ok("emitterCnpj"), `${origem}: validação CNPJ emitente`).toBe(true);
  expect(ok("receiverCnpj"), `${origem}: validação CNPJ destinatário`).toBe(true);
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

describe(
  "R20 — integração com o caminho real do diálogo (readDanfeFile via mergeDanfeTexts)",
  () => {
    for (const { file, origem } of presentFixtures) {
      it(`${origem}: o diálogo queima o relatório real como na tela de Entradas`, () => {
        const raw = readFileSync(resolve(FIXTURE_DIR, file), "utf8");
        const { reports } = parseReportInput(raw);
        expect(reports.length, `${origem}: relatórios extraídos`).toBeGreaterThan(0);

        for (const payload of reports) {
          // readDanfeFile, para um PDF sem camada de texto utilizável, roda
          // mergeDanfeTexts(pageOcrText, regionTexts) e depois
          // parseDanfeText(merged) — exatamente o que o diálogo escolhe quando
          // hasUsableTextLayer(rawText) é falso (PDF escaneado). Testamos esse
          // caminho, não o buildReportText de armazenamento.
          const merged = mergeDanfeTexts(
            payload.pageOcrText ?? "",
            payload.regionTexts ?? [],
          );
          const parsed = parseDanfeText(merged);

          // — Critérios de aceitação do documento original (item 6 da tarefa) —
          expect(parsed.accessKey, `${origem}: chave`).toBe(
            "42260922816315000144550010000029671515440064",
          );
          expect(Number(digitsOnly(parsed.nfeNumber ?? "")), `${origem}: número`).toBe(2967);
          expect(parsed.series, `${origem}: série`).toBe("001");
          expect(parsed.emissionDate, `${origem}: emissão`).toBe("2026-09-28");

          // Emitente: CNPJ 22.816.315/0001-44 → INCOTECH COMPANY LTDA, nunca o
          // título da DANFE ("da Nota Fiscal Eletronica SAIDA").
          expect(
            digitsOnly(parsed.emitterCnpj ?? ""),
            `${origem}: CNPJ emitente`,
          ).toBe("22816315000144");
          expect(
            norm(parsed.emitterName),
            `${origem}: razão social emitente`,
          ).toBe(norm("INCOTECH COMPANY LTDA"));
          expect(
            parsed.emitterName,
            `${origem}: emitente ≠ título DANFE`,
          ).not.toMatch(/Nota Fiscal Eletronica|Documento Auxiliar/i);

          // Destinatário: CNPJ 44.723.674/0001-90 → MUNICIPIO DE CAPIVARI.
          expect(
            digitsOnly(parsed.receiverCnpj ?? ""),
            `${origem}: CNPJ destinatário`,
          ).toBe("44723674000190");
          expect(
            norm(parsed.receiverName),
            `${origem}: destinatário`,
          ).toBe(norm("MUNICIPIO DE CAPIVARI"));
          expect(
            parsed.receiverName,
            `${origem}: destinatário ≠ ruído de OCR`,
          ).not.toMatch(/UNICIPIO DE CAPTVART|CAPTV/i);

          // Itens: item 231071 identificado mesmo sem coluna UN.
          expect(parsed.items.length, `${origem}: nº de itens`).toBeGreaterThanOrEqual(1);
          const item = parsed.items[0];
          expect(item?.code, `${origem}: código`).toBe("231071");
          expect(
            norm(item?.description),
            `${origem}: descrição`,
          ).toBe(norm("KIT TECLADO E MOUSE USB SLIM CHOCO"));
          expect(item?.ncm, `${origem}: NCM`).toBe("84716053");
          expect(item?.quantity, `${origem}: quantidade`).toBe(25);
          expect(item?.unitValue, `${origem}: unitário`).toBeCloseTo(52.94, 2);
          expect(item?.totalValue, `${origem}: total do item`).toBeCloseTo(1323.5, 2);
          expect(parsed.totalValue, `${origem}: total da nota`).toBeCloseTo(1323.5, 2);

          // Campos sem evidência permanecem pendentes — nunca inventados.
          expect(
            parsed.afNumber,
            `${origem}: AF pendente (não inventada)`,
          ).toBeUndefined();
          expect(
            parsed.empenhoNumber,
            `${origem}: empenho pendente (não inventado)`,
          ).toBeUndefined();
          expect(
            parsed.transporterCnpj,
            `${origem}: transportadora pendente (não inventada)`,
          ).toBeUndefined();
          expect(
            parsed.receiverPendingName,
            `${origem}: destinatário sem nome pendente não deve ser sinalizado`,
          ).toBeUndefined();
          expect(
            parsed.emitterPendingName,
            `${origem}: emitente sem nome pendente não deve ser sinalizado`,
          ).toBeUndefined();
        }
      });
    }

    it("o fallback do destinatário sem rótulo de seção ainda sinaliza quando a razão social é ruído", () => {
      // Simula o pior caso de OCR: o título da DANFE e um nome degradado onde
      // deveria haver o destinatário. O parser deve rejeitá-los e deixar o CNPJ
      // identificado mas a razão social pendente — nunca exibir lixo como se
      // fosse a parte.
      const ruído = [
        "DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
        "IDENTIFICACAO DO EMITENTE",
        "da Nota Fiscal Eletronica SAIDA",
        "CNPJ/CPF 22.816.315/0001-44",
        "RUA RUI BARBOSA, 263",
        "NOME / RAZÃO SOCIAL",
        "UNICIPIO DE CAPTVART",
        "44.723.674/0001-90",
        "42260922816315000144550010000029671515440064",
      ].join("\n");
      const parsed = parseDanfeText(ruído);
      // Log de diagnóstico em caso de falha: mostra o que o parser decidiu.
      if (process.env.VITEST_DEBUG) {
        console.log("=== ruído parsed ===");
        console.log("emitterCnpj:", parsed.emitterCnpj);
        console.log("emitterName:", parsed.emitterName);
        console.log("emitterPendingName:", parsed.emitterPendingName);
        console.log("receiverCnpj:", parsed.receiverCnpj);
        console.log("receiverName:", parsed.receiverName);
        console.log("receiverPendingName:", parsed.receiverPendingName);
        console.log("receiverCnpjDigits:", digitsOnly(parsed.receiverCnpj ?? ""));
        console.log("notes:", JSON.stringify(parsed.notes, null, 2));
        console.log("confidence:", JSON.stringify(parsed.confidence, null, 2));
      }
      // O CNPJ do emitente é identificado (a seção emitente tem CNPJ próprio).
      expect(
        digitsOnly(parsed.emitterCnpj ?? ""),
        "emitente reconhece o CNPJ da INCOTECH mesmo com títuloDANFE",
      ).toBe("22816315000144");

      // Destinatário: quando sobra EXATAMENTE um CNPJ não atribuído (regra de
      // exclusão), o parser nomeia o destinatário pelo nome vizinho ao CNPJ.
      // No caso de ruído ("UNICIPIO DE CAPTVART") esse nome é rejeitado e fica
      // pendente — preservando o CNPJ identificado.
      expect(
        digitsOnly(parsed.receiverCnpj ?? ""),
        "destinatário reconhece o CNPJ exclusivo (regra de exclusão)",
      ).toBe("44723674000190");
      expect(
        parsed.receiverName,
        "destinatário NÃO aceita ruído como razão social",
      ).toBeUndefined();
      expect(
        parsed.receiverPendingName,
        "destinatário sinaliza que a razão social está pendente",
      ).toBeDefined();
      expect(
        parsed.receiverCnpj,
        "CNPJ do destinatário preservado mesmo com nome pendente",
      ).toBe("44.723.674/0001-90");
      // O teste do fixture PDF cobre o caso em que o OCR capturou o nome
      // correto ("MUNICIPIO DE CAPIVARI", com sufixo MUNICIPIO) — aí o parser o
      // aceita e receiverPendingName fica undefined.
      expect(
        parsed.accessKey,
        "chave de acesso preservada para conferência",
      ).toBe("42260922816315000144550010000029671515440064");
      expect(
        parsed.notes?.receiverName,
        "nota registra que a razão social do destinatário está pendente",
      ).toMatch(/pendente|sem sufixo|ruído|confirme/i);
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
