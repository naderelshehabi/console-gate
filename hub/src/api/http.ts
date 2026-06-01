import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  rawBody: string; // exact request body text (for signature verification)
  header(name: string): string | undefined;
  json(status: number, obj: unknown): void;
}

type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[]; // ':name' marks a param
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method: method.toUpperCase(), segments: pattern.split('/').filter(Boolean), handler });
  }
  get(p: string, h: Handler) {
    this.add('GET', p, h);
  }
  post(p: string, h: Handler) {
    this.add('POST', p, h);
  }
  put(p: string, h: Handler) {
    this.add('PUT', p, h);
  }
  delete(p: string, h: Handler) {
    this.add('DELETE', p, h);
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = path.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const seg = route.segments[i]!;
        const val = parts[i]!;
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(val);
        else if (seg !== val) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return undefined;
  }
}

const MAX_BODY = 1024 * 1024; // 1 MiB

export interface ParsedBody {
  raw: string;
  value: unknown;
}

export function readBody(req: IncomingMessage): Promise<ParsedBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
      if (!raw.trim()) return resolve({ raw, value: undefined });
      const ct = req.headers['content-type'] ?? '';
      if (ct.includes('application/json')) {
        try {
          resolve({ raw, value: JSON.parse(raw) });
        } catch {
          reject(new HttpError(400, 'invalid JSON body'));
        }
      } else {
        resolve({ raw, value: raw });
      }
    });
    req.on('error', reject);
  });
}
