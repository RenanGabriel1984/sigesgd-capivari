/**
 * RODADA 8 — MÁSCARAS GLOBAIS, ENTRADA, FORNECEDOR E OCR DA DANFE
 *
 * Cobre o prompt da rodada:
 *  §1  Máscaras centralizadas (CNPJ, CPF, telefone/celular, CEP, chave NF-e,
 *      moeda) — exibição formatada, banco normalizado;
 *  §2  Fornecedor da Entrada com largura controlada (não invade o Nº da NF);
 *  §3  Cadastro inline reutiliza o MESMO formulário completo de fornecedor;
 *  §4  "Data de emissão da NF-e" com tooltip;
 *  §5  AF, Processo Administrativo e Empenho são três campos distintos;
 *  §7  PDF escaneado detectado e rasterizado a ~300 DPI;
 *  §8  OCR por regiões da DANFE;
 *  §9  Chave de acesso robusta (espaços, pontos, hífens, glifos trocados);
 *  §10 OCR parcial NÃO é falha total ("X de 10 campos" + correção manual);
 *  §11 DANFE da Incotech reconhecida (nº, série, data, chave, emitente,
 *      produto, valores, AF e empenho — SEM processo, que não existe no doc);
 *  §12 NUNCA criar entrada sem confirmação humana;
 *  §13 Regressão: XML, manual, duplicidade e documento original preservado.
 *
 * Testes PUROS: não escrevem no banco e não movimentam estoque.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  digitsOnly,
  formatCnpj,
  formatCpf,
  formatCurrency,
  formatAccessKeyGrouped,
  isValidAccessKey,
  isValidCpf,
  maskCnpj,
  maskCep,
  maskCpf,
  maskCurrency,
  maskPhone,
  normalizeAccessKey,
  normalizeCep,
  normalizeCurrency,
  normalizeCnpj,
} from "@/lib/br-validators";
import {
  DANFE_REGIONS,
  DANFE_TRACKED_FIELDS,
  danfeFieldSummary,
  hasUsableTextLayer,
  mergeDanfeTexts,
  parseDanfeText,
} from "@/lib/danfe-ocr";
import { parseNfeXml } from "@/lib/nfe";

const read = (rel: string) => readFileSync(resolve(__dirname, "..", "..", rel), "utf8");

const CNPJ = "61457941000143";
const CNPJ_MASKED = "61.457.941/0001-43";
const CPF = "12345678909";
const ACCESS_KEY = "42260922816315000144550010000029671515440064";

// ═══════════════════════════════════════════════════════════════════════════
// 1. §1 — Máscaras centralizadas: visual formatado, banco normalizado
// ═══════════════════════════════════════════════════════════════════════════

describe("§1 — Camada central de máscaras (formatar na tela, normalizar no banco)", () => {
  it("CNPJ: 61457941000143 → 61.457.941/0001-43 e volta ao banco sem pontuação", () => {
    expect(maskCnpj(CNPJ)).toBe(CNPJ_MASKED);
    expect(formatCnpj(CNPJ)).toBe(CNPJ_MASKED);
    expect(digitsOnly(maskCnpj(CNPJ))).toBe(CNPJ);
    expect(normalizeCnpj(CNPJ_MASKED)).toBe(CNPJ);
    expect(normalizeCnpj(CNPJ)).toBe(CNPJ);
  });

  it("CPF: máscara progressiva 000.000.000-00 + dígitos verificadores", () => {
    expect(maskCpf("123")).toBe("123");
    expect(maskCpf("123456789")).toBe("123.456.789");
    expect(maskCpf(CPF)).toBe("123.456.789-09");
    expect(formatCpf(CPF)).toBe("123.456.789-09");
    expect(digitsOnly(maskCpf(CPF))).toBe(CPF);
    expect(isValidCpf(CPF)).toBe(true);
    expect(isValidCpf("12345678900")).toBe(false); // DV errado
    expect(isValidCpf("11111111111")).toBe(false); // repetido
  });

  it("telefone fixo e celular: (00) 0000-0000 e (00) 00000-0000", () => {
    expect(maskPhone("614579410")).toBe("(61) 4579-410"); // fixo parcial
    expect(maskPhone("6133334444")).toBe("(61) 3333-4444"); // fixo
    expect(maskPhone("61988887777")).toBe("(61) 98888-7777"); // celular
    expect(digitsOnly(maskPhone("61988887777"))).toBe("61988887777");
  });

  it("CEP: 70040010 → 70040-010 (completo e parcial)", () => {
    expect(maskCep("70040010")).toBe("70040-010");
    expect(maskCep("7004")).toBe("7004");
    expect(normalizeCep("70040-010")).toBe("70040010");
  });

  it("chave NF-e: agrupamento visual dos 44 dígitos + normalização", () => {
    const grouped = formatAccessKeyGrouped(ACCESS_KEY);
    expect(grouped.split(" ")).toHaveLength(11);
    expect(digitsOnly(grouped)).toBe(ACCESS_KEY);
    expect(normalizeAccessKey(grouped)).toBe(ACCESS_KEY);
  });

  it("moeda: R$ 0,00 na tela, número normalizado no banco", () => {
    expect(formatCurrency(1323.5)).toBe("R$ 1.323,50");
    expect(formatCurrency("1323.5")).toBe("R$ 1.323,50");
    expect(formatCurrency("R$ 1.323,50")).toBe("R$ 1.323,50");
    // Máscara progressiva: o que foi digitado aparece, sem inventar decimais
    expect(maskCurrency("1323,5")).toBe("R$ 1.323,5");
    expect(maskCurrency("12.5")).toBe("R$ 12,5");
    expect(maskCurrency("")).toBe("");
    // Normalização para o banco (string numérica com ponto decimal)
    expect(normalizeCurrency("R$ 1.323,50")).toBe("1323.5");
    expect(normalizeCurrency("12.5")).toBe("12.5");
    expect(Number(normalizeCurrency("R$ 1.323,50"))).toBe(1323.5);
  });

  it("a camada central é a ÚNICA fonte dos formatadores usados nos formulários", () => {
    const validators = read("src/lib/br-validators.ts");
    for (const fn of [
      "export const maskCnpj",
      "export const maskCpf",
      "export const maskPhone",
      "export const maskCep",
      "export const maskCurrency",
      "export const formatCnpj",
      "export const formatCpf",
      "export const formatPhone",
      "export const formatCep",
      "export const formatCurrency",
      "export const formatAccessKeyGrouped",
      "export const normalizeCnpj",
      "export const normalizeCep",
      "export const normalizeAccessKey",
      "export const normalizeCurrency",
    ]) {
      expect(validators, fn).toContain(fn);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. §2/§3 — Fornecedor da Entrada: layout contido + formulário único
// ═══════════════════════════════════════════════════════════════════════════

describe("§2/§3 — Fornecedor na Entrada (layout) e cadastro inline completo", () => {
  const ENTRIES = read("src/pages/Entries.tsx");
  const SUPPLIER_FORM = read("src/components/SupplierForm.tsx");

  it("§2 — valor selecionado: razão social com TRUNCAMENTO + CNPJ no próprio componente", () => {
    expect(ENTRIES).toContain("<SupplierSelectValue");
    expect(ENTRIES).toContain("min-w-0 truncate");
    expect(ENTRIES).toContain("CNPJ {formatCnpj(supplier.cnpj)}");
    // Nada de string única "NOME — CNPJ" ocupando a largura toda
    expect(ENTRIES).not.toContain("${s.legalName} — ${formatCnpj(s.cnpj)}");
  });

  it("§2 — item do dropdown apresenta Razão Social e CNPJ organizados", () => {
    expect(ENTRIES).toContain('textValue={s.legalName}');
    expect(ENTRIES).toContain("CNPJ: ${formatCnpj(s.cnpj)}");
  });

  it("§2 — Nº da NF é campo INDEPENDENTE e o grid reorganiza no mobile", () => {
    expect(ENTRIES).toContain("grid grid-cols-1 sm:grid-cols-2 gap-3");
    expect(ENTRIES).toContain("Nº Nota Fiscal");
    expect(ENTRIES).toContain("min-w-0 flex-1");
  });

  it("§3 — cadastro inline usa o MESMO SupplierForm completo (não há segundo formulário)", () => {
    expect(ENTRIES).toContain("<SupplierForm");
    expect(ENTRIES).toContain("onCreated={handleSupplierCreated}");
    expect(ENTRIES).toContain("Fornecedor criado e selecionado");
    // seleção automática do fornecedor recém-criado
    expect(ENTRIES).toContain("setcSupplierId(newId)");
    // o formulário completo tem todos os campos cadastrais
    for (const field of [
      "legalName",
      "tradeName",
      "cnpj",
      "contactPerson",
      "contact",
      "phone",
      "email",
      "addressType",
      "streetName",
      "number",
      "complement",
      "district",
      "postalCode",
      "city",
      "state",
    ]) {
      expect(SUPPLIER_FORM, field).toContain(field);
    }
    expect(SUPPLIER_FORM).toContain("viacep.com.br"); // ViaCEP
    expect(SUPPLIER_FORM).toContain("isValidCnpj(cnpjDigits)"); // validação CNPJ
    expect(SUPPLIER_FORM).toContain("maskCnpj(form.cnpj)");
    expect(SUPPLIER_FORM).toContain("maskPhone(form.phone)");
    expect(SUPPLIER_FORM).toContain("maskCep(form.postalCode)");
  });

  it("§3 — não existem dois cadastros de fornecedor (formulário duplicado removido)", () => {
    const sources = [ENTRIES, read("src/pages/Suppliers.tsx")].join("\n");
    expect(sources).not.toContain("SupplierInlineCreate");
    expect(() => read("src/components/SupplierInlineCreate.tsx")).toThrow();
  });

  it("§3 — cadastro de fornecedor exige permissão no servidor e protege duplicidade", () => {
    const suppliers = read("src/convex/suppliers.ts");
    expect(suppliers).toContain('requirePermission(ctx, "suppliers.manage"');
    expect(suppliers).toContain("Já existe um fornecedor com este CNPJ");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. §4/§5 — Nomenclatura e identificadores fiscais distintos
// ═══════════════════════════════════════════════════════════════════════════

describe("§4/§5 — Data de emissão da NF-e, AF, Processo Administrativo e Empenho", () => {
  const ENTRIES = read("src/pages/Entries.tsx");
  const SCHEMA = read("src/convex/schema.ts");
  const MUTATION = read("src/convex/entries.ts");
  const DETAILS = read("src/components/EntryDetailsDialog.tsx");

  it("§4 — rótulo 'Data de emissão da NF-e' com tooltip explicativo", () => {
    expect(ENTRIES).toContain("Data de emissão da NF-e");
    expect(ENTRIES).toContain("Data em que a NF-e foi emitida pelo fornecedor.");
    expect(ENTRIES).not.toContain(">Data NF<");
    expect(DETAILS).toContain("Data de emissão da NF-e:");
  });

  it("§5 — os três campos existem, são distintos e opcionais na UI", () => {
    expect(ENTRIES).toContain("Número da AF");
    expect(ENTRIES).toContain("Número do Processo Administrativo");
    expect(ENTRIES).toContain("Número do Empenho");
    // Cada um com estado próprio — um nunca alimenta o outro
    expect(ENTRIES).toContain('value={cAfNumber}');
    expect(ENTRIES).toContain('value={cProcessNumber}');
    expect(ENTRIES).toContain('value={cEmpenhoNumber}');
    // Na conferência da NF-e também são editáveis separadamente
    expect(ENTRIES).toContain('value={nfeAfNumber}');
    expect(ENTRIES).toContain('value={nfeProcessNumber}');
    expect(ENTRIES).toContain('value={nfeEmpenhoNumber}');
  });

  it("§5 — backend: AF, Processo e Empenho persistem como campos distintos", () => {
    const entriesBlock = SCHEMA.slice(SCHEMA.indexOf("entries: defineTable"), SCHEMA.indexOf("entryItems: defineTable"));
    expect(entriesBlock).toContain("purchaseAuthorizationNumber");
    expect(entriesBlock).toContain("processNumber");
    expect(entriesBlock).toContain("empenhoNumber");
    expect(MUTATION).toContain("empenhoNumber: v.optional(v.string())");
    expect(MUTATION).toContain("empenhoNumber: args.empenhoNumber || undefined");
    // Detalhe da entrada exibe os três rótulos distintos
    expect(DETAILS).toContain("Processo Administrativo:");
    expect(DETAILS).toContain("Empenho:");
  });

  it("§5 — o NÚMERO DO EMPENHO (778/2026) é aceito e o processo não é preenchido por ele", () => {
    const parsed = parseDanfeText(
      [
        "DADOS ADICIONAIS",
        "AF: 2223/2026",
        "EMPENHO: 778/2026",
      ].join("\n"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.afNumber).toBe("2223/2026");
    expect(parsed.empenhoNumber).toBe("778/2026");
    // Sem rótulo de processo → fica VAZIO (nunca vira o empenho)
    expect(parsed.processNumber).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. §7/§8/§9/§10 — Pipeline de OCR: PDF escaneado, regiões, chave e parcial
// ═══════════════════════════════════════════════════════════════════════════

describe("§7–§10 — Pipeline PDF escaneado → OCR → parser parcial", () => {
  const DIALOG = read("src/components/DanfeImportDialog.tsx");

  it("§7 — PDF escaneado é detectado pela ausência de camada de texto", () => {
    expect(hasUsableTextLayer("")).toBe(false);
    expect(hasUsableTextLayer(null)).toBe(false);
    expect(hasUsableTextLayer("DANFE ".repeat(30))).toBe(true);
    expect(DIALOG).toContain("hasUsableTextLayer(text)");
  });

  it("§7 — rasterização a ~300 DPI e pré-processamento antes do OCR", () => {
    expect(DIALOG).toContain("TARGET_DPI / 72");
    expect(DIALOG).toContain("const TARGET_DPI = 300");
    expect(DIALOG).toContain("preprocessForOcr");
    expect(DIALOG).toContain("0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]"); // escala de cinza
    expect(DIALOG).toContain("Math.min(255, Math.max(0, Math.round(((data[i] - min) * 255) / range)))"); // contraste
    // nunca OCR em imagem pequena demais
    expect(DIALOG).toContain("MIN_OCR_WIDTH");
    expect(DIALOG).toContain("loadImageCanvas(f)");
    // rotação corrigida quando a primeira leitura sai vazia
    expect(DIALOG).toContain("corrigindo rotação");
  });

  it("§8 — OCR por regiões clássicas da DANFE (em ADDIÇÃO à página inteira)", () => {
    const keys = DANFE_REGIONS.map((r) => r.key);
    expect(keys).toEqual(
      expect.arrayContaining(["cabecalho", "chave", "emitente", "destinatario", "produtos", "totais", "dadosAdicionais"]),
    );
    for (const region of DANFE_REGIONS) {
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(1);
      expect(region.y + region.h).toBeLessThanOrEqual(1);
    }
    expect(DIALOG).toContain("ocrDanfeRegions");
    expect(DIALOG).toContain("mergeDanfeTexts");
    expect(mergeDanfeTexts("pag1", ["reg1", "reg2"])).toBe("pag1\nreg1\nreg2");
  });

  it("§9 — chave de acesso reconhecida com espaços, pontos, hífens e glifos trocados", () => {
    const spaced = parseDanfeText(
      ["NF-e Nº 2967", "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064"].join("\n"),
    );
    expect(spaced.ok && spaced.accessKey).toBe(ACCESS_KEY);

    const dotted = parseDanfeText(
      ["NF-e Nº 2967", "4226.0922.8163.1500.0144.5500.1000.0029.6715.1544.0064"].join("\n"),
    );
    expect(dotted.ok && dotted.accessKey).toBe(ACCESS_KEY);

    const dashed = parseDanfeText(
      ["NF-e Nº 2967", "4226-0922-8163-1500-0144-5500-1000-0029-6715-1544-0064"].join("\n"),
    );
    expect(dashed.ok && dashed.accessKey).toBe(ACCESS_KEY);

    // OCR trocando O→0, S→5 e B→8 dentro da chave
    const glyphNoise = parseDanfeText(
      ["NF-e Nº 2967", "4226 O922 8163 15OO O144 55OO 1OOO OO29 6715 1544 OO64"].join("\n"),
    );
    expect(glyphNoise.ok && glyphNoise.accessKey).toBe(ACCESS_KEY);

    expect(isValidAccessKey(ACCESS_KEY)).toBe(true);
    expect(isValidAccessKey("123")).toBe(false);
    expect(isValidAccessKey("99999999999999999999999999999999999999999999")).toBe(false); // UF impossível
  });

  it("§10 — resumo parcial 'X de 10 campos' com lista do que faltou", () => {
    expect(DANFE_TRACKED_FIELDS).toHaveLength(10);
    const partial = parseDanfeText(
      ["NF-e Nº 2967", "Série: 001", `CNPJ: ${CNPJ_MASKED}`, "Razão Social: GOMAQ LTDA"].join("\n"),
    );
    const summary = danfeFieldSummary(partial);
    expect(summary.total).toBe(10);
    expect(summary.found).toBe(4); // número, série, CNPJ, razão social
    expect(summary.missing).toContain("Chave de acesso");
    expect(summary.missing).toContain("Itens da NF-e");
  });

  it("§10 — a tela de conferência mostra o resumo parcial e nunca bloqueia o usuário", () => {
    expect(DIALOG).toContain("Dados identificados: {fieldSummary.found} de {fieldSummary.total} campos");
    expect(DIALOG).toContain("Você pode informar ou corrigir");
    // falha total apenas quando NADA foi identificado
    expect(DIALOG).toContain("summary.found === 0");
    expect(DIALOG).toContain("nada foi perdido");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. §11 — DANFE escaneada da INCOTECH (caso de teste obrigatório)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Texto representativo do que o OCR devolve da DANFE escaneada da Incotech
 * (PDF escaneado, ~300 DPI, com o ruído típico: espaços extras, caixa alta e
 * a chave agrupada em blocos de 4).
 */
