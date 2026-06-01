import dgram from 'node:dgram';
import type { HubConfig } from '../config';
import { log } from '../logger';

export const DISCOVERY_MAGIC = 'CG_DISCOVER?v1';

export interface DiscoveryHandle {
  stop(): void;
  /** Resolves with the actually-bound UDP port (useful when discoveryPort=0). */
  ready: Promise<number>;
}

/**
 * UDP-broadcast discovery responder. Clients (Android app, console agents) send
 * a `CG_DISCOVER?v1` datagram to the subnet broadcast on `discoveryPort`; the Hub
 * replies with its connection info. This is the reliable primary discovery path
 * on home networks (mDNS is added in Phase 5 and can fail across the Docker bridge
 * — see docs/implement/12-risks-open-questions.md R-03/R-07).
 */
export function startDiscovery(config: HubConfig, hubId: string): DiscoveryHandle {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => log.warn('discovery socket error', { err: String(err) }));

  socket.on('message', (msg, rinfo) => {
    if (!msg.toString('utf8').startsWith('CG_DISCOVER?')) return;
    const reply = Buffer.from(
      JSON.stringify({ hubId, port: config.port, api: '/api/v1', v: 1, tls: false }),
    );
    socket.send(reply, rinfo.port, rinfo.address, (err) => {
      if (err) log.warn('discovery reply failed', { err: String(err) });
    });
  });

  let resolveReady: (port: number) => void;
  const ready = new Promise<number>((resolve) => {
    resolveReady = resolve;
  });

  socket.bind(config.discoveryPort, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* ignore */
    }
    const bound = socket.address().port;
    log.info('discovery responder bound', { port: bound });
    resolveReady(bound);
  });

  return {
    ready,
    stop: () => {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    },
  };
}
