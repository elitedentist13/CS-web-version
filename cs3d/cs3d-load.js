/* Unpack DICOM zip / folder for the Banana Dicom Reader.
   Independent copy of the OHIF zip reader — does not feed OHIF or share its globals. */
(function () {
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
        if (window.CS3D_PAGE && typeof window.CS3D_PAGE.setStatus === 'function') {
            window.CS3D_PAGE.setStatus(msg, kind);
            return;
        }
        var el = document.getElementById('status');
        if (el) el.textContent = msg || '';
    }

    function handleList(fileList, label) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) return Promise.resolve(false);
        var zips = files.filter(looksZip).length;
        status((zips ? 'Unpacking zip… ' : 'Reading… ') + files.length + ' item' + (files.length === 1 ? '' : 's') + (label ? ' (' + label + ')' : ''));
        return expandFiles(files).then(function (dcm) {
            if (!dcm.length) {
                status('No DICOM instances in that zip/folder (need .dcm or DICM files).', 'err');
                return false;
            }
            if (window.CS3D_PAGE && typeof window.CS3D_PAGE.loadFiles === 'function') {
                return window.CS3D_PAGE.loadFiles(dcm, label || 'files');
            }
            status('Reader is not ready yet. Wait a moment and try again.', 'err');
            return false;
        }, function (err) {
            status('Could not read the zip/folder: ' + (err && err.message ? err.message : 'error'), 'err');
            return false;
        });
    }

    function onDropCapture(ev) {
        var list = ev.dataTransfer && ev.dataTransfer.files;
        if (!list || !list.length) return;
        ev.preventDefault();
        ev.stopPropagation();
        handleList(list, 'drop');
    }

    function onDragOver(ev) {
        if (ev.dataTransfer) ev.preventDefault();
    }

    document.addEventListener('drop', onDropCapture, true);
    document.addEventListener('dragover', onDragOver, true);

    window.bananaCs3dUnzip = unzipBuffer;
    window.bananaCs3dExpandFiles = expandFiles;
    window.bananaCs3dLooksDicom = looksDicom;
    window.bananaCs3dHandleList = handleList;
    window.bananaCs3dLooksZip = looksZip;
})();
