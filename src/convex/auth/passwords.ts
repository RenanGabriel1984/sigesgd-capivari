/**
 * Password hashing using PBKDF2 with SHA-256.
 * Uses Web Crypto API (available in Convex Node.js runtime).
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const SALT_LENGTH_BYTES = 16;

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
