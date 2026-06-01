import type { Store } from '../store/store';
import type { TimeAuthority } from '../time/timeauth';
import type { QuotaService, QuotaView } from '../quota/quota';
import type { EventLog } from '../events/log';
import type { StreamBus } from '../events/bus';
import type { HubConfig } from '../config';
import { evaluate, type TimeSignal } from './evaluator';
import { defaultFlags } from './defaults';
import { transitionEvents, type StateMemo } from './transitions';
import type { EffectiveState, Flags, Schedule } from '../types';

export interface ComputedState {
  effective: EffectiveState;
  quota: QuotaView;
  schedule: Schedule;
  flags: Flags;
}

/**
 * Combines schedule + flags + quota + authoritative time into the single
 * effective state used by both the agent poll and controller reads, and emits
 * transition events as state changes.
 */
export class EnforcementService {
  private readonly lastState = new Map<string, StateMemo>();

  constructor(
    private readonly store: Store,
    private readonly time: TimeAuthority,
    private readonly quota: QuotaService,
    private readonly events: EventLog,
    private readonly config: HubConfig,
    private readonly bus?: StreamBus,
  ) {}

  effectiveSchedule(consoleId: string): Schedule {
    return this.store.getSchedule(consoleId) ?? this.store.getDefaultSchedule();
  }

  flagsOf(consoleId: string): Flags {
    return this.store.getFlags(consoleId) ?? defaultFlags(consoleId);
  }

  /** Compute effective state now. `timeSignal` is supplied on agent polls only. */
  async computeState(consoleId: string, timeSignal?: TimeSignal): Promise<ComputedState> {
    const now = this.time.now();
    const schedule = this.effectiveSchedule(consoleId);
    const flags = this.flagsOf(consoleId);
    const quotaState = await this.quota.ensure(consoleId, schedule, now);
    const view = this.quota.view(quotaState);

    const effective = evaluate({
      now,
      tz: schedule.tz,
      schedule,
      enforcement: flags.enforcement,
      warnThresholdsMin: flags.warnThresholdsMin,
      graceSeconds: flags.graceSeconds,
      lockNow: flags.lockNow,
      paused: flags.paused,
      quotaTotalMin: view.quotaTotalMin,
      minutesUsed: view.minutesUsed,
      timeSignal,
    });

    return { effective, quota: view, schedule, flags };
  }

  /** Emit transition events for a freshly computed state and remember it. */
  recordTransition(consoleId: string, effective: EffectiveState, now: number): void {
    const prev = this.lastState.get(consoleId);
    const events = transitionEvents(prev, effective);
    for (const e of events) {
      this.events.emit({ type: e.type, consoleId, data: e.data, ts: now });
    }
    const changed = !prev || prev.state !== effective.state || prev.reason !== effective.reason;
    if (changed) this.bus?.publish({ kind: 'state', consoleId, effective });
    this.lastState.set(consoleId, { state: effective.state, reason: effective.reason });
  }

  /** Build the time-trust signal for a poll from the console's reported clock. */
  buildTimeSignal(highWaterUtc: number, reportedLocalUtc: number | undefined): TimeSignal {
    return {
      reportedLocalUtc,
      highWaterUtc,
      plausibleFloorUtc: this.config.plausibleFloorUtc,
      skewToleranceMs: this.config.clockSkewToleranceMs,
      hubUnreachable: false,
    };
  }
}
