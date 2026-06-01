import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import type { PinRecord } from '../types';

/**
 * Parent-PIN verifier using scrypt (built into Node — no external KDF dep).
 * Production note: scrypt is a strong memory-hard KDF; the plan referenced
 * Argon2id, and a future swap is isolated to this module.
 */
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPin(pin: string): PinRecord {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p });
  return {
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    keylen: PARAMS.keylen,
    updatedAt: Date.now(),
  };
}

export function verifyPin(pin: string, rec: PinRecord): boolean {
  const salt = Buffer.from(rec.salt, 'base64');
  const expected = Buffer.from(rec.hash, 'base64');
  const actual = scryptSync(pin, salt, rec.keylen, { N: rec.N, r: rec.r, p: rec.p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
