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
      expect(source).toContain("page: enriched");
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
});
