# Twilio WhatsApp — live Edge (publish-ready)

Sends **one** WhatsApp message via **Supabase Edge Function** `twilio-whatsapp`.  
Works on GitHub Pages / any static host. Twilio secrets stay in Supabase — never in the browser or git.

## 1. Secrets (Supabase Dashboard)

**Edge Functions → Secrets** (project `kprihawipljrltfzpfjd`, same as `app.js`):

| Secret | Example |
|--------|---------|
| `TWILIO_ACCOUNT_SID` | `ACxxxx…` |
| `TWILIO_AUTH_TOKEN` | your auth token |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+852xxxxxxxx` (WhatsApp From) |
| `TWILIO_SMS_FROM` | `+852xxxxxxxx` (**recommended for SMS** — must be SMS-capable; WhatsApp senders often cannot send SMS) |
| `TWILIO_MESSAGING_SERVICE_SID` | optional `MGxxxx…` (mainly WhatsApp; SMS uses this only as last resort) |
| `TWILIO_WHATSAPP_CONTENT_SID` | `HXf63c7a58271df43f5c63d97c6a514413` (**fallback only** if the request omits `contentSid`) |

CLI alternative:

```bash
supabase login
supabase link --project-ref kprihawipljrltfzpfjd
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxx
supabase secrets set TWILIO_WHATSAPP_FROM=whatsapp:+852xxxxxxxx
# recommended for SMS (regular SMS-capable Twilio number):
supabase secrets set TWILIO_SMS_FROM=+852xxxxxxxx
# optional:
# supabase secrets set TWILIO_MESSAGING_SERVICE_SID=MGxxxx
supabase secrets set TWILIO_WHATSAPP_CONTENT_SID=HXf63c7a58271df43f5c63d97c6a514413
```

**Do not rotate `TWILIO_WHATSAPP_CONTENT_SID` for each template.** The AI Helper sends the selected Content SID in the request body; Edge prefers that over the secret.

**SMS From priority:** request `from` → `TWILIO_SMS_FROM` → stripped `TWILIO_WHATSAPP_FROM` → Messaging Service (last resort).

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
  -d "{\"callerUserId\":\"YOUR_STAFF_USER_ID\",\"to\":\"+85291234567\",\"name\":\"Test\",\"contentSid\":\"HXf63c7a58271df43f5c63d97c6a514413\",\"contentVariables\":{\"1\":\"Test\"}}"
```

Expect: `{"ok":true,"result":{"sid":"SM…","mode":"content"}}`

## 4. Use in the published app

1. Open the live clinic URL (GitHub Pages or your host) — **not** `file://`
2. Log in as an active staff user
3. **AI Helper → Twilio Send**
4. Choose **WhatsApp** or **SMS**, pick a **Content template** (or add SIDs from Twilio Console), enter phone (+ message body for SMS) → **Send via Twilio**

### Content templates (AI Helper)

- WhatsApp sends use the selected **Content SID** + `contentVariables`.
- Staff can add / edit / remove templates in the panel (saved in browser `localStorage`).
- Direct link: [Twilio Content Template Builder](https://console.twilio.com/us1/develop/sms/content-template-builder) — copy approved `HX…` SIDs into the clinic list.
- Default seeded template: `HXf63c7a58271df43f5c63d97c6a514413` (clinic recall, `{{1}}` = name).

### Edge payload (AI Helper)

```json
{
  "callerUserId": "staff_id",
  "callerClinicId": "…",
  "channel": "whatsapp",
  "to": "+85291234567",
  "name": "Ada",
  "contentSid": "HXf63c7a58271df43f5c63d97c6a514413",
  "contentVariables": { "1": "Ada" },
  "body": "optional fallback"
}
```

For SMS, send `"channel":"sms"` with a non-empty `body` (no Content SID required). Edge should use the same Twilio From / Messaging Service number.

Optional `from` (AI Helper From picker): when staff pick a saved clinic number, the client sends e.g. `"from":"whatsapp:+852…"` or `"from":"+852…"`. Edge should prefer request `from` when present and valid for the account; otherwise fall back to `TWILIO_WHATSAPP_FROM` / Messaging Service.

## Notes

- **Login required** — Edge checks `app_users` (`callerUserId` + `is_active`).
- **Template selection** — AI Helper sends the **selected** `contentSid` + `contentVariables`. Edge uses request `contentSid` first; `TWILIO_WHATSAPP_CONTENT_SID` is fallback only when the request omits a valid SID. **No need to change the secret** when switching templates in the UI.
- **Edge contract** — prefer request `channel`, `contentSid`, `contentVariables`, `from`, and `body` when present; else fall back to env secrets.
- **SMS** — `channel=sms` sends Programmable Messaging SMS from request `from` / `TWILIO_WHATSAPP_FROM` / Messaging Service (number must support SMS).
- **Free-form WhatsApp** — without Content SID, uses message body / default test text (often fails for cold sends).
- Local `tools/twilio-whatsapp-test-api.mjs` is optional offline only; the UI calls the live Edge function.
