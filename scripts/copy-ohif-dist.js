var fs = require('fs');
var path = require('path');
var from = path.resolve(__dirname, '..', '..', 'ohif-src', 'platform', 'app', 'dist');
var to = path.resolve(__dirname, '..', 'ohif');
if (!fs.existsSync(from)) from = process.env.OHIF_DIST || from;
function skip(n) {
    return /\.map$/.test(n) ||
        n === 'ort' || n === 'dicom-microscopy-viewer' ||
        n === 'banana-app-config.js' || n === 'banana-boot.js' || n === 'README.md';
}
function copy(a, b) {
    fs.mkdirSync(b, { recursive: true });
    fs.readdirSync(a).forEach(function (n) {
        if (skip(n)) return;
        var A = path.join(a, n);
        var B = path.join(b, n);
        if (fs.statSync(A).isDirectory()) copy(A, B);
        else fs.copyFileSync(A, B);
    });
}
copy(from, to);
fs.copyFileSync(path.join(to, 'banana-app-config.js'), path.join(to, 'app-config.js'));
var htmlPath = path.join(to, 'index.html');
var html = fs.readFileSync(htmlPath, 'utf8');
if (html.indexOf('banana-boot.js') < 0) {
    html = html.replace('<head>', '<head><script src="./banana-boot.js"></script>');
    fs.writeFileSync(htmlPath, html);
}
var files = fs.readdirSync(to);
console.log('ohif files', files.length);
console.log('bundle', files.filter(function (f) { return /^app\.bundle/.test(f); }).join(','));
console.log('boot patched', fs.readFileSync(htmlPath, 'utf8').indexOf('banana-boot') >= 0);
console.log('local config', /dicomlocal/.test(fs.readFileSync(path.join(to, 'app-config.js'), 'utf8')));
