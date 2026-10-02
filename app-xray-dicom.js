/* =========================================================
   app-xray-dicom.js - in-house DICOM decode for the X-ray tab.
   OHIF/Viewers is the clinical checklist only (WW/WL, pixel
   spacing, metadata, transfer-syntax honesty). This module
   paints into the existing lightbox / thumbs / compare so
   measurements, FMX and notes stay on the same film.
   Loads after app-xray-viewer.js.
   ========================================================= */

(function () {
    var MORE = {
        'xd.group': { en: 'DICOM', 'zh-CN': 'DICOM', 'zh-Hant': 'DICOM' },
        'xd.wc': { en: 'Window center', 'zh-CN': '窗位', 'zh-Hant': '窗位' },
        'xd.ww': { en: 'Window width', 'zh-CN': '窗宽', 'zh-Hant': '窗寬' },
        'xd.reset': { en: 'File default', 'zh-CN': '文件默认', 'zh-Hant': '檔案預設' },
        'xd.frame': { en: 'Frame', 'zh-CN': '帧', 'zh-Hant': '幀' },
        'xd.meta': { en: 'DICOM tags', 'zh-CN': 'DICOM 标签', 'zh-Hant': 'DICOM 標籤' },
        'xd.modality': { en: 'Modality', 'zh-CN': '模态', 'zh-Hant': '模態' },
        'xd.size': { en: 'Size', 'zh-CN': '尺寸', 'zh-Hant': '尺寸' },
        'xd.spacing': { en: 'Pixel spacing', 'zh-CN': '像素间距', 'zh-Hant': '像素間距' },
        'xd.syntax': { en: 'Transfer syntax', 'zh-CN': '传输语法', 'zh-Hant': '傳輸語法' },
        'xd.unsupported': { en: 'This DICOM uses a compressed transfer syntax this page cannot decode. Download the file and open it in a dedicated viewer.', 'zh-CN': '此 DICOM 使用本页无法解码的压缩传输语法。请下载后用专用查看器打开。', 'zh-Hant': '此 DICOM 使用本頁無法解碼的壓縮傳輸語法。請下載後用專用檢視器開啟。' },
        'xd.bad': { en: 'This file is not a readable DICOM image.', 'zh-CN': '此文件不是可读取的 DICOM 影像。', 'zh-Hant': '此檔案不是可讀取的 DICOM 影像。' },
        'xd.loading': { en: 'Reading DICOM…', 'zh-CN': '正在读取 DICOM…', 'zh-Hant': '正在讀取 DICOM…' },
        'xd.cal': { en: 'Calibrated from DICOM pixel spacing: 1 px = {MM} mm', 'zh-CN': '已按 DICOM 像素间距校准：1 像素 = {MM} 毫米', 'zh-Hant': '已按 DICOM 像素間距校準：1 像素 = {MM} 毫米' },
        'xd.noSpacing': { en: 'No pixel spacing in this file — calibrate with a known length, or lengths stay in px.', 'zh-CN': '此文件无像素间距 — 请用已知长度校准，否则长度以像素显示。', 'zh-Hant': '此檔案無像素間距 — 請用已知長度校準，否則長度以像素顯示。' },
        'xd.stackNote': { en: 'Multi-frame file: showing frame {N} of {M}. This is not a 3D / CBCT workstation.', 'zh-CN': '多帧文件：第 {N} / {M} 帧。这不是三维 / CBCT 工作站。', 'zh-Hant': '多幀檔案：第 {N} / {M} 幀。這不是三維 / CBCT 工作站。' },
        'xd.thumb': { en: 'DICOM', 'zh-CN': 'DICOM', 'zh-Hant': 'DICOM' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_DICOM = {
    cache: {},
    view: {},
    blobs: {},
    openId: '',
    fetchIn: {},
    hooked: false
};

var XRAY_DICOM_TS = {
    ILE: '1.2.840.10008.1.2',
    ELE: '1.2.840.10008.1.2.1',
    EBE: '1.2.840.10008.1.2.2',
    JPEG: '1.2.840.10008.1.2.4.50'
};

var XRAY_DICOM_VR_LONG = { OB: 1, OD: 1, OF: 1, OL: 1, OV: 1, OW: 1, SQ: 1, SV: 1, UC: 1, UN: 1, UR: 1, UT: 1, UV: 1 };

var XRAY_DICOM_IMPL = {
    0x00020010: 'UI', 0x00080020: 'DA', 0x00080023: 'DA', 0x00080030: 'TM',
    0x00080060: 'CS', 0x0008103E: 'LO', 0x00100010: 'PN', 0x00100020: 'LO',
    0x00180050: 'DS', 0x00180088: 'DS', 0x00181164: 'DS',
    0x0020000D: 'UI', 0x0020000E: 'UI', 0x00200011: 'IS', 0x00200013: 'IS',
    0x00200032: 'DS', 0x00200037: 'DS',
    0x00280002: 'US', 0x00280004: 'CS', 0x00280008: 'IS', 0x00280010: 'US',
    0x00280011: 'US', 0x00280030: 'DS', 0x00280100: 'US', 0x00280101: 'US',
    0x00280102: 'US', 0x00280103: 'US', 0x00281050: 'DS', 0x00281051: 'DS',
    0x00281052: 'DS', 0x00281053: 'DS', 0x7FE00010: 'OW'
};

function xdTr(key, repl) {
    var s = (typeof t === 'function') ? t(key) : key;
    Object.keys(repl || {}).forEach(function (k) { s = String(s).split('{' + k + '}').join(repl[k]); });
    return s;
}

function xdEl(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function xdU16(u8, i, le) {
    return le ? (u8[i] | (u8[i + 1] << 8)) : ((u8[i] << 8) | u8[i + 1]);
}

function xdU32(u8, i, le) {
    return le
        ? ((u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16) | (u8[i + 3] << 24)) >>> 0)
        : ((u8[i] << 24) | (u8[i + 1] << 16) | (u8[i + 2] << 8) | u8[i + 3]) >>> 0;
}

function xdStr(u8, start, len) {
    var s = '';
    var n = start + len;
    for (var i = start; i < n && i < u8.length; i++) {
        var c = u8[i];
        if (c === 0) break;
        s += String.fromCharCode(c);
    }
    return s.replace(/\s+$/g, '');
}

function xdLooksLikeName(name) {
    return /\.(dcm|dicom)$/i.test(String(name || ''));
}

function xdLooksLikeBytes(u8) {
    if (!u8 || u8.length < 132) return false;
    return u8[128] === 68 && u8[129] === 73 && u8[130] === 67 && u8[131] === 77;
}

function xdLooksLikeRecord(rec) {
    if (!rec) return false;
    if (xdLooksLikeName(rec.file_name) || xdLooksLikeName(rec.file_path)) return true;
    var url = String((rec.file_url || '')).split('?')[0];
    return xdLooksLikeName(url);
}

function xdLooksLikeFile(file) {
    if (!file) return false;
    return xdLooksLikeName(file.name) || String(file.type || '') === 'application/dicom';
}

function xdGuessType(modality) {
    var m = String(modality || '').toUpperCase();
    if (m === 'PX' || m === 'PAN') return 'Panoramic';
    if (m === 'CT' || m === 'CBCT') return 'CBCT';
    if (m === 'CEPH' || m === 'XC') return 'Cephalometric';
    if (m === 'IO' || m === 'DX' || m === 'CR') return 'Periapical';
    return '';
}

function xdDateIso(da) {
    var d = String(da || '').replace(/\D/g, '');
    if (d.length < 8) return '';
    return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
}

function xdSkipUndef(u8, offset, little, end) {
    while (offset + 8 <= end) {
        var g = xdU16(u8, offset, little);
        var e = xdU16(u8, offset + 2, little);
        var len = xdU32(u8, offset + 4, little);
        offset += 8;
        if (g === 0xFFFE && e === 0xE0DD) return offset;
        if (g === 0xFFFE && e === 0xE000) {
            if (len === 0xFFFFFFFF) offset = xdSkipUndef(u8, offset, little, end);
            else offset += len;
        } else if (len !== 0xFFFFFFFF) {
            offset += len;
        }
    }
    return offset;
}

function xdReadEncapsulated(u8, offset, little, end) {
    var parts = [];
    var first = true;
    while (offset + 8 <= end) {
        var g = xdU16(u8, offset, little);
        var e = xdU16(u8, offset + 2, little);
        var len = xdU32(u8, offset + 4, little);
        offset += 8;
        if (g === 0xFFFE && e === 0xE0DD) break;
        if (g === 0xFFFE && e === 0xE000) {
            if (first) { first = false; offset += (len === 0xFFFFFFFF ? 0 : len); continue; }
            if (len && len !== 0xFFFFFFFF) {
                parts.push(u8.subarray(offset, offset + len));
                offset += len;
            }
        } else {
            break;
        }
    }
    if (!parts.length) return { offset: offset, bytes: null };
    var n = 0;
    parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n);
    var at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return { offset: offset, bytes: out };
}

function xdStore(into, g, e, vr, u8, start, len, little) {
    var key = (g << 16) | e;
    if (key === 0x7FE00010) {
        into.pixelOffset = start;
        into.pixelLength = len;
        into.pixelVr = vr;
        return;
    }
    var names = {
        0x00020010: 'transferSyntax', 0x00080020: 'studyDate', 0x00080023: 'contentDate',
        0x00080060: 'modality', 0x0008103E: 'seriesDesc', 0x00100010: 'patientName',
        0x00100020: 'patientId', 0x00180050: 'sliceThickness', 0x00180088: 'spacingBetween',
        0x00181164: 'imagerSpacing', 0x0020000E: 'seriesUid', 0x00200013: 'instanceNumber',
        0x00200032: 'imagePosition', 0x00200037: 'imageOrientation',
        0x00280002: 'samples',
        0x00280004: 'photo', 0x00280008: 'frames', 0x00280010: 'rows', 0x00280011: 'cols',
        0x00280030: 'pixelSpacing', 0x00280100: 'bitsAlloc', 0x00280101: 'bitsStored',
        0x00280103: 'pixelRep', 0x00281050: 'wc', 0x00281051: 'ww',
        0x00281052: 'intercept', 0x00281053: 'slope'
    };
    var name = names[key];
    if (!name) return;
    if (vr === 'US' || vr === 'SS') {
        into[name] = xdU16(u8, start, little);
        if (vr === 'SS' && into[name] > 32767) into[name] -= 65536;
    } else if (vr === 'UL' || vr === 'SL') {
        into[name] = xdU32(u8, start, little);
    } else {
        into[name] = xdStr(u8, start, len);
    }
}

function xdWalk(u8, offset, end, explicit, little, into) {
    while (offset + 8 <= end) {
        var g = xdU16(u8, offset, little);
        var e = xdU16(u8, offset + 2, little);
        offset += 4;
        var vr, len;
        if (g === 0xFFFE) {
            len = xdU32(u8, offset, little);
            offset += 4;
            if (e === 0xE0DD) return offset;
            if (e === 0xE000 && len !== 0xFFFFFFFF) offset += len;
            else if (e === 0xE000) offset = xdSkipUndef(u8, offset, little, end);
            continue;
        }
        if (explicit) {
            vr = String.fromCharCode(u8[offset], u8[offset + 1]);
            if (XRAY_DICOM_VR_LONG[vr]) {
                offset += 4;
                len = xdU32(u8, offset, little);
                offset += 4;
            } else {
                offset += 2;
                len = xdU16(u8, offset, little);
                offset += 2;
            }
        } else {
            vr = XRAY_DICOM_IMPL[(g << 16) | e] || 'UN';
            len = xdU32(u8, offset, little);
            offset += 4;
        }
        if (len === 0xFFFFFFFF) {
            if (g === 0x7FE0 && e === 0x0010) {
                var enc = xdReadEncapsulated(u8, offset, little, end);
                into.pixelEncapsulated = enc.bytes;
                return enc.offset;
            }
            offset = xdSkipUndef(u8, offset, little, end);
            continue;
        }
        if (offset + len > end) break;
        xdStore(into, g, e, vr, u8, offset, len, little);
        offset += len;
        if (g === 0x7FE0 && e === 0x0010) break;
    }
    return offset;
}

function xdFirstNum(s) {
    var p = String(s || '').split('\\')[0];
    var n = parseFloat(p);
    return isFinite(n) ? n : 0;
}

function xdAvgSpacing(s) {
    var parts = String(s || '').split('\\').map(function (x) { return parseFloat(x); }).filter(function (n) { return n > 0; });
    if (!parts.length) return 0;
    return parts.reduce(function (a, b) { return a + b; }, 0) / parts.length;
}

/** Parse a DICOM byte buffer. Uncompressed Implicit/Explicit LE and JPEG-baseline only. */
function xrayDicomParse(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!xdLooksLikeBytes(u8)) return { ok: false, reason: 'magic' };
    var le = true;
    var metaEnd = Math.min(u8.length, 132 + 8192);
    if (xdU16(u8, 132, true) === 0x0002 && xdU16(u8, 134, true) === 0x0000) {
        var glVr = String.fromCharCode(u8[136], u8[137]);
        var glLen = (glVr === 'UL') ? xdU32(u8, 140, true) : xdU32(u8, 138, true);
        var glHead = (glVr === 'UL') ? 12 : 8;
        metaEnd = Math.min(u8.length, 132 + glHead + glLen);
    }
    var tmp = {};
    var afterMeta = xdWalk(u8, 132, metaEnd, true, true, tmp);
    var ts = tmp.transferSyntax || XRAY_DICOM_TS.ELE;
    var explicit = ts !== XRAY_DICOM_TS.ILE;
    le = ts !== XRAY_DICOM_TS.EBE;
    var supported = ts === XRAY_DICOM_TS.ILE || ts === XRAY_DICOM_TS.ELE || ts === XRAY_DICOM_TS.EBE || ts === XRAY_DICOM_TS.JPEG;
    var dsOff = (xdU16(u8, 132, true) === 0x0002 && xdU16(u8, 134, true) === 0x0000) ? metaEnd : afterMeta;
    var into = { transferSyntax: ts };
    xdWalk(u8, dsOff, u8.length, explicit, le, into);
    into.transferSyntax = ts;
    into.ok = true;
    into.rows = into.rows || 0;
    into.cols = into.cols || 0;
    into.samples = into.samples || 1;
    into.bitsAlloc = into.bitsAlloc || 8;
    into.pixelRep = into.pixelRep || 0;
    into.frames = Math.max(1, parseInt(into.frames, 10) || 1);
    into.slope = xdFirstNum(into.slope) || 1;
    into.intercept = xdFirstNum(into.intercept) || 0;
    into.photo = String(into.photo || 'MONOCHROME2').replace(/\s+$/g, '');
    into.mmPerPx = xdAvgSpacing(into.pixelSpacing) || xdAvgSpacing(into.imagerSpacing) || 0;
    into.wc = xdFirstNum(into.wc);
    into.ww = xdFirstNum(into.ww);
    into.supported = supported;
    into._le = le;
    into._u8 = u8;
    if (!supported) {
        into.ok = true;
        into.decode = false;
        into.reason = 'syntax';
        return into;
    }
    if (ts === XRAY_DICOM_TS.JPEG) {
        into.decode = !!into.pixelEncapsulated;
        into.kind = 'jpeg';
        return into;
    }
    if (!into.rows || !into.cols || into.pixelOffset == null) {
        into.ok = false;
        into.reason = 'pixels';
        return into;
    }
    into.decode = true;
    into.kind = 'raw';
    into.values = xdUnpackPixels(into);
    if (!into.wc || !into.ww) {
        var mn = 1e15, mx = -1e15;
        for (var i = 0; i < into.values.length; i++) {
            var v = into.values[i];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
        }
        into.wc = (mn + mx) / 2;
        into.ww = Math.max(1, mx - mn);
    }
    return into;
}

function xdUnpackPixels(p) {
    var u8 = p._u8;
    var rows = p.rows, cols = p.cols, frames = p.frames;
    var spp = p.samples || 1;
    var bpp = p.bitsAlloc >= 16 ? 2 : 1;
    var n = rows * cols * frames;
    var out = new Float32Array(n);
    var signed = p.pixelRep === 1;
    var le = p._le !== false;
    var off = p.pixelOffset;
    var slope = p.slope, icept = p.intercept;
    var i, src, raw;
    if (bpp === 1) {
        for (i = 0; i < n; i++) {
            raw = u8[off + i * spp] || 0;
            if (signed && raw > 127) raw -= 256;
            out[i] = raw * slope + icept;
        }
        return out;
    }
    for (i = 0; i < n; i++) {
        src = off + i * spp * 2;
        raw = xdU16(u8, src, le);
        if (signed && raw > 32767) raw -= 65536;
        out[i] = raw * slope + icept;
    }
    return out;
}

function xrayDicomWindowByte(v, wc, ww) {
    var w = Math.max(1, ww);
    var lo = wc - 0.5 - (w - 1) / 2;
    var hi = wc - 0.5 + (w - 1) / 2;
    if (v <= lo) return 0;
    if (v > hi) return 255;
    if (hi <= lo) return 0;
    return Math.round(((v - lo) / (hi - lo)) * 255);
}

function xrayDicomRenderCanvas(parsed, wc, ww, frame) {
    var c = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
    if (!c) return null;
    c.width = parsed.cols;
    c.height = parsed.rows;
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(parsed.cols, parsed.rows);
    var d = img.data;
    var fr = Math.max(0, Math.min((parsed.frames || 1) - 1, frame || 0));
    var plane = parsed.cols * parsed.rows;
    var invert = /MONOCHROME1/i.test(parsed.photo || '');
    var vals = parsed.values;
    var i, v, b;
    for (i = 0; i < plane; i++) {
        v = vals[fr * plane + i];
        b = xrayDicomWindowByte(v, wc, ww);
        if (invert) b = 255 - b;
        d[i * 4] = b;
        d[i * 4 + 1] = b;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
}

function xrayDicomRenderToUrl(parsed, wc, ww, frame, quality) {
    if (parsed.kind === 'jpeg' && parsed.pixelEncapsulated && (frame || 0) === 0) {
        var blob = new Blob([parsed.pixelEncapsulated], { type: 'image/jpeg' });
        return URL.createObjectURL(blob);
    }
    var c = xrayDicomRenderCanvas(parsed, wc, ww, frame);
    if (!c) return '';
    return c.toDataURL('image/jpeg', quality || 0.82);
}

/** Small explicit-VR LE test image (used by smoke tests). */
function xrayDicomBuildUncompressed(opt) {
    opt = opt || {};
    var rows = opt.rows || 16;
    var cols = opt.cols || 32;
    var spacing = opt.spacing || 0.2;
    var wc = opt.wc != null ? opt.wc : 128;
    var ww = opt.ww != null ? opt.ww : 256;
    var tsUid = opt.transferSyntax || XRAY_DICOM_TS.ELE;
    var pixels = new Uint8Array(rows * cols);
    var y, x;
    for (y = 0; y < rows; y++) {
        for (x = 0; x < cols; x++) pixels[y * cols + x] = Math.round((x / Math.max(1, cols - 1)) * 255);
    }
    function encUI(s) {
        var t = String(s);
        if (t.length % 2) t += '\0';
        return t;
    }
    function encAS(s) {
        var t = String(s);
        if (t.length % 2) t += ' ';
        return t;
    }
    var chunks = [];
    function pushBytes(arr) { chunks.push(arr); }
    function pushTag(g, e, vr, val) {
        var isLong = !!XRAY_DICOM_VR_LONG[vr];
        var data;
        if (typeof val === 'string') {
            var s = encAS(val);
            data = new Uint8Array(s.length);
            for (var i = 0; i < s.length; i++) data[i] = s.charCodeAt(i);
        } else if (val instanceof Uint8Array) {
            data = val;
            if (data.length % 2) {
                var p = new Uint8Array(data.length + 1);
                p.set(data);
                data = p;
            }
        } else {
            data = new Uint8Array(2);
            data[0] = val & 255;
            data[1] = (val >> 8) & 255;
        }
        var head = new Uint8Array(isLong ? 12 : 8);
        head[0] = g & 255; head[1] = (g >> 8) & 255;
        head[2] = e & 255; head[3] = (e >> 8) & 255;
        head[4] = vr.charCodeAt(0); head[5] = vr.charCodeAt(1);
        if (isLong) {
            head[8] = data.length & 255;
            head[9] = (data.length >> 8) & 255;
            head[10] = (data.length >> 16) & 255;
            head[11] = (data.length >> 24) & 255;
        } else {
            head[6] = data.length & 255;
            head[7] = (data.length >> 8) & 255;
        }
        pushBytes(head);
        pushBytes(data);
    }
    var metaBits = [];
    function metaPush(arr) { metaBits.push(arr); }
    function metaTag(g, e, vr, val) {
        var hold = chunks; chunks = metaBits; pushTag(g, e, vr, val); chunks = hold;
    }
    metaTag(0x0002, 0x0001, 'OB', new Uint8Array([0, 1]));
    metaTag(0x0002, 0x0010, 'UI', encUI(tsUid));
    var metaLen = 0;
    metaBits.forEach(function (a) { metaLen += a.length; });
    var body = [];
    chunks = body;
    pushTag(0x0008, 0x0020, 'DA', '20261002');
    pushTag(0x0008, 0x0060, 'CS', 'IO');
    pushTag(0x0010, 0x0010, 'PN', 'TEST^DICOM');
    pushTag(0x0028, 0x0002, 'US', 1);
    pushTag(0x0028, 0x0004, 'CS', 'MONOCHROME2');
    pushTag(0x0028, 0x0010, 'US', rows);
    pushTag(0x0028, 0x0011, 'US', cols);
    pushTag(0x0028, 0x0030, 'DS', spacing + '\\' + spacing);
    pushTag(0x0028, 0x0100, 'US', 8);
    pushTag(0x0028, 0x0101, 'US', 8);
    pushTag(0x0028, 0x0103, 'US', 0);
    pushTag(0x0020, 0x0013, 'IS', String(opt.instanceNumber || 1));
    if (opt.ippZ != null) pushTag(0x0020, 0x0032, 'DS', '0\\0\\' + opt.ippZ);
    if (opt.sliceThickness) pushTag(0x0018, 0x0050, 'DS', String(opt.sliceThickness));
    pushTag(0x0028, 0x1050, 'DS', String(wc));
    pushTag(0x0028, 0x1051, 'DS', String(ww));
    pushTag(0x7FE0, 0x0010, 'OB', pixels);
    var total = 132 + 12 + metaLen;
    body.forEach(function (a) { total += a.length; });
    var out = new Uint8Array(total);
    out[128] = 68; out[129] = 73; out[130] = 67; out[131] = 77;
    var gl = new Uint8Array(12);
    gl[0] = 2; gl[2] = 0; gl[4] = 85; gl[5] = 76; /* UL */
    gl[6] = 4; gl[8] = metaLen & 255; gl[9] = (metaLen >> 8) & 255;
    /* 0002,0000 UL group length */
    gl[0] = 0x02; gl[1] = 0; gl[2] = 0; gl[3] = 0;
    gl[4] = 'U'.charCodeAt(0); gl[5] = 'L'.charCodeAt(0);
    gl[6] = 4; gl[7] = 0;
    gl[8] = metaLen & 255; gl[9] = (metaLen >> 8) & 255; gl[10] = 0; gl[11] = 0;
    var at = 132;
    out.set(gl, at); at += 12;
    metaBits.forEach(function (a) { out.set(a, at); at += a.length; });
    body.forEach(function (a) { out.set(a, at); at += a.length; });
    return out;
}

function xdKeepBlob(id, url) {
    if (XRAY_DICOM.blobs[id] && XRAY_DICOM.blobs[id] !== url) {
        try { URL.revokeObjectURL(XRAY_DICOM.blobs[id]); } catch (e) { /* ignore */ }
    }
    if (url && url.indexOf('blob:') === 0) XRAY_DICOM.blobs[id] = url;
}

function xrayDicomPlaceholder() {
    return 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180">' +
        '<rect fill="#0f172a" width="240" height="180"/>' +
        '<text x="50%" y="50%" fill="#7dd3fc" text-anchor="middle" dy=".3em" font-size="16">' +
        xdTr('xd.thumb') + '</text></svg>'
    );
}

function xrayDicomFetch(rec) {
    var id = String(rec.id);
    if (XRAY_DICOM.cache[id]) return Promise.resolve(XRAY_DICOM.cache[id]);
    if (XRAY_DICOM.fetchIn[id]) return XRAY_DICOM.fetchIn[id];
    var url = (typeof xrayBareUrl === 'function') ? xrayBareUrl(rec) : (rec.file_url || '');
    if (!url) return Promise.resolve({ ok: false, reason: 'url' });
    var p = fetch(url, { mode: 'cors' }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.arrayBuffer();
    }).then(function (buf) {
        var parsed = xrayDicomParse(new Uint8Array(buf));
        XRAY_DICOM.cache[id] = parsed;
        return parsed;
    }, function () {
        return { ok: false, reason: 'fetch' };
    }).then(function (parsed) {
        if (XRAY_DICOM.fetchIn[id]) delete XRAY_DICOM.fetchIn[id];
        return parsed;
    });
    XRAY_DICOM.fetchIn[id] = p;
    return p;
}

function xrayDicomViewState(id, parsed) {
    var cur = XRAY_DICOM.view[id];
    if (!cur) {
        cur = { wc: parsed.wc, ww: parsed.ww, frame: 0 };
        XRAY_DICOM.view[id] = cur;
    }
    return cur;
}

function xrayDicomPaintUrl(id, parsed) {
    var st = xrayDicomViewState(id, parsed);
    if (!parsed.decode) return '';
    if (parsed.kind === 'jpeg') {
        var u = xrayDicomRenderToUrl(parsed, st.wc, st.ww, st.frame);
        xdKeepBlob(id, u);
        return u;
    }
    var c = xrayDicomRenderCanvas(parsed, st.wc, st.ww, st.frame);
    if (!c || !c.toBlob) {
        return c ? c.toDataURL('image/jpeg', 0.85) : '';
    }
    return new Promise(function (resolve) {
        c.toBlob(function (b) {
            if (!b) { resolve(c.toDataURL('image/jpeg', 0.85)); return; }
            var url = URL.createObjectURL(b);
            xdKeepBlob(id, url);
            resolve(url);
        }, 'image/jpeg', 0.85);
    });
}

function xrayDicomBindThumb(img, rec) {
    if (!img || !rec || !xdLooksLikeRecord(rec)) return;
    img.setAttribute('data-xray-id', rec.id);
    if (XRAY_DICOM.blobs[rec.id]) { img.src = XRAY_DICOM.blobs[rec.id]; return; }
    img.src = xrayDicomPlaceholder();
    xrayDicomFetch(rec).then(function (parsed) {
        if (!parsed || !parsed.ok || !parsed.decode) return;
        return Promise.resolve(xrayDicomPaintUrl(rec.id, parsed)).then(function (url) {
            if (url && img.getAttribute('data-xray-id') === String(rec.id)) img.src = url;
        });
    });
}

function xrayDicomBindRoot(root, recs) {
    if (!root || !recs) return;
    var map = {};
    recs.forEach(function (r) { if (r && r.id) map[String(r.id)] = r; });
    Array.prototype.forEach.call(root.querySelectorAll('img[data-xray-id]'), function (img) {
        var rec = map[img.getAttribute('data-xray-id')];
        if (rec) xrayDicomBindThumb(img, rec);
    });
}

function xrayDicomIsOpen() {
    return !!XRAY_DICOM.openId;
}

function xdShowChrome(on) {
    var g = xdEl('lbDicomGroup');
    if (g) g.style.display = on ? 'flex' : 'none';
    var meta = xdEl('xrayDicomMeta');
    if (meta) meta.hidden = !on;
    var note = xdEl('xrayDicomStatus');
    if (note && !on) { note.hidden = true; note.textContent = ''; }
    var crop = xdEl('lbTBtn-crop');
    if (crop) crop.disabled = !!on;
}

function xdPaintMeta(parsed) {
    var box = xdEl('xrayDicomMeta');
    if (!box) return;
    if (!parsed || !parsed.ok) { box.hidden = true; box.innerHTML = ''; return; }
    var rows = [
        [xdTr('xd.modality'), parsed.modality || '—'],
        [xdTr('xd.size'), (parsed.cols || '?') + ' × ' + (parsed.rows || '?') + (parsed.frames > 1 ? ' × ' + parsed.frames : '')],
        [xdTr('xd.spacing'), parsed.mmPerPx ? (parsed.mmPerPx.toFixed(4) + ' mm') : '—'],
        [xdTr('xd.syntax'), parsed.transferSyntax || '—']
    ];
    if (parsed.patientName) rows.unshift(['', String(parsed.patientName).replace(/\^/g, ' ')]);
    var html = '<div class="xd-title">' + xdTr('xd.meta') + '</div>';
    rows.forEach(function (r) {
        html += '<div class="xd-row"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>';
    });
    if (!parsed.decode) html += '<p class="xd-warn">' + xdTr('xd.unsupported') + '</p>';
    if (parsed.frames > 1) html += '<p class="xd-note">' + xdTr('xd.stackNote', { N: (XRAY_DICOM.view[XRAY_DICOM.openId] || {}).frame + 1 || 1, M: parsed.frames }) + '</p>';
    box.innerHTML = html;
    box.hidden = false;
}

function xdSyncSliders(st, parsed) {
    var wc = xdEl('lbDicomWc');
    var ww = xdEl('lbDicomWw');
    var wcv = xdEl('lbDicomWcVal');
    var wwv = xdEl('lbDicomWwVal');
    var fr = xdEl('lbDicomFrame');
    var frw = xdEl('lbDicomFrameWrap');
    var span = Math.max(256, Math.round(Math.abs(st.ww) || 256));
    if (wc) {
        wc.min = String(Math.round(st.wc - span * 2));
        wc.max = String(Math.round(st.wc + span * 2));
        wc.value = String(Math.round(st.wc));
    }
    if (ww) {
        ww.min = '1';
        ww.max = String(Math.max(4095, span * 4));
        ww.value = String(Math.max(1, Math.round(st.ww)));
    }
    if (wcv) wcv.textContent = String(Math.round(st.wc));
    if (wwv) wwv.textContent = String(Math.max(1, Math.round(st.ww)));
    if (frw) frw.hidden = !(parsed && parsed.frames > 1);
    if (fr && parsed) {
        fr.max = String(Math.max(0, parsed.frames - 1));
        fr.value = String(st.frame || 0);
    }
}

function xrayDicomApplyAutoCal(rec, parsed) {
    if (!parsed || !parsed.mmPerPx || typeof XRAY_MEAS === 'undefined') return;
    if (!XRAY_MEAS.rec || String(XRAY_MEAS.rec.id) !== String(rec.id)) return;
    var d = XRAY_MEAS.data;
    if (d.cal && d.cal.source === 'user') return;
    if (d.cal && d.cal.pts && d.cal.pts.length === 2 && d.cal.source !== 'dicom') return;
    d.cal = { mmPerPx: parsed.mmPerPx, knownMm: parsed.mmPerPx, pts: [], source: 'dicom' };
    if (typeof xrayMeasRender === 'function') xrayMeasRender();
}

function xrayDicomSetImg(url) {
    var img = xdEl('xrayLbImg');
    if (!img || !url) return;
    img.onload = function () {
        if (typeof lbInitCanvas === 'function') lbInitCanvas();
        if (typeof xrayMeasRender === 'function') xrayMeasRender();
    };
    img.style.display = 'block';
    img.src = url;
    if (img.complete && img.naturalWidth) {
        if (typeof lbInitCanvas === 'function') lbInitCanvas();
    }
}

function xrayDicomOpen(rec) {
    if (!rec || !xdLooksLikeRecord(rec)) {
        XRAY_DICOM.openId = '';
        xdShowChrome(false);
        return false;
    }
    XRAY_DICOM.openId = String(rec.id);
    xdShowChrome(true);
    var img = xdEl('xrayLbImg');
    if (img) {
        img.style.display = 'block';
        img.src = XRAY_DICOM.blobs[rec.id] || xrayDicomPlaceholder();
    }
    var note = xdEl('xrayDicomStatus');
    if (note) { note.hidden = false; note.textContent = xdTr('xd.loading'); }
    xrayDicomFetch(rec).then(function (parsed) {
        if (XRAY_DICOM.openId !== String(rec.id)) return;
        if (!parsed || !parsed.ok) {
            if (note) note.textContent = xdTr('xd.bad');
            xdPaintMeta(parsed);
            return;
        }
        var st = xrayDicomViewState(rec.id, parsed);
        xdSyncSliders(st, parsed);
        xdPaintMeta(parsed);
        if (!parsed.decode) {
            if (note) note.textContent = xdTr('xd.unsupported');
            return;
        }
        if (note) {
            note.textContent = parsed.mmPerPx
                ? xdTr('xd.cal', { MM: parsed.mmPerPx.toFixed(4) })
                : xdTr('xd.noSpacing');
        }
        Promise.resolve(xrayDicomPaintUrl(rec.id, parsed)).then(function (url) {
            if (XRAY_DICOM.openId !== String(rec.id) || !url) return;
            xrayDicomSetImg(url);
            xrayDicomApplyAutoCal(rec, parsed);
            xdShowChrome(true);
            xdPaintMeta(parsed);
            xdSyncSliders(xrayDicomViewState(rec.id, parsed), parsed);
        });
    });
    return true;
}

function xrayDicomRelight() {
    var id = XRAY_DICOM.openId;
    if (!id) return;
    var parsed = XRAY_DICOM.cache[id];
    if (!parsed || !parsed.decode) return;
    Promise.resolve(xrayDicomPaintUrl(id, parsed)).then(function (url) {
        if (url && XRAY_DICOM.openId === id) xrayDicomSetImg(url);
        xdPaintMeta(parsed);
    });
}

function xrayDicomOnWc(v) {
    var id = XRAY_DICOM.openId;
    if (!id) return;
    XRAY_DICOM.view[id] = XRAY_DICOM.view[id] || {};
    XRAY_DICOM.view[id].wc = Number(v);
    var el = xdEl('lbDicomWcVal');
    if (el) el.textContent = String(Math.round(Number(v)));
    xrayDicomRelight();
}

function xrayDicomOnWw(v) {
    var id = XRAY_DICOM.openId;
    if (!id) return;
    XRAY_DICOM.view[id] = XRAY_DICOM.view[id] || {};
    XRAY_DICOM.view[id].ww = Math.max(1, Number(v));
    var el = xdEl('lbDicomWwVal');
    if (el) el.textContent = String(Math.round(XRAY_DICOM.view[id].ww));
    xrayDicomRelight();
}

function xrayDicomOnFrame(v) {
    var id = XRAY_DICOM.openId;
    if (!id) return;
    XRAY_DICOM.view[id] = XRAY_DICOM.view[id] || {};
    XRAY_DICOM.view[id].frame = parseInt(v, 10) || 0;
    xrayDicomRelight();
}

function xrayDicomResetWl() {
    var id = XRAY_DICOM.openId;
    var parsed = id && XRAY_DICOM.cache[id];
    if (!parsed) return;
    XRAY_DICOM.view[id] = { wc: parsed.wc, ww: parsed.ww, frame: 0 };
    xdSyncSliders(XRAY_DICOM.view[id], parsed);
    xrayDicomRelight();
}

function xrayDicomPrefillUpload(file) {
    if (!xdLooksLikeFile(file)) return Promise.resolve(null);
    return file.arrayBuffer().then(function (buf) {
        var parsed = xrayDicomParse(new Uint8Array(buf));
        if (!parsed || !parsed.ok) return null;
        var dateEl = xdEl('uploadDate');
        var typeEl = xdEl('uploadType');
        var iso = xdDateIso(parsed.contentDate || parsed.studyDate);
        if (dateEl && iso && (!file.xhDate)) dateEl.value = iso;
        var guess = xdGuessType(parsed.modality);
        if (typeEl && guess && !file.xhTypeGuess) typeEl.value = guess;
        return parsed;
    }, function () { return null; });
}

function xrayDicomHook() {
    if (XRAY_DICOM.hooked) return;
    if (typeof window.openLightbox !== 'function') return;
    XRAY_DICOM.hooked = true;

    var wrap = function (name, after) {
        var base = window[name];
        if (typeof base !== 'function' || base._xd) return;
        var w = function () {
            var out = base.apply(this, arguments);
            try { after.apply(this, arguments); } catch (e) { console.error('[xray-dicom]', e); }
            return out;
        };
        w._xd = true;
        if (base._xv) w._xv = base._xv;
        window[name] = w;
    };

    wrap('openLightbox', function (idx) {
        var rec = (typeof xrayFiltered !== 'undefined' && xrayFiltered) ? xrayFiltered[idx] : null;
        if (rec && xdLooksLikeRecord(rec)) xrayDicomOpen(rec);
        else { XRAY_DICOM.openId = ''; xdShowChrome(false); }
    });
    wrap('openLightboxRecord', function (rec) {
        if (rec && xdLooksLikeRecord(rec)) xrayDicomOpen(rec);
        else { XRAY_DICOM.openId = ''; xdShowChrome(false); }
    });
    wrap('_forceCloseLightbox', function () {
        XRAY_DICOM.openId = '';
        xdShowChrome(false);
    });
    wrap('renderXrayGrid', function () {
        var grid = xdEl('xrayGridView');
        if (grid && typeof xrayFiltered !== 'undefined') xrayDicomBindRoot(grid, xrayFiltered);
    });
    wrap('renderFilmstrip', function () {
        var fs = xdEl('xrayFilmstrip');
        if (fs && typeof xrayFiltered !== 'undefined') xrayDicomBindRoot(fs, xrayFiltered);
    });
    wrap('renderSlideAt', function (idx) {
        var rec = (typeof xrayFiltered !== 'undefined') ? xrayFiltered[idx] : null;
        var img = xdEl('xraySlideImg');
        if (img && rec && xdLooksLikeRecord(rec)) xrayDicomBindThumb(img, rec);
    });
    wrap('xrayMountRender', function () {
        var body = xdEl('xrayMountBody') || document.querySelector('.xray-mount-box');
        var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : xrayFiltered;
        if (body) xrayDicomBindRoot(body, rows);
    });
    wrap('lbInitCanvas', function () {
        if (!xrayDicomIsOpen()) return;
        var crop = xdEl('lbTBtn-crop');
        if (crop) crop.disabled = true;
    });
    wrap('xrayApplyLightboxReadonly', function (rec) {
        if (xrayDicomIsOpen() || (rec && xdLooksLikeRecord(rec))) {
            var crop = xdEl('lbTBtn-crop');
            if (crop) crop.disabled = true;
        }
    });
    wrap('xrayCmpPick', function (side, id) {
        var rec = typeof xrayCtxRecord === 'function' ? xrayCtxRecord(id) : null;
        var img = xdEl('xrayCompareImg' + String(side || '').toUpperCase());
        if (img && rec && xdLooksLikeRecord(rec)) xrayDicomBindThumb(img, rec);
    });
    wrap('showUploadModal', function (file) {
        xrayDicomPrefillUpload(file).then(function (parsed) {
            if (!parsed || !parsed.decode) return;
            var box = xdEl('uploadPreviewWrap');
            if (!box) return;
            var c = xrayDicomRenderCanvas(parsed, parsed.wc, parsed.ww, 0);
            if (!c) return;
            c.style.maxWidth = '100%';
            c.style.maxHeight = '200px';
            box.innerHTML = '';
            box.appendChild(c);
        });
    });

    if (typeof window.lbNeedsImagePersist === 'function' && !window.lbNeedsImagePersist._xd) {
        var baseP = window.lbNeedsImagePersist;
        window.lbNeedsImagePersist = function () {
            if (xrayDicomIsOpen()) return false;
            return baseP.apply(this, arguments);
        };
        window.lbNeedsImagePersist._xd = true;
    }
    if (typeof window.xrayOpenCompare === 'function' && !window.xrayOpenCompare._xdCmp) {
        var baseC = window.xrayOpenCompare;
        window.xrayOpenCompare = function (idA, idB) {
            var out = baseC.apply(this, arguments);
            [idA, idB].forEach(function (id, n) {
                var rec = typeof xrayCtxRecord === 'function' ? xrayCtxRecord(id) : null;
                if (!rec || !xdLooksLikeRecord(rec)) return;
                var img = xdEl(n === 0 ? 'xrayCompareImgA' : 'xrayCompareImgB');
                if (img) xrayDicomBindThumb(img, rec);
            });
            return out;
        };
        window.xrayOpenCompare._xdCmp = true;
        if (baseC._xv) window.xrayOpenCompare._xv = baseC._xv;
    }
    if (typeof window.xrayMeasLoad === 'function' && !window.xrayMeasLoad._xd) {
        var baseM = window.xrayMeasLoad;
        window.xrayMeasLoad = function (rec) {
            var out = baseM.apply(this, arguments);
            if (rec && XRAY_DICOM.cache[rec.id]) xrayDicomApplyAutoCal(rec, XRAY_DICOM.cache[rec.id]);
            return out;
        };
        window.xrayMeasLoad._xd = true;
    }

    var host = xdEl('xrayClinicStrips');
    if (host && !host._xdBound) {
        host._xdBound = true;
        var mo = new MutationObserver(function () {
            if (typeof xrayFiltered !== 'undefined') xrayDicomBindRoot(host, xrayAllRecords || xrayFiltered);
        });
        mo.observe(host, { childList: true, subtree: true });
    }
}

(function () {
    function boot() {
        xrayDicomHook();
        xdShowChrome(false);
    }
    xrayDicomHook();
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }
})();
