import { mkdirSync, copyFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '../store/store';
import type { EventLog } from '../events/log';
import type { TimeAuthority } from '../time/timeauth';
import { log } from '../logger';

export interface BackupResult {
  dir: string;
  ts: number;
  files: string[];
  logIntegrity: boolean;
}

/**
 * Backups + standby snapshots (docs/implement/03-hub.md §3.8/§3.9).
 *
 * - {@link backupNow} copies state.json + the signed events.jsonl to a
 *   timestamped folder and records whether the event-log hash chain still
 *   verifies (so a corrupt backup is obvious).
 * - {@link snapshot} returns a serializable, secret-free state export for a
 *   standby Hub to {@link Store.importState}, keeping reads available if the
 *   primary is down.
 */
export class BackupService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly store: Store,
    private readonly events: EventLog,
    private readonly time: TimeAuthority,
  ) {}

  backupNow(): BackupResult {
    const ts = this.time.now();
    const dir = join(this.dataDir, 'backups', String(ts));
    mkdirSync(dir, { recursive: true });
    const files: string[] = [];
    for (const name of ['state.json', 'events.jsonl']) {
      const src = join(this.dataDir, name);
      if (existsSync(src)) {
        copyFileSync(src, join(dir, name));
        files.push(name);
      }
    }
    // Also drop a sealed snapshot for fast standby restore.
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(this.snapshot()));
    files.push('snapshot.json');
    const logIntegrity = this.events.verify().ok;
    log.info('backup written', { dir, files: files.length, logIntegrity });
    return { dir, ts, files, logIntegrity };
  }

  listBackups(): number[] {
    const root = join(this.dataDir, 'backups');
    if (!existsSync(root)) return [];
    return readdirSync(root)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
  }

  /** A consistent, secret-free state export for a standby replica. */
  snapshot(): { hubId: string; generatedAt: number; state: unknown; events: unknown[] } {
    return {
      hubId: this.store.getHubId(),
      generatedAt: this.time.now(),
      state: this.store.exportState(),
      events: this.events.readAll(),
    };
  }

  start(intervalMs: number): void {
    if (intervalMs <= 0) return;
    this.timer = setInterval(() => {
      try {
        this.backupNow();
      } catch (e) {
        log.warn('scheduled backup failed', { err: String(e) });
      }
    }, intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
