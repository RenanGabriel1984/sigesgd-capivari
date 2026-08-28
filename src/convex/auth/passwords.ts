/**
 * Password hashing using PBKDF2 with SHA-256.
 * Uses Web Crypto API (available in Convex Node.js runtime).
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function generateSalt(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes.buffer);
}

async function deriveKey(
  password: string,
  salt: string
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  return crypto.subtle.deriveBits(
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
  return toHex(keyBits) === storedHash;
}
