import type { Weekday } from '../types';

/**
 * Timezone-aware local time helpers built on the platform Intl database.
 * The Hub stores schedules as local "HH:MM" windows and a local day key,
 * so all window/quota math goes through these functions.
 */

const WEEKDAY_MAP: Record<string, Weekday> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

export interface LocalParts {
  weekday: Weekday;
  minutesOfDay: number; // 0..1439 in local time
  dateKey: string;      // YYYY-MM-DD in local time
}

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    cache.set(tz, f);
  }
  return f;
}

/** Throws if the timezone identifier is invalid. */
export function assertValidTimezone(tz: string): void {
  // Constructing the formatter throws RangeError for an invalid tz.
  formatter(tz);
}

/** Break an epoch-ms instant into local weekday / minutes-of-day / date key. */
export function localParts(utcMs: number, tz: string): LocalParts {
  const parts = formatter(tz).formatToParts(new Date(utcMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekday = WEEKDAY_MAP[get('weekday')];
  if (!weekday) {
    throw new Error(`Unable to resolve weekday for tz=${tz}`);
  }
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0; // some platforms emit 24 for midnight under h23
  const minute = parseInt(get('minute'), 10);
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  return { weekday, minutesOfDay: hour * 60 + minute, dateKey };
}

/** Parse "HH:MM" to minutes-of-day. Returns NaN on malformed input. */
export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return NaN;
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h < 0 || h > 24 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}
