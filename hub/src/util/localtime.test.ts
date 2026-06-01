import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localParts, parseHHMM, assertValidTimezone } from './localtime';

test('localParts resolves weekday/minutes/date in UTC', () => {
  const p = localParts(Date.UTC(2024, 0, 3, 10, 30, 0), 'UTC');
  assert.equal(p.weekday, 'wed');
  assert.equal(p.minutesOfDay, 10 * 60 + 30);
  assert.equal(p.dateKey, '2024-01-03');
});

test('localParts respects timezone offset', () => {
  // 2024-01-03 02:00 UTC is 2024-01-02 21:00 in America/New_York (UTC-5).
  const p = localParts(Date.UTC(2024, 0, 3, 2, 0, 0), 'America/New_York');
  assert.equal(p.dateKey, '2024-01-02');
  assert.equal(p.weekday, 'tue');
  assert.equal(p.minutesOfDay, 21 * 60);
});

test('parseHHMM parses and rejects', () => {
  assert.equal(parseHHMM('08:30'), 510);
  assert.equal(parseHHMM('00:00'), 0);
  assert.ok(Number.isNaN(parseHHMM('bad')));
  assert.ok(Number.isNaN(parseHHMM('25:00')));
});

test('assertValidTimezone throws on garbage', () => {
  assert.throws(() => assertValidTimezone('Not/AZone'));
  assert.doesNotThrow(() => assertValidTimezone('UTC'));
});
