# AGENTS.md

## Cursor Cloud specific instructions

### Product Overview

This is **Joyful Smile Clinic Manager** — a dental clinic management SPA (single-page application) built with vanilla HTML/CSS/JavaScript. There is no build system, no package manager, and no bundler. The backend is entirely Supabase (cloud-hosted PostgreSQL + Auth + Storage).

### Running the Development Server

Serve the static files from the workspace root:

```bash
python3 -m http.server 8080 --directory /workspace
```

Then open `http://localhost:8080/` in a browser. The application loads `index.html` which pulls in `style.css` and all `app*.js` files.

### Architecture Notes

- **No build step** — all JS files are loaded directly via `<script>` tags in `index.html`.
- **No linter/formatter** — there is no ESLint, Prettier, or similar tooling configured.
- **No automated tests** — there is no test framework or test files in this repository.
- **No package.json** — no npm/yarn/pnpm dependencies to install.
- **Supabase connection** — the app connects to a cloud Supabase instance (credentials are hardcoded in `app.js`). Internet access is required for the app to function.
- **CDN dependencies** — Supabase JS SDK and Chart.js are loaded from `cdn.jsdelivr.net` at runtime.

### Login

The login page lists suggested usernames (e.g. `admin`, `drchan`, `nurse`). Credentials are stored in the `app_users` table in Supabase. Without valid credentials, you can still access the "AI Patient Assistant" feature via the "Try AI Patient Assistant — no login" button on the login screen.

### Key Files

| File | Purpose |
|------|---------|
| `index.html` | Single HTML page (~4668 lines) containing all UI markup |
| `style.css` | All styles (~132KB) |
| `app.js` | Core init, Supabase client, login, global state |
| `app-appt.js` | Appointment scheduling module |
| `app-consultation.js` | Consultation/treatment notes |
| `app-charts.js` | Dental charting (FDI notation) |
| `app-xray.js` | X-ray image management |
| `app-photos.js` | Clinical photography |
| `app-drugs.js` | Drug book / prescriptions |
| `app-patient.js` | Patient registration & directory |
| `app-config.js` | Configuration/settings module |
| `app-report.js` | Reporting module |
| `app-ai-helper.js` | AI Patient Assistant |
| `app-memo-ai.js` | Memo Cards + AI polish |
| `cal-doctor-colors.js` | Calendar doctor color assignments |
