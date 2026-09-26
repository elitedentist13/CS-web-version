// docs/xray-helper-manual.js — content of the Banana X-ray Helper manual (English / 繁體中文 / 简体中文).
// Rendered by xray-helper-manual.html; the PDF linked from the X-ray tab is printed from that page:
//   chrome --headless=new --no-pdf-header-footer --print-to-pdf=docs\xray-helper-manual.pdf docs\xray-helper-manual.html
(function () {
    'use strict';

    var LANGS = [
        { id: 'en', label: 'English' },
        { id: 'zh-Hant', label: '繁體中文' },
        { id: 'zh-CN', label: '简体中文' }
    ];

    function picker(t) {
        return '<div class="xhg-picker" aria-hidden="true">' +
            '<div class="xhg-picker-head">' + t.pickTitle + '</div>' +
            '<div class="xhg-picker-tabs">' +
                '<span class="xhg-tab is-bad">' + t.tabChrome + ' ✗</span>' +
                '<span class="xhg-tab is-good">' + t.tabWindow + ' ✓</span>' +
                '<span class="xhg-tab is-ok">' + t.tabScreen + ' ✓</span>' +
            '</div>' +
            '<div class="xhg-picker-body">' +
                '<div class="xhg-win is-good"><span>🦷</span>' + t.winXray + '<b>✓</b></div>' +
                '<div class="xhg-win"><span>📁</span>' + t.winOther + '</div>' +
                '<div class="xhg-win is-bad"><span>🍌</span>' + t.winBanana + '<b>✗</b></div>' +
            '</div>' +
            '<div class="xhg-picker-foot"><span class="xhg-fake-btn">' + t.pickCancel + '</span>' +
                '<span class="xhg-fake-btn is-primary">' + t.pickShare + '</span></div>' +
        '</div>';
    }

    function bar(t) {
        return '<div class="xhg-bar" aria-hidden="true"><span>🍌</span>' +
            '<span class="xhg-pill">' + t.barPatient + '</span>' +
            '<span class="xhg-bbtn is-dark">' + t.btnSelection + '</span>' +
            '<span class="xhg-bbtn">' + t.btnAuto + '</span>' +
            '<span class="xhg-bbtn">' + t.btnSame + '</span>' +
            '<span class="xhg-dot"></span><span class="xhg-bar-status">' + t.barStatus + '</span>' +
            '<span class="xhg-bbtn">' + t.btnStop + '</span><span class="xhg-bbtn">✕</span></div>';
    }

    var T = {
        en: {
            title: '🍌 X-ray Helper — how to use',
            intro: 'The X-ray Helper is a small yellow bar that floats above your X-ray software. ' +
                'When a new X-ray appears, one click crops it and saves it to the patient open in Banana — ' +
                'no exporting, no saving files, no drag-and-drop.',
            before: 'Before you start',
            beforeList: [
                'Use <b>Google Chrome</b> or <b>Microsoft Edge</b>, opened from the Banana desktop shortcut.',
                'Open the <b>patient</b> in Banana (Consultation → X-ray tab).',
                'Open the <b>X-ray software</b> as usual.'
            ],
            s1: 'Open the helper',
            s1List: [
                'On the X-ray tab, click <b>🍌 X-ray Helper</b>. The yellow bar appears.',
                'Drag the bar by its edge to the <b>top of the X-ray software</b> (its title/toolbar area), ' +
                    'so it never covers the X-ray. Chrome remembers this place next time.'
            ],
            s2: 'Share the X-ray software window',
            s2Lead: 'Chrome now asks <b>what to share</b>. This is the one step people get wrong:',
            s2List: [
                'Click the <b>Window</b> tab, then click the <b>X-ray software</b> window, then <b>Share</b>.',
                'Or use <b>Entire screen</b> (with two monitors, pick the one with the X-ray software).',
                '<b>Do NOT choose “Chrome tab”</b>, and do not pick the Chrome / Banana window — ' +
                    'that shares Banana itself, not the X-ray. The X-ray software is a separate program in its own window.'
            ],
            s2Note: 'You only share once per session. A <b>green dot</b> on the bar means sharing is on. ' +
                'If you shared the wrong thing, press <b>Stop</b>, then <b>Share screen</b> and choose again.',
            s3: 'Capture the X-ray',
            s3Lead: 'Take the X-ray as usual. When it appears on screen, press one of these on the yellow bar:',
            s3List: [
                '<b>✨ Auto</b> — Banana finds the X-ray for you and outlines it. Press <b>Enter</b> (or ✓ Use this). ' +
                    'Several films on screen? Press <b>Tab</b> to jump to the next one. Wrong area? Just drag instead.',
                '<b>✂ Selection</b> — the screen dims; drag a box over the X-ray. Letting go of the mouse crops it.',
                '<b>⟲ Same area</b> — crops exactly the same box as last time on this computer, with no dragging. ' +
                    'Best when the software always shows the X-ray in the same place.'
            ],
            s4: 'Check and save',
            s4List: [
                'Banana comes to the front with the usual <b>Upload X-Ray</b> panel.',
                'Check <b>Upload to</b> shows the right patient. If it turns <b>red</b>, the patient was changed after capturing — ' +
                    'the upload is blocked; open the right patient and capture again.',
                'Check the <b>X-ray type</b> (Banana guesses it from the shape — please confirm), the date and notes.',
                'Press <b>Confirm Upload</b>. The X-ray opens in the viewer and the bar shows <b>✓ Saved</b>.'
            ],
            tips: 'Problems?',
            tipList: [
                ['The picture shows Banana, not the X-ray', 'A Chrome tab was shared. Press Stop → Share screen → Window → X-ray software.'],
                ['The picture is black or old', 'The X-ray software window is minimised. Restore it, then capture again.'],
                ['“Screen size changed”', 'The screen layout changed since last time. Use ✂ Selection once; Same area works again after that.'],
                ['“No X-ray found automatically”', 'Just drag over the X-ray. Auto works best when the X-ray is large on screen.'],
                ['The bar does not open', 'Open Banana from the desktop shortcut (an address starting with http://127.0.0.1 or https://).'],
                ['Cancel a selection', 'Press Esc. ✕ on the bar closes the helper; Stop ends screen sharing.']
            ],
            quality: 'X-rays are saved at full screen resolution as lossless greyscale PNG — sharp, and small to store.',
            pickTitle: 'Choose what to share', tabChrome: 'Chrome tab', tabWindow: 'Window', tabScreen: 'Entire screen',
            winXray: 'X-ray software', winOther: 'Other program', winBanana: 'Banana — Google Chrome',
            pickCancel: 'Cancel', pickShare: 'Share',
            barPatient: 'Upload to: #1234', btnSelection: '✂ Selection', btnAuto: '✨ Auto', btnSame: '⟲ Same area',
            barStatus: 'When the X-ray appears…', btnStop: 'Stop',
            close: 'Close', print: '🖨 Print'
        },
        'zh-Hant': {
            title: '🍌 X 光助手 — 使用說明',
            intro: 'X 光助手是一條浮在 X 光軟件上方的黃色小工具列。X 光一出現，按一下就能截取並儲存到 Banana 目前開啟的病人 — ' +
                '無需匯出、無需另存檔案、無需拖放。',
            before: '開始前',
            beforeList: [
                '使用 <b>Google Chrome</b> 或 <b>Microsoft Edge</b>，並從 Banana 桌面捷徑開啟。',
                '在 Banana 開啟<b>病人</b>（診症 → X 光分頁）。',
                '照常開啟 <b>X 光軟件</b>。'
            ],
            s1: '開啟助手',
            s1List: [
                '在 X 光分頁按 <b>🍌 X 光助手</b>，黃色工具列會出現。',
                '拖動工具列邊緣，把它放到 <b>X 光軟件的頂部</b>（標題列／工具列位置），以免遮住 X 光。Chrome 下次會記住這個位置。'
            ],
            s2: '分享 X 光軟件視窗',
            s2Lead: 'Chrome 會問<b>要分享甚麼</b>。這是最容易選錯的一步：',
            s2List: [
                '按 <b>「視窗」</b>分頁 → 選 <b>X 光軟件</b>的視窗 → 按<b>「分享」</b>。',
                '或選 <b>「整個畫面」</b>（有兩個螢幕時，選顯示 X 光軟件的那一個）。',
                '<b>不要選「Chrome 分頁」</b>，也不要選 Chrome／Banana 的視窗 — 那樣分享的是 Banana 本身，而不是 X 光。' +
                    'X 光軟件是另一個程式，在它自己的視窗裏。'
            ],
            s2Note: '每次開啟只需分享一次。工具列上的<b>綠點</b>表示正在分享。' +
                '如果選錯了，按<b>「停止」</b>，再按<b>「分享畫面」</b>重新選擇。',
            s3: '截取 X 光',
            s3Lead: '照常拍攝 X 光。X 光在畫面出現後，在黃色工具列按以下其中一個：',
            s3List: [
                '<b>✨ 自動</b> — Banana 自動找出 X 光並框好。按 <b>Enter</b>（或「✓ 使用」）。' +
                    '畫面有多張片？按 <b>Tab</b> 跳到下一張。範圍不對？直接拖選即可。',
                '<b>✂ 選取</b> — 畫面變暗，用滑鼠在 X 光上拖出方框，放開滑鼠即截取。',
                '<b>⟲ 同一範圍</b> — 在這部電腦上截取與上次完全相同的範圍，無需拖選。適合 X 光每次都在同一位置顯示的軟件。'
            ],
            s4: '檢查並儲存',
            s4List: [
                'Banana 會自動回到前面，並開啟平常的 <b>上載 X 光</b> 面板。',
                '確認<b>「上載到」</b>是正確的病人。如果變成<b>紅色</b>，表示截取後病人已被更換 — 系統會阻止上載；請開啟正確病人再截取一次。',
                '確認 <b>X 光類型</b>（Banana 會按形狀估計，請確認）、日期及備註。',
                '按<b>「確認上載」</b>。X 光會在檢視器中開啟，工具列顯示 <b>✓ 已儲存</b>。'
            ],
            tips: '遇到問題？',
            tipList: [
                ['截到的是 Banana，而不是 X 光', '分享了 Chrome 分頁。按「停止」→「分享畫面」→「視窗」→ X 光軟件。'],
                ['畫面是黑色或舊的', 'X 光軟件視窗被最小化了。還原視窗後再截取。'],
                ['「畫面尺寸已改變」', '畫面佈局與上次不同。先用一次「✂ 選取」，之後「同一範圍」便可再用。'],
                ['「未能自動找到 X 光」', '直接拖選 X 光即可。X 光在畫面上愈大，自動功能愈準確。'],
                ['工具列開不到', '請從桌面捷徑開啟 Banana（網址以 http://127.0.0.1 或 https:// 開頭）。'],
                ['取消選取', '按 Esc。工具列上的 ✕ 關閉助手；「停止」結束畫面分享。']
            ],
            quality: 'X 光以原畫面解像度儲存為無損灰階 PNG — 清晰，而且佔用空間少。',
            pickTitle: '選擇要分享的內容', tabChrome: 'Chrome 分頁', tabWindow: '視窗', tabScreen: '整個畫面',
            winXray: 'X 光軟件', winOther: '其他程式', winBanana: 'Banana — Google Chrome',
            pickCancel: '取消', pickShare: '分享',
            barPatient: '上載到： #1234', btnSelection: '✂ 選取', btnAuto: '✨ 自動', btnSame: '⟲ 同一範圍',
            barStatus: 'X 光出現後…', btnStop: '停止',
            close: '關閉', print: '🖨 列印'
        },
        'zh-CN': {
            title: '🍌 X 光助手 — 使用说明',
            intro: 'X 光助手是一条浮在 X 光软件上方的黄色小工具栏。X 光一出现，点一下就能截取并保存到 Banana 当前打开的病人 — ' +
                '无需导出、无需另存文件、无需拖放。',
            before: '开始前',
            beforeList: [
                '使用 <b>Google Chrome</b> 或 <b>Microsoft Edge</b>，并从 Banana 桌面快捷方式打开。',
                '在 Banana 打开<b>病人</b>（诊症 → X 光标签）。',
                '照常打开 <b>X 光软件</b>。'
            ],
            s1: '打开助手',
            s1List: [
                '在 X 光标签点 <b>🍌 X 光助手</b>，黄色工具栏会出现。',
                '拖动工具栏边缘，把它放到 <b>X 光软件的顶部</b>（标题栏／工具栏位置），以免遮住 X 光。Chrome 下次会记住这个位置。'
            ],
            s2: '共享 X 光软件窗口',
            s2Lead: 'Chrome 会问<b>要共享什么</b>。这是最容易选错的一步：',
            s2List: [
                '点 <b>「窗口」</b>标签 → 选 <b>X 光软件</b>的窗口 → 点<b>「共享」</b>。',
                '或选 <b>「整个屏幕」</b>（有两个显示器时，选显示 X 光软件的那一个）。',
                '<b>不要选「Chrome 标签页」</b>，也不要选 Chrome／Banana 的窗口 — 那样共享的是 Banana 本身，而不是 X 光。' +
                    'X 光软件是另一个程序，在它自己的窗口里。'
            ],
            s2Note: '每次打开只需共享一次。工具栏上的<b>绿点</b>表示正在共享。' +
                '如果选错了，点<b>「停止」</b>，再点<b>「共享屏幕」</b>重新选择。',
            s3: '截取 X 光',
            s3Lead: '照常拍摄 X 光。X 光在屏幕出现后，在黄色工具栏点以下其中一个：',
            s3List: [
                '<b>✨ 自动</b> — Banana 自动找出 X 光并框好。按 <b>Enter</b>（或「✓ 使用」）。' +
                    '屏幕有多张片？按 <b>Tab</b> 跳到下一张。范围不对？直接拖选即可。',
                '<b>✂ 选取</b> — 屏幕变暗，用鼠标在 X 光上拖出方框，松开鼠标即截取。',
                '<b>⟲ 同一范围</b> — 在这台电脑上截取与上次完全相同的范围，无需拖选。适合 X 光每次都在同一位置显示的软件。'
            ],
            s4: '检查并保存',
            s4List: [
                'Banana 会自动回到前面，并打开平常的 <b>上传 X 光</b> 面板。',
                '确认<b>「上传到」</b>是正确的病人。如果变成<b>红色</b>，表示截取后病人已被更换 — 系统会阻止上传；请打开正确病人再截取一次。',
                '确认 <b>X 光类型</b>（Banana 会按形状估计，请确认）、日期及备注。',
                '点<b>「确认上传」</b>。X 光会在查看器中打开，工具栏显示 <b>✓ 已保存</b>。'
            ],
            tips: '遇到问题？',
            tipList: [
                ['截到的是 Banana，而不是 X 光', '共享了 Chrome 标签页。点「停止」→「共享屏幕」→「窗口」→ X 光软件。'],
                ['画面是黑色或旧的', 'X 光软件窗口被最小化了。还原窗口后再截取。'],
                ['「画面尺寸已改变」', '屏幕布局与上次不同。先用一次「✂ 选取」，之后「同一范围」便可再用。'],
                ['「未能自动找到 X 光」', '直接拖选 X 光即可。X 光在屏幕上越大，自动功能越准确。'],
                ['工具栏打不开', '请从桌面快捷方式打开 Banana（网址以 http://127.0.0.1 或 https:// 开头）。'],
                ['取消选取', '按 Esc。工具栏上的 ✕ 关闭助手；「停止」结束屏幕共享。']
            ],
            quality: 'X 光以原屏幕分辨率保存为无损灰度 PNG — 清晰，而且占用空间少。',
            pickTitle: '选择要共享的内容', tabChrome: 'Chrome 标签页', tabWindow: '窗口', tabScreen: '整个屏幕',
            winXray: 'X 光软件', winOther: '其他程序', winBanana: 'Banana — Google Chrome',
            pickCancel: '取消', pickShare: '共享',
            barPatient: '上传到： #1234', btnSelection: '✂ 选取', btnAuto: '✨ 自动', btnSame: '⟲ 同一范围',
            barStatus: 'X 光出现后…', btnStop: '停止',
            close: '关闭', print: '🖨 打印'
        }
    };

    function li(list) { return '<ul>' + list.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ul>'; }

    function step(n, title, body, key) {
        return '<section class="xhg-step' + (key ? ' is-key' : '') + '"><h3><span class="xhg-num">' + n + '</span>' + title + '</h3>' + body + '</section>';
    }

    function render(lang) {
        var t = T[lang] || T.en;
        return '<p class="xhg-intro">' + t.intro + '</p>' +
            '<section class="xhg-before"><h3>' + t.before + '</h3>' + li(t.beforeList) + '</section>' +
            step(1, t.s1, li(t.s1List) + bar(t)) +
            step(2, t.s2, '<p>' + t.s2Lead + '</p><div class="xhg-share">' + li(t.s2List) + picker(t) + '</div>' +
                '<p class="xhg-note">' + t.s2Note + '</p>', true) +
            step(3, t.s3, '<p>' + t.s3Lead + '</p>' + li(t.s3List)) +
            step(4, t.s4, li(t.s4List)) +
            '<section class="xhg-tips"><h3>' + t.tips + '</h3><dl>' +
                t.tipList.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') +
            '</dl></section>' +
            '<p class="xhg-quality">' + t.quality + '</p>';
    }

    function build() {
        var root = document.getElementById('manual');
        var cover = '<section class="xhg-page xhg-cover">' +
            '<div class="xhg-cover-logo">🍌</div>' +
            '<h1>Banana X-ray Helper<br><span>X 光助手 · 使用說明 · 使用说明</span></h1>' +
            '<p class="xhg-cover-sub">User manual — English · 繁體中文 · 简体中文</p>' +
            '<ol class="xhg-cover-toc">' +
                LANGS.map(function (l) {
                    return '<li><a href="#lang-' + l.id + '"><b>' + l.label + '</b> — ' + T[l.id].title.replace(/^🍌\s*/, '') + '</a></li>';
                }).join('') +
            '</ol>' +
            '<div class="xhg-cover-key">' +
                '<b>⚠ The one rule · 最重要 · 最重要</b>' +
                '<p>' + T.en.s2List[0] + '<br>' + T['zh-Hant'].s2List[0] + '<br>' + T['zh-CN'].s2List[0] + '</p>' +
            '</div>' +
        '</section>';
        root.innerHTML = cover + LANGS.map(function (l) {
            return '<section class="xhg-page" id="lang-' + l.id + '" lang="' + l.id + '">' +
                '<header class="xhg-head"><h2 class="xhg-title">' + T[l.id].title + '</h2>' +
                    '<span class="xhg-lang-tag">' + l.label + '</span></header>' +
                '<div class="xhg-body">' + render(l.id) + '</div>' +
            '</section>';
        }).join('');
        document.title = 'Banana X-ray Helper — user manual · 使用說明 · 使用说明';
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
