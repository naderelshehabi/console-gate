# 14 — Implementation Checklist & Testing Gateways

A granular, ordered build checklist. Every task is a checkbox. Between phases (and at key points within them) there are **GATES** — manual test procedures with explicit pass criteria that **must pass on real hardware before proceeding**. A failed gate blocks the next phase; record the failure in [12-risks-open-questions.md](12-risks-open-questions.md) and either fix or take the documented fallback.

**Legend:** `[ ]` task · **GATE** = blocking manual test · *Owner/Env* noted where it matters · "DoD" = Definition of Done.

**Conventions used by all gates:**
- Each gate has a **Procedure** (numbered steps), **Expected**, **Pass criteria**, and a **Sign-off** line (date/initials).
- "Real hardware" = an actual JTAG/RGH 360 and/or softmod Wii, not an emulator, unless stated.
- Keep a `docs/implement/test-log.md` (create in P0) and paste gate results there.

---

## Phase 0 — Foundations & De-risking Spikes

Goal: prove the three riskiest unknowns before committing to the full build. Do **not** start Phase 1 proper until GATE 0 passes or a fallback is chosen.

### 0.1 Project scaffolding
- [x] Create repo structure: `/hub` created (agent-360/agent-wii/android scaffolding deferred to their phases). Web UI lives in `/hub`.
- [x] Create `docs/implement/test-log.md` with a table: `Gate | Date | Env | Result | Notes`.
- [~] Build prerequisites documented in `hub/README.md` (root `CONTRIBUTING.md` to follow when agent/android packages land).
- [x] Decide Hub language: **Node.js 22 + TypeScript** chosen (Go unavailable in the target environment; plan explicitly permits Node/TS). Recorded in `02-architecture.md` §2.10 and `03-hub.md`.
- [x] Version pinning: mDNS/discovery service `_consolegate._tcp`, API `v1`, UDP discovery port `8099`, HTTP port `8088` (documented in `hub/consolegate.example.yml` + `08-protocol-api.md`).

> **HARDWARE-BLOCKED:** Spikes S1 (0a) and S2 (0b) require a physical JTAG/RGH Xbox 360 and a softmod Wii plus their toolchains (XDK/libxenon, devkitPPC). These cannot run in the current dev environment and are tracked as BLOCKED in `test-log.md` — not deferred by choice. S3 (0c) is partially done (UDP-broadcast responder built; full cross-platform test pending Phase 5 + hardware).

### 0.2 Spike S1 — Xbox 360 resident plugin (CRITICAL, retires R-01/R-02)
- [ ] Stand up the XDK (or libxenon) toolchain; build a "hello" XEX that runs on the target 360.
- [ ] Build a minimal Dashlaunch plugin that loads via `launch.ini [Plugins]` and logs "resident" once per second to serial/onscreen.
- [ ] Confirm the plugin's counter **keeps incrementing after a retail game is launched** (background residency during gameplay).
- [ ] Implement a trigger (e.g. a controller button combo) that calls `XLaunchNewImage(dashboard, NULL)` to force-close the running game.
- [ ] Repeat across **3+ different commercial titles** (different engines) to test generality (R-02).

> **GATE 0a — 360 residency & force-close** *(blocks Phase 4; informs Phase 0 exit)*
> **Procedure:** 1) Boot 360 with the spike plugin. 2) Launch Game A; observe the plugin counter still advancing (serial/onscreen). 3) Trigger the force-close combo. 4) Repeat for Games B and C.
> **Expected:** counter advances during all three games; trigger returns to dashboard within ~2s each time, no hang/brick.
> **Pass criteria:** residency confirmed in ≥3 titles AND force-close works in ≥3 titles.
> **If fail:** fall back to **gate-only 360** (hook the launcher, no mid-game close) — record in R-01/R-02 and adjust [04](04-console-xbox360.md) §4.8. Sign-off: ____

### 0.3 Spike S2 — Wii autoboot + LAN + chain (retires parts of B2/B3/B4)
- [ ] Build a libogc `.dol` that connects to a LAN HTTP endpoint (libogc `net_*`) and prints the response.
- [ ] Install Priiloader on the test Wii; set **Autoboot = Installed file** = the spike `.dol`.
- [ ] From the `.dol`, chain-launch USB Loader GX; set USB Loader GX **"Return To"** = the `.dol`/forwarder.
- [ ] Confirm exiting a game returns to the spike `.dol`.

