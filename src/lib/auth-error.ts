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

type ErrorRecord = {
  message?: unknown;
  data?: unknown;
  errorData?: unknown;
  cause?: unknown;
};

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  const visited = new Set<object>();

  function visit(value: unknown, depth: number): void {
    if (depth > 3 || value == null) return;

    if (typeof value === "string") {
      if (value.trim()) messages.push(value);
      return;
    }

    if (typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    const record = value as ErrorRecord;
    if (typeof record.message === "string" && record.message.trim()) {
      messages.push(record.message);
    }

    // Convex forwards ConvexError.data to the client even when the
    // production errorMessage is redacted to the generic "Server Error".
    visit(record.data, depth + 1);

    // Also accept the HTTP response envelope shape for callers/tests that
    // pass the raw action response instead of the thrown ConvexError.
    visit(record.errorData, depth + 1);
    visit(record.cause, depth + 1);
  }

  visit(error, 0);
  return messages;
}

export function getLoginErrorMessage(
  error: unknown,
  appEnvironment?: string,
): string {
  const messages = collectErrorMessages(error);
  const normalizedMessages = messages.map((message) =>
    message.toLocaleLowerCase("pt-BR"),
  );

  // Prefer the explicit lockout reason carried in ConvexError.data when the
  // top-level message has been redacted by the production deployment.
  const lockoutMessage = messages.find((message, index) =>
    normalizedMessages[index].includes("bloqueado"),
  );
  if (lockoutMessage) {
    return lockoutMessage;
  }

  // Keep all credential failures indistinguishable to avoid revealing
  // whether an e-mail exists, the account is active, or a password is set.
  if (
    normalizedMessages.some((message) =>
      CREDENTIAL_ERROR_MARKERS.some((marker) => message.includes(marker)),
    )
  ) {
    return INVALID_LOGIN_MESSAGE;
  }

  if (appEnvironment?.trim().toLowerCase() === "homologacao") {
    return (
      "Falha técnica na autenticação de homologação. " +
      "Verifique a configuração de sessão/JWT e os logs do backend."
    );
  }

  // Unknown errors (for example network or JWT handshake failures) remain
  // technical and are never mislabeled as an invalid password.
  return LOGIN_TECHNICAL_ERROR_MESSAGE;
}
