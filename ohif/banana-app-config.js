/**
 * OHIF sidecar config for Banana.
 * Local zip / folder only — no public PACS.
 * routerBasename is always the /ohif folder, even on /ohif/local or /ohif/viewer.
 */
(function () {
    var path = '/ohif';
    try {
        var raw = String(location.pathname || '').replace(/\/index\.html$/i, '');
        var low = raw.toLowerCase();
        var i = low.lastIndexOf('/ohif');
        if (i >= 0 && (raw.length === i + 5 || raw.charAt(i + 5) === '/')) {
            path = raw.slice(0, i + 5);
        } else {
            path = raw.replace(/\/+$/, '') || '/ohif';
        }
    } catch (e) { path = '/ohif'; }

    window.config = {
        name: 'banana-ohif-sidecar',
        routerBasename: path,
        extensions: [],
        modes: [],
        customizationService: {},
        showStudyList: true,
        maxNumberOfWebWorkers: 3,
        showWarningMessageForCrossOrigin: true,
        showCPUFallbackMessage: true,
        showLoadingIndicator: true,
        experimentalStudyBrowserSort: false,
        strictZSpacingForVolumeViewport: true,
        groupEnabledModesFirst: true,
        allowMultiSelectExport: false,
        maxNumRequests: { interaction: 100, thumbnail: 75, prefetch: 25 },
        showErrorDetails: 'always',
        defaultDataSourceName: 'dicomlocal',
        dataSources: [
            {
                namespace: '@ohif/extension-default.dataSourcesModule.dicomlocal',
                sourceName: 'dicomlocal',
                configuration: { friendlyName: 'Local DICOM zip / folder' }
            },
            {
                namespace: '@ohif/extension-default.dataSourcesModule.dicomjson',
                sourceName: 'dicomjson',
                configuration: { friendlyName: 'dicom json', name: 'json' }
            }
        ],
        httpErrorHandler: function (error) {
            console.warn('[banana-ohif]', error && error.status);
        }
    };
})();
