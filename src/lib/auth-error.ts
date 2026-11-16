export const INVALID_LOGIN_MESSAGE = "E-mail ou senha inválidos.";
export const LOGIN_TECHNICAL_ERROR_MESSAGE =
  "Não foi possível concluir o login por uma falha técnica. Tente novamente. Se persistir, informe o suporte.";

const CREDENTIAL_ERROR_MARKERS = [
  "e-mail ou senha incorretos",
  "e-mail ou senha inválidos",
  "incorretos",
  "inválidos",
  "invalid credentials",
  "credentialssignin",
];

export function getLoginErrorMessage(
  error: unknown,
  appEnvironment?: string,
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalized = message.toLocaleLowerCase("pt-BR");

  if (normalized.includes("bloqueado")) {
    return message || "Acesso temporariamente bloqueado. Tente novamente mais tarde.";
  }

  // Mensagens de credenciais incorretas permanecem genéricas para não revelar
  // se o e-mail existe, se a conta está ativa ou se há uma senha cadastrada.
  if (CREDENTIAL_ERROR_MARKERS.some((marker) => normalized.includes(marker))) {
    return INVALID_LOGIN_MESSAGE;
  }

  if (appEnvironment?.trim().toLowerCase() === "homologacao") {
    return (
      "Falha técnica na autenticação de homologação. " +
      "Verifique a configuração de sessão/JWT e os logs do backend."
    );
  }

  // Erros desconhecidos (ex.: Server Error, rede ou handshake JWT) nunca devem
  // ser apresentados como senha incorreta: isso induz a redefinições inúteis.
  return LOGIN_TECHNICAL_ERROR_MESSAGE;
}
