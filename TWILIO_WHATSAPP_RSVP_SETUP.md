# Two-way WhatsApp RSVP recall

## 1. Database (once)

Run in Supabase SQL Editor:

- `wa_appointment_rsvp.sql`

## 2. Inbound Edge Function

JWT is disabled via `supabase/config.toml` (`verify_jwt = false`) — **do not** append `--no-verify-jwt` on deploy.

```powershell
cd "C:\Users\joyfu\Downloads\CS-web-version-main (6)\CS-web-version-main"
npx supabase functions deploy twilio-whatsapp-inbound
```

Run **one command only** (do not paste `npx` onto the end of the previous line).
Twilio Console → your WhatsApp sender / Messaging Service → **A message comes in**:

`https://kprihawipljrltfzpfjd.supabase.co/functions/v1/twilio-whatsapp-inbound`

Method: HTTP POST. Content type: form URL-encoded (Twilio default).

## 3. App UI

Appointment → tab **Two-way RSVP** (next to Recall Patient).

- Loads appointments for the selected date (same clinic bar as other appt tabs).
- Sends Content SID `HX3e0d0027555e8d6b700381a797f599cc` via existing Edge `twilio-whatsapp`.
- Logs each send in `wa_appointment_rsvp` with `appointment_id` + Twilio SID.
- Shows reply status; staff can manually mark Confirm / Decline if webhook is not live yet.

Existing **Recall Patient** tab is unchanged.