> **GATE 0b — Wii boot-gate loop** *(blocks Phase 3)*
> **Procedure:** 1) Power on; confirm the Wii boots into the spike `.dol` before the System Menu. 2) `.dol` fetches from LAN endpoint and shows the value. 3) `.dol` chains to USB Loader GX; launch a game. 4) Exit the game (HOME/exit).
> **Expected:** autoboot lands in the `.dol`; LAN fetch succeeds; game launches; exiting returns to the `.dol`.
> **Pass criteria:** full loop boot→gate→LAN→game→back-to-gate works twice consecutively.
> **If fail:** investigate Return-To/cIOS config; record in R-05/R-09. Sign-off: ____

### 0.4 Spike S3 — Hub-in-Docker discovery on Win & Mac (retires R-03/R-07)
- [x] UDP-broadcast `CG_DISCOVER?v1` responder implemented (`hub/src/discovery/discovery.ts`) and bound at Hub startup (verified in the live smoke run).
- [ ] mDNS advertiser of `_consolegate._tcp` (Phase 5, needs a library).
- [ ] Run it under **Docker Desktop on Windows** and **on Mac**.
- [ ] Build a throwaway Android `NsdManager` client (MulticastLock + serialized resolve) that lists discovered services.

> **GATE 0c — Cross-platform discovery** *(blocks Phase 5; may change discovery strategy)*
> **Procedure:** 1) Start the container on Windows Docker Desktop. 2) From an Android phone on the same Wi-Fi, run mDNS discovery. 3) Repeat with the container on Mac. 4) Disable mDNS path; test UDP-broadcast discovery.
> **Expected:** the phone finds the Hub via mDNS on at least one platform; UDP-broadcast finds it on both.
> **Pass criteria:** UDP-broadcast discovery works on **both** Win and Mac; mDNS works on at least one (else mDNS becomes best-effort).
> **If fail (mDNS blocked by Docker bridge):** make **UDP-broadcast the PRIMARY** discovery method (R-03); document `--network host`/reflector options. Sign-off: ____

> ## ✅ GATE 0 — Phase 0 exit (ALL of 0a, 0b, 0c resolved with pass-or-documented-fallback)
> Do not begin Phase 1 until every spike is green or has an agreed fallback recorded in [12](12-risks-open-questions.md) and the affected component doc updated. Sign-off: ____

---

## Phase 1 — Hub Core (time + policy + state + agent API)

Goal: a running Hub that serves authoritative time and correct effective-state to a mock agent.

### 1.1 Service skeleton
- [x] HTTP server with `/api/v1` routing (`src/api`), config loader (`src/config.ts`: tz, NTP pool, ports; yaml/json/env).
- [x] Structured logging (`src/logger.ts`); graceful shutdown (`src/index.ts`); health endpoint `/api/v1/hello`.
- [x] `Dockerfile` + `docker-compose.yml` with a mounted data volume. (Multi-arch via `node:22-alpine`; mDNS-over-bridge caveat documented.)

### 1.2 Time authority
- [x] SNTP client against the configured pool (`src/time/sntp.ts`); records `lastSync`, `source`, `offset`. Verified live against `pool.ntp.org`.
- [x] Monotonic anchor: `authoritative = anchorUtc + (monoNow - anchorMono)` (`src/time/timeauth.ts`) — backward host-clock changes can't move served time (unit-tested).
- [x] `GET /api/v1/time` → `TimeStatus`; `POST /api/v1/time/refresh` forces resync (PIN-gated) + emits `TIME_RESYNCED`.
- [x] Auto-refresh timer (default 60 min) + refresh on start.
- [x] Degraded mode: pool configured but unreachable → `source:"degraded"`.

### 1.3 Data layer
- [x] Schema for `Console, Schedule, Flags, Grant, QuotaState, Session, Device, Command, MoreTimeRequest, PinRecord` (`src/types.ts`). **Note:** implemented as an atomic file-backed `Store` (`src/store/`) behind an interface; SQLite is a future swap (kept dependency-free — see `03-hub.md`).
- [x] Seed a default schedule on first run.

