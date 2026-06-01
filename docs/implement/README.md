# ConsoleGate — Implementation Plan

A parental screen-time control system for **JTAG/RGH Xbox 360** and **softmodded Wii** consoles that boot homebrew via the Homebrew Channel / USB Loader GX.

This folder is the complete, validated, end-to-end implementation plan. Every load-bearing technical claim was researched against primary/authoritative sources (see [`01-research-findings.md`](01-research-findings.md)) — the plan does **not** rest on assumptions. Where something is technically impossible (e.g. interrupting a running Wii game), that is stated plainly and the design works around it.

## What this system does

- Weekly schedule to enable/disable each console, plus a daily play-time budget.
- Graduated on-screen warnings before downtime, then enforcement at downtime.
- Parents grant bonus time, "lock now", pause, or unlock — from the console (PIN), a local web UI, or an Android app.
- Auto-discovery: the Android app finds the system on the LAN with no manual IP entry.
- Resists time tampering and casual disabling, and makes any bypass **tamper-evident** (logged + push-notified) even when it cannot be prevented.
- An event system: every meaningful event (especially *playing beyond downtime*) is logged to all components and pushed to the parent's phone.

## The four components

| Component | Tech | Role |
|---|---|---|
| **Hub** (required) | Docker service (runs on existing always-on Windows/Mac) | Authoritative clock, schedule, quota state, event log, web UI, API, push dispatch, mDNS advertiser |
| **Console agent — Xbox 360** | Dashlaunch plugin (XDK) + on-console dashboard app | Boots first, background timer, force-closes games at downtime, lock screen, heartbeat |
| **Console agent — Wii** | Priiloader-autobooted gatekeeper (`.dol` / NAND channel) | Boots first, gates game launches, captures voluntary exits, heartbeat |
| **Android app** | Kotlin + NsdManager discovery | Remote control + dashboard + push notifications |
| **Web UI** | Served by the Hub | Same functions as the Android app, in a browser on the LAN |

## Key architectural decisions (locked)

1. **The Hub is required** and is the single source of truth. It runs as a Docker container on the user's existing always-on Windows and Mac machines. It holds authoritative time (internet NTP + a local refresh API), the schedule, quota state, and the signed event log, and it hosts the web UI.
2. **Software-only enforcement.** No smart plug. The Xbox 360 *can* force-close a running game; the **Wii cannot** (hard technical limit). On Wii, enforcement happens at the launch gate and on voluntary exit; "playing beyond downtime" becomes a logged + push-notified **event** rather than a forced stop.
3. **Fail-closed.** When time or state is untrustworthy, or the Hub is unreachable past a grace window, the console locks by default, with a **parent PIN** escape hatch.
4. **Tamper-evident, not tamper-proof.** A child with the same mod tools can ultimately reflash NAND. The goal is to raise the bar above the child's ability *and* ensure no bypass happens silently.

## Document index

| # | Document | Contents |
|---|---|---|
| 01 | [Research findings](01-research-findings.md) | Validated facts + sources that the plan is built on |
| 02 | [Architecture](02-architecture.md) | System topology, data flow, component responsibilities |
| 03 | [Hub](03-hub.md) | Docker service: time, policy, state, events, web UI, discovery |
| 04 | [Xbox 360 agent](04-console-xbox360.md) | Dashlaunch plugin + dashboard app design |
| 05 | [Wii agent](05-console-wii.md) | Priiloader gatekeeper + launch-gate enforcement |
| 06 | [Web interface](06-web-interface.md) | Browser UI hosted by the Hub |
| 07 | [Android app](07-android-app.md) | Remote control, discovery, push notifications |
| 08 | [Protocol & API](08-protocol-api.md) | REST/WebSocket contract, data models, event taxonomy |
| 09 | [Time & tamper resistance](09-time-and-tamper.md) | The clock-trust model and anti-disable layers |
| 10 | [Security & threat model](10-security-threat-model.md) | Attacker model, what holds, what doesn't |
| 11 | [Roadmap & milestones](11-roadmap-milestones.md) | Phased build order with acceptance criteria |
| 12 | [Risks & open questions](12-risks-open-questions.md) | Unknowns to validate during build |
| 13 | [Parent setup & hardening guide](13-parent-setup-guide.md) | Install + tighten-security instructions for parents |
| 14 | [Implementation checklist & testing gateways](14-implementation-checklist.md) | Granular step-by-step build tasks with blocking on-hardware test gates |

