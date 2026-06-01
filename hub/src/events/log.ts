import { createHmac } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { uuid } from '../util/ids';
import { type EventType, type Severity, severityOf, shouldPush } from './taxonomy';

export interface EventRecord {
  id: string;
  ts: number;
  consoleId: string | null;
  type: EventType;
  severity: Severity;
  push: boolean;
  data: Record<string, unknown>;
  prevHash: string; // hmac of the previous record ('' for the first)
  hmac: string;     // hmac over this record's content + prevHash
}

export interface EmitInput {
  type: EventType;
  consoleId?: string | null;
  data?: Record<string, unknown>;
  ts: number;
}

export type EventSubscriber = (e: EventRecord) => void;

export interface VerifyResult {
  ok: boolean;
  count: number;
  brokenAt?: number; // index of the first broken record
  reason?: string;
}

/**
 * Append-only, HMAC-signed, hash-chained event log. Each record carries the
 * HMAC of the previous record (`prevHash`) so any deletion or edit breaks the
 * chain and is detected by {@link verify}. This is the tamper-evidence backbone
 * (docs/implement/09-time-and-tamper.md §9.7).
 */
export class EventLog {
  private readonly path: string;
  private readonly secret: Buffer;
  private lastHash = '';
  private subscribers = new Set<EventSubscriber>();

  constructor(path: string, secret: Buffer) {
    this.path = path;
    this.secret = secret;
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const recs = this.readAll();
      this.lastHash = recs.length ? recs[recs.length - 1]!.hmac : '';
    }
  }

  private computeHmac(rec: Omit<EventRecord, 'hmac'>): string {
    const canonical = JSON.stringify([
      rec.id,
      rec.ts,
      rec.consoleId,
      rec.type,
      rec.severity,
      rec.push,
      rec.data,
      rec.prevHash,
    ]);
    return createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  emit(input: EmitInput): EventRecord {
    const base: Omit<EventRecord, 'hmac'> = {
      id: uuid(),
      ts: input.ts,
      consoleId: input.consoleId ?? null,
      type: input.type,
      severity: severityOf(input.type),
      push: shouldPush(input.type),
      data: input.data ?? {},
      prevHash: this.lastHash,
    };
    const hmac = this.computeHmac(base);
    const rec: EventRecord = { ...base, hmac };
    appendFileSync(this.path, JSON.stringify(rec) + '\n');
    this.lastHash = hmac;
    for (const sub of this.subscribers) {
      try {
        sub(rec);
      } catch {
        /* subscriber errors never affect logging */
      }
    }
    return rec;
  }

  readAll(): EventRecord[] {
    if (!existsSync(this.path)) return [];
    const text = readFileSync(this.path, 'utf8');
    const out: EventRecord[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      out.push(JSON.parse(line) as EventRecord);
    }
    return out;
  }

  /** Most recent events first, optionally filtered. */
  query(opts: { since?: number; type?: EventType; consoleId?: string; limit?: number } = {}): EventRecord[] {
    let recs = this.readAll();
    if (opts.since !== undefined) recs = recs.filter((r) => r.ts >= opts.since!);
    if (opts.type) recs = recs.filter((r) => r.type === opts.type);
    if (opts.consoleId) recs = recs.filter((r) => r.consoleId === opts.consoleId);
    recs.reverse();
    if (opts.limit !== undefined) recs = recs.slice(0, opts.limit);
    return recs;
  }

  /** Re-verify the entire hash chain. */
  verify(): VerifyResult {
    const recs = this.readAll();
    let prev = '';
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]!;
      if (r.prevHash !== prev) {
        return { ok: false, count: recs.length, brokenAt: i, reason: 'prevHash mismatch' };
      }
      const { hmac, ...rest } = r;
      const expected = this.computeHmac(rest);
      if (expected !== hmac) {
        return { ok: false, count: recs.length, brokenAt: i, reason: 'hmac mismatch' };
      }
      prev = hmac;
    }
    return { ok: true, count: recs.length };
  }

  subscribe(fn: EventSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}
