/**
 * Resolução segura das URLs Convex por ambiente.
 *
 * first-herring-264 é o backend operacional confirmado pelo responsável do
 * SIGESGD. Homologação usa exclusivamente tame-alligator-797. Não se presume
 * um deployment de desenvolvimento diferente sem confirmação operacional.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTIVE_OPERATIONAL_CONVEX_URL,
  DEVELOPMENT_CONVEX_URL,
  HOMOLOGATION_CONVEX_URL,
  PRODUCTION_CONVEX_URL,
  convexHost,
  isHomologacaoEnv,
  resolveConvexUrl,
} from "@/lib/convex-url";

const read = (path: string) => readFileSync(resolve(__dirname, "..", "..", path), "utf8");
const MAIN = read("src/main.tsx");
const SCRIPT = read("scripts/build-homolog.mjs");

describe("backend operacional confirmado", () => {
  it("produção e destino operacional usam first-herring-264", () => {
    const official = "https://first-herring-264.convex.cloud";
    expect(PRODUCTION_CONVEX_URL).toBe(official);
    expect(ACTIVE_OPERATIONAL_CONVEX_URL).toBe(official);
    expect(resolveConvexUrl({})).toBe(official);
    expect(resolveConvexUrl({ MODE: "production" })).toBe(official);
    expect(resolveConvexUrl({
      MODE: "production",
      VITE_CONVEX_URL: "https://savory-sockeye-292.convex.cloud",
    })).toBe(official);
  });

  it("preserva o destino atual em desenvolvimento até existir backend isolado confirmado", () => {
    expect(DEVELOPMENT_CONVEX_URL).toBe(PRODUCTION_CONVEX_URL);
    expect(resolveConvexUrl({ MODE: "development" })).toBe(PRODUCTION_CONVEX_URL);
    expect(resolveConvexUrl({ VITE_APP_ENV: "development" })).toBe(PRODUCTION_CONVEX_URL);
    expect(resolveConvexUrl({
      MODE: "development",
      VITE_CONVEX_URL: DEVELOPMENT_CONVEX_URL,
    })).toBe(PRODUCTION_CONVEX_URL);
    expect(() => resolveConvexUrl({
      MODE: "development",
      VITE_CONVEX_URL: "https://unexpected-preview.convex.cloud",
    })).toThrow(/desenvolvimento só pode usar/i);
  });

  it("bloqueia VITE_APP_ENV=development em build de produção", () => {
    expect(() => resolveConvexUrl({
      MODE: "production",
      VITE_APP_ENV: "development",
    })).toThrow(/Build de produção não pode usar o backend de desenvolvimento/i);
  });

  it("recusa ambiente desconhecido", () => {
    expect(() => resolveConvexUrl({ VITE_APP_ENV: "staging" })).toThrow(/VITE_APP_ENV desconhecido/i);
  });
});

describe("homologação isolada e fail-closed", () => {
  it("aceita exclusivamente tame-alligator-797", () => {
    expect(HOMOLOGATION_CONVEX_URL).toBe("https://tame-alligator-797.convex.cloud");
    expect(resolveConvexUrl({
      VITE_APP_ENV: "homologacao",
      VITE_CONVEX_URL: HOMOLOGATION_CONVEX_URL,
    })).toBe(HOMOLOGATION_CONVEX_URL);
    expect(isHomologacaoEnv({ VITE_APP_ENV: " HOMOLOGACAO " })).toBe(true);
  });

  it("exige URL explícita", () => {
    expect(() => resolveConvexUrl({ VITE_APP_ENV: "homologacao" })).toThrow(/VITE_CONVEX_URL/i);
  });

  it("recusa backend operacional, savory e deployments de preview", () => {
    const forbidden = [
      PRODUCTION_CONVEX_URL,
      "https://savory-sockeye-292.convex.cloud",
      "https://first-starling-943.convex.cloud",
      "https://brilliant-bullfrog-982.convex.cloud",
      "https://first-dinosaur-625.convex.cloud",
    ];
    for (const url of forbidden) {
      expect(() => resolveConvexUrl({
        VITE_APP_ENV: "homologacao",
        VITE_CONVEX_URL: url,
      })).toThrow(/só pode usar/i);
    }
  });

  it("recusa URL inválida, HTTP ou host externo", () => {
    for (const bad of [
      "https://nao-e-convex.example.com",
      "http://sigesgd-staging.convex.cloud",
      "sigesgd-staging.convex.cloud",
    ]) {
      expect(() => resolveConvexUrl({
        VITE_APP_ENV: "homologacao",
        VITE_CONVEX_URL: bad,
      })).toThrow();
    }
  });
});

describe("diagnóstico e script usam o resolvedor", () => {
  it("main.tsx não fixa URL inline", () => {
    expect(MAIN).toContain('from "@/lib/convex-url"');
    expect(MAIN).toContain("new ConvexReactClient(resolvedConvexUrl)");
    expect(MAIN).not.toContain('"https://first-herring-264.convex.cloud"');
    expect(MAIN).not.toContain('"https://savory-sockeye-292.convex.cloud"');
  });

  it("script de homologação valida o destino e não faz deploy", () => {
    expect(SCRIPT).toContain('import("../src/lib/convex-url.ts")');
    expect(SCRIPT).toContain("BLOCKED_CONVEX_HOSTS");
    expect(SCRIPT).toContain("tame-alligator-797.convex.cloud");
    expect(SCRIPT).not.toContain("convex deploy");
    expect(SCRIPT).not.toContain("CONVEX_DEPLOY_KEY");
  });

  it("expõe somente host no diagnóstico", () => {
    expect(convexHost("https://abc.convex.cloud/api?key=segredo")).toBe("abc.convex.cloud");
    expect(convexHost("não é url")).toBeNull();
  });
});
