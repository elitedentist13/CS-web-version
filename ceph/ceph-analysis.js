/* Common lateral cephalometric analyses from the ISBI 19 landmarks.
   Methods follow the MIT cephalometric web apps (alexcorvi/cephalometric,
   tjandrayana/ortho-cephalometry): Steiner, Downs, Tweed, Wits, McNamara.
   Degrees are scale-free. Linear values use mmPerPx (ISBI default 0.1). */
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
    function row(name, value, unit, norm, note) {
        return {
            name: name,
            value: value == null || !isFinite(value) ? null : Math.round(value * 10) / 10,
            unit: unit || '°',
            norm: norm || '',
            note: note || ''
        };
    }
    function anbClass(anb) {
        if (anb == null) return '';
        if (anb > 4) return 'skeletal Class II tendency';
        if (anb < 0) return 'skeletal Class III tendency';
        return 'skeletal Class I';
    }

    function run(pts, mmPerPx) {
        mmPerPx = Number(mmPerPx);
        if (!isFinite(mmPerPx) || mmPerPx <= 0) mmPerPx = 0.1;
        var S = pt(pts, 'S'), N = pt(pts, 'N'), A = pt(pts, 'A'), B = pt(pts, 'B');
        var Pog = pt(pts, 'Pog'), Me = pt(pts, 'Me'), Gn = pt(pts, 'Gn'), Go = pt(pts, 'Go');
        var Or = pt(pts, 'Or'), Po = pt(pts, 'Po'), U1 = pt(pts, 'U1'), L1 = pt(pts, 'L1');
        var ANS = pt(pts, 'ANS'), PNS = pt(pts, 'PNS'), Ar = pt(pts, 'Ar');
        var sna = (S && N && A) ? ang3(S, N, A) : null;
        var snb = (S && N && B) ? ang3(S, N, B) : null;
        var anb = (sna != null && snb != null) ? (sna - snb) : ((A && N && B) ? ang3(A, N, B) : null);
        var snMp = (S && N && Go && Gn) ? planeAng(S, N, Go, Gn) : null;
        var fma = (Po && Or && Go && Me) ? planeAng(Po, Or, Go, Me) : null;
        var impa = (L1 && Go && Me) ? planeAng(L1, { x: L1.x, y: L1.y - 40 }, Go, Me) : null;
        if (L1 && Go && Me) {
            var apexGuess = { x: L1.x - 8, y: L1.y + 28 };
            impa = planeAng(apexGuess, L1, Go, Me);
        }
        var fmia = (Po && Or && L1) ? planeAng(Po, Or, L1, { x: L1.x - 8, y: L1.y + 28 }) : null;
        var inter = (U1 && L1) ? planeAng(U1, { x: U1.x - 6, y: U1.y + 26 }, L1, { x: L1.x - 8, y: L1.y + 28 }) : null;
        var facial = (Po && Or && N && Pog) ? planeAng(Po, Or, N, Pog) : null;
        var convex = (N && A && Pog) ? ang3(N, A, Pog) : null;
        var yaxis = (Po && Or && S && Gn) ? planeAng(Po, Or, S, Gn) : null;
        var wits = null;
        if (A && B && U1 && L1) {
            var ao = project(A, U1, L1);
            var bo = project(B, U1, L1);
            wits = dist(ao, bo) * mmPerPx;
            if (ao.x < bo.x) wits = -wits;
        }
        var nperpA = null, nperpPog = null;
        if (N && Po && Or && A) {
            var fh1 = Po, fh2 = Or;
            var nA = project(A, N, { x: N.x + (fh2.x - fh1.x), y: N.y + (fh2.y - fh1.y) });
            nperpA = signedDistToLine(A, N, { x: N.x, y: N.y + 100 }) * mmPerPx;
            nperpA = Math.abs(A.x - N.x) * mmPerPx * (A.x >= N.x ? 1 : -1);
        }
        if (N && Pog) nperpPog = Math.abs(Pog.x - N.x) * mmPerPx * (Pog.x >= N.x ? 1 : -1);
        var ansMe = (ANS && Me) ? dist(ANS, Me) * mmPerPx : null;
        var nMe = (N && Me) ? dist(N, Me) * mmPerPx : null;
        var sGo = (S && Go) ? dist(S, Go) * mmPerPx : null;
        var arGo = (Ar && Go) ? dist(Ar, Go) * mmPerPx : null;

        return {
            mmPerPx: mmPerPx,
            groups: [
                {
                    id: 'steiner',
                    title: 'Steiner',
                    rows: [
                        row('SNA', sna, '°', '82 ± 2'),
                        row('SNB', snb, '°', '80 ± 2'),
                        row('ANB', anb, '°', '2 ± 2', anbClass(anb)),
                        row('SN–GoGn', snMp, '°', '32 ± 5'),
                        row('Interincisal', inter, '°', '130 ± 6')
                    ]
                },
                {
                    id: 'downs',
                    title: 'Downs',
                    rows: [
                        row('Facial angle', facial, '°', '87.8 ± 3.6'),
                        row('Angle of convexity', convex, '°', '0 ± 5'),
                        row('Y-axis', yaxis, '°', '59.4 ± 3.8'),
                        row('FH–MP', fma, '°', '21.9 ± 3.2')
                    ]
                },
                {
                    id: 'tweed',
                    title: 'Tweed',
                    rows: [
                        row('FMA', fma, '°', '25 ± 3'),
                        row('IMPA', impa, '°', '90 ± 5'),
                        row('FMIA', fmia, '°', '65 ± 3')
                    ]
                },
                {
                    id: 'wits',
                    title: 'Wits',
                    rows: [
                        row('AO–BO', wits, 'mm', '0 ± 2', 'on U1–L1 occlusal')
                    ]
                },
                {
                    id: 'mcnamara',
                    title: 'McNamara',
                    rows: [
                        row('A to N-perp', nperpA, 'mm', '1 ± 2'),
                        row('Pog to N-perp', nperpPog, 'mm', '−2 to +4'),
                        row('ANS–Me', ansMe, 'mm', ''),
                        row('N–Me', nMe, 'mm', ''),
                        row('S–Go', sGo, 'mm', ''),
                        row('Ar–Go', arGo, 'mm', '')
                    ]
                }
            ]
        };
    }

    function toCsv(result) {
        var lines = ['analysis,measurement,value,unit,norm,note'];
        (result.groups || []).forEach(function (g) {
            (g.rows || []).forEach(function (r) {
                lines.push([g.title, r.name, r.value == null ? '' : r.value, r.unit, r.norm, r.note]
                    .map(function (x) { return '"' + String(x).replace(/"/g, '""') + '"'; }).join(','));
            });
        });
        return lines.join('\n');
    }

    g.CEPH_AN = { run: run, toCsv: toCsv, ang3: ang3, dist: dist, planeAng: planeAng };
})(typeof window !== 'undefined' ? window : this);
