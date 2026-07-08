# Online Booking — Front Desk Guide  
# 網上預約 — 前台護士簡易手冊

**For front desk nurses | 給前台護士**  
**Version:** July 2026

---

## 1. What you need to know (30 seconds) | 三句話明白

**EN**  
Patients submit requests on the clinic website. They are **not confirmed** until **you** confirm them.  
Open **Appointments → 🌐 Web Bookings** and follow the red number.

**繁**  
病人在診所網頁提交申請，**要你確認後**才算正式預約。  
請開 **Appointments → 🌐 Web Bookings**，留意紅色數字。

---

## 2. Every morning — 4 steps | 每日四步

| Step | EN | 繁 |
|------|----|----|
| 1 | Select your **working clinic** (top of screen) | 頂部選好 **工作診所** |
| 2 | Open **🌐 Web Bookings** tab | 開啟 **🌐 網上預約** 分頁 |
| 3 | Work through rows with **blue** or **orange** status | 處理 **藍色** 或 **橙色** 狀態的列 |
| 4 | **Confirm** or **Cancel** each one | 逐筆 **確認** 或 **取消** |

Press **F2** if the list looks old.  
清單似過時可按 **F2** 重新整理。

---

## 3. Two kinds of web booking | 兩種網上預約

### Type A — Patient chose a time | 病人已選時間

| | EN | 繁 |
|---|----|----|
| **Status** | Blue — *Created from Web* | 藍色 — *網上預約待確認* |
| **You see** | Date + time filled in | 日期及時間已填 |
| **What to do** | Check details → **Confirm** | 核對資料 → 按 **確認** |

**Steps | 步驟**

1. Click the row | 點選該列  
2. Check name, phone, date, time | 核對姓名、電話、日期、時間  
3. (Optional) **WhatsApp** or call patient | （可選）**WhatsApp** 或致電  
4. (Optional) **Link patient** if they are in our system | （可選）**關聯病人**  
5. Click **Confirm** | 按 **確認**  

---

### Type B — Day was full; time not chosen | 當日已滿，待安排時間

| | EN | 繁 |
|---|----|----|
| **Status** | Orange — *Arrange by front desk* | 橙色 — *待前台安排* |
| **You see** | Date only — *Time TBC* | 只有日期 — *時間待定* |
| **What to do** | Call patient → set time → **Confirm** | 聯絡病人 → 設定時間 → **確認** |

**Steps | 步驟**

1. **WhatsApp** or call patient to agree a time | **WhatsApp** 或致電商討時間  
2. Click **Reschedule** (or double-click the row) | 按 **改期**（或雙擊該列）  
3. Set **date** and **time** → **Save Appointment** | 設定 **日期**、**時間** → **儲存預約**  
4. Click **Confirm** in Web Bookings | 在 Web Bookings 按 **確認**  

> **Shortcut | 捷徑:** Double-click row → edit → **Save** also confirms in one step.  
> 雙擊該列 → 編輯 → **儲存** 亦可一步確認。

---

## 4. Buttons (after you click a row) | 按鈕說明

| Button | EN | 繁 |
|--------|----|----|
| **Confirm** | Finalise booking | 確認預約 |
| **Reschedule** | Change date / time / doctor | 改日期／時間／醫生 |
| **Cancel** | Patient not coming / cannot fit | 取消預約 |
| **Link patient** | Attach to existing patient file | 關聯現有病人 |
| **WhatsApp** | Send message to patient | 發 WhatsApp |
| **View calendar** | See that day on calendar | 查看當日日曆 |

---

## 5. After you confirm | 確認之後

**EN**  
The booking appears on **Calendar** and **Today** like a normal appointment.  
Pending web bookings show a **dashed orange border** on the calendar until confirmed.

**繁**  
預約會在 **日曆** 及 **Today** 如一般預約顯示。  
未確認前，日曆上會有 **橙色虛線框**。

---

## 6. Notes for patients | 提醒病人

**EN**

- **Quarry Bay** and **Po Lam** — online booking **not available yet**. Ask them to phone the clinic.  
- We **do not** auto-send SMS/WhatsApp after they submit — **you** contact them.  
- Reference code (e.g. WB-20260708-A3F2) is on the booking row.

**繁**

- **鰂魚涌**、**寶琳** — 暫未開放網上預約，請病人致電診所。  
- 提交後 **不會** 自動發訊息 — 需 **同事** 聯絡病人。  
- 參考編號（如 WB-20260708-A3F2）在清單內。

---

## 7. Quick problems | 常見情況

| Problem 問題 | What to do 怎麼辦 |
|--------------|-------------------|
| Red number wrong 紅色數字不對 | Open Web Bookings again or press **F2** |
| Empty list 清單空白 | Check **working clinic** at top |
| Cannot press Confirm on orange row 橙色未能確認 | **Reschedule** first — must set a time |
| Patient says they booked but you see nothing 病人說已預約但看不到 | Check clinic filter; widen date **From** |
| System error 系統錯誤 | Tell manager / IT — see **Technical** section below |

---

# ─── Technical appendix (Admin / IT / Manager) ───  
# ─── 技術附錄（管理員／IT／經理）───

*Front desk nurses can skip this section.*  
*前台護士可略過此部分。*

---

## T1. One-time system setup | 一次性系統設定

Run in **Supabase SQL Editor**, in order:

| Order | File |
|-------|------|
| 1 | `online_booking.sql` |
| 2 | `online_booking_rpc.sql` |
| 3 | `online_booking_roster.sql` |

Upload to booking host: `book.html`, `book.js`, `book.css`  
Staff app: hard-refresh after updates (`index.html` BUILD tag).

Full roster steps: see `ONLINE_BOOKING_ROSTER_SETUP.md`

---

## T2. Doctor Roster (manager sets up) | 醫生排班（經理設定）

**Path:** Appointments → Web Bookings → **Doctor Roster**

- **Pattern (weekly)** — regular weekdays + optional alternate weeks  
- **Manual month** — tick dates per month  
- Sessions: **AM** 10:00–13:00 · **PM** 14:30–19:30 (weekend/PH to 18:30) · **Night** 21:00–23:30 (optional)  
- Only the **active** mode is saved; other panel is greyed out  

Patients only see **blue dates** on the booking page after roster is saved.

---

## T3. How data flows | 資料流程

```
Doctor Roster saved → Patient book.html submits
→ appointments table (booking_source = web)
→ Staff Web Bookings inbox → Confirm
→ Normal appointment on calendar
```

**Statuses in database:** `pending_staff` · `pending_arrange` · `confirmed` · `cancelled`

---

## T4. Technical troubleshooting | 技術故障排除

| Problem | Fix |
|---------|-----|
| Patient calendar has no blue dates | Save Doctor Roster; re-run `online_booking_roster.sql` |
| Submit error on patient page | Re-run `online_booking_roster.sql` |
| Booking columns missing | Re-run `online_booking.sql` + `online_booking_rpc.sql` |
| Edge API / local API | Deploy `supabase/functions/online-booking` or `tools/online-booking-api.mjs` |

---

## T5. Who does what | 分工

| Role | Tasks |
|------|-------|
| **IT / Admin** | SQL, upload patient page, Supabase |
| **Manager / senior nurse** | Doctor Roster |
| **Front desk** | Web Bookings inbox — this guide |

---

**Files | 相關檔案**

- Front desk guide: `ONLINE_BOOKING_STAFF_MANUAL.md` (this file)  
- Roster setup detail: `ONLINE_BOOKING_ROSTER_SETUP.md`

---

*End | 完*
