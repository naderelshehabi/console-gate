# Installing ConsoleGate on a Softmodded Wii

Step-by-step instructions for a parent to install the ConsoleGate gatekeeper on a
**softmodded Nintendo Wii** (one with the Homebrew Channel and a USB loader). When
you're done, the Wii boots into ConsoleGate first, checks your schedule and daily
limit **before** letting a game start, and reports play time back to the Hub.

> **Read this first — an important Wii limitation.** Unlike the Xbox 360, the Wii
> **cannot stop a game that is already running**. That's a hard limitation of the
> Wii, not a ConsoleGate choice. So on the Wii, ConsoleGate enforces at the
> **launch gate** (it blocks the *next* game when time is up), warns at launch if a
> game can't finish before bedtime, and **alerts you on your phone if play runs
> past downtime**. There is no software way to interrupt a running Wii game.
> See [the Wii design notes](../implement/05-console-wii.md) for why.

---

## 1. Before you begin

You need:

1. **A softmodded Wii** with the **Homebrew Channel** and **Priiloader** installed,
   plus a USB-loader (**USB Loader GX** or **WiiFlow**). This guide does **not**
   cover softmodding the Wii — if yours is still stock, follow a standard guide
   (e.g. wii.hacks.guide) to install the Homebrew Channel and Priiloader first, then
   come back here.
2. **The ConsoleGate Hub running** on an always-on computer on your home network.
   If you haven't set it up, do the [Hub setup](../implement/13-parent-setup-guide.md)
   first. Note the Hub's address, e.g. `http://192.168.1.50:8088/`.
3. **The Wii and the Hub computer on the same Wi-Fi/LAN** (not a guest network).
4. The Wii's **SD card** (and the USB drive you load games from).

You will install:

| File | Goes to | What it does |
|---|---|---|
| `boot.dol` (the ConsoleGate gatekeeper, `cg_gate`) | `SD:/apps/consolegate/` | Boots first, checks the schedule, lets games launch or shows a lock screen |
| (optional) ConsoleGate channel (a `.wad`) | installed to NAND | Survives the SD card being removed |

---

## 2. Get the ConsoleGate files

You have two options:

- **Prebuilt release (preferred when available):** download the Wii package from the
  project's releases and unzip it. You'll get the `consolegate` homebrew folder
  (with `boot.dol`) and, optionally, a channel `.wad`.
- **Build from source:** ConsoleGate's Wii agent is built with devkitPPC/libogc.
  Follow [`agent-wii/README.md`](../../agent-wii/README.md). The shared logic is in
  [`agent-core/`](../../agent-core/README.md).

---

## 3. Copy the gatekeeper onto the SD card

1. Insert the Wii's SD card into your computer.
2. Create the folder `apps/consolegate/` on the SD card and copy the gatekeeper in:
   - `SD:/apps/consolegate/boot.dol`
   - (plus `meta.xml` / `icon.png` if they came with it, so it shows nicely in the
     Homebrew Channel)
3. Put the SD card back in the Wii and turn it on.
4. (Optional, recommended) Open the **Homebrew Channel** and launch **ConsoleGate**
   once to confirm it runs and can reach your network.

---

## 4. Make ConsoleGate boot first (Priiloader autoboot)

Priiloader runs **before** the Wii System Menu, so it's where we make ConsoleGate
start first.

1. Enter **Priiloader**: turn the Wii off, then **hold RESET while pressing POWER**
   (keep holding RESET until the Priiloader menu appears).
2. Choose **Load/Install File** (sometimes "Install File"). Select the ConsoleGate
   gatekeeper (`boot.dol`) from your SD card. This copies it into Priiloader.
3. Go to **Settings** and set:
   - **Autoboot = Installed File**
   - (Optional) set **"Return to" = System Menu** if your loader routes exits that
     way — see step 6.
4. **Save Settings** and exit.

Reboot the Wii. It should now start into **ConsoleGate** before the System Menu.

---

## 5. Pair the console with your Hub

On the very first ConsoleGate boot you'll see a pairing prompt.

1. On the Hub web page (`http://<hub-ip>:8088/`), log in with your parent PIN and
   open the **System** tab → **Generate pairing code** to get a **6-digit code**
   (valid for 5 minutes).
2. On the Wii, enter the code with the Wii Remote:
   - **UP / DOWN** change the current digit
   - **RIGHT** moves to the next digit
   - **A** confirms · **HOME** cancels
3. The Wii contacts the Hub, registers itself, and saves its login. The console
   appears on the Hub dashboard and in the Android app.

---

## 6. Point your game loader back to ConsoleGate

