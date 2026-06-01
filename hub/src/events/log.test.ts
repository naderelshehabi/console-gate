import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { EventLog } from './log';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cg-log-'));
  const path = join(dir, 'events.jsonl');
  const secret = randomBytes(32);
  return { dir, path, secret, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('emits, persists, and verifies a clean chain', () => {
  const { path, secret, cleanup } = setup();
  try {
    const lg = new EventLog(path, secret);
    lg.emit({ type: 'SESSION_START', consoleId: 'c1', ts: 1 });
    lg.emit({ type: 'QUOTA_EXHAUSTED', consoleId: 'c1', ts: 2 });
    lg.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 3 });
    const v = lg.verify();
    assert.equal(v.ok, true);
    assert.equal(v.count, 3);
  } finally {
    cleanup();
  }
});

test('push/severity metadata applied from taxonomy', () => {
  const { path, secret, cleanup } = setup();
  try {
    const lg = new EventLog(path, secret);
    const e = lg.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 1 });
    assert.equal(e.push, true);
    assert.equal(e.severity, 'warn');
    const info = lg.emit({ type: 'SESSION_START', consoleId: 'c1', ts: 2 });
    assert.equal(info.push, false);
  } finally {
    cleanup();
  }
});

test('detects a tampered record', () => {
  const { path, secret, cleanup } = setup();
  try {
    const lg = new EventLog(path, secret);
    lg.emit({ type: 'SESSION_START', consoleId: 'c1', ts: 1 });
    lg.emit({ type: 'SESSION_END', consoleId: 'c1', ts: 2 });
    // Tamper: rewrite the first line's data.
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    const rec = JSON.parse(lines[0]!);
    rec.data = { hacked: true };
    lines[0] = JSON.stringify(rec);
    writeFileSync(path, lines.join('\n') + '\n');

    const v = lg.verify();
    assert.equal(v.ok, false);
    assert.equal(v.brokenAt, 0);
  } finally {
    cleanup();
  }
});

test('detects a deleted record (chain break)', () => {
  const { path, secret, cleanup } = setup();
  try {
    const lg = new EventLog(path, secret);
    lg.emit({ type: 'SESSION_START', consoleId: 'c1', ts: 1 });
    lg.emit({ type: 'SESSION_END', consoleId: 'c1', ts: 2 });
    lg.emit({ type: 'BONUS_GRANTED', consoleId: 'c1', ts: 3 });
    // Delete the middle record.
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    writeFileSync(path, [lines[0], lines[2]].join('\n') + '\n');
    const v = lg.verify();
    assert.equal(v.ok, false);
    assert.equal(v.brokenAt, 1);
  } finally {
    cleanup();
  }
});

test('query filters and reverses (most recent first)', () => {
  const { path, secret, cleanup } = setup();
  try {
    const lg = new EventLog(path, secret);
    lg.emit({ type: 'SESSION_START', consoleId: 'c1', ts: 1 });
    lg.emit({ type: 'SESSION_START', consoleId: 'c2', ts: 2 });
    lg.emit({ type: 'SESSION_END', consoleId: 'c1', ts: 3 });
    assert.equal(lg.query({ consoleId: 'c1' }).length, 2);
    assert.equal(lg.query({ type: 'SESSION_START' }).length, 2);
    assert.equal(lg.query({ limit: 1 })[0]?.ts, 3);
  } finally {
    cleanup();
  }
});

test('chain survives reopening the log', () => {
  const { path, secret, cleanup } = setup();
  try {
    new EventLog(path, secret).emit({ type: 'SESSION_START', consoleId: 'c1', ts: 1 });
    const lg2 = new EventLog(path, secret);
    lg2.emit({ type: 'SESSION_END', consoleId: 'c1', ts: 2 });
    assert.equal(lg2.verify().ok, true);
  } finally {
    cleanup();
  }
});