### 1.4 Effective-state evaluator (the heart)
- [x] `evaluate(...)` per [08](08-protocol-api.md) §8.9 (`src/policy/evaluator.ts`), shared by the agent poll and controller reads.
- [x] `untrusted_time` checks (backward jump vs high-water; default/reset clock; hub-unreachable).
- [x] Unit tests (`src/policy/evaluator.test.ts`, `quota.test.ts`): inside/outside window, quota zero, lock_now, paused, grace boundary, warn thresholds, untrusted-time, bonus applied, day rollover.

### 1.5 Pairing & auth
- [x] `POST /pair/start` (PIN-gated), `POST /pair/claim` → device token (`src/auth/`).
- [x] Bearer-token middleware; parent PIN via **scrypt** (Node built-in; Argon2id was named in the plan, scrypt swap documented); `POST /pin/verify` → short session; lockout/rate-limit.
- [x] `POST /unlock/verify` for agent-driven PIN unlock.

### 1.6 Agent endpoints
- [x] `POST /agent/poll`, `/agent/heartbeat`, `/agent/session/start`, `/agent/session/end`, `/agent/events`, `/agent/command/ack` ([08](08-protocol-api.md) §8.6).
- [x] Quota decrements from **monotonic `minutesUsedDelta`**, never wall-clock subtraction (`src/quota/quota.ts`; unit-tested that clock-forward does not refund).
- [x] Command queue + nonce/ts on commands; ack removes them.

### 1.7 Mock agent (test harness)
- [x] CLI mock agent (`mock-agent/mockAgent.ts`) that ensures PIN, pairs, polls, and can simulate clock rollback (`--rollback-hours`) and play (`--consume`). Verified against the live Hub.

> ## ✅ GATE 1 — Hub core correctness *(blocks Phase 2)* — **PASSED (automated) 2026-06-01**
> Automated by `cd hub && npm test` (71/71 pass), primarily `src/api/api.test.ts` which drives the live HTTP server end-to-end. Evidence in [test-log.md](test-log.md).
> 1. ✅ `time/refresh` + `GET /time`; live sync to `pool.ntp.org` at 261 ms offset (< 1 s).
> 2. ✅ Evaluator unit suite 100% pass.
> 3. ✅ Mock agent pairs, polls → ALLOWED.
> 4. ✅ WARNING → GRACE → LOCKED reasons confirmed.
> 5. ✅ Quota exhausted via monotonic deltas → LOCKED `quota-exhausted`.
> 6. ✅ Reported `local_utc < high_water` → LOCKED `cant-verify-time` (+ `CLOCK_TAMPER_SUSPECTED` event).
> 7. ✅ Bonus grant increases remaining; day rollover resets usage (unit-tested), high-water carried forward.
> **Pass confirmed:** served time within ±1 s of NTP; evaluator tests pass; transitions correct; clock-forward does NOT refund minutes.
> Sign-off: automated suite, 2026-06-01

---

## Phase 2 — Event System, Signed Log & Web UI MVP

Goal: tamper-evident logging, live fan-out, and a usable browser control surface.

### 2.1 Event bus & signed log  *(done early — needed by Phase 1 endpoints)*
- [x] Event taxonomy enum ([08](08-protocol-api.md) §8.7) with `severity`, `push` flags (`src/events/taxonomy.ts`).
- [x] Append to `events.jsonl` with per-record HMAC + `prevHash` hash-chain (`src/events/log.ts`).
- [x] `GET /system/verify-log` re-verifies the chain (tamper + deletion detected; unit-tested). `LOG_INTEGRITY_FAIL` event type defined.
- [x] In-process subscriber fan-out hook (`EventLog.subscribe`) bridged onto the live stream in `hub.ts`.
- [x] Analytics rollup computed on read (`src/analytics/analytics.ts`): per-console play minutes by day + overage/agent-offline/bonus incident counts; `GET /analytics/summary?days=`. Unit-tested.

### 2.2 Live fan-out
- [x] `WS /stream` (`src/api/ws.ts`, via `ws`): device-token authenticated; pushes `hello`, `event`, and `state` (console_state_changed) frames via `StreamBus` (`src/events/bus.ts`).
- [x] Hub emits a `state` frame when evaluator output changes for a console (`EnforcementService.recordTransition`).
- [x] Integration-tested (`src/api/ws.test.ts`): hello + event + state on a transition; invalid token rejected at upgrade.

