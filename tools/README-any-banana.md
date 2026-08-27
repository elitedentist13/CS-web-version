# Any Banana — remote support agent

A lightweight "AnyDesk-lite" tool built into Banana: any clinic PC with this
agent installed gets a persistent **Device ID**, and any other Banana
browser tab (anywhere with internet, not just the same LAN/clinic) can type
that ID in to request a screen-view/control + file-sharing session — but
**only after someone physically at the host PC clicks Allow** on a native
popup. No install is needed on the connecting/viewer side, only on the side
being controlled.

## What's in this folder

| File | Purpose |
|---|---|
| `banana-remote-agent.ps1` | The agent itself: registers/loads this PC's Device ID, shows the consent popup, captures the screen and uploads frames, injects incoming mouse/keyboard commands, and moves files in and out — all relayed through Supabase (see `../any_banana_remote.sql`). |
| `install-banana-remote.ps1` | Installer: copies the agent, adds the required Defender exclusion, self-tests, sets up auto-start at login, and starts it immediately. |
| `Install Any Banana Remote.bat` | Double-click wrapper around the installer. |

The web side lives in `../app-remote.js` (the "Any Banana" card on the
Banana Dashboard) — nothing to install for that, it just needs the app open
in a browser.

## Deploying to a new PC

1. Copy this whole `tools` folder (or just `banana-remote-agent.ps1` +
   `install-banana-remote.ps1` + `Install Any Banana Remote.bat` together —
   they must stay siblings) to the target PC.
2. Double-click **`Install Any Banana Remote.bat`**.
3. Click **Yes** if Windows asks for Administrator. This is required for
   two things, not just cosmetic auto-start coverage:
   - Auto-start covering every Windows account that logs into this PC.
   - A **Windows Defender exclusion** for the install folder (default
     `C:\BananaRemote`) — see "Why the Defender exclusion?" below. Without
     it, the agent will fail its self-test and the installer will stop.
4. Open Banana on that PC and go to **Any Banana** on the Dashboard — it
   will show this PC's 6-digit Device ID, fetched from the agent running
   on `127.0.0.1:17891`.
5. Give that Device ID to whoever needs to connect in. They type it into
   their own Banana's **Any Banana** page and click Connect. **Nothing
   happens until someone at this PC clicks Allow** on the popup that
   appears here.

To remove it from a PC:

```
powershell -NoProfile -ExecutionPolicy Bypass -File install-banana-remote.ps1 -Uninstall
```

## Why the Defender exclusion?

Screen capture + mouse/keyboard injection (`SetCursorPos`, `mouse_event`,
`keybd_event`/`SendInput`) is exactly the API combination real remote-access
trojans use — and it's also exactly what any *legitimate* remote-support
tool needs, including this one. Windows Defender's AMSI layer blocks the
script from even parsing without an exclusion for its install folder
(confirmed live 2026-08-27: `ScriptContainedMaliciousContent`). The
installer adds this exclusion automatically when run elevated; if it
can't (declined UAC prompt), add it by hand:

**Windows Security → Virus & threat protection → Manage settings →
Exclusions → Add an exclusion → Folder → `C:\BananaRemote`**

This only affects Defender's static scan of that one folder — it does not
turn off real-time protection anywhere else on the PC.

## Known v1 limitations

- **Screenshot polling, not real video.** ~2fps (`-PollIntervalMs 400` by
  default) with visible lag — a "get someone to look at my screen /
  click this for me" tool, not a smooth remote-desktop replacement.
- **Primary monitor only** — no multi-monitor support.
- **No clipboard sync.**
- **No auto-update** (unlike the X-ray bridge) — re-run the installer by
  hand after pulling code changes to this agent.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Any Banana page says "agent not found on this PC" | The agent isn't installed/running here, or something else is using port 17891. This PC can still act as a *viewer* (connect out to other PCs) without the agent — it just can't be connected *to*. |
| Installer's self-test fails immediately | Almost always the missing Defender exclusion — re-run the installer elevated (click Yes on the UAC prompt). |
| Connection request never shows a popup on the host | The host's agent isn't running (check `http://127.0.0.1:17891/status` on that PC), or it's mid-session with someone else already. |
| Screen looks frozen / very laggy | Expected at v1's ~2fps screenshot-polling design — see limitations above, not a bug. |
