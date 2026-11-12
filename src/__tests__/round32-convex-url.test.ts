/**
 * R32.0 — Resolução da URL do backend Convex.
 *
 * Garante que:
 *  • a aplicação continua no backend operacional atual, onde o Freebuff
 *    carrega os dados (first-herring-264), sem inferir isso pelo tipo Convex;
 *  • homologação só é possível com VITE_APP_ENV=homologacao + URL isolada, e
 *    falha fechado (erro) quando falta URL, a URL é inválida ou aponta para o
 *    deployment oficial;
 *  • o cliente Convex em `main.tsx` usa esse resolvedor — não há mais URL
 *    fixa inline nem chance de um build "homolog" falar com o banco oficial.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ACTIVE_OPERATIONAL_CONVEX_URL,
  HOMOLOGATION_CONVEX_URL,
  convexHost,
  isHomologacaoEnv,
  resolveConvexUrl,
} from "@/lib/convex-url";

const read = (path: string) => readFileSync(resolve(__dirname, "..", "..", path), "utf8");
const MAIN = read("src/main.tsx");
const SCRIPT = read("scripts/build-homolog.mjs");

describe("R32 — o backend operacional atual permanece preservado", () => {
  it("sem VITE_APP_ENV usa first-herring, onde o Freebuff carrega os dados atuais", () => {
    expect(resolveConvexUrl({})).toBe(ACTIVE_OPERATIONAL_CONVEX_URL);
    expect(ACTIVE_OPERATIONAL_CONVEX_URL).toBe(
      "https://first-herring-264.convex.cloud",
    );
  });

  it("ignora VITE_CONVEX_URL injetado fora de homologação", () => {
    expect(
      resolveConvexUrl({ VITE_CONVEX_URL: "https://outro-deployment.convex.cloud" }),
    ).toBe(ACTIVE_OPERATIONAL_CONVEX_URL);
    expect(
      resolveConvexUrl({
        VITE_APP_ENV: "production",
        VITE_CONVEX_URL: "https://savory-sockeye-292.convex.cloud",
      }),
    ).toBe(ACTIVE_OPERATIONAL_CONVEX_URL);
  });
});

describe("R32 — homologação isolada e fail-closed", () => {
  it("aceita exclusivamente o Production do projeto Convex de homologação", () => {
    expect(
      resolveConvexUrl({
        VITE_APP_ENV: "homologacao",
        VITE_CONVEX_URL: HOMOLOGATION_CONVEX_URL,
      }),
    ).toBe(HOMOLOGATION_CONVEX_URL);
    expect(isHomologacaoEnv({ VITE_APP_ENV: " HOMOLOGACAO " })).toBe(true);
  });

  it("exige a URL (não cai silenciosamente no oficial)", () => {
    expect(() => resolveConvexUrl({ VITE_APP_ENV: "homologacao" })).toThrow(
      /VITE_CONVEX_URL/i,
    );
  });

  it("recusa todos os deployments do projeto principal e o Development do projeto homologação", () => {
    const forbidden = [
      "https://savory-sockeye-292.convex.cloud",
      "https://first-herring-264.convex.cloud",
      "https://first-starling-943.convex.cloud",
      "https://brilliant-bullfrog-982.convex.cloud",
      "https://first-dinosaur-625.convex.cloud",
    ];
    for (const url of forbidden) {
      expect(() =>
        resolveConvexUrl({ VITE_APP_ENV: "homologacao", VITE_CONVEX_URL: url }),
      ).toThrow(/só pode usar/i);
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

describe("R32 — app e script usam a mesma regra", () => {
  it("main.tsx não fixa mais a URL e usa o resolvedor", () => {
    expect(MAIN).toContain('from "@/lib/convex-url"');
    expect(MAIN).toContain("new ConvexReactClient(resolvedConvexUrl)");
    expect(MAIN).not.toContain('"https://first-herring-264.convex.cloud"');
  });

  it("script de homologação valida com o resolvedor e nunca faz deploy", () => {
    expect(SCRIPT).toContain('import("../src/lib/convex-url.ts")');
    expect(SCRIPT).toContain("BLOCKED_CONVEX_HOSTS");
    expect(SCRIPT).toContain("tame-alligator-797.convex.cloud");
    expect(SCRIPT).not.toContain("convex deploy");
    expect(SCRIPT).not.toContain("CONVEX_DEPLOY_KEY");
  });
});
