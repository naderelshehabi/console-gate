import { randomBytes, randomUUID } from 'node:crypto';

/** RFC4122 v4 UUID. */
export function uuid(): string {
  return randomUUID();
}

/** URL-safe random token of `bytes` entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** A numeric pairing code of `digits` length (zero-padded). */
export function numericCode(digits = 6): string {
  const max = 10 ** digits;
  const n = randomBytes(4).readUInt32BE(0) % max;
  return n.toString().padStart(digits, '0');
}

/** A short random nonce for command replay protection. */
export function nonce(): string {
  return randomBytes(12).toString('base64url');
}
