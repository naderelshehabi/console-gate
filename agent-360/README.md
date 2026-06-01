# ConsoleGate Xbox 360 Agent (`cg_agent`)

The 360 is the strong case: a resident **Dashlaunch plugin** keeps running while a
game runs, so it can overlay graduated warnings during play and **force-close the
running title** at downtime via `XLaunchNewImage` (confirmed feasible:
[`../docs/implement/01-research-findings.md`](../docs/implement/01-research-findings.md) §A1/§A3).

## Code layout

- **[`../agent-core/`](../agent-core)** — portable, **host-tested** C shared with
  the Wii agent: protocol (`cg_proto`), decision logic (`cg_agent`), in-game
  enforcement (`cg_enforce`: graduated-warning scheduler, soft/hard action
  selector, monotonic minute accounting), HTTP helpers (`cg_http`), JSON
  (`cg_json`). **122 host C-unit checks pass.**
- **`plugin/`** — the thin XDK layer (this package): `main.c` (resident poll/warn/
  force-close loop), `net.c` (XNet/Winsock HTTP using `cg_http`), and
  `launch.ini.example`.

> **Build status.** The portable logic is implemented and **host-unit-tested**;
> the 360 orchestration in `plugin/main.c` + `plugin/net.c` **compiles cleanly on
> the host against agent-core** (non-XDK code paths — the platform code is under
> `#ifdef _XBOX`). Producing the actual `cg_agent.xex` requires the **Xbox 360 XDK**
> and the on-hardware **GATE 4** requires a JTAG/RGH console — both unavailable in
> the current dev environment (hardware-blocked; see
> [`../docs/implement/test-log.md`](../docs/implement/test-log.md)).

## Build (XDK)

Requires the Microsoft **Xbox 360 SDK (XeDK)** and its Visual Studio integration.
Build `plugin/main.c` + `plugin/net.c` + the `agent-core/src/*.c` into a plugin
XEX (`cg_agent.xex`) with `_XBOX` defined. (libxenon is a possible open fallback
but cannot hook a *running* title — that would degrade the 360 to the Wii
gate-only model; see [`../docs/implement/04-console-xbox360.md`](../docs/implement/04-console-xbox360.md) §4.8.)

Host compile-check of the non-platform paths (catches integration/type errors):

```bash
gcc -std=c99 -Wall -Wextra -Iagent-core/include -Iagent-360/plugin \
    -c agent-360/plugin/main.c agent-360/plugin/net.c
```

## Install (parent, one-time)

1. Copy `cg_agent.xex` to `Hdd:\cg_agent\` and the dashboard app to `Hdd:\cg_dash\`.
2. Merge `plugin/launch.ini.example` into your `launch.ini` (Dashlaunch): set the
   `default` to the ConsoleGate dashboard and add `cg_agent.xex` as `plugin1`.
3. **Harden:** remove button-launch slots, neutralise `RBump`, and for best
   tamper resistance **bake the plugin + launch.ini into NAND** (xeBuild/J-Runner)
   so an HDD wipe doesn't remove it.
4. Pair once from the dashboard app using a code from the Hub Web UI
   (**System › Generate pairing code**).

See [`../docs/implement/13-parent-setup-guide.md`](../docs/implement/13-parent-setup-guide.md).

## Enforcement behaviour

| State | Hard mode | Soft mode |
|---|---|---|
| WARNING | overlay at 60/30/15/5 min (`cg_warn_check`) | same |
| GRACE | save-countdown overlay | same |
| LOCKED (in game) | **force-close** → dashboard + `PLAY_INTERRUPTED` | persistent nag + `PLAY_BEYOND_DOWNTIME` |
| LOCKED (at dashboard) | lock screen, no game reachable | same |

Quota is decremented live from monotonic minute deltas while a game runs
(`cg_minutes_delta`) — clock-independent, so changing the 360 clock can't refund
time, and a long unplug (default clock) trips untrusted-time → LOCKED.

## `cg_dash` (parent-facing dashboard XEX)

The on-console dashboard (analytics, grant bonus, lock-now, request-more-time)
is a thin companion XEX that reuses `agent-core` + `net` and calls the same Hub
controller endpoints (PIN-gated) already covered by the Hub test suite. For this
milestone its functions are reachable from the plugin's lock screen / menu; it
can be split into a standalone `cg_dash.xex` without logic changes.

## GATE 4 (on hardware — pending)

Procedure in
[`../docs/implement/14-implementation-checklist.md`](../docs/implement/14-implementation-checklist.md)
§Phase 4: warnings render over a running game; hard-mode force-close; soft-mode
nag; rollback/unplug never grants time; NAND-baked agent survives an HDD wipe.
