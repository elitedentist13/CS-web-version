/**
 * Build DenCT (ZoliQua/Dental-CBCT-Viewer) into /denct for Banana CBCT Viewer.
 * Uses a sibling clone at ../Dental-CBCT-Viewer, or DENCT_SRC.
 *
 *   node scripts/build-denct-sidecar.js
 */
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var DEST = path.join(ROOT, 'denct');
var SRC = process.env.DENCT_SRC || path.resolve(ROOT, '..', 'Dental-CBCT-Viewer');
var UPSTREAM = 'https://github.com/ZoliQua/Dental-CBCT-Viewer.git';

function run(cmd, cwd) {
    console.log('> ' + cmd);
    child_process.execSync(cmd, { cwd: cwd, stdio: 'inherit', windowsHide: true });
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (name) {
        if (name === 'banana-boot.js') return;
        var src = path.join(from, name);
        var dst = path.join(to, name);
        if (fs.statSync(src).isDirectory()) copyDir(src, dst);
        else fs.copyFileSync(src, dst);
    });
}

function injectBoot(htmlPath) {
    var html = fs.readFileSync(htmlPath, 'utf8');
    if (html.indexOf('banana-boot.js') >= 0) return;
    html = html.replace('<head>', '<head>\n    <script src="./banana-boot.js"></script>');
    fs.writeFileSync(htmlPath, html);
}

if (!fs.existsSync(path.join(SRC, 'package.json'))) {
    console.log('Cloning DenCT into ' + SRC);
    fs.mkdirSync(path.dirname(SRC), { recursive: true });
    run('git clone --depth 1 ' + UPSTREAM + ' "' + SRC + '"', path.dirname(SRC));
}

if (!fs.existsSync(path.join(SRC, 'node_modules'))) {
    run('npm install', SRC);
}

run('npx vite build --base ./', SRC);

var built = path.join(SRC, 'demo-dist');
if (!fs.existsSync(path.join(built, 'index.html'))) {
    throw new Error('DenCT build missing demo-dist/index.html');
}

fs.mkdirSync(DEST, { recursive: true });
copyDir(built, DEST);
injectBoot(path.join(DEST, 'index.html'));
var licSrc = path.join(SRC, 'LICENSE');
if (fs.existsSync(licSrc)) fs.copyFileSync(licSrc, path.join(DEST, 'LICENSE'));
console.log('DenCT sidecar ready at ' + DEST);
