/**
 * Diagnóstico técnico da importação DANFE — temporário, local e descritivo.
 *
 * Registra as etapas REAIS executadas numa leitura (pdf.js, fallback dos
 * fluxos de conteúdo, OCR, combinação de textos, parses antes e depois da
 * comparação e o objeto final entregue à conferência) para localizar
 * exatamente em qual etapa emitente, destinatário ou itens deixam de existir.
 *
 * Regras desta ferramenta:
 *  - não altera parser, comparação nem resultado da importação;
 *  - nada é gravado no banco nem enviado a serviços externos;
 *  - nunca inclui o conteúdo binário do arquivo nem o texto integral do
 *    documento — apenas contagens e trechos limitados (DIAGNOSTICO_TRECHO_MAX).
 */
import {
  DANFE_TRACKED_FIELDS,
  danfeFieldNotes,
  danfeFieldSummary,
  danfeFieldWarnings,
  type DanfeParseResult,
} from "@/lib/danfe-ocr";

/** Espelha `version` do package.json — identifica a revisão do build. */
export const APP_VERSION = "0.7.0";

/** Limite de caracteres por trecho de contexto incluído no diagnóstico. */
export const DIAGNOSTICO_TRECHO_MAX = 400;

export interface DanfeDiagnosticIdentificacao {
  diagnosticoId: string;
  geradoEm: string;
  versaoApp: string;
  modo: "desenvolvimento" | "producao";
  /** Nome do bundle de entrada servido (ex.: /assets/index-<hash>.js). */
  bundleEntrada: string | null;
  userAgent: string | null;
}

/** Etapa 1 — leitura da camada de texto de um PDF. */
export interface PdfLayerStage {
  pdfjsExecutado: boolean;
  paginas: number | null;
  itensTextoPdfjs: number | null;
  /** O ArrayBuffer original continuou legível depois da chamada ao pdf.js? */
  bufferDisponivelAposPdfjs: boolean | null;
  erroPdfjs: string | null;
  fallbackExecutado: boolean;
  fallbackCaracteres: number | null;
  fallbackLinhas: number | null;
  fallbackErro: string | null;
  fonteDoTexto: "camada-pdfjs" | "fluxos-de-conteudo" | "nenhuma";
  camadaCaracteres: number;
  camadaLinhas: number;
}

export interface DanfeTextSourceStat {
  nome: string;
  caracteres: number;
  linhas: number;
  trecho: string;
  trechoTruncado: boolean;
  marcadores?: Array<{ marcador: string; linhas: string[] }>;
}

export interface DanfeItemDiagnostic {
  codigo: string;
  descricao: string;
  quantidade: number;
  unidade: string;
  valorUnitario: number;
  valorTotal: number;
  quantidadeXunitario: number;
  diferencaQuantidadeXunitario: number | null;
}

export interface DanfeParseSummary {
  rotulo: string;
  executado: boolean;
  ok: boolean;
  camposIdentificados: number;
  camposTotais: number;
  camposEncontrados: string[];
  camposAusentes: string[];
  itensDetectados: number;
  itens: DanfeItemDiagnostic[];
  valoresPrincipais: Record<string, string | number | null>;
}

export interface DanfeDiagnosticInput {
  identificacao: DanfeDiagnosticIdentificacao;
  arquivo: {
    nome: string;
    tipo: string;
    tamanhoBytes: number | null;
    formato: "pdf" | "imagem" | "desconhecido";
  };
  pdf?: PdfLayerStage;
  imagem?: {
    ocrExecutado: boolean;
    motivoDecisao: string;
    textoPaginaCaracteres: number;
    textoPaginaLinhas: number;
    regioesQuantidade: number;
    regioesCaracteres: number;
    regioesLinhas: number;
  };
  decisaoOcr: { executado: boolean; motivo: string };
  /**
   * Estatísticas das fontes de texto REAIS (trecho limitado + contagens).
   * O diagnóstico converte as fontes completas (rawText, pageOcrText,
   * regionTexts, mergedOcr) em estatísticas antes de montar a saída, e as
   * fontes completas nunca deixam a memória do diálogo.
   */
  fontesTexto: DanfeTextSourceStat[];
  /** Versão resumida das fontes completas — usada apenas para expandir o
   * diagnóstico com linhas relevantes de cada estágio. Não embute o texto
   * integral do documento; somente o necessário para localizar marcadores.
   */
  fontesTextoCompletas?: {
    /** Camada textual do PDF (pdf.js ou fallback dos fluxos de conteúdo). */
    camada?: string | null;
    /** OCR da página inteira (tesseract.js). */
    pageOcr?: string | null;
    /** Cada região OCR, identificada pelo seu índice na página. */
    regionOcr?: (string | null)[];
    /** Texto efetivamente passado a parseDanfeText (mergedOcr). */
    mergedOcr?: string | null;
  };
  textoUtilizadoPor: "camada" | "ocr" | "nenhuma";
  parses?: {
    camada?: DanfeParseResult;
    ocr?: DanfeParseResult;
    escolhido?: "camada" | "ocr" | null;
  };
  final?: DanfeParseResult;
  /** Decisões que conectam as etapas (R28.1 §3). */
  decisoesConectoras?: {
    hasLayer?: boolean;
    layerMissingCore?: boolean;
    needsOcr?: boolean;
    parsedLayer?: DanfeParseResult | undefined;
    parsedOcr?: DanfeParseResult | undefined;
    comparisonBetter?: boolean | null;
  };
  estadoInterface: { transformacoes: string[] };
  erros: string[];
}

