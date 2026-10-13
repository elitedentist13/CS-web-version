/* Unpack DICOM zip / folder for the Banana Dicom Reader.
   Independent copy of the OHIF zip reader — does not feed OHIF or share its globals. */
(function () {
    var zipNotes = { encrypted: 0, unsupported: 0, scanned: 0 };

    function u16(b, o) { return b[o] | (b[o + 1] << 8); }
    function u32(b, o) {
        return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    }
    function u64(b, o) {
        return u32(b, o) + u32(b, o + 4) * 4294967296;
    }

    function inflateRaw(raw) {
        if (typeof DecompressionStream === 'undefined') {
            return Promise.reject(new Error('deflate'));
        }
        var copy = raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array(raw);
        var ds = new DecompressionStream('deflate-raw');
        var stream = new Blob([copy]).stream().pipeThrough(ds);
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

    function zip64Central(u8, eocd) {
        var loc = eocd - 20;
        if (loc < 0 || u32(u8, loc) !== 0x07064b50) return null;
        var off = u64(u8, loc + 8);
        if (off < 0 || off + 56 > u8.length || u32(u8, off) !== 0x06064b50) return null;
        return {
            count: u64(u8, off + 32),
            cdOff: u64(u8, off + 48)
        };
    }

    function zip64Extra(u8, start, len, need) {
        var p = start;
        var end = start + len;
        var out = {};
        while (p + 4 <= end) {
            var id = u16(u8, p);
            var sz = u16(u8, p + 2);
            var body = p + 4;
            if (body + sz > end) break;
            if (id === 0x0001) {
                var q = body;
                if (need.uncomp && q + 8 <= body + sz) { out.uncomp = u64(u8, q); q += 8; }
                if (need.comp && q + 8 <= body + sz) { out.comp = u64(u8, q); q += 8; }
                if (need.off && q + 8 <= body + sz) { out.off = u64(u8, q); q += 8; }
            }
            p = body + sz;
        }
        return out;
    }

    function decodeName(bytes, utf8) {
        var name = '';
        try {
            if (typeof TextDecoder !== 'undefined') {
                name = new TextDecoder(utf8 ? 'utf-8' : 'utf-8').decode(bytes);
            }
        } catch (e) { name = ''; }
        if (!name) {
            var i;
            for (i = 0; i < bytes.length; i++) name += String.fromCharCode(bytes[i]);
        }
        return String(name || '').replace(/\\/g, '/').replace(/\0/g, '');
    }

    function baseName(name, index) {
        var base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
        base = base.replace(/[\\/:*?"<>|]/g, '_').trim();
        if (!base || base === '.' || base === '..') base = 'slice-' + index + '.dcm';
        return base;
    }

    function mapLimit(items, limit, fn) {
        var out = new Array(items.length);
        var next = 0;
        var active = 0;
        if (!items.length) return Promise.resolve(out);
        return new Promise(function (resolve, reject) {
            function pump() {
                if (next >= items.length && active === 0) { resolve(out); return; }
                while (active < limit && next < items.length) {
                    (function (idx) {
                        active++;
                        Promise.resolve().then(function () { return fn(items[idx], idx); }).then(function (val) {
                            out[idx] = val;
                            active--;
                            pump();
                        }, reject);
                    })(next++);
                }
            }
            pump();
        });
    }

    function unzipBuffer(buf, depth) {
        depth = depth || 0;
        var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        if (depth > 2 || u8.length < 22 || u8[0] !== 0x50 || u8[1] !== 0x4b) {
            return Promise.resolve([]);
        }
        var eocd = findEocd(u8);
        if (eocd < 0) return Promise.resolve([]);
        var cdCount = u16(u8, eocd + 10);
        var cdOff = u32(u8, eocd + 16);
        if (cdCount === 0xFFFF || cdOff === 0xFFFFFFFF || u32(u8, eocd + 12) === 0xFFFFFFFF) {
            var z64 = zip64Central(u8, eocd);
            if (z64) {
                if (cdCount === 0xFFFF) cdCount = z64.count;
                if (cdOff === 0xFFFFFFFF) cdOff = z64.cdOff;
            }
        }
        if (!cdCount || cdOff >= u8.length) return Promise.resolve([]);
        if (cdCount > 20000) cdCount = 20000;
        var jobs = [];
        var encrypted = 0;
        var unsupported = 0;
        var p = cdOff;
        var n;
        for (n = 0; n < cdCount && p + 46 <= u8.length; n++) {
            if (u8[p] !== 0x50 || u8[p + 1] !== 0x4b || u8[p + 2] !== 0x01 || u8[p + 3] !== 0x02) break;
            var flags = u16(u8, p + 8);
            var method = u16(u8, p + 10);
            var comp = u32(u8, p + 20);
            var uncomp = u32(u8, p + 24);
            var nameLen = u16(u8, p + 28);
            var extraLen = u16(u8, p + 30);
            var commLen = u16(u8, p + 32);
            var localOff = u32(u8, p + 42);
            var nameStart = p + 46;
            var extraStart = nameStart + nameLen;
            if (comp === 0xFFFFFFFF || uncomp === 0xFFFFFFFF || localOff === 0xFFFFFFFF) {
                var extra = zip64Extra(u8, extraStart, extraLen, {
                    uncomp: uncomp === 0xFFFFFFFF,
                    comp: comp === 0xFFFFFFFF,
                    off: localOff === 0xFFFFFFFF
                });
                if (extra.comp != null) comp = extra.comp;
                if (extra.off != null) localOff = extra.off;
            }
            var name = decodeName(u8.subarray(nameStart, nameStart + nameLen), (flags & 0x800) !== 0);
            p += 46 + nameLen + extraLen + commLen;
            if (!name || /\/$/.test(name) || /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)/i.test(name)) continue;
            if (flags & 1) { encrypted++; continue; }
            if (method !== 0 && method !== 8) { unsupported++; continue; }
            jobs.push({ method: method, comp: comp, localOff: localOff, name: name });
        }
        return mapLimit(jobs, 6, function (job, index) {
            var lp = job.localOff;
            if (lp + 30 > u8.length || u8[lp] !== 0x50 || u8[lp + 1] !== 0x4b) return [];
            var ln = u16(u8, lp + 26);
            var le = u16(u8, lp + 28);
            var dataStart = lp + 30 + ln + le;
            var dataEnd = dataStart + job.comp;
            if (dataEnd > u8.length) return [];
            var raw = u8.subarray(dataStart, dataEnd);
            var base = baseName(job.name, index);
            return Promise.resolve().then(function () {
                if (job.method === 0) return new Uint8Array(raw);
                return inflateRaw(raw);
            }).then(function (bytes) {
                if (!bytes || !bytes.length) return [];
                if (/\.zip$/i.test(base)) return unzipBuffer(bytes, depth + 1);
                return [{ name: base, path: job.name, bytes: bytes }];
            }, function () { return []; });
        }).then(function (groups) {
            var out = [];
            (groups || []).forEach(function (g) {
                if (!g) return;
                out = out.concat(g);
                if (g.encrypted) encrypted += g.encrypted;
                if (g.unsupported) unsupported += g.unsupported;
            });
            out.encrypted = encrypted;
            out.unsupported = unsupported;
            return out;
        });
    }

    function looksZip(file) {
        var n = (file && (file.name || file.path || '')) || '';
        var t = (file && file.type) || '';
        return /\.zip$/i.test(n) || /\/zip/i.test(t) || t === 'application/x-zip-compressed';
    }

    function headerIsDicom(bytes) {
        if (!bytes || bytes.length < 8) return false;
        if (bytes.length > 132 &&
            bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77) {
            return true;
        }
        if (bytes[0] === 68 && bytes[1] === 73 && bytes[2] === 67 && bytes[3] === 77) return true;
        var g = bytes[0] | (bytes[1] << 8);
        var e = bytes[2] | (bytes[3] << 8);
        if ((g === 0x0008 || g === 0x0002 || g === 0x0010 || g === 0x0020 || g === 0x0028) && e < 0x2000) {
            return true;
        }
        var gbe = (bytes[0] << 8) | bytes[1];
        var ebe = (bytes[2] << 8) | bytes[3];
        if ((gbe === 0x0008 || gbe === 0x0002) && ebe < 0x2000) return true;
        return false;
    }

    function looksDicom(name, bytes, size) {
        var base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
        if (!base || /^DICOMDIR$/i.test(base)) return false;
        if (/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(base)) return false;
        if (/\.(jpe?g|png|gif|txt|xml|json|html?|nfo|pdf|exe|dll|zip|bat|lnk|url)$/i.test(base)) return false;
        if (headerIsDicom(bytes)) return true;
        if (/\.(dcm|dicom|ima|dic|acr)$/i.test(base)) return true;
        if (!/\./.test(base) && size > 132 && bytes && bytes.length >= 8 && headerIsDicom(bytes)) return true;
        return false;
    }

    function fileToU8(file) {
        return file.arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
    }

    function peekHeader(file) {
        var blob = file.slice ? file.slice(0, 256) : file;
        var read = blob.arrayBuffer ? blob.arrayBuffer() : file.arrayBuffer();
        return Promise.resolve(read).then(function (buf) { return new Uint8Array(buf); });
    }

    function toDicomFile(entry, index) {
        var name = baseName(entry.name || entry.path, index);
        try {
            return new File([entry.bytes], name, { type: 'application/dicom' });
        } catch (e) {
            return new File([entry.bytes], 'slice-' + index + '.dcm', { type: 'application/dicom' });
        }
    }

    function oneLoose(file) {
        if (!file) return Promise.resolve([]);
        zipNotes.scanned++;
        if (looksZip(file)) {
            return fileToU8(file).then(function (u8) { return unzipBuffer(u8, 0); }).then(function (entries) {
                zipNotes.encrypted += entries.encrypted || 0;
                zipNotes.unsupported += entries.unsupported || 0;
                var kept = [];
                (entries || []).forEach(function (entry, i) {
                    if (entry && looksDicom(entry.path || entry.name, entry.bytes, entry.bytes && entry.bytes.length)) {
                        kept.push(toDicomFile(entry, i));
                    }
                });
                return kept;
            });
        }
        if (!file.size && file.size !== 0) return Promise.resolve([]);
        if (file.size === 0) return Promise.resolve([]);
        return peekHeader(file).then(function (head) {
            var name = file.webkitRelativePath || file.name || '';
            if (!looksDicom(name, head, file.size)) return [];
            return [file];
        });
    }

    function expandFiles(fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        zipNotes.encrypted = 0;
        zipNotes.unsupported = 0;
        zipNotes.scanned = 0;
        return mapLimit(files, 8, oneLoose).then(function (groups) {
            var out = [];
            (groups || []).forEach(function (g) { if (g && g.length) out = out.concat(g); });
            out.encrypted = zipNotes.encrypted;
            out.unsupported = zipNotes.unsupported;
            out.scanned = zipNotes.scanned;
            return out;
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

    function whenPage() {
        function ready() {
            var page = window.CS3D_PAGE;
            if (!page || typeof page.loadFiles !== 'function') return Promise.resolve(false);
            var p = page.ready && page.ready();
            if (p && typeof p.then === 'function') return p.then(function () { return true; }, function () { return true; });
            return Promise.resolve(true);
        }
        if (window.CS3D_PAGE && typeof window.CS3D_PAGE.loadFiles === 'function') return ready();
        return new Promise(function (resolve) {
            var n = 0;
            var t = setInterval(function () {
                n++;
                if (window.CS3D_PAGE && typeof window.CS3D_PAGE.loadFiles === 'function') {
                    clearInterval(t);
                    ready().then(resolve);
                } else if (n > 200) {
                    clearInterval(t);
                    resolve(false);
                }
            }, 100);
        });
    }

    function handleList(fileList, label) {
        var files = Array.prototype.slice.call(fileList || []);
        if (!files.length) {
            status('That drop did not include any files. Use Load folder, or drop the files themselves.', 'err');
            return Promise.resolve(false);
        }
        var zips = files.filter(looksZip).length;
        status((zips ? 'Unpacking… ' : 'Reading… ') + files.length + ' item' + (files.length === 1 ? '' : 's') +
            (label ? ' (' + label + ')' : ''));
        return Promise.all([expandFiles(files), whenPage()]).then(function (pair) {
            var dcm = pair[0] || [];
            if (!dcm.length) {
                if (dcm.encrypted) {
                    status('That zip is password-protected. Unzip it on this PC, then use Load folder.', 'err');
                } else if (dcm.unsupported) {
                    status('This browser cannot unpack that zip. Unzip the study, then use Load folder.', 'err');
                } else {
                    status('No CBCT slices in that selection (' + (dcm.scanned || files.length) +
                        ' item' + ((dcm.scanned || files.length) === 1 ? '' : 's') +
                        '). Load the CT stack (zip or folder). Pictures and reports are skipped.', 'err');
                }
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

    function readEntry(entry, prefix, depth) {
        return new Promise(function (resolve) {
            if (!entry || depth > 8) { resolve([]); return; }
            if (entry.isFile) {
                entry.file(function (file) {
                    resolve(file ? [file] : []);
                }, function () { resolve([]); });
                return;
            }
            if (!entry.isDirectory || !entry.createReader) { resolve([]); return; }
            var reader = entry.createReader();
            var batch = [];
            function pull() {
                reader.readEntries(function (ents) {
                    if (!ents || !ents.length) {
                        var dir = (prefix ? prefix + '/' : '') + (entry.name || '');
                        Promise.all(batch.map(function (child) {
                            return readEntry(child, dir, depth + 1);
                        })).then(function (groups) {
                            var out = [];
                            groups.forEach(function (g) { out = out.concat(g || []); });
                            resolve(out);
                        }, function () { resolve([]); });
                        return;
                    }
                    var i;
                    for (i = 0; i < ents.length; i++) batch.push(ents[i]);
                    pull();
                }, function () { resolve([]); });
            }
            pull();
        });
    }

    function filesFromDrop(dt) {
        var items = dt && dt.items;
        if (!items || !items.length || !items[0].webkitGetAsEntry) {
            return Promise.resolve(dt && dt.files ? Array.prototype.slice.call(dt.files) : []);
        }
        var entries = [];
        var i;
        for (i = 0; i < items.length; i++) {
            var ent = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
            if (ent) entries.push(ent);
        }
        if (!entries.length) {
            return Promise.resolve(dt.files ? Array.prototype.slice.call(dt.files) : []);
        }
        status('Opening dropped folder…');
        return Promise.all(entries.map(function (ent) { return readEntry(ent, '', 0); })).then(function (groups) {
            var out = [];
            groups.forEach(function (g) { out = out.concat(g || []); });
            if (!out.length && dt.files && dt.files.length) return Array.prototype.slice.call(dt.files);
            return out;
        });
    }

    function onDropCapture(ev) {
        var dt = ev.dataTransfer;
        if (!dt) return;
        var hasItems = dt.items && dt.items.length;
        var hasFiles = dt.files && dt.files.length;
        if (!hasItems && !hasFiles) return;
        ev.preventDefault();
        ev.stopPropagation();
        filesFromDrop(dt).then(function (list) { return handleList(list, 'drop'); });
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
    window.bananaCs3dHeaderIsDicom = headerIsDicom;
})();
