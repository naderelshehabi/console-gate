import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';

/**
 * Contract test: the fields the native agent's parser (agent-core/src/cg_proto.c)
 * reads out of a /agent/poll response MUST keep their names and types. If the Hub
 * drifts, this fails and warns us before the C agent breaks in the field.
 */
test('agent poll response matches the cg_proto contract', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    const res = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 115 } });
    assert.equal(res.status, 200);
    const j = res.json;

    // effective.*
    assert.equal(typeof j.effective.state, 'string');
    assert.ok(['ALLOWED', 'WARNING', 'GRACE', 'LOCKED'].includes(j.effective.state));
    assert.equal(typeof j.effective.reason, 'string');
    assert.equal(typeof j.effective.secondsToNextBoundary, 'number');
    assert.equal(typeof j.effective.quotaRemainingMin, 'number');
    assert.ok(['soft', 'hard'].includes(j.effective.enforcement));
    assert.equal(typeof j.effective.graceSeconds, 'number');
    assert.ok(Array.isArray(j.effective.warnThresholdsMin));
    j.effective.warnThresholdsMin.forEach((n: unknown) => assert.equal(typeof n, 'number'));

    // authoritative.*
    assert.equal(typeof j.authoritative.utcMs, 'number');
    assert.equal(typeof j.authoritative.source, 'string');

    // commands[] = { id, type }
    assert.ok(Array.isArray(j.commands));
  } finally {
    await h.close();
  }
});

test('queued command exposes id + type for the native ack path', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', `/api/v1/consoles/${consoleId}/lock`, { token, pin: '4242', body: {} });
    const res = await h.request('POST', '/api/v1/agent/poll', { token, body: {} });
    const cmd = res.json.commands[0];
    assert.ok(cmd);
    assert.equal(typeof cmd.id, 'string');
    assert.equal(typeof cmd.type, 'string');
    assert.equal(cmd.type, 'LOCK_NOW');
  } finally {
    await h.close();
  }
});
