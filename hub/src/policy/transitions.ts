import type { EventType } from '../events/taxonomy';
import type { EffectiveState } from '../types';

export interface StateMemo {
  state: EffectiveState['state'];
  reason: string;
}

export interface TransitionEvent {
  type: EventType;
  data: Record<string, unknown>;
}

/**
 * Pure mapping from a state transition to the events it should log. Emitted only
 * when the (state, reason) pair changes, so steady polling does not spam the log.
 * Parent-initiated locks/pauses are emitted by the control path, not here.
 */
export function transitionEvents(prev: StateMemo | undefined, next: EffectiveState): TransitionEvent[] {
  const changed = !prev || prev.state !== next.state || prev.reason !== next.reason;
  if (!changed) return [];

  switch (next.state) {
    case 'WARNING':
      return [{ type: 'WARNING_SHOWN', data: { secondsLeft: next.secondsToNextBoundary, reason: next.reason } }];
    case 'GRACE':
      return [{ type: 'GRACE_STARTED', data: { secondsLeft: next.secondsToNextBoundary } }];
    case 'LOCKED':
      switch (next.reason) {
        case 'quota-exhausted':
          return [
            { type: 'QUOTA_EXHAUSTED', data: {} },
            { type: 'DOWNTIME_ENFORCED', data: { reason: next.reason } },
          ];
        case 'outside-window':
        case 'window-end':
          return [{ type: 'DOWNTIME_ENFORCED', data: { reason: next.reason } }];
        case 'cant-verify-time':
          return [{ type: 'CLOCK_TAMPER_SUSPECTED', data: {} }];
        case 'hub-unreachable':
          return [{ type: 'HUB_UNREACHABLE', data: {} }];
        default:
          return []; // locked-by-parent / paused handled by the control path
      }
    default:
      return [];
  }
}
