in the xray tab, the image library should auto-refresh and show saved images everytime the xray tab is click or a patient is selected already in the "treatment notes " tab

--> DONE (2026-05-14):
    1. Added refreshXrays() to app-xray.js — wires the ↻ Refresh button that was calling an undefined function.
    2. Updated switchConTab('xrays') in app-consultation.js — now falls back to syncXrayPatient(conPatientId, conPatientData) when xrayPatientId is not yet set, so clicking the X-ray tab always shows the current patient's images even if the sync hadn't fired yet.
