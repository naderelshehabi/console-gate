# 02 — System Architecture

## 2.1 Topology

```
                         Home LAN (same L2 segment)
   ┌──────────────────────────────────────────────────────────────────────┐
   │                                                                        │
   │   ┌─────────────────────────────┐                                      │
   │   │        ConsoleGate HUB       │   (Docker container on an always-on  │
   │   │  (authoritative authority)   │    Windows or Mac machine)           │
   │   │                              │                                      │
   │   │  • Authoritative clock       │◄───── internet NTP (when available)  │
   │   │    + local /time/refresh API │                                      │
   │   │  • Schedule / policy store   │                                      │
   │   │  • Quota & high-water state  │                                      │
   │   │  • Signed append-only log    │                                      │
   │   │  • Event bus + push dispatch │──────► FCM / ntfy ──► Android (off-LAN)│
   │   │  • REST + WebSocket API      │                                      │
   │   │  • Web UI (served here)      │                                      │
   │   │  • mDNS advertiser           │                                      │
   │   └──────┬───────────────┬───────┘                                      │
   │          │               │                                              │
   │   poll/heartbeat   poll/heartbeat        discover + control             │
   │          │               │                      │                       │
   │   ┌──────▼──────┐  ┌──────▼──────┐        ┌──────▼───────┐   ┌─────────┐ │
   │   │ Xbox 360    │  │ Wii          │        │ Android app  │   │ Browser │ │
   │   │ agent       │  │ gatekeeper   │        │ (Kotlin)     │   │ (Web UI)│ │
   │   │ (Dashlaunch │  │ (Priiloader  │        │ NsdManager   │   │         │ │
   │   │  plugin)    │  │  autoboot)   │        │ discovery    │   │         │ │
   │   └─────────────┘  └─────────────┘        └──────────────┘   └─────────┘ │
   └──────────────────────────────────────────────────────────────────────┘
```

## 2.2 The Hub is the single source of truth

All authoritative state lives on the Hub, never on a console:

- **Time** — the Hub's clock (synced from internet NTP, refreshable via a local API). Consoles never trust their own RTC for policy decisions.
- **Policy** — weekly schedule (per-day allowed windows + daily quota), bonus grants, lock/pause flags.
- **State** — remaining quota, high-water-mark time, per-console session state.
- **Log** — signed, append-only event history.

This placement is deliberate: keeping the anchor *off* the child's console defeats the "back up the datastore, roll back, restore" attack and survives a console NAND wipe ([09](09-time-and-tamper.md), [10](10-security-threat-model.md)). Because the Hub runs on hardware the user already keeps on 24/7, the web UI and Android app work even when every console is powered off.

### Why required, and why Docker on existing machines
A parent's phone is not a dependable always-on authority (it sleeps and leaves the house). The user has always-on **Windows and Mac** machines, so the Hub ships as a single cross-platform **Docker image**. One Hub instance is authoritative; the second machine can run a **warm standby** (read-replica of the log + policy) for resilience (optional, see [03](03-hub.md) §3.8).

## 2.3 Control plane vs enforcement plane

- **Control plane** (Hub ⇄ Android/Web): parents view dashboards and issue commands (grant bonus, lock now, edit schedule, approve "more time"). All privileged commands require the parent PIN/secret.
- **Enforcement plane** (Hub ⇄ console agents): agents poll the Hub for `{trusted_time, effective_policy, remaining_quota, commands}` on a short interval and emit heartbeats + events. Enforcement decisions are computed on the Hub and *applied* locally by the agent.

The agent keeps a **local fallback policy cache** so it still enforces correctly during a brief Hub outage, using its monotonic counters — then fails closed after a grace window ([09](09-time-and-tamper.md) §9.5).

## 2.4 The two consoles are asymmetric — design consequence

| Capability | Xbox 360 | Wii |
|---|---|---|
| Resident agent during gameplay | **Yes** (Dashlaunch plugin) | **No** (loader exits) |
| Force-close a running game at downtime | **Yes** (`XLaunchNewImage`) | **No** — gate at next launch only |
| On-screen warnings during play | **Yes** | Only at the launch gate / on exit |
| Detect "playing beyond downtime" in real time | **Yes** (agent is running) | **No** — reconstructed at next gate + heartbeat gap, then logged as an event |

The product behaves consistently where the hardware allows and **degrades honestly** on Wii: instead of a forced stop, an overage becomes a first-class **event** (logged everywhere + Android push), and the launch gate refuses to start a game that can't finish before downtime. This is documented for parents in [13](13-parent-setup-guide.md).

