/**
 * Injectable clock sources so time logic is deterministically testable.
 * `wallNow` is the host wall clock (Date.now); `monoNow` is a monotonic
 * millisecond counter that never goes backwards (performance.now based).
 */
export interface ClockSource {
  wallNow(): number; // epoch ms (host wall clock)
  monoNow(): number; // monotonic ms (arbitrary origin, never decreases)
}

import { performance } from 'node:perf_hooks';

export const systemClock: ClockSource = {
  wallNow: () => Date.now(),
  monoNow: () => performance.now(),
};

/** A controllable clock for tests. */
export class FakeClock implements ClockSource {
  private wall: number;
  private mono: number;
  constructor(wall = 1_700_000_000_000, mono = 1_000_000) {
    this.wall = wall;
    this.mono = mono;
  }
  wallNow(): number {
    return this.wall;
  }
  monoNow(): number {
    return this.mono;
  }
  /** Advance both wall and monotonic clocks by the same delta (normal passage of time). */
  advance(ms: number): void {
    this.wall += ms;
    this.mono += ms;
  }
  /** Move only the wall clock (simulate a user changing the system clock); mono is unaffected. */
  setWall(ms: number): void {
    this.wall = ms;
  }
  /** Advance only the monotonic clock. */
  advanceMono(ms: number): void {
    this.mono += ms;
  }
}
