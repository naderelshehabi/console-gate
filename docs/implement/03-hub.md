# 03 — Hub (required, Docker)

The Hub is the authoritative authority and the only always-on component. It runs as a Docker container on the user's existing always-on Windows and/or Mac machine.

> **Implementation status (Phases 1 & 2 complete).** The Hub is built in **Node.js 22 + TypeScript** (run via `tsx`, no build step) under [`/hub`](../../hub). Deviations from this design doc, all deliberate and documented:
> - **Language:** Node/TS instead of Go (Go unavailable in the target environment; the plan permits Node/TS). API contract unchanged.
> - **Storage:** an atomic file-backed `Store` (single `state.json` + signed `events.jsonl`) behind a `Store` interface, instead of SQLite — keeps the Hub dependency-free; SQLite is a drop-in future swap. Schema/entities are exactly as in §3.4 / [08](08-protocol-api.md).
> - **PIN KDF:** Node built-in **scrypt** instead of Argon2id (isolated to `auth/pin.ts`).
> - **Ports:** HTTP `8088`, UDP discovery `8099` (configurable).
> - **Discovery:** UDP-broadcast responder implemented; mDNS advertiser is Phase 5.
> - **Done now:** signed event log + analytics rollup (§3.6), **WebSocket live fan-out** (§2.2, `WS /stream`), and the **Web UI** (§6, served from `hub/web/`). **Push (§3.7)** remains a later phase (the event taxonomy already marks push-priority events).
> See [`hub/README.md`](../../hub/README.md) and [14](14-implementation-checklist.md) Phases 1–2.

## 3.1 Responsibilities

1. **Time authority** — maintain authoritative wall-clock time; sync from internet NTP/SNTP when reachable; expose a **local refresh API** to force a resync; serve time to agents.
2. **Policy store** — weekly schedule (per-day windows + daily quota), per-console overrides, bonus grants, lock/pause flags, enforcement mode (soft/hard), warning thresholds.
3. **State store** — remaining quota per console/day, high-water-mark time, session state, last heartbeat.
4. **Event bus + signed log** — ingest events from agents and itself; sign and append; fan out to clients; dispatch push.
5. **APIs** — REST + WebSocket for agents, Web UI, and Android ([08](08-protocol-api.md)).
6. **Web UI** — served on the same host ([06](06-web-interface.md)).
7. **Discovery** — advertise `_consolegate._tcp` via mDNS; answer UDP broadcast probes.
8. **Pairing & auth** — device pairing, token issuance, parent-PIN verification.

## 3.2 Process/module layout

```
hub/
  cmd/consolegate-hub/        # main: config, wiring, graceful shutdown
  internal/timeauth/          # NTP client, monotonic anchor, /time/refresh
  internal/policy/            # schedule model, effective-state evaluation
  internal/state/             # quota counters, high-water-mark, sessions (SQLite)
  internal/events/            # taxonomy, signing, append-only JSONL, fan-out
  internal/push/              # FCM + ntfy/UnifiedPush adapters
  internal/api/               # REST handlers + WebSocket hub
  internal/discovery/         # mDNS advertiser + UDP responder
  internal/auth/              # pairing, device tokens, PIN (Argon2id)
  web/                        # Web UI assets/templates
  Dockerfile
  docker-compose.yml
```

Language: **Go** is the recommended default (single static binary, trivial multi-arch Docker for amd64 Win/Mac + arm64, solid stdlib for HTTP/crypto, mature NTP and mDNS libraries). Node/TypeScript is an acceptable alternative if the team prefers JS across the stack; the API contract in [08](08-protocol-api.md) is language-neutral.

## 3.3 Time authority

- **Sync sources, in priority order:** (1) configured internet NTP pool (e.g. `pool.ntp.org`) via SNTP; (2) the host OS clock (the Docker host is itself kept accurate by the OS). The Hub records `last_sync_at`, `source`, and estimated `offset`/`drift`.
- **Monotonic anchor:** the Hub tracks `authoritative_time = last_synced_utc + (host_monotonic_now - host_monotonic_at_sync)` so a host wall-clock glitch doesn't corrupt served time between syncs.
- **Local refresh API:** `POST /api/v1/time/refresh` forces an immediate NTP resync (the user explicitly wanted a local way to refresh time). Returns the new authoritative time + source. Also auto-refreshes on a schedule (default every 60 min) and on container start.
- **Served to agents:** `GET /api/v1/time` → `{utc_ms, mono_token, trust:"ntp"|"host"|"degraded"}`. `mono_token` lets the agent detect Hub restarts. If neither NTP nor a confidently-set host clock is available, `trust:"degraded"` and the Hub flags it — agents treat degraded time conservatively but the Hub clock is still far more trustworthy than a console's.

## 3.4 Policy / schedule model

