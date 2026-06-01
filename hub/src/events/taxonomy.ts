/** Event taxonomy — docs/implement/08-protocol-api.md §8.7. */

export type EventType =
  | 'SESSION_START'
  | 'SESSION_END'
  | 'WARNING_SHOWN'
  | 'GRACE_STARTED'
  | 'DOWNTIME_ENFORCED'
  | 'QUOTA_EXHAUSTED'
  | 'PLAY_INTERRUPTED'
  | 'PLAY_BEYOND_DOWNTIME'
  | 'MORE_TIME_REQUESTED'
  | 'BONUS_GRANTED'
  | 'EXTENDED_TODAY'
  | 'LOCKED_BY_PARENT'
  | 'UNLOCKED'
  | 'PAUSED'
  | 'RESUMED'
  | 'AGENT_OFFLINE'
  | 'CONSOLE_POWERED_DURING_LOCK'
  | 'CLOCK_TAMPER_SUSPECTED'
  | 'PRIILOADER_ACCESS'
  | 'SETTINGS_ACCESS'
  | 'HUB_UNREACHABLE'
  | 'TIME_RESYNCED'
  | 'LOG_INTEGRITY_FAIL';

export type Severity = 'info' | 'warn' | 'crit';

interface Meta {
  severity: Severity;
  push: boolean;
}

const META: Record<EventType, Meta> = {
  SESSION_START: { severity: 'info', push: false },
  SESSION_END: { severity: 'info', push: false },
  WARNING_SHOWN: { severity: 'info', push: false },
  GRACE_STARTED: { severity: 'info', push: false },
  DOWNTIME_ENFORCED: { severity: 'info', push: false },
  QUOTA_EXHAUSTED: { severity: 'info', push: false },
  PLAY_INTERRUPTED: { severity: 'warn', push: false },
  PLAY_BEYOND_DOWNTIME: { severity: 'warn', push: true },
  MORE_TIME_REQUESTED: { severity: 'info', push: true },
  BONUS_GRANTED: { severity: 'info', push: false },
  EXTENDED_TODAY: { severity: 'info', push: false },
  LOCKED_BY_PARENT: { severity: 'info', push: false },
  UNLOCKED: { severity: 'info', push: false },
  PAUSED: { severity: 'info', push: false },
  RESUMED: { severity: 'info', push: false },
  AGENT_OFFLINE: { severity: 'warn', push: true },
  CONSOLE_POWERED_DURING_LOCK: { severity: 'warn', push: true },
  CLOCK_TAMPER_SUSPECTED: { severity: 'warn', push: true },
  PRIILOADER_ACCESS: { severity: 'warn', push: true },
  SETTINGS_ACCESS: { severity: 'warn', push: true },
  HUB_UNREACHABLE: { severity: 'info', push: false },
  TIME_RESYNCED: { severity: 'info', push: false },
  LOG_INTEGRITY_FAIL: { severity: 'crit', push: true },
};

export function isEventType(s: string): s is EventType {
  return Object.prototype.hasOwnProperty.call(META, s);
}

export function severityOf(type: EventType): Severity {
  return META[type].severity;
}

export function shouldPush(type: EventType): boolean {
  return META[type].push;
}
