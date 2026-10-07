(function () {
    var img = new Image();
    var filmEpoch = 0;
    var shownUrl = '';
    var pts = {};
    var sel = '';
    var drag = null;
    var mmPerPx = 0.1;
    var calibrated = false;
    var calMode = false;
    var calFirst = null;
    var ruler = null;
    var source = '';
    var ctxInfo = null;
    var fileName = 'ceph.png';
    var lastBox = null;
    var lastDetect = null;
    var touched = {};
    var setTouched = [{}, {}, {}];
    var sets = [];
    var setIndex = 0;
    var userPickedSet = false;
    var setBarHidden = true;
    var viewedSets = [false, false, false];
    var USE_TRAIN_KEY = 'banana.ceph.useTrain.v1';
    var useTraining = false;
    var NORM_KEY = 'banana.ceph.normSet.v1';
    var AGE_KEY = 'banana.ceph.ageBand.v1';
    var CVM_KEY = 'banana.ceph.cvm.v1';
    var SEX_KEY = 'banana.ceph.sexBand.v1';
    var TRACE_KEY = 'banana.ceph.savedTrace.v1';
    var TRACE_CH = 'banana.ceph.save.v1';
    var restoreHold = null;
    var restoreVia = '';
    var normSet = 'chinese';
    var ageBand = 'adult';
    var cvmStageN = 0;
    var cvmVia = '';
    var cvmAutoTried = false;
    var sexBand = '';

    function $(id) { return document.getElementById(id); }
    function canvas() { return $('view'); }
    function tx(key, vars) {
        return (window.CEPH_I18N && typeof CEPH_I18N.t === 'function') ? CEPH_I18N.t(key, vars) : key;
    }
    function ph(en) {
        if (en == null || en === '') return '';
        return (window.CEPH_I18N && typeof CEPH_I18N.phrase === 'function') ? CEPH_I18N.phrase(en) : String(en);
    }
    function phJoin(en) {
        if (!en) return '';
        var parts = Array.isArray(en) ? en : String(en).split(/\s*\+\s*|;\s*/);
        return parts.map(function (part) {
            return ph(String(part).replace(/\.\s*$/, '').trim());
        }).filter(Boolean).join(' · ');
    }
    function extractNoteTx(note) {
        if (!note) return '';
        var tail = tx('extract.disclaimer');
        var head = String(note).replace(/\s*Ceph only; crowding \/ Bolton \/ growth not assessed\. Not a treatment plan\.\s*$/, '');
        head = head.replace(/\.\s*$/, '');
        return (head ? phJoin(head) + '. ' : '') + tail;
    }
    function lmName(d) {
        var k = 'lm.' + d.id;
        var s = tx(k);
        return (s && s !== k) ? s : (d.name || d.id);
    }
    function extraName(d) {
        var k = 'extra.' + d.id;
        var s = tx(k);
        return (s && s !== k) ? s : (d.name || d.id);
    }
    function setLabelTx(s) {
        if (!s) return '';
        if ((s.id === 'lib1502' || s.id === 'lib1502all') &&
            (s.trainingSource || /training:/.test(String(s.source || '')))) {
            var plusKey = s.id === 'lib1502all' ? 'set.lib1502allplus' : 'set.lib1502plus';
            var plus = tx(plusKey);
            if (plus && plus !== plusKey) return plus;
        }
        var k = 'set.' + s.id;
        var t = tx(k);
        return (t && t !== k) ? t : (s.label || '');
    }
    function setChip(s) {
        var k = 'set.chip.' + (s && s.id ? s.id : 'unet');
        var t = tx(k);
        if (t && t !== k) return t;
        if (!s || s.id === 'unet') return 'UNet';
        if (s.id === 'lib1502all') return 'All';
        return '1502';
    }
    function groupTitleTx(en) {
        var map = {
            Steiner: 'g.steiner', Downs: 'g.downs', Tweed: 'g.tweed',
            Wits: 'g.wits', McNamara: 'g.mcnamara', Ricketts: 'g.ricketts',
            Jarabak: 'g.jarabak',
            'Soft tissue': 'g.soft',
            'Extraction index': 'g.extract',
            CVM: 'g.cvm'
        };
        return map[en] ? tx(map[en]) : en;
    }
    function extractBandTx(band) {
        var k = 'extract.' + String(band || '');
        var s = tx(k);
        return (s && s !== k) ? s : String(band || '');
    }

    function readCtx() {
        try { ctxInfo = JSON.parse(sessionStorage.getItem('banana.ceph.v1') || 'null'); } catch (e) { ctxInfo = null; }
        if (!ctxInfo) {
            try { ctxInfo = JSON.parse(localStorage.getItem('banana.ceph.v1') || 'null'); } catch (e2) { ctxInfo = null; }
        }
        try {
            var qx = new URLSearchParams(window.location.search).get('x');
            if (qx && ctxInfo && !ctxInfo.xrayId) ctxInfo.xrayId = qx;
            else if (qx && !ctxInfo) ctxInfo = { xrayId: qx };
        } catch (eQ) { /* ignore */ }
        try {
            if (window.opener && !window.opener.closed && typeof window.opener.xrayCephContext === 'function') {
                var live = window.opener.xrayCephContext();
                if (live && typeof live === 'object') {
                    // keep the strip film named by the open payload. A fresh context()
                    // call can fall back to the saved study and load both bitmaps.
                    if (ctxInfo && (ctxInfo.studyUrl || ctxInfo.xrayId || ctxInfo.viaStrip || ctxInfo.userPick)) {
                        if (!ctxInfo.patientId && live.patientId) ctxInfo.patientId = live.patientId;
                        if (!ctxInfo.patientNo && live.patientNo) ctxInfo.patientNo = live.patientNo;
                        if (!ctxInfo.name && live.name) ctxInfo.name = live.name;
                        if (!ctxInfo.en && live.en) ctxInfo.en = live.en;
                        ['cn', 'sex', 'dob', 'hkid', 'phone', 'mobile', 'email', 'taken'].forEach(function (k) {
                            if (live[k]) ctxInfo[k] = live[k];
                        });
                    } else ctxInfo = Object.assign({}, ctxInfo || {}, live);
                }
            }
            if (window.opener && !window.opener.closed && window.opener.xrayPatientId && ctxInfo && !ctxInfo.patientId) {
                ctxInfo.patientId = window.opener.xrayPatientId;
            }
        } catch (eO) { /* ignore */ }
        absorbChartDemo();
        var title = tx('ui.title');
        if (ctxInfo && ctxInfo.patientNo) title += ' · #' + ctxInfo.patientNo;
        if (ctxInfo && ctxInfo.name) title += ' · ' + ctxInfo.name;
        document.title = title;
        var bar = $('bananaCephBar');
        if (bar) {
            var who = (ctxInfo && (ctxInfo.name || ctxInfo.patientNo))
                ? (tx('bar.who') + ' ' + (ctxInfo.patientNo || '') + ' ' + (ctxInfo.name || '')).trim()
                : tx('st.noPatient');
            bar.textContent = tx('bar.line', { who: who });
        }
    }

    function absorbChartDemo() {
        var chart = null;
        try {
            if (window.opener && !window.opener.closed && window.opener.xrayPatientData) {
                var p = window.opener.xrayPatientData;
                var cn = String(p.chinese_name || '').trim();
                var enName = String(p.full_name || '').trim();
                chart = {
                    patientId: p.id || '',
                    patientNo: String(p.patient_no || '').trim(),
                    cn: cn,
                    en: enName,
                    name: cn || enName,
                    sex: String(p.sex || '').trim(),
                    dob: String(p.dob || '').trim(),
                    hkid: String(p.hkid || '').trim(),
                    phone: String(p.phone_number || p.phone || '').trim(),
                    mobile: String(p.mobile_phone || '').trim(),
                    email: String(p.email || '').trim()
                };
            }
        } catch (e) { chart = null; }
        if (chart && (chart.patientNo || chart.name || chart.hkid || chart.en)) {
            if (!ctxInfo) ctxInfo = {};
            ['patientId', 'patientNo', 'cn', 'en', 'name', 'sex', 'dob', 'hkid', 'phone', 'mobile', 'email'].forEach(function (k) {
                if (chart[k]) ctxInfo[k] = chart[k];
            });
        }
        if (ctxInfo && !ctxInfo.taken) {
            var taken = takenFromOpener(ctxInfo.xrayId);
            if (taken) ctxInfo.taken = taken;
        }
    }

    function takenFromOpener(xrayId) {
        if (!xrayId) return '';
        try {
            if (!window.opener || window.opener.closed) return '';
            var lists = [window.opener.xrayAllRecords, window.opener.xrayFiltered];
            var li, recs, i, r;
            for (li = 0; li < lists.length; li++) {
                recs = lists[li];
                if (!recs || !recs.length) continue;
                for (i = 0; i < recs.length; i++) {
                    r = recs[i];
                    if (r && String(r.id) === String(xrayId)) return String(r.taken_date || r.created_at || '');
                }
            }
        } catch (e) { /* ignore */ }
        return '';
    }

    function chartAgeYears(dob) {
        var m = String(dob || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        var born = new Date(+m[1], +m[2] - 1, +m[3]);
        if (isNaN(born.getTime())) return null;
        var today = new Date();
        var age = today.getFullYear() - born.getFullYear();
        var mo = today.getMonth() - born.getMonth();
        if (mo < 0 || (mo === 0 && today.getDate() < born.getDate())) age--;
        return age >= 0 ? age : null;
    }

    function fmtChartDate(iso) {
        var s = String(iso || '').trim();
        if (!s) return '';
        var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return m[3] + '/' + m[2] + '/' + m[1];
        var d = new Date(s);
        if (isNaN(d.getTime())) return s;
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function reportPatientGrid() {
        var p = ctxInfo || {};
        var cn = (p.cn != null && String(p.cn).trim()) ? String(p.cn).trim()
            : ((p.name && p.name !== p.en) ? String(p.name) : '');
        var enName = String(p.en || '').trim();
        if (!cn && p.name && !enName) cn = String(p.name);
        var su = String(p.sex || sexBand || '').trim().toUpperCase();
        var sexText = (su === 'M' || su === 'MALE') ? tx('pdf.male')
            : ((su === 'F' || su === 'FEMALE') ? tx('pdf.female') : '');
        var years = chartAgeYears(p.dob);
        var ageText = years == null ? '' : tx('pdf.ageY', { n: years });
        var phone = [p.phone, (p.mobile && p.mobile !== p.phone) ? p.mobile : ''].filter(Boolean).join(' · ');
        var now = new Date();
        function pad(n) { return (n < 10 ? '0' : '') + n; }
        var reportDate = fmtChartDate(now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()));
        var rows = [
            [tx('pdf.cn'), cn, tx('pdf.en'), enName],
            [tx('pdf.sex'), sexText, tx('pdf.age'), ageText],
            [tx('pdf.dob'), fmtChartDate(p.dob), tx('pdf.hkid'), String(p.hkid || '')],
            [tx('pdf.phone'), phone, tx('pdf.chart'), String(p.patientNo || '')],
            [tx('pdf.date'), reportDate, tx('pdf.filmDate'), fmtChartDate(p.taken)]
        ];
        if (p.email) rows.push([tx('pdf.email'), String(p.email), '', '']);
        return rows;
    }

    function setStatus(s) {
        var el = $('status');
        if (el) el.textContent = s || '';
    }

    function viewSize() {
        var c = canvas();
        var w = c.clientWidth || 800;
        var h = c.clientHeight || 600;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        return { w: c.width, h: c.height };
    }

    function fit() {
        var vs = viewSize();
        var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        var s = Math.min(vs.w / iw, vs.h / ih) * viewZoom;
        var ox = (vs.w - iw * s) / 2 + panX, oy = (vs.h - ih * s) / 2 + panY;
        return { s: s, ox: ox, oy: oy };
    }

    function filmCenter() {
        return { x: (img.naturalWidth || 1) / 2, y: (img.naturalHeight || 1) / 2 };
    }
    function fhRot() {
        if (!fhUp) return 0;
        var Po = pts.Po, Or = pts.Or;
        if (!Po || !Or || !isFinite(Po.x) || !isFinite(Po.y) || !isFinite(Or.x) || !isFinite(Or.y)) return 0;
        return -Math.atan2(Or.y - Po.y, Or.x - Po.x);
    }
    function rotAbout(p, ang) {
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return { x: 0, y: 0 };
        var c = filmCenter();
        var x = p.x - c.x, y = p.y - c.y;
        var cs = Math.cos(ang), sn = Math.sin(ang);
        return { x: c.x + x * cs - y * sn, y: c.y + x * sn + y * cs };
    }
    function toView(p) {
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return { x: 0, y: 0 };
        var f = fit();
        var q = rotAbout(p, fhRot());
        return { x: f.ox + q.x * f.s, y: f.oy + q.y * f.s };
    }
    function toImg(x, y) {
        var f = fit();
        var q = { x: (x - f.ox) / f.s, y: (y - f.oy) / f.s };
        return rotAbout(q, -fhRot());
    }

    var extra = {};
    var extraTouched = {};
    var EXTRA_DEFS = [
        { id: 'U1a', name: 'U1 apex', pair: 'U1' },
        { id: 'L1a', name: 'L1 apex', pair: 'L1' },
        { id: 'FopA', name: 'FOP anterior', pair: '' },
        { id: 'FopP', name: 'FOP posterior', pair: '' },
        { id: 'Pn', name: 'Pronasale', pair: 'Sn' }
    ];
    var viewZoom = 1;
    var panX = 0;
    var panY = 0;
    var panning = null;
    var invertFilm = false;
    var filmBright = 1;
    var filmContrast = 1;
    var fhUp = false;
    var hiMeasure = '';
    var labOpen = false;
    var qaIds = {};
    var WALK_IDS = ['Go', 'Po', 'Or', 'Ar', 'U1a', 'L1a', 'Pn'];
    var walkOn = false;
    var walkIdx = -1;
    var undoStack = [];
    var lastProfileN = 0;
    var overlayRec = null;
    var overlayMode = 'sn';
    var overlayMapped = null;
    function strokePath(ctx, ids, color, width) {
        var on = [];
        ids.forEach(function (id) {
            var p = loc(id);
            if (p) on.push(p);
        });
        if (on.length < 2) return 0;
        ctx.strokeStyle = color;
        ctx.lineWidth = width || 2;
        ctx.beginPath();
        var v0 = toView(on[0]);
        ctx.moveTo(v0.x, v0.y);
        on.slice(1).forEach(function (p) {
            var v = toView(p);
            ctx.lineTo(v.x, v.y);
        });
        ctx.stroke();
        return on.length - 1;
    }
    var HIGHLIGHT = {
        SNA: [['S', 'N'], ['N', 'A']],
        SNB: [['S', 'N'], ['N', 'B']],
        ANB: [['A', 'N'], ['N', 'B']],
        'SN–GoGn': [['S', 'N'], ['Go', 'Gn']],
        Interincisal: [['U1a', 'U1'], ['L1a', 'L1']],
        'U1–SN': [['U1a', 'U1'], ['S', 'N']],
        'U1–NA': [['U1a', 'U1'], ['N', 'A']],
        'U1–NA mm': [['N', 'A'], ['U1', 'A']],
        'L1–NB': [['L1a', 'L1'], ['N', 'B']],
        'L1–NB mm': [['N', 'B'], ['L1', 'B']],
        'U1–APog': [['U1a', 'U1'], ['A', 'Pog']],
        'U1–APog mm': [['A', 'Pog'], ['U1', 'A']],
        'L1–APog': [['L1a', 'L1'], ['A', 'Pog']],
        'L1–APog mm': [['A', 'Pog'], ['L1', 'A']],
        'Facial angle': [['Po', 'Or'], ['N', 'Pog']],
        'Angle of convexity': [['N', 'A'], ['A', 'Pog']],
        'Y-axis': [['Po', 'Or'], ['S', 'Gn']],
        'FH–MP': [['Po', 'Or'], ['Go', 'Me']],
        FMA: [['Po', 'Or'], ['Go', 'Me']],
        IMPA: [['L1a', 'L1'], ['Go', 'Me']],
        FMIA: [['Po', 'Or'], ['L1a', 'L1']],
        'AO–BO': [['FopA', 'FopP']],
        'A to N-perp': [['Po', 'Or'], ['N', 'A']],
        'Pog to N-perp': [['Po', 'Or'], ['N', 'Pog']],
        'ANS–Me': [['ANS', 'Me']],
        'N–Me': [['N', 'Me']],
        'S–Go': [['S', 'Go']],
        'Ar–Go': [['Ar', 'Go']],
        'Ls to Sn–PogS': [['Sn', 'PogS'], ['Ls', 'Sn']],
        'Li to Sn–PogS': [['Sn', 'PogS'], ['Li', 'Sn']],
        'Ls to E-line': [['Pn', 'PogS'], ['Ls', 'Pn']],
        'Li to E-line': [['Pn', 'PogS'], ['Li', 'Pn']],
        'N–S–Ar': [['N', 'S'], ['S', 'Ar']],
        'S–Ar–Go': [['S', 'Ar'], ['Ar', 'Go']],
        'Ar–Go–Me': [['Ar', 'Go'], ['Go', 'Me']],
        'Jarabak sum': [['N', 'S'], ['S', 'Ar'], ['Ar', 'Go'], ['Go', 'Me']],
        'PFH/AFH': [['S', 'Go'], ['N', 'Me']]
    };
    function loc(id) {
        var p = (pts && pts[id]) || extra[id] || null;
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
        return p;
    }
    var PLANES = [
        ['S', 'N'], ['Po', 'Or'], ['Go', 'Gn'], ['Go', 'Me'], ['N', 'Pog'],
        ['U1', 'L1'], ['A', 'B'], ['PNS', 'ANS'], ['S', 'Gn']
    ];

    function draw() {
        var c = canvas();
        var ctx = c.getContext('2d');
        var vs = viewSize();
        ctx.clearRect(0, 0, vs.w, vs.h);
        ctx.fillStyle = '#080b14';
        ctx.fillRect(0, 0, vs.w, vs.h);
        if (img.naturalWidth) {
            var f = fit();
            var dw = img.naturalWidth * f.s, dh = img.naturalHeight * f.s;
            var cx = f.ox + dw / 2, cy = f.oy + dh / 2;
            var filt = 'brightness(' + filmBright + ') contrast(' + filmContrast + ')';
            if (invertFilm) filt += ' invert(1) hue-rotate(180deg)';
            ctx.save();
            ctx.filter = filt;
            ctx.translate(cx, cy);
            ctx.rotate(fhRot());
            ctx.translate(-cx, -cy);
            ctx.drawImage(img, f.ox, f.oy, dw, dh);
            ctx.restore();
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(56,189,248,0.75)';
        PLANES.forEach(function (ab) {
            var a = loc(ab[0]), b = loc(ab[1]);
            if (!a || !b) return;
            var A = toView(a), B = toView(b);
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        });
        lastProfileN = strokePath(ctx, ['Pn', 'Sn', 'Ls', 'Li', 'PogS'], 'rgba(251,146,60,0.95)', 2.2);
        lastProfileN += strokePath(ctx, ['S', 'N'], 'rgba(125,211,252,0.95)', 2);
        lastProfileN += strokePath(ctx, ['Go', 'Me'], 'rgba(125,211,252,0.95)', 2);
        if (overlayMapped) {
            ctx.fillStyle = 'rgba(244,114,182,0.95)';
            Object.keys(overlayMapped).forEach(function (id) {
                var p = overlayMapped[id];
                if (!p || !isFinite(p.x)) return;
                var v = toView(p);
                ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, Math.PI * 2); ctx.fill();
            });
            var ovPath = ['Pn', 'Sn', 'Ls', 'Li', 'PogS'].map(function (id) { return overlayMapped[id]; }).filter(function (p) {
                return p && isFinite(p.x);
            });
            if (ovPath.length >= 2) {
                ctx.strokeStyle = 'rgba(244,114,182,0.9)';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                var v0 = toView(ovPath[0]);
                ctx.moveTo(v0.x, v0.y);
                ovPath.slice(1).forEach(function (p) {
                    var v = toView(p);
                    ctx.lineTo(v.x, v.y);
                });
                ctx.stroke();
            }
        }
        var hi = HIGHLIGHT[hiMeasure];
        if (hi) {
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2.6;
            hi.forEach(function (ab) {
                var a = loc(ab[0]), b = loc(ab[1]);
                if (!a || !b) return;
                var A = toView(a), Bv = toView(b);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bv.x, Bv.y); ctx.stroke();
            });
        }
        (CEPH_LM.defs() || []).forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            var v = toView(p);
            ctx.beginPath();
            ctx.fillStyle = d.id === sel ? '#facc15' : '#38bdf8';
            ctx.arc(v.x, v.y, d.id === sel ? 6 : 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fffbeb';
            ctx.font = '11px system-ui';
            ctx.fillText(d.id, v.x + 7, v.y - 6);
        });
        if (pts.U1 && pts.L1) {
            ctx.strokeStyle = 'rgba(196,181,253,0.85)';
            ctx.lineWidth = 1.6;
            [['U1', 'U1a'], ['L1', 'L1a']].forEach(function (ab) {
                var a = pts[ab[0]], b = extra[ab[1]];
                if (!a || !b) return;
                var A = toView(a), B = toView(b);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
            });
            if (extra.FopA && extra.FopP) {
                ctx.strokeStyle = 'rgba(249,168,212,0.9)';
                var Fa = toView(extra.FopA), Fb = toView(extra.FopP);
                ctx.beginPath(); ctx.moveTo(Fa.x, Fa.y); ctx.lineTo(Fb.x, Fb.y); ctx.stroke();
            }
        }
        EXTRA_DEFS.forEach(function (d) {
            var p = extra[d.id];
            if (!p) return;
            var v = toView(p);
            ctx.save();
            ctx.translate(v.x, v.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = d.id === sel ? '#facc15' : '#c4b5fd';
            ctx.fillRect(-4, -4, 8, 8);
            ctx.restore();
            ctx.fillStyle = '#fffbeb';
            ctx.font = '10px system-ui';
            ctx.fillText(d.id, v.x + 7, v.y - 6);
        });
        if (ruler && ruler.a && ruler.b) {
            var Ra = toView(ruler.a), Rb = toView(ruler.b);
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(Ra.x, Ra.y); ctx.lineTo(Rb.x, Rb.y); ctx.stroke();
            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 11px system-ui';
            ctx.fillText((ruler.mm || '') + ' mm', (Ra.x + Rb.x) / 2 + 6, (Ra.y + Rb.y) / 2);
        }
        if (calFirst) {
            var cf = toView(calFirst);
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.arc(cf.x, cf.y, 5, 0, Math.PI * 2); ctx.fill();
        }
    }

    function renderList() {
        var host = $('lmList');
        if (!host) return;
        host.innerHTML = CEPH_LM.defs().map(function (d) {
            var p = pts[d.id] || {};
            var mark = touched[d.id] ? ' is-touched' : '';
            if (qaIds[d.id]) mark += ' is-qa';
            if (walkOn && WALK_IDS[walkIdx] === d.id) mark += ' is-walk';
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + mark + '" data-id="' + d.id + '">' +
                '<span>' + d.i + '. ' + d.id + ' — ' + lmName(d) +
                (qaIds[d.id] ? ' ' + tx('tag.check') : '') +
                (touched[d.id] ? ' ' + tx('tag.moved') : '') + '</span>' +
                '<span>' + (p.x ? Math.round(p.x) + ',' + Math.round(p.y) : '—') + '</span></div>';
        }).join('');
        host.innerHTML += EXTRA_DEFS.map(function (d) {
            var p = extra[d.id] || {};
            var extraMark = extraTouched[d.id] ? ' is-touched' : '';
            if (walkOn && WALK_IDS[walkIdx] === d.id) extraMark += ' is-walk';
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + extraMark + '" data-id="' + d.id + '">' +
                '<span>' + d.id + ' — ' + extraName(d) + (extraTouched[d.id] ? ' ' + tx('tag.moved') : '') + '</span>' +
                '<span>' + (p.x ? Math.round(p.x) + ',' + Math.round(p.y) : '—') + '</span></div>';
        }).join('');
        host.querySelectorAll('.lm').forEach(function (el) {
            el.onclick = function () {
                sel = el.getAttribute('data-id');
                renderList();
                draw();
            };
        });
        renderLearn();
    }

    function placedIds() {
        return CEPH_LM.defs().map(function (d) { return d.id; }).filter(function (id) {
            var p = pts[id];
            return p && isFinite(p.x) && isFinite(p.y) && (p.x !== 0 || p.y !== 0);
        });
    }

    function publishedN() {
        if (window.CEPH_LM && typeof CEPH_LM.publishedStats === 'function') return CEPH_LM.publishedStats().films;
        return 1502;
    }

    function readNormSet() {
        try {
            var v = window.localStorage && localStorage.getItem(NORM_KEY);
            if (v === 'caucasian' || v === 'chinese') return v;
        } catch (e) { /* ignore */ }
        return 'chinese';
    }
    function writeNormSet(id) {
        normSet = (id === 'caucasian') ? 'caucasian' : 'chinese';
        try { if (window.localStorage) localStorage.setItem(NORM_KEY, normSet); } catch (e2) { /* ignore */ }
        syncNormBtn();
        renderAnalysis();
        setStatus(tx('st.norms', { label: tx(normSet === 'chinese' ? 'btn.normCn' : 'btn.normCauc') }));
        return normSet;
    }
    function writeAge(id) {
        ageBand = id === 'child' ? 'child' : 'adult';
        try { if (window.localStorage) localStorage.setItem(AGE_KEY, ageBand); } catch (e) { /* ignore */ }
        syncNormBtn();
        syncCvmBar();
        renderAnalysis();
        setStatus(tx('st.age', { label: tx(ageBand === 'child' ? 'btn.ageChild' : 'btn.ageAdult') }));
        if (ageBand === 'child') maybeAutoCvm();
        return ageBand;
    }
    function parseCvmN(raw) {
        if (window.CEPH_AN && typeof CEPH_AN.parseCvm === 'function') return CEPH_AN.parseCvm(raw);
        var n = parseInt(raw, 10);
        return (n >= 1 && n <= 6) ? n : 0;
    }
    function writeCvm(raw, via) {
        cvmStageN = parseCvmN(raw);
        cvmVia = cvmStageN ? (via || 'staff') : '';
        try { if (window.localStorage) localStorage.setItem(CVM_KEY, String(cvmStageN || '')); } catch (e) { /* ignore */ }
        syncCvmBar();
        renderAnalysis();
        var info = window.CEPH_AN && CEPH_AN.cvmStage ? CEPH_AN.cvmStage(cvmStageN) : null;
        var label = (info && info.id) ? info.id : tx('btn.cvmClear');
        setStatus(cvmVia === 'api' ? tx('st.cvmApi', { label: label }) : tx('st.cvm', { label: label }));
        return cvmStageN;
    }
    function cvmLandmarkSrc() {
        var unet = sets && sets[0];
        if (unet && unet.id === 'unet' && unet.pts && unet.pts.Pog) return unet.pts;
        return pts;
    }
    function cvmPtsPayload() {
        var src = cvmLandmarkSrc();
        var out = {};
        ['Po', 'Ar', 'Go', 'S', 'N', 'Pog'].forEach(function (id) {
            if (src[id] && isFinite(src[id].x) && isFinite(src[id].y)) out[id] = { x: src[id].x, y: src[id].y };
        });
        return out;
    }
    function pullCvmApi(opts) {
        if (!img.naturalWidth) return Promise.resolve({ ok: false, error: 'image' });
        if (!window.CEPH_LM || typeof CEPH_LM.detectCvmApi !== 'function') {
            return Promise.resolve({ ok: false, error: 'api' });
        }
        setStatus(tx('st.cvmRun'));
        var api = (window.XRAY_AI_API_URL || 'http://127.0.0.1:8877');
        var auto = !!(opts && opts.auto);
        return CEPH_LM.detectCvmApi(img, api, cvmPtsPayload()).then(function (j) {
            if (auto && cvmVia === 'staff' && cvmStageN) {
                return { ok: true, stage: cvmStageN, via: 'staff', skipped: true };
            }
            if (j && j.ok && j.stage) {
                writeCvm(j.stage, 'api');
                return { ok: true, stage: j.stage, via: 'api', roi: j.roi };
            }
            if (auto && cvmVia === 'staff' && cvmStageN) {
                return { ok: true, stage: cvmStageN, via: 'staff', skipped: true };
            }
            if (j && j.error === 'weights') setStatus(tx('st.cvmNeedWeights'));
            else setStatus(tx('st.cvmFail'));
            return { ok: false, error: (j && j.error) || 'cvm' };
        }, function (err) {
            if (auto && cvmVia === 'staff' && cvmStageN) {
                return { ok: true, stage: cvmStageN, via: 'staff', skipped: true };
            }
            var body = err && err.body;
            var detail = body && body.detail;
            var code = (detail && detail.error) || (err && err.message) || '';
            setStatus(/weights/.test(String(code)) ? tx('st.cvmNeedWeights') : tx('st.cvmFail'));
            return { ok: false, error: code || 'net' };
        });
    }
    function maybeAutoCvm() {
        if (ageBand !== 'child' || !img.naturalWidth || cvmStageN || cvmAutoTried) return;
        cvmAutoTried = true;
        pullCvmApi({ auto: true });
    }
    function cvmCommentTx(info) {
        if (!info) return '';
        if (info.commentKey) {
            var s = tx(info.commentKey);
            if (s && s !== info.commentKey) return s;
        }
        return info.comment || '';
    }
    function syncCvmBar() {
        var bar = $('cvmBar');
        if (bar) {
            if (ageBand === 'child') bar.classList.remove('is-hidden');
            else bar.classList.add('is-hidden');
        }
        var hint = $('cvmHint');
        var info = window.CEPH_AN && CEPH_AN.cvmStage ? CEPH_AN.cvmStage(cvmStageN) : null;
        if (hint) hint.textContent = cvmCommentTx(info) || tx('cvm.need');
        var group = $('cvmGroup');
        if (!group) return;
        group.querySelectorAll('button[data-cvm]').forEach(function (btn) {
            var v = btn.getAttribute('data-cvm');
            var on = (v === '' && !cvmStageN) || (parseCvmN(v) === cvmStageN && cvmStageN);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            if (on) btn.classList.add('is-on');
            else btn.classList.remove('is-on');
        });
    }
    function writeSex(id) {
        sexBand = (id === 'f' || id === 'm') ? id : '';
        try { if (window.localStorage) localStorage.setItem(SEX_KEY, sexBand); } catch (e) { /* ignore */ }
        syncNormBtn();
        renderAnalysis();
        setStatus(tx('st.sex', { label: tx(sexBand === 'f' ? 'btn.sexF' : (sexBand === 'm' ? 'btn.sexM' : 'btn.sexU')) }));
        return sexBand;
    }
    function syncNormBtn() {
        var cauc = $('btnNormCauc');
        var cn = $('btnNormCn');
        var src = $('normSource');
        var pack = window.CEPH_AN && CEPH_AN.applyDemo
            ? CEPH_AN.applyDemo(CEPH_AN.getSet(normSet), ageBand, sexBand)
            : (window.CEPH_AN && CEPH_AN.getSet ? CEPH_AN.getSet(normSet) : null);
        [[cauc, normSet === 'caucasian'], [cn, normSet === 'chinese']].forEach(function (pair) {
            var btn = pair[0];
            if (!btn) return;
            btn.setAttribute('aria-pressed', pair[1] ? 'true' : 'false');
            if (pair[1]) btn.classList.add('is-on');
            else btn.classList.remove('is-on');
        });
        [['btnAgeAdult', ageBand === 'adult'], ['btnAgeChild', ageBand === 'child'],
            ['btnSexM', sexBand === 'm'], ['btnSexF', sexBand === 'f']].forEach(function (pair) {
            var btn = $(pair[0]);
            if (!btn) return;
            btn.setAttribute('aria-pressed', pair[1] ? 'true' : 'false');
            btn.classList.toggle('is-on', pair[1]);
        });
        if (src && pack) src.textContent = pack.source || tx('norm.src.' + normSet) || '';
    }

    function readUseTraining() {
        try {
            return !!(window.localStorage && localStorage.getItem(USE_TRAIN_KEY) === '1');
        } catch (e) {
            return false;
        }
    }

    function writeUseTraining(on) {
        useTraining = !!on;
        try {
            if (window.localStorage) localStorage.setItem(USE_TRAIN_KEY, useTraining ? '1' : '0');
        } catch (e) { /* private mode */ }
        syncUseTrainBtn();
        renderLearn();
        return useTraining;
    }

    function syncUseTrainBtn() {
        var pairs = [
            [$('btnRefPub'), !useTraining],
            [$('btnRefPlus'), useTraining]
        ];
        pairs.forEach(function (pair) {
            var btn = pair[0];
            if (!btn) return;
            var on = pair[1];
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            if (on) btn.classList.add('is-on');
            else btn.classList.remove('is-on');
        });
        if ($('btnRefPub')) $('btnRefPub').textContent = tx('btn.refPub');
    }

    function setRefMode(onPlus) {
        var st = (window.CEPH_LEARN && CEPH_LEARN.stats) ? CEPH_LEARN.stats() : { films: 0 };
        writeUseTraining(!!onPlus);
        if (useTraining && !st.films) {
            setStatus(tx('st.plusEmpty'));
        } else if (useTraining) {
            setStatus(tx('st.plusRef', { n: st.films }));
        } else {
            setStatus(tx('st.pubOnly'));
        }
        if (img.naturalWidth) runDetect();
        return useTraining;
    }

    function renderLearn() {
        var nEl = $('learnCount');
        var filmsEl = $('learnFilms');
        var pubEl = $('pubCount');
        var st = (window.CEPH_LEARN && CEPH_LEARN.stats) ? CEPH_LEARN.stats() : { films: 0, points: 0 };
        if (pubEl) pubEl.textContent = String(publishedN());
        if (filmsEl) filmsEl.textContent = String(st.films);
        if (nEl) {
            nEl.textContent = tx('learn.line', {
                n: st.films,
                p: st.points,
                ref: useTraining ? tx('learn.plus') : tx('learn.pub')
            });
        }
    }

    function includeSelected() {
        if (!window.CEPH_LEARN) return { ok: false, error: 'learn' };
        if (!img.naturalWidth) { setStatus(tx('st.loadFirst')); return { ok: false }; }
        var picked = placedIds();
        if (!picked.length) { setStatus(tx('st.learnNone')); return { ok: false, error: 'none' }; }
        var box = lastBox || (CEPH_LM.findHeadBox ? CEPH_LM.findHeadBox(img) : null);
        var out = CEPH_LEARN.includeSelected({
            pts: pts,
            box: box,
            fileName: fileName,
            patientNo: ctxInfo && ctxInfo.patientNo,
            setId: sets[setIndex] && sets[setIndex].id,
            setLabel: sets[setIndex] && sets[setIndex].label
        });
        if (!out.ok) { setStatus(tx('st.learnFail')); return out; }
        setStatus(tx('st.learnAdded', {
            n: out.included.length,
            label: sets[setIndex] ? (', ' + setLabelTx(sets[setIndex])) : '',
            films: out.films
        }));
        renderLearn();
        if (out.trace && typeof CEPH_LEARN.postRemote === 'function') {
            CEPH_LEARN.postRemote(out.trace);
        }
        return out;
    }

    function renderAnalysis() {
        var host = $('tables');
        if (!host || typeof CEPH_AN === 'undefined') return;
        var res = CEPH_AN.run(pts, mmPerPx, { normSet: normSet, calibrated: calibrated, extra: extra, age: ageBand, sex: sexBand, cvm: cvmStageN });
        host.innerHTML = res.groups.map(function (g) {
            return '<h2>' + groupTitleTx(g.title) + '</h2><table><tr><th>' + tx('th.measure') + '</th><th>' +
                tx('th.value') + '</th><th>' + tx('th.delta') + '</th><th>' + tx('th.norm') + '</th><th></th></tr>' +
                g.rows.map(function (r) {
                    var cls = r.band ? (' class="band-' + r.band + '"') : '';
                    var delta = r.delta == null ? '' : ((r.delta > 0 ? '+' : '') + r.delta);
                    return '<tr' + cls + ' data-measure="' + r.name + '"><td>' + r.name + '</td><td>' +
                        (r.value == null ? '—' : r.value + ' ' + r.unit) +
                        '</td><td class="delta">' + delta + '</td><td>' + (r.norm || '') + '</td><td>' +
                        (r.name === 'Extraction index' ? extractNoteTx(r.note) : ph(r.note || '')) + '</td></tr>';
                }).join('') + '</table>';
        }).join('');
        host.querySelectorAll('tr[data-measure]').forEach(function (tr) {
            if (tr.getAttribute('data-measure') === hiMeasure) tr.classList.add('is-hi');
            tr.onclick = function () {
                hiMeasure = tr.getAttribute('data-measure') || '';
                renderAnalysis();
                draw();
            };
        });
        window.__cephLast = { result: res, pts: pts, source: source, fileName: fileName, ctx: ctxInfo };
        var sum = $('summary');
        if (sum && res.summary) {
            var s = res.summary;
            var chips = [
                [tx('sum.skeletal'), ph(s.skeletal)],
                [tx('sum.vertical'), ph(s.vertical)],
                [tx('sum.profile'), ph(s.profile)],
                [tx('sum.incisor'), ph(s.incisor) + ' · ' + tx('sum.lip') + ' ' + ph(s.lip)]
            ];
            if (s.cvm || s.cvmComment) {
                chips.push([tx('sum.cvm'), ph(s.cvm || tx('btn.cvmClear')) + (s.cvmComment ? ' · ' + ph(cvmCommentTx({ comment: s.cvmComment, commentKey: s.cvmKey })) : '')]);
            }
            if (s.extraction) {
                var scoreBit = String(s.extraction).replace(/^[A-Za-z\-]+\s+/, '');
                var whyBits = (s.extractionReasons && s.extractionReasons.length)
                    ? s.extractionReasons
                    : s.extractionWhy;
                chips.push([tx('sum.extract'), extractBandTx(s.extractionBand) + ' ' + scoreBit +
                    (whyBits ? ' · ' + phJoin(whyBits) : '') +
                    ' · <a class="extract-notes" href="extraction.html?v=20261005fx53" target="_blank">' + tx('sum.notes') + '</a>']);
            }
            sum.innerHTML = chips.map(function (pair) {
                var isExtract = pair[0] === tx('sum.extract');
                var isCvm = pair[0] === tx('sum.cvm');
                var cls = isExtract && s.extractionBand ? ('summary-extract is-' + s.extractionBand) : (isCvm ? 'summary-cvm' : '');
                var title = (isExtract && s.extractionNote) ? (' title="' + extractNoteTx(s.extractionNote).replace(/"/g, '') + '"') : '';
                return '<div' + (cls ? ' class="' + cls + '"' : '') + title + '><div class="k">' + pair[0] + '</div><div class="v">' + pair[1] + '</div></div>';
            }).join('');
            var notes = sum.querySelector('a.extract-notes');
            if (notes) notes.onclick = openExtractNotes;
        }
    }

    function highlightMeasure(name) {
        hiMeasure = name || '';
        renderAnalysis();
        draw();
        return { ok: true, measure: hiMeasure, planes: HIGHLIGHT[hiMeasure] || [] };
    }
    function isExtraId(id) {
        return EXTRA_DEFS.some(function (d) { return d.id === id; });
    }
    function cloneUndo() {
        return {
            pts: JSON.parse(JSON.stringify(pts)),
            extra: JSON.parse(JSON.stringify(extra)),
            touched: JSON.parse(JSON.stringify(touched)),
            extraTouched: JSON.parse(JSON.stringify(extraTouched))
        };
    }
    function pushUndo() {
        try { undoStack.push(cloneUndo()); } catch (e) { return; }
        if (undoStack.length > 40) undoStack.shift();
    }
    function clearUndo() { undoStack = []; }
    function undoMove() {
        var s = undoStack.pop();
        if (!s) { setStatus(tx('st.nothingUndo')); return { ok: false }; }
        pts = s.pts || pts;
        extra = s.extra || extra;
        if (s.touched) {
            touched = s.touched;
            if (sets[setIndex]) setTouched[setIndex] = touched;
        }
        if (s.extraTouched) extraTouched = s.extraTouched;
        if (sets[setIndex]) sets[setIndex].pts = pts;
        refresh();
        setStatus(tx('st.undid'));
        return { ok: true, n: undoStack.length };
    }
    function setPointAt(id, imgPt, record) {
        if (!id || !imgPt || !isFinite(imgPt.x) || !isFinite(imgPt.y)) return { ok: false };
        if (record) pushUndo();
        if (isExtraId(id)) {
            extra[id] = { x: imgPt.x, y: imgPt.y };
            extraTouched[id] = true;
        } else {
            pts[id] = { x: imgPt.x, y: imgPt.y };
            touched[id] = true;
            if (sets[setIndex]) sets[setIndex].pts = pts;
        }
        sel = id;
        refresh();
        return { ok: true, id: id, x: imgPt.x, y: imgPt.y };
    }
    function resetView() {
        viewZoom = 1;
        panX = 0;
        panY = 0;
        draw();
        return { ok: true, zoom: viewZoom };
    }
    function setInvert(on) {
        invertFilm = !!on;
        if ($('btnInvert')) {
            $('btnInvert').classList.toggle('is-on', invertFilm);
            $('btnInvert').setAttribute('aria-pressed', invertFilm ? 'true' : 'false');
        }
        draw();
        return invertFilm;
    }
    function setFilmLook(opts) {
        opts = opts || {};
        if (opts.bright != null) filmBright = Math.max(0.3, Math.min(2.5, Number(opts.bright) || 1));
        if (opts.contrast != null) filmContrast = Math.max(0.3, Math.min(2.5, Number(opts.contrast) || 1));
        if ($('filmBright')) $('filmBright').value = String(filmBright);
        if ($('filmContrast')) $('filmContrast').value = String(filmContrast);
        draw();
        return { bright: filmBright, contrast: filmContrast, fhUp: !!fhUp };
    }
    function setFhUp(on) {
        fhUp = !!on;
        if ($('btnFhUp')) {
            $('btnFhUp').classList.toggle('is-on', fhUp);
            $('btnFhUp').setAttribute('aria-pressed', fhUp ? 'true' : 'false');
        }
        draw();
        return { ok: true, fhUp: fhUp, rotDeg: Math.round(fhRot() * 1800 / Math.PI) / 10 };
    }
    function overlayAnchor(mode, src) {
        src = src || {};
        if (mode === 'fh') return { a: src.Po, b: src.Or };
        if (mode === 'pp') return { a: src.ANS, b: src.PNS };
        return { a: src.S, b: src.N };
    }
    function mapOverlayPts(srcPts, mode) {
        if (!srcPts) return null;
        var live = overlayAnchor(mode, pts);
        var other = overlayAnchor(mode, srcPts);
        if (!live.a || !live.b || !other.a || !other.b) return srcPts;
        if (!isFinite(live.a.x) || !isFinite(other.a.x) || !isFinite(live.b.x) || !isFinite(other.b.x)) return srcPts;
        var rot = Math.atan2(live.b.y - live.a.y, live.b.x - live.a.x) -
            Math.atan2(other.b.y - other.a.y, other.b.x - other.a.x);
        var cs = Math.cos(rot), sn = Math.sin(rot);
        var out = {}, k;
        for (k in srcPts) {
            if (!Object.prototype.hasOwnProperty.call(srcPts, k) || !srcPts[k]) continue;
            var p = srcPts[k];
            if (!isFinite(p.x) || !isFinite(p.y)) continue;
            var x = p.x - other.a.x, y = p.y - other.a.y;
            out[k] = { x: live.a.x + x * cs - y * sn, y: live.a.y + x * sn + y * cs };
        }
        return out;
    }
    function refreshOverlay() {
        overlayMapped = overlayRec && overlayRec.pts ? mapOverlayPts(overlayRec.pts, overlayMode) : null;
        ['btnOverlaySn', 'btnOverlayFh', 'btnOverlayPp'].forEach(function (id) {
            var el = $(id);
            if (!el) return;
            var on = (id === 'btnOverlaySn' && overlayMode === 'sn') ||
                (id === 'btnOverlayFh' && overlayMode === 'fh') ||
                (id === 'btnOverlayPp' && overlayMode === 'pp');
            el.classList.toggle('is-on', !!(overlayMapped && on));
            el.setAttribute('aria-pressed', overlayMapped && on ? 'true' : 'false');
        });
        draw();
        return overlayMapped;
    }
    function setOverlay(rec) {
        if (!rec || !rec.pts) {
            overlayRec = null;
            overlayMapped = null;
            refreshOverlay();
            setStatus(tx('st.overlayOff'));
            return { ok: false };
        }
        overlayRec = { pts: rec.pts, extra: rec.extra || {}, label: rec.fileName || rec.label || 'prior' };
        refreshOverlay();
        setStatus(tx('st.overlayOn', { mode: overlayMode, n: Object.keys(overlayMapped || {}).length }));
        return { ok: true, n: Object.keys(overlayMapped || {}).length, mode: overlayMode };
    }
    function setOverlayMode(mode) {
        overlayMode = (mode === 'fh' || mode === 'pp') ? mode : 'sn';
        refreshOverlay();
        return { ok: true, mode: overlayMode, n: overlayMapped ? Object.keys(overlayMapped).length : 0 };
    }
    function traceStoreKey() {
        var p = (ctxInfo && (ctxInfo.patientNo || ctxInfo.patientId)) || 'anon';
        var x = (ctxInfo && ctxInfo.xrayId) || fileName || 'film';
        return String(p) + ':' + String(x);
    }
    function readTraceStore() {
        try {
            var raw = window.localStorage && localStorage.getItem(TRACE_KEY);
            var db = raw ? JSON.parse(raw) : {};
            return db && typeof db === 'object' ? db : {};
        } catch (e) { return {}; }
    }
    function findStoredTrace() {
        var db = readTraceStore();
        var id = ctxInfo && ctxInfo.xrayId ? String(ctxInfo.xrayId) : '';
        var rec = db[traceStoreKey()];
        if (isTrace(rec)) return rec;
        var k;
        for (k in db) {
            if (!Object.prototype.hasOwnProperty.call(db, k)) continue;
            rec = db[k];
            if (!isTrace(rec)) continue;
            if (id && String(rec.xrayId) === id) return rec;
            if (fileName && rec.fileName === fileName) return rec;
        }
        return null;
    }
    function traceForThisFilm(rec, fromCtx) {
        if (!isTrace(rec)) return false;
        if (!ctxInfo || (!ctxInfo.viaStrip && !ctxInfo.userPick)) return true;
        var id = ctxInfo.xrayId ? String(ctxInfo.xrayId) : '';
        var a = rec.xrayId ? String(rec.xrayId) : '';
        var b = rec.cephXrayId ? String(rec.cephXrayId) : '';
        if (!id) return !!fromCtx;
        if (!a && !b) return !!fromCtx;
        return a === id || b === id;
    }
    function pendingTrace() {
        if (ctxInfo && isTrace(ctxInfo.tracing) && traceForThisFilm(ctxInfo.tracing, true)) {
            return { rec: ctxInfo.tracing, via: ctxInfo.tracingVia === 'local' ? 'local' : 'cloud' };
        }
        var rec = findStoredTrace();
        if (isTrace(rec) && traceForThisFilm(rec, false)) return { rec: rec, via: 'local' };
        return null;
    }
    function syncLoadBtn() {
        var btn = $('btnLoadTrace');
        if (!btn) return;
        var on = !!pendingTrace();
        btn.disabled = !on;
        btn.setAttribute('aria-disabled', on ? 'false' : 'true');
    }
    function openerSb() {
        try {
            if (window.opener && !window.opener.closed && window.opener.SB) return window.opener.SB;
        } catch (e) { /* ignore */ }
        return null;
    }
    function applyCloudTrace(t) {
        if (!isTrace(t)) return null;
        if (ctxInfo) {
            ctxInfo.tracing = t;
            ctxInfo.tracingVia = 'cloud';
            if (t.cephSaveId) ctxInfo.cephSaveId = t.cephSaveId;
            if (t.cephXrayId) ctxInfo.cephXrayId = t.cephXrayId;
            // keep the strip film. A saved fileUrl is a second bitmap.
            if (t.fileUrl && !ctxInfo.studyUrl && !shownUrl && !ctxInfo.viaStrip && !ctxInfo.userPick) {
                ctxInfo.studyUrl = t.fileUrl;
            }
        }
        return t;
    }
    function pullCloudTrace() {
        var id = ctxInfo && ctxInfo.xrayId;
        var gen = filmEpoch;
        function still() { return gen === filmEpoch; }
        function noteSaveUrl(url) {
            if (!still() || !ctxInfo || !url) return;
            if (ctxInfo.studyUrl || shownUrl || ctxInfo.viaStrip || ctxInfo.userPick) return;
            ctxInfo.studyUrl = url;
        }
        function fromLatest() {
            if (!still()) return Promise.resolve(null);
            if (ctxInfo && (ctxInfo.viaStrip || ctxInfo.userPick)) return Promise.resolve(null);
            try {
                if (window.opener && !window.opener.closed && typeof window.opener.xrayCephFetchLatestForPatient === 'function' && ctxInfo && ctxInfo.patientId) {
                    return Promise.resolve(window.opener.xrayCephFetchLatestForPatient(ctxInfo.patientId)).then(function (save) {
                        if (!still()) return null;
                        if (save && isTrace(save.tracing)) {
                            applyCloudTrace(save.tracing);
                            if (ctxInfo && save.id) ctxInfo.cephSaveId = save.id;
                            noteSaveUrl(save.file_url);
                            if (ctxInfo && save.source_xray_id && !ctxInfo.xrayId) ctxInfo.xrayId = save.source_xray_id;
                            return save.tracing;
                        }
                        return null;
                    }, function () { return null; });
                }
            } catch (eP) { /* ignore */ }
            return Promise.resolve(null);
        }
        function orLatest(t) {
            if (!still()) return Promise.resolve(null);
            return isTrace(t) ? t : fromLatest();
        }
        if (!id) return fromLatest();
        try {
            if (window.opener && !window.opener.closed) {
                if (typeof window.opener.xrayCephFetchSave === 'function') {
                    return Promise.resolve(window.opener.xrayCephFetchSave(id)).then(function (save) {
                        if (!still()) return null;
                        if (save && isTrace(save.tracing)) {
                            applyCloudTrace(save.tracing);
                            if (ctxInfo && save.id) ctxInfo.cephSaveId = save.id;
                            noteSaveUrl(save.file_url);
                            return save.tracing;
                        }
                        if (typeof window.opener.xrayCephFetchTracing === 'function') {
                            return Promise.resolve(window.opener.xrayCephFetchTracing(id)).then(function (t) {
                                if (!still()) return null;
                                return orLatest(applyCloudTrace(t));
                            }, fromLatest);
                        }
                        return fromLatest();
                    }, fromLatest);
                }
                if (typeof window.opener.xrayCephFetchTracing === 'function') {
                    return Promise.resolve(window.opener.xrayCephFetchTracing(id)).then(function (t) {
                        if (!still()) return null;
                        return orLatest(applyCloudTrace(t));
                    }, fromLatest);
                }
            }
        } catch (e) { /* ignore */ }
        var sb = openerSb();
        if (!sb) return fromLatest();
        return Promise.resolve(sb.from('ceph_saves').select('id,file_url,tracing').eq('source_xray_id', id).limit(1)).then(function (r) {
            if (!still()) return null;
            var row = r && r.data && (Array.isArray(r.data) ? r.data[0] : r.data);
            if (row && isTrace(row.tracing)) {
                if (row.id) row.tracing.cephSaveId = row.id;
                if (row.file_url) row.tracing.fileUrl = row.file_url;
                return applyCloudTrace(row.tracing);
            }
            return Promise.resolve(sb.from('xrays').select('ceph_tracing').eq('id', id).limit(1)).then(function (r2) {
                if (!still()) return null;
                var row2 = r2 && r2.data && (Array.isArray(r2.data) ? r2.data[0] : r2.data);
                return orLatest(applyCloudTrace(row2 && row2.ceph_tracing));
            }, fromLatest);
        }, function () {
            return Promise.resolve(sb.from('xrays').select('ceph_tracing').eq('id', id).limit(1)).then(function (r2) {
                if (!still()) return null;
                var row2 = r2 && r2.data && (Array.isArray(r2.data) ? r2.data[0] : r2.data);
                return orLatest(applyCloudTrace(row2 && row2.ceph_tracing));
            }, fromLatest);
        });
    }
    function clonePts(o) {
        var out = {}, k;
        if (!o) return out;
        for (k in o) {
            if (!Object.prototype.hasOwnProperty.call(o, k) || !o[k]) continue;
            if (isFinite(o[k].x) && isFinite(o[k].y)) out[k] = { x: o[k].x, y: o[k].y };
        }
        return out;
    }
    function isTrace(rec) {
        if (!rec || typeof rec !== 'object' || !rec.pts) return false;
        var k;
        for (k in rec.pts) {
            if (!Object.prototype.hasOwnProperty.call(rec.pts, k)) continue;
            var p = rec.pts[k];
            if (p && isFinite(p.x) && isFinite(p.y) && (p.x !== 0 || p.y !== 0)) return true;
        }
        return false;
    }
    function applyTraceRec(rec, via, opt) {
        opt = opt || {};
        if (!isTrace(rec)) return { ok: false };
        pts = clonePts(rec.pts);
        extra = rec.extra && typeof rec.extra === 'object' ? clonePts(rec.extra) : {};
        extraTouched = {};
        seedExtra(false);
        if (rec.mmPerPx) {
            mmPerPx = rec.mmPerPx;
            if ($('mmPerPx')) $('mmPerPx').value = String(mmPerPx);
        }
        if (rec.calibrated) calibrated = true;
        if (rec.normSet) { normSet = rec.normSet; syncNormBtn(); }
        if (rec.cvm != null) {
            cvmStageN = parseCvmN(rec.cvm);
            cvmVia = rec.cvmVia || (cvmStageN ? 'staff' : '');
            syncCvmBar();
        }
        source = rec.source || source;
        if (sets[setIndex]) sets[setIndex].pts = pts;
        restoreVia = via || restoreVia || 'local';
        hideSetBar();
        refresh();
        syncLoadBtn();
        if (!opt.quiet) {
            setStatus(via === 'cloud' ? tx('st.restoredCloud') : tx('st.restoredLocal'));
        }
        return { ok: true, key: rec.key || traceStoreKey(), nPts: placedIds().length, via: via };
    }
    function filmDataUrl() {
        if (!img.naturalWidth) return '';
        try {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            var g = c.getContext('2d');
            if (!g) return '';
            g.drawImage(img, 0, 0);
            return c.toDataURL('image/jpeg', 0.92);
        } catch (e) { return ''; }
    }
    function paintShortName(g, id, p, w, r) {
        if (!p || !isFinite(p.x) || !isFinite(p.y) || !id) return;
        var fontPx = Math.max(16, Math.round(w / 80));
        var dx = Math.round(r + 4);
        var dy = Math.round(fontPx * 0.35);
        g.font = 'bold ' + fontPx + 'px sans-serif';
        g.textBaseline = 'alphabetic';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(3, fontPx / 5);
        g.strokeStyle = 'rgba(15,23,42,0.88)';
        g.strokeText(id, p.x + dx, p.y - dy);
        g.fillStyle = '#fde68a';
        g.fillText(id, p.x + dx, p.y - dy);
    }
    function markedDataUrl() {
        if (!img.naturalWidth) return '';
        try {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            var g = c.getContext('2d');
            if (!g) return '';
            g.drawImage(img, 0, 0);
            g.strokeStyle = 'rgba(56,189,248,0.85)';
            g.lineWidth = Math.max(2, c.width / 900);
            (typeof PLANES !== 'undefined' ? PLANES : []).forEach(function (ab) {
                var a = pts[ab[0]], b = pts[ab[1]];
                if (!a || !b) return;
                g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
            });
            var r = Math.max(4, c.width / 280);
            (CEPH_LM.defs() || []).forEach(function (d) {
                var p = pts[d.id];
                if (!p) return;
                g.beginPath();
                g.fillStyle = '#facc15';
                g.arc(p.x, p.y, r, 0, Math.PI * 2);
                g.fill();
                paintShortName(g, d.id, p, c.width, r);
            });
            EXTRA_DEFS.forEach(function (d) {
                var p = extra[d.id];
                if (!p) return;
                g.beginPath();
                g.fillStyle = '#c4b5fd';
                g.arc(p.x, p.y, Math.max(3, r * 0.75), 0, Math.PI * 2);
                g.fill();
                paintShortName(g, d.id, p, c.width, r);
            });
            return c.toDataURL('image/jpeg', 0.88);
        } catch (e) { return filmDataUrl(); }
    }
    function openerPatientId() {
        try {
            if (window.opener && !window.opener.closed && window.opener.xrayPatientId) {
                return String(window.opener.xrayPatientId);
            }
        } catch (e) { /* ignore */ }
        return '';
    }
    function publishTrace(rec) {
        if (!rec) return Promise.resolve({ ok: false, error: 'payload' });
        if (!rec.patientId) rec.patientId = (ctxInfo && ctxInfo.patientId) || openerPatientId();
        if (!rec.xrayId) rec.xrayId = (ctxInfo && ctxInfo.xrayId) || '';
        var opt = {
            filmDataUrl: markedDataUrl() || filmDataUrl(),
            fileName: rec.fileName,
            patientId: rec.patientId,
            fileUrl: (ctxInfo && (ctxInfo.studyUrl || ctxInfo.fileUrl)) || '',
            filePath: (ctxInfo && ctxInfo.filePath) || rec.filePath || ''
        };
        var payload = {
            type: 'banana.ceph.saveTrace',
            xrayId: rec.xrayId || '',
            tracing: rec,
            opt: opt,
            reqId: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
        };
        function viaOpener() {
            try {
                if (window.opener && !window.opener.closed && typeof window.opener.xrayCephSaveTracing === 'function') {
                    return Promise.resolve(window.opener.xrayCephSaveTracing(rec.xrayId || '', rec, opt)).then(function (r) {
                        return r || { ok: false, error: 'opener' };
                    }, function () { return null; });
                }
            } catch (e) { /* ignore */ }
            return Promise.resolve(null);
        }
        function viaBus() {
            return new Promise(function (resolve) {
                var ch = null;
                try { ch = new BroadcastChannel(TRACE_CH); } catch (eB) { resolve(null); return; }
                var timer = setTimeout(function () {
                    try { ch.close(); } catch (eT) { /* ignore */ }
                    resolve(null);
                }, 8000);
                ch.onmessage = function (ev) {
                    var d = ev && ev.data;
                    if (!d || d.type !== 'banana.ceph.saveTrace.done' || String(d.reqId) !== payload.reqId) return;
                    clearTimeout(timer);
                    try { ch.close(); } catch (eC) { /* ignore */ }
                    resolve(d.result || { ok: false });
                };
                try {
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage(payload, window.location.origin);
                    }
                } catch (eP) { /* ignore */ }
                try { ch.postMessage(payload); } catch (eM) {
                    clearTimeout(timer);
                    try { ch.close(); } catch (eX) { /* ignore */ }
                    resolve(null);
                }
            });
        }
        return viaOpener().then(function (r) {
            if (r && (r.ok || r.error === 'col' || r.needSql || r.error === 'patient' || r.error === 'film')) return r;
            return viaBus().then(function (b) {
                return b || r || { ok: false, error: rec.patientId ? 'bus' : 'patient' };
            });
        });
    }
    function applySourceRec(r) {
        if (!r || !r.xrayId) return r;
        if (!ctxInfo) ctxInfo = {};
        ctxInfo.xrayId = r.xrayId;
        if (r.fileUrl) {
            ctxInfo.studyUrl = r.fileUrl;
            ctxInfo.fileUrl = r.fileUrl;
        }
        if (r.filePath) ctxInfo.filePath = r.filePath;
        if (r.fileName) ctxInfo.fileName = r.fileName;
        try { sessionStorage.setItem('banana.ceph.v1', JSON.stringify(ctxInfo)); } catch (eS) { /* ignore */ }
        try { localStorage.setItem('banana.ceph.v1', JSON.stringify(ctxInfo)); } catch (eL) { /* ignore */ }
        return r;
    }
    function fileToDataUrl(file) {
        return new Promise(function (resolve) {
            if (!file) return resolve('');
            if (typeof FileReader !== 'function') return resolve('');
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { resolve(''); };
            reader.readAsDataURL(file);
        });
    }
    function publishSourceFile(file) {
        if (!file) return Promise.resolve({ ok: false, error: 'film' });
        var patientId = (ctxInfo && ctxInfo.patientId) || openerPatientId();
        setStatus(tx('st.sourceSaving'));
        return fileToDataUrl(file).then(function (dataUrl) {
            var opt = { fileName: file.name || fileName, patientId: patientId, filmDataUrl: dataUrl };
            function viaOpener() {
                try {
                    if (window.opener && !window.opener.closed && typeof window.opener.xrayCephPublishSource === 'function') {
                        return Promise.resolve(window.opener.xrayCephPublishSource(file, opt)).then(function (r) {
                            return r || { ok: false, error: 'opener' };
                        }, function () { return null; });
                    }
                } catch (e) { /* ignore */ }
                return Promise.resolve(null);
            }
            function viaBus() {
                var payload = {
                    type: 'banana.ceph.publishSource',
                    opt: opt,
                    reqId: String(Date.now()) + '-src-' + Math.random().toString(36).slice(2, 8)
                };
                return new Promise(function (resolve) {
                    var ch = null;
                    try { ch = new BroadcastChannel(TRACE_CH); } catch (eB) { resolve(null); return; }
                    var timer = setTimeout(function () {
                        try { ch.close(); } catch (eT) { /* ignore */ }
                        resolve(null);
                    }, 8000);
                    ch.onmessage = function (ev) {
                        var d = ev && ev.data;
                        if (!d || d.type !== 'banana.ceph.saveTrace.done' || String(d.reqId) !== payload.reqId) return;
                        clearTimeout(timer);
                        try { ch.close(); } catch (eC) { /* ignore */ }
                        resolve(d.result || { ok: false });
                    };
                    try { ch.postMessage(payload); } catch (eM) {
                        clearTimeout(timer);
                        try { ch.close(); } catch (eX) { /* ignore */ }
                        resolve(null);
                    }
                });
            }
            return viaOpener().then(function (r) {
                if (r && r.ok) return applySourceRec(r);
                return viaBus().then(function (b) {
                    var out = b || r || { ok: false, error: patientId ? 'bus' : 'patient' };
                    if (out && out.ok) applySourceRec(out);
                    return out;
                });
            });
        }).then(function (r) {
            if (r && r.ok && r.xrayId) setStatus(tx('st.sourceCloud'));
            else if (r && r.error === 'patient') setStatus(tx('st.saveNeedPatient'));
            else setStatus(tx('st.sourceFail'));
            return r;
        });
    }
    function saveTrace() {
        if (!img.naturalWidth || !placedIds().length) {
            setStatus(tx('st.saveNeed'));
            return { ok: false };
        }
        var db = readTraceStore();
        var key = traceStoreKey();
        var rec = {
            v: 1,
            kind: 'banana.ceph.savedTrace',
            key: key,
            patientId: ctxInfo && ctxInfo.patientId,
            patientNo: ctxInfo && ctxInfo.patientNo,
            xrayId: ctxInfo && ctxInfo.xrayId,
            fileName: fileName,
            pts: clonePts(pts),
            extra: clonePts(extra),
            mmPerPx: mmPerPx,
            calibrated: !!calibrated,
            normSet: normSet,
            source: source,
            setId: sets[setIndex] && sets[setIndex].id,
            cvm: cvmStageN || 0,
            cvmVia: cvmVia || '',
            cephSaveId: ctxInfo && ctxInfo.cephSaveId,
            cephXrayId: ctxInfo && ctxInfo.cephXrayId,
            savedAt: new Date().toISOString()
        };
        db[key] = rec;
        try { localStorage.setItem(TRACE_KEY, JSON.stringify(db)); } catch (e) { return { ok: false, error: 'store' }; }
        if (ctxInfo) {
            ctxInfo.tracing = rec;
            ctxInfo.tracingVia = 'local';
            try { sessionStorage.setItem('banana.ceph.v1', JSON.stringify(ctxInfo)); } catch (e2) { /* ignore */ }
            try { localStorage.setItem('banana.ceph.v1', JSON.stringify(ctxInfo)); } catch (e3) { /* ignore */ }
        }
        syncLoadBtn();
        setStatus(tx('st.savingCloud'));
        publishTrace(rec).then(function (r) {
            if (r && r.ok && r.cloud && r.cephXrayId) {
                if (ctxInfo) {
                    ctxInfo.tracingVia = 'cloud';
                    if (r.cephSaveId) ctxInfo.cephSaveId = r.cephSaveId;
                    if (r.cephXrayId) ctxInfo.cephXrayId = r.cephXrayId;
                    if (r.xrayId) ctxInfo.xrayId = r.xrayId;
                    if (r.fileUrl && ctxInfo.tracing) ctxInfo.tracing.fileUrl = r.fileUrl;
                    if (r.cephSaveId && ctxInfo.tracing) ctxInfo.tracing.cephSaveId = r.cephSaveId;
                    if (r.cephXrayId && ctxInfo.tracing) ctxInfo.tracing.cephXrayId = r.cephXrayId;
                }
                setStatus(tx('st.savedCloud'));
            } else if (r && r.ok && r.cloud) setStatus(tx('st.savedNoStrip'));
            else if (r && (r.error === 'col' || r.needSql)) setStatus(tx('st.savedNeedSql'));
            else if (r && r.error === 'patient') setStatus(tx('st.saveNeedPatient'));
            else if (r && (r.error === 'film' || r.error === 'opener' || r.error === 'bus')) setStatus(tx('st.savedFail'));
            else setStatus(tx('st.savedLocal', { key: key }));
        });
        return { ok: true, key: key, rec: rec };
    }
    function loadTrace(key) {
        if (key) {
            var rec = readTraceStore()[key];
            if (!isTrace(rec)) { setStatus(tx('st.loadNone')); return { ok: false }; }
            return applyTraceRec(rec, 'local');
        }
        var pending = pendingTrace();
        if (!pending) {
            setStatus(tx('st.loadNone'));
            syncLoadBtn();
            return { ok: false };
        }
        return applyTraceRec(pending.rec, pending.via);
    }
    var PRINT_MAJOR = [
        ['steiner', 'SNA'],
        ['steiner', 'SNB'],
        ['steiner', 'ANB'],
        ['steiner', 'SN–GoGn'],
        ['steiner', 'U1–SN'],
        ['tweed', 'FMA'],
        ['tweed', 'IMPA'],
        ['wits', 'AO–BO'],
        ['downs', 'Angle of convexity'],
        ['mcnamara', 'A to N-perp'],
        ['soft', 'Ls to Sn–PogS'],
        ['soft', 'Li to Sn–PogS']
    ];

    function printEsc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function printRow(res, gid, name) {
        var g = (res.groups || []).filter(function (x) { return x.id === gid; })[0];
        if (!g) return null;
        var i;
        for (i = 0; i < (g.rows || []).length; i++) {
            if (g.rows[i].name === name) return g.rows[i];
        }
        return null;
    }

    function fillPrintSheet() {
        var brand = $('prBrand');
        if (brand) brand.textContent = tx('ui.brand') || 'Banana · Lateral ceph';
        var head = $('prPatientHead');
        if (head) head.textContent = tx('pdf.patient');
        var findHead = $('prFindHead');
        if (findHead) findHead.textContent = tx('print.findings');
        var dataHead = $('prDataHead');
        if (dataHead) dataHead.textContent = tx('print.major');
        var id = $('prId');
        if (id) {
            id.innerHTML = reportPatientGrid().map(function (r) {
                var html = '<div><span>' + printEsc(r[0]) + '</span><b>' + printEsc(r[1] || '—') + '</b></div>';
                if (r[2]) html += '<div><span>' + printEsc(r[2]) + '</span><b>' + printEsc(r[3] || '—') + '</b></div>';
                return html;
            }).join('');
        }
        var film = $('prFilm');
        var empty = $('prNoFilm');
        if (empty) empty.textContent = tx('print.noFilm');
        if (film) {
            if (img.naturalWidth) {
                try { film.src = reportFilmCanvas().toDataURL('image/jpeg', 0.82); } catch (eFilm) { film.removeAttribute('src'); }
                film.hidden = !film.getAttribute('src');
            } else {
                film.removeAttribute('src');
                film.hidden = true;
            }
        }
        if (empty) empty.hidden = !!(film && !film.hidden);
        var res = (window.__cephLast && window.__cephLast.result) || null;
        var s = res && res.summary;
        var find = $('prFindings');
        if (find) {
            var bits = [];
            if (s) {
                bits.push([tx('sum.skeletal'), ph(s.skeletal)]);
                bits.push([tx('sum.vertical'), ph(s.vertical)]);
                bits.push([tx('sum.profile'), ph(s.profile)]);
                bits.push([tx('sum.incisor'), ph(s.incisor) + ' · ' + tx('sum.lip') + ' ' + ph(s.lip)]);
                if (s.extraction) {
                    var scoreBit = String(s.extraction).replace(/^[A-Za-z\-]+\s+/, '');
                    var whyBits = (s.extractionReasons && s.extractionReasons.length) ? s.extractionReasons : s.extractionWhy;
                    bits.push([tx('sum.extract'), extractBandTx(s.extractionBand) + ' ' + scoreBit + (whyBits ? ' · ' + phJoin(whyBits) : '')]);
                }
                if (s.cvm || s.cvmComment) {
                    var cvmLine = ph(s.cvm || '');
                    if (s.cvmKey && s.cvmKey !== 'cvm.need') {
                        cvmLine += ' · ' + cvmCommentTx({ comment: s.cvmComment, commentKey: s.cvmKey });
                    }
                    bits.push([tx('sum.cvm'), cvmLine]);
                }
            }
            find.innerHTML = bits.length ? bits.map(function (pair) {
                return '<div><span>' + printEsc(pair[0]) + '</span><b>' + printEsc(pair[1] || '—') + '</b></div>';
            }).join('') : '<div><b>—</b></div>';
        }
        var data = $('prData');
        if (data) {
            var items = res ? PRINT_MAJOR.map(function (spec) {
                var r = printRow(res, spec[0], spec[1]);
                if (!r) return '';
                var val = r.value == null ? '—' : (r.value + (r.unit ? (' ' + r.unit) : ''));
                var delta = r.delta == null ? '' : ((r.delta > 0 ? '+' : '') + r.delta);
                return '<tr class="band-' + printEsc(r.band || '') + '"><td>' + printEsc(r.name) +
                    '</td><td>' + printEsc(val) + '</td><td>' + printEsc(delta) + '</td><td>' + printEsc(r.norm || '') + '</td></tr>';
            }).join('') : '';
            data.innerHTML = '<tr><th>' + printEsc(tx('th.measure')) + '</th><th>' + printEsc(tx('th.value')) +
                '</th><th>' + printEsc(tx('th.delta')) + '</th><th>' + printEsc(tx('th.norm')) + '</th></tr>' + items;
        }
    }

    function printReport() {
        renderAnalysis();
        fillPrintSheet();
        window.print();
        return { ok: true };
    }

    function refresh() {
        qaScan();
        renderList();
        renderAnalysis();
        draw();
    }
    function qaScan() {
        qaIds = {};
        if (!img.naturalWidth) return [];
        var watch = { Go: 1, Po: 1, Or: 1, Ar: 1 };
        (CEPH_LM.defs() || []).forEach(function (d) {
            if (!watch[d.id] || d.ix == null || d.iy == null) return;
            var p = pts[d.id];
            if (!p || !p.x) return;
            var mx = d.ix * img.naturalWidth, my = d.iy * img.naturalHeight;
            var nrm = Math.hypot(p.x - mx, p.y - my) / Math.max(img.naturalWidth, 1);
            if (nrm > 0.08) qaIds[d.id] = true;
        });
        return Object.keys(qaIds);
    }
    function syncWalkUi() {
        var on = !!walkOn;
        if ($('btnWalk')) {
            $('btnWalk').classList.toggle('is-on', on);
            $('btnWalk').setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        ['btnWalkNext', 'btnWalkSkip', 'btnWalkDone'].forEach(function (id) {
            var btn = $(id);
            if (!btn) return;
            if (on) btn.classList.remove('is-hidden');
            else btn.classList.add('is-hidden');
        });
    }
    function focusWalkPt(id) {
        var p = loc(id);
        if (!p) return false;
        sel = id;
        viewZoom = 2.2;
        panX = 0;
        panY = 0;
        var vs = viewSize();
        var f = fit();
        var q = rotAbout(p, fhRot());
        panX = vs.w / 2 - (f.ox + q.x * f.s);
        panY = vs.h / 2 - (f.oy + q.y * f.s);
        renderList();
        draw();
        return true;
    }
    function showWalkStep() {
        if (!walkOn || walkIdx < 0 || walkIdx >= WALK_IDS.length) return stopWalk();
        var id = WALK_IDS[walkIdx];
        focusWalkPt(id);
        syncWalkUi();
        setStatus(tx('st.walk', {
            n: walkIdx + 1,
            of: WALK_IDS.length,
            id: id,
            hint: tx('walk.' + id)
        }));
        return { ok: true, id: id, i: walkIdx, n: WALK_IDS.length, walkOn: true };
    }
    function startWalk() {
        if (!img.naturalWidth) return { ok: false };
        walkOn = true;
        walkIdx = 0;
        return showWalkStep();
    }
    function walkNext() {
        if (!walkOn) return startWalk();
        walkIdx += 1;
        if (walkIdx >= WALK_IDS.length) return stopWalk();
        return showWalkStep();
    }
    function walkSkip() {
        return walkNext();
    }
    function stopWalk(opt) {
        opt = opt || {};
        var was = walkOn;
        walkOn = false;
        walkIdx = -1;
        syncWalkUi();
        if (!opt.keepView) resetView();
        if (was && !opt.quiet) setStatus(tx('st.walkDone'));
        renderList();
        return { ok: true, walkOn: false };
    }
    function setLabMode(on) {
        labOpen = !!on;
        document.querySelectorAll('.labOnly').forEach(function (el) {
            if (labOpen) el.classList.remove('is-hidden');
            else el.classList.add('is-hidden');
        });
        if ($('btnAdvanced')) {
            $('btnAdvanced').classList.toggle('is-on', labOpen);
            $('btnAdvanced').setAttribute('aria-pressed', labOpen ? 'true' : 'false');
        }
        return labOpen;
    }

    function setMeta() {
        return (sets || []).map(function (s, i) {
            return { i: i, id: s.id, label: s.label, source: s.source, on: i === setIndex };
        });
    }

    function showSetBar() {
        setBarHidden = false;
        var bar = $('setBar');
        var chip = $('btnChangeSet');
        if (bar) bar.classList.remove('is-hidden');
        if (chip) chip.classList.add('is-hidden');
        renderSetBar();
    }

    function hideSetBar() {
        setBarHidden = true;
        var bar = $('setBar');
        var chip = $('btnChangeSet');
        if (bar) bar.classList.add('is-hidden');
        if (chip) chip.classList.remove('is-hidden');
    }

    function viewedAll() {
        return sets.length > 0 && viewedSets.slice(0, sets.length).every(Boolean);
    }

    function remainingView() {
        var left = [];
        sets.forEach(function (s, i) { if (!viewedSets[i]) left.push(setChip(s)); });
        return left;
    }

    function renderSetBar() {
        var host = $('setBtns');
        var cap = $('setCaption');
        var adopt = $('btnAdoptSet');
        var ready = viewedAll();
        if (host) {
            if (!sets.length) {
                host.innerHTML = [0, 1, 2].map(function (i) {
                    return '<button type="button" disabled>' + (i === 0 ? 'UNet' : (i === 2 ? 'All' : '1502')) + '</button>';
                }).join('');
                if (adopt) adopt.disabled = true;
            } else {
                host.innerHTML = sets.map(function (s, i) {
                    var on = i === setIndex;
                    return '<button type="button" class="' + (on ? 'is-on' : '') + '" data-set="' + i +
                        '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + (s.label || ('Set ' + (i + 1))) +
                        '">' + setChip(s) + '</button>';
                }).join('');
                host.querySelectorAll('button').forEach(function (btn) {
                    btn.onclick = function () {
                        previewSet(parseInt(btn.getAttribute('data-set'), 10), true);
                    };
                });
                if (adopt) adopt.disabled = !ready;
            }
        }
        if (cap) {
            var s = sets[setIndex];
            if (!s) cap.textContent = tx('cap.needDetect');
            else if (!ready) cap.textContent = tx('cap.still', { left: remainingView().join(', ') });
            else cap.textContent = tx('cap.ready', { n: setIndex + 1, label: setLabelTx(s) });
        }
    }

    function seedExtra(force) {
        if (pts.Sn && (force || !extra.Pn)) {
            extra.Pn = {
                x: pts.Sn.x + 10,
                y: pts.N ? (pts.N.y * 0.4 + pts.Sn.y * 0.6) : (pts.Sn.y - 26)
            };
        }
        if (!pts.U1 || !pts.L1) return extra;
        if (force || !extra.U1a) extra.U1a = { x: pts.U1.x - 18, y: pts.U1.y - 36 };
        if (force || !extra.L1a) extra.L1a = { x: pts.L1.x - 16, y: pts.L1.y + 36 };
        if (force || !extra.FopA) {
            extra.FopA = { x: (pts.U1.x + pts.L1.x) / 2, y: (pts.U1.y + pts.L1.y) / 2 };
        }
        if (force || !extra.FopP) {
            extra.FopP = { x: extra.FopA.x - 80, y: extra.FopA.y + 10 };
        }
        return extra;
    }

    function previewSet(i, fromUser) {
        if (!sets.length) return { ok: false };
        i = ((i % sets.length) + sets.length) % sets.length;
        if (fromUser) userPickedSet = true;
        setIndex = i;
        viewedSets[i] = true;
        if (!setTouched[i]) setTouched[i] = {};
        touched = setTouched[i];
        var s = sets[i];
        pts = s.pts || {};
        source = s.source || source;
        lastDetect = s;
        extraTouched = {};
        extra = {};
        seedExtra(true);
        if (s.extra) {
            Object.keys(s.extra).forEach(function (id) {
                var p = s.extra[id];
                if (p && isFinite(p.x) && isFinite(p.y)) extra[id] = { x: p.x, y: p.y };
            });
        }
        renderSetBar();
        refresh();
        if (fromUser) {
            setStatus(viewedAll()
                ? tx('st.viewAdopt', { n: i + 1, label: setLabelTx(s) })
                : tx('st.viewOther', { n: i + 1, label: setLabelTx(s) }));
        }
        return { ok: true, i: i, id: s.id, label: s.label, source: s.source };
    }

    function lockAdopt() {
        if (!sets.length || !sets[setIndex]) {
            setStatus(tx('st.need3'));
            return { ok: false };
        }
        if (!viewedAll()) {
            setStatus(tx('st.viewAll'));
            return { ok: false };
        }
        var s = sets[setIndex];
        hideSetBar();
        setStatus(tx('st.adopted', { n: setIndex + 1, label: setLabelTx(s) }));
        return { ok: true, i: setIndex, id: s.id, label: s.label, source: s.source };
    }

    function setPts(next, src) {
        pts = next || {};
        source = src || source;
        if (sets[setIndex]) {
            sets[setIndex].pts = pts;
            if (src) sets[setIndex].source = src;
        }
        refresh();
    }

    function afterLoad(done, skipRestore, gen) {
        if (gen == null) gen = filmEpoch;
        function alive() { return gen === filmEpoch; }
        if (!alive()) { if (done) done({ ok: false, error: 'stale' }); return; }
        if (walkOn) stopWalk({ quiet: true, keepView: true });
        clearUndo();
        userPickedSet = false;
        cvmAutoTried = false;
        restoreHold = (!skipRestore) ? pendingTrace() : null;
        if (!restoreHold || !parseCvmN(restoreHold.rec && restoreHold.rec.cvm)) {
            cvmStageN = 0;
            cvmVia = '';
        }
        restoreVia = '';
        var pack = CEPH_LM.detectSets(img, { useTraining: useTraining });
        sets = pack.sets || [];
        lastBox = pack.box || lastBox;
        lastDetect = pack;
        setTouched = sets.map(function () { return {}; });
        viewedSets = sets.map(function () { return false; });
        var idx = pack.defaultIndex || 0;

        function applyHeld() {
            if (!alive()) return;
            if (restoreHold) {
                hideSetBar();
                applyTraceRec(restoreHold.rec, restoreHold.via, { quiet: true });
            } else {
                showSetBar();
                previewSet(idx, false);
            }
            syncLoadBtn();
        }
        function finish(payload) {
            if (!alive()) { if (done) done({ ok: false, error: 'stale' }); return; }
            var hold = restoreHold;
            if (!hold && !skipRestore) hold = pendingTrace();
            if (hold && isTrace(hold.rec)) {
                applyTraceRec(hold.rec, hold.via, { quiet: true });
                payload.restored = true;
                payload.restoreVia = hold.via;
                if (hold.via === 'local' && ctxInfo && ctxInfo.xrayId) publishTrace(hold.rec);
            }
            syncLoadBtn();
            if (done) done(payload);
            maybeAutoCvm();
        }
        function continueLoad() {
            var api = (window.XRAY_AI_API_URL || 'http://127.0.0.1:8877');
            CEPH_LM.detectApi(img, api).then(function (remote) {
                if (!alive()) { finish({ ok: false, error: 'stale' }); return; }
                var unetPts = (remote.pts && typeof CEPH_LM.scaleAboutPog === 'function')
                    ? CEPH_LM.scaleAboutPog(remote.pts, 1.15)
                    : remote.pts;
                var unetExtra = remote.extra
                    ? ((typeof CEPH_LM.scaleAboutPog === 'function')
                        ? CEPH_LM.scaleAboutPog(remote.extra, 1.15, remote.pts)
                        : remote.extra)
                    : null;
                sets[0] = {
                    id: 'unet',
                    label: 'UNet auto landmarks',
                    source: remote.source || 'dental_001-unet-29',
                    publishedSource: /unet/i.test(String(remote.source || ''))
                        ? 'dental_001-unet-29'
                        : (remote.source || ''),
                    pts: unetPts,
                    extra: unetExtra
                };
                if (remote.pts && typeof CEPH_LM.fitLibToGuide === 'function') {
                    var lib = CEPH_LM.fitLibToGuide(img, remote.pts, { useTraining: useTraining });
                    if (lib && lib.pts) {
                        sets[1] = lib;
                        lastBox = lib.box || lastBox;
                        pack.trainingSource = lib.trainingSource || pack.trainingSource;
                    }
                    if (typeof CEPH_LM.fitLibAll === 'function') {
                        var libAll = CEPH_LM.fitLibAll(img, remote.pts, { useTraining: useTraining });
                        if (libAll && libAll.pts) sets[2] = libAll;
                    }
                }
                if (!userPickedSet && !restoreHold) previewSet(0, false);
                else if (setIndex > 0 && !restoreHold) previewSet(setIndex, false);
                else renderSetBar();
                if (!restoreHold) {
                    setStatus(ctxInfo && ctxInfo.viaStrip
                        ? tx('st.openedStrip')
                        : tx('st.twoReady', {
                            n: setIndex + 1,
                            label: setLabelTx(sets[setIndex])
                        }));
                }
                finish({
                    ok: true,
                    source: source,
                    via: restoreHold ? restoreHold.via : (userPickedSet ? 'local' : 'api'),
                    publishedSource: sets[setIndex] && sets[setIndex].publishedSource,
                    trainingSource: pack.trainingSource,
                    useTraining: !!useTraining,
                    setIndex: setIndex,
                    nSets: sets.length
                });
            }).catch(function () {
                if (!restoreHold) {
                    setStatus(ctxInfo && ctxInfo.viaStrip
                        ? tx('st.openedStrip')
                        : tx('st.twoLocal', {
                            n: setIndex + 1,
                            label: setLabelTx(sets[setIndex])
                        }));
                }
                finish({
                    ok: true,
                    source: source,
                    via: restoreHold ? restoreHold.via : 'local',
                    publishedSource: sets[setIndex] && sets[setIndex].publishedSource,
                    trainingSource: pack.trainingSource,
                    useTraining: !!useTraining,
                    setIndex: setIndex,
                    nSets: sets.length
                });
            });
        }

        if (!restoreHold && !skipRestore) {
            pullCloudTrace().then(function (t) {
                if (!alive()) { if (done) done({ ok: false, error: 'stale' }); return; }
                if (isTrace(t) && traceForThisFilm(t, true)) restoreHold = { rec: t, via: 'cloud' };
                applyHeld();
                continueLoad();
            }, function () {
                applyHeld();
                continueLoad();
            });
            return;
        }
        applyHeld();
        continueLoad();
    }

    function runDetect() {
        if (!img.naturalWidth) { setStatus(tx('st.loadFirst')); return Promise.resolve({ ok: false }); }
        setStatus(tx('st.detecting'));
        return new Promise(function (resolve) { afterLoad(resolve, true); });
    }

    function clearMarks() {
        pts = (window.CEPH_LM && typeof CEPH_LM.emptyPts === 'function') ? CEPH_LM.emptyPts() : {};
        extra = {};
        extraTouched = {};
        overlayRec = null;
        overlayMapped = null;
        restoreHold = null;
        sel = '';
    }
    function blankFilm() {
        clearMarks();
        try {
            var c = canvas();
            var g = c && c.getContext('2d');
            if (!g) return;
            var vs = viewSize();
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.clearRect(0, 0, vs.w, vs.h);
            g.fillStyle = '#080b14';
            g.fillRect(0, 0, vs.w, vs.h);
        } catch (eB) { /* ignore */ }
    }
    function loadFile(file) {
        if (!file) return Promise.resolve({ ok: false });
        filmEpoch += 1;
        var gen = filmEpoch;
        shownUrl = '';
        fileName = file.name || 'ceph.png';
        img = new Image();
        if (ctxInfo) {
            ctxInfo.tracing = null;
            ctxInfo.tracingVia = '';
            ctxInfo.studyUrl = '';
            ctxInfo.fileUrl = '';
            ctxInfo.userPick = true;
            ctxInfo.viaStrip = true;
            ctxInfo.xrayId = '';
            ctxInfo.cephSaveId = '';
            ctxInfo.cephXrayId = '';
        }
        blankFilm();
        var url = URL.createObjectURL(file);
        var incoming = new Image();
        return new Promise(function (resolve) {
            incoming.onload = function () {
                URL.revokeObjectURL(url);
                if (gen !== filmEpoch) { resolve({ ok: false, error: 'stale' }); return; }
                img = incoming;
                publishSourceFile(file);
                afterLoad(resolve, false, gen);
            };
            incoming.onerror = function () {
                URL.revokeObjectURL(url);
                if (gen !== filmEpoch) { resolve({ ok: false, error: 'stale' }); return; }
                img = new Image();
                setStatus(tx('st.badFile'));
                resolve({ ok: false });
            };
            incoming.src = url;
        });
    }

    function loadUrl(url, name) {
        if (!url) return Promise.resolve({ ok: false });
        if (url === shownUrl && img.naturalWidth) return Promise.resolve({ ok: true, same: true });
        filmEpoch += 1;
        var gen = filmEpoch;
        shownUrl = url;
        fileName = name || 'ceph.png';
        img = new Image();
        blankFilm();
        var incoming = new Image();
        incoming.crossOrigin = 'anonymous';
        return new Promise(function (resolve) {
            incoming.onload = function () {
                if (gen !== filmEpoch) { resolve({ ok: false, error: 'stale' }); return; }
                img = incoming;
                afterLoad(resolve, false, gen);
            };
            incoming.onerror = function () {
                if (gen !== filmEpoch) { resolve({ ok: false, error: 'stale' }); return; }
                img = new Image();
                setStatus(tx('st.cors'));
                resolve({ ok: false, error: 'load' });
            };
            incoming.src = url;
        });
    }
    function acceptOpen(ctx) {
        if (!ctx || typeof ctx !== 'object') return;
        var prevId = ctxInfo && ctxInfo.xrayId ? String(ctxInfo.xrayId) : '';
        var nextId = ctx.xrayId ? String(ctx.xrayId) : '';
        var nextUrl = ctx.studyUrl || '';
        var sameFilm = !!(prevId && nextId && prevId === nextId);
        if (shownUrl && nextUrl && nextUrl !== shownUrl && sameFilm) {
            // keep the strip film already on screen; a saved fileUrl must not load beside it
            ctx.studyUrl = shownUrl;
            nextUrl = shownUrl;
        }
        ctxInfo = ctx;
        try { sessionStorage.setItem('banana.ceph.v1', JSON.stringify(ctxInfo)); } catch (eO) { /* ignore */ }
        if (nextUrl && nextUrl !== shownUrl) loadUrl(nextUrl, ctx.fileName);
        else if (isTrace(ctx.tracing) && traceForThisFilm(ctx.tracing, true) && img.naturalWidth) {
            hideSetBar();
            applyTraceRec(ctx.tracing, ctx.tracingVia || 'cloud');
        }
    }

    function applyRuler(a, b, mm) {
        if (!a || !b) return { ok: false, error: 'pts' };
        mm = Number(mm);
        if (!isFinite(mm) || mm <= 0) mm = 10;
        var px = Math.hypot(b.x - a.x, b.y - a.y);
        if (px < 4) return { ok: false, error: 'short' };
        mmPerPx = mm / px;
        calibrated = true;
        calMode = false;
        calFirst = null;
        ruler = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, mm: mm };
        if ($('mmPerPx')) $('mmPerPx').value = String(Math.round(mmPerPx * 10000) / 10000);
        if ($('btnCalibrate')) {
            $('btnCalibrate').classList.remove('is-on');
            $('btnCalibrate').setAttribute('aria-pressed', 'false');
        }
        renderAnalysis();
        draw();
        setStatus(tx('st.calOk', {
            mm: mm,
            px: Math.round(px),
            scale: Math.round(mmPerPx * 10000) / 10000
        }));
        return { ok: true, mmPerPx: mmPerPx, px: px, mm: mm, calibrated: true };
    }
    function startCalibrate() {
        if (!img.naturalWidth) { setStatus(tx('st.loadFirst')); return false; }
        calMode = true;
        calFirst = null;
        if ($('btnCalibrate')) {
            $('btnCalibrate').classList.add('is-on');
            $('btnCalibrate').setAttribute('aria-pressed', 'true');
        }
        var mm = ($('rulerMm') && parseFloat($('rulerMm').value)) || 10;
        setStatus(tx('st.calStart', { mm: mm }));
        return true;
    }

    function exportJson() {
        var last = window.__cephLast || { pts: pts };
        var train = window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 };
        var blob = new Blob([JSON.stringify({
            v: 1,
            kind: 'banana.ceph',
            dataset: 'ISBI2015-19',
            source: source,
            fileName: fileName,
            patient: ctxInfo,
            mmPerPx: mmPerPx,
            calibrated: !!calibrated,
            normSet: normSet,
            landmarks: pts,
            extra: extra,
            analysis: last.result,
            adoptedSet: sets[setIndex] ? {
                index: setIndex,
                id: sets[setIndex].id,
                label: sets[setIndex].label,
                source: sets[setIndex].source
            } : null,
            published: {
                dataset: 'ISBI2015+Aariz+PKU',
                films: publishedN(),
                kind: 'published',
                readOnly: true
            },
            clinicTraining: {
                kind: 'banana.ceph.clinicTrain',
                films: train.films,
                points: train.points,
                usedAsReference: !!useTraining
            }
        }, null, 2)], { type: 'application/json' });
        download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-analysis.json');
    }

    function csvText() {
        var last = window.__cephLast;
        if (!last || !last.result) renderAnalysis();
        last = window.__cephLast;
        return CEPH_AN.toCsv(last && last.result);
    }
    function exportCsv() {
        var text = csvText();
        var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
        download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-analysis.csv');
    }

    function exportPng() {
        var out = document.createElement('canvas');
        if (!img.naturalWidth) { setStatus(tx('st.noExport')); return; }
        out.width = img.naturalWidth;
        out.height = img.naturalHeight;
        var ctx = out.getContext('2d');
        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = 'rgba(56,189,248,0.85)';
        ctx.lineWidth = Math.max(2, out.width / 900);
        PLANES.forEach(function (ab) {
            var a = pts[ab[0]], b = pts[ab[1]];
            if (!a || !b) return;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        CEPH_LM.defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            ctx.beginPath();
            ctx.fillStyle = '#facc15';
            ctx.arc(p.x, p.y, Math.max(4, out.width / 280), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#111';
            ctx.font = 'bold ' + Math.max(14, Math.round(out.width / 90)) + 'px sans-serif';
            ctx.fillText(d.id, p.x + 8, p.y - 8);
        });
        out.toBlob(function (blob) {
            download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-marked.png');
        }, 'image/png');
    }

    function reportFilmCanvas() {
        var w = img.naturalWidth, h = img.naturalHeight;
        var base = document.createElement('canvas');
        base.width = w;
        base.height = h;
        var bctx = base.getContext('2d');
        bctx.fillStyle = '#0b1020';
        bctx.fillRect(0, 0, w, h);
        var ang = fhRot();
        bctx.save();
        bctx.translate(w / 2, h / 2);
        bctx.rotate(ang);
        bctx.translate(-w / 2, -h / 2);
        var filt = 'brightness(' + filmBright + ') contrast(' + filmContrast + ')';
        if (invertFilm) filt += ' invert(1) hue-rotate(180deg)';
        bctx.filter = filt;
        bctx.drawImage(img, 0, 0);
        bctx.restore();
        var marks = [];
        function addMark(id, p) {
            if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
            var q = rotAbout(p, ang);
            marks.push({ id: id, x: q.x, y: q.y });
        }
        if (window.CEPH_LM && CEPH_LM.defs) CEPH_LM.defs().forEach(function (d) { addMark(d.id, pts[d.id]); });
        EXTRA_DEFS.forEach(function (d) { addMark(d.id, extra[d.id]); });
        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        marks.forEach(function (m) {
            if (m.x < minx) minx = m.x;
            if (m.y < miny) miny = m.y;
            if (m.x > maxx) maxx = m.x;
            if (m.y > maxy) maxy = m.y;
        });
        if (!marks.length) { minx = 0; miny = 0; maxx = w; maxy = h; }
        var span = Math.max(1, Math.max(maxx - minx, maxy - miny));
        var pad = Math.max(24, Math.round(span * 0.08));
        minx = Math.max(0, Math.floor(minx - pad));
        miny = Math.max(0, Math.floor(miny - pad));
        maxx = Math.min(w, Math.ceil(maxx + pad));
        maxy = Math.min(h, Math.ceil(maxy + pad));
        var cw = Math.max(1, maxx - minx), ch = Math.max(1, maxy - miny);
        var crop = document.createElement('canvas');
        crop.width = cw;
        crop.height = ch;
        var ctx = crop.getContext('2d');
        ctx.drawImage(base, minx, miny, cw, ch, 0, 0, cw, ch);
        function at(id) {
            var i, m;
            for (i = 0; i < marks.length; i++) {
                m = marks[i];
                if (m.id === id) return { x: m.x - minx, y: m.y - miny };
            }
            return null;
        }
        var lw = Math.max(2, cw / 420);
        function seg(a, b, color) {
            var A = at(a), B = at(b);
            if (!A || !B) return;
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(A.x, A.y);
            ctx.lineTo(B.x, B.y);
            ctx.stroke();
        }
        PLANES.forEach(function (ab) { seg(ab[0], ab[1], 'rgba(56,189,248,0.9)'); });
        [['Pn', 'Sn'], ['Sn', 'Ls'], ['Ls', 'Li'], ['Li', 'PogS']].forEach(function (ab) {
            seg(ab[0], ab[1], 'rgba(251,146,60,0.95)');
        });
        var dot = Math.max(4, cw / 220);
        ctx.font = 'bold ' + Math.max(14, Math.round(cw / 70)) + 'px sans-serif';
        marks.forEach(function (m) {
            var x = m.x - minx, y = m.y - miny;
            ctx.beginPath();
            ctx.fillStyle = '#facc15';
            ctx.arc(x, y, dot, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#111827';
            ctx.fillText(m.id, x + dot + 2, y - dot - 2);
        });
        return crop;
    }

    function jpegPagesToPdf(pages) {
        var PW = 595.28, PH = 841.89;
        var parts = [];
        var off = 0;
        function add(u8) { parts.push(u8); off += u8.length; }
        function addStr(s) { add(new TextEncoder().encode(s)); }
        var xref = [0];
        function obj(n, body) {
            xref[n] = off;
            addStr(n + ' 0 obj\n');
            if (typeof body === 'string') addStr(body);
            else body();
            addStr('\nendobj\n');
        }
        addStr('%PDF-1.4\n');
        var nPages = pages.length;
        var ids = [];
        var next = 3;
        var pi;
        for (pi = 0; pi < nPages; pi++) {
            ids.push({ page: next, content: next + 1, image: next + 2 });
            next += 3;
        }
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Count ' + nPages + ' /Kids [' +
            ids.map(function (id) { return id.page + ' 0 R'; }).join(' ') + '] >>');
        pages.forEach(function (page, i) {
            var id = ids[i];
            var content = 'q\n' + PW.toFixed(2) + ' 0 0 ' + PH.toFixed(2) + ' 0 0 cm\n/Im0 Do\nQ\n';
            obj(id.page, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW.toFixed(2) + ' ' + PH.toFixed(2) +
                '] /Contents ' + id.content + ' 0 R /Resources << /XObject << /Im0 ' + id.image + ' 0 R >> >> >>');
            obj(id.content, '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
            obj(id.image, function () {
                addStr('<< /Type /XObject /Subtype /Image /Width ' + page.w + ' /Height ' + page.h +
                    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + page.jpeg.length + ' >>\nstream\n');
                add(page.jpeg);
                addStr('\nendstream');
            });
        });
        var xrefPos = off;
        addStr('xref\n0 ' + next + '\n');
        addStr('0000000000 65535 f \n');
        var oi;
        for (oi = 1; oi < next; oi++) {
            addStr(('0000000000' + (xref[oi] || 0)).slice(-10) + ' 00000 n \n');
        }
        addStr('trailer\n<< /Size ' + next + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n');
        var out = new Uint8Array(off);
        var p = 0;
        parts.forEach(function (u) { out.set(u, p); p += u.length; });
        return new Blob([out], { type: 'application/pdf' });
    }

    function buildReportCanvases() {
        var PW = 1190, PH = 1684, M = 56;
        var font = "'Segoe UI', 'Microsoft YaHei', 'PingFang TC', sans-serif";
        var pages = [];
        var ctx, y;
        function newPage(title) {
            var c = document.createElement('canvas');
            c.width = PW;
            c.height = PH;
            ctx = c.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, PW, PH);
            ctx.fillStyle = '#111827';
            ctx.textBaseline = 'top';
            y = M;
            pages.push(c);
            if (title) {
                ctx.font = '600 18px ' + font;
                ctx.fillStyle = '#64748b';
                ctx.fillText(title, M, y);
                y += 36;
                ctx.fillStyle = '#111827';
            }
        }
        function need(h) {
            if (y + h > PH - M) newPage(tx('pdf.findings'));
        }
        function wrap(text, maxW) {
            var s = String(text == null ? '' : text).replace(/\r/g, '');
            var lines = [];
            var line = '';
            function pushHard(chunk) {
                var part = '';
                var k, t2;
                for (k = 0; k < chunk.length; k++) {
                    t2 = part + chunk.charAt(k);
                    if (part && ctx.measureText(t2).width > maxW) {
                        lines.push(part);
                        part = chunk.charAt(k);
                    } else part = t2;
                }
                return part;
            }
            function take(chunk) {
                var trial = line + chunk;
                if (line && ctx.measureText(trial).width > maxW) {
                    lines.push(line.replace(/\s+$/, ''));
                    line = chunk.replace(/^\s+/, '');
                    if (ctx.measureText(line).width > maxW) line = pushHard(line);
                } else line = trial;
            }
            s.split('\n').forEach(function (para, pi) {
                if (pi) { lines.push(line.replace(/\s+$/, '')); line = ''; }
                para.split(/(\s+)/).forEach(function (chunk) {
                    if (!chunk) return;
                    if (/^\s+$/.test(chunk)) { if (line) take(chunk); return; }
                    if (ctx.measureText(chunk).width <= maxW) { take(chunk); return; }
                    var buf = '', ci, ch;
                    for (ci = 0; ci < chunk.length; ci++) {
                        ch = chunk.charAt(ci);
                        if (ch.charCodeAt(0) > 255) {
                            if (buf) { take(buf); buf = ''; }
                            take(ch);
                        } else buf += ch;
                    }
                    if (buf) take(buf);
                });
            });
            if (line) lines.push(line.replace(/\s+$/, ''));
            return lines.length ? lines : [''];
        }
        function heading(text) {
            need(40);
            ctx.font = '700 26px ' + font;
            ctx.fillStyle = '#0f172a';
            ctx.fillText(text, M, y);
            y += 36;
        }
        function body(text, size, color) {
            ctx.font = (size || 16) + 'px ' + font;
            wrap(text, PW - M * 2).forEach(function (line) {
                need((size || 16) + 8);
                ctx.font = (size || 16) + 'px ' + font;
                ctx.fillStyle = color || '#1f2937';
                ctx.fillText(line, M, y);
                y += (size || 16) + 8;
            });
        }
        var res = (window.__cephLast && window.__cephLast.result) || null;
        var s = res && res.summary;
        newPage('');
        ctx.font = '700 34px ' + font;
        ctx.fillStyle = '#0f172a';
        ctx.fillText(tx('ui.brand') || 'Banana · Lateral ceph', M, y);
        y += 44;
        heading(tx('pdf.patient'));
        var idRows = reportPatientGrid();
        var col2 = M + Math.floor((PW - M * 2) / 2);
        var labelW = 168;
        function clipText(text, x, y0, maxW) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y0 - 2, maxW, 24);
            ctx.clip();
            ctx.font = '16px ' + font;
            ctx.fillStyle = '#111827';
            ctx.fillText(String(text), x, y0);
            ctx.restore();
        }
        idRows.forEach(function (r) {
            need(28);
            ctx.font = '600 15px ' + font;
            ctx.fillStyle = '#64748b';
            ctx.fillText(r[0], M, y);
            if (r[2]) ctx.fillText(r[2], col2, y);
            clipText(r[1] || '—', M + labelW, y, col2 - M - labelW - 16);
            if (r[2]) clipText(r[3] || '—', col2 + labelW, y, PW - M - (col2 + labelW));
            y += 26;
        });
        y += 6;
        body([fileName, tx(normSet === 'chinese' ? 'btn.normCn' : 'btn.normCauc')].filter(Boolean).join('  ·  '), 15, '#64748b');
        y += 8;
        var film = reportFilmCanvas();
        var maxW = PW - M * 2;
        var maxH = 480;
        var scale = Math.min(maxW / film.width, maxH / film.height);
        var dw = Math.round(film.width * scale);
        var dh = Math.round(film.height * scale);
        need(dh + 16);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;
        ctx.strokeRect(M - 1, y - 1, dw + 2, dh + 2);
        ctx.drawImage(film, M, y, dw, dh);
        y += dh + 28;
        if (s) {
            heading(tx('pdf.hard'));
            body(tx('sum.skeletal') + '  ' + ph(s.skeletal), 18);
            body(tx('sum.vertical') + '  ' + ph(s.vertical), 18);
            y += 8;
            heading(tx('pdf.soft'));
            body(tx('sum.profile') + '  ' + ph(s.profile), 18);
            body(tx('sum.incisor') + '  ' + ph(s.incisor) + ' · ' + tx('sum.lip') + ' ' + ph(s.lip), 18);
            y += 8;
        }
        if (s && s.extraction) {
            heading(tx('g.extract'));
            var scoreBit = String(s.extraction).replace(/^[A-Za-z\-]+\s+/, '');
            body(extractBandTx(s.extractionBand) + '  ' + scoreBit, 20);
            var whyBits = (s.extractionReasons && s.extractionReasons.length) ? s.extractionReasons : s.extractionWhy;
            if (whyBits) body(phJoin(whyBits), 16);
            if (s.extractionNote) body(extractNoteTx(s.extractionNote), 15, '#475569');
            y += 8;
        }
        if (s && (s.cvm || s.cvmComment)) {
            heading(tx('g.cvm'));
            body(ph(s.cvm || ''), 18);
            if (s.cvmComment) body(cvmCommentTx({ comment: s.cvmComment, commentKey: s.cvmKey }), 16, '#475569');
        }
        heading(tx('pdf.findings'));
        var colM = M, colV = M + 460, colD = M + 680, colN = M + 820;
        (res && res.groups || []).forEach(function (g) {
            var label = groupTitleTx(g.title);
            need(36);
            ctx.font = '700 20px ' + font;
            ctx.fillStyle = '#0f172a';
            ctx.fillText(label, M, y);
            y += 30;
            ctx.font = '600 14px ' + font;
            ctx.fillStyle = '#64748b';
            ctx.fillText(tx('th.measure'), colM, y);
            ctx.fillText(tx('th.value'), colV, y);
            ctx.fillText(tx('th.delta'), colD, y);
            ctx.fillText(tx('th.norm'), colN, y);
            y += 24;
            (g.rows || []).forEach(function (r) {
                var note = r.name === 'Extraction index' ? extractNoteTx(r.note) : ph(r.note || '');
                ctx.font = '14px ' + font;
                var noteLines = note ? wrap(note, PW - M * 2) : [];
                if (noteLines.length > 4) noteLines = noteLines.slice(0, 4);
                need(26 + noteLines.length * 20);
                var color = r.band === 'out' ? '#b91c1c' : (r.band === 'warn' ? '#a16207' : '#111827');
                ctx.font = '16px ' + font;
                ctx.fillStyle = color;
                ctx.fillText(String(r.name || ''), colM, y);
                var val = r.value == null ? '—' : (r.value + (r.unit ? (' ' + r.unit) : ''));
                ctx.fillText(String(val), colV, y);
                var delta = r.delta == null ? '' : ((r.delta > 0 ? '+' : '') + r.delta);
                ctx.fillText(String(delta), colD, y);
                ctx.fillText(String(r.norm || ''), colN, y);
                y += 24;
                if (noteLines.length) {
                    ctx.font = '14px ' + font;
                    ctx.fillStyle = '#64748b';
                    noteLines.forEach(function (line) {
                        ctx.fillText(line, colM, y);
                        y += 20;
                    });
                }
            });
            y += 12;
        });
        return pages;
    }

    function canvasToJpeg(c) {
        return new Promise(function (resolve, reject) {
            c.toBlob(function (blob) {
                if (!blob) { reject(new Error('jpeg')); return; }
                blob.arrayBuffer().then(function (buf) {
                    resolve({ w: c.width, h: c.height, jpeg: new Uint8Array(buf) });
                }, reject);
            }, 'image/jpeg', 0.86);
        });
    }

    function exportPdf() {
        if (!img.naturalWidth) {
            setStatus(tx('st.noExport'));
            return Promise.resolve({ ok: false, error: 'image' });
        }
        renderAnalysis();
        var name = (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-report.pdf';
        var pick = null;
        try {
            if (typeof window.showSaveFilePicker === 'function') {
                pick = window.showSaveFilePicker({
                    suggestedName: name,
                    types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }]
                });
            }
        } catch (ePick) { pick = null; }
        return Promise.resolve(pick).then(function (handle) {
            var pages = buildReportCanvases();
            return Promise.all(pages.map(canvasToJpeg)).then(function (jpegs) {
                var blob = jpegPagesToPdf(jpegs);
                if (!handle) {
                    download(blob, name);
                    setStatus(tx('st.pdfSaved'));
                    return { ok: true, via: 'download' };
                }
                return handle.createWritable().then(function (stream) {
                    return stream.write(blob).then(function () { return stream.close(); });
                }).then(function () {
                    setStatus(tx('st.pdfSaved'));
                    return { ok: true, via: 'picker' };
                });
            });
        }, function (err) {
            if (err && err.name === 'AbortError') {
                setStatus(tx('st.pdfCancel'));
                return { ok: false, error: 'cancel' };
            }
            setStatus(tx('st.pdfFail'));
            return { ok: false, error: 'pdf' };
        });
    }

    function download(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    }

    function openExtractNotes(e) {
        var url = 'extraction.html?v=20261005fx53';
        if (e && e.currentTarget && e.currentTarget.getAttribute('href')) {
            url = e.currentTarget.getAttribute('href');
        }
        var w = window.open(url, 'cephExtractNotes');
        if (w) {
            if (e) e.preventDefault();
            try { w.focus(); } catch (err) {}
            return false;
        }
        return true;
    }

    function onMove(e) {
        var r = canvas().getBoundingClientRect();
        var x = e.clientX - r.left, y = e.clientY - r.top;
        if (drag && pts[drag]) {
            pts[drag] = toImg(x, y);
            refresh();
            return;
        }
        if (drag && extra[drag]) {
            extra[drag] = toImg(x, y);
            extraTouched[drag] = true;
            refresh();
        }
    }
    function hit(x, y) {
        var best = '', bestD = 22;
        CEPH_LM.defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            var v = toView(p);
            var dd = Math.hypot(v.x - x, v.y - y);
            if (dd < bestD) { bestD = dd; best = d.id; }
        });
        EXTRA_DEFS.forEach(function (d) {
            var p = extra[d.id];
            if (!p) return;
            var v = toView(p);
            var dd = Math.hypot(v.x - x, v.y - y);
            if (dd < bestD) { bestD = dd; best = d.id; }
        });
        return best;
    }

    function boot() {
        if (window.CEPH_I18N && typeof CEPH_I18N.boot === 'function') {
            CEPH_I18N.boot({
                onLang: function () {
                    readCtx();
                    renderList();
                    renderAnalysis();
                    renderLearn();
                    renderSetBar();
                    syncUseTrainBtn();
                    syncNormBtn();
                    if (!img.naturalWidth) setStatus(tx('st.loadHint'));
                }
            });
        }
        readCtx();
        CEPH_LM.loadCatalog().then(function () {
            pts = CEPH_LM.emptyPts();
            renderSetBar();
            renderList();
            if (window.CEPH_LEARN && typeof CEPH_LEARN.pullRemote === 'function') {
                CEPH_LEARN.pullRemote().then(function () { renderLearn(); });
            }
            if (ctxInfo && ctxInfo.studyUrl) {
                loadUrl(ctxInfo.studyUrl, ctxInfo.fileName);
                if (ctxInfo.viaStrip) setStatus(tx('st.openedStrip'));
            } else setStatus(tx('st.loadHint'));
            syncLoadBtn();
        }).catch(function () { setStatus(tx('st.missingCat')); });

        $('btnLoad').onclick = function () { $('filePick').click(); };
        $('filePick').onchange = function () { loadFile(this.files && this.files[0]); this.value = ''; };
        $('btnDetect').onclick = function () {
            if (window.CEPH_LM && typeof CEPH_LM.wakeProtocol === 'function') CEPH_LM.wakeProtocol();
            runDetect();
        };
        useTraining = readUseTraining();
        syncUseTrainBtn();
        normSet = readNormSet();
        syncNormBtn();
        if ($('btnNormCauc')) $('btnNormCauc').onclick = function () { writeNormSet('caucasian'); };
        if ($('btnNormCn')) $('btnNormCn').onclick = function () { writeNormSet('chinese'); };
        try { var ag = window.localStorage && localStorage.getItem(AGE_KEY); if (ag === 'child') ageBand = 'child'; } catch (eA) { /* ignore */ }
        try { var sx = window.localStorage && localStorage.getItem(SEX_KEY); if (sx === 'f' || sx === 'm') sexBand = sx; } catch (eS) { /* ignore */ }
        try { var cv = window.localStorage && localStorage.getItem(CVM_KEY); if (cv) { cvmStageN = parseCvmN(cv); cvmVia = cvmStageN ? 'staff' : ''; } } catch (eC) { /* ignore */ }
        if ($('btnAgeAdult')) $('btnAgeAdult').onclick = function () { writeAge('adult'); };
        if ($('btnAgeChild')) $('btnAgeChild').onclick = function () { writeAge('child'); };
        if ($('btnSexM')) $('btnSexM').onclick = function () { writeSex(sexBand === 'm' ? '' : 'm'); };
        if ($('btnSexF')) $('btnSexF').onclick = function () { writeSex(sexBand === 'f' ? '' : 'f'); };
        var cvmGroup = $('cvmGroup');
        if (cvmGroup) {
            cvmGroup.querySelectorAll('button[data-cvm]').forEach(function (btn) {
                btn.onclick = function () { writeCvm(btn.getAttribute('data-cvm'), 'staff'); };
            });
        }
        if ($('btnAutoCvm')) $('btnAutoCvm').onclick = function () {
            if (window.CEPH_LM && typeof CEPH_LM.wakeProtocol === 'function') CEPH_LM.wakeProtocol();
            pullCvmApi();
        };
        syncNormBtn();
        syncCvmBar();
        if ($('btnAdvanced')) $('btnAdvanced').onclick = function () { setLabMode(!labOpen); };
        setLabMode(false);
        function bindRef(id, onPlus) {
            if ($(id)) $(id).onclick = function (e) {
                e.stopPropagation();
                setRefMode(onPlus);
            };
        }
        bindRef('btnRefPub', false);
        bindRef('btnRefPlus', true);
        var setBar = $('setBar');
        if (setBar) {
            setBar.addEventListener('wheel', function (e) {
                if (!sets.length || setBarHidden) return;
                e.preventDefault();
                var d = e.deltaY > 0 ? 1 : -1;
                previewSet(setIndex + d, true);
            }, { passive: false });
        }
        if ($('btnAdoptSet')) $('btnAdoptSet').onclick = function (e) {
            e.stopPropagation();
            lockAdopt();
        };
        if ($('btnChangeSet')) $('btnChangeSet').onclick = function () {
            showSetBar();
            setStatus(tx('st.compare'));
        };
        if ($('btnLearn')) $('btnLearn').onclick = includeSelected;
        if ($('btnLearnUndo')) $('btnLearnUndo').onclick = function () {
            if (!window.CEPH_LEARN) return;
            var st = CEPH_LEARN.undoLast();
            setStatus(tx('st.learnUndo', { n: st.films }));
            renderLearn();
        };
        $('btnJson') && ($('btnJson').onclick = exportJson);
        $('btnCsv').onclick = exportCsv;
        $('btnPng').onclick = exportPng;
        if ($('btnPdf')) $('btnPdf').onclick = function () { exportPdf(); };
        if ($('btnExtractHelp')) $('btnExtractHelp').onclick = openExtractNotes;
        if ($('btnSaveTrace')) $('btnSaveTrace').onclick = saveTrace;
        if ($('btnLoadTrace')) $('btnLoadTrace').onclick = function () { loadTrace(); };
        if ($('btnPrint')) $('btnPrint').onclick = printReport;
        if ($('btnCalibrate')) $('btnCalibrate').onclick = function () {
            if (calMode) {
                calMode = false;
                calFirst = null;
                $('btnCalibrate').classList.remove('is-on');
                $('btnCalibrate').setAttribute('aria-pressed', 'false');
                setStatus(tx('st.calCancel'));
                draw();
                return;
            }
            startCalibrate();
        };
        $('mmPerPx').onchange = function () {
            mmPerPx = parseFloat(this.value) || 0.1;
            calibrated = true;
            renderAnalysis();
            setStatus(tx('st.manualScale', { n: mmPerPx }));
        };
        var c = canvas();
        c.addEventListener('mousedown', function (e) {
            var r = c.getBoundingClientRect();
            var x = e.clientX - r.left, y = e.clientY - r.top;
            if (calMode) {
                e.preventDefault();
                var imgPt = toImg(x, y);
                if (!calFirst) {
                    calFirst = imgPt;
                    draw();
                    setStatus(tx('st.calFirst'));
                    return;
                }
                var mm = ($('rulerMm') && parseFloat($('rulerMm').value)) || 10;
                applyRuler(calFirst, imgPt, mm);
                return;
            }
            var id = hit(x, y);
            if (id) {
                pushUndo();
                sel = id;
                drag = id;
                refresh();
                return;
            }
            panning = { x: x, y: y, panX: panX, panY: panY };
        });
        window.addEventListener('mousemove', function (e) {
            if (panning) {
                var r = c.getBoundingClientRect();
                panX = panning.panX + (e.clientX - r.left - panning.x);
                panY = panning.panY + (e.clientY - r.top - panning.y);
                draw();
                return;
            }
            onMove(e);
        });
        window.addEventListener('mouseup', function () {
            panning = null;
            if (!drag) return;
            if (pts[drag]) touched[drag] = true;
            if (extra[drag]) extraTouched[drag] = true;
            drag = null;
            renderList();
        });
        c.addEventListener('wheel', function (e) {
            e.preventDefault();
            var next = viewZoom * (e.deltaY > 0 ? 0.9 : 1.1);
            if (next < 0.5) next = 0.5;
            if (next > 6) next = 6;
            viewZoom = next;
            draw();
        }, { passive: false });
        if ($('btnInvert')) $('btnInvert').onclick = function () { setInvert(!invertFilm); };
        if ($('filmBright')) $('filmBright').oninput = function () { setFilmLook({ bright: this.value }); };
        if ($('filmContrast')) $('filmContrast').oninput = function () { setFilmLook({ contrast: this.value }); };
        if ($('btnFhUp')) $('btnFhUp').onclick = function () { setFhUp(!fhUp); };
        (function fillOverlayPick() {
            var sel = $('overlayPick');
            if (!sel) return;
            var rows = (ctxInfo && ctxInfo.otherTraces) || [];
            sel.innerHTML = '<option value="">' + tx('h.overlay') + '</option>' + rows.map(function (r, i) {
                return '<option value="' + i + '">' + (r.fileName || r.taken || ('#' + (i + 1))) + '</option>';
            }).join('');
            sel.onchange = function () {
                var i = parseInt(sel.value, 10);
                if (!isFinite(i) || !rows[i]) { setOverlay(null); return; }
                setOverlay(rows[i].tracing);
            };
        })();
        if ($('btnOverlaySn')) $('btnOverlaySn').onclick = function () { setOverlayMode('sn'); };
        if ($('btnOverlayFh')) $('btnOverlayFh').onclick = function () { setOverlayMode('fh'); };
        if ($('btnOverlayPp')) $('btnOverlayPp').onclick = function () { setOverlayMode('pp'); };
        if ($('btnOverlayOff')) $('btnOverlayOff').onclick = function () { setOverlay(null); };
        if ($('btnUndoPt')) $('btnUndoPt').onclick = undoMove;
        if ($('btnWalk')) $('btnWalk').onclick = function () {
            if (walkOn) stopWalk();
            else startWalk();
        };
        if ($('btnWalkNext')) $('btnWalkNext').onclick = walkNext;
        if ($('btnWalkSkip')) $('btnWalkSkip').onclick = walkSkip;
        if ($('btnWalkDone')) $('btnWalkDone').onclick = stopWalk;
        if ($('btnResetView')) $('btnResetView').onclick = resetView;
        window.addEventListener('keydown', function (e) {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key !== 'z' && e.key !== 'Z') return;
            if (e.shiftKey) return;
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            undoMove();
        });
        window.addEventListener('resize', draw);
        c.addEventListener('dragover', function (e) { e.preventDefault(); });
        c.addEventListener('drop', function (e) {
            e.preventDefault();
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) loadFile(f);
        });
        try {
            var chOpen = new BroadcastChannel(TRACE_CH);
            chOpen.onmessage = function (ev) {
                var d = ev && ev.data;
                if (!d || d.type !== 'banana.ceph.open' || !d.ctx) return;
                acceptOpen(d.ctx);
            };
        } catch (eCh) { /* ignore */ }
        window.addEventListener('storage', function (ev) {
            if (!ev || ev.key !== 'banana.ceph.v1' || !ev.newValue) return;
            try { acceptOpen(JSON.parse(ev.newValue)); } catch (eS) { /* ignore */ }
        });
    }

    window.CEPH_PAGE = {
        loadUrl: loadUrl,
        markedDataUrl: markedDataUrl,
        openFromStrip: function (url, name, extra) {
            extra = extra || {};
            if (!ctxInfo) ctxInfo = {};
            var nextId = extra.xrayId ? String(extra.xrayId) : '';
            if (nextId && ctxInfo.xrayId && nextId !== String(ctxInfo.xrayId)) {
                ctxInfo.tracing = null;
                ctxInfo.tracingVia = '';
            }
            ctxInfo.viaStrip = true;
            ctxInfo.userPick = true;
            ctxInfo.studyUrl = url || extra.studyUrl || ctxInfo.studyUrl || '';
            ctxInfo.fileName = name || extra.fileName || ctxInfo.fileName || '';
            ctxInfo.xrayType = extra.xrayType || ctxInfo.xrayType || 'Cephalometric';
            if (extra.xrayId) ctxInfo.xrayId = extra.xrayId;
            if (extra.patientId) ctxInfo.patientId = extra.patientId;
            return loadUrl(ctxInfo.studyUrl, ctxInfo.fileName);
        },
        loadFile: loadFile,
        runDetect: runDetect,
        exportJson: exportJson,
        exportCsv: exportCsv,
        csvText: csvText,
        openExtractNotes: openExtractNotes,
        movePoint: function (id, x, y) { return setPointAt(id, { x: x, y: y }, true); },
        exportPng: exportPng,
        exportPdf: exportPdf,
        includeSelected: includeSelected,
        setUseTraining: writeUseTraining,
        setRefMode: setRefMode,
        setNormSet: writeNormSet,
        setAgeBand: writeAge,
        setSexBand: writeSex,
        setCvm: writeCvm,
        autoCvm: pullCvmApi,
        calibrate: applyRuler,
        startCalibrate: startCalibrate,
        highlightMeasure: highlightMeasure,
        undoMove: undoMove,
        resetView: resetView,
        setInvert: setInvert,
        setFilmLook: setFilmLook,
        setFhUp: setFhUp,
        setOverlay: setOverlay,
        setOverlayMode: setOverlayMode,
        startWalk: startWalk,
        walkNext: walkNext,
        walkSkip: walkSkip,
        walkStop: stopWalk,
        saveTrace: saveTrace,
        publishSourceFile: publishSourceFile,
        loadTrace: loadTrace,
        printReport: printReport,
        setLabMode: setLabMode,
        qaScan: qaScan,
        extra: function () { return extra; },
        adoptSet: function (i) { return previewSet(i, true); },
        lockAdopt: lockAdopt,
        showSetBar: showSetBar,
        sets: setMeta,
        learnStats: function () { return window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 }; },
        state: function () {
            var last = window.__cephLast || {};
            var keys = Object.keys(pts || {}).filter(function (k) { return pts[k] && pts[k].x; });
            var st = window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 };
            return {
                fileName: fileName,
                viaStrip: !!(ctxInfo && ctxInfo.viaStrip),
                xrayType: (ctxInfo && ctxInfo.xrayType) || '',
                xrayId: (ctxInfo && ctxInfo.xrayId) || '',
                source: source,
                imgW: img.naturalWidth || 0,
                imgH: img.naturalHeight || 0,
                nPts: keys.length,
                pts: pts,
                sna: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].value,
                snaBand: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].band,
                snaNorm: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].norm,
                normSet: (last.result && last.result.normSet) || normSet,
                ageBand: ageBand,
                sexBand: sexBand,
                cvm: cvmStageN || 0,
                cvmVia: cvmVia || '',
                cvmId: last.result && last.result.cvm && last.result.cvm.id,
                cvmComment: last.result && last.result.summary && last.result.summary.cvmComment,
                groups: last.result ? last.result.groups.map(function (g) { return g.id; }) : [],
                patient: ctxInfo,
                publishedFilms: publishedN(),
                publishedSource: (sets[setIndex] && sets[setIndex].publishedSource) || (lastDetect && lastDetect.publishedSource),
                trainingSource: (sets[setIndex] && sets[setIndex].trainingSource) || (lastDetect && lastDetect.trainingSource),
                clinicFilms: st.films,
                clinicPoints: st.points,
                useTraining: !!useTraining,
                setIndex: setIndex,
                nSets: sets.length,
                setId: sets[setIndex] && sets[setIndex].id,
                setLabel: sets[setIndex] && sets[setIndex].label,
                setBarHidden: !!setBarHidden,
                calibrated: !!calibrated,
                mmPerPx: mmPerPx,
                extra: extra,
                hiMeasure: hiMeasure,
                viewZoom: viewZoom,
                invert: !!invertFilm,
                filmBright: filmBright,
                filmContrast: filmContrast,
                fhUp: !!fhUp,
                fhRotDeg: Math.round(fhRot() * 1800 / Math.PI) / 10,
                profileN: lastProfileN,
                overlayOn: !!overlayMapped,
                overlayMode: overlayMode,
                walkOn: !!walkOn,
                walkId: walkOn ? (WALK_IDS[walkIdx] || '') : '',
                walkIdx: walkIdx,
                overlayN: overlayMapped ? Object.keys(overlayMapped).length : 0,
                summary: last.result && last.result.summary,
                labOpen: !!labOpen,
                restoreVia: restoreVia,
                hasSavedTrace: !!pendingTrace(),
                qa: Object.keys(qaIds),
                selected: placedIds(),
                undoN: undoStack.length,
                extractScore: last.result && last.result.extraction && last.result.extraction.score,
                extractBand: last.result && last.result.extraction && last.result.extraction.band,
                extractLabel: last.result && last.result.extraction && last.result.extraction.label,
                extractNote: last.result && last.result.extraction && last.result.extraction.note,
                extractHint: last.result && last.result.extraction && last.result.extraction.hint,
                extractWhy: last.result && last.result.summary && last.result.summary.extractionWhy
            };
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