export interface DanfeDiagnostic {
  identificacao: DanfeDiagnosticIdentificacao;
  arquivo: DanfeDiagnosticInput["arquivo"];
  etapas: {
    pdf: PdfLayerStage | null;
    imagem: NonNullable<DanfeDiagnosticInput["imagem"]> | null;
    decisaoOcr: DanfeDiagnosticInput["decisaoOcr"];
    textoUtilizadoPor: DanfeDiagnosticInput["textoUtilizadoPor"];
    fontesTexto: DanfeTextSourceStat[];
    fontesDetalhadas: {
      camadaCaracteres: number | null;
      camadaMarcadores: Array<{ marcador: string; linhas: string[] }>;
      pageOcrCaracteres: number | null;
      pageOcrMarcadores: Array<{ marcador: string; linhas: string[] }>;
      regionOcr: Array<{
        indiceRegiao: number;
        caracteres: number;
        marcadores: Array<{ marcador: string; linhas: string[] }>;
      }>;
      mergedOcrCaracteres: number | null;
      mergedOcrMarcadores: Array<{ marcador: string; linhas: string[] }>;
      linhasPorFonte: Array<{
        nome: string;
        linhas: Array<{ marcador: string; linhas: string[] }>;
      }>;
    };
    decisoesConectoras: {
      hasLayer: boolean | null;
      layerMissingCore: boolean | null;
      needsOcr: boolean | null;
      parsedLayer: DanfeParseResult | undefined;
      parsedOcr: DanfeParseResult | undefined;
      comparisonBetter: boolean | null;
    };
  };
  parses: {
    camada: DanfeParseSummary;
    ocr: DanfeParseSummary;
    escolhido: "camada" | "ocr" | null;
  };
  resultadoFinal: DanfeParseSummary & {
    valorTotalNota: number | null;
    somaDosItens: number;
    diferencaTotalNotaSomaItens: number | null;
    conferenciaTotalVsItens: "coerente" | "divergente" | "sem-itens" | "sem-total";
  };
  pendencias: Array<{ campo: string; titulo: string; motivo: string; confianca: number }>;
  dataDeEmissao: {
    valor: string | null;
    pendente: boolean;
    motivoOuOrigem: string;
    chaveConfereApenasAnoMes: boolean;
    diaValidadoPelaChave: boolean;
  };
  estadoInterface: {
    transformacoes: string[];
    camposNoObjetoFinal: number;
    itensNoObjetoFinal: number;
    camposPrincipais: Record<string, string | number | null>;
  };
  erros: string[];
}

/** Conta linhas de um texto (vazio ⇒ 0). */
export function countTextLines(text: string | null | undefined): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

/** Trecho curto de contexto — nunca o texto integral do documento. */
export function trechoDe(
  texto: string | null | undefined,
  limite: number = DIAGNOSTICO_TRECHO_MAX,
): { trecho: string; trechoTruncado: boolean } {
  if (!texto) return { trecho: "", trechoTruncado: false };
  if (texto.length <= limite) return { trecho: texto, trechoTruncado: false };
  return { trecho: texto.slice(0, limite), trechoTruncado: true };
}

const marcadoresDaFonte = linhasRelevantesDe;

const MARCADORES_DANFE = [
  "INCOTECH",
  "22.816.315",
  "NOME",
  "RAZAO SOCIAL",
  "CAPIVARI",
  "44.723.674",
  "DESTINATARIO",
  "231071",
  "84716053",
  "25.0000",
  "52.94",
  "1323.50",
  "1.323,50",
] as const;

/**
 * Linhas relevantes de um texto para os marcadores da DANFE — sem armazenar
 * o texto integral do documento. Só as linhas que contêm um marcador (e no
 * máximo uma linha vizinha de contexto) são mantidas na saída.
 */
