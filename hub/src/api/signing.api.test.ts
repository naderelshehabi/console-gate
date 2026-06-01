import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHarness, pairAgent } from '../testutil';
import { sign } from '../auth/signing';

/** Build the signing headers for a request body. */
function signHeaders(signingKey: string, method: string, path: string, body: unknown, ts: number, nonce: string) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return {
    'x-cg-nonce': nonce,
    'x-cg-ts': String(ts),
    'x-cg-sig': sign(signingKey, method, path, raw, nonce, ts),
  };
}

test('PHASE6: a correctly signed agent request is accepted', async () => {
  const h = await makeHarness();
  try {
    const { token, signingKey } = await pairAgent(h);
    assert.ok(signingKey, 'agent received a signing key');
    const body = { minutesUsedDelta: 0 };
    const ts = h.hub.time.now();
    const headers = signHeaders(signingKey, 'POST', '/api/v1/agent/poll', body, ts, 'sig-nonce-1');
    const res = await h.request('POST', '/api/v1/agent/poll', { token, body, headers });
    assert.equal(res.status, 200);
  } finally {
    await h.close();
  }
});

test('PHASE6: tampered body / bad signature / replay / stale ts are rejected', async () => {
  const h = await makeHarness();
  try {
    const { token, signingKey } = await pairAgent(h);
    const path = '/api/v1/agent/poll';
    const ts = h.hub.time.now();

    // Sign for one body but send a different body -> bad signature.
    const headersForA = signHeaders(signingKey, 'POST', path, { minutesUsedDelta: 0 }, ts, 'n-tamper');
    const tampered = await h.request('POST', path, { token, body: { minutesUsedDelta: 99 }, headers: headersForA });
    assert.equal(tampered.status, 401);

    // Valid signed request, then replay the exact same nonce -> rejected.
    const body = { minutesUsedDelta: 0 };
    const h2 = signHeaders(signingKey, 'POST', path, body, ts, 'n-replay');
    assert.equal((await h.request('POST', path, { token, body, headers: h2 })).status, 200);
    assert.equal((await h.request('POST', path, { token, body, headers: h2 })).status, 401); // replay

    // Stale timestamp -> rejected.
    const staleTs = ts - 10 * 60 * 1000;
    const h3 = signHeaders(signingKey, 'POST', path, body, staleTs, 'n-stale');
    assert.equal((await h.request('POST', path, { token, body, headers: h3 })).status, 401);
  } finally {
    await h.close();
  }
});

test('PHASE6: enforceAgentSigning rejects unsigned agent requests', async () => {
  const h = await makeHarness({});
  try {
    // Flip enforcement on for this Hub instance.
    (h.hub.config as { enforceAgentSigning: boolean }).enforceAgentSigning = true;
    const { token, signingKey } = await pairAgent(h);

    // Unsigned -> rejected.
    const unsigned = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 0 } });
    assert.equal(unsigned.status, 401);

    // Signed -> accepted.
    const ts = h.hub.time.now();
    const headers = signHeaders(signingKey, 'POST', '/api/v1/agent/poll', { minutesUsedDelta: 0 }, ts, 'enf-1');
    const signed = await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 0 }, headers });
    assert.equal(signed.status, 200);
  } finally {
    await h.close();
  }
});
