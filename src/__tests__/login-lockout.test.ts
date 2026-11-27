import { describe, expect, it } from "vitest";
import {
  clearLoginFailureState,
  LOGIN_LOCK_WINDOW_MS,
  recordLoginFailure,
  type LoginFailureState,
} from "@/lib/login-lockout";

describe("proteção contra tentativas inválidas de login", () => {
  const minute = 60 * 1000;
  const start = 1_800_000_000_000;

  it("uma falha isolada não bloqueia o acesso", () => {
    const next = recordLoginFailure({}, start);

    expect(next.attempts).toBe(1);
    expect(next.attemptTimestamps).toEqual([start]);
    expect(next.lockedUntil).toBeUndefined();
  });

  it("descarta falhas anteriores à janela móvel de 15 minutos", () => {
    const oldFailures = {
      attemptTimestamps: [
        start - 20 * minute,
        start - 19 * minute,
        start - 18 * minute,
        start - 16 * minute,
      ],
    };

    const next = recordLoginFailure(oldFailures, start);

    expect(next.attempts).toBe(1);
    expect(next.attemptTimestamps).toEqual([start]);
    expect(next.lockedUntil).toBeUndefined();
  });

  it("quatro falhas antigas em registro legado não provocam bloqueio na falha seguinte", () => {
    const legacyState = {
      attempts: 4,
      lastAttemptAt: start - minute,
      // Campo inexistente nos registros anteriores à implementação.
    } as { attempts: number; lastAttemptAt: number; attemptTimestamps?: number[] };

    const next = recordLoginFailure(legacyState, start);

    expect(next.attempts).toBe(1);
    expect(next.lockedUntil).toBeUndefined();
  });

  it("bloqueia somente ao atingir cinco falhas dentro dos mesmos 15 minutos", () => {
    let state: LoginFailureState = {};
    for (let index = 0; index < 4; index += 1) {
      state = recordLoginFailure(state, start + index * minute);
    }

    const fifthFailureAt = start + 4 * minute;
    const next = recordLoginFailure(state, fifthFailureAt);

    expect(next.attempts).toBe(5);
    expect(next.lockedUntil).toBe(fifthFailureAt + LOGIN_LOCK_WINDOW_MS);
  });

  it("após o bloqueio expirar, inicia uma nova contagem", () => {
    let state: LoginFailureState = {};
    for (let index = 0; index < 5; index += 1) {
      state = recordLoginFailure(state, start + index * minute);
    }

    const lockExpiresAt = state.lockedUntil!;
    const next = recordLoginFailure(state, lockExpiresAt);

    expect(next.attempts).toBe(1);
    expect(next.attemptTimestamps).toEqual([lockExpiresAt]);
    expect(next.lockedUntil).toBeUndefined();
  });

  it("um login válido limpa contador, histórico e bloqueio", () => {
    expect(clearLoginFailureState()).toEqual({
      attempts: 0,
      attemptTimestamps: [],
      lockedUntil: undefined,
    });
  });
});
