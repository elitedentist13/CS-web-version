/**
 * Build Cornerstone3D into /cs3d/vendor for Banana Dicom Reader.
 * Does not clone, patch, or overwrite /ohif/.
 *
 *   node scripts/build-cs3d-sidecar.js
 */
var fs = require('fs');
var path = require('path');
var child = require('child_process');

var ROOT = path.resolve(__dirname, '..');
var DEST = path.join(ROOT, 'cs3d');
var VENDOR = path.join(DEST, 'vendor');
var WASM = path.join(DEST, 'wasm');
var SRC = process.env.CS3D_SRC || path.resolve(ROOT, '..', 'cs3d-src');

function run(cmd, args, cwd) {
    console.log(cmd, args.join(' '));
    child.execFileSync(cmd, args, { cwd: cwd, stdio: 'inherit', shell: process.platform === 'win32' });
}

function writeJson(file, obj) {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
}

function copyWasm() {
    fs.mkdirSync(WASM, { recursive: true });
    var specs = [
        ['@cornerstonejs/codec-charls', 'charlswasm_decode.wasm'],
        ['@cornerstonejs/codec-libjpeg-turbo-8bit', 'libjpegturbowasm_decode.wasm'],
        ['@cornerstonejs/codec-openjpeg', 'openjpegwasm_decode.wasm'],
        ['@cornerstonejs/codec-openjph', 'openjphjs.wasm']
    ];
    specs.forEach(function (row) {
        var pkg = path.join(SRC, 'node_modules', row[0]);
        var found = null;
        function walk(dir, depth) {
            if (found || !fs.existsSync(dir) || depth > 4) return;
            fs.readdirSync(dir).forEach(function (n) {
                if (found) return;
                var p = path.join(dir, n);
                var st = fs.statSync(p);
                if (st.isDirectory()) walk(p, depth + 1);
                else if (n === row[1]) found = p;
            });
        }
        walk(pkg, 0);
        if (!found) {
            console.warn('wasm missing: ' + row[0] + ' / ' + row[1]);
            return;
        }
        fs.copyFileSync(found, path.join(WASM, row[1]));
        console.log('wasm', row[1]);
    });
}

function main() {
    fs.mkdirSync(SRC, { recursive: true });
    writeJson(path.join(SRC, 'package.json'), {
        name: 'banana-cs3d-vendor',
        private: true,
        version: '1.0.0',
        dependencies: {
            '@cornerstonejs/core': '3.14.4',
            '@cornerstonejs/dicom-image-loader': '3.14.4',
            '@cornerstonejs/tools': '3.14.4',
            'dicom-parser': '1.8.21'
        },
        devDependencies: {
            esbuild: '0.25.9'
        }
    });
    run('npm', ['install', '--no-fund', '--no-audit'], SRC);
    var esbuild = require(path.join(SRC, 'node_modules', 'esbuild'));
    fs.mkdirSync(VENDOR, { recursive: true });
    var empty = path.join(DEST, 'src', 'empty.js');
    esbuild.buildSync({
        absWorkingDir: SRC,
        entryPoints: [path.join(DEST, 'src', 'vendor-entry.js')],
        bundle: true,
        format: 'iife',
        platform: 'browser',
        outfile: path.join(VENDOR, 'cs3d.bundle.js'),
        minify: false,
        sourcemap: false,
        legalComments: 'none',
        define: {
            'process.env.NODE_ENV': '"production"',
            global: 'window'
        },
        nodePaths: [path.join(SRC, 'node_modules')],
        alias: {
            fs: empty,
            path: empty,
            'node:fs': empty,
            'node:path': empty
        }
    });
    copyWasm();
    var bundleFile = path.join(VENDOR, 'cs3d.bundle.js');
    patchWasmUrls(bundleFile);
    patchWorkerInit(bundleFile);
    patchMainThreadDecode(bundleFile);
    patchVtkNullWebglProxy(bundleFile);
    var bytes = fs.statSync(path.join(VENDOR, 'cs3d.bundle.js')).size;
    console.log('Banana Dicom Reader vendor ready at ' + VENDOR + ' (' + Math.round(bytes / 1024) + ' KB)');
}

