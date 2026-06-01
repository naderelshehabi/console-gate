# 13 — Parent Setup & Hardening Guide

Plain-language instructions for parents. **Read §13.1 first — it sets honest expectations.**

> **Quick reference (as implemented).** Hub runs in Docker and serves the web UI at **`http://<hub-host>:8088/`** (UDP **8099** is used for auto-discovery). First run: open that URL → **set a parent PIN** → log in. Pair a console or the phone by generating a 6-digit code under **System › Generate pairing code** and entering it on the device (the code expires in 5 minutes). The Hub watches each console's heartbeat and alerts you (**"agent stopped reporting"** = `AGENT_OFFLINE`) if a powered console goes silent, plus alerts for *played-past-downtime*, *clock-tampering*, and *more-time requests*. The Hub keeps signed logs and takes automatic backups. On-console button paths for the 360/Wii install steps are confirmed during the on-hardware acceptance run (GATE 3/4).

## 13.1 What this can and can't do (read this)

- **It will:** enforce a weekly schedule + daily time limit, warn before time's up, let you grant bonus time or lock the console from your phone or a browser, and **tell you on your phone** whenever something matters — especially if a console is played past its bedtime.
- **On the Xbox 360 it can** stop a game that's already running when time is up (with a save-warning countdown first).
- **On the Wii it cannot** stop a game that's already running — that's a hard limitation of the Wii. Instead it blocks the *next* game when time is up, warns at launch if a game can't finish before bedtime, and **notifies you** if play runs past bedtime. (If you need a hard mid-game stop on Wii, the only real option is cutting power, which this software-only system deliberately does not do.)
- **Honest limit:** a determined, tech-savvy child with console-modding tools can eventually disable on-console software (by reflashing the console). **This system is built so that if they do, you find out** — you'll get a "console stopped reporting" alert. It raises the bar a lot and makes any tampering visible; it is not an unbreakable lock.

## 13.2 What you need

- One always-on computer you already keep running (Windows or Mac) with **Docker Desktop** installed — this runs the **Hub**.
- Your JTAG/RGH Xbox 360 and/or softmodded Wii on the **same home Wi-Fi/LAN** as that computer (not a guest network).
- An Android phone for the app (optional but recommended).

## 13.3 Step 1 — Install the Hub (the brain)

1. Install Docker Desktop on your always-on Windows or Mac machine.
2. From the `hub/` folder run **`docker compose up -d`** (one command). Set your timezone in `docker-compose.yml` (`CG_TZ`) or `consolegate.yml` first.
3. Open `http://<that-computer>:8088/` in a browser. First run:
   - **Create a parent PIN** (don't use 0000/1234; the child may watch you type — choose something they won't guess), then log in with it.
   - Internet time sync is automatic; the **System** tab shows time status and a **Refresh time now** button.
   - Choose how you want phone notifications (cloud push via FCM for alerts anywhere, or self-hosted/LAN-only for privacy).
4. Leave this computer on. The Hub keeps the real clock, the schedule, and the history even when the consoles are off, and takes automatic backups (and can run a warm **standby** on a second always-on machine).

## 13.4 Step 2 — Set the schedule

In the Web UI (or Android app): for each console, set, per day of the week:
- **Allowed hours** (e.g. Mon–Fri 4:00–7:00 PM, weekends 10:00 AM–8:00 PM).
- **Daily limit** (e.g. 2 hours/day even within allowed hours).
- **Enforcement mode:** *Hard* (360 closes the game at time-up) or *Soft* (just warns — gentler for games with manual saves).

## 13.5 Step 3 — Install on the Xbox 360

(Performed once, with your modding tools.)
1. Install the **ConsoleGate agent** so it boots first (via `launch.ini`), ideally baked into NAND so wiping the hard drive won't remove it.
2. **Tighten security (important):** remove the "hold a button at boot" shortcuts and the always-return-to-official-dashboard option, so there's no way around the agent. Turn off FTP/file-manager apps or put them behind the PIN.
3. On the console, pair it: enter the pairing code shown in the Web UI.
4. Test: play a game and confirm warnings appear and the console locks at the limit.

## 13.6 Step 3 — Install on the Wii

1. Make sure **Priiloader** is installed (it lives in the Wii's memory, before the main menu).
2. Install the **ConsoleGate gatekeeper** and set Priiloader to **autoboot** it, so the Wii always starts in ConsoleGate. Install it as a **channel** too, so removing the SD card doesn't disable it.
3. In USB Loader GX / WiiFlow, set **"Return To" = ConsoleGate** so exiting a game comes back to the gate.
4. **Tighten security:** set a Priiloader password (note: a tech-savvy child can find the known Priiloader password trick online — that's why the real control is ConsoleGate's own PIN, and why you'll get an alert if anyone opens the Priiloader menu).
5. Pair the console with the code from the Web UI. Test the lock and the bedtime warning at launch.

## 13.7 Step 4 — Install the Android app

1. Install the app and open it on the **same Wi-Fi** as the Hub. It finds the Hub automatically — no IP typing.
   - If it can't find it: your Wi-Fi may isolate devices (common on guest networks). Put the phone and the Hub computer on the same normal network, or enter the Hub's address once manually.
2. Approve the pairing in the Web UI.
3. Turn on notifications so you get alerts (bedtime overruns, "console stopped reporting", more-time requests).

## 13.8 Everyday use

- **Grant bonus / extend today:** from the app or web, add minutes (auto-resets tomorrow).
- **Lock now / pause:** instantly lock or pause a console.
- **Approve "more time":** when a child requests extra time on the console, you get a notification — tap **Grant** or **Deny**.
- **See activity:** charts of time played, busiest hours, and any overage or tamper alerts.

## 13.9 How to make it as tight as possible (hardening checklist)

- [ ] Bake the agent into NAND (both consoles) so wiping storage doesn't remove it.
- [ ] 360: remove boot-button shortcuts and the return-to-official-dashboard escape; PIN-gate or remove FTP/file managers.
- [ ] Wii: install the agent as a NAND **channel**; set Priiloader autoboot + password; set loader "Return To" = ConsoleGate.
- [ ] Use a strong, unseen parent PIN; don't reuse it elsewhere.
- [ ] Keep the Hub computer in a spot/account the child can't administer; don't let them have its login.
- [ ] Turn on cloud push so you get alerts even when you're not home.
- [ ] Enable the second-computer **standby Hub** if you have one, so a single computer being off doesn't pause everything.
- [ ] Periodically check the **activity log** — and treat an "agent stopped reporting" alert as a sign to inspect the console.

## 13.10 If something goes wrong

- **Console locked saying "can't verify time":** the console couldn't reach the Hub or its clock looks wrong. Make sure the Hub computer is on and on the same network; use **Unlock** with your PIN. (This lock-by-default is intentional — it stops "unplug it for free time" tricks.)
- **Real power outage / Hub was off:** consoles keep working on the last known schedule for a short grace period, then lock; unlock with your PIN.
- **App can't find the Hub:** check same-network/guest-network, or enter the Hub address manually once.
</content>
