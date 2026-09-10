/**
 * SIGESGD CAPIVARI — CORREÇÃO CRÍTICA: INVENTÁRIO + ORGANIZAÇÕES
 *
 * Testes de regressão da intervenção:
 *  A) Inventário abre sem React #310 (nenhum hook após return condicional);
 *  B) Nenhuma página tem hooks condicionais (ordem constante entre renders);
 *  C) Importação da planilha continua funcionando (formato + prévia);
 *  D/E/F) Organizações: página distingue carregamento de vazio e lê a raiz da
 *         hierarquia (Secretaria → Departamento → Unidade);
 *  G) Toner Lexmark XM5365 presente na planilha de carga inicial (Armário TI 02);
 *  H) Observação "Parte do kit original e 4 cores" aplicada às famílias
 *     VersaLink, AltaLink, Lexmark CX735 e Lexmark XM5365.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSheetText, tonerKitObservation, matchesStockSearch, TONER_KIT_OBSERVATION } from "@/convex/stockHelpers";

// ═══════════════════════════════════════════════════════════════════════════
// A/B. REGRA DOS HOOKS — NENHUM HOOK APÓS RETURN CONDICIONAL (React #310)
// ═══════════════════════════════════════════════════════════════════════════

const HOOK_RE = /\buse(?:State|Effect|Memo|Callback|Query|Mutation|Auth|Context|Ref|Reducer)\s*\(/;

/**
 * Varre o corpo da função `export default` de um componente, respeitando
 * strings/comentários, e devolve:
 *  - hookLines: linhas (1-based) com chamadas de hook no nível 1 do componente;
 *  - earlyReturnLines: linhas onde existe `if (...) { return (` no nível 1.
 */
function scanDefaultComponent(filePath: string): { hookLines: number[]; earlyReturnLines: number[] } {
  const src = readFileSync(filePath, "utf-8");
  const m = src.match(/export default function \w+\([^)]*\)\s*\{/);
  if (!m) return { hookLines: [], earlyReturnLines: [] };
  const start = m.index! + m[0].length - 1; // posição do "{"

  let depth = 0;
  let i = start;
  let line = src.slice(0, start).split("\n").length;
  const hookLines: number[] = [];
  const earlyReturnLines: number[] = [];
  let lineStart = start;
  const atDepth1 = () => depth === 1;
  // rastreia "if (" aberto no nível 1 aguardando `return (` no nível 2
  let openIfLine: number | null = null;

  const markLine = (pos: number) => src.slice(0, pos).split("\n").length;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    // strings
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    // template literal (não conta chaves dentro)
    if (ch === "`") {
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    // comentários
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "\n") { line++; lineStart = i + 1; i++; continue; }

    if (ch === "{") {
      if (atDepth1()) {
        // `if (...) {` aberto no nível 1: olha para trás na linha atual
        const fromLineStart = src.slice(lineStart, i);
        if (/if\s*\([^)]*\)\s*$/.test(fromLineStart) || /if\s*\([^)]*\)\s*\{\s*$/.test(fromLineStart)) {
          openIfLine = line;
        }
      }
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (atDepth1() && openIfLine !== null) {
        // fechou o if sem `return (` no nível 2 — descarta
        openIfLine = null;
      }
      if (depth === 0) break; // fim da função default
      i++;
      continue;
    }

    // hook no nível 1
    if (atDepth1() && HOOK_RE.test(src.slice(i, i + 40))) {
      hookLines.push(line);
    }
    // `return (` no nível 2 dentro de um if do nível 1 → early return
    if (depth === 2 && openIfLine !== null && /^\s*return\s*\(/.test(src.slice(lineStart, i + 6))) {
      earlyReturnLines.push(openIfLine);
      openIfLine = null;
    }
    i++;
  }

  return { hookLines: [...new Set(hookLines)], earlyReturnLines: [...new Set(earlyReturnLines)] };
}

