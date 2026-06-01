/**
 * Shared domain types for the ConsoleGate Hub.
 * Mirrors the data models in docs/implement/08-protocol-api.md §8.5.
 * All timestamps are UTC epoch milliseconds (number) unless the field name says otherwise.
 */

export type ConsoleKind = 'xbox360' | 'wii';
export type DeviceKind = 'agent' | 'web' | 'android';
export type EnforcementMode = 'soft' | 'hard';
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** A console managed by the Hub. */
export interface Console {
  id: string;
  kind: ConsoleKind;
  name: string;
  pairedAt: number;
  lastSeen: number | null;
  agentVersion: string | null;
  fwNotes: string | null;
}

/** An allowed time-of-day window, local to the Hub timezone. "HH:MM" 24h. */
export interface Window {
  start: string; // inclusive, "HH:MM"
  end: string;   // exclusive, "HH:MM"
}

export interface DaySchedule {
  windows: Window[];
  quotaMin: number; // daily play-time budget in minutes
}

/** Weekly schedule. consoleId === null is the shared default schedule. */
export interface Schedule {
  consoleId: string | null;
  days: Record<Weekday, DaySchedule>;
  tz: string;
  updatedAt: number;
  updatedBy: string | null;
}

export interface Flags {
  consoleId: string;
  lockNow: boolean;
  paused: boolean;
  enforcement: EnforcementMode;
  warnThresholdsMin: number[]; // e.g. [60, 30, 15, 5]
  graceSeconds: number;
  wiiMinSessionMin: number;     // won't-finish guard floor (Wii)
  wiiBlockUnfinishable: boolean;
}

export interface Grant {
  id: string;
  consoleId: string;
  minutes: number;
  date: string;       // local date key YYYY-MM-DD the grant applies to
  grantedBy: string;
  createdAt: number;
  expires: number;    // epoch ms; auto-expires at day boundary
}

export interface QuotaState {
  consoleId: string;
  date: string;            // local date key YYYY-MM-DD
  quotaTotalMin: number;   // base daily quota + active grants for the day
  minutesUsed: number;     // accumulated from monotonic deltas (clock-independent)
  highWaterUtc: number;    // max authoritative time acknowledged for this console
  updatedAt: number;
}

export type SessionSource = '360-live' | 'wii-gate';

export interface Session {
  id: string;
  consoleId: string;
  startedUtc: number;
  endedUtc: number | null;
  titleId: string | null;
  expectedReturnBy: number | null;
  source: SessionSource;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  consoleId: string | null;   // set for agent devices
  tokenHash: string;          // sha256 of the issued device token
  pushToken: string | null;
  pairedAt: number;
  lastSeen: number | null;
}

export type TimeSource = 'ntp' | 'host' | 'degraded';

export interface TimeStatus {
  utcMs: number;
  source: TimeSource;
  lastSync: number | null;
  offsetMs: number;     // estimated (ntpTime - hostTime) at last sync
  monoToken: string;    // changes when the Hub restarts; lets agents detect restarts
}

/** A queued command for an agent, delivered via /agent/poll and removed on ack. */
export type CommandType =
  | 'LOCK_NOW'
  | 'UNLOCK'
  | 'GRANT_BONUS'
  | 'PAUSE'
  | 'RESUME'
  | 'RESYNC';

export interface Command {
  id: string;
  consoleId: string;
  type: CommandType;
  args: Record<string, unknown>;
  nonce: string;
  ts: number;
}

export type RequestStatus = 'pending' | 'approved' | 'denied';

/** A child-initiated "more time" request from a console. */
export interface MoreTimeRequest {
  id: string;
  consoleId: string;
  minutes: number;       // requested amount
  reason: string | null;
  status: RequestStatus;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
}

/** Stored parent-PIN verifier (scrypt). */
export interface PinRecord {
  salt: string;       // base64
  hash: string;       // base64
  N: number;
  r: number;
  p: number;
  keylen: number;
  updatedAt: number;
}

export type EffectiveStateKind = 'ALLOWED' | 'WARNING' | 'GRACE' | 'LOCKED';

export interface EffectiveState {
  state: EffectiveStateKind;
  reason: string;
  secondsToNextBoundary: number; // seconds until the next state-changing boundary (clamped >= 0)
  quotaRemainingMin: number;
  warnThresholdsMin: number[];
  graceSeconds: number;
  enforcement: EnforcementMode;
}
