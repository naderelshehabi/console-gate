import { readFileSync, existsSync } from 'node:fs';
import { assertValidTimezone } from './util/localtime';

/**
 * Hub configuration. Loaded from (in priority order): explicit object,
 * environment variables, then defaults. A minimal YAML/JSON file loader is
 * supported for `consolegate.yml` but env vars override file values.
 */
export interface HubConfig {
  host: string;
  port: number;
  discoveryPort: number;
  tz: string;
  ntpPool: string[];
  ntpSyncIntervalMs: number;
  dataDir: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Skew tolerance (ms) before a backwards clock report is treated as tampering. */
  clockSkewToleranceMs: number;
  /** Plausibility floor: a console clock below this is treated as a default/reset clock. */
  plausibleFloorUtc: number;
  /** Require HMAC-signed requests on agent endpoints (reject unsigned). */
  enforceAgentSigning: boolean;
  /** Allowed clock skew (ms) on a signed request's timestamp. */
  signingSkewMs: number;
  /** Agent heartbeat-gap (ms) after which the watchdog raises AGENT_OFFLINE. */
  agentOfflineMs: number;
  /** How often the watchdog scans for offline agents (ms). */
  watchdogIntervalMs: number;
  /** How often automatic backups run (ms); 0 disables. */
  backupIntervalMs: number;
}

export const DEFAULT_CONFIG: HubConfig = {
  host: '0.0.0.0',
  port: 8088,
  discoveryPort: 8099,
  tz: 'UTC',
  ntpPool: ['pool.ntp.org', 'time.cloudflare.com'],
  ntpSyncIntervalMs: 60 * 60 * 1000,
  dataDir: './data',
  logLevel: 'info',
  clockSkewToleranceMs: 2 * 60 * 1000,
  // 2023-01-01T00:00:00Z — any console clock older than this is implausible (default/reset).
  plausibleFloorUtc: 1672531200000,
  enforceAgentSigning: false,
  signingSkewMs: 5 * 60 * 1000,
  agentOfflineMs: 3 * 60 * 1000,
  watchdogIntervalMs: 30 * 1000,
  backupIntervalMs: 24 * 60 * 60 * 1000,
};

/** Extremely small YAML subset parser: `key: value` and `key:` + `- item` lists. */
function parseSimpleYaml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let currentList: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentList) {
      (out[currentList] as string[]).push(stripQuotes(listItem[1]!));
      continue;
    }
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line.trim());
    if (kv) {
      const key = kv[1]!;
      const val = kv[2]!;
      if (val === '') {
        out[key] = [];
        currentList = key;
      } else {
        currentList = null;
        out[key] = coerce(stripQuotes(val));
      }
    }
  }
  return out;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function coerce(s: string): unknown {
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

export function loadConfig(opts?: { file?: string; overrides?: Partial<HubConfig> }): HubConfig {
  const cfg: HubConfig = { ...DEFAULT_CONFIG };

  const file = opts?.file ?? process.env.CONSOLEGATE_CONFIG ?? 'consolegate.yml';
  if (file && existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const parsed = file.endsWith('.json') ? JSON.parse(text) : parseSimpleYaml(text);
    Object.assign(cfg, sanitizePartial(parsed));
  }

  // Environment overrides.
  const env = process.env;
  if (env.CG_HOST) cfg.host = env.CG_HOST;
  if (env.CG_PORT) cfg.port = parseInt(env.CG_PORT, 10);
  if (env.CG_DISCOVERY_PORT) cfg.discoveryPort = parseInt(env.CG_DISCOVERY_PORT, 10);
  if (env.CG_TZ) cfg.tz = env.CG_TZ;
  if (env.CG_NTP_POOL) cfg.ntpPool = env.CG_NTP_POOL.split(',').map((s) => s.trim()).filter(Boolean);
  if (env.CG_DATA_DIR) cfg.dataDir = env.CG_DATA_DIR;
  if (env.CG_LOG_LEVEL) cfg.logLevel = env.CG_LOG_LEVEL as HubConfig['logLevel'];
  if (env.CG_ENFORCE_SIGNING) cfg.enforceAgentSigning = env.CG_ENFORCE_SIGNING === 'true';

  if (opts?.overrides) Object.assign(cfg, opts.overrides);

  assertValidTimezone(cfg.tz);
  if (!Number.isInteger(cfg.port) || cfg.port <= 0) throw new Error(`Invalid port: ${cfg.port}`);
  return cfg;
}

function sanitizePartial(parsed: Record<string, unknown>): Partial<HubConfig> {
  const p: Partial<HubConfig> = {};
  if (typeof parsed.host === 'string') p.host = parsed.host;
  if (typeof parsed.port === 'number') p.port = parsed.port;
  if (typeof parsed.discoveryPort === 'number') p.discoveryPort = parsed.discoveryPort;
  if (typeof parsed.tz === 'string') p.tz = parsed.tz;
  if (Array.isArray(parsed.ntpPool)) p.ntpPool = parsed.ntpPool.map(String);
  if (typeof parsed.dataDir === 'string') p.dataDir = parsed.dataDir;
  if (typeof parsed.logLevel === 'string') p.logLevel = parsed.logLevel as HubConfig['logLevel'];
  if (typeof parsed.enforceAgentSigning === 'boolean') p.enforceAgentSigning = parsed.enforceAgentSigning;
  if (typeof parsed.agentOfflineMs === 'number') p.agentOfflineMs = parsed.agentOfflineMs;
  if (typeof parsed.backupIntervalMs === 'number') p.backupIntervalMs = parsed.backupIntervalMs;
  return p;
}
