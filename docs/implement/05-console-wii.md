# 05 — Wii Agent (softmod)

> **Implementation status (Phase 3 — logic complete + tested).** Built as a split: the portable, **host-tested** decision/protocol logic lives in [`agent-core/`](../../agent-core) (shared with the 360 agent; 78 C-unit checks pass, cross-validated against a live Hub response), and the thin Wii/libogc glue (`cg_gate.dol`: gate flow, HTTP/UDP-discovery client, SD/NAND persistence, devkitPPC Makefile + install docs) lives in [`agent-wii/`](../../agent-wii). Compiling the `.dol` and the on-hardware **GATE 3** require devkitPPC + a physical Wii (hardware-blocked — [test-log.md](test-log.md)). The Hub-side overage/heartbeat-gap inference (§5.3) is slated for the Phase 6 watchdog.

The Wii is the constrained case. **A running game cannot be interrupted in software** ([01](01-research-findings.md) §B1) — once a game launches, the loader is gone and nothing resident survives. The agent therefore enforces at the **launch gate** and on **voluntary exit**, and turns an unavoidable overage into a logged + push-notified **event** rather than a forced stop. This is by explicit design decision (software-only, no smart plug).

## 5.1 Shape: a Priiloader-autobooted gatekeeper

```
Power on
  → Priiloader (NAND, before System Menu)        [01 §B2]
     → Autoboot = Installed file = cg_gate.dol
        → cg_gate (devkitPPC/libogc):
             1. discover + reach Hub, get {trusted_time, effective_state, quota}
             2. if LOCKED → show lock screen (PIN unlock / request-more-time); do NOT chain on
             3. if WARNING/ALLOWED → show status + budget, then chain to the game loader
                (USB Loader GX / WiiFlow), with "Return To" → cg_gate
  → child plays a game (agent NOT running)
  → child exits game (voluntary) → "Return To" returns to cg_gate
        → cg_gate computes elapsed session, decrements quota on Hub, re-evaluates state
```

Package `cg_gate` as a **NAND channel (WAD)** as well, so pulling the SD card doesn't disable it ([01](01-research-findings.md) §B6). Priiloader's "Installed file" can target the NAND-resident payload.

## 5.2 What the gate enforces

At each launch the gate asks the Hub for effective state and applies it **before** handing off:

- **LOCKED** (outside window / quota zero / lock-now / untrusted-time): refuse to chain; show lock screen. No game launches.
- **Won't-finish guard:** if `seconds_to_next_boundary < min_session` (configurable, e.g. 10 min) or quota remaining is below a floor, warn clearly: *"Bedtime in 8 min. The Wii can't stop a game for you — save and quit by 9:00 PM or it'll count as past bedtime."* Optionally refuse to launch (parent setting) so the child can't start a game guaranteed to overrun.
- **ALLOWED:** show remaining budget + next boundary, then chain to the loader with `Return To = cg_gate`.

## 5.3 Handling the inevitable overage (event, not force-stop)

Because the agent isn't running during the game, an overrun is detected two ways and always **logged + pushed**:

1. **At next gate (authoritative):** on the voluntary return, `cg_gate` compares session-start (persisted at launch) and the budget/window it handed out against authoritative Hub time. If the session ran past downtime or past quota, it fires `PLAY_BEYOND_DOWNTIME` with the measured overage, decrements/zeros quota, and may start the next period LOCKED.
2. **Heartbeat gap (real-time-ish signal):** before chaining, `cg_gate` records an `expected_return_by` hint to the Hub. If the Hub sees no return/heartbeat past that time, it raises `PLAY_BEYOND_DOWNTIME` (suspected) and pushes to Android, so the parent learns *during* the overrun, not only after. (The Hub cannot reliably ping the Wii during a game since most games drop networking — so the heartbeat-gap inference is the best real-time signal; documented honestly in [13](13-parent-setup-guide.md).)

