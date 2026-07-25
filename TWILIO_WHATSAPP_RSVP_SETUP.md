# Two-way WhatsApp RSVP recall

Approved template: **`HX123c5d6b07dff76590124d0c363fdd21`**

Variables: `{{1}}` NAME · `{{2}}` CLINIC · `{{3}}` DATE · `{{4}}` TIME · `{{5}}` DOCTOR  
Quick-reply buttons should map to **CONFIRM** / **CANCEL** (or Yes/No text).

## 1. Database (once)

Run in Supabase SQL Editor:

- `wa_appointment_rsvp.sql` — adds RSVP columns + log table + seeds approved template
- `twilio_content_templates.sql` — if not already applied

Re-run `wa_appointment_rsvp.sql` after template approval to register the new Content SID.

## 2. Outbound Edge Function

Outbound sends use existing **`twilio-whatsapp`** (see `TWILIO_WHATSAPP_TEST.md`).

The RSVP tab passes `contentSid: HX123c5d6b07dff76590124d0c363fdd21` in each request — no Edge secret change needed.

## 3. Inbound Edge Function (two-way replies)

JWT is disabled in `supabase/config.toml` for this function.

```powershell
cd "C:\Users\joyfu\Downloads\CS-web-version-main (1)\CS-web-version-main"
supabase functions deploy twilio-whatsapp-inbound --no-verify-jwt
```

**JWT must be off** or Twilio POSTs get 401. Always use `--no-verify-jwt`.

Set webhook on **both** (if you send via Messaging Service `MG…`):

1. **Messaging** → **Messaging Services** → your service → **Incoming messages** → Webhook  
2. **Messaging** → **Senders** → WhatsApp number → **A message comes in**

URL:

`https://kprihawipljrltfzpfjd.supabase.co/functions/v1/twilio-whatsapp-inbound`

- Method: **HTTP POST**
- Content type: **application/x-www-form-urlencoded** (Twilio default)

After deploy, open that URL in a browser — should return JSON `{ "ok": true, ... }`.

When a patient taps Confirm/Cancel **and presses Send**, Twilio POSTs here → `wa_rsvp_inbound_log` gets rows → `appointments.patient_rsvp_status` updates.

## 4. App UI

**Appointment → Two-way RSVP** tab (next to Recall Patient).

- Pick a date → select appointments → **Send RSVP WhatsApp**
- Reply status refreshes every ~12s (or use **Refresh**)
- Staff can **Mark Yes / Mark No** if webhook is not live yet

Existing **Recall Patient** tab is unchanged.

## 5. Smoke test

1. Run SQL + deploy inbound function + set Twilio webhook URL
2. Hard-refresh app (`Ctrl+Shift+R`)
3. Send RSVP to your own WhatsApp test number
4. Tap Confirm or Cancel — **if WhatsApp only fills the text box, press the green Send button**
5. RSVP tab should show **Confirmed** or **Declined** within ~5s

## 6. Troubleshooting “Awaiting reply”

| Check | What to do |
|-------|------------|
| **Webhook not wired** | Twilio Console → Monitor → Logs → Messaging. After patient sends reply, you should see an HTTP POST to `twilio-whatsapp-inbound`. If not, set **A message comes in** on the **same WhatsApp sender / Messaging Service** used for outbound. |
| **Messaging Service** | If sends use a Messaging Service (`MG…`), set inbound webhook on **that service**, not only on the phone number. |
| **Button only fills text box** | Patient must tap **Send** (green arrow). Twilio only notifies us when the message is actually sent. |
| **Debug table** | Supabase → `wa_rsvp_inbound_log`. Every Twilio POST creates `webhook_received` row; success adds `ok`. **Empty = Twilio never reached Supabase.** |
| **RSVP tab diagnostic** | Bottom of RSVP tab shows last inbound time and pending count. |
| **Manual fallback** | Use **Mark Yes / Mark No** in the RSVP tab anytime. |

Redeploy after code changes:

```powershell
supabase functions deploy twilio-whatsapp-inbound --no-verify-jwt
```
