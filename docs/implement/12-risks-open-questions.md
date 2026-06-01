# 12 — Risks & Open Questions

Tracked items that are **Unconfirmed** or need a build-time decision. Each must be resolved by an M0 spike or early in its milestone — none are assumed-true in the plan.

| ID | Risk / question | Impact | Plan to resolve | Fallback |
|---|---|---|---|---|
| **R-01** | XDK/XeDK acquisition & licensing for the 360 plugin (legal/practical) | High — gates full 360 in-game enforcement | M0 S1: attempt the plugin on XDK; investigate libxenon plugin viability | libxenon **gate-only** 360 (no mid-game force-close; degrades 360 to Wii model) |
| **R-02** | Can a Dashlaunch plugin reliably keep a background thread + overlay across *arbitrary* commercial titles (not just RTE-friendly ones)? | High | M0 S1 across several real games | Enforce at title-launch boundary only (hook the launcher, not in-title) |
| **R-03** | Docker Desktop on Win/Mac does not pass host mDNS into the bridge network | High — breaks zero-config discovery | M0 S3: test `--network host`, a host mDNS reflector, or published UDP 5353 | Make **UDP-broadcast discovery primary**; mDNS best-effort; manual IP always available |
| **R-04** | TLS feasibility inside the 360 plugin / Wii `.dol` | Medium | Spike a TLS client on each; measure footprint | HMAC-signed plaintext LAN protocol ([10](10-security-threat-model.md) §10.6) |
| **R-05** | Wii: can a forwarder hold the **complete** agent payload in NAND with zero SD dependency? | Medium — affects SD-pull resistance | M3: size the payload vs NAND space | NAND channel + SD payload; SD-pull = no-play (fails safe), still acceptable |
| **R-06** | Off-LAN push without Google (privacy) — ntfy must be internet-reachable | Medium | Decide deployment: FCM vs self-hosted ntfy vs LAN-only | Default FCM; document LAN-only ntfy limitation |
| **R-07** | Exact 360 clock-retention off AC (minutes vs ~2h) | Low | Empirical test on the target unit | Treat any default/old clock as untrusted regardless |
| **R-08** | Priiloader password BackDoor + hold-RESET cannot be removed | Low (by design) | N/A — rely on agent-held secret + evidence events | Tamper-evident posture ([10](10-security-threat-model.md) T6/T15) |
| **R-09** | Heartbeat-gap inference on Wii (Hub can't ping during a game) reliability | Medium — affects real-time overage alerts | M3: tune `expected_return_by` + gap thresholds to limit false positives | Authoritative detection at next gate always fires; heartbeat-gap is the "early warning" best-effort |
| **R-10** | NAND reflash / clean-dump restore defeats everything | Accepted | N/A | Detect via `AGENT_OFFLINE`; inform parent; re-provision |
| **R-11** | Parent-PIN offline unlock on the agent requires provisioning an Argon2id hash to the console | Low | M4/M3: provision at pairing; rotate on PIN change | Online-only unlock if offline hash deemed too risky to store |
| **R-12** | libwiisocket current status | Low | Use libogc `net_*` baseline | n/a |
| **R-13** | Old LAN browsers for Web UI (feature support) | Low | Keep UI to widely-supported HTML/JS; polling fallback for WS | Server-rendered, minimal JS |
| **R-14** | Standby Hub split-brain on grants/writes | Low | Primary-only writes; standby read-only; queue + reconcile | Manual failover documented |

## Decisions already made (not open)

- Hub required, Docker on existing Win/Mac. Software-only (no smart plug). Fail-closed + parent PIN. Event system with Android push. Local time-refresh API. (See [README](README.md) and memory `consolegate-architecture-decisions`.)

## Explicitly out of scope (from the brief)

- Enabling/disabling specific games. iOS/macOS/Windows apps. Support for consoles other than JTAG 360 and softmod Wii.
</content>