Stored in SQLite; see full schema in [08](08-protocol-api.md) §8.5. Core entities:

- **Console** `{id, kind: xbox360|wii, name, pairing, last_seen, agent_version}`
- **Schedule** — per console (or shared default). For each weekday: an ordered list of **allowed windows** `[{start:"15:30", end:"19:00"}, …]` and a **daily quota** in minutes. Empty windows = blocked all day.
- **Bonus grant** `{console_id, minutes, date, granted_by, expires}` — adds to today's quota; auto-expires at the day boundary.
- **Flags** `{lock_now, paused, enforcement_mode: soft|hard, warn_thresholds:[60,30,15,5], grace_seconds}`.
- **Day boundary / timezone** — configured on the Hub (single home timezone); quota resets at local midnight by authoritative time.

**Effective-state evaluation** (`internal/policy`): given `(console, authoritative_time, quota_state, flags)`, return one of `ALLOWED / WARNING / GRACE / LOCKED` plus `reason`, `seconds_to_next_boundary`, and `quota_remaining`. This is the single function both the poll endpoint and the Web UI dashboard call, so console and UI never disagree.

## 3.5 State & quota

- `quota_state(console_id, date)` = `{quota_total, minutes_used, high_water_utc, updated_at}`.
- `minutes_used` is incremented from agent-reported **elapsed-play deltas** (monotonic-derived, clock-independent — see [09](09-time-and-tamper.md)), not from wall-clock subtraction.
- `high_water_utc` is the max authoritative time the console has acknowledged; a console reporting a local time below this is flagged `CLOCK_TAMPER_SUSPECTED`.
- Quota auto-resets at the configured local midnight; bonus grants for past days expire.

## 3.6 Event bus, signing, log

- Every event ([08](08-protocol-api.md) §8.7) is appended to `events.jsonl` with a per-record HMAC (key derived from a Hub master secret) and a hash-chain field (`prev_hash`) so deletions/edits are detectable. This is the tamper-evidence backbone.
- On append, the event is (a) fanned out to all connected WebSocket clients, and (b) if `push: true`, queued to the push dispatcher.
- Retention: configurable (default 365 days); a daily rollup table powers dashboard analytics without scanning the full log.

## 3.7 Push notifications

The user requires Android push for events (especially `PLAY_BEYOND_DOWNTIME`). Two adapters, pick at deploy time:

- **FCM (Firebase Cloud Messaging)** — most reliable background delivery, works when the phone is **off the LAN** (parent at work). Requires a Google project + internet. The Android app registers its FCM token with the Hub at pairing.
- **Self-hosted ntfy / UnifiedPush** — privacy-friendly, no Google dependency, but for off-LAN delivery needs the ntfy server reachable from the internet (or accept LAN-only push). Good default for users who don't want cloud.

When the Android app is foregrounded and on-LAN, real-time delivery is via the WebSocket; push is the background/off-LAN path. The dispatcher dedupes so the parent doesn't get both.

## 3.8 Deployment

- **Image:** multi-arch (`linux/amd64`, `linux/arm64`). On Windows runs under Docker Desktop (WSL2 backend); on macOS under Docker Desktop. Host networking or an explicit published-port + an mDNS reflector — note Docker Desktop on Win/Mac does **not** pass host mDNS into the default bridge, so the Hub must either run with the mDNS advertiser bound to the LAN interface via `--network host` (Linux) or use a host-side helper / published UDP 5353 (Win/Mac). This is a flagged integration risk ([12](12-risks-open-questions.md) R-07).
- **Persistence:** a mounted volume holds SQLite db, `events.jsonl`, keys, and config.
- **Config:** `consolegate.yml` (timezone, NTP pool, push backend + creds, web port, TLS cert path, retention).
- **Standby (optional):** the second always-on machine runs a read-only replica that tails the primary's signed log + policy snapshots; if the primary is down, agents that fail over to it still get correct *read* policy and time (writes/grants queue until the primary returns). Keeps "Hub required" from being a single point of total failure.

## 3.9 Backup & recovery

- Nightly export of SQLite + a sealed copy of `events.jsonl` to the host filesystem (and optionally the second machine).
- The parent secret and signing key are stored only in the mounted volume (never in the image); losing them requires re-pairing devices and re-setting the PIN.

## 3.10 Acceptance criteria

- Serves authoritative time within ±1s of NTP; `/time/refresh` resyncs on demand.
- Evaluates effective state identically for the poll endpoint and the Web UI.
- Appends, signs, and hash-chains events; a tampered/deleted log line is detectable by a verify command.
- Advertises via mDNS and is discoverable by the Android app and both agents on a flat LAN.
- Delivers a `PLAY_BEYOND_DOWNTIME` push to the Android app within seconds (FCM) or per ntfy latency.
- Survives container restart with no state loss; standby serves reads when primary is down.
</content>