const INCOTECH_OCR_TEXT = [
  "DANFE - DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA",
  "0 - ENTRADA   1 - SAIDA",
  "Nº 000002967",
  "SÉRIE 001",
  "CHAVE DE ACESSO",
  "4226 0922 8163 1500 0144 5500 1000 0029 6715 1544 0064",
  "NATUREZA DA OPERACAO",
  "VENDA DE MERCADORIA",
  "PROTOCOLO DE USO DE NF-e 000000000000000",
  "INSCRICAO ESTADUAL 250.123.456",
  "INCOTECH COMPANY LTDA",
  "22.816.315/0001-44",
  "RUA JOAO PESSOA, 1000 - CENTRO",
  "CRICIUMA",
  "SC",
  "CEP: 88802-000",
  "FONE (48) 3433-1000",
  "DATA DE EMISSÃO 28/09/2026",
  "DESTINATARIO / REMETENTE",
  "GOMAQ MAQUINAS PARA ESCRITORIO LTDA",
  "CNPJ: 61.457.941/0001-43",
  "DADOS DOS PRODUTOS / SERVICOS",
  "1 23107 KIT TECLADO E MOUSE USB SLIM CHOCO 25 PC 52,94 1.323,50",
  "VALOR TOTAL DA NF R$ 1.323,50",
  "DADOS ADICIONAIS",
  "AF: 2223/2026",
  "EMPENHO: 778/2026",
].join("\n");

