# ConsoleGate Android App

Parent remote control: auto-discovers the Hub on the LAN (no manual IP), mirrors
the Web UI (dashboard, quick actions, schedule, requests), and receives push
notifications for events. See [`../docs/implement/07-android-app.md`](../docs/implement/07-android-app.md).

## Modules

- **`shared/`** — a **pure-JVM Java library** (no Android dependency) holding the
  platform-independent logic: the `DiscoveryCoordinator` (mDNS → UDP → cache →
  manual ordering, retry, validation policy), a JSON reader, `Endpoint` parsing,
  and `HubModels` (response DTOs/parsers). **Host-unit-tested with a plain JDK** —
  no Gradle, no JUnit, no Android SDK required.
- **`app/`** — the Android app (Kotlin + Jetpack Compose): `DiscoveryManager`
  (NsdManager + UDP broadcast + manual, wired into the shared coordinator),
  `HubApi` (OkHttp REST + WebSocket, parsing via `shared`), `MainActivity`
  (Compose login + live dashboard), `CgMessagingService` (FCM push), `Prefs`
  (encrypted token/endpoint storage).

> **Build status.** The `shared` logic is implemented and **host-unit-tested
> (49 checks pass)**. The Android `app` requires the **Android SDK + Gradle +
> Kotlin** toolchain (only `adb` is present in the current dev environment — no
> `gradle`/`kotlinc`/SDK platforms), so it can't be compiled/run here; it's
> tracked as toolchain-blocked in
> [`../docs/implement/test-log.md`](../docs/implement/test-log.md). The discovery
> contract it relies on is verified Hub-side
> (`hub/src/discovery/discovery.test.ts`).

## Test the shared logic (no Android toolchain needed)

```powershell
./shared/run-tests.ps1
```

or directly:

```bash
cd android/shared
javac -Xlint:all -d build $(find src -name '*.java')
java -cp build com.consolegate.shared.TestMain
# -> android/shared: 49 checks, 0 failed
```

## Build the app (needs the Android toolchain)

```bash
cd android
./gradlew :app:assembleDebug      # requires Android SDK (compileSdk 34) + JDK 17
```

For FCM push, add a `google-services.json` and the `com.google.gms.google-services`
plugin (or switch to the UnifiedPush/ntfy backend — see
[`../docs/implement/03-hub.md`](../docs/implement/03-hub.md) §3.7).

## Discovery (verified policy)

The fallback order and retry/validation policy live in `shared`
(`DiscoveryCoordinator`) and are unit-tested (cache-hit, stale-cache→mDNS,
lossy-multicast retry, all-fail→manual, single-try manual). The Android sources
just feed candidates in:

1. **Cache** — last-known endpoint (fast path), validated by `GET /hello`.
2. **mDNS** (`NsdManager`, `_consolegate._tcp`) — MulticastLock held, resolves
   serialized to avoid the "listener in use" bug, retried (multicast is lossy).
3. **UDP broadcast** — `CG_DISCOVER?v1` → Hub responder (port 8099); reply parsed
   by `Endpoint.fromDiscoveryReply`.
4. **Manual IP** — last resort for AP-isolation / VLAN-separated networks.

## GATE 5 (on device — pending)

Procedure in [`../docs/implement/14-implementation-checklist.md`](../docs/implement/14-implementation-checklist.md)
§Phase 5: zero-IP discovery on a flat LAN; graceful fallback on an isolated LAN;
backgrounded `PLAY_BEYOND_DOWNTIME` push; approve "more time" from the
notification; control parity with the Web UI.
