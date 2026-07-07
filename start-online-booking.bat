@echo off
setlocal
cd /d "%~dp0"

if exist online-booking.env (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("online-booking.env") do (
    if not "%%a"=="" set "%%a=%%b"
  )
)

if "%SUPABASE_SERVICE_ROLE_KEY%"=="" (
  echo.
  echo  For local API testing only, set your service role key:
  echo    1. Copy online-booking.env.example to online-booking.env
  echo    2. Paste SUPABASE_SERVICE_ROLE_KEY=... into online-booking.env
  echo.
  echo  Patient booking works without this if you ran online_booking_rpc.sql
  echo  in Supabase SQL Editor. Open book.html directly after that.
  echo.
)

set ONLINE_BOOKING_DEBUG=
echo Starting online booking API on port 8788 (staff confirm mode, no SMS OTP)...
echo Patient page: http://127.0.0.1:8123/book.html?local=1
echo.
start "" cmd /c "npx --yes http-server -p 8123 -c-1"
node tools/online-booking-api.mjs
