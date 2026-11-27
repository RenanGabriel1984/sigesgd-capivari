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

function recentFailures(state: LoginFailureState, now: number): number[] {
  const cutoff = now - LOGIN_LOCK_WINDOW_MS;
  const timestamps = Array.isArray(state.attemptTimestamps)
    ? state.attemptTimestamps
    : [];
  return timestamps.filter(
    (timestamp) =>
      Number.isFinite(timestamp) && timestamp > cutoff && timestamp <= now,
  );
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
  const timestamps = recentFailures(state, now);
  timestamps.push(now);
  const attemptTimestamps = timestamps.slice(-LOGIN_MAX_ATTEMPTS);
  const alreadyLockedWithValidHistory =
    typeof state.lockedUntil === "number" &&
    state.lockedUntil > now &&
    attemptTimestamps.length >= LOGIN_MAX_ATTEMPTS;

  return {
    attempts: attemptTimestamps.length,
    lastAttemptAt: now,
    attemptTimestamps,
    lockedUntil:
      attemptTimestamps.length >= LOGIN_MAX_ATTEMPTS
        ? alreadyLockedWithValidHistory
          ? state.lockedUntil
          : now + LOGIN_LOCK_WINDOW_MS
        : undefined,
  };
}

/**
 * Só reconhece bloqueios sustentados por cinco timestamps ainda dentro
 * da janela atual. Isso descarta bloqueios legados sem histórico verificável.
 */
export function getLoginLockStatus(
  state: LoginFailureState,
  now: number,
): { locked: false } | { locked: true; remainingSeconds: number } {
  const timestamps = recentFailures(state, now);
  if (
    timestamps.length < LOGIN_MAX_ATTEMPTS ||
    typeof state.lockedUntil !== "number" ||
    state.lockedUntil <= now
  ) {
    return { locked: false };
  }

  return {
    locked: true,
    remainingSeconds: Math.ceil((state.lockedUntil - now) / 1000),
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
