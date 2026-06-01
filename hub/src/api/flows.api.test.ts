import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';

/**
 * Phase 7 end-to-end flow polish: extend-today, the child request -> parent
 * approve loop, and the finalized analytics surface, exercised over the API.
 */

test('PHASE7: extend-today adds quota and is logged as EXTENDED_TODAY', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } }); // exhaust
    assert.equal((await h.request('POST', '/api/v1/agent/poll', { token, body: {} })).json.effective.state, 'LOCKED');

    const ext = await h.request('POST', `/api/v1/consoles/${consoleId}/extend-today`, {
      token, pin: '4242', body: { minutes: 90 },
    });
    assert.equal(ext.status, 200);

    const poll = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    assert.equal(poll.json.effective.state, 'ALLOWED');
    assert.equal(poll.json.effective.quotaRemainingMin, 90);

    const events = await h.request('GET', '/api/v1/events', { token });
    assert.ok(events.json.events.some((e: any) => e.type === 'EXTENDED_TODAY'));
  } finally {
    await h.close();
  }
});

test('PHASE7: child request -> parent approve grants time and resolves the request', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } });

    const req = await h.request('POST', `/api/v1/consoles/${consoleId}/request-time`, {
      token, body: { minutes: 20, reason: 'boss fight' },
    });
    const id = req.json.request.id;

    // It shows up as pending for the parent.
    const pending = await h.request('GET', '/api/v1/requests?status=pending', { token });
    assert.ok(pending.json.requests.some((r: any) => r.id === id));

    const approve = await h.request('POST', `/api/v1/requests/${id}/approve`, { token, pin: '4242', body: {} });
    assert.equal(approve.json.request.status, 'approved');

    // Quota granted, and the request is no longer pending.
    assert.equal((await h.request('POST', '/api/v1/agent/poll', { token, body: {} })).json.effective.quotaRemainingMin, 20);
    const stillPending = await h.request('GET', '/api/v1/requests?status=pending', { token });
    assert.ok(!stillPending.json.requests.some((r: any) => r.id === id));
  } finally {
    await h.close();
  }
});

test('PHASE7: deny leaves quota untouched and marks the request denied', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } });
    const req = await h.request('POST', `/api/v1/consoles/${consoleId}/request-time`, {
      token, body: { minutes: 30, reason: null },
    });
    const deny = await h.request('POST', `/api/v1/requests/${req.json.request.id}/deny`, { token, pin: '4242', body: {} });
    assert.equal(deny.json.request.status, 'denied');
    assert.equal((await h.request('POST', '/api/v1/agent/poll', { token, body: {} })).json.effective.state, 'LOCKED');
  } finally {
    await h.close();
  }
});

test('PHASE7: analytics summary includes busiest-hours and agent-offline gaps', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    // A finished play session feeds busiest-hours.
    const start = await h.request('POST', '/api/v1/agent/session/start', { token, body: { source: 'wii-gate' } });
    h.clock.advance(20 * 60 * 1000);
    await h.request('POST', '/api/v1/agent/session/end', {
      token, body: { sessionId: start.json.sessionId, elapsedMin: 20 },
    });
    // A heartbeat gap feeds agent-offline incidents.
    await h.request('POST', '/api/v1/agent/heartbeat', { token, body: {} });
    h.clock.advance(5 * 60 * 1000);
    h.hub.watchdog.scan(h.hub.time.now());

    const a = await h.request('GET', '/api/v1/analytics/summary', { token });
    const c = a.json.consoles.find((x: any) => x.consoleId === consoleId);
    assert.ok(c);
    assert.equal(c.busiestHours.length, 24);
    assert.equal(c.busiestHours.reduce((s: number, n: number) => s + n, 0), 20); // 20 min total
    assert.equal(c.agentOfflineIncidents, 1);
  } finally {
    await h.close();
  }
});
