import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { DEFAULT_CONFIG, type HubConfig } from './config';
import { Hub } from './hub';
import { FakeClock } from './time/clock';
import { createServer } from './api/server';
import { setLogLevel } from './logger';
import type { SntpResult } from './time/sntp';

setLogLevel('error');

export interface TestClientResponse {
  status: number;
  json: any;
}

export interface TestHarness {
  hub: Hub;
  clock: FakeClock;
  baseUrl: string;
  server: Server;
  dataDir: string;
  request(
    method: string,
    path: string,
    opts?: { body?: unknown; token?: string; pin?: string; pinSession?: string },
  ): Promise<TestClientResponse>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  wall?: number;
  mono?: number;
  tz?: string;
  sntpQuery?: (server: string) => Promise<SntpResult>;
}

/** Wednesday 2024-01-03 10:00:00 UTC — inside the default 08:00–21:00 window. */
export const WED_1000_UTC = Date.UTC(2024, 0, 3, 10, 0, 0);

export async function makeHarness(opts: HarnessOptions = {}): Promise<TestHarness> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cg-hub-'));
  const config: HubConfig = {
    ...DEFAULT_CONFIG,
    dataDir,
    tz: opts.tz ?? 'UTC',
    ntpPool: [],
    port: 0,
    discoveryPort: 0,
    logLevel: 'error',
  };
  const clock = new FakeClock(opts.wall ?? WED_1000_UTC, opts.mono ?? 1_000_000);
  const hub = new Hub({ config, clock, sntpQuery: opts.sntpQuery });
  const server = createServer(hub);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function request(
    method: string,
    path: string,
    o: { body?: unknown; token?: string; pin?: string; pinSession?: string } = {},
  ): Promise<TestClientResponse> {
    const headers: Record<string, string> = {};
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.token) headers['authorization'] = `Bearer ${o.token}`;
    if (o.pin) headers['x-parent-pin'] = o.pin;
    if (o.pinSession) headers['x-pin-session'] = o.pinSession;
    const res = await fetch(baseUrl + path, {
      method,
      headers,
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    let json: any = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    return { status: res.status, json };
  }

  return {
    hub,
    clock,
    baseUrl,
    server,
    dataDir,
    request,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      hub.stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Pair an agent and return its token + consoleId, setting the PIN first. */
export async function pairAgent(
  h: TestHarness,
  pin = '4242',
  kind: 'xbox360' | 'wii' = 'xbox360',
): Promise<{ token: string; consoleId: string }> {
  await h.request('POST', '/api/v1/setup/pin', { body: { pin } });
  const start = await h.request('POST', '/api/v1/pair/start', { body: {}, pin });
  const code = start.json.code as string;
  const claim = await h.request('POST', '/api/v1/pair/claim', {
    body: { code, deviceKind: 'agent', deviceName: 'test-agent', consoleKind: kind, consoleName: 'Test Console' },
  });
  return { token: claim.json.deviceToken, consoleId: claim.json.console.id };
}
