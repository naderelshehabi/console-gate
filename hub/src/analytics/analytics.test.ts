import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../store/fileStore';
import { EventLog } from '../events/log';
import { computeSummary } from './analytics';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cg-an-'));
  const store = FileStore.open(dir, 'UTC');
  const log = new EventLog(join(dir, 'events.jsonl'), store.getSecret());
  return { dir, store, log, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('computeSummary aggregates play minutes and incident counts', async () => {
  const { store, log, cleanup } = setup();
  try {
    await store.upsertConsole({
      id: 'c1', kind: 'wii', name: 'Wii', pairedAt: 1, lastSeen: 100, agentVersion: null, fwNotes: null,
    });
    await store.upsertQuota({ consoleId: 'c1', date: '2024-01-03', quotaTotalMin: 120, minutesUsed: 40, highWaterUtc: 1, updatedAt: 1 });
    await store.upsertQuota({ consoleId: 'c1', date: '2024-01-04', quotaTotalMin: 120, minutesUsed: 60, highWaterUtc: 1, updatedAt: 1 });
    log.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 1000 });
    log.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 2000 });
    log.emit({ type: 'BONUS_GRANTED', consoleId: 'c1', ts: 3000 });

    const sum = computeSummary(store, log, { sinceTs: 0, now: 5000 });
    const c = sum.consoles[0]!;
    assert.equal(c.totalMinutesPlayed, 100);
    assert.equal(c.byDay.length, 2);
    assert.equal(c.overageIncidents, 2);
    assert.equal(c.bonusesGranted, 1);
    assert.equal(sum.totals.minutesPlayed, 100);
    assert.equal(sum.totals.overageIncidents, 2);
  } finally {
    cleanup();
  }
});

test('computeSummary respects the since window for incidents', async () => {
  const { store, log, cleanup } = setup();
  try {
    await store.upsertConsole({
      id: 'c1', kind: 'xbox360', name: 'X', pairedAt: 1, lastSeen: 1, agentVersion: null, fwNotes: null,
    });
    log.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 1000 }); // old
    log.emit({ type: 'PLAY_BEYOND_DOWNTIME', consoleId: 'c1', ts: 9000 }); // recent
    const sum = computeSummary(store, log, { sinceTs: 5000, now: 10000 });
    assert.equal(sum.consoles[0]!.overageIncidents, 1);
  } finally {
    cleanup();
  }
});
