import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, isUntrustedTime, type EvaluateInput } from './evaluator';
import { WEEKDAYS, type DaySchedule, type Schedule, type Weekday } from '../types';

const WED_1000 = Date.UTC(2024, 0, 3, 10, 0, 0);

function schedule(windows: DaySchedule['windows'], quotaMin = 120, tz = 'UTC'): Schedule {
  const days = {} as Record<Weekday, DaySchedule>;
  for (const d of WEEKDAYS) days[d] = { windows: windows.map((w) => ({ ...w })), quotaMin };
  return { consoleId: 'c1', days, tz, updatedAt: 0, updatedBy: null };
}

function base(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    now: WED_1000,
    tz: 'UTC',
    schedule: schedule([{ start: '08:00', end: '21:00' }]),
    enforcement: 'hard',
    warnThresholdsMin: [60, 30, 15, 5],
    graceSeconds: 60,
    lockNow: false,
    paused: false,
    quotaTotalMin: 120,
    minutesUsed: 0,
    ...overrides,
  };
}

test('ALLOWED mid-window with quota', () => {
  const e = evaluate(base());
  assert.equal(e.state, 'ALLOWED');
  assert.equal(e.quotaRemainingMin, 120);
});

test('WARNING when within threshold of window end (by window)', () => {
  // 20:30 UTC, window ends 21:00 -> 30 min left -> WARNING.
  const e = evaluate(base({ now: Date.UTC(2024, 0, 3, 20, 30, 0) }));
  assert.equal(e.state, 'WARNING');
  assert.equal(e.reason, 'window-end');
  assert.equal(e.secondsToNextBoundary, 30 * 60);
});

test('WARNING when quota nearly exhausted (by quota)', () => {
  const e = evaluate(base({ minutesUsed: 115 })); // 5 min left
  assert.equal(e.state, 'WARNING');
  assert.equal(e.reason, 'quota-end');
  assert.equal(e.quotaRemainingMin, 5);
});

test('GRACE inside the grace window', () => {
  const e = evaluate(base({ minutesUsed: 119 })); // 1 min left = 60s <= grace 60
  assert.equal(e.state, 'GRACE');
});

test('LOCKED outside any window', () => {
  const e = evaluate(base({ now: Date.UTC(2024, 0, 3, 22, 0, 0) }));
  assert.equal(e.state, 'LOCKED');
  assert.equal(e.reason, 'outside-window');
});

test('LOCKED when quota exhausted', () => {
  const e = evaluate(base({ minutesUsed: 120 }));
  assert.equal(e.state, 'LOCKED');
  assert.equal(e.reason, 'quota-exhausted');
});

test('LOCKED by parent flag and pause', () => {
  assert.equal(evaluate(base({ lockNow: true })).reason, 'locked-by-parent');
  assert.equal(evaluate(base({ paused: true })).reason, 'paused');
});

test('LOCKED cant-verify-time on backward clock jump', () => {
  const e = evaluate(
    base({
      timeSignal: {
        reportedLocalUtc: WED_1000 - 3 * 3600_000,
        highWaterUtc: WED_1000,
        skewToleranceMs: 120_000,
        plausibleFloorUtc: 1_672_531_200_000,
      },
    }),
  );
  assert.equal(e.state, 'LOCKED');
  assert.equal(e.reason, 'cant-verify-time');
});

test('LOCKED cant-verify-time on default/reset clock', () => {
  const e = evaluate(
    base({
      timeSignal: {
        reportedLocalUtc: 1_000_000, // year 1970 — below plausibility floor
        highWaterUtc: 1_000_000,
        plausibleFloorUtc: 1_672_531_200_000,
      },
    }),
  );
  assert.equal(e.reason, 'cant-verify-time');
});

test('hub-unreachable maps to its own reason', () => {
  const e = evaluate(base({ timeSignal: { highWaterUtc: WED_1000, hubUnreachable: true } }));
  assert.equal(e.state, 'LOCKED');
  assert.equal(e.reason, 'hub-unreachable');
});

test('small clock skew within tolerance is trusted', () => {
  assert.equal(
    isUntrustedTime({ reportedLocalUtc: WED_1000 - 30_000, highWaterUtc: WED_1000, skewToleranceMs: 120_000 }),
    false,
  );
});

test('bonus reflected via higher quotaTotal', () => {
  // 80 min remaining = 4800s, beyond the 60-min warning threshold -> ALLOWED.
  const e = evaluate(base({ quotaTotalMin: 200, minutesUsed: 120 }));
  assert.equal(e.state, 'ALLOWED');
  assert.equal(e.quotaRemainingMin, 80);
});

test('30 min remaining is WARNING (graduated warnings begin at 60 min)', () => {
  const e = evaluate(base({ quotaTotalMin: 150, minutesUsed: 120 }));
  assert.equal(e.state, 'WARNING');
  assert.equal(e.quotaRemainingMin, 30);
});

test('empty windows day is fully locked', () => {
  const e = evaluate(base({ schedule: schedule([]) }));
  assert.equal(e.reason, 'outside-window');
});
