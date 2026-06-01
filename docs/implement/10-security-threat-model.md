# 10 — Security & Threat Model

## 10.1 Attacker

A **tech-savvy child with full physical access** to the console and the same modding tools the parent used (JTAG/RGH flasher, J-Runner/xeBuild; Wii: HBC, BootMii, Priiloader, WAD managers, NAND dumps). They can read public wikis (wiibrew, gbatemp, se7ensins). They control the LAN as an ordinary client but not the Hub host (assumed in a location/account the child can't administer).

**Honest thesis (validated — [01](01-research-findings.md) §E, [09](09-time-and-tamper.md)):** you cannot make this tamper-*proof*. A child who controls the flash can ultimately remove any on-device agent (worst case: restore a clean NAND dump). The achievable, valuable goals are:
1. **Raise the bar** above the child's current skill/effort.
2. **No silent bypass** — every defeat leaves parent-visible evidence.
3. **No time gained by tampering** — clock/power/network attacks can only restrict.

## 10.2 Asset list

- Authoritative time, schedule, quota state, parent secret, signed event log (all on the Hub — the trust anchor is **off** the console by design).
- Console agent integrity (boot-gate + residency).
- Device tokens, transport integrity on the LAN.

## 10.3 Threats → mitigations → residual

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Roll clock back to re-enter window / undo expiry | High-water-mark detection → untrusted-time → LOCKED; quota uses monotonic deltas | none for *time gain*; tamper logged |
| T2 | Set clock forward to fake a new day | Quota resets only on Hub-confirmed boundary; play counter is wall-clock-independent | none |
| T3 | Unplug 360 to reset unbatteried RTC | Default clock = untrusted-time → LOCKED | inconvenience only |
| T4 | Kill/remove the agent | Heartbeat dead-man's switch → `AGENT_OFFLINE` push; next session LOCKED | detectable, not preventable |
| T5 | Pull SD (Wii) / wipe HDD (360) | Agent + config in **NAND** | NAND reflash still possible (T9) |
| T6 | Bypass boot gate (360 button/`RBump`; Wii hold-RESET → Priiloader) | Strip 360 escape slots; Wii real secret in agent, not Priiloader; menu access = evidence event | Priiloader BackDoor defeats Priiloader PIN → mitigated by agent-held secret + evidence |
| T7 | Pull the Hub / cut network for "free time" | Fail-closed after grace window → LOCKED; agent-side PIN unlock; `HUB_UNREACHABLE`/`AGENT_OFFLINE` evidence | brief grace-window play only; visible |
| T8 | Backup/restore the console state store to undo high-water | Authoritative anchor lives on the **Hub**, not the console; console store is corroborated, not trusted | reduced to T9 |
| T9 | Full NAND reflash / clean-dump restore | Out of software reach | **accepted** — heartbeat gap → push; parent informed; re-provision needed |
| T10 | Tamper with the Hub event log | HMAC + hash chain; `LOG_INTEGRITY_FAIL`; standby replica copy | needs Hub-host admin (assumed out of child's reach) |
| T11 | Spoof the Hub / MITM on LAN | Cert pinning at pairing (HTTPS) or HMAC-signed protocol + nonce/ts replay guard | LAN attacker can't forge without device key |
| T12 | Replay old "unlock"/"grant" commands | Commands carry `nonce`+`ts`; agent acks once; bounded by authoritative time skew | none |
| T13 | Steal a device token | Tokens are per-device, revocable from Web UI; privileged ops still need parent PIN | revoke on suspicion |
| T14 | Brute-force the parent PIN | Argon2id + rate-limit + lockout on Hub and agent | use a non-trivial PIN |
| T15 | Defeat Priiloader password (BackDoor `1,2,2,2,2`) | Don't rely on it; real secret in agent; menu entry = `PRIILOADER_ACCESS` evidence | tamper-evident only |

## 10.4 Hardening the 360 boot config

- Set `launch.ini default` to the agent; **remove button-launch slots** and neutralize `RBump`'s return-to-MS-dash so there's no held-button bypass ([01](01-research-findings.md) §A2).
- Disable FTP/known file managers on the hardened profile, or PIN-gate them, so the agent/config can't be edited live.
- Bake agent + `launch.ini` into NAND (xeBuild) for the hardened deployment.

## 10.5 Hardening the Wii boot config

- Priiloader **Autoboot = agent**, **Return-To = Autoboot**; gate the System Menu behind the agent.
- Deploy the agent as a **NAND channel** so SD removal doesn't disable it.
- Set a Priiloader password for friction (knowing it's BackDoor-defeatable) and rely on the agent-held secret + evidence events for real control.

## 10.6 Transport on constrained consoles

TLS may be impractical inside the 360 plugin / Wii `.dol`. The LAN-only fallback is **HMAC-SHA256-signed plaintext JSON** with `nonce`+`ts` replay protection and the device key established at pairing (§8.4). This authenticates and integrity-protects messages on the trusted home LAN without a full TLS stack; the Web/Android surfaces use real HTTPS. Decision recorded as an open item ([12](12-risks-open-questions.md) R-04).

## 10.7 Privacy

- All data stays on the LAN/Hub except optional push (FCM/ntfy). A no-cloud deployment (self-hosted ntfy, LAN-only) is supported for users who don't want any third party; documented tradeoff is off-LAN notifications.
- The event log records play sessions and tamper signals — surfaced to parents only; protect the Hub host accordingly.

## 10.8 Set expectations with the parent

[13](13-parent-setup-guide.md) states plainly: this is a strong deterrent and a complete tamper-evidence system, **not** an unbreakable lock. The most determined bypass (NAND reflash) is detectable but not preventable; the system's real power is that the parent always finds out.
</content>
