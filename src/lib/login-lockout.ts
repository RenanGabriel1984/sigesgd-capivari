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

export function recordLoginFailure(
  state: LoginFailureState,
  now: number,
): NextLoginFailureState {
  // Ao terminar um bloqueio, a próxima falha sempre inicia uma contagem nova.
  const lockExpired =
    typeof state.lockedUntil === "number" && state.lockedUntil <= now;
  const timestamps = lockExpired ? [] : recentFailures(state, now);
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

export function getLoginLockStatus(
  state: LoginFailureState,
  now: number,
): { locked: false } | { locked: true; remainingSeconds: number } {
  // Uma vez atingido o limite, mantém o bloqueio até lockedUntil. Não
  // recalcula a janela durante o bloqueio; senão as primeiras falhas
  // expirariam e liberariam a conta antes dos 15 minutos.
  const storedTimestamps = Array.isArray(state.attemptTimestamps)
    ? state.attemptTimestamps
    : [];
  if (
    storedTimestamps.filter(Number.isFinite).length < LOGIN_MAX_ATTEMPTS ||
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

export function clearLoginFailureState() {
  return {
    attempts: 0,
    attemptTimestamps: [] as number[],
    lockedUntil: undefined,
  };
}
