# 01 — Research Findings (Validated)

Every load-bearing claim below was checked against primary or authoritative community sources. Confidence is marked **Confirmed** (multiple/primary sources agree), **Likely** (strong single source), or **Unconfirmed** (could not verify — flagged as a build-time risk). The plan never treats Unconfirmed items as true.

---

## A. Xbox 360 (JTAG/RGH)

### A1. A resident plugin can run during gameplay — **Confirmed**
Dashlaunch loads plugins via `launch.ini` `[Plugins]` slots `plugin1`–`plugin5`, each a XEX, loaded as resident system modules (`XexLoadImageFromMemory`). Plugins use `PatchModuleImport` to hook imported functions **inside running titles** — the entire Real-Time-Editing (RTE) / mod-menu ecosystem depends on plugin code executing inside a running game. A background timer thread that survives title launches is therefore feasible. **This is the architectural enabler for the 360.**
- https://www.se7ensins.com/forums/threads/hook-imported-xam-function-from-dashlaunch-plugin.1155959/
- https://www.se7ensins.com/forums/threads/jtag-rgh-how-to-setup-rte.868711/
- https://github.com/Byrom90/XeUnshackle/blob/main/Dashlaunch.cpp · https://github.com/InvoxiPlayGames/CoronaKeysFixPlugin

### A2. Force-launch a chosen app at boot — **Confirmed**
`launch.ini` `default` boots straight into any XEX before/instead of the dashboard. Per-button slots (`But_A`, …) can launch alternatives when a button is held — these are escape hatches to strip. `RBump` is a hardcoded slot that **always returns to the stock Microsoft dash** (must be neutralized for a tight lock).
- https://consolemods.org/wiki/Xbox_360:DashLaunch · https://www.xpgamesaves.com/threads/dash-launch-in-depth-explanation-and-set-up.50001/
- https://dev360.fandom.com/wiki/Launching_XEX_files

### A3. Force-close a running game — **Confirmed**
`XLaunchNewImage("…\\dashboard.xex", NULL)` terminates the current title and launches another — the standard "quit to dashboard" mechanism, callable from a resident plugin. So a **mid-game hard cutoff is achievable on the 360.** Dashlaunch also exposes `dvdexitdash`/`xblaexitdash`/`fatalreboot` behaviors and quick-launch button mappings.
- https://dev360.fandom.com/wiki/Launching_XEX_files

### A4. LAN networking / HTTP server — **Confirmed**
libxenon ships a full lwIP TCP/IP stack with an Ethernet driver. XeLL/XeLLous run an HTTP server; **Aurora ships "NOVA", an HTTP/REST server on port 9999 with JWT auth** — proof that a resident HTTP server on a modded 360 on the LAN is a shipped, working pattern. XDK apps can also use XBDM (RDCP over TCP 731) for remote reboot/launch.
- https://free60project.github.io/libxenon/enet_8c.html · https://github.com/jrobiche/xbox360-aurora-developer-documentation
- https://xboxdevwiki.net/Xbox_Debug_Monitor

### A5. Clock / RTC — **Confirmed (this is the weakest link)**
The 360 has **no battery-backed RTC**. The SMC keeps a 40-bit ms counter (epoch 2001-11-15) alive via a standby capacitor **only while plugged into AC**; after roughly minutes-to-2 hours off AC the clock resets to default. The clock is freely user-settable in Settings, and Xbox Live re-syncs it when online. **Any enforcement that trusts the local clock is trivially defeated** by a rollback or a power-pull → time must come from the Hub (see [09](09-time-and-tamper.md)).
- https://github.com/DerfJagged/TimeFixer · https://consolemods.org/wiki/Xbox_360:TimeFixer
- https://gamefaqs.gamespot.com/xbox360/927749-xbox-360/answers/28949

### A6. Build toolchain — **Confirmed**
Two paths in C/C++: **libxenon** (Free60, open, bare-metal, lower-level) and the **XDK/XeDK** (Microsoft, proprietary, full Xbox APIs — the typical toolchain for Dashlaunch plugins and `PatchModuleImport`). The production plugin path is XDK; an open fallback is libxenon. Decide early (see [04](04-console-xbox360.md)).
- https://github.com/Free60Project/libxenon · https://free60.org/Development/LibXenon/

