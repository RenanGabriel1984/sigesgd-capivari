import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const backend = readFileSync(resolve(root, "src/convex/assetMaintenances.ts"), "utf8");
const schema = readFileSync(resolve(root, "src/convex/schema.ts"), "utf8");

describe("validação e rastreabilidade de manutenções", () => {
  it("limita estados ao conjunto suportado pelo schema", () => {
    expect(backend).toContain('["scheduled", "in_progress", "completed", "cancelled"]');
    expect(backend).toContain("status: assetMaintenanceStatusValidator");
    expect(schema).toContain('v.literal("scheduled"), v.literal("in_progress"), v.literal("completed"), v.literal("cancelled")');
  });

  it("valida equipamento, técnico, data e descrição antes de criar a manutenção", () => {
    expect(backend).toContain('asset.status === "disposed" || asset.status === "lost"');
    expect(backend).toContain("Number.isSafeInteger(args.date)");
    expect(backend).toContain("!args.reason.trim() || !args.serviceDescription.trim()");
    expect(backend).toContain('technician.active === false');
  });

  it("audita alterações de status e registra no histórico do ativo", () => {
    expect(backend).toContain('eventType: "maintenance"');
    expect(backend).toContain('action: "asset_maintenance"');
    expect(backend).toContain('entity: "assetMaintenances"');
    expect(backend).toContain('maintenance.status + " para " + args.status');
  });
  it("não trunca o histórico de manutenção nem o histórico do equipamento", () => {
    expect(backend).toContain('.withIndex("by_asset", (q) => q.eq("assetId", args.assetId))\n      .order("desc")\n      .collect();');
    const assets = readFileSync(resolve(root, "src/convex/assets.ts"), "utf8");
    expect(assets).toContain('.query("assetHistory")\n      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))\n      .order("desc")\n      .collect();');
    expect(assets).not.toContain('.query("assetHistory")\n      .withIndex("by_asset", (q) => q.eq("assetId", args.assetId))\n      .order("desc")\n      .take(100)');
  });

});