## 2.5 Enforcement model (shared)

Each console has, at any instant, an **effective state** computed by the Hub from the policy + clock + quota:

- `ALLOWED` — within an allowed schedule window **and** quota remaining > 0.
- `WARNING` — `ALLOWED` but within a warning threshold of a boundary (downtime or quota exhaustion). Drives the 1h/30/15/5-min overlays.
- `GRACE` — boundary passed; a short configurable grace to let the player save (360 shows a countdown; Wii only relevant at gate).
- `LOCKED` — outside allowed window, quota exhausted, "lock now", or untrusted-time/fail-closed. Console shows the lock screen; only a parent PIN or a Hub command unlocks.

State transitions and the warning schedule are defined in [08](08-protocol-api.md) §8.6.

## 2.6 Time-trust model (summary; full detail in [09](09-time-and-tamper.md))

1. The Hub holds authoritative wall-clock time.
2. The agent measures **elapsed play** with a monotonic counter (immune to clock-back) and persists a **high-water-mark** time + accumulated minutes to non-volatile storage.
3. On each poll the agent reconciles with the Hub; if the local clock is < high-water-mark, or the Hub is unreachable past the grace window, the agent enters **untrusted-time → LOCKED** (fail-closed).
4. Net guarantee: **clock changes and reboots can only ever cost the child time, never grant bonus time.**

## 2.7 Event system (cross-cutting)

A single event taxonomy ([08](08-protocol-api.md) §8.7) flows: agent/Hub → Hub event bus → (a) signed log, (b) WebSocket fan-out to connected Web/Android clients, (c) background push (FCM or self-hosted ntfy) to the Android app. Tamper-relevant events (`PLAY_BEYOND_DOWNTIME`, `AGENT_OFFLINE`, `CLOCK_TAMPER_SUSPECTED`, `CONSOLE_POWERED_DURING_LOCK`) are push-priority so the parent learns of any bypass attempt.

## 2.8 Discovery flow

1. Hub advertises `_consolegate._tcp` (instance `ConsoleGate Hub`, TXT: version, hubId, api path) via mDNS.
2. Console agents discover the Hub the same way (mDNS query), falling back to a cached IP, then a UDP broadcast probe, then a configured static IP.
3. Android app uses `NsdManager` to find the Hub (MulticastLock held, resolves serialized, retry on lossy multicast); falls back to UDP broadcast, then manual IP. Once found, the app talks only to the Hub, which already knows every console — so the user never types an IP. See [07](07-android-app.md) §7.3.

## 2.9 Trust & auth boundaries

- **Device pairing:** each agent and each app instance pairs with the Hub once (out-of-band code shown in the Web UI) and receives a long-lived device token. See [08](08-protocol-api.md) §8.3.
- **Parent secret:** privileged actions (edit schedule, grant bonus, unlock, disable enforcement) require the parent PIN, verified by the Hub — never stored on a console.
- **Transport:** HTTPS with a Hub-generated self-signed CA; agents/apps pin the Hub cert at pairing. On the constrained consoles, if TLS is impractical, fall back to an HMAC-signed plaintext protocol on the LAN (see [10](10-security-threat-model.md) §10.6).

## 2.10 Technology choices (rationale in each component doc)

| Layer | Choice | Why |
|---|---|---|
| Hub | **Node.js 22 + TypeScript** (implemented; run via `tsx`) | Go was the original default but is unavailable in the target build environment; the plan sanctioned Node/TS, which also shares the JVM/Kotlin world with the Android app. Strong built-ins for HTTP/UDP-SNTP/crypto. |
| Hub storage | **Atomic file-backed `Store`** (state) + append-only signed JSONL (events) | Implemented dependency-free behind a `Store` interface so SQLite can be swapped in later without touching services; right scale for a handful of consoles; trivial backup/standby replication. |
| Web UI | Server-rendered + light JS (or a small SPA) | Hosted by Hub, works on old browsers on the LAN |
| 360 agent | XDK C/C++ Dashlaunch plugin (+ libxenon fallback) | Only path to in-game residency + `XLaunchNewImage` |
| Wii agent | devkitPPC + libogc `.dol`, packaged as NAND channel | Priiloader autoboot target; survives SD removal |
| Android | Kotlin, NsdManager, OkHttp/WebSocket, FCM (or ntfy/UnifiedPush) | Native discovery + reliable background push |

See [11](11-roadmap-milestones.md) for the order in which these are built and validated.
</content>