export function linhasRelevantesDe(
  texto: string | null | undefined,
  contextoVizinha: number = 1,
): Array<{ marcador: string; linhas: string[] }> {
  if (!texto) return [];
  const lines = texto.split(/\r?\n/);
  const resultado: Array<{ marcador: string; linhas: string[] }> = [];

  for (const marcador of MARCADORES_DANFE) {
    const indices: number[] = [];
    const alvo = marcador.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(alvo)) indices.push(i);
    }
    if (!indices.length) continue;

    const conjunto = new Set<number>();
    for (const i of indices) {
      conjunto.add(i);
      const inicio = Math.max(0, i - contextoVizinha);
      const fim = Math.min(lines.length - 1, i + contextoVizinha);
      for (let j = inicio; j <= fim; j++) conjunto.add(j);
    }
    const linhas = Array.from(conjunto)
      .sort((a, b) => a - b)
      .map((i) => lines[i]);
    resultado.push({ marcador, linhas });
  }
  return resultado;
}

function redonda(value: number): number {
  return Math.round(value * 100) / 100;
}

function descreverItem(item: {
  code?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  unitValue?: number;
  totalValue?: number;
}): DanfeItemDiagnostic {
  const quantidade = item.quantity ?? 0;
  const unitValue = item.unitValue ?? 0;
  const totalValue = item.totalValue ?? 0;
  const produto = redonda(quantidade * unitValue);
  return {
    codigo: item.code ?? "",
    descricao: item.description ?? "",
    quantidade,
    unidade: item.unit ?? "",
    valorUnitario: unitValue,
    valorTotal: totalValue,
    quantidadeXunitario: produto,
    diferencaQuantidadeXunitario:
      totalValue > 0 || quantidade > 0 ? redonda(totalValue - produto) : null,
  };
}

/** Resumo de UM parse: campos identificados/ausentes e itens — sem mascarar. */
export function describeDanfeParse(
  rotulo: string,
  parsed: DanfeParseResult | undefined,
): DanfeParseSummary {
  if (!parsed) {
    return {
      rotulo,
      executado: false,
      ok: false,
      camposIdentificados: 0,
      camposTotais: DANFE_TRACKED_FIELDS.length,
      camposEncontrados: [],
      camposAusentes: DANFE_TRACKED_FIELDS.map((field) => field.titulo),
      itensDetectados: 0,
      itens: [],
      valoresPrincipais: {},
    };
  }

  const summary = danfeFieldSummary(parsed);
  const ausentes = new Set(summary.missing);
  return {
    rotulo,
    executado: true,
    ok: parsed.ok,
    camposIdentificados: summary.found,
    camposTotais: summary.total,
    camposEncontrados: DANFE_TRACKED_FIELDS.filter((field) => !ausentes.has(field.titulo)).map(
      (field) => field.titulo,
    ),
    camposAusentes: summary.missing,
    itensDetectados: parsed.items.length,
    itens: parsed.items.map(descreverItem),
    valoresPrincipais: {
      nfeNumber: parsed.nfeNumber ?? null,
      series: parsed.series ?? null,
      emissionDate: parsed.emissionDate ?? null,
      accessKey: parsed.accessKey ?? null,
      emitterCnpj: parsed.emitterCnpj ?? null,
      emitterName: parsed.emitterName ?? null,
      receiverCnpj: parsed.receiverCnpj ?? null,
      receiverName: parsed.receiverName ?? null,
      issuerCnpj: parsed.issuerCnpj ?? null,
      issuerName: parsed.issuerName ?? null,
      totalValue: parsed.totalValue ?? null,
    },
  };
}

