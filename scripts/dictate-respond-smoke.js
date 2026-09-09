var fs = require('fs');
var vm = require('vm');
var code = fs.readFileSync('app-perio-dictation.js', 'utf8');
var ctx = {
    window: { addEventListener: function() {} },
    localStorage: { getItem: function() { return null; }, setItem: function() {} },
    document: {
        querySelectorAll: function() { return []; },
        getElementById: function() { return null; },
        createElement: function() { return { style: {}, classList: { add: function() {}, toggle: function() {} }, appendChild: function() {}, addEventListener: function() {}, querySelector: function() { return null; }, setAttribute: function() {} }; },
        head: { appendChild: function() {} }
    },
    perioSettings: { numbering: 'fdi' },
    perioState: {},
    UPPER_RIGHT: [18,17,16,15,14,13,12,11],
    UPPER_LEFT: [21,22,23,24,25,26,27,28],
    LOWER_RIGHT: [48,47,46,45,44,43,42,41],
    LOWER_LEFT: [31,32,33,34,35,36,37,38],
    console: console
};
ctx.window = Object.assign(ctx.window, ctx);
ctx.addEventListener = function() {};
vm.runInNewContext(code + '\nthis.pdDict=pdDict; this.pdDictParse=pdDictParse; this.pdDictNormalize=pdDictNormalize;', ctx);

ctx.pdDict.cursor = { tn: 18, surface: 'b', pos: 'd', measure: 'pd' };

function show(raw) {
    var n = ctx.pdDictNormalize(raw);
    var a = ctx.pdDictParse(raw);
    console.log(JSON.stringify(raw), '→', n, '→', JSON.stringify(a));
}

function vals(raw) {
    return ctx.pdDictParse(raw).filter(function(x) { return x.type === 'value'; }).map(function(x) { return x.n; });
}

function eqArr(a, b) {
    return a.length === b.length && a.every(function(v, i) { return v === b[i]; });
}

var checks = [];
function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail || '' });
    console.log(name + ':', ok ? 'PASS' : 'FAIL ' + (detail || ''));
}

show('3');
show('two');
show('3 2 4');
show('one two one');
show('121');
show('twelve');
show('12 1');
show('eleven');
show('tooth 2 8');
show('for');
show('start 17 distobuccal 6');
show('-3');

check('3 2 4 as three values', eqArr(vals('3 2 4'), [3, 2, 4]), JSON.stringify(ctx.pdDictParse('3 2 4')));
check('one two one → 1,2,1', eqArr(vals('one two one'), [1, 2, 1]), JSON.stringify(ctx.pdDictParse('one two one')));
check('121 glued → 1,2,1', eqArr(vals('121'), [1, 2, 1]), JSON.stringify(ctx.pdDictParse('121')));
check('twelve stays 12', eqArr(vals('twelve'), [12]), JSON.stringify(ctx.pdDictParse('twelve')));
check('12 1 glued → 1,2,1', eqArr(vals('12 1'), [1, 2, 1]), JSON.stringify(ctx.pdDictParse('12 1')));
check('eleven stays 11', eqArr(vals('eleven'), [11]), JSON.stringify(ctx.pdDictParse('eleven')));
check('tooth 2 8 still joins FDI', ctx.pdDictNormalize('tooth 2 8') === 'tooth 28', ctx.pdDictNormalize('tooth 2 8'));
check('for → 4', eqArr(vals('for'), [4]), JSON.stringify(ctx.pdDictParse('for')));

var start = ctx.pdDictParse('start 17 distobuccal 6');
check(
    'start 17 distobuccal 6',
    start.length === 2 && start[0].type === 'start' && start[0].tn === 17 &&
        start[1].type === 'value' && start[1].n === 6,
    JSON.stringify(start)
);

ctx.pdDict.cursor = { tn: 18, surface: 'b', pos: 'd', measure: 'gm' };
check('GM -3 stays negative', eqArr(vals('-3'), [-3]), JSON.stringify(ctx.pdDictParse('-3')));

var failed = checks.filter(function(c) { return !c.ok; });
process.exit(failed.length ? 1 : 0);
