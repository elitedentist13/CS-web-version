/**
 * Probe-walk smoke / spot test — Bern routes
 * Run: node scripts/probe-walk-smoke.js
 */
var fs = require('fs');
var path = require('path');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-charts.js'))) root = process.cwd();

var c = fs.readFileSync(path.join(root, 'app-charts.js'), 'utf8');
var e = c.indexOf('function pdParsePerioCellId');
if (e < 0) throw new Error('pdParsePerioCellId not found');
eval(c.slice(c.indexOf('function pdSameQuadrant'), e));
eval(
    'var UPPER_RIGHT=[18,17,16,15,14,13,12,11],' +
    'UPPER_LEFT=[21,22,23,24,25,26,27,28],' +
    'LOWER_RIGHT=[48,47,46,45,44,43,42,41],' +
    'LOWER_LEFT=[31,32,33,34,35,36,37,38],' +
    'perioSettings={probingSequence:"bern"};' +
    c.slice(c.indexOf('function pdProbeToothBlocks'), e)
);

var fails = [];
function ok(cond, msg) {
    if (!cond) fails.push(msg);
}

var SEGMENTS = [
    { name: '18B→11B toward', teeth: [18,17,16,15,14,13,12,11], surf: 'b', order: 'd-m-me' },
    { name: '21B→28B away',   teeth: [21,22,23,24,25,26,27,28], surf: 'b', order: 'me-m-d' },
    { name: '28L→21L toward', teeth: [28,27,26,25,24,23,22,21], surf: 'l', order: 'd-m-me' },
    { name: '11L→18L away',   teeth: [11,12,13,14,15,16,17,18], surf: 'l', order: 'me-m-d' },
    { name: '38B→31B toward', teeth: [38,37,36,35,34,33,32,31], surf: 'b', order: 'd-m-me' },
    { name: '41B→48B away',   teeth: [41,42,43,44,45,46,47,48], surf: 'b', order: 'me-m-d' },
    { name: '48L→41L toward', teeth: [48,47,46,45,44,43,42,41], surf: 'l', order: 'd-m-me' },
    { name: '31L→38L away',   teeth: [31,32,33,34,35,36,37,38], surf: 'l', order: 'me-m-d' }
];

console.log('=== Bern site-order rules (UI + walk) ===');
SEGMENTS.forEach(function(seg) {
    var bad = [];
    seg.teeth.forEach(function(tn) {
        var got = pdSiteOrderForToothSurface(tn, seg.surf).join('-');
        if (got !== seg.order) bad.push(tn + '=' + got);
    });
    var pass = bad.length === 0;
    ok(pass, seg.name + ' FAIL ' + bad.join(', '));
    console.log((pass ? 'PASS' : 'FAIL') + '  ' + seg.name + '  →  ' + seg.order +
        (pass ? '' : '  !! ' + bad.join(', ')));
});

var blocks = pdProbeToothBlocks('bern');
console.log('\n=== Tooth path blocks ===');
[
    '1. Upper buccal 18B→28B',
    '2. Upper lingual 28L→18L',
    '3. Lower buccal 38B→48B',
    '4. Lower lingual 48L→38L'
].forEach(function(label, i) {
    console.log(label + ': ' + blocks[i].surface.toUpperCase() + ' ' + blocks[i].teeth.join('→'));
});

ok(blocks[0].teeth.join() === '18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28', 'block0 teeth');
ok(blocks[1].teeth.join() === '28,27,26,25,24,23,22,21,11,12,13,14,15,16,17,18', 'block1 teeth');
ok(blocks[2].teeth.join() === '38,37,36,35,34,33,32,31,41,42,43,44,45,46,47,48', 'block2 teeth');
ok(blocks[3].teeth.join() === '48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38', 'block3 teeth');

var seq = pdProbeWalkSequence('bern');
ok(seq.length === 192, 'seq length expected 192 got ' + seq.length);

function idxOf(tn, surface, pos) {
    return seq.findIndex(function(s) {
        return s.tn === tn && s.surface === surface && s.pos === pos;
    });
}

function site(i) {
    var s = seq[i];
    return s.tn + s.surface.toUpperCase() + s.pos;
}

