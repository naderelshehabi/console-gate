import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../store/fileStore';
import { AuthService, LockedOutError } from './authService';
import { hashPin, verifyPin } from './pin';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cg-auth-'));
  const store = FileStore.open(dir, 'UTC');
  let now = 1_700_000_000_000;
  const auth = new AuthService(store, () => now, { lockoutThreshold: 3, lockoutWindowMs: 60_000 });
  return {
    store,
    auth,
    setNow: (n: number) => (now = n),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('pin hash verifies correct and rejects wrong', () => {
  const rec = hashPin('4242');
  assert.ok(verifyPin('4242', rec));
  assert.equal(verifyPin('0000', rec), false);
});

test('set PIN then require old PIN to change', async () => {
  const { auth, cleanup } = setup();
  try {
    assert.equal(auth.isPinSet(), false);
    await auth.setPin('4242');
    assert.equal(auth.isPinSet(), true);
    await assert.rejects(() => auth.setPin('9999')); // missing old PIN
    await auth.setPin('9999', '4242');
    assert.ok(auth.verifyPin('9999'));
  } finally {
    cleanup();
  }
});

test('lockout after threshold failures', async () => {
  const { auth, cleanup } = setup();
  try {
    await auth.setPin('4242');
    assert.equal(auth.verifyPin('0001'), false);
    assert.equal(auth.verifyPin('0002'), false);
    assert.equal(auth.verifyPin('0003'), false);
    assert.throws(() => auth.verifyPin('4242'), LockedOutError);
  } finally {
    cleanup();
  }
});

test('lockout window expires', async () => {
  const { auth, setNow, cleanup } = setup();
  try {
    await auth.setPin('4242');
    for (let i = 0; i < 3; i++) auth.verifyPin('bad');
    assert.equal(auth.isLockedOut(), true);
    setNow(1_700_000_000_000 + 61_000); // past the 60s window
    assert.equal(auth.isLockedOut(), false);
    assert.ok(auth.verifyPin('4242'));
  } finally {
    cleanup();
  }
});

test('pairing an agent creates a console and a usable token', async () => {
  const { auth, cleanup } = setup();
  try {
    const { code } = auth.startPairing();
    const res = await auth.claimPairing(code, {
      deviceKind: 'agent',
      deviceName: 'agent-1',
      consoleKind: 'xbox360',
      consoleName: 'Den 360',
    });
    assert.ok(res.console);
    assert.equal(res.console?.kind, 'xbox360');
    const device = auth.authenticate(res.token);
    assert.equal(device?.id, res.device.id);
    assert.equal(device?.consoleId, res.console?.id);
  } finally {
    cleanup();
  }
});

test('agent pairing without console details is rejected', async () => {
  const { auth, cleanup } = setup();
  try {
    const { code } = auth.startPairing();
    await assert.rejects(() => auth.claimPairing(code, { deviceKind: 'agent', deviceName: 'x' }));
  } finally {
    cleanup();
  }
});

test('expired or unknown pairing code is rejected', async () => {
  const { auth, setNow, cleanup } = setup();
  try {
    const { code } = auth.startPairing();
    setNow(1_700_000_000_000 + 10 * 60_000); // past 5 min TTL
    await assert.rejects(() =>
      auth.claimPairing(code, { deviceKind: 'android', deviceName: 'phone' }),
    );
  } finally {
    cleanup();
  }
});

test('PIN session verifies and a bad token does not', async () => {
  const { auth, cleanup } = setup();
  try {
    await auth.setPin('4242');
    const s = auth.createPinSession('4242');
    assert.ok(auth.verifyPinSession(s.token));
    assert.equal(auth.verifyPinSession('garbage'), false);
  } finally {
    cleanup();
  }
});
