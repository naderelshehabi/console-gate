# 09 — Time-Trust & Tamper Resistance

This is the core of the system's integrity. The design goal, stated plainly: **clock manipulation and reboots can only ever cost the child time, never grant bonus time**, and **no bypass happens silently**. Full tamper-proofing against an attacker with the same mod tools is impossible ([10](10-security-threat-model.md)); we aim for *raise-the-bar + tamper-evident*.

## 9.1 The four time signals (validated — [01](01-research-findings.md) §E)

| Signal | Property | Defeats | Weakness alone |
|---|---|---|---|
| (a) **Hub authoritative time** | trusted, off-console | all local clock games | needs Hub reachable |
| (b) **Monotonic counter** | can't go backward | clock-back during a session | resets on reboot/power-off |
| (c) **High-water-mark** persisted time | detects backward jumps | rollback across boots | snapshot/restore of the store |
| (d) **Accumulated-play counter** | wall-clock-independent | faking a new day to refill quota | needs trusted day-boundary to reset |

They interlock so each one's weakness is covered by another.

## 9.2 How they combine

- **Daily budget** is enforced by (d): minutes_used increments from (b) monotonic deltas while a game runs — it does **not** subtract wall-clock timestamps. Faking the clock forward doesn't refund minutes already spent.
- **Day rollover** (quota reset) happens only on a **Hub-confirmed** authoritative day boundary (a). The console never resets its own quota from its local clock.
- **Backward jump** (rolling the clock back to re-enter an allowed window or undo expiry) is caught by (c): if `local_clock < high_water_utc`, it's tampering → untrusted-time.
- **Reboot to reset the session counter** is covered because (d) is **persisted** to NV storage every ~60s and reloaded on boot; only a Hub-confirmed new day (or a parent action) resets it.

## 9.3 Per-console clock facts (drive the rules)

- **Xbox 360:** no battery RTC; after a power-unplug the clock resets to a **default** value ([01](01-research-findings.md) §A5). Rule: a default/implausibly-old clock reading = untrusted-time signal, not a loophole.
- **Wii:** battery RTC keeps time unplugged, but the clock is still user-settable via SYSCONF bias ([01](01-research-findings.md) §B5). Same untrusted-by-default treatment; resync from Hub.

## 9.4 The "untrusted-time" state

The agent (and the Hub's evaluator, §8.9) declares **untrusted-time** when any of:
- reported `local_utc_guess` < persisted `high_water_utc` (backward jump), or
- the console clock reads its default/post-reset value (360), or
- the Hub has been unreachable longer than `grace_window` (default 15 min) so authoritative time can't be confirmed.

**Untrusted-time → LOCKED (fail-closed)** with reason `cant-verify-time` and a **parent-PIN unlock**. The child cannot turn "I broke the clock / I pulled the network" into free play — at worst it locks. The transition itself is logged (`CLOCK_TAMPER_SUSPECTED`) and pushed to Android.

## 9.5 Fail-closed with a humane escape hatch

Fail-closed is correct for a parental tool (the safe state of a screen-time gate is *locked*). But it must mean **restricted with a parent-PIN unlock**, never "bricked":
- Brief Hub outage (< grace_window): keep enforcing the **cached policy** using (b)/(d). Play continues normally; events buffer.
- Outage past grace_window: LOCKED `HUB_UNREACHABLE`; parent PIN unlocks for a configurable window even fully offline (PIN can be verified against an agent-side Argon2id hash provisioned at pairing, so unlock works without the Hub).
- Real-world outages/power cuts therefore inconvenience but don't trap the family, while removing the "kill the Hub for free time" incentive.

## 9.6 Anti-disable layers (ordered by leverage)

1. **Boot-chain gating** — agent runs first (360 `launch.ini default`; Wii Priiloader autoboot). The console won't usefully reach a game without passing the gate ([04](04-console-xbox360.md) §4.2, [05](05-console-wii.md) §5.1).
2. **NAND residency** — agent + config in NAND, not removable storage, so SD/HDD wipes don't disable it ([01](01-research-findings.md) §A7, §B6).
3. **Strip escape hatches** — neutralize 360 `RBump`/button-launch slots; gate Wii Settings behind the agent.
4. **Watchdog / dead-man's switch** — agent heartbeats to the Hub; a gap (while the console isn't cleanly powered off) raises `AGENT_OFFLINE` and the Hub starts the next session LOCKED. Killing the agent trips the alarm instead of granting freedom.
5. **PIN-gated controls** — every menu that can change schedule/time/autoboot/enforcement needs the parent secret, held by the Hub (and an agent-side hash for offline unlock), never by Priiloader's defeatable password.

## 9.7 Tamper-evidence (the layer that actually holds)

Because on-device measures are ultimately defeatable, evidence is decisive:
- **Signed, hash-chained event log** on the Hub ([03](03-hub.md) §3.6): deletions/edits break the chain → `LOG_INTEGRITY_FAIL`.
- **Heartbeat-gap alerts** distinguish "cleanly powered off" (benign) from "active/on-network but agent silent" (suspicious) → `AGENT_OFFLINE` / `CONSOLE_POWERED_DURING_LOCK` pushes.
- **Clock-anomaly events** → `CLOCK_TAMPER_SUSPECTED` pushes ("clock set back", "booted with default clock").
- **Wii menu-access events** → `PRIILOADER_ACCESS` / `SETTINGS_ACCESS` where detectable.
- Net effect: a determined child can still win the technical fight, but **not quietly** — every defeat surfaces on the parent's phone, moving enforcement into the parent-child relationship where a parental tool's authority actually lives.

## 9.8 What this guarantees vs. doesn't

**Guaranteed:** clock changes, power-cycles, and Hub/network attacks can only ever restrict play, never grant bonus time; any tampering or agent-disable is detectable and surfaced to the parent.

**Not guaranteed:** prevention of a full NAND reflash / clean-dump restore by a child with the mod tools and the will to use them. That is out of reach of any on-device software and is handled by evidence + the social layer, not prevention ([10](10-security-threat-model.md)).
</content>
