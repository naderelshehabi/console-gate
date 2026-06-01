import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';

/** Collect stream messages until `done(messages)` is true or it times out. */
function collect(url: string, done: (msgs: any[]) => boolean, timeoutMs = 3000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs: any[] = [];
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(msgs); // resolve with what we have; assertions decide pass/fail
    }, timeoutMs);
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
    ws.onmessage = (ev) => {
      msgs.push(JSON.parse(String(ev.data)));
      if (done(msgs)) {
        clearTimeout(timer);
        try { ws.close(); } catch { /* ignore */ }
        resolve(msgs);
      }
    };
  });
}

test('GATE2: stream sends hello, then event + state on a transition', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    const wsUrl = h.baseUrl.replace(/^http/, 'ws') + '/api/v1/stream?token=' + token;

    const collecting = collect(wsUrl, (m) => m.some((x) => x.kind === 'event') && m.some((x) => x.kind === 'state'));
    // Give the socket a moment to open before triggering, then exhaust quota -> LOCKED.
    await new Promise((r) => setTimeout(r, 150));
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 120 } });

    const msgs = await collecting;
    assert.ok(msgs.some((m) => m.kind === 'hello'), 'hello frame');
    assert.ok(msgs.some((m) => m.kind === 'event' && m.event.type === 'QUOTA_EXHAUSTED'), 'event frame');
    const stateMsg = msgs.find((m) => m.kind === 'state');
    assert.ok(stateMsg, 'state frame');
    assert.equal(stateMsg.effective.state, 'LOCKED');
  } finally {
    await h.close();
  }
});

test('GATE2: stream rejects an invalid token', async () => {
  const h = await makeHarness();
  try {
    const wsUrl = h.baseUrl.replace(/^http/, 'ws') + '/api/v1/stream?token=bogus';
    await assert.rejects(
      () => new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => { try { ws.close(); } catch { /* ignore */ } resolve(null); };
        ws.onerror = () => reject(new Error('rejected'));
      }),
    );
  } finally {
    await h.close();
  }
});