### 2.3 Web UI (served by Hub) — [06](06-web-interface.md) → `hub/web/`
- [x] First-run wizard: set PIN, then PIN login (`POST /web/login` → web device token + PIN session).
- [x] Dashboard: live per-console cards (state badge, reason, played-today quota bar, remaining, enforcement, agent last-seen).
- [x] Schedule editor (per-day windows + daily quota, enforcement mode, warn thresholds, grace, Wii min-session + block-unfinishable).
- [x] Quick actions: grant bonus, +15, lock now, pause/resume, unlock (PIN-gated via web session).
- [x] Requests panel (approve/deny).
- [x] Events timeline (warn/crit highlighted) + **Verify log** button.
- [x] System panel: time status + **Refresh time now**, **pairing-code generator**, analytics summary.
- [x] WS→polling fallback (5 s) on socket drop; header connection indicator.

> ## ✅ GATE 2 — Event integrity + control surface *(blocks Phase 3)* — **PASSED (automated) 2026-06-01**
> Automated by `cd hub && npm test` (80/80). Evidence in [test-log.md](test-log.md).
> 1. ✅ Events appear on the live stream (`ws.test.ts`: `QUOTA_EXHAUSTED` `event` frame received after a poll); Web UI appends on `event`/`state`.
> 2. ✅ Tampered/deleted `events.jsonl` detected with `brokenAt` (`events/log.test.ts`); `verify-log` endpoint live + wired to the UI button.
> 3. ✅ Grant-bonus and lock-now via the web session reflected in the agent's next poll within one interval (`api.test.ts`, `web.test.ts`).
> 4. ✅ Editing the schedule changes effective state (`web.test.ts`: block-all-day → LOCKED `outside-window`).
> Live boot confirmed `/`, `/app.js`, `/style.css` serve over a real socket with correct content types.
> Sign-off: automated suite, 2026-06-01

---

## Phase 3 — Wii Agent (gate-only baseline)

Goal: the honest Wii enforcement — launch gate, voluntary-exit reconciliation, overage as an event. Build on GATE 0b.

> **Split delivery.** The platform-independent logic was built as a portable, **host-tested** C library [`agent-core/`](../../agent-core) (shared with the 360 agent). The Wii/libogc glue is [`agent-wii/platform/`](../../agent-wii). The `agent-core` part is **done + tested here (78 C checks pass, compiles `-Wall -Wextra`)** and cross-validated against a live Hub response; the `platform/` layer + on-hardware **GATE 3** require devkitPPC + a physical Wii (hardware-blocked — [test-log.md](test-log.md)).

### 3.1 Core gate `cg_gate.dol`
- [x] Discovery chain: UDP broadcast (`agent-wii/platform/net.c`) + cached host/port + static; mDNS pending Phase 5.
- [x] Pair with Hub (enter code from Web UI) + store device token on SD/NAND (`platform/main.c` `ensure_paired`, `store.c`).
- [x] Fetch `{authoritative time, effective state, commands}` at boot (`cg_proto_parse_poll`, host-tested + live cross-checked).
- [x] Lock screen (reason text, request-more-time, parent-PIN entry → `POST /unlock/verify`) (`platform/main.c` `lock_screen`).
- [x] Status screen (remaining quota) before chaining.

### 3.2 Launch gate logic
- [x] If LOCKED → lock screen, do **not** chain (`cg_agent_state_is_locked`).
- [x] Won't-finish guard (`cg_agent_launch_guard`): `secs_to_boundary < wii_min_session` → WARN, or BLOCK if `block_unfinishable`. **Unit-tested** (`test_agent.c`).
- [x] If OK/WARN → `session/start` with `expected_return_by`, persist pending session, chain to loader (Return-To = gate).

### 3.3 Exit reconciliation & overage
- [x] On return, reconcile pending session against Hub authoritative time; `cg_agent_session_result` → elapsed + overage; `session/end` decrements quota. **Unit-tested.**
- [x] If overage > 0 → `session/end` carries `overageMin`; Hub emits `PLAY_BEYOND_DOWNTIME` (verified Hub-side in `api.test.ts`).
- [ ] Hub-side heartbeat-gap inference for suspected overage (R-09) — deferred to Phase 6 watchdog (Hub-side, software).

### 3.4 Time-trust & persistence
- [x] Persist `{device_token, hub host/port, high_water_utc}` to SD/NAND (`store.c`); high-water only advances (`cg_agent_update_high_water`, unit-tested).
- [x] Backward clock jump / default clock → untrusted (`cg_agent_clock_trustworthy`, unit-tested); the Hub also fails closed. PIN unlock path wired.

