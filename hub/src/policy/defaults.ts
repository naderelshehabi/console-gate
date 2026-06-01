import type { Flags } from '../types';

export function defaultFlags(consoleId: string): Flags {
  return {
    consoleId,
    lockNow: false,
    paused: false,
    enforcement: 'hard',
    warnThresholdsMin: [60, 30, 15, 5],
    graceSeconds: 60,
    wiiMinSessionMin: 10,
    wiiBlockUnfinishable: false,
  };
}
