# Changelog

Human-readable trace of notable changes, especially anything touching the
installers/deployment scripts (`install-*.bat`, `start-*.bat`, `find-python.bat`,
`xray-ai-deploy-pack/`) where a one-line commit subject isn't enough context
for "why did this change and what did it fix."

Format: newest entry first. Each entry links to its commit hash.

## 2026-09-10 -- `installer-hardening-2026-09-10` tag

- Added `.githooks/pre-commit` + `tools/check-ascii-bat.ps1`: blocks any
  commit that introduces non-ASCII bytes into a `.bat`/`.cmd` file (see the
  2026-09-10 entry below for why this matters). Activate once per clone with
  `git config core.hooksPath .githooks`.
- Added a GitHub Actions workflow that runs the same ASCII guard on every
  push/PR, so a bad batch-file edit can't reach `main` even if a
  contributor's local hook isn't set up.
- Pinned exact versions in `xray-ai-service/requirements.txt` (previously
  `>=` lower bounds only) so `pip install -r requirements.txt` reproduces
  the same dependency set on every clinic PC instead of whatever the latest
  compatible releases happen to be that day.
- Extended `.gitattributes`: `* text=auto` for consistent line-ending
  normalization by default, plus explicit `binary` markers for model
  weights/caches/archives as a second layer of defense (they're also
  gitignored).

## 2026-09-10 -- `07c10ce`, `7b4a44a`

- **Root-caused and fixed clinic-PC installer failures** ("files missing"
  errors on PCs that were plain copies/clones of the original working
  machine). Two independent bugs, both confirmed live on a PC with a
  Traditional Chinese (Big5, code page 950) default locale:
  - `cmd.exe` decodes `.bat`/`.cmd` files using the PC's active OEM/ANSI
    code page, not UTF-8. A handful of files had em-dash (`-`) characters
    saved as UTF-8 bytes, which misdecode under non-Western code pages and
    corrupt cmd's parser -- cascading into
    `'X' is not recognized as an internal or external command` errors that
    have nothing obviously to do with the actual em-dash. Fixed by scanning
    every `.bat`/`.cmd` file for non-ASCII bytes and replacing them with
    plain ASCII. (This is now enforced automatically -- see Unreleased.)
  - Python auto-detection was too narrow (assumed one install location).
    Replaced with `find-python.bat`, a shared subroutine that checks
    per-user, machine-wide, root-of-drive, and `py` launcher install
    locations, gated to Python >= 3.10.
  - Added `install-live-server.bat` (Node/npm checker + installer, with a
    `winget` fallback) and `install-clinic-pc.bat` (one-click: web app +
    live-server, then the X-ray Assist AI service, in one run).
  - Pinned `.bat`/`.cmd` line endings to CRLF via `.gitattributes` so every
    clone is byte-for-byte identical to what was tested.
- Gitignored `xray-ai-extras/` -- confirmed it's purely the installer's own
  generated "already applied" record (a copy of the tracked
  `xray-ai-deploy-pack/extras/<date>/` source), not separate content that
  needed wiring in.

## 2026-09-09 -- `725f8db`

- Shipped the day's X-ray Assist lightbox fixes (maximize toolbar stacking,
  crop apply/restore, Assist prompt stacking, intraoral decay emphasis) as
  an **additive installer extras pack** (`xray-ai-deploy-pack/extras/2026-09-09/`)
  applied via `apply_xray_ai_extras.py`: copies new files next to existing
  ones and only patches `index.html`/`start-xray-ai.bat` in place if the
  hooks aren't already there, backing up first. Never replaces an existing
  file.

## 2026-09-08 -- `792b7f8`

- Wired up the local X-ray AI helper service end-to-end and added the
  original clinic installer (`install-xray-ai.bat`, `start-xray-ai.bat`).
