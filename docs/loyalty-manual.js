// docs/loyalty-manual.js — content of the Reward Points + Discount Coupons manual (English / 繁體中文 / 简体中文).
// Rendered by loyalty-manual.html (opened from 📖 How to use in Configuration → Reward Points / Discount Coupons,
// at #rewards-<app language> or #coupons-<app language>).
// After editing, rebuild the downloadable PDF with: tools\build-manual-pdf.ps1 -Name loyalty-manual
(function () {
    'use strict';

    var LANGS = [
        { id: 'en', label: 'English' },
        { id: 'zh-Hant', label: '繁體中文' },
        { id: 'zh-CN', label: '简体中文' }
    ];

    function capMock(m) {
        return '<div class="lm-mock" aria-hidden="true">' +
            '<div class="lm-mock-title">' + m.capTitle + '</div>' +
            '<div class="lm-mock-row"><b>' + m.capMax + '</b>' +
                '<span class="lm-box is-empty">—</span><span>% ' + m.ofBill + '</span>' +
                '<span>' + m.upTo + ' HK$</span><span class="lm-box">3000</span><span class="lm-btn">' + m.save + '</span></div>' +
            '<div class="lm-sum">' + m.capSum + '</div>' +
            '<div class="lm-note">' + m.capNote + '</div>' +
        '</div>';
    }

    function zeroMock(m) { return zeroMockOf(m, m.zeroTitle, m.zLife); }

    function dcZeroMock(m) { return zeroMockOf(m, m.dcZeroTitle, m.dcZLife); }

    function zeroMockOf(m, title, life) {
        return '<div class="lm-mock" aria-hidden="true">' +
            '<div class="lm-mock-title">' + title + '</div>' +
            '<span class="lm-radio">○ ' + m.zManual + '</span>' +
            '<span class="lm-radio">○ ' + m.zYear + '</span>' +
            '<span class="lm-radio">● ' + life + '</span>' +
            '<div class="lm-months">' + [1, 2, 3, 4, 6, 9, 12, 24].map(function (n) {
                return '<span' + (n === 12 ? ' class="is-on"' : '') + '>' + n + m.mo + '</span>';
            }).join('') + '</div>' +
            '<div class="lm-mock-row"><span class="lm-btn">' + m.save + '</span>' +
                '<span class="lm-btn is-danger">' + m.resetBtn + '</span></div>' +
        '</div>';
    }

    function ladderMock(m) {
        var rows = [[1000, 100, 74], [5000, 500, 94], [10000, 1000, 116]];
        return '<ol class="lm-ladder" aria-hidden="true">' + rows.map(function (r) {
            return '<li class="lm-rung" style="height:' + r[2] + 'px"><b>+HK$' + r[1] + '</b><span>' + m.spend + ' HK$' + r[0] + '</span></li>';
        }).join('') + '</ol>';
    }

    function cashMock(m) {
        return '<div class="lm-mock" aria-hidden="true">' +
            '<div class="lm-mock-title">' + m.cashTitle + '</div>' +
            '<div class="lm-mock-row"><b>' + m.cashCount + '</b><span class="lm-box">' + m.noLimit + ' ▾</span></div>' +
            '<div class="lm-mock-row" style="margin-top:4px"><b>' + m.cashMax + '</b>' +
                '<span class="lm-box">50</span><span>% ' + m.ofBill + '</span><span>' + m.upTo + ' HK$</span><span class="lm-box">3000</span></div>' +
            '<div class="lm-sum">' + m.cashSum + '</div>' +
        '</div>';
    }

    function deskCouponMock(m) {
        return '<div class="lm-mock" aria-hidden="true">' +
            '<div class="lm-mock-title">' + m.dkBill + '</div>' +
            '<div class="lm-mock-row"><span>🎟️ ' + m.dkCouponRow + '</span><b>−100.00</b><span class="lm-btn is-ghost">' + m.dkChoose + '</span></div>' +
            '<div class="lm-tabs"><span class="lm-tab is-on">' + m.dkUse + '</span><span class="lm-tab">' + m.dkGift + '</span>' +
                '<span class="lm-tab">' + m.dkXfer + '</span></div>' +
            '<div class="lm-ticket is-on"><b>HK$100</b> <small>' + m.dkWhole + '</small> <em>' + m.dkBest + '</em><span>−100.00 ✓</span></div>' +
            '<div class="lm-ticket is-off"><b>' + m.dkScaling + '</b> <small>' + m.dkTreat + '</small><span>' + m.dkNotTicked + '</span></div>' +
            '<div class="lm-sum">' + m.dkNewTotal + ' 460.00</div>' +
            '<div class="lm-mock-row"><span class="lm-btn">' + m.dkApply + '</span><span class="lm-btn is-ghost">' + m.dkNoCoupon + '</span></div>' +
        '</div>';
    }

    function deskPayMock(m) {
        return '<div class="lm-mock lm-mock-pay" aria-hidden="true">' +
            '<div class="lm-mock-title">💰 ' + m.dkAddPay + '</div>' +
            '<div class="lm-mock-row lm-split"><span>' + m.dkDoctor + '</span><b>Dr Chan</b></div>' +
            '<div class="lm-mock-row lm-split"><b>' + m.dkAvail + '</b><b class="lm-green">1,250.00</b></div>' +
            '<div class="lm-mock-row">☑ ' + m.dkUsePts + '</div>' +
            '<div class="lm-mock-row lm-split"><small>' + m.dkByClinic + '</small><span class="lm-btn is-green">' + m.dkRedeemAll + '</span></div>' +
            '<div class="lm-mock-row"><span>☑ PL 800.00</span><span>☑ KT 450.00</span></div>' +
            '<div class="lm-mock-row"><span>' + m.dkPtsToUse + '</span><span class="lm-box">500</span></div>' +
            '<div class="lm-sum">' + m.dkWillTake + ' KT 450.00 · PL 50.00</div>' +
            '<div class="lm-note">' + m.dkCapNote + '</div>' +
            '<div class="lm-mock-row" style="margin-top:6px"><span class="lm-btn">' + m.dkConfirm + '</span></div>' +
        '</div>';
    }

    var T = {
        en: {
            coverPart: { rw: 'Reward points', dc: 'Discount coupons', dk: 'At the payment desk' },
            rw: {
                title: '🎁 Reward Points — set-up guide',
                intro: 'Patients earn reward points on what they pay. <b>1 point = HK$1</b> off a later bill. ' +
                    'Points used as a discount are <b>not counted as clinic income</b>. This page explains every control in ' +
                    '<b>Configuration → 🎁 Reward Points</b>.',
                before: 'Before you start',
                beforeList: [
                    'Everyone can open the page, but only <b>Admin</b> can change it. Other logins see the values with ' +
                        '“Only Admin can change this setting.”',
                    'Most cards have their own <b>Save</b> button. Ticks (SMS, Join) save as soon as you click them.',
                    'The red card needs the admin <b>SMS code</b> and the <b>Google Authenticator</b> code.'
                ],
                steps: [
                    { t: 'Earn rate', list: [
                        'Type the percentage of each payment that comes back as points (default <b>10%</b>), then press <b>Save</b>.',
                        'Points already earned do not change. Points earned on a payment can be used from the <b>next</b> payment, not the same one.'
                    ] },
                    { t: 'SMS notify on balance change', list: [
                        'Tick <b>Send Twilio SMS when points change</b> to text the patient each time the balance goes up or down.',
                        'Untick to stop the SMS. It saves at once.'
                    ] },
                    { t: 'Refer a friend (points)', list: [
                        'Tick <b>Give reward points for referrals</b>, fill in <b>Points</b> and <b>Min payment HK$</b>, then press <b>Save</b>.',
                        'The referrer gets the points as soon as the new patient has paid <b>at least the minimum in cash on one bill</b> — a full payment or a part payment both count. ' +
                            'A small <b>Refer a friend bonus activated</b> message then pops up at the bottom right of the screen. ' +
                            'Leave the minimum blank for any amount.',
                        'On the patient form, staff pick the referrer under <b>Referred by</b> and choose <b>points</b> or a <b>discount coupon</b>. ' +
                            'A choice is greyed out where the clinic is not in that scheme.'
                    ] },
                    { t: 'Using points on one bill', key: true, mock: capMock, list: [
                        'Set the most points one bill can use: a <b>% of the bill</b>, an amount <b>up to HK$</b>, or both. Press <b>Save</b>.',
                        'Both limits apply and the <b>smaller one wins</b>. Leave a box blank to drop that limit. The % is of the bill total.',
                        'Default: <b>up to HK$3,000</b> per bill, no %. The patient’s phone page shows the limit you save here ' +
                            '(for example “Maximum usage per bill is HK$3,000.”); with both boxes blank it shows no limit line.',
                        'It counts <b>every payment on the same bill</b>. At the payment desk the points box stops at the limit, ' +
                            'an amber note shows what is left, and <b>✓ Confirm Payment</b> refuses anything over it.'
                    ] },
                    { t: 'Reset reward points to zero', danger: true, mock: zeroMock, list: [
                        'Choose how balances are cleared: <b>Manual</b> (default, points never clear by themselves), ' +
                            '<b>every year on 31 Dec 23:59</b> (HK time), or a <b>life span</b> of 1–24 months ' +
                            '(points clear after that many months with no new points).',
                        'Press <b>Save</b>, then enter the <b>SMS code</b> and the <b>Google Authenticator</b> code.',
                        '<b>Manual RESET ZERO</b>: press <b>RESET ZERO</b> → verify (SMS + Authenticator) → tick <b>All clinics</b> or single clinics → ' +
                            '<b>Confirm set zero</b> → type the word <b>confirm</b> → <b>Wipe points now</b>.',
                        'Every reset keeps a <b>safety log</b>. <b>Step back and recover last balance before set zero</b> brings the last reset back. ' +
                            'The grey line under the buttons shows the last safety log.'
                    ] },
                    { t: 'Clinics in scheme', list: [
                        'One tab per clinic. A <b>dot</b> on the tab means the clinic is joined. Default: <b>PL · All Doctors</b>.',
                        'Each row has a <b>Gain &amp; Redeem</b> tick. <b>All Doctors</b> joins the whole clinic; a doctor row joins only that doctor. ' +
                            'It saves at once (“Saved”).',
                        'Points belong to the <b>doctor</b> who earned them. A bill can use only points earned with the <b>same doctor</b> — ' +
                            'at any clinic where that doctor earned them. The doctor must be chosen on the bill.'
                    ] },
                    { t: 'Summary log', list: [
                        'The latest 80 point changes: when, clinic, doctor, chart no., patient, type, points, balance after, and who did it.'
                    ] }
                ],
                recap: 'At the payment desk',
                recapList: [
                    'In <b>Add payment</b>, tick <b>Use reward points as discount</b>, then type <b>Points to use</b> or press <b>Redeem all</b> ' +
                        '(takes the smallest clinic balance first).',
                    'In the patient’s points ledger, <b>📱 Points on the phone</b> makes a QR code and a WhatsApp message so the patient can see the balance.'
                ],
                tips: 'Problems?',
                tipList: [
                    ['“Only Admin can change this setting.”', 'You are not logged in as Admin. Ask an Admin to change it.'],
                    ['The points box stops below the balance', 'It stops at the smallest of: the bill balance, the points for this doctor, and the per-bill limit. The amber note shows the limit.'],
                    ['“No reward points for Dr … to redeem.”', 'Points belong to the doctor who earned them. Check the bill has the right doctor, and the doctor is joined in Clinics in scheme.'],
                    ['Today’s points cannot be used', 'By design: points earned on a payment can be used from the next payment.'],
                    ['Balances were reset by mistake', 'Press Step back… on the red card. It recovers the last RESET ZERO from its safety log.'],
                    ['Step back is greyed out', 'There is no RESET ZERO safety log left to recover.'],
                    ['The SMS code does not arrive', 'Press Resend SMS code. If SMS cannot be sent, only the Google Authenticator code is asked.']
                ]
            },
            dc: {
                title: '🎟️ Discount Coupons — set-up guide',
                intro: 'Coupons are separate from reward points. Patients collect them in a wallet and use them on later bills. ' +
                    'This page explains every control in <b>Configuration → 🎟️ Discount Coupons</b>.',
                before: 'Before you start',
                beforeList: [
                    'There is <b>no Save button</b>: each change saves as soon as you leave the box or click the tick. ' +
                        'The one exception is the red <b>Set discount coupons to zero</b> card, which has its own Save and needs the admin SMS + Google Authenticator codes.',
                    'A yellow banner at the top lists the clinics where coupons are <b>switched off</b>.',
                    '<b>Coupon rules (tap to open)</b> lists the rules staff and patients follow (see the summary at the end).'
                ],
                steps: [
                    { t: 'Clinics in scheme', list: [
                        'One tab per clinic; a <b>dot</b> means joined. <b>Join</b> on the clinic row switches the whole clinic. ' +
                            'KT is joined by default; other clinics stay off until you tick them.',
                        'Under it, <b>All Doctors</b> and each doctor have their own <b>Join</b>.',
                        'Bills at a clinic that is off neither use nor earn coupons.'
                    ] },
                    { t: 'Expenditure coupons', mock: ladderMock, list: [
                        'Five spend rows. The first three are filled in (spend HK$1,000 / 5,000 / 10,000 → get HK$100 / 500 / 1,000); the last two stay blank until you fill them.',
                        'Each row: the <b>switch</b>, <b>Spend HK$</b>, <b>Coupon HK$</b>, <b>Days</b> (valid for), <b>Hold up to</b> ' +
                            '(most unused coupons of this kind one patient can hold), <b>Issue cap</b> and <b>Budget HK$</b>.',
                        'A row issues only when it is on and both amounts are filled. One bill earns <b>every row it reaches</b>; the picture shows the tiers.',
                        'Spend counts all cash paid on the bill (not reward points, balance transfer or voided payments). The coupon can be used from the <b>next</b> bill.'
                    ] },
                    { t: 'Campaigns', list: [
                        'Every other offer, each with a switch, a preview ticket and its boxes: <b>HK$</b>, <b>%</b> (percentage coupons), <b>Days</b>, ' +
                            '<b>Ceiling</b> (most HK$ it can take off), <b>Hold up to</b>, <b>Issue cap</b>, <b>Budget HK$</b>.',
                        '<b>Whole-bill coupons</b>: Cash coupon (staff gift HK$1–200), New chart and Refer a friend (both issued automatically; ' +
                            'Refer a friend has <b>Min payment HK$</b>).',
                        '<b>Treatment coupons</b>: Free scaling, Free filling, Free extraction, Implant, Orthodontic, Crown and bridge, Root canal, Whitening. ' +
                            'They only cover the treatment items ticked for them (step 5).',
                        'The badge shows <b>On</b>, <b>Off</b>, <b>Needs setup</b> or <b>Limit reached</b>. Issue cap and budget are optional; voided coupons do not count.'
                    ] },
                    { t: 'Using cash coupons on one bill', key: true, mock: cashMock, list: [
                        'Inside the Cash coupon card. <b>Cash coupons per bill</b>: No limit, or 1–10.',
                        '<b>Max cash off per bill</b>: a <b>% of the bill</b> and/or <b>up to HK$</b>. Both apply and the smaller one wins; blank drops that limit.',
                        'Default: any number of cash coupons, <b>50% of the bill up to HK$3,000</b>. The % is of the whole bill before coupons.',
                        'Only cash coupons stack. Spend, new-chart and referral coupons stay one per bill and are not combined with cash.'
                    ] },
                    { t: 'Treatment items for a treatment coupon', list: [
                        '<b>Smart keyword filter</b>: items whose name has one of the <b>Keywords</b> (comma separated) and none of the <b>Exclude words</b> are ticked for you.',
                        'Open <b>Treatment items: … ticked</b> to see the list. Search, then tick or untick any item. ' +
                            'Tags: <i>keyword</i> = ticked by keyword, <i>unticked</i> = keyword match you took out, <i>not in list</i> = no longer in the treatment list.',
                        'A line typed on the bill counts only if its name is exactly the same as the treatment list.'
                    ] },
                    { t: 'Set discount coupons to zero', danger: true, mock: dcZeroMock, list: [
                        'The red card above Referrals. Admin only; other logins see the option in use. Setting zero <b>voids every unused coupon</b> ' +
                            'in the chosen clinics (a coupon belongs to the clinic that issued it). Used and expired coupons are not touched.',
                        'Choose how coupons are cleared: <b>Manual</b> (<b>default</b> — coupons are never cleared by themselves), ' +
                            '<b>every year on 31 Dec 23:59</b> (HK time; clears coupons issued before 1 Jan), ' +
                            'or a <b>life span</b> of 1, 2, 3, 4, 6, 9, 12 or 24 months (clears unused coupons issued longer ago, even if their own expiry is later).',
                        '<b>Every change of option needs the admin SMS code and the Google Authenticator code.</b> ' +
                            '<b>Save</b> lights up only after you pick a different option or month; press it, then enter both codes. Nothing changes until both codes pass.',
                        'Year-end and life span run by themselves when the Discount Coupons config page is opened (year-end once a year, life span at most once a day). ' +
                            'Turning on year-end part way through a year starts with the coming 31 Dec.',
                        '<b>Manual RESET ZERO</b>: press <b>RESET ZERO</b> → verify → tick <b>All clinics</b> or single clinics → ' +
                            '<b>Confirm set zero</b> → type <b>confirm</b> → <b>Void coupons now</b>.',
                        'Every clear keeps a <b>safety log</b> and a line in the Coupon log. <b>Step back and give back the coupons of the last set zero</b> ' +
                            'makes those coupons usable again. The grey line under the buttons shows the last safety log.'
                    ] },
                    { t: 'Referrals', list: [
                        'Each new patient with a referrer. <b>Pending</b> waits until the new patient has paid the minimum on a bill (full or part payment); <b>blocked</b> shows why no coupon was given.'
                    ] },
                    { t: 'Coupon log', list: [
                        'Pick the dates (from → to) and an optional <b>Chart no.</b>, then press <b>Show</b>. The chips filter by action; <b>Export CSV</b> downloads the list.',
                        'It lists every coupon issued, gifted, transferred, given back on a void, or cancelled. Gifts show the login that gave them.'
                    ] }
                ],
                recap: 'Coupon rules in short',
                recapList: [
                    'Per bill: one treatment coupon plus either one whole-bill coupon (spend, new chart, referral) or cash coupons. The treatment coupon comes off first.',
                    'No change and no cash back: if a coupon is worth more than the bill, the rest is lost.',
                    'New-chart and referral coupons stay with the patient; other coupons can be transferred to another chart no.',
                    'Voiding a bill returns the coupons used on it and cancels coupons it issued.',
                    'Expired coupons cannot be used; patients get an SMS 7 days before expiry. A wallet holds up to 20 unused coupons.'
                ],
                tips: 'Problems?',
                tipList: [
                    ['Badge “Needs setup”', 'Fill in the HK$ amount (both amounts for a spend row), or tick at least one treatment item.'],
                    ['Badge “Limit reached”', 'The Issue cap or Budget is used up. Raise it, or clear the box for no limit.'],
                    ['“Coupons are switched off at …”', 'Those clinics are not joined. Open the clinic tab and tick Join.'],
                    ['A patient did not get a coupon', 'The clinic or doctor is not joined, the row is off, or the patient already holds the Hold up to number (or 20 coupons in all).'],
                    ['A coupon cannot be used on a bill', 'The clinic or doctor is not joined, the treatment is not ticked for that coupon, the coupon has expired, or a whole-bill coupon is already on the bill.'],
                    ['Cash coupons stop short', 'The per-bill cash limit applies (default 50% of the bill, up to HK$3,000).'],
                    ['Coupons were set to zero by mistake', 'Press Step back… on the red card. It gives back the coupons of the last set zero from its safety log.'],
                    ['Save on the set zero card is greyed out', 'You have not picked a different option or month yet. Every change needs the SMS and Google Authenticator codes.'],
                    ['“Run discount_coupon_zero.sql in Supabase first.”', 'The set zero tables are not in the database yet. Ask the system admin to run discount_coupon_zero.sql once.']
                ]
            },
            desk: {
                title: '🧾 At the payment desk — reward points &amp; discount coupons',
                intro: 'For front-desk staff using Banana. This part shows, step by step, how to use <b>discount coupons</b> and ' +
                    '<b>reward points</b> while you take a payment: <b>Bill Detail</b> → 🎟️ coupon row → <b>+ Add Payment</b>.',
                before: 'Before you start',
                beforeList: [
                    'Each scheme works only at clinics (and doctors) that are joined. Where a clinic is not in a scheme, its controls are hidden or greyed out.',
                    'Choose the <b>treating doctor</b> on the bill first. Reward points belong to the doctor who earned them.',
                    'Work in this order: <b>coupon first, then payment</b>. The coupon row locks as soon as any payment is on the bill.'
                ],
                steps: [
                    { t: 'See what the patient has', list: [
                        'On the patient info banner, the <b>Rewards</b> button shows the points balance. The <b>📖 How to use</b> link next to it opens this manual.',
                        'Click <b>Rewards</b> to open the panel with two tabs: <b>🎁 Reward points</b> (ledger) and <b>🎟️ Discount coupons</b> (wallet). ' +
                            'A tab is greyed out (“Clinic not in scheme”) where the clinic is not joined.',
                        'The same panel opens from <b>Patients → ⋯ → Rewards</b>. On the patient <b>Dashboard</b>, the 🎁 card shows the points and the 🎟️ <b>Coupon wallet</b> card shows how many coupons are live.'
                    ] },
                    { t: 'Use a discount coupon on the bill', key: true, mock: deskCouponMock, list: [
                        'In <b>Bill Detail</b>, press <b>Choose</b> on the 🎟️ <b>Discount coupon</b> row. The <b>Use</b> tab lists the patient’s live coupons.',
                        'Each ticket shows its value, <b>Whole bill</b> or <b>Treatment</b>, the expiry, and how much it takes off. <b>Best</b> marks the biggest saving.',
                        'Tap a ticket to pick it (<b>✓ Selected</b>). The line at the bottom shows the new total. Press <b>Apply</b>.',
                        'A ticket that cannot be used shows the reason instead of an amount (for example the treatment is not on the bill, or it has expired).',
                        'To take a coupon off, press <b>Choose</b> → <b>Do not use a coupon</b>. Once a payment is saved, <b>Choose</b> is greyed out.'
                    ] },
                    { t: 'Gift or transfer a coupon', list: [
                        '<b>Gift</b> tab: pick the coupon type (cash coupon HK$1–200, or a treatment coupon that is turned on), then press the 🔒 button and log in with your staff login.',
                        '<b>Transfer</b> tab: pick the coupon, type the other patient’s <b>chart no.</b>, then 🔒 log in. New-chart and referral coupons cannot be moved.',
                        'You can do the same without a bill: <b>Rewards</b> → <b>🎟️ Discount coupons</b> tab → <b>Wallet</b> / <b>Gift</b> / <b>Transfer</b>. ' +
                            'Wallet there is for browsing only. Press Esc to close the login box without closing the panel.'
                    ] },
                    { t: 'Use reward points in Add Payment', key: true, mock: deskPayMock, list: [
                        'Press <b>+ Add Payment</b>. The green reward box shows the <b>Doctor</b> and <b>Available for this doctor (all clinics)</b>.',
                        'Tick <b>Use reward points as discount</b>. Under <b>By clinic (same doctor)</b>, tick the clinics to take points from.',
                        'Type <b>Points to use</b>, or press <b>Redeem all</b> (it takes the smallest clinic balance first). <b>Will take:</b> shows which clinic pays for it.',
                        'The <b>Amount</b> box drops by the points, so it shows the cash still to pay. If you hit the per-bill limit, an amber note shows what is left.',
                        'Fill in the payment method, then press <b>✓ Confirm Payment</b>. Points used are a discount, <b>not clinic income</b>.'
                    ] },
                    { t: 'After the payment', list: [
                        'Points earned on this payment appear in the <b>Rewards</b> balance. They can be used from the <b>next</b> payment, not the same one.',
                        'Coupons earned by spending are issued when the bill is <b>fully paid</b>. The green box under the balance shows <b>Earned from this bill</b>, ' +
                            'or how much more to spend for the next coupon.',
                        'The <b>Saved on this bill</b> line adds up line discounts, extra discount and coupons.'
                    ] },
                    { t: 'Give the patient the phone page', list: [
                        'Points: <b>Rewards</b> → 🎁 tab → <b>📱 Points on the phone</b>. Coupons: <b>Rewards</b> → 🎟️ tab → <b>Wallet QR</b>, or the 🎟️ <b>Coupon wallet</b> card on the patient Dashboard.',
                        'The patient scans the QR code with the phone camera. You can also copy the link, download the PNG, print a slip, or send it by <b>WhatsApp</b>.',
                        '<b>New QR code</b> stops the old link from working (for example if the patient lost the phone). The phone page is browse only.'
                    ] },
                    { t: 'Fixing a mistake', danger: true, list: [
                        '<b>Void a payment</b>: the points used on it come back, and the points it earned are taken away.',
                        '<b>Void a bill</b>: coupons used on it go back to the wallet, and coupons it issued are cancelled. Points are reversed the same way.',
                        'Wrong coupon before any payment? Press <b>Choose</b> again and pick another one, or <b>Do not use a coupon</b>.'
                    ] }
                ],
                recap: 'Quick order at the desk',
                recapList: [
                    'Doctor on the bill → <b>Choose</b> a coupon → <b>Apply</b>.',
                    '<b>+ Add Payment</b> → tick <b>Use reward points</b> → <b>Points to use</b> or <b>Redeem all</b> → <b>✓ Confirm Payment</b>.',
                    'Tell the patient about the phone page (📱 points, Wallet QR for coupons).'
                ],
                tips: 'Problems?',
                tipList: [
                    ['The green reward box is not in Add Payment', 'The clinic or the bill’s doctor is not joined in Reward Points → Clinics in scheme.'],
                    ['“Use reward points” cannot be ticked', 'No doctor on the bill, or this patient has no points with this doctor.'],
                    ['Choose is greyed out', 'A payment is already on the bill. Coupons must be chosen before the first payment.'],
                    ['A coupon shows a reason instead of an amount', 'The treatment is not on the bill, the coupon has expired, a whole-bill coupon is already used, or the clinic is not in the coupon scheme.'],
                    ['The points box stops early', 'It stops at the smallest of: the bill balance, this doctor’s points, and the per-bill limit.'],
                    ['Points from today cannot be used', 'By design: points earned on a payment are usable from the next payment.']
                ]
            },
            mock: {
                dkBill: 'Bill Detail', dkCouponRow: 'Discount coupon', dkChoose: 'Choose', dkUse: 'Use', dkGift: 'Gift', dkXfer: 'Transfer',
                dkWhole: 'Whole bill', dkTreat: 'Treatment', dkBest: 'Best', dkScaling: 'Free scaling', dkNotTicked: 'Not on this bill',
                dkNewTotal: 'New total', dkApply: 'Apply', dkNoCoupon: 'Do not use a coupon',
                dkAddPay: 'Add Payment', dkDoctor: 'Doctor', dkAvail: 'Available for this doctor (all clinics)', dkUsePts: 'Use reward points as discount',
                dkByClinic: 'By clinic (same doctor)', dkRedeemAll: 'Redeem all', dkPtsToUse: 'Points to use', dkWillTake: 'Will take:',
                dkCapNote: 'Per-bill limit HK$3000.00 · already used on this bill 0.00 · can use now 3000.00', dkConfirm: '✓ Confirm Payment',
                capTitle: 'Using points on one bill', capMax: 'Max points used per bill', ofBill: 'of the bill', upTo: 'up to', save: 'Save',
                capSum: 'At most HK$3,000 in points per bill',
                capNote: 'Per-bill limit HK$3000.00 · already used on this bill 500.00 · can use now 2500.00',
                zeroTitle: 'Reset reward points to zero', zManual: 'Manual (default)', zYear: 'Auto set zero every year on 31 Dec 23:59 (HK)',
                zLife: 'Set each reward points life span of:', mo: ' mo', resetBtn: 'RESET ZERO',
                dcZeroTitle: 'Set discount coupons to zero', dcZLife: 'Set each coupon’s life span to at most:',
                spend: 'Spend',
                cashTitle: 'Using cash coupons on one bill', cashCount: 'Cash coupons per bill', noLimit: 'No limit',
                cashMax: 'Max cash off per bill', cashSum: 'Any number of cash coupons per bill · at most 50% of the bill up to HK$3,000'
            }
        },
        'zh-Hant': {
            coverPart: { rw: '獎勵積分', dc: '優惠券', dk: '收費櫃檯' },
            rw: {
                title: '🎁 獎勵積分 — 設定說明',
                intro: '病人按付款金額賺取獎勵積分，<b>1 積分 = HK$1</b>，可在之後的賬單抵扣。' +
                    '積分抵扣<b>不計作診所收入</b>。本頁說明 <b>設定 → 🎁 獎勵積分</b> 內每一項設定。',
                before: '開始前',
                beforeList: [
                    '所有人都可開啟此頁，但只有<b>管理員</b>可以更改。其他登入只會看到數值及「僅管理員可更改此設定。」',
                    '大部分設定卡有自己的<b>儲存</b>按鈕；剔選（短訊、加入）一按即儲存。',
                    '紅色設定卡需要管理員的<b>短訊驗證碼</b>及 <b>Google 驗證器</b>驗證碼。'
                ],
                steps: [
                    { t: '賺取比率', list: [
                        '輸入每筆付款轉為積分的百分比（預設 <b>10%</b>），然後按<b>儲存</b>。',
                        '已賺取的積分不會改變。今次付款賺取的積分可於<b>下一筆</b>付款使用，不可在同一筆付款內抵扣。'
                    ] },
                    { t: '結餘變動短訊通知', list: [
                        '剔選<b>積分變動時發送 Twilio 短訊</b>，結餘每次增減都會以短訊通知病人。',
                        '取消剔選即停止發送，一按即儲存。'
                    ] },
                    { t: '介紹新客（積分）', list: [
                        '剔選<b>介紹新客可獲積分</b>，填寫<b>積分</b>及<b>最低付款 HK$</b>，然後按<b>儲存</b>。',
                        '新病人在<b>同一張賬單的現金付款累計達最低金額</b>（全數或部分付款均計算），介紹人即獲得積分，畫面右下角會彈出<b>介紹新客獎賞已啟動</b>的小提示。最低金額留空即不設下限。',
                        '在病人資料表的<b>轉介人</b>選擇介紹人，再選<b>積分</b>或<b>優惠券</b>。如該診所未參加某計劃，該選項會變灰。'
                    ] },
                    { t: '單張賬單使用積分上限', key: true, mock: capMock, list: [
                        '設定每張賬單最多可用多少積分：<b>賬單金額 %</b>、<b>最多 HK$</b>，或兩者都設，然後按<b>儲存</b>。',
                        '兩個上限同時適用，<b>以較小者為準</b>；留空即取消該上限。百分比以賬單總額計算。',
                        '預設：每張賬單<b>最多 HK$3,000</b>，不設百分比。病人手機頁面會顯示此處儲存的上限（例如「每張賬單最高使用額為 HK$3,000。」）；兩格都留空則不顯示上限。',
                        '同一張賬單的<b>每次付款合併計算</b>。付款時積分欄不能超過上限，琥珀色提示顯示尚餘多少，超出時<b>✓ 確認付款</b>會被拒絕。'
                    ] },
                    { t: '將獎勵積分清零', danger: true, mock: zeroMock, list: [
                        '選擇清零方式：<b>手動</b>（預設，積分不會自動清零）、<b>每年 12 月 31 日 23:59</b>（香港時間）自動清零，' +
                            '或<b>有效期</b> 1–24 個月（連續該月數沒有新積分便清零）。',
                        '按<b>儲存</b>，再輸入<b>短訊驗證碼</b>及 <b>Google 驗證器</b>驗證碼。',
                        '<b>手動清零</b>：按<b>清零重置</b> → 驗證（短訊 + 驗證器）→ 剔選<b>全部診所</b>或個別診所 → ' +
                            '<b>確認清零</b> → 輸入 <b>confirm</b> 一字 → <b>立即清零</b>。',
                        '每次清零都會保留<b>安全日誌</b>。<b>回退並還原清零前的上次結餘</b>可把上一次清零還原；按鈕下方的灰字顯示上一個安全日誌。'
                    ] },
                    { t: '參與診所', list: [
                        '每間診所一個分頁，分頁上的<b>圓點</b>表示已加入。預設：<b>PL · 全部醫生</b>。',
                        '每行有<b>賺取 &amp; 兌換</b>剔選。<b>全部醫生</b>即整間診所加入；醫生行只加入該醫生。一按即儲存（「已儲存」）。',
                        '積分屬於賺取它的<b>醫生</b>。賬單只可使用<b>同一醫生</b>賺取的積分 — 該醫生在任何診所賺取的都可以。賬單上必須選擇醫生。'
                    ] },
                    { t: '匯總日誌', list: [
                        '最近 80 筆積分變動：時間、診所、醫生、病歷號、病人、類型、積分、變動後結餘及經手人。'
                    ] }
                ],
                recap: '在收費處',
                recapList: [
                    '在<b>新增付款</b>剔選<b>使用積分抵扣</b>，再輸入<b>使用積分數</b>或按<b>全部兌換</b>（先扣結餘較少的診所）。',
                    '在病人的積分紀錄面板按 <b>📱 手機查看積分</b>，可產生 QR 碼及 WhatsApp 訊息，讓病人在手機查看結餘。'
                ],
                tips: '遇到問題？',
                tipList: [
                    ['「僅管理員可更改此設定。」', '目前不是以管理員登入。請管理員更改。'],
                    ['積分欄停在結餘以下', '上限取以下最小者：賬單結欠、該醫生的積分、每張賬單上限。琥珀色提示會顯示上限。'],
                    ['「Dr … 沒有可兌換積分。」', '積分屬於賺取它的醫生。請確認賬單上的醫生正確，並已在「參與診所」加入。'],
                    ['今天賺取的積分不能用', '設計如此：今次付款賺取的積分可於下一筆付款使用。'],
                    ['誤把結餘清零', '在紅色設定卡按「回退並還原…」，系統會按安全日誌還原上一次清零。'],
                    ['「回退」按鈕是灰色', '沒有可還原的清零安全日誌。'],
                    ['收不到短訊驗證碼', '按「重新發送短訊驗證碼」。如短訊無法發送，系統只會要求 Google 驗證器驗證碼。']
                ]
            },
            dc: {
                title: '🎟️ 優惠券 — 設定說明',
                intro: '優惠券與獎勵積分分開運作。病人把優惠券存入錢包，於之後的賬單使用。本頁說明 <b>設定 → 🎟️ 優惠券</b> 內每一項設定。',
                before: '開始前',
                beforeList: [
                    '此頁<b>沒有儲存按鈕</b>：離開輸入格或按剔選後即自動儲存。' +
                        '唯一例外是紅色的<b>優惠券清零</b>卡片，它有自己的儲存按鈕，並需管理員短訊及 Google 驗證器驗證碼。',
                    '頂部的黃色橫額列出<b>未開啟</b>優惠券的診所。',
                    '<b>優惠券使用規則（點擊展開）</b>列出員工及病人須遵守的規則（摘要見本頁末）。'
                ],
                steps: [
                    { t: '參與診所', list: [
                        '每間診所一個分頁，<b>圓點</b>表示已加入。診所行的<b>加入</b>開關整間診所。KT 預設已加入，其他診所須剔選後才開啟。',
                        '下方<b>全部醫生</b>及每位醫生各有<b>加入</b>剔選。',
                        '未加入的診所，賬單既不能使用、也不會獲發優惠券。'
                    ] },
                    { t: '消費滿額券', mock: ladderMock, list: [
                        '共五行。首三行已填好（消費 HK$1,000 / 5,000 / 10,000 → 送 HK$100 / 500 / 1,000），最後兩行留空，待你填寫。',
                        '每行：<b>開關</b>、<b>消費 HK$</b>、<b>優惠 HK$</b>、<b>有效日數</b>、<b>最多持有</b>（每位病人最多持有多少張未用的此類券）、' +
                            '<b>發放上限</b>及<b>預算 HK$</b>。',
                        '只有已開啟且兩個金額都已填寫的行才會發券。一張賬單可獲得<b>所有達到的級別</b>，圖示顯示各級別。',
                        '消費金額計算賬單上所有現金付款（不包括積分、結餘轉移或已作廢付款）。獲發的券可於<b>下一張</b>賬單使用。'
                    ] },
                    { t: '優惠活動', list: [
                        '其餘每項優惠都有開關、預覽票券及以下輸入格：<b>HK$</b>、<b>%</b>（百分比券）、<b>有效日數</b>、<b>上限</b>（最多扣減 HK$）、' +
                            '<b>最多持有</b>、<b>發放上限</b>、<b>預算 HK$</b>。',
                        '<b>全單券</b>：現金券（員工可贈送 HK$1–200）、新客券及介紹新客（兩者自動發放；介紹新客設有<b>最低付款 HK$</b>）。',
                        '<b>治療券</b>：免費洗牙、免費補牙、免費脫牙、植牙、矯齒、牙套牙橋、根管、美白優惠 — 只適用於為該券剔選的治療項目（第 5 步）。',
                        '標籤顯示<b>已開啟</b>、<b>已關閉</b>、<b>需設定</b>或<b>已達上限</b>。發放上限及預算可留空；已作廢的券不計算在內。'
                    ] },
                    { t: '同一張單使用現金券', key: true, mock: cashMock, list: [
                        '位於「現金券」設定卡內。<b>每張單現金券數量</b>：不限，或 1–10 張。',
                        '<b>每張單現金券扣減上限</b>：<b>賬單金額 %</b> 及／或<b>最多 HK$</b>。兩者同時適用，以較小者為準；留空即取消該上限。',
                        '預設：現金券數量不限，<b>賬單金額 50%，最多 HK$3,000</b>。百分比以使用優惠券前的整張賬單計算。',
                        '只有現金券可以疊加。消費滿額券、新客券及介紹新客券每張單只限一張，且不可與現金券同用。'
                    ] },
                    { t: '治療券的治療項目', list: [
                        '<b>智能關鍵字篩選</b>：名稱含有<b>關鍵字</b>（以逗號分隔）而不含<b>排除字詞</b>的項目會自動剔選。',
                        '打開<b>適用治療項目：… 項已勾選</b>查看清單，可搜尋並剔選或取消任何項目。' +
                            '標記：<i>關鍵字</i> = 由關鍵字剔選；<i>已剔除</i> = 符合關鍵字但被你取消；<i>不在項目表</i> = 已不在治療項目清單。',
                        '賬單上手動輸入的項目，名稱必須與治療項目清單完全相同才計算。'
                    ] },
                    { t: '優惠券清零', danger: true, mock: dcZeroMock, list: [
                        '位於「介紹記錄」上方的紅色卡片。只限管理員；其他登入只會看到現用的選項。清零會<b>作廢所選診所內所有未使用的優惠券</b>' +
                            '（優惠券屬於發出它的診所）。已使用及已過期的券不受影響。',
                        '選擇清零方式：<b>手動</b>（<b>預設</b>，優惠券不會自動清零）、<b>每年 12 月 31 日 23:59</b>（香港時間；作廢 1 月 1 日前發出的券），' +
                            '或<b>有效期</b> 1、2、3、4、6、9、12 或 24 個月（作廢發出時間早於該月數的未使用券，即使其自身到期日較後）。',
                        '<b>每次更改清零選項都需輸入管理員短訊驗證碼及 Google 驗證器驗證碼。</b>' +
                            '只有選了不同的選項或月數，<b>儲存</b>才可按；按下後輸入兩個驗證碼，兩者通過後才會更改。',
                        '年終及有效期清零會在開啟優惠券設定頁時自動執行（年終每年一次，有效期最多每日一次）。' +
                            '年中才開啟年終清零，會由今年 12 月 31 日開始。',
                        '<b>手動清零</b>：按<b>清零重置</b> → 驗證 → 剔選<b>全部診所</b>或個別診所 → ' +
                            '<b>確認清零</b> → 輸入 <b>confirm</b> → <b>立即作廢優惠券</b>。',
                        '每次清零都會保留<b>安全日誌</b>，並在優惠券記錄留下一行。<b>回退並退回上次清零的優惠券</b>可令該批券重新可用；按鈕下方的灰字顯示上一個安全日誌。'
                    ] },
                    { t: '介紹記錄', list: [
                        '列出每位有介紹人的新病人。<b>待定</b>表示等待新病人在一張賬單付款達最低金額（全數或部分付款）；<b>受阻</b>顯示未發券的原因。'
                    ] },
                    { t: '優惠券記錄', list: [
                        '選擇日期（由 → 至）及可選的<b>病歷號</b>，按<b>顯示</b>。可用標籤按動作篩選；<b>匯出 CSV</b> 下載清單。',
                        '列出每張券的發出、贈送、轉移、作廢退回或取消。贈送會顯示經手的登入帳戶。'
                    ] }
                ],
                recap: '優惠券規則摘要',
                recapList: [
                    '每張賬單：一張治療券，加上一張全單券（消費滿額、新客、介紹）或多張現金券。先扣治療券。',
                    '不設找贖、不退現金：券面值高於賬單時，餘額作廢。',
                    '新客券及介紹券只限本人使用；其他券可轉給另一病歷號。',
                    '作廢賬單會退回該單已用的券，並取消該單發出的券。',
                    '過期券不能使用；到期前 7 天會以短訊提醒病人。每個錢包最多持有 20 張未用的券。'
                ],
                tips: '遇到問題？',
                tipList: [
                    ['標籤「需設定」', '填寫 HK$ 金額（消費滿額券兩個金額都要填），或最少剔選一個治療項目。'],
                    ['標籤「已達上限」', '發放上限或預算已用完。提高數值，或清空輸入格即不設上限。'],
                    ['「…未開啟優惠券」', '這些診所未加入。打開該診所分頁並剔選「加入」。'],
                    ['病人沒有獲發優惠券', '診所或醫生未加入、該行已關閉，或病人已持有「最多持有」的張數（或合共 20 張）。'],
                    ['賬單不能使用某張券', '診所或醫生未加入、該治療項目未為此券剔選、券已過期，或賬單已有一張全單券。'],
                    ['現金券扣減不足', '受每張單現金券上限限制（預設賬單金額 50%，最多 HK$3,000）。'],
                    ['誤把優惠券清零', '在紅色卡片按「回退…」，會按安全日誌退回上次清零的優惠券。'],
                    ['清零卡片的「儲存」是灰色', '你尚未選擇不同的選項或月數。每次更改都需短訊及 Google 驗證器驗證碼。'],
                    ['「請先在 Supabase 執行 discount_coupon_zero.sql。」', '資料庫尚未有清零用的資料表。請系統管理員執行一次 discount_coupon_zero.sql。']
                ]
            },
            desk: {
                title: '🧾 收費櫃檯 — 獎勵積分及優惠券',
                intro: '給使用 Banana 的前台同事。本部分逐步說明收款時如何使用<b>優惠券</b>及<b>獎勵積分</b>：' +
                    '<b>帳單詳情</b> → 🎟️ 優惠券一行 → <b>+ 新增付款</b>。',
                before: '開始前',
                beforeList: [
                    '兩個計劃只在已加入的診所（及醫生）適用。診所未加入時，相關按鈕會隱藏或變灰。',
                    '先在賬單選好<b>主診醫生</b>。獎勵積分屬於賺取積分時的醫生。',
                    '次序：<b>先選優惠券，後收款</b>。賬單一有付款，優惠券一行便會鎖定。'
                ],
                steps: [
                    { t: '查看病人擁有甚麼', list: [
                        '病人資料橫額上的<b>積分</b>按鈕顯示積分結餘；旁邊的 <b>📖 使用說明</b> 開啟本手冊。',
                        '按<b>積分</b>開啟面板，有兩個分頁：<b>🎁 獎勵積分</b>（賬本）及 <b>🎟️ 優惠券</b>（錢包）。' +
                            '診所未加入的計劃，其分頁會變灰（「診所未加入」）。',
                        '在<b>病人 → ⋯ → 獎賞</b>亦會開啟同一面板。病人<b>總覽</b>頁的 🎁 卡顯示積分，🎟️ <b>優惠券錢包</b>卡顯示可用優惠券數目。'
                    ] },
                    { t: '在賬單使用優惠券', key: true, mock: deskCouponMock, list: [
                        '在<b>帳單詳情</b>的 🎟️ <b>優惠券</b>一行按<b>選擇</b>。<b>使用</b>分頁列出病人可用的優惠券。',
                        '每張券顯示面值、<b>全單券</b>或<b>治療券</b>、到期日及可扣減金額。<b>最優</b>表示節省最多。',
                        '按一下券即選取（<b>✓ 已選</b>），底部顯示新總額，然後按<b>使用</b>。',
                        '不能使用的券會顯示原因而不是金額（例如賬單上沒有該治療，或已過期）。',
                        '要取消優惠券，按<b>選擇</b> → <b>不使用優惠券</b>。付款儲存後，<b>選擇</b>會變灰。'
                    ] },
                    { t: '贈送或轉讓優惠券', list: [
                        '<b>贈送</b>分頁：選擇券種（現金券 HK$1–200，或已開啟的治療券），按 🔒 按鈕並以職員帳戶登入。',
                        '<b>轉讓</b>分頁：選擇優惠券，輸入對方的<b>病歷號</b>，再 🔒 登入。新客券及介紹新客券不能轉讓。',
                        '不經賬單亦可操作：<b>積分</b> → <b>🎟️ 優惠券</b>分頁 → <b>錢包</b>／<b>贈送</b>／<b>轉讓</b>。' +
                            '該處的錢包只供瀏覽。按 Esc 可關閉登入框而不關閉面板。'
                    ] },
                    { t: '在新增付款使用獎勵積分', key: true, mock: deskPayMock, list: [
                        '按 <b>+ 新增付款</b>。綠色積分框顯示<b>醫生</b>及<b>本醫生可用積分（全部診所）</b>。',
                        '剔選<b>使用積分抵扣</b>，在<b>按診所（同一醫生）</b>剔選要扣除積分的診所。',
                        '輸入<b>使用積分數</b>，或按<b>全部兌換</b>（先扣結餘較少的診所）。<b>將扣除：</b>顯示由哪間診所扣除。',
                        '<b>金額</b>欄會減去積分，顯示仍需支付的現金。到達每張賬單上限時，琥珀色提示顯示尚餘多少。',
                        '填寫付款方式，按 <b>✓ 確認付款</b>。積分抵扣屬折扣，<b>不計作診所收入</b>。'
                    ] },
                    { t: '付款之後', list: [
                        '今次付款賺取的積分會加入<b>積分</b>結餘，可於<b>下一筆</b>付款使用，不可在同一筆付款使用。',
                        '消費優惠券在賬單<b>全數付清</b>後發出。結餘下方的綠色框顯示<b>本單獲得</b>，或再消費多少可獲下一張券。',
                        '賬單上的<b>本單共節省</b>一行合計項目折扣、額外折扣及優惠券。'
                    ] },
                    { t: '給病人手機頁', list: [
                        '積分：<b>積分</b> → 🎁 分頁 → <b>📱 手機查看積分</b>。優惠券：<b>積分</b> → 🎟️ 分頁 → <b>錢包 QR 碼</b>，或病人總覽頁的 🎟️ <b>優惠券錢包</b>卡。',
                        '病人用手機相機掃描 QR 碼。亦可複製連結、下載 PNG、列印紙條，或以 <b>WhatsApp</b> 發送。',
                        '<b>重新產生 QR 碼</b>會令舊連結失效（例如病人遺失手機）。手機頁只供瀏覽。'
                    ] },
                    { t: '更正錯誤', danger: true, list: [
                        '<b>作廢付款</b>：該次使用的積分會退回，該次賺取的積分會扣除。',
                        '<b>作廢賬單</b>：已使用的優惠券退回錢包，該單發出的優惠券會取消；積分亦同樣還原。',
                        '未收款前選錯優惠券？再按<b>選擇</b>另選一張，或按<b>不使用優惠券</b>。'
                    ] }
                ],
                recap: '櫃檯快速次序',
                recapList: [
                    '賬單選醫生 → <b>選擇</b>優惠券 → <b>使用</b>。',
                    '<b>+ 新增付款</b> → 剔選<b>使用積分抵扣</b> → <b>使用積分數</b>或<b>全部兌換</b> → <b>✓ 確認付款</b>。',
                    '告訴病人手機頁（📱 積分，優惠券用錢包 QR 碼）。'
                ],
                tips: '遇到問題？',
                tipList: [
                    ['新增付款沒有綠色積分框', '診所或賬單醫生未在 獎勵積分 → 參與診所 加入。'],
                    ['「使用積分抵扣」不能剔選', '賬單未選醫生，或病人沒有此醫生的積分。'],
                    ['「選擇」變灰', '賬單已有付款。優惠券須在第一筆付款前選擇。'],
                    ['優惠券顯示原因而不是金額', '賬單上沒有該治療、優惠券已過期、已使用全單券，或診所未加入優惠券計劃。'],
                    ['積分欄提早停止', '以下最小者為上限：賬單結欠、此醫生的積分、每張賬單上限。'],
                    ['今天賺取的積分不能使用', '按設計：付款賺取的積分可於下一筆付款使用。']
                ]
            },
            mock: {
                dkBill: '帳單詳情', dkCouponRow: '優惠券', dkChoose: '選擇', dkUse: '使用', dkGift: '贈送', dkXfer: '轉讓',
                dkWhole: '全單券', dkTreat: '治療券', dkBest: '最優', dkScaling: '免費洗牙', dkNotTicked: '賬單上沒有此治療',
                dkNewTotal: '新總額', dkApply: '使用', dkNoCoupon: '不使用優惠券',
                dkAddPay: '新增付款', dkDoctor: '醫生', dkAvail: '本醫生可用積分（全部診所）', dkUsePts: '使用積分抵扣',
                dkByClinic: '按診所（同一醫生）', dkRedeemAll: '全部兌換', dkPtsToUse: '使用積分數', dkWillTake: '將扣除：',
                dkCapNote: '每張賬單上限 HK$3000.00 · 本單已用 0.00 · 現可用 3000.00', dkConfirm: '✓ 確認付款',
                capTitle: '單張賬單使用積分上限', capMax: '每張賬單最多使用積分', ofBill: '賬單金額', upTo: '最多', save: '儲存',
                capSum: '最多 HK$3,000 積分／每張賬單',
                capNote: '每張賬單上限 HK$3000.00 · 此賬單已使用 500.00 · 現可使用 2500.00',
                zeroTitle: '將獎勵積分清零', zManual: '手動（預設）', zYear: '每年 12 月 31 日 23:59（香港時間）自動清零',
                zLife: '設定每筆獎勵積分有效期為：', mo: ' 個月', resetBtn: '清零重置',
                dcZeroTitle: '優惠券清零', dcZLife: '設定每張優惠券有效期最長為：',
                spend: '消費',
                cashTitle: '同一張單使用現金券', cashCount: '每張單現金券數量', noLimit: '不限',
                cashMax: '每張單現金券扣減上限', cashSum: '每張單現金券數量不限 · 最多賬單金額 50%，最多 HK$3,000'
            }
        },
        'zh-CN': {
            coverPart: { rw: '奖励积分', dc: '优惠券', dk: '收费柜台' },
            rw: {
                title: '🎁 奖励积分 — 设置说明',
                intro: '病人按付款金额赚取奖励积分，<b>1 积分 = HK$1</b>，可在之后的账单抵扣。' +
                    '积分抵扣<b>不计作诊所收入</b>。本页说明 <b>设置 → 🎁 奖励积分</b> 内每一项设置。',
                before: '开始前',
                beforeList: [
                    '所有人都可打开此页，但只有<b>管理员</b>可以更改。其他登录只会看到数值及「仅管理员可更改此设置。」',
                    '大部分设置卡有自己的<b>保存</b>按钮；勾选（短信、加入）一点即保存。',
                    '红色设置卡需要管理员的<b>短信验证码</b>及 <b>Google 验证器</b>验证码。'
                ],
                steps: [
                    { t: '赚取比率', list: [
                        '输入每笔付款转为积分的百分比（默认 <b>10%</b>），然后点<b>保存</b>。',
                        '已赚取的积分不会改变。本次付款赚取的积分可于<b>下一笔</b>付款使用，不可在同一笔付款内抵扣。'
                    ] },
                    { t: '余额变动短信通知', list: [
                        '勾选<b>积分变动时发送 Twilio 短信</b>，余额每次增减都会以短信通知病人。',
                        '取消勾选即停止发送，一点即保存。'
                    ] },
                    { t: '介绍新客（积分）', list: [
                        '勾选<b>介绍新客可获积分</b>，填写<b>积分</b>及<b>最低付款 HK$</b>，然后点<b>保存</b>。',
                        '新病人在<b>同一张账单的现金付款累计达最低金额</b>（全数或部分付款均计算），介绍人即获得积分，画面右下角会弹出<b>介绍新客奖赏已启动</b>的小提示。最低金额留空即不设下限。',
                        '在病人资料表的<b>转介人</b>选择介绍人，再选<b>积分</b>或<b>优惠券</b>。如该诊所未参加某计划，该选项会变灰。'
                    ] },
                    { t: '单张账单使用积分上限', key: true, mock: capMock, list: [
                        '设置每张账单最多可用多少积分：<b>账单金额 %</b>、<b>最多 HK$</b>，或两者都设，然后点<b>保存</b>。',
                        '两个上限同时适用，<b>以较小者为准</b>；留空即取消该上限。百分比以账单总额计算。',
                        '默认：每张账单<b>最多 HK$3,000</b>，不设百分比。病人手机页面会显示此处保存的上限（例如「每张账单最高使用额为 HK$3,000。」）；两格都留空则不显示上限。',
                        '同一张账单的<b>每次付款合并计算</b>。付款时积分栏不能超过上限，琥珀色提示显示尚余多少，超出时<b>✓ 确认付款</b>会被拒绝。'
                    ] },
                    { t: '将奖励积分清零', danger: true, mock: zeroMock, list: [
                        '选择清零方式：<b>手动</b>（默认，积分不会自动清零）、<b>每年 12 月 31 日 23:59</b>（香港时间）自动清零，' +
                            '或<b>有效期</b> 1–24 个月（连续该月数没有新积分便清零）。',
                        '点<b>保存</b>，再输入<b>短信验证码</b>及 <b>Google 验证器</b>验证码。',
                        '<b>手动清零</b>：点<b>清零重置</b> → 验证（短信 + 验证器）→ 勾选<b>全部诊所</b>或个别诊所 → ' +
                            '<b>确认清零</b> → 输入 <b>confirm</b> 一词 → <b>立即清零</b>。',
                        '每次清零都会保留<b>安全日志</b>。<b>回退并恢复清零前的上次余额</b>可把上一次清零恢复；按钮下方的灰字显示上一个安全日志。'
                    ] },
                    { t: '参与诊所', list: [
                        '每间诊所一个标签，标签上的<b>圆点</b>表示已加入。默认：<b>PL · 全部医生</b>。',
                        '每行有<b>赚取 &amp; 兑换</b>勾选。<b>全部医生</b>即整间诊所加入；医生行只加入该医生。一点即保存（「已保存」）。',
                        '积分属于赚取它的<b>医生</b>。账单只可使用<b>同一医生</b>赚取的积分 — 该医生在任何诊所赚取的都可以。账单上必须选择医生。'
                    ] },
                    { t: '汇总日志', list: [
                        '最近 80 笔积分变动：时间、诊所、医生、病历号、病人、类型、积分、变动后余额及经手人。'
                    ] }
                ],
                recap: '在收费处',
                recapList: [
                    '在<b>添加付款</b>勾选<b>使用积分抵扣</b>，再输入<b>使用积分数</b>或点<b>全部兑换</b>（先扣余额较少的诊所）。',
                    '在病人的积分记录面板点 <b>📱 手机查看积分</b>，可生成 QR 码及 WhatsApp 信息，让病人在手机查看余额。'
                ],
                tips: '遇到问题？',
                tipList: [
                    ['「仅管理员可更改此设置。」', '当前不是以管理员登录。请管理员更改。'],
                    ['积分栏停在余额以下', '上限取以下最小者：账单结欠、该医生的积分、每张账单上限。琥珀色提示会显示上限。'],
                    ['「Dr … 没有可兑换积分。」', '积分属于赚取它的医生。请确认账单上的医生正确，并已在「参与诊所」加入。'],
                    ['今天赚取的积分不能用', '设计如此：本次付款赚取的积分可于下一笔付款使用。'],
                    ['误把余额清零', '在红色设置卡点「回退并恢复…」，系统会按安全日志恢复上一次清零。'],
                    ['「回退」按钮是灰色', '没有可恢复的清零安全日志。'],
                    ['收不到短信验证码', '点「重新发送短信验证码」。如短信无法发送，系统只会要求 Google 验证器验证码。']
                ]
            },
            dc: {
                title: '🎟️ 优惠券 — 设置说明',
                intro: '优惠券与奖励积分分开运作。病人把优惠券存入钱包，于之后的账单使用。本页说明 <b>设置 → 🎟️ 优惠券</b> 内每一项设置。',
                before: '开始前',
                beforeList: [
                    '此页<b>没有保存按钮</b>：离开输入框或点勾选后即自动保存。' +
                        '唯一例外是红色的<b>优惠券清零</b>卡片，它有自己的保存按钮，并需管理员短信及 Google 验证器验证码。',
                    '顶部的黄色横幅列出<b>未开启</b>优惠券的诊所。',
                    '<b>优惠券使用规则（点击展开）</b>列出员工及病人须遵守的规则（摘要见本页末）。'
                ],
                steps: [
                    { t: '参与诊所', list: [
                        '每间诊所一个标签，<b>圆点</b>表示已加入。诊所行的<b>加入</b>开关整间诊所。KT 默认已加入，其他诊所须勾选后才开启。',
                        '下方<b>全部医生</b>及每位医生各有<b>加入</b>勾选。',
                        '未加入的诊所，账单既不能使用、也不会获发优惠券。'
                    ] },
                    { t: '消费满额券', mock: ladderMock, list: [
                        '共五行。前三行已填好（消费 HK$1,000 / 5,000 / 10,000 → 送 HK$100 / 500 / 1,000），最后两行留空，待你填写。',
                        '每行：<b>开关</b>、<b>消费 HK$</b>、<b>优惠 HK$</b>、<b>有效日数</b>、<b>最多持有</b>（每位病人最多持有多少张未用的此类券）、' +
                            '<b>发放上限</b>及<b>预算 HK$</b>。',
                        '只有已开启且两个金额都已填写的行才会发券。一张账单可获得<b>所有达到的级别</b>，图示显示各级别。',
                        '消费金额计算账单上所有现金付款（不包括积分、余额转移或已作废付款）。获发的券可于<b>下一张</b>账单使用。'
                    ] },
                    { t: '优惠活动', list: [
                        '其余每项优惠都有开关、预览票券及以下输入框：<b>HK$</b>、<b>%</b>（百分比券）、<b>有效日数</b>、<b>上限</b>（最多扣减 HK$）、' +
                            '<b>最多持有</b>、<b>发放上限</b>、<b>预算 HK$</b>。',
                        '<b>全单券</b>：现金券（员工可赠送 HK$1–200）、新客券及介绍新客（两者自动发放；介绍新客设有<b>最低付款 HK$</b>）。',
                        '<b>治疗券</b>：免费洗牙、免费补牙、免费脱牙、植牙、矫齿、牙套牙桥、根管、美白优惠 — 只适用于为该券勾选的治疗项目（第 5 步）。',
                        '标签显示<b>已开启</b>、<b>已关闭</b>、<b>需设定</b>或<b>已达上限</b>。发放上限及预算可留空；已作废的券不计算在内。'
                    ] },
                    { t: '同一张单使用现金券', key: true, mock: cashMock, list: [
                        '位于「现金券」设置卡内。<b>每张单现金券数量</b>：不限，或 1–10 张。',
                        '<b>每张单现金券扣减上限</b>：<b>账单金额 %</b> 及／或<b>最多 HK$</b>。两者同时适用，以较小者为准；留空即取消该上限。',
                        '默认：现金券数量不限，<b>账单金额 50%，最多 HK$3,000</b>。百分比以使用优惠券前的整张账单计算。',
                        '只有现金券可以叠加。消费满额券、新客券及介绍新客券每张单只限一张，且不可与现金券同用。'
                    ] },
                    { t: '治疗券的治疗项目', list: [
                        '<b>智能关键字筛选</b>：名称含有<b>关键字</b>（以逗号分隔）而不含<b>排除字词</b>的项目会自动勾选。',
                        '打开<b>适用治疗项目：… 项已勾选</b>查看清单，可搜索并勾选或取消任何项目。' +
                            '标记：<i>关键字</i> = 由关键字勾选；<i>已剔除</i> = 符合关键字但被你取消；<i>不在项目表</i> = 已不在治疗项目清单。',
                        '账单上手动输入的项目，名称必须与治疗项目清单完全相同才计算。'
                    ] },
                    { t: '优惠券清零', danger: true, mock: dcZeroMock, list: [
                        '位于「介绍记录」上方的红色卡片。只限管理员；其他登录只会看到现用的选项。清零会<b>作废所选诊所内所有未使用的优惠券</b>' +
                            '（优惠券属于发出它的诊所）。已使用及已过期的券不受影响。',
                        '选择清零方式：<b>手动</b>（<b>默认</b>，优惠券不会自动清零）、<b>每年 12 月 31 日 23:59</b>（香港时间；作废 1 月 1 日前发出的券），' +
                            '或<b>有效期</b> 1、2、3、4、6、9、12 或 24 个月（作废发出时间早于该月数的未使用券，即使其自身到期日较后）。',
                        '<b>每次更改清零选项都需输入管理员短信验证码及 Google 验证器验证码。</b>' +
                            '只有选了不同的选项或月数，<b>保存</b>才可点；点下后输入两个验证码，两者通过后才会更改。',
                        '年终及有效期清零会在打开优惠券设置页时自动执行（年终每年一次，有效期最多每日一次）。' +
                            '年中才开启年终清零，会由今年 12 月 31 日开始。',
                        '<b>手动清零</b>：点<b>清零重置</b> → 验证 → 勾选<b>全部诊所</b>或个别诊所 → ' +
                            '<b>确认清零</b> → 输入 <b>confirm</b> → <b>立即作废优惠券</b>。',
                        '每次清零都会保留<b>安全日志</b>，并在优惠券记录留下一行。<b>回退并退回上次清零的优惠券</b>可令该批券重新可用；按钮下方的灰字显示上一个安全日志。'
                    ] },
                    { t: '介绍记录', list: [
                        '列出每位有介绍人的新病人。<b>待定</b>表示等待新病人在一张账单付款达最低金额（全数或部分付款）；<b>受阻</b>显示未发券的原因。'
                    ] },
                    { t: '优惠券记录', list: [
                        '选择日期（由 → 至）及可选的<b>病历号</b>，点<b>显示</b>。可用标签按动作筛选；<b>导出 CSV</b> 下载清单。',
                        '列出每张券的发出、赠送、转移、作废退回或取消。赠送会显示经手的登录账户。'
                    ] }
                ],
                recap: '优惠券规则摘要',
                recapList: [
                    '每张账单：一张治疗券，加上一张全单券（消费满额、新客、介绍）或多张现金券。先扣治疗券。',
                    '不设找零、不退现金：券面值高于账单时，余额作废。',
                    '新客券及介绍券只限本人使用；其他券可转给另一病历号。',
                    '作废账单会退回该单已用的券，并取消该单发出的券。',
                    '过期券不能使用；到期前 7 天会以短信提醒病人。每个钱包最多持有 20 张未用的券。'
                ],
                tips: '遇到问题？',
                tipList: [
                    ['标签「需设定」', '填写 HK$ 金额（消费满额券两个金额都要填），或最少勾选一个治疗项目。'],
                    ['标签「已达上限」', '发放上限或预算已用完。提高数值，或清空输入框即不设上限。'],
                    ['「…未开启优惠券」', '这些诊所未加入。打开该诊所标签并勾选「加入」。'],
                    ['病人没有获发优惠券', '诊所或医生未加入、该行已关闭，或病人已持有「最多持有」的张数（或合共 20 张）。'],
                    ['账单不能使用某张券', '诊所或医生未加入、该治疗项目未为此券勾选、券已过期，或账单已有一张全单券。'],
                    ['现金券扣减不足', '受每张单现金券上限限制（默认账单金额 50%，最多 HK$3,000）。'],
                    ['误把优惠券清零', '在红色卡片点「回退…」，会按安全日志退回上次清零的优惠券。'],
                    ['清零卡片的「保存」是灰色', '你尚未选择不同的选项或月数。每次更改都需短信及 Google 验证器验证码。'],
                    ['「请先在 Supabase 运行 discount_coupon_zero.sql。」', '数据库尚未有清零用的数据表。请系统管理员运行一次 discount_coupon_zero.sql。']
                ]
            },
            desk: {
                title: '🧾 收费柜台 — 奖励积分及优惠券',
                intro: '给使用 Banana 的前台同事。本部分逐步说明收款时如何使用<b>优惠券</b>及<b>奖励积分</b>：' +
                    '<b>账单详情</b> → 🎟️ 优惠券一行 → <b>+ 添加付款</b>。',
                before: '开始前',
                beforeList: [
                    '两个计划只在已加入的诊所（及医生）适用。诊所未加入时，相关按钮会隐藏或变灰。',
                    '先在账单选好<b>主诊医生</b>。奖励积分属于赚取积分时的医生。',
                    '次序：<b>先选优惠券，后收款</b>。账单一有付款，优惠券一行便会锁定。'
                ],
                steps: [
                    { t: '查看病人拥有什么', list: [
                        '病人资料横幅上的<b>积分</b>按钮显示积分余额；旁边的 <b>📖 使用说明</b> 打开本手册。',
                        '点<b>积分</b>打开面板，有两个分页：<b>🎁 奖励积分</b>（账本）及 <b>🎟️ 优惠券</b>（钱包）。' +
                            '诊所未加入的计划，其分页会变灰（“诊所未加入”）。',
                        '在<b>病人 → ⋯ → 奖赏</b>也会打开同一面板。病人<b>总览</b>页的 🎁 卡显示积分，🎟️ <b>优惠券钱包</b>卡显示可用优惠券数目。'
                    ] },
                    { t: '在账单使用优惠券', key: true, mock: deskCouponMock, list: [
                        '在<b>账单详情</b>的 🎟️ <b>优惠券</b>一行点<b>选择</b>。<b>使用</b>分页列出病人可用的优惠券。',
                        '每张券显示面值、<b>全单券</b>或<b>治疗券</b>、到期日及可扣减金额。<b>最优</b>表示节省最多。',
                        '点一下券即选取（<b>✓ 已选</b>），底部显示新总额，然后点<b>使用</b>。',
                        '不能使用的券会显示原因而不是金额（例如账单上没有该治疗，或已过期）。',
                        '要取消优惠券，点<b>选择</b> → <b>不使用优惠券</b>。付款保存后，<b>选择</b>会变灰。'
                    ] },
                    { t: '赠送或转让优惠券', list: [
                        '<b>赠送</b>分页：选择券种（现金券 HK$1–200，或已开启的治疗券），点 🔒 按钮并以职员账户登录。',
                        '<b>转让</b>分页：选择优惠券，输入对方的<b>病历号</b>，再 🔒 登录。新客券及介绍新客券不能转让。',
                        '不经账单也可操作：<b>积分</b> → <b>🎟️ 优惠券</b>分页 → <b>钱包</b>／<b>赠送</b>／<b>转让</b>。' +
                            '该处的钱包只供浏览。按 Esc 可关闭登录框而不关闭面板。'
                    ] },
                    { t: '在添加付款使用奖励积分', key: true, mock: deskPayMock, list: [
                        '点 <b>+ 添加付款</b>。绿色积分框显示<b>医生</b>及<b>本医生可用积分（全部诊所）</b>。',
                        '勾选<b>使用积分抵扣</b>，在<b>按诊所（同一医生）</b>勾选要扣除积分的诊所。',
                        '输入<b>使用积分数</b>，或点<b>全部兑换</b>（先扣余额较少的诊所）。<b>将扣除：</b>显示由哪间诊所扣除。',
                        '<b>金额</b>栏会减去积分，显示仍需支付的现金。到达每张账单上限时，琥珀色提示显示尚余多少。',
                        '填写付款方式，点 <b>✓ 确认付款</b>。积分抵扣属折扣，<b>不计作诊所收入</b>。'
                    ] },
                    { t: '付款之后', list: [
                        '本次付款赚取的积分会加入<b>积分</b>余额，可于<b>下一笔</b>付款使用，不可在同一笔付款使用。',
                        '消费优惠券在账单<b>全数付清</b>后发出。余额下方的绿色框显示<b>本单获得</b>，或再消费多少可获下一张券。',
                        '账单上的<b>本单共节省</b>一行合计项目折扣、额外折扣及优惠券。'
                    ] },
                    { t: '给病人手机页', list: [
                        '积分：<b>积分</b> → 🎁 分页 → <b>📱 手机查看积分</b>。优惠券：<b>积分</b> → 🎟️ 分页 → <b>钱包二维码</b>，或病人总览页的 🎟️ <b>优惠券钱包</b>卡。',
                        '病人用手机相机扫描二维码。也可复制链接、下载 PNG、打印纸条，或以 <b>WhatsApp</b> 发送。',
                        '<b>重新生成二维码</b>会令旧链接失效（例如病人遗失手机）。手机页只供浏览。'
                    ] },
                    { t: '更正错误', danger: true, list: [
                        '<b>作废付款</b>：该次使用的积分会退回，该次赚取的积分会扣除。',
                        '<b>作废账单</b>：已使用的优惠券退回钱包，该单发出的优惠券会取消；积分也同样还原。',
                        '未收款前选错优惠券？再点<b>选择</b>另选一张，或点<b>不使用优惠券</b>。'
                    ] }
                ],
                recap: '柜台快速次序',
                recapList: [
                    '账单选医生 → <b>选择</b>优惠券 → <b>使用</b>。',
                    '<b>+ 添加付款</b> → 勾选<b>使用积分抵扣</b> → <b>使用积分数</b>或<b>全部兑换</b> → <b>✓ 确认付款</b>。',
                    '告诉病人手机页（📱 积分，优惠券用钱包二维码）。'
                ],
                tips: '遇到问题？',
                tipList: [
                    ['添加付款没有绿色积分框', '诊所或账单医生未在 奖励积分 → 参与诊所 加入。'],
                    ['“使用积分抵扣”不能勾选', '账单未选医生，或病人没有此医生的积分。'],
                    ['“选择”变灰', '账单已有付款。优惠券须在第一笔付款前选择。'],
                    ['优惠券显示原因而不是金额', '账单上没有该治疗、优惠券已过期、已使用全单券，或诊所未加入优惠券计划。'],
                    ['积分栏提早停止', '以下最小者为上限：账单结欠、此医生的积分、每张账单上限。'],
                    ['今天赚取的积分不能使用', '按设计：付款赚取的积分可于下一笔付款使用。']
                ]
            },
            mock: {
                dkBill: '账单详情', dkCouponRow: '优惠券', dkChoose: '选择', dkUse: '使用', dkGift: '赠送', dkXfer: '转让',
                dkWhole: '全单券', dkTreat: '治疗券', dkBest: '最优', dkScaling: '免费洗牙', dkNotTicked: '账单上没有此治疗',
                dkNewTotal: '新总额', dkApply: '使用', dkNoCoupon: '不使用优惠券',
                dkAddPay: '添加付款', dkDoctor: '医生', dkAvail: '本医生可用积分（全部诊所）', dkUsePts: '使用积分抵扣',
                dkByClinic: '按诊所（同一医生）', dkRedeemAll: '全部兑换', dkPtsToUse: '使用积分数', dkWillTake: '将扣除：',
                dkCapNote: '每张账单上限 HK$3000.00 · 本单已用 0.00 · 现可用 3000.00', dkConfirm: '✓ 确认付款',
                capTitle: '单张账单使用积分上限', capMax: '每张账单最多使用积分', ofBill: '账单金额', upTo: '最多', save: '保存',
                capSum: '最多 HK$3,000 积分／每张账单',
                capNote: '每张账单上限 HK$3000.00 · 此账单已使用 500.00 · 现可使用 2500.00',
                zeroTitle: '将奖励积分清零', zManual: '手动（默认）', zYear: '每年 12 月 31 日 23:59（香港时间）自动清零',
                zLife: '设置每笔奖励积分有效期为：', mo: ' 个月', resetBtn: '清零重置',
                dcZeroTitle: '优惠券清零', dcZLife: '设置每张优惠券有效期最长为：',
                spend: '消费',
                cashTitle: '同一张单使用现金券', cashCount: '每张单现金券数量', noLimit: '不限',
                cashMax: '每张单现金券扣减上限', cashSum: '每张单现金券数量不限 · 最多账单金额 50%，最多 HK$3,000'
            }
        }
    };

    function li(list) { return '<ul>' + list.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>'; }

    function step(n, s, m) {
        var body = s.mock ? '<div class="xhg-share">' + li(s.list) + s.mock(m) + '</div>' : li(s.list);
        var cls = s.key ? ' is-key' : (s.danger ? ' is-danger' : '');
        return '<section class="xhg-step' + cls + '"><h3><span class="xhg-num">' + n + '</span>' + s.t + '</h3>' + body + '</section>';
    }

    function renderPart(p, m) {
        return '<p class="xhg-intro">' + p.intro + '</p>' +
            '<section class="xhg-before"><h3>' + p.before + '</h3>' + li(p.beforeList) + '</section>' +
            p.steps.map(function (s, i) { return step(i + 1, s, m); }).join('') +
            '<section class="lm-recap"><h3>' + p.recap + '</h3>' + li(p.recapList) + '</section>' +
            '<section class="xhg-tips"><h3>' + p.tips + '</h3><dl>' +
                p.tipList.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') +
            '</dl></section>';
    }

    function page(id, lang, label, title, cls, body) {
        return '<section class="xhg-page" id="' + id + '" lang="' + lang + '">' +
            '<header class="xhg-head' + cls + '"><h2 class="xhg-title">' + title + '</h2>' +
                '<span class="xhg-lang-tag">' + label + '</span></header>' +
            '<div class="xhg-body">' + body + '</div></section>';
    }

    /** #lang-x and #rewards-x open the reward points part, #coupons-x the coupon part, #desk-x the payment desk part.
     *  #start-rewards-x / #start-coupons-x / #start-desk-x open the cover (contents page) with that language and part marked. */
    function targetFor(hash) {
        var s = /^#start-(rewards|coupons|desk)-(en|zh-Hant|zh-CN)$/.exec(hash || '');
        if (s) return { lang: s[2], id: 'manualCover', part: s[1], cover: true };
        var m = /^#(lang|rewards|coupons|desk)-(en|zh-Hant|zh-CN)$/.exec(hash || '');
        if (!m) return null;
        return { lang: m[2], id: (m[1] === 'coupons' ? 'coupons-' : m[1] === 'desk' ? 'desk-' : 'lang-') + m[2] };
    }

    /** Pure: the language to open with no #anchor — the dashboard's saved language, else Traditional Chinese. */
    function defaultLang(stored) {
        var s = String(stored || '');
        return s === 'en' || s === 'zh-CN' || s === 'zh-Hant' ? s : 'zh-Hant';
    }

    function storedDashLang() {
        try { return localStorage.getItem('joyful_ui_lang_v1'); } catch (e) { return null; }
    }

    function build() {
        var root = document.getElementById('manual');
        if (!targetFor(location.hash) && history.replaceState) {
            history.replaceState(null, '', '#start-rewards-' + defaultLang(storedDashLang()));
        }
        var cover = '<section class="xhg-page xhg-cover" id="manualCover">' +
            '<div class="xhg-cover-logo">🎁 🎟️</div>' +
            '<h1>Reward Points &amp; Discount Coupons<br><span>獎勵積分及優惠券 · 使用說明 · 奖励积分及优惠券 · 使用说明</span></h1>' +
            '<p class="xhg-cover-sub">User manual — English · 繁體中文 · 简体中文</p>' +
            '<ol class="xhg-cover-toc">' +
                LANGS.map(function (l) {
                    var t = T[l.id];
                    return '<li data-lang="' + l.id + '"><a href="#lang-' + l.id + '"><b>' + l.label + '</b></a>' +
                        '<small><a href="#rewards-' + l.id + '" data-part="rewards">🎁 ' + t.coverPart.rw + '</a>' +
                        '<a href="#coupons-' + l.id + '" data-part="coupons">🎟️ ' + t.coverPart.dc + '</a>' +
                        '<a href="#desk-' + l.id + '" data-part="desk">🧾 ' + t.coverPart.dk + '</a></small></li>';
                }).join('') +
            '</ol>' +
            '<div class="xhg-cover-key">' +
                '<b>⚠ Where · 位置 · 位置</b>' +
                '<p>Configuration → 🎁 Reward Points / 🎟️ Discount Coupons — 📖 How to use opens this manual.<br>' +
                '設定 → 🎁 獎勵積分／🎟️ 優惠券 — 按 📖 使用說明開啟本手冊。<br>' +
                '设置 → 🎁 奖励积分／🎟️ 优惠券 — 点 📖 使用说明打开本手册。</p>' +
                '<p>Patient info banner → <b>Rewards</b> 📖 — front-desk steps: 🧾 ' + T.en.coverPart.dk + '.<br>' +
                '病人資料橫額 → <b>積分</b> 📖 — 前台步驟：🧾 ' + T['zh-Hant'].coverPart.dk + '。<br>' +
                '病人资料横幅 → <b>积分</b> 📖 — 前台步骤：🧾 ' + T['zh-CN'].coverPart.dk + '。</p>' +
                '<p><b>💳 HK$3,000</b> — ' + T.en.rw.steps[3].t + ' · ' + T['zh-Hant'].rw.steps[3].t + ' · ' + T['zh-CN'].rw.steps[3].t + '</p>' +
            '</div>' +
        '</section>';
        root.innerHTML = cover + LANGS.map(function (l) {
            var t = T[l.id];
            return page('lang-' + l.id, l.id, l.label, t.rw.title, '', renderPart(t.rw, t.mock)) +
                page('coupons-' + l.id, l.id, l.label, t.dc.title, ' is-coupons', renderPart(t.dc, t.mock)) +
                page('desk-' + l.id, l.id, l.label, t.desk.title, ' is-desk', renderPart(t.desk, t.mock));
        }).join('');
        document.title = 'Banana Reward Points & Discount Coupons — user manual · 使用說明 · 使用说明';

        var printBtn = document.getElementById('xhgPrint');
        if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
        function markLang() {
            var target = targetFor(location.hash);
            document.querySelectorAll('.xhg-toolbar [data-lang]').forEach(function (a) {
                a.classList.toggle('is-on', !!target && a.getAttribute('data-lang') === target.lang);
            });
            document.querySelectorAll('.xhg-cover-toc li[data-lang]').forEach(function (li) {
                var on = !!target && li.getAttribute('data-lang') === target.lang;
                li.classList.toggle('is-on', on);
                li.querySelectorAll('a[data-part]').forEach(function (a) {
                    a.classList.toggle('is-on', on && !!target.part && a.getAttribute('data-part') === target.part);
                });
            });
            var el = target && document.getElementById(target.id);
            if (target && target.cover) window.scrollTo(0, 0);
            else if (el) el.scrollIntoView({ block: 'start' });
        }
        window.addEventListener('hashchange', markLang);
        // Sections are built by this script, after the browser's own jump to the hash was attempted.
        markLang();
    }

    window.LoyaltyManual = { T: T, LANGS: LANGS, targetFor: targetFor, defaultLang: defaultLang };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
