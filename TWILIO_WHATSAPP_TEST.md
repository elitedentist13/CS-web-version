# Twilio WhatsApp — live Edge (publish-ready)

Sends **one** WhatsApp message via **Supabase Edge Function** `twilio-whatsapp`.  
Works on GitHub Pages / any static host. Twilio secrets stay in Supabase — never in the browser or git.

## 1. Secrets (Supabase Dashboard)

**Edge Functions → Secrets** (project `kprihawipljrltfzpfjd`, same as `app.js`):

| Secret | Example |
|--------|---------|
| `TWILIO_ACCOUNT_SID` | `ACxxxx…` |
| `TWILIO_AUTH_TOKEN` | your auth token |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+852xxxxxxxx` |
| `TWILIO_MESSAGING_SERVICE_SID` | optional `MGxxxx…` |
| `TWILIO_WHATSAPP_CONTENT_SID` | optional `HXxxxx…` (approved template) |

CLI alternative:

```bash
supabase login
supabase link --project-ref kprihawipljrltfzpfjd
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxx
supabase secrets set TWILIO_WHATSAPP_FROM=whatsapp:+852xxxxxxxx
# optional:
# supabase secrets set TWILIO_MESSAGING_SERVICE_SID=MGxxxx
# supabase secrets set TWILIO_WHATSAPP_CONTENT_SID=HXxxxx
```

## 2. Deploy the function

```bash
supabase functions deploy twilio-whatsapp --no-verify-jwt
```

Or Dashboard → **Edge Functions** → create/edit `twilio-whatsapp` → paste  
`supabase/functions/twilio-whatsapp/index.ts` → deploy.  
JWT verification must be **off** (clinic uses custom login + anon key).

## 3. Smoke test (curl)

Replace `ANON_KEY` with the anon JWT from `app.js`, and use a real active `user_id` from `app_users`:

```bash
curl -s -X POST "https://kprihawipljrltfzpfjd.supabase.co/functions/v1/twilio-whatsapp" \
  -H "Content-Type: application/json" \
  -H "apikey: ANON_KEY" \
  -H "Authorization: Bearer ANON_KEY" \
  -d "{\"callerUserId\":\"YOUR_STAFF_USER_ID\",\"to\":\"+85291234567\",\"name\":\"Test\"}"
```

Expect: `{"ok":true,"result":{"sid":"SM…","mode":"…"}}`

## 4. Use in the published app

1. Open the live clinic URL (GitHub Pages or your host) — **not** `file://`
2. Log in as an active staff user
3. **AI Helper → Recall**
4. Enter your phone → **Test Twilio WhatsApp**

## Notes

- **Login required** — Edge checks `app_users` (`callerUserId` + `is_active`).
- **Template mode** — set `TWILIO_WHATSAPP_CONTENT_SID` for cold outreach (Meta rule).
- **Free-form** — without Content SID, uses message body / default test text (often fails for cold sends).
- Local `tools/twilio-whatsapp-test-api.mjs` is optional offline only; the UI calls the live Edge function.
