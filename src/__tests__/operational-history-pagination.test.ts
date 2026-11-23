describe("paginação do arquivo histórico de entregas", () => {
  it("usa endpoint paginado com escopo por usuário e filtros no backend", () => {
    const backend = read("convex/requests.ts");
    const endpoint = backend.slice(backend.indexOf("export const listDeliveredPaginated"), backend.indexOf("Historico de Consumo por organizacao"));
    expect(endpoint).toContain("paginationOptsValidator");
    expect(endpoint).toContain("requireUser(ctx)");
    expect(endpoint).toContain("fullVisibility");
    expect(endpoint).toContain("enrichRequest");
    expect(endpoint).toContain("serialSearch");
    expect(endpoint).not.toContain(".take(500)");
  });

  it("a tela usa cursor e oferece carregamento incremental", () => {
    const page = read("pages/Requests.tsx");
    expect(page).toContain("usePaginatedQuery(");
    expect(page).toContain("api.requests.listDeliveredPaginated");
    expect(page).toContain("loadMoreDeliveredRequests(50)");
    expect(page).not.toContain("allDeliveredRequests");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("paginação dos históricos operacionais", () => {
  it("usa cursor do Convex para entradas, transferências e devoluções", () => {
    for (const path of ["convex/entries.ts", "convex/stockTransfers.ts", "convex/returns.ts"]) {
      const source = read(path);
      expect(source).toContain("paginationOptsValidator");
      expect(source).toContain("paginate(args.paginationOpts)");
      expect(source).toContain("return { ...page, page: enriched }");
    }
  });

  it("usa cursor do Convex também em equipamentos, movimentações e solicitações", () => {
    for (const path of ["convex/assets.ts", "convex/stockMovements.ts", "convex/requests.ts"]) {
      const source = read(path);
      expect(source).toContain("paginationOptsValidator");
      expect(source).toContain("paginate(args.paginationOpts)");
      expect(source).toContain("page:");
    }
  });

  it("oferece carregamento incremental nas telas de entradas, transferências e devoluções", () => {
    const cases = [
      ["pages/Entries.tsx", "api.entries.listPage", "loadMoreEntries", "Carregar mais entradas"],
      ["pages/StockTransfers.tsx", "api.stockTransfers.listPage", "loadMoreTransfers", "Carregar mais transferências"],
      ["pages/Returns.tsx", "api.returns.listPage", "loadMoreReturns", "Carregar mais devoluções"],
    ] as const;
    for (const [path, query, loader, label] of cases) {
      const source = read(path);
      expect(source).toContain(query);
      expect(source).toContain(loader);
      expect(source).toContain(label);
      expect(source).toContain('"LoadingMore"');
    }
  });

  it("oferece carregamento incremental em equipamentos, movimentações e solicitações", () => {
    const cases = [
      ["pages/Assets.tsx", "api.assets.listPaginated", "loadMoreAssets", "Carregar mais equipamentos"],
      ["pages/Movements.tsx", "api.stockMovements.listPaginated", "loadMoreMovements", "Carregar mais movimentações"],
      ["pages/Requests.tsx", "api.requests.listPaginated", "loadMoreRequests", "Carregar mais solicitações"],
    ] as const;
    for (const [path, query, loader, label] of cases) {
      const source = read(path);
      expect(source).toContain(query);
      expect(source).toContain(loader);
      expect(source).toContain(label);
      expect(source).toContain('"LoadingMore"');
    }
  });
  it("não limita artificialmente históricos legados de entregas e consumo por organização", () => {
    const backend = read("convex/requests.ts");
    const delivered = backend.slice(backend.indexOf("export const listDelivered ="), backend.indexOf("export const listDeliveredPaginated"));
    const organization = backend.slice(backend.indexOf("export const listByOrganization ="));
    expect(delivered).toContain('.order("desc")\n      .collect();');
    expect(organization).toContain('.order("desc")\n      .collect();');
    expect(delivered).not.toContain(".take(500)");
    expect(organization).not.toContain(".take(500)");
  });

});

describe("paginação e escopo do histórico de devoluções", () => {
  it("pagina saídas devolvíveis em vez de carregar o histórico completo", () => {
    const backend = read("convex/returns.ts");
    const page = backend.slice(
      backend.indexOf("export const returnablePage = query({"),
      backend.indexOf("export const returnableByExit = query({"),
    );
    expect(page).toContain("paginationOptsValidator");
    expect(page).toContain('.withIndex("by_type"');
    expect(page).toContain(".paginate(args.paginationOpts)");
    expect(page).toContain("buildReturnableExitRow");
    expect(page).not.toContain(".collect()");
  });

  it("calcula devolução com consultas indexadas à saída e à solicitação, sem varrer todas as devoluções", () => {
    const backend = read("convex/returns.ts");
    const helper = backend.slice(
      backend.indexOf("async function loadReturnsForExit"),
      backend.indexOf("async function buildReturnableExitRow"),
    );
    expect(helper).toContain('.withIndex("by_exitMovement"');
    expect(helper).toContain('.withIndex("by_request"');
    expect(helper).toContain("!record.exitMovementId");
    expect(helper).toContain("record.productId === exit.productId");
    expect(helper).not.toContain('query("returns").collect()');
    const create = backend.slice(backend.indexOf("export const create = mutation({"));
    expect(create).toContain("loadReturnsForExit(ctx, exit)");
    expect(create).not.toContain("loadReturns(ctx)");
  });

  it("preserva acesso direto a uma saída antiga sem carregar todas as páginas", () => {
    const backend = read("convex/returns.ts");
    const byExit = backend.slice(backend.indexOf("export const returnableByExit = query({"));
    expect(byExit).toContain('v.id("stockMovements")');
    expect(byExit).toContain("ctx.db.get(args.exitMovementId)");
    expect(byExit).toContain("buildReturnableExitRow(ctx, movement)");
  });

  it("a interface carrega as saídas em páginas e mantém o deep-link por ID", () => {
    const page = read("pages/Returns.tsx");
    expect(page).toContain("api.returns.returnablePage");
    expect(page).toContain("loadMoreExits(50)");
    expect(page).toContain("api.returns.returnableByExit");
    expect(page).toContain('exitParam ? { exitMovementId: exitParam as any } : "skip"');
    expect(page).toContain("Carregar mais saídas");
  });
});
