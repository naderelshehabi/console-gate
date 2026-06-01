import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalString, bodyHashHex, sign, verifySignature, ReplayCache, checkSignedRequest } from './signing';

const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

test('canonical string has the documented 5-line shape', () => {
  const c = canonicalString('post', '/api/v1/agent/poll', '{"a":1}', 'n1', 1700000000000);
  const lines = c.split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], 'POST'); // method uppercased
  assert.equal(lines[1], '/api/v1/agent/poll');
  assert.equal(lines[2], bodyHashHex('{"a":1}'));
  assert.equal(lines[3], 'n1');
  assert.equal(lines[4], '1700000000000');
});

test('sign/verify round-trip; tamper detection', () => {
  const sig = sign(KEY, 'POST', '/x', 'body', 'n', 1);
  assert.ok(verifySignature(KEY, 'POST', '/x', 'body', 'n', 1, sig));
  // any change breaks verification
  assert.equal(verifySignature(KEY, 'POST', '/x', 'body2', 'n', 1, sig), false);
  assert.equal(verifySignature(KEY, 'GET', '/x', 'body', 'n', 1, sig), false);
  assert.equal(verifySignature(KEY, 'POST', '/x', 'body', 'n', 2, sig), false);
  assert.equal(verifySignature('ff'.repeat(32), 'POST', '/x', 'body', 'n', 1, sig), false);
  assert.equal(verifySignature(KEY, 'POST', '/x', 'body', 'n', 1, 'deadbeef'), false);
});

test('replay cache rejects a reused nonce within the TTL', () => {
  const rc = new ReplayCache(1000);
  assert.equal(rc.checkAndRecord('a', 0), true);
  assert.equal(rc.checkAndRecord('a', 100), false); // replay
  assert.equal(rc.checkAndRecord('b', 100), true);
  // After TTL the nonce can be reused (cache pruned).
  assert.equal(rc.checkAndRecord('a', 2000), true);
});

test('checkSignedRequest enforces key, ts skew, signature, and replay', () => {
  const rc = new ReplayCache();
  const now = 1700000000000;
  const good = {
    signingKey: KEY,
    method: 'POST',
    path: '/api/v1/agent/poll',
    rawBody: '{"minutesUsedDelta":0}',
    nonce: 'nonce-1',
    ts: String(now),
    now,
    skewMs: 300000,
    replay: rc,
  };
  const sig = sign(KEY, good.method, good.path, good.rawBody, good.nonce, good.ts);

  assert.equal(checkSignedRequest({ ...good, sig }).ok, true);
  // replay (same nonce) now fails
  assert.equal(checkSignedRequest({ ...good, sig }).reason, 'replayed nonce');
  // missing key
  assert.equal(checkSignedRequest({ ...good, signingKey: null, nonce: 'n2', sig }).reason, 'device has no signing key');
  // stale ts
  const staleTs = String(now - 10 * 60 * 1000);
  const staleSig = sign(KEY, good.method, good.path, good.rawBody, 'n3', staleTs);
  assert.equal(checkSignedRequest({ ...good, nonce: 'n3', ts: staleTs, sig: staleSig }).reason, 'stale timestamp');
  // bad signature
  assert.equal(checkSignedRequest({ ...good, nonce: 'n4', sig: 'abcd' }).reason, 'bad signature');
  // missing headers
  assert.equal(checkSignedRequest({ ...good, nonce: undefined, sig }).reason, 'missing signing headers');
});
