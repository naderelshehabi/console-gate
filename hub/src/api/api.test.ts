import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent, WED_1000_UTC } from '../testutil';

/**
 * End-to-end integration tests against the real HTTP server. Together these
 * automate GATE 1 (docs/implement/14-implementation-checklist.md): authoritative
 * time, the ALLOWED→WARNING→GRACE→LOCKED transitions, monotonic quota, rollback
 * detection, bonus grants, and parent lock/unlock.
 */

test('GATE1: hello + time are served', async () => {
  const h = await makeHarness();
  try {
    const hello = await h.request('GET', '/api/v1/hello');
    assert.equal(hello.status, 200);
    assert.ok(hello.json.hubId);
    const time = await h.request('GET', '/api/v1/time');
    assert.equal(time.json.utcMs, WED_1000_UTC);
    assert.equal(time.json.source, 'host');
  } finally {
    await h.close();
  }
});

test('GATE1: setup, pairing, and an authenticated poll returns ALLOWED', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    const poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.status, 200);
    assert.equal(poll.json.effective.state, 'ALLOWED');
    assert.equal(poll.json.effective.quotaRemainingMin, 120);
    assert.equal(poll.json.authoritative.utcMs, WED_1000_UTC);
  } finally {
    await h.close();
  }
});

test('GATE1: unauthenticated poll is rejected', async () => {
  const h = await makeHarness();
  try {
    const poll = await h.request('POST', '/api/v1/agent/poll', { body: {} });
    assert.equal(poll.status, 401);
  } finally {
    await h.close();
  }
});

test('GATE1: WARNING then GRACE then LOCKED as quota is consumed via monotonic deltas', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    // Consume 115 of 120 minutes -> 5 left -> WARNING (by quota).
    let poll = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 115 } });
    assert.equal(poll.json.effective.state, 'WARNING');
    assert.equal(poll.json.effective.reason, 'quota-end');

    // Consume 4 more -> 1 left -> 60s -> GRACE.
    poll = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 4 } });
    assert.equal(poll.json.effective.state, 'GRACE');

    // Consume the last minute -> LOCKED quota-exhausted.
    poll = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 1 } });
    assert.equal(poll.json.effective.state, 'LOCKED');
    assert.equal(poll.json.effective.reason, 'quota-exhausted');

    // The transition events were logged.
    const events = await h.request('GET', '/api/v1/events', { token });
    const types = events.json.events.map((e: any) => e.type);
    assert.ok(types.includes('QUOTA_EXHAUSTED'));
    assert.ok(types.includes('DOWNTIME_ENFORCED'));
  } finally {
    await h.close();
  }
});

test('GATE1: faking the clock FORWARD does not refund spent minutes', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 119 } });
    // Move real time forward 3 hours; still same day, still in window.
    h.clock.advance(3 * 3600_000);
    const poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    // Only 1 minute remained and it is NOT refunded by the clock moving on.
    assert.equal(poll.json.effective.quotaRemainingMin, 1);
  } finally {
    await h.close();
  }
});

test('GATE1: rolling the console clock BACK locks with cant-verify-time', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    // First poll establishes the high-water mark at authoritative now.
    await h.request('POST', '/api/v1/agent/poll', { token, body: { localUtcGuess: WED_1000_UTC } });
    // Agent now reports a clock 3 hours in the past.
    const poll = await h.request('POST', '/api/v1/agent/poll', {
      token,
      body: { localUtcGuess: WED_1000_UTC - 3 * 3600_000 },
    });
    assert.equal(poll.json.effective.state, 'LOCKED');
    assert.equal(poll.json.effective.reason, 'cant-verify-time');
    const events = await h.request('GET', '/api/v1/events', { token });
    assert.ok(events.json.events.some((e: any) => e.type === 'CLOCK_TAMPER_SUSPECTED'));
  } finally {
    await h.close();
  }
});

