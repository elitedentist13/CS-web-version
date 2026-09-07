var http = require('http');
var fs = require('fs');

function get(path) {
    return new Promise(function(res, rej) {
        http.get({ host: '127.0.0.1', port: 8123, path: path }, function(r) {
            var d = '';
            r.on('data', function(c) { d += c; });
            r.on('end', function() {
                res({ status: r.statusCode, body: d });
            });
        }).on('error', rej);
    });
}

(async function() {
    var spot = await get('/probe-walk-spot.html');
    var charts = await get('/app-charts.js');
    var idx = await get('/index.html');
    console.log('spot.html', spot.status, 'bytes', spot.body.length);
    console.log('app-charts.js has pdBernIsTowardMidline:', charts.body.indexOf('pdBernIsTowardMidline') >= 0);
    console.log('served BUILD:', (idx.body.match(/BUILD = '([^']+)'/) || [])[1]);

    var c = fs.readFileSync('app-charts.js', 'utf8');
    var e = c.indexOf('function pdParsePerioCellId');
    eval(c.slice(c.indexOf('function pdSameQuadrant'), e));
    eval(
        'var UPPER_RIGHT=[18,17,16,15,14,13,12,11],' +
        'UPPER_LEFT=[21,22,23,24,25,26,27,28],' +
        'LOWER_RIGHT=[48,47,46,45,44,43,42,41],' +
        'LOWER_LEFT=[31,32,33,34,35,36,37,38],' +
        'perioSettings={probingSequence:"bern"};' +
        c.slice(c.indexOf('function pdProbeToothBlocks'), e)
    );

    function fakeTri(tn, surf) {
        return pdSiteOrderForToothSurface(tn, surf).join('-');
    }

    var checks = [
        [28, 'l', 'd-m-me'], [21, 'l', 'd-m-me'],
        [21, 'b', 'me-m-d'], [28, 'b', 'me-m-d'],
        [41, 'b', 'me-m-d'], [48, 'b', 'me-m-d'],
        [48, 'l', 'd-m-me'], [31, 'l', 'me-m-d'],
        [18, 'b', 'd-m-me'], [38, 'b', 'd-m-me']
    ];
    var fails = [];
    checks.forEach(function(t) {
        var g = fakeTri(t[0], t[1]);
        var pass = g === t[2];
        if (!pass) fails.push(t[0] + t[1] + '=' + g);
        console.log((pass ? 'PASS' : 'FAIL') + ' DOM-sim ' + t[0] + (t[1] === 'b' ? 'B' : 'L') + ' ' + g);
    });

    var seq = pdProbeWalkSequence();
    var i = seq.findIndex(function(s) { return s.tn === 28 && s.surface === 'l' && s.pos === 'd'; });
    console.log('Tab-sim 28Ld…', seq.slice(i, i + 8).map(function(s) {
        return s.tn + s.surface.toUpperCase() + s.pos;
    }).join(' → '));

    i = seq.findIndex(function(s) { return s.tn === 31 && s.surface === 'b' && s.pos === 'me'; });
    console.log('Tab-sim 31Bme…', seq.slice(i, i + 5).map(function(s) {
        return s.tn + s.surface.toUpperCase() + s.pos;
    }).join(' → '));

    console.log(fails.length ? 'FAILED ' + fails.join(', ') : 'HTTP + DOM-SIM ALL PASS');
    process.exit(fails.length ? 1 : 0);
})();
