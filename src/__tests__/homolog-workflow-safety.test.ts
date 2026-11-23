import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = readFileSync(
  resolve(__dirname, "..", "..", ".github", "workflows", "convex-homologacao.yml"),
  "utf8",
);

describe("segurança do workflow de homologação", () => {
  it("só pode ser acionado manualmente com confirmação explícita", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("github.event.inputs.confirmar == 'publicar-homologacao'");
    expect(workflow).toContain("default: nao");
  });

  it("faz checkout exclusivamente do código integrado na main", () => {
    expect(workflow).toContain("ref: main");
    expect(workflow).not.toContain("ref: codex/");
    expect(workflow).toContain("refs/heads/main");
  });

  it("valida a chave e publica exclusivamente no deployment de homologação", () => {
    expect(workflow).toContain("ALVO_REF: tame-alligator-797");
    expect(workflow).toContain("ALVO_HOST: tame-alligator-797.convex.cloud");
    expect(workflow).toContain("CONVEX_DEPLOY_KEY_HOMOLOG");
    expect(workflow).toContain("first-herring-264.convex.cloud");
    expect(workflow).toContain("Deployed Convex functions to https://\u0024{ALVO_HOST}");
  });
});
