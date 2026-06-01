import { createServer as createHttpServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Router, readBody, HttpError, type Ctx } from './http';
import { registerRoutes, statusForError } from './routes';
import { attachWebSocket } from './ws';
import { serveStatic } from './static';
import type { Hub } from '../hub';
import { log } from '../logger';

const WEB_DIR = fileURLToPath(new URL('../../web', import.meta.url));

/** Build an http.Server bound to the Hub's routes, live WebSocket, and Web UI. */
export function createServer(hub: Hub): Server {
  const router = new Router();
  registerRoutes(router, hub);

  const server = createHttpServer((req, res) => {
    void handle(req, res, router, hub);
  });
  const ws = attachWebSocket(server, hub);
  server.on('close', () => ws.close());
  return server;
}

async function handle(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  router: Router,
  hub: Hub,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  const ctx: Ctx = {
    req,
    res,
    method,
    path: url.pathname,
    params: {},
    query: url.searchParams,
    body: undefined,
    header: (name) => {
      const v = req.headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
    json: (status, obj) => {
      const payload = JSON.stringify(obj);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(payload);
    },
  };

  try {
    const matched = router.match(method, url.pathname);
    if (!matched) {
      // Non-API GET requests fall through to the Web UI static assets.
      if (method === 'GET' && !url.pathname.startsWith('/api/') && serveStatic(WEB_DIR, url.pathname, res)) {
        return;
      }
      throw new HttpError(404, 'not found');
    }
    ctx.params = matched.params;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      ctx.body = await readBody(req);
    }
    await matched.handler(ctx);
  } catch (err) {
    const { status, message } = statusForError(err);
    if (status >= 500) log.error('request failed', { method, path: url.pathname, err: String(err) });
    if (!res.headersSent) {
      ctx.json(status, { error: message });
    } else {
      res.end();
    }
  }
}
