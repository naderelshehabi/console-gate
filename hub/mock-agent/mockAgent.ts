/**
 * Mock console agent — a CLI test harness for the Hub (checklist 1.7).
 *
 * It performs the full agent lifecycle: ensure a PIN, pair as an agent (creating
 * a console), then poll on an interval and print the effective state. Flags let
 * you simulate play (consume quota) and clock tampering (rollback), which is how
 * GATE 1 is exercised by hand against a running Hub.
 *
 * Usage:
 *   npm run mock-agent -- --url http://127.0.0.1:8088 --pin 4242 \
 *     --kind xbox360 --name "Den 360" --consume 5 --interval 2000
 *   npm run mock-agent -- --rollback-hours 3      # simulate a backward clock jump
 */

interface Args {
  url: string;
  pin: string;
  kind: 'xbox360' | 'wii';
  name: string;
  consume: number;
  intervalMs: number;
  rollbackHours: number;
  once: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    url: 'http://127.0.0.1:8088',
    pin: '4242',
    kind: 'xbox360',
    name: 'Mock Console',
    consume: 0,
    intervalMs: 2000,
    rollbackHours: 0,
    once: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--url': a.url = v!; i++; break;
      case '--pin': a.pin = v!; i++; break;
      case '--kind': a.kind = v as Args['kind']; i++; break;
      case '--name': a.name = v!; i++; break;
      case '--consume': a.consume = Number(v); i++; break;
      case '--interval': a.intervalMs = Number(v); i++; break;
      case '--rollback-hours': a.rollbackHours = Number(v); i++; break;
      case '--once': a.once = true; break;
    }
  }
  return a;
}

async function api(url: string, path: string, opts: { method?: string; body?: unknown; token?: string; pin?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (opts.pin) headers['x-parent-pin'] = opts.pin;
  const res = await fetch(url + path, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[mock-agent] connecting to ${args.url}`);

  const setup = await api(args.url, '/api/v1/setup');
  if (!setup.pinSet) {
    await api(args.url, '/api/v1/setup/pin', { method: 'POST', body: { pin: args.pin } });
    console.log('[mock-agent] PIN configured');
  }

  const start = await api(args.url, '/api/v1/pair/start', { method: 'POST', body: {}, pin: args.pin });
  const claim = await api(args.url, '/api/v1/pair/claim', {
    method: 'POST',
    body: {
      code: start.code,
      deviceKind: 'agent',
      deviceName: args.name,
      consoleKind: args.kind,
      consoleName: args.name,
    },
  });
  const token: string = claim.deviceToken;
  console.log(`[mock-agent] paired as console ${claim.console.id} (${args.kind})`);

  const tick = async () => {
    const time = await api(args.url, '/api/v1/time');
    const localUtcGuess =
      args.rollbackHours > 0 ? time.utcMs - args.rollbackHours * 3600_000 : time.utcMs;
    const poll = await api(args.url, '/api/v1/agent/poll', {
      method: 'POST',
      token,
      body: {
        minutesUsedDelta: args.consume,
        localUtcGuess,
        agentVersion: 'mock-0.1.0',
      },
    });
    const e = poll.effective;
    console.log(
      `[mock-agent] state=${e.state} reason=${e.reason} remaining=${e.quotaRemainingMin}m ` +
        `nextBoundary=${Math.round(e.secondsToNextBoundary / 60)}m commands=${poll.commands.length}`,
    );
    for (const c of poll.commands) {
      console.log(`[mock-agent]   -> command ${c.type}; acking`);
      await api(args.url, '/api/v1/agent/command/ack', { method: 'POST', token, body: { commandId: c.id } });
    }
  };

  await tick();
  if (args.once) return;
  setInterval(() => void tick().catch((e) => console.error('[mock-agent] tick error', String(e))), args.intervalMs);
}

main().catch((e) => {
  console.error('[mock-agent] fatal', String(e));
  process.exit(1);
});
