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

  it("oferece carregamento incremental nas três telas", () => {
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
});
