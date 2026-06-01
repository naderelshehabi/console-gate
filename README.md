# ConsoleGate

An open-source parental screen-time control system for **JTAG/RGH Xbox 360** and
**softmodded Wii** consoles that boot homebrew (Homebrew Channel / USB Loader GX /
Dashlaunch).

A weekly schedule + daily time budget, graduated warnings before downtime, and
parent controls (grant bonus, lock now, approve "more time") from a console app,
a **local web UI**, or an **Android app** that auto-discovers the system on your
Wi‑Fi. Resists time tampering and makes any bypass **tamper-evident** (logged +
push-notified) even when it can't be prevented.

> Full design + validated research: [`docs/implement/`](docs/implement/README.md).
> Build/acceptance gates: [`docs/implement/14-implementation-checklist.md`](docs/implement/14-implementation-checklist.md).

## Architecture

A required always-on **Hub** is the single source of truth (authoritative clock,
schedule, quota, signed event log). Consoles and apps are clients.

```
            ┌─────────────── Hub (Docker, on an always-on Win/Mac) ───────────────┐
            │ authoritative time · schedule · quota · signed log · web UI · push  │
            └───▲────────────▲───────────────▲───────────────▲────────────────────┘
        poll/heartbeat   poll/gate        WS + REST       discover + control
                │            │                │                  │
          Xbox 360       Wii gate         Browser            Android app
          plugin         (.dol)           (Web UI)           (Kotlin)
```

| Component | Path | Tech | Status |
|---|---|---|---|
| **Hub** | [`hub/`](hub) | Node 22 + TypeScript | ✅ built + tested (103 tests) |
| **Web UI** | [`hub/web/`](hub/web) | vanilla JS (served by Hub) | ✅ built + tested |
| **Shared agent core** | [`agent-core/`](agent-core) | portable C99 | ✅ built + tested (142 checks) |
| **Xbox 360 agent** | [`agent-360/`](agent-360) | XDK plugin (`#ifdef _XBOX`) | ⚙ logic tested; XDK build pending hardware |
| **Wii agent** | [`agent-wii/`](agent-wii) | devkitPPC/libogc (`#ifdef __wii__`) | ⚙ logic tested; devkitPPC build pending hardware |
| **Android app** | [`android/`](android) | Kotlin + pure-JVM `shared` (49 checks) | ⚙ shared logic tested; APK build pending Android SDK |

The console agents and Android app keep all platform-independent logic in
host-tested modules (`agent-core`, `android/shared`); only the thin platform glue
needs the console/SDK toolchains. See [`docs/implement/test-log.md`](docs/implement/test-log.md)
for exactly what is verified vs. hardware-blocked.

## Quick start (Hub)

```bash
cd hub
docker compose up -d              # or: npm install && npm start
# open http://<this-host>:8088/  -> set a parent PIN, then pair consoles/app
```

Configuration: [`hub/consolegate.example.yml`](hub/consolegate.example.yml) or
`CG_*` env vars. Parent install guide:
[`docs/implement/13-parent-setup-guide.md`](docs/implement/13-parent-setup-guide.md).

## Run all tests

```bash
./run-all-tests.ps1      # Windows PowerShell
./run-all-tests.sh       # bash (Linux/macOS/Git-Bash)
```

This runs the Hub suite (`node:test`), the `agent-core` C suite (gcc), and the
`android/shared` JVM suite (javac/java) — no Gradle/Android SDK/console toolchains
required for the host-testable layers.

## Security model (honest)

ConsoleGate is **tamper-evident, not tamper-proof**. A child with the same
console-modding tools can ultimately reflash NAND — but the system is built so
that (a) clock changes/reboots can only ever *cost* play time, never grant it, and
(b) no bypass happens silently: killing the agent, pulling the network, or playing
past downtime all raise parent-visible events/pushes. LAN traffic from the
constrained consoles is HMAC-signed (no TLS needed). Details:
[`docs/implement/10-security-threat-model.md`](docs/implement/10-security-threat-model.md).

## Status

Work in progress on the `develop` branch. Phases 1–6 implemented and tested;
Phase 7 (packaging/acceptance) in progress. Hardware acceptance gates (real
360/Wii, on-device Android) are pending physical hardware.
