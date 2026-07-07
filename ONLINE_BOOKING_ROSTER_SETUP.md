# Doctor Roster Setup — Step by Step

Run these steps **once** in Supabase, then configure rosters in the staff app.

## Step 1 — Run SQL in Supabase

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project
2. Go to **SQL Editor**
3. Run these files **in order** (copy/paste full file → **Run**):

| Order | File | Purpose |
|-------|------|---------|
| 1 | `online_booking.sql` | Base booking columns (skip if already run) |
| 2 | `online_booking_rpc.sql` | Patient submit booking function |
| 3 | `online_booking_roster.sql` | **Doctor roster tables + calendar API** |

If you already ran (1) and (2), only run **`online_booking_roster.sql`**.

## Step 2 — Upload patient booking files

Upload to your host (Netlify / `book.joyfulsmiledental.com`):

- `book.html`
- `book.js`
- `book.css`

Hard-refresh the page on your phone after uploading.

## Step 3 — Open staff app

1. Open your clinic staff app (`index.html`)
2. Go to **Appointments** → **Web Bookings**
3. Click sub-tab **Doctor Roster**

## Step 4 — Configure a doctor roster

1. Select **Clinic** (e.g. CWB)
2. Select **Doctor** (e.g. Dr Ng)

### Option A — Pattern (weekly + optional alternate per day)

1. Ensure **Pattern (weekly)** mode is selected
2. **On duty** row — tick weekdays the doctor works every week (e.g. Tue, Sat)
3. **Alt wk** row — for a weekday that is *only every other week*, tick **On duty** AND **Alt wk** on that day only (e.g. Thu)
4. Set **Anchor week (Week A starts)** — pick the Monday of a week when that alternate day is **on**
5. Click **Save roster**

Example:

```
        Mon  Tue  Wed  Thu  Fri  Sat  Sun
On duty [ ]  [✓]  [ ]  [✓]  [ ]  [✓]  [ ]
Alt wk  [ ]  [ ]  [ ]  [✓]  [ ]  [ ]  [ ]
```

= Every Tue & Sat, plus Thu on alternate weeks only.

### Option B — Manual month

1. Click **Manual month**
2. Use ◀ ▶ to pick the month
3. Click dates to toggle on-duty days
4. Optional: **Copy from previous month** / **Clear this month**
5. Click **Save roster**

Repeat for each doctor at each clinic.

## Step 5 — Test patient booking

1. Open `book.html` on your phone
2. Select **Clinic** and **Doctor**
3. Calendar shows **blue highlighted** on-duty dates
4. Tap a highlighted date → time slots appear
5. Submit a test booking
6. In staff app → **Web Bookings** → **Bookings** tab → confirm the row appears

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No highlighted dates on patient calendar | Save roster in staff app; re-run `online_booking_roster.sql` |
| "Run online_booking_roster.sql" error on submit | Run Step 1 SQL file #3 |
| All weekdays still show (no roster yet) | Legacy mode uses old `online_booking_rules` until you save a roster profile |
| Alternate week wrong | Adjust **Anchor week** to a Monday when that day should be "on" |

## How it works

```
Staff: Doctor Roster panel → saves to Supabase tables
Patient: book.html → ob_get_duty_dates → highlights calendar
Patient: picks date → time slots → ob_request_booking (validates roster)
Staff: Web Bookings → Confirm
```
