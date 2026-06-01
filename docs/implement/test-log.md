# Test Log

Records of gate executions (checklist [14](14-implementation-checklist.md)). Automated gates are re-run by `cd hub && npm test`.

| Gate | Date | Env | Result | Notes |
|---|---|---|---|---|
| GATE 0a (360 residency + force-close) | — | — | **BLOCKED** | Needs physical JTAG/RGH Xbox 360 + XDK. Not runnable in the dev environment. |
| GATE 0b (Wii boot-gate loop) | — | — | **BLOCKED** | Needs physical softmod Wii + devkitPPC. |
| GATE 0c (cross-platform Docker discovery) | — | — | **PARTIAL** | UDP-broadcast responder implemented (`src/discovery`); Hub binds it at boot. Full Win+Mac Docker + Android `NsdManager` test pending Phase 5 + hardware. |
| GATE 1 (Hub time + evaluator + quota) | 2026-06-01 | Node 22.14 / Win11 | **PASS (automated)** | `npm test` → 71/71 pass. `src/api/api.test.ts` drives the full GATE 1 scenario through the live HTTP server: ALLOWED→WARNING→GRACE→LOCKED, monotonic quota (clock-forward does not refund), clock-rollback → `cant-verify-time`, bonus grant, parent lock/unlock, session overage → `PLAY_BEYOND_DOWNTIME`, verify-log clean. Live run also synced real `pool.ntp.org` (offset 261 ms < 1 s) and a mock agent paired + polled against the running process. |
| GATE 6 (Hardening & Resilience) | 2026-06-01 | gcc 13.2 + JDK 21 + Node 22.14 / Win11 | **PARTIAL — software mitigations PASS, hardware walkthrough BLOCKED** | Hub **99 tests** (signing accept/tamper/replay/stale/enforce, token revocation, watchdog `AGENT_OFFLINE`/clean-shutdown/re-arm, `CONSOLE_POWERED_DURING_LOCK`, backup integrity, standby snapshot→import). agent-core **142 C checks** incl. SHA-256/HMAC RFC-4231 vectors + **cross-language pin** (C `cg_sign` == Node `sign()` byte-identical). Console boot-chain hardening + full T1–T15 walkthrough need real consoles. |
| GATE 5 (Android) | 2026-06-01 | JDK 21 (host) + Node 22.14 / Win11 | **PARTIAL — shared logic PASS, device BLOCKED** | `android/shared` pure-JVM suite → **49 checks, 0 failed** (`javac -Xlint:all` clean): discovery fallback policy (cache→mDNS→UDP→manual, lossy retry), `Endpoint.fromDiscoveryReply`, JSON reader, `HubModels` console/login/stream parsing. Hub UDP discovery responder integration-tested (`hub/src/discovery/discovery.test.ts`, 2 tests). The Kotlin app (`android/app`) needs Android SDK + Gradle + Kotlin (only `adb` present) → can't build/run on-device here. |
| GATE 4 (Xbox 360 enforcement) | 2026-06-01 | gcc 13.2 (host) + Node 22.14 / Win11 | **PARTIAL — logic PASS, hardware BLOCKED** | `agent-core` host suite → **122 C checks, 0 failed** (adds `cg_enforce`: graduated warnings/action-selector/minute-accounting, and `cg_http`). The 360 plugin orchestration (`agent-360/plugin/main.c`+`net.c`) **host-compiles clean** (`gcc -Wall -Wextra`, non-XDK paths) against agent-core. Hub-side effects (`PLAY_INTERRUPTED`/`PLAY_BEYOND_DOWNTIME` events, rollback/schedule → LOCKED) pass in the Hub suite. On-hardware (overlay over a running game, `XLaunchNewImage` force-close, >2 h unplug, NAND bake) needs the XDK + a JTAG/RGH 360. |
| GATE 3 (Wii enforcement) | 2026-06-01 | gcc 13.2 (host) + Node 22.14 / Win11 | **PARTIAL — logic PASS, hardware BLOCKED** | `agent-core` host suite (`make test`) → **78→122 C checks, 0 failed**, clean `-Wall -Wextra`. Cross-language: `cg_parse_tool` parsed a **live Hub `/agent/poll` response** (incl. a queued `LOCK_NOW` command) → correct `state/reason/remaining/source/command` + `launch_guard=BLOCK`. Hub-side effects (overage→`PLAY_BEYOND_DOWNTIME`, schedule→LOCKED, contract shape) pass in the 82-test Hub suite. On-hardware steps (autoboot, real game launch/exit, SD-pull, hold-RESET) need devkitPPC + a physical Wii. |
| GATE 2 (signed log + control surface) | 2026-06-01 | Node 22.14 / Win11 | **PASS (automated)** | `npm test` → 80/80. Signed hash-chained log (tamper + deletion detected, `system/verify-log`); `WS /stream` live fan-out (`ws.test.ts`: hello+event+state, invalid token rejected); Web UI served by the Hub (login, dashboard, schedule editor, quick actions, requests, events timeline, system/analytics) with WS→polling fallback; schedule edit changes effective state (`web.test.ts`); analytics rollup (`analytics.test.ts`). Live boot served `/`, `/app.js`, `/style.css` over a real socket. |

## How to reproduce GATE 1

```bash
cd hub
npm install
npm test            # 71/71
npm run typecheck   # clean
# live runtime:
CG_PORT=8090 CG_TZ=UTC npm start        # (PowerShell: set $env: vars)
npx tsx mock-agent/mockAgent.ts --url http://127.0.0.1:8090 --consume 10 --once
```
</content>
