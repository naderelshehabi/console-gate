import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, resolve, extname } from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Serve a static asset from `webDir`, guarding against path traversal.
 * Returns true if a file was sent, false if not found (caller then 404s).
 */
export function serveStatic(webDir: string, urlPath: string, res: ServerResponse): boolean {
  const rel = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const safe = normalize(rel).replace(/^(\.\.([/\\]|$))+/, '');
  const full = join(webDir, safe);
  const root = resolve(webDir);
  if (!resolve(full).startsWith(root)) return false; // traversal attempt
  if (!existsSync(full) || !statSync(full).isFile()) return false;
  const ext = extname(full).toLowerCase();
  res.writeHead(200, { 'content-type': TYPES[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(full));
  return true;
}
