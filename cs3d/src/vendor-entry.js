/* Bundled Cornerstone3D + DICOM loader for the Banana Dicom Reader sidecar.
   Keep minify off — tool names must stay Length / Angle / … at runtime. */
import * as csCore from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import * as dicomNs from '@cornerstonejs/dicom-image-loader';
import dicomDefault from '@cornerstonejs/dicom-image-loader';

try {
    var csDicom = Object.assign({}, dicomDefault || {}, dicomNs || {});
    if (!csDicom.init && dicomDefault && typeof dicomDefault.init === 'function') csDicom = dicomDefault;

    window.csCore = csCore;
    window.csTools = csTools;
    window.csDicom = csDicom;
    window.BananaCS3DVendor = {
        core: csCore,
        tools: csTools,
        dicom: csDicom
    };
} catch (err) {
    window.BananaCS3DError = (err && err.message) ? err.message : String(err);
    throw err;
}
