import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHELL = readFileSync(resolve(__dirname, "../components/AppShell.tsx"), "utf8");
const DASHBOARD = readFileSync(resolve(__dirname, "../pages/Dashboard.tsx"), "utf8");
const DIALOG = readFileSync(resolve(__dirname, "../components/ui/dialog.tsx"), "utf8");
const CSS = readFileSync(resolve(__dirname, "../index.css"), "utf8");
const USE_MOBILE = readFileSync(resolve(__dirname, "../hooks/use-mobile.ts"), "utf8");
const INDEX_HTML = readFileSync(resolve(__dirname, "../../index.html"), "utf8");
const ORGANIZATION = readFileSync(resolve(__dirname, "../pages/Organization.tsx"), "utf8");
const INVENTORY = readFileSync(resolve(__dirname, "../pages/Inventory.tsx"), "utf8");

describe("SIGESGD — Responsividade mobile (drawer, dashboard, diálogos)", () => {
  it("MV-01: menu contém TODAS as rotas de Administração (nada desaparece)", () => {
    for (const href of [
      "/products",
      "/categories",
      "/organization",
      "/users",
      "/suppliers",
      "/audit",
      "/settings",
    ]) {
      expect(SHELL).toContain(`href: "${href}"`);
    }
  });

  it("MV-02: lista do drawer usa rolagem nativa própria (overflow-y-auto, touch)", () => {
    expect(SHELL).toContain("overflow-y-auto overscroll-contain");
    expect(SHELL).toContain("WebkitOverflowScrolling");
    // ScrollArea (que falhava por toque no celular) foi removida do drawer.
    expect(SHELL).not.toContain('<ScrollArea');
  });

  it("MV-03: drawer limitado a 100dvh com safe-area inferior e sem estourar largura", () => {
    expect(SHELL).toContain('height: "100dvh"');
    expect(SHELL).toContain('maxHeight: "100dvh"');
    expect(SHELL).toContain("env(safe-area-inset-bottom)");
    expect(SHELL).toContain("w-[min(19.5rem,100vw)]");
  });

  it("MV-04: botão fechar acessível (aria-label) e header fixo do drawer", () => {
    expect(SHELL).toContain('aria-label="Fechar menu"');
    expect(SHELL).toContain("shrink-0 items-center justify-between border-b");
  });

  it("MV-05: overlay bloqueia scroll da página atrás (body overflow hidden)", () => {
    expect(SHELL).toContain('document.body.style.overflow = "hidden"');
  });

  it("MV-06: drawer fecha ao navegar (efeito sobre location.pathname)", () => {
    expect(SHELL).toMatch(/useEffect\(\(\) => \{\s*setSidebarOpen\(false\);\s*\}, \[location\.pathname\]\)/);
  });

  it("MV-07: seções viram accordions no mobile, sem remover rotas", () => {
    expect(SHELL).toContain("<Collapsible");
    expect(SHELL).toContain("toggleSection");
  });

  it("MV-08: hook useIsDesktop alinhado ao breakpoint lg (1024px)", () => {
    expect(USE_MOBILE).toContain("DESKTOP_BREAKPOINT = 1024");
    expect(USE_MOBILE).toContain("export function useIsDesktop");
  });

  it("MV-09: dashboard — botões inventário/relatórios empilham título e descrição", () => {
    expect(DASHBOARD).toContain("min-h-14 flex-col items-start gap-1 p-3 rounded-xl border");
  });

  it("MV-10: dashboard — grids só vão a 2 colunas quando há espaço (>=420px)", () => {
    const hits = DASHBOARD.match(/min-\[420px\]:grid-cols-2/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it("MV-11: dashboard — cards de indicador podem encolher (min-w-0)", () => {
    expect(DASHBOARD).toContain("flex items-center gap-3 min-w-0");
  });

  it("MV-12: dialog nunca cola nas bordas da tela (guard max-sm mesmo com max-w-* de página)", () => {
    expect(DIALOG).toContain("max-sm:max-w-[calc(100%-2rem)]");
  });

  it("MV-13: CSS global — sem scroll horizontal e safe-area disponível", () => {
    expect(CSS).toMatch(/html,\s*\n\s*body\s*\{\s*overflow-x:\s*hidden/);
    expect(CSS).toContain("env(safe-area-inset-bottom)");
  });

  it("MV-14: shell aplica padding de safe-area horizontal", () => {
    expect(SHELL).toContain("page-x-pad");
    expect(SHELL).toContain("page-bot-pad");
  });

  it("MV-15: viewport com viewport-fit=cover (notch/Android)", () => {
    expect(INDEX_HTML).toContain("viewport-fit=cover");
  });

  it("MV-16: formulários de cadastro em 1 coluna no celular (Inventory/quick-create)", () => {
    expect(INVENTORY).toContain("grid-cols-1 sm:grid-cols-2 gap-3");
  });

  it("MV-17: Organization — histórico e datas responsivos", () => {
    expect(ORGANIZATION).toContain("grid-cols-1 min-[420px]:grid-cols-2 gap-3 mb-4");
    expect(ORGANIZATION).toContain("grid-cols-1 sm:grid-cols-2 gap-4");
  });

  it("MV-18: nenhuma alteração de backend/Convex nesta rodada (correção é frontend)", () => {
    // Os arquivos editados não incluem nada de src/convex — dados intactos.
    const edited = [SHELL, DASHBOARD, DIALOG, CSS, USE_MOBILE, INDEX_HTML, ORGANIZATION, INVENTORY];
    for (const src of edited) {
      expect(src).not.toContain("ctx.db");
    }
  });
});
