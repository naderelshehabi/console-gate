# 04 — Xbox 360 Agent (JTAG/RGH)

> **Implementation status (Phase 4 — logic complete + tested).** Split like the Wii agent: the in-game decision logic is host-tested in [`agent-core/`](../../agent-core) — `cg_enforce` (graduated-warning fire-once scheduler, soft/hard `FORCE_CLOSE`-vs-`NAG` action selector, clock-independent `cg_minutes_delta`) plus shared `cg_http`/`cg_proto`/`cg_agent` — **122 C-unit checks pass**. The XDK plugin glue (`agent-360/plugin/`: resident poll/warn/force-close loop via `XLaunchNewImage`, XNet HTTP client) is written and **host-compiles clean against agent-core** (non-XDK paths). Building `cg_agent.xex` and the on-hardware **GATE 4** require the Xbox 360 XDK + a JTAG/RGH console (hardware-blocked — [test-log.md](test-log.md)). `cg_dash` (§4.4) is currently folded into the plugin's PIN-gated menu/lock screen and can be split into a standalone XEX without logic changes.

The 360 is the strong case: a resident Dashlaunch plugin runs during gameplay and can force-close the running game. The agent has two parts that share state on disk:

1. **`cg_agent` — a Dashlaunch plugin** (resident system module): timing, enforcement, lock overlay, Hub comms, force-close.
2. **`cg_dash` — an on-console dashboard app** (XEX): parent-facing UI — analytics dashboard, grant bonus, lock now, settings — all PIN-gated.

## 4.1 Why a Dashlaunch plugin (validated)

Per [01](01-research-findings.md) §A1, Dashlaunch plugins load as resident modules and hook imports **inside running titles** (`PatchModuleImport`) — the mechanism the RTE/mod-menu scene relies on. That is the only way to keep a timer alive during gameplay and to render an overlay + force-close at downtime. `XLaunchNewImage` (§A3) performs the force-close back to the dashboard.

## 4.2 Boot & residency

- `launch.ini` `default` → the agent's bootstrap (or the agent plugin is loaded via `[Plugins] plugin1=cg_agent.xex`), so enforcement is live from power-on before any game ([01](01-research-findings.md) §A2).
- Strip escape hatches in `launch.ini`: remove/neutralize button-launch slots and `RBump` behavior that would bypass the agent ([10](10-security-threat-model.md) §10.4).
- For tamper resistance, the agent module + `launch.ini` are baked into the **NAND image** (xeBuild/J-Runner) so an HDD wipe doesn't remove them ([01](01-research-findings.md) §A7). HDD copy is the dev/test path; NAND is the hardened deployment.

## 4.3 Plugin internals (`cg_agent`)

```
cg_agent (resident plugin, C/C++ XDK)
  ├─ net/         lwIP/Winsock client to Hub (HTTPS or HMAC-plaintext)
  ├─ clock/       monotonic tick source + high-water-mark persistence
  ├─ policy/      cached effective-policy; local evaluator for Hub-outage
  ├─ enforce/     state machine ALLOWED/WARNING/GRACE/LOCKED
  ├─ overlay/     on-screen warnings + lock screen (rendered over title)
  ├─ killer/      XLaunchNewImage → dashboard at downtime/lock
  ├─ pin/         parent-PIN verification via Hub (challenge), local cache
  └─ store/       NV state file (NAND-backed path), session log buffer
```

### Timing & trust
- Maintain a monotonic tick (CPU timebase) for **elapsed-play** measurement — immune to clock changes ([09](09-time-and-tamper.md)).
- Persist `{high_water_utc, minutes_used_today, session_id, mono_at_persist}` to NV storage every ~60s of play and on clean transitions.
- Each poll: send `{console_id, local_utc_guess, mono_ticks, minutes_used_delta, current_title_id, state}`; receive `{authoritative_utc, effective_state, quota_remaining, commands[]}`.
- If `local clock < high_water_utc` or the 360's clock reads its post-unplug default → report it; Hub flags `CLOCK_TAMPER_SUSPECTED`; agent leans on monotonic counters only.

