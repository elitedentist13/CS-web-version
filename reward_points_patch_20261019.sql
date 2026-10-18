-- Patch: bilingual ZH-Hant + EN SMS body for reward balance changes.
-- Safe to re-run.

update public.reward_program
set sms_template_en =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    sms_template_zh_hant =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    sms_template_zh_cn =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    updated_at = now()
where id = 1;
