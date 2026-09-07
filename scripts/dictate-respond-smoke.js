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

show('3');
show('two');
show('3 2 4');
show('tooth 2 8');
show('for');
show('start 17 distobuccal 6');

var bad = ctx.pdDictParse('3 2 4');
var ok = bad.length === 3 && bad.every(function(x) { return x.type === 'value'; });
console.log('3 2 4 as three values:', ok ? 'PASS' : 'FAIL ' + JSON.stringify(bad));
process.exit(ok ? 0 : 1);
