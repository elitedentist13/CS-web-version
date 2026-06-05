// app-doc-editor.js — shared rich-text (contenteditable) editor for documents & templates
var DocEditor = (function () {
    var _ranges = {};

    function el(id) {
        return typeof g === 'function' ? g(id) : document.getElementById(id);
    }

    function escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function toolbarHtml(prefix, opts) {
        opts = opts || {};
        prefix = prefix || 'de';
        var extra = opts.extraButtonsHtml || '';
        var phRow = opts.placeholderRowHtml || '';
        var showPh = !!phRow;

        return '' +
            '<div id="' + prefix + '_toolbar" class="doc-rt-toolbar">' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="bold" title="Bold"><b>B</b></button>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="italic" title="Italic"><i>I</i></button>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="underline" title="Underline"><u>U</u></button>' +
              '<span class="doc-rt-sep"></span>' +
              '<select id="' + prefix + '_fontName" class="doc-rt-select" data-de-font="name">' +
                '<option value="Arial">Arial</option>' +
                '<option value="Times New Roman">Times New Roman</option>' +
                '<option value="Georgia">Georgia</option>' +
                '<option value="Calibri">Calibri</option>' +
                '<option value="PMingLiU">PMingLiU</option>' +
                '<option value="MingLiU">MingLiU</option>' +
                '<option value="Microsoft JhengHei">Microsoft JhengHei</option>' +
              '</select>' +
              '<select id="' + prefix + '_fontSize" class="doc-rt-select" data-de-font="size">' +
                '<option value="2">Small</option>' +
                '<option value="3" selected>Normal</option>' +
                '<option value="4">Large</option>' +
                '<option value="5">X-Large</option>' +
              '</select>' +
              '<input type="color" id="' + prefix + '_fontColor" class="doc-rt-color" value="#111111" data-de-font="color">' +
              '<span class="doc-rt-sep"></span>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="justifyLeft" title="Align left">⟸</button>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="justifyCenter" title="Centre">≡</button>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="justifyRight" title="Align right">⟹</button>' +
              '<span class="doc-rt-sep"></span>' +
              '<button type="button" class="doc-rt-btn" data-de-cmd="insertUnorderedList" title="Bullets">• List</button>' +
              extra +
            '</div>' +
            (showPh
                ? '<div class="doc-rt-ph-row"><span class="doc-rt-ph-label">' + escAttr(opts.placeholderLabel || '') + '</span>' +
                  phRow + '</div>'
                : '');
    }

    function editorHtml(editorId, opts) {
        opts = opts || {};
        var minH = opts.minHeight || 320;
        return '<div id="' + escAttr(editorId) + '" class="doc-rt-editor" contenteditable="true" ' +
            'style="min-height:' + minH + 'px;" data-placeholder-mode="' + (opts.placeholderMode ? '1' : '0') + '"></div>';
    }

    function saveSelection(editorId) {
        var editor = el(editorId);
        if (!editor) return;
        var sel = window.getSelection ? window.getSelection() : null;
        if (!sel || sel.rangeCount === 0) return;
        var range = sel.getRangeAt(0);
        if (!editor.contains(range.commonAncestorContainer)) return;
        _ranges[editorId] = range.cloneRange();
    }

    function restoreSelection(editorId) {
        var editor = el(editorId);
        if (!editor || !_ranges[editorId]) return false;
        var sel = window.getSelection ? window.getSelection() : null;
        if (!sel) return false;
        sel.removeAllRanges();
        sel.addRange(_ranges[editorId]);
        return true;
    }

    function clearPlaceholder(editorId) {
        var editor = el(editorId);
        if (!editor || editor.dataset.placeholderMode !== '1') return;
        editor.dataset.placeholderMode = '0';
        editor.innerHTML = '';
    }

    function setPlaceholder(editorId, text) {
        var editor = el(editorId);
        if (!editor) return;
        editor.dataset.placeholderMode = '1';
        editor.innerHTML = '<span class="doc-rt-ph">' + (typeof esc === 'function' ? esc(text) : text) + '</span>';
    }

    function focusEditor(editorId) {
        var editor = el(editorId);
        if (!editor) return;
        clearPlaceholder(editorId);
        editor.focus();
    }

    function exec(editorId, command, value) {
        var editor = el(editorId);
        if (!editor) return;
        clearPlaceholder(editorId);
        editor.focus();
        restoreSelection(editorId);
        try {
            document.execCommand(command, false, value == null ? null : value);
        } catch (e) {}
        saveSelection(editorId);
    }

    function insertText(editorId, text) {
        exec(editorId, 'insertText', text);
    }

    function getHtml(editorId) {
        var editor = el(editorId);
        if (!editor || editor.dataset.placeholderMode === '1') return '';
        return String(editor.innerHTML || '').trim();
    }

    function setHtml(editorId, html) {
        var editor = el(editorId);
        if (!editor) return;
        editor.dataset.placeholderMode = '0';
        editor.innerHTML = html || '';
    }

    function bindToolbar(prefix, editorId) {
        var bar = el(prefix + '_toolbar');
        if (!bar || bar.dataset.deBound === '1') return;
        bar.dataset.deBound = '1';

        bar.querySelectorAll('[data-de-cmd]').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                exec(editorId, btn.getAttribute('data-de-cmd'));
            });
        });

        var fn = el(prefix + '_fontName');
        if (fn) {
            fn.addEventListener('change', function () {
                exec(editorId, 'fontName', fn.value);
            });
        }
        var fs = el(prefix + '_fontSize');
        if (fs) {
            fs.addEventListener('change', function () {
                exec(editorId, 'fontSize', fs.value);
            });
        }
        var fc = el(prefix + '_fontColor');
        if (fc) {
            fc.addEventListener('input', function () {
                exec(editorId, 'foreColor', fc.value);
            });
        }
    }

    function init(editorId, opts) {
        opts = opts || {};
        var editor = el(editorId);
        if (!editor || editor.dataset.deInit === '1') return;
        editor.dataset.deInit = '1';

        if (opts.toolbarPrefix) {
            bindToolbar(opts.toolbarPrefix, editorId);
        }

        ['mouseup', 'keyup', 'touchend'].forEach(function (ev) {
            editor.addEventListener(ev, function () { saveSelection(editorId); });
        });
        editor.addEventListener('focus', function () {
            clearPlaceholder(editorId);
            saveSelection(editorId);
        });
        editor.addEventListener('input', function () {
            if (editor.dataset.placeholderMode === '1') clearPlaceholder(editorId);
        });

        if (opts.placeholderText && !getHtml(editorId)) {
            setPlaceholder(editorId, opts.placeholderText);
        }
    }

    function refreshFontSizeLabels(prefix, trFn) {
        var sel = el(prefix + '_fontSize');
        if (!sel || typeof trFn !== 'function') return;
        var sizes = [
            { v: '2', k: 'con.forms.fontSizeSmall' },
            { v: '3', k: 'con.forms.fontSizeNormal' },
            { v: '4', k: 'con.forms.fontSizeLarge' },
            { v: '5', k: 'con.forms.fontSizeXLarge' }
        ];
        var prev = sel.value || '3';
        sel.innerHTML = sizes.map(function (s) {
            return '<option value="' + s.v + '">' + (typeof esc === 'function' ? esc(trFn(s.k)) : trFn(s.k)) + '</option>';
        }).join('');
        sel.value = prev;
    }

    return {
        toolbarHtml: toolbarHtml,
        editorHtml: editorHtml,
        init: init,
        bindToolbar: bindToolbar,
        getHtml: getHtml,
        setHtml: setHtml,
        setPlaceholder: setPlaceholder,
        clearPlaceholder: clearPlaceholder,
        exec: exec,
        insertText: insertText,
        focusEditor: focusEditor,
        saveSelection: saveSelection,
        restoreSelection: restoreSelection,
        refreshFontSizeLabels: refreshFontSizeLabels
    };
})();
