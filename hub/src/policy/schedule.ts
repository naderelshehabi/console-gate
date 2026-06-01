import { parseHHMM } from '../util/localtime';
import type { DaySchedule, Window } from '../types';

/** The window containing `minutesOfDay` (start inclusive, end exclusive), or null. */
export function currentWindow(day: DaySchedule, minutesOfDay: number): Window | null {
  for (const w of day.windows) {
    const s = parseHHMM(w.start);
    const e = parseHHMM(w.end);
    if (Number.isNaN(s) || Number.isNaN(e)) continue;
    if (minutesOfDay >= s && minutesOfDay < e) return w;
  }
  return null;
}

/** Minutes from `minutesOfDay` until the given window's end. */
export function minutesToWindowEnd(w: Window, minutesOfDay: number): number {
  const e = parseHHMM(w.end);
  return e - minutesOfDay;
}

/** Validate a single window: well-formed HH:MM and start < end. */
export function isValidWindow(w: Window): boolean {
  const s = parseHHMM(w.start);
  const e = parseHHMM(w.end);
  return !Number.isNaN(s) && !Number.isNaN(e) && s < e;
}
