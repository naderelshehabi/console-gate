import type { Store } from '../store/store';
import type { EventLog } from '../events/log';

export interface DayRollup {
  date: string;
  minutesUsed: number;
  quotaTotalMin: number;
}

export interface ConsoleSummary {
  consoleId: string;
  name: string;
  kind: string;
  totalMinutesPlayed: number;
  byDay: DayRollup[];
  overageIncidents: number;     // PLAY_BEYOND_DOWNTIME
  agentOfflineIncidents: number; // AGENT_OFFLINE
  bonusesGranted: number;        // BONUS_GRANTED + EXTENDED_TODAY
  lastSeen: number | null;
}

export interface AnalyticsSummary {
  sinceTs: number;
  generatedAt: number;
  consoles: ConsoleSummary[];
  totals: { minutesPlayed: number; overageIncidents: number };
}

/**
 * Roll up per-console play time and incident counts from the quota states and the
 * signed event log. Computed on read (right scale for a household); a persisted
 * rollup table can be layered behind this same shape later if needed.
 */
export function computeSummary(
  store: Store,
  events: EventLog,
  opts: { sinceTs: number; now: number; maxDays?: number },
): AnalyticsSummary {
  const maxDays = opts.maxDays ?? 30;
  const consoles = store.listConsoles().map((c) => {
    const states = store
      .listQuota(c.id)
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, maxDays);
    const totalMinutesPlayed = states.reduce((s, q) => s + q.minutesUsed, 0);
    const ev = events.query({ since: opts.sinceTs, consoleId: c.id, limit: 100000 });
    const count = (t: string) => ev.filter((e) => e.type === t).length;
    const summary: ConsoleSummary = {
      consoleId: c.id,
      name: c.name,
      kind: c.kind,
      totalMinutesPlayed,
      byDay: states.map((q) => ({ date: q.date, minutesUsed: q.minutesUsed, quotaTotalMin: q.quotaTotalMin })),
      overageIncidents: count('PLAY_BEYOND_DOWNTIME'),
      agentOfflineIncidents: count('AGENT_OFFLINE'),
      bonusesGranted: count('BONUS_GRANTED') + count('EXTENDED_TODAY'),
      lastSeen: c.lastSeen,
    };
    return summary;
  });

  return {
    sinceTs: opts.sinceTs,
    generatedAt: opts.now,
    consoles,
    totals: {
      minutesPlayed: consoles.reduce((s, c) => s + c.totalMinutesPlayed, 0),
      overageIncidents: consoles.reduce((s, c) => s + c.overageIncidents, 0),
    },
  };
}
