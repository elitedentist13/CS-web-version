# AI on GitHub Pages (for staff link)

GitHub Pages only hosts **static files** (HTML/JS). It cannot run `tools/ai-local-proxy.mjs` or read `tools/.env`.

For users opening your `https://….github.io/…` link, AI must use **Supabase Edge Function** `ai-patient-draft` (API key stays in Supabase secrets, not in GitHub).

---

## Checklist (one-time, ~15 minutes)

### 1. Push this repo to GitHub

Include folder: `supabase/functions/ai-patient-draft/`

### 2. Enable GitHub Pages

GitHub repo → **Settings** → **Pages**

- **Source:** Deploy from branch `main` (or your default branch)
- **Folder:** `/ (root)`
- Save. Note your URL, e.g. `https://YOUR_USER.github.io/CS-web-version-main/`

### 3. Deploy Edge Function on Supabase (required for AI)

Use project **`kprihawipljrltfzpfjd`** (same as `app.js`).

#### A. Secrets (Dashboard)

**Edge Functions** → **Secrets** → add:

| Name | Value |
|------|--------|
| `QWE_API` | Your qweapi `sk-…` key |
| `AI_API_BASE` | `https://qweapi.com/v1` |
| `AI_MODEL` | `gpt-5.4` |

#### B. Deploy function code

**Option 1 — Supabase CLI** (if installed):

```bash
supabase login
supabase link --project-ref kprihawipljrltfzpfjd
supabase secrets set QWE_API=sk-YOUR_KEY
supabase secrets set AI_API_BASE=https://qweapi.com/v1
supabase secrets set AI_MODEL=gpt-5.4
supabase functions deploy ai-patient-draft --no-verify-jwt
```

**Option 2 — Dashboard editor**

1. **Edge Functions** → **Create function** → name: `ai-patient-draft`
2. Paste contents of `supabase/functions/ai-patient-draft/index.ts`
3. Deploy
4. Ensure JWT verification is **off** for this function (clinic app uses custom login + anon key). Repo file `supabase/config.toml` documents this.

#### C. Test Edge (replace `ANON_KEY` from `app.js`)

```bash
curl -s -X POST "https://kprihawipljrltfzpfjd.supabase.co/functions/v1/ai-patient-draft" \
  -H "Content-Type: application/json" \
  -H "apikey: ANON_KEY" \
  -H "Authorization: Bearer ANON_KEY" \
  -d '{"workflow":"birthday","userPrompt":"test","clinicName":"Test","patientFirstName":"Ann","tone":"warm_professional"}'
```

Expect: `{"message":"..."}`  
If **404** → function not deployed.  
If **`QWE_API not configured`** → secrets missing.

### 4. Test on GitHub Pages

1. Open your Pages URL (not `file://`)
2. Log in → **AI Helper** → generate a draft
3. Status should say: **已透過 Supabase Edge (ai-patient-draft) 產生**

---

## Optional: auto-deploy Edge from GitHub Actions

Repo → **Settings** → **Secrets and variables** → **Actions**, add:

- `SUPABASE_ACCESS_TOKEN` — from Supabase Account → Access Tokens
- `SUPABASE_PROJECT_REF` — `kprihawipljrltfzpfjd`

Then run workflow **Deploy Supabase AI Edge** (or push changes under `supabase/functions/`).

---

## What does *not* work on GitHub Pages

| Item | Works on Pages? |
|------|------------------|
| `START-AI.bat` / local proxy | No (only on your PC) |
| `tools/.env` on GitHub | No (gitignored; never commit keys) |
| AI without Edge deploy | No (shows demo templates) |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| 示範範本 | Deploy `ai-patient-draft` + set secrets |
| CORS error | Edge function must return `Access-Control-Allow-Origin: *` (included in repo) |
| 502 upstream_error | Wrong model name or qweapi channel issue — check Edge logs |
| Login works, AI fails | Supabase project in `app.js` must match where you deployed the function |
