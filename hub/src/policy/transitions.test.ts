import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transitionEvents } from './transitions';
import type { EffectiveState } from '../types';

function st(state: EffectiveState['state'], reason: string): EffectiveState {
  return {
    state,
    reason,
    secondsToNextBoundary: 0,
    quotaRemainingMin: 0,
    warnThresholdsMin: [60],
    graceSeconds: 60,
    enforcement: 'hard',
  };
}

test('no events when state unchanged', () => {
  const prev = { state: 'ALLOWED' as const, reason: 'in-window' };
  assert.deepEqual(transitionEvents(prev, st('ALLOWED', 'in-window')), []);
});

test('entering WARNING emits WARNING_SHOWN', () => {
  const evs = transitionEvents({ state: 'ALLOWED', reason: 'in-window' }, st('WARNING', 'window-end'));
  assert.equal(evs[0]?.type, 'WARNING_SHOWN');
});

test('entering GRACE emits GRACE_STARTED', () => {
  const evs = transitionEvents({ state: 'WARNING', reason: 'window-end' }, st('GRACE', 'window-end'));
  assert.equal(evs[0]?.type, 'GRACE_STARTED');
});

test('quota lock emits QUOTA_EXHAUSTED + DOWNTIME_ENFORCED', () => {
  const evs = transitionEvents({ state: 'GRACE', reason: 'quota-end' }, st('LOCKED', 'quota-exhausted'));
  assert.deepEqual(evs.map((e) => e.type), ['QUOTA_EXHAUSTED', 'DOWNTIME_ENFORCED']);
});

test('window lock emits DOWNTIME_ENFORCED', () => {
  const evs = transitionEvents({ state: 'ALLOWED', reason: 'in-window' }, st('LOCKED', 'outside-window'));
  assert.deepEqual(evs.map((e) => e.type), ['DOWNTIME_ENFORCED']);
});

test('clock tamper lock emits CLOCK_TAMPER_SUSPECTED', () => {
  const evs = transitionEvents(undefined, st('LOCKED', 'cant-verify-time'));
  assert.equal(evs[0]?.type, 'CLOCK_TAMPER_SUSPECTED');
});

test('parent lock does not emit here', () => {
  assert.deepEqual(transitionEvents(undefined, st('LOCKED', 'locked-by-parent')), []);
});