describe("Regra dos Hooks — React #310 (Inventory)", () => {
  const inventoryPath = join(process.cwd(), "src/pages/Inventory.tsx");

  it("A) Inventário não possui hook após o primeiro return condicional", () => {
    const { hookLines, earlyReturnLines } = scanDefaultComponent(inventoryPath);
    expect(earlyReturnLines.length).toBeGreaterThan(0); // a página tem loading condicional
    const firstEarly = Math.min(...earlyReturnLines);
    const hooksAfter = hookLines.filter((l) => l > firstEarly);
    expect(hooksAfter).toEqual([]);
  });

  it("A) Inventário ainda usa useMemo para a prévia da planilha (funcionalidade preservada)", () => {
    const src = readFileSync(inventoryPath, "utf-8");
    expect(src).toMatch(/const sheetRows = useMemo\(/);
    expect(src).toMatch(/parseSheetText\(sheetText\)/);
  });
});

describe("Regra dos Hooks — todas as páginas", () => {
  const pagesDir = join(process.cwd(), "src/pages");
  const pages = readdirSync(pagesDir).filter((f) => f.endsWith(".tsx"));

  it(`B) Nenhuma das ${pages.length} páginas tem hook após return condicional`, () => {
    const violations: string[] = [];
    for (const page of pages) {
      const { hookLines, earlyReturnLines } = scanDefaultComponent(join(pagesDir, page));
      if (earlyReturnLines.length === 0) continue;
      const firstEarly = Math.min(...earlyReturnLines);
      const hooksAfter = hookLines.filter((l) => l > firstEarly);
      if (hooksAfter.length > 0) {
        violations.push(`${page}: hooks após linha ${firstEarly}: ${hooksAfter.join(", ")}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D/E/F. ORGANIZAÇÕES — carregamento ≠ vazio; hierarquia com raiz
// ═══════════════════════════════════════════════════════════════════════════

describe("Organizações — página e hierarquia", () => {
  const orgPath = join(process.cwd(), "src/pages/Organization.tsx");
  const src = readFileSync(orgPath, "utf-8");

  it("D) Enquanto a query carrega, mostra skeleton (e não 'Nenhuma unidade')", () => {
    expect(src).toMatch(/if \(orgData === undefined\)/);
    expect(src).toMatch(/return <LoadingSkeleton \/>/);
  });

  it("E) A raiz da hierarquia é detectada por ausência de parentId", () => {
    expect(src).toMatch(/orgData\?\.orgs\.filter\(\(o\) => !o\.parentId\)/);
  });

  it("F) A árvore filtra filhos pelo parentId (Secretaria → Departamento → Unidade)", () => {
    expect(src).toMatch(/allOrgs\.filter\(\(o\) => o\.parentId === org\._id\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P3. ESTOQUE OPERACIONAL — busca ampla + "Solicitar este item"
// ═══════════════════════════════════════════════════════════════════════════

describe("Estoque operacional — busca", () => {
  const toner = {
    name: "CART. TONER PRETO 28K CX-735 (81C8XK0)",
    internalCode: "0110000735",
    manufacturer: "Gomaq",
    brand: "Lexmark",
    model: "CX735",
    specification: "Compatível com CX-735 / 28K páginas",
  };

  it("encontra por nome, marca, modelo, especificação, fabricante e código", () => {
    expect(matchesStockSearch(toner, "toner preto")).toBe(true);
    expect(matchesStockSearch(toner, "Lexmark")).toBe(true);
    expect(matchesStockSearch(toner, "CX735")).toBe(true);
    expect(matchesStockSearch(toner, "28k páginas")).toBe(true);
    expect(matchesStockSearch(toner, "Gomaq")).toBe(true);
    expect(matchesStockSearch(toner, "0110000735")).toBe(true);
  });

  it("não encontra termos ausentes e ignora caixa/acentos irrelevantes", () => {
    expect(matchesStockSearch(toner, "ribbon")).toBe(false);
    expect(matchesStockSearch(toner, "")).toBe(true); // termo vazio = sem filtro
  });

  it("não agrupa toners diferentes apenas por descrição semelhante", () => {
    const ciano = { ...toner, name: "CART. TONER CIANO 16.2K CX-735 (81C8XC0)", internalCode: "0110002735" };
    expect(matchesStockSearch(ciano, "ciano")).toBe(true);
    expect(matchesStockSearch(ciano, "preto")).toBe(false);
  });
});

describe("Estoque operacional — botão Solicitar este item", () => {
  it("a tela de Estoque navega para /requests?product=<id> (desktop e mobile)", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/Stock.tsx"), "utf-8");
    expect(src).toMatch(/\/requests\?product=\$\{p\._id\}/);
    expect(src).toMatch(/Solicitar este item/);
  });

  it("a tela de Solicitações pré-seleciona o produto vindo da URL", () => {
    const src = readFileSync(join(process.cwd(), "src/pages/Requests.tsx"), "utf-8");
    expect(src).toMatch(/useSearchParams\(\)/);
    expect(src).toMatch(/prefillProduct = searchParams\.get\("product"\)/);
    expect(src).toMatch(/productId: prefillProduct/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P4. SOLICITAÇÃO → APROVAÇÃO → ENTREGA — confirmação autenticada
// ═══════════════════════════════════════════════════════════════════════════

describe("Entrega autenticada e autoaprovação", () => {
  const reqSrc = readFileSync(join(process.cwd(), "src/convex/requests.ts"), "utf-8");

  it("a entrega exige confirmação por senha (assinatura eletrônica)", () => {
    expect(reqSrc).toMatch(/confirmationPassword: v\.string\(\)/);
    expect(reqSrc).toMatch(/verifyPassword\(args\.confirmationPassword/);
    expect(reqSrc).toMatch(/Assinado eletronicamente por/);
  });

  it("a entrega registra quem entregou e quem recebeu", () => {
    expect(reqSrc).toMatch(/receivedByUserId/);
    expect(reqSrc).toMatch(/deliveredBySignature/);
  });

  it("a entrega baixa físico e reservado juntos (FIFO por lote)", () => {
    expect(reqSrc).toMatch(/newPhysical = freshStock\.physicalQuantity - input\.quantityDelivered/);
    expect(reqSrc).toMatch(/newReserved = freshStock\.reservedQuantity - input\.quantityDelivered/);
    expect(reqSrc).toMatch(/requestItemLots/);
  });

  it("técnico não pode aprovar a própria solicitação", () => {
    expect(reqSrc).toMatch(/Não é possível aprovar sua própria solicitação/);
    expect(reqSrc).toMatch(/Técnicos não podem aprovar solicitações/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// P5. INVENTÁRIO — justificativa obrigatória no fechamento
// ═══════════════════════════════════════════════════════════════════════════

describe("Inventário — ajuste nunca silencioso", () => {
  const invSrc = readFileSync(join(process.cwd(), "src/convex/inventory.ts"), "utf-8");
  const pageSrc = readFileSync(join(process.cwd(), "src/pages/Inventory.tsx"), "utf-8");

  it("o fechamento exige justificativa obrigatória no backend", () => {
    expect(invSrc).toMatch(/justification: v\.string\(\)/);
    expect(invSrc).toMatch(/justificativa do fechamento é obrigatória/);
    expect(invSrc).toMatch(/Justificativa: \$\{justification\}/);
  });

  it("a tela pede a justificativa antes de fechar (diálogo)", () => {
    expect(pageSrc).toMatch(/A justificativa é obrigatória para fechar o inventário/);
    expect(pageSrc).toMatch(/Justificativa \*/);
    expect(pageSrc).toMatch(/closeInventory\(\{ inventoryId: closeTarget as any, justification/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. IMPORTAÇÃO DA PLANILHA — formato preservado
// ═══════════════════════════════════════════════════════════════════════════

describe("Importação da planilha de carga inicial", () => {
  it("C) O parser continua aceitando o formato Localização; Produto; Marca; Quantidade; Unidade; Observação", () => {
    const rows = parseSheetText(
      "Localização; Produto; Marca; Quantidade; Unidade; Observação\n" +
        "Armário TI 01; Cabo HDMI; Exbom; 8; un; Caixa original"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      locationName: "Armário TI 01",
      productName: "Cabo HDMI",
      brand: "Exbom",
      quantity: 8,
      unitOfMeasure: "un",
      observation: "Caixa original",
    });
  });

  it("C) Não converte caixas/pacotes em unidades (90 UNI permanece 90)", () => {
    const rows = parseSheetText("Armário TI 02; Bobina Termica 80x40 caixa c 30 unid; Gomaq; 90; un; Caixa com 30 unid");
    expect(rows[0].quantity).toBe(90);
    expect(rows[0].observation).toBe("Caixa com 30 unid");
  });

  it("C) 53 linhas (52 existentes + XM5365) são interpretadas sem perda", () => {
    const base = Array.from({ length: 52 }, (_, i) => `Armário TI 01; Item de teste ${i + 1}; Marca; 1; un;`);
    const lines = [...base, "Armário TI 02; Toner Lexmark XM5365; Lexmark; 1; un; Parte do kit original e 4 cores"];
    const rows = parseSheetText(lines.join("\n"));
    expect(rows).toHaveLength(53);
    expect(rows[52]).toMatchObject({
      locationName: "Armário TI 02",
      productName: "Toner Lexmark XM5365",
      quantity: 1,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G. TONER LEXMARK XM5365 — planilha real
// ═══════════════════════════════════════════════════════════════════════════

describe("Toner Lexmark XM5365 na carga inicial", () => {
  const csv = readFileSync(join(process.cwd(), "docs/planilha-carga-inicial.csv"), "utf-8");

  it("G) A planilha contém o registro real do XM5365 no Armário TI 02", () => {
    const rows = parseSheetText(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      locationName: "Armário TI 02",
      productName: "Toner Lexmark XM5365",
      brand: "Lexmark",
      quantity: 1,
      unitOfMeasure: "un",
      observation: TONER_KIT_OBSERVATION,
    });
  });

  it("G) Nenhuma quantidade fictícia para outras cores da XM5365 foi incluída", () => {
    const rows = parseSheetText(csv);
    const xm5365 = rows.filter((r) => r.productName.toLowerCase().includes("xm5365"));
    expect(xm5365).toHaveLength(1);
    expect(xm5365[0].quantity).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. OBSERVAÇÃO DOS TONERS DE KIT (VersaLink, AltaLink, Lexmark CX735)
// ═══════════════════════════════════════════════════════════════════════════

describe("Observação 'Parte do kit original e 4 cores'", () => {
  it("H) Xerox VersaLink recebe a observação", () => {
    expect(tonerKitObservation({ brand: "Xerox", model: "VersaLink C405" })).toBe(TONER_KIT_OBSERVATION);
  });

  it("H) Xerox AltaLink recebe a observação (descrição real da NF-e)", () => {
    expect(
      tonerKitObservation({ name: "CART. TONER XEROX (006R01759) ALTALINK C8145 C8155 C8170/C8270 CIANOIMP" })
    ).toBe(TONER_KIT_OBSERVATION);
  });

  it("H) Lexmark CX735 recebe a observação (descrição real da NF-e)", () => {
    expect(
      tonerKitObservation({ name: "CART. TONER PRETO 28K CX-735 (81C8XK0)" })
    ).toBe(TONER_KIT_OBSERVATION);
    expect(
      tonerKitObservation({ name: "CART. TONER AMARELO 16.2K CX-735 (81C8XY0)" })
    ).toBe(TONER_KIT_OBSERVATION);
  });

  it("H) Lexmark XM5365 recebe a observação", () => {
    expect(tonerKitObservation({ name: "Toner Lexmark XM5365", brand: "Lexmark", specification: "XM5365" })).toBe(
      TONER_KIT_OBSERVATION
    );
  });

  it("H) 'TONER' genérico ou produtos comuns NÃO recebem a observação (sem agrupamento por descrição)", () => {
    expect(tonerKitObservation({ name: "TONER" })).toBeNull();
    expect(tonerKitObservation({ name: "Toner HP Preto", brand: "HP" })).toBeNull();
    expect(tonerKitObservation({ name: "Cabo HDMI", brand: "Exbom" })).toBeNull();
    expect(tonerKitObservation({ brand: "Kingston", model: "NV2" })).toBeNull();
  });

  it("H) A observação é relacional e nunca altera quantidade física", () => {
    // A regra devolve apenas texto de observação — sem campos de estoque
    const obs = tonerKitObservation({ name: "CART. TONER CIANO 16.2K CX-735 (81C8XC0)" });
    expect(obs).toBe(TONER_KIT_OBSERVATION);
    expect(TONER_KIT_OBSERVATION).not.toMatch(/qtd|quantity|estoque/i);
  });
});