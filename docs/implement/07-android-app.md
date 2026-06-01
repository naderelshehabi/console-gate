# 07 — Android App

> **Implementation status (Phase 5 — logic complete + tested).** Split like the console agents: the platform-independent client logic is a **pure-JVM Java module** [`android/shared/`](../../android/shared) — the `DiscoveryCoordinator` (ordering/retry/validation policy), a JSON reader, `Endpoint` parsing, and `HubModels` response DTOs/parsers — **host-unit-tested with a plain JDK (49 checks pass, `javac -Xlint:all` clean)**, no Gradle/Android SDK needed. The Kotlin/Compose app [`android/app/`](../../android/app) (`DiscoveryManager` over NsdManager+UDP, `HubApi` over OkHttp+WebSocket, `MainActivity`, `CgMessagingService` for FCM, `Prefs`) wires Android APIs into it. Building the APK + on-device **GATE 5** require the Android SDK + Gradle + Kotlin (only `adb` is present here) — toolchain-blocked ([test-log.md](test-log.md)). The discovery contract is verified Hub-side (`hub/src/discovery/discovery.test.ts`). Full Compose schedule/requests/analytics screens + actionable-notification buttons are finished in the device build.

Native Kotlin app for parents: discovers the Hub automatically, mirrors the Web UI functions, and receives push notifications for events (the user's explicit requirement). It talks to the **Hub**, which already knows every console — so the parent never types an IP.

## 7.1 Stack

- Kotlin, min SDK ~24, target current. Jetpack Compose UI.
- `NsdManager` for discovery; OkHttp (REST) + OkHttp WebSocket (live). Coroutines/Flow for state.
- Push: **FCM** (default, reliable background + off-LAN) or **UnifiedPush/ntfy** (no-Google option) — matches the Hub's configured backend ([03](03-hub.md) §3.7).
- Local cache (DataStore/Room) of last-known Hub address, paired console list, and recent events for offline viewing.

## 7.2 Screens (parity with Web UI)

- **Dashboard** — per-console state cards, today/this-week play, remaining quota, next window, agent health; live via WebSocket.
- **Schedule editor** — weekly windows + daily quota per console; enforcement mode; thresholds.
- **Quick actions** — Grant bonus, Extend today, Lock now, Pause/Resume, Unlock (PIN-gated).
- **Requests** — approve/deny "more time" with one tap (also actionable directly from the push notification).
- **Activity & events** — timeline + analytics; tamper-evidence events highlighted.
- **Devices / System** — pairing (scan QR from Web UI), time status + refresh, push status.

## 7.3 Discovery (validated approach — [01](01-research-findings.md) §D)

Layered, because home networks vary:

1. **mDNS/DNS-SD via `NsdManager`** (primary): discover `_consolegate._tcp`, resolve to host+port.
   - Acquire `WifiManager.MulticastLock` before discovery; release after (battery).
   - **Serialize `resolveService()` calls** (only one in flight) or use `registerServiceInfoCallback()` on API 34+ to avoid the documented listener-in-use failure.
   - Treat multicast as **lossy** → retry discovery a few times before falling back.
2. **UDP broadcast probe** (fallback): send a small `CG_DISCOVER?` datagram to the subnet broadcast on a fixed port; the Hub replies with `{host, port, hubId}`. Survives flaky mDNS stacks.
3. **Cached last-known IP** (fast path): try the cached address first on launch; validate with a `GET /api/v1/hello`.
4. **Manual IP entry** (last resort): required on networks with **AP/client isolation** or VLAN/band separation, which break all LAN discovery. Show a helpful diagnostic ("phone and Hub must be on the same Wi-Fi network; guest/AP-isolation networks block discovery").

Once the Hub is found, the app fetches the console list from the Hub — it does **not** need to discover each console separately.

## 7.4 Push notifications

- On pairing, register the FCM/UnifiedPush token with the Hub.
- The Hub pushes priority events: `PLAY_BEYOND_DOWNTIME`, `AGENT_OFFLINE`, `CLOCK_TAMPER_SUSPECTED`, `CONSOLE_POWERED_DURING_LOCK`, `MORE_TIME_REQUESTED`. Notifications are actionable (e.g. "Grant 15 min" / "Deny" from the `MORE_TIME_REQUESTED` push).
- When the app is foregrounded on-LAN, live updates come via WebSocket; the Hub dedupes so the parent doesn't get both ([03](03-hub.md) §3.7).
- Off-LAN delivery (parent at work) works only with a cloud-reachable backend (FCM, or an internet-exposed ntfy). LAN-only ntfy = notifications only when home; surfaced as a setup choice.

## 7.5 Auth

- Pair once via a code/QR from the Web UI → device token stored in Android Keystore-backed storage.
- Privileged actions require the parent PIN (verified by the Hub); the app can optionally cache PIN-unlock for a short, configurable window with biometric re-auth.

## 7.6 Acceptance criteria

- Finds the Hub on a flat home LAN with zero manual IP entry; falls back gracefully and offers manual IP on isolated networks.
- Dashboard live-updates within ~1s on-LAN.
- Quick actions reach the console within one poll interval.
- Receives a `PLAY_BEYOND_DOWNTIME` push within seconds (FCM) even with the app backgrounded.
- "More time" request is approvable directly from the notification.
- Functions are at parity with the Web UI.
</content>
