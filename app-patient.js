// ════════════════════════════════════════════════════════════════
// PATIENT STATE
// ════════════════════════════════════════════════════════════════
var selPatientId  = null;
var editPatientId = null;

// ════════════════════════════════════════════════════════════════
// PATIENT NUMBER
// ════════════════════════════════════════════════════════════════
function genPatientNo(cb) {
    SB.from('patients').select('patient_no')
    .then(function(r) {
        var data = r.data || [];
        if (!data.length) { cb('001000'); return; }
        var nums = data
            .map(function(p){ return parseInt(p.patient_no,10); })
            .filter(function(n){ return !isNaN(n); });
        cb(nums.length
            ? String(Math.max.apply(null,nums)+1).padStart(6,'0')
            : '001000');
    });
}

function openAddPatient() {
    g('patientForm').reset();
    sv('preview_patientNo','...');
    openModal('addPatientModal');
    genPatientNo(function(no){ sv('preview_patientNo',no); });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — ADD
// ════════════════════════════════════════════════════════════════
function submitAddPatient(e) {
    e.preventDefault();
    genPatientNo(function(no) {
        var payload = {
            patient_no:     no,
            full_name:      (g('fullName').value     ||'').trim(),
            chinese_name:   (g('chineseName').value  ||'').trim()||null,
            phone_number:   (g('phone').value        ||'').trim()||null,
            email:          (g('email').value        ||'').trim()||null,
            sex:             g('sex').value           ||null,
            dob:             g('dob').value           ||null,
            hkid:           (g('hkid').value         ||'').trim()||null,
            insurance_no:   (g('insuranceNo').value  ||'').trim()||null,
            occupation:     (g('occupation').value   ||'').trim()||null,
            address:        (g('address').value      ||'').trim()||null,
            medical_alerts: (g('alerts').value       ||'').trim()||null,
            remarks:        (g('remarks').value      ||'').trim()||null
        };
        SB.from('patients').insert([payload])
        .then(function(r) {
            if (r.error) { alert('Error: '+r.error.message); return; }
            closeModal('addPatientModal');
            g('patientForm').reset();
            fetchPatients();
            alert('Patient registered!  No: '+no);
        });
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — FETCH + RENDER
// ════════════════════════════════════════════════════════════════
function fetchPatients() {
    SB.from('patients').select('*')
        .order('patient_no',{ascending:true})
    .then(function(r) {
        if (r.error) { console.error(r.error); return; }
        renderPatients(r.data||[]);
    });
}

function renderPatients(list) {
    var tb = g('patientTableBody');
    if (!list.length) {
        tb.innerHTML =
            '<tr><td colspan="6" style="text-align:center;' +
            'padding:30px;color:#999;">No patients found.</td></tr>';
        return;
    }
    tb.innerHTML = '';
    list.forEach(function(p) {
        var dob = '--';
        if (p.dob) {
            var pts = p.dob.split('-');
            dob = pts[2]+'/'+pts[1]+'/'+pts[0];
        }
        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td>' +
                (p.patient_no
                    ? '<span class="pno-badge"># '+esc(p.patient_no)+'</span><br>'
                    : '') +
                '<strong>'+esc(p.full_name)+'</strong>' +
                (p.chinese_name
                    ? '<br><small style="color:#999;">'+esc(p.chinese_name)+'</small>'
                    : '') +
            '</td>' +
            '<td>'+esc(p.phone_number||'--')+'</td>' +
            '<td style="white-space:nowrap;">'+dob+'</td>' +
            '<td>'+esc(p.hkid||'--')+'</td>' +
            '<td><small style="color:'+(p.medical_alerts?'var(--danger)':'#bbb')+';">' +
                esc(p.medical_alerts||'None')+'</small></td>' +
            '<td>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                    '<button class="btn-notes" ' +
                    'style="background:#f0f0f0;border:1px solid #ccc;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">📋 Notes</button>' +
                    (currentRole!=='nurse'
                        ? '<button class="btn-editp" ' +
                          'style="background:var(--primary);color:white;border:none;' +
                          'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                          'data-id="'+p.id+'">✏️ Edit</button>'
                        : '') +
                '</div>' +
            '</td>';
        tb.appendChild(tr);
    });
    tb.querySelectorAll('.btn-notes').forEach(function(b) {
        b.addEventListener('click', function(){ viewHistory(b.dataset.id); });
    });
    tb.querySelectorAll('.btn-editp').forEach(function(b) {
        b.addEventListener('click', function(){ openEditPatient(b.dataset.id); });
    });
}

function filterTable() {
    var q = (g('searchInput').value||'').toLowerCase();
    document.querySelectorAll('#patientTableBody tr').forEach(function(r) {
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — EDIT
// ════════════════════════════════════════════════════════════════
function openEditPatient(id) {
    editPatientId = id;
    SB.from('patients').select('*').eq('id',id).single()
    .then(function(r) {
        if (r.error||!r.data) { alert('Could not load patient.'); return; }
        var p = r.data;
        sv('edit_patientNo',   p.patient_no    ||'');
        sv('edit_fullName',    p.full_name      ||'');
        sv('edit_chineseName', p.chinese_name   ||'');
        sv('edit_phone',       p.phone_number   ||'');
        sv('edit_email',       p.email          ||'');
        sv('edit_sex',         p.sex            ||'');
        sv('edit_dob',         p.dob            ||'');
        sv('edit_hkid',        p.hkid           ||'');
        sv('edit_insuranceNo', p.insurance_no   ||'');
        sv('edit_occupation',  p.occupation     ||'');
        sv('edit_address',     p.address        ||'');
        sv('edit_alerts',      p.medical_alerts ||'');
        sv('edit_remarks',     p.remarks        ||'');
        openModal('editPatientModal');
    });
}

function submitEditPatient(e) {
    e.preventDefault();
    if (!editPatientId) return;
    var payload = {
        full_name:      (g('edit_fullName').value    ||'').trim(),
        chinese_name:   (g('edit_chineseName').value ||'').trim()||null,
        phone_number:   (g('edit_phone').value       ||'').trim()||null,
        email:          (g('edit_email').value       ||'').trim()||null,
        sex:             g('edit_sex').value          ||null,
        dob:             g('edit_dob').value          ||null,
        hkid:           (g('edit_hkid').value        ||'').trim()||null,
        insurance_no:   (g('edit_insuranceNo').value ||'').trim()||null,
        occupation:     (g('edit_occupation').value  ||'').trim()||null,
        address:        (g('edit_address').value     ||'').trim()||null,
        medical_alerts: (g('edit_alerts').value      ||'').trim()||null,
        remarks:        (g('edit_remarks').value     ||'').trim()||null
    };
    SB.from('patients').update(payload).eq('id',editPatientId)
    .then(function(r) {
        if (r.error) { alert('Error: '+r.error.message); return; }
        closeModal('editPatientModal');
        fetchPatients();
        alert('Patient updated!');
    });
}

function deletePatient() {
    if (currentRole==='nurse') { alert('Permission denied.'); return; }
    if (!editPatientId) return;
    var name = g('edit_fullName').value  || 'this patient';
    var no   = g('edit_patientNo').value || '';
    if (!confirm('Delete Patient #'+no+' "'+name+'"?\nCannot be undone.')) return;
    SB.from('treatments').delete().eq('patient_id',editPatientId)
    .then(function() {
        return SB.from('patients').delete().eq('id',editPatientId);
    })
    .then(function(r) {
        if (r.error) { alert('Error: '+r.error.message); return; }
        closeModal('editPatientModal');
        fetchPatients();
        alert('Patient deleted.');
    });
}

// ════════════════════════════════════════════════════════════════
// TREATMENT HISTORY
// ════════════════════════════════════════════════════════════════
function viewHistory(pid) {
    selPatientId = pid;
    SB.from('patients').select('*').eq('id',pid).single()
    .then(function(r) {
        if (r.error||!r.data) { alert('Could not load patient.'); return; }
        var p = r.data;
        g('det_patientNo').textContent   = p.patient_no ? '# '+p.patient_no : '';
        g('det_patientName').textContent = p.full_name+(p.chinese_name?'  '+p.chinese_name:'');
        g('det_alerts').textContent      = p.medical_alerts||'';
        var bs = g('bulkSec');
        if (currentRole!=='nurse') {
            bs.innerHTML =
                '<h3 style="margin-top:0;font-size:16px;">Add Clinical Note</h3>' +
                '<textarea id="bulkNoteInput" rows="3" ' +
                'placeholder="Enter treatment details..." ' +
                'style="width:100%;padding:10px;border:1px solid #ddd;' +
                'border-radius:6px;font-size:14px;box-sizing:border-box;' +
                'resize:vertical;"></textarea>' +
                '<button class="btn-add" id="noteSaveBtn" ' +
                'style="margin-top:10px;">Add to History</button>';
            g('noteSaveBtn').addEventListener('click', saveNote);
        } else {
            bs.innerHTML =
                '<p style="color:#888;font-style:italic;margin:0;">Viewing Mode</p>';
        }
        loadTreatments(pid);
        openModal('patientDetailsModal');
    });
}

function loadTreatments(pid) {
    var tl = g('treatmentTimeline');
    tl.innerHTML = '<p style="color:#999;">Loading...</p>';
    SB.from('treatments').select('*')
        .eq('patient_id',pid)
        .order('created_at',{ascending:false})
    .then(function(r) {
        if (r.error||!r.data||!r.data.length) {
            tl.innerHTML =
                '<p style="color:#999;margin:0;">No treatment history yet.</p>';
            return;
        }
        var todayStr = new Date().toDateString();
        tl.innerHTML = '';
        r.data.forEach(function(t) {
            var isToday = new Date(t.created_at).toDateString()===todayStr;
            var canEdit = isToday && currentRole!=='nurse';
            var div = document.createElement('div');
            div.className = 'note-card';
            div.innerHTML =
                (canEdit
                    ? '<button data-note="'+t.id+'" ' +
                      'style="position:absolute;right:12px;top:12px;' +
                      'background:var(--primary);color:white;border:none;' +
                      'padding:4px 10px;border-radius:4px;cursor:pointer;' +
                      'font-size:12px;">Edit</button>'
                    : '') +
                '<small style="color:#aaa;">' +
                    new Date(t.created_at).toLocaleString() +
                '</small>' +
                '<div id="nt-'+t.id+'" ' +
                'style="white-space:pre-wrap;margin-top:6px;font-size:14px;">' +
                    esc(t.notes) +
                '</div>';
            tl.appendChild(div);
            if (canEdit) {
                div.querySelector('button').addEventListener('click', function(){
                    editNote(t.id);
                });
            }
        });
    });
}

function saveNote() {
    var inp = g('bulkNoteInput');
    if (!inp) return;
    var note = inp.value.trim();
    if (!note) { alert('Please enter a note.'); return; }
    SB.from('treatments')
        .insert([{ patient_id:selPatientId, notes:note }])
    .then(function(r) {
        if (r.error) { alert('Error: '+r.error.message); return; }
        inp.value = '';
        loadTreatments(selPatientId);
    });
}

function editNote(nid) {
    var div = g('nt-'+nid);
    if (!div) return;
    var orig = div.innerText.trim();
    div.innerHTML =
        '<textarea id="ei-'+nid+'" ' +
        'style="width:100%;height:80px;padding:8px;border:1px solid #ddd;' +
        'border-radius:6px;font-size:14px;box-sizing:border-box;' +
        'margin-top:8px;resize:vertical;">' + esc(orig) + '</textarea>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;">' +
            '<button id="del-'+nid+'" ' +
            'style="background:var(--danger);color:white;border:none;' +
            'padding:6px 14px;border-radius:4px;cursor:pointer;">Delete</button>' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="can-'+nid+'" ' +
                'style="background:var(--gray);color:white;border:none;' +
                'padding:6px 14px;border-radius:4px;cursor:pointer;">Cancel</button>' +
                '<button id="sav-'+nid+'" ' +
                'style="background:var(--success);color:white;border:none;' +
                'padding:6px 14px;border-radius:4px;cursor:pointer;">Save</button>' +
            '</div>' +
        '</div>';
    g('del-'+nid).addEventListener('click', function() {
        if (!confirm('Delete this note?')) return;
        SB.from('treatments').delete().eq('id',nid)
        .then(function(r) {
            if (r.error) { alert('Error: '+r.error.message); return; }
            loadTreatments(selPatientId);
        });
    });
    g('can-'+nid).addEventListener('click', function() {
        loadTreatments(selPatientId);
    });
    g('sav-'+nid).addEventListener('click', function() {
        var v = g('ei-'+nid).value.trim();
        SB.from('treatments').update({notes:v}).eq('id',nid)
        .then(function(r) {
            if (r.error) { alert('Error: '+r.error.message); return; }
            loadTreatments(selPatientId);
        });
    });
}
