import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimeAuthority } from './timeauth';
import { FakeClock } from './clock';
import { parseReply, buildReply } from './sntp';

test('anchors to host clock before any sync', () => {
  const clock = new FakeClock(1_700_000_000_000, 5000);
  const ta = new TimeAuthority({ clock, ntpPool: [] });
  assert.equal(ta.now(), 1_700_000_000_000);
  assert.equal(ta.status().source, 'host');
});

test('authoritative time advances with the monotonic clock', () => {
  const clock = new FakeClock(1_700_000_000_000, 5000);
  const ta = new TimeAuthority({ clock, ntpPool: [] });
  clock.advance(60_000);
  assert.equal(ta.now(), 1_700_000_060_000);
});

test('a backwards host wall-clock change does NOT move authoritative time', () => {
  const clock = new FakeClock(1_700_000_000_000, 5000);
  const ta = new TimeAuthority({ clock, ntpPool: [] });
  // Advance monotonic by 30s (real time passing) but yank wall clock back an hour.
  clock.advanceMono(30_000);
  clock.setWall(1_700_000_000_000 - 3_600_000);
  // now() is anchored to monotonic, so it only reflects the +30s.
  assert.equal(ta.now(), 1_700_000_030_000);
});

test('NTP sync moves the anchor to server time (within 1s) and marks source ntp', async () => {
  const clock = new FakeClock(1_700_000_000_000, 5000);
  const serverNow = 1_700_000_500_000; // host is 500s behind "truth"
  const ta = new TimeAuthority({
    clock,
    ntpPool: ['fake'],
    sntpQuery: async (server) => {
      const reply = buildReply(serverNow);
      // Simulate ~0 rtt by using the same instant for send/recv.
      return parseReply(reply, clock.wallNow(), clock.wallNow(), server);
    },
  });
  const status = await ta.refresh();
  assert.equal(status.source, 'ntp');
  assert.ok(Math.abs(ta.now() - serverNow) <= 1000, `now ${ta.now()} within 1s of ${serverNow}`);
});

test('refresh falls back to host when NTP fails', async () => {
  const clock = new FakeClock(1_700_000_000_000, 5000);
  const ta = new TimeAuthority({
    clock,
    ntpPool: ['fake'],
    sntpQuery: async () => {
      throw new Error('unreachable');
    },
  });
  const status = await ta.refresh();
  assert.equal(status.source, 'degraded'); // pool configured but unreachable
  assert.equal(ta.now(), 1_700_000_000_000);
});
