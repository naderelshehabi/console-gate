import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReply, parseReply } from './sntp';

test('parseReply round-trips a synthetic server time', () => {
  const serverNow = 1_700_000_500_000;
  const reply = buildReply(serverNow);
  // Zero round-trip: client send == client recv == serverNow.
  const res = parseReply(reply, serverNow, serverNow, 'fake');
  assert.ok(Math.abs(res.serverTimeMs - serverNow) <= 2);
  assert.ok(Math.abs(res.offsetMs) <= 2);
});

test('parseReply computes positive offset when host is behind', () => {
  const serverNow = 1_700_000_500_000;
  const hostNow = serverNow - 500_000; // host 500s behind
  const reply = buildReply(serverNow);
  const res = parseReply(reply, hostNow, hostNow, 'fake');
  assert.ok(res.offsetMs > 499_000 && res.offsetMs < 501_000, `offset ${res.offsetMs}`);
});

test('parseReply rejects a short packet', () => {
  assert.throws(() => parseReply(Buffer.alloc(10), 0, 0));
});
