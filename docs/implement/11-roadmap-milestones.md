# 11 — Roadmap & Milestones

Build order is chosen so the **Hub contract is proven first**, then the easier-but-still-real path (one console at a time), then control surfaces, then hardening. Each milestone has explicit acceptance criteria; nothing is "done" until its criteria pass on real hardware.

## M0 — Spikes to retire the biggest unknowns (before committing)

Do these *first*; they gate the whole 360 design.
- **S1 (360, critical):** build a minimal Dashlaunch plugin that (a) stays resident, (b) keeps a counter running while a game runs, and (c) calls `XLaunchNewImage` to force-return to the dashboard on a trigger. Confirms [01](01-research-findings.md) §A1/§A3 on real hardware and the XDK-vs-libxenon decision (R-01).
- **S2 (Wii):** Priiloader autoboot a `.dol` that reaches a LAN HTTP server (libogc `net_*`) and chains to USB Loader GX with Return-To back to itself. Confirms §B2/B3/B4.
- **S3 (Hub/Docker):** mDNS advertise from a container on Windows + Mac Docker Desktop and discover it from an Android `NsdManager` client. Confirms the Docker-mDNS risk (R-07).
- **Exit criteria:** all three spikes green, or a documented fallback chosen (e.g. 360 degrades to gate-only; mDNS replaced by UDP-broadcast primary).

## M1 — Hub core (time + policy + state + API)

- Time authority (NTP sync, monotonic anchor, `/time/refresh`), SQLite schema ([08](08-protocol-api.md) §8.5), effective-state evaluator (§8.9), agent poll/heartbeat/session endpoints, device pairing + tokens, parent PIN.
- **Accept:** serves authoritative time ±1s; evaluator returns correct ALLOWED/WARNING/GRACE/LOCKED across window/quota/lock/untrusted-time cases (unit-tested); pairs a mock agent; quota decrements from monotonic deltas.

## M2 — Event system + signed log + Web UI MVP

- Event taxonomy ([08](08-protocol-api.md) §8.7), HMAC hash-chain log, WebSocket fan-out, analytics rollups. Web UI: dashboard, schedule editor, quick actions, events timeline, time/system panel.
- **Accept:** events logged + chained (tamper detectable via verify); Web UI shows live state and can grant/lock/unlock a mock console; schedule edits change evaluator output.

## M3 — Wii agent (gate-only, the honest baseline)

- `cg_gate` `.dol`: discover Hub, fetch state, lock screen, launch gate with won't-finish guard, session start/end, voluntary-exit reconciliation, `PLAY_BEYOND_DOWNTIME` via next-gate + heartbeat-gap, untrusted-time lock. Package as Priiloader installed-file; then as NAND channel.
- **Accept:** LOCKED prevents launch; allowed launch chains to loader and returns to gate; overage produces the event + push; clock rollback locks with PIN unlock; survives SD removal as NAND channel.

## M4 — Xbox 360 agent (full, with in-game enforcement)

- `cg_agent` plugin: residency, monotonic timing + high-water persistence, warning overlays (60/30/15/5), grace countdown, `XLaunchNewImage` force-close (hard mode) / nag (soft mode), lock screen, parent-PIN unlock (online + offline hash), Hub comms, NAND bake. `cg_dash` on-console dashboard app.
- **Accept:** counter runs during gameplay; warnings overlay a running game; hard-mode downtime force-closes the game and locks; soft-mode fires `PLAY_BEYOND_DOWNTIME` without killing; rollback/unplug never grants time; agent+config survive HDD wipe when NAND-baked.

## M5 — Android app

- NsdManager discovery (MulticastLock, serialized resolves, retry) + UDP-broadcast + manual-IP fallback; dashboard, schedule, quick actions, requests, events; FCM/ntfy push with actionable notifications.
- **Accept:** finds Hub with zero IP entry on a flat LAN; falls back on isolated LAN; live dashboard; `PLAY_BEYOND_DOWNTIME` push arrives backgrounded; "more time" approvable from the notification.

## M6 — Hardening & resilience

- Strip 360 escape hatches; Wii NAND-channel + menu-access evidence; cert pinning / HMAC transport; fail-closed grace-window tuning; Hub standby replica + backups; log-integrity verify in UI; rate-limit/lockout on PIN.
- **Accept:** threat-model table ([10](10-security-threat-model.md) §10.3) walked through on hardware — each mitigation demonstrated or its residual risk documented; standby serves reads during primary outage.

## M7 — UX polish, packaging, docs

- Bonus/extend/request flows end-to-end across all surfaces; analytics dashboards; first-run wizard; one-command Docker deploy for Win/Mac; signed releases of agents; finalize the parent guide ([13](13-parent-setup-guide.md)) and per-console install scripts.
- **Accept:** a non-expert parent can install per [13](13-parent-setup-guide.md) and run a full week; all feature requirements from the brief verified against acceptance criteria.

## Requirement traceability

| Brief requirement | Where delivered |
|---|---|
| Console app: grant time + analytics dashboard | `cg_dash` ([04](04-console-xbox360.md)), Wii gate status ([05](05-console-wii.md)) |
| Web interface (LAN) same functions | [06](06-web-interface.md) |
| Android app w/ network discovery | [07](07-android-app.md) §7.3 |
| Resist time tampering | [09](09-time-and-tamper.md) |
| Resist deleting/disabling | [09](09-time-and-tamper.md) §9.6, [10](10-security-threat-model.md) |
| Weekly enable/disable schedule | Schedule model ([08](08-protocol-api.md) §8.5), editors ([06](06-web-interface.md)/[07](07-android-app.md)) |
| Bonus time / lock now | Controller endpoints ([08](08-protocol-api.md) §8.8) |
| Alert near downtime + interrupt at downtime | 360 overlays + force-close ([04](04-console-xbox360.md)); Wii gate + event ([05](05-console-wii.md)) |
| (Added) Event notification system | Event taxonomy + push ([08](08-protocol-api.md) §8.7, [03](03-hub.md) §3.7) |
| (Added) Fail-closed + parent PIN | [09](09-time-and-tamper.md) §9.5 |
| (Added) Local time refresh API | [03](03-hub.md) §3.3 |
</content>