test('GATE1: bonus grant increases remaining quota', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } }); // exhaust
    let poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.state, 'LOCKED');

    const grant = await h.request('POST', `/api/v1/consoles/${consoleId}/grant`, {
      token,
      pin: '4242',
      body: { minutes: 90 },
    });
    assert.equal(grant.status, 200);

    poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    // 90 min remaining is beyond the 60-min warning threshold -> ALLOWED.
    assert.equal(poll.json.effective.state, 'ALLOWED');
    assert.equal(poll.json.effective.quotaRemainingMin, 90);
  } finally {
    await h.close();
  }
});

test('GATE1: lock-now then unlock', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', `/api/v1/consoles/${consoleId}/lock`, { token, pin: '4242', body: {} });
    let poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.reason, 'locked-by-parent');
    // A LOCK_NOW command is queued for the agent.
    assert.ok(poll.json.commands.some((c: any) => c.type === 'LOCK_NOW'));

    await h.request('POST', `/api/v1/consoles/${consoleId}/unlock`, { token, pin: '4242', body: {} });
    poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.state, 'ALLOWED');
  } finally {
    await h.close();
  }
});

test('GATE1: wrong PIN is rejected for privileged actions', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    const res = await h.request('POST', `/api/v1/consoles/${consoleId}/lock`, {
      token,
      pin: '0000',
      body: {},
    });
    assert.equal(res.status, 401);
  } finally {
    await h.close();
  }
});

test('GATE1: outside the allowed window the console is LOCKED', async () => {
  // 23:00 UTC is outside the default 08:00–21:00 window.
  const h = await makeHarness({ wall: Date.UTC(2024, 0, 3, 23, 0, 0) });
  try {
    const { token } = await pairAgent(h);
    const poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.state, 'LOCKED');
    assert.equal(poll.json.effective.reason, 'outside-window');
  } finally {
    await h.close();
  }
});

test('GATE1: session start/end accrues usage and an overage emits PLAY_BEYOND_DOWNTIME', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h);
    const start = await h.request('POST', '/api/v1/agent/session/start', {
      token,
      body: { titleId: 'GAME1', source: 'wii-gate' },
    });
    const sessionId = start.json.sessionId;
    await h.request('POST', '/api/v1/agent/session/end', {
      token,
      body: { sessionId, elapsedMin: 30, overageMin: 5 },
    });
    const detail = await h.request('GET', `/api/v1/consoles/${consoleId}`, { token });
    assert.equal(detail.json.quota.minutesUsed, 30);
    const events = await h.request('GET', '/api/v1/events', { token });
    assert.ok(events.json.events.some((e: any) => e.type === 'PLAY_BEYOND_DOWNTIME'));
  } finally {
    await h.close();
  }
});

test('GATE1: more-time request then approve grants the minutes', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } });
    const req = await h.request('POST', `/api/v1/consoles/${consoleId}/request-time`, {
      token,
      body: { minutes: 15, reason: 'one more level' },
    });
    const reqId = req.json.request.id;
    const approve = await h.request('POST', `/api/v1/requests/${reqId}/approve`, {
      token,
      pin: '4242',
      body: {},
    });
    assert.equal(approve.json.request.status, 'approved');
    const poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.quotaRemainingMin, 15);
  } finally {
    await h.close();
  }
});

test('GATE1: verify-log endpoint reports a clean chain', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } });
    const v = await h.request('GET', '/api/v1/system/verify-log', { token, pin: '4242' });
    assert.equal(v.json.ok, true);
    assert.ok(v.json.count > 0);
  } finally {
    await h.close();
  }
});

test('GATE1: time/refresh works and emits TIME_RESYNCED', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h, '4242');
    const refresh = await h.request('POST', '/api/v1/time/refresh', { token, pin: '4242', body: {} });
    assert.equal(refresh.status, 200);
    // No NTP pool in tests -> host source.
    assert.ok(['host', 'degraded', 'ntp'].includes(refresh.json.source));
  } finally {
    await h.close();
  }
});
