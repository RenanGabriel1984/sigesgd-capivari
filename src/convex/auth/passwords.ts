/**
 * Password hashing using PBKDF2 with SHA-256.
 * Uses Web Crypto API (available in Convex Node.js runtime).
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH_BYTES = 16;

/** Upper bound exclusive for unbiased 6-digit reset-code generation. */
const RESET_CODE_RANGE = 900_000;
const UINT32_RANGE = 0x1_0000_0000;
const RESET_CODE_SAMPLE_LIMIT =
  Math.floor(UINT32_RANGE / RESET_CODE_RANGE) * RESET_CODE_RANGE;

/** Validação compartilhada do endereço usado nos fluxos públicos de recuperação. */
export function isValidRecoveryEmail(value: string): boolean {
  return value.length > 0 &&
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generates a cryptographically secure per-password salt.
 * Never replace this with Math.random(): salts must come from a CSPRNG.
 */
export function generateSalt(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Gerador criptográfico seguro indisponível.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  return toHex(bytes.buffer as ArrayBuffer);
}

/**
 * Generates a uniformly distributed six-digit recovery code.
 * Rejection sampling avoids modulo bias.
 */
export function generateSecureNumericCode(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    throw new Error("Gerador criptográfico seguro indisponível.");
  }

  const sample = new Uint32Array(1);
  do {
    cryptoApi.getRandomValues(sample);
  } while (sample[0] >= RESET_CODE_SAMPLE_LIMIT);

  return String(100_000 + (sample[0] % RESET_CODE_RANGE));
}

/** Pure transition used to count every invalid confirmation against the active code. */
export function nextResetAttempt(
  currentAttempts: number,
  maxAttempts: number,
  now: number
): { attempts: number; usedAt?: number } {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("Limite de tentativas inválido.");
  }
  const safeCurrent =
    Number.isSafeInteger(currentAttempts) && currentAttempts > 0
      ? currentAttempts
      : 0;
  const attempts = safeCurrent + 1;
  return attempts >= maxAttempts ? { attempts, usedAt: now } : { attempts };
}

function constantTimeEquals(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function deriveKey(
  password: string,
  salt: string
): Promise<ArrayBuffer> {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new Error("Derivação criptográfica de senha indisponível.");
  }
  const encoder = new TextEncoder();
  const passwordKey = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return cryptoApi.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    KEY_LENGTH * 8
  );
}

/**
 * Recovery OTPs have only six digits, so a plain SHA-256 digest would be
 * cheaply brute-forced after a database leak. Reuse PBKDF2-SHA-256 with a
 * fresh random salt, just as for account passwords.
 */
export async function hashResetCode(
  code: string
): Promise<{ hash: string; salt: string }> {
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Código de recuperação inválido.");
  }
  const salt = generateSalt();
  const keyBits = await deriveKey(code, salt);
  return { hash: toHex(keyBits), salt };
}

export async function verifyResetCode(
  code: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const keyBits = await deriveKey(code, storedSalt);
  return constantTimeEquals(toHex(keyBits), storedHash);
}

export async function hashPassword(
  password: string
): Promise<{ hash: string; salt: string }> {
  const salt = generateSalt();
  const keyBits = await deriveKey(password, salt);
  return { hash: toHex(keyBits), salt };
}

export async function verifyPassword(
  password: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  const keyBits = await deriveKey(password, storedSalt);
  return constantTimeEquals(toHex(keyBits), storedHash);
}