So that play time is counted when a child finishes a game, tell your loader to
return to ConsoleGate (not straight to the System Menu) when a game exits.

- **USB Loader GX:** Settings → Loader Settings → **"Return To"** → choose
  **ConsoleGate** (or the ConsoleGate forwarder/Homebrew Channel, depending on your
  setup).
- **WiiFlow:** set the equivalent **"Return to"** option to ConsoleGate.

Now, when a game is exited normally (HOME → Exit), the Wii comes back to ConsoleGate,
which records the session and updates the remaining time.

---

## 7. Tighten security (important)

1. **Install ConsoleGate as a channel (strongest for the Wii).** If you have the
   ConsoleGate `.wad`, install it with a WAD manager so ConsoleGate also lives in
   the Wii's internal memory. Then **removing the SD card won't disable it** — the
   most common "easy" bypass.
   - Always keep a **NAND backup (BootMii)** before installing any WAD, in case you
     need to recover.
2. **Set a Priiloader password.** In Priiloader → Settings, enable a password so the
   Priiloader menu and autoboot are protected.
   - **Be aware:** there is a well-known Priiloader password "back door" that a
     tech-savvy child can find online. That's *why* the real lock is **ConsoleGate's
     own parent PIN**, and why you'll get an alert if anyone opens the Priiloader
     menu. Don't rely on the Priiloader password alone.
3. **Keep games on USB, not on the SD card** where possible, so the SD card only
   holds ConsoleGate. If a child pulls the SD card on a NAND-channel install, the
   gatekeeper still runs and simply won't launch a game (it fails safe).

> As on every modded console, this is a strong deterrent that **makes tampering
> visible**, not an unbreakable lock. A determined child could reflash the Wii to
> remove ConsoleGate — but the Hub will alert you that the console stopped reporting.

---

## 8. Test that it works

1. **Blocked test:** in the Hub web UI, set today's schedule so the console is
   **outside** an allowed window (or set the daily limit to 0). Reboot the Wii.
   ConsoleGate should show a **lock screen** and refuse to start a game.
2. **Allowed + won't-finish test:** open an allowed window with only a few minutes
   left, then try to launch a game. ConsoleGate should warn that there isn't enough
   time to finish before downtime (and can block the launch if you turned on
   "block launches that can't finish").
3. **Overage alert test:** with a tiny amount of time left, launch a game and keep
   playing past the limit, then exit. You should get a **"played past downtime"**
   alert on your phone, and the day's time should be used up.
4. **Tamper test:** in the Wii's own Settings, set the clock back a few hours, then
   reboot into ConsoleGate. It should **lock** with "can't verify time" (changing
   the clock can't earn extra time); unlock with your **parent PIN**.

Set your real schedule afterward (allowed hours per day + a daily limit).

---

## 9. Troubleshooting

- **Won't pair / "can't reach Hub".** Make sure the Hub computer is on and on the
  same Wi-Fi (not a guest network), and generate a fresh code (they expire after 5
  minutes). Confirm the Hub web page opens from another device.
- **Wii boots straight to the System Menu.** Re-enter Priiloader (hold RESET +
  POWER), confirm **Autoboot = Installed File** is set and saved.
- **Holding RESET drops into Priiloader.** This is normal Priiloader behavior. Set a
  Priiloader password to add friction; the real control is ConsoleGate's PIN, and
  opening the Priiloader menu is flagged to you as a tamper event where detectable.
- **A game exited to the System Menu instead of ConsoleGate.** Re-check the
  **"Return To"** setting in USB Loader GX / WiiFlow (step 6).
- **"Can't verify time — ask a parent."** ConsoleGate locks by default if it can't
  confirm the time with the Hub. Make sure the Hub is reachable, then **Unlock** with
  your parent PIN.

---

## 10. What to expect (and the honest limits)

- ConsoleGate enforces a **weekly schedule + a daily time budget** on the Wii **at
  the launch gate** and when a child voluntarily exits a game.
- It **cannot** stop a game that's already running (a Wii hardware limitation), but
  it **alerts you** if play runs past downtime and won't let the *next* game start.
- Changing the Wii clock **cannot** earn extra time — at worst the console locks
  until you unlock it with your PIN.
- Every important event (played past downtime, agent went offline, clock looks
  tampered, "more time" requests, Priiloader menu opened) is **logged on the Hub and
  pushed to your phone**.

For the Xbox 360, see [`xbox-360.md`](xbox-360.md). For the Hub and full hardening
checklist, see [the parent setup guide](../implement/13-parent-setup-guide.md).