## Status

**Phases 1 & 2 implemented, tested, and GATES 1 & 2 passed (2026-06-01).** The Hub lives in [`/hub`](../../hub) (Node.js 22 + TypeScript):

- **Phase 1 — Hub Core:** authoritative NTP-backed time, the effective-state evaluator, monotonic clock-independent quota, scrypt PIN + pairing + device tokens, the full agent + controller REST API, and UDP-broadcast discovery.
- **Phase 2 — Events + live fan-out + Web UI:** signed hash-chained event log with integrity verification, a `WS /stream` live feed (`StreamBus`), an analytics rollup, and a complete browser **Web UI** served by the Hub (login, live dashboard, schedule editor, quick actions, requests, events timeline, system/analytics) with a WS→polling fallback.

- **Phase 3 — Wii agent (logic complete + tested):** the platform-independent agent logic is a portable C library [`agent-core/`](../../agent-core) (protocol parse/build, time-trust, won't-finish launch guard, session accounting, command handling), cross-validated by piping a **live Hub response** through the compiled parser. The Wii/libogc glue [`agent-wii/`](../../agent-wii) (`cg_gate.dol`, devkitPPC Makefile, install docs) is written; compiling it and the on-hardware **GATE 3** need devkitPPC + a physical Wii.
- **Phase 4 — Xbox 360 agent (logic complete + tested):** `agent-core` gained `cg_enforce` (graduated-warning scheduler, soft/hard force-close-vs-nag selector, monotonic minute accounting) + shared `cg_http`. The XDK plugin glue [`agent-360/`](../../agent-360) (resident poll/warn/`XLaunchNewImage` force-close loop) **host-compiles clean against agent-core**; producing `cg_agent.xex` + on-hardware **GATE 4** need the Xbox 360 XDK + a JTAG/RGH console.
- **Phase 5 — Android app (logic complete + tested):** the platform-independent client logic is a pure-JVM Java module [`android/shared/`](../../android/shared) — discovery fallback policy (cache→mDNS→UDP→manual, lossy retry, validation), JSON, `Endpoint` + `HubModels` parsing — **49 host JDK checks pass**. The Kotlin/Compose app [`android/app/`](../../android/app) (NsdManager/UDP discovery, OkHttp REST+WS, FCM push) wires into it; building the APK + on-device **GATE 5** need the Android SDK + Gradle. The Hub UDP discovery responder is integration-tested.
- **Phase 6 — Hardening & resilience (Hub software complete + tested):** **HMAC-signed LAN transport (R-04)** — SHA-256/HMAC in C (`agent-core/cg_hmac`, RFC-4231-tested) **cross-language-pinned** to the Hub's verifier, with a nonce replay cache + ts-skew window and an `enforceAgentSigning` switch; **token revocation**; a **heartbeat dead-man's-switch watchdog** (`AGENT_OFFLINE`, `CONSOLE_POWERED_DURING_LOCK`); and **backups + standby read-replica** (snapshot/import). The console boot-chain hardening is documented config on real hardware.

**99 Hub tests + 142 agent-core C checks + 49 android-shared JDK checks green**, plus live runtime smokes (real `pool.ntp.org` sync, mock agent, Web UI over a real socket, Node↔C cross-language poll-response + HMAC-signature pin). Hardware/toolchain-dependent spikes/gates (GATE 0a/0b/0c, the on-hardware parts of GATE 3/4/6, the on-device part of GATE 5) are blocked on physical 360/Wii hardware and the Android SDK — see [test-log.md](test-log.md).

Next: **Phase 7 (UX polish, packaging & acceptance)**. Start at [`14-implementation-checklist.md`](14-implementation-checklist.md) for the granular, phased build checklist with testing gateways (it expands [`11-roadmap-milestones.md`](11-roadmap-milestones.md), the higher-level milestone view).
</content>