### A7. Persistence — **Confirmed (raise-the-bar only)**
Plugins/apps and `launch.ini` normally live on HDD/USB (editable on any PC). The plugin module + `launch.ini` **can be baked into the NAND image** via xeBuild/J-Runner so they survive an HDD wipe and reflash on each boot — meaningfully harder to remove (requires NAND reflash, brick risk) but not impossible.
- https://gbatemp.net/threads/how-to-get-aurora-launching-from-hdd-instead-of-nand.593752/

### A8. Existing solutions — **Confirmed: none found**
No parental-control / screen-time / time-limit homebrew or Dashlaunch plugin exists for JTAG/RGH. The stock NXE **Family Timer** (daily/weekly limit, warnings at 1h/30/15/5 min, then shutdown) is a useful **UX reference only** — it isn't booted on custom dashboards and its passcode is resettable via the SMC config on a modded box.
- https://support.xbox.com/en-US/help/xbox-360/security/how-to-set-family-timer · https://consolemods.org/wiki/Xbox_360:Parental_Lock

---

## B. Wii (softmod: HBC + USB Loader GX / WiiFlow)

### B1. A running game CANNOT be interrupted — **Confirmed (decisive constraint)**
When USB Loader GX / WiiFlow launches a game, the loader exits and the game owns the console entirely. There is no multitasking and no resident background process that survives into the game to later force-close it. Even Nintendont (GameCube loader) has **no clean programmatic exit** — only the physical Power button. **Consequence: on Wii you can only enforce at the launch gate and capture *voluntary* exits; you cannot cut a child off mid-game.**
- https://github.com/FIX94/Nintendont/issues/120

### B2. Boot gate via Priiloader autoboot — **Confirmed**
Priiloader modifies NAND and runs **before** the System Menu. Its "Install file" + **Autoboot = Installed file** boots a chosen `.dol` first; "you can now only access the system menu through Priiloader". This is the Wii kiosk gate.
- https://wiibrew.org/wiki/Priiloader · https://wii.hacks.guide/priiloader-usage

### B3. Capturing game exits — **Likely**
USB Loader GX / WiiFlow have a **"Return To"** setting that patches the game's exit/HOME to return to a chosen forwarder/loader instead of the System Menu. Chained with Priiloader (Return-To = Autoboot), a *voluntary* game exit re-enters the gatekeeper, which then updates the budget. **Only fires when the child chooses to exit** — not at a deadline.
- https://wii.hacks.guide/priiloader.html

### B4. LAN networking — **Confirmed**
devkitPPC + **libogc** (C/C++) bundle an lwIP stack with BSD-style `net_*` sockets. "TCP Loader" runs a TCP server on the Wii (port 8080) — proof a LAN server is feasible from a `.dol`.
- https://github.com/devkitPro/libogc · https://wiibrew.org/wiki/TCP_Loader

### B5. Clock / RTC — **Confirmed**
The Wii **has a battery-backed RTC** (CR2032) that keeps running while unplugged unless the cell is dead. Real time = free-running RTC counter + a **bias stored in SYSCONF** (epoch 2000-01-01; libogc adds the Unix offset). **Setting the clock in Wii Settings changes only the bias.** The clock is still user-settable, so it remains untrusted for enforcement; resync from the Hub each boot.
- https://bugs.dolphin-emu.org/issues/371 · https://github.com/dolphin-emu/dolphin/pull/6824 · https://github.com/ErikAndren/sntp

### B6. Persistence — **Confirmed (weak-to-moderate)**
HBC apps live on SD/USB; Priiloader lives in NAND. Documented bypasses to design around: **hold RESET enters the Priiloader menu** even with autoboot; the **Priiloader password BackDoor** (Wiimote `1` then `2,2,2,2`) defeats Priiloader's own password; **pull the SD card**; full **NAND reflash**. → Package the gatekeeper as a **NAND channel (WAD)** so SD removal doesn't disable it, and hold the real secret in our own agent, never in Priiloader's password.
- https://wiibrew.org/wiki/Priiloader · https://gbatemp.net/threads/holding-reset-boots-priiloader.472615/ · http://gwht.wikidot.com/forwarder

### B7. Existing solutions — **Confirmed: none found**
No screen-time homebrew exists. The Wii's built-in parental controls are **content-rating only** (no time feature) and the PIN is trivially reset (forgotten-PIN code → wii.marcan.st/parental, or Multi-Mod Manager reveals it).
- https://en-americas-support.nintendo.com/app/answers/detail/a_id/1672/ · https://gbatemp.net/threads/wii-parental-controls-unlock.272171/