### 3.5 Packaging
- [x] devkitPPC Makefile producing `cg_gate.dol` (Priiloader **Installed file** autoboot target) + install docs ([`agent-wii/README.md`](../../agent-wii/README.md)).
- [~] NAND channel (WAD) packaging documented; building/flashing requires hardware (R-05).

> ## ✅ GATE 3 — Wii enforcement on real hardware *(blocks Phase 6 hardening of Wii; can run parallel to Phase 4)* — **PARTIAL: logic verified host-side; on-hardware steps BLOCKED**
> **Host-verified now (automated):** the decision logic each step depends on is unit-tested in `agent-core` (`make test`, 78 checks) and the protocol is cross-validated against a **live Hub response** (`cg_parse_tool` piped a real `/agent/poll` reply → correct `state`/`reason`/`commands`/`launch_guard`). The Hub-side effects (overage → `PLAY_BEYOND_DOWNTIME`, rollback → lock, schedule → LOCKED) pass in the Hub suite.
> **Still requires a physical Wii (BLOCKED):** steps 1–6 below — autoboot, real game launch/exit, SD-pull on a NAND-channel build, hold-RESET Priiloader access — need devkitPPC + hardware.
> 1. Schedule LOCKED → lock screen, no launch.  2. 5-min window → play 6 min → exit → `PLAY_BEYOND_DOWNTIME`, quota 0.  3. `wii_block_unfinishable` → block.  4. Clock back 3 h → LOCKED `cant-verify-time` → PIN unlock.  5. SD pull (NAND channel) → gate still runs.  6. Priiloader access → `PRIILOADER_ACCESS`.
> Sign-off (host logic): automated, 2026-06-01 · Sign-off (hardware): ____

---

## Phase 4 — Xbox 360 Agent (full, in-game enforcement)

Goal: warnings over a running game, hard-mode force-close, soft-mode nag, rollback resistance. Build on GATE 0a.

> **Split delivery (same model as Phase 3).** The in-game enforcement logic was added to the host-tested [`agent-core/`](../../agent-core) as **`cg_enforce`** (graduated-warning scheduler, soft/hard action selector, monotonic minute accounting) + shared **`cg_http`**. The XDK glue is [`agent-360/plugin/`](../../agent-360). `agent-core` is **done + tested here (122 C checks pass)**; the 360 orchestration (`plugin/main.c`, `plugin/net.c`) **host-compiles clean against agent-core** (non-XDK paths). Producing `cg_agent.xex` + on-hardware **GATE 4** need the XDK + a JTAG/RGH 360 (hardware-blocked — [test-log.md](test-log.md)).

### 4.1 Plugin `cg_agent`
- [x] Discovery + pairing + device token (UDP discovery `cg360_discover_hub`; token store; same Hub API as Wii).
- [x] Monotonic tick source + clock-independent minute accounting (`cg_minutes_delta`, unit-tested); high-water persisted (`cg_agent_update_high_water`).
- [x] Poll loop (25 s ALLOWED; 7 s WARNING/GRACE) + command handling + ack (`plugin/main.c` `tick`/`ack_commands`).
- [x] Cached-policy + fail-closed grace primitive (`cg_agent_hub_grace_expired`, unit-tested) for Hub-outage enforcement.

### 4.2 On-screen enforcement
- [x] Graduated warning overlays at 60/30/15/5 — fire-once scheduler `cg_warn_check` (unit-tested incl. sparse-poll jumps + re-arm).
- [x] Grace countdown overlay (`p360_overlay_grace`) on `CG_ACT_GRACE`.
- [x] Hard mode: `XLaunchNewImage` force-close + `PLAY_INTERRUPTED` (`cg_enforce_action` → `CG_ACT_FORCE_CLOSE`, unit-tested).
- [x] Soft mode: persistent nag + `PLAY_BEYOND_DOWNTIME`, no kill (`CG_ACT_NAG`, unit-tested).
- [x] Lock screen on `CG_ACT_LOCK` (at dashboard) + request-more-time / parent-PIN unlock path.

