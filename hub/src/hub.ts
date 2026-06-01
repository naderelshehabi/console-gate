import { join } from 'node:path';
import type { HubConfig } from './config';
import { FileStore } from './store/fileStore';
import type { Store } from './store/store';
import { TimeAuthority } from './time/timeauth';
import type { ClockSource } from './time/clock';
import type { SntpQuery } from './time/timeauth';
import { QuotaService } from './quota/quota';
import { EventLog } from './events/log';
import { StreamBus } from './events/bus';
import { EnforcementService } from './policy/enforcement';
import { ControlService } from './policy/control';
import { AuthService } from './auth/authService';

export interface HubDeps {
  config: HubConfig;
  store?: Store;
  clock?: ClockSource;
  sntpQuery?: SntpQuery;
}

/**
 * Composition root: constructs and wires every service. Tests build a Hub with
 * an injected FakeClock + stub SNTP for deterministic time; production builds it
 * from real config.
 */
export class Hub {
  readonly config: HubConfig;
  readonly store: Store;
  readonly time: TimeAuthority;
  readonly quota: QuotaService;
  readonly events: EventLog;
  readonly bus: StreamBus;
  readonly enforcement: EnforcementService;
  readonly control: ControlService;
  readonly auth: AuthService;

  constructor(deps: HubDeps) {
    this.config = deps.config;
    this.store = deps.store ?? FileStore.open(deps.config.dataDir, deps.config.tz);
    this.time = new TimeAuthority({
      clock: deps.clock,
      ntpPool: deps.config.ntpPool,
      sntpQuery: deps.sntpQuery,
      syncIntervalMs: deps.config.ntpSyncIntervalMs,
    });
    this.quota = new QuotaService(this.store);
    this.events = new EventLog(join(deps.config.dataDir, 'events.jsonl'), this.store.getSecret());
    this.bus = new StreamBus();
    // Bridge every signed-log event onto the live stream.
    this.events.subscribe((event) => this.bus.publish({ kind: 'event', event }));
    this.enforcement = new EnforcementService(this.store, this.time, this.quota, this.events, this.config, this.bus);
    this.control = new ControlService(this.store, this.time, this.events, this.enforcement);
    this.auth = new AuthService(this.store, () => this.time.now());
  }

  /** Start background tasks (time sync). */
  start(): void {
    this.time.start();
  }

  stop(): void {
    this.time.stop();
  }
}
