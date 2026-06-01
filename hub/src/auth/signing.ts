import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

/**
 * HMAC request signing for the LAN transport (R-04 / docs 10 §10.6). The console
 * agents (which can't easily do TLS) sign each request; the Hub verifies integrity
 * + replay protection without a certificate. Canonical string:
 *
 *   METHOD \n PATH \n SHA256_HEX(body) \n NONCE \n TS
 *
 * signed as HMAC-SHA256(signingKey, canonical) -> hex. The same formula is
 * implemented in C (agent-core/cg_sign.c) and pinned by a cross-language test.
 */

export function bodyHashHex(rawBody: string): string {
  return createHash('sha256').update(rawBody ?? '', 'utf8').digest('hex');
}

export function canonicalString(
  method: string,
  path: string,
  rawBody: string,
  nonce: string,
  ts: number | string,
): string {
  return [method.toUpperCase(), path, bodyHashHex(rawBody), nonce, String(ts)].join('\n');
}

export function sign(
  signingKeyHex: string,
  method: string,
  path: string,
  rawBody: string,
  nonce: string,
  ts: number | string,
): string {
  const key = Buffer.from(signingKeyHex, 'hex');
  return createHmac('sha256', key).update(canonicalString(method, path, rawBody, nonce, ts), 'utf8').digest('hex');
}

export function verifySignature(
  signingKeyHex: string,
  method: string,
  path: string,
  rawBody: string,
  nonce: string,
  ts: number | string,
  presentedSigHex: string,
): boolean {
  const expected = Buffer.from(sign(signingKeyHex, method, path, rawBody, nonce, ts), 'hex');
  let presented: Buffer;
  try {
    presented = Buffer.from(presentedSigHex ?? '', 'hex');
  } catch {
    return false;
  }
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

/** Single-use nonce cache with a TTL, defeating replay of captured signed requests. */
export class ReplayCache {
  private seen = new Map<string, number>(); // nonce -> expiry ms
  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  /** Returns true if the nonce is fresh (and records it); false if it's a replay. */
  checkAndRecord(nonce: string, now: number): boolean {
    this.prune(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface SignatureCheck {
  ok: boolean;
  reason?: string;
}

/** Full verification: signing-key present, ts within skew, nonce fresh, signature valid. */
export function checkSignedRequest(args: {
  signingKey: string | null;
  method: string;
  path: string;
  rawBody: string;
  nonce: string | undefined;
  ts: string | undefined;
  sig: string | undefined;
  now: number;
  skewMs: number;
  replay: ReplayCache;
}): SignatureCheck {
  const { signingKey, method, path, rawBody, nonce, ts, sig, now, skewMs, replay } = args;
  if (!signingKey) return { ok: false, reason: 'device has no signing key' };
  if (!nonce || !ts || !sig) return { ok: false, reason: 'missing signing headers' };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'bad ts' };
  if (Math.abs(now - tsNum) > skewMs) return { ok: false, reason: 'stale timestamp' };
  if (!verifySignature(signingKey, method, path, rawBody, nonce, ts, sig)) {
    return { ok: false, reason: 'bad signature' };
  }
  if (!replay.checkAndRecord(nonce, now)) return { ok: false, reason: 'replayed nonce' };
  return { ok: true };
}
