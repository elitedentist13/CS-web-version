// Verifies the client-side pathology gate and finding normalization.
// Run: node xray-ai-service/verify_client_gate.js   (from the repo root)
//
// app-xray-ai.js is an IIFE with no test seam, so the source is loaded and a
// single export line is injected before the closing brace. Nothing is written
// back to disk.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

function stubEl() {
    const el = {
        _text: '', innerHTML: '', hidden: false, value: '', checked: false,
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [], attributes: {},
        get textContent() { return this._text; },
        set textContent(v) { this._text = String(v); },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k]; },
        removeAttribute(k) { delete this.attributes[k]; },
        appendChild(c) { this.children.push(c); return c; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
        getContext() { return null; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
    };
    return el;
}

function loadModule() {
    const src = fs.readFileSync(path.join(ROOT, 'app-xray-ai.js'), 'utf8');
    const marker = '})();';
    const at = src.lastIndexOf(marker);
    assert.ok(at > 0, 'could not find IIFE close');
    const exportLine = `
    window.__t = {
        normalize: xrayAiNormalizeFinding,
        withhold: xrayAiWithholdPathology,
        finalize: xrayAiFinalizeFinding,
        pathologyTypes: PATHOLOGY_TYPES,
        meta: FINDING_META,
        typesOrder: FINDING_TYPES_ORDER,
        state: xrayAiState,
        config: XRAY_AI_CONFIG,
        updateScopeNote: xrayAiUpdateScopeNote,
        tr: xrayAiTr
    };
`;
    const patched = src.slice(0, at) + exportLine + src.slice(at);

    const els = {};
    const doc = {
        getElementById: (id) => (els[id] = els[id] || stubEl()),
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => stubEl(),
        addEventListener: () => {},
        body: stubEl(),
        documentElement: stubEl()
    };
    const store = {};
    const win = {
        document: doc,
        localStorage: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; }
        },
        addEventListener: () => {},
        setTimeout, clearTimeout, setInterval, clearInterval,
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        devicePixelRatio: 1,
        fetch: () => Promise.reject(new Error('no network in test')),
        console
    };
    win.window = win;

    const ctx = vm.createContext(win);
    vm.runInContext(patched, ctx, { filename: 'app-xray-ai.js' });
    return { t: win.__t, els, win };
}

const { t, els } = loadModule();
let pass = 0;
function check(name, fn) {
    fn();
    pass++;
    console.log('  ok  ' + name);
}

// Arrays built inside the VM have that realm's Array.prototype, so
// deepStrictEqual would reject them on prototype identity alone.
function eqList(actual, expected, msg) {
    assert.deepStrictEqual(Array.from(actual || []), expected, msg);
}

console.log('client pathology gate');

check('every pathology type is a real finding type', () => {
    t.pathologyTypes.forEach((ty) => {
        assert.ok(t.meta[ty], ty + ' missing from FINDING_META');
        assert.ok(t.typesOrder.indexOf(ty) !== -1, ty + ' missing from FINDING_TYPES_ORDER');
    });
});

check('disease classes are withheld, measurements are kept', () => {
    const input = [
        { type: 'caries_progressed', confidence: 0.94 },
        { type: 'caries_incipient', confidence: 0.88 },
        { type: 'calculus', confidence: 0.7 },
        { type: 'periapical_radiolucency', confidence: 0.6 },
        { type: 'defective_margin', confidence: 0.8 },
        { type: 'restoration', confidence: 0.75 },
        { type: 'bone_loss_mild', confidence: 0.5 },
        { type: 'bone_loss_moderate', confidence: 0.55 },
        { type: 'bone_loss_severe', confidence: 0.6 }
    ];
    const kept = Array.from(t.withhold(input)).map((f) => f.type);
    eqList(kept,
        ['restoration', 'bone_loss_mild', 'bone_loss_moderate', 'bone_loss_severe']);
});

check('withhold tolerates empty and malformed input', () => {
    eqList(t.withhold([]), []);
    eqList(t.withhold(null), []);
    eqList(t.withhold(undefined), []);
    eqList(Array.from(t.withhold([null, undefined, { type: 'restoration' }])).map((f) => f.type),
        ['restoration']);
});

check('no caries claim can survive the fallback gate', () => {
    // Guards the actual risk: a high-confidence caries call from pixel maths.
    const out = t.withhold([{ type: 'caries_progressed', confidence: 0.99 }]);
    assert.strictEqual(out.length, 0);
});

console.log('finding normalization');

check('legacy aliases still map to current taxonomy', () => {
    assert.strictEqual(t.normalize({ type: 'caries_candidate' }).type, 'caries_incipient');
    assert.strictEqual(t.normalize({ type: 'radiolucency_candidate' }).type, 'caries_progressed');
    assert.strictEqual(t.normalize({ type: 'dense_spot_candidate' }).type, 'restoration');
    assert.strictEqual(t.normalize({ type: 'periapical_hint' }).type, 'periapical_radiolucency');
});