---

## C. UX patterns worth copying (from modern systems)

- **Graduated warnings before cutoff** (Xbox 360 Family Timer: 1h/30/15/5 min) — never a silent kill. **Confirmed.**
- **Two schedule axes**, both per-day-of-week: a **daily duration cap** *and* a **bedtime / allowed time-of-day window** (Nintendo Switch & Xbox both separate these). **Confirmed.**
- **Bonus time / "extend today"** granted by parent PIN, auto-resetting next day. **Confirmed.**
- **Soft vs hard enforcement toggle** (Switch: notify-only vs auto-suspend the game) — important because old-console games use manual saves. **Confirmed.** (On Wii only "soft" is possible — see B1.)
- **In-flow "request more time"** from the child → instant remote parent approval (Xbox). **Confirmed.**
- **Repeating/persistent alert at cutoff** that clears only on sleep/parent action (Switch). **Confirmed.**
- Sources: https://www.nintendo.com/us/mobile-apps/parental-controls/ · https://support.xbox.com/en-US/help/family-online-safety/online-safety/set-screen-time-limits

---

## D. Android LAN auto-discovery — **Confirmed (with documented gotchas)**

Recommended: **mDNS/DNS-SD via Android `NsdManager`** as primary, **UDP broadcast beacon** as fallback, **manual IP** as last resort.
- `NsdManager` (API 16+) uses DNS-SD over mDNS (UDP 5353 / 224.0.0.251). Flow: `discoverServices()` → resolve → host+port.
- **Gotchas:** must hold a `WifiManager.MulticastLock` to receive mDNS; the legacy `resolveService()` allows only one in-flight resolve (serialize them, or use `registerServiceInfoCallback()` on API 34+); Wi-Fi multicast is lossy → retry; **AP/client isolation** and band/VLAN separation break *all* LAN discovery → manual-IP fallback required.
- Sources: https://developer.android.com/develop/connectivity/wifi/use-nsd · https://developer.android.com/reference/android/net/wifi/WifiManager.MulticastLock · https://issuetracker.google.com/issues/37127704

---

## E. Time-tamper & anti-disable engineering — **Confirmed principles**

- The device clock is attacker-controlled input. Combine: **(a)** external authority (the Hub / NTP), **(b)** monotonic session counter (immune to clock-back but resets on reboot), **(c)** persisted **high-water-mark** time to detect backward jumps, **(d)** a wall-clock-independent **accumulated-play counter** for the daily budget. Together, clock changes/reboots can only ever trigger *restriction*, never grant bonus time.
- Commercial DRM solves the identical problem this way (PlayReady "anti-rollback clock" = a clock periodically verified to have advanced; stored-time comparison detects rollback).
- **Fail-closed** is correct for a parental tool (a screen-time gate's safe state is *locked*), but must mean "restricted with a parent-PIN unlock", not "bricked".
- A small always-on **hub holding the authoritative clock + state off the console** is the proven pattern (Pi-hole serves LAN NTP + DHCP + RTC). Here the hub is a Docker container on the user's existing always-on machines.
- Tamper-**evidence** (heartbeat dead-man's switch, signed logs, parent alerts) is where the system earns its keep, since on-device tamper-proofing is ultimately defeatable.
- Sources: https://learn.microsoft.com/en-us/playready/features/trusted-clocks · https://patents.google.com/patent/US20020169974A1/en · https://docs.pi-hole.net/guides/misc/ntp/

---

## F. Unconfirmed / to validate during build (tracked in [12](12-risks-open-questions.md))

1. Exact 360 clock-retention time off AC (sources vary minutes–2h). Treat any default/rolled-back clock as "untrusted-time".
2. Whether a Wii forwarder can hold a **complete** payload in NAND with zero SD dependency (Likely, with NAND size limits).
3. NOVA has no documented "kill running title" REST verb — use `XLaunchNewImage` from our own plugin instead (Confirmed workaround).
4. Current status of `libwiisocket` (Likely usable; libogc `net_*` is the safe baseline).
5. XDK acquisition/licensing for the 360 plugin build (legal/practical) vs. an all-libxenon implementation.
</content>
