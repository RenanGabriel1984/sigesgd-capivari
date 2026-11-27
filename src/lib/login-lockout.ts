/**
 * Proteção contra força bruta no login.
 *
 * Mantém somente os cinco horários mais recentes dentro da janela móvel.
 * A duração da janela e do bloqueio são iguais: 15 minutos.
 */
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;

export interface LoginFailureState {
  attemptTimestamps?: number[];
  lockedUntil?: number;
}

export interface NextLoginFailureState {
  attempts: number;
  lastAttemptAt: number;
  attemptTimestamps: number[];
  lockedUntil?: number;
}

/**
 * Registra uma falha considerando somente falhas ocorridas nos últimos
 * 15 minutos. Campos legados sem horários individuais são descartados, pois
 * não é possível determinar com segurança a idade de cada tentativa.
 */
export function recordLoginFailure(
  state: LoginFailureState,
  now: number,
): NextLoginFailureState {
  const cutoff = now - LOGIN_LOCK_WINDOW_MS;
  const previousTimestamps = Array.isArray(state.attemptTimestamps)
    ? state.attemptTimestamps
    : [];
  const recentTimestamps = previousTimestamps.filter(
    (timestamp) =>
      Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= now,
  );

  recentTimestamps.push(now);
  const attemptTimestamps = recentTimestamps.slice(-LOGIN_MAX_ATTEMPTS);
  const lockIsActive =
    typeof state.lockedUntil === "number" && state.lockedUntil > now;

  return {
    attempts: attemptTimestamps.length,
    lastAttemptAt: now,
    attemptTimestamps,
    lockedUntil: lockIsActive
      ? state.lockedUntil
      : attemptTimestamps.length >= LOGIN_MAX_ATTEMPTS
        ? now + LOGIN_LOCK_WINDOW_MS
        : undefined,
  };
}

/** Estado canônico após login válido ou redefinição administrativa da senha. */
export function clearLoginFailureState() {
  return {
    attempts: 0,
    attemptTimestamps: [] as number[],
    lockedUntil: undefined,
  };
}
