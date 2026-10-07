/* Banana Dicom Reader — virtual implant overlay (planning only, not a surgical guide). */
(function () {
    var ENGINE_ID = 'banana-cs3d';
    var VP = { AX: 'CS3D_AXIAL', SAG: 'CS3D_SAGITTAL', COR: 'CS3D_CORONAL', VOL: 'CS3D_VOLUME' };
    var COLORS = ['#fbbf24', '#34d399', '#38bdf8', '#f472b6', '#a78bfa', '#fb7185'];
    var STORE_PREFIX = 'banana.cs3d.implants.v1.';
    var I18N = {
        'cs3d.implant.tool': 'Implant',
        'cs3d.implant.add': 'Add implant',
        'cs3d.implant.disclaimer': 'Visual planning only. Not a surgical guide. Not a substitute for Blue Sky Plan or a CE-marked implant system.',
        'cs3d.implant.needVolume': 'Load a volume first, then place an implant.',
        'cs3d.implant.saved': 'Implant plan saved on this computer (visual planning only).'
    };

    var model = { implants: [], selectedId: '', pivot: 'center', active: false, drawn: 0, i18n: I18N };
    var nSeq = 0;
    var drag = null;
    var hooked = false;
    var suspended = false;
    var redrawTimer = 0;
    var hookedEvents = [];
    var syncing = false;
    var TAPER_TIP = 0.55;

    function $(id) { return document.getElementById(id); }
    function as3(v) {
        if (!v) return [0, 0, 0];
        return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
    }

    function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
    function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
    function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function vLen0(a) { return Math.sqrt(vDot(a, a)); }
    function vLen(a) { return vLen0(a) || 1; }
    function vNorm(a) {
        var L = vLen(a);
        return [a[0] / L, a[1] / L, a[2] / L];
    }
    function vCross(a, b) {
        return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    function vRot(vec, axis, rad) {
        axis = vNorm(axis);
        var c = Math.cos(rad);
        var s = Math.sin(rad);
        var k = vScale(axis, vDot(axis, vec) * (1 - c));
        var cr = vCross(axis, vec);
        return vAdd(vAdd(vScale(vec, c), vScale(cr, s)), k);
    }

    function patientKey() {
        var ctx = window.__bananaCs3dCtx || {};
        return String(ctx.patientId || ctx.patientNo || 'anon');
    }

    function nextId() {
        nSeq += 1;
        return 'imp-' + Date.now().toString(36) + '-' + nSeq;
    }

    function findImp(id) {
        var i;
        for (i = 0; i < model.implants.length; i++) {
            if (model.implants[i].id === id) return model.implants[i];
        }
        return null;
    }

    function headOf(imp) {
        return vAdd(imp.position, vScale(imp.axis, Number(imp.lengthMm) / 2));
    }
    function tipOf(imp) {
        return vAdd(imp.position, vScale(imp.axis, -Number(imp.lengthMm) / 2));
    }
    function pivotOf(imp) {
        if (model.pivot === 'head') return headOf(imp);
        if (model.pivot === 'tip') return tipOf(imp);
        return imp.position.slice();
    }

    function addImplant(opts) {
        opts = opts || {};
        var imp = {
            id: opts.id || nextId(),
            diameterMm: Number(opts.diameterMm) > 0 ? Number(opts.diameterMm) : 4,
            lengthMm: Number(opts.lengthMm) > 0 ? Number(opts.lengthMm) : 10,
            position: as3(opts.position),
            axis: vNorm(as3(opts.axis && opts.axis.length ? opts.axis : [0, 0, 1])),
            locked: !!opts.locked,
            color: opts.color || COLORS[model.implants.length % COLORS.length],
            label: opts.label || String(model.implants.length + 1)
        };
        model.implants.push(imp);
        model.selectedId = imp.id;
        draw();
        paintPanel();
        return imp;
    }

    function serializeImplants() {
        return JSON.stringify({
            v: 1,
            kind: 'banana-cs3d-implant-plan',
            disclaimer: 'Visual planning only. Not a surgical guide.',
            patientId: patientKey(),
            pivot: model.pivot,
            implants: model.implants.map(function (imp) {
                return {
                    id: imp.id,
                    diameterMm: imp.diameterMm,
                    lengthMm: imp.lengthMm,
                    position: as3(imp.position),
                    axis: as3(imp.axis),
                    locked: imp.locked,
                    color: imp.color,
                    label: imp.label
                };
            })
        });
    }

    function loadImplants(raw) {
        var data = raw;
        if (typeof raw === 'string') {
            try { data = JSON.parse(raw); } catch (e) { return 0; }
        }
        if (!data || !Array.isArray(data.implants)) return 0;
        model.implants = [];
        data.implants.forEach(function (row) { addImplant(row); });
        if (data.pivot) model.pivot = data.pivot;
        return model.implants.length;
    }

    function persistKey() { return STORE_PREFIX + patientKey(); }

    function saveImplants() {
        var json = serializeImplants();
        try { localStorage.setItem(persistKey(), json); } catch (e) { /* ignore */ }
        try { sessionStorage.setItem(persistKey(), json); } catch (e2) { /* ignore */ }
        return json;
    }

    function restoreImplants() {
        var raw = '';
        try { raw = sessionStorage.getItem(persistKey()) || ''; } catch (e) { raw = ''; }
        if (!raw) {
            try { raw = localStorage.getItem(persistKey()) || ''; } catch (e2) { raw = ''; }
        }
        if (!raw) return 0;
        model.implants = [];
        return loadImplants(raw);
    }

    function fetchImplants() {
        restoreImplants();
        return serializeImplants();
    }

    function clearImplants() {
        model.implants = [];
        model.selectedId = '';
        model.drawn = 0;
        draw();
        paintPanel();
        return 0;
    }

    function engine() {
        try {
            return window.csCore && window.csCore.getRenderingEngine && window.csCore.getRenderingEngine(ENGINE_ID);
        } catch (e) { return null; }
    }

    function viewport(id) {
        var en = engine();
        return en && en.getViewport ? en.getViewport(id) : null;
    }

    function worldToCanvas(vpId, world) {
        var vp = viewport(vpId);
        if (!vp || !vp.worldToCanvas) return null;
        try { return vp.worldToCanvas(world); } catch (e) { return null; }
    }

    function canvasToWorld(vpId, xy) {
        var vp = viewport(vpId);
        if (!vp || !vp.canvasToWorld) return null;
        try { return vp.canvasToWorld(xy); } catch (e) { return null; }
    }

    function viewNormal(vpId) {
        var plane = cameraPlane(vpId);
        if (plane) return plane.n;
        if (vpId === VP.AX) return [0, 0, 1];
        if (vpId === VP.SAG) return [1, 0, 0];
        if (vpId === VP.COR) return [0, 1, 0];
        return [0, 0, 1];
    }

    function cameraPlane(vpId) {
        var vp = viewport(vpId);
        if (!vp || !vp.getCamera) return null;
        try {
            var cam = vp.getCamera();
            if (!cam || !cam.viewPlaneNormal || !cam.focalPoint) return null;
            var n = vNorm(as3(cam.viewPlaneNormal));
            var origin = as3(cam.focalPoint);
            var up = cam.viewUp ? vNorm(as3(cam.viewUp)) : [0, 1, 0];
            if (Math.abs(vDot(up, n)) > 0.98) up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
            var right = vNorm(vCross(up, n));
            up = vNorm(vCross(n, right));
            return { origin: origin, n: n, up: up, right: right, position: cam.position ? as3(cam.position) : null };
        } catch (e) { return null; }
    }

    function planeDist(world, plane) {
        return vDot(vSub(as3(world), plane.origin), plane.n);
    }

    function projectToPlane(world, plane) {
        return vSub(as3(world), vScale(plane.n, planeDist(world, plane)));
    }

    function sliceSpacingMm(vpId) {
        try {
            var vid = window.CS3D_PAGE && typeof CS3D_PAGE.volumeId === 'function' ? CS3D_PAGE.volumeId() : '';
            var vol = vid && window.csCore && csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(vid);
            if (vol && vol.spacing && vol.spacing.length) {
                var n = viewNormal(vpId);
                var dir = vol.direction;
                if (dir && dir.length >= 9) {
                    var dots = [
                        Math.abs(n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2]),
                        Math.abs(n[0] * dir[3] + n[1] * dir[4] + n[2] * dir[5]),
                        Math.abs(n[0] * dir[6] + n[1] * dir[7] + n[2] * dir[8])
                    ];
                    var i = dots[0] >= dots[1] && dots[0] >= dots[2] ? 0 : (dots[1] >= dots[2] ? 1 : 2);
                    return Number(vol.spacing[i]) || 0.5;
                }
                return Math.min(Number(vol.spacing[0]) || 1, Number(vol.spacing[1]) || 1, Number(vol.spacing[2]) || 1);
            }
        } catch (e) { /* ignore */ }
        return 0.5;
    }

    function mmToCanvas(vpId) {
        var plane = cameraPlane(vpId);
        var a, b;
        if (plane) {
            a = worldToCanvas(vpId, plane.origin);
            b = worldToCanvas(vpId, vAdd(plane.origin, plane.right));
        } else {
            a = worldToCanvas(vpId, [0, 0, 0]);
            b = worldToCanvas(vpId, [1, 0, 0]);
        }
        if (!a || !b) return 4;
        var px = Math.sqrt((a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]));
        return px > 0.05 ? px : 4;
    }

    function jumpSliceToWorld(vpId, world) {
        if (vpId === VP.VOL) return false;
        var vp = viewport(vpId);
        var plane = cameraPlane(vpId);
        if (!vp || !vp.setCamera || !plane) return false;
        var delta = planeDist(world, plane);
        if (!isFinite(delta)) return false;
        if (Math.abs(delta) < 0.12) return true;
        var n = plane.n;
        var cam = { focalPoint: vAdd(plane.origin, vScale(n, delta)) };
        if (plane.position) cam.position = vAdd(plane.position, vScale(n, delta));
        try {
            vp.setCamera(cam);
            return true;
        } catch (e) {
            return false;
        }
    }

    function centerViewportOnWorld(vpId, world) {
        if (vpId === VP.VOL) return false;
        var vp = viewport(vpId);
        if (!vp || !vp.setCamera || !vp.getCamera) return false;
        var canvas = vp.canvas;
        var w = canvas && (canvas.clientWidth || canvas.width) || 0;
        var h = canvas && (canvas.clientHeight || canvas.height) || 0;
        if (w >= 4 && h >= 4 && vp.canvasToWorld) {
            var centerWorld = null;
            try { centerWorld = vp.canvasToWorld([w / 2, h / 2]); } catch (eC) { centerWorld = null; }
            if (centerWorld) {
                var delta = vSub(as3(world), as3(centerWorld));
                if (vLen0(delta) < 0.08) return true;
                var cam = vp.getCamera();
                if (cam && cam.focalPoint && cam.position) {
                    try {
                        vp.setCamera({
                            focalPoint: vAdd(as3(cam.focalPoint), delta),
                            position: vAdd(as3(cam.position), delta)
                        });
                        return true;
                    } catch (eSet) { /* fall through to slice jump */ }
                }
            }
        }
        return jumpSliceToWorld(vpId, world);
    }

    function selectedImplant() {
        return findImp(model.selectedId) || model.implants[0] || null;
    }

    function alignMprToWorld(world) {
        if (!world || syncing || suspended) return 0;
        var en = engine();
        if (!en) return 0;
        syncing = true;
        var n = 0;
        try {
            [VP.AX, VP.SAG, VP.COR].forEach(function (id) {
                if (centerViewportOnWorld(id, world)) n += 1;
            });
            if (en.render) en.render();
        } catch (e) { /* ignore */ }
        syncing = false;
        scheduleDraw();
        return n;
    }

    function alignMprToSelectedImplant() {
        var imp = selectedImplant();
        if (!imp) return null;
        alignMprToWorld(imp.position);
        return as3(imp.position);
    }

    function syncMprToImplant(imp, exceptVpId) {
        if (!imp || syncing || suspended) return 0;
        if (!engine()) return 0;
        syncing = true;
        var n = 0;
        try {
            [VP.AX, VP.SAG, VP.COR].forEach(function (id) {
                if (id === exceptVpId) return;
                if (centerViewportOnWorld(id, imp.position)) n += 1;
            });
        } catch (e) { /* ignore */ }
        syncing = false;
        scheduleDraw();
        return n;
    }

    function implantRadii(imp) {
        var head = Math.max(0.2, Number(imp && imp.diameterMm) / 2);
        var tip = Math.max(0.12, head * TAPER_TIP);
        return { head: head, tip: tip };
    }

    function radiusAt(imp, t) {
        var r = implantRadii(imp);
        t = Math.max(0, Math.min(1, Number(t) || 0));
        return r.tip + (r.head - r.tip) * t;
    }

    function chordHalf(radius, dist) {
        var inside = radius * radius - dist * dist;
        if (inside <= 0) return Math.max(0.12, radius * 0.2);
        return Math.sqrt(inside);
    }

    function cylinderSlice(imp, plane) {
        if (!imp || !plane) return { kind: 'miss' };
        var rad = implantRadii(imp);
        var r = rad.head;
        var tip = tipOf(imp);
        var head = headOf(imp);
        var axis = vNorm(imp.axis);
        var cos = Math.abs(vDot(axis, plane.n));
        var sin = Math.sqrt(Math.max(0, 1 - cos * cos));
        var slab = sliceSpacingMm(null) * 0.6;
        var rAlongN = r * sin;
        var dTip = planeDist(tip, plane);
        var dHead = planeDist(head, plane);
        var dir = vSub(head, tip);
        var len = vLen0(dir) || Number(imp.lengthMm) || 1;

        if (cos > 0.82) {
            var denom = vDot(dir, plane.n);
            if (Math.abs(denom) < 1e-6) return { kind: 'miss', cos: cos };
            var t = vDot(vSub(plane.origin, tip), plane.n) / denom;
            if (t < -0.08 || t > 1.08) return { kind: 'miss', cos: cos };
            return {
                kind: 'circle',
                cos: cos,
                center: vAdd(tip, vScale(dir, t)),
                radiusMm: radiusAt(imp, t),
                head: head,
                tip: tip
            };
        }

        var tol = rAlongN + slab + 0.15;
        var dMin = Math.min(dTip, dHead);
        var dMax = Math.max(dTip, dHead);
        var hits = (dMin <= tol && dMax >= -tol);
        if (!hits) return { kind: 'miss', cos: cos };

        var t0 = 0;
        var t1 = 1;
        var dd = dHead - dTip;
        if (Math.abs(dd) > 1e-6) {
            var ta = (-tol - dTip) / dd;
            var tb = (tol - dTip) / dd;
            t0 = Math.max(0, Math.min(ta, tb));
            t1 = Math.min(1, Math.max(ta, tb));
            if (t1 < t0) return { kind: 'miss', cos: cos };
        }
        var a = vAdd(tip, vScale(dir, t0));
        var b = vAdd(tip, vScale(dir, t1));
        var halfHead = chordHalf(rad.head, dHead);
        var halfTip = chordHalf(rad.tip, dTip);
        if (halfHead < 0.15) halfHead = rad.head * Math.max(sin, 0.2);
        if (halfTip < 0.12) halfTip = rad.tip * Math.max(sin, 0.2);
        return {
            kind: 'rect',
            cos: cos,
            a: projectToPlane(a, plane),
            b: projectToPlane(b, plane),
            head: projectToPlane(head, plane),
            tip: projectToPlane(tip, plane),
            halfWidthMm: Math.max(halfHead, halfTip),
            halfHeadMm: halfHead,
            halfTipMm: halfTip,
            radiusMm: r
        };
    }

    function svgNode(name, attrs) {
        var el = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.keys(attrs).forEach(function (k) { el.setAttribute(k, String(attrs[k])); });
        return el;
    }

    function ensureSvg(pane, id) {
        var svg = document.getElementById(id);
        if (svg) return svg;
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('id', id);
        svg.setAttribute('class', 'implant-svg');
        svg.setAttribute('data-implant-layer', '1');
        pane.appendChild(svg);
        return svg;
    }

    function distPointSeg(px, py, ax, ay, bx, by) {
        var dx = bx - ax;
        var dy = by - ay;
        var l2 = dx * dx + dy * dy || 1;
        var t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        var qx = ax + t * dx;
        var qy = ay + t * dy;
        return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
    }

    function drawOne(svg, vpId, imp, pxPerMm) {
        var plane = cameraPlane(vpId);
        var g = svgNode('g', { 'data-implant': imp.id, opacity: imp.locked ? '0.55' : '0.95' });
        if (imp.id === model.selectedId) g.setAttribute('data-selected', '1');
        var cut = (vpId !== VP.VOL && plane) ? cylinderSlice(imp, plane) : { kind: 'volume' };
        g.setAttribute('data-cut', cut.kind || 'miss');

        function markHeadTip(hw, tw) {
            var hc = worldToCanvas(vpId, hw);
            var tc = worldToCanvas(vpId, tw);
            if (hc) {
                g.appendChild(svgNode('circle', {
                    cx: hc[0], cy: hc[1], r: Math.max(2.5, implantRadii(imp).head * pxPerMm * 0.35),
                    fill: imp.color
                }));
            }
            if (tc) {
                g.appendChild(svgNode('circle', {
                    cx: tc[0], cy: tc[1], r: '2.5', fill: '#0b1220', stroke: imp.color
                }));
            }
            return { hc: hc, tc: tc };
        }

        function appendTaper(ac, bc, rHeadPx, rTipPx, ghost) {
            var dx = bc[0] - ac[0];
            var dy = bc[1] - ac[1];
            var L = Math.hypot(dx, dy) || 1;
            var ux = dx / L;
            var uy = dy / L;
            var nx = -uy;
            var ny = ux;
            var blunt = Math.min(Math.max(2, rTipPx), L * 0.28);
            var ex = ac[0] + ux * (L - blunt);
            var ey = ac[1] + uy * (L - blunt);
            var hL = [ac[0] + nx * rHeadPx, ac[1] + ny * rHeadPx];
            var hR = [ac[0] - nx * rHeadPx, ac[1] - ny * rHeadPx];
            var tL = [ex + nx * rTipPx, ey + ny * rTipPx];
            var tR = [ex - nx * rTipPx, ey - ny * rTipPx];
            var d = 'M ' + hL[0] + ' ' + hL[1] +
                ' L ' + tL[0] + ' ' + tL[1] +
                ' Q ' + bc[0] + ' ' + bc[1] + ' ' + tR[0] + ' ' + tR[1] +
                ' L ' + hR[0] + ' ' + hR[1] + ' Z';
            g.appendChild(svgNode('path', {
                d: d,
                fill: imp.color,
                'fill-opacity': ghost ? '0.1' : '0.32',
                stroke: imp.color,
                'stroke-width': ghost ? '1.5' : '2',
                'stroke-dasharray': ghost ? '5 4' : 'none',
                opacity: ghost ? '0.4' : '0.95'
            }));
        }

        if (cut.kind === 'circle') {
            var cc = worldToCanvas(vpId, cut.center);
            if (!cc) return 0;
            var pr = Math.max(3, cut.radiusMm * pxPerMm);
            g.appendChild(svgNode('circle', {
                cx: cc[0], cy: cc[1], r: pr,
                fill: imp.color, 'fill-opacity': '0.28',
                stroke: imp.color, 'stroke-width': '2'
            }));
            g.appendChild(svgNode('circle', {
                cx: cc[0], cy: cc[1], r: '2', fill: imp.color
            }));
            g.setAttribute('data-cx', String(cc[0]));
            g.setAttribute('data-cy', String(cc[1]));
            g.setAttribute('data-r', String(pr));
            if (imp.id === model.selectedId) {
                g.appendChild(svgNode('circle', {
                    cx: cc[0] + 16, cy: cc[1] - 16, r: '6',
                    fill: '#fff', stroke: imp.color, 'data-handle': 'rotate'
                }));
            }
            svg.appendChild(g);
            return 1;
        }

        var aW = cut.kind === 'rect' ? (cut.b || cut.head) : headOf(imp);
        var bW = cut.kind === 'rect' ? (cut.a || cut.tip) : tipOf(imp);
        var ac = worldToCanvas(vpId, aW);
        var bc = worldToCanvas(vpId, bW);
        var rad = implantRadii(imp);
        var ghost = cut.kind === 'miss';
        if (ghost) {
            ac = worldToCanvas(vpId, headOf(imp));
            bc = worldToCanvas(vpId, tipOf(imp));
        }
        if (!ac || !bc) return 0;
        var rHeadPx = Math.max(2, (cut.kind === 'rect' ? (cut.halfHeadMm || rad.head) : rad.head) * pxPerMm);
        var rTipPx = Math.max(1.4, (cut.kind === 'rect' ? (cut.halfTipMm || rad.tip) : rad.tip) * pxPerMm);
        if (ghost) {
            rHeadPx = Math.max(1.5, rad.head * pxPerMm);
            rTipPx = Math.max(1.2, rad.tip * pxPerMm);
        }
        appendTaper(ac, bc, rHeadPx, rTipPx, ghost);
        if (!ghost) {
            var ends = markHeadTip(cut.head || headOf(imp), cut.tip || tipOf(imp));
            if (imp.id === model.selectedId && ends.hc && ends.tc) {
                var mid = [(ends.hc[0] + ends.tc[0]) / 2, (ends.hc[1] + ends.tc[1]) / 2];
                var n2 = vNorm([-(ends.tc[1] - ends.hc[1]), ends.tc[0] - ends.hc[0], 0]);
                g.appendChild(svgNode('circle', {
                    cx: mid[0] + n2[0] * 18, cy: mid[1] + n2[1] * 18, r: '6',
                    fill: '#fff', stroke: imp.color, 'data-handle': 'rotate'
                }));
            }
        }
        svg.appendChild(g);
        return ghost ? 0 : 1;
    }

    function draw() {
        if (suspended) return 0;
        var drawn = 0;
        try {
            var panes = [
                { el: $('vpAxial') && $('vpAxial').parentNode, id: 'implantSvgAxial', vp: VP.AX },
                { el: $('vpSagittal') && $('vpSagittal').parentNode, id: 'implantSvgSagittal', vp: VP.SAG },
                { el: $('vpCoronal') && $('vpCoronal').parentNode, id: 'implantSvgCoronal', vp: VP.COR },
                { el: $('vpVolume') && $('vpVolume').parentNode, id: 'implantSvgVolume', vp: VP.VOL }
            ];
            panes.forEach(function (p) {
                if (!p.el) return;
                var svg = ensureSvg(p.el, p.id);
                svg.setAttribute('width', String(p.el.clientWidth || 0));
                svg.setAttribute('height', String(p.el.clientHeight || 0));
                svg.innerHTML = '';
                var px = mmToCanvas(p.vp);
                model.implants.forEach(function (imp) {
                    drawn += drawOne(svg, p.vp, imp, px);
                });
            });
        } catch (eDraw) {
            drawn = 0;
        }
        model.drawn = drawn;
        return drawn;
    }

    function hitImplant(vpId, x, y) {
        var px = mmToCanvas(vpId);
        var plane = cameraPlane(vpId);
        var i;
        for (i = model.implants.length - 1; i >= 0; i--) {
            var imp = model.implants[i];
            var cut = plane && vpId !== VP.VOL ? cylinderSlice(imp, plane) : { kind: 'volume' };
            var handle = null;
            if (cut.kind === 'circle') {
                var cc = worldToCanvas(vpId, cut.center);
                if (!cc) continue;
                if (imp.id === model.selectedId && Math.hypot(x - (cc[0] + 16), y - (cc[1] - 16)) <= 10) {
                    return { imp: imp, mode: 'rotate' };
                }
                if (Math.hypot(x - cc[0], y - cc[1]) <= Math.max(8, cut.radiusMm * px + 4)) {
                    return { imp: imp, mode: 'move' };
                }
                continue;
            }
            var hw = worldToCanvas(vpId, cut.head || headOf(imp));
            var tw = worldToCanvas(vpId, cut.tip || tipOf(imp));
            if (!hw || !tw) continue;
            if (imp.id === model.selectedId) {
                var mid = [(hw[0] + tw[0]) / 2, (hw[1] + tw[1]) / 2];
                var n = vNorm([-(tw[1] - hw[1]), tw[0] - hw[0], 0]);
                if (Math.hypot(x - (mid[0] + n[0] * 18), y - (mid[1] + n[1] * 18)) <= 10) {
                    return { imp: imp, mode: 'rotate' };
                }
            }
            var w = Math.max(8, (cut.halfWidthMm || implantRadii(imp).head) * px + 4);
            if (distPointSeg(x, y, hw[0], hw[1], tw[0], tw[1]) <= w) {
                return { imp: imp, mode: 'move' };
            }
        }
        return null;
    }

    function paneVp(svg) {
        if (svg.id === 'implantSvgAxial') return VP.AX;
        if (svg.id === 'implantSvgSagittal') return VP.SAG;
        if (svg.id === 'implantSvgCoronal') return VP.COR;
        return VP.VOL;
    }

    function localXy(svg, ev) {
        var r = svg.getBoundingClientRect();
        return [ev.clientX - r.left, ev.clientY - r.top];
    }

    function placeAtViewport(vpId, nx, ny) {
        var vp = viewport(vpId);
        if (!vp) {
            addImplant({
                position: [16, 16, 4],
                axis: viewNormal(vpId),
                diameterMm: 4,
                lengthMm: 10
            });
            return findImp(model.selectedId);
        }
        var el = vp.element || vp.canvas;
        var w = (el && el.clientWidth) || 1;
        var h = (el && el.clientHeight) || 1;
        var world = canvasToWorld(vpId, [nx * w, ny * h]);
        if (!world) world = [16, 16, 4];
        var imp = addImplant({
            position: world,
            axis: viewNormal(vpId),
            diameterMm: Number($('impDia') && $('impDia').value) || 4,
            lengthMm: Number($('impLen') && $('impLen').value) || 10
        });
        // The click is already a DICOM millimetre point. Leave the MPR cameras
        // where the clinician had them; redraw so the implant stays on the volume.
        try { draw(); } catch (eDraw) { /* ignore */ }
        return imp;
    }

    function nudgeImplant(id, delta) {
        var imp = findImp(id || model.selectedId);
        if (!imp || imp.locked) return null;
        imp.position = vAdd(imp.position, delta);
        draw();
        paintPanel();
        return imp;
    }

    function rotateImplant(id, degrees, around) {
        var imp = findImp(id || model.selectedId);
        if (!imp || imp.locked) return null;
        var rad = (Number(degrees) || 0) * Math.PI / 180;
        var axis = around && around.length === 3 ? around : [0, 1, 0];
        var pivot = pivotOf(imp);
        var newAxis = vNorm(vRot(imp.axis, axis, rad));
        var rel = vSub(imp.position, pivot);
        imp.axis = newAxis;
        imp.position = vAdd(pivot, vRot(rel, axis, rad));
        draw();
        paintPanel();
        return imp;
    }

    function setPivot(name) {
        if (name === 'head' || name === 'tip' || name === 'center') model.pivot = name;
        paintPanel();
        return model.pivot;
    }

    function setSize(id, dia, len) {
        var imp = findImp(id || model.selectedId);
        if (!imp || imp.locked) return null;
        if (dia != null && Number(dia) > 0) imp.diameterMm = Number(dia);
        if (len != null && Number(len) > 0) imp.lengthMm = Number(len);
        draw();
        paintPanel();
        return imp;
    }

    function setLocked(id, locked) {
        var imp = findImp(id || model.selectedId);
        if (!imp) return null;
        imp.locked = !!locked;
        draw();
        paintPanel();
        return imp;
    }

    function duplicateImplant(id) {
        var imp = findImp(id || model.selectedId);
        if (!imp) return null;
        var copy = addImplant({
            diameterMm: imp.diameterMm,
            lengthMm: imp.lengthMm,
            position: vAdd(imp.position, [2, 0, 0]),
            axis: imp.axis.slice(),
            color: COLORS[model.implants.length % COLORS.length]
        });
        return copy;
    }

    function deleteImplant(id) {
        var want = id || model.selectedId;
        model.implants = model.implants.filter(function (imp) { return imp.id !== want; });
        if (model.selectedId === want) {
            model.selectedId = model.implants[0] ? model.implants[0].id : '';
        }
        draw();
        paintPanel();
        return model.implants.length;
    }

    function selectImplant(id) {
        if (findImp(id)) model.selectedId = id;
        draw();
        paintPanel();
        return model.selectedId;
    }

    function implantDistance(aId, bId) {
        var a = findImp(aId);
        var b = findImp(bId);
        if (!a || !b) {
            if (model.implants.length < 2) return 0;
            a = model.implants[0];
            b = model.implants[1];
        }
        return vLen(vSub(a.position, b.position));
    }

    function setActive(on) {
        model.active = !!on;
        var btn = $('btnImplant');
        if (btn) btn.className = model.active ? 'on' : '';
        var panel = $('implantPanel');
        if (panel) panel.classList.toggle('is-on', model.active);
        var app = $('app');
        if (app) app.classList.toggle('implant-on', model.active);
        return model.active;
    }

    function onPointerDown(ev) {
        if (!model.active) return;
        var svg = ev.currentTarget;
        var vpId = paneVp(svg);
        var xy = localXy(svg, ev);
        var hit = hitImplant(vpId, xy[0], xy[1]);
        if (hit) {
            model.selectedId = hit.imp.id;
            if (hit.imp.locked && hit.mode === 'move') {
                paintPanel();
                draw();
                return;
            }
            var world = canvasToWorld(vpId, xy) || hit.imp.position.slice();
            drag = {
                id: hit.imp.id,
                mode: hit.mode,
                vpId: vpId,
                startWorld: world,
                startPos: hit.imp.position.slice(),
                startAxis: hit.imp.axis.slice()
            };
            ev.preventDefault();
            draw();
            paintPanel();
            return;
        }
        var r = svg.getBoundingClientRect();
        placeAtViewport(vpId, xy[0] / (r.width || 1), xy[1] / (r.height || 1));
        ev.preventDefault();
    }

    function onPointerMove(ev) {
        if (!drag) return;
        var imp = findImp(drag.id);
        if (!imp || (imp.locked && drag.mode === 'move')) return;
        var svg = ev.currentTarget;
        var xy = localXy(svg, ev);
        var world = canvasToWorld(drag.vpId, xy);
        if (!world) return;
        if (drag.mode === 'move') {
            var n = viewNormal(drag.vpId);
            var delta = vSub(world, drag.startWorld);
            delta = vSub(delta, vScale(n, vDot(delta, n)));
            imp.position = vAdd(drag.startPos, delta);
        } else {
            var n = viewNormal(drag.vpId);
            var pivot = pivotOf(imp);
            var v0 = vSub(drag.startWorld, pivot);
            var v1 = vSub(world, pivot);
            v0 = vSub(v0, vScale(n, vDot(v0, n)));
            v1 = vSub(v1, vScale(n, vDot(v1, n)));
            var den = vLen0(v0) * vLen0(v1);
            if (den > 1e-6) {
                var ang = Math.atan2(vDot(n, vCross(v0, v1)), vDot(v0, v1));
                imp.axis = vNorm(vRot(drag.startAxis, n, ang));
                var rel = vSub(drag.startPos, pivot);
                imp.position = vAdd(pivot, vRot(rel, n, ang));
            }
        }
        draw();
    }

    function onPointerUp() {
        drag = null;
        paintPanel();
        draw();
    }

    function bindSvgs() {
        ['implantSvgAxial', 'implantSvgSagittal', 'implantSvgCoronal', 'implantSvgVolume'].forEach(function (id) {
            var svg = $(id);
            if (!svg || svg.getAttribute('data-bound') === '1') return;
            svg.setAttribute('data-bound', '1');
            svg.addEventListener('pointerdown', onPointerDown);
            svg.addEventListener('pointermove', onPointerMove);
            svg.addEventListener('pointerup', onPointerUp);
            svg.addEventListener('pointerleave', onPointerUp);
        });
    }

    function paintPanel() {
        var list = $('impList');
        if (list) {
            list.innerHTML = model.implants.map(function (imp) {
                var on = imp.id === model.selectedId ? ' is-on' : '';
                return '<button type="button" class="imp-row' + on + '" data-imp="' + imp.id + '">' +
                    '<span style="color:' + imp.color + '">●</span> #' + (imp.label || '') +
                    ' · ' + imp.diameterMm + '×' + imp.lengthMm + ' mm' +
                    (imp.locked ? ' 🔒' : '') + '</button>';
            }).join('') || '<p class="imp-empty">No implants yet. Turn Implant on, then click a slice.</p>';
            Array.prototype.forEach.call(list.querySelectorAll('[data-imp]'), function (b) {
                b.addEventListener('click', function () { selectImplant(b.getAttribute('data-imp')); });
            });
        }
        var imp = findImp(model.selectedId);
        if ($('impDia') && imp) $('impDia').value = imp.diameterMm;
        if ($('impLen') && imp) $('impLen').value = imp.lengthMm;
        if ($('impPivot')) $('impPivot').value = model.pivot;
        var dist = $('impDist');
        if (dist) {
            dist.textContent = model.implants.length >= 2
                ? ('Distance: ' + implantDistance().toFixed(1) + ' mm')
                : 'Distance: —';
        }
        bindSvgs();
    }

    function wirePanel() {
        if ($('btnImplant')) {
            $('btnImplant').addEventListener('click', function () {
                var page = window.CS3D_PAGE;
                if (page && page.setTool) page.setTool('Implant');
                else setActive(true);
            });
        }
        if ($('impAdd')) {
            $('impAdd').addEventListener('click', function () {
                if (!window.CS3D_PAGE || !window.CS3D_PAGE.state || !window.CS3D_PAGE.state().ready) {
                    if (window.CS3D_PAGE && window.CS3D_PAGE.setStatus) {
                        window.CS3D_PAGE.setStatus(I18N['cs3d.implant.needVolume'], 'err');
                    }
                    return;
                }
                placeAtViewport(VP.AX, 0.5, 0.5);
            });
        }
        if ($('impDup')) $('impDup').addEventListener('click', function () { duplicateImplant(); });
        if ($('impDel')) $('impDel').addEventListener('click', function () { deleteImplant(); });
        if ($('impLock')) {
            $('impLock').addEventListener('click', function () {
                var imp = findImp(model.selectedId);
                if (imp) setLocked(imp.id, !imp.locked);
            });
        }
        if ($('impSave')) $('impSave').addEventListener('click', function () {
            saveImplants();
            if (window.CS3D_PAGE && window.CS3D_PAGE.setStatus) {
                window.CS3D_PAGE.setStatus(I18N['cs3d.implant.saved'], 'ok');
            }
        });
        function applySize() {
            setSize(model.selectedId, $('impDia') && $('impDia').value, $('impLen') && $('impLen').value);
        }
        if ($('impDia')) $('impDia').addEventListener('change', applySize);
        if ($('impLen')) $('impLen').addEventListener('change', applySize);
        if ($('impPivot')) {
            $('impPivot').addEventListener('change', function () { setPivot($('impPivot').value); });
        }
        if ($('impRot')) {
            $('impRot').addEventListener('click', function () { rotateImplant(model.selectedId, 15); });
        }
    }

    function scheduleDraw() {
        if (suspended || syncing) return;
        if (redrawTimer) return;
        redrawTimer = requestAnimationFrame(function () {
            redrawTimer = 0;
            if (suspended) return;
            try { draw(); bindSvgs(); } catch (eDraw) { /* never break the volume */ }
        });
    }

    function unhookRender() {
        hookedEvents.forEach(function (row) {
            try { row.target.removeEventListener(row.type, row.fn); } catch (e) { /* ignore */ }
        });
        hookedEvents = [];
        hooked = false;
        if (redrawTimer) {
            try { cancelAnimationFrame(redrawTimer); } catch (e2) { /* ignore */ }
            redrawTimer = 0;
        }
    }

    function hookRender() {
        if (hooked || !window.csCore) return;
        var E = window.csCore.Enums && window.csCore.Enums.Events;
        if (!E || !window.csCore.eventTarget) return;
        hooked = true;
        function listen(target, type, fn) {
            target.addEventListener(type, fn);
            hookedEvents.push({ target: target, type: type, fn: fn });
        }
        try { listen(window.csCore.eventTarget, E.CAMERA_MODIFIED, scheduleDraw); } catch (e) { /* ignore */ }
        try { listen(window.csCore.eventTarget, E.IMAGE_RENDERED, scheduleDraw); } catch (e2) { /* ignore */ }
        listen(window, 'resize', scheduleDraw);
    }

    function suspend(on) {
        suspended = !!on;
        if (suspended) unhookRender();
        return suspended;
    }

    function onVolumeReady() {
        suspended = false;
        hookRender();
        if (!model.implants.length) restoreImplants();
        try { draw(); } catch (e) { /* ignore */ }
        paintPanel();
        bindSvgs();
    }

    function onDestroy() {
        suspend(true);
        drag = null;
        model.drawn = 0;
        ['implantSvgAxial', 'implantSvgSagittal', 'implantSvgCoronal', 'implantSvgVolume'].forEach(function (id) {
            var el = $(id);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        });
    }

    function sliceKinds(id) {
        var imp = findImp(id || model.selectedId);
        var out = {};
        [VP.AX, VP.SAG, VP.COR, VP.VOL].forEach(function (vpId) {
            if (vpId === VP.VOL) { out[vpId] = 'volume'; return; }
            var plane = cameraPlane(vpId);
            out[vpId] = (!imp || !plane) ? 'none' : cylinderSlice(imp, plane).kind;
        });
        return out;
    }

    function mprFit(id) {
        var imp = findImp(id || model.selectedId);
        if (!imp) return [];
        return [VP.AX, VP.SAG, VP.COR].map(function (vpId) {
            var plane = cameraPlane(vpId);
            return plane ? Math.abs(planeDist(imp.position, plane)) : null;
        });
    }

    function state() {
        return {
            count: model.implants.length,
            selectedId: model.selectedId,
            pivot: model.pivot,
            active: model.active,
            drawn: model.drawn,
            implants: model.implants.map(function (imp) {
                return {
                    id: imp.id,
                    diameterMm: imp.diameterMm,
                    lengthMm: imp.lengthMm,
                    position: as3(imp.position),
                    axis: as3(imp.axis),
                    locked: imp.locked,
                    label: imp.label
                };
            })
        };
    }

    window.CS3D_IMPLANT = {
        addImplant: addImplant,
        serializeImplants: serializeImplants,
        loadImplants: loadImplants,
        saveImplants: saveImplants,
        restoreImplants: restoreImplants,
        fetchImplants: fetchImplants,
        clearImplants: clearImplants,
        placeAtViewport: placeAtViewport,
        selectedImplant: selectedImplant,
        alignMprToWorld: alignMprToWorld,
        alignMprToSelectedImplant: alignMprToSelectedImplant,
        syncMprToImplant: syncMprToImplant,
        cylinderSlice: cylinderSlice,
        implantRadii: implantRadii,
        radiusAt: radiusAt,
        sliceKinds: sliceKinds,
        mprFit: mprFit,
        nudgeImplant: nudgeImplant,
        rotateImplant: rotateImplant,
        setPivot: setPivot,
        setSize: setSize,
        setLocked: setLocked,
        duplicateImplant: duplicateImplant,
        deleteImplant: deleteImplant,
        selectImplant: selectImplant,
        implantDistance: implantDistance,
        setActive: setActive,
        draw: draw,
        drawImplants: draw,
        suspend: suspend,
        onVolumeReady: onVolumeReady,
        onDestroy: onDestroy,
        state: state,
        i18n: I18N
    };
    window.BANANA_CS3D_IMPLANT = model;
    if (window.CS3D_PAGE) window.CS3D_PAGE.implant = window.CS3D_IMPLANT;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { wirePanel(); paintPanel(); });
    } else {
        wirePanel();
        paintPanel();
    }
})();
