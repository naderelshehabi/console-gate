import type { Store } from '../store/store';
import type { TimeAuthority } from '../time/timeauth';
import type { EventLog } from '../events/log';
import type { EnforcementService } from './enforcement';
import { defaultFlags } from './defaults';
import { localParts } from '../util/localtime';
import { uuid, nonce } from '../util/ids';
import type { Command, CommandType, Flags, MoreTimeRequest } from '../types';

function nextLocalMidnight(now: number, tz: string): number {
  const { minutesOfDay } = localParts(now, tz);
  return now + (1440 - minutesOfDay) * 60_000;
}

/**
 * Parent-facing control operations. Each mutates policy/state, enqueues an agent
 * command where an immediate push is useful, and logs an event.
 */
export class ControlService {
  constructor(
    private readonly store: Store,
    private readonly time: TimeAuthority,
    private readonly events: EventLog,
    private readonly enforcement: EnforcementService,
  ) {}

  private flags(consoleId: string): Flags {
    return this.store.getFlags(consoleId) ?? defaultFlags(consoleId);
  }

  private async enqueue(consoleId: string, type: CommandType, args: Record<string, unknown> = {}): Promise<Command> {
    const cmd: Command = { id: uuid(), consoleId, type, args, nonce: nonce(), ts: this.time.now() };
    await this.store.addCommand(cmd);
    return cmd;
  }

  async lockNow(consoleId: string, actor: string): Promise<void> {
    await this.store.upsertFlags({ ...this.flags(consoleId), lockNow: true });
    await this.enqueue(consoleId, 'LOCK_NOW');
    this.events.emit({ type: 'LOCKED_BY_PARENT', consoleId, data: { actor }, ts: this.time.now() });
  }

  async unlock(consoleId: string, actor: string): Promise<void> {
    await this.store.upsertFlags({ ...this.flags(consoleId), lockNow: false, paused: false });
    await this.enqueue(consoleId, 'UNLOCK');
    this.events.emit({ type: 'UNLOCKED', consoleId, data: { actor }, ts: this.time.now() });
  }

  async pause(consoleId: string, actor: string): Promise<void> {
    await this.store.upsertFlags({ ...this.flags(consoleId), paused: true });
    await this.enqueue(consoleId, 'PAUSE');
    this.events.emit({ type: 'PAUSED', consoleId, data: { actor }, ts: this.time.now() });
  }

  async resume(consoleId: string, actor: string): Promise<void> {
    await this.store.upsertFlags({ ...this.flags(consoleId), paused: false });
    await this.enqueue(consoleId, 'RESUME');
    this.events.emit({ type: 'RESUMED', consoleId, data: { actor }, ts: this.time.now() });
  }

  async grantBonus(consoleId: string, minutes: number, actor: string, extend = false): Promise<void> {
    const now = this.time.now();
    const tz = this.enforcement.effectiveSchedule(consoleId).tz;
    const date = localParts(now, tz).dateKey;
    await this.store.addGrant({
      id: uuid(),
      consoleId,
      minutes,
      date,
      grantedBy: actor,
      createdAt: now,
      expires: nextLocalMidnight(now, tz),
    });
    await this.enqueue(consoleId, 'GRANT_BONUS', { minutes });
    this.events.emit({
      type: extend ? 'EXTENDED_TODAY' : 'BONUS_GRANTED',
      consoleId,
      data: { minutes, actor },
      ts: now,
    });
  }

  // More-time requests -----------------------------------------------------
  async requestMoreTime(consoleId: string, minutes: number, reason: string | null): Promise<MoreTimeRequest> {
    const req: MoreTimeRequest = {
      id: uuid(),
      consoleId,
      minutes,
      reason,
      status: 'pending',
      createdAt: this.time.now(),
      resolvedAt: null,
      resolvedBy: null,
    };
    await this.store.addRequest(req);
    this.events.emit({ type: 'MORE_TIME_REQUESTED', consoleId, data: { minutes, reason }, ts: this.time.now() });
    return req;
  }

  async approveRequest(id: string, actor: string): Promise<MoreTimeRequest> {
    const req = this.store.getRequest(id);
    if (!req) throw new Error('request not found');
    if (req.status !== 'pending') return req;
    await this.grantBonus(req.consoleId, req.minutes, actor);
    const updated: MoreTimeRequest = { ...req, status: 'approved', resolvedAt: this.time.now(), resolvedBy: actor };
    await this.store.updateRequest(updated);
    return updated;
  }

  async denyRequest(id: string, actor: string): Promise<MoreTimeRequest> {
    const req = this.store.getRequest(id);
    if (!req) throw new Error('request not found');
    if (req.status !== 'pending') return req;
    const updated: MoreTimeRequest = { ...req, status: 'denied', resolvedAt: this.time.now(), resolvedBy: actor };
    await this.store.updateRequest(updated);
    return updated;
  }
}
