import { describe, expect, it } from "vitest";
import {
  getLoginErrorMessage,
  INVALID_LOGIN_MESSAGE,
  LOGIN_TECHNICAL_ERROR_MESSAGE,
} from "@/lib/auth-error";

describe("mensagens de erro do login", () => {
  it("mantém a mensagem genérica para credenciais inválidas", () => {
    expect(getLoginErrorMessage(new Error("E-mail ou senha incorretos."))).toBe(
      INVALID_LOGIN_MESSAGE,
    );
    expect(getLoginErrorMessage(new Error("CredentialsSignin"))).toBe(
      INVALID_LOGIN_MESSAGE,
    );
  });

  it("lê ConvexError.data quando o message de produção é redigido", () => {
    const error = Object.assign(new Error("Server Error"), {
      data: "E-mail ou senha incorretos.",
    });
    expect(getLoginErrorMessage(error)).toBe(INVALID_LOGIN_MESSAGE);
  });

  it("aceita o envelope errorData do endpoint de ação", () => {
    expect(
      getLoginErrorMessage({
        errorMessage: "Server Error",
        errorData: "E-mail ou senha incorretos.",
      }),
    ).toBe(INVALID_LOGIN_MESSAGE);
  });

  it("preserva a orientação de bloqueio temporário carregada em data", () => {
    const message = "Acesso temporariamente bloqueado. Tente novamente em 15 minuto(s).";
    const error = Object.assign(new Error("Server Error"), { data: message });
    expect(getLoginErrorMessage(error)).toBe(message);
  });

  it("distingue erros técnicos de senha incorreta", () => {
    expect(getLoginErrorMessage(new Error("Server Error"))).toBe(
      LOGIN_TECHNICAL_ERROR_MESSAGE,
    );
    expect(getLoginErrorMessage(new Error("Failed to fetch"))).toBe(
      LOGIN_TECHNICAL_ERROR_MESSAGE,
    );
    expect(getLoginErrorMessage(null)).toBe(LOGIN_TECHNICAL_ERROR_MESSAGE);
  });

  it("dá orientação técnica específica na build isolada de homologação", () => {
    expect(
      getLoginErrorMessage(new Error("Server Error"), "homologacao"),
    ).toContain("sessão/JWT");
  });
});
