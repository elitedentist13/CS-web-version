# Online Booking — Twilio SMS OTP Setup

Patient flow after this change:

**Form → SMS OTP (Twilio Verify) → Appointment created (`pending_staff` / `pending_arrange`) → Staff confirms**

You **do not need to buy a Twilio phone number** for this. We use **Twilio Verify**, which sends OTPs on Twilio’s shared routes. Buying a number is optional and only needed later if you want branded “From” SMS via Programmable Messaging.

---

## A. What was added in this repo

| File | Purpose |
|------|---------|
| `online_booking_otp.sql` | Hold table helpers + RPCs (`ob_create_otp_request`, `ob_complete_otp_request`, …) |
| `tools/online-booking-api.mjs` | Local API on `:8788` — Twilio send/check + Supabase |
| `supabase/functions/online-booking/index.ts` | Production Edge Function (same actions) |
| `book.html` / `book.js` / `book.css` | New **Verify mobile** step |
| `online-booking.env.example` | Env template including Twilio |

---

## B. Step-by-step: Twilio Console (no number required)

### 1. Open Twilio Console

1. Go to [https://console.twilio.com/](https://console.twilio.com/)
2. Confirm your account is **Active** (you said profile is verified/approved — good).

### 2. Copy Account credentials

1. Open **Account → Account Dashboard** (or the home console).
2. Copy:
   - **Account SID** → starts with `AC…`
   - **Auth Token** → click to reveal, then copy  
3. Keep these secret (never put them in `book.html` or git).

### 3. Create a Verify Service (this is the OTP engine)

1. In the left menu go to **Messaging → Verify → Services**  
   (or open [https://console.twilio.com/us1/develop/verify/services](https://console.twilio.com/us1/develop/verify/services))
2. Click **Create new** / **Create Service**.
3. Friendly name: e.g. `Joyful Smile Booking`.
4. Enable channel: **SMS** (default).
5. Save.
6. Copy the **Service SID** → starts with `VA…`

That is all you need for OTP. **Skip “Buy a number” for now.**

### 4. Trial vs paid (important for Hong Kong mobiles)

| Account type | What happens |
|--------------|--------------|
| **Trial** | You can only SMS numbers you add under **Phone Numbers → Verified Caller IDs**. Add your test HK mobile there first. |
| **Upgraded / paid** | You can SMS real patient numbers (subject to Twilio geo / compliance rules). |

If you are still on Trial:

1. **Phone Numbers → Manage → Verified Caller IDs**
2. Add `+852XXXXXXXX` (your test phone)
3. Complete the voice/SMS verification Twilio asks for
4. Then test booking with that same number

### 5. (Optional later) Buy a Twilio number

Only if you later want:

- Custom “From” number for transactional SMS
- WhatsApp / other messaging products
- Not using Verify

Steps when ready:

1. **Phone Numbers → Buy a number**
2. Country: prefer a number that can SMS **Hong Kong (+852)** destinations (Twilio will show capability filters)
3. Complete purchase / regulatory paperwork if prompted
4. For **Verify**, you usually still keep using the Verify Service; you do **not** paste the number into this booking OTP integration unless you switch to Programmable Messaging + custom OTP logic

---

## C. Step-by-step: Supabase (one-time SQL)

1. Open Supabase → your project → **SQL Editor**
2. If not already done, run in order:
   - `online_booking.sql`
   - `online_booking_rpc.sql`
   - roster/session SQL you already use
3. **New for OTP:** run `online_booking_otp.sql`
4. Confirm no errors.

Copy the **service_role** key (Settings → API) for local/Edge secrets — never expose it in the browser.

---

## D. Local test (recommended first)

### 1. Create `online-booking.env`

```bat
copy online-booking.env.example online-booking.env
```

Edit `online-booking.env`:

```env
SUPABASE_URL=https://kprihawipljrltfzpfjd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your_service_role...
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxx
ONLINE_BOOKING_OTP_ENABLED=1
```

### 2. Start servers

```bat
start-online-booking.bat
```

- Static site: `http://127.0.0.1:8123/book.html?local=1`
- API: `http://127.0.0.1:8788`

### 3. Patient test

1. Open the patient page with `?local=1`
2. Fill form with a mobile Twilio is allowed to SMS
3. Click **Send verification code**
4. Check SMS → enter code on **Verify mobile** step
5. Confirm success screen shows a `WB-…` reference
6. Staff app → **Web Bookings** → new row appears as pending (staff still confirms)

### 4. Quick API health check

Open or curl:

`http://127.0.0.1:8788/health`

Expect `"otp_required": true` and `"twilio_configured": true`.

---

## E. Production: Supabase Edge Function

From a machine with [Supabase CLI](https://supabase.com/docs/guides/cli) logged in:

```bash
supabase functions deploy online-booking --no-verify-jwt
```

Set secrets:

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxx
supabase secrets set TWILIO_VERIFY_SERVICE_SID=VAxxxx
supabase secrets set ONLINE_BOOKING_OTP_ENABLED=1
```

`book.html` already points `edgeUrl` at:

`https://kprihawipljrltfzpfjd.supabase.co/functions/v1/online-booking`

On production hosts (not localhost), the page uses the Edge Function automatically.

---

## F. How the code uses Twilio (mental model)

```
Patient submits form
    → API action send-otp
        → SQL ob_create_otp_request  (hold in online_booking_requests)
        → Twilio Verify: POST /Verifications  (To=+852…, Channel=sms)
    → Patient enters code
    → API action verify-otp
        → Twilio Verify: POST /VerificationCheck
        → if approved → SQL ob_complete_otp_request
            → calls existing ob_request_booking
            → sets appointments.verified_at
```

Twilio stores and checks the OTP. We do **not** generate or hash codes ourselves when using Verify.

---

## G. Troubleshooting

| Symptom | Likely fix |
|---------|------------|
| “Twilio Verify is not configured” | Missing `TWILIO_*` in `online-booking.env` or Edge secrets |
| “SMS verification needs the booking API” | Open `book.html?local=1` and run `start-online-booking.bat`, or deploy Edge Function |
| OTP never arrives (Trial) | Verify the destination number under Verified Caller IDs |
| OTP never arrives (Paid) | Check Twilio **Monitor → Logs → Verify**; confirm HK SMS geo permissions |
| “OTP request not found” | Re-submit form (old request expired); re-run `online_booking_otp.sql` if RPC missing |
| Staff never sees booking | OTP not verified yet, or SQL complete RPC failed — check API console / Edge logs |
| Want to disable OTP temporarily | Set `ONLINE_BOOKING_OTP_ENABLED=0` (legacy direct booking) |

---

## H. Checklist (you are here)

- [x] Twilio account verified/approved  
- [ ] Create **Verify Service** → copy `VA…` SID  
- [ ] Fill `online-booking.env` (or Edge secrets)  
- [ ] Run `online_booking_otp.sql`  
- [ ] Local test with `start-online-booking.bat`  
- [ ] Deploy Edge Function for production  
- [ ] (Optional later) Buy a Twilio number — **not required for Verify OTP**

When the checklist is done, patient booking always requires a real SMS code before a web appointment row is created.
