# 08 — Protocol, API & Data Models

Language-neutral contract shared by the Hub, both console agents, the Web UI, and the Android app. Base path `/(api/v1)`. JSON over HTTPS (or HMAC-signed plaintext on constrained consoles — §8.4). Times are UTC epoch milliseconds unless noted.

## 8.1 Roles

- **Agent** (console): polls for time/policy/commands, posts heartbeats/events, decrements quota.
- **Controller** (Web/Android): reads dashboards, issues PIN-gated commands.
- **Hub:** authority for all of the above.

## 8.2 Discovery records

- mDNS service: `_consolegate._tcp.local`, instance `ConsoleGate Hub`. TXT: `v=1`, `hubId=<uuid>`, `api=/api/v1`, `port=<n>`, `tls=1|0`.
- UDP probe: client → subnet broadcast `:<discovery_port>` payload `CG_DISCOVER?v1`; Hub → unicast `{hubId, host, port, tls}`.

## 8.3 Pairing & auth

- `POST /pair/start` (from Web UI, PIN-authenticated) → `{pair_code, expires}`. Hub shows code/QR.
- Device calls `POST /pair/claim {pair_code, device_kind, device_name, push_token?}` → `{device_id, device_token}`. Token is long-lived; stored securely on the device.
- All subsequent calls send `Authorization: Bearer <device_token>`.
- **Parent PIN:** privileged controller actions include `X-Parent-PIN` (or a short-lived `pin_session` obtained via `POST /pin/verify`). PIN stored only on the Hub as Argon2id hash. Agents never hold the PIN; they verify unlocks via `POST /unlock/verify`.

## 8.4 Transport security

- Default: HTTPS, Hub self-signed CA; clients pin the cert fingerprint captured at pairing.
- Constrained-console fallback (§10.6): plaintext JSON with `X-CG-Sig: HMAC-SHA256(device_key, method|path|body|nonce|ts)` and replay protection (`nonce`, `ts` within skew of authoritative time). Used only on the trusted LAN.

## 8.5 Data models (SQLite + JSONL)

```jsonc
Console      { id, kind:"xbox360"|"wii", name, paired_at, last_seen, agent_version, fw_notes }
Schedule     { console_id|null /*null=default*/,
               days:{ mon:{ windows:[{start:"HH:MM",end:"HH:MM"}], quota_min:120 }, ... },
               tz, updated_at, updated_by }
Flags        { console_id, lock_now:bool, paused:bool, enforcement:"soft"|"hard",
               warn_thresholds_min:[60,30,15,5], grace_seconds:60,
               wii_min_session_min:10, wii_block_unfinishable:bool }
Grant        { id, console_id, minutes, date, granted_by, created_at, expires }
QuotaState   { console_id, date, quota_total_min, minutes_used, high_water_utc, updated_at }
Session      { id, console_id, started_utc, ended_utc|null, title_id|null,
               expected_return_by|null, source:"360-live"|"wii-gate" }
Event        { id, ts, console_id|null, type, severity, push:bool, data{}, prev_hash, hmac }
Device       { id, kind:"agent"|"web"|"android", name, push_token|null, last_seen }
TimeStatus   { utc_ms, source:"ntp"|"host"|"degraded", last_sync, offset_ms, mono_token }
```

## 8.6 Agent endpoints

- `GET /hello` → `{hubId, server_time:TimeStatus, your_console}` (liveness + clock check).
- `POST /agent/poll`
  ```jsonc
  // request
  { console_id, local_utc_guess, mono_ticks, minutes_used_delta,
    state, current_title_id?, agent_version }
  // response
  { authoritative:TimeStatus,
    effective:{ state:"ALLOWED|WARNING|GRACE|LOCKED", reason,
                seconds_to_next_boundary, quota_remaining_min,
                warn_thresholds_min, grace_seconds, enforcement },
    commands:[ {id, type:"LOCK_NOW|UNLOCK|GRANT_BONUS|PAUSE|RESUME|RESYNC", args, nonce} ] }
  ```
  Poll interval: default 20–30s (ALLOWED), tighter (5–10s) in WARNING/GRACE.
- `POST /agent/heartbeat { console_id, mono_ticks, state, powered:true }` — lightweight liveness between polls; absence drives `AGENT_OFFLINE`.
- `POST /agent/session/start { console_id, title_id?, expected_return_by? }` → `{session_id}` (Wii gate sets `expected_return_by`).
- `POST /agent/session/end { session_id, elapsed_min, overage_min? }` — decrements quota; if overage, Hub emits `PLAY_BEYOND_DOWNTIME`.
- `POST /agent/events [Event...]` — buffered events flushed from the agent (warnings shown, interruptions, tamper signals).
- `POST /agent/command/ack { command_id }`.

