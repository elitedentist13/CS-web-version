-- Patch: reward points SMS shows this chart's balance, the all-clinic total and the year-end note.
-- {YEAR} is filled in by the app. Safe to re-run.
-- The app already sends this layout when the saved template has no {TOTAL}; this keeps the saved copy in step.

update public.reward_program
set sms_template_en = $t$[Joyful Smile Dental Clinic 樂意牙科中心] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance ({CLINIC}): {BALANCE}
總結餘/All-clinic total: {TOTAL}
診所/Clinic: {CLINIC}
參考/Ref: {REF}
備註/Note: 所有積分將於今年{YEAR}年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。All reward points expire on 31 Dec {YEAR} 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.$t$,
    sms_template_zh_hant = $t$[Joyful Smile Dental Clinic 樂意牙科中心] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance ({CLINIC}): {BALANCE}
總結餘/All-clinic total: {TOTAL}
診所/Clinic: {CLINIC}
參考/Ref: {REF}
備註/Note: 所有積分將於今年{YEAR}年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。All reward points expire on 31 Dec {YEAR} 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.$t$,
    sms_template_zh_cn = $t$[Joyful Smile Dental Clinic 樂意牙科中心] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance ({CLINIC}): {BALANCE}
總結餘/All-clinic total: {TOTAL}
診所/Clinic: {CLINIC}
參考/Ref: {REF}
備註/Note: 所有積分將於今年{YEAR}年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。All reward points expire on 31 Dec {YEAR} 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.$t$,
    updated_at = now()
where id = 1;
