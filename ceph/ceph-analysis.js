/* Common lateral cephalometric analyses from the ISBI 19 landmarks.
   Methods follow the MIT cephalometric web apps (alexcorvi/cephalometric,
   tjandrayana/ortho-cephalometry): Steiner, Downs, Tweed, Wits, McNamara.
   Degrees are scale-free. Linear values use mmPerPx (ISBI default 0.1).
   Norm sets: Caucasian textbook vs Southern Chinese / Hong Kong adult composite. */
(function (g) {
    function pt(pts, id) {
        var p = pts && pts[id];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return null;
        return p;
    }
    function dist(a, b) {
        return Math.hypot(b.x - a.x, b.y - a.y);
    }
    function ang3(a, b, c) {
        var v1x = a.x - b.x, v1y = a.y - b.y;
        var v2x = c.x - b.x, v2y = c.y - b.y;
        var n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
        if (!n1 || !n2) return null;
        var cos = (v1x * v2x + v1y * v2y) / (n1 * n2);
        if (cos > 1) cos = 1;
        if (cos < -1) cos = -1;
        return Math.acos(cos) * 180 / Math.PI;
    }
    function lineAng(a, b) {
        return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    }
    function planeAng(a1, a2, b1, b2) {
        var d = Math.abs(lineAng(a1, a2) - lineAng(b1, b2));
        while (d > 90) d = Math.abs(d - 180);
        return d;
    }
    /* Interincisal is the larger angle between the two long axes (~120–140°), not the acute fold. */
    function dentalAng(a1, a2, b1, b2) {
        if (!a1 || !a2 || !b1 || !b2) return null;
        var a = planeAng(a1, a2, b1, b2);
        return a == null ? null : (180 - a);
    }
    /* Downs convexity: 180 − ∠N-A-Pog, positive when A is on the facial side of N–Pog. */
    function convexityDeg(N, A, Pog, face) {
        if (!N || !A || !Pog) return null;
        var mag = 180 - ang3(N, A, Pog);
        if (!isFinite(mag)) return null;
        if (face && face !== A) {
            var fs = signedDistToLine(face, N, Pog);
            var as = signedDistToLine(A, N, Pog);
            if (fs !== 0 && as * fs < 0) mag = -mag;
        }
        return mag;
    }
    function project(p, a, b) {
        var vx = b.x - a.x, vy = b.y - a.y;
        var L = vx * vx + vy * vy;
        if (!L) return { x: a.x, y: a.y };
        var t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L;
        return { x: a.x + t * vx, y: a.y + t * vy };
    }
    function signedDistToLine(p, a, b) {
        var vx = b.x - a.x, vy = b.y - a.y;
        var L = Math.hypot(vx, vy);
        if (!L) return 0;
        return ((p.x - a.x) * vy - (p.y - a.y) * vx) / L;
    }
    function round1(n) {
        return Math.round(n * 10) / 10;
    }
    function fmtN(n) {
        if (n < 0) return '−' + String(Math.abs(round1(n)));
        if (n > 0) return '+' + String(round1(n));
        return String(round1(n));
    }
    function formatSpec(spec) {
        if (!spec) return '';
        if (spec.mean != null && spec.sd != null) return round1(spec.mean) + ' ± ' + round1(spec.sd);
        if (spec.lo != null && spec.hi != null) return fmtN(spec.lo).replace(/^\+/, '') + ' to ' + fmtN(spec.hi);
        return '';
    }
    function score(value, spec) {
        var out = { band: '', delta: null };
        if (value == null || !isFinite(value) || !spec) return out;
        if (spec.mean != null && spec.sd != null && spec.sd > 0) {
            var d = value - spec.mean;
            var a = Math.abs(d);
            out.delta = round1(d);
            out.band = a <= spec.sd ? 'in' : (a <= 2 * spec.sd ? 'warn' : 'out');
            return out;
        }
        if (spec.lo != null && spec.hi != null) {
            if (value >= spec.lo && value <= spec.hi) out.band = 'in';
            else {
                var pad = Math.max(1, (spec.hi - spec.lo) * 0.25);
                out.band = (value >= spec.lo - pad && value <= spec.hi + pad) ? 'warn' : 'out';
            }
        }
        return out;
    }

    /* Caucasian: Steiner / Downs / Tweed textbook adults.
       Chinese: Southern Chinese / Hong Kong adult composite (Chan 1972 Cantonese;
       Cooke & Wei 1988 HK Chinese vs British Caucasian). Linear McNamara ranges
       stay similar; ANB Class I sits higher than the Caucasian 2°. */
    var SETS = {
        caucasian: {
            id: 'caucasian',
            label: 'Caucasian',
            source: 'Caucasian adult textbook (Steiner / Downs / Tweed / McNamara)',
            measures: {
                SNA: { mean: 82, sd: 2 },
                SNB: { mean: 80, sd: 2 },
                ANB: { mean: 2, sd: 2 },
                'SN–GoGn': { mean: 32, sd: 5 },
                Interincisal: { mean: 130, sd: 6 },
                'Facial angle': { mean: 87.8, sd: 3.6 },
                'Angle of convexity': { mean: 0, sd: 5 },
                'Y-axis': { mean: 59.4, sd: 3.8 },
                'FH–MP': { mean: 21.9, sd: 3.2 },
                FMA: { mean: 25, sd: 3 },
                IMPA: { mean: 90, sd: 5 },
                FMIA: { mean: 65, sd: 3 },
                'AO–BO': { mean: 0, sd: 2 },
                'A to N-perp': { mean: 1, sd: 2 },
                'Pog to N-perp': { lo: -2, hi: 4 },
                'Ls to Sn–PogS': { mean: 0, sd: 2 },
                'Li to Sn–PogS': { mean: 0, sd: 2 }
            }
        },
        chinese: {
            id: 'chinese',
            label: 'HK Chinese',
            source: 'Southern Chinese / Hong Kong adult (Chan 1972; Cooke & Wei 1988)',
            measures: {
                SNA: { mean: 83.8, sd: 3.2 },
                SNB: { mean: 80.0, sd: 3.2 },
                ANB: { mean: 3.5, sd: 2.0 },
                'SN–GoGn': { mean: 34.5, sd: 4.5 },
                Interincisal: { mean: 124, sd: 8 },
                'Facial angle': { mean: 85.0, sd: 3.5 },
                'Angle of convexity': { mean: 6, sd: 5 },
                'Y-axis': { mean: 63.0, sd: 4.0 },
                'FH–MP': { mean: 26.0, sd: 4.0 },
                FMA: { mean: 28, sd: 4 },
                IMPA: { mean: 93, sd: 6 },
                FMIA: { mean: 59, sd: 5 },
                'AO–BO': { mean: -1, sd: 3 },
                'A to N-perp': { mean: 1, sd: 3 },
                'Pog to N-perp': { lo: -6, hi: 2 },
                'Ls to Sn–PogS': { mean: 2, sd: 2 },
                'Li to Sn–PogS': { mean: 2, sd: 2 }
            }
        }
    };

    function listSets() {
        return [
            { id: 'caucasian', label: SETS.caucasian.label, source: SETS.caucasian.source },
            { id: 'chinese', label: SETS.chinese.label, source: SETS.chinese.source }
        ];
    }
    function getSet(id) {
        return SETS[id] || SETS.caucasian;
    }
    function anbClass(anb, spec) {
        if (anb == null) return '';
        var mean = spec && spec.mean != null ? spec.mean : 2;
        var sd = spec && spec.sd != null ? spec.sd : 2;
        if (anb > mean + sd) return 'skeletal Class II tendency';
        if (anb < mean - sd) return 'skeletal Class III tendency';
        return 'skeletal Class I';
    }
    function row(set, name, value, unit, note) {
        var spec = set.measures[name];
        var sc = score(value, spec);
        return {
            name: name,
            value: value == null || !isFinite(value) ? null : round1(value),
            unit: unit || '°',
            norm: formatSpec(spec),
            note: note || '',
            band: sc.band,
            delta: sc.delta
        };
    }

    function extraPt(extra, id, fallback) {
        var p = extra && extra[id];
        if (p && isFinite(p.x) && isFinite(p.y)) return p;
        return fallback || null;
    }
    function nPerpMm(p, N, Po, Or, mmPerPx) {
        if (!p || !N || !Po || !Or) return null;
        var fx = Or.x - Po.x, fy = Or.y - Po.y;
        if (!Math.hypot(fx, fy)) return null;
        var lx = -fy, ly = fx;
        var d = signedDistToLine(p, N, { x: N.x + lx, y: N.y + ly });
        return d * mmPerPx;
    }
    function witsMm(A, B, p1, p2, mmPerPx) {
        if (!A || !B || !p1 || !p2) return null;
        var ao = project(A, p1, p2);
        var bo = project(B, p1, p2);
        var dirx = p2.x - p1.x, diry = p2.y - p1.y;
        var L = Math.hypot(dirx, diry);
        if (!L) return null;
        var tA = ((ao.x - p1.x) * dirx + (ao.y - p1.y) * diry) / L;
        var tB = ((bo.x - p1.x) * dirx + (bo.y - p1.y) * diry) / L;
        var signed = tA - tB;
        if (dirx < 0) signed = -signed;
        return signed * mmPerPx;
    }

    function run(pts, mmPerPx, opts) {
        mmPerPx = Number(mmPerPx);
        if (!isFinite(mmPerPx) || mmPerPx <= 0) mmPerPx = 0.1;
        opts = opts || {};
        var set = getSet(opts.normSet);
        var S = pt(pts, 'S'), N = pt(pts, 'N'), A = pt(pts, 'A'), B = pt(pts, 'B');
        var Pog = pt(pts, 'Pog'), Me = pt(pts, 'Me'), Gn = pt(pts, 'Gn'), Go = pt(pts, 'Go');
        var Or = pt(pts, 'Or'), Po = pt(pts, 'Po'), U1 = pt(pts, 'U1'), L1 = pt(pts, 'L1');
        var ANS = pt(pts, 'ANS'), PNS = pt(pts, 'PNS'), Ar = pt(pts, 'Ar');
        var Ls = pt(pts, 'Ls'), Li = pt(pts, 'Li'), Sn = pt(pts, 'Sn'), PogS = pt(pts, 'PogS');
        var extra = opts.extra || {};
        var L1a = extraPt(extra, 'L1a', L1 ? { x: L1.x - 16, y: L1.y + 36 } : null);
        var U1a = extraPt(extra, 'U1a', U1 ? { x: U1.x - 18, y: U1.y - 36 } : null);
        var FopA = extraPt(extra, 'FopA', U1);
        var FopP = extraPt(extra, 'FopP', L1);
        var usedFop = !!(extra.FopA && extra.FopP);
        var usedApex = !!(extra.L1a || extra.U1a);
        var sna = (S && N && A) ? ang3(S, N, A) : null;
        var snb = (S && N && B) ? ang3(S, N, B) : null;
        var anb = (sna != null && snb != null) ? (sna - snb) : ((A && N && B) ? ang3(A, N, B) : null);
        var snMp = (S && N && Go && Gn) ? planeAng(S, N, Go, Gn) : null;
        var fma = (Po && Or && Go && Me) ? planeAng(Po, Or, Go, Me) : null;
        var fmia = (Po && Or && L1 && L1a) ? planeAng(Po, Or, L1a, L1) : null;
        var impa = (fma != null && fmia != null) ? (180 - fma - fmia)
            : ((L1 && L1a && Go && Me) ? planeAng(L1a, L1, Go, Me) : null);
        var inter = (U1 && U1a && L1 && L1a) ? dentalAng(U1a, U1, L1a, L1) : null;
        var facial = (Po && Or && N && Pog) ? planeAng(Po, Or, N, Pog) : null;
        var convex = convexityDeg(N, A, Pog, ANS || U1);
        var yaxis = (Po && Or && S && Gn) ? planeAng(Po, Or, S, Gn) : null;
        var wits = witsMm(A, B, FopA, FopP, mmPerPx);
        var nperpA = nPerpMm(A, N, Po, Or, mmPerPx);
        var nperpPog = nPerpMm(Pog, N, Po, Or, mmPerPx);
        var ansMe = (ANS && Me) ? dist(ANS, Me) * mmPerPx : null;
        var nMe = (N && Me) ? dist(N, Me) * mmPerPx : null;
        var sGo = (S && Go) ? dist(S, Go) * mmPerPx : null;
        var arGo = (Ar && Go) ? dist(Ar, Go) * mmPerPx : null;
        var lsLine = (Ls && Sn && PogS) ? signedDistToLine(Ls, Sn, PogS) * mmPerPx : null;
        var liLine = (Li && Sn && PogS) ? signedDistToLine(Li, Sn, PogS) * mmPerPx : null;

        var result = {
            mmPerPx: mmPerPx,
            calibrated: !!opts.calibrated,
            normSet: set.id,
            normLabel: set.label,
            normSource: set.source,
            groups: [
                {
                    id: 'steiner',
                    title: 'Steiner',
                    rows: [
                        row(set, 'SNA', sna, '°'),
                        row(set, 'SNB', snb, '°'),
                        row(set, 'ANB', anb, '°', anbClass(anb, set.measures.ANB)),
                        row(set, 'SN–GoGn', snMp, '°'),
                        row(set, 'Interincisal', inter, '°', usedApex ? 'U1a-U1 / L1a-L1' : 'approx (drag U1a / L1a)')
                    ]
                },
                {
                    id: 'downs',
                    title: 'Downs',
                    rows: [
                        row(set, 'Facial angle', facial, '°'),
                        row(set, 'Angle of convexity', convex, '°'),
                        row(set, 'Y-axis', yaxis, '°'),
                        row(set, 'FH–MP', fma, '°')
                    ]
                },
                {
                    id: 'tweed',
                    title: 'Tweed',
                    rows: [
                        row(set, 'FMA', fma, '°'),
                        row(set, 'IMPA', impa, '°', usedApex ? 'L1–L1a vs MP' : 'approx (drag L1a)'),
                        row(set, 'FMIA', fmia, '°', usedApex ? 'L1–L1a vs FH' : 'approx (drag L1a)')
                    ]
                },
                {
                    id: 'wits',
                    title: 'Wits',
                    rows: [
                        row(set, 'AO–BO', wits, 'mm', usedFop ? 'on FOP' : 'proxy U1-L1 (drag FopA / FopP)')
                    ]
                },
                {
                    id: 'mcnamara',
                    title: 'McNamara',
                    rows: [
                        row(set, 'A to N-perp', nperpA, 'mm', 'N-perp to FH'),
                        row(set, 'Pog to N-perp', nperpPog, 'mm', 'N-perp to FH'),
                        row(set, 'ANS–Me', ansMe, 'mm'),
                        row(set, 'N–Me', nMe, 'mm'),
                        row(set, 'S–Go', sGo, 'mm'),
                        row(set, 'Ar–Go', arGo, 'mm')
                    ]
                },
                {
                    id: 'soft',
                    title: 'Soft tissue',
                    rows: [
                        row(set, 'Ls to Sn–PogS', lsLine, 'mm', 'Steiner S-line (Sn–Pog′)'),
                        row(set, 'Li to Sn–PogS', liLine, 'mm', 'Steiner S-line (Sn–Pog′)')
                    ]
                }
            ]
        };
        if (!opts.calibrated) {
            result.groups.forEach(function (g) {
                (g.rows || []).forEach(function (r) {
                    if (r.unit !== 'mm') return;
                    r.band = '';
                    r.delta = null;
                    r.note = r.note ? (r.note + '; not calibrated') : 'not calibrated';
                });
            });
        }
        result.extraction = extractionIndex(result);
        result.groups.push({
            id: 'extract',
            title: 'Extraction index',
            rows: [{
                name: 'Extraction index',
                value: result.extraction.score,
                unit: '',
                norm: '50 undecided',
                delta: result.extraction.score - 50,
                band: result.extraction.tableBand,
                note: result.extraction.note
            }]
        });
        result.summary = summarise(result);
        if (result.summary && result.extraction) {
            result.summary.extraction = result.extraction.label + ' ' + result.extraction.score;
            result.summary.extractionBand = result.extraction.band;
            result.summary.extractionHint = result.extraction.hint;
            result.summary.extractionWhy = result.extraction.why;
            result.summary.extractionReasons = result.extraction.reasons || [];
            result.summary.extractionNote = result.extraction.note;
        }
        return result;
    }

    function findRow(result, groupId, name) {
        var g = (result.groups || []).filter(function (x) { return x.id === groupId; })[0];
        if (!g) return null;
        return (g.rows || []).filter(function (x) { return x.name === name; })[0] || null;
    }
    function summarise(result) {
        var anb = findRow(result, 'steiner', 'ANB');
        var mp = findRow(result, 'steiner', 'SN–GoGn');
        var conv = findRow(result, 'downs', 'Angle of convexity');
        var impa = findRow(result, 'tweed', 'IMPA');
        var ls = findRow(result, 'soft', 'Ls to Sn–PogS');
        var skeletal = (anb && anb.note) || '—';
        var vertical = 'average';
        if (mp && mp.delta != null) {
            if (mp.band === 'out' || (mp.band === 'warn' && Math.abs(mp.delta) > 0)) {
                vertical = mp.delta > 0 ? 'high-angle' : 'low-angle';
            }
        }
        var profile = 'straight';
        if (conv && conv.delta != null) {
            if (conv.delta > 2) profile = 'convex';
            else if (conv.delta < -2) profile = 'concave';
        }
        var incisor = 'average';
        if (impa && impa.delta != null) {
            if (impa.delta > 2) incisor = 'proclined';
            else if (impa.delta < -2) incisor = 'retroclined';
        }
        var lip = '—';
        if (ls && ls.delta != null) lip = ls.delta > 1 ? 'protrusive' : (ls.delta < -1 ? 'retrusive' : 'balanced');
        return {
            skeletal: skeletal,
            vertical: vertical,
            profile: profile,
            incisor: incisor,
            lip: lip,
            lines: [
                skeletal,
                vertical + ' mandible',
                profile + ' profile',
                incisor + ' lower incisors',
                'upper lip ' + lip
            ]
        };
    }

    /* Ceph-only extraction tendency vs the selected norm set.
       Not a treatment plan: crowding, Bolton, growth and the chart are absent. */
    function tilt(row, wOut, wWarn, invert) {
        if (!row || row.delta == null || !row.band || row.band === 'in') return 0;
        var w = row.band === 'out' ? wOut : (row.band === 'warn' ? wWarn : 0);
        if (!w) return 0;
        var high = row.delta > 0;
        var towardExtract = invert ? !high : high;
        return towardExtract ? w : -w;
    }
    function addWhy(why, pts, plus, minus) {
        if (pts >= 6 && plus) why.push({ t: plus, w: pts });
        else if (pts <= -6 && minus) why.push({ t: minus, w: pts });
    }
    function extractionIndex(result) {
        var score = 50;
        var why = [];
        var hint = 'ceph guidance only; crowding not assessed';
        var impa = findRow(result, 'tweed', 'IMPA');
        var fmia = findRow(result, 'tweed', 'FMIA');
        var inter = findRow(result, 'steiner', 'Interincisal');
        var conv = findRow(result, 'downs', 'Angle of convexity');
        var anb = findRow(result, 'steiner', 'ANB');
        var mp = findRow(result, 'steiner', 'SN–GoGn');
        var ls = findRow(result, 'soft', 'Ls to Sn–PogS');
        var li = findRow(result, 'soft', 'Li to Sn–PogS');
        var wits = findRow(result, 'wits', 'AO–BO');
        var t;
        t = tilt(impa, 15, 8, false);
        score += t;
        addWhy(why, t, 'proclined lower incisors (IMPA)', 'retroclined lower incisors');
        t = tilt(inter, 15, 8, true);
        score += t;
        addWhy(why, t, 'acute interincisal (bimax)', 'obtuse interincisal');
        t = tilt(conv, 10, 6, false);
        score += t;
        addWhy(why, t, 'convex profile', 'concave profile');
        t = tilt(fmia, 10, 6, true);
        score += t;
        addWhy(why, t, 'low FMIA (Tweed)', 'high FMIA');
        t = tilt(ls, 12, 8, false);
        score += t;
        addWhy(why, t, 'upper lip ahead of S-line', 'retrusive upper lip');
        t = tilt(li, 10, 6, false);
        score += t;
        addWhy(why, t, 'lower lip ahead of S-line', 'retrusive lower lip');
        if (anb && anb.delta != null && anb.band && anb.band !== 'in') {
            if (anb.delta > 0) {
                t = anb.band === 'out' ? 12 : 8;
                score += t;
                why.push({ t: 'Class II skeletal (upper-arch camouflage)', w: t });
                hint = 'Class II camouflage (upper premolars more often than 4 premolars)';
            } else {
                hint = 'Class III: lower-arch camouflage or surgery; not a 4-premolar pattern';
                why.push({ t: 'Class III skeletal (not scored as 4-premolar extraction)', w: -1 });
            }
        }
        if (wits && wits.delta != null && wits.band && wits.band !== 'in' && wits.delta > 0) {
            t = wits.band === 'out' ? 8 : 5;
            score += t;
            why.push({ t: 'Wits Class II', w: t });
        }
        if (mp && mp.delta != null && mp.delta > 0 && mp.band === 'out') {
            score -= 4;
            why.push({ t: 'high-angle: retract with vertical control', w: -4 });
        }
        if (score < 0) score = 0;
        if (score > 100) score = 100;
        var band = 'borderline';
        var label = 'Borderline';
        var tableBand = 'warn';
        if (score <= 34) { band = 'low'; label = 'Low'; tableBand = 'in'; }
        else if (score <= 54) { band = 'borderline'; label = 'Borderline'; tableBand = 'warn'; }
        else if (score <= 74) { band = 'moderate'; label = 'Moderate'; tableBand = 'warn'; }
        else { band = 'high'; label = 'High'; tableBand = 'out'; }
        why.sort(function (a, b) { return Math.abs(b.w) - Math.abs(a.w); });
        var texts = why.map(function (x) { return x.t; });
        var top = texts.slice(0, 3);
        var note = (texts.length ? texts.join('; ') + '. ' : '') +
            'Ceph only; crowding / Bolton / growth not assessed. Not a treatment plan.';
        return {
            score: score,
            band: band,
            label: label,
            tableBand: tableBand,
            hint: hint,
            why: top.join(' + ') || 'angles near this norm set',
            reasons: top,
            note: note
        };
    }

    function csvSafe(v) {
        if (v == null) return '';
        return String(v)
            .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, '-')
            .replace(/\u00B1/g, '+/-')
            .replace(/\u00B0/g, 'deg')
            .replace(/[\u2032\u2033]/g, "'");
    }
    function toCsv(result) {
        result = result || {};
        var lines = ['analysis,measurement,value,unit,norm,delta,band,note'];
        (result.groups || []).forEach(function (g) {
            (g.rows || []).forEach(function (r) {
                lines.push([g.title, r.name, r.value == null ? '' : r.value, r.unit, r.norm,
                    r.delta == null ? '' : r.delta, r.band || '', r.note]
                    .map(function (x) { return '"' + csvSafe(x).replace(/"/g, '""') + '"'; }).join(','));
            });
        });
        return '\uFEFF' + lines.join('\r\n');
    }

    g.CEPH_AN = {
        run: run,
        toCsv: toCsv,
        ang3: ang3,
        dist: dist,
        planeAng: planeAng,
        dentalAng: dentalAng,
        convexityDeg: convexityDeg,
        listSets: listSets,
        getSet: getSet,
        score: score,
        nPerpMm: nPerpMm,
        witsMm: witsMm,
        summarise: summarise,
        extractionIndex: extractionIndex
    };
})(typeof window !== 'undefined' ? window : this);