/** Monta o diagnóstico completo a partir das etapas realmente executadas. */
export function buildDanfeDiagnostic(input: DanfeDiagnosticInput): DanfeDiagnostic {
  const final = input.final;
  const finalSummary = describeDanfeParse("resultado final (o que a tela exibe)", final);

  const somaDosItens = finalSummary.itens.reduce((total, item) => total + item.valorTotal, 0);
  const valorTotalNota = final?.totalValue ?? null;
  const diferenca =
    valorTotalNota != null ? redonda(valorTotalNota - redonda(somaDosItens)) : null;
  const conferencia: DanfeDiagnostic["resultadoFinal"]["conferenciaTotalVsItens"] =
    finalSummary.itensDetectados === 0
      ? "sem-itens"
      : valorTotalNota == null
        ? "sem-total"
        : Math.abs(diferenca ?? Infinity) <= 0.05
          ? "coerente"
          : "divergente";

  const pendencias = final
    ? danfeFieldNotes(final).map((validation) => ({
        campo: validation.campo,
        titulo: validation.titulo,
        motivo: validation.note,
        confianca: validation.confidence,
      }))
    : [];

  const warningsData = final ? danfeFieldWarnings(final) : [];
  const dataWarning = warningsData.find((w) => w.campo === "emissionDate");
  const dataPendencia = pendencias.find((p) => p.campo === "emissionDate");

  return {
    identificacao: input.identificacao,
    arquivo: input.arquivo,
    etapas: {
      pdf: input.pdf ?? null,
      imagem: input.imagem ?? null,
      decisaoOcr: input.decisaoOcr,
      textoUtilizadoPor: input.textoUtilizadoPor,
      fontesTexto: input.fontesTexto.map((fonte) => ({
        ...fonte,
        marcadores: marcadoresDaFonte(fonte.trecho),
      })),
      /** Textos completos das etapas REAIS — usados SOMENTE para localizar
       * marcadores, nunca para embular o documento. Cada fonte registra
       * apenas as linhas relevantes nos marcadores da DANFE. */
      fontesDetalhadas: (() => {
        const camada = input.fontesTextoCompletas?.camada ?? null;
        const pageOcr = input.fontesTextoCompletas?.pageOcr ?? null;
        const regionOcr = input.fontesTextoCompletas?.regionOcr ?? [];
        const mergedOcr = input.fontesTextoCompletas?.mergedOcr ?? null;

        const camadaMarcadores = marcadoresDaFonte(camada);
        const pageOcrMarcadores = marcadoresDaFonte(pageOcr);
        const mergedOcrMarcadores = marcadoresDaFonte(mergedOcr);

        return {
          camadaCaracteres: camada?.length ?? null,
          camadaMarcadores,
          pageOcrCaracteres: pageOcr?.length ?? null,
          pageOcrMarcadores,
          regionOcr: regionOcr.map((texto, index) => ({
            indiceRegiao: index,
            caracteres: texto?.length ?? 0,
            marcadores: linhasRelevantesDe(texto),
          })),
          mergedOcrCaracteres: mergedOcr?.length ?? null,
          mergedOcrMarcadores,
          linhasPorFonte: [
            { nome: "camada", linhas: camadaMarcadores },
            { nome: "pageOcr", linhas: pageOcrMarcadores },
            ...regionOcr.map((texto, index) => ({
              nome: `regionOcr[${index}]`,
              linhas: linhasRelevantesDe(texto),
            })),
            { nome: "mergedOcr", linhas: mergedOcrMarcadores },
          ],
        };
      })(),
      /** Decisões que conectam as etapas (R28.1 §3) — registradas com os
       * valores REAIS dessa execução, sem inferência. */
      decisoesConectoras: {
        hasLayer: input.decisoesConectoras?.hasLayer ?? null,
        layerMissingCore: input.decisoesConectoras?.layerMissingCore ?? null,
        needsOcr: input.decisoesConectoras?.needsOcr ?? null,
        parsedLayer: input.decisoesConectoras?.parsedLayer ?? undefined,
        parsedOcr: input.decisoesConectoras?.parsedOcr ?? undefined,
        comparisonBetter: input.decisoesConectoras?.comparisonBetter ?? null,
      },
    },
    parses: {
      camada: describeDanfeParse("parse da camada de texto", input.parses?.camada),
      ocr: describeDanfeParse("parse do texto combinado (OCR/camada)", input.parses?.ocr),
      escolhido: input.parses?.escolhido ?? null,
    },
    resultadoFinal: {
      ...finalSummary,
      valorTotalNota,
      somaDosItens: redonda(somaDosItens),
      diferencaTotalNotaSomaItens: diferenca,
      conferenciaTotalVsItens: conferencia,
    },
    pendencias,
    dataDeEmissao: {
      valor: final?.emissionDate ?? null,
      pendente: Boolean(dataPendencia),
      motivoOuOrigem: dataPendencia?.motivo ?? dataWarning?.note ?? "Sem leitura da data.",
      // A chave de acesso codifica somente AAAA e MM: o DIA NUNCA é validado
      // por ela, apenas ano/mês são conferidos.
      chaveConfereApenasAnoMes: Boolean(final?.accessKey),
      diaValidadoPelaChave: false,
    },
    estadoInterface: {
      transformacoes: input.estadoInterface.transformacoes,
      camposNoObjetoFinal: finalSummary.camposIdentificados,
      itensNoObjetoFinal: finalSummary.itensDetectados,
      camposPrincipais: finalSummary.valoresPrincipais,
    },
    erros: input.erros,
  };
}
