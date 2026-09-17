// ════════════════════════════════════════════════════════════════
// app-xray-link.js — Cross-clinic X-ray strips (HKID-linked charts)
// Loaded after app-xray.js. Overrides load / filter / view.
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    if (typeof xrayView === 'undefined') return;

    var xrayOpenLightboxCore = (typeof openLightbox === 'function') ? openLightbox : null;
    var xraySaveLbMetaCore = (typeof saveLbMeta === 'function') ? saveLbMeta : null;
    var xrayDeleteLbCore = (typeof deleteLbXray === 'function') ? deleteLbXray : null;
    var xrayStripsBound = false;

    function xrayThumbUrl(record) {
        var raw = (typeof xrayBareUrl === 'function') ? xrayBareUrl(record) : (record && record.file_url) || '';
        if (!raw || raw.indexOf('data:') === 0) {
            return typeof xrayDisplayUrl === 'function' ? xrayDisplayUrl(record) : raw;
        }
        var render = raw.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
        if (render === raw) {
            return typeof xrayDisplayUrl === 'function' ? xrayDisplayUrl(record) : raw;
        }
        var join = render.indexOf('?') >= 0 ? '&' : '?';
        return render + join + 'width=280&resize=contain&quality=70';
    }

    window.xrayNormalizeHkid = function (raw) {
        return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    };

    function xrayPatientClinicTag(p) {
        if (!p) return '';
        var field = (typeof PATIENT_CLINIC_TAG_FIELD === 'string') ? PATIENT_CLINIC_TAG_FIELD : 'clinic_tag';
        return String(p[field] || p.clinic_tag || '').trim();
    }

    function xrayClinicRecordFromTag(tag) {
        var t = String(tag || '').trim();
        if (!t || typeof APP_CLINICS === 'undefined' || !APP_CLINICS) return null;
        var i, c;
        for (i = 0; i < APP_CLINICS.length; i++) {
            c = APP_CLINICS[i];
            if (!c) continue;
            if (String(c.id) === t) return c;
            if (String(c.clinic_code || '').trim() === t) return c;
        }
        return null;
    }

    function xrayClinicLabelFromTag(tag) {
        var rec = xrayClinicRecordFromTag(tag);
        if (rec) {
            var code = String(rec.clinic_code || '').trim();
            if (code) return code;
            if (typeof clinicDisplayName === 'function') return clinicDisplayName(rec);
        }
        return String(tag || '').trim() || mediaTr('common.clinic');
    }

    function xrayForceCloseLightbox() {
        if (typeof _forceCloseLightbox === 'function') _forceCloseLightbox();
        else {
            var lb = g('xrayLightbox');
            if (lb) lb.style.display = 'none';
        }
    }

    window.xrayWorkingClinicTag = function () {
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return '';
    };

    function xrayChartsAtTag(home, matches, tag) {
        var want = String(tag || '').trim().toUpperCase();
        var out = [];
        var seen = {};
        function add(row) {
            if (!row || !row.id || !want) return;
            if (xrayPatientClinicTag(row).toUpperCase() !== want) return;
            var id = String(row.id);
            if (seen[id]) return;
            seen[id] = true;
            out.push(row);
        }
        add(home);
        (matches || []).forEach(add);
        return out;
    }

    function xrayTagEquals(a, b) {
        return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();
    }

    window.xrayHomeClinicTag = function () {
        var tag = xrayPatientClinicTag(xrayPatientData);
        if (tag) return tag;
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return '';
    };

    // New uploads (and lightbox edits of those films) go to the working
    // clinic chart, not the opened chart-number prefix. Viewing still
    // stays on the selected chart; HKID twins are a union of patient_ids.
    window.xrayUploadOverrideTarget = null;
    var xrayChooserOnDone = null;
    var xrayChooserBareNo = '';

    window.xrayClearUploadOverride = function () {
        window.xrayUploadOverrideTarget = null;
    };

    function xrayMakeWriteTarget(p, extras) {
        extras = extras || {};
        if (!p || !p.id) return { ok: false, reason: 'no-patient' };
        var tag = extras.clinic_tag || xrayPatientClinicTag(p) || xrayWorkingClinicTag();
        return {
            ok: true,
            id: p.id,
            patient_no: p.patient_no || extras.patient_no || null,
            full_name: p.full_name || extras.full_name || null,
            clinic_tag: tag,
            clinicLabel: extras.clinicLabel || xrayClinicLabelFromTag(tag),
            sameAsOpened: String(p.id) === String(xrayPatientId)
        };
    }

    window.xrayUploadTargetPatient = function () {
        if (window.xrayUploadOverrideTarget && window.xrayUploadOverrideTarget.ok) {
            return window.xrayUploadOverrideTarget;
        }
        var work = xrayWorkingClinicTag();
        var home = xrayPatientData;
        var homeTag = xrayPatientClinicTag(home);
        var workLabel = xrayClinicLabelFromTag(work);
        if (!xrayPatientId) {
            return { ok: false, reason: 'no-patient', workingTag: work, clinicLabel: workLabel };
        }
        if (!work || xrayTagEquals(homeTag, work)) {
            return {
                ok: true,
                id: xrayPatientId,
                patient_no: (home && home.patient_no) || null,
                full_name: (home && home.full_name) || null,
                clinic_tag: homeTag || work || '',
                clinicLabel: xrayClinicLabelFromTag(homeTag || work),
                sameAsOpened: true
            };
        }
        var charts = xrayChartsAtTag(home, xrayLinkedPatients, work);
        if (charts.length === 1 && charts[0] && charts[0].id) {
            var twin = charts[0];
            return {
                ok: true,
                id: twin.id,
                patient_no: twin.patient_no || null,
                full_name: twin.full_name || null,
                clinic_tag: xrayPatientClinicTag(twin) || work,
                clinicLabel: xrayClinicLabelFromTag(xrayPatientClinicTag(twin) || work),
                sameAsOpened: String(twin.id) === String(xrayPatientId)
            };
        }
        if (charts.length > 1) {
            return {
                ok: false,
                reason: 'ambiguous',
                workingTag: work,
                clinicLabel: workLabel,
                chartTag: homeTag
            };
        }
        return {
            ok: false,
            reason: 'no-working-chart',
            workingTag: work,
            clinicLabel: workLabel,
            chartTag: homeTag
        };
    };

    window.xrayExplainUploadBlock = function (target) {
        if (target && target.ok) return;
        var work = (target && (target.clinicLabel || target.workingTag)) || xrayWorkingClinicTag();
        if (target && target.reason === 'ambiguous') {
            alert(mediaTrRepl('con.xray.uploadAmbiguousWork', { WORK: work }));
            return;
        }
        if (target && target.reason === 'no-working-chart') {
            alert(mediaTrRepl('con.xray.uploadNeedWorkChart', { WORK: work }));
            return;
        }
        alert(mediaTr('con.forms.alertSelectPatient'));
    };

    function xrayChooserExistingCharts() {
        var seen = {};
        var out = [];
        function add(p) {
            if (!p || !p.id) return;
            var id = String(p.id);
            if (seen[id]) return;
            seen[id] = true;
            out.push(p);
        }
        if (xrayPatientData && xrayPatientId) {
            add(Object.assign({}, xrayPatientData, { id: xrayPatientId }));
        }
        (xrayLinkedPatients || []).forEach(add);
        return out;
    }

    function xrayChooserCoreKey(no) {
        var raw = (typeof clinicNoNumbersOnly === 'function')
            ? clinicNoNumbersOnly(no)
            : String(no || '').replace(/\D/g, '');
        if (!raw) return '';
        return String(parseInt(raw, 10));
    }

    window.xrayAllocBarePatientNo = function (cb) {
        if (typeof collectAllPatientNumbersThen !== 'function') {
            if (cb) cb(null, new Error('no number allocator'));
            return;
        }
        collectAllPatientNumbersThen(function (list, err) {
            if (err) {
                if (cb) cb(null, err);
                return;
            }
            var used = {};
            (list || []).forEach(function (no) {
                var key = xrayChooserCoreKey(no);
                if (key) used[key] = true;
            });
            var minReg = (typeof patientNoMinReg === 'function') ? patientNoMinReg() : 10000;
            var maxReg = (typeof patientNoMaxReg === 'function') ? patientNoMaxReg() : 999999;
            var width = (typeof patientNoDigitWidth === 'function') ? patientNoDigitWidth() : 6;
            var next = null;
            var usedNums = Object.keys(used).map(function (k) { return parseInt(k, 10); });
            if (usedNums.length) {
                var cand = Math.max.apply(null, usedNums) + 1;
                if (cand <= maxReg && !used[String(cand)]) next = cand;
            } else {
                next = minReg;
            }
            if (next == null) {
                var n;
                for (n = minReg; n <= maxReg; n++) {
                    if (!used[String(n)]) {
                        next = n;
                        break;
                    }
                }
            }
            if (next == null) {
                if (cb) cb(null);
                return;
            }
            var pad = String(next);
            while (pad.length < width) pad = '0' + pad;
            if (cb) cb(pad);
        });
    };

    function xrayChooserShowError(msg) {
        var err = g('xrayChooserError');
        if (!err) return;
        if (!msg) {
            err.hidden = true;
            err.textContent = '';
            return;
        }
        err.hidden = false;
        err.textContent = msg;
    }

    window.xrayChooserSyncMode = function () {
        var globalOn = !!(g('xrayChooserModeGlobal') && g('xrayChooserModeGlobal').checked);
        var sel = g('xrayChooserChartSelect');
        var hkid = g('xrayChooserHkid');
        if (sel) sel.disabled = globalOn;
        if (hkid) hkid.disabled = !globalOn;
    };

    function xrayChooserFinish(ok) {
        var cb = xrayChooserOnDone;
        xrayChooserOnDone = null;
        if (typeof closeModal === 'function') closeModal('xrayUploadChooserModal');
        if (typeof cb === 'function') cb(!!ok);
    }

    window.xrayCancelUploadChooser = function () {
        window.xrayClearUploadOverride();
        xrayChooserFinish(false);
    };

    window.xrayOpenUploadChooser = function (blockTarget, onDone) {
        xrayChooserOnDone = onDone;
        xrayChooserBareNo = '';
        var work = (blockTarget && (blockTarget.clinicLabel || blockTarget.workingTag)) ||
            xrayClinicLabelFromTag(xrayWorkingClinicTag());
        var homeTag = xrayPatientClinicTag(xrayPatientData);
        var lead = g('xrayChooserLead');
        if (lead) {
            lead.textContent = mediaTrRepl('con.xray.chooser.lead', {
                WORK: work,
                CHART: xrayClinicLabelFromTag(homeTag || (blockTarget && blockTarget.chartTag)),
                NO: (xrayPatientData && xrayPatientData.patient_no) || ''
            });
        }
        var sel = g('xrayChooserChartSelect');
        if (sel) {
            sel.innerHTML = '';
            xrayChooserExistingCharts().forEach(function (p) {
                var o = document.createElement('option');
                o.value = String(p.id);
                var tag = xrayClinicLabelFromTag(xrayPatientClinicTag(p));
                o.textContent = (tag ? tag + ' ' : '') + '#' + (p.patient_no || p.id);
                sel.appendChild(o);
            });
            if (xrayPatientId) sel.value = String(xrayPatientId);
        }
        var existing = g('xrayChooserModeExisting');
        if (existing) existing.checked = true;
        var hkidInp = g('xrayChooserHkid');
        if (hkidInp) {
            hkidInp.value = (xrayPatientData && xrayPatientData.hkid) ? String(xrayPatientData.hkid) : '';
        }
        var noEl = g('xrayChooserNewNo');
        if (noEl) noEl.textContent = mediaTr('con.xray.chooser.newNoWait');
        xrayChooserShowError('');
        xrayChooserSyncMode();
        if (typeof ensureModalNoBackdropClose === 'function') {
            ensureModalNoBackdropClose('xrayUploadChooserModal');
        }
        if (typeof openModal === 'function') openModal('xrayUploadChooserModal');
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(g('xrayUploadChooserModal'));
        window.xrayAllocBarePatientNo(function (no) {
            xrayChooserBareNo = no || '';
            if (noEl) {
                noEl.textContent = no
                    ? mediaTrRepl('con.xray.chooser.newNo', { NO: no })
                    : mediaTr('con.xray.chooser.needNo');
            }
        });
    };

    function xrayPersistSourceHkid(raw) {
        if (!xrayPatientId) return Promise.resolve();
        var already = xrayNormalizeHkid(xrayPatientData && xrayPatientData.hkid);
        var want = xrayNormalizeHkid(raw);
        if (already && already === want) {
            if (xrayPatientData) xrayPatientData.hkid = raw;
            return Promise.resolve();
        }
        return SB.from('patients').update({ hkid: raw }).eq('id', xrayPatientId).then(function (r) {
            if (r.error) throw r.error;
            if (xrayPatientData) xrayPatientData.hkid = raw;
            if (typeof conPatientData !== 'undefined' && conPatientData &&
                String(conPatientData.id) === String(xrayPatientId)) {
                conPatientData.hkid = raw;
            }
        });
    }

    function xrayInsertGlobalClone(src, bareNo, hkidRaw) {
        var work = xrayWorkingClinicTag();
        var payload = {
            patient_no: bareNo,
            full_name: src.full_name || '',
            chinese_name: src.chinese_name || null,
            phone_number: src.phone_number || null,
            mobile_phone: src.mobile_phone || null,
            email: src.email || null,
            sex: src.sex || null,
            dob: src.dob || null,
            hkid: hkidRaw,
            insurance_no: src.insurance_no || null,
            occupation: src.occupation || null,
            address: src.address || null,
            residential_district: src.residential_district || null,
            medical_alerts: src.medical_alerts || null,
            family_history: src.family_history || null,
            referred_by: src.referred_by || null,
            remarks: src.remarks || null,
            banana_index: src.banana_index != null ? src.banana_index : null,
            banana_notes: src.banana_notes || null
        };
        var field = (typeof PATIENT_CLINIC_TAG_FIELD === 'string') ? PATIENT_CLINIC_TAG_FIELD : 'clinic_tag';
        payload[field] = work;
        function insert(pl, retried) {
            return SB.from('patients').insert([pl])
                .select('id,patient_no,full_name,chinese_name,hkid,dob,clinic_tag')
                .then(function (r) {
                    if (r.error) {
                        var msg = String(r.error.message || '').toLowerCase();
                        if (!retried && msg.indexOf('banana_notes') >= 0) {
                            var pl2 = Object.assign({}, pl);
                            delete pl2.banana_notes;
                            return insert(pl2, true);
                        }
                        throw r.error;
                    }
                    return (r.data && r.data[0]) ? r.data[0] : null;
                });
        }
        return insert(payload, false);
    }

    window.xrayConfirmUploadChooser = function () {
        xrayChooserShowError('');
        var globalOn = !!(g('xrayChooserModeGlobal') && g('xrayChooserModeGlobal').checked);
        if (!globalOn) {
            var sel = g('xrayChooserChartSelect');
            var id = sel ? String(sel.value || '').trim() : '';
            var charts = xrayChooserExistingCharts();
            var picked = null;
            charts.forEach(function (p) {
                if (String(p.id) === id) picked = p;
            });
            if (!picked) {
                xrayChooserShowError(mediaTr('con.xray.chooser.needChart'));
                return;
            }
            window.xrayUploadOverrideTarget = xrayMakeWriteTarget(picked);
            xrayChooserFinish(true);
            return;
        }
        var hkidInp = g('xrayChooserHkid');
        var hkidRaw = hkidInp ? String(hkidInp.value || '').trim() : '';
        if (!xrayNormalizeHkid(hkidRaw)) {
            xrayChooserShowError(mediaTr('con.xray.chooser.hkidNeed'));
            return;
        }
        if (!xrayChooserBareNo) {
            xrayChooserShowError(mediaTr('con.xray.chooser.needNo'));
            return;
        }
        var btn = g('xrayChooserContinueBtn');
        if (btn) btn.disabled = true;
        var srcP = (xrayPatientData && xrayPatientData.id)
            ? Promise.resolve(xrayPatientData)
            : SB.from('patients').select('*').eq('id', xrayPatientId).maybeSingle()
                .then(function (r) { return r.data || {}; });
        srcP.then(function (src) {
            return xrayPersistSourceHkid(hkidRaw).then(function () { return src; });
        }).then(function (src) {
            if (typeof patientNoDupQuery === 'function') {
                return patientNoDupQuery(xrayChooserBareNo).then(function (dupr) {
                    if (dupr.error) throw dupr.error;
                    if (dupr.data && dupr.data.length) {
                        throw new Error(mediaTr('con.xray.chooser.needNo'));
                    }
                    return src;
                });
            }
            return src;
        }).then(function (src) {
            return xrayInsertGlobalClone(src || {}, xrayChooserBareNo, hkidRaw);
        }).then(function (row) {
            if (!row || !row.id) throw new Error(mediaTr('con.xray.chooser.needNo'));
            var work = xrayWorkingClinicTag();
            window.xrayUploadOverrideTarget = xrayMakeWriteTarget(row, {
                clinic_tag: work,
                clinicLabel: xrayClinicLabelFromTag(work)
            });
            xrayLinkedPatients = (xrayLinkedPatients || []).concat([Object.assign({}, row, {
                isHome: false,
                clinic_tag: work,
                clinicLabel: xrayClinicLabelFromTag(work),
                matchMethod: 'hkid',
                detailsDiffer: false
            })]);
            xrayChooserFinish(true);
        }).catch(function (err) {
            xrayChooserShowError(mediaTrRepl('con.xray.chooser.cloneFail', {
                MSG: (err && err.message) ? err.message : String(err || '')
            }));
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    };

    window.xrayRevealWriteClinic = function (target) {
        if (!target || !target.ok || !target.clinic_tag) return;
        var tag = String(target.clinic_tag);
        xrayExpandedClinicTags[tag] = true;
        var home = xrayHomeClinicTag();
        if (!xrayTagEquals(tag, home) && (xrayClinicScope === 'home' || !xrayClinicScope)) {
            xrayClinicScope = 'all';
            var sel = g('xrayClinicScope');
            if (sel) sel.value = 'all';
        }
    };

    window.xrayIsHomeRecord = function (rec) {
        if (!rec) return false;
        var pid = String(rec.patient_id || '');
        if (!pid) return false;
        var write = window.xrayUploadTargetPatient();
        if (write && write.ok && write.id) {
            return pid === String(write.id);
        }
        return !!(xrayPatientId && pid === String(xrayPatientId));
    };

    window.xrayClinicTagLabel = function (rec) {
        if (!rec) return '';
        if (rec._clinicLabel) return rec._clinicLabel;
        if (rec._clinicTag) return xrayClinicLabelFromTag(rec._clinicTag);
        return '';
    };

    window.xrayClinicTagHtml = function (rec, extraClass) {
        var label = window.xrayClinicTagLabel(rec);
        if (!label) return '';
        var home = xrayIsHomeRecord(rec);
        var cls = 'xray-clinic-tag' + (home ? ' xray-clinic-tag--home' : ' xray-clinic-tag--other');
        if (extraClass) cls += ' ' + extraClass;
        return '<span class="' + cls + '">' + esc(label) + '</span>';
    };

    window.xrayIsLinkedPatientId = function (pid) {
        var id = String(pid || '').trim();
        if (!id) return false;
        if (xrayPatientId && String(xrayPatientId) === id) return true;
        var i;
        for (i = 0; i < xrayLinkedPatients.length; i++) {
            if (String(xrayLinkedPatients[i].id) === id) return true;
        }
        return false;
    };

    function xrayPatientDisplayName(p) {
        if (!p) return '—';
        var en = String(p.full_name || '').trim();
        var cn = String(p.chinese_name || '').trim();
        if (en && cn && en !== cn) return en + ' / ' + cn;
        return en || cn || '—';
    }

    function xrayDobKey(raw) {
        return String(raw || '').trim().slice(0, 10);
    }

    function xrayDetailsDiffer(home, other) {
        if (!home || !other) return false;
        var hn = xrayPatientDisplayName(home).toLowerCase();
        var on = xrayPatientDisplayName(other).toLowerCase();
        var nameDiff = hn !== '—' && on !== '—' && hn !== on;
        var hd = xrayDobKey(home.dob);
        var od = xrayDobKey(other.dob);
        return nameDiff || (!!(hd && od && hd !== od));
    }

    function xrayLinkedSelectCols() {
        var field = (typeof PATIENT_CLINIC_TAG_FIELD === 'string') ? PATIENT_CLINIC_TAG_FIELD : 'clinic_tag';
        return 'id,patient_no,full_name,chinese_name,sex,dob,phone_number,mobile_phone,hkid,' + field;
    }

    function xrayEscapeOrValue(s) {
        return String(s || '').replace(/,/g, '').replace(/\./g, '');
    }

    function xrayFindLinkedPatients(home) {
        if (!home || !home.id) return Promise.resolve([]);
        var norm = xrayNormalizeHkid(home.hkid);
        var digits = (typeof clinicNoNumbersOnly === 'function')
            ? clinicNoNumbersOnly(home.patient_no)
            : String(home.patient_no || '').replace(/\D/g, '');
        var dob = xrayDobKey(home.dob);
        var cols = xrayLinkedSelectCols();
        var q;

        if (norm && norm.length >= 5) {
            var needle = (typeof escapePostgrestIlike === 'function')
                ? escapePostgrestIlike(norm.length >= 7 ? norm.slice(0, -1) : norm)
                : xrayEscapeOrValue(norm);
            q = SB.from('patients').select(cols)
                .or('hkid.ilike.%' + needle + '%,hkid.eq.' + xrayEscapeOrValue(norm))
                .limit(80);
            return q.then(function (r) {
                var rows = (!r.error && r.data) ? r.data : [];
                return rows.filter(function (row) {
                    return xrayNormalizeHkid(row.hkid) === norm;
                }).map(function (row) {
                    return Object.assign({}, row, { _matchMethod: 'hkid' });
                });
            });
        }

        if (digits && digits.length >= 4 && dob) {
            q = SB.from('patients').select(cols)
                .eq('dob', dob)
                .ilike('patient_no', '%' + digits + '%')
                .limit(40);
            return q.then(function (r) {
                var rows = (!r.error && r.data) ? r.data : [];
                return rows.filter(function (row) {
                    var d = (typeof clinicNoNumbersOnly === 'function')
                        ? clinicNoNumbersOnly(row.patient_no)
                        : String(row.patient_no || '').replace(/\D/g, '');
                    return d === digits && xrayDobKey(row.dob) === dob;
                }).map(function (row) {
                    return Object.assign({}, row, { _matchMethod: 'chart_dob' });
                });
            });
        }

        return Promise.resolve([]);
    }

    function xrayBuildLinkedSet(home, matches) {
        var homeTag = xrayPatientClinicTag(home);
        var byClinic = {};
        var ambiguousTags = [];
        var list = [];
        var homeKey = homeTag || '__home__';
        var homeEntry = Object.assign({}, home, {
            isHome: true,
            clinic_tag: homeTag,
            clinicLabel: xrayClinicLabelFromTag(homeTag),
            matchMethod: xrayNormalizeHkid(home.hkid) ? 'hkid' : 'home',
            detailsDiffer: false
        });
        list.push(homeEntry);
        byClinic[homeKey] = [homeEntry];

        (matches || []).forEach(function (row) {
            if (!row || !row.id || String(row.id) === String(home.id)) return;
            var tag = xrayPatientClinicTag(row);
            var key = tag || ('id:' + row.id);
            if (!byClinic[key]) byClinic[key] = [];
            byClinic[key].push(row);
        });

        Object.keys(byClinic).forEach(function (key) {
            var rows = byClinic[key];
            if (rows.length > 1) ambiguousTags.push(xrayPatientClinicTag(rows[0]) || key);
            rows.forEach(function (row) {
                if (!row || !row.id) return;
                if (String(row.id) === String(home.id)) return;
                list.push(Object.assign({}, row, {
                    isHome: false,
                    clinic_tag: xrayPatientClinicTag(row),
                    clinicLabel: xrayClinicLabelFromTag(xrayPatientClinicTag(row)),
                    matchMethod: row._matchMethod || 'hkid',
                    detailsDiffer: xrayDetailsDiffer(home, row)
                }));
            });
        });

        return { list: list, ambiguousTags: ambiguousTags };
    }

    function xrayStampRecords(rows) {
        var byPid = {};
        xrayLinkedPatients.forEach(function (p) { byPid[String(p.id)] = p; });
        return (rows || []).map(function (x) {
            var src = byPid[String(x.patient_id)] || null;
            var tag = src ? src.clinic_tag : xrayHomeClinicTag();
            var copy = Object.assign({}, x);
            copy._clinicTag = tag;
            copy._clinicLabel = src ? src.clinicLabel : xrayClinicLabelFromTag(tag);
            copy._sourcePatient = src;
            copy._isHome = !!(src && src.isHome) || xrayIsHomeRecord(x);
            copy._matchMethod = src ? src.matchMethod : 'home';
            return copy;
        });
    }

    function xrayReadClinicScopePref() {
        try {
            var v = localStorage.getItem(XRAY_CLINIC_PREF_LS);
            if (v === 'all' || v === 'home') return v;
        } catch (e) {}
        return 'home';
    }

    function xrayWriteClinicScopePref(v) {
        if (v !== 'all' && v !== 'home') return;
        try { localStorage.setItem(XRAY_CLINIC_PREF_LS, v); } catch (e) {}
    }

    function xrayCountsByClinicUnfiltered() {
        var counts = {};
        xrayAllRecords.forEach(function (x) {
            var tag = x._clinicTag || '';
            counts[tag] = (counts[tag] || 0) + 1;
        });
        return counts;
    }

    function xrayRecordMatchesWhen(x) {
        if (!xrayWhenFilter) return true;
        var d = String(x.taken_date || '').slice(0, 10);
        var today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
        if (xrayWhenFilter === 'visit') return d === today;
        var cutoff = today;
        try {
            var dt = new Date(today + 'T00:00:00');
            dt.setMonth(dt.getMonth() - 12);
            cutoff = dt.toISOString().slice(0, 10);
        } catch (e) {}
        if (xrayWhenFilter === '12m') return !!(d && d >= cutoff);
        if (xrayWhenFilter === 'older') return !d || d < cutoff;
        return true;
    }

    function xrayOtherClinicsWithFilms() {
        var home = xrayHomeClinicTag();
        var counts = xrayCountsByClinicUnfiltered();
        var out = [];
        var seen = {};
        xrayLinkedPatients.forEach(function (p) {
            if (p.isHome) return;
            var n = counts[p.clinic_tag] || 0;
            if (n > 0 && !seen[p.clinic_tag]) {
                seen[p.clinic_tag] = true;
                out.push({ tag: p.clinic_tag, label: p.clinicLabel, count: n, patient: p });
            }
        });
        Object.keys(counts).forEach(function (tag) {
            if (tag === home || seen[tag] || !counts[tag]) return;
            out.push({ tag: tag, label: xrayClinicLabelFromTag(tag), count: counts[tag], patient: null });
        });
        return out;
    }

    window.xrayFillTypeChips = function () {
        var host = g('xrayTypeChips');
        if (!host) return;
        var cur = (g('xrayFilterType') && g('xrayFilterType').value) || '';
        var html = '<button type="button" class="xray-chip' + (!cur ? ' active' : '') +
            '" data-type="" onclick="xraySetTypeFilter(\'\')">' + esc(mediaTr('media.allTypes')) + '</button>';
        XRAY_TYPE_PAIRS.forEach(function (pair) {
            html += '<button type="button" class="xray-chip' + (cur === pair[0] ? ' active' : '') +
                '" data-type="' + esc(pair[0]) + '" onclick="xraySetTypeFilter(\'' +
                String(pair[0]).replace(/'/g, '') + '\')">' + esc(mediaTr(pair[1])) + '</button>';
        });
        host.innerHTML = html;
    };

    window.xraySetTypeFilter = function (type) {
        var sel = g('xrayFilterType');
        if (sel) sel.value = type || '';
        xrayFillTypeChips();
        filterXrays();
    };

    window.xrayOnTypeSelectChange = function () {
        xrayFillTypeChips();
        filterXrays();
    };

    window.xraySetWhenFilter = function (when) {
        xrayWhenFilter = when || '';
        var host = g('xrayWhenChips');
        if (host) {
            Array.prototype.forEach.call(host.querySelectorAll('.xray-chip'), function (btn) {
                btn.classList.toggle('active', String(btn.getAttribute('data-when') || '') === xrayWhenFilter);
            });
        }
        filterXrays();
    };

    window.xrayOnClinicScopeChange = function () {
        var sel = g('xrayClinicScope');
        xrayClinicScope = sel ? String(sel.value || 'home') : 'home';
        if (xrayClinicScope === 'home' || xrayClinicScope === 'all') {
            xrayWriteClinicScopePref(xrayClinicScope);
        }
        filterXrays();
        xraySyncLinkChrome();
    };

    window.xrayShowAllClinicsFromBanner = function () {
        xrayClinicScope = 'all';
        xrayWriteClinicScopePref('all');
        xrayOtherClinicsWithFilms().forEach(function (c) {
            xrayExpandedClinicTags[c.tag] = true;
        });
        var sel = g('xrayClinicScope');
        if (sel) sel.value = 'all';
        filterXrays();
        xraySyncLinkChrome();
    };

    function xrayFillClinicScopeSelect() {
        var sel = g('xrayClinicScope');
        if (!sel) return;
        var home = xrayHomeClinicTag();
        var counts = xrayCountsByClinicUnfiltered();
        var homeN = counts[home] || 0;
        var total = xrayAllRecords.length;
        var html = '<option value="home">' + esc(mediaTr('con.xray.scopeThisChart')) +
            ' (' + homeN + ')</option>';
        html += '<option value="all">' + esc(mediaTr('con.xray.scopeAll')) +
            ' (' + total + ')</option>';
        xrayOtherClinicsWithFilms().forEach(function (c) {
            html += '<option value="' + esc(c.tag) + '">' + esc(c.label) +
                ' (' + c.count + ')</option>';
        });
        var prev = xrayClinicScope || 'home';
        sel.innerHTML = html;
        if (prev !== 'home' && prev !== 'all') {
            var found = false;
            xrayOtherClinicsWithFilms().forEach(function (c) {
                if (c.tag === prev) found = true;
            });
            if (!found) prev = xrayReadClinicScopePref();
        }
        sel.value = prev;
        xrayClinicScope = sel.value || 'home';
    }

    window.xraySyncLinkChrome = function () {
        var bar = g('xrayLinkBar');
        var also = g('xrayAlsoAtBtn');
        var status = g('xrayLinkStatus');
        var prompt = g('xrayHkidPrompt');
        var hint = g('xrayHomeWriteHint');
        var others = xrayOtherClinicsWithFilms();
        var missingHkid = !xrayNormalizeHkid(xrayPatientData && xrayPatientData.hkid);
        var hasFallback = xrayLinkedPatients.some(function (p) {
            return !p.isHome && p.matchMethod === 'chart_dob';
        });
        var mismatch = !!(xrayLinkMeta && xrayLinkMeta.noWorkingChart);
        var dupBtn = g('xrayDupToWorkBtn');

        if (bar) {
            var showBar = !!(others.length || missingHkid ||
                (xrayLinkMeta.ambiguousTags && xrayLinkMeta.ambiguousTags.length) || mismatch);
            bar.style.display = showBar ? 'flex' : 'none';
            if (showBar) bar.removeAttribute('hidden');
            else bar.setAttribute('hidden', '');
        }
        if (also) {
            if (others.length) {
                var n = 0;
                others.forEach(function (c) { n += c.count || 0; });
                var names = others.map(function (c) { return c.label; }).join(' · ');
                also.textContent = mediaTrRepl('con.xray.alsoAt', { N: String(n), LIST: names });
            }
            also.style.display = (others.length && xrayClinicScope !== 'all') ? '' : 'none';
        }
        if (status) {
            var msgs = [];
            if (mismatch) {
                msgs.push(mediaTrRepl('con.xray.workingNoChart', {
                    WORK: xrayClinicLabelFromTag(xrayLinkMeta.workingTag),
                    CHART: xrayClinicLabelFromTag(xrayLinkMeta.chartTag),
                    NO: (xrayPatientData && xrayPatientData.patient_no) || ''
                }));
            }
            if (xrayLinkMeta.ambiguousTags && xrayLinkMeta.ambiguousTags.length) {
                msgs.push(mediaTrRepl('con.xray.ambiguousId', {
                    CLINICS: xrayLinkMeta.ambiguousTags.map(xrayClinicLabelFromTag).join(', ')
                }));
            }
            if (hasFallback) msgs.push(mediaTr('con.xray.linkedByChartDob'));
            others.forEach(function (c) {
                if (c.patient && c.patient.detailsDiffer) {
                    msgs.push(mediaTrRepl('con.xray.detailsDiffer', { CLINIC: c.label }));
                }
            });
            status.textContent = msgs.join('  ');
        }
        if (dupBtn) {
            if (mismatch && typeof openDuplicatePatientToClinic === 'function') {
                dupBtn.textContent = mediaTrRepl('con.xray.dupToWork', {
                    WORK: xrayClinicLabelFromTag(xrayLinkMeta.workingTag)
                });
                dupBtn.style.display = '';
            } else {
                dupBtn.style.display = 'none';
            }
        }
        if (prompt) {
            prompt.style.display = missingHkid ? 'flex' : 'none';
            if (missingHkid) prompt.removeAttribute('hidden');
            else prompt.setAttribute('hidden', '');
        }
        if (hint) {
            var write = window.xrayUploadTargetPatient();
            if (write && write.ok) {
                hint.textContent = mediaTrRepl('con.xray.writeHint', {
                    CLINIC: write.clinicLabel || xrayClinicLabelFromTag(write.clinic_tag),
                    NO: write.patient_no || ''
                });
                hint.hidden = !((others.length && xrayClinicScope === 'all') || mismatch || !write.sameAsOpened);
            } else if (write && write.reason === 'no-working-chart') {
                hint.textContent = mediaTrRepl('con.xray.uploadNeedWorkChart', {
                    WORK: write.clinicLabel || xrayClinicLabelFromTag(write.workingTag)
                });
                hint.hidden = false;
            } else if (write && write.reason === 'ambiguous') {
                hint.textContent = mediaTrRepl('con.xray.uploadAmbiguousWork', {
                    WORK: write.clinicLabel || xrayClinicLabelFromTag(write.workingTag)
                });
                hint.hidden = false;
            } else {
                var homeLabel = xrayClinicLabelFromTag(xrayHomeClinicTag());
                var no = (xrayPatientData && xrayPatientData.patient_no) ? String(xrayPatientData.patient_no) : '';
                hint.textContent = mediaTrRepl('con.xray.writeHint', { CLINIC: homeLabel, NO: no });
                hint.hidden = !((others.length && xrayClinicScope === 'all') || mismatch);
            }
        }
    };

    window.xraySaveHkidAndRelink = function () {
        var inp = g('xrayHkidInput');
        var raw = inp ? String(inp.value || '').trim() : '';
        var norm = xrayNormalizeHkid(raw);
        if (!norm || !xrayPatientId) {
            alert(mediaTr('con.xray.hkidNeedValue'));
            return;
        }
        SB.from('patients').update({ hkid: raw }).eq('id', xrayPatientId)
            .then(function (r) {
                if (r.error) {
                    alert(mediaErr(r.error.message));
                    return;
                }
                if (xrayPatientData) xrayPatientData.hkid = raw;
                if (typeof conPatientData !== 'undefined' && conPatientData &&
                    String(conPatientData.id) === String(xrayPatientId)) {
                    conPatientData.hkid = raw;
                }
                loadXrayRecords();
            });
    };

    window.xrayDupToWorkingClinic = function () {
        if (typeof openDuplicatePatientToClinic !== 'function' || !xrayPatientId) return;
        openDuplicatePatientToClinic(xrayPatientId);
        setTimeout(function () {
            var sel = g('patientDupClinicSelect');
            if (!sel || typeof currentClinicId === 'undefined' || !currentClinicId) return;
            sel.value = String(currentClinicId);
        }, 80);
    };

    window.xrayMaybeLoadNotesOnPatientSync = function () {
        var onXray = typeof activeConsultationTabKey === 'function' &&
            activeConsultationTabKey() === 'xrays';
        if (onXray && typeof xrayNotesPanelHidden === 'function' && xrayNotesPanelHidden()) return;
        if (typeof loadConNotes === 'function' && xrayPatientId) loadConNotes(xrayPatientId);
    };

    function xrayNoPreviewSvg() {
        return 'data:image/svg+xml,' +
            encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">' +
                '<rect fill="#1a1a2e"/>' +
                '<text x="50%" y="50%" fill="#888" text-anchor="middle" ' +
                'dy=".3em" font-size="13">' + esc(mediaTr('media.noPreview')) + '</text></svg>'
            );
    }

    window.xrayStripThumbFallback = function (img) {
        if (!img) return;
        var full = img.getAttribute('data-full') || '';
        if (full && img.src !== full && img.getAttribute('data-tried-full') !== '1') {
            img.setAttribute('data-tried-full', '1');
            img.src = full;
            return;
        }
        img.onerror = null;
        img.src = xrayNoPreviewSvg();
    };

    window.loadXrayRecords = function () {
        if (!xrayPatientId) return Promise.resolve();
        var token = ++xrayLinkResolveToken;
        if (window._xrayLinkLastPid !== String(xrayPatientId)) {
            xrayExpandedClinicTags = {};
            xrayShowAllInRow = {};
            xrayPinnedId = null;
            window.xrayClearUploadOverride();
            window._xrayLinkLastPid = String(xrayPatientId);
        }
        xrayClinicScope = xrayReadClinicScopePref() || 'home';
        window._xrayScopePrefApplied = true;
        var home = xrayPatientData || { id: xrayPatientId };
        return xrayFindLinkedPatients(home).then(function (matches) {
            if (token !== xrayLinkResolveToken) return null;
            var work = xrayWorkingClinicTag();
            var homeTagNow = xrayPatientClinicTag(home);
            var workCharts = xrayChartsAtTag(home, matches, work);
            // Stay on the chart the user selected for viewing. New uploads
            // retarget via xrayUploadTargetPatient() to workCharts[0] when
            // the opened chart number carries another clinic's prefix.
            var built = xrayBuildLinkedSet(home, matches);
            xrayLinkedPatients = built.list;
            var hkidLinked = !!(xrayNormalizeHkid(home.hkid) && built.list.some(function (p) {
                return !p.isHome;
            }));
            if (hkidLinked) {
                xrayClinicScope = 'all';
                built.list.forEach(function (p) {
                    if (!p.isHome && p.clinic_tag) xrayExpandedClinicTags[p.clinic_tag] = true;
                });
            }
            xrayLinkMeta = {
                method: xrayNormalizeHkid(home.hkid) ? 'hkid' : (matches.length ? 'chart_dob' : 'none'),
                ambiguousTags: built.ambiguousTags,
                missingHkid: !xrayNormalizeHkid(home.hkid),
                workingTag: work,
                chartTag: homeTagNow,
                noWorkingChart: !!(work && homeTagNow && work.toUpperCase() !== homeTagNow.toUpperCase() && workCharts.length === 0)
            };
            var ids = xrayLinkedPatients.map(function (p) { return p.id; }).filter(Boolean);
            if (!ids.length) ids = [xrayPatientId];
            return SB.from('xrays')
                .select('*')
                .in('patient_id', ids)
                .order('taken_date', { ascending: false })
                .order('created_at', { ascending: false });
        }).then(function (r) {
            if (token !== xrayLinkResolveToken) return;
            if (!r) return;
            if (r.error) {
                console.error('[X-Ray] load error:', r.error);
                xrayAllRecords = [];
            } else {
                xrayAllRecords = xrayStampRecords(r.data || []);
            }
            if (typeof populateYearFilter === 'function') populateYearFilter();
            if (!xrayClinicScope) xrayClinicScope = xrayReadClinicScopePref();
            xrayFillClinicScopeSelect();
            xrayFillTypeChips();
            filterXrays();
            xraySyncLinkChrome();
        }).catch(function (err) {
            console.error('[X-Ray] link load:', err);
            xrayAllRecords = [];
            filterXrays();
        });
    };

    function xrayScopeFilter(x) {
        var home = xrayHomeClinicTag();
        if (xrayClinicScope === 'all') return true;
        if (xrayClinicScope === 'home' || !xrayClinicScope) {
            return x._isHome || (x._clinicTag || '') === home;
        }
        return (x._clinicTag || '') === xrayClinicScope;
    }

    window.filterXrays = function () {
        var type = ((g('xrayFilterType') && g('xrayFilterType').value) || '').toLowerCase();
        var query = ((g('xrayFilterSearch') && g('xrayFilterSearch').value) || '').toLowerCase();

        var typed = xrayAllRecords.filter(function (x) {
            if (type && (x.xray_type || '').toLowerCase() !== type) return false;
            if (query && !(x.notes || '').toLowerCase().includes(query)) return false;
            if (!xrayRecordMatchesWhen(x)) return false;
            return true;
        });

        xrayFiltered = typed.filter(xrayScopeFilter);

        xraySelected.clear();
        if (typeof updateSelectedCount === 'function') updateSelectedCount();
        var sa = g('xraySelectAll');
        if (sa) sa.checked = false;

        renderXrayClinicStrips(typed);
        if (xrayView === 'grid' && typeof renderXrayGrid === 'function') renderXrayGrid();
        else if (xrayView === 'slide' && typeof renderXraySlide === 'function') renderXraySlide();
    };

    window.setXrayView = function (view) {
        xrayView = view || 'strips';
        var btnT = g('btnStripsView');
        var btnG = g('btnGridView');
        var btnS = g('btnSlideView');
        if (btnT) btnT.classList.toggle('active', xrayView === 'strips');
        if (btnG) btnG.classList.toggle('active', xrayView === 'grid');
        if (btnS) btnS.classList.toggle('active', xrayView === 'slide');

        var strips = g('xrayClinicStrips');
        var gv = g('xrayGridView');
        var sv2 = g('xraySlideView');
        if (strips) strips.style.display = xrayView === 'strips' ? '' : 'none';
        if (gv) gv.style.display = xrayView === 'grid' ? '' : 'none';
        if (sv2) sv2.style.display = xrayView === 'slide' ? '' : 'none';

        if (xrayView === 'slide' && typeof renderXraySlide === 'function') renderXraySlide();
        else if (xrayView === 'grid' && typeof renderXrayGrid === 'function') renderXrayGrid();
        else filterXrays();
    };

    function xrayLinkedPatientForTag(tag) {
        var i;
        for (i = 0; i < xrayLinkedPatients.length; i++) {
            if (String(xrayLinkedPatients[i].clinic_tag || '') === String(tag || '')) {
                return xrayLinkedPatients[i];
            }
        }
        return null;
    }

    function xrayVisitGroups(records) {
        var map = {};
        var dates = [];
        records.forEach(function (x) {
            var d = String(x.taken_date || '').slice(0, 10);
            if (!map[d]) {
                map[d] = [];
                dates.push(d);
            }
            map[d].push(x);
        });
        dates.sort(function (a, b) {
            if (!a && !b) return 0;
            if (!a) return 1;
            if (!b) return -1;
            return a < b ? 1 : (a > b ? -1 : 0);
        });
        return dates.map(function (d) { return { date: d, items: map[d] }; });
    }

    function xrayToggleRowExpand(tag) {
        xrayExpandedClinicTags[tag] = !xrayExpandedClinicTags[tag];
        filterXrays();
    }

    window.xrayToggleClinicRow = function (tag) {
        if (String(tag || '') === String(xrayHomeClinicTag() || '')) return;
        xrayToggleRowExpand(tag);
    };

    window.xrayShowAllInClinicRow = function (tag) {
        xrayShowAllInRow[tag] = true;
        filterXrays();
    };

    function xrayBindStripWheel(scroller) {
        if (!scroller || scroller.getAttribute('data-xray-wheel') === '1') return;
        scroller.setAttribute('data-xray-wheel', '1');
        scroller.addEventListener('wheel', function (ev) {
            if (scroller.scrollWidth <= scroller.clientWidth + 2) return;
            if (Math.abs(ev.deltaY) > Math.abs(ev.deltaX)) {
                scroller.scrollLeft += ev.deltaY;
                ev.preventDefault();
            }
        }, { passive: false });
    }

    function renderXrayClinicStrips(typedRecords) {
        var host = g('xrayClinicStrips');
        if (!host) return;
        if (xrayView !== 'strips') {
            host.style.display = 'none';
            return;
        }
        host.style.display = '';
        host._navByTag = {};
        var homeTag = xrayHomeClinicTag();
        var workTag = xrayWorkingClinicTag();
        var mismatchHome = !!(workTag && homeTag && workTag.toUpperCase() !== homeTag.toUpperCase());
        var byTag = {};
        (typedRecords || []).forEach(function (x) {
            var tag = x._clinicTag || '';
            if (!byTag[tag]) byTag[tag] = [];
            byTag[tag].push(x);
        });

        var order = [homeTag];
        xrayOtherClinicsWithFilms().forEach(function (c) {
            if (c.tag !== homeTag) order.push(c.tag);
        });
        Object.keys(byTag).forEach(function (tag) {
            if (order.indexOf(tag) < 0) order.push(tag);
        });

        var scope = xrayClinicScope || 'home';
        var html = '';
        order.forEach(function (tag) {
            var isHome = tag === homeTag;
            if (scope === 'home' && !isHome) return;
            if (scope !== 'all' && scope !== 'home' && tag !== scope) return;
            var items = byTag[tag] || [];
            if (!isHome && !items.length) return;
            var src = xrayLinkedPatientForTag(tag);
            var expanded = isHome || !!xrayExpandedClinicTags[tag] || (scope !== 'all' && scope !== 'home');
            var unfilteredN = xrayCountsByClinicUnfiltered()[tag] || 0;
            var label = (src && src.clinicLabel) || xrayClinicLabelFromTag(tag);
            var chart = (src && src.patient_no) || (isHome && xrayPatientData ? xrayPatientData.patient_no : '');
            var ident = [];
            if (src) {
                ident.push(esc(xrayPatientDisplayName(src)));
                if (src.dob && typeof formatDobAge === 'function') ident.push(esc(formatDobAge(src.dob)));
                if (src.hkid) ident.push(esc(String(src.hkid)));
            }
            var warn = (src && src.detailsDiffer)
                ? '<div class="xray-clinic-row-warn">' + esc(mediaTr('con.xray.detailsDifferShort')) + '</div>'
                : '';
            var matchLbl = (!isHome && src && src.matchMethod === 'chart_dob')
                ? '<span class="xray-match-pill">' + esc(mediaTr('con.xray.linkedByChartDobShort')) + '</span>'
                : '';
            var homePill = isHome
                ? '<span class="xray-home-pill">' + esc(mediaTr('con.xray.thisChart')) + '</span>' +
                  (mismatchHome
                      ? ' <span class="xray-mismatch-pill">' +
                        esc(mediaTrRepl('con.xray.notWorking', { WORK: xrayClinicLabelFromTag(workTag) })) +
                        '</span>'
                      : '')
                : '<span class="xray-other-pill">' + esc(mediaTr('con.xray.otherClinic')) + '</span>';

            html += '<section class="xray-clinic-row' + (isHome ? ' xray-clinic-row--home' : '') +
                (expanded ? '' : ' xray-clinic-row--collapsed') + '" data-tag="' + esc(tag) + '">';
            html += '<header class="xray-clinic-row-head" role="button" tabindex="0" onclick="xrayToggleClinicRow(\'' +
                String(tag).replace(/\\/g, '').replace(/'/g, '') + '\')">';
            html += '<span class="xray-clinic-row-chevron" aria-hidden="true">' +
                (isHome ? '' : (expanded ? '▾' : '▸')) + '</span>';
            html += '<div class="xray-clinic-row-titles">';
            html += '<div class="xray-clinic-row-title">' + esc(label) + ' ' + homePill + ' ' + matchLbl +
                (chart ? ' <span class="xray-clinic-chart">#' + esc(chart) + '</span>' : '') + '</div>';
            if (ident.length) {
                html += '<div class="xray-clinic-row-ident">' + ident.join(' · ') + '</div>';
            }
            html += warn;
            html += '</div>';
            html += '<span class="xray-clinic-row-count">' + items.length +
                (unfilteredN && unfilteredN !== items.length ? ' / ' + unfilteredN : '') + '</span>';
            html += '</header>';

            if (expanded) {
                html += '<div class="xray-clinic-row-body">';
                if (!items.length) {
                    html += '<div class="xray-clinic-empty">' + esc(mediaTr(isHome ? 'con.xray.noFilmsHere' : 'con.xray.noMatchingFilms')) + '</div>';
                } else {
                    var cap = xrayShowAllInRow[tag] ? items.length : XRAY_STRIP_CAP;
                    var shown = 0;
                    var navList = items.slice();
                    html += '<div class="xray-clinic-scroller">';
                    xrayVisitGroups(items).forEach(function (grp) {
                        if (shown >= cap) return;
                        var dateLbl = grp.date
                            ? (typeof fmtDateLong === 'function' ? fmtDateLong(grp.date) : grp.date)
                            : mediaTr('media.noDate');
                        html += '<div class="xray-visit-cluster">';
                        html += '<div class="xray-visit-date">' + esc(dateLbl) + '</div>';
                        html += '<div class="xray-visit-tiles">';
                        grp.items.forEach(function (x) {
                            if (shown >= cap) return;
                            shown += 1;
                            var imgSrc = x.file_url ? xrayThumbUrl(x) : '';
                            var notes = String(x.notes || '').trim();
                            html += '<button type="button" class="xray-strip-tile' +
                                (xrayPinnedId && String(x.id) === String(xrayPinnedId) ? ' xray-strip-tile--pinned' : '') +
                                '" data-id="' + esc(x.id) + '" data-tag="' + esc(tag) + '">';
                            html += '<span class="xray-strip-tile-img">';
                            var fullSrc = x.file_url
                                ? ((typeof xrayDisplayUrl === 'function') ? xrayDisplayUrl(x) : x.file_url)
                                : '';
                            html += imgSrc
                                ? '<img loading="lazy" src="' + imgSrc + '" alt="" data-full="' +
                                  esc(fullSrc) + '" onerror="xrayStripThumbFallback(this)">'
                                : '<span class="xray-fs-no-img">🔬</span>';
                            html += '</span>';
                            html += '<span class="xray-strip-tile-meta">';
                            html += typeof getTypeBadge === 'function' ? getTypeBadge(x.xray_type) : esc(x.xray_type || '');
                            html += '<span class="xray-strip-tile-date">' + esc(grp.date ? dateLbl : mediaTr('media.noDate')) + '</span>';
                            if (notes) html += '<span class="xray-strip-tile-notes">' + esc(notes) + '</span>';
                            html += '</span></button>';
                        });
                        html += '</div></div>';
                    });
                    html += '</div>';
                    if (items.length > cap) {
                        html += '<button type="button" class="xray-show-all-row" onclick="xrayShowAllInClinicRow(\'' +
                            String(tag).replace(/'/g, '') + '\')">' +
                            esc(mediaTrRepl('con.xray.showAllInRow', { N: String(items.length) })) + '</button>';
                    }
                    host._navByTag[tag] = navList;
                }
                html += '</div>';
            }
            html += '</section>';
        });

        if (!html) {
            html = '<div class="xray-clinic-empty">' + esc(mediaTr('media.noXraysTitle')) + '</div>';
        }
        host.innerHTML = html;
        Array.prototype.forEach.call(host.querySelectorAll('.xray-clinic-scroller'), xrayBindStripWheel);
        Array.prototype.forEach.call(host.querySelectorAll('.xray-strip-tile'), function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-id');
                var tag = btn.getAttribute('data-tag');
                var nav = (host._navByTag && host._navByTag[tag]) || xrayFiltered;
                var rec = null;
                (nav || []).forEach(function (x) { if (String(x.id) === String(id)) rec = x; });
                if (!rec) {
                    xrayAllRecords.forEach(function (x) { if (String(x.id) === String(id)) rec = x; });
                }
                openLightboxRecord(rec, nav);
            });
        });
        Array.prototype.forEach.call(host.querySelectorAll('.xray-clinic-row-head'), function (head) {
            head.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    head.click();
                }
            });
        });
    }

    function xrayFindRecordById(id) {
        var i;
        for (i = 0; i < xrayAllRecords.length; i++) {
            if (String(xrayAllRecords[i].id) === String(id)) return xrayAllRecords[i];
        }
        for (i = 0; i < xrayFiltered.length; i++) {
            if (String(xrayFiltered[i].id) === String(id)) return xrayFiltered[i];
        }
        return null;
    }

    function xrayApplyLightboxReadonly(rec) {
        var modal = g('xrayLightbox');
        var readonly = !!(rec && !xrayIsHomeRecord(rec));
        if (modal) modal.classList.toggle('xray-lb-readonly', readonly);
        ['lbType', 'lbDate', 'lbNotes'].forEach(function (id) {
            var el = g(id);
            if (el) el.disabled = readonly;
        });
        var saveBtn = g('lbSaveBtn');
        var delBtn = g('lbDeleteBtn');
        if (saveBtn) saveBtn.disabled = readonly;
        if (delBtn) delBtn.disabled = readonly;
        ['lbTBtn-free', 'lbTBtn-line', 'lbTBtn-arrow', 'lbTBtn-rect', 'lbTBtn-ellipse',
            'lbTBtn-poly', 'lbTBtn-crop', 'lbBtnAnnotText'].forEach(function (id) {
            var el = g(id);
            if (el) el.disabled = readonly;
        });
        var chip = g('lbClinicChip');
        if (chip) {
            if (rec) {
                var label = rec._clinicLabel || xrayClinicLabelFromTag(rec._clinicTag);
                chip.textContent = readonly
                    ? mediaTrRepl('con.xray.lbViewOnly', { CLINIC: label })
                    : label;
                chip.hidden = false;
            } else {
                chip.hidden = true;
            }
        }
        var pinBtn = g('lbPinBtn');
        if (pinBtn) {
            pinBtn.classList.toggle('active', !!(xrayPinnedId && rec && String(xrayPinnedId) === String(rec.id)));
        }
    }

    window.xrayTogglePinFromLightbox = function () {
        if (!lbCurrentId) return;
        if (xrayPinnedId && String(xrayPinnedId) === String(lbCurrentId)) {
            xrayPinnedId = null;
            var rec = xrayFindRecordById(lbCurrentId);
            xrayApplyLightboxReadonly(rec);
            return;
        }
        xrayPinnedId = lbCurrentId;
        xrayForceCloseLightbox();
        filterXrays();
    };

    window.xrayLbNav = function (dir) {
        if (!lbCurrentId || !xrayLbNavList.length) return;
        var i = -1;
        xrayLbNavList.forEach(function (r, n) {
            if (String(r.id) === String(lbCurrentId)) i = n;
        });
        var next = xrayLbNavList[i + dir];
        if (!next) return;
        openLightboxRecord(next, xrayLbNavList, true);
    };

    window.openLightboxRecord = function (rec, navList, fromNav) {
        if (!rec) return;
        if (!fromNav && xrayPinnedId && String(rec.id) !== String(xrayPinnedId)) {
            xrayOpenCompare(xrayPinnedId, rec.id);
            return;
        }
        xrayLbNavList = (navList && navList.length) ? navList.slice() : [rec];
        var idx = -1;
        xrayFiltered.forEach(function (r, n) {
            if (String(r.id) === String(rec.id)) idx = n;
        });
        var savedFiltered = null;
        if (idx < 0) {
            savedFiltered = xrayFiltered;
            xrayFiltered = xrayLbNavList.slice();
            xrayLbNavList.forEach(function (r, n) {
                if (String(r.id) === String(rec.id)) idx = n;
            });
        }
        if (typeof xrayOpenLightboxCore === 'function') xrayOpenLightboxCore(idx);
        if (savedFiltered) xrayFiltered = savedFiltered;
        xrayApplyLightboxReadonly(rec);
    };

    window.openLightbox = function (idx) {
        var rec = xrayFiltered[idx];
        openLightboxRecord(rec, xrayFiltered);
    };

    window.xrayOpenCompare = function (idA, idB) {
        var a = xrayFindRecordById(idA);
        var b = xrayFindRecordById(idB);
        if (!a || !b) return;
        function cap(x) {
            var dateStr = x.taken_date
                ? (typeof fmtDateLong === 'function' ? fmtDateLong(x.taken_date) : x.taken_date)
                : mediaTr('media.noDate');
            return (x._clinicLabel || '') + ' · ' + (xrayTypeLabel(x.xray_type) || '') + ' · ' + dateStr;
        }
        var imgA = g('xrayCompareImgA');
        var imgB = g('xrayCompareImgB');
        var capA = g('xrayCompareCapA');
        var capB = g('xrayCompareCapB');
        if (imgA) imgA.src = xrayDisplayUrl(a);
        if (imgB) imgB.src = xrayDisplayUrl(b);
        if (capA) capA.textContent = cap(a);
        if (capB) capB.textContent = cap(b);
        xrayForceCloseLightbox();
        if (typeof openModal === 'function') openModal('xrayCompareModal');
    };

    window.xrayCloseCompare = function () {
        if (typeof closeModal === 'function') closeModal('xrayCompareModal');
        xrayPinnedId = null;
        var pinBtn = g('lbPinBtn');
        if (pinBtn) pinBtn.classList.remove('active');
    };

    if (typeof renderXrayGrid === 'function') {
        var _renderXrayGrid = renderXrayGrid;
        window.renderXrayGrid = function () {
            _renderXrayGrid();
            var grid = g('xrayGridView');
            if (!grid) return;
            Array.prototype.forEach.call(grid.querySelectorAll('.xray-cb'), function (cb) {
                var rec = xrayFindRecordById(cb.getAttribute('data-id'));
                if (rec && !xrayIsHomeRecord(rec)) {
                    cb.disabled = true;
                    cb.checked = false;
                    xraySelected.delete(rec.id);
                    var wrap = cb.closest('.xray-card-check');
                    if (wrap) wrap.style.display = 'none';
                    var card = cb.closest('.xray-card');
                    if (card) card.classList.add('xray-card--other-clinic');
                }
            });
        };
    }
    if (typeof toggleSelectAll === 'function') {
        var _toggleSelectAll = toggleSelectAll;
        window.toggleSelectAll = function (checked) {
            if (!checked) return _toggleSelectAll(checked);
            xraySelected.clear();
            xrayFiltered.forEach(function (x) {
                if (xrayIsHomeRecord(x)) xraySelected.add(x.id);
            });
            document.querySelectorAll('.xray-cb').forEach(function (cb) {
                var rec = xrayFindRecordById(cb.getAttribute('data-id'));
                cb.checked = !!(rec && xrayIsHomeRecord(rec) && xraySelected.has(rec.id));
            });
            if (typeof updateSelectedCount === 'function') updateSelectedCount();
        };
    }
    if (typeof exportAllXrays === 'function') {
        var _exportAllXrays = exportAllXrays;
        window.exportAllXrays = function () {
            var saved = xrayFiltered;
            var specific = xrayClinicScope && xrayClinicScope !== 'home' && xrayClinicScope !== 'all';
            if (!specific) {
                xrayFiltered = saved.filter(xrayIsHomeRecord);
            }
            try {
                return _exportAllXrays();
            } finally {
                xrayFiltered = saved;
            }
        };
    }
    if (typeof exportSelectedXrays === 'function') {
        var _exportSelectedXrays = exportSelectedXrays;
        window.exportSelectedXrays = function () {
            var extra = [];
            xraySelected.forEach(function (id) {
                var rec = xrayFindRecordById(id);
                if (rec && !xrayIsHomeRecord(rec)) extra.push(id);
            });
            extra.forEach(function (id) { xraySelected.delete(id); });
            return _exportSelectedXrays();
        };
    }

    if (xraySaveLbMetaCore) {
        window.saveLbMeta = function () {
            var rec = xrayFindRecordById(lbCurrentId);
            if (rec && !xrayIsHomeRecord(rec)) {
                alert(mediaTr('con.xray.readonlyOtherClinic'));
                return;
            }
            return xraySaveLbMetaCore();
        };
    }
    if (xrayDeleteLbCore) {
        window.deleteLbXray = function () {
            var rec = xrayFindRecordById(lbCurrentId);
            if (rec && !xrayIsHomeRecord(rec)) {
                alert(mediaTr('con.xray.readonlyOtherClinic'));
                return;
            }
            return xrayDeleteLbCore();
        };
    }

    function xrayBindLightboxKeys() {
        if (xrayStripsBound) return;
        xrayStripsBound = true;
        document.addEventListener('keydown', function (ev) {
            var modal = g('xrayLightbox');
            if (!modal) return;
            var tag = ev.target && ev.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            var vis = window.getComputedStyle(modal);
            if (vis.display === 'none' || vis.visibility === 'hidden') return;
            if (ev.key === 'ArrowLeft') {
                ev.preventDefault();
                xrayLbNav(-1);
            } else if (ev.key === 'ArrowRight') {
                ev.preventDefault();
                xrayLbNav(1);
            }
        });
    }

    var _refreshLang = (typeof refreshXrayUiForLangChange === 'function') ? refreshXrayUiForLangChange : null;
    window.refreshXrayUiForLangChange = function () {
        if (_refreshLang) _refreshLang();
        xrayFillTypeChips();
        xrayFillClinicScopeSelect();
        xraySyncLinkChrome();
        if (xrayView === 'strips') filterXrays();
    };

    document.addEventListener('DOMContentLoaded', function () {
        xrayClinicScope = xrayReadClinicScopePref();
        if (typeof applyXrayNotesDefaultHidden === 'function') applyXrayNotesDefaultHidden();
        xrayFillTypeChips();
        xrayBindLightboxKeys();
        if (typeof setXrayView === 'function') setXrayView('strips');
    });
})();