### 4.3 Dashboard app `cg_dash`
- [~] Parent-facing functions (today/week, remaining, grant/lock/pause/extend PIN-gated, request-more-time) reuse `agent-core` + `net` against existing Hub controller endpoints (already covered by the Hub suite). Reachable from the plugin lock screen/menu; can split into a standalone `cg_dash.xex` without logic changes ([agent-360/README.md](../../agent-360/README.md)).
- [x] Boot target via `launch.ini default` ([`launch.ini.example`](../../agent-360/plugin/launch.ini.example)); child reaches loader only when ALLOWED.

### 4.4 Fail-closed & outage
- [x] On non-200 poll, hold cached behaviour; production fails closed after the grace window via `cg_agent_hub_grace_expired` (unit-tested); events buffer (`post_event`).

### 4.5 Hardened packaging
- [x] `launch.ini.example` with plugin slot + hardening notes (strip button slots, neutralise `RBump`); NAND-bake instructions ([agent-360/README.md](../../agent-360/README.md)).
- [~] Actual NAND bake (xeBuild/J-Runner) requires hardware.

> ## ✅ GATE 4 — 360 enforcement on real hardware *(blocks Phase 6 hardening of 360)* — **PARTIAL: logic verified host-side; on-hardware steps BLOCKED**
> **Host-verified now (automated):** every decision the seven steps hinge on is unit-tested in `agent-core` — warning thresholds (`test_enforce.c`), force-close vs nag vs lock selection, rollback/default-clock detection (`test_agent.c`), minute accounting, grace-window fail-closed — **122 C checks pass**; the 360 orchestration host-compiles against the core; Hub-side effects (overage/interrupt events, schedule/rollback → LOCKED) pass in the 82-test Hub suite.
> **Still requires a JTAG/RGH 360 (BLOCKED):** real overlay rendering over a running game, `XLaunchNewImage` force-close, >2 h unplug clock reset, NAND-bake survival.
> 1. warnings over a game.  2. hard-mode grace → force-close + `PLAY_INTERRUPTED`.  3. soft-mode nag, no kill.  4. unplug → default clock → LOCKED `cant-verify-time`.  5. clock-back → rollback LOCKED.  6. Hub drop → cached then LOCKED `HUB_UNREACHABLE`.  7. HDD wipe (NAND-baked) → still enforces.
> Sign-off (host logic): automated, 2026-06-01 · Sign-off (hardware): ____

---

## Phase 5 — Android App

Goal: zero-IP discovery, full control parity, reliable push. Build on GATE 0c.

> **Split delivery (same model as Phases 3–4).** The platform-independent client logic is a **pure-JVM Java module** [`android/shared/`](../../android/shared) — host-tested with a plain JDK (no Gradle/Android SDK): **49 checks pass**. The Android Kotlin/Compose app [`android/app/`](../../android/app) wires NsdManager/UDP/OkHttp/FCM into it. Building the app needs the **Android SDK + Gradle + Kotlin** (only `adb` is present here) — toolchain-blocked ([test-log.md](test-log.md)). The discovery contract is verified Hub-side (`hub/src/discovery/discovery.test.ts`).

### 5.1 Discovery & connection
- [x] Discovery ordering/retry/validation policy in `shared` `DiscoveryCoordinator` (unit-tested: cache-hit, stale-cache→mDNS, lossy-multicast retry, all-fail→manual, single-try manual). `NsdManager` (MulticastLock, **serialized resolve**) + UDP-broadcast + cache + manual wired in `app/DiscoveryManager.kt`.
- [x] UDP-broadcast fallback + cached fast path + manual-IP last resort (with a "same Wi-Fi / not guest network" diagnostic). UDP reply parsing in `shared` `Endpoint.fromDiscoveryReply` (unit-tested); Hub responder integration-tested.
- [x] Token in Keystore-backed `EncryptedSharedPreferences` (`app/Prefs.kt`); PIN login via `POST /web/login` (`app/HubApi.kt`). (QR-scan pairing is a UI nicety left for the device build.)

### 5.2 Screens (parity with Web UI)
- [x] Dashboard (live via WebSocket, refresh on `event`/`state`), quick actions (lock/unlock/+15) (`app/MainActivity.kt`); response parsing via host-tested `shared` `HubModels`.
- [~] Schedule editor / requests / analytics screens — wired through the same `HubApi` + endpoints (covered Hub-side); full Compose screens to finish in the device build.
- [x] PIN gating for privileged actions (`X-Pin-Session` header via `HubApi`).