## 8.7 Event taxonomy

| type | severity | push | emitted by | meaning |
|---|---|---|---|---|
| `SESSION_START` / `SESSION_END` | info | no | agent | play session boundaries |
| `WARNING_SHOWN` | info | no | agent (360) | a pre-cutoff warning was displayed |
| `GRACE_STARTED` | info | no | agent (360) | save-countdown began |
| `DOWNTIME_ENFORCED` | info | no | agent/hub | console locked at boundary |
| `QUOTA_EXHAUSTED` | info | no | hub | daily budget hit zero |
| `PLAY_INTERRUPTED` | warn | no | agent (360) | a running game was force-closed |
| **`PLAY_BEYOND_DOWNTIME`** | **warn** | **yes** | agent/hub | played past downtime/quota (360 soft-mode; Wii overrun) |
| `MORE_TIME_REQUESTED` | info | yes | agent | child requested an extension |
| `BONUS_GRANTED` / `EXTENDED_TODAY` | info | no | hub | parent granted time |
| `LOCKED_BY_PARENT` / `UNLOCKED` / `PAUSED` / `RESUMED` | info | no | hub | manual control |
| **`AGENT_OFFLINE`** | **warn** | **yes** | hub | heartbeat gap while not cleanly powered off |
| `CONSOLE_POWERED_DURING_LOCK` | warn | yes | hub/agent | console active while it should be locked |
| **`CLOCK_TAMPER_SUSPECTED`** | **warn** | **yes** | agent/hub | local clock < high-water or default-reset |
| `PRIILOADER_ACCESS` / `SETTINGS_ACCESS` | warn | yes | agent (wii) | tamper-evidence: protected menu entered |
| `HUB_UNREACHABLE` | info | no | agent | agent entered fail-closed cache mode |
| `TIME_RESYNCED` | info | no | hub | NTP/local refresh occurred |
| `LOG_INTEGRITY_FAIL` | crit | yes | hub | event hash-chain broke (log tampered) |

Per the user's requirement, events are written to the signed log, fanned out over WebSocket to all connected clients, and (where `push:true`) delivered to Android — i.e. logged to **all components** and notified.

## 8.8 Controller endpoints

- `GET /consoles` , `GET /consoles/{id}` (state via the same evaluator as the agent poll).
- `GET /schedule/{console_id}` , `PUT /schedule/{console_id}` (PIN).
- `GET /flags/{console_id}` , `PUT /flags/{console_id}` (PIN).
- `POST /consoles/{id}/grant {minutes}` , `/extend-today` , `/lock` , `/unlock` , `/pause` , `/resume` (PIN).
- `GET /requests` , `POST /requests/{id}/approve|deny` (PIN).
- `GET /events?since=&type=&console_id=` , `GET /analytics/summary?range=`.
- `GET /time` , `POST /time/refresh` (PIN) — the local time-refresh API.
- `GET /system/verify-log` (PIN) — re-verify the hash chain.
- `WS /stream` — server pushes `{event}` and `{console_state_changed}` to controllers.

## 8.9 Effective-state evaluation (authoritative, Hub-side)

Single function used by `/agent/poll` and all controller reads:

```
evaluate(console, now, quota_state, flags, schedule) ->
  if flags.lock_now or flags.paused            -> LOCKED(reason)
  if untrusted_time(console, now)              -> LOCKED("cant-verify-time")   // fail-closed
  win = current_window(schedule, now)
  if not win                                   -> LOCKED("outside-window")
  rem = quota_state.quota_total - quota_state.minutes_used
  if rem <= 0                                   -> LOCKED("quota-exhausted")
  secs = seconds_to_min(window_end(win), quota_end(rem))
  if secs <= grace_seconds                      -> GRACE(secs)
  if secs <= max(warn_thresholds)*60            -> WARNING(secs)
  else                                          -> ALLOWED(secs, rem)
```

`untrusted_time` is true when the agent's reported `local_utc_guess` < `high_water_utc`, the console reports a default/post-unplug clock, or (agent-local) the Hub has been unreachable past the grace window. Detail in [09](09-time-and-tamper.md).

## 8.10 Versioning

`v=1` in mDNS TXT and `/hello`. Agents and apps check Hub `api` version and warn on mismatch; the Hub supports the previous minor for rolling upgrades.
</content>
