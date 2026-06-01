# ConsoleGate Wii Agent (`cg_gate`)

The Wii gatekeeper: Priiloader autoboots it before the System Menu; it talks to
the [Hub](../hub), enforces the schedule/quota at the **launch gate**, and
reconciles play time when the child returns from a game. The Wii **cannot stop a
running game** (see [`../docs/implement/05-console-wii.md`](../docs/implement/05-console-wii.md)),
so enforcement happens at launch and overage becomes a logged + pushed event.

## Code layout

- **[`../agent-core/`](../agent-core)** — portable, **host-tested** C: protocol
  encode/parse (`cg_proto`), decision logic (`cg_agent`: time-trust, won't-finish
  guard, session accounting, command handling), and a small JSON reader
  (`cg_json`). Shared with the Xbox 360 agent. `cd ../agent-core && make test`.
- **`platform/`** — the thin Wii/libogc layer (this package): `main.c` (gate
  flow), `net.c` (HTTP + UDP discovery), `store.c` (SD/NAND persistence). Builds
  only with devkitPPC.

> **Build status:** the portable core is fully implemented and **host-unit-tested
> (78 checks passing)**. The `platform/` layer and the on-hardware **GATE 3** test
> require the devkitPPC toolchain and a physical softmodded Wii, which are not
> available in the current dev environment — they are tracked as hardware-blocked
> in [`../docs/implement/test-log.md`](../docs/implement/test-log.md).

## Prerequisites

Install [devkitPro](https://devkitpro.org/wiki/Getting_Started) and, via
`dkp-pacman`, the packages: `wii-dev` (pulls `devkitPPC`, `libogc`, `libfat-ogc`,
`wiiload`). Also provide a `cg_run_dol()` DOL-loader (the standard
devkitPPC "load .dol and exec" routine, e.g. from the libogc examples) — see the
integration note in `platform/main.c`.

## Build

```bash
cd agent-wii
make            # -> cg_gate.dol
```

## Install on the Wii (parent, one-time)

1. **Priiloader** must be installed (it lives in NAND, before the System Menu).
2. Copy `cg_gate.dol` to the SD card as the Priiloader install file, then in
   Priiloader: **Install File** → select it, and set **Autoboot = Installed File**.
   The Wii now boots into ConsoleGate first.
3. In **USB Loader GX / WiiFlow**, set **Return To = ConsoleGate** so exiting a
   game returns to the gate (which then reconciles the session).
4. For tamper resistance, also install `cg_gate` as a **NAND channel (WAD)** so
   removing the SD card doesn't disable it (the agent then persists to its save
   data instead of `sd:/apps/consolegate/`).
5. First boot shows a pairing prompt: generate a code in the Hub Web UI
   (**System › Generate pairing code**) and enter it on the Wii.

See [`../docs/implement/13-parent-setup-guide.md`](../docs/implement/13-parent-setup-guide.md)
for the full hardening checklist (Priiloader password, hold-RESET caveat, etc.).

## How it maps to the Hub API

| Step | Hub endpoint |
|---|---|
| Pair | `POST /api/v1/pair/claim` |
| Discover | UDP `CG_DISCOVER?v1` → Hub responder (port 8099) |
| Poll (time/state/commands) | `POST /api/v1/agent/poll` |
| Ack a command | `POST /api/v1/agent/command/ack` |
| Start a session at the gate | `POST /api/v1/agent/session/start` |
| Reconcile on return (+ overage) | `POST /api/v1/agent/session/end` |
| Parent-PIN unlock at the console | `POST /api/v1/unlock/verify` |

## GATE 3 (on hardware — pending)

The acceptance procedure is in
[`../docs/implement/14-implementation-checklist.md`](../docs/implement/14-implementation-checklist.md)
§Phase 3: LOCKED prevents launch; won't-finish guard warns/blocks; voluntary exit
reconciles quota; overage emits `PLAY_BEYOND_DOWNTIME`; clock rollback locks; the
NAND-channel build survives SD removal.
