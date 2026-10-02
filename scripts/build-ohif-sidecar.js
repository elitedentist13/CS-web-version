/**
 * Build the official OHIF Viewer (tagged release) into /ohif for Banana.
 * Requires git + node. Uses corepack yarn. Source is cloned outside the repo.
 * Run: node scripts/build-ohif-sidecar.js
 */
var fs = require('fs');
var path = require('path');
var child_process = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var TAG = process.env.OHIF_TAG || 'v3.11.1';
var SRC = process.env.OHIF_SRC || path.resolve(ROOT, '..', 'ohif-src');
var DEST = path.join(ROOT, 'ohif');
var REPO = 'https://github.com/OHIF/Viewers.git';

function run(cmd, args, cwd, extra) {
    console.log('> ' + [cmd].concat(args).join(' ') + (cwd ? '  (' + cwd + ')' : ''));
    var r = child_process.spawnSync(cmd, args, Object.assign({
        cwd: cwd || ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        env: Object.assign({}, process.env, extra || {})
    }, extra && extra.spawn || {}));
    if (r.status !== 0) throw new Error('failed: ' + cmd + ' ' + args.join(' '));
}

function copyDir(from, to) {
    fs.mkdirSync(to, { recursive: true });
    fs.readdirSync(from).forEach(function (name) {
        if (name === 'banana-app-config.js' || name === 'banana-boot.js' || name === 'README.md') return;
        var a = path.join(from, name);
        var b = path.join(to, name);
        if (fs.statSync(a).isDirectory()) copyDir(a, b);
        else fs.copyFileSync(a, b);
    });
}

function patchIndex(htmlPath) {
    var html = fs.readFileSync(htmlPath, 'utf8');
    if (html.indexOf('banana-boot.js') < 0) {
        html = html.replace('<head>', '<head>\n    <script src="./banana-boot.js"></script>');
    }
    if (html.indexOf('app-config.js') >= 0) {
        /* keep their config tag; we overwrite the file */
    }
    fs.writeFileSync(htmlPath, html);
}

(function () {
    if (!fs.existsSync(path.join(SRC, '.git'))) {
        fs.mkdirSync(path.dirname(SRC), { recursive: true });
        run('git', ['clone', '--depth', '1', '--branch', TAG, REPO, SRC]);
    } else {
        console.log('using existing ' + SRC);
    }
    try { run('corepack', ['enable']); } catch (e) { console.warn('corepack enable skipped'); }
    run('corepack', ['yarn', 'install', '--immutable'], SRC);
    run('corepack', ['yarn', 'run', 'build'], SRC, {
        PUBLIC_URL: './',
        APP_CONFIG: 'config/default.js'
    });
    var dist = path.join(SRC, 'platform', 'app', 'dist');
    if (!fs.existsSync(dist)) throw new Error('OHIF dist missing: ' + dist);
    copyDir(dist, DEST);
    require('./copy-ohif-dist.js');
    console.log('OHIF sidecar ready at ' + DEST);
})();
