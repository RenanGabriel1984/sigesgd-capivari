import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const query = readFileSync(
  resolve(__dirname, "../../scripts/stock-movement-traceability-audit.inline.ts"),
  "utf8",
);

describe("reconciliação histórica de saída e devolução — somente leitura", () => {
  it("consulta a saída, a devolução e as tabelas de alocação sem mutações", () => {
    expect(query).toContain('ctx.db.query("stockMovements")');
    expect(query).toContain('ctx.db.query("returns")');
    expect(query).toContain('ctx.db.query("stockMovementLotAllocations")');
    expect(query).toContain('ctx.db.query("returnLotAllocations")');
    expect(query).not.toMatch(/ctx\.db\.(insert|patch|replace|delete)\s*\(/);
    expect(query).not.toMatch(/runMutation|internalMutation/);
    expect(query).toContain("writesPerformed: 0");
    expect(query).toContain("mutationsImported: false");
  });

  it("só propõe vínculos quando saída, lote, produto, quantidade e armários fecham", () => {
    expect(query).toContain("historicalExitReturnTraceability");
    expect(query).toContain("readyForMetadataBackfill");
    expect(query).toContain('allocationType: "withdrawal"');
    expect(query).toContain("sourceLocationId: String(exit.locationId)");
    expect(query).toContain("destinationLocationId: String(returned.locationId)");
    expect(query).toContain("totalReturnedForExit");
    expect(query).toContain("vínculo temporal entre registro de devolução e movimento não é único");
  });

  it("distingue o vínculo ao lote de origem do disposition histórico não gravado", () => {
    expect(query).toContain("returnRecordLotId");
    expect(query).toContain("sourceLotNumber");
    expect(query).toContain("stockDispositionRecorded");
    expect(query).toContain("expectedDispositionFromRecordedCondition");
  });
});
