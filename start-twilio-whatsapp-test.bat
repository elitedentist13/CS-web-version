@echo off
setlocal
cd /d "%~dp0"
echo.
echo  NOTE: The clinic UI now uses the LIVE Supabase Edge Function
echo  "twilio-whatsapp" (see TWILIO_WHATSAPP_TEST.md).
echo  This local :8790 server is optional offline only.
echo.
echo  Publish path:
echo    supabase functions deploy twilio-whatsapp --no-verify-jwt
echo    + set TWILIO_* secrets in Supabase Dashboard
echo.
pause
exit /b 0
