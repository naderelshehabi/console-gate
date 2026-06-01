import { localParts } from '../util/localtime';
import { currentWindow, minutesToWindowEnd } from './schedule';
import type { EffectiveState, EnforcementMode, Schedule } from '../types';

/**
 * Time-trust signal supplied on an agent poll. When present, the evaluator can
 * detect a rolled-back or default (post-unplug) console clock and fail closed.
 * Controller reads (Web/Android) omit this — they use authoritative time only.
 */
export interface TimeSignal {
  reportedLocalUtc?: number; // the console's own clock guess
  highWaterUtc: number;      // max authoritative time acknowledged for this console
  plausibleFloorUtc?: number; // a clock below this is treated as default/reset
  skewToleranceMs?: number;   // tolerance before a backward report is "tampering"
  hubUnreachable?: boolean;   // agent-side: hub unreachable past the grace window
}

export interface EvaluateInput {
  now: number; // authoritative epoch ms
  tz: string;
  schedule: Schedule;
  enforcement: EnforcementMode;
  warnThresholdsMin: number[];
  graceSeconds: number;
  lockNow: boolean;
  paused: boolean;
  quotaTotalMin: number; // base daily quota + active grants
  minutesUsed: number;   // accumulated from monotonic deltas
  timeSignal?: TimeSignal;
}

/** True when the console's reported clock cannot be trusted (fail-closed trigger). */
export function isUntrustedTime(sig: TimeSignal | undefined): boolean {
  if (!sig) return false;
  if (sig.hubUnreachable) return true;
  if (sig.reportedLocalUtc !== undefined) {
    const skew = sig.skewToleranceMs ?? 0;
    if (sig.reportedLocalUtc < sig.highWaterUtc - skew) return true; // backward jump
    if (sig.plausibleFloorUtc !== undefined && sig.reportedLocalUtc < sig.plausibleFloorUtc) {
      return true; // default / reset clock
    }
  }
  return false;
}

function mk(
  state: EffectiveState['state'],
  reason: string,
  secondsToNextBoundary: number,
  quotaRemainingMin: number,
  input: EvaluateInput,
): EffectiveState {
  return {
    state,
    reason,
    secondsToNextBoundary: Math.max(0, Math.round(secondsToNextBoundary)),
    quotaRemainingMin,
    warnThresholdsMin: input.warnThresholdsMin,
    graceSeconds: input.graceSeconds,
    enforcement: input.enforcement,
  };
}

/**
 * Compute the effective state for a console. This single function is used by
 * both the agent poll endpoint and all controller reads so the console and the
 * dashboards can never disagree. See docs/implement/08-protocol-api.md §8.9.
 */
export function evaluate(input: EvaluateInput): EffectiveState {
  const quotaRemaining = Math.max(0, input.quotaTotalMin - input.minutesUsed);

  if (input.paused) return mk('LOCKED', 'paused', 0, quotaRemaining, input);
  if (input.lockNow) return mk('LOCKED', 'locked-by-parent', 0, quotaRemaining, input);
  if (isUntrustedTime(input.timeSignal)) {
    const reason = input.timeSignal?.hubUnreachable ? 'hub-unreachable' : 'cant-verify-time';
    return mk('LOCKED', reason, 0, quotaRemaining, input);
  }

  const { weekday, minutesOfDay } = localParts(input.now, input.tz);
  const day = input.schedule.days[weekday];
  const win = currentWindow(day, minutesOfDay);
  if (!win) return mk('LOCKED', 'outside-window', 0, quotaRemaining, input);

  if (quotaRemaining <= 0) return mk('LOCKED', 'quota-exhausted', 0, quotaRemaining, input);

  const secsToWindowEnd = minutesToWindowEnd(win, minutesOfDay) * 60;
  const secsToQuotaEnd = quotaRemaining * 60;
  const secs = Math.min(secsToWindowEnd, secsToQuotaEnd);
  const reason = secsToWindowEnd <= secsToQuotaEnd ? 'window-end' : 'quota-end';

  if (secs <= input.graceSeconds) return mk('GRACE', reason, secs, quotaRemaining, input);

  const maxWarn = input.warnThresholdsMin.length ? Math.max(...input.warnThresholdsMin) : 0;
  if (secs <= maxWarn * 60) return mk('WARNING', reason, secs, quotaRemaining, input);

  return mk('ALLOWED', 'in-window', secs, quotaRemaining, input);
}
