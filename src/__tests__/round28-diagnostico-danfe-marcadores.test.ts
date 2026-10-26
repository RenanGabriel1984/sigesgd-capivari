/**
 * R28.1 — novos campos do diagnóstico: marcadores por fonte e decisões
 * conectoras. Não toca parser/comparação/banco; só confirma que o montador
 * registra, a partir das fontes reais, onde cada marcador foi encontrado e
 * que as decisões (hasLayer, layerMissingCore, needsOcr, parsedLayer,
 * parsedOcr, comparisonBetter) chegam ao diagnóstico.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DanfeReadError,
  extractPdfTextLayer,
  readDanfeFile,
} from "@/components/DanfeImportDialog";
import {
  APP_VERSION,
  DIAGNOSTICO_TRECHO_MAX,
  linhasRelevantesDe,
  trechoDe,
} from "@/lib/danfe-diagnostics";
import { parseDanfeText } from "@/lib/danfe-ocr";

const PDF_FIXTURE = resolve(__dirname, "fixtures", "danfe-incotech-2967-original.pdf");

describe("R28.1 — diagnóstico técnico: marcadores e decisões reais", () => {
  it("registra, por fonte, as linhas onde cada marcador aparece (sem texto integral)", async () => {
    const file = new File([readFileSync(PDF_FIXTURE)], "Incotech Company.pdf", {
      type: "application/pdf",
    });

    const { diagnostic } = await readDanfeFile(file, () => {});

    expect(diagnostic.etapas.fontesDetalhadas).toBeDefined();
    const detalhes = diagnostic.etapas.fontesDetalhadas!;

    /**
     * R28.1 §1: o fixture reconhece emitente, destinatário e item 231071. O
     * diagnóstico de produção precisa poder comparar FONTES; se o marcador não
     * aparece em uma fonte, essa fonte é o primeiro ponto de divergência
     * comprovado na importação real — e não uma suposição deParser.
     */
    expect(detalhes.camadaCaracteres ?? null, "camada completa disponível para busca de marcadores").not.toBeNull();
    expect(detalhes.camadaMarcadores.length, "camada registra marcadores encontrados").toBeGreaterThan(0);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "INCOTECH"),
      "camada contém INCOTECH",
    ).toBe(true);

    // CNPJ e nome do emitente/figurante do fixture.
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "22.816.315"),
      "camada contém CNPJ do emitente",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "RAZAO SOCIAL"),
      "camada contém rótulo RAZAO SOCIAL",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "NOME"),
      "camada contém rótulo NOME",
    ).toBe(true);

    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "CAPIVARI"),
      "camada contém CAPIVARI",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "44.723.674"),
      "camada contém CNPJ do destinatário",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "DESTINATARIO"),
      "camada contém DESTINATARIO",
    ).toBe(true);

    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "231071"),
      "camada contém código do item 231071",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some((m) => m.marcador === "84716053"),
      "camada contém NCM/item do fixture",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some(
        (m) => m.marcador === "25.0000" || m.marcador === "52.94",
      ),
      "camada contém quantidade/valor unitário do item",
    ).toBe(true);
    expect(
      detalhes.camadaMarcadores.some(
        (m) => m.marcador === "1323.50" || m.marcador === "1.323,50",
      ),
      "camada contém valor total da nota",
    ).toBe(true);

    // PRESTAÇÃO: cada fonte retorna SOMENTE as linhas relevantes, nunca o
    // texto integral do documento (R28.1 §2).
    for (const marcador of detalhes.camadaMarcadores) {
      for (const linha of marcador.linhas) {
        expect(linha.length, "linha de contexto limitada").toBeLessThanOrEqual(4000);
      }
    }

    // Marcadores que NÃO devem aparecer em nenhuma fonte do diagnóstico:
    // confirmação explícita de que o diagnóstico não inventa ocorrências.
    const todosMarcadoresFonte = new Set<string>();
    for (const fonte of diagnostic.etapas.fontesDetalhadas?.linhasPorFonte) {
      for (const grupo of fonte.linhas ?? []) {
        for (const linha of (grupo as { linhas: string[] }).linhas ?? []) {
          expect(
            !linha.toLowerCase().includes("%pdf"),
            "texto integral do PDF não aparece no diagnóstico",
          ).toBe(true);
        }
      }
    }
  });

  it("registra decisões conectoras com os valores reais da leitura", async () => {
    const file = new File([readFileSync(PDF_FIXTURE)], "Incotech Company.pdf", {
      type: "application/pdf",
    });

    const { diagnostic } = await readDanfeFile(file, () => {});

    expect(diagnostic.etapas.decisoesConectoras).toBeDefined();
    const d = diagnostic.etapas.decisoesConectoras!;

    // Este PDF tem camada textual legível (extraída do fallback dos fluxos),
    // então hasLayer deve ser true e needsOcr false.
    expect(d.hasLayer, "camada legível presente").toBe(true);
    expect(d.layerMissingCore, "camada não perde núcleo (nomes/itens)").toBe(false);
    expect(d.needsOcr, "OCR não executado porque a camada é boa").toBe(false);
    expect(d.parsedLayer).toBeDefined();
    expect(d.parsedOcr).toBeDefined();

    // R28.1 §3: o parser vence a comparação quando a camada reconhece
    // emitente/destinatário/itens com evidência — e o JSON precisa mostrar
    // exatamente o valor que conecta as etapas.
    expect(d.parsedLayer.items.length, "parse da camada reconhece itens").toBeGreaterThan(0);
    expect(d.parsedLayer.emitterName, "parse da camada reconhece emitente").toBeDefined();
    expect(d.parsedLayer.receiverName, "parse da camada reconhece destinatário").toBeDefined();

    expect(typeof d.comparisonBetter).toBe("boolean");
    expect(d.comparisonBetter, "camada vence a comparação neste fixture").toBe(true);

    // O parse escolhido e o final devem refletir a mesma decisão.
    expect(diagnostic.parses.escolhido, "parse escolhido reflete o vencedor").toBe("camada");
    expect(diagnostic.estadoInterface.itensNoObjetoFinal, "itens do final = itens do parse escolhido").toBeGreaterThan(
      0,
    );
  });

  it("preserva o diagnóstico parcial com decisões registradas quando a leitura falha", async () => {
    const broken = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])],
      "quebrado.pdf",
      { type: "application/pdf" },
    );

    let diagnostic: unknown = null;
    await readDanfeFile(broken, () => {}).catch((err: unknown) => {
      if (err instanceof DanfeReadError) diagnostic = err.diagnostic;
    });

    expect(diagnostic).not.toBeNull();
    const diag = diagnostic as Awaited<ReturnType<typeof readDanfeFile>>["diagnostic"];

    // Mesmo em falha, as decisões que foram registradas devem estar presentes:
    // hasLayer false (não conseguiu ler), needsOcr true (o OCR seria necessário),
    // e parsedLayer/parsedOcr com os parses que realmente rodaram.
    expect(diag.etapas.decisoesConectoras).toBeDefined();
    const d = diag.etapas.decisoesConectoras!;
    expect(d.hasLayer, "camada não legível em PDF malformado").toBe(false);
    expect(d.layerMissingCore, "camada ausente ⇒ sem núcleo").toBe(true);
    expect(d.needsOcr, "OCR seria necessário").toBe(true);

    // Zero itens: nada é atribuído ao parse — o teste de regressão de parser
    // nunca assume que a falha do PDF injeta itens.
    expect(diag.resultadoFinal.itensDetectados).toBe(0);
    expect(diag.resultadoFinal.itens).toEqual([]);
    expect(diag.estadoInterface.itensNoObjetoFinal).toBe(0);
    expect(diag.resultadoFinal.conferenciaTotalVsItens).toBe("sem-itens");
    expect(diag.erros.length).toBeGreaterThan(0);
  });

  it("linhasRelevantesDe só inclui linhas do marcador + contexto vizinho (sem texto integral)", () => {
    const texto = ["Razão social: INCOTECH COMPANY LTDA", "", "CNPJ: 22.816.315/0001-44", ""].join(
      "\n",
    );

    const resultado = linhasRelevantesDe(texto);

    const incotech = resultado.find((r) => r.marcador === "INCOTECH");
    expect(incotech).toBeDefined();
    expect(incotech!.linhas.length).toBeGreaterThan(0);
    expect(incotech!.linhas.join("\n"), "só a linha com o marcador + contexto").not.toContain(
      "CNPJ: 22.816.315/0001-44",
    );

    const cnpj = resultado.find((r) => r.marcador === "22.816.315");
    expect(cnpj).toBeDefined();
    expect(cnpj!.linhas.join("\n")).toContain("22.816.315");

    // Texto vazio não gera linhas.
    expect(linhasRelevantesDe("")).toEqual([]);
    expect(linhasRelevantesDe(null)).toEqual([]);
  });
});