### 5.3 Push
- [x] FCM service (`app/CgMessagingService.kt`): receives event pushes → notification; re-registers token on refresh. (UnifiedPush/ntfy is the no-Google alternative per Hub config.)
- [~] Actionable notification buttons (Grant/Deny on `MORE_TIME_REQUESTED`) — to finish in the device build (server push + WS dedupe contract is ready).

> ## ✅ GATE 5 — Android end-to-end on real networks *(blocks Phase 6)* — **PARTIAL: shared logic verified; device build BLOCKED**
> **Host-verified now (automated):** the discovery fallback policy, UDP-reply parsing, JSON, and Hub model parsing are unit-tested in `android/shared` (**49 checks**, `javac -Xlint:all` clean); the Hub UDP discovery responder is integration-tested (`discovery.test.ts`); control/login/console endpoints the app calls pass in the 84-test Hub suite.
> **Still requires the Android toolchain + devices (BLOCKED):** building the APK and the on-network steps below need Android SDK + Gradle + a phone.
> 1. flat LAN → zero-IP discovery.  2. isolated LAN → graceful fallback + manual IP.  3. backgrounded `PLAY_BEYOND_DOWNTIME` push.  4. approve `MORE_TIME_REQUESTED` from the notification.  5. edit/grant from app reflected on console + Web UI.
> Sign-off (shared logic): automated, 2026-06-01 · Sign-off (device): ____

---

## Phase 6 — Hardening & Resilience

Goal: walk the threat model on hardware; make bypass visible; remove escape hatches.

> **Mostly Hub-side software — built + tested here.** Transport signing, replay protection, token revocation, the watchdog, and backups/standby are fully implemented and tested (Hub 99 tests; agent-core 142 C checks incl. cross-language HMAC pin). The console **boot-chain** hardening (6.1) is configuration on real hardware (documented in the agent READMEs + `launch.ini.example` + parent guide).

### 6.1 Boot-chain hardening
- [~] 360: strip button-launch slots; neutralize `RBump`; PIN-gate/remove FTP; NAND bake — documented in [`agent-360/plugin/launch.ini.example`](../../agent-360/plugin/launch.ini.example) + [README](../../agent-360/README.md); applying it needs the console.
- [~] Wii: NAND-channel deploy; Priiloader autoboot + password; loader Return-To = gate — documented in [`agent-wii/README.md`](../../agent-wii/README.md). **Menu-access events wired:** `PRIILOADER_ACCESS`/`SETTINGS_ACCESS` event types exist and the agent posts them via `/agent/events`.

### 6.2 Transport & secrets
- [x] **HMAC-signed LAN transport (R-04)** implemented on each agent: SHA-256 + HMAC-SHA256 in C (`agent-core/cg_hmac.c`, RFC-4231-vector-tested) + `cg_sign` (`cg_sign.c`) producing the canonical signature, wired into both net layers (`cgnet_set_signing_key`/`cg360_set_signing_key`, auto-signing in the request path). **Cross-language pinned**: C `cg_sign` == Hub Node `sign()` (byte-identical, `test_hmac.c`).
- [x] Hub verifies signatures (`auth/signing.ts`: canonical/HMAC/`timingSafeEqual`) with **nonce replay cache + ts-skew window**; signing keys issued at pairing; `enforceAgentSigning` config to require signing. Tested (`signing.test.ts`, `signing.api.test.ts`: accept / tamper / replay / stale-ts / enforce-unsigned-reject).
- [x] **Token revocation** from Web UI/app: `GET /devices` (secret-free) + `POST /devices/:id/revoke`; revoked tokens die immediately (tested `resilience.api.test.ts`). **PIN rate-limit/lockout** on the Hub (tested `auth.test.ts`); agent-side parent-PIN unlock verifies against the Hub.

### 6.3 Watchdog & evidence
- [x] Heartbeat dead-man's switch (`watchdog/watchdog.ts`): gap without a clean shutdown → `AGENT_OFFLINE` (push), debounced + re-armed on return; `POST /agent/shutdown` suppresses benign power-offs. Tested (`watchdog.test.ts`).
- [x] `CONSOLE_POWERED_DURING_LOCK` emitted when a poll reports a running title while the effective state is LOCKED (tested).
- [x] Tamper events push-flagged in the taxonomy (`PLAY_BEYOND_DOWNTIME`, `AGENT_OFFLINE`, `CONSOLE_POWERED_DURING_LOCK`, `CLOCK_TAMPER_SUSPECTED`, `PRIILOADER_ACCESS`, `SETTINGS_ACCESS`, `LOG_INTEGRITY_FAIL`); FCM dispatch in the Android `CgMessagingService`.

