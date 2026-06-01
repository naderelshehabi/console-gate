import { type ClockSource, systemClock } from './clock';
import { querySntp, type SntpResult } from './sntp';
import { randomToken } from '../util/ids';
import { log } from '../logger';
import type { TimeStatus, TimeSource } from '../types';

export type SntpQuery = (server: string) => Promise<SntpResult>;

export interface TimeAuthorityOptions {
  clock?: ClockSource;
  ntpPool?: string[];
  sntpQuery?: SntpQuery; // injectable for tests
  syncIntervalMs?: number;
}

/**
 * Authoritative time for the whole system.
 *
 * Time is computed as `anchorUtc + (monoNow - anchorMono)` so a host wall-clock
 * glitch between syncs cannot corrupt served time — only a fresh sync moves the
 * anchor. Agents never trust their own console clocks; they read this.
 */
export class TimeAuthority {
  private readonly clock: ClockSource;
  private readonly ntpPool: string[];
  private readonly sntpQuery: SntpQuery;
  private readonly syncIntervalMs: number;
  private readonly monoToken = randomToken(8);

  private anchorUtc: number;
  private anchorMono: number;
  private source: TimeSource;
  private lastSync: number | null = null;
  private offsetMs = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: TimeAuthorityOptions = {}) {
    this.clock = opts.clock ?? systemClock;
    this.ntpPool = opts.ntpPool ?? [];
    this.sntpQuery = opts.sntpQuery ?? ((s) => querySntp(s));
    this.syncIntervalMs = opts.syncIntervalMs ?? 60 * 60 * 1000;
    // Anchor to the host clock immediately so the Hub has a usable time before first NTP sync.
    this.anchorUtc = this.clock.wallNow();
    this.anchorMono = this.clock.monoNow();
    this.source = 'host';
  }

  /** Current authoritative epoch-ms. */
  now(): number {
    return Math.round(this.anchorUtc + (this.clock.monoNow() - this.anchorMono));
  }

  status(): TimeStatus {
    return {
      utcMs: this.now(),
      source: this.source,
      lastSync: this.lastSync,
      offsetMs: Math.round(this.offsetMs),
      monoToken: this.monoToken,
    };
  }

  /**
   * Attempt an NTP sync across the pool. On success, moves the anchor to NTP time.
   * On failure, re-anchors to the host clock only if we have no better source.
   * Returns the resulting status.
   */
  async refresh(): Promise<TimeStatus> {
    for (const server of this.ntpPool) {
      try {
        const res = await this.sntpQuery(server);
        // Re-read mono as close as possible to adopting the sample.
        this.anchorMono = this.clock.monoNow();
        this.anchorUtc = res.serverTimeMs;
        this.offsetMs = res.offsetMs;
        this.source = 'ntp';
        this.lastSync = res.serverTimeMs;
        log.info('time synced', { server, offsetMs: Math.round(res.offsetMs), rtt: Math.round(res.roundTripMs) });
        return this.status();
      } catch (err) {
        log.warn('ntp sync failed', { server, err: String(err) });
      }
    }
    // No NTP available.
    if (this.source !== 'ntp') {
      // Re-anchor to host to correct accumulated drift, mark as host (or degraded if no pool configured).
      this.anchorUtc = this.clock.wallNow();
      this.anchorMono = this.clock.monoNow();
      this.source = this.ntpPool.length === 0 ? 'host' : 'degraded';
    }
    return this.status();
  }

  /** Start the periodic background sync. Does an immediate refresh first. */
  start(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.syncIntervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
