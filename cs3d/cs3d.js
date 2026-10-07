/* Banana Dicom Reader — Cornerstone3D volume + three planes + measure tools.
   Independent of /ohif/. Banana only opens this window and Helper-saves. */
(function () {
    var ENGINE_ID = 'banana-cs3d';
    var TG_MPR = 'banana-cs3d-mpr';
    var TG_3D = 'banana-cs3d-3d';
    var VP = { AX: 'CS3D_AXIAL', SAG: 'CS3D_SAGITTAL', COR: 'CS3D_CORONAL', VOL: 'CS3D_VOLUME' };
    var last = { source: '', n: 0, skipped: 0, mode: '', volumeId: '', tool: 'WindowLevel', ready: false, error: '' };
    var nLoad = 0;

    function $(id) { return document.getElementById(id); }

    function setStatus(msg, kind) {
        var el = $('status');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'status' + (kind ? ' ' + kind : '');
    }

    function wasmBasePath() {
        var base = window.BANANA_CS3D_BASE || '';
        try {
            return new URL('wasm/', document.baseURI || (base + '/')).href;
        } catch (e) {
            return (base || '/cs3d') + '/wasm/';
        }
    }

    function vendorOk() {
        return !!(window.csCore && window.csTools && window.csDicom);
    }

    function toolList() {
        var T = window.csTools || {};
        return [
            ['WindowLevel', T.WindowLevelTool, 'WW/WL'],
            ['Pan', T.PanTool, 'Pan'],
            ['Zoom', T.ZoomTool, 'Zoom'],
            ['Crosshairs', T.CrosshairsTool, 'Crosshairs'],
            ['Length', T.LengthTool, 'Length'],
            ['Angle', T.AngleTool, 'Angle'],
            ['CobbAngle', T.CobbAngleTool, 'Cobb'],
            ['Probe', T.ProbeTool, 'Probe'],
            ['RectangleROI', T.RectangleROITool, 'Rect'],
            ['EllipticalROI', T.EllipticalROITool, 'Ellipse'],
            ['Bidirectional', T.BidirectionalTool, 'Bi-D'],
            ['PlanarFreehandROI', T.PlanarFreehandROITool, 'Freehand'],
            ['Eraser', T.EraserTool, 'Erase']
        ].filter(function (row) { return !!row[1]; });
    }

    function paintTools() {
        var box = $('tools');
        if (!box) return;
        box.innerHTML = '';
        toolList().forEach(function (row) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-tool', row[0]);
            b.textContent = row[2];
            if (row[0] === last.tool) b.className = 'on';
            b.addEventListener('click', function () { setTool(row[0]); });
            box.appendChild(b);
        });
        var reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Reset view';
        reset.addEventListener('click', resetCameras);
        box.appendChild(reset);
    }

    function markTool(name) {
        last.tool = name;
        var box = $('tools');
        if (box) {
            Array.prototype.forEach.call(box.querySelectorAll('[data-tool]'), function (b) {
                b.className = b.getAttribute('data-tool') === name ? 'on' : '';
            });
        }
        var implantBtn = $('btnImplant');
        if (implantBtn) implantBtn.className = name === 'Implant' ? 'on' : '';
        if (window.CS3D_IMPLANT && CS3D_IMPLANT.setActive) CS3D_IMPLANT.setActive(name === 'Implant');
    }

    function mouse() {
        var E = window.csTools && window.csTools.Enums;
        return (E && E.MouseBindings) || { Primary: 1, Secondary: 2, Auxiliary: 4, Wheel: 0 };
    }

    function addIf(ctor) {
        if (!ctor) return;
        try { window.csTools.addTool(ctor); } catch (e) { /* already added */ }
    }

    function registerTools() {
        var T = window.csTools;
        addIf(T.WindowLevelTool);
        addIf(T.PanTool);
        addIf(T.ZoomTool);
        addIf(T.StackScrollTool);
        addIf(T.TrackballRotateTool);
        addIf(T.CrosshairsTool);
        addIf(T.LengthTool);
        addIf(T.AngleTool);
        addIf(T.CobbAngleTool);
        addIf(T.ProbeTool);
        addIf(T.RectangleROITool);
        addIf(T.EllipticalROITool);
        addIf(T.BidirectionalTool);
        addIf(T.PlanarFreehandROITool);
        addIf(T.EraserTool);
    }

    function loseCanvasGl(c) {
        if (!c) return;
        try {
            var gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
            var ext = gl && gl.getExtension && gl.getExtension('WEBGL_lose_context');
            if (ext && ext.loseContext) ext.loseContext();
        } catch (eGl) { /* ignore */ }
    }

    function loseViewportGl(wipe) {
        try {
            var old = window.csCore && csCore.getRenderingEngine && csCore.getRenderingEngine(ENGINE_ID);
            var box = old && old.offScreenCanvasContainer;
            if (box && box.querySelectorAll) {
                Array.prototype.forEach.call(box.querySelectorAll('canvas'), loseCanvasGl);
            }
        } catch (eOff) { /* ignore */ }
        try {
            Array.prototype.forEach.call(document.querySelectorAll('canvas'), loseCanvasGl);
        } catch (eDoc) { /* ignore */ }
        if (!wipe) return;
        var nodes = els();
        [nodes.axial, nodes.sagittal, nodes.coronal, nodes.volume].forEach(function (el) {
            if (!el) return;
            var canvases = el.querySelectorAll ? el.querySelectorAll('canvas') : [];
            Array.prototype.forEach.call(canvases, loseCanvasGl);
            try { el.innerHTML = ''; } catch (eWipe) { /* ignore */ }
        });
    }

    function patchCanvasGl() {
        var proto = window.HTMLCanvasElement && HTMLCanvasElement.prototype;
        if (!proto || proto.__bananaGl) return;
        var orig = proto.getContext;
        proto.getContext = function (type, attrs) {
            var gl = orig.apply(this, arguments);
            if (!gl && type && /webgl/i.test(String(type))) {
                try { gl = orig.call(this, type); } catch (eRetry) { gl = null; }
            }
            return gl;
        };
        proto.__bananaGl = 1;
    }

    function isGlProxyError(err) {
        var msg = (err && err.message) ? err.message : String(err || '');
        return /Cannot create proxy with a non-object/i.test(msg) || /WEBGL_lose_context|webgl/i.test(msg);
    }

    function destroyEngine() {
        if (window.CS3D_IMPLANT && CS3D_IMPLANT.suspend) {
            try { CS3D_IMPLANT.suspend(true); } catch (eSus) { /* ignore */ }
        }
        if (window.CS3D_IMPLANT && CS3D_IMPLANT.onDestroy) {
            try { CS3D_IMPLANT.onDestroy(); } catch (eImp) { /* ignore */ }
        }
        var core = window.csCore;
        var tools = window.csTools;
        try {
            var old = core.getRenderingEngine && core.getRenderingEngine(ENGINE_ID);
            loseViewportGl(false);
            if (old && old.destroy) old.destroy();
        } catch (e) { /* ignore */ }
        loseViewportGl(true);
        try { tools.ToolGroupManager.destroyToolGroup(TG_MPR); } catch (e2) { /* ignore */ }
        try { tools.ToolGroupManager.destroyToolGroup(TG_3D); } catch (e3) { /* ignore */ }
        try { if (core.cache && core.cache.purgeVolumeCache) core.cache.purgeVolumeCache(); } catch (e4) { /* ignore */ }
    }

    function purgeFiles() {
        try { if (window.csCore.cache && window.csCore.cache.purgeCache) window.csCore.cache.purgeCache(); } catch (e5) { /* ignore */ }
        try {
            var wadouri = window.csDicom && window.csDicom.wadouri;
            if (wadouri && wadouri.dataSetCacheManager && wadouri.dataSetCacheManager.purge) {
                wadouri.dataSetCacheManager.purge();
            }
            if (wadouri && wadouri.fileManager && wadouri.fileManager.purge) {
                wadouri.fileManager.purge();
            }
        } catch (e6) { /* ignore */ }
    }

    function colors() {
        var map = {};
        map[VP.AX] = 'rgb(255, 87, 51)';
        map[VP.SAG] = 'rgb(52, 211, 153)';
        map[VP.COR] = 'rgb(56, 189, 248)';
        return map;
    }

    function buildToolGroups(volumeId) {
        var T = window.csTools;
        var M = mouse();
        var mpr = T.ToolGroupManager.createToolGroup(TG_MPR);
        var vol = T.ToolGroupManager.createToolGroup(TG_3D);
        toolList().forEach(function (row) {
            try { mpr.addTool(row[1].toolName); } catch (e) { /* skip */ }
        });
        if (T.StackScrollTool) {
            try { mpr.addTool(T.StackScrollTool.toolName); } catch (e2) { /* skip */ }
        }
        if (T.TrackballRotateTool) {
            try { vol.addTool(T.TrackballRotateTool.toolName, { configuration: { volumeId: volumeId } }); } catch (e3) { /* skip */ }
        }
        if (T.PanTool) try { vol.addTool(T.PanTool.toolName); } catch (e4) { /* skip */ }
        if (T.ZoomTool) try { vol.addTool(T.ZoomTool.toolName); } catch (e5) { /* skip */ }

        if (T.CrosshairsTool && mpr.getToolInstance) {
            try {
                var c = colors();
                mpr.setToolConfiguration(T.CrosshairsTool.toolName, {
                    getReferenceLineColor: function (id) { return c[id] || 'rgb(200,200,0)'; }
                });
            } catch (e6) { /* optional */ }
        }

        if (T.StackScrollTool) {
            mpr.setToolActive(T.StackScrollTool.toolName, { bindings: [{ mouseButton: M.Wheel }] });
        }
        if (T.ZoomTool) {
            mpr.setToolActive(T.ZoomTool.toolName, { bindings: [{ mouseButton: M.Secondary }] });
            try { vol.setToolActive(T.ZoomTool.toolName, { bindings: [{ mouseButton: M.Secondary }] }); } catch (e7) { /* skip */ }
        }
        if (T.PanTool) {
            mpr.setToolActive(T.PanTool.toolName, { bindings: [{ mouseButton: M.Auxiliary }] });
        }
        if (T.TrackballRotateTool) {
            try {
                vol.setToolActive(T.TrackballRotateTool.toolName, { bindings: [{ mouseButton: M.Primary }] });
            } catch (e8) { /* skip */ }
        }
        return { mpr: mpr, vol: vol };
    }

    function implantWorld() {
        var I = window.CS3D_IMPLANT;
        if (!I) return null;
        try {
            if (I.alignMprToSelectedImplant) return I.alignMprToSelectedImplant();
            var st = I.state && I.state();
            var row = st && st.implants && (st.implants.filter(function (imp) { return imp.id === st.selectedId; })[0] || st.implants[0]);
            return row && row.position ? [row.position[0], row.position[1], row.position[2]] : null;
        } catch (e) { return null; }
    }

    function snapCrosshairsToWorld(world) {
        if (!world) return false;
        var T = window.csTools;
        var mpr = T && T.ToolGroupManager && T.ToolGroupManager.getToolGroup(TG_MPR);
        var toolName = T && T.CrosshairsTool && T.CrosshairsTool.toolName;
        var tool = mpr && toolName && mpr.getToolInstance && mpr.getToolInstance(toolName);
        if (!tool) return false;
        var pos = [Number(world[0]), Number(world[1]), Number(world[2])];
        try {
            if (tool.setToolCenter) tool.setToolCenter(pos);
        } catch (eSet) { /* ignore */ }
        try {
            var core = window.csCore;
            var engine = core && core.getRenderingEngine && core.getRenderingEngine(ENGINE_ID);
            var ax = engine && engine.getViewport && engine.getViewport(VP.AX);
            if (tool._jump && ax) {
                tool._jump({
                    viewport: ax,
                    renderingEngine: engine,
                    viewportId: VP.AX,
                    renderingEngineId: ENGINE_ID
                }, pos);
            }
            if (engine && engine.render) engine.render();
        } catch (eJump) { /* ignore */ }
        try {
            if (window.CS3D_IMPLANT && CS3D_IMPLANT.drawImplants) CS3D_IMPLANT.drawImplants();
        } catch (eDraw) { /* ignore */ }
        return true;
    }

    function afterPaint(fn) {
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(function () { requestAnimationFrame(fn); });
        } else {
            fn();
        }
    }

    function crosshairCenter() {
        try {
            var T = window.csTools;
            var mpr = T && T.ToolGroupManager && T.ToolGroupManager.getToolGroup(TG_MPR);
            var toolName = T && T.CrosshairsTool && T.CrosshairsTool.toolName;
            var tool = mpr && toolName && mpr.getToolInstance && mpr.getToolInstance(toolName);
            if (!tool || !tool.toolCenter) return null;
            return [Number(tool.toolCenter[0]), Number(tool.toolCenter[1]), Number(tool.toolCenter[2])];
        } catch (e) { return null; }
    }

    function setTool(name) {
        var T = window.csTools;
        if (!T || !T.ToolGroupManager) {
            markTool(name);
            return;
        }
        var mpr = T.ToolGroupManager.getToolGroup(TG_MPR);
        if (!mpr) { markTool(name); return; }
        var M = mouse();
        var passive = toolList();
        passive.forEach(function (row) {
            try { mpr.setToolPassive(row[1].toolName); } catch (e) { /* skip */ }
        });
        var world = null;
        if (name === 'Crosshairs') {
            world = implantWorld();
        }
        if (name === 'Implant') {
            markTool('Implant');
            if (T.StackScrollTool) {
                try { mpr.setToolActive(T.StackScrollTool.toolName, { bindings: [{ mouseButton: M.Wheel }] }); } catch (eImpW) { /* skip */ }
            }
            if (T.ZoomTool) {
                try { mpr.setToolActive(T.ZoomTool.toolName, { bindings: [{ mouseButton: M.Secondary }] }); } catch (eImpZ) { /* skip */ }
            }
            return;
        }
        var match = passive.filter(function (row) { return row[0] === name; })[0];
        if (!match) match = passive[0];
        if (match) {
            try {
                mpr.setToolActive(match[1].toolName, { bindings: [{ mouseButton: M.Primary }] });
            } catch (e2) { /* skip */ }
            markTool(match[0]);
            if (match[0] === 'Crosshairs' && world) {
                snapCrosshairsToWorld(world);
                afterPaint(function () { snapCrosshairsToWorld(world); });
            }
        }
        if (T.StackScrollTool) {
            try { mpr.setToolActive(T.StackScrollTool.toolName, { bindings: [{ mouseButton: M.Wheel }] }); } catch (e3) { /* skip */ }
        }
        if (T.ZoomTool) {
            try { mpr.setToolActive(T.ZoomTool.toolName, { bindings: [{ mouseButton: M.Secondary }] }); } catch (e4) { /* skip */ }
        }
    }

    function resetCameras() {
        var core = window.csCore;
        try {
            var engine = core.getRenderingEngine(ENGINE_ID);
            if (!engine) return;
            [VP.AX, VP.SAG, VP.COR, VP.VOL].forEach(function (id) {
                var vp = engine.getViewport(id);
                if (vp && vp.resetCamera) vp.resetCamera();
            });
            engine.render();
        } catch (e) { /* ignore */ }
    }

    function els() {
        return {
            axial: $('vpAxial'),
            sagittal: $('vpSagittal'),
            coronal: $('vpCoronal'),
            volume: $('vpVolume')
        };
    }

    function fileToImageId(file) {
        var dil = window.csDicom;
        if (dil.wadouri && dil.wadouri.fileManager && dil.wadouri.fileManager.add) {
            return dil.wadouri.fileManager.add(file);
        }
        throw new Error('DICOM file manager is missing');
    }

    function withTimeout(p, ms, label) {
        return Promise.race([
            p,
            new Promise(function (_, reject) {
                setTimeout(function () { reject(new Error(label || 'timeout')); }, ms);
            })
        ]);
    }

    async function prefetchMeta(imageIds) {
        var dil = window.csDicom;
        var core = window.csCore;
        var i;
        for (i = 0; i < imageIds.length; i++) {
            var id = imageIds[i];
            try {
                if (dil.wadouri && dil.wadouri.loadImage) {
                    await withTimeout(dil.wadouri.loadImage(id).promise, 8000, 'prefetch ' + id);
                } else if (core.imageLoader && core.imageLoader.loadAndCacheImage) {
                    await withTimeout(core.imageLoader.loadAndCacheImage(id), 8000, 'prefetch ' + id);
                }
            } catch (e) {
                console.warn('[cs3d] prefetch', id, e);
            }
        }
    }

    function metaGet(type, imageId) {
        var core = window.csCore;
        try {
            if (core && core.metaData && typeof core.metaData.get === 'function') {
                return core.metaData.get(type, imageId);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function hasReconstructablePlane(imageId) {
        var plane = metaGet('imagePlaneModule', imageId);
        if (!plane) return false;
        var ipp = plane.imagePositionPatient;
        var iop = plane.imageOrientationPatient;
        return !!(ipp && ipp.length >= 3 && iop && iop.length >= 6);
    }

    function seriesKey(imageId) {
        var series = metaGet('generalSeriesModule', imageId);
        var plane = metaGet('imagePlaneModule', imageId);
        return (series && (series.seriesInstanceUID || series.SeriesInstanceUID)) ||
            (plane && plane.frameOfReferenceUID) ||
            'unknown';
    }

    function expandFrames(imageIds) {
        var out = [];
        (imageIds || []).forEach(function (id) {
            var n = 0;
            var mf = metaGet('multiframeModule', id) || metaGet('multiFrameModule', id);
            if (mf) n = Number(mf.NumberOfFrames || mf.numberOfFrames || 0);
            if (!n) {
                var inst = metaGet('instance', id);
                if (inst) n = Number(inst.NumberOfFrames || inst.numberOfFrames || 0);
            }
            if (n > 1) {
                var base = String(id).replace(/[?&]frame=\d+$/i, '');
                var i;
                for (i = 1; i <= n; i++) out.push(base + (base.indexOf('?') >= 0 ? '&' : '?') + 'frame=' + i);
            } else {
                out.push(id);
            }
        });
        return out;
    }

    function pickVolumeImageIds(imageIds) {
        var usable = (imageIds || []).filter(hasReconstructablePlane);
        if (!usable.length) return [];
        var groups = {};
        usable.forEach(function (id) {
            var key = seriesKey(id);
            if (!groups[key]) groups[key] = [];
            groups[key].push(id);
        });
        var best = [];
        Object.keys(groups).forEach(function (k) {
            if (groups[k].length > best.length) best = groups[k];
        });
        return best;
    }

    function apply3dPreset(viewport) {
        var core = window.csCore;
        try {
            if (viewport.setProperties) viewport.setProperties({ preset: 'CT-Bone' });
        } catch (e) { /* ignore */ }
        try {
            var actor = viewport.getDefaultActor && viewport.getDefaultActor();
            var presets = core.CONSTANTS && core.CONSTANTS.VIEWPORT_PRESETS;
            var bone = presets && presets.filter(function (p) { return p.name === 'CT-Bone'; })[0];
            if (actor && actor.actor && bone && core.utilities && core.utilities.applyPreset) {
                core.utilities.applyPreset(actor.actor, bone);
            }
        } catch (e2) { /* ignore */ }
    }

    async function loadVolume(imageIds, label, opts) {
        opts = opts || {};
        var include3d = opts.include3d !== false;
        var core = window.csCore;
        var Enums = core.Enums;
        var nodes = els();
        nLoad += 1;
        var volumeId = 'cornerstoneStreamingImageVolume:banana-' + nLoad;
        last.volumeId = volumeId;
        last.mode = 'volume';
        last.n = imageIds.length;

        destroyEngine();
        var groups = buildToolGroups(volumeId);
        var engine = new core.RenderingEngine(ENGINE_ID);
        var defs = [
            {
                viewportId: VP.AX,
                type: Enums.ViewportType.ORTHOGRAPHIC,
                element: nodes.axial,
                defaultOptions: { orientation: Enums.OrientationAxis.AXIAL, background: [0.04, 0.07, 0.12] }
            },
            {
                viewportId: VP.SAG,
                type: Enums.ViewportType.ORTHOGRAPHIC,
                element: nodes.sagittal,
                defaultOptions: { orientation: Enums.OrientationAxis.SAGITTAL, background: [0.04, 0.07, 0.12] }
            },
            {
                viewportId: VP.COR,
                type: Enums.ViewportType.ORTHOGRAPHIC,
                element: nodes.coronal,
                defaultOptions: { orientation: Enums.OrientationAxis.CORONAL, background: [0.04, 0.07, 0.12] }
            }
        ];
        if (include3d) {
            defs.push({
                viewportId: VP.VOL,
                type: Enums.ViewportType.VOLUME_3D,
                element: nodes.volume,
                defaultOptions: { orientation: Enums.OrientationAxis.CORONAL, background: [0.02, 0.03, 0.06] }
            });
        }
        engine.setViewports(defs);
        groups.mpr.addViewport(VP.AX, ENGINE_ID);
        groups.mpr.addViewport(VP.SAG, ENGINE_ID);
        groups.mpr.addViewport(VP.COR, ENGINE_ID);
        if (include3d) groups.vol.addViewport(VP.VOL, ENGINE_ID);

        var volume = await core.volumeLoader.createAndCacheVolume(volumeId, { imageIds: imageIds });
        volume.load();
        var vpIds = [VP.AX, VP.SAG, VP.COR];
        if (include3d) vpIds = vpIds.concat([VP.VOL]);
        if (core.setVolumesForViewports) {
            await core.setVolumesForViewports(engine, [{ volumeId: volumeId }], vpIds);
        } else {
            await Promise.all(vpIds.map(function (id) {
                return engine.getViewport(id).setVolumes([{ volumeId: volumeId }]);
            }));
        }
        if (include3d) {
            try { apply3dPreset(engine.getViewport(VP.VOL)); } catch (e3d) { console.warn('[cs3d] 3D preset', e3d); }
        } else if (nodes.volume) {
            nodes.volume.innerHTML = '<div class="label" style="position:absolute;left:8px;top:8px">Volume skipped (GPU). Three-plane view is enough for implants.</div>';
        }
        setTool(last.tool || 'WindowLevel');
        engine.resize();
        engine.render();
        last.ready = true;
        last.error = '';
        last.include3d = include3d;
        setStatus((label || 'Loaded') + ': ' + imageIds.length + ' instances · volume + three planes' +
            (include3d ? '' : ' (3D pane skipped — GPU busy)') +
            '. Left = tool, right = zoom, wheel = scroll.', 'ok');
        if (window.CS3D_IMPLANT && CS3D_IMPLANT.onVolumeReady) {
            try { CS3D_IMPLANT.onVolumeReady(); } catch (eReady) { /* ignore */ }
        }
    }

    async function loadStack(imageIds, label) {
        var core = window.csCore;
        var T = window.csTools;
        var Enums = core.Enums;
        var nodes = els();
        last.mode = 'stack';
        last.n = imageIds.length;
        last.volumeId = '';
        destroyEngine();
        var groups = buildToolGroups('');
        var engine = new core.RenderingEngine(ENGINE_ID);
        engine.setViewports([{
            viewportId: VP.AX,
            type: Enums.ViewportType.STACK,
            element: nodes.axial,
            defaultOptions: { background: [0.04, 0.07, 0.12] }
        }]);
        groups.mpr.addViewport(VP.AX, ENGINE_ID);
        var vp = engine.getViewport(VP.AX);
        await vp.setStack(imageIds);
        setTool(last.tool === 'Crosshairs' ? 'WindowLevel' : (last.tool || 'WindowLevel'));
        engine.resize();
        engine.render();
        last.ready = true;
        last.error = '';
        setStatus((label || 'Loaded') + ': ' + imageIds.length + ' frame' + (imageIds.length === 1 ? '' : 's') + ' (stack — add more slices for three-plane MPR).', 'ok');
        if (window.CS3D_IMPLANT && CS3D_IMPLANT.onVolumeReady) {
            try { CS3D_IMPLANT.onVolumeReady(); } catch (eReady2) { /* ignore */ }
        }
        if (T && T.StackScrollTool) {
            try {
                groups.mpr.setToolActive(T.StackScrollTool.toolName, { bindings: [{ mouseButton: mouse().Wheel }] });
            } catch (e) { /* ignore */ }
        }
    }

    async function loadFiles(files, label) {
        if (!vendorOk()) {
            setStatus('Cornerstone3D vendor bundle is missing. Run node scripts/build-cs3d-sidecar.js', 'err');
            return false;
        }
        var list = Array.prototype.slice.call(files || []);
        if (!list.length) {
            setStatus('No DICOM files to load.', 'err');
            return false;
        }
        setStatus('Reading ' + list.length + ' DICOM file' + (list.length === 1 ? '' : 's') + '…');
        last.source = label || 'files';
        try {
            destroyEngine();
            purgeFiles();
            var imageIds = list.map(fileToImageId);
            await prefetchMeta(imageIds);
            if (typeof window.csDicom.convertMultiframeImageIds === 'function') {
                try { imageIds = window.csDicom.convertMultiframeImageIds(imageIds); } catch (eMf) { /* keep ids */ }
            }
            imageIds = expandFrames(imageIds);
            var volumeIds = pickVolumeImageIds(imageIds);
            var skipped = imageIds.length - volumeIds.length;
            last.skipped = skipped;
            if (volumeIds.length >= 3) {
                try {
                    await loadVolume(volumeIds, label);
                    if (skipped > 0) {
                        setStatus((label || 'Loaded') + ': ' + volumeIds.length +
                            ' instances · volume + three planes (skipped ' + skipped +
                            ' file' + (skipped === 1 ? '' : 's') + ' without slice positions).', 'ok');
                    }
                    return true;
                } catch (volErr) {
                    console.warn('[cs3d] volume failed', volErr);
                    await new Promise(function (r) { setTimeout(r, 80); });
                    try {
                        await loadVolume(volumeIds, label, { include3d: false });
                        return true;
                    } catch (eMpr) {
                        console.warn('[cs3d] MPR-only retry failed', eMpr);
                    }
                    try {
                        await loadStack(volumeIds, label);
                        return true;
                    } catch (eStack) {
                        console.warn('[cs3d] stack retry failed', eStack);
                        if (isGlProxyError(volErr) || isGlProxyError(eMpr) || isGlProxyError(eStack)) {
                            throw new Error('GPU is busy (WebGL). Close extra Banana Dicom Reader / 3D windows, then Load zip again.');
                        }
                        throw volErr;
                    }
                }
            }
            if (volumeIds.length) {
                await loadStack(volumeIds, label);
                return true;
            }
            if (imageIds.length === 1) {
                await loadStack(imageIds, label);
                return true;
            }
            throw new Error('No reconstructable slices (need Image Position). This zip may mix reports/scouts with a volume — load one series, or use the OHIF CBCT viewer.');
        } catch (err) {
            last.ready = false;
            last.error = (err && err.message) ? err.message : String(err);
            console.error('[cs3d]', err);
            setStatus('Could not build the volume: ' + last.error, 'err');
            return false;
        }
    }

    async function initLibs() {
        if (!vendorOk()) {
            setStatus('Cornerstone3D vendor bundle is missing. Run node scripts/build-cs3d-sidecar.js', 'err');
            return false;
        }
        var dil = window.csDicom;
        var core = window.csCore;
        var tools = window.csTools;
        patchCanvasGl();
        if (dil.init) {
            await dil.init({
                maxWebWorkers: 0,
                startWebWorkersOnDemand: false,
                wasmBasePath: wasmBasePath()
            });
        }
        if (core.init) await core.init();
        if (tools.init) await tools.init();
        registerTools();
        paintTools();
        markTool('WindowLevel');
        return true;
    }

    function bindUi() {
        $('btnZip').addEventListener('click', function () { $('zipPick').click(); });
        $('btnFolder').addEventListener('click', function () { $('folderPick').click(); });
        $('btnFiles').addEventListener('click', function () { $('filePick').click(); });
        function onPick(input, label) {
            input.addEventListener('change', function () {
                if (input.files && input.files.length && window.bananaCs3dHandleList) {
                    window.bananaCs3dHandleList(input.files, label);
                }
                input.value = '';
            });
        }
        onPick($('zipPick'), 'zip');
        onPick($('folderPick'), 'folder');
        onPick($('filePick'), 'files');
        window.addEventListener('resize', function () {
            try {
                var engine = window.csCore && window.csCore.getRenderingEngine(ENGINE_ID);
                if (engine && engine.resize) engine.resize();
            } catch (e) { /* ignore */ }
        });
    }

    function state() {
        return {
            ready: last.ready,
            vendor: vendorOk(),
            source: last.source,
            n: last.n,
            skipped: last.skipped || 0,
            mode: last.mode,
            tool: last.tool,
            volumeId: last.volumeId,
            error: last.error,
            include3d: last.include3d !== false,
            patient: window.__bananaCs3dCtx || null,
            implant: (window.CS3D_IMPLANT && CS3D_IMPLANT.state) ? CS3D_IMPLANT.state() : null
        };
    }

    function padEven(s) {
        s = String(s);
        return s.length % 2 ? s + ' ' : s;
    }
    function ctSlice(z, n) {
        var rows = 32, cols = 32;
        var pixels = new Uint8Array(rows * cols);
        var y, x, cx = 16, cy = 16, r = 4 + (z % 8);
        for (y = 0; y < rows; y++) {
            for (x = 0; x < cols; x++) {
                var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                pixels[y * cols + x] = d < r * r ? 220 : 20;
            }
        }
        function enc(s) {
            s = padEven(s);
            var a = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
            return a;
        }
        var chunks = [];
        function pushTag(g, e, vr, val) {
            var longVr = vr === 'OB' || vr === 'OW' || vr === 'UN';
            var data = typeof val === 'number' ? (function () {
                var u = new Uint8Array(2); u[0] = val & 255; u[1] = (val >> 8) & 255; return u;
            })() : (val instanceof Uint8Array ? val : enc(val));
            if (data.length % 2 && vr !== 'US') {
                var p = new Uint8Array(data.length + 1); p.set(data); data = p;
            }
            var head = new Uint8Array(longVr ? 12 : 8);
            head[0] = g & 255; head[1] = (g >> 8) & 255;
            head[2] = e & 255; head[3] = (e >> 8) & 255;
            head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
            if (longVr) {
                head[8] = data.length & 255; head[9] = (data.length >> 8) & 255;
            } else {
                head[6] = data.length & 255; head[7] = (data.length >> 8) & 255;
            }
            chunks.push(head, data);
        }
        var meta = [];
        var hold = chunks; chunks = meta;
        pushTag(0x0002, 0x0001, 'OB', new Uint8Array([0, 1]));
        pushTag(0x0002, 0x0010, 'UI', '1.2.840.10008.1.2.1');
        chunks = hold;
        var metaLen = 0; meta.forEach(function (a) { metaLen += a.length; });
        pushTag(0x0008, 0x0016, 'UI', '1.2.840.10008.5.1.4.1.1.2');
        pushTag(0x0008, 0x0018, 'UI', '1.2.826.0.1.3680043.8.498.1.' + n + '.' + z);
        pushTag(0x0008, 0x0060, 'CS', 'CT');
        pushTag(0x0020, 0x000D, 'UI', '1.2.826.0.1.3680043.8.498.10');
        pushTag(0x0020, 0x000E, 'UI', '1.2.826.0.1.3680043.8.498.11');
        pushTag(0x0020, 0x0011, 'IS', '1');
        pushTag(0x0020, 0x0013, 'IS', String(z + 1));
        pushTag(0x0020, 0x0032, 'DS', '0\\0\\' + z);
        pushTag(0x0020, 0x0037, 'DS', '1\\0\\0\\0\\1\\0');
        pushTag(0x0020, 0x0052, 'UI', '1.2.826.0.1.3680043.8.498.12');
        pushTag(0x0018, 0x0050, 'DS', '1');
        pushTag(0x0028, 0x0002, 'US', 1);
        pushTag(0x0028, 0x0004, 'CS', 'MONOCHROME2');
        pushTag(0x0028, 0x0010, 'US', rows);
        pushTag(0x0028, 0x0011, 'US', cols);
        pushTag(0x0028, 0x0030, 'DS', '1\\1');
        pushTag(0x0028, 0x0100, 'US', 8);
        pushTag(0x0028, 0x0101, 'US', 8);
        pushTag(0x0028, 0x0103, 'US', 0);
        pushTag(0x0028, 0x1050, 'DS', '128');
        pushTag(0x0028, 0x1051, 'DS', '256');
        pushTag(0x7FE0, 0x0010, 'OB', pixels);
        var total = 132 + 12 + metaLen;
        chunks.forEach(function (a) { total += a.length; });
        var out = new Uint8Array(total);
        out[128] = 68; out[129] = 73; out[130] = 67; out[131] = 77;
        var gl = new Uint8Array(12);
        gl[0] = 2; gl[2] = 0; gl[4] = 85; gl[5] = 76; gl[6] = 4;
        gl[8] = metaLen & 255; gl[9] = (metaLen >> 8) & 255;
        var at = 132;
        out.set(gl, at); at += 12;
        meta.forEach(function (a) { out.set(a, at); at += a.length; });
        chunks.forEach(function (a) { out.set(a, at); at += a.length; });
        return out;
    }

    async function loadTestVolume(n) {
        n = n || 8;
        var files = [];
        var i;
        for (i = 0; i < n; i++) {
            files.push(new File([ctSlice(i, n)], 'ct-' + i + '.dcm', { type: 'application/dicom' }));
        }
        return loadFiles(files, 'test-ct');
    }

    window.CS3D_PAGE = {
        loadFiles: loadFiles,
        loadTestVolume: loadTestVolume,
        pickVolumeImageIds: pickVolumeImageIds,
        hasReconstructablePlane: hasReconstructablePlane,
        setTool: setTool,
        setStatus: setStatus,
        resetCameras: resetCameras,
        volumeId: function () { return last.volumeId; },
        crosshairCenter: crosshairCenter,
        state: state,
        implant: null
    };

    bindUi();
    initLibs().then(function (ok) {
        if (ok) setStatus('Ready. Load a DICOM zip, folder, or files. Share this window in X-ray Helper to save a view.');
    }).catch(function (err) {
        setStatus('Cornerstone3D failed to start: ' + (err && err.message ? err.message : err), 'err');
    });
})();
