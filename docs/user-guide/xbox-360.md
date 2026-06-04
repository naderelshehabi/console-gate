# Installing ConsoleGate on a JTAG/RGH Xbox 360

Step-by-step instructions for a parent to install the ConsoleGate agent on a
**JTAG or RGH (Reset Glitch Hack) modded Xbox 360**. When you're done, the console
boots into ConsoleGate first, enforces your schedule and daily time limit, shows
warnings before time runs out, and can close a running game at downtime.

> **Read this first:** ConsoleGate is **tamper-evident, not tamper-proof**. A
> child with the same modding tools can eventually remove on-console software — but
> the system is built so that if they do, **you get an alert** ("agent stopped
> reporting"), and so that changing the clock or unplugging the console can only
> ever *cost* play time, never grant it. See
> [the threat model](../implement/10-security-threat-model.md) for the honest details.

---

## 1. Before you begin

You need:

1. **A JTAG or RGH Xbox 360** that already boots a custom dashboard (Aurora,
   Freestyle Dash, or XeXMenu) with **Dashlaunch** installed. This guide does **not**
   cover modding the console itself — if your 360 is still stock, follow a standard
   RGH/JTAG guide first (e.g. consolemods.org), then come back here.
2. **The ConsoleGate Hub running** on an always-on computer on your home network.
   If you haven't set it up yet, do the [Hub setup](../implement/13-parent-setup-guide.md)
   first — it takes about 5 minutes with Docker. Note the Hub's address, e.g.
   `http://192.168.1.50:8088/`.
3. **The 360 and the Hub computer on the same Wi-Fi/LAN** (not a guest network).
4. A way to copy files to the console — an FTP client, a USB stick, or the
   console's own file manager.

You will install two pieces:

| File | Goes to | What it does |
|---|---|---|
| `cg_agent.xex` | `Hdd:\cg_agent\` | The resident plugin: timer, warnings, force-close, lock screen |
| `cg_dash` (a `default.xex`) | `Hdd:\cg_dash\` | The on-console screen for pairing, the dashboard, and "ask for more time" |

---

## 2. Get the ConsoleGate files

You have two options:

- **Prebuilt release (preferred when available):** download the Xbox 360 package
  from the project's releases and unzip it. You'll get `cg_agent.xex` and the
  `cg_dash` folder.
- **Build from source:** ConsoleGate's 360 agent is built with the Xbox 360 XDK.
  Follow [`agent-360/README.md`](../../agent-360/README.md). The shared logic is in
  [`agent-core/`](../../agent-core/README.md).

Keep the files on your computer for now.

---

## 3. Copy the files onto the console

1. Turn on the 360 and let it boot to your dashboard.
2. Using FTP (or a USB stick), create these folders on the internal hard drive and
   copy the files in:
   - `Hdd:\cg_agent\cg_agent.xex`
   - `Hdd:\cg_dash\default.xex`  (plus any files that came in the `cg_dash` folder)
3. Leave the console on for the next steps.

> Tip: most custom dashboards show the hard drive as `Hdd:` and a USB drive as
> `Usb:`. If you can only reach a USB drive, you can install from there, but the
> internal `Hdd:` is recommended.

---

## 4. Make ConsoleGate boot first (edit `launch.ini` with Dashlaunch)

Dashlaunch controls what the console runs at startup using a text file called
`launch.ini`.

1. Launch **Dashlaunch** (from your dashboard's apps, or hold a trigger at boot if
   you've mapped it).
2. Set the **default** boot path to the ConsoleGate dashboard:
   - `default = Hdd:\cg_dash\default.xex`
3. Add the ConsoleGate plugin so it stays loaded in the background, even during
   games. In the **Plugins** section set an empty plugin slot:
   - `plugin1 = Hdd:\cg_agent\cg_agent.xex`
   - (If `plugin1` is already used, use the next free slot, `plugin2` … `plugin5`.)
4. **Save** and exit Dashlaunch. (Dashlaunch writes `launch.ini` for you.)

There's a ready-made example to copy from:
[`agent-360/plugin/launch.ini.example`](../../agent-360/plugin/launch.ini.example).

Reboot the console. It should now start into the **ConsoleGate dashboard**.

---

## 5. Pair the console with your Hub

1. On the Hub web page (`http://<hub-ip>:8088/`), log in with your parent PIN and
   open the **System** tab → **Generate pairing code**. You'll get a **6-digit
   code** that's valid for 5 minutes.
2. On the 360, in the ConsoleGate dashboard, choose **Pair with Hub** and enter the
   6-digit code.
3. The console contacts the Hub, registers itself, and saves its login. You'll see
   the console appear on the Hub dashboard and in the Android app.

That's it — the console is now managed. From now on it talks to the Hub on every
boot and while games run.

---

## 6. Tighten security (important)

By default a modded 360 has several "escape hatches." Closing them is what makes
ConsoleGate actually stick:

1. **Remove hold-a-button boot shortcuts.** In Dashlaunch, clear any
   button-launch slots (`But_A`, `But_X`, `But_Y`, …) so a child can't hold a
   button at boot to skip ConsoleGate.
2. **Neutralize the "return to official dashboard" shortcut** (`RBump`) so it can't
   be used to bypass the agent.
3. **Disable or PIN-protect FTP and file managers** so the agent and `launch.ini`
   can't be edited live. Remove XeXMenu/FTP from easy reach, or keep them behind
   your PIN.
4. **Bake it into NAND (strongest).** Use **xeBuild / J-Runner** to include
   `cg_agent` and your hardened `launch.ini` in the console's NAND image and
   reflash. Then **wiping the hard drive won't remove ConsoleGate** — it would take
   a full NAND reflash to undo, which is far beyond casual tampering.
   - Always keep a known-good NAND backup before reflashing.

> Even with all of this, treat ConsoleGate as a strong deterrent that **makes
> tampering visible**, not an unbreakable lock. If a child does manage to disable
> it, the Hub will alert you that the console stopped reporting.

---

## 7. Test that it works

1. **Schedule test:** in the Hub web UI, set today's allowed window to *now* with a
   small daily limit (say 5 minutes). On the 360, start any game.
   - You should see ConsoleGate **warning overlays** as the limit approaches
     (60/30/15/5 minutes — you'll see the short ones with a 5-minute limit).
   - In **Hard** enforcement mode, at zero the game is **closed** after a short
     save countdown and the **lock screen** appears.
   - In **Soft** mode, it keeps nagging instead of closing, and you get a
     "played past downtime" alert on your phone.
2. **Lock-now test:** from the web UI or Android app, press **Lock now**. The
   console should lock within a few seconds.
3. **Bonus test:** press **+15 min** (or grant a custom amount); the console should
   unlock and show the new remaining time.
4. **Tamper-evidence test:** unplug the network cable while a game is running. After
   a few minutes the Hub should show an **"agent stopped reporting"** alert.

Set your real schedule afterward (allowed hours per day + a daily limit, and pick
Hard or Soft enforcement).

---

## 8. Troubleshooting

- **Console won't pair / "can't reach Hub".** Make sure the Hub computer is on and
  on the same Wi-Fi (not a guest network), and that you generated a fresh code
  (codes expire after 5 minutes). Confirm the Hub web page opens from another device
  on the network.
- **Console boots to the wrong place.** Re-open Dashlaunch and check
  `default = Hdd:\cg_dash\default.xex` and the `plugin1` line. Reboot.
- **"Can't verify time — ask a parent."** ConsoleGate locks by default if it can't
  confirm the time with the Hub (this stops "unplug it for free time" tricks). Make
  sure the Hub is reachable, then **Unlock** with your parent PIN. This is also what
  you'll see after the console has been unplugged for a long time (the 360 has no
  internal clock battery).
- **No warnings appear in a game.** Confirm the plugin line is present in
  `launch.ini` and the console was rebooted after editing it.

---

## 9. What to expect (and the honest limits)

- ConsoleGate enforces a **weekly schedule + a daily time budget**, with graduated
  warnings and (on the 360) a **mid-game force-close** at downtime.
- Changing the console clock or unplugging it **cannot** earn extra time — at worst
  it locks the console until you unlock it with your PIN.
- Every important event (played past downtime, agent went offline, clock looks
  tampered, "more time" requests) is **logged on the Hub and pushed to your phone**.
- A determined, technical child with modding tools could eventually reflash the
  console to remove the agent — but they can't do it **silently**; you'll be
  alerted.

For the Wii, see [`wii.md`](wii.md). For the Hub and full hardening checklist, see
[the parent setup guide](../implement/13-parent-setup-guide.md).
