import type { Server, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Hub } from '../hub';
import { log } from '../logger';

export const STREAM_PATH = '/api/v1/stream';

/**
 * Attach the live WebSocket stream to the HTTP server. Controllers connect to
 * `/api/v1/stream?token=<deviceToken>` and receive a `hello` frame, then every
 * `event` (from the signed log) and `console_state_changed` (`state`) message.
 * One-way server→client; control still flows over REST.
 */
export function attachWebSocket(server: Server, hub: Hub): { close(): void } {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (url.pathname !== STREAM_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const token = url.searchParams.get('token') ?? undefined;
    const device = hub.auth.authenticate(token);
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const send = (obj: unknown) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };
    send({ kind: 'hello', serverTime: hub.time.now() });
    const unsubscribe = hub.bus.subscribe((msg) => send(msg));

    // Keepalive: drop dead connections so subscribers don't leak.
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch {
        /* ignore */
      }
    }, 30_000);
    if (typeof ping.unref === 'function') ping.unref();

    ws.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
    ws.on('error', (err) => log.warn('ws error', { err: String(err) }));
  });

  return {
    close: () => {
      for (const client of wss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      wss.close();
    },
  };
}
