// ════════════════════════════════════════════════════════════════
// app-xray-ai.js — CS X-ray Assist (Pearl-inspired lite pathology hints)
// Decision-support only — not Pearl, not a diagnosis. Clinician verifies all.
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var MODEL_VERSION = 'cs-xray-assist-pearl-v7';
    // The service now runs two independently-trained models: a panoramic
    // (full-arch) model and a dedicated PA/bitewing (intraoral) model, each
    // with its own weights and its own continual-training loop. These are
    // fallback labels only — the service's /health and /analyze responses
    // are the source of truth when they advertise a model id.
    var PANO_MODEL_VERSION = 'cs-xray-assist-pano-v1';
    var PABW_MODEL_VERSION = 'cs-xray-assist-pabw-v1';
    // Bumped when the disclaimer's substance changes, so anyone who accepted an
    // earlier wording has to read and accept the new one.
    var DISCLAIMER_KEY = 'jsm_xray_ai_disclaimer_v2';
    var CONFIDENCE_KEY = 'jsm_xray_ai_confidence_v1';

    var XRAY_AI_CONFIG = {
        apiUrl: (typeof window.XRAY_AI_API_URL === 'string' && window.XRAY_AI_API_URL)
            ? window.XRAY_AI_API_URL.replace(/\/$/, '')
            : 'http://127.0.0.1:8877',
        preferApi: window.XRAY_AI_PREFER_API !== false,
        // Default position of the confidence slider — unchanged from the
        // previous fixed cutoff, so out-of-the-box output looks the same.
        minConfidence: 0.38,
        // Findings below this are discarded outright. Everything between this
        // floor and the slider position is kept in state so raising/lowering
        // the slider reveals or hides results without re-running the analysis.
        retainConfidence: 0.15,
        // Slider bounds, in percent.
        confidenceMinPct: 15,
        confidenceMaxPct: 95,
        // Real detectors legitimately find more than the old heuristic did:
        // a full-arch panoramic can carry 20+ genuine findings.
        maxFindings: 40,
        maxCanvasTags: 6
    };

    function xrayAiReadStoredConfidence() {
        try {
            var raw = localStorage.getItem(CONFIDENCE_KEY);
            if (raw == null || raw === '') return XRAY_AI_CONFIG.minConfidence;
            var v = parseFloat(raw);
            if (!isFinite(v)) return XRAY_AI_CONFIG.minConfidence;
            return Math.max(
                XRAY_AI_CONFIG.confidenceMinPct / 100,
                Math.min(XRAY_AI_CONFIG.confidenceMaxPct / 100, v)
            );
        } catch (e) {
            return XRAY_AI_CONFIG.minConfidence;
        }
    }

    /** Pearl Second Opinion–style categories & colours (reference UX only). */
    var FINDING_TYPES_ORDER = [
        'caries_incipient', 'caries_progressed', 'calculus', 'periapical_radiolucency',
        'defective_margin', 'restoration',
        'bone_loss_mild', 'bone_loss_moderate', 'bone_loss_severe'
    ];

    /**
     * Disease claims, as opposed to observations about hardware or geometry.
     *
     * The in-browser fallback (xrayAiAnalyzeClient) is a pixel-threshold
     * heuristic with no model behind it, so it must not assert any of these —
     * see xrayAiWithholdPathology. The Python service applies the equivalent
     * gate server-side via ENABLE_PATHOLOGY_CLASSES.
     */
    var PATHOLOGY_TYPES = [
        'caries_incipient', 'caries_progressed', 'calculus',
        'periapical_radiolucency', 'defective_margin'
    ];

    var FINDING_META = {
        caries_incipient:       { color: '#eab308', shape: 'fill',  i18n: 'media.xrayAi.finding.cariesIncipient' },
        caries_progressed:      { color: '#ec4899', shape: 'fill',  i18n: 'media.xrayAi.finding.cariesProgressed' },
        calculus:               { color: '#22c55e', shape: 'box',   i18n: 'media.xrayAi.finding.calculus' },
        periapical_radiolucency:{ color: '#3b82f6', shape: 'fill',  i18n: 'media.xrayAi.finding.periapical' },
        defective_margin:       { color: '#a855f7', shape: 'box',   i18n: 'media.xrayAi.finding.margin' },
        restoration:            { color: '#64748b', shape: 'fill',  i18n: 'media.xrayAi.finding.restoration' },
        bone_loss_mild:         { color: '#22c55e', shape: 'band',  i18n: 'media.xrayAi.finding.boneMild' },
        bone_loss_moderate:     { color: '#eab308', shape: 'band',  i18n: 'media.xrayAi.finding.boneMod' },
        bone_loss_severe:       { color: '#f97316', shape: 'band',  i18n: 'media.xrayAi.finding.boneSev' }
    };

    /** Pearl-style tooth layer colours (reference UX only). */
    var ANATOMY_LAYER_META = {
        enamel:      { color: '#93c5fd', alpha: 0.10, strokeOnly: true, i18n: 'media.xrayAi.layer.enamel' },
        dentin:      { color: '#5eead4', alpha: 0.18, i18n: 'media.xrayAi.layer.dentin' },
        pulp:        { color: '#fca5a5', alpha: 0.22, i18n: 'media.xrayAi.layer.pulp' },
        restoration: { color: '#d4a574', alpha: 0.20, i18n: 'media.xrayAi.layer.restoration' }
    };
    var ANATOMY_LAYER_ORDER = ['enamel', 'dentin', 'pulp', 'restoration'];

    var xrayAiState = {
        xrayId: null,
        findings: [],
        anatomyLayers: [],
        boneMeasurements: [],
        hidden: {},
        categoryHidden: {},
        layerHidden: {},
        selectedIdx: -1,
        showOverlays: true,
        showAnatomyLayers: true,
        showBoneLines: true,
        running: false,
        lastSource: null,
        lastRunAt: null,
        // Exact model id string reported by the service for the most recent run.
        lastModel: null,
        // Provenance block from the service (which stage produced caries, etc.).
        advisory: null,
        modality: null,
        // Whether the running service accepts training feedback, and per-finding
        // verdicts already sent this run (keyed by finding index).
        // feedbackEnabled covers the panoramic model; pabwFeedbackEnabled covers
        // the separate PA/bitewing model — the service can enable either
        // independently depending on which continual-training loop is ready.
        feedbackEnabled: false,
        pabwFeedbackEnabled: false,
        // Model ids actually reported by the service (falls back to the
        // hardcoded version constants above when /health doesn't advertise them).
        panoModelId: PANO_MODEL_VERSION,
        pabwModelId: PABW_MODEL_VERSION,
        feedback: {},
        // User-adjustable display threshold (see the confidence slider).
        confidenceThreshold: xrayAiReadStoredConfidence()
    };

    // Which training tab (pano vs PA/bitewing) is currently open in the
    // training review modal. Defaults to panoramic; xrayAiOpenTrainingReview
    // switches this to match whichever X-ray is open in the lightbox.
    var xrayAiActiveTrainTab = 'pano';

    /** True when a finding clears the current confidence threshold. */
    function xrayAiMeetsConfidence(f) {
        return (f && f.confidence != null ? f.confidence : 0) >= xrayAiState.confidenceThreshold;
    }

    /**
     * Findings above the threshold, paired with their original index.
     * The index matters: hidden[]/selectedIdx and the findings-list click
     * handlers all key off position in xrayAiState.findings, so filtering must
     * not renumber anything.
     */
    function xrayAiVisibleFindings() {
        var out = [];
        xrayAiState.findings.forEach(function (f, idx) {
            if (xrayAiMeetsConfidence(f)) out.push({ f: f, idx: idx });
        });
        return out;
    }

    function xrayAiTr(key, pairs) {
        if (typeof mediaTrRepl === 'function' && pairs) return mediaTrRepl(key, pairs);
        if (typeof mediaTr === 'function') return mediaTr(key);
        return key;
    }

    function xrayAiEsc(s) {
        if (typeof esc === 'function') return esc(s);
        return String(s == null ? '' : s);
    }

    function xrayAiG(id) {
        return (typeof g === 'function') ? g(id) : document.getElementById(id);
    }

    function xrayAiBoundsFromPolygon(poly) {
        if (!poly || poly.length < 3) return null;
        var minX = poly[0][0], maxX = minX, minY = poly[0][1], maxY = minY, i;
        for (i = 1; i < poly.length; i++) {
            if (poly[i][0] < minX) minX = poly[i][0];
            if (poly[i][0] > maxX) maxX = poly[i][0];
            if (poly[i][1] < minY) minY = poly[i][1];
            if (poly[i][1] > maxY) maxY = poly[i][1];
        }
        return {
            x: minX,
            y: minY,
            w: Math.max(0.008, maxX - minX),
            h: Math.max(0.008, maxY - minY)
        };
    }

    function xrayAiFinalizeFinding(f, imgW, imgH) {
        f = xrayAiNormalizeFinding(f);
        if (!f) return null;
        if (f.polygon) {
            f.polygon = xrayAiSanitizePolygon(f.polygon, imgW, imgH);
            if (!f.polygon) delete f.polygon;
        }
        if (f.polygon && f.polygon.length >= 3) {
            var pb = xrayAiBoundsFromPolygon(f.polygon);
            if (pb) {
                f.x = pb.x;
                f.y = pb.y;
                f.w = pb.w;
                f.h = pb.h;
            }
        } else if (imgW && imgH && (f.x > 1.5 || f.y > 1.5)) {
            f.x = f.x / imgW;
            f.y = f.y / imgH;
            f.w = (f.w || 0.05) / imgW;
            f.h = (f.h || 0.05) / imgH;
        }
        return f;
    }

    function xrayAiDedupeFindings(findings) {
        findings = xrayAiNms(findings, 0.42);
        var out = [], i, j, f, g;
        for (i = 0; i < findings.length; i++) {
            f = findings[i];
            var skip = false;
            for (j = 0; j < out.length; j++) {
                g = out[j];
                if (xrayAiIou(f, g) < 0.22) continue;
                var bothCaries = (f.type || '').indexOf('caries_') === 0 && (g.type || '').indexOf('caries_') === 0;
                if (bothCaries || f.type === g.type) {
                    if ((f.confidence || 0) > (g.confidence || 0)) out[j] = f;
                    skip = true;
                    break;
                }
            }
            if (!skip) out.push(f);
        }
        return out;
    }

    /** Returns a normalized finding, or null if it cannot be represented. */
    function xrayAiNormalizeFinding(f) {
        if (!f || !f.type) return null;
        var t = f.type;
        if (t === 'caries_candidate') t = 'caries_incipient';
        if (t === 'radiolucency_candidate') t = 'caries_progressed';
        if (t === 'dense_spot_candidate') t = 'restoration';
        if (t === 'periapical_hint') t = 'periapical_radiolucency';
        // An unrecognised type is dropped rather than coerced. It used to fall
        // through to caries_progressed, which turned any unknown label into the
        // most serious diagnosis in the taxonomy.
        if (!FINDING_META[t]) return null;
        var out = Object.assign({}, f, { type: t });
        if (out.polygon && !Array.isArray(out.polygon)) out.polygon = null;
        if (Array.isArray(out.polygon)) {
            out.polygon = out.polygon.filter(function (pt) {
                return pt && pt.length >= 2 && isFinite(pt[0]) && isFinite(pt[1]);
            });
            if (out.polygon.length < 3) out.polygon = null;
        }
        return out;
    }

    function xrayAiNormalizePolyPoint(pt, imgW, imgH) {
        var nx, ny;
        if (Array.isArray(pt) && pt.length >= 2) {
            nx = Number(pt[0]);
            ny = Number(pt[1]);
        } else if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
            nx = pt.x;
            ny = pt.y;
        } else {
            return null;
        }
        if (!isFinite(nx) || !isFinite(ny)) return null;
        if ((nx > 1.5 || ny > 1.5) && imgW && imgH) {
            nx /= imgW;
            ny /= imgH;
        }
        return [Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny))];
    }

    function xrayAiSanitizePolygon(poly, imgW, imgH) {
        if (!Array.isArray(poly)) return null;
        var pts = [], i;
        for (i = 0; i < poly.length; i++) {
            var n = xrayAiNormalizePolyPoint(poly[i], imgW, imgH);
            if (n) pts.push(n);
        }
        return pts.length >= 3 ? pts : null;
    }

    function xrayAiPolyArea(poly) {
        if (!poly || poly.length < 3) return 0;
        var area = 0, i;
        for (i = 0; i < poly.length; i++) {
            var j = (i + 1) % poly.length;
            area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
        }
        return Math.abs(area) * 0.5;
    }

    function xrayAiPolyYSpan(poly) {
        if (!poly || !poly.length) return 0;
        var minY = poly[0][1], maxY = poly[0][1], i;
        for (i = 1; i < poly.length; i++) {
            if (poly[i][1] < minY) minY = poly[i][1];
            if (poly[i][1] > maxY) maxY = poly[i][1];
        }
        return maxY - minY;
    }

    function xrayAiPickBestLayers(layers) {
        var best = {}, i, layer, key, area;
        for (i = 0; i < layers.length; i++) {
            layer = layers[i];
            key = String(layer.tooth) + '|' + layer.layer;
            area = xrayAiPolyArea(layer.polygon);
            if (!best[key] || area > best[key].area) best[key] = { layer: layer, area: area };
        }
        return Object.keys(best).map(function (k) { return best[k].layer; });
    }

    function xrayAiSanitizeLayers(layers, imgW, imgH) {
        if (!Array.isArray(layers)) return [];
        var out = [], i;
        for (i = 0; i < layers.length; i++) {
            var layer = layers[i];
            if (!layer || !layer.layer) continue;
            var poly = xrayAiSanitizePolygon(layer.polygon, imgW, imgH);
            if (!poly) continue;
            if (layer.layer === 'enamel' && xrayAiPolyYSpan(poly) < 0.05) continue;
            out.push({ tooth: layer.tooth, layer: layer.layer, polygon: poly });
            if (out.length >= 120) break;
        }
        return xrayAiPickBestLayers(out);
    }

    function xrayAiGetOverlayRect(img) {
        if (!img) return { x: 0, y: 0, w: 800, h: 600 };
        var dw = (typeof lbLayoutBaseW === 'number' && lbLayoutBaseW > 0)
            ? lbLayoutBaseW : (img.offsetWidth || img.clientWidth || 800);
        var dh = (typeof lbLayoutBaseH === 'number' && lbLayoutBaseH > 0)
            ? lbLayoutBaseH : (img.offsetHeight || img.clientHeight || 600);
        var nw = img.naturalWidth || dw;
        var nh = img.naturalHeight || dh;
        if (!nw || !nh) return { x: 0, y: 0, w: dw, h: dh };
        var scale = Math.min(dw / nw, dh / nh);
        var cw = nw * scale;
        var ch = nh * scale;
        return { x: (dw - cw) / 2, y: (dh - ch) / 2, w: cw, h: ch };
    }

    function xrayAiNormToCanvas(nx, ny, rect) {
        return [rect.x + nx * rect.w, rect.y + ny * rect.h];
    }

    function xrayAiDisclaimerAccepted() {
        try { return localStorage.getItem(DISCLAIMER_KEY) === '1'; } catch (e) { return false; }
    }

    function xrayAiSetDisclaimerAccepted() {
        try { localStorage.setItem(DISCLAIMER_KEY, '1'); } catch (e) {}
    }

    function xrayAiEnsureDisclaimer(thenFn) {
        if (xrayAiDisclaimerAccepted()) { thenFn(); return; }
        var ov = document.createElement('div');
        ov.className = 'xray-ai-overlay';
        ov.innerHTML =
            '<div class="xray-ai-modal" role="dialog">' +
                '<h2>' + xrayAiEsc(xrayAiTr('media.xrayAi.disclaimerTitle')) + '</h2>' +
                '<div class="xray-ai-disclaimer-body">' + xrayAiEsc(xrayAiTr('media.xrayAi.disclaimerBody')) + '</div>' +
                '<label class="xray-ai-check"><input type="checkbox" id="xrayAiDisclaimerDontShow"> ' +
                    xrayAiEsc(xrayAiTr('media.xrayAi.disclaimerDontShow')) + '</label>' +
                '<div class="xray-ai-modal-actions">' +
                    '<button type="button" class="ct-btn" id="xrayAiDisclaimerCancel">' + xrayAiEsc(xrayAiTr('media.xrayAi.cancel')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="xrayAiDisclaimerOk">' + xrayAiEsc(xrayAiTr('media.xrayAi.understand')) + '</button>' +
                '</div></div>';
        document.body.appendChild(ov);
        xrayAiG('xrayAiDisclaimerCancel').onclick = function () { ov.remove(); };
        xrayAiG('xrayAiDisclaimerOk').onclick = function () {
            var chk = xrayAiG('xrayAiDisclaimerDontShow');
            if (chk && chk.checked) xrayAiSetDisclaimerAccepted();
            ov.remove();
            thenFn();
        };
    }

    // ── Image analysis helpers ─────────────────────────────────────
    function xrayAiExtractGray(imgEl, maxSide) {
        maxSide = maxSide || 1024;
        var nw = imgEl.naturalWidth || imgEl.width || 800;
        var nh = imgEl.naturalHeight || imgEl.height || 600;
        var scale = Math.min(1, maxSide / Math.max(nw, nh));
        var cw = Math.max(32, Math.round(nw * scale));
        var ch = Math.max(32, Math.round(nh * scale));
        var off = document.createElement('canvas');
        off.width = cw;
        off.height = ch;
        var ctx = off.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, cw, ch);
        var data;
        try { data = ctx.getImageData(0, 0, cw, ch).data; }
        catch (e) { return { error: 'CORS' }; }
        var gray = new Float32Array(cw * ch);
        for (var i = 0; i < cw * ch; i++) {
            var p = i * 4;
            gray[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
        }
        var minG = 255, maxG = 0, j;
        for (j = 0; j < gray.length; j++) {
            if (gray[j] < minG) minG = gray[j];
            if (gray[j] > maxG) maxG = gray[j];
        }
        var range = Math.max(1, maxG - minG);
        for (j = 0; j < gray.length; j++) gray[j] = ((gray[j] - minG) / range) * 255;
        return { gray: gray, cw: cw, ch: ch };
    }

    function xrayAiLocalMean(gray, cw, ch, cx, cy, r) {
        var sum = 0, cnt = 0, x, y;
        for (y = Math.max(0, cy - r); y <= Math.min(ch - 1, cy + r); y++) {
            for (x = Math.max(0, cx - r); x <= Math.min(cw - 1, cx + r); x++) {
                sum += gray[y * cw + x];
                cnt++;
            }
        }
        return cnt ? sum / cnt : 128;
    }

    function xrayAiIou(a, b) {
        var ax2 = a.x + a.w, ay2 = a.y + a.h, bx2 = b.x + b.w, by2 = b.y + b.h;
        var ix1 = Math.max(a.x, b.x), iy1 = Math.max(a.y, b.y);
        var ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
        var iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1);
        var inter = iw * ih;
        if (inter <= 0) return 0;
        return inter / (a.w * a.h + b.w * b.h - inter);
    }

    function xrayAiNms(boxes, thresh) {
        boxes = boxes.slice().sort(function (a, b) { return b.confidence - a.confidence; });
        var kept = [];
        boxes.forEach(function (b) {
            if (kept.some(function (k) { return xrayAiIou(b, k) > (thresh || 0.35); })) return;
            kept.push(b);
        });
        return kept;
    }

    function xrayAiMaskOverlap(mask, cw, x, y, bw, bh) {
        if (!mask) return 0;
        var x2 = Math.min(cw, x + bw), y2 = Math.min(mask.length / cw, y + bh);
        x = Math.max(0, x); y = Math.max(0, y);
        if (x2 <= x || y2 <= y) return 0;
        var hit = 0, total = 0, xi, yi;
        for (yi = y; yi < y2; yi++) {
            for (xi = x; xi < x2; xi++) {
                total++;
                if (mask[yi * cw + xi]) hit++;
            }
        }
        return total ? hit / total : 0;
    }

    function xrayAiDistToTooth(mask, cw, ch, cx, cy) {
        if (!mask) return Math.max(cw, ch);
        var best = 1e9, i, x, y;
        for (i = 0; i < mask.length; i++) {
            if (!mask[i]) continue;
            y = (i / cw) | 0;
            x = i % cw;
            var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
            if (d < best) best = d;
        }
        return best;
    }

    function xrayAiFindInterarchGap(toothMask, cw, ch) {
        var proj = new Float32Array(ch), y, x, i, lo, hi, segMin, segIdx, peak, above, below, minSide, sum, cnt;
        for (y = 0; y < ch; y++) {
            sum = 0;
            for (x = 0; x < cw; x++) if (toothMask[y * cw + x]) sum++;
            proj[y] = sum;
        }
        var smoothW = Math.max(7, (ch / 32) | 0);
        var smooth = new Float32Array(ch);
        for (y = 0; y < ch; y++) {
            sum = 0; cnt = 0;
            for (i = y - smoothW; i <= y + smoothW; i++) {
                if (i >= 0 && i < ch) { sum += proj[i]; cnt++; }
            }
            smooth[y] = cnt ? sum / cnt : 0;
        }
        lo = (ch * 0.28) | 0; hi = (ch * 0.72) | 0;
        if (hi <= lo + 6) return null;
        peak = 0;
        for (y = 0; y < ch; y++) if (smooth[y] > peak) peak = smooth[y];
        segMin = 1e9; segIdx = lo;
        for (y = lo; y < hi; y++) {
            if (smooth[y] < segMin) { segMin = smooth[y]; segIdx = y; }
        }
        if (peak < 4 || segMin > peak * 0.92) return null;
        if (segIdx - lo < 5 || hi - segIdx < 6) return null;
        above = 0; below = 0;
        for (y = 0; y < segIdx; y++) for (x = 0; x < cw; x++) if (toothMask[y * cw + x]) above++;
        for (y = segIdx; y < ch; y++) for (x = 0; x < cw; x++) if (toothMask[y * cw + x]) below++;
        minSide = Math.max(24, ((cw * ch * 0.008) | 0));
        if (above < minSide || below < minSide) return null;
        return segIdx;
    }

    function xrayAiColumnVerticalBands(colBool, cw, ch, archGapY) {
        var rows = [], y, x, i, gapMin, bands = [], start, prev, r;
        for (y = 0; y < ch; y++) {
            if (colBool[y]) { rows.push(y); break; }
        }
        if (rows.length < 8) return [];
        gapMin = Math.max(4, (ch * 0.018) | 0);
        start = rows[0]; prev = rows[0];
        for (i = 1; i < rows.length; i++) {
            r = rows[i];
            if (r - prev > gapMin) {
                if (prev - start + 1 >= 8) bands.push([start, prev]);
                start = r;
            }
            prev = r;
        }
        if (prev - start + 1 >= 8) bands.push([start, prev]);
        if (!bands.length) bands.push([rows[0], rows[rows.length - 1]]);
        if (archGapY != null && bands.length === 1) {
            if (bands[0][0] + 10 < archGapY && archGapY < bands[0][1] - 10) {
                bands = [[bands[0][0], archGapY - 1], [archGapY + 1, bands[0][1]]];
            }
        }
        return bands;
    }

    function xrayAiCrownRootForBand(yTop, yApex, cejY, ch, archGapY) {
        if (archGapY != null) {
            if (yApex <= archGapY) return { crownY1: yTop, crownY2: cejY, arch: 'upper' };
            if (yTop >= archGapY) return { crownY1: cejY, crownY2: yApex + 1, arch: 'lower' };
        }
        var bandMid = (yTop + yApex) / 2;
        if (bandMid < ch * 0.48) return { crownY1: yTop, crownY2: cejY, arch: 'upper' };
        return { crownY1: cejY, crownY2: yApex + 1, arch: 'lower' };
    }

    function xrayAiToothForPoint(anatomy, cx, cy) {
        var i, t;
        for (i = 0; i < anatomy.teeth.length; i++) {
            t = anatomy.teeth[i];
            if (cx >= t.xLeft && cx <= t.xRight && cy >= t.crownY1 && cy <= t.crownY2) return t;
        }
        return null;
    }

    function xrayAiClampCejY(yTop, yApex, cejY) {
        var colH = Math.max(10, yApex - yTop);
        var minCej = yTop + Math.max(4, (colH * 0.30) | 0);
        var maxCej = yTop + Math.max(8, (colH * 0.58) | 0);
        if (cejY < minCej) cejY = minCej;
        if (cejY > maxCej) cejY = maxCej;
        return cejY;
    }

    function xrayAiBuildAnatomy(gray, cw, ch) {
        var otsu = 0, hist = new Array(256).fill(0), i, v, p, cnt, x, y;
        for (i = 0; i < gray.length; i++) hist[Math.min(255, Math.max(0, gray[i] | 0))]++;
        var total = gray.length, sum = 0, sumB = 0, wB = 0, maxVar = 0;
        for (i = 0; i < 256; i++) sum += i * hist[i];
        for (i = 0; i < 256; i++) {
            wB += hist[i]; if (!wB) continue;
            var wF = total - wB; if (!wF) break;
            sumB += i * hist[i];
            var mB = sumB / wB, mF = (sum - sumB) / wF;
            var vBetween = wB * wF * (mB - mF) * (mB - mF);
            if (vBetween > maxVar) { maxVar = vBetween; otsu = i; }
        }
        var dentinT = Math.max(68, otsu * 0.76);
        var tooth = new Uint8Array(cw * ch);
        var topCut = Math.max(1, (ch * 0.05) | 0);
        for (i = 0; i < gray.length; i++) {
            if ((i / cw | 0) < topCut) continue;
            if (gray[i] > dentinT) tooth[i] = 1;
        }

        // Keep tall vertical components (teeth)
        var visited = new Uint8Array(cw * ch);
        var toothMask = new Uint8Array(cw * ch);
        var components = [];
        function flood(si) {
            var stack = [si], minX = si % cw, maxX = minX, minY = (si / cw) | 0, maxY = minY, cnt = 0;
            visited[si] = 1;
            toothMask[si] = 1;
            while (stack.length) {
                var cur = stack.pop();
                cnt++;
                var cx = cur % cw, cy = (cur / cw) | 0;
                if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
                if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
                var nbs = [cur - 1, cur + 1, cur - cw, cur + cw];
                var d, ni, nx, ny;
                for (d = 0; d < 4; d++) {
                    ni = nbs[d]; nx = ni % cw; ny = (ni / cw) | 0;
                    if (ni < 0 || ni >= gray.length || visited[ni] || !tooth[ni]) continue;
                    if (d === 0 && nx !== cx - 1) continue;
                    if (d === 1 && nx !== cx + 1) continue;
                    visited[ni] = 1;
                    toothMask[ni] = 1;
                    stack.push(ni);
                }
            }
            return { cnt: cnt, minX: minX, maxX: maxX, minY: minY, maxY: maxY, h: maxY - minY + 1 };
        }
        for (i = 0; i < gray.length; i++) {
            if (!tooth[i] || visited[i]) continue;
            var comp = flood(i);
            if (comp.h > ch * 0.10 && comp.cnt > cw * ch * 0.004) components.push(comp);
        }
        if (!components.length) {
            for (i = 0; i < tooth.length; i++) toothMask[i] = tooth[i];
        }

        // Vertical projection
        var vProj = new Float32Array(cw);
        for (p = 0; p < cw; p++) {
            sum = 0;
            for (i = p; i < gray.length; i += cw) if (toothMask[i]) sum++;
            vProj[p] = sum;
        }
        var smoothW = Math.max(7, (cw / 28) | 0);
        var vSmooth = new Float32Array(cw);
        for (p = 0; p < cw; p++) {
            sum = 0; cnt = 0;
            for (i = p - smoothW; i <= p + smoothW; i++) {
                if (i >= 0 && i < cw) { sum += vProj[i]; cnt++; }
            }
            vSmooth[p] = cnt ? sum / cnt : 0;
        }
        var peakT = 0;
        for (p = 0; p < cw; p++) if (vSmooth[p] > peakT) peakT = vSmooth[p];
        peakT = Math.max(4, peakT * 0.18);
        var minDist = Math.max(6, (cw / 22) | 0);
        var peaks = [];
        for (p = 2; p < cw - 2; p++) {
            if (vSmooth[p] < peakT) continue;
            if (vSmooth[p] >= vSmooth[p - 1] && vSmooth[p] >= vSmooth[p + 1]) {
                if (!peaks.length || p - peaks[peaks.length - 1] >= minDist) peaks.push(p);
                else if (vSmooth[p] > vSmooth[peaks[peaks.length - 1]]) peaks[peaks.length - 1] = p;
            }
        }

        var crownMask = new Uint8Array(cw * ch);
        var rootMask = new Uint8Array(cw * ch);
        var pulpMask = new Uint8Array(cw * ch);
        var enamelMask = new Uint8Array(cw * ch);
        var dentinMask = new Uint8Array(cw * ch);
        var alveolarMask = new Uint8Array(cw * ch);
        var interproxMask = new Uint8Array(cw * ch);
        var cejCurve = new Int32Array(cw);
        for (p = 0; p < cw; p++) cejCurve[p] = (ch * 0.45) | 0;
        var teeth = [];
        var archGapY = xrayAiFindInterarchGap(toothMask, cw, ch);

        function addToothBand(xLeft, xRight, px, yTop, yApex) {
            var widths = [], y, x, wMin = 1e9, cejY = ((yTop + yApex) * 0.55) | 0;
            var s0 = (yTop + ((yApex - yTop) * 0.30) | 0) | 0;
            var s1 = (yTop + ((yApex - yTop) * 0.78) | 0) | 0;
            for (y = yTop; y <= yApex; y++) {
                var x1b = cw, x2b = 0;
                for (x = xLeft; x <= xRight; x++) {
                    if (toothMask[y * cw + x]) { if (x < x1b) x1b = x; if (x > x2b) x2b = x; }
                }
                widths.push(x2b >= x1b ? x2b - x1b + 1 : 0);
            }
            for (y = s0 - yTop; y < Math.min(widths.length, s1 - yTop); y++) {
                if (widths[y] > 0 && widths[y] < wMin) { wMin = widths[y]; cejY = yTop + y; }
            }
            cejY = xrayAiClampCejY(yTop, yApex, cejY);
            var cr = xrayAiCrownRootForBand(yTop, yApex, cejY, ch, archGapY);
            if (cr.crownY2 <= cr.crownY1 + 2) return;
            teeth.push({
                xLeft: xLeft, xRight: xRight, xCenter: px, yTop: yTop, cejY: cejY, yApex: yApex,
                crownY1: cr.crownY1, crownY2: cr.crownY2, arch: cr.arch
            });
            for (x = xLeft; x <= xRight; x++) {
                if (cr.arch === 'upper') cejCurve[x] = Math.min(cejCurve[x], cejY);
                else cejCurve[x] = Math.max(cejCurve[x], cejY);
            }
            for (y = cr.crownY1; y < cr.crownY2; y++) {
                for (x = xLeft; x <= xRight; x++) if (toothMask[y * cw + x]) crownMask[y * cw + x] = 1;
            }
            if (cr.arch === 'upper') {
                for (y = cejY; y <= yApex; y++) {
                    for (x = xLeft; x <= xRight; x++) if (toothMask[y * cw + x]) rootMask[y * cw + x] = 1;
                }
            } else {
                for (y = yTop; y < cejY; y++) {
                    for (x = xLeft; x <= xRight; x++) if (toothMask[y * cw + x]) rootMask[y * cw + x] = 1;
                }
            }
            var darkVals = [];
            for (y = cr.crownY1; y < cr.crownY2; y++) {
                for (x = xLeft; x <= xRight; x++) {
                    if (crownMask[y * cw + x]) darkVals.push(gray[y * cw + x]);
                }
            }
            if (darkVals.length) {
                darkVals.sort(function (a, b) { return a - b; });
                var pulpT = darkVals[Math.floor(darkVals.length * 0.22)];
                for (y = cr.crownY1; y < cr.crownY2; y++) {
                    for (x = xLeft; x <= xRight; x++) {
                        if (crownMask[y * cw + x] && gray[y * cw + x] < pulpT) pulpMask[y * cw + x] = 1;
                    }
                }
            }
            for (y = cr.crownY1; y < cr.crownY2; y++) {
                var rx1 = cw, rx2 = 0, xi;
                for (xi = xLeft; xi <= xRight; xi++) {
                    if (crownMask[y * cw + xi]) { if (xi < rx1) rx1 = xi; if (xi > rx2) rx2 = xi; }
                }
                if (rx2 <= rx1) continue;
                var shell = Math.max(2, ((rx2 - rx1 + 1) / 2) * 0.38);
                for (xi = xLeft; xi <= xRight; xi++) {
                    if (!crownMask[y * cw + xi] || pulpMask[y * cw + xi]) continue;
                    if (Math.min(xi - rx1, rx2 - xi) <= shell) enamelMask[y * cw + xi] = 1;
                    else dentinMask[y * cw + xi] = 1;
                }
            }
        }

        peaks.forEach(function (px, pi) {
            var xLeft, xRight;
            if (pi === 0) xLeft = Math.max(0, px - minDist);
            else xLeft = ((peaks[pi - 1] + px) / 2) | 0;
            if (pi === peaks.length - 1) xRight = Math.min(cw - 1, px + minDist);
            else xRight = ((px + peaks[pi + 1]) / 2) | 0;
            if (xRight <= xLeft) {
                xLeft = Math.max(0, px - 2);
                xRight = Math.min(cw - 1, px + 2);
            }
            var colBool = new Uint8Array(ch);
            for (y = 0; y < ch; y++) {
                for (x = xLeft; x <= xRight; x++) if (toothMask[y * cw + x]) colBool[y] = 1;
            }
            var bands = xrayAiColumnVerticalBands(colBool, cw, ch, archGapY);
            if (!bands.length) return;
            bands.forEach(function (band) {
                if (band[1] - band[0] < 10) return;
                addToothBand(xLeft, xRight, px, band[0], band[1]);
            });
        });

        var archGroups = { upper: [], lower: [] };
        teeth.forEach(function (t) { archGroups[t.arch].push(t); });
        ['upper', 'lower'].forEach(function (arch) {
            archGroups[arch].sort(function (a, b) { return a.xCenter - b.xCenter; });
            for (i = 0; i < archGroups[arch].length - 1; i++) {
                var t1 = archGroups[arch][i], t2 = archGroups[arch][i + 1];
                var gl = t1.xRight, gr = t2.xLeft;
                if (gr - gl < 2) { var mid = (gl + gr) >> 1; gl = Math.max(0, mid - 3); gr = Math.min(cw - 1, mid + 3); }
                var crownTop = Math.max(t1.crownY1, t2.crownY1);
                var crownBot = Math.min(t1.crownY2, t2.crownY2);
                if (crownBot > crownTop + 4) {
                    var midCrown = (crownTop + crownBot) >> 1;
                    var iy0 = Math.max(0, midCrown - ((ch * 0.10) | 0));
                    var iy1 = Math.min(ch, midCrown + ((ch * 0.12) | 0));
                    for (y = iy0; y < iy1; y++) {
                        for (x = gl; x <= gr; x++) interproxMask[y * cw + x] = 1;
                    }
                }
                var cej = arch === 'upper' ? Math.min(t1.cejY, t2.cejY) : Math.max(t1.cejY, t2.cejY);
                var y0 = arch === 'upper' ? cej : Math.max(0, cej - ((ch * 0.22) | 0));
                var y1 = arch === 'upper' ? Math.min(ch, cej + ((ch * 0.22) | 0)) : cej;
                for (y = y0; y < y1; y++) {
                    for (x = gl; x <= gr; x++) alveolarMask[y * cw + x] = 1;
                }
            }
        });

        return {
            toothMask: toothMask, crownMask: crownMask, pulpMask: pulpMask,
            rootMask: rootMask, alveolarMask: alveolarMask, interproxMask: interproxMask,
            enamelMask: enamelMask, dentinMask: dentinMask,
            cejCurve: cejCurve, teeth: teeth, cw: cw, ch: ch
        };
    }

    // ── Pearl anatomy export (browser fallback) ───────────────────
    // Crown outline from per-row mask edges (stable on bitewings; avoids stacked fragments).
    function xrayAiCrownEnvelopePoly(mask, cw, ch, x1, y1, x2, y2, maxPts) {
        maxPts = maxPts || 28;
        var left = [], right = [], y, x, lx, rx;
        for (y = y1; y < y2; y++) {
            lx = -1; rx = -1;
            for (x = x1; x <= x2; x++) {
                if (mask[y * cw + x]) {
                    if (lx < 0) lx = x;
                    rx = x;
                }
            }
            if (lx < 0) continue;
            left.push([lx / cw, y / ch]);
            right.push([rx / cw, y / ch]);
        }
        if (left.length < 3) return [];
        var poly = left.concat(right.reverse());
        if (poly.length <= maxPts) return poly;
        var step = Math.ceil(poly.length / maxPts);
        return poly.filter(function (_, idx) { return idx % step === 0; });
    }

    // Trace outer contour (ordered), not raster-scanned boundary points.
    function xrayAiMaskBoundaryPoly(mask, cw, ch, x1, y1, x2, y2, maxPts) {
        maxPts = maxPts || 28;
        var start = null, x, y, i;
        for (y = y1; y <= y2 && !start; y++) {
            for (x = x1; x <= x2; x++) {
                i = y * cw + x;
                if (!mask[i]) continue;
                if (x <= x1 || !mask[i - 1] || y <= y1 || !mask[i - cw]) {
                    start = [x, y];
                    break;
                }
            }
        }
        if (!start) return [];

        var dirs = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
        var contour = [];
        var cx = start[0], cy = start[1], dir = 0;
        var steps = 0, maxSteps = (x2 - x1 + 1) * (y2 - y1 + 1) * 8 + 8;

        do {
            contour.push([cx / cw, cy / ch]);
            var found = false, d, nd, nx, ny;
            for (d = 0; d < 8; d++) {
                nd = (dir + d + 5) % 8;
                nx = cx + dirs[nd][0];
                ny = cy + dirs[nd][1];
                if (nx < x1 || nx > x2 || ny < y1 || ny > y2) continue;
                if (mask[ny * cw + nx]) {
                    cx = nx;
                    cy = ny;
                    dir = nd;
                    found = true;
                    break;
                }
            }
            if (!found) break;
            steps++;
        } while ((cx !== start[0] || cy !== start[1] || contour.length < 3) && steps < maxSteps);

        if (contour.length < 3) return [];
        if (contour.length <= maxPts) return contour;
        var step = Math.ceil(contour.length / maxPts);
        return contour.filter(function (_, idx) { return idx % step === 0; });
    }

    function xrayAiExportAnatomyLayers(anatomy, gray) {
        var cw = anatomy.cw, ch = anatomy.ch, layers = [], maskTmp = new Uint8Array(cw * ch);
        var x1, x2, y1, y2, layerName, src, poly, x, y, i;
        anatomy.teeth.forEach(function (tooth, ti) {
            x1 = tooth.xLeft; x2 = tooth.xRight; y1 = tooth.crownY1; y2 = tooth.crownY2;
            if (y2 <= y1 + 2) return;
            poly = xrayAiCrownEnvelopePoly(anatomy.crownMask, cw, ch, x1, y1, x2, y2);
            if (poly.length >= 3 && xrayAiPolyYSpan(poly) >= 0.06) {
                layers.push({ tooth: ti, layer: 'dentin', polygon: poly });
            }
            ANATOMY_LAYER_ORDER.forEach(function (layerName) {
                if (layerName === 'dentin') return;
                src = layerName === 'enamel' ? anatomy.enamelMask :
                    layerName === 'pulp' ? anatomy.pulpMask : null;
                if (layerName === 'restoration') {
                    maskTmp.fill(0);
                    for (y = y1; y < y2; y++) {
                        for (x = x1; x <= x2; x++) {
                            i = y * cw + x;
                            if (anatomy.crownMask[i] && gray[i] > 168) maskTmp[i] = 1;
                        }
                    }
                    src = maskTmp;
                } else if (!src) return;
                if (layerName === 'pulp') {
                    poly = xrayAiCrownEnvelopePoly(src, cw, ch, x1, y1, x2, y2);
                    if (poly.length < 3) poly = xrayAiMaskBoundaryPoly(src, cw, ch, x1, y1, x2, y2);
                } else {
                    poly = xrayAiMaskBoundaryPoly(src, cw, ch, x1, y1, x2, y2);
                }
                if (poly.length >= 3) layers.push({ tooth: ti, layer: layerName, polygon: poly });
            });
        });
        return xrayAiPickBestLayers(layers);
    }

    function xrayAiEstimatePxPerMm(anatomy) {
        if (!anatomy.teeth.length) return anatomy.ch / 35;
        var widths = anatomy.teeth.map(function (t) { return Math.max(4, t.xRight - t.xLeft); });
        widths.sort(function (a, b) { return a - b; });
        return Math.max(4, widths[(widths.length / 2) | 0] / 9);
    }

    function xrayAiMeasureCejCrest(anatomy, gray) {
        var cw = anatomy.cw, ch = anatomy.ch, lines = [], pxMm = xrayAiEstimatePxPerMm(anatomy);
        for (var i = 0; i < anatomy.teeth.length - 1; i++) {
            var gl = anatomy.teeth[i].xRight, gr = anatomy.teeth[i + 1].xLeft;
            if (gr - gl < 1) { var mid = (gl + gr) >> 1; gl = Math.max(0, mid - 4); gr = Math.min(cw - 1, mid + 4); }
            var cx = ((gl + gr) / 2) | 0;
            var cej = anatomy.cejCurve[gl];
            for (var x = gl; x <= gr; x++) if (anatomy.cejCurve[x] < cej) cej = anatomy.cejCurve[x];
            var colW = Math.max(3, ((gr - gl) / 2 | 0) + 2);
            var y0 = cej, y1 = Math.min(ch, cej + (ch * 0.22 | 0));
            var profile = [], y, xi, sum, cnt, py;
            for (py = y0; py < y1; py++) {
                sum = 0; cnt = 0;
                for (xi = cx - colW; xi <= cx + colW; xi++) {
                    if (xi >= 0 && xi < cw) { sum += gray[py * cw + xi]; cnt++; }
                }
                profile.push(cnt ? sum / cnt : 128);
            }
            if (profile.length < 8) continue;
            var minV = 1e9, minIdx = 0, pi;
            for (pi = 0; pi < profile.length; pi++) {
                if (profile[pi] < minV) { minV = profile[pi]; minIdx = pi; }
            }
            var crestY = y0 + minIdx;
            var distPx = Math.max(0, crestY - cej);
            if (distPx < 4) continue;
            lines.push({
                gap: i,
                cej: [cx / cw, cej / ch],
                crest: [cx / cw, crestY / ch],
                measurement_mm: Math.round((distPx / pxMm) * 100) / 100
            });
        }
        return lines.slice(0, 8);
    }

    function xrayAiLayerOverlap(anatomy, x, y, bw, bh) {
        var e = xrayAiMaskOverlap(anatomy.enamelMask, anatomy.cw, x, y, bw, bh);
        var d = xrayAiMaskOverlap(anatomy.dentinMask, anatomy.cw, x, y, bw, bh);
        var total = Math.max(e + d, 0.01);
        return { enamel: Math.round(100 * e / total), dentin: Math.round(100 * d / total) };
    }

    function xrayAiClassifyCariesPearl(layers, darkScore, ring, interprox, ch, pulpDist) {
        if (layers.dentin >= 28 || (layers.dentin >= 18 && pulpDist < ch * 0.12)) {
            var conf = 0.38 + Math.min(0.28, layers.dentin / 100 * 0.55) +
                Math.min(0.22, darkScore / 32) + Math.min(0.12, ring / 40);
            if (pulpDist < ch * 0.08) conf += 0.06;
            return { type: 'caries_progressed', conf: Math.min(0.94, conf) };
        }
        var conf = 0.40 + Math.min(0.26, layers.enamel / 100 * 0.45) +
            Math.min(0.22, darkScore / 35) + Math.min(0.14, interprox);
        return { type: 'caries_incipient', conf: Math.min(0.94, conf) };
    }

    function xrayAiIsBonyBackground(gray, anatomy, x, y, bw, bh) {
        var cx = x + (bw >> 1), cy = y + (bh >> 1);
        var toothFrac = xrayAiMaskOverlap(anatomy.toothMask, anatomy.cw, x, y, bw, bh);
        var crownFrac = xrayAiMaskOverlap(anatomy.crownMask, anatomy.cw, x, y, bw, bh);
        if (toothFrac >= 0.35 || crownFrac >= 0.30) return false;
        var dist = xrayAiDistToTooth(anatomy.toothMask, anatomy.cw, anatomy.ch, cx, cy);
        if (dist > Math.max(anatomy.cw, anatomy.ch) * 0.07) return true;
        var std = xrayAiLocalStd(gray, anatomy.cw, anatomy.ch, cx, cy, 4);
        var mean = xrayAiLocalMean(gray, anatomy.cw, anatomy.ch, cx, cy, 4);
        return std > 16 && mean > 75 && mean < 145 && toothFrac < 0.15;
    }

    function xrayAiFindingAllowed(f, anatomy, gray) {
        var cw = anatomy.cw, ch = anatomy.ch;
        var x = (f.x * cw) | 0, y = (f.y * ch) | 0;
        var bw = Math.max(1, (f.w * cw) | 0), bh = Math.max(1, (f.h * ch) | 0);
        var cx = x + (bw >> 1), cy = y + (bh >> 1);
        if (xrayAiIsBonyBackground(gray, anatomy, x, y, bw, bh)) return false;
        var toothFrac = xrayAiMaskOverlap(anatomy.toothMask, cw, x, y, bw, bh);
        var crownFrac = xrayAiMaskOverlap(anatomy.crownMask, cw, x, y, bw, bh);
        var pulpFrac = xrayAiMaskOverlap(anatomy.pulpMask, cw, x, y, bw, bh);
        var rootFrac = xrayAiMaskOverlap(anatomy.rootMask, cw, x, y, bw, bh);
        var t = f.type;
        if (t === 'caries_incipient' || t === 'caries_progressed') {
            var ip = xrayAiMaskOverlap(anatomy.interproxMask, cw, x, y, bw, bh) > 0.18;
            if (crownFrac < (ip ? 0.28 : 0.38) || pulpFrac > 0.48) return false;
            if (xrayAiRingContrast(gray, cw, ch, x, y, bw, bh, 5) < (ip ? 5 : 6.5)) return false;
            var toothHit = xrayAiToothForPoint(anatomy, cx, cy);
            if (toothHit) {
                var margin = Math.max(3, bh >> 1);
                if (cy < toothHit.crownY1 - margin || cy > toothHit.crownY2 + margin) return false;
            }
            return true;
        }
        if (t === 'periapical_radiolucency') {
            if (rootFrac < 0.35) return false;
            var col = null, i;
            for (i = 0; i < anatomy.teeth.length; i++) {
                if (cx >= anatomy.teeth[i].xLeft && cx <= anatomy.teeth[i].xRight) { col = anatomy.teeth[i]; break; }
            }
            if (col && cy < col.cejY) return false;
            return toothFrac >= 0.25 || rootFrac >= 0.40;
        }
        if (t.indexOf('bone_loss_') === 0) {
            return xrayAiMaskOverlap(anatomy.alveolarMask, cw, x, y, bw, bh) >= 0.40;
        }
        if (t === 'calculus' || t === 'restoration' || t === 'defective_margin') {
            return toothFrac >= 0.45;
        }
        return toothFrac >= 0.30;
    }

    function xrayAiFilterByAnatomy(findings, anatomy, gray) {
        return findings.filter(function (f) { return xrayAiFindingAllowed(f, anatomy, gray); });
    }

    function xrayAiLocalStd(gray, cw, ch, cx, cy, r) {
        var mean = xrayAiLocalMean(gray, cw, ch, cx, cy, r);
        var sum = 0, cnt = 0, x, y, d;
        for (y = Math.max(0, cy - r); y <= Math.min(ch - 1, cy + r); y++) {
            for (x = Math.max(0, cx - r); x <= Math.min(cw - 1, cx + r); x++) {
                d = gray[y * cw + x] - mean;
                sum += d * d;
                cnt++;
            }
        }
        return cnt ? Math.sqrt(sum / cnt) : 0;
    }

    function xrayAiRingContrast(gray, cw, ch, bx, by, bw, bh, pad) {
        pad = pad || 4;
        var x1 = Math.max(0, bx - pad), y1 = Math.max(0, by - pad);
        var x2 = Math.min(cw, bx + bw + pad), y2 = Math.min(ch, by + bh + pad);
        var roiSum = 0, roiCnt = 0, ringSum = 0, ringCnt = 0, x, y, idx;
        for (y = y1; y < y2; y++) {
            for (x = x1; x < x2; x++) {
                idx = y * cw + x;
                if (x >= bx && x < bx + bw && y >= by && y < by + bh) {
                    roiSum += gray[idx]; roiCnt++;
                } else {
                    ringSum += gray[idx]; ringCnt++;
                }
            }
        }
        if (!roiCnt || !ringCnt) return 0;
        return ringSum / ringCnt - roiSum / roiCnt;
    }

    function xrayAiInterproximalBoost(gray, cw, ch, cx, cy) {
        var colW = Math.max(3, Math.floor(cw / 48));
        var x1 = Math.max(0, cx - colW), x2 = Math.min(cw, cx + colW);
        var profile = [], y, x, sum, cnt;
        for (y = 0; y < ch; y++) {
            sum = 0; cnt = 0;
            for (x = x1; x < x2; x++) { sum += gray[y * cw + x]; cnt++; }
            profile.push(cnt ? sum / cnt : 128);
        }
        if (profile.length < 8) return 0;
        var localMin = profile[Math.min(cy, profile.length - 1)];
        var y0 = Math.max(0, cy - 20), y1 = Math.min(profile.length, cy + 20);
        var localMax = 0;
        for (y = y0; y < y1; y++) if (profile[y] > localMax) localMax = profile[y];
        return localMax > 0 ? Math.max(0, (localMax - localMin) / localMax) : 0;
    }

    function xrayAiIsPulpChamber(bx, by, bw, bh, cw, ch, area) {
        var cx = (bx + bw / 2) / cw, cy = (by + bh / 2) / ch;
        var rel = area / (cw * ch);
        if (cy > 0.55 || cy < 0.12 || rel < 0.004) return false;
        var aspect = bh / Math.max(bw, 1);
        return cx > 0.28 && cx < 0.72 && rel > 0.006 && aspect > 0.85 && aspect < 2.8;
    }

    function xrayAiScoreCaries(area, bw, bh, cy, meanVal, darkScore, ring, interprox, cw, ch) {
        var relArea = area / (cw * ch);
        var maxDim = Math.max(bw, bh);
        var conf;
        if (maxDim < cw * 0.055 && relArea < cw * ch * 0.0025) {
            conf = 0.32 + Math.min(0.28, darkScore / 35) + Math.min(0.22, ring / 45) +
                Math.min(0.12, interprox * 0.8) + (cy < 0.45 ? 0.08 : 0);
            return { type: 'caries_incipient', conf: Math.min(0.92, conf) };
        }
        conf = 0.30 + Math.min(0.30, darkScore / 30) + Math.min(0.25, ring / 40) +
            Math.min(0.10, interprox * 0.6) + (meanVal < 105 ? 0.06 : 0) +
            (relArea > cw * ch * 0.0008 ? 0.05 : 0);
        if (cy > 0.48 && bh > ch * 0.035) conf += 0.04;
        return { type: 'caries_progressed', conf: Math.min(0.94, conf) };
    }

    function xrayAiDetectCaries(gray, cw, ch, anatomy) {
        var findings = [];
        var win = Math.max(11, Math.floor(Math.min(cw, ch) / 36));
        if (win % 2 === 0) win++;
        var half = Math.floor(win / 2);
        var block = 4;
        var darkCells = [];
        var bx, by, x, y, cx, cy, localMean, val, darkScore, sum, cnt;

        for (by = half; by < ch - half - block; by += block) {
            for (bx = half; bx < cw - half - block; bx += block) {
                if (xrayAiMaskOverlap(anatomy.crownMask, cw, bx, by, block, block) < 0.45) continue;
                if (xrayAiMaskOverlap(anatomy.pulpMask, cw, bx, by, block, block) > 0.42) continue;
                cx = bx + block / 2;
                cy = by + block / 2;
                localMean = xrayAiLocalMean(gray, cw, ch, cx, cy, half);
                sum = 0; cnt = 0;
                for (y = by; y < by + block; y++) {
                    for (x = bx; x < bx + block; x++) { sum += gray[y * cw + x]; cnt++; }
                }
                val = sum / cnt;
                darkScore = localMean - val;
                if (darkScore < 6.5 || val > 130) continue;
                var ring = xrayAiRingContrast(gray, cw, ch, bx, by, block, block, Math.max(4, Math.floor(win / 3)));
                if (ring < 6) continue;
                var interprox = xrayAiMaskOverlap(anatomy.interproxMask, cw, bx, by, block, block) > 0.3 ? 0.35 : 0;
                darkCells.push({ bx: bx, by: by, val: val, darkScore: darkScore, ring: ring, interprox: interprox });
            }
        }

        var used = {};
        darkCells.sort(function (a, b) { return b.darkScore - a.darkScore; });
        darkCells.forEach(function (cell, ci) {
            if (used[ci]) return;
            var minX = cell.bx, minY = cell.by, maxX = cell.bx + block, maxY = cell.by + block;
            var dsSum = cell.darkScore, ringSum = cell.ring, ipSum = cell.interprox, valSum = cell.val, n = 1;
            used[ci] = true;
            var changed = true;
            while (changed) {
                changed = false;
                darkCells.forEach(function (other, oi) {
                    if (used[oi]) return;
                    if (Math.abs(other.bx - minX) <= block * 2 && Math.abs(other.by - minY) <= block * 2 &&
                        other.bx + block >= minX - block && other.by + block >= minY - block &&
                        other.bx <= maxX + block && other.by <= maxY + block) {
                        used[oi] = true;
                        minX = Math.min(minX, other.bx);
                        minY = Math.min(minY, other.by);
                        maxX = Math.max(maxX, other.bx + block);
                        maxY = Math.max(maxY, other.by + block);
                        dsSum += other.darkScore; ringSum += other.ring; ipSum += other.interprox;
                        valSum += other.val; n++;
                        changed = true;
                    }
                });
            }
            var bw = maxX - minX, bh = maxY - minY, area = bw * bh;
            if (area < 16 || area > cw * ch * 0.025) return;
            if (xrayAiMaskOverlap(anatomy.crownMask, cw, minX, minY, bw, bh) < 0.55) return;
            if (xrayAiMaskOverlap(anatomy.pulpMask, cw, minX, minY, bw, bh) > 0.40) return;
            var haloBright = xrayAiLocalMean(gray, cw, ch, minX + bw / 2, minY + bh / 2, 8);
            if (haloBright > 175) return;
            var layers = xrayAiLayerOverlap(anatomy, minX, minY, bw, bh);
            if (layers.enamel + layers.dentin < 15) return;
            var cls = xrayAiClassifyCariesPearl(layers, dsSum / n, ringSum / n, ipSum / n, ch, ch * 0.2);
            if (cls.conf < 0.42) return;
            findings.push({
                type: cls.type,
                x: minX / cw, y: minY / ch,
                w: Math.min(0.22, bw / cw), h: Math.min(0.22, bh / ch),
                confidence: cls.conf,
                enamel_pct: layers.enamel,
                dentin_pct: layers.dentin
            });
        });
        return findings;
    }

    function xrayAiDetectPeriapical(gray, cw, ch, anatomy) {
        var findings = [], block = 6, bx, by, x, y, sum, cnt, val, cy, t, i;
        if (!anatomy.teeth.length) return findings;
        anatomy.teeth.forEach(function (tooth) {
            for (by = tooth.cejY; by < Math.min(ch, tooth.yApex + (ch * 0.04 | 0)) - block; by += block) {
                for (bx = tooth.xLeft; bx < tooth.xRight - block; bx += block) {
                    if (xrayAiMaskOverlap(anatomy.rootMask, cw, bx, by, block, block) < 0.35) continue;
                    sum = 0; cnt = 0;
                    for (y = by; y < by + block; y++) {
                        for (x = bx; x < bx + block; x++) { sum += gray[y * cw + x]; cnt++; }
                    }
                    val = sum / cnt;
                    cy = by + block / 2;
                    if (val > 115 || cy < tooth.cejY + 4) continue;
                    var ring = xrayAiRingContrast(gray, cw, ch, bx, by, block, block, 5);
                    var conf = Math.min(0.92, 0.40 + (118 - val) / 118 * 0.30 + Math.min(0.18, ring / 45));
                    if (conf < 0.42) continue;
                    findings.push({
                        type: 'periapical_radiolucency',
                        x: bx / cw, y: by / ch,
                        w: block * 2.2 / cw, h: block * 2.2 / ch,
                        confidence: conf
                    });
                }
            }
        });
        return findings.slice(0, 3);
    }

    function xrayAiDetectBoneLoss(gray, cw, ch, anatomy) {
        var findings = [], gaps = [], i, g, cej, y0, y1, colW, cx, y, x, sum, cnt, profile, pi, minV, minI, peakV, drop, sev;
        for (i = 0; i < anatomy.teeth.length - 1; i++) {
            var gl = anatomy.teeth[i].xRight, gr = anatomy.teeth[i + 1].xLeft;
            if (gr - gl < 2) { var mid = (gl + gr) >> 1; gaps.push([Math.max(0, mid - 3), Math.min(cw - 1, mid + 3)]); }
            else gaps.push([gl, gr]);
        }
        gaps.forEach(function (gap) {
            cx = (gap[0] + gap[1]) >> 1;
            colW = Math.max(3, ((gap[1] - gap[0]) >> 1) + 2);
            cej = anatomy.cejCurve[gap[0]];
            for (x = gap[0]; x <= gap[1]; x++) if (anatomy.cejCurve[x] < cej) cej = anatomy.cejCurve[x];
            y0 = cej;
            y1 = Math.min(ch, cej + (ch * 0.20 | 0));
            profile = [];
            for (y = y0; y < y1; y++) {
                sum = 0; cnt = 0;
                for (x = cx - colW; x <= cx + colW; x++) {
                    if (x >= 0 && x < cw) { sum += gray[y * cw + x]; cnt++; }
                }
                profile.push(cnt ? sum / cnt : 128);
            }
            if (profile.length < 10) return;
            minV = 255; minI = 0; peakV = 0;
            for (pi = 0; pi < profile.length; pi++) {
                if (profile[pi] < minV) { minV = profile[pi]; minI = pi; }
                if (profile[pi] > peakV) peakV = profile[pi];
            }
            drop = peakV - minV;
            if (drop < 20) return;
            sev = drop / Math.max(peakV, 1);
            if (sev < 0.14) return;
            var btype2 = sev < 0.24 ? 'bone_loss_mild' : (sev < 0.34 ? 'bone_loss_moderate' : 'bone_loss_severe');
            var bconf2 = sev < 0.24 ? Math.min(0.78, 0.38 + sev) : (sev < 0.34 ? Math.min(0.84, 0.42 + sev) : Math.min(0.88, 0.46 + sev * 0.7));
            findings.push({
                type: btype2,
                x: (cx - colW) / cw,
                y: (y0 + minI) / ch,
                w: (colW * 2 + 1) / cw,
                h: Math.max(0.04, Math.min(0.12, drop / 255 * 0.45 + 0.04)),
                confidence: bconf2,
                measurement: Math.round(drop / 8 * 10) / 10
            });
        });
        return findings.slice(0, 4);
    }

    /**
     * Strips disease claims from heuristic output.
     *
     * The fallback path reaches conclusions like "progressed caries, 94%" from
     * nothing but local pixel darkness and contrast. Left in, it would assert
     * more, and more confidently, than the trained detector in the Python
     * service — which withholds these same classes because it scored too far
     * below clinical accuracy on them. Restorations and bone geometry survive:
     * radiopaque hardware and CEJ-to-crest distance are measurements rather
     * than diagnoses.
     */
    function xrayAiWithholdPathology(findings) {
        return (findings || []).filter(function (f) {
            return f && PATHOLOGY_TYPES.indexOf(f.type) === -1;
        });
    }

    function xrayAiAnalyzeClient(imgEl) {
        return new Promise(function (resolve) {
            setTimeout(function () {
                try {
                    var ex = xrayAiExtractGray(imgEl, 1024);
                    if (ex.error) { resolve({ findings: [], error: 'CORS' }); return; }
                    var gray = ex.gray, cw = ex.cw, ch = ex.ch;
                    var anatomy = xrayAiBuildAnatomy(gray, cw, ch);
                    var findings = [];
                    var block = 6;
                    var bx, by, x, y, sum, cnt, val, localContrast, cy, roiMean;

                    findings = findings.concat(xrayAiDetectCaries(gray, cw, ch, anatomy));
                    findings = findings.concat(xrayAiDetectPeriapical(gray, cw, ch, anatomy));
                    findings = findings.concat(xrayAiDetectBoneLoss(gray, cw, ch, anatomy));

                    for (by = 0; by < ch - block; by += block) {
                        for (bx = 0; bx < cw - block; bx += block) {
                            if (xrayAiMaskOverlap(anatomy.toothMask, cw, bx, by, block, block) < 0.50) continue;
                            sum = 0; cnt = 0;
                            for (y = by; y < by + block; y++) {
                                for (x = bx; x < bx + block; x++) { sum += gray[y * cw + x]; cnt++; }
                            }
                            val = sum / cnt;
                            localContrast = 0;
                            for (y = by; y < by + block; y++) {
                                for (x = bx; x < bx + block; x++) {
                                    localContrast += Math.abs(gray[y * cw + x] - val);
                                }
                            }
                            localContrast /= cnt;
                            cy = (by + block / 2) / ch;
                            if (val > 158 && localContrast > 12) {
                                var bconf = Math.min(0.90, 0.38 + (val - 158) / 97 * 0.38);
                                var cejY = anatomy.cejCurve[Math.min(cw - 1, bx + (block >> 1))] / ch;
                                var btype = (cy < cejY + 0.05 && block < cw * 0.06) ? 'calculus' : 'restoration';
                                if (bconf >= 0.40) {
                                    findings.push({
                                        type: btype,
                                        x: bx / cw, y: by / ch,
                                        w: Math.min(0.25, block * 2.5 / cw),
                                        h: Math.min(0.25, block * 2.5 / ch),
                                        confidence: bconf
                                    });
                                }
                            }
                        }
                    }

                    var gs = 4;
                    for (by = gs; by < ch - block - gs; by += block) {
                        for (bx = gs; bx < cw - block - gs; bx += block) {
                            if (xrayAiMaskOverlap(anatomy.toothMask, cw, bx, by, block, block) < 0.45) continue;
                            var gx = Math.abs(gray[by * cw + bx + gs] - gray[by * cw + bx - gs]);
                            var gy = Math.abs(gray[(by + gs) * cw + bx] - gray[(by - gs) * cw + bx]);
                            var grad = gx + gy;
                            roiMean = xrayAiLocalMean(gray, cw, ch, bx + block / 2, by + block / 2, 4);
                            if (grad > 55 && roiMean > 95 && roiMean < 200) {
                                findings.push({
                                    type: 'defective_margin',
                                    x: bx / cw, y: by / ch,
                                    w: block * 2 / cw, h: block * 2 / ch,
                                    confidence: Math.min(0.82, 0.32 + grad / 200 * 0.4)
                                });
                            }
                        }
                    }

                    findings = xrayAiFilterByAnatomy(
                        findings.map(xrayAiNormalizeFinding).filter(Boolean), anatomy, gray);
                    findings = xrayAiNms(findings, 0.42);
                    findings = xrayAiWithholdPathology(findings);
                    // Retain to the same low floor the service uses, so the
                    // confidence slider has range to work with on this path too.
                    findings = findings.filter(function (f) {
                        return f.confidence >= XRAY_AI_CONFIG.retainConfidence;
                    });
                    findings.sort(function (a, b) { return b.confidence - a.confidence; });
                    findings = findings.slice(0, XRAY_AI_CONFIG.maxFindings);
                    resolve({
                        findings: findings,
                        model: MODEL_VERSION + '-client',
                        anatomy_layers: xrayAiExportAnatomyLayers(anatomy, gray),
                        bone_measurements: xrayAiMeasureCejCrest(anatomy, gray),
                        width: cw,
                        height: ch
                    });
                } catch (err) {
                    resolve({ findings: [], error: String(err && err.message || err) });
                }
            }, 0);
        });
    }

    function xrayAiDrawPolygon(ctx, poly, rect) {
        ctx.beginPath();
        poly.forEach(function (pt, pi) {
            var c = xrayAiNormToCanvas(pt[0], pt[1], rect);
            if (pi === 0) ctx.moveTo(c[0], c[1]); else ctx.lineTo(c[0], c[1]);
        });
        ctx.closePath();
    }

    function xrayAiRenderAnatomyLayers(ctx, rect) {
        if (!xrayAiState.showAnatomyLayers || !xrayAiState.anatomyLayers.length) return;
        var drawOrder = ['dentin', 'pulp', 'restoration', 'enamel'];
        drawOrder.forEach(function (layerName) {
            xrayAiState.anatomyLayers.forEach(function (layer) {
                if (layer.layer !== layerName) return;
                if (xrayAiState.layerHidden[layer.layer]) return;
                if (!layer.polygon || layer.polygon.length < 3) return;
                var meta = ANATOMY_LAYER_META[layer.layer];
                if (!meta) return;
                ctx.save();
                xrayAiDrawPolygon(ctx, layer.polygon, rect);
                ctx.strokeStyle = meta.color;
                if (meta.strokeOnly) {
                    ctx.globalAlpha = 0.75;
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    ctx.restore();
                    return;
                }
                ctx.fillStyle = meta.color;
                ctx.globalAlpha = meta.alpha;
                ctx.fill('evenodd');
                ctx.globalAlpha = 0.45;
                ctx.lineWidth = 1;
                ctx.stroke();
                ctx.restore();
            });
        });
    }

    function xrayAiRenderBoneLines(ctx, rect) {
        if (!xrayAiState.showBoneLines) return;
        var boneGaps = xrayAiVisibleBoneGaps();
        var lines = (xrayAiState.boneMeasurements || []).filter(function (line) {
            return !(boneGaps && line.gap != null && !boneGaps[line.gap]);
        });
        lines.forEach(function (line) {
            if (!line.cej || !line.crest) return;
            var p1 = xrayAiNormToCanvas(line.cej[0], line.cej[1], rect);
            var p2 = xrayAiNormToCanvas(line.crest[0], line.crest[1], rect);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.92)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(p1[0], p1[1]);
            ctx.lineTo(p2[0], p2[1]);
            ctx.stroke();
            ctx.setLineDash([]);
            var mm = line.measurement_mm != null ? line.measurement_mm : line.measurement;
            if (mm == null) { ctx.restore(); return; }
            var label = mm + ' mm';
            ctx.font = 'bold 11px sans-serif';
            var tw = ctx.measureText(label).width + 10;
            var lx = p2[0] + 6, ly = (p1[1] + p2[1]) / 2 - 8;
            ctx.fillStyle = 'rgba(15,23,42,0.78)';
            ctx.fillRect(lx, ly, tw, 16);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, lx + 5, ly + 12);
            ctx.restore();
        });
        xrayAiState.findings.forEach(function (f, idx) {
            if (!xrayAiIsFindingVisible(idx, f)) return;
            if (!f.cej || !f.crest || f.measurement == null) return;
            if (lines.some(function (ln) {
                return ln.cej && Math.abs(ln.cej[0] - f.cej[0]) < 0.01 && Math.abs(ln.cej[1] - f.cej[1]) < 0.01;
            })) return;
            var b1 = xrayAiNormToCanvas(f.cej[0], f.cej[1], rect);
            var b2 = xrayAiNormToCanvas(f.crest[0], f.crest[1], rect);
            ctx.save();
            ctx.strokeStyle = 'rgba(255,255,255,0.75)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(b1[0], b1[1]);
            ctx.lineTo(b2[0], b2[1]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        });
    }

    function xrayAiDrawPearlTag(ctx, x, y, bw, bh, title, sub, color, canvasW, canvasH) {
        ctx.font = 'bold 11px sans-serif';
        var line2 = sub || '';
        var tw = Math.max(ctx.measureText(title).width, line2 ? ctx.measureText(line2).width : 0) + 12;
        var boxH = line2 ? 30 : 16;
        var bx = Math.max(4, Math.min(canvasW - tw - 4, x));
        var by = y + Math.max(8, bh || 8) + 4;
        if (by + boxH > canvasH - 4) by = Math.max(4, y - boxH - 4);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, tw, boxH);
        ctx.fillStyle = '#fff';
        ctx.fillText(title, bx + 6, by + 12);
        if (line2) {
            ctx.font = '10px sans-serif';
            ctx.fillText(line2, bx + 6, by + 24);
        }
        return { x: bx, y: by, w: tw, h: boxH };
    }

    // ── Overlay rendering (Pearl-style) ──────────────────────────
    function xrayAiSyncCanvasSize() {
        var aiCv = xrayAiG('xrayLbAiCanvas');
        var img = xrayAiG('xrayLbImg');
        if (!aiCv || !img || img.style.display === 'none') return;
        var w = (typeof lbLayoutBaseW === 'number' && lbLayoutBaseW > 0)
            ? lbLayoutBaseW : (img.offsetWidth || 800);
        var h = (typeof lbLayoutBaseH === 'number' && lbLayoutBaseH > 0)
            ? lbLayoutBaseH : (img.offsetHeight || 600);
        aiCv.width = Math.max(1, w);
        aiCv.height = Math.max(1, h);
        xrayAiRenderOverlays();
    }

    function xrayAiIsFindingVisible(idx, f) {
        if (!xrayAiState.showOverlays) return false;
        if (xrayAiState.hidden[idx]) return false;
        if (xrayAiState.categoryHidden[f.type]) return false;
        if (!xrayAiMeetsConfidence(f)) return false;
        return true;
    }

    function xrayAiRenderOverlays() {
        var aiCv = xrayAiG('xrayLbAiCanvas');
        if (!aiCv) return;
        var ctx = aiCv.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, aiCv.width, aiCv.height);
        if (!xrayAiState.showOverlays) return;
        var img = xrayAiG('xrayLbImg');
        var rect = xrayAiGetOverlayRect(img);

        xrayAiRenderAnatomyLayers(ctx, rect);
        xrayAiRenderBoneLines(ctx, rect);

        var canvasW = aiCv.width, canvasH = aiCv.height;
        var tagCount = 0;

        xrayAiState.findings.forEach(function (f, idx) {
            if (!xrayAiIsFindingVisible(idx, f)) return;
            var meta = FINDING_META[f.type] || FINDING_META.caries_progressed;
            var c0 = xrayAiNormToCanvas(f.x || 0, f.y || 0, rect);
            var c1 = xrayAiNormToCanvas((f.x || 0) + (f.w || 0.05), (f.y || 0) + (f.h || 0.05), rect);
            var x = c0[0], y = c0[1], bw = Math.max(1, c1[0] - c0[0]), bh = Math.max(1, c1[1] - c0[1]);
            var selected = idx === xrayAiState.selectedIdx;
            ctx.save();
            ctx.strokeStyle = meta.color;
            ctx.lineWidth = selected ? 3 : 2;
            if (f.polygon && f.polygon.length >= 3) {
                xrayAiDrawPolygon(ctx, f.polygon, rect);
                ctx.fillStyle = meta.color;
                ctx.globalAlpha = selected ? 0.42 : 0.28;
                ctx.fill('evenodd');
                ctx.globalAlpha = 1;
                ctx.stroke();
            } else if (meta.shape === 'fill' || meta.shape === 'band') {
                ctx.fillStyle = meta.color;
                ctx.globalAlpha = selected ? 0.35 : 0.22;
                ctx.fillRect(x, y, bw, bh);
                ctx.globalAlpha = 1;
                ctx.setLineDash([]);
                ctx.strokeRect(x, y, bw, bh);
            } else {
                ctx.setLineDash(selected ? [] : [5, 4]);
                ctx.strokeRect(x, y, bw, bh);
                ctx.setLineDash([]);
            }

            var isCaries = f.type === 'caries_incipient' || f.type === 'caries_progressed';
            var showTag = selected || (isCaries && tagCount < XRAY_AI_CONFIG.maxCanvasTags);
            if (isCaries && f.enamel_pct != null && f.dentin_pct != null && showTag) {
                xrayAiDrawPearlTag(ctx, x, y, bw, bh,
                    xrayAiTr('media.xrayAi.tag.caries'),
                    xrayAiTr('media.xrayAi.tag.enamelDentin', { E: f.enamel_pct, D: f.dentin_pct }),
                    meta.color, canvasW, canvasH);
                tagCount++;
            } else if (f.type === 'calculus' && selected) {
                xrayAiDrawPearlTag(ctx, x, y, bw, bh, xrayAiTr('media.xrayAi.tag.calculus'), null, meta.color, canvasW, canvasH);
            } else if (!isCaries && selected) {
                var label = xrayAiTr(meta.i18n);
                if (f.measurement != null) label += ' ' + f.measurement + 'mm';
                else label += ' ' + Math.round((f.confidence || 0) * 100) + '%';
                ctx.font = 'bold 11px sans-serif';
                var tw = ctx.measureText(label).width + 8;
                ctx.fillStyle = meta.color;
                ctx.fillRect(x, Math.max(4, y + bh + 4), tw, 15);
                ctx.fillStyle = '#fff';
                ctx.fillText(label, x + 4, Math.max(15, y + bh + 16));
            }
            ctx.restore();
        });
    }

    function xrayAiSetStatus(msg, kind) {
        var el = xrayAiG('xrayAiStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'xray-ai-status' + (kind ? ' xray-ai-status-' + kind : '');
    }

    function xrayAiInitCategoryFilters() {
        FINDING_TYPES_ORDER.forEach(function (t) {
            if (xrayAiState.categoryHidden[t] === undefined) xrayAiState.categoryHidden[t] = false;
        });
        ANATOMY_LAYER_ORDER.forEach(function (l) {
            if (xrayAiState.layerHidden[l] === undefined) {
                xrayAiState.layerHidden[l] = (l === 'enamel' || l === 'pulp' || l === 'restoration');
            }
        });
    }

    function xrayAiUpdateAnatomyLegend() {
        var el = xrayAiG('xrayAiAnatomyLegend');
        if (!el) return;
        if (!xrayAiState.anatomyLayers.length) {
            el.innerHTML = '';
            el.style.display = 'none';
            return;
        }
        el.style.display = '';
        el.innerHTML =
            '<div class="xray-ai-anatomy-head">' + xrayAiEsc(xrayAiTr('media.xrayAi.anatomyTitle')) + '</div>' +
            '<label class="xray-ai-anatomy-toggle"><input type="checkbox" id="xrayAiShowLayers"' +
                (xrayAiState.showAnatomyLayers ? ' checked' : '') + '> ' +
                xrayAiEsc(xrayAiTr('media.xrayAi.showLayers')) + '</label>' +
            '<label class="xray-ai-anatomy-toggle"><input type="checkbox" id="xrayAiShowBoneLines"' +
                (xrayAiState.showBoneLines ? ' checked' : '') + '> ' +
                xrayAiEsc(xrayAiTr('media.xrayAi.showBoneLines')) + '</label>' +
            '<div class="xray-ai-anatomy-chips">' +
            ANATOMY_LAYER_ORDER.map(function (layer) {
                var meta = ANATOMY_LAYER_META[layer];
                var on = !xrayAiState.layerHidden[layer];
                return '<label class="xray-ai-anatomy-chip' + (on ? '' : ' is-off') + '">' +
                    '<input type="checkbox" data-ai-layer="' + layer + '"' + (on ? ' checked' : '') + '>' +
                    '<span class="xray-ai-dot" style="background:' + meta.color + '"></span>' +
                    xrayAiEsc(xrayAiTr(meta.i18n)) + '</label>';
            }).join('') + '</div>';
        var showLayers = xrayAiG('xrayAiShowLayers');
        if (showLayers) showLayers.onchange = function () {
            xrayAiState.showAnatomyLayers = showLayers.checked;
            xrayAiRenderOverlays();
        };
        var showBone = xrayAiG('xrayAiShowBoneLines');
        if (showBone) showBone.onchange = function () {
            xrayAiState.showBoneLines = showBone.checked;
            xrayAiRenderOverlays();
        };
        el.querySelectorAll('[data-ai-layer]').forEach(function (inp) {
            inp.onchange = function () {
                xrayAiState.layerHidden[inp.getAttribute('data-ai-layer')] = !inp.checked;
                xrayAiRenderOverlays();
                xrayAiUpdateAnatomyLegend();
            };
        });
    }

    /**
     * Per-type counts of the findings currently above the confidence threshold.
     * Always recomputed rather than reusing the backend's summary, so the
     * summary chips and legend counts track the slider instead of reporting a
     * total the clinician cannot see on the image.
     */
    function xrayAiComputeSummary() {
        var s = {};
        xrayAiVisibleFindings().forEach(function (item) {
            s[item.f.type] = (s[item.f.type] || 0) + 1;
        });
        return s;
    }

    function xrayAiUpdateSummaryRow() {
        var el = xrayAiG('xrayAiSummary');
        if (!el) return;
        var summary = xrayAiComputeSummary();
        var total = xrayAiVisibleFindings().length;
        if (!total) {
            el.innerHTML = '';
            el.style.display = 'none';
            return;
        }
        el.style.display = '';
        var chips = FINDING_TYPES_ORDER.map(function (t) {
            var n = summary[t] || 0;
            if (!n) return '';
            var m = FINDING_META[t];
            var off = !!xrayAiState.categoryHidden[t];
            return '<button type="button" class="xray-ai-summary-chip' + (off ? ' is-off' : '') +
                '" data-ai-cat="' + t + '" style="--chip-color:' + m.color + '">' +
                '<span class="xray-ai-dot" style="background:' + m.color + '"></span>' +
                '<span class="xray-ai-summary-count">' + n + '</span>' +
                '<span class="xray-ai-summary-label">' + xrayAiEsc(xrayAiTr(m.i18n)) + '</span></button>';
        }).filter(Boolean).join('');
        el.innerHTML =
            '<div class="xray-ai-summary-head">' +
                xrayAiEsc(xrayAiTr('media.xrayAi.summaryTitle')) +
                ' <span class="xray-ai-summary-total">' +
                xrayAiEsc(xrayAiTr('media.xrayAi.summaryTotal', { N: total })) + '</span></div>' +
            '<div class="xray-ai-summary-chips">' + chips + '</div>';
        el.querySelectorAll('[data-ai-cat]').forEach(function (chip) {
            chip.addEventListener('click', function () {
                var t = chip.getAttribute('data-ai-cat');
                xrayAiState.categoryHidden[t] = !xrayAiState.categoryHidden[t];
                xrayAiRenderOverlays();
                xrayAiUpdatePanel();
            });
        });
    }

    /**
     * Gap keys of the bone-loss findings currently above the threshold, or null
     * when no finding carries a gap key (in which case measurements cannot be
     * matched to findings and are all shown).
     */
    function xrayAiVisibleBoneGaps() {
        var anyKeyed = false;
        var gaps = {};
        xrayAiState.findings.forEach(function (f) {
            if (!f.type || f.type.indexOf('bone_loss_') !== 0 || f.gap == null) return;
            anyKeyed = true;
            if (xrayAiMeetsConfidence(f)) gaps[f.gap] = true;
        });
        return anyKeyed ? gaps : null;
    }

    function xrayAiUpdateBoneMeasures() {
        var el = xrayAiG('xrayAiBoneMeasures');
        if (!el) return;
        var visibleGaps = xrayAiVisibleBoneGaps();
        var items = (xrayAiState.boneMeasurements || []).map(function (line, idx) {
            if (line.measurement_mm == null) return null;
            if (visibleGaps && line.gap != null && !visibleGaps[line.gap]) return null;
            return { mm: line.measurement_mm, gap: (line.gap != null ? line.gap + 1 : idx + 1) };
        }).filter(Boolean);
        if (!items.length) {
            xrayAiState.findings.forEach(function (f, idx) {
                if (f.type && f.type.indexOf('bone_loss_') === 0 && f.measurement != null &&
                    xrayAiMeetsConfidence(f)) {
                    items.push({ mm: f.measurement, gap: idx + 1, findingIdx: idx });
                }
            });
        }
        if (!items.length) {
            el.innerHTML = '';
            el.style.display = 'none';
            return;
        }
        el.style.display = '';
        el.innerHTML =
            '<div class="xray-ai-bone-head">' + xrayAiEsc(xrayAiTr('media.xrayAi.boneTitle')) + '</div>' +
            '<p class="xray-ai-bone-hint">' + xrayAiEsc(xrayAiTr('media.xrayAi.boneHintPearl')) + '</p>' +
            items.map(function (it) {
                return '<div class="xray-ai-bone-item">' +
                    '<span class="xray-ai-bone-label">' + xrayAiEsc(xrayAiTr('media.xrayAi.boneGap', { N: it.gap })) + '</span>' +
                    '<span class="xray-ai-bone-mm">' + it.mm + ' mm</span></div>';
            }).join('');
    }

    function xrayAiUpdateLegend() {
        var leg = xrayAiG('xrayAiLegend');
        if (!leg) return;
        var summary = xrayAiComputeSummary();
        leg.innerHTML = FINDING_TYPES_ORDER.map(function (t) {
            var m = FINDING_META[t];
            var on = !xrayAiState.categoryHidden[t];
            var cnt = summary[t] || 0;
            return '<label class="xray-ai-legend-item' + (on ? '' : ' is-off') + '">' +
                '<input type="checkbox" data-ai-cat="' + t + '"' + (on ? ' checked' : '') + '>' +
                '<span class="xray-ai-dot" style="background:' + m.color + '"></span>' +
                '<span>' + xrayAiEsc(xrayAiTr(m.i18n)) + '</span>' +
                (cnt ? '<span class="xray-ai-legend-count">' + cnt + '</span>' : '') +
                '</label>';
        }).join('');
        leg.querySelectorAll('[data-ai-cat]').forEach(function (inp) {
            inp.addEventListener('change', function () {
                xrayAiState.categoryHidden[inp.getAttribute('data-ai-cat')] = !inp.checked;
                xrayAiRenderOverlays();
                xrayAiUpdateLegend();
            });
        });
    }

    /**
     * Says out loud that the browser fallback does not look for disease, so a
     * result with no caries markings is not mistaken for a negative finding.
     */
    function xrayAiUpdateScopeNote() {
        var el = xrayAiG('xrayAiScopeNote');
        if (!el) return;
        var show = xrayAiState.lastSource === 'client';
        el.hidden = !show;
        el.textContent = show ? xrayAiTr('media.xrayAi.fallbackScope') : '';
    }

    function xrayAiUpdatePanel() {
        var list = xrayAiG('xrayAiFindingsList');
        var meta = xrayAiG('xrayAiRunMeta');
        var visible = xrayAiVisibleFindings();
        if (meta) {
            var src = xrayAiState.lastSource === 'api' ? xrayAiTr('media.xrayAi.sourceApi') :
                (xrayAiState.lastSource === 'client' ? xrayAiTr('media.xrayAi.sourceClient') : '');
            // Prefer the exact model id the service reported for this run;
            // fall back to the modality-appropriate constant (e.g. before the
            // first successful run, or for the client-side heuristic).
            var isPabwRun = (xrayAiState.modality === 'pabw' ||
                xrayAiState.modality === 'periapical' || xrayAiState.modality === 'bitewing');
            var isPanoRun = xrayAiState.modality === 'panoramic';
            var verLabel = xrayAiState.lastModel ||
                (isPabwRun ? xrayAiState.pabwModelId : (isPanoRun ? xrayAiState.panoModelId : MODEL_VERSION));
            meta.textContent = visible.length
                ? xrayAiTr('media.xrayAi.runMeta', { N: visible.length, SRC: src, VER: verLabel })
                : '';
            if (xrayAiState.modality) {
                var modKey = 'media.xrayAi.modality.' + xrayAiState.modality;
                var modLabel = xrayAiTr(modKey);
                if (modLabel && modLabel !== modKey) {
                    meta.textContent = (meta.textContent ? meta.textContent + ' · ' : '') + modLabel;
                }
            }
            // Say which caries engine produced the hints this run, so a trained
            // model and the classical fallback are never mistaken for each other.
            if (visible.length && xrayAiState.advisory && xrayAiState.advisory.caries &&
                visible.some(function (it) { return xrayAiIsCaries(it.f); })) {
                var cariesAdv = xrayAiState.advisory.caries;
                var cariesSrcKey = cariesAdv.indexOf('classical') === 0
                    ? 'media.xrayAi.cariesSourceClassical'
                    : (cariesAdv.indexOf('union') >= 0
                        ? 'media.xrayAi.cariesSourceUnion'
                        : 'media.xrayAi.cariesSourceTrained');
                meta.textContent += ' · ' + xrayAiTr(cariesSrcKey);
            }
        }
        xrayAiUpdateScopeNote();
        // The training-review entry point only makes sense when the local
        // service is up and accepting feedback for at least one of the two
        // models (panoramic or PA/bitewing train independently).
        var trainBtn = xrayAiG('xrayAiTrainOpenBtn');
        if (trainBtn) trainBtn.hidden = !(xrayAiState.feedbackEnabled || xrayAiState.pabwFeedbackEnabled);
        xrayAiUpdateLegend();
        xrayAiUpdateAnatomyLegend();
        xrayAiUpdateSummaryRow();
        xrayAiUpdateBoneMeasures();
        xrayAiSyncConfidenceControl();
        if (!list) return;
        if (!visible.length) {
            // Distinguish "nothing found" from "everything is below the slider",
            // otherwise a high threshold reads as a clean radiograph.
            var msg = xrayAiState.findings.length
                ? xrayAiTr('media.xrayAi.allBelowThreshold', {
                    N: xrayAiState.findings.length,
                    PCT: Math.round(xrayAiState.confidenceThreshold * 100)
                })
                : xrayAiTr('media.xrayAi.noFindings');
            list.innerHTML = '<div class="xray-ai-empty">' + xrayAiEsc(msg) + '</div>';
            return;
        }
        list.innerHTML = visible.map(function (item) {
            var f = item.f;
            var idx = item.idx;
            var fm = FINDING_META[f.type] || FINDING_META.caries_progressed;
            var hidden = !!xrayAiState.hidden[idx];
            var sel = idx === xrayAiState.selectedIdx;
            var extra = (f.enamel_pct != null && f.dentin_pct != null)
                ? (' · E' + f.enamel_pct + '% · D' + f.dentin_pct + '%')
                : (f.measurement != null ? (' · ~' + f.measurement + 'mm') : (' · ' + Math.round((f.confidence || 0) * 100) + '%'));
            return '<div class="xray-ai-finding-row">' +
                '<button type="button" class="xray-ai-finding-item' +
                (hidden ? ' is-hidden' : '') + (sel ? ' is-selected' : '') +
                '" data-ai-idx="' + idx + '">' +
                '<span class="xray-ai-dot" style="background:' + fm.color + '"></span>' +
                '<span class="xray-ai-finding-text">' + xrayAiEsc(xrayAiTr(fm.i18n)) + extra +
                xrayAiCariesBadgeHtml(f) + '</span></button>' +
                xrayAiFeedbackHtml(idx, f) +
                '</div>';
        }).join('');
        list.querySelectorAll('.xray-ai-finding-item[data-ai-idx]').forEach(function (btn) {
            btn.addEventListener('click', function (ev) {
                var i = parseInt(btn.getAttribute('data-ai-idx'), 10);
                if (ev.shiftKey) {
                    xrayAiState.hidden[i] = !xrayAiState.hidden[i];
                } else {
                    xrayAiState.selectedIdx = (xrayAiState.selectedIdx === i) ? -1 : i;
                }
                xrayAiRenderOverlays();
                xrayAiUpdatePanel();
            });
        });
        list.querySelectorAll('[data-ai-fb]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                xrayAiSendCariesFeedback(
                    parseInt(btn.getAttribute('data-ai-fbidx'), 10),
                    btn.getAttribute('data-ai-fb')
                );
            });
        });
    }

    /** True for a caries finding produced by the service this run. */
    function xrayAiIsCaries(f) {
        return f && typeof f.type === 'string' && f.type.indexOf('caries_') === 0;
    }

    /** Provenance chips shown inside a caries finding row. */
    function xrayAiCariesBadgeHtml(f) {
        if (!xrayAiIsCaries(f) || !f.screening) return '';
        var chips = '<span class="xray-ai-badge xray-ai-badge-screen" title="' +
            xrayAiEsc(xrayAiTr('media.xrayAi.screeningTip')) + '">' +
            xrayAiEsc(xrayAiTr('media.xrayAi.screeningBadge')) + '</span>';
        if (f.surface) {
            var key = 'media.xrayAi.surface.' + f.surface;
            var label = xrayAiTr(key);
            if (label === key) label = f.surface; // fall back to raw if untranslated
            chips += '<span class="xray-ai-badge">' + xrayAiEsc(label) + '</span>';
        }
        if (f.edj_crossing || (f.relay_flags && f.relay_flags.indexOf('edj_crossing') !== -1)) {
            chips += '<span class="xray-ai-badge" title="' +
                xrayAiEsc(xrayAiTr('media.xrayAi.edjCrossingTip')) + '">' +
                xrayAiEsc(xrayAiTr('media.xrayAi.edjCrossing')) + '</span>';
        }
        if (f.relay_flags && f.relay_flags.indexOf('near_restoration') !== -1) {
            chips += '<span class="xray-ai-badge xray-ai-badge-warn" title="' +
                xrayAiEsc(xrayAiTr('media.xrayAi.nearRestorationTip')) + '">' +
                xrayAiEsc(xrayAiTr('media.xrayAi.nearRestoration')) + '</span>';
        }
        return chips;
    }

    /** Confirm/reject controls, or a "recorded" note once a verdict was sent. */
    function xrayAiFeedbackHtml(idx, f) {
        if (!xrayAiIsCaries(f) || xrayAiState.lastSource !== 'api' || !xrayAiState.feedbackEnabled) {
            return '';
        }
        var given = xrayAiState.feedback[idx];
        if (given) {
            var k = given === 'confirm' ? 'media.xrayAi.fbRecordedConfirm' : 'media.xrayAi.fbRecordedReject';
            return '<span class="xray-ai-fb-done">' + xrayAiEsc(xrayAiTr(k)) + '</span>';
        }
        return '<span class="xray-ai-fb">' +
            '<button type="button" class="xray-ai-fb-btn xray-ai-fb-yes" data-ai-fb="confirm" data-ai-fbidx="' + idx + '" title="' +
            xrayAiEsc(xrayAiTr('media.xrayAi.fbConfirmTip')) + '">\u2713</button>' +
            '<button type="button" class="xray-ai-fb-btn xray-ai-fb-no" data-ai-fb="reject" data-ai-fbidx="' + idx + '" title="' +
            xrayAiEsc(xrayAiTr('media.xrayAi.fbRejectTip')) + '">\u2717</button>' +
            '</span>';
    }

    function xrayAiClearOverlays() {
        xrayAiState.findings = [];
        xrayAiState.anatomyLayers = [];
        xrayAiState.boneMeasurements = [];
        xrayAiState.hidden = {};
        xrayAiState.selectedIdx = -1;
        xrayAiState.lastSource = null;
        xrayAiState.lastRunAt = null;
        xrayAiInitCategoryFilters();
        var aiCv = xrayAiG('xrayLbAiCanvas');
        if (aiCv) aiCv.getContext('2d').clearRect(0, 0, aiCv.width, aiCv.height);
        xrayAiUpdatePanel();
        xrayAiSetStatus('');
    }

    function xrayAiToggleOverlays() {
        xrayAiState.showOverlays = !xrayAiState.showOverlays;
        var btn = xrayAiG('lbXrayAiToggleBtn');
        if (btn) btn.classList.toggle('lb-chrome-active', !xrayAiState.showOverlays);
        xrayAiRenderOverlays();
    }

    /** Reflect the current threshold on the slider without re-rendering. */
    function xrayAiSyncConfidenceControl() {
        var pct = Math.round(xrayAiState.confidenceThreshold * 100);
        var slider = xrayAiG('xrayAiConfidenceSlider');
        if (slider && String(slider.value) !== String(pct)) slider.value = pct;
        var out = xrayAiG('xrayAiConfidenceVal');
        if (out) out.textContent = pct + '%';
        var note = xrayAiG('xrayAiConfidenceNote');
        if (note) {
            var retained = xrayAiState.findings.length;
            var shown = xrayAiVisibleFindings().length;
            note.textContent = retained
                ? xrayAiTr('media.xrayAi.confidenceCount', { N: shown, T: retained })
                : '';
        }
    }

    /**
     * Filter the existing findings to a new confidence threshold. Purely
     * client-side: nothing is re-analyzed, so dragging the slider is instant.
     */
    function xrayAiSetConfidenceThreshold(val) {
        var pct = parseFloat(val);
        if (!isFinite(pct)) return;
        pct = Math.max(XRAY_AI_CONFIG.confidenceMinPct,
            Math.min(XRAY_AI_CONFIG.confidenceMaxPct, pct));
        xrayAiState.confidenceThreshold = pct / 100;
        try { localStorage.setItem(CONFIDENCE_KEY, String(pct / 100)); } catch (e) { /* private mode */ }
        // A finding hidden by the slider must not stay selected, or its detail
        // highlight would persist with nothing drawn for it.
        if (xrayAiState.selectedIdx >= 0) {
            var sel = xrayAiState.findings[xrayAiState.selectedIdx];
            if (!sel || !xrayAiMeetsConfidence(sel)) xrayAiState.selectedIdx = -1;
        }
        xrayAiRenderOverlays();
        xrayAiUpdatePanel();
    }

    function xrayAiImageReady(imgEl) {
        return !!(imgEl && imgEl.complete && (imgEl.naturalWidth || imgEl.width));
    }

    function xrayAiBareImageUrl(imgEl) {
        var src = imgEl && imgEl.src ? String(imgEl.src) : '';
        if (!src) return '';
        var bare = src.split('#')[0];
        bare = bare.replace(/([?&])_xr=[^&]*/g, '$1').replace(/[?&]$/, '');
        bare = bare.replace(/\?&/, '?').replace(/\?$/, '');
        return bare;
    }

    function xrayAiFindRecord() {
        if (typeof lbCurrentId === 'undefined' || !lbCurrentId) return null;
        if (typeof xrayFiltered === 'undefined' || !xrayFiltered) return null;
        var i;
        for (i = 0; i < xrayFiltered.length; i++) {
            if (xrayFiltered[i].id === lbCurrentId) return xrayFiltered[i];
        }
        return null;
    }

    /**
     * Classifies the X-ray currently open in the lightbox into one of the
     * two model families the service now runs: the full-arch panoramic model,
     * or the shared periapical/bitewing ("pabw") intraoral model. Falls back
     * to reading the live #lbType select (set while editing metadata) when
     * the filtered-list record isn't available yet. Returns null when the
     * type is something the service should auto-detect instead (CBCT, etc.).
     */
    function xrayAiCurrentXrayModality() {
        var rec = xrayAiFindRecord();
        var type = (rec && rec.xray_type) || '';
        if (!type) {
            var typeEl = xrayAiG('lbType');
            if (typeEl && typeEl.value) type = typeEl.value;
        }
        type = String(type || '').toLowerCase();
        if (type === 'panoramic') return 'panoramic';
        if (type === 'periapical' || type === 'bitewing') return 'pabw';
        return null;
    }

    function xrayAiFetchBlobFromCanvas(imgEl) {
        return new Promise(function (resolve, reject) {
            if (!xrayAiImageReady(imgEl)) {
                reject(new Error('image_not_ready'));
                return;
            }
            var off = document.createElement('canvas');
            off.width = imgEl.naturalWidth || imgEl.width || 800;
            off.height = imgEl.naturalHeight || imgEl.height || 600;
            try { off.getContext('2d').drawImage(imgEl, 0, 0); }
            catch (e) { reject(new Error('CORS')); return; }
            off.toBlob(function (blob) {
                if (blob && blob.size > 0) resolve(blob);
                else reject(new Error('blob'));
            }, 'image/jpeg', 0.92);
        });
    }

    function xrayAiFetchBlobDirect(imgEl) {
        return new Promise(function (resolve, reject) {
            var bare = xrayAiBareImageUrl(imgEl);
            if (/^https?:\/\//i.test(bare)) {
                fetch(bare, { mode: 'cors', credentials: 'omit', cache: 'no-store' }).then(function (r) {
                    if (!r.ok) throw new Error('img HTTP ' + r.status);
                    return r.blob();
                }).then(function (blob) {
                    if (blob && blob.size > 0) resolve(blob);
                    else throw new Error('empty_blob');
                }).catch(function () {
                    xrayAiFetchBlobFromCanvas(imgEl).then(resolve).catch(reject);
                });
                return;
            }
            xrayAiFetchBlobFromCanvas(imgEl).then(resolve).catch(reject);
        });
    }

    function xrayAiFetchBlobFromImg(imgEl) {
        return new Promise(function (resolve, reject) {
            if (!xrayAiImageReady(imgEl)) {
                reject(new Error('image_not_ready'));
                return;
            }
            var rec = xrayAiFindRecord();
            if (rec && typeof lbComposeMergeViaFetch === 'function') {
                lbComposeMergeViaFetch(rec, function (blob) {
                    if (blob && blob.size > 0) resolve(blob);
                    else xrayAiFetchBlobDirect(imgEl).then(resolve).catch(reject);
                });
                return;
            }
            xrayAiFetchBlobDirect(imgEl).then(resolve).catch(reject);
        });
    }

    function xrayAiCheckApiHealth() {
        return xrayAiFetchWithTimeout(XRAY_AI_CONFIG.apiUrl + '/health', { mode: 'cors' }, 5000)
            .then(function (r) {
                if (!r.ok) return false;
                return r.json().then(function (j) {
                    // Remember whether this service will accept training feedback,
                    // so the panel only offers the buttons when they will work.
                    // The two models train independently, so each has its own flag.
                    xrayAiState.feedbackEnabled = !!(j && j.caries_feedback && j.caries_feedback.enabled);
                    xrayAiState.pabwFeedbackEnabled = !!(j && j.pabw_feedback && j.pabw_feedback.enabled);
                    xrayAiState.panoModelId = (j && j.models && j.models.pano) || PANO_MODEL_VERSION;
                    xrayAiState.pabwModelId = (j && j.models && j.models.pabw) || PABW_MODEL_VERSION;
                    return true;
                }).catch(function () { return true; });
            })
            .catch(function () { return false; });
    }

    function xrayAiFetchWithTimeout(url, options, ms) {
        ms = ms || 90000;
        return new Promise(function (resolve, reject) {
            var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            var timer = setTimeout(function () {
                if (ctrl) ctrl.abort();
                reject(new Error('timeout'));
            }, ms);
            var opts = options || {};
            if (ctrl) opts.signal = ctrl.signal;
            fetch(url, opts).then(function (r) {
                clearTimeout(timer);
                resolve(r);
            }).catch(function (e) {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    function xrayAiAnalyzeApi(blob) {
        // Tell the service which of its two models to use. This is a hint,
        // not a guarantee — an unlabeled or CBCT/other image sends no
        // modality field at all, so the service falls back to its own
        // auto-detection.
        var modalityHint = xrayAiCurrentXrayModality();
        var fallbackModel = (modalityHint === 'pabw' ? PABW_MODEL_VERSION :
            (modalityHint === 'panoramic' ? PANO_MODEL_VERSION : MODEL_VERSION)) + '-api';
        return xrayAiFetchWithTimeout(XRAY_AI_CONFIG.apiUrl + '/analyze', {
            method: 'POST',
            body: (function () {
                var fd = new FormData();
                fd.append('file', blob, 'xray.jpg');
                if (modalityHint) fd.append('modality', modalityHint);
                return fd;
            })(),
            mode: 'cors'
        }, 120000).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (data) {
            return {
                findings: (data.findings || []).map(xrayAiNormalizeFinding).filter(Boolean),
                model: data.model || fallbackModel,
                summary: data.summary || null,
                backend: data.backend || null,
                advisory: data.advisory || null,
                modality: data.modality || (data.advisory && data.advisory.modality) || modalityHint || null,
                anatomy_layers: data.anatomy_layers || [],
                bone_measurements: data.bone_measurements || [],
                width: data.width || null,
                height: data.height || null
            };
        });
    }

    /**
     * Send a clinician verdict on a caries hint back to the service, where it
     * becomes a labelled training example (continual learning). Best-effort:
     * failures surface a status message but never disrupt review.
     */
    function xrayAiSendCariesFeedback(idx, verdict) {
        var f = xrayAiState.findings[idx];
        if (!f || !xrayAiIsCaries(f)) return;
        if (xrayAiState.lastSource !== 'api') return;
        // Each model has its own continual-training loop and its own enabled
        // flag, so which endpoint (and which flag) applies depends on which
        // model actually produced this run's findings.
        var mod = xrayAiState.modality || xrayAiCurrentXrayModality();
        var isPabw = (mod === 'pabw' || mod === 'periapical' || mod === 'bitewing');
        if (isPabw ? !xrayAiState.pabwFeedbackEnabled : !xrayAiState.feedbackEnabled) return;
        if (xrayAiState.feedback[idx]) return;
        var img = xrayAiG('xrayLbImg');
        if (!img) return;

        var feedbackUrl = XRAY_AI_CONFIG.apiUrl + (isPabw ? '/pabw/feedback' : '/feedback');
        var modelForFeedback = isPabw ? xrayAiState.pabwModelId : xrayAiState.panoModelId;

        xrayAiSetStatus(xrayAiTr('media.xrayAi.fbSending'), 'work');
        xrayAiFetchBlobFromImg(img).then(function (blob) {
            var fd = new FormData();
            fd.append('file', blob, 'xray.jpg');
            fd.append('verdict', verdict);
            fd.append('finding', JSON.stringify({
                type: f.type,
                box: { x: f.x, y: f.y, w: f.w, h: f.h },
                polygon: f.polygon || null,
                confidence: f.confidence,
                surface: f.surface || null,
                source: f.source || null
            }));
            if (xrayAiState.xrayId) fd.append('xray_id', String(xrayAiState.xrayId));
            if (typeof xrayPatientId !== 'undefined' && xrayPatientId) {
                fd.append('patient_ref', String(xrayPatientId));
            }
            if (typeof currentName === 'function') {
                try { fd.append('created_by', String(currentName() || '')); } catch (e) { /* optional */ }
            }
            fd.append('model_version', modelForFeedback || MODEL_VERSION);
            // Patient consent for retaining the image as training data is a PDPO
            // requirement; default off unless the deployment opts in explicitly.
            fd.append('consent', (typeof window !== 'undefined' && window.XRAY_AI_FEEDBACK_CONSENT === true) ? 'true' : 'false');
            return xrayAiFetchWithTimeout(feedbackUrl, {
                method: 'POST', body: fd, mode: 'cors'
            }, 30000);
        }).then(function (r) {
            if (!r) return;
            if (r.status === 403) {
                if (isPabw) xrayAiState.pabwFeedbackEnabled = false;
                else xrayAiState.feedbackEnabled = false;
                xrayAiSetStatus(xrayAiTr('media.xrayAi.fbDisabled'), 'bad');
                xrayAiUpdatePanel();
                return;
            }
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json().then(function () {
                xrayAiState.feedback[idx] = verdict;
                xrayAiSetStatus(xrayAiTr('media.xrayAi.fbThanks'), 'ok');
                xrayAiUpdatePanel();
            });
        }).catch(function (e) {
            xrayAiSetStatus(xrayAiTr('media.xrayAi.fbFailed', { MSG: (e && e.message) || 'error' }), 'bad');
        });
    }

    // ── Training review screen ─────────────────────────────────────
    // Lists the verdicts accumulated via the feedback buttons, shows whether
    // the machine is ready to retrain, and lets the operator kick off a
    // continual pass and watch the promote/reject decision. All state lives
    // on the service; this is a thin viewer.
    //
    // The panoramic and PA/bitewing models train completely independently
    // (separate datasets, separate weights, separate promote/reject
    // decisions), so the modal has one tab per model. Every function below
    // takes a `which` ('pano' | 'pabw') and reads/writes only that tab's DOM
    // elements and endpoint prefix — xrayAiTrainIds() and xrayAiTrainBase()
    // are the two lookup tables that make that possible.

    var xrayAiTrainPollTimer = null;

    /** Endpoint prefix for the given model's training API. */
    function xrayAiTrainBase(which) {
        return which === 'pabw' ? '/pabw' : '/caries';
    }

    /** DOM elements for the given tab's pane (pano reuses the original ids). */
    function xrayAiTrainIds(which) {
        var suffix = which === 'pabw' ? 'Pabw' : '';
        return {
            stats: xrayAiG('xrayAiTrainStats' + suffix),
            preflight: xrayAiG('xrayAiTrainPreflight' + suffix),
            runBtn: xrayAiG('xrayAiTrainRunBtn' + suffix),
            stateEl: xrayAiG('xrayAiTrainState' + suffix),
            logEl: xrayAiG('xrayAiTrainLog' + suffix),
            verdicts: xrayAiG('xrayAiTrainVerdicts' + suffix)
        };
    }

    function xrayAiSwitchTrainTab(which) {
        which = (which === 'pabw') ? 'pabw' : 'pano';
        xrayAiActiveTrainTab = which;
        var tabPano = xrayAiG('xrayAiTrainTabPano');
        var tabPabw = xrayAiG('xrayAiTrainTabPabw');
        var panePano = xrayAiG('xrayAiTrainPanePano');
        var panePabw = xrayAiG('xrayAiTrainPanePabw');
        if (tabPano) tabPano.classList.toggle('active', which === 'pano');
        if (tabPabw) tabPabw.classList.toggle('active', which === 'pabw');
        if (panePano) panePano.hidden = (which !== 'pano');
        if (panePabw) panePabw.hidden = (which !== 'pabw');
        if (xrayAiTrainPollTimer) {
            clearTimeout(xrayAiTrainPollTimer);
            xrayAiTrainPollTimer = null;
        }
        xrayAiLoadTrainingReview(which);
    }

    function xrayAiOpenTrainingReview() {
        var modal = xrayAiG('xrayAiTrainModal');
        if (!modal) return;
        modal.hidden = false;
        // Default to whichever model matches the X-ray currently open, when known.
        var mod = xrayAiCurrentXrayModality();
        xrayAiSwitchTrainTab(mod === 'pabw' ? 'pabw' : 'pano');
    }

    function xrayAiCloseTrainingReview() {
        var modal = xrayAiG('xrayAiTrainModal');
        if (modal) modal.hidden = true;
        if (xrayAiTrainPollTimer) {
            clearTimeout(xrayAiTrainPollTimer);
            xrayAiTrainPollTimer = null;
        }
    }

    function xrayAiLoadTrainingReview(which) {
        which = which || xrayAiActiveTrainTab;
        var ids = xrayAiTrainIds(which);
        if (ids.stats) ids.stats.textContent = xrayAiTr('media.xrayAi.train.loading');
        xrayAiFetchWithTimeout(XRAY_AI_CONFIG.apiUrl + xrayAiTrainBase(which) + '/dataset', { mode: 'cors' }, 10000)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                xrayAiRenderTrainStats(data.stats || {}, which);
                xrayAiRenderTrainPreflight(data.preflight || [], !!data.ready_to_train, data.training_enabled !== false, which);
                xrayAiRenderTrainVerdicts(data.recent || [], which);
                return xrayAiFetchTrainStatus(which);
            })
            .catch(function (e) {
                if (ids.stats) ids.stats.textContent = xrayAiTr('media.xrayAi.train.loadFailed', { MSG: (e && e.message) || 'error' });
            });
    }

    function xrayAiRenderTrainStats(s, which) {
        var ids = xrayAiTrainIds(which || xrayAiActiveTrainTab);
        if (!ids.stats) return;
        ids.stats.textContent = xrayAiTr('media.xrayAi.train.stats', {
            CONFIRM: s.confirm || 0,
            REJECT: s.reject || 0,
            IMAGES: s.images || 0
        });
    }

    function xrayAiRenderTrainPreflight(checks, ready, trainingEnabled, which) {
        var ids = xrayAiTrainIds(which || xrayAiActiveTrainTab);
        if (ids.preflight) {
            ids.preflight.innerHTML = checks.map(function (c) {
                var cls = c.ok ? 'ok' : (c.blocking ? 'bad' : 'warn');
                var mark = c.ok ? '✓' : (c.blocking ? '✗' : '!');
                return '<div class="xray-ai-train-check xray-ai-train-check-' + cls + '">' +
                    '<span class="xray-ai-train-mark">' + mark + '</span>' +
                    '<span>' + xrayAiEsc(c.detail || c.check) + '</span></div>';
            }).join('');
            if (!trainingEnabled) {
                ids.preflight.innerHTML += '<div class="xray-ai-train-check xray-ai-train-check-bad">' +
                    '<span class="xray-ai-train-mark">✗</span><span>' +
                    xrayAiEsc(xrayAiTr('media.xrayAi.train.disabled')) + '</span></div>';
            }
        }
        if (ids.runBtn) ids.runBtn.disabled = !(ready && trainingEnabled);
    }

    function xrayAiRenderTrainVerdicts(recent, which) {
        var ids = xrayAiTrainIds(which || xrayAiActiveTrainTab);
        var el = ids.verdicts;
        if (!el) return;
        if (!recent.length) {
            el.innerHTML = '<div class="xray-ai-train-empty">' +
                xrayAiEsc(xrayAiTr('media.xrayAi.train.noVerdicts')) + '</div>';
            return;
        }
        el.innerHTML = recent.map(function (v) {
            var verdictKey = v.verdict === 'reject'
                ? 'media.xrayAi.fbRecordedReject' : 'media.xrayAi.fbRecordedConfirm';
            var when = (v.ts || '').replace('T', ' ').slice(0, 16);
            var conf = (v.confidence != null) ? Math.round(v.confidence * 100) + '%' : '';
            var surface = v.surface ? xrayAiTr('media.xrayAi.surface.' + v.surface) : '';
            var typeLabel = (v.type && FINDING_META[v.type])
                ? xrayAiTr(FINDING_META[v.type].i18n) : (v.type || '');
            return '<div class="xray-ai-train-verdict xray-ai-train-verdict-' +
                (v.verdict === 'reject' ? 'no' : 'yes') + '">' +
                '<span class="xray-ai-train-verdict-mark">' + xrayAiEsc(xrayAiTr(verdictKey)) + '</span>' +
                '<span>' + xrayAiEsc([typeLabel, surface, conf].filter(Boolean).join(' · ')) + '</span>' +
                '<span class="xray-ai-train-verdict-when">' + xrayAiEsc(when) + '</span>' +
                '</div>';
        }).join('');
    }

    function xrayAiFetchTrainStatus(which) {
        which = which || xrayAiActiveTrainTab;
        return xrayAiFetchWithTimeout(XRAY_AI_CONFIG.apiUrl + xrayAiTrainBase(which) + '/train/status', { mode: 'cors' }, 10000)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (st) { return xrayAiRenderTrainStatus(st, which); })
            .catch(function () { /* status area simply stays as-is */ });
    }

    function xrayAiRenderTrainStatus(st, which) {
        which = which || xrayAiActiveTrainTab;
        st = st || {};
        var ids = xrayAiTrainIds(which);
        var running = st.state === 'running';

        if (ids.stateEl) {
            var text = '';
            if (running) {
                text = xrayAiTr('media.xrayAi.train.running');
            } else if (st.outcome === 'promoted') {
                text = xrayAiTr('media.xrayAi.train.promoted');
            } else if (st.outcome === 'rejected') {
                text = xrayAiTr('media.xrayAi.train.rejected');
            } else if (st.outcome === 'failed') {
                text = xrayAiTr('media.xrayAi.train.failed');
            } else if (st.message) {
                text = st.message;
            }
            ids.stateEl.textContent = text;
            ids.stateEl.className = 'xray-ai-train-state' +
                (running ? ' is-running' :
                    st.outcome === 'promoted' ? ' is-promoted' :
                    st.outcome === 'rejected' ? ' is-rejected' :
                    st.outcome === 'failed' ? ' is-failed' : '');
        }
        if (ids.logEl) {
            var tail = st.log_tail || '';
            ids.logEl.hidden = !tail;
            ids.logEl.textContent = tail;
            if (!ids.logEl.hidden) ids.logEl.scrollTop = ids.logEl.scrollHeight;
        }
        if (ids.runBtn && running) ids.runBtn.disabled = true;

        if (running) {
            if (xrayAiTrainPollTimer) clearTimeout(xrayAiTrainPollTimer);
            xrayAiTrainPollTimer = setTimeout(function () {
                var modal = xrayAiG('xrayAiTrainModal');
                // Only keep polling if this tab is still the one on screen.
                if (modal && !modal.hidden && xrayAiActiveTrainTab === which) xrayAiFetchTrainStatus(which);
            }, 5000);
        } else if (xrayAiTrainPollTimer) {
            clearTimeout(xrayAiTrainPollTimer);
            xrayAiTrainPollTimer = null;
            // A finished run can change readiness (e.g. new incumbent weights),
            // so refresh the preflight block once.
            xrayAiLoadTrainingReview(which);
        }
    }

    function xrayAiRunContinualTraining(which) {
        which = which || xrayAiActiveTrainTab;
        var ids = xrayAiTrainIds(which);
        if (ids.runBtn) ids.runBtn.disabled = true;
        if (ids.stateEl) ids.stateEl.textContent = xrayAiTr('media.xrayAi.train.starting');
        var fd = new FormData();
        fd.append('epochs', '40');
        fd.append('replay_frac', '0.5');
        xrayAiFetchWithTimeout(XRAY_AI_CONFIG.apiUrl + xrayAiTrainBase(which) + '/train', {
            method: 'POST', body: fd, mode: 'cors'
        }, 20000).then(function (r) {
            if (r.status === 403) throw new Error(xrayAiTr('media.xrayAi.train.disabled'));
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }).then(function (st) {
            xrayAiRenderTrainStatus(st, which);
            if (st && st.preflight) {
                xrayAiRenderTrainPreflight(st.preflight, st.state === 'running', true, which);
            }
        }).catch(function (e) {
            if (ids.stateEl) {
                ids.stateEl.textContent = xrayAiTr('media.xrayAi.train.startFailed', { MSG: (e && e.message) || 'error' });
                ids.stateEl.className = 'xray-ai-train-state is-failed';
            }
            if (ids.runBtn) ids.runBtn.disabled = false;
        });
    }

    function xrayAiPersistRun(findings, model) {
        if (typeof SB === 'undefined' || !SB.from || !xrayAiState.xrayId) return;
        try {
            SB.from('xray_ai_runs').insert([{
                xray_id: xrayAiState.xrayId,
                patient_id: (typeof xrayPatientId !== 'undefined') ? xrayPatientId : null,
                findings: findings,
                model_version: model || MODEL_VERSION,
                source: xrayAiState.lastSource,
                created_by: (typeof currentName === 'function') ? currentName() : null
            }]).then(function () { return null; }, function () { return null; });
        } catch (e) {
            /* optional audit table — never block overlay display */
        }
    }

    function xrayAiApplyResults(result, source) {
        result = result || {};
        var imgW = result.width || null;
        var imgH = result.height || null;
        // Retain down to the low floor, not the display threshold: the slider
        // can only reveal findings that were kept here in the first place.
        xrayAiState.findings = xrayAiDedupeFindings(
            (result.findings || [])
                .map(function (f) { return xrayAiFinalizeFinding(f, imgW, imgH); })
                .filter(function (f) { return f && (f.confidence || 0) >= XRAY_AI_CONFIG.retainConfidence; })
        ).slice(0, XRAY_AI_CONFIG.maxFindings);
        xrayAiState.hidden = {};
        xrayAiState.selectedIdx = -1;
        xrayAiState.feedback = {};
        xrayAiState.lastSource = source;
        xrayAiState.lastRunAt = new Date().toISOString();
        xrayAiState.backend = result.backend || null;
        xrayAiState.advisory = result.advisory || null;
        xrayAiState.modality = result.modality || (result.advisory && result.advisory.modality) || null;
        xrayAiState.lastModel = result.model || null;
        xrayAiState.analysisWidth = result.width || null;
        xrayAiState.analysisHeight = result.height || null;
        xrayAiState.anatomyLayers = xrayAiSanitizeLayers(
            result.anatomy_layers,
            xrayAiState.analysisWidth,
            xrayAiState.analysisHeight
        );
        xrayAiState.boneMeasurements = Array.isArray(result.bone_measurements) ? result.bone_measurements : [];
        xrayAiState.showOverlays = true;
        xrayAiState.showAnatomyLayers = true;
        xrayAiState.showBoneLines = true;
        xrayAiInitCategoryFilters();
        xrayAiSyncConfidenceControl();
        try { xrayAiSyncCanvasSize(); } catch (e1) { /* canvas optional */ }
        try { xrayAiUpdatePanel(); } catch (e2) { /* panel optional */ }
        var shown = xrayAiVisibleFindings().length;
        xrayAiSetStatus(shown
            ? xrayAiTr('media.xrayAi.done', { N: shown })
            : xrayAiTr('media.xrayAi.noFindingsShort'), 'ok');
        // The audit row records everything retained, not just what is on screen,
        // so a later review is not limited by where the slider happened to sit.
        xrayAiPersistRun(xrayAiState.findings, result.model);
    }

    function xrayAiRunAssist() {
        if (xrayAiState.running) return;
        if (typeof lbIsVideo !== 'undefined' && lbIsVideo) {
            alert(xrayAiTr('media.xrayAi.imagesOnly')); return;
        }
        var img = xrayAiG('xrayLbImg');
        if (!img || img.style.display === 'none' || !img.src) {
            alert(xrayAiTr('media.xrayAi.noImage')); return;
        }
        if (!xrayAiImageReady(img)) {
            alert(xrayAiTr('media.xrayAi.imageNotReady')); return;
        }
        xrayAiEnsureDisclaimer(function () {
            xrayAiState.running = true;
            xrayAiSetStatus(xrayAiTr('media.xrayAi.running'), 'work');
            var btn = xrayAiG('lbXrayAiBtn');
            if (btn) btn.disabled = true;
            var slowTimer = setTimeout(function () {
                if (xrayAiState.running) {
                    xrayAiSetStatus(xrayAiTr('media.xrayAi.runningSlow'), 'work');
                }
            }, 12000);

            function finish() {
                clearTimeout(slowTimer);
                xrayAiState.running = false;
                if (btn) btn.disabled = false;
            }

            function applySafe(res, source) {
                try {
                    if (!res || res.error) {
                        var errMsg = (res && res.error) ? String(res.error) : 'empty';
                        if (errMsg === 'CORS') {
                            xrayAiSetStatus(xrayAiTr('media.xrayAi.corsError'), 'bad');
                        } else if (errMsg === 'image_not_ready') {
                            xrayAiSetStatus(xrayAiTr('media.xrayAi.imageNotReady'), 'bad');
                        } else {
                            xrayAiSetStatus(xrayAiTr('media.xrayAi.errorApply', { MSG: errMsg }), 'bad');
                        }
                        finish();
                        return;
                    }
                    xrayAiApplyResults(res, source);
                } catch (e) {
                    console.error('[xray-ai] apply failed', e);
                    xrayAiSetStatus(xrayAiTr('media.xrayAi.errorApply', { MSG: (e && e.message) || 'unknown' }), 'bad');
                }
                finish();
            }

            function runClient(reason) {
                if (reason === 'api_down') {
                    xrayAiSetStatus(xrayAiTr('media.xrayAi.apiUnreachable'), 'work');
                } else if (reason) {
                    xrayAiSetStatus(xrayAiTr('media.xrayAi.fallbackClient'), 'work');
                }
                xrayAiAnalyzeClient(img).then(function (res) {
                    if (res.error === 'CORS') {
                        xrayAiSetStatus(xrayAiTr('media.xrayAi.corsError'), 'bad');
                        finish();
                        return;
                    }
                    applySafe(res, 'client');
                }).catch(function (e) {
                    console.error('[xray-ai] client failed', e);
                    xrayAiSetStatus(xrayAiTr('media.xrayAi.errorApply', { MSG: (e && e.message) || 'client' }), 'bad');
                    finish();
                });
            }

            if (!XRAY_AI_CONFIG.preferApi) { runClient(); return; }

            xrayAiCheckApiHealth().then(function (ok) {
                if (!ok) { runClient('api_down'); return; }
                xrayAiFetchBlobFromImg(img).then(xrayAiAnalyzeApi).then(function (res) {
                    applySafe(res, 'api');
                }).catch(function (err) {
                    console.warn('[xray-ai] api failed', err);
                    var msg = (err && err.message) || '';
                    if (msg === 'image_not_ready') {
                        xrayAiSetStatus(xrayAiTr('media.xrayAi.imageNotReady'), 'bad');
                        finish();
                        return;
                    }
                    if (msg.indexOf('HTTP ') === 0) {
                        xrayAiSetStatus(xrayAiTr('media.xrayAi.errorApply', { MSG: msg }), 'bad');
                        finish();
                        return;
                    }
                    runClient(msg === 'timeout' ? 'timeout' : 'api');
                });
            });
        });
    }

    function xrayAiOnLightboxOpen(xrayId) {
        xrayAiState.xrayId = xrayId || null;
        xrayAiClearOverlays();
        xrayAiInitCategoryFilters();
        var hide = typeof lbIsVideo !== 'undefined' && lbIsVideo;
        ['lbXrayAiBtn', 'lbXrayAiToggleBtn', 'xrayAiPanel'].forEach(function (id) {
            var el = xrayAiG(id);
            if (el) el.style.display = hide ? 'none' : '';
        });
        setTimeout(xrayAiSyncCanvasSize, 50);
    }

    function xrayAiOnLightboxClose() {
        xrayAiClearOverlays();
        xrayAiState.xrayId = null;
        xrayAiCloseTrainingReview();
    }

    xrayAiInitCategoryFilters();

    window.xrayAiRunAssist = xrayAiRunAssist;
    window.xrayAiClearFindings = xrayAiClearOverlays;
    window.xrayAiToggleOverlays = xrayAiToggleOverlays;
    window.xrayAiSetConfidenceThreshold = xrayAiSetConfidenceThreshold;
    window.xrayAiSendCariesFeedback = xrayAiSendCariesFeedback;
    window.xrayAiOpenTrainingReview = xrayAiOpenTrainingReview;
    window.xrayAiCloseTrainingReview = xrayAiCloseTrainingReview;
    window.xrayAiSwitchTrainTab = xrayAiSwitchTrainTab;
    window.xrayAiRunContinualTraining = xrayAiRunContinualTraining;
    window.xrayAiOnLightboxOpen = xrayAiOnLightboxOpen;
    window.xrayAiOnLightboxClose = xrayAiOnLightboxClose;
    window.xrayAiOnCanvasResize = xrayAiSyncCanvasSize;
    window.xrayAiSyncCanvasSize = xrayAiSyncCanvasSize;
})();
