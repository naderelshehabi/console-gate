# ConsoleGate Hub

The authoritative authority for the ConsoleGate parental-control system: holds
the trusted clock, the weekly schedule, quota state, and a signed event log;
serves the REST API consumed by the console agents, the Web UI, and the Android
app; and answers LAN discovery probes.

See the design docs in [`../docs/implement`](../docs/implement). This package
implements **Phase 1 — Hub Core** and **Phase 2 — Event System, live WebSocket
fan-out & Web UI** of
[`../docs/implement/14-implementation-checklist.md`](../docs/implement/14-implementation-checklist.md).

Open `http://<host>:8088/` in a browser for the Web UI (set a parent PIN on first
run, then log in): live dashboard, schedule editor, quick actions, requests,
events timeline, and a system/analytics panel.

## Stack

- **Node.js 22 + TypeScript**, run directly with `tsx` (no build step needed).
  The plan named Go as the default and sanctioned Node/TS as an acceptable
  alternative; Node is the toolchain available in the target environment, and the
  Android app shares the JVM/Kotlin world.
- **Zero native dependencies.** Storage is a small atomic file-backed store
  behind a `Store` interface (SQLite can be swapped in later); crypto uses Node's
  built-in `scrypt`/`hmac`; time sync is a built-in `dgram` SNTP client; tests use
  the built-in `node:test` runner. Runtime dependencies: `zod` (validation) and
  `ws` (WebSocket server; pure JS). The Web UI is dependency-free vanilla JS.

## Run

```bash
npm install
npm start                 # listens on :8088 (configurable)
```

Configuration: copy `consolegate.example.yml` to `consolegate.yml`, or use
`CG_*` environment variables (see the example file). Key env vars:
`CG_PORT`, `CG_TZ`, `CG_DATA_DIR`, `CG_NTP_POOL`, `CG_LOG_LEVEL`.

State is written under `dataDir` (`./data` by default): `state.json`,
`events.jsonl` (the signed log), and `hub.secret`.

### Docker

```bash
docker compose up -d      # see docker-compose.yml for the discovery caveat on Win/Mac
```

## Test

```bash
npm test                  # 80 unit + integration tests (node:test)
npm run typecheck         # tsc --noEmit
```

`src/api/api.test.ts` is the end-to-end suite that automates **GATE 1**
(authoritative time, ALLOWED→WARNING→GRACE→LOCKED, monotonic quota, clock-rollback
lockout, bonus grants, parent lock/unlock).

## Mock agent

A CLI that emulates a console agent end-to-end (pair → poll → print state), used
to exercise the Hub by hand. Invoke with `tsx` directly (npm mangles `--` flags):

```bash
npx tsx mock-agent/mockAgent.ts --url http://127.0.0.1:8088 --pin 4242 \
  --kind xbox360 --name "Den 360" --consume 5 --interval 2000
npx tsx mock-agent/mockAgent.ts --rollback-hours 3      # simulate a backward clock jump
```

## Layout

```
src/
  config.ts          # config loader (yaml/json/env)
  hub.ts             # composition root wiring all services
  index.ts           # entrypoint: server + discovery + graceful shutdown
  types.ts           # shared domain types
  time/              # ClockSource, SNTP client, TimeAuthority (monotonic anchor)
  store/             # Store interface + atomic file-backed implementation
  policy/            # schedule math, effective-state evaluator, transitions, control
  quota/             # monotonic, clock-independent quota accounting
  auth/              # scrypt PIN, device tokens, pairing, lockout, web login
  events/            # taxonomy + signed hash-chained append log + StreamBus
  analytics/         # on-read play/incident rollups
  api/               # router, routes, http server, WebSocket stream, static serving
  discovery/         # UDP-broadcast discovery responder
web/                 # Web UI (vanilla JS, served by the Hub)
mock-agent/          # CLI console-agent emulator
```

## API surface (v1)

`/api/v1` — `hello`, `time`, `time/refresh`, `setup`, `setup/pin`, `pin/verify`,
`pair/start`, `pair/claim`, `agent/{poll,heartbeat,session/start,session/end,events,command/ack}`,
`unlock/verify`, `consoles`, `consoles/:id`, `schedule/:id`, `flags/:id`,
`consoles/:id/{grant,extend-today,lock,unlock,pause,resume,request-time}`,
`requests`, `requests/:id/{approve,deny}`, `events`, `analytics/summary`,
`system/verify-log`. Full contract: [`../docs/implement/08-protocol-api.md`](../docs/implement/08-protocol-api.md).
</content>