function patchWasmUrls(file) {
    var js = fs.readFileSync(file, 'utf8');
    var map = {
        '@cornerstonejs/codec-libjpeg-turbo-8bit/decodewasm': 'libjpegturbowasm_decode.wasm',
        '@cornerstonejs/codec-charls/decodewasm': 'charlswasm_decode.wasm',
        '@cornerstonejs/codec-openjpeg/decodewasm': 'openjpegwasm_decode.wasm',
        '@cornerstonejs/codec-openjph/wasm': 'openjphjs.wasm'
    };
    Object.keys(map).forEach(function (spec) {
        var re = new RegExp('new URL\\("' + spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '",\\s*import_meta\\d+\\.url\\)', 'g');
        var next = 'new URL((window.BANANA_CS3D_BASE||"/cs3d")+"/wasm/' + map[spec] + '", document.baseURI)';
        var before = js;
        js = js.replace(re, next);
        if (js === before) throw new Error('no replace for ' + spec);
    });
    if (/new URL\("@cornerstonejs\/codec-/.test(js)) {
        throw new Error('wasm URL patch missed a codec specifier');
    }
    fs.writeFileSync(file, js);
    console.log('patched codec wasm URLs');
}

function patchWorkerInit(file) {
    var js = fs.readFileSync(file, 'utf8');
    var from = 'const maxWorkers = options2?.maxWebWorkers || getReasonableWorkerCount();\n    workerManager.registerWorker("dicomImageLoader", workerFn, {\n      maxWorkerInstances: maxWorkers\n    });';
    var to = 'const maxWorkers = (options2 && typeof options2.maxWebWorkers === "number") ? options2.maxWebWorkers : getReasonableWorkerCount();\n    if (maxWorkers > 0) workerManager.registerWorker("dicomImageLoader", workerFn, {\n      maxWorkerInstances: maxWorkers\n    });';
    if (js.indexOf(from) < 0) {
        throw new Error('worker init patch target not found');
    }
    fs.writeFileSync(file, js.replace(from, to));
    console.log('patched dicom worker init to allow main-thread decode');
}

function patchMainThreadDecode(file) {
    var js = fs.readFileSync(file, 'utf8');
    var from = '    return webWorkerManager2.executeTask("dicomImageLoader", "decodeTask", {';
    var to = '    if (typeof decodeImageFrame2 === "function") return decodeImageFrame2(imageFrame, transferSyntax, pixelData, decodeConfig, options2);\n    return webWorkerManager2.executeTask("dicomImageLoader", "decodeTask", {';
    if (js.indexOf(from) < 0) {
        throw new Error('main-thread decode patch target not found');
    }
    fs.writeFileSync(file, js.replace(from, to));
    console.log('patched decodeImageFrame to run on the main thread');
}

function patchVtkNullWebglProxy(file) {
    var js = fs.readFileSync(file, 'utf8');
    var from = 'return new Proxy(result, getCachingContextHandler());';
    var to = 'if (!result) {\n        result = model.canvas.getContext("webgl2") || model.canvas.getContext("webgl") || model.canvas.getContext("experimental-webgl");\n      }\n      if (!result) return null;\n      return new Proxy(result, getCachingContextHandler());';
    if (js.indexOf(from) < 0) {
        throw new Error('vtk WebGL proxy patch target not found');
    }
    if (js.indexOf('if (!result) return null;\n      return new Proxy(result, getCachingContextHandler());') >= 0) {
        console.log('vtk WebGL proxy already patched');
        return;
    }
    fs.writeFileSync(file, js.replace(from, to));
    console.log('patched vtk get3DContext to skip Proxy(null)');
}

main();
