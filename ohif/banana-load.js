/* Unpack DICOM zip / folder and hand the instances to OHIF.
   Stock OHIF /local has no zip reader; a .zip is parsed as one DICOM and dropped. */
(function () {
    var FEED = '__bananaOhifFeed';

    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) {
        return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    }

    function inflateRaw(raw) {
        if (typeof DecompressionStream === 'undefined') {
            return Promise.reject(new Error('deflate'));
        }
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([raw]).stream().pipeThrough(ds);
        return new Response(stream).arrayBuffer().then(function (buf) {
            return new Uint8Array(buf);
        });
    }

    function findEocd(u8) {
        var min = Math.max(0, u8.length - 22 - 65535);
        for (var i = u8.length - 22; i >= min; i--) {
            if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
                return i;
            }
        }
        return -1;
    }

    function unzipBuffer(buf, depth) {
        depth = depth || 0;
        var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        if (depth > 2 || u8.length < 22 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
            return Promise.resolve([]);
        }
        var eocd = findEocd(u8);
        if (eocd < 0) return Promise.resolve([]);
        var cdOff = u32(u8, eocd + 16);
        var cdCount = u16(u8, eocd + 10);
        var jobs = [];
        var p = cdOff;
        var n;
        for (n = 0; n < cdCount && p + 46 <= u8.length; n++) {
            if (u8[p] !== 0x50 || u8[p + 1] !== 0x4b || u8[p + 2] !== 0x01 || u8[p + 3] !== 0x02) break;
            (function (method, comp, nameLen, extraLen, commLen, localOff, nameStart) {
                var name = '';
                try {
                    name = new TextDecoder('utf-8').decode(u8.subarray(nameStart, nameStart + nameLen));
                } catch (e) { name = ''; }
                if (!name || /\/$/.test(name) || /(^|\/)(__MACOSX|\.DS_Store)/i.test(name)) return;
                var lp = localOff;
                if (lp + 30 > u8.length || u8[lp] !== 0x50 || u8[lp + 1] !== 0x4b) return;
                var ln = u16(u8, lp + 26);
                var le = u16(u8, lp + 28);
                var dataStart = lp + 30 + ln + le;
                var raw = u8.subarray(dataStart, dataStart + comp);
                var base = name.split('/').pop() || name;
                jobs.push(Promise.resolve().then(function () {
                    if (method === 0) return raw;
                    if (method === 8) return inflateRaw(raw);
                    return null;
                }).then(function (bytes) {
                    if (!bytes) return [];
                    var slice = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                    if (/\.zip$/i.test(base)) return unzipBuffer(slice, depth + 1);
                    return [{ name: base, path: name, bytes: slice }];
                }, function () { return []; }));
            })(
                u16(u8, p + 10),
                u32(u8, p + 20),
                u16(u8, p + 28),
                u16(u8, p + 30),
                u16(u8, p + 32),
                u32(u8, p + 42),
                p + 46
            );
            p += 46 + u16(u8, p + 28) + u16(u8, p + 30) + u16(u8, p + 32);
        }
        return Promise.all(jobs).then(function (groups) {
            var out = [];
            groups.forEach(function (g) { out = out.concat(g); });
            return out;
        });
    }

    function looksZip(file) {
        var n = (file && (file.name || '')) || '';
        var t = (file && file.type) || '';
        return /\.zip$/i.test(n) || /zip/.test(t);
    }

    function looksDicom(name, bytes) {
        var base = String(name || '').split('/').pop() || '';
        if (/^DICOMDIR$/i.test(base)) return false;
        if (/\.(jpe?g|png|gif|txt|xml|json|html|nfo|pdf|exe|dll)$/i.test(base)) return false;
        if (bytes && bytes.length > 132 &&
            bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77) {
            return true;
        }
        if (/\.(dcm|dicom|ima)$/i.test(base)) return true;
        return false;
    }

    function fileToU8(file) {
        return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }

    function expandFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        return Promise.all(files.map(function (file) {
            if (looksZip(file)) {
                return fileToU8(file).then(function (u8) { return unzipBuffer(u8, 0); });
            }
            return fileToU8(file).then(function (u8) {
                return [{ name: file.name, path: file.webkitRelativePath || file.name, bytes: u8 }];
            });
        })).then(function (groups) {
            var out = [];
            groups.forEach(function (g) { out = out.concat(g); });
            return out.filter(function (x) { return x && looksDicom(x.name, x.bytes); })
                .map(function (x) {
                    return new File([x.bytes], x.name, { type: 'application/dicom' });
                });
        });
    }

    function status(msg, kind) {
        var bar = document.getElementById('bananaOhifBar');
        if (!bar) return;
        var el = document.getElementById('bananaOhifLoadStatus');
        if (!el) {
            el = document.createElement('span');
            el.id = 'bananaOhifLoadStatus';
            el.setAttribute('style', 'margin-left:10px;font-weight:700;');
            bar.appendChild(el);
        }
        el.style.color = kind === 'err' ? '#fca5a5' : (kind === 'ok' ? '#86efac' : '#fde047');
        el.textContent = msg || '';
    }

    function ohifFileInput() {
        var nodes = document.querySelectorAll('input[type=file]');
        var i;
        for (i = 0; i < nodes.length; i++) {
            if (!nodes[i].webkitdirectory) return nodes[i];
        }
        return nodes[0] || null;
    }

    function waitInput(ms) {
        ms = ms || 15000;
        var start = Date.now();
        return new Promise(function (resolve) {
            function tick() {
                var input = ohifFileInput();
                if (input) { resolve(input); return; }
                if (Date.now() - start > ms) { resolve(null); return; }
                setTimeout(tick, 200);
            }
            tick();
        });
    }

    function feedOhif(files) {
        return waitInput().then(function (input) {
            if (!input) {
                status('OHIF file picker is not ready. Refresh this window.', 'err');
                return false;
            }
            if (!files.length) {
                status('No DICOM instances in that zip/folder (need .dcm or DICM files).', 'err');
                return false;
            }
            var dt = new DataTransfer();
            files.forEach(function (f) { dt.items.add(f); });
            input[FEED] = true;
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            setTimeout(function () { try { input[FEED] = false; } catch (e) { /* ignore */ } }, 0);
            status('Handed ' + files.length + ' DICOM file' + (files.length === 1 ? '' : 's') + ' to OHIF.', 'ok');
            return true;
        });
    }

    function handleList(fileList, label) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) return Promise.resolve(false);
        var zips = files.filter(looksZip).length;
        status((zips ? 'Unpacking zip… ' : 'Reading folder… ') + files.length + ' item' + (files.length === 1 ? '' : 's') + (label ? ' (' + label + ')' : ''));
        return expandFiles(files).then(function (dcm) {
            return feedOhif(dcm);
        }, function (err) {
            status('Could not read the zip/folder: ' + (err && err.message ? err.message : 'error'), 'err');
            return false;
        });
    }

    function onDropCapture(ev) {
        var list = ev.dataTransfer && ev.dataTransfer.files;
        if (!list || !list.length) return;
        var files = Array.prototype.slice.call(list);
        if (!files.some(looksZip)) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        handleList(files, 'drop');
    }

    function onChangeCapture(ev) {
        var input = ev.target;
        if (!input || input.type !== 'file' || input[FEED] || input.getAttribute('data-banana-load')) return;
        var list = input.files;
        if (!list || !list.length) return;
        var files = Array.prototype.slice.call(list);
        if (!files.some(looksZip)) return;
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        handleList(files, input.webkitdirectory ? 'folder' : 'files');
    }

    function addBarButtons() {
        var bar = document.getElementById('bananaOhifBar');
        if (!bar || document.getElementById('bananaOhifLoadZip')) return;
        function mkBtn(id, text) {
            var b = document.createElement('button');
            b.id = id;
            b.type = 'button';
            b.textContent = text;
            b.setAttribute('style',
                'margin-left:8px;padding:3px 10px;border-radius:6px;border:1px solid #38bdf8;' +
                'background:#0ea5e9;color:#082f49;font:800 11px/1.2 Segoe UI,sans-serif;cursor:pointer;');
            return b;
        }
        var zipInput = document.createElement('input');
        zipInput.type = 'file';
        zipInput.accept = '.zip,application/zip';
        zipInput.setAttribute('data-banana-load', '1');
        zipInput.style.display = 'none';
        zipInput.addEventListener('change', function () {
            if (zipInput.files && zipInput.files.length) handleList(zipInput.files, 'zip');
            zipInput.value = '';
        });
        var folderInput = document.createElement('input');
        folderInput.type = 'file';
        folderInput.multiple = true;
        folderInput.setAttribute('webkitdirectory', 'true');
        folderInput.setAttribute('directory', 'true');
        folderInput.setAttribute('data-banana-load', '1');
        folderInput.style.display = 'none';
        folderInput.addEventListener('change', function () {
            if (folderInput.files && folderInput.files.length) handleList(folderInput.files, 'folder');
            folderInput.value = '';
        });
        var zipBtn = mkBtn('bananaOhifLoadZip', 'Load zip');
        var folderBtn = mkBtn('bananaOhifLoadFolder', 'Load folder');
        zipBtn.addEventListener('click', function () { zipInput.click(); });
        folderBtn.addEventListener('click', function () { folderInput.click(); });
        bar.appendChild(zipBtn);
        bar.appendChild(folderBtn);
        bar.appendChild(zipInput);
        bar.appendChild(folderInput);
    }

    document.addEventListener('drop', onDropCapture, true);
    document.addEventListener('change', onChangeCapture, true);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addBarButtons);
    } else {
        addBarButtons();
    }
    setTimeout(addBarButtons, 500);

    window.bananaOhifUnzip = unzipBuffer;
    window.bananaOhifExpandFiles = expandFiles;
    window.bananaOhifLooksDicom = looksDicom;
})();
