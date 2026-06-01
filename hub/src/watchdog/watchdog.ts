import type { Store } from '../store/store';
import type { TimeAuthority } from '../time/timeauth';
import type { EventLog } from '../events/log';
import { log } from '../logger';

interface ConsoleWatch {
  cleanShutdown: boolean; // agent reported a graceful power-off
  offlineFired: boolean;  // AGENT_OFFLINE already raised for the current gap
}

/**
 * Heartbeat dead-man's switch (docs/implement/09-time-and-tamper.md §9.6/§9.7).
 *
 * Agents heartbeat while powered. A gap that is NOT preceded by a clean shutdown
 * means the agent was killed / the console reflashed / network cut — so the
 * watchdog raises an `AGENT_OFFLINE` push (debounced). A graceful power-off
 * (POST /agent/shutdown) suppresses it. This makes "disable the agent" a
 * detected event rather than a silent win.
 */
export class WatchdogService {
  private readonly watches = new Map<string, ConsoleWatch>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly time: TimeAuthority,
    private readonly events: EventLog,
    private readonly offlineMs: number,
    private readonly intervalMs: number,
  ) {}

  private watch(consoleId: string): ConsoleWatch {
    let w = this.watches.get(consoleId);
    if (!w) {
      w = { cleanShutdown: false, offlineFired: false };
      this.watches.set(consoleId, w);
    }
    return w;
  }

  /** Called on every poll/heartbeat — the agent is alive. */
  noteHeartbeat(consoleId: string): void {
    const w = this.watch(consoleId);
    w.cleanShutdown = false;
    w.offlineFired = false;
  }

  /** Called when an agent reports a graceful power-off. */
  noteShutdown(consoleId: string): void {
    this.watch(consoleId).cleanShutdown = true;
  }

  /**
   * Scan all consoles for heartbeat gaps. Pure of timers so tests can drive it
   * directly with a fake clock. Returns the consoleIds that newly went offline.
   */
  scan(now: number): string[] {
    const fired: string[] = [];
    for (const console of this.store.listConsoles()) {
      if (console.lastSeen == null) continue; // never connected — nothing to miss
      const w = this.watch(console.id);
      if (w.cleanShutdown || w.offlineFired) continue;
      if (now - console.lastSeen > this.offlineMs) {
        w.offlineFired = true;
        this.events.emit({
          type: 'AGENT_OFFLINE',
          consoleId: console.id,
          data: { lastSeen: console.lastSeen, gapMs: now - console.lastSeen },
          ts: now,
        });
        fired.push(console.id);
      }
    }
    return fired;
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        this.scan(this.time.now());
      } catch (e) {
        log.warn('watchdog scan failed', { err: String(e) });
      }
    }, this.intervalMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
