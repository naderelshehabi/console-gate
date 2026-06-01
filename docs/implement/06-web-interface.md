# 06 — Web Interface

Served by the Hub on the LAN; available whenever the Hub host is on (i.e. even when all consoles are off). It exposes the same functions as the Android app, in a browser, with no install.

> **Implementation status (Phase 2 complete).** Built as dependency-free vanilla JS under [`hub/web/`](../../hub/web), served by the Hub (`GET /` etc.). Implemented: PIN first-run + login (`POST /web/login`), live dashboard cards (WebSocket `/api/v1/stream`, with a 5 s polling fallback), schedule + flags editor, quick actions (grant/+15/lock/unlock/pause/resume), requests approve/deny, events timeline with **Verify log**, and a System tab (time status + **Refresh time now**, pairing-code generator, analytics). Auth model is PIN-based per §6.1: login returns a web **device token** (for reads) + a **PIN session** (for mutations). Deferred to later phases: the read-only-without-PIN dashboard option and push-backend configuration UI (push is Phase 7).

## 6.1 Access & auth

- URL: `https://<hub-host>:<port>/` (or `http://consolegate.local/` via mDNS hostname where the OS resolves it).
- First-run: set the **parent secret/PIN** and create the signing key (one-time setup wizard).
- Login: parent PIN unlocks privileged controls; a read-only dashboard can optionally be viewable without PIN on the LAN (configurable). Sessions are short-lived cookies; privileged mutations re-verify the PIN.
- Pairing console agents and the Android app is done here (shows pairing codes / QR — see [08](08-protocol-api.md) §8.3).

## 6.2 Screens

1. **Dashboard (home)** — per-console cards: current state (ALLOWED/WARNING/GRACE/LOCKED) with reason, time played today/this week, remaining quota, next allowed window, last-seen/heartbeat health. Live-updates via WebSocket.
2. **Schedule editor** — weekly grid per console (or shared): per-day allowed windows + daily quota; enforcement mode (soft/hard); warning thresholds; grace seconds; won't-finish guard (Wii). Validated UX: two axes (windows + quota), per-day-of-week ([01](01-research-findings.md) §C).
3. **Quick actions** — Grant bonus (minutes), Extend today, Lock now, Pause/Resume, Unlock — all PIN-gated; reflected to the console within one poll.
4. **Requests** — pending "more time" requests from consoles with one-click approve/deny ([01](01-research-findings.md) §C).
5. **Activity & events** — filterable event timeline (with tamper-evidence events highlighted) and analytics: daily/weekly play charts, busiest hours, overage incidents, agent-offline gaps. Backed by the rollup table ([03](03-hub.md) §3.6).
6. **Devices** — paired consoles + apps, agent versions, re-pair / revoke, per-console settings.
7. **System** — time status (`last_sync`, source, **Refresh time now** button → `POST /time/refresh`), push backend status, log integrity **Verify** button (re-checks the hash chain), backup/standby status.

## 6.3 Tech

- Server-rendered templates + a small amount of JS (htmx-style or a tiny SPA). Must run on the **older browsers** likely on the LAN; avoid bleeding-edge APIs. WebSocket for live updates with a polling fallback.
- All data via the same `/api/v1` contract the Android app uses ([08](08-protocol-api.md)) — the web UI is just another API client, keeping behavior identical across surfaces.

## 6.4 Acceptance criteria

- Reachable on the LAN while consoles are off.
- Dashboard reflects live console state via WebSocket within ~1s.
- Schedule edits and quick actions take effect on the console within one poll interval.
- Time-refresh and log-integrity-verify work from the UI.
- Functions are a strict superset-equal of the Android app (no drift).
</content>
