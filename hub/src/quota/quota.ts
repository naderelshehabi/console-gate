import type { Store } from '../store/store';
import { localParts } from '../util/localtime';
import type { QuotaState, Schedule } from '../types';

export interface QuotaView {
  date: string;
  quotaTotalMin: number;
  minutesUsed: number;
  remainingMin: number;
  highWaterUtc: number;
}

/**
 * Quota accounting. The daily budget is enforced from accumulated **monotonic**
 * play minutes (clock-independent), never wall-clock subtraction — so advancing
 * the console clock cannot refund time. The day key is derived from authoritative
 * time in the schedule timezone, so quota resets only on a real day boundary.
 */
export class QuotaService {
  constructor(private readonly store: Store) {}

  baseQuotaForDay(schedule: Schedule, now: number): number {
    const { weekday } = localParts(now, schedule.tz);
    return schedule.days[weekday].quotaMin;
  }

  activeGrantMinutes(consoleId: string, date: string, now: number): number {
    return this.store
      .listGrants(consoleId, date)
      .filter((g) => g.expires > now)
      .reduce((sum, g) => sum + g.minutes, 0);
  }

  private dateKey(schedule: Schedule, now: number): string {
    return localParts(now, schedule.tz).dateKey;
  }

  /** Highest authoritative time ever acknowledged for this console (across days). */
  private carriedHighWater(consoleId: string, now: number): number {
    const states = this.store.listQuota(consoleId);
    let hw = now;
    for (const s of states) hw = Math.max(hw, s.highWaterUtc);
    return hw;
  }

  /** Ensure today's quota row exists with an up-to-date total (base + grants). */
  async ensure(consoleId: string, schedule: Schedule, now: number): Promise<QuotaState> {
    const date = this.dateKey(schedule, now);
    const total = this.baseQuotaForDay(schedule, now) + this.activeGrantMinutes(consoleId, date, now);
    let q = this.store.getQuota(consoleId, date);
    if (!q) {
      q = {
        consoleId,
        date,
        quotaTotalMin: total,
        minutesUsed: 0,
        highWaterUtc: this.carriedHighWater(consoleId, now),
        updatedAt: now,
      };
      await this.store.upsertQuota(q);
    } else if (q.quotaTotalMin !== total) {
      q = { ...q, quotaTotalMin: total, updatedAt: now };
      await this.store.upsertQuota(q);
    }
    return q;
  }

  view(q: QuotaState): QuotaView {
    return {
      date: q.date,
      quotaTotalMin: q.quotaTotalMin,
      minutesUsed: q.minutesUsed,
      remainingMin: Math.max(0, q.quotaTotalMin - q.minutesUsed),
      highWaterUtc: q.highWaterUtc,
    };
  }

  /** Apply a play delta (minutes). Clamped to a sane range; only ever increases usage. */
  async applyUsage(consoleId: string, schedule: Schedule, deltaMin: number, now: number): Promise<QuotaState> {
    const q = await this.ensure(consoleId, schedule, now);
    const clamped = Math.max(0, Math.min(deltaMin, 24 * 60));
    const updated: QuotaState = {
      ...q,
      minutesUsed: q.minutesUsed + clamped,
      highWaterUtc: Math.max(q.highWaterUtc, now),
      updatedAt: now,
    };
    await this.store.upsertQuota(updated);
    return updated;
  }

  /** Move the high-water mark forward to `now` without changing usage. */
  async bumpHighWater(consoleId: string, schedule: Schedule, now: number): Promise<QuotaState> {
    const q = await this.ensure(consoleId, schedule, now);
    if (now <= q.highWaterUtc) return q;
    const updated: QuotaState = { ...q, highWaterUtc: now, updatedAt: now };
    await this.store.upsertQuota(updated);
    return updated;
  }
}
