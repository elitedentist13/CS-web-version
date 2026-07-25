# Admin login — Twilio Verify SMS OTP

After password validation, **admin** accounts must verify in **two sequential steps** when both services are available:

1. **SMS code** (Twilio Verify → `+85260716591`) — Step 1  
2. **Authenticator app (TOTP)** — Step 2, only after SMS passes

**Quiet fallback** (login still works):

| SMS (Twilio) | TOTP configured | Result |
|--------------|-----------------|--------|
| Working | Yes | **Both required** — SMS first, then TOTP |
| Not configured / fails | Yes | TOTP only |
| Working | No | Password only (cannot complete double verify) |
| Not configured / fails | No | Password only |

## Deploy (Supabase Edge Function)

1. Create a **Verify Service** in [Twilio Console → Verify](https://console.twilio.com/us1/develop/verify/services) and copy the `VA…` SID.

2. Set secrets (same as online booking OTP):

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxx
supabase secrets set TWILIO_VERIFY_SERVICE_SID=VAxxxx
```

3. Deploy:

```bash
supabase functions deploy admin-login-verify --no-verify-jwt
```

`--no-verify-jwt` is required because the user is not logged in yet.

4. Hard-refresh the clinic app (`Ctrl+Shift+R`) and test admin login.

## Notes

- The destination number is **fixed in the Edge Function** (`+85260716591`) — not configurable from the browser.
- Trial Twilio accounts must add this number under **Verified Caller IDs**.
- If SMS send fails, the login screen falls back to TOTP only (if set) or password-only (if no TOTP), without blocking login.
- When SMS works, **TOTP must be configured** in Configuration → Users to complete login (double verify).
