import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';
import { WEEKDAYS } from '../types';

function blockedSchedule(tz = 'UTC') {
  const days: Record<string, unknown> = {};
  for (const d of WEEKDAYS) days[d] = { windows: [], quotaMin: 120 };
  return { days, tz };
}

test('GATE2: web/login issues a token usable for reads', async () => {
  const h = await makeHarness();
  try {
    await h.request('POST', '/api/v1/setup/pin', { body: { pin: '4242' } });
    const login = await h.request('POST', '/api/v1/web/login', { body: { pin: '4242' } });
    assert.equal(login.status, 200);
    assert.ok(login.json.deviceToken);
    assert.ok(login.json.pinSession);

    const consoles = await h.request('GET', '/api/v1/consoles', { token: login.json.deviceToken });
    assert.equal(consoles.status, 200);
  } finally {
    await h.close();
  }
});

test('GATE2: web/login rejects a wrong PIN', async () => {
  const h = await makeHarness();
  try {
    await h.request('POST', '/api/v1/setup/pin', { body: { pin: '4242' } });
    const login = await h.request('POST', '/api/v1/web/login', { body: { pin: '0000' } });
    assert.equal(login.status, 401);
  } finally {
    await h.close();
  }
});

test('GATE2: editing the schedule changes the effective state', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    // Initially ALLOWED in the default 08–21 window.
    let detail = await h.request('GET', `/api/v1/consoles/${consoleId}`, { token });
    assert.equal(detail.json.effective.state, 'ALLOWED');

    // Edit schedule to block all day via the web session token.
    const login = await h.request('POST', '/api/v1/web/login', { body: { pin: '4242' } });
    const put = await h.request('PUT', `/api/v1/schedule/${consoleId}`, {
      token: login.json.deviceToken,
      pinSession: login.json.pinSession,
      body: blockedSchedule(),
    });
    assert.equal(put.status, 200);

    detail = await h.request('GET', `/api/v1/consoles/${consoleId}`, { token });
    assert.equal(detail.json.effective.state, 'LOCKED');
    assert.equal(detail.json.effective.reason, 'outside-window');
  } finally {
    await h.close();
  }
});

test('GATE2: Web UI static assets are served', async () => {
  const h = await makeHarness();
  try {
    const index = await fetch(h.baseUrl + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') ?? '', /text\/html/);
    const html = await index.text();
    assert.match(html, /ConsoleGate/);

    const js = await fetch(h.baseUrl + '/app.js');
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type') ?? '', /javascript/);

    const missing = await fetch(h.baseUrl + '/does-not-exist.js');
    assert.equal(missing.status, 404);

    // API paths never fall through to static.
    const apiMiss = await fetch(h.baseUrl + '/api/v1/nope');
    assert.equal(apiMiss.status, 404);
  } finally {
    await h.close();
  }
});

test('GATE2: analytics summary reflects play and bonuses', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 50 } });
    await h.request('POST', `/api/v1/consoles/${consoleId}/grant`, { token, pin: '4242', body: { minutes: 20 } });
    const a = await h.request('GET', '/api/v1/analytics/summary', { token });
    const c = a.json.consoles.find((x: any) => x.consoleId === consoleId);
    assert.ok(c);
    assert.equal(c.totalMinutesPlayed, 50);
    assert.equal(c.bonusesGranted, 1);
    assert.equal(a.json.totals.minutesPlayed, 50);
  } finally {
    await h.close();
  }
});
