/**
 * R33.0 — Resolução da URL do backend Convex.
 *
 * Garante que produção usa savory-sockeye-292, o desenvolvimento local usa
 * first-herring-264 e a homologação nunca reutiliza nenhum desses backends.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEVELOPMENT_CONVEX_URL,
  OFFICIAL_CONVEX_URL,
  convexHost,
  isDevelopmentEnv,
  isHomologacaoEnv,
  resolveConvexUrl,
} from "@/lib/convex-url";

const read = (path: string) => readFileSync(resolve(__dirname, "..", "..", path), "utf8");
const MAIN = read("src/main.tsx");
const SCRIPT = read("scripts/build-homolog.mjs");

describe("R33 — roteamento dos ambientes", () => {
  it("fixa produção no deployment oficial confirmado", () => {
    expect(OFFICIAL_CONVEX_URL).toBe("https://savory-sockeye-292.convex.cloud");
    expect(resolveConvexUrl({})).toBe(OFFICIAL_CONVEX_URL);
  });

  it("ignora VITE_CONVEX_URL externo no build de produção", () => {
    expect(
      resolveConvexUrl({ VITE_CONVEX_URL: DEVELOPMENT_CONVEX_URL }),
    ).toBe(OFFICIAL_CONVEX_URL);
    expect(
      resolveConvexUrl({
        VITE_APP_ENV: "production",
        VITE_CONVEX_URL: "https://outro-deployment.convex.cloud",
      }),
    ).toBe(OFFICIAL_CONVEX_URL);
  });

  it("usa desenvolvimento no modo local, sem apontar para produção", () => {
    expect(DEVELOPMENT_CONVEX_URL).toBe("https://first-herring-264.convex.cloud");
    expect(resolveConvexUrl({ DEV: true, MODE: "development" })).toBe(
      DEVELOPMENT_CONVEX_URL,
    );
    expect(resolveConvexUrl({ VITE_APP_ENV: "development" })).toBe(
      DEVELOPMENT_CONVEX_URL,
    );
    expect(isDevelopmentEnv({ DEV: true })).toBe(true);
  });

  it("permite backend Convex alternativo em desenvolvimento, mas bloqueia produção", () => {
    expect(
      resolveConvexUrl({
        VITE_APP_ENV: "development",
        VITE_CONVEX_URL: "https://first-starling-943.convex.cloud",
      }),
    ).toBe("https://first-starling-943.convex.cloud");
    expect(() =>
      resolveConvexUrl({
        VITE_APP_ENV: "development",
        VITE_CONVEX_URL: OFFICIAL_CONVEX_URL,
      }),
    ).toThrow(/produção/i);
  });
});

describe("R33 — homologação isolada e fail-closed", () => {
  it("aceita URL isolada quando VITE_APP_ENV=homologacao", () => {
    expect(
      resolveConvexUrl({
        VITE_APP_ENV: "homologacao",
        VITE_CONVEX_URL: "https://sigesgd-staging.convex.cloud",
      }),
    ).toBe("https://sigesgd-staging.convex.cloud");
    expect(isHomologacaoEnv({ VITE_APP_ENV: " HOMOLOGACAO " })).toBe(true);
  });

  it("exige URL explícita e não cai silenciosamente em produção", () => {
    expect(() => resolveConvexUrl({ VITE_APP_ENV: "homologacao" })).toThrow(
      /VITE_CONVEX_URL/i,
    );
  });

  it("recusa os backends oficial e de desenvolvimento", () => {
    for (const forbidden of [OFFICIAL_CONVEX_URL, DEVELOPMENT_CONVEX_URL]) {
      expect(() =>
        resolveConvexUrl({
          VITE_APP_ENV: "homologacao",
          VITE_CONVEX_URL: forbidden,
        }),
      ).toThrow(/produção ou desenvolvimento/i);
    }
  });

  it("recusa URL inválida, http ou host que não é Convex", () => {
    for (const bad of [
      "https://nao-e-convex.example.com",
      "http://sigesgd-staging.convex.cloud",
      "sigesgd-staging.convex.cloud",
    ]) {
      expect(() =>
        resolveConvexUrl({ VITE_APP_ENV: "homologacao", VITE_CONVEX_URL: bad }),
      ).toThrow();
    }
  });

  it("expõe apenas o host", () => {
    expect(convexHost("https://abc.convex.cloud/api?key=segredo")).toBe(
      "abc.convex.cloud",
    );
    expect(convexHost("não é url")).toBeNull();
  });
});

describe("R33 — app e script usam a mesma regra", () => {
  it("main.tsx usa o resolvedor, sem URL fixa inline", () => {
    expect(MAIN).toContain('from "@/lib/convex-url"');
    expect(MAIN).toContain("new ConvexReactClient(resolvedConvexUrl)");
    expect(MAIN).not.toContain('"https://first-herring-264.convex.cloud"');
    expect(MAIN).not.toContain('"https://savory-sockeye-292.convex.cloud"');
  });

  it("script de homologação bloqueia produção/desenvolvimento e nunca faz deploy", () => {
    expect(SCRIPT).toContain('import("../src/lib/convex-url.ts")');
    expect(SCRIPT).toContain("PRODUCTION_CONVEX_HOSTS");
    expect(SCRIPT).toContain("DEVELOPMENT_CONVEX_HOSTS");
    expect(SCRIPT).not.toContain("convex deploy");
    expect(SCRIPT).not.toContain("CONVEX_DEPLOY_KEY");
  });
});
