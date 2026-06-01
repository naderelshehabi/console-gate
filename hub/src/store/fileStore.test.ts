import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from './fileStore';
import type { Console } from '../types';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'cg-store-'));
}

test('seeds a default schedule and a hub id', () => {
  const dir = tmp();
  try {
    const s = FileStore.open(dir, 'UTC');
    assert.ok(s.getHubId());
    const def = s.getDefaultSchedule();
    assert.equal(def.consoleId, null);
    assert.equal(def.days.mon.quotaMin, 120);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upsert/get console persists across reopen', async () => {
  const dir = tmp();
  try {
    const s = FileStore.open(dir, 'UTC');
    const c: Console = {
      id: 'c1',
      kind: 'wii',
      name: 'Living Room',
      pairedAt: 1,
      lastSeen: null,
      agentVersion: null,
      fwNotes: null,
    };
    await s.upsertConsole(c);
    const reopened = FileStore.open(dir, 'UTC');
    assert.deepEqual(reopened.getConsole('c1'), c);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secret is stable across reopen', () => {
  const dir = tmp();
  try {
    const a = FileStore.open(dir).getSecret().toString('hex');
    const b = FileStore.open(dir).getSecret().toString('hex');
    assert.equal(a, b);
    assert.equal(Buffer.from(a, 'hex').length, 32);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('device lookup by token hash', async () => {
  const dir = tmp();
  try {
    const s = FileStore.open(dir);
    await s.upsertDevice({
      id: 'd1',
      kind: 'android',
      name: 'phone',
      consoleId: null,
      tokenHash: 'abc',
      signingKey: null,
      pushToken: null,
      pairedAt: 1,
      lastSeen: null,
    });
    assert.equal(s.getDeviceByTokenHash('abc')?.id, 'd1');
    assert.equal(s.getDeviceByTokenHash('nope'), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serialized writes do not corrupt the file under concurrency', async () => {
  const dir = tmp();
  try {
    const s = FileStore.open(dir);
    const writes: Promise<void>[] = [];
    for (let i = 0; i < 50; i++) {
      writes.push(
        s.addGrant({
          id: `g${i}`,
          consoleId: 'c1',
          minutes: i,
          date: '2024-01-03',
          grantedBy: 'test',
          createdAt: i,
          expires: 9_999_999_999_999,
        }),
      );
    }
    await Promise.all(writes);
    const reopened = FileStore.open(dir);
    assert.equal(reopened.listGrants('c1', '2024-01-03').length, 50);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
