/* ════════════════════════════════════════════════════════════════════
 *  app-engines.js — real chess/xiangqi AI via UCI engines (WASM/asm.js)
 *
 *  Loads Stockfish (international chess) and Pikafish (xiangqi) into a
 *  Web Worker and talks UCI to them. Everything runs locally in the
 *  browser — no server, no API key.
 *
 *  Engine files ship with the app under ./engines/ so the games work
 *  fully OFFLINE and stay stable regardless of CDN availability:
 *     engines/stockfish.js                 (Stockfish 10, asm.js)
 *     engines/pikafish/pikafish.js         (Pikafish, emscripten glue)
 *     engines/pikafish/pikafish.wasm       (Pikafish WebAssembly)
 *     engines/pikafish/pikafish.data       (bundled NNUE network)
 *  Remote CDN/site mirrors are kept only as a last-resort fallback. If no
 *  source loads, callers should fall back to the built-in JS AI.
 *
 *  Two wire protocols are supported per engine:
 *     'stdin'   — script auto-wires self.onmessage (Stockfish asm.js):
 *                 postMessage('uci'); lines come back as strings.
 *     'factory' — script exposes self.Pikafish({...}) returning a promise
 *                 to an engine object with .sendCommand(str) and an
 *                 onReceiveStdout callback (Pikafish web build).
 *
 *  Public API:
 *     GameEngine.bestMove(game, fen, { skill, movetime })  → Promise<uciMove>
 *     GameEngine.label(game)         → 'Stockfish' | 'Pikafish'
 *     GameEngine.isActive(game)      → bool (a real engine move was produced)
 *
 *  Override sources before first use, e.g.:
 *     window.ENGINE_CONFIG = { chess:{ sources:[...] }, xiangqi:{ sources:[...] } };
 * ════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    var USER = (typeof window !== 'undefined' && window.ENGINE_CONFIG) || {};

    // Resolve a path relative to the page so blob Workers (whose own origin is
    // "blob:") can importScripts() our local engine files by absolute URL.
    function abs(p) {
        try { return new URL(p, document.baseURI).href; }
        catch (e) { return p; }
    }

    var DEFS = {
        chess: {
            label: 'Stockfish',
            protocol: 'stdin',
            sources: (USER.chess && USER.chess.sources) || [
                // Local, offline-first.
                { script: abs('engines/stockfish.js') },
                // Remote fallbacks (permissive CORS for cross-origin importScripts).
                { script: 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js' },
                { script: 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js' }
            ],
            options: []
        },
        xiangqi: {
            label: 'Pikafish',
            protocol: 'factory',
            sources: (USER.xiangqi && USER.xiangqi.sources) || [
                // Local, offline-first (NNUE bundled inside pikafish.data).
                {
                    script: abs('engines/pikafish/pikafish.js'),
                    wasm:   abs('engines/pikafish/pikafish.wasm'),
                    data:   abs('engines/pikafish/pikafish.data')
                },
                // Remote mirror fallback (official Pikafish web build).
                {
                    script: 'https://xiangqiai.com/engine/main_20240816v7/single/pikafish.js',
                    wasm:   'https://xiangqiai.com/engine/main_20240816v7/single/pikafish.wasm',
                    data:   'https://xiangqiai.com/engine/main_20240816v7/data/pikafish.data'
                }
            ],
            options: []
        }
    };

    var INIT_TIMEOUT = 25000;   // ms to obtain 'uciok' (Pikafish loads ~4MB)
    var engines = {};           // game -> record
    var active  = {};           // game -> bool (produced a real move)

    // ---- worker boot builders -------------------------------------------

    function bootStdin(src) {
        // Script auto-wires self.onmessage; we just need importScripts and,
        // if a wasm path is supplied, a locateFile hint for cross-origin.
        var boot = '';
        if (src.wasm || src.data) {
            boot += 'self.Module=self.Module||{};' +
                'self.Module.locateFile=function(p){' +
                (src.wasm ? 'if(p.indexOf(".wasm")>=0)return ' + JSON.stringify(src.wasm) + ';' : '') +
                (src.data ? 'if(p.indexOf(".data")>=0)return ' + JSON.stringify(src.data) + ';' : '') +
                'return p;};';
        }
        boot += 'try{importScripts(' + JSON.stringify(src.script) + ');}' +
                'catch(e){self.postMessage("IMPORT_ERROR:"+e);}';
        return boot;
    }

    function bootFactory(src) {
        // Pikafish web build: importScripts the glue, instantiate via the
        // self.Pikafish(...) factory, then expose a plain UCI string pipe so
        // the rest of this module can treat it like any stdin engine.
        var CFG = JSON.stringify({ script: src.script, wasm: src.wasm, data: src.data });
        return '' +
            'var CFG=' + CFG + ';' +
            'var __eng=null,__ready=false,__q=[];' +
            'function __flush(){while(__q.length&&__eng){__eng.sendCommand(__q.shift());}}' +
            'self.onmessage=function(e){var c=e.data;if(typeof c!=="string")return;' +
            '  if(__ready&&__eng){__eng.sendCommand(c);}else{__q.push(c);}};' +
            'try{importScripts(CFG.script);}catch(err){self.postMessage("IMPORT_ERROR:"+err);}' +
            'try{' +
            '  self.Pikafish({' +
            '    onReceiveStdout:function(o){self.postMessage(o);},' +
            '    onExit:function(){},' +
            '    locateFile:function(u){' +
            '      if(u==="pikafish.data"||u.indexOf(".data")>=0)return CFG.data;' +
            '      if(u.indexOf(".wasm")>=0)return CFG.wasm;return u;},' +
            '    setStatus:function(){}' +
            '  }).then(function(p){__eng=p;__ready=true;__flush();})' +
            '   .catch(function(err){self.postMessage("IMPORT_ERROR:factory:"+err);});' +
            '}catch(err){self.postMessage("IMPORT_ERROR:"+err);}';
    }

    function makeWorker(src, def) {
        var boot = def.protocol === 'factory' ? bootFactory(src) : bootStdin(src);
        var blob = new Blob([boot], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    function lineOf(e) {
        return typeof e.data === 'string' ? e.data
             : (e.data && typeof e.data.data === 'string') ? e.data.data : '';
    }

    function tryOne(src, def) {
        return new Promise(function (resolve, reject) {
            var w;
            try { w = makeWorker(src, def); } catch (e) { return reject(e); }
            var settled = false;
            var to = setTimeout(function () {
                if (!settled) { settled = true; try { w.terminate(); } catch (_) {} reject('timeout'); }
            }, INIT_TIMEOUT);
            w.onmessage = function (e) {
                var line = lineOf(e);
                if (line.indexOf('IMPORT_ERROR') === 0) {
                    if (!settled) { settled = true; clearTimeout(to); try { w.terminate(); } catch (_) {} reject(line); }
                    return;
                }
                if (line.indexOf('uciok') >= 0) {
                    if (!settled) {
                        settled = true; clearTimeout(to);
                        (def.options || []).forEach(function (o) { try { w.postMessage(o); } catch (_) {} });
                        resolve(w);
                    }
                }
            };
            w.onerror = function () {
                if (!settled) { settled = true; clearTimeout(to); try { w.terminate(); } catch (_) {} reject('worker error'); }
            };
            // For 'stdin' engines this kicks off handshake; for 'factory' it is
            // queued in the worker until the engine resolves, then replayed.
            try { w.postMessage('uci'); } catch (e) { /* uciok handler still applies */ }
        });
    }

    function trySources(def, i) {
        if (i >= def.sources.length) return Promise.reject('no engine source loaded');
        return tryOne(def.sources[i], def).catch(function () { return trySources(def, i + 1); });
    }

    function initEngine(game) {
        var def = DEFS[game];
        if (!def) return Promise.reject('unknown game');
        if (engines[game]) return engines[game].ready;
        var rec = { worker: null, newGame: false };
        rec.ready = trySources(def, 0).then(function (w) { rec.worker = w; return w; });
        engines[game] = rec;
        return rec.ready;
    }

    function bestMove(game, fen, opts) {
        opts = opts || {};
        var def = DEFS[game];
        if (!def) return Promise.reject('unknown game');
        return initEngine(game).then(function (w) {
            return new Promise(function (resolve, reject) {
                var rec = engines[game];
                var mt = opts.movetime || 600;
                var settled = false;
                var to = setTimeout(function () {
                    if (!settled) { settled = true; w.removeEventListener('message', handler); reject('move timeout'); }
                }, mt + 12000);
                function handler(e) {
                    var line = lineOf(e);
                    var m = line.match(/bestmove\s+(\S+)/);
                    if (m) {
                        settled = true; clearTimeout(to); w.removeEventListener('message', handler);
                        if (!m[1] || m[1] === '(none)') reject('no move');
                        else { active[game] = true; resolve(m[1]); }
                    }
                }
                w.addEventListener('message', handler);
                if (typeof opts.skill === 'number') {
                    try { w.postMessage('setoption name Skill Level value ' + opts.skill); } catch (_) {}
                }
                if (!rec.newGame) { try { w.postMessage('ucinewgame'); } catch (_) {} rec.newGame = true; }
                w.postMessage('position fen ' + fen);
                w.postMessage('go movetime ' + mt);
            });
        });
    }

    window.GameEngine = {
        bestMove: bestMove,
        label: function (game) { return (DEFS[game] && DEFS[game].label) || 'Engine'; },
        isActive: function (game) { return !!active[game]; }
    };
})();