### 6.4 Resilience
- [x] Standby read-replica: `GET /system/snapshot` (consistent, secret-free export) + `Store.importState` / `POST /system/replicate`; a second Hub imports and serves identical reads (tested `resilience.api.test.ts`). Agents fail over via the multi-endpoint discovery chain.
- [x] Backups: `POST /system/backup` + scheduled `backupIntervalMs` copy `state.json` + sealed `events.jsonl` + `snapshot.json` to a timestamped folder, recording log-integrity; `GET /system/backups` lists them. Tested.

> ## ✅ GATE 6 — Threat-model walkthrough *(blocks Phase 7)* — **PARTIAL: software mitigations verified; on-hardware walkthrough BLOCKED**
> **Verified now (automated, Hub 99 tests + agent-core 142 C checks):** the software mitigations behind the threat table ([10](10-security-threat-model.md) §10.3) are tested — T1/T2 (clock rollback/forward → no time gain), T4 (kill agent → `AGENT_OFFLINE`), T11/T12 (MITM/replay → HMAC signing + nonce cache), T13 (stolen token → revocation), T14 (PIN brute force → lockout), T10 (log tamper → hash-chain), plus standby read-replica + backups.
> **Still requires real consoles (BLOCKED):** the full T1–T15 walkthrough on hardware (boot-chain escape hatches, NAND-reflash residual T9, hold-RESET) needs a JTAG 360 + softmod Wii.
> Sign-off (software mitigations): automated, 2026-06-01 · Sign-off (hardware walkthrough): ____

---

## Phase 7 — UX Polish, Packaging & Acceptance

Goal: a non-expert parent can install and run it for a real week.

### 7.1 End-to-end flows
- [ ] Bonus/extend/request flows polished across console, web, Android.
- [ ] Analytics dashboards finalized (daily/weekly play, busiest hours, overage incidents, agent-offline gaps).
- [ ] First-run wizard + inline help finalized.

### 7.2 Packaging & docs
- [ ] One-command Docker deploy for Windows & Mac (compose + readme).
- [ ] Signed releases of `cg_agent`/`cg_dash` (360) and `cg_gate` WAD/`.dol` (Wii) with install scripts.
- [ ] Finalize [13-parent-setup-guide.md](13-parent-setup-guide.md) with exact button paths verified on hardware.

> ## ✅ GATE 7 — Parent acceptance (one-week soak) *(release gate)*
> **Procedure:** A non-developer follows [13](13-parent-setup-guide.md) unaided to install the Hub, both consoles, and the Android app, then runs the system for **7 days** with a real child user.
> **Pass criteria:**
> - Install completed without developer help.
> - Schedule enforced daily; warnings seen; ≥1 bonus grant and ≥1 lock-now used successfully.
> - All brief requirements verified against the traceability table ([11](11-roadmap-milestones.md)).
> - Every overage/tamper event during the week produced a push and a log entry (cross-checked).
> - No data loss across a Hub restart and a console power-cycle.
> Sign-off: ____

---

## Master gate summary (quick reference)

| Gate | Proves | Blocks until passed |
|---|---|---|
| 0a | 360 in-game residency + force-close | Phase 4 |
| 0b | Wii autoboot→LAN→game→back loop | Phase 3 |
| 0c | Cross-platform Docker discovery | Phase 5 |
| **0** | All spikes resolved/fallback | Phase 1 |
| 1 | Hub time + evaluator + quota correctness | Phase 2 |
| 2 | Signed-log integrity + control surface | Phase 3 |
| 3 | Wii enforcement on hardware | Wii hardening |
| 4 | 360 enforcement on hardware | 360 hardening |
| 5 | Android discovery + push + parity | Phase 6 |
| 6 | Threat model holds (or documented residual) | Phase 7 |
| 7 | Parent one-week acceptance | Release |

> **Rule:** never start a phase whose blocking gate(s) haven't been signed off in `test-log.md`. A red gate is a stop-the-line event — fix or take the documented fallback before proceeding.
</content>
