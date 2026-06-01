import type { EventRecord } from './log';
import type { EffectiveState } from '../types';

/** Messages broadcast to connected controller clients over the WebSocket stream. */
export type StreamMessage =
  | { kind: 'hello'; serverTime: number }
  | { kind: 'event'; event: EventRecord }
  | { kind: 'state'; consoleId: string; effective: EffectiveState };

export type StreamSubscriber = (msg: StreamMessage) => void;

/**
 * In-process pub/sub for the live stream. The Hub publishes event records (from
 * the signed log) and console state-change notifications here; the WebSocket
 * layer subscribes and fans them out to browsers / the Android app.
 */
export class StreamBus {
  private subscribers = new Set<StreamSubscriber>();

  publish(msg: StreamMessage): void {
    for (const sub of this.subscribers) {
      try {
        sub(msg);
      } catch {
        /* a slow/broken subscriber never affects publishing */
      }
    }
  }

  subscribe(fn: StreamSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  get size(): number {
    return this.subscribers.size;
  }
}
