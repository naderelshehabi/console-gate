import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';

test('PHASE6: heartbeat gap (not cleanly shut down) raises AGENT_OFFLINE once', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    // Agent checks in.
    await h.request('POST', '/api/v1/agent/heartbeat', { token, body: {} });

    // No gap yet -> no alarm.
    assert.deepEqual(h.hub.watchdog.scan(h.hub.time.now()), []);

    // Advance past the offline threshold (default 3 min).
    h.clock.advance(4 * 60 * 1000);
    const fired = h.hub.watchdog.scan(h.hub.time.now());
    assert.equal(fired.length, 1);

    // Debounced: a second scan during the same gap does not re-fire.
    assert.deepEqual(h.hub.watchdog.scan(h.hub.time.now()), []);

    const events = await h.request('GET', '/api/v1/events', { token });
    assert.equal(events.json.events.filter((e: any) => e.type === 'AGENT_OFFLINE').length, 1);
  } finally {
    await h.close();
  }
});

test('PHASE6: a clean shutdown suppresses the AGENT_OFFLINE alarm', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    await h.request('POST', '/api/v1/agent/heartbeat', { token, body: {} });
    await h.request('POST', '/api/v1/agent/shutdown', { token, body: {} });

    h.clock.advance(10 * 60 * 1000);
    assert.deepEqual(h.hub.watchdog.scan(h.hub.time.now()), []); // benign power-off

    const events = await h.request('GET', '/api/v1/events', { token });
    assert.equal(events.json.events.some((e: any) => e.type === 'AGENT_OFFLINE'), false);
  } finally {
    await h.close();
  }
});

test('PHASE6: heartbeat after a gap re-arms the watchdog', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    await h.request('POST', '/api/v1/agent/heartbeat', { token, body: {} });
    h.clock.advance(4 * 60 * 1000);
    assert.equal(h.hub.watchdog.scan(h.hub.time.now()).length, 1); // first gap

    // Agent comes back, then goes silent again -> fires again.
    await h.request('POST', '/api/v1/agent/heartbeat', { token, body: {} });
    h.clock.advance(4 * 60 * 1000);
    assert.equal(h.hub.watchdog.scan(h.hub.time.now()).length, 1);
  } finally {
    await h.close();
  }
});

test('PHASE6: a title running while LOCKED emits CONSOLE_POWERED_DURING_LOCK', async () => {
  // 23:00 UTC is outside the default 08:00-21:00 window -> LOCKED.
  const h = await makeHarness({ wall: Date.UTC(2024, 0, 3, 23, 0, 0) });
  try {
    const { token } = await pairAgent(h);
    await h.request('POST', '/api/v1/agent/poll', { token, body: { currentTitleId: 'GAME1' } });
    const events = await h.request('GET', '/api/v1/events', { token });
    assert.ok(events.json.events.some((e: any) => e.type === 'CONSOLE_POWERED_DURING_LOCK'));
  } finally {
    await h.close();
  }
});
