import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStore } from '../store/fileStore';
import { QuotaService } from './quota';
import { uuid } from '../util/ids';

const WED_1000 = Date.UTC(2024, 0, 3, 10, 0, 0);
const THU_1000 = Date.UTC(2024, 0, 4, 10, 0, 0);

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cg-quota-'));
  const store = FileStore.open(dir, 'UTC');
  const quota = new QuotaService(store);
  const schedule = store.getDefaultSchedule(); // quota 120, tz UTC
  return { dir, store, quota, schedule, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('ensure creates a row with base quota and seeds high-water to now', async () => {
  const { quota, schedule, cleanup } = setup();
  try {
    const q = await quota.ensure('c1', schedule, WED_1000);
    assert.equal(q.quotaTotalMin, 120);
    assert.equal(q.minutesUsed, 0);
    assert.equal(q.highWaterUtc, WED_1000);
  } finally {
    cleanup();
  }
});

test('grants increase the daily total', async () => {
  const { store, quota, schedule, cleanup } = setup();
  try {
    await store.addGrant({
      id: uuid(),
      consoleId: 'c1',
      minutes: 30,
      date: '2024-01-03',
      grantedBy: 'p',
      createdAt: WED_1000,
      expires: WED_1000 + 12 * 3600_000,
    });
    const q = await quota.ensure('c1', schedule, WED_1000);
    assert.equal(q.quotaTotalMin, 150);
  } finally {
    cleanup();
  }
});

test('applyUsage accumulates monotonically and clamps negatives', async () => {
  const { quota, schedule, cleanup } = setup();
  try {
    await quota.applyUsage('c1', schedule, 40, WED_1000);
    const q = await quota.applyUsage('c1', schedule, -10, WED_1000); // negative ignored
    assert.equal(q.minutesUsed, 40);
  } finally {
    cleanup();
  }
});

test('day rollover resets usage but carries the high-water mark forward', async () => {
  const { quota, schedule, cleanup } = setup();
  try {
    await quota.applyUsage('c1', schedule, 100, WED_1000);
    const next = await quota.ensure('c1', schedule, THU_1000);
    assert.equal(next.date, '2024-01-04');
    assert.equal(next.minutesUsed, 0); // fresh quota for the new day
    assert.ok(next.highWaterUtc >= WED_1000); // high-water carried forward (anti-rollback)
  } finally {
    cleanup();
  }
});

test('advancing the clock forward does not refund already-used minutes', async () => {
  const { quota, schedule, cleanup } = setup();
  try {
    await quota.applyUsage('c1', schedule, 90, WED_1000);
    // Same day, later in the day: usage persists (no wall-clock subtraction).
    const q = await quota.ensure('c1', schedule, WED_1000 + 3 * 3600_000);
    assert.equal(q.minutesUsed, 90);
  } finally {
    cleanup();
  }
});