console.log('\n=== Spot transitions ===');
var spots = [
    { label: 'Start', from: [18,'b','d'], expectNext: null, note: 'first site' },
    { label: '11B me → 21B me', from: [11,'b','me'], expect: [21,'b','me'] },
    { label: '28B d → 28L d', from: [28,'b','d'], expect: [28,'l','d'] },
    { label: '28L d→m→me', from: [28,'l','d'], chain: ['28Ld','28Lm','28Lme'] },
    { label: '21L me → 11L me', from: [21,'l','me'], expect: [11,'l','me'] },
    { label: '18L d → 38B d', from: [18,'l','d'], expect: [38,'b','d'] },
    { label: '38B d→m→me (lower start)', from: [38,'b','d'], chain: ['38Bd','38Bm','38Bme'] },
    { label: '31B me → 41B me', from: [31,'b','me'], expect: [41,'b','me'] },
    { label: '41B me→m→d', from: [41,'b','me'], chain: ['41Bme','41Bm','41Bd'] },
    { label: '48B d → 48L d', from: [48,'b','d'], expect: [48,'l','d'] },
    { label: '48L d→m→me (lower lingual start)', from: [48,'l','d'], chain: ['48Ld','48Lm','48Lme'] },
    { label: '41L me → 31L me', from: [41,'l','me'], expect: [31,'l','me'] },
    { label: 'End at 38Ld', from: [38,'l','d'], expectNext: null, note: 'last site' }
];

spots.forEach(function(sp) {
    var i = idxOf(sp.from[0], sp.from[1], sp.from[2]);
    ok(i >= 0, sp.label + ' not found in seq');
    if (i < 0) {
        console.log('FAIL  ' + sp.label);
        return;
    }
    if (sp.chain) {
        var got = sp.chain.map(function(_, k) { return site(i + k); });
        var pass = got.join() === sp.chain.join();
        ok(pass, sp.label + ' got ' + got.join('→'));
        console.log((pass ? 'PASS' : 'FAIL') + '  ' + sp.label + '  ' + got.join(' → '));
        return;
    }
    if (sp.expect) {
        var n = seq[i + 1];
        var pass = n && n.tn === sp.expect[0] && n.surface === sp.expect[1] && n.pos === sp.expect[2];
        ok(pass, sp.label + ' got ' + (n ? site(i + 1) : 'EOF'));
        console.log((pass ? 'PASS' : 'FAIL') + '  ' + sp.label + '  ' + site(i) + ' → ' + (n ? site(i + 1) : 'EOF'));
        return;
    }
    if (sp.label === 'Start') {
        ok(i === 0, 'Start not at index 0');
        console.log((i === 0 ? 'PASS' : 'FAIL') + '  Start at ' + site(0));
        return;
    }
    if (sp.expectNext === null) {
        ok(i === seq.length - 1, sp.label + ' not last');
        console.log((i === seq.length - 1 ? 'PASS' : 'FAIL') + '  ' + sp.label +
            ' at ' + site(i) + ' (#' + (i + 1) + '/' + seq.length + ')');
    }
});

// Continuity: within a tooth, positions follow either D-M-Me or Me-M-D without jumps
console.log('\n=== Intra-tooth continuity ===');
var contFails = 0;
for (var i = 1; i < seq.length; i++) {
    var a = seq[i - 1];
    var b = seq[i];
    if (a.tn !== b.tn || a.surface !== b.surface) continue;
    var dmm = ['d', 'm', 'me'];
    var mmd = ['me', 'm', 'd'];
    var stepOk =
        dmm.indexOf(b.pos) - dmm.indexOf(a.pos) === 1 ||
        mmd.indexOf(b.pos) - mmd.indexOf(a.pos) === 1;
    if (!stepOk) {
        contFails++;
        fails.push('continuity ' + site(i - 1) + '→' + site(i));
    }
}
console.log((contFails === 0 ? 'PASS' : 'FAIL') + '  ' + contFails + ' continuity breaks');

// Sample full chain snippets
console.log('\n=== Sample chains ===');
function printChain(label, tn0, s0, p0, tn1, s1, p1) {
    var a = idxOf(tn0, s0, p0);
    var b = idxOf(tn1, s1, p1);
    var parts = seq.slice(a, b + 1).map(function(s, k) {
        return s.tn + s.surface.toUpperCase() + s.pos;
    });
    console.log(label + ' (' + parts.length + ' sites):');
    console.log('  ' + parts.join(' → '));
}
printChain('28L→21L', 28, 'l', 'd', 21, 'l', 'me');
printChain('38B→41B cross', 31, 'b', 'me', 42, 'b', 'me');

console.log('\n=== RESULT ===');
if (fails.length) {
    console.log('FAILED (' + fails.length + ')');
    fails.forEach(function(f) { console.log(' - ' + f); });
    process.exit(1);
}
console.log('ALL SMOKE CHECKS PASSED');
