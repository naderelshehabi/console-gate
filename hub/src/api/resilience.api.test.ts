import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeHarness, pairAgent, WED_1000_UTC } from '../testutil';
import { Hub } from '../hub';
import { DEFAULT_CONFIG } from '../config';
import { FakeClock } from '../time/clock';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// --- Token revocation -------------------------------------------------------

test('PHASE6: revoking a device kills its token', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    // Token works before revocation.
    assert.equal((await h.request('POST', '/api/v1/agent/poll', { token, body: {} })).status, 200);

    // Find the agent device and revoke it.
    const devices = await h.request('GET', '/api/v1/devices', { token });
    const agent = devices.json.devices.find((d: any) => d.consoleId === consoleId);
    assert.ok(agent);
    const revoke = await h.request('POST', `/api/v1/devices/${agent.id}/revoke`, { token, pin: '4242', body: {} });
    assert.equal(revoke.status, 200);

    // Token is now rejected.
    assert.equal((await h.request('POST', '/api/v1/agent/poll', { token, body: {} })).status, 401);
  } finally {
    await h.close();
  }
});

test('PHASE6: device list never leaks secrets', async () => {
  const h = await makeHarness();
  try {
    const { token } = await pairAgent(h);
    const devices = await h.request('GET', '/api/v1/devices', { token });
    const raw = JSON.stringify(devices.json);
    assert.ok(!raw.includes('tokenHash'));
    assert.ok(!raw.includes('signingKey'));
  } finally {
    await h.close();
  }
});

// --- Backups ----------------------------------------------------------------

test('PHASE6: backup writes state + log + snapshot with verified integrity', async () => {
  const h = await makeHarness();
  try {
    const { token, consoleId } = await pairAgent(h, '4242');
    await h.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 5 } });
    // Emit at least one event so the signed log exists and gets backed up.
    await h.request('POST', `/api/v1/consoles/${consoleId}/lock`, { token, pin: '4242', body: {} });
    const res = await h.request('POST', '/api/v1/system/backup', { token, pin: '4242', body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json.logIntegrity, true);
    assert.ok(existsSync(join(res.json.dir, 'state.json')));
    assert.ok(existsSync(join(res.json.dir, 'events.jsonl')));
    assert.ok(existsSync(join(res.json.dir, 'snapshot.json')));

    const list = await h.request('GET', '/api/v1/system/backups', { token, pin: '4242' });
    assert.ok(list.json.backups.length >= 1);
  } finally {
    await h.close();
  }
});

// --- Standby replication ----------------------------------------------------

test('PHASE6: a standby Hub imports a snapshot and serves identical reads', async () => {
  const primary = await makeHarness();
  const standbyDir = mkdtempSync(join(tmpdir(), 'cg-standby-'));
  let standby: Hub | undefined;
  try {
    const { token, consoleId } = await pairAgent(primary, '4242');
    await primary.request('POST', '/api/v1/agent/poll', { token, body: { minutesUsedDelta: 30 } });

    // Pull the snapshot from the primary.
    const snap = await primary.request('GET', '/api/v1/system/snapshot', { token, pin: '4242' });
    assert.equal(snap.status, 200);
    assert.equal(snap.json.hubId, primary.hub.store.getHubId());

    // Build a standby Hub and replicate into it.
    standby = new Hub({
      config: { ...DEFAULT_CONFIG, dataDir: standbyDir, tz: 'UTC', ntpPool: [], port: 0, discoveryPort: 0, logLevel: 'error' },
      clock: new FakeClock(WED_1000_UTC), // same day as the primary so quota day-keys match
    });
    await standby.store.importState(snap.json.state);

    // The standby now knows the same console + quota.
    const c = standby.store.getConsole(consoleId);
    assert.ok(c, 'console replicated');
    const computed = await standby.enforcement.computeState(consoleId);
    assert.equal(computed.quota.minutesUsed, 30);
  } finally {
    standby?.stop();
    rmSync(standbyDir, { recursive: true, force: true });
    await primary.close();
  }
});