This satisfies the requirement "playing beyond downtime → alert + log to all components" within the Wii's hard limits.

## 5.4 Pre-launch warnings

The gate shows the 60/30/15/5-style framing **at the gate** (since it can't overlay during play): a clear screen of how much time is left in the window and the day's quota, with the won't-finish guard above. If the loader supports a pre-game banner, surface remaining time there too (best-effort).

## 5.5 Time & trust on Wii

- The Wii has a battery RTC, but the clock is still user-settable (changes SYSCONF bias) ([01](01-research-findings.md) §B5) — so it stays untrusted. `cg_gate` fetches authoritative time from the Hub each boot/gate and can resync the local clock (SNTP precedent exists) for cosmetic correctness.
- Persist `{high_water_utc, minutes_used_today}` to NAND/SD; on backward clock jump → untrusted-time → LOCKED with parent-PIN unlock (fail-closed), same model as the 360 ([09](09-time-and-tamper.md)).
- Elapsed-play for a session is measured from gate-launch to gate-return using monotonic time where available, reconciled to Hub time, so clock games can't refund minutes.

## 5.6 Networking

- devkitPPC + **libogc** `net_*` (lwIP) — TCP/HTTP client to the Hub; "TCP Loader" proves a LAN server works, a client is simpler ([01](01-research-findings.md) §B4).
- Discover Hub via mDNS/UDP-broadcast/cached-IP/static, same chain as the 360.
- HMAC-signed plaintext LAN protocol is the likely transport (TLS on libogc is heavy); see [10](10-security-threat-model.md) §10.6.

## 5.7 Tamper realities & mitigations (documented for parents in [13](13-parent-setup-guide.md))

| Bypass (validated) | Mitigation | Residual risk |
|---|---|---|
| Hold **RESET** → Priiloader menu | Priiloader password (note BackDoor); real secret lives in `cg_gate`, and changing autoboot still lands you in `cg_gate` if it's the System-Menu path too | Priiloader BackDoor (`1,2,2,2,2`) defeats Priiloader's own PIN → **tamper-evident**: any settings-menu entry fires `PRIILOADER_ACCESS` event/heartbeat anomaly |
| Pull **SD card** | `cg_gate` as **NAND channel**; policy/state cached in NAND | If loader/games are on SD, removing it just prevents play (fails safe) |
| Change **clock** in Settings | Settings reachable only past the gate; untrusted-time → LOCKED | none beyond tamper-evidence |
| **NAND reflash** / restore clean dump | Out of reach of software | Accept; heartbeat gap → `AGENT_OFFLINE` push so the parent learns the console stopped reporting |

The honest posture: this deters an ordinary kid and makes a determined bypass **visible**, not impossible ([10](10-security-threat-model.md)).

## 5.8 Build & toolchain

- devkitPPC + libogc; `.dol` built and installed as Priiloader "Installed file" and as a NAND **WAD** channel (forwarder that carries its payload in NAND where size allows; otherwise NAND channel + SD payload, accepting SD-pull = no-play).
- Loader integration: configure USB Loader GX / WiiFlow **"Return To" = cg_gate** (or its forwarder) so exits re-enter the gate ([01](01-research-findings.md) §B3).

## 5.9 Acceptance criteria

- Autoboots `cg_gate` before the System Menu via Priiloader.
- LOCKED state prevents chaining to any game loader.
- Won't-finish guard warns (and optionally blocks) launches that can't complete before downtime.
- Voluntary exit returns to `cg_gate`, which decrements quota and re-evaluates against Hub time.
- Overage produces a `PLAY_BEYOND_DOWNTIME` event (push to Android) both via next-gate reconciliation and via heartbeat-gap inference.
- Clock rollback → LOCKED, parent-PIN unlock; no time refunded.
- Surviving SD removal when deployed as a NAND channel.
- Every Priiloader/Settings access produces a tamper-evidence event where detectable.
</content>