### Enforcement state machine
- **WARNING:** render unobtrusive overlay toasts at the configured thresholds (default 60/30/15/5 min) before downtime or quota exhaustion — the validated Family-Timer UX ([01](01-research-findings.md) §C). Each fires a `WARNING_SHOWN` event.
- **GRACE:** at the boundary, show a full-screen countdown (default 60s, configurable) — "Saving time! Console locks in 0:60" — so the player can save. Fires `GRACE_STARTED`.
- **LOCKED:** call `XLaunchNewImage` to return to the dashboard, then show the **lock screen** (see §4.5). The running game is force-closed. Fires `DOWNTIME_ENFORCED` / `QUOTA_EXHAUSTED` and, if the player was mid-game, `PLAY_INTERRUPTED`.
- **Soft mode:** if the parent set enforcement = soft, skip the force-close; keep nagging with a persistent overlay and fire `PLAY_BEYOND_DOWNTIME` (logged + pushed) instead of killing the title — respects manual-save games at the parent's discretion.

### Fail-closed on Hub outage
- The agent enforces from its **cached policy + monotonic counters** during a brief outage. After `grace_window` (default 15 min) with no Hub contact, it transitions to LOCKED with reason `HUB_UNREACHABLE` and a parent-PIN unlock path ([09](09-time-and-tamper.md) §9.5). It keeps buffering events and flushes them when the Hub returns.

## 4.4 On-console dashboard app (`cg_dash`)

A normal XEX the parent launches from the agent's home screen (PIN-gated). Functions (mirrors Web/Android):
- **Dashboard:** today/this-week play time, remaining quota, next allowed window, recent events — read from the Hub.
- **Grant bonus time** / **Lock now** / **Pause** / **Extend today** — PIN-gated, sent to the Hub.
- **Request more time** (child-initiated, no PIN): fires `MORE_TIME_REQUESTED`; parent approves from Android/Web; approval flows back as a command. The validated Xbox in-flow pattern ([01](01-research-findings.md) §C).
- **Settings:** schedule editor (PIN-gated) as a convenience; the canonical editor is the Web UI.

The agent's home screen is what `launch.ini default` boots into; from there the child can launch the real dashboard/loader **only if state is ALLOWED**. If LOCKED, only the lock screen + "request more time" + parent-PIN unlock are reachable.

## 4.5 Lock screen
Full-screen, non-dismissible overlay rendered by the plugin: shows reason ("Bedtime until 7:00 AM", "Daily limit reached", "Locked by parent", "Can't verify time — ask a parent"), a **request-more-time** button, and a hidden parent-PIN entry (button combo to reveal, like the validated SMC reset combo pattern but verified against the Hub). No path to a game from here.

## 4.6 Force-close mechanics (validated)
`XLaunchNewImage(default_dashboard_xex, NULL)` from the plugin terminates the active title and returns to the agent home/dashboard ([01](01-research-findings.md) §A3). The agent then asserts LOCKED. Guard against title-relaunch loops with `fatalreboot`-style handling. (Note: NOVA has no documented kill verb — we use `XLaunchNewImage` directly, not an external API.)

## 4.7 Networking
- Primary: HTTPS client to the Hub (cert pinned at pairing). If TLS proves too heavy on the plugin, use the HMAC-signed plaintext LAN protocol ([10](10-security-threat-model.md) §10.6).
- Discover the Hub via mDNS query → cached IP → UDP broadcast → static config ([02](02-architecture.md) §2.8).
- Optional: the agent exposes a tiny read-only status endpoint (`:9970/status`) so the Android app can confirm the console directly if needed; all control still goes through the Hub.

## 4.8 Build & toolchain
- **Primary:** XDK/XeDK C/C++ (required for `PatchModuleImport`-style in-title hooking and the resident-plugin model). Licensing/acquisition is an open item ([12](12-risks-open-questions.md) R-01).
- **Fallback:** a libxenon implementation can cover Hub comms + a boot-time gate + lock, but **cannot** hook a running title — it would degrade the 360 to the Wii model (gate-only, no mid-game force-close). Use only if XDK is unavailable.

## 4.9 Acceptance criteria
- Agent is resident from boot and survives game launches (timer keeps counting during gameplay).
- Warnings render over a running game at the configured thresholds.
- At downtime/quota-zero in hard mode, the running game is force-closed and the lock screen appears.
- Soft mode nags + fires `PLAY_BEYOND_DOWNTIME` without killing the title.
- Clock rollback/power-unplug never grants extra time (monotonic + high-water enforced).
- Hub outage → cached enforcement, then fail-closed LOCKED after the grace window, unlockable by parent PIN.
- Agent + config survive an HDD wipe when NAND-baked.
</content>