describe("§11 — DANFE da INCOTECH reconhecida (escaneada, OCR parcial aceito)", () => {
  const parsed = parseDanfeText(INCOTECH_OCR_TEXT);

  it("é identificada como NF-e (não é tratada como ilegível)", () => {
    expect(parsed.ok).toBe(true);
    const summary = danfeFieldSummary(parsed);
    expect(summary.found).toBeGreaterThanOrEqual(7);
  });

  it("número 2967, série 001 e emissão 28/09/2026", () => {
    if (!parsed.ok) return;
    expect(parsed.nfeNumber).toBe("2967");
    expect(parsed.series).toBe("001");
    expect(parsed.emissionDate).toBe("2026-09-28");
  });

  it("chave de acesso 422609...0064 reconhecida e validada", () => {
    if (!parsed.ok) return;
    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(isValidAccessKey(parsed.accessKey ?? "")).toBe(true);
  });

  it("emitente INCOTECH COMPANY LTDA + CNPJ 22.816.315/0001-44", () => {
    if (!parsed.ok) return;
    expect(digitsOnly(parsed.emitterCnpj ?? "")).toBe("22816315000144");
    expect(parsed.emitterName).toBe("INCOTECH COMPANY LTDA");
  });

  it("item KIT TECLADO E MOUSE USB SLIM CHOCO: 23107, 25 PC, 52,94, 1.323,50", () => {
    if (!parsed.ok) return;
    expect(parsed.items).toHaveLength(1);
    const [item] = parsed.items;
    expect(item?.code).toBe("23107");
    expect(item?.description).toBe("KIT TECLADO E MOUSE USB SLIM CHOCO");
    expect(item?.quantity).toBe(25);
    expect(item?.unit).toBe("PC");
    expect(item?.unitValue).toBeCloseTo(52.94, 2);
    expect(item?.totalValue).toBeCloseTo(1323.5, 2);
  });

  it("AF 2223/2026 e Empenho 778/2026; processo VAZIO (não inventado)", () => {
    if (!parsed.ok) return;
    expect(parsed.afNumber).toBe("2223/2026");
    expect(parsed.empenhoNumber).toBe("778/2026");
    expect(parsed.processNumber).toBeUndefined();
  });

  it("destinatário não confundido com o emitente", () => {
    if (!parsed.ok) return;
    expect(digitsOnly(parsed.receiverCnpj ?? "")).not.toBe("22816315000144");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. §12/§13 — Confirmação humana, preservação do XML e regressão
// ═══════════════════════════════════════════════════════════════════════════

describe("§12/§13 — Conferência humana obrigatória e regressão", () => {
  const ENTRIES = read("src/pages/Entries.tsx");
  const DIALOG = read("src/components/DanfeImportDialog.tsx");

  it("§12 — o diálogo de OCR NÃO tem mutation alguma (nunca cria estoque sozinho)", () => {
    expect(DIALOG).not.toContain("useMutation");
    expect(DIALOG).not.toContain("api.entries");
    expect(DIALOG).not.toContain("createEntry");
    expect(DIALOG).not.toContain("confirmEntry");
    expect(DIALOG).toContain("Conferir na Entrada");
    expect(DIALOG).toContain("nada é criado sem a sua confirmação");
  });

  it("§12 — a entrada só existe após confirmação explícita do usuário", () => {
    expect(ENTRIES).toContain("confirmEntry({ entryId: entryId as any })");
    // O caminho DANFE entrega dados à conferência (handleDanfeImport) e o
    // registro acontece apenas em handleConfirmImport.
    expect(ENTRIES).toContain("handleDanfeImport");
    expect(ENTRIES).toContain("handleConfirmImport");
    expect(ENTRIES).toContain("Dados extraídos por OCR de DANFE/PDF/imagem — conferir antes de confirmar.");
  });

  it("§13 — falha de OCR não perde a Entrada: mensagem orienta para manual/XML", () => {
    expect(DIALOG).toContain("use a entrada manual");
    expect(DIALOG).toContain("Importar NF-e XML");
    expect(ENTRIES).toContain("Nova Entrada");
    expect(ENTRIES).toContain("NewEntryItemsEditor");
  });

  it("§13 — XML continua sendo o caminho preferencial e o original é preservado", () => {
    expect(ENTRIES).toContain("Importar NF-e XML");
    expect(ENTRIES).toContain("parseNfeXml(");
    expect(ENTRIES).toContain('nfeXmlFile.type || "application/xml"');
    expect(ENTRIES).toContain("Falha ao salvar o DANFE original");
    expect(DIALOG).toContain('accept=".pdf,image/*"');
    expect(DIALOG).toContain("tesseract.js");
    expect(DIALOG).toContain("pdfjs-dist");
  });

  it("§13 — duplicidade de NF continua bloqueada (chave ou fornecedor+número+série)", () => {
    expect(ENTRIES).toContain("Esta NF-e já está cadastrada no SIGESGD");
    expect(ENTRIES).toContain("findDuplicateEntry(entries ?? [], {");
  });

  it("§13 — AF/Processo/Empenho vindos do XML vão para os campos certos", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <NFe><infNFe Id="NFe${ACCESS_KEY}" versao="4.00">
          <ide><cUF>42</cUF><natOp>VENDA</natOp><mod>55</mod><serie>001</serie><nNF>000002967</nNF><dhEmi>2026-09-28T10:00:00-03:00</dhEmi></ide>
          <emit><CNPJ>22816315000144</CNPJ><xNome>INCOTECH COMPANY LTDA</xNome></emit>
          <det nItem="1"><prod><cProd>23107</cProd><xProd>KIT TECLADO E MOUSE USB SLIM CHOCO</xProd><NCM>84716050</NCM><CFOP>5102</CFOP><uCom>PC</uCom><qCom>25.0000</qCom><vUnCom>52.9400</vUnCom><vProd>1323.50</vProd><cEAN>SEM GTIN</cEAN></prod></det>
          <total><ICMSTot><vNF>1323.50</vNF></ICMSTot></total>
          <infAdic><infCpl>AF 2223/2026 - Empenho 778/2026 - Pedido 5544</infCpl></infAdic>
        </infNFe></NFe>
      </nfeProc>`;
    const parsed = parseNfeXml(xml);
    expect(parsed.accessKey).toBe(ACCESS_KEY);
    expect(parsed.afNumber).toBe("2223/2026");
    expect(parsed.empenhoNumber).toBe("778/2026");
    // Sem rótulo de processo no XML → continua vazio
    expect(parsed.processNumber).toBeUndefined();
    expect(parsed.items).toHaveLength(1);
  });
});