check('unknown type is dropped, not promoted to caries', () => {
    assert.strictEqual(t.normalize({ type: 'who_knows' }), null);
    assert.strictEqual(t.normalize({ type: 'sinus_opacity', confidence: 0.9 }), null);
});

check('falsy and typeless input returns null rather than passing through', () => {
    assert.strictEqual(t.normalize(null), null);
    assert.strictEqual(t.normalize(undefined), null);
    assert.strictEqual(t.normalize({}), null);
    assert.strictEqual(t.normalize({ confidence: 0.9 }), null);
});

check('known types pass through unchanged', () => {
    t.typesOrder.forEach((ty) => {
        const out = t.normalize({ type: ty, x: 0.1, y: 0.2, w: 0.1, h: 0.1, confidence: 0.5 });
        assert.ok(out, ty + ' was dropped');
        assert.strictEqual(out.type, ty);
    });
});

check('finalize survives a null-producing finding', () => {
    assert.strictEqual(t.finalize({ type: 'bogus' }, 100, 100), null);
    assert.strictEqual(t.finalize(null, 100, 100), null);
    const ok = t.finalize({ type: 'restoration', x: 0.1, y: 0.1, w: 0.2, h: 0.2, confidence: 0.6 }, 100, 100);
    assert.ok(ok && ok.type === 'restoration');
});

check('degenerate polygon is discarded without dropping the finding', () => {
    const out = t.finalize(
        { type: 'restoration', x: 0.1, y: 0.1, w: 0.2, h: 0.2, confidence: 0.6, polygon: [[0.1, 0.1]] },
        100, 100);
    assert.ok(out, 'finding should survive a bad polygon');
    assert.ok(!out.polygon, '1-point polygon should not be kept');
});

console.log('offline scope notice');

check('notice is shown only for the browser fallback', () => {
    t.state.lastSource = 'client';
    t.updateScopeNote();
    // Stub elements are created on first lookup, so read after the first call.
    const el = els.xrayAiScopeNote;
    assert.ok(el, 'xrayAiScopeNote was never looked up — panel is not wired');
    assert.strictEqual(el.hidden, false, 'should be visible offline');
    // The i18n runtime is not loaded here, so xrayAiTr echoes the key back.
    // That still proves the text is routed through translation.
    assert.strictEqual(el.textContent, 'media.xrayAi.fallbackScope');

    t.state.lastSource = 'api';
    t.updateScopeNote();
    assert.strictEqual(el.hidden, true, 'should be hidden when the service answered');
    assert.strictEqual(el.textContent, '');

    t.state.lastSource = null;
    t.updateScopeNote();
    assert.strictEqual(el.hidden, true, 'should be hidden before any run');
});

check('scope notice is translated into every supported locale', () => {
    // Checked against the source text rather than the runtime, since the i18n
    // bundle is far too large to evaluate here.
    const src = fs.readFileSync(path.join(ROOT, 'app-i18n-extra.js'), 'utf8');
    const at = src.indexOf("'media.xrayAi.fallbackScope'");
    assert.ok(at > 0, 'i18n key media.xrayAi.fallbackScope is not defined');
    const block = src.slice(at, at + 1400);
    ['en:', "'zh-CN':", "'zh-Hant':"].forEach((loc) => {
        assert.ok(block.indexOf(loc) !== -1, 'missing locale ' + loc);
    });
    // The English copy must state the two things that matter clinically.
    const en = block.slice(block.indexOf('en:'), block.indexOf("'zh-CN':"));
    assert.ok(/caries/i.test(en), 'should name what is not being looked for');
    assert.ok(/no AI model|without any AI model/i.test(en),
        'should say no model was used');
});

check('scope note element exists in index.html', () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.ok(html.indexOf('id="xrayAiScopeNote"') !== -1,
        'xrayAiScopeNote markup is missing from the panel');
    assert.ok(html.indexOf('xray-ai-scope-note') !== -1, 'style hook is missing');
    const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    assert.ok(css.indexOf('.xray-ai-scope-note') !== -1, 'CSS rule is missing');
});

check('retain floor sits below the default display threshold', () => {
    // The fallback now retains to retainConfidence; if that were above the
    // slider default, lowering the slider would reveal nothing.
    assert.ok(t.config.retainConfidence < t.config.minConfidence);
    assert.ok(t.config.retainConfidence >= t.config.confidenceMinPct / 100 - 1e-9,
        'slider cannot reach below the retain floor');
});

console.log('\n' + pass + ' checks passed');
