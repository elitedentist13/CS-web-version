// app-entertainment.js
// Entertainment Hub – Four in a Row, Chess (International), Chinese Chess (象棋), Gomoku (五子棋)
// Three game modes: vs AI  |  Local 2-Player  |  Online Same-Clinic (Supabase Realtime Broadcast)

(function () {
    'use strict';

    function g(id) { return document.getElementById(id); }

    // ────────────────────────────────────────────────────────────────
    //  MODULE STATE
    // ────────────────────────────────────────────────────────────────
    var entGame     = null;   // 'c4' | 'chess' | 'xiangqi' | 'gomoku'
    var entMode     = null;   // 'ai'  | 'local' | 'online'
    var entRole     = null;   // 'host' | 'guest'  (online only)
    var entRoomCode = null;
    var entChannel  = null;
    var entMyColor  = null;   // color/player assigned to this browser
    var entTurn     = null;   // whose turn right now
    var entGameOver = false;
    var _entApplyingOnline = false;  // suppresses re-broadcast when processing received move
    var _onlineHandler     = null;   // set by each game's init, called on received moves

    // Per-browser unique id — lets >2 clients share the host/guest channel (used by Mahjong)
    var entClientId = (Math.random().toString(36).slice(2, 8) + Date.now().toString(36)).toUpperCase();

    // Mahjong shared state object (populated by the Mahjong section further below)
    var MJ = { claimTimer: null, turnTimer: null };

    var GAME_NAMES = {
        c4:          'Four in a Row',
        chess:       'Chess',
        xiangqi:     'Chinese Chess (象棋)',
        gomoku:      'Gomoku (五子棋)',
        reversi:     'Reversi (Othello)',
        '2048':      '2048',
        minesweeper: 'Minesweeper',
        snake:       'Snake',
        sudoku:      'Sudoku',
        mahjong:     'Mahjong 麻將',
        typing:      'Typing of the Cats 打字貓',
        ime:         '中文輸入法練習 IME Practice'
    };

    // Games with no multiplayer — show difficulty / just start directly
    var SOLO_GAMES = { '2048': true, minesweeper: true, snake: true, sudoku: true, typing: true, ime: true };

    // Solo loop handles (cleared on exit/restart)
    var _snakeInterval = null;
    var _msTimer       = null;
    var _typingLoop    = null;
    var _tyKeyHandler  = null;

    function stopAllSoloLoops() {
        if (_snakeInterval) { clearInterval(_snakeInterval); _snakeInterval = null; }
        if (_msTimer)       { clearInterval(_msTimer);       _msTimer = null; }
        if (typeof tyStopLoop === 'function') tyStopLoop();
        if (typeof imStopLoop === 'function') imStopLoop();
        if (MJ && MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }
        if (MJ && MJ.turnTimer)  { clearTimeout(MJ.turnTimer);  MJ.turnTimer  = null; }
    }

    // ────────────────────────────────────────────────────────────────
    //  PANEL MANAGEMENT
    // ────────────────────────────────────────────────────────────────
    var ENT_PANELS = ['entLobby', 'entModeSelect', 'entOnlineRoom', 'entGameArea'];

    function showPanel(id) {
        ENT_PANELS.forEach(function (p) {
            var el = g(p);
            if (el) el.style.display = (p === id) ? '' : 'none';
        });
    }

    function showEntertainment() {
        if (typeof showOnly === 'function') {
            showOnly('entertainmentSection');
        } else {
            var sec = g('entertainmentSection');
            if (sec) { sec.style.display = 'block'; sec.removeAttribute('aria-hidden'); }
        }
        showPanel('entLobby');
        var sec = g('entertainmentSection');
        if (sec && typeof applyI18nInRoot === 'function') applyI18nInRoot(sec);
    }

    // ────────────────────────────────────────────────────────────────
    //  GAME SELECTION → MODE / DIFFICULTY SELECTION
    // ────────────────────────────────────────────────────────────────
    function selectGame(game) {
        entGame = game;

        // Mahjong has its own table-setup screen (player count + computer/online seats)
        if (game === 'mahjong') { showMahjongSetup(); return; }

        // Solo games: no multiplayer mode — go to difficulty picker (or straight to game)
        if (SOLO_GAMES[game]) {
            if (game === '2048') { startGame(game, 'solo', {}); return; }
            showDifficultySelect(game);
            return;
        }

        // Multiplayer board games
        var el = g('entModeSelectInner');
        if (!el) return;
        el.innerHTML =
            '<h2 class="ent-mode-title">' + (GAME_NAMES[game] || game) + '</h2>' +
            '<div class="ent-mode-btns">' +
              '<button class="ent-mode-btn" id="entModeAI">🤖 vs Computer</button>' +
              '<button class="ent-mode-btn" id="entModeLocal">🖥️ Local 2 Players</button>' +
              '<button class="ent-mode-btn" id="entModeOnline">🌐 Online — Same Clinic</button>' +
            '</div>' +
            '<button class="ent-back-btn" id="entModeBack">← Back to Games</button>';
        g('entModeAI').onclick     = function () {
            if (AI_DIFF_GAMES[game]) { showAiDiffSelect(game); } else { startGame(game, 'ai', {}); }
        };
        g('entModeLocal').onclick  = function () { startGame(game, 'local', {}); };
        g('entModeOnline').onclick = function () { showOnlineRoom(game); };
        g('entModeBack').onclick   = function () { showPanel('entLobby'); };
        showPanel('entModeSelect');
    }

    // Games that offer an easy/medium/difficult/master AI selector
    var AI_DIFF_GAMES = { chess: 1, xiangqi: 1, c4: 1, gomoku: 1, reversi: 1 };

    var AI_DIFF_HINTS = {
        chess:   ['Makes random moves — perfect for beginners.', 'Greedy captures + positional play (1-ply).', '3-ply look-ahead with alpha-beta pruning.', '4-ply deep search — a real challenge!'],
        xiangqi: ['Makes random moves — perfect for beginners.', 'Greedy captures + material (1-ply).', '3-ply look-ahead with alpha-beta pruning.', '4-ply deep search — a real challenge!'],
        c4:      ['Drops in random columns.', '2-move look-ahead.', '5-move look-ahead — blocks your threats.', '7-move deep search — very hard to beat!'],
        gomoku:  ['Plays near random open points.', 'Greedy threat scoring.', 'Strong attack + defence weighting.', '2-ply look-ahead — anticipates your replies.'],
        reversi: ['Plays random valid moves.', 'Positional weights + mobility (1-ply).', '3-ply look-ahead with alpha-beta pruning.', '5-ply deep search — grabs corners ruthlessly!']
    };

    function showAiDiffSelect(game) {
        var el = g('entModeSelectInner'); if (!el) return;
        var hints = AI_DIFF_HINTS[game] || AI_DIFF_HINTS.chess;
        var DIFFS = [
            { id:'easy',      icon:'🟢', label:'Easy' },
            { id:'medium',    icon:'🟡', label:'Medium' },
            { id:'difficult', icon:'🟠', label:'Difficult' },
            { id:'master',    icon:'🔴', label:'Master' }
        ];
        var btns = DIFFS.map(function(d, i) {
            return '<button class="ent-mode-btn ent-chess-diff-btn" data-diff="'+d.id+'">' +
                   d.icon + ' ' + d.label +
                   '<span class="ent-diff-hint">'+hints[i]+'</span></button>';
        }).join('');
        el.innerHTML =
            '<h2 class="ent-mode-title">🎯 ' + (GAME_NAMES[game] || game) + ' — Difficulty</h2>' +
            '<div class="ent-mode-btns ent-diff-btns">' + btns + '</div>' +
            '<button class="ent-back-btn" id="entDiffSelBack">← Back</button>';
        el.querySelectorAll('[data-diff]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                startGame(game, 'ai', { difficulty: btn.dataset.diff });
            });
        });
        g('entDiffSelBack').onclick = function() { selectGame(game); };
    }

    function showDifficultySelect(game) {
        var el = g('entModeSelectInner'); if (!el) return;
        var DIFFS = {
            minesweeper: [
                {id:'easy',   label:'😊 Easy  (9 × 9,  10 mines)'},
                {id:'medium', label:'😐 Medium (14 × 14, 35 mines)'},
                {id:'hard',   label:'😤 Hard  (20 × 16, 70 mines)'}
            ],
            snake: [
                {id:'easy',   label:'🐢 Easy  (slow)'},
                {id:'medium', label:'🐍 Medium'},
                {id:'hard',   label:'⚡ Hard  (fast)'}
            ],
            sudoku: [
                {id:'easy',   label:'😊 Easy  (45 hints)'},
                {id:'medium', label:'😐 Medium (35 hints)'},
                {id:'hard',   label:'😤 Hard  (25 hints)'}
            ],
            typing: [
                {id:'easy',      label:'🐱 Easy  (single characters)'},
                {id:'medium',    label:'😼 Medium (chars + words)'},
                {id:'difficult', label:'🙀 Difficult (words + phrases)'},
                {id:'master',    label:'😾 Master (fast phrase swarm)'}
            ],
            ime: [
                {id:'easy',      label:'🚶 慢速 Slow  (walk)'},
                {id:'medium',    label:'🚲 普通 Normal (bike)'},
                {id:'difficult', label:'🚗 快速 Fast  (car)'},
                {id:'master',    label:'✈️ 極速 Insane (plane)'}
            ]
        };
        var diffs = DIFFS[game] || [];
        var btns  = diffs.map(function (d) {
            return '<button class="ent-mode-btn" data-diff="' + d.id + '">' + d.label + '</button>';
        }).join('');
        el.innerHTML =
            '<h2 class="ent-mode-title">' + (GAME_NAMES[game] || game) + '</h2>' +
            '<div class="ent-mode-btns">' + btns + '</div>' +
            '<button class="ent-back-btn" id="entDiffBack">← Back to Games</button>';
        el.querySelectorAll('[data-diff]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                startGame(game, 'solo', { difficulty: btn.dataset.diff });
            });
        });
        g('entDiffBack').onclick = function () { showPanel('entLobby'); };
        showPanel('entModeSelect');
    }

    // ────────────────────────────────────────────────────────────────
    //  ONLINE ROOM  (host / join)
    // ────────────────────────────────────────────────────────────────
    function showOnlineRoom(game) {
        var el = g('entOnlineRoomInner');
        if (!el) return;
        el.innerHTML =
            '<h2 class="ent-mode-title">🌐 Online — Same Clinic</h2>' +
            '<div class="ent-online-opts">' +
              '<button class="ent-mode-btn" id="entHostBtn">🏠 Host a Game</button>' +
              '<div class="ent-or-divider">— or —</div>' +
              '<div class="ent-join-row">' +
                '<input type="text" id="entJoinCode" class="ent-code-input"' +
                       ' placeholder="Room code" maxlength="6"' +
                       ' autocomplete="off" spellcheck="false">' +
                '<button class="ent-mode-btn" id="entJoinBtn">🚪 Join</button>' +
              '</div>' +
            '</div>' +
            '<div id="entRoomMsg" class="ent-room-msg"></div>' +
            '<button class="ent-back-btn" id="entOnlineBack">← Back</button>';

        showPanel('entOnlineRoom');
        g('entHostBtn').onclick  = function () { hostGame(game); };
        g('entJoinBtn').onclick  = function () {
            var code = String(g('entJoinCode').value || '').trim().toUpperCase();
            if (!code) { g('entRoomMsg').textContent = 'Please enter a room code.'; return; }
            joinGame(game, code);
        };
        g('entJoinCode').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') g('entJoinBtn').click();
        });
        g('entOnlineBack').onclick = function () { selectGame(game); };
    }

    function randomCode() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var s = '';
        for (var i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    }

    function clinicPrefix() {
        var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
            ? String(currentClinicId) : 'shared';
        return 'ent-' + cid;
    }

    function firstColor(game) {
        if (game === 'xiangqi') return 'r';
        if (game === 'chess')   return 'w';
        return 1;  // c4, gomoku, reversi
    }

    function oppositeColor(game, c) {
        if (game === 'chess'  ) return c === 'w' ? 'b' : 'w';
        if (game === 'xiangqi') return c === 'r' ? 'b' : 'r';
        return c === 1 ? 2 : 1;  // c4, gomoku, reversi
    }

    function hostGame(game) {
        entRole     = 'host';
        entRoomCode = randomCode();
        entMyColor  = firstColor(game);
        var msgEl   = g('entRoomMsg');
        msgEl.innerHTML =
            '<p>Your room code:</p>' +
            '<div class="ent-room-code-display">' + entRoomCode + '</div>' +
            '<p class="ent-wait-msg">⏳ Waiting for opponent to join…</p>';

        openOnlineChannel(function (msg) {
            if (msg.type === 'join') {
                sendOnline({ type: 'start', firstColor: entMyColor });
                startGame(game, 'online');
            } else if (msg.type === 'move') {
                entHandleOnlineMoveReceived(msg);
            }
        });
    }

    function joinGame(game, code) {
        entRole     = 'guest';
        entRoomCode = code;
        g('entRoomMsg').textContent = 'Connecting to room ' + code + '…';

        openOnlineChannel(function (msg) {
            if (msg.type === 'start') {
                entMyColor = oppositeColor(game, msg.firstColor);
                startGame(game, 'online');
            } else if (msg.type === 'move') {
                entHandleOnlineMoveReceived(msg);
            }
        });
        setTimeout(function () { sendOnline({ type: 'join' }); }, 700);
    }

    function openOnlineChannel(onMsg) {
        if (!window.SB) { alert('Realtime not available.'); return; }
        if (entChannel) {
            try { SB.removeChannel(entChannel); } catch (e) {}
            entChannel = null;
        }
        var channelName = clinicPrefix() + '-' + entRoomCode;
        entChannel = SB.channel(channelName, { config: { broadcast: { self: false } } });
        entChannel
            .on('broadcast', { event: 'ent' }, function (payload) {
                var msg = (payload && payload.payload) ? payload.payload : payload;
                if (!msg || msg._from === entRole) return;
                onMsg(msg);
            })
            .subscribe();
    }

    function sendOnline(data) {
        if (!entChannel || _entApplyingOnline) return;
        entChannel.send({
            type: 'broadcast', event: 'ent',
            payload: Object.assign({}, data, { _from: entRole })
        }).catch(function () {});
    }

    function cleanupOnlineChannel() {
        if (entChannel) {
            try { SB.removeChannel(entChannel); } catch (e) {}
            entChannel = null;
        }
    }

    // ────────────────────────────────────────────────────────────────
    //  GAME LIFECYCLE
    // ────────────────────────────────────────────────────────────────
    function startGame(game, mode, opts) {
        opts = opts || {};
        stopAllSoloLoops();
        entGame     = game;
        entMode     = mode;
        entGameOver = false;
        _entApplyingOnline = false;

        showPanel('entGameArea');
        var oldToast = g('entRecordToast'); if (oldToast && oldToast.parentNode) oldToast.parentNode.removeChild(oldToast);
        var titleEl = g('entGameTitle');
        if (titleEl) titleEl.textContent = GAME_NAMES[game] || game;
        var statusEl = g('entGameStatus');
        if (statusEl) statusEl.textContent = '';

        var diff = opts.difficulty || 'easy';

        if      (game === 'c4')          { c4Init(diff);                  c4Render();          }
        else if (game === 'chess')       { chessInit(diff);               chessRender();       }
        else if (game === 'xiangqi')     { xqInit(diff);                  xqRender();          }
        else if (game === 'gomoku')      { gomokuInit(diff);               gomokuRender();      }
        else if (game === 'reversi')     { reversiInit(diff);              reversiRender();     }
        else if (game === '2048')        { init2048();                     render2048();        }
        else if (game === 'minesweeper') { initMinesweeper(diff);          renderMinesweeper(); }
        else if (game === 'snake')       { initSnake(diff); renderSnake(); startSnakeLoop();   }
        else if (game === 'sudoku')      { initSudoku(diff);               renderSudoku();      }
        else if (game === 'typing')      { initTyping(diff);              startTypingLoop();    }
        else if (game === 'ime')         { initIme(diff);                 startImeLoop();       }
        else if (game === 'mahjong')     { mjStart(opts);                                       }

        var restartBtn = g('entRestartBtn');
        var exitBtn    = g('entExitBtn');
        if (restartBtn) restartBtn.onclick = function () {
            stopAllSoloLoops();
            if (game === 'mahjong' && mode === 'online') {
                // host restarts a fresh deal; guests will receive new state
                if (MJ.isHost) { mjStart(opts); }
                return;
            }
            cleanupOnlineChannel();
            startGame(game, mode === 'online' ? 'local' : mode, opts);
        };
        if (exitBtn) exitBtn.onclick = exitGame;

        if (!SOLO_GAMES[game] && game !== 'mahjong') updateTurnStatus();
    }

    function exitGame() {
        stopAllSoloLoops();
        cleanupOnlineChannel();
        entGame = null; entMode = null; entMyColor = null;
        showPanel('entLobby');
    }

    // ────────────────────────────────────────────────────────────────
    //  SHARED STATUS
    // ────────────────────────────────────────────────────────────────
    function updateTurnStatus(customMsg) {
        var el = g('entGameStatus');
        if (!el) return;
        if (customMsg !== undefined) { el.textContent = customMsg; return; }
        if (entGameOver) return;
        var t = entTurn;
        var LBLS = {
            c4:      { 1: '🔴 Red',     2: '🟡 Yellow' },
            chess:   { w: '⬜ White',   b: '⬛ Black'  },
            xiangqi: { r: '🔴 Red',     b: '⚫ Black'  },
            gomoku:  { 1: '⚫ Black',   2: '⚪ White'  },
            reversi: { 1: '⬛ Black',   2: '⬜ White'  }
        };
        var lbl = (LBLS[entGame] && LBLS[entGame][t]) || String(t);
        var msg;
        if (entMode === 'online') {
            msg = (t === entMyColor) ? '✅ Your turn (' + lbl + ')' : '⌛ Opponent\'s turn…';
        } else if (entMode === 'ai') {
            var isHuman = (entGame==='c4'&&t===1) || (entGame==='chess'&&t==='w') ||
                          (entGame==='xiangqi'&&t==='r') || (entGame==='gomoku'&&t===1) ||
                          (entGame==='reversi'&&t===1);
            var curD = (entGame==='chess') ? chDifficulty : (entGame==='xiangqi') ? xqDifficulty :
                       (entGame==='c4') ? c4Difficulty : (entGame==='gomoku') ? gmDifficulty :
                       (entGame==='reversi') ? rvDifficulty : null;
            var diffTag = curD ? ' [' + curD.charAt(0).toUpperCase() + curD.slice(1) + ']' : '';
            var engTag = '';
            if (entGame === 'chess' && chUsingEngine) engTag = ' · 🧠 Stockfish';
            else if (entGame === 'xiangqi' && xqUsingEngine) engTag = ' · 🧠 Pikafish';
            msg = isHuman ? lbl + ' — your turn' + diffTag + engTag : lbl + ' — AI thinking…' + diffTag + engTag;
        } else {
            msg = lbl + '\'s turn';
        }
        el.textContent = msg;
    }

    function setGameOver(msg) {
        entGameOver = true;
        var el = g('entGameStatus');
        if (el) el.textContent = msg;
    }

    // ────────────────────────────────────────────────────────────────
    //  ONLINE MOVE RECEIVER
    // ────────────────────────────────────────────────────────────────
    function entHandleOnlineMoveReceived(msg) {
        if (!_onlineHandler) return;
        _entApplyingOnline = true;
        try { _onlineHandler(msg); } finally { _entApplyingOnline = false; }
    }

    // ════════════════════════════════════════════════════════════════
    //  ① CONNECT FOUR (Four in a Row)
    // ════════════════════════════════════════════════════════════════
    var C4R = 6, C4C = 7;
    var c4Board, c4Turn;

    var c4Difficulty = 'medium';

    function c4Init(diff) {
        if (diff) c4Difficulty = diff;
        c4Board = [];
        for (var r = 0; r < C4R; r++) c4Board.push(new Array(C4C).fill(0));
        c4Turn  = 1;
        entTurn = 1;
        _onlineHandler = function (msg) { c4ApplyDrop(msg.col); c4Render(); };
    }

    function c4Drop(col) {
        if (entGameOver) return;
        if (entMode === 'online' && c4Turn !== entMyColor) return;
        if (entMode === 'ai'     && c4Turn !== 1) return;
        c4ApplyDrop(col);
        c4Render();
        if (!entGameOver && entMode === 'ai' && c4Turn === 2) setTimeout(c4AiMove, 420);
    }

    function c4ApplyDrop(col) {
        var row = -1;
        for (var r = C4R - 1; r >= 0; r--) { if (c4Board[r][col] === 0) { row = r; break; } }
        if (row === -1) return;
        c4Board[row][col] = c4Turn;
        if (!_entApplyingOnline) sendOnline({ type: 'move', game: 'c4', col: col });
        var win = c4CheckWin();
        if (win) {
            setGameOver((c4Turn===1?'🔴 Red':'🟡 Yellow') + ' wins! 🎉');
            if (entMode==='ai' && c4Turn===1) {
                var dr=ENT_DIFF_RANK[c4Difficulty]||1;
                entRecordAndToast('c4', dr, 'Beat '+(ENT_DIFF_NAME[dr]||'AI'));
            }
            return;
        }
        if (c4Full()) { setGameOver("It's a draw! 🤝"); return; }
        c4Turn = c4Turn === 1 ? 2 : 1;
        entTurn = c4Turn;
        updateTurnStatus();
    }

    function c4Full() {
        for (var c = 0; c < C4C; c++) if (c4Board[0][c] === 0) return false;
        return true;
    }

    function c4CheckWin() {
        var D = [[0,1],[1,0],[1,1],[1,-1]];
        for (var r = 0; r < C4R; r++) for (var c = 0; c < C4C; c++) {
            var v = c4Board[r][c]; if (!v) continue;
            for (var d = 0; d < 4; d++) {
                var ok = true;
                for (var k = 1; k < 4; k++) {
                    var nr=r+D[d][0]*k, nc=c+D[d][1]*k;
                    if (nr<0||nr>=C4R||nc<0||nc>=C4C||c4Board[nr][nc]!==v){ok=false;break;}
                }
                if (ok) return [r, c, D[d][0], D[d][1]];
            }
        }
        return null;
    }

    // — AI: minimax with alpha-beta; search depth scales with difficulty —
    function c4AiMove() {
        if (entGameOver) return;
        var cols = c4ValidCols(c4Board);
        if (!cols.length) return;
        var col;
        if (c4Difficulty === 'easy') {
            col = cols[Math.floor(Math.random() * cols.length)];
        } else {
            var depth = c4Difficulty === 'master' ? 7 : c4Difficulty === 'difficult' ? 5 : 2;
            col = c4BestCol(c4Board, 2, depth);
        }
        // Call c4ApplyDrop directly — c4Drop has a human-turn guard that
        // would reject the AI (c4Turn === 2, not 1).
        c4ApplyDrop(col);
        c4Render();
    }

    function c4BestCol(board, aiP, depth) {
        var cols = c4ValidCols(board);
        var best = -Infinity, bestCol = cols[Math.floor(Math.random() * cols.length)];
        cols.forEach(function (col) {
            var b2 = board.map(function (r) { return r.slice(); });
            c4DropB(b2, col, aiP);
            var s = c4MM(b2, depth - 1, -Infinity, Infinity, false, aiP===1?2:1, aiP);
            if (s > best) { best = s; bestCol = col; }
        });
        return bestCol;
    }

    function c4MM(board, depth, alpha, beta, isMax, turn, aiP) {
        var win = c4WinB(board);
        if (win) return (board[win[0]][win[1]] === aiP) ? 1000+depth : -(1000+depth);
        var cols = c4ValidCols(board);
        if (!depth || !cols.length) return c4Eval(board, aiP);
        if (isMax) {
            var best = -Infinity;
            for (var i=0;i<cols.length;i++) {
                var b2=board.map(function(r){return r.slice();});
                c4DropB(b2,cols[i],turn);
                var s=c4MM(b2,depth-1,alpha,beta,false,turn===1?2:1,aiP);
                if(s>best)best=s; if(best>alpha)alpha=best; if(alpha>=beta)break;
            }
            return best;
        } else {
            var best = Infinity;
            for (var i=0;i<cols.length;i++) {
                var b2=board.map(function(r){return r.slice();});
                c4DropB(b2,cols[i],turn);
                var s=c4MM(b2,depth-1,alpha,beta,true,turn===1?2:1,aiP);
                if(s<best)best=s; if(best<beta)beta=best; if(alpha>=beta)break;
            }
            return best;
        }
    }

    function c4ValidCols(b) { var v=[]; for(var c=0;c<C4C;c++) if(!b[0][c])v.push(c); return v; }
    function c4DropB(b,col,p) { for(var r=C4R-1;r>=0;r--){if(!b[r][col]){b[r][col]=p;return;}} }
    function c4WinB(b) {
        var D=[[0,1],[1,0],[1,1],[1,-1]];
        for(var r=0;r<C4R;r++) for(var c=0;c<C4C;c++) {
            var v=b[r][c];if(!v)continue;
            for(var d=0;d<4;d++){var ok=true;
                for(var k=1;k<4;k++){var nr=r+D[d][0]*k,nc=c+D[d][1]*k;
                    if(nr<0||nr>=C4R||nc<0||nc>=C4C||b[nr][nc]!==v){ok=false;break;}}
                if(ok)return[r,c];}
        }
        return null;
    }
    function c4Eval(b,aiP) {
        var opp=aiP===1?2:1, score=0;
        for(var r=0;r<C4R;r++) if(b[r][3]===aiP)score+=3;
        var D=[[0,1],[1,0],[1,1],[1,-1]];
        for(var r=0;r<C4R;r++) for(var c=0;c<C4C;c++) for(var d=0;d<4;d++){
            var w=[],ok=true;
            for(var k=0;k<4;k++){var nr=r+D[d][0]*k,nc=c+D[d][1]*k;
                if(nr<0||nr>=C4R||nc<0||nc>=C4C){ok=false;break;}w.push(b[nr][nc]);}
            if(!ok)continue;
            var ai=0,em=0,op=0;
            w.forEach(function(v){if(v===aiP)ai++;else if(!v)em++;else op++;});
            if(!op){if(ai===3&&em===1)score+=5;else if(ai===2&&em===2)score+=2;}
            if(!ai&&op===3&&em===1)score-=4;
        }
        return score;
    }

    function c4Render() {
        var wrap = g('entBoardWrap'); if (!wrap) return;
        var canMove = function (col) {
            return !entGameOver && c4Board[0][col] === 0 &&
                   (entMode==='local' || (entMode==='ai'&&c4Turn===1) || (entMode==='online'&&c4Turn===entMyColor));
        };
        var html = '<div class="c4-container"><div class="c4-col-row">';
        for (var c = 0; c < C4C; c++) {
            var act = canMove(c);
            html += '<button class="c4-drop-btn' + (act?' c4-drop-btn--active':'') + '"' +
                    (act?'':' disabled') + ' data-col="' + c + '">▼</button>';
        }
        html += '</div><div class="c4-grid">';
        for (var r = 0; r < C4R; r++) for (var c = 0; c < C4C; c++) {
            var v = c4Board[r][c];
            html += '<div class="c4-cell' + (v===1?' c4-p1':v===2?' c4-p2':'') +
                    '" data-r="' + r + '" data-c="' + c + '"></div>';
        }
        html += '</div></div>';
        wrap.innerHTML = html;
        wrap.querySelectorAll('.c4-drop-btn').forEach(function (btn) {
            btn.addEventListener('click', function () { c4Drop(parseInt(btn.dataset.col)); });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  ② CHESS (International)
    // ════════════════════════════════════════════════════════════════
    var chBoard, chTurn, chSel, chMoves, chCastle, chEP;

    var CH_INIT = [
        ['bR','bN','bB','bQ','bK','bB','bN','bR'],
        ['bP','bP','bP','bP','bP','bP','bP','bP'],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['','','','','','','',''],
        ['wP','wP','wP','wP','wP','wP','wP','wP'],
        ['wR','wN','wB','wQ','wK','wB','wN','wR']
    ];
    var CH_SYM = { wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙',
                   bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟' };
    var CH_VAL = { P:1, N:3, B:3, R:5, Q:9, K:0 };
    var chDifficulty = 'medium';

    // ── Piece-square tables (white perspective; row 0 = rank 8) ──
    var CH_PST = {
        P:[  0,  0,  0,  0,  0,  0,  0,  0,
            50, 50, 50, 50, 50, 50, 50, 50,
            10, 10, 20, 30, 30, 20, 10, 10,
             5,  5, 10, 25, 25, 10,  5,  5,
             0,  0,  0, 20, 20,  0,  0,  0,
             5, -5,-10,  0,  0,-10, -5,  5,
             5, 10, 10,-20,-20, 10, 10,  5,
             0,  0,  0,  0,  0,  0,  0,  0],
        N:[-50,-40,-30,-30,-30,-30,-40,-50,
           -40,-20,  0,  0,  0,  0,-20,-40,
           -30,  0, 10, 15, 15, 10,  0,-30,
           -30,  5, 15, 20, 20, 15,  5,-30,
           -30,  0, 15, 20, 20, 15,  0,-30,
           -30,  5, 10, 15, 15, 10,  5,-30,
           -40,-20,  0,  5,  5,  0,-20,-40,
           -50,-40,-30,-30,-30,-30,-40,-50],
        B:[-20,-10,-10,-10,-10,-10,-10,-20,
           -10,  0,  0,  0,  0,  0,  0,-10,
           -10,  0,  5, 10, 10,  5,  0,-10,
           -10,  5,  5, 10, 10,  5,  5,-10,
           -10,  0, 10, 10, 10, 10,  0,-10,
           -10, 10, 10, 10, 10, 10, 10,-10,
           -10,  5,  0,  0,  0,  0,  5,-10,
           -20,-10,-10,-10,-10,-10,-10,-20],
        R:[  0,  0,  0,  0,  0,  0,  0,  0,
             5, 10, 10, 10, 10, 10, 10,  5,
            -5,  0,  0,  0,  0,  0,  0, -5,
            -5,  0,  0,  0,  0,  0,  0, -5,
            -5,  0,  0,  0,  0,  0,  0, -5,
            -5,  0,  0,  0,  0,  0,  0, -5,
            -5,  0,  0,  0,  0,  0,  0, -5,
             0,  0,  0,  5,  5,  0,  0,  0],
        Q:[-20,-10,-10, -5, -5,-10,-10,-20,
           -10,  0,  0,  0,  0,  0,  0,-10,
           -10,  0,  5,  5,  5,  5,  0,-10,
            -5,  0,  5,  5,  5,  5,  0, -5,
             0,  0,  5,  5,  5,  5,  0, -5,
           -10,  5,  5,  5,  5,  5,  0,-10,
           -10,  0,  5,  0,  0,  0,  0,-10,
           -20,-10,-10, -5, -5,-10,-10,-20],
        K:[-30,-40,-40,-50,-50,-40,-40,-30,
           -30,-40,-40,-50,-50,-40,-40,-30,
           -30,-40,-40,-50,-50,-40,-40,-30,
           -30,-40,-40,-50,-50,-40,-40,-30,
           -20,-30,-30,-40,-40,-30,-30,-20,
           -10,-20,-20,-20,-20,-20,-20,-10,
            20, 20,  0,  0,  0,  0, 20, 20,
            20, 30, 10,  0,  0, 10, 30, 20]
    };

    // ── search helpers ────────────────────────────────────────────
    function chEvalBoard(forColor) {
        var score = 0;
        for (var r=0;r<8;r++) for (var f=0;f<8;f++) {
            var p=chBoard[r][f]; if (!p) continue;
            var pst=CH_PST[p[1]];
            var pos=pst ? pst[(p[0]==='w'?r:7-r)*8+f]/100.0 : 0;
            score += (p[0]===forColor) ? (CH_VAL[p[1]]||0)+pos : -((CH_VAL[p[1]]||0)+pos);
        }
        return score;
    }

    function chSaveGs() {
        return {
            b: chBoard.map(function(r){return r.slice();}),
            cw:{K:chCastle.w.K,Q:chCastle.w.Q}, cb:{K:chCastle.b.K,Q:chCastle.b.Q},
            e:chEP, t:chTurn, go:entGameOver
        };
    }
    function chRestoreGs(s) {
        chBoard=s.b; chEP=s.e; chTurn=s.t; entTurn=s.t; entGameOver=s.go;
        chCastle.w.K=s.cw.K; chCastle.w.Q=s.cw.Q;
        chCastle.b.K=s.cb.K; chCastle.b.Q=s.cb.Q;
    }

    function chAllLegal(color) {
        var all=[];
        for (var r=0;r<8;r++) for (var f=0;f<8;f++)
            if (chBoard[r][f]&&chBoard[r][f][0]===color)
                chGetLegal(r,f).forEach(function(m){all.push({fr:r,ff:f,tr:m[0],tf:m[1]});});
        return all;
    }
    function chSortLegal(moves) {
        return moves.sort(function(a,b){
            return (CH_VAL[chBoard[b.tr][b.tf]&&chBoard[b.tr][b.tf][1]]||0) -
                   (CH_VAL[chBoard[a.tr][a.tf]&&chBoard[a.tr][a.tf][1]]||0);
        });
    }

    function chAB(depth, alpha, beta, forColor) {
        if (depth===0) return chEvalBoard(forColor);
        var moves=chAllLegal(chTurn);
        if (!moves.length) return chIsInCheck(chTurn,chBoard) ? (chTurn===forColor?-99:99) : 0;
        moves=chSortLegal(moves);
        var maximizing=(chTurn===forColor), best=maximizing?-Infinity:Infinity;
        for (var i=0;i<moves.length;i++){
            var m=moves[i], s=chSaveGs();
            _entApplyingOnline=true; chApplyMove(m.fr,m.ff,m.tr,m.tf,null); _entApplyingOnline=false;
            var sc=chAB(depth-1,alpha,beta,forColor);
            chRestoreGs(s);
            if (maximizing){if(sc>best)best=sc;if(sc>alpha)alpha=sc;}
            else            {if(sc<best)best=sc;if(sc<beta)beta=sc;}
            if (alpha>=beta) break;
        }
        return best;
    }

    function chessInit(diff) {
        if (diff) chDifficulty = diff;
        chUsingEngine = false;
        chBoard  = CH_INIT.map(function (r) { return r.slice(); });
        chTurn   = 'w';  chSel = null;  chMoves = [];
        chCastle = { w:{K:true,Q:true}, b:{K:true,Q:true} };
        chEP     = null;
        entTurn  = 'w';
        _onlineHandler = function (msg) {
            var m = msg.move; if (!m) return;
            chApplyMove(m.fr, m.ff, m.tr, m.tf, m.promo);
            chessRender();
        };
    }

    function chessClick(r, f) {
        if (entGameOver) return;
        if (entMode==='online' && chTurn !== entMyColor) return;
        if (entMode==='ai'     && chTurn !== 'w') return;
        if (chSel) {
            if (chMoves.some(function(m){return m[0]===r&&m[1]===f;})) {
                chApplyMove(chSel[0],chSel[1],r,f,null);
                chSel=null; chMoves=[];
                chessRender();
                if (!entGameOver && entMode==='ai') setTimeout(chessAiMove, 480);
                return;
            }
            if (chBoard[r][f] && chBoard[r][f][0]===chTurn) {
                chSel=[r,f]; chMoves=chGetLegal(r,f); chessRender(); return;
            }
            chSel=null; chMoves=[]; chessRender(); return;
        }
        if (chBoard[r][f] && chBoard[r][f][0]===chTurn) {
            chSel=[r,f]; chMoves=chGetLegal(r,f); chessRender();
        }
    }

    function chApplyMove(fr,ff,tr,tf,promo) {
        var piece=chBoard[fr][ff]; if(!piece) return;
        // en passant capture
        if(piece[1]==='P'&&tf!==ff&&!chBoard[tr][tf]) chBoard[fr][tf]='';
        // castling
        if(piece[1]==='K'&&Math.abs(tf-ff)===2){
            var hr=fr;
            if(tf===6){chBoard[hr][5]=chBoard[hr][7];chBoard[hr][7]='';}
            else      {chBoard[hr][3]=chBoard[hr][0];chBoard[hr][0]='';}
        }
        // castling rights
        if(piece==='wK'){chCastle.w.K=false;chCastle.w.Q=false;}
        if(piece==='bK'){chCastle.b.K=false;chCastle.b.Q=false;}
        if(fr===7&&ff===0)chCastle.w.Q=false; if(fr===7&&ff===7)chCastle.w.K=false;
        if(fr===0&&ff===0)chCastle.b.Q=false; if(fr===0&&ff===7)chCastle.b.K=false;
        // en-passant target
        chEP=(piece[1]==='P'&&Math.abs(tr-fr)===2)?[(fr+tr)/2,tf]:null;
        // move
        chBoard[tr][tf]=piece; chBoard[fr][ff]='';
        // promotion
        if(piece==='wP'&&tr===0) chBoard[tr][tf]=promo||'wQ';
        if(piece==='bP'&&tr===7) chBoard[tr][tf]=promo||'bQ';

        if(!_entApplyingOnline) sendOnline({type:'move',game:'chess',move:{fr:fr,ff:ff,tr:tr,tf:tf,promo:promo}});

        chTurn=chTurn==='w'?'b':'w'; entTurn=chTurn;

        var inCheck=chIsInCheck(chTurn,chBoard), hasLegal=chHasAnyLegal(chTurn);
        if(!hasLegal){
            if(inCheck){
                setGameOver('Checkmate! '+(chTurn==='w'?'⬛ Black':'⬜ White')+' wins! 🎉');
                if(entMode==='ai'&&chTurn==='b'){var dr=ENT_DIFF_RANK[chDifficulty]||1;entRecordAndToast('chess',dr,'Beat '+(ENT_DIFF_NAME[dr]||'AI'));}
            }
            else        setGameOver('Stalemate — draw! 🤝');
        } else {
            updateTurnStatus(inCheck?((chTurn==='w'?'⬜ White':'⬛ Black')+' is in Check!'):undefined);
        }
    }

    function chGetLegal(r,f){
        var p=chBoard[r][f]; if(!p) return [];
        return chPseudo(r,f,p,chBoard,chCastle,chEP).filter(function(m){
            return !chExposes(r,f,m[0],m[1],p);
        });
    }

    function chExposes(fr,ff,tr,tf,piece){
        var b2=chBoard.map(function(r){return r.slice();});
        if(piece[1]==='P'&&tf!==ff&&!b2[tr][tf]) b2[fr][tf]='';
        b2[tr][tf]=piece; b2[fr][ff]='';
        return chIsInCheck(piece[0],b2);
    }

    function chIsInCheck(color,board){
        var kr=-1,kf=-1;
        for(var r=0;r<8;r++) for(var f=0;f<8;f++) if(board[r][f]===color+'K'){kr=r;kf=f;}
        if(kr===-1) return true;
        var opp=color==='w'?'b':'w';
        var nc={w:{K:false,Q:false},b:{K:false,Q:false}};
        for(var r=0;r<8;r++) for(var f=0;f<8;f++){
            var p=board[r][f]; if(!p||p[0]!==opp) continue;
            if(chPseudo(r,f,p,board,nc,null).some(function(m){return m[0]===kr&&m[1]===kf;})) return true;
        }
        return false;
    }

    function chHasAnyLegal(color){
        for(var r=0;r<8;r++) for(var f=0;f<8;f++)
            if(chBoard[r][f]&&chBoard[r][f][0]===color&&chGetLegal(r,f).length) return true;
        return false;
    }

    function chPseudo(rank,file,piece,board,castle,ep){
        var color=piece[0],type=piece[1],opp=color==='w'?'b':'w',moves=[];
        function addIf(r,f){
            if(r<0||r>=8||f<0||f>=8)return false;
            var t=board[r][f]; if(t&&t[0]===color)return false;
            moves.push([r,f]); return !t;
        }
        function slide(dirs){dirs.forEach(function(d){for(var i=1;i<8;i++)if(!addIf(rank+d[0]*i,file+d[1]*i))break;});}
        if(type==='P'){
            var dir=color==='w'?-1:1,sr=color==='w'?6:1,r1=rank+dir;
            if(r1>=0&&r1<8&&!board[r1][file]){
                moves.push([r1,file]);
                var r2=rank+dir*2;
                if(rank===sr&&r2>=0&&r2<8&&!board[r2][file]) moves.push([r2,file]);
            }
            [-1,1].forEach(function(df){
                var nr=rank+dir,nf=file+df;
                if(nr>=0&&nr<8&&nf>=0&&nf<8){
                    if(board[nr][nf]&&board[nr][nf][0]===opp)moves.push([nr,nf]);
                    if(ep&&ep[0]===nr&&ep[1]===nf)moves.push([nr,nf]);
                }
            });
        } else if(type==='N'){
            [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]].forEach(function(d){addIf(rank+d[0],file+d[1]);});
        } else if(type==='B'){slide([[-1,-1],[-1,1],[1,-1],[1,1]]);}
        else if(type==='R'){slide([[-1,0],[1,0],[0,-1],[0,1]]);}
        else if(type==='Q'){slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);}
        else if(type==='K'){
            [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].forEach(function(d){addIf(rank+d[0],file+d[1]);});
            var hr=color==='w'?7:0;
            if(rank===hr&&file===4){
                if(castle[color].K&&!board[hr][5]&&!board[hr][6])moves.push([hr,6]);
                if(castle[color].Q&&!board[hr][1]&&!board[hr][2]&&!board[hr][3])moves.push([hr,2]);
            }
        }
        return moves;
    }

    // ── real-engine (Stockfish) bridge ────────────────────────────
    var chUsingEngine = false;
    function chToFen(){
        var rows=[];
        for(var r=0;r<8;r++){
            var s='',empty=0;
            for(var f=0;f<8;f++){
                var p=chBoard[r][f];
                if(!p){empty++;continue;}
                if(empty){s+=empty;empty=0;}
                var L=p[1]; s+=(p[0]==='w')?L.toUpperCase():L.toLowerCase();
            }
            if(empty)s+=empty;
            rows.push(s);
        }
        var cast=''; if(chCastle.w.K)cast+='K'; if(chCastle.w.Q)cast+='Q';
        if(chCastle.b.K)cast+='k'; if(chCastle.b.Q)cast+='q'; if(!cast)cast='-';
        var ep='-'; if(chEP) ep=String.fromCharCode(97+chEP[1])+(8-chEP[0]);
        return rows.join('/')+' '+chTurn+' '+cast+' '+ep+' 0 1';
    }
    function chParseUci(u){
        if(!u||u.length<4) return null;
        var ff=u.charCodeAt(0)-97, fr=8-parseInt(u[1],10);
        var tf=u.charCodeAt(2)-97, tr=8-parseInt(u[3],10);
        if(fr<0||fr>7||tr<0||tr>7||ff<0||ff>7||tf<0||tf>7) return null;
        var promo=null;
        if(u[4]){ promo=chTurn+u[4].toUpperCase(); }
        return {fr:fr,ff:ff,tr:tr,tf:tf,promo:promo};
    }
    function chEngineOpts(){
        if(chDifficulty==='master')    return {skill:20, movetime:1100};
        if(chDifficulty==='difficult') return {skill:12, movetime:650};
        return {skill:3, movetime:300};   // medium
    }

    function chessAiMove(){
        if(entGameOver) return;
        var moves=chAllLegal(chTurn); if(!moves.length) return;
        // Try the real engine (Stockfish) for medium+; fall back to built-in AI.
        if(chDifficulty!=='easy' && window.GameEngine){
            GameEngine.bestMove('chess', chToFen(), chEngineOpts()).then(function(uci){
                if(entGameOver||entGame!=='chess'||chTurn!=='b') return;
                var mv=chParseUci(uci);
                if(mv){ chUsingEngine=true; chApplyMove(mv.fr,mv.ff,mv.tr,mv.tf,mv.promo); chessRender(); }
                else { chessAiMoveLocal(moves); }
            }).catch(function(){
                if(!entGameOver&&entGame==='chess'&&chTurn==='b') chessAiMoveLocal(moves);
            });
            return;
        }
        chessAiMoveLocal(moves);
    }

    function chessAiMoveLocal(moves){
        if(entGameOver) return;
        chUsingEngine=false;
        var best, depth;
        if (chDifficulty==='easy') {
            // purely random — any legal move
            best=moves[Math.floor(Math.random()*moves.length)];
        } else {
            depth = chDifficulty==='master' ? 4 : chDifficulty==='difficult' ? 3 : 1;
            var aiColor=chTurn, bestScore=-Infinity;
            chSortLegal(moves);
            for(var i=0;i<moves.length;i++){
                var m=moves[i], s=chSaveGs();
                _entApplyingOnline=true; chApplyMove(m.fr,m.ff,m.tr,m.tf,null); _entApplyingOnline=false;
                var sc=chAB(depth-1,-Infinity,Infinity,aiColor);
                chRestoreGs(s);
                sc += Math.random()*0.002; // tiny jitter avoids repetition
                if(sc>bestScore){bestScore=sc;best=m;}
            }
        }
        if(best){ chApplyMove(best.fr,best.ff,best.tr,best.tf,null); chessRender(); }
    }

    function chessRender(){
        var wrap=g('entBoardWrap'); if(!wrap) return;
        var html='<div class="ch-outer">';
        // Rank labels left
        html+='<div class="ch-rank-labels">';
        for(var r=8;r>=1;r--) html+='<span>'+r+'</span>';
        html+='</div>';
        html+='<div class="ch-board-col"><table class="ch-board" id="chBoard">';
        for(var r=0;r<8;r++){
            html+='<tr>';
            for(var f=0;f<8;f++){
                var dark=(r+f)%2===1;
                var cls='ch-cell '+(dark?'ch-dark':'ch-light');
                if(chSel&&chSel[0]===r&&chSel[1]===f) cls+=' ch-sel';
                if(chMoves.some(function(m){return m[0]===r&&m[1]===f;})) cls+=' ch-legal';
                var p=chBoard[r][f];
                html+='<td class="'+cls+'" data-r="'+r+'" data-f="'+f+'">';
                if(p) html+='<span class="ch-piece ch-piece-'+p[0]+'">'+(CH_SYM[p]||p)+'</span>';
                html+='</td>';
            }
            html+='</tr>';
        }
        html+='</table>';
        // File labels
        html+='<div class="ch-file-labels">';
        'abcdefgh'.split('').forEach(function(c){html+='<span>'+c+'</span>';});
        html+='</div></div></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.ch-cell').forEach(function(td){
            td.addEventListener('click',function(){
                chessClick(parseInt(td.dataset.r),parseInt(td.dataset.f));
            });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  ③ XIANGQI (Chinese Chess 象棋)
    // ════════════════════════════════════════════════════════════════
    var XQ_R=10, XQ_C=9;
    var xqBoard, xqTurn, xqSel, xqMoves;

    var XQ_INIT=[
        ['bR','bH','bE','bA','bK','bA','bE','bH','bR'],
        ['','','','','','','','',''],
        ['','bC','','','','','','bC',''],
        ['bS','','bS','','bS','','bS','','bS'],
        ['','','','','','','','',''],
        ['','','','','','','','',''],
        ['rS','','rS','','rS','','rS','','rS'],
        ['','rC','','','','','','rC',''],
        ['','','','','','','','',''],
        ['rR','rH','rE','rA','rK','rA','rE','rH','rR']
    ];
    var XQ_CH={
        rK:'帅',rA:'仕',rE:'相',rH:'傌',rR:'俥',rC:'炮',rS:'兵',
        bK:'将',bA:'士',bE:'象',bH:'马',bR:'車',bC:'砲',bS:'卒'
    };

    var xqDifficulty='medium';

    function xqInit(diff){
        if(diff) xqDifficulty=diff;
        xqUsingEngine=false;
        xqBoard=XQ_INIT.map(function(r){return r.slice();});
        xqTurn='r'; xqSel=null; xqMoves=[];
        entTurn='r';
        _onlineHandler=function(msg){xqApplyMove(msg.fr,msg.fc,msg.tr,msg.tc);xqRender();};
    }

    function xqClick(r,c){
        if(entGameOver) return;
        if(entMode==='online'&&xqTurn!==entMyColor) return;
        if(entMode==='ai'    &&xqTurn!=='r') return;
        var p=xqBoard[r][c];
        if(xqSel){
            if(xqMoves.some(function(m){return m[0]===r&&m[1]===c;})){
                xqApplyMove(xqSel[0],xqSel[1],r,c); xqSel=null; xqMoves=[]; xqRender();
                if(!entGameOver&&entMode==='ai') setTimeout(xqAiMove,500);
                return;
            }
            if(p&&p[0]===xqTurn){xqSel=[r,c];xqMoves=xqGetLegal(r,c);xqRender();return;}
            xqSel=null;xqMoves=[];xqRender();return;
        }
        if(p&&p[0]===xqTurn){xqSel=[r,c];xqMoves=xqGetLegal(r,c);xqRender();}
    }

    function xqApplyMove(fr,fc,tr,tc){
        var piece=xqBoard[fr][fc], cap=xqBoard[tr][tc];
        xqBoard[tr][tc]=piece; xqBoard[fr][fc]='';
        if(!_entApplyingOnline) sendOnline({type:'move',game:'xiangqi',fr:fr,fc:fc,tr:tr,tc:tc});
        xqTurn=xqTurn==='r'?'b':'r'; entTurn=xqTurn;
        if(cap&&cap[1]==='K'){
            setGameOver((piece[0]==='r'?'🔴 Red':'⚫ Black')+' wins! 🎉');
            if(entMode==='ai'&&piece[0]==='r'){var dr=ENT_DIFF_RANK[xqDifficulty]||1;entRecordAndToast('xiangqi',dr,'Beat '+(ENT_DIFF_NAME[dr]||'AI'));}
        }
        else if(!xqHasAnyLegal(xqTurn)){setGameOver((xqTurn==='r'?'⚫ Black':'🔴 Red')+' wins! 🎉');}
        else updateTurnStatus();
    }

    function xqGetLegal(r,c){
        var p=xqBoard[r][c]; if(!p) return [];
        return xqPseudo(r,c,p,xqBoard).filter(function(m){
            var b2=xqBoard.map(function(row){return row.slice();});
            b2[m[0]][m[1]]=p; b2[r][c]='';
            return !xqInCheck(p[0],b2);
        });
    }

    function xqInCheck(color,board){
        var kr=-1,kc=-1;
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++) if(board[r][c]===color+'K'){kr=r;kc=c;}
        if(kr===-1) return true;
        var opp=color==='r'?'b':'r';
        // Face-to-face generals
        var okr=-1,okc=-1;
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++) if(board[r][c]===opp+'K'){okr=r;okc=c;}
        if(okr!==-1&&okc===kc){
            var blocked=false;
            for(var r2=Math.min(kr,okr)+1;r2<Math.max(kr,okr);r2++) if(board[r2][kc]){blocked=true;break;}
            if(!blocked) return true;
        }
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++){
            var p=board[r][c]; if(!p||p[0]!==opp) continue;
            if(xqPseudo(r,c,p,board).some(function(m){return m[0]===kr&&m[1]===kc;})) return true;
        }
        return false;
    }

    function xqHasAnyLegal(color){
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++)
            if(xqBoard[r][c]&&xqBoard[r][c][0]===color&&xqGetLegal(r,c).length) return true;
        return false;
    }

    function xqPseudo(row,col,piece,board){
        var color=piece[0],type=piece[1],opp=color==='r'?'b':'r',moves=[];
        function add(r,c){
            if(r<0||r>=XQ_R||c<0||c>=XQ_C)return;
            var t=board[r][c]; if(t&&t[0]===color)return;
            moves.push([r,c]);
        }
        switch(type){
            case 'K':{
                var p=color==='r'?{r0:7,r1:9,c0:3,c1:5}:{r0:0,r1:2,c0:3,c1:5};
                [[0,1],[0,-1],[1,0],[-1,0]].forEach(function(d){
                    var nr=row+d[0],nc=col+d[1];
                    if(nr>=p.r0&&nr<=p.r1&&nc>=p.c0&&nc<=p.c1)add(nr,nc);
                });
                break;
            }
            case 'A':{
                var p=color==='r'?{r0:7,r1:9,c0:3,c1:5}:{r0:0,r1:2,c0:3,c1:5};
                [[1,1],[1,-1],[-1,1],[-1,-1]].forEach(function(d){
                    var nr=row+d[0],nc=col+d[1];
                    if(nr>=p.r0&&nr<=p.r1&&nc>=p.c0&&nc<=p.c1)add(nr,nc);
                });
                break;
            }
            case 'E':{
                [[2,2],[2,-2],[-2,2],[-2,-2]].forEach(function(d){
                    var nr=row+d[0],nc=col+d[1];
                    if(nr<0||nr>=XQ_R||nc<0||nc>=XQ_C)return;
                    if(color==='r'&&nr<5)return; if(color==='b'&&nr>4)return;
                    if(!board[row+d[0]/2][col+d[1]/2])add(nr,nc);
                });
                break;
            }
            case 'H':{
                var HMOVES=[
                    [[-1,0],[-2,-1]],[[-1,0],[-2,1]],
                    [[1,0],[2,-1]], [[1,0],[2,1]],
                    [[0,-1],[-1,-2]],[[0,-1],[1,-2]],
                    [[0,1],[-1,2]], [[0,1],[1,2]]
                ];
                HMOVES.forEach(function(path){
                    var br=row+path[0][0],bc=col+path[0][1];
                    var nr=row+path[1][0],nc=col+path[1][1];
                    if(br<0||br>=XQ_R||bc<0||bc>=XQ_C)return;
                    if(nr<0||nr>=XQ_R||nc<0||nc>=XQ_C)return;
                    if(!board[br][bc])add(nr,nc);
                });
                break;
            }
            case 'R':{
                [[0,1],[0,-1],[1,0],[-1,0]].forEach(function(d){
                    for(var i=1;;i++){
                        var nr=row+d[0]*i,nc=col+d[1]*i;
                        if(nr<0||nr>=XQ_R||nc<0||nc>=XQ_C)break;
                        var t=board[nr][nc];
                        if(!t)moves.push([nr,nc]);
                        else{if(t[0]===opp)moves.push([nr,nc]);break;}
                    }
                });
                break;
            }
            case 'C':{
                [[0,1],[0,-1],[1,0],[-1,0]].forEach(function(d){
                    var jumped=false;
                    for(var i=1;;i++){
                        var nr=row+d[0]*i,nc=col+d[1]*i;
                        if(nr<0||nr>=XQ_R||nc<0||nc>=XQ_C)break;
                        var t=board[nr][nc];
                        if(!jumped){if(!t)moves.push([nr,nc]);else jumped=true;}
                        else{if(!t)continue;if(t[0]===opp)moves.push([nr,nc]);break;}
                    }
                });
                break;
            }
            case 'S':{
                var fwd=color==='r'?-1:1;
                var crossed=color==='r'?(row<=4):(row>=5);
                add(row+fwd,col);
                if(crossed){add(row,col-1);add(row,col+1);}
                break;
            }
        }
        return moves;
    }

    var XQ_VAL={K:10000,A:20,E:20,H:45,R:90,C:50,S:10};

    // generate all legal moves for a colour on a given board
    function xqGenAll(board,color){
        var all=[];
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++){
            var p=board[r][c]; if(!p||p[0]!==color) continue;
            xqPseudo(r,c,p,board).forEach(function(m){
                var b2=board.map(function(row){return row.slice();});
                b2[m[0]][m[1]]=p; b2[r][c]='';
                if(!xqInCheck(color,b2)) all.push({fr:r,fc:c,tr:m[0],tc:m[1]});
            });
        }
        return all;
    }

    function xqKingMissing(board){
        var rk=false,bk=false;
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++){
            if(board[r][c]==='rK')rk=true; else if(board[r][c]==='bK')bk=true;
        }
        if(!rk) return 'r'; if(!bk) return 'b'; return null;
    }

    function xqEval(board,forColor){
        var s=0;
        for(var r=0;r<XQ_R;r++) for(var c=0;c<XQ_C;c++){
            var p=board[r][c]; if(!p) continue;
            var v=XQ_VAL[p[1]]||0;
            // small bonus: advanced soldiers, central rooks/cannons
            if(p[1]==='S'){ v += (p[0]==='r' ? (9-r) : r) * 1.5; }
            if(p[1]==='R'||p[1]==='C'){ v += (4-Math.abs(c-4)); }
            s += (p[0]===forColor) ? v : -v;
        }
        return s;
    }

    function xqAB(board,turn,depth,alpha,beta,forColor){
        var km=xqKingMissing(board);
        if(km){ return (km===forColor) ? -100000-depth : 100000+depth; }
        if(depth===0) return xqEval(board,forColor);
        var moves=xqGenAll(board,turn);
        if(!moves.length) return (turn===forColor) ? -100000-depth : 100000+depth;
        // capture-first ordering for better pruning
        moves.sort(function(a,b){
            return (XQ_VAL[(board[b.tr][b.tc]||' ')[1]]||0) - (XQ_VAL[(board[a.tr][a.tc]||' ')[1]]||0);
        });
        var opp=turn==='r'?'b':'r', maximizing=(turn===forColor);
        var best=maximizing?-Infinity:Infinity;
        for(var i=0;i<moves.length;i++){
            var m=moves[i];
            var b2=board.map(function(row){return row.slice();});
            b2[m.tr][m.tc]=b2[m.fr][m.fc]; b2[m.fr][m.fc]='';
            var sc=xqAB(b2,opp,depth-1,alpha,beta,forColor);
            if(maximizing){ if(sc>best)best=sc; if(best>alpha)alpha=best; }
            else          { if(sc<best)best=sc; if(best<beta)beta=best; }
            if(alpha>=beta) break;
        }
        return best;
    }

    // ── real-engine (Pikafish) bridge ─────────────────────────────
    var xqUsingEngine = false;
    var XQ_FEN_LETTER = { K:'K', A:'A', E:'B', H:'N', R:'R', C:'C', S:'P' };
    function xqToFen(){
        var rows=[];
        for(var r=0;r<XQ_R;r++){
            var s='',empty=0;
            for(var c=0;c<XQ_C;c++){
                var p=xqBoard[r][c];
                if(!p){empty++;continue;}
                if(empty){s+=empty;empty=0;}
                var L=XQ_FEN_LETTER[p[1]]||'P';
                s+=(p[0]==='r')?L.toUpperCase():L.toLowerCase();
            }
            if(empty)s+=empty;
            rows.push(s);
        }
        var side=(xqTurn==='r')?'w':'b';
        return rows.join('/')+' '+side+' - - 0 1';
    }
    function xqParseUci(u){
        if(!u||u.length<4) return null;
        var fc=u.charCodeAt(0)-97, fr=9-parseInt(u[1],10);
        var tc=u.charCodeAt(2)-97, tr=9-parseInt(u[3],10);
        if(fr<0||fr>9||tr<0||tr>9||fc<0||fc>8||tc<0||tc>8) return null;
        return {fr:fr,fc:fc,tr:tr,tc:tc};
    }
    function xqEngineOpts(){
        if(xqDifficulty==='master')    return {skill:20, movetime:1100};
        if(xqDifficulty==='difficult') return {skill:12, movetime:650};
        return {skill:3, movetime:300};   // medium
    }

    function xqAiMove(){
        if(entGameOver) return;
        var moves=xqGenAll(xqBoard,xqTurn);
        if(!moves.length) return;
        // Try the real engine (Pikafish) for medium+; fall back to built-in AI.
        if(xqDifficulty!=='easy' && window.GameEngine){
            GameEngine.bestMove('xiangqi', xqToFen(), xqEngineOpts()).then(function(uci){
                if(entGameOver||entGame!=='xiangqi'||xqTurn!=='b') return;
                var mv=xqParseUci(uci);
                if(mv){ xqUsingEngine=true; xqApplyMove(mv.fr,mv.fc,mv.tr,mv.tc); xqRender(); }
                else { xqAiMoveLocal(moves); }
            }).catch(function(){
                if(!entGameOver&&entGame==='xiangqi'&&xqTurn==='b') xqAiMoveLocal(moves);
            });
            return;
        }
        xqAiMoveLocal(moves);
    }

    function xqAiMoveLocal(moves){
        if(entGameOver) return;
        xqUsingEngine=false;
        var best;

        if(xqDifficulty==='easy'){
            best=moves[Math.floor(Math.random()*moves.length)];
        } else {
            var depth = xqDifficulty==='master' ? 4 : xqDifficulty==='difficult' ? 3 : 1;
            var forColor=xqTurn, opp=xqTurn==='r'?'b':'r', bestScore=-Infinity;
            moves.sort(function(a,b){
                return (XQ_VAL[(xqBoard[b.tr][b.tc]||' ')[1]]||0) - (XQ_VAL[(xqBoard[a.tr][a.tc]||' ')[1]]||0);
            });
            for(var i=0;i<moves.length;i++){
                var m=moves[i];
                var b2=xqBoard.map(function(row){return row.slice();});
                b2[m.tr][m.tc]=b2[m.fr][m.fc]; b2[m.fr][m.fc]='';
                var sc=xqAB(b2,opp,depth-1,-Infinity,Infinity,forColor)+Math.random()*0.01;
                if(sc>bestScore){bestScore=sc;best=m;}
            }
        }
        xqApplyMove(best.fr,best.fc,best.tr,best.tc);
        xqRender();
    }

    function xqRender(){
        var wrap=g('entBoardWrap'); if(!wrap) return;
        var html='<div class="xq-outer"><table class="xq-board" id="xqBoard">';
        for(var r=0;r<XQ_R;r++){
            if(r===5) html+='<tr class="xq-river-row"><td colspan="9" class="xq-river-cell">楚 河 &nbsp;&nbsp;&nbsp;&nbsp; 漢 界</td></tr>';
            html+='<tr>';
            for(var c=0;c<XQ_C;c++){
                var p=xqBoard[r][c];
                var cls='xq-cell';
                if(xqSel&&xqSel[0]===r&&xqSel[1]===c) cls+=' xq-sel';
                if(xqMoves&&xqMoves.some(function(m){return m[0]===r&&m[1]===c;})) cls+=' xq-legal';
                var lbl=p?(XQ_CH[p]||p[1]):'';
                html+='<td class="'+cls+'" data-r="'+r+'" data-c="'+c+'">';
                if(lbl) html+='<span class="xq-piece xq-piece-'+p[0]+'">'+lbl+'</span>';
                html+='</td>';
            }
            html+='</tr>';
        }
        html+='</table></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.xq-cell').forEach(function(td){
            td.addEventListener('click',function(){
                xqClick(parseInt(td.dataset.r),parseInt(td.dataset.c));
            });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  ④ GOMOKU (Five in a Row 五子棋)
    // ════════════════════════════════════════════════════════════════
    var GM=15;
    var gmBoard, gmTurn;

    var gmDifficulty='medium';

    function gomokuInit(diff){
        if(diff) gmDifficulty=diff;
        gmBoard=[];
        for(var i=0;i<GM;i++) gmBoard.push(new Array(GM).fill(0));
        gmTurn=1; entTurn=1;
        _onlineHandler=function(msg){
            if(gmBoard[msg.r][msg.c]) return;
            gmApply(msg.r,msg.c);
            gomokuRender();
        };
    }

    function gmClick(r,c){
        if(entGameOver) return;
        if(entMode==='online'&&gmTurn!==entMyColor) return;
        if(entMode==='ai'    &&gmTurn!==1) return;
        gmApply(r,c);
        gomokuRender();
        if(!entGameOver&&entMode==='ai'&&gmTurn===2) setTimeout(gmAiMove,320);
    }

    function gmApply(r,c){
        if(gmBoard[r][c]) return;
        gmBoard[r][c]=gmTurn;
        if(!_entApplyingOnline) sendOnline({type:'move',game:'gomoku',r:r,c:c});
        if(gmWin(r,c,gmTurn)){
            setGameOver((gmTurn===1?'⚫ Black':'⚪ White')+' wins! 🎉');
            if(entMode==='ai'&&gmTurn===1){var dr=ENT_DIFF_RANK[gmDifficulty]||1;entRecordAndToast('gomoku',dr,'Beat '+(ENT_DIFF_NAME[dr]||'AI'));}
            return;
        }
        gmTurn=gmTurn===1?2:1; entTurn=gmTurn;
        updateTurnStatus();
    }

    function gmWin(r,c,p){
        var D=[[0,1],[1,0],[1,1],[1,-1]];
        for(var d=0;d<4;d++){
            var cnt=1;
            for(var s=1;s>=-1;s-=2) for(var i=1;i<=4;i++){
                var nr=r+D[d][0]*i*s,nc=c+D[d][1]*i*s;
                if(nr<0||nr>=GM||nc<0||nc>=GM||gmBoard[nr][nc]!==p) break;
                cnt++;
            }
            if(cnt>=5) return true;
        }
        return false;
    }

    function gmScore(r,c,p){
        var D=[[0,1],[1,0],[1,1],[1,-1]],score=0;
        D.forEach(function(d){
            var cnt=1,open=0;
            for(var s=1;s>=-1;s-=2){
                for(var i=1;i<=4;i++){
                    var nr=r+d[0]*i*s,nc=c+d[1]*i*s;
                    if(nr<0||nr>=GM||nc<0||nc>=GM){break;}
                    if(gmBoard[nr][nc]===p)cnt++;
                    else{if(!gmBoard[nr][nc])open++;break;}
                }
            }
            if(cnt>=5)score+=100000;
            else if(cnt===4&&open>=1)score+=10000;
            else if(cnt===3&&open>=2)score+=1000;
            else if(cnt===2&&open>=2)score+=100;
        });
        return score;
    }

    function gmCandidates(){
        var cands=[];
        for(var r=0;r<GM;r++) for(var c=0;c<GM;c++){
            if(gmBoard[r][c]) continue;
            var nb=false;
            outer: for(var dr=-2;dr<=2;dr++) for(var dc=-2;dc<=2;dc++){
                if(!dr&&!dc) continue;
                var nr=r+dr,nc=c+dc;
                if(nr>=0&&nr<GM&&nc>=0&&nc<GM&&gmBoard[nr][nc]){nb=true;break outer;}
            }
            if(nb) cands.push([r,c]);
        }
        return cands;
    }

    function gmAiMove(){
        if(entGameOver) return;
        var aiP=2,humP=1;
        var cands=gmCandidates();
        if(!cands.length){gmApply(Math.floor(GM/2),Math.floor(GM/2));return;}

        var bR=-1,bC=-1,best=-Infinity;

        if(gmDifficulty==='easy'){
            var p=cands[Math.floor(Math.random()*cands.length)]; bR=p[0]; bC=p[1];
        } else if(gmDifficulty==='medium'){
            cands.forEach(function(pos){
                var s=gmScore(pos[0],pos[1],aiP)*1.0+gmScore(pos[0],pos[1],humP)*0.8+Math.random()*5;
                if(s>best){best=s;bR=pos[0];bC=pos[1];}
            });
        } else if(gmDifficulty==='difficult'){
            cands.forEach(function(pos){
                var s=gmScore(pos[0],pos[1],aiP)*1.05+gmScore(pos[0],pos[1],humP)*1.3;
                if(s>best){best=s;bR=pos[0];bC=pos[1];}
            });
        } else { // master — 2-ply look-ahead
            for(var i=0;i<cands.length;i++){
                var r0=cands[i][0],c0=cands[i][1];
                var off=gmScore(r0,c0,aiP);
                if(off>=100000){ bR=r0;bC=c0;best=Infinity;break; }  // immediate win
                // place my stone, find opponent's strongest reply
                gmBoard[r0][c0]=aiP;
                var oppBest=0, sub=gmCandidates();
                for(var j=0;j<sub.length;j++){
                    var os=gmScore(sub[j][0],sub[j][1],humP);
                    if(os>oppBest) oppBest=os;
                }
                gmBoard[r0][c0]=0;
                var val=off*1.0 - oppBest*0.95 + gmScore(r0,c0,humP)*0.5;
                if(val>best){best=val;bR=r0;bC=c0;}
            }
        }

        if(bR===-1){var pr=cands[Math.floor(Math.random()*cands.length)];bR=pr[0];bC=pr[1];}
        gmApply(bR,bC);
        gomokuRender();
    }

    function gomokuRender(){
        var wrap=g('entBoardWrap'); if(!wrap) return;
        var cs=34,pad=17,sz=(GM-1)*cs+pad*2;
        var html='<div class="gm-wrap"><svg class="gm-svg" viewBox="0 0 '+sz+' '+sz+'">';
        // Grid lines
        for(var i=0;i<GM;i++){
            html+='<line x1="'+(pad+i*cs)+'" y1="'+pad+'" x2="'+(pad+i*cs)+'" y2="'+(pad+(GM-1)*cs)+'" class="gm-line"/>';
            html+='<line x1="'+pad+'" y1="'+(pad+i*cs)+'" x2="'+(pad+(GM-1)*cs)+'" y2="'+(pad+i*cs)+'" class="gm-line"/>';
        }
        // Star points
        [[3,3],[3,11],[7,7],[11,3],[11,11]].forEach(function(p){
            html+='<circle cx="'+(pad+p[1]*cs)+'" cy="'+(pad+p[0]*cs)+'" r="4" class="gm-star"/>';
        });
        // Stones
        for(var r=0;r<GM;r++) for(var c=0;c<GM;c++){
            if(!gmBoard[r][c]) continue;
            var cx=pad+c*cs,cy=pad+r*cs;
            html+='<circle cx="'+cx+'" cy="'+cy+'" r="14" class="'+(gmBoard[r][c]===1?'gm-black':'gm-white')+'"/>';
        }
        // Hit targets
        for(var r=0;r<GM;r++) for(var c=0;c<GM;c++){
            html+='<rect x="'+(pad+c*cs-cs/2)+'" y="'+(pad+r*cs-cs/2)+'" width="'+cs+'" height="'+cs+
                  '" class="gm-hit" data-r="'+r+'" data-c="'+c+'"/>';
        }
        html+='</svg></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.gm-hit').forEach(function(el){
            el.addEventListener('click',function(){gmClick(parseInt(el.dataset.r),parseInt(el.dataset.c));});
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑤ REVERSI (Othello)
    // ════════════════════════════════════════════════════════════════
    var rvBoard, rvTurn, rvDifficulty='medium';
    var RV_DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    var RV_W = [
        [120,-20, 20,  5,  5, 20,-20,120],
        [-20,-40, -5, -5, -5, -5,-40,-20],
        [ 20, -5, 15,  3,  3, 15, -5, 20],
        [  5, -5,  3,  3,  3,  3, -5,  5],
        [  5, -5,  3,  3,  3,  3, -5,  5],
        [ 20, -5, 15,  3,  3, 15, -5, 20],
        [-20,-40, -5, -5, -5, -5,-40,-20],
        [120,-20, 20,  5,  5, 20,-20,120]
    ];

    function reversiInit(diff) {
        if (diff) rvDifficulty = diff;
        rvBoard=[];
        for(var i=0;i<8;i++) rvBoard.push(new Array(8).fill(0));
        rvBoard[3][3]=2; rvBoard[3][4]=1; rvBoard[4][3]=1; rvBoard[4][4]=2;
        rvTurn=1; entTurn=1;
        _onlineHandler=function(msg){ rvApplyMove(msg.r,msg.c); reversiRender(); };
    }

    function rvFlips(board,r,c,player) {
        if(board[r][c]) return [];
        var opp=player===1?2:1, all=[];
        RV_DIRS.forEach(function(d){
            var fl=[],nr=r+d[0],nc=c+d[1];
            while(nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr][nc]===opp){fl.push([nr,nc]);nr+=d[0];nc+=d[1];}
            if(fl.length&&nr>=0&&nr<8&&nc>=0&&nc<8&&board[nr][nc]===player) all=all.concat(fl);
        });
        return all;
    }

    function rvValidMoves(board,player) {
        var moves=[];
        for(var r=0;r<8;r++) for(var c=0;c<8;c++)
            if(!board[r][c]&&rvFlips(board,r,c,player).length) moves.push([r,c]);
        return moves;
    }

    function rvClick(r,c) {
        if(entGameOver) return;
        if(entMode==='online'&&rvTurn!==entMyColor) return;
        if(entMode==='ai'    &&rvTurn!==1) return;
        if(!rvFlips(rvBoard,r,c,rvTurn).length) return;
        rvApplyMove(r,c);
        reversiRender();
        if(!entGameOver&&entMode==='ai'&&rvTurn===2) setTimeout(rvAiMove,450);
    }

    function rvApplyMove(r,c) {
        var flips=rvFlips(rvBoard,r,c,rvTurn);
        if(!flips.length) return;
        rvBoard[r][c]=rvTurn;
        flips.forEach(function(f){rvBoard[f[0]][f[1]]=rvTurn;});
        if(!_entApplyingOnline) sendOnline({type:'move',game:'reversi',r:r,c:c});
        var opp=rvTurn===1?2:1;
        if(rvValidMoves(rvBoard,opp).length){rvTurn=opp;entTurn=rvTurn;updateTurnStatus();return;}
        if(rvValidMoves(rvBoard,rvTurn).length){
            updateTurnStatus('⚠️ Opponent has no moves — '+(rvTurn===1?'⬛ Black':'⬜ White')+' plays again');
            return;
        }
        rvEndGame();
    }

    function rvEndGame() {
        var b=0,w=0;
        for(var r=0;r<8;r++) for(var c=0;c<8;c++){if(rvBoard[r][c]===1)b++;else if(rvBoard[r][c]===2)w++;}
        var msg='⬛ '+b+' — ⬜ '+w+' — ';
        setGameOver(msg+(b>w?'⬛ Black wins! 🎉':w>b?'⬜ White wins! 🎉':'Draw! 🤝'));
        // record only when the human (Black, player 1) beats the computer
        if(entMode==='ai' && b>w) entRecordAndToast('reversi', b-w, '+'+(b-w)+' ('+b+'–'+w+')');
    }

    function rvCount(board,p){var n=0;for(var r=0;r<8;r++)for(var c=0;c<8;c++)if(board[r][c]===p)n++;return n;}

    function rvApplyTo(board,r,c,player){
        var nb=board.map(function(row){return row.slice();});
        var fl=rvFlips(nb,r,c,player);
        nb[r][c]=player; fl.forEach(function(f){nb[f[0]][f[1]]=player;});
        return nb;
    }

    // positional weights + mobility, from `player`'s perspective
    function rvEvalFor(board,player){
        var opp=player===1?2:1, sc=0;
        for(var r=0;r<8;r++) for(var c=0;c<8;c++){
            if(board[r][c]===player) sc+=RV_W[r][c];
            else if(board[r][c]===opp) sc-=RV_W[r][c];
        }
        var mp=rvValidMoves(board,player).length, mo=rvValidMoves(board,opp).length;
        sc += (mp-mo)*6;
        return sc;
    }

    function rvTerminalScore(board,player){
        var opp=player===1?2:1, diff=rvCount(board,player)-rvCount(board,opp);
        return diff>0 ? 100000+diff : diff<0 ? -100000+diff : 0;
    }

    // order moves by positional weight → far better alpha-beta pruning
    function rvOrder(moves){ return moves.sort(function(a,b){ return RV_W[b[0]][b[1]]-RV_W[a[0]][a[1]]; }); }

    function rvNegamax(board,player,depth,alpha,beta){
        var opp=player===1?2:1;
        var moves=rvValidMoves(board,player);
        if(!moves.length){
            if(!rvValidMoves(board,opp).length) return rvTerminalScore(board,player);
            return -rvNegamax(board,opp,depth-1,-beta,-alpha);   // pass
        }
        if(depth===0) return rvEvalFor(board,player);
        rvOrder(moves);
        var best=-Infinity;
        for(var i=0;i<moves.length;i++){
            var nb=rvApplyTo(board,moves[i][0],moves[i][1],player);
            var sc=-rvNegamax(nb,opp,depth-1,-beta,-alpha);
            if(sc>best) best=sc;
            if(best>alpha) alpha=best;
            if(alpha>=beta) break;
        }
        return best;
    }

    function rvAiMove() {
        if(entGameOver) return;
        var moves=rvValidMoves(rvBoard,rvTurn); if(!moves.length) return;
        var opp=rvTurn===1?2:1;
        var r,c;

        if(rvDifficulty==='easy'){
            var pick=moves[Math.floor(Math.random()*moves.length)];
            r=pick[0]; c=pick[1];
        } else {
            var depth = rvDifficulty==='master' ? 5 : rvDifficulty==='difficult' ? 3 : 1;
            var best=-Infinity, bm=moves[0];
            rvOrder(moves);
            for(var i=0;i<moves.length;i++){
                var nb=rvApplyTo(rvBoard,moves[i][0],moves[i][1],rvTurn);
                var sc=-rvNegamax(nb,opp,depth-1,-Infinity,Infinity) + Math.random()*0.5;
                if(sc>best){best=sc;bm=moves[i];}
            }
            r=bm[0]; c=bm[1];
        }
        rvApplyMove(r,c);
        reversiRender();
        // if the human had no legal reply, the AI keeps the turn — play again
        if(!entGameOver && entMode==='ai' && rvTurn===2) setTimeout(rvAiMove,450);
    }

    function reversiRender() {
        var wrap=g('entBoardWrap'); if(!wrap) return;
        var valid=entGameOver?[]:rvValidMoves(rvBoard,rvTurn);
        var vset={};valid.forEach(function(m){vset[m[0]+','+m[1]]=true;});
        var b=0,w=0;
        for(var r=0;r<8;r++) for(var c=0;c<8;c++){if(rvBoard[r][c]===1)b++;else if(rvBoard[r][c]===2)w++;}
        var html='<div class="rv-outer">' +
            '<div class="rv-score">⬛ Black: <b>'+b+'</b> &nbsp;|&nbsp; ⬜ White: <b>'+w+'</b></div>' +
            '<table class="rv-board" id="rvBoard">';
        for(var r=0;r<8;r++){
            html+='<tr>';
            for(var c=0;c<8;c++){
                var v=rvBoard[r][c], hint=vset[r+','+c];
                html+='<td class="rv-cell'+(hint?' rv-hint':'')+'" data-r="'+r+'" data-c="'+c+'">';
                if(v===1) html+='<div class="rv-disc rv-black"></div>';
                else if(v===2) html+='<div class="rv-disc rv-white"></div>';
                else if(hint) html+='<div class="rv-dot"></div>';
                html+='</td>';
            }
            html+='</tr>';
        }
        html+='</table></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.rv-cell').forEach(function(td){
            td.addEventListener('click',function(){rvClick(parseInt(td.dataset.r),parseInt(td.dataset.c));});
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑥ 2048
    // ════════════════════════════════════════════════════════════════
    var _g2048, _s2048=0, _best2048=0;

    function init2048() {
        _g2048=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
        _s2048=0;
        _g2048Spawn(); _g2048Spawn();
        wire2048Keys();
        var el=g('entGameStatus'); if(el) el.textContent='Score: 0';
    }

    function _g2048Spawn() {
        var em=[];
        for(var r=0;r<4;r++) for(var c=0;c<4;c++) if(!_g2048[r][c]) em.push([r,c]);
        if(!em.length) return;
        var p=em[Math.floor(Math.random()*em.length)];
        _g2048[p[0]][p[1]]=Math.random()<0.9?2:4;
    }

    function move2048(dir) {
        if(entGameOver||entGame!=='2048') return;
        function tr(g){return g[0].map(function(_,c){return g.map(function(r){return r[c];});});}
        function fh(g){return g.map(function(r){return r.slice().reverse();});}
        var G=_g2048.map(function(r){return r.slice();}), add=0, moved=false;
        if(dir==='right') G=fh(G);
        else if(dir==='up') G=tr(G);
        else if(dir==='down') G=fh(tr(G));
        G=G.map(function(row){
            var was=row.join(), a=row.filter(Boolean), out=[];
            for(var i=0;i<a.length;i++){
                if(a[i+1]===a[i]){out.push(a[i]*2);add+=a[i]*2;i++;}else out.push(a[i]);
            }
            while(out.length<4) out.push(0);
            if(out.join()!==was) moved=true;
            return out;
        });
        if(dir==='right') G=fh(G);
        else if(dir==='up') G=tr(G);
        else if(dir==='down') G=tr(fh(G));
        if(!moved) return;
        _g2048=G; _s2048+=add; if(_s2048>_best2048)_best2048=_s2048;
        _g2048Spawn(); render2048();
        // Check 2048
        var won=false;
        for(var r=0;r<4;r++) for(var c=0;c<4;c++) if(_g2048[r][c]===2048){won=true;}
        if(won){setGameOver('🎉 You reached 2048! Score: '+_s2048);render2048();entRecordAndToast('2048',_s2048,_s2048+' pts');return;}
        // Check no moves
        var dead=true;
        ol:for(var r=0;r<4;r++) for(var c=0;c<4;c++){
            if(!_g2048[r][c]){dead=false;break ol;}
            if(c<3&&_g2048[r][c]===_g2048[r][c+1]){dead=false;break ol;}
            if(r<3&&_g2048[r][c]===_g2048[r+1][c]){dead=false;break ol;}
        }
        if(dead){setGameOver('Game Over — Score: '+_s2048);entRecordAndToast('2048',_s2048,_s2048+' pts');return;}
        var el=g('entGameStatus');if(el)el.textContent='Score: '+_s2048+' | Best: '+_best2048;
    }

    var _2048keysBound=false;
    function wire2048Keys(){
        if(_2048keysBound) return; _2048keysBound=true;
        document.addEventListener('keydown',function(e){
            if(entGame!=='2048') return;
            var map={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
            if(map[e.key]){e.preventDefault();move2048(map[e.key]);}
        });
    }

    var T_COLORS={0:'#cdc1b4',2:'#eee4da',4:'#ede0c8',8:'#f2b179',16:'#f59563',
                  32:'#f67c5f',64:'#f65e3b',128:'#edcf72',256:'#edcc61',512:'#edc850',
                  1024:'#edc53f',2048:'#edc22e'};

    function render2048(){
        var wrap=g('entBoardWrap');if(!wrap)return;
        var html='<div class="t48-wrap"><div class="t48-board">';
        for(var r=0;r<4;r++) for(var c=0;c<4;c++){
            var v=_g2048[r][c];
            var bg=T_COLORS[v]||'#3c3a32', fg=v<=4?'#776e65':'#f9f6f2';
            var fs=v>=1024?'18px':v>=128?'22px':'28px';
            html+='<div class="t48-tile" style="background:'+bg+';color:'+fg+';font-size:'+fs+';">'+(v||'')+'</div>';
        }
        html+='</div>';
        // D-pad for mobile / swipe
        html+='<div class="t48-dpad">';
        html+='<div></div><button class="t48-btn" data-dir="up">▲</button><div></div>';
        html+='<button class="t48-btn" data-dir="left">◀</button><div></div><button class="t48-btn" data-dir="right">▶</button>';
        html+='<div></div><button class="t48-btn" data-dir="down">▼</button><div></div>';
        html+='</div></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.t48-btn').forEach(function(btn){
            btn.addEventListener('click',function(){move2048(btn.dataset.dir);});
        });
        // Touch swipe on board
        var board=wrap.querySelector('.t48-board');
        if(board){
            var sx,sy;
            board.addEventListener('touchstart',function(e){sx=e.touches[0].clientX;sy=e.touches[0].clientY;},{passive:true});
            board.addEventListener('touchend',function(e){
                var dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
                if(Math.abs(dx)<20&&Math.abs(dy)<20)return;
                if(Math.abs(dx)>Math.abs(dy))move2048(dx>0?'right':'left');
                else move2048(dy>0?'down':'up');
            },{passive:true});
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑦ MINESWEEPER
    // ════════════════════════════════════════════════════════════════
    var msGrid, msCfg, msReady, msFlags, msRevealed, msTimerVal, msFlagMode=false, msDiff='easy';
    var MS_CFG={easy:{rows:9,cols:9,mines:10},medium:{rows:14,cols:14,mines:35},hard:{rows:16,cols:20,mines:70}};
    var MS_WEIGHT={easy:1,medium:2,hard:3};

    function initMinesweeper(diff){
        msDiff=diff||'easy';
        var cfg=MS_CFG[diff]||MS_CFG.easy; msCfg=cfg;
        msGrid=[];
        for(var r=0;r<cfg.rows;r++){msGrid.push([]);
            for(var c=0;c<cfg.cols;c++) msGrid[r].push({mine:false,rev:false,flag:false,cnt:0});}
        msReady=false; msFlags=0; msRevealed=0; msTimerVal=0; msFlagMode=false;
        if(_msTimer){clearInterval(_msTimer);_msTimer=null;}
    }

    function msPlaceMines(fr,fc){
        var cfg=msCfg, pool=[];
        for(var r=0;r<cfg.rows;r++) for(var c=0;c<cfg.cols;c++){
            if(Math.abs(r-fr)<=1&&Math.abs(c-fc)<=1) continue;
            pool.push([r,c]);
        }
        for(var i=pool.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=pool[i];pool[i]=pool[j];pool[j]=t;}
        for(var i=0;i<cfg.mines;i++) msGrid[pool[i][0]][pool[i][1]].mine=true;
        var D=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for(var r=0;r<cfg.rows;r++) for(var c=0;c<cfg.cols;c++){
            if(msGrid[r][c].mine) continue;
            var cnt=0;
            D.forEach(function(d){var nr=r+d[0],nc=c+d[1];if(nr>=0&&nr<cfg.rows&&nc>=0&&nc<cfg.cols&&msGrid[nr][nc].mine)cnt++;});
            msGrid[r][c].cnt=cnt;
        }
        msReady=true;
        _msTimer=setInterval(function(){
            msTimerVal++;
            var el=g('msFlagBar'); if(el) el.textContent='🚩 '+msFlags+'/'+msCfg.mines+' · ⏱ '+msTimerVal+'s';
        },1000);
    }

    function msReveal(r,c){
        if(entGameOver) return;
        var cell=msGrid[r][c]; if(cell.rev||cell.flag) return;
        if(!msReady) msPlaceMines(r,c);
        cell.rev=true; msRevealed++;
        if(cell.mine){
            for(var i=0;i<msCfg.rows;i++) for(var j=0;j<msCfg.cols;j++) if(msGrid[i][j].mine) msGrid[i][j].rev=true;
            if(_msTimer){clearInterval(_msTimer);_msTimer=null;}
            setGameOver('💥 Boom! Try again.'); renderMinesweeper(); return;
        }
        if(cell.cnt===0){
            var D=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
            var q=[[r,c]];
            while(q.length){var cur=q.pop();
                D.forEach(function(d){var nr=cur[0]+d[0],nc=cur[1]+d[1];
                    if(nr<0||nr>=msCfg.rows||nc<0||nc>=msCfg.cols)return;
                    var n=msGrid[nr][nc]; if(n.rev||n.flag||n.mine)return;
                    n.rev=true;msRevealed++;if(n.cnt===0)q.push([nr,nc]);});
            }
        }
        if(msRevealed>=msCfg.rows*msCfg.cols-msCfg.mines){
            if(_msTimer){clearInterval(_msTimer);_msTimer=null;}
            setGameOver('🎉 Cleared in '+msTimerVal+'s!');
            var msCap=msDiff.charAt(0).toUpperCase()+msDiff.slice(1);
            entRecordAndToast('minesweeper',(MS_WEIGHT[msDiff]||1)*100000-msTimerVal,msCap+' · '+msTimerVal+'s');
        }
        renderMinesweeper();
    }

    function msFlag(r,c){
        if(entGameOver||!msReady) return;
        var cell=msGrid[r][c]; if(cell.rev) return;
        cell.flag=!cell.flag; msFlags+=cell.flag?1:-1;
        renderMinesweeper();
    }

    function renderMinesweeper(){
        var wrap=g('entBoardWrap');if(!wrap)return;
        var NC=['','#1565c0','#2e7d32','#c62828','#1a237e','#880e4f','#006064','#212121','#546e7a'];
        var html='<div class="ms-wrap">';
        html+='<div class="ms-bar"><span id="msFlagBar">🚩 '+msFlags+'/'+msCfg.mines+' · ⏱ '+msTimerVal+'s</span>';
        html+='<button class="ms-mode-btn'+(msFlagMode?' ms-mode-on':'')+'" id="msModeBtn">'+(msFlagMode?'🚩 Flag':'🔍 Dig')+'</button></div>';
        html+='<div class="ms-grid" style="grid-template-columns:repeat('+msCfg.cols+',28px)" id="msGrid">';
        for(var r=0;r<msCfg.rows;r++) for(var c=0;c<msCfg.cols;c++){
            var cl=msGrid[r][c], cls='ms-cell';
            var inner='';
            if(cl.rev){cls+=' ms-rev';if(cl.mine)inner='💣';else if(cl.cnt)inner='<span style="color:'+NC[cl.cnt]+'">'+cl.cnt+'</span>';}
            else if(cl.flag) inner='🚩';
            html+='<div class="'+cls+'" data-r="'+r+'" data-c="'+c+'">'+inner+'</div>';
        }
        html+='</div></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.ms-cell').forEach(function(el){
            el.addEventListener('click',function(){
                var r=parseInt(el.dataset.r),c=parseInt(el.dataset.c);
                msFlagMode?msFlag(r,c):msReveal(r,c);
            });
            el.addEventListener('contextmenu',function(e){e.preventDefault();msFlag(parseInt(el.dataset.r),parseInt(el.dataset.c));});
        });
        var mb=g('msModeBtn');
        if(mb) mb.addEventListener('click',function(){msFlagMode=!msFlagMode;renderMinesweeper();});
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑧ SNAKE
    // ════════════════════════════════════════════════════════════════
    var snBody, snDir, snFood, snScore, snSpeed;
    var SN=20;
    var SN_SPD={easy:220,medium:130,hard:70};
    var _snKeysBound=false;

    function initSnake(diff){
        snBody=[[10,10],[10,9],[10,8]];
        snDir=[0,1]; snFood=snSpawnFood(); snScore=0;
        snSpeed=SN_SPD[diff]||SN_SPD.easy;
        if(_snakeInterval){clearInterval(_snakeInterval);_snakeInterval=null;}
        wireSnakeKeys();
        var el=g('entGameStatus');if(el)el.textContent='🍎 Score: 0';
    }

    function snSpawnFood(){
        var em=[];
        for(var r=0;r<SN;r++) for(var c=0;c<SN;c++){
            var ok=true;for(var i=0;i<snBody.length;i++)if(snBody[i][0]===r&&snBody[i][1]===c){ok=false;break;}
            if(ok)em.push([r,c]);
        }
        return em[Math.floor(Math.random()*em.length)]||[0,0];
    }

    function startSnakeLoop(){
        if(_snakeInterval)clearInterval(_snakeInterval);
        _snakeInterval=setInterval(snStep,snSpeed);
    }

    function snStep(){
        if(entGameOver||entGame!=='snake'){clearInterval(_snakeInterval);_snakeInterval=null;return;}
        var h=snBody[0], nr=h[0]+snDir[0], nc=h[1]+snDir[1];
        if(nr<0||nr>=SN||nc<0||nc>=SN){clearInterval(_snakeInterval);_snakeInterval=null;setGameOver('💥 Score: '+snScore);renderSnake();entRecordAndToast('snake',snScore,snScore+' pts');return;}
        for(var i=0;i<snBody.length-1;i++)if(snBody[i][0]===nr&&snBody[i][1]===nc){clearInterval(_snakeInterval);_snakeInterval=null;setGameOver('💥 Score: '+snScore);renderSnake();entRecordAndToast('snake',snScore,snScore+' pts');return;}
        snBody.unshift([nr,nc]);
        if(nr===snFood[0]&&nc===snFood[1]){
            snScore++;snFood=snSpawnFood();
            var el=g('entGameStatus');if(el)el.textContent='🍎 Score: '+snScore;
            if(snScore%5===0){clearInterval(_snakeInterval);snSpeed=Math.max(55,snSpeed-15);_snakeInterval=setInterval(snStep,snSpeed);}
        }else snBody.pop();
        renderSnake();
    }

    function wireSnakeKeys(){
        if(_snKeysBound)return;_snKeysBound=true;
        document.addEventListener('keydown',function(e){
            if(entGame!=='snake')return;
            var M={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1],
                   w:[-1,0],s:[1,0],a:[0,-1],d:[0,1]};
            var d=M[e.key];
            if(d&&!(d[0]===-snDir[0]&&d[1]===-snDir[1])){e.preventDefault();snDir=d;}
        });
    }

    function renderSnake(){
        var wrap=g('entBoardWrap');if(!wrap)return;
        var cs=22,sz=SN*cs;
        var html='<div class="sn-wrap">';
        html+='<canvas id="snCanvas" width="'+sz+'" height="'+sz+'"></canvas>';
        html+='<div class="sn-dpad">';
        html+='<div></div><button class="sn-btn" data-r="-1" data-c="0">▲</button><div></div>';
        html+='<button class="sn-btn" data-r="0" data-c="-1">◀</button><div class="sn-center"></div><button class="sn-btn" data-r="0" data-c="1">▶</button>';
        html+='<div></div><button class="sn-btn" data-r="1" data-c="0">▼</button><div></div>';
        html+='</div></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.sn-btn').forEach(function(btn){
            btn.addEventListener('click',function(){
                var dr=parseInt(btn.dataset.r),dc=parseInt(btn.dataset.c);
                if(!(dr===-snDir[0]&&dc===-snDir[1]))snDir=[dr,dc];
            });
        });
        var cv=g('snCanvas');if(!cv)return;
        var ctx=cv.getContext('2d');
        ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,sz,sz);
        ctx.strokeStyle='#22223a';ctx.lineWidth=0.5;
        for(var i=0;i<=SN;i++){ctx.beginPath();ctx.moveTo(i*cs,0);ctx.lineTo(i*cs,sz);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*cs);ctx.lineTo(sz,i*cs);ctx.stroke();}
        for(var i=0;i<snBody.length;i++){
            var r=snBody[i][0],c=snBody[i][1];
            var a=1-i/snBody.length*0.55;
            ctx.fillStyle=i===0?'#4cff72':('rgba(30,190,70,'+a.toFixed(2)+')');
            ctx.fillRect(c*cs+1,r*cs+1,cs-2,cs-2);
            if(i===0){ctx.fillStyle='#000';ctx.fillRect(c*cs+4,r*cs+5,3,3);ctx.fillRect(c*cs+cs-7,r*cs+5,3,3);}
        }
        if(snFood){var fr=snFood[0],fc=snFood[1];ctx.fillStyle='#ff3b3b';ctx.beginPath();ctx.arc(fc*cs+cs/2,fr*cs+cs/2,cs/2-2,0,Math.PI*2);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.4)';ctx.beginPath();ctx.arc(fc*cs+cs/2-3,fr*cs+cs/2-3,3,0,Math.PI*2);ctx.fill();}
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑨ SUDOKU
    // ════════════════════════════════════════════════════════════════
    var sdkBoard, sdkSol, sdkGiven, sdkSel, sdkDiff='easy', sdkStart=0;
    var SDK_WEIGHT={easy:1,medium:2,hard:3};

    function initSudoku(diff){
        sdkDiff=diff||'easy';
        var hints={easy:45,medium:35,hard:25}[diff]||45;
        sdkSol=sdkGen();
        sdkBoard=sdkSol.map(function(r){return r.slice();});
        sdkGiven=sdkSol.map(function(r){return r.slice();});
        var cells=[];for(var r=0;r<9;r++) for(var c=0;c<9;c++) cells.push([r,c]);
        cells.sort(function(){return Math.random()-0.5;});
        for(var i=0;i<81-hints;i++){sdkBoard[cells[i][0]][cells[i][1]]=0;sdkGiven[cells[i][0]][cells[i][1]]=0;}
        sdkSel=null;
        sdkStart=Date.now();
        var el=g('entGameStatus');if(el)el.textContent='Select a cell then tap a number';
    }

    function sdkGen(){var g=[];for(var i=0;i<9;i++)g.push(new Array(9).fill(0));sdkFill(g,0);return g;}
    function sdkFill(gr,pos){
        if(pos===81)return true;
        var r=Math.floor(pos/9),c=pos%9;
        var nums=[1,2,3,4,5,6,7,8,9];nums.sort(function(){return Math.random()-0.5;});
        for(var i=0;i<9;i++){
            if(sdkOk(gr,r,c,nums[i])){gr[r][c]=nums[i];if(sdkFill(gr,pos+1))return true;gr[r][c]=0;}
        }
        return false;
    }
    function sdkOk(gr,r,c,n){
        for(var i=0;i<9;i++){if(gr[r][i]===n||gr[i][c]===n)return false;}
        var br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;
        for(var i=0;i<3;i++)for(var j=0;j<3;j++)if(gr[br+i][bc+j]===n)return false;
        return true;
    }

    function sdkInput(n){
        if(!sdkSel)return;
        var r=sdkSel[0],c=sdkSel[1];
        if(sdkGiven[r][c])return;
        sdkBoard[r][c]=n; renderSudoku();
        var done=true;
        for(var i=0;i<9;i++)for(var j=0;j<9;j++)if(sdkBoard[i][j]!==sdkSol[i][j]){done=false;break;}
        if(done){
            var secs=Math.round((Date.now()-sdkStart)/1000);
            var mm=Math.floor(secs/60), ss=secs%60, tstr=mm+':'+(ss<10?'0':'')+ss;
            setGameOver('🎉 Puzzle solved in '+tstr+'!');
            var sdkCap=sdkDiff.charAt(0).toUpperCase()+sdkDiff.slice(1);
            entRecordAndToast('sudoku',(SDK_WEIGHT[sdkDiff]||1)*1000000-secs,sdkCap+' · '+tstr);
        }
    }

    function renderSudoku(){
        var wrap=g('entBoardWrap');if(!wrap)return;
        var html='<div class="sdk-wrap"><table class="sdk-board">';
        for(var r=0;r<9;r++){
            html+='<tr>';
            for(var c=0;c<9;c++){
                var v=sdkBoard[r][c], given=sdkGiven[r][c]>0;
                var sel=sdkSel&&sdkSel[0]===r&&sdkSel[1]===c;
                var wrong=v&&!given&&v!==sdkSol[r][c];
                var sameBox=sdkSel&&Math.floor(sdkSel[0]/3)===Math.floor(r/3)&&Math.floor(sdkSel[1]/3)===Math.floor(c/3);
                var sameLine=sdkSel&&(sdkSel[0]===r||sdkSel[1]===c);
                var cls='sdk-cell';
                if(c===2||c===5) cls+=' sdk-rb';
                if(r===2||r===5) cls+=' sdk-bb';
                if(given) cls+=' sdk-given';
                if(sel)   cls+=' sdk-sel';
                else if(sameBox||sameLine) cls+=' sdk-hi';
                if(wrong) cls+=' sdk-wrong';
                html+='<td class="'+cls+'" data-r="'+r+'" data-c="'+c+'">'+(v||'')+'</td>';
            }
            html+='</tr>';
        }
        html+='</table>';
        html+='<div class="sdk-pad">';
        for(var n=1;n<=9;n++) html+='<button class="sdk-num" data-n="'+n+'">'+n+'</button>';
        html+='<button class="sdk-num sdk-clr" data-n="0">✕</button>';
        html+='</div></div>';
        wrap.innerHTML=html;
        wrap.querySelectorAll('.sdk-cell').forEach(function(td){
            td.addEventListener('click',function(){sdkSel=[parseInt(td.dataset.r),parseInt(td.dataset.c)];renderSudoku();});
        });
        wrap.querySelectorAll('.sdk-num').forEach(function(btn){
            btn.addEventListener('click',function(){sdkInput(parseInt(btn.dataset.n));});
        });
        // Keyboard input
        if(!wrap._sdkKeyBound){
            wrap._sdkKeyBound=true;
            document.addEventListener('keydown',function(e){
                if(entGame!=='sudoku'||!sdkSel)return;
                var n=parseInt(e.key);
                if(n>=0&&n<=9)sdkInput(n);
                if(e.key==='Backspace'||e.key==='Delete')sdkInput(0);
            });
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑩ MAHJONG 麻將  (4-player, Yahoo-style)
    //  Tiles encoded 0..33:
    //    0-8  man(萬) 1-9 | 9-17 pin(筒) 1-9 | 18-26 sou(索) 1-9
    //    27-30 winds E,S,W,N | 31-33 dragons Red,Green,White
    //  Modes: 'ai' (you + 3 computers) · 'local' (2-4 hot-seat) · 'online'
    // ════════════════════════════════════════════════════════════════

    // ── tile helpers ───────────────────────────────────────────────
    //  34-37 flowers 梅蘭菊竹 · 38-41 seasons 春夏秋冬  (bonus tiles)
    function mjGlyph(t) {
        if (t < 9)  return String.fromCodePoint(0x1F007 + t);          // man
        if (t < 18) return String.fromCodePoint(0x1F019 + (t - 9));    // pin (circles)
        if (t < 27) return String.fromCodePoint(0x1F010 + (t - 18));   // sou (bamboo)
        if (t < 31) return String.fromCodePoint(0x1F000 + (t - 27));   // winds E,S,W,N
        if (t < 34) return String.fromCodePoint(0x1F004 + (t - 31));   // dragons R,G,W
        return String.fromCodePoint(0x1F022 + (t - 34));               // flowers + seasons
    }
    function mjIsFlower(t) { return t >= 34; }
    function mjSuited(t) { return t < 27; }
    function mjSuit(t)   { return t < 27 ? Math.floor(t / 9) : 3; }
    function mjVal(t)    { return t < 27 ? (t % 9) : -1; }   // 0..8 within suit
    function mjCount(arr) {
        var c = new Array(34).fill(0);
        for (var i = 0; i < arr.length; i++) c[arr[i]]++;
        return c;
    }
    function mjRemoveN(arr, t, n) {
        for (var k = 0; k < n; k++) { var i = arr.indexOf(t); if (i >= 0) arr.splice(i, 1); }
    }
    function mjSortSeat(seat) { MJ.players[seat].hand.sort(function (a, b) { return a - b; }); }

    // ── win detection ──────────────────────────────────────────────
    function mjAllMelds(cnt) {
        var i = 0; while (i < 34 && cnt[i] === 0) i++;
        if (i === 34) return true;
        if (cnt[i] >= 3) { cnt[i] -= 3; if (mjAllMelds(cnt)) { cnt[i] += 3; return true; } cnt[i] += 3; }
        if (i < 27 && (i % 9) <= 6 && cnt[i + 1] > 0 && cnt[i + 2] > 0) {
            cnt[i]--; cnt[i + 1]--; cnt[i + 2]--;
            var ok = mjAllMelds(cnt);
            cnt[i]++; cnt[i + 1]++; cnt[i + 2]++;
            if (ok) return true;
        }
        return false;
    }
    function mjCanWin(cnt) {
        for (var t = 0; t < 34; t++) {
            if (cnt[t] >= 2) { cnt[t] -= 2; var ok = mjAllMelds(cnt); cnt[t] += 2; if (ok) return true; }
        }
        return false;
    }
    function mjSevenPairs(cnt) {
        var pairs = 0;
        for (var t = 0; t < 34; t++) { if (cnt[t] === 2) pairs++; else if (cnt[t] !== 0) return false; }
        return pairs === 7;
    }
    function mjHandIsWin(p) {
        var cnt = mjCount(p.hand);
        if (mjCanWin(cnt)) return true;
        if (p.melds.length === 0 && p.hand.length === 14 && mjSevenPairs(cnt)) return true;
        return false;
    }
    function mjWouldWinWith(p, tile) {
        var test = p.hand.slice(); test.push(tile);
        var cnt = mjCount(test);
        if (mjCanWin(cnt)) return true;
        if (p.melds.length === 0 && test.length === 14 && mjSevenPairs(cnt)) return true;
        return false;
    }

    // ── hand decomposition (for scoring) ───────────────────────────
    function mjMeldsDecomp(cnt) {
        var i = 0; while (i < 34 && cnt[i] === 0) i++;
        if (i === 34) return [];
        if (cnt[i] >= 3) {
            cnt[i] -= 3; var r = mjMeldsDecomp(cnt); cnt[i] += 3;
            if (r !== null) return [{ type: 'pung', base: i }].concat(r);
        }
        if (i < 27 && (i % 9) <= 6 && cnt[i + 1] > 0 && cnt[i + 2] > 0) {
            cnt[i]--; cnt[i + 1]--; cnt[i + 2]--;
            var r2 = mjMeldsDecomp(cnt); cnt[i]++; cnt[i + 1]++; cnt[i + 2]++;
            if (r2 !== null) return [{ type: 'chow', base: i }].concat(r2);
        }
        return null;
    }
    function mjDecompose(cnt) {
        for (var t = 0; t < 34; t++) {
            if (cnt[t] >= 2) { cnt[t] -= 2; var r = mjMeldsDecomp(cnt); cnt[t] += 2; if (r !== null) return { pair: t, melds: r }; }
        }
        return null;
    }

    // ── fan scoring ────────────────────────────────────────────────
    function mjScoreHand(p, seat, selfDraw) {
        var pats = [], fan = 0;
        function add(name, f) { pats.push({ name: name, fan: f }); fan += f; }

        var cnt = mjCount(p.hand);
        var sevenPairs = (p.melds.length === 0 && p.hand.length === 14 && mjSevenPairs(cnt));

        add('Win 胡', 1);
        if (selfDraw)           add('Self-draw 自摸', 1);
        if (p.melds.length === 0 && !sevenPairs) add('Concealed 門清', 1);
        var kongs = p.melds.filter(function (m) { return m.type === 'kong'; }).length;
        if (kongs)              add('Kong ×' + kongs + ' 槓', kongs);

        if (sevenPairs) {
            add('Seven Pairs 七對', 4);
        } else {
            var exposedAllPung = p.melds.every(function (m) { return m.type === 'pung' || m.type === 'kong'; });
            // direct All-Triplets test (avoids ambiguity from chow decompositions)
            var pairCnt = 0, allTrip = exposedAllPung;
            for (var z = 0; z < 34 && allTrip; z++) {
                if (cnt[z] === 0 || cnt[z] === 3) continue;
                if (cnt[z] === 2) { pairCnt++; continue; }
                allTrip = false;
            }
            if (allTrip && pairCnt === 1) add('All Triplets 對對胡', 3);

            var dec = mjDecompose(cnt);
            var all = p.melds.map(function (m) { return { type: m.type === 'kong' ? 'pung' : m.type, base: m.tiles[0] }; });
            if (dec) dec.melds.forEach(function (m) { all.push({ type: m.type, base: m.base }); });
            if (!(allTrip && pairCnt === 1) && all.length === 4 && all.every(function (m) { return m.type === 'chow'; }))
                add('All Chows 平胡', 1);
            // dragon / wind triplets (honors always resolve to pungs)
            all.forEach(function (m) {
                if (m.type === 'pung') {
                    if (m.base >= 31)      add('Dragon triplet 箭刻', 1);
                    else if (m.base >= 27) add('Wind triplet 風刻', 1);
                }
            });
        }

        // flush check across concealed + exposed tiles
        var tiles = p.hand.slice();
        p.melds.forEach(function (m) { tiles = tiles.concat(m.tiles); });
        var suits = {}, hasHonor = false;
        tiles.forEach(function (t) { if (t >= 27) hasHonor = true; else suits[mjSuit(t)] = true; });
        var sc = Object.keys(suits).length;
        if (sc === 0 && hasHonor)      add('All Honors 字一色', 8);
        else if (sc === 1 && !hasHonor) add('Full Flush 清一色', 6);
        else if (sc === 1 && hasHonor)  add('Half Flush 混一色', 3);

        // flower / season bonus tiles
        var flowers = p.flowers || [];
        if (flowers.length) {
            add('Flowers ×' + flowers.length + ' 花', flowers.length);
            var own = 0;
            flowers.forEach(function (f) { if (f === 34 + seat || f === 38 + seat) own++; });
            if (own) add('Seat flower 正花 ×' + own, own);
            if (flowers.length === 8) add('All Flowers 花胡', 4);   // grand slam of bonus tiles
        }

        if (fan < 1) fan = 1;
        return { fan: fan, pats: pats };
    }

    // ── claim option detection ─────────────────────────────────────
    function mjClaimOptions(seat, tile, discarder) {
        var p = MJ.players[seat];
        var cnt = mjCount(p.hand);
        var o = { seat: seat, ron: false, kong: false, pung: false, chows: [] };
        if (mjWouldWinWith(p, tile)) o.ron = true;
        if (cnt[tile] >= 2) o.pung = true;
        if (cnt[tile] >= 3) o.kong = true;
        if (seat === (discarder + 1) % 4 && tile < 27) {
            var s = mjSuit(tile), v = mjVal(tile);
            function ok(idx) { return idx >= 0 && idx < 27 && cnt[idx] > 0 && mjSuit(idx) === s; }
            if (v >= 2 && ok(tile - 1) && ok(tile - 2)) o.chows.push([tile - 2, tile - 1]);
            if (v >= 1 && v <= 7 && ok(tile - 1) && ok(tile + 1)) o.chows.push([tile - 1, tile + 1]);
            if (v <= 6 && ok(tile + 1) && ok(tile + 2)) o.chows.push([tile + 1, tile + 2]);
        }
        return o;
    }
    function mjHasAnyClaim(o) { return o.ron || o.pung || o.kong || o.chows.length > 0; }
    function mjClaimRank(type) { return type === 'ron' ? 3 : (type === 'kong' || type === 'pung') ? 2 : 1; }

    // AI claim policy: always ron; pung/kong only honors (winds/dragons); never chow
    function mjAiClaim(seat, tile, o) {
        if (o.ron) return { seat: seat, type: 'ron' };
        if (tile >= 27) {
            if (o.kong) return { seat: seat, type: 'kong' };
            if (o.pung) return { seat: seat, type: 'pung' };
        }
        return null;
    }

    // ── seat / view helpers ────────────────────────────────────────
    var MJ_NAMES = ['South', 'East', 'North', 'West'];
    function mjSeatName(seat) {
        var n = MJ.players[seat];
        if (n && n.name) return n.name;
        return MJ_NAMES[seat];
    }
    function mjViewSeat() {
        if (MJ.online) return MJ.mySeat != null ? MJ.mySeat : 0;
        if (entMode === 'ai') return 0;
        return MJ.localViewSeat != null ? MJ.localViewSeat : 0;   // local hot-seat
    }
    // which seat (if any) this device may currently act for in discard phase
    function mjMyActiveSeat() {
        if (MJ.phase !== 'discard') return null;
        if (MJ.online) return (MJ.turn === MJ.mySeat && !MJ.players[MJ.turn].ai) ? MJ.mySeat : null;
        var p = MJ.players[MJ.turn];
        return (p && !p.ai) ? MJ.turn : null;
    }
    // seats whose CLAIMS this device controls (privacy: none for local hot-seat)
    function mjControllableClaimSeats() {
        if (MJ.online) return [MJ.mySeat];
        if (entMode === 'ai') return [0];
        return [];
    }

    // ── setup screen ───────────────────────────────────────────────
    function showMahjongSetup() {
        MJ.scores = null;   // fresh session → reset running totals
        var el = g('entModeSelectInner'); if (!el) return;
        el.innerHTML =
            '<h2 class="ent-mode-title">🀄 Mahjong 麻將</h2>' +
            '<p class="ent-mj-setup-sub">A classic 4-player game — draw a tile, discard one, and complete 4 sets + a pair to win.</p>' +
            '<div class="ent-mode-btns">' +
              '<button class="ent-mode-btn" id="mjModeAI">🤖 vs 3 Computers</button>' +
              '<button class="ent-mode-btn" id="mjModeLocal">🖥️ Local Table (pass &amp; play)</button>' +
              '<button class="ent-mode-btn" id="mjModeOnline">🌐 Online — Same Clinic</button>' +
            '</div>' +
            '<button class="ent-back-btn" id="mjSetupBack">← Back to Games</button>';
        g('mjModeAI').onclick    = function () { entMode = 'ai'; startGame('mahjong', 'ai', { humans: 1 }); };
        g('mjModeLocal').onclick = function () { mjLocalCountScreen(); };
        g('mjModeOnline').onclick= function () { mjOnlineRoomScreen(); };
        g('mjSetupBack').onclick = function () { showPanel('entLobby'); };
        showPanel('entModeSelect');
    }

    function mjLocalCountScreen() {
        var el = g('entModeSelectInner'); if (!el) return;
        el.innerHTML =
            '<h2 class="ent-mode-title">🖥️ Local Table</h2>' +
            '<p class="ent-mj-setup-sub">How many human players share this device? Empty seats are computers.</p>' +
            '<div class="ent-mode-btns">' +
              '<button class="ent-mode-btn" data-h="2">2 Players</button>' +
              '<button class="ent-mode-btn" data-h="3">3 Players</button>' +
              '<button class="ent-mode-btn" data-h="4">4 Players</button>' +
            '</div>' +
            '<button class="ent-back-btn" id="mjLocalBack">← Back</button>';
        el.querySelectorAll('[data-h]').forEach(function (b) {
            b.addEventListener('click', function () {
                entMode = 'local';
                startGame('mahjong', 'local', { humans: parseInt(b.dataset.h, 10) });
            });
        });
        g('mjLocalBack').onclick = function () { showMahjongSetup(); };
    }

    // ════════════════════════════════════════════════════════════════
    //  MAHJONG — game setup / dealing
    // ════════════════════════════════════════════════════════════════
    function mjBuildWall() {
        var w = [];
        for (var t = 0; t < 34; t++) for (var k = 0; k < 4; k++) w.push(t);   // 136 suit/honor tiles
        for (var f = 34; f < 42; f++) w.push(f);                              // 8 flower/season tiles
        for (var i = w.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = w[i]; w[i] = w[j]; w[j] = tmp;
        }
        return w;
    }

    function mjFreshPlayers() {
        var ps = [];
        for (var s = 0; s < 4; s++) {
            ps.push({ seat: s, hand: [], melds: [], discards: [], flowers: [], ai: true, name: MJ_NAMES[s], lastDraw: null });
        }
        return ps;
    }

    // draw one tile, auto-collecting any flowers into the seat's flower row;
    // returns a non-flower tile, or null if the wall is exhausted
    function mjDrawTile(seat) {
        while (MJ.wall.length) {
            var t = MJ.wall.pop();
            if (mjIsFlower(t)) {
                MJ.players[seat].flowers.push(t);
                MJ.players[seat].flowers.sort(function (a, b) { return a - b; });
                continue;
            }
            return t;
        }
        return null;
    }

    // pull flowers out of a hand, drawing non-flower replacements for each
    function mjNormalizeFlowers(seat) {
        var p = MJ.players[seat];
        var i = 0;
        while (i < p.hand.length) {
            if (mjIsFlower(p.hand[i])) {
                p.flowers.push(p.hand[i]);
                p.hand.splice(i, 1);
                var rep = mjDrawTile(seat);
                if (rep != null) p.hand.push(rep);
            } else { i++; }
        }
        p.flowers.sort(function (a, b) { return a - b; });
        mjSortSeat(seat);
    }

    function mjDeal() {
        MJ.wall = mjBuildWall();
        for (var s = 0; s < 4; s++) {
            MJ.players[s].hand = []; MJ.players[s].melds = []; MJ.players[s].discards = [];
            MJ.players[s].flowers = []; MJ.players[s].lastDraw = null;
            for (var k = 0; k < 13; k++) MJ.players[s].hand.push(MJ.wall.pop());
        }
        // replace any flowers dealt into starting hands (E first, then S/W/N)
        for (var s2 = 0; s2 < 4; s2++) mjNormalizeFlowers(s2);
        MJ.dealer = 0; MJ.turn = 0; MJ.phase = 'draw';
        MJ.lastDiscard = null;
        entGameOver = false;
        MJ.claimOptionsForMe = null;
        MJ.pending = null;
        MJ.winDetail = null;
        MJ.winMsg = null;
        MJ.winnerSeat = null;
    }

    function mjStart(opts) {
        opts = opts || {};
        entGame = 'mahjong'; entGameOver = false;
        if (MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }
        if (!MJ.scores) MJ.scores = [0, 0, 0, 0];   // running totals persist across deals

        if (entMode === 'online' && MJ.isHost) {
            // seats already configured by host lobby (mjOnlineStart)
            mjDeal();
            mjApplyHostSeatRoles();
            mjRender();
            mjBroadcastState();
            mjBeginTurn();
            return;
        }
        if (entMode === 'online' && !MJ.isHost) {
            // guest: nothing to deal, just wait for state broadcasts
            mjRender();
            return;
        }

        // offline (ai / local)
        var humans = Math.max(1, Math.min(4, opts.humans || 1));
        MJ.online = false; MJ.isHost = false; MJ.mySeat = 0; MJ.localViewSeat = 0;
        MJ.players = mjFreshPlayers();
        for (var s = 0; s < 4; s++) {
            MJ.players[s].ai = (s >= humans);
            MJ.players[s].name = MJ.players[s].ai ? ('Computer ' + s) : (humans === 1 ? 'You' : ('Player ' + (s + 1)));
        }
        mjDeal();
        mjBeginTurn();
    }

    function mjApplyHostSeatRoles() {
        // MJ.seatClient maps seat->clientId for remote humans; seat 0 = host human
        for (var s = 0; s < 4; s++) {
            var isHuman = (s === 0) || (MJ.seatClient && MJ.seatClient[s]);
            MJ.players[s].ai = !isHuman;
            MJ.players[s].name = (s === 0) ? 'You (Host)' : (MJ.seatClient && MJ.seatClient[s] ? ('Player ' + (s + 1)) : ('Computer ' + s));
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  MAHJONG — turn flow
    // ════════════════════════════════════════════════════════════════
    function mjBeginTurn() {
        if (entGameOver) return;
        if (MJ.online && !MJ.isHost) return;   // guests are driven by broadcasts
        if (MJ.wall.length === 0) { mjDrawGame(); return; }

        var seat = MJ.turn;
        var p = MJ.players[seat];
        var tile = mjDrawTile(seat);           // auto-collects flowers + draws replacement
        if (tile == null) { mjDrawGame(); return; }
        p.hand.push(tile); p.lastDraw = tile; mjSortSeat(seat);
        MJ.phase = 'discard';

        if (MJ.online && MJ.isHost) mjBroadcastState();

        if (p.ai) {
            mjRender();
            MJ.turnTimer = setTimeout(function () { mjAiTurn(seat); }, 750);
            return;
        }
        // human seat
        if (MJ.online) {
            if (seat === MJ.mySeat) { mjRender(); }   // my turn — render shows clickable hand
            else { mjRender(); }                      // remote human; host waits for their action
        } else {
            mjLocalRevealGate(seat, function () { mjRender(); });
        }
    }

    function mjLocalRevealGate(seat, cb) {
        // hot-seat privacy: when control passes to a different human, hide & require a tap
        if (entMode !== 'local' || mjHumanCount() <= 1 || seat === MJ.localViewSeat) {
            MJ.localViewSeat = seat; cb(); return;
        }
        var wrap = g('entBoardWrap'); if (!wrap) { MJ.localViewSeat = seat; cb(); return; }
        wrap.innerHTML =
            '<div class="mj-gate">' +
              '<div class="mj-gate-card">' +
                '<div class="mj-gate-icon">🀄</div>' +
                '<h3>Pass the device to ' + mjSeatName(seat) + '</h3>' +
                '<p>Make sure other players aren\'t looking.</p>' +
                '<button class="ent-mode-btn" id="mjGateBtn">👀 Reveal my hand</button>' +
              '</div>' +
            '</div>';
        g('mjGateBtn').onclick = function () { MJ.localViewSeat = seat; cb(); };
    }

    function mjHumanCount() {
        var n = 0; for (var s = 0; s < 4; s++) if (!MJ.players[s].ai) n++; return n;
    }

    // — perform a discard (host/offline authoritative) —
    function mjDoDiscard(seat, tile) {
        var p = MJ.players[seat];
        var i = p.hand.indexOf(tile);
        if (i < 0) return;
        p.hand.splice(i, 1);
        p.lastDraw = null;
        p.discards.push(tile);
        MJ.lastDiscard = { tile: tile, seat: seat };
        MJ.phase = 'claim';
        MJ.claimOptionsForMe = null;
        mjRender();
        if (MJ.online && MJ.isHost) mjBroadcastState();
        mjAfterDiscard(seat, tile);
    }

    // — human clicks a tile to discard —
    function mjHumanDiscard(seat, tile) {
        if (MJ.phase !== 'discard' || MJ.turn !== seat) return;
        if (MJ.online && !MJ.isHost) {
            if (seat !== MJ.mySeat) return;
            mjGuestSend({ action: 'discard', seat: seat, tile: tile });
            MJ.phase = 'wait';   // prevent double-send
            mjRender();
            return;
        }
        mjDoDiscard(seat, tile);
    }

    function mjAiTurn(seat) {
        if (entGameOver) return;
        var p = MJ.players[seat];
        if (mjHandIsWin(p)) { mjWin(seat, null, null); return; }
        // self (concealed) kong for honors if holding 4
        var cnt = mjCount(p.hand);
        for (var t = 27; t < 34; t++) {
            if (cnt[t] === 4) {
                mjRemoveN(p.hand, t, 4);
                p.melds.push({ type: 'kong', tiles: [t, t, t, t], from: seat, concealed: true });
                mjRender();
                if (MJ.online && MJ.isHost) mjBroadcastState();
                var rt = mjDrawTile(seat); if (rt != null) { p.hand.push(rt); p.lastDraw = rt; mjSortSeat(seat); }
                if (mjHandIsWin(p)) { mjWin(seat, null, null); return; }
                break;
            }
        }
        var tile = mjAiChooseDiscard(p);
        mjDoDiscard(seat, tile);
    }

    function mjTileScore(cnt, t) {
        var s = 0;
        if (cnt[t] >= 3) s += 100; else if (cnt[t] === 2) s += 45; else s += 4;
        if (t < 27) {
            var v = t % 9;
            if (v >= 1 && cnt[t - 1]) s += 16;
            if (v <= 7 && cnt[t + 1]) s += 16;
            if (v >= 2 && cnt[t - 2]) s += 8;
            if (v <= 6 && cnt[t + 2]) s += 8;
            if (v === 0 || v === 8) s -= 2;          // terminals slightly less useful
        } else {
            if (cnt[t] === 1) s -= 6;                // lone honor = good discard
        }
        return s;
    }
    function mjAiChooseDiscard(p) {
        var cnt = mjCount(p.hand);
        var best = null, bestScore = Infinity;
        for (var i = 0; i < p.hand.length; i++) {
            var t = p.hand[i];
            var sc = mjTileScore(cnt, t) + Math.random() * 0.5;
            if (sc < bestScore) { bestScore = sc; best = t; }
        }
        return best != null ? best : p.hand[p.hand.length - 1];
    }

    // ── claim resolution ───────────────────────────────────────────
    function mjAfterDiscard(discarder, tile) {
        if (MJ.online && !MJ.isHost) return;  // guests never resolve

        var optsPerSeat = {};
        var aiBest = null;
        for (var s = 0; s < 4; s++) {
            if (s === discarder) continue;
            var o = mjClaimOptions(s, tile, discarder);
            if (!mjHasAnyClaim(o)) continue;
            optsPerSeat[s] = o;
            if (MJ.players[s].ai) {
                var d = mjAiClaim(s, tile, o);
                if (d && (!aiBest || mjClaimRank(d.type) > mjClaimRank(aiBest.type))) aiBest = d;
            }
        }

        if (MJ.online && MJ.isHost) {
            mjHostOpenClaimWindow(discarder, tile, optsPerSeat, aiBest);
            return;
        }

        // offline: which seats can THIS device claim for?
        var mine = mjControllableClaimSeats().filter(function (s) {
            return s !== discarder && optsPerSeat[s] && mjHasAnyClaim(optsPerSeat[s]);
        });
        if (mine.length) {
            mjShowClaimBar(discarder, tile, optsPerSeat[mine[0]], aiBest);
        } else {
            mjFinalizeClaim(discarder, tile, aiBest);
        }
    }

    function mjShowClaimBar(discarder, tile, myOpts, aiBest) {
        MJ.claimOptionsForMe = { discarder: discarder, tile: tile, opts: myOpts, aiBest: aiBest };
        mjRenderActionBar();
        if (MJ.claimTimer) clearTimeout(MJ.claimTimer);
        MJ.claimTimer = setTimeout(function () {
            MJ.claimOptionsForMe = null;
            mjFinalizeClaim(discarder, tile, aiBest);  // timed-out → pass
        }, 6000);
    }

    // human picked a claim from the bar (offline path)
    function mjHumanClaim(choice) {
        var info = MJ.claimOptionsForMe;
        if (!info) return;
        if (MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }
        MJ.claimOptionsForMe = null;

        if (MJ.online && !MJ.isHost) {
            mjGuestSend({ action: 'claim', seat: MJ.mySeat, choice: choice });
            mjRenderActionBar();
            return;
        }
        if (MJ.online && MJ.isHost && info.hostLocal) {
            mjRenderActionBar();
            mjHostLocalClaim(choice);
            return;
        }
        // offline: resolve human vs aiBest by priority
        var human = choice ? { seat: info.opts.seat, type: choice.type, chow: choice.chow } : null;
        var winner = mjPickClaim(human, info.aiBest);
        mjFinalizeClaim(info.discarder, info.tile, winner);
    }

    function mjPickClaim(a, b) {
        if (!a) return b; if (!b) return a;
        return mjClaimRank(a.type) >= mjClaimRank(b.type) ? a : b;
    }

    function mjFinalizeClaim(discarder, tile, claim) {
        MJ.claimOptionsForMe = null;
        if (MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }

        if (!claim) {
            MJ.turn = (discarder + 1) % 4;
            mjBeginTurn();
            return;
        }

        // pull the claimed tile out of the discarder's pile
        if (MJ.players[discarder].discards.length &&
            MJ.players[discarder].discards[MJ.players[discarder].discards.length - 1] === tile) {
            MJ.players[discarder].discards.pop();
        }
        var p = MJ.players[claim.seat];

        if (claim.type === 'ron') {
            p.hand.push(tile); mjSortSeat(claim.seat);
            mjWin(claim.seat, tile, discarder);
            return;
        }
        if (claim.type === 'kong') {
            mjRemoveN(p.hand, tile, 3);
            p.melds.push({ type: 'kong', tiles: [tile, tile, tile, tile], from: discarder });
            MJ.turn = claim.seat;
            var rtk = mjDrawTile(claim.seat); if (rtk != null) { p.hand.push(rtk); p.lastDraw = rtk; mjSortSeat(claim.seat); }
            MJ.phase = 'discard';
            mjAfterClaimAct(claim.seat);
            return;
        }
        if (claim.type === 'pung') {
            mjRemoveN(p.hand, tile, 2);
            p.melds.push({ type: 'pung', tiles: [tile, tile, tile], from: discarder });
            MJ.turn = claim.seat; MJ.phase = 'discard';
            mjAfterClaimAct(claim.seat);
            return;
        }
        if (claim.type === 'chow') {
            var pr = claim.chow;
            mjRemoveN(p.hand, pr[0], 1); mjRemoveN(p.hand, pr[1], 1);
            var tiles = [pr[0], pr[1], tile].sort(function (a, b) { return a - b; });
            p.melds.push({ type: 'chow', tiles: tiles, from: discarder });
            MJ.turn = claim.seat; MJ.phase = 'discard';
            mjAfterClaimAct(claim.seat);
            return;
        }
    }

    // after a pung/chow/kong the claimer must discard (no fresh draw for pung/chow)
    function mjAfterClaimAct(seat) {
        var p = MJ.players[seat];
        mjRender();
        if (MJ.online && MJ.isHost) mjBroadcastState();
        if (p.ai) {
            MJ.turnTimer = setTimeout(function () {
                if (mjHandIsWin(p)) { mjWin(seat, null, null); return; }
                mjDoDiscard(seat, mjAiChooseDiscard(p));
            }, 750);
            return;
        }
        if (MJ.online) { if (seat === MJ.mySeat) mjRender(); }
        else { mjLocalRevealGate(seat, function () { mjRender(); }); }
    }

    function mjWin(seat, tile, fromSeat) {
        entGameOver = true;
        MJ.phase = 'over';
        if (MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }

        var selfDraw = (fromSeat == null);
        var sc = mjScoreHand(MJ.players[seat], seat, selfDraw);
        var fan = sc.fan;
        if (!MJ.scores) MJ.scores = [0, 0, 0, 0];
        if (selfDraw) {
            for (var s = 0; s < 4; s++) if (s !== seat) { MJ.scores[s] -= fan; MJ.scores[seat] += fan; }
        } else {
            MJ.scores[seat] += 3 * fan; MJ.scores[fromSeat] -= 3 * fan;
        }

        var how = selfDraw ? 'self-draw 自摸' : ('ron off ' + mjSeatName(fromSeat));
        MJ.winMsg = '🀄 ' + mjSeatName(seat) + ' wins! ' + fan + ' fan (' + how + ')';
        MJ.winDetail = sc.pats;
        MJ.winnerSeat = seat;
        mjRender();
        var st = g('entGameStatus'); if (st) st.textContent = MJ.winMsg;
        if (MJ.online && MJ.isHost) mjBroadcastState();

        // Hall of Fame: record only when the local human is the winner
        var localWin = MJ.online ? (seat === MJ.mySeat) : !MJ.players[seat].ai;
        if (localWin) entRecordAndToast('mahjong', fan, fan + ' fan' + (selfDraw ? ' 自摸' : ''));
    }

    function mjDrawGame() {
        entGameOver = true;
        MJ.phase = 'over';
        MJ.winMsg = '🀫 Draw — the wall is empty. No winner.';
        mjRender();
        var st = g('entGameStatus'); if (st) st.textContent = MJ.winMsg;
        if (MJ.online && MJ.isHost) mjBroadcastState();
    }

    // ════════════════════════════════════════════════════════════════
    //  MAHJONG — rendering (Yahoo-style table)
    // ════════════════════════════════════════════════════════════════
    function mjTileHTML(t, cls, dataIdx) {
        var face = mjGlyph(t);
        var honor = t >= 27 ? ' mj-tile-honor' : '';
        return '<span class="mj-tile' + honor + (cls ? ' ' + cls : '') + '"' +
               (dataIdx != null ? ' data-idx="' + dataIdx + '"' : '') + '>' + face + '</span>';
    }
    function mjBackHTML(n, vertical) {
        var s = '';
        for (var i = 0; i < n; i++) s += '<span class="mj-tile mj-back' + (vertical ? ' mj-back-v' : '') + '">🀫</span>';
        return s;
    }
    function mjMeldsHTML(melds) {
        if (!melds.length) return '';
        var h = '<div class="mj-melds">';
        melds.forEach(function (m) {
            h += '<span class="mj-meld">';
            m.tiles.forEach(function (t) { h += mjTileHTML(t, 'mj-tile-sm'); });
            h += '</span>';
        });
        return h + '</div>';
    }
    function mjDiscardsHTML(discards) {
        var h = '<div class="mj-discards">';
        discards.forEach(function (t) { h += mjTileHTML(t, 'mj-tile-sm'); });
        return h + '</div>';
    }
    function mjFlowersHTML(flowers) {
        if (!flowers || !flowers.length) return '';
        var h = '<div class="mj-flowers" title="Flowers / Seasons">';
        flowers.forEach(function (t) { h += mjTileHTML(t, 'mj-tile-sm mj-flower'); });
        return h + '</div>';
    }

    function mjPlayerZoneHTML(seat, pos, revealed, clickable) {
        var p = MJ.players[seat];
        var isTurn = (MJ.turn === seat && !entGameOver);
        var score = (MJ.scores && MJ.scores[seat] != null) ? MJ.scores[seat] : 0;
        var scoreCls = score > 0 ? ' mj-score-pos' : (score < 0 ? ' mj-score-neg' : '');
        var head =
            '<div class="mj-pname' + (isTurn ? ' mj-turn' : '') + (seat === MJ.winnerSeat && entGameOver ? ' mj-winner' : '') + '">' +
                (isTurn ? '▶ ' : '') + mjSeatName(seat) +
                ' <span class="mj-pcount">(' + p.hand.length + ')</span>' +
                ' <span class="mj-pscore' + scoreCls + '">💰 ' + score + '</span>' +
            '</div>';

        var handHTML;
        if (revealed || entGameOver) {
            handHTML = '<div class="mj-hand">';
            for (var i = 0; i < p.hand.length; i++) {
                var isDraw = (p.lastDraw === p.hand[i]);
                handHTML += mjTileHTML(p.hand[i], (clickable ? 'mj-clickable' : '') + (isDraw ? ' mj-justdrawn' : ''), clickable ? i : null);
            }
            handHTML += '</div>';
        } else {
            var vertical = (pos === 'left' || pos === 'right');
            handHTML = '<div class="mj-hand mj-hand-hidden">' + mjBackHTML(p.hand.length, vertical) + '</div>';
        }

        return '<div class="mj-zone mj-zone-' + pos + '" data-seat="' + seat + '">' +
                   head + mjFlowersHTML(p.flowers) + mjMeldsHTML(p.melds) + mjDiscardsHTML(p.discards) + handHTML +
               '</div>';
    }

    function mjRender() {
        var wrap = g('entBoardWrap'); if (!wrap) return;
        if (!MJ.players) { wrap.innerHTML = '<div class="mj-wait">Setting up table…</div>'; return; }

        var vs = mjViewSeat();
        var posOf = ['bottom', 'right', 'top', 'left'];
        var zones = { bottom: '', right: '', top: '', left: '' };
        for (var s = 0; s < 4; s++) {
            var rel = (s - vs + 4) % 4;
            var pos = posOf[rel];
            var revealed = (s === vs && !MJ.players[s].ai) || entGameOver;
            var clickable = (s === vs) && (mjMyActiveSeat() === s);
            zones[pos] = mjPlayerZoneHTML(s, pos, revealed, clickable);
        }

        var last = MJ.lastDiscard;
        var centerInfo =
            '<div class="mj-center">' +
                '<div class="mj-wallcount">🀫 Wall: ' + (MJ.wall ? MJ.wall.length : 0) + '</div>' +
                (last ? '<div class="mj-lastdiscard">' + mjSeatName(last.seat) + ' discarded' +
                        '<div class="mj-lastbig">' + mjTileHTML(last.tile) + '</div></div>'
                      : '<div class="mj-lastdiscard mj-muted">— no discard yet —</div>') +
                (entGameOver ? '<div class="mj-winbanner">' + (MJ.winMsg || '') +
                    (MJ.winDetail && MJ.winDetail.length ?
                        '<div class="mj-fanlist">' + MJ.winDetail.map(function (x) {
                            return '<span>' + x.name + ' <b>+' + x.fan + '</b></span>';
                        }).join('') + '</div>' : '') +
                    '</div>' : '') +
                '<div id="mjActionBar" class="mj-actionbar"></div>' +
            '</div>';

        wrap.innerHTML =
            '<div class="mj-table">' +
                '<div class="mj-row mj-row-top">' + zones.top + '</div>' +
                '<div class="mj-row mj-row-mid">' +
                    '<div class="mj-side">' + zones.left + '</div>' +
                    centerInfo +
                    '<div class="mj-side">' + zones.right + '</div>' +
                '</div>' +
                '<div class="mj-row mj-row-bottom">' + zones.bottom + '</div>' +
            '</div>';

        // wire clickable hand tiles (bottom / active seat)
        wrap.querySelectorAll('.mj-tile.mj-clickable[data-idx]').forEach(function (el) {
            el.addEventListener('click', function () {
                var seat = vs;
                var idx = parseInt(el.dataset.idx, 10);
                var tile = MJ.players[seat].hand[idx];
                mjHumanDiscard(seat, tile);
            });
        });

        mjRenderActionBar();
        mjUpdateStatus();
    }

    function mjUpdateStatus() {
        var st = g('entGameStatus'); if (!st) return;
        if (entGameOver) { st.textContent = MJ.winMsg || ''; return; }
        var seat = MJ.turn;
        var meTurn = (MJ.online ? seat === MJ.mySeat : !MJ.players[seat].ai && seat === mjViewSeat());
        if (MJ.phase === 'claim') { st.textContent = '⏳ Waiting for claims…'; return; }
        if (MJ.players[seat].ai) { st.textContent = mjSeatName(seat) + ' (computer) is thinking…'; return; }
        st.textContent = meTurn ? '🎴 Your turn — tap a tile to discard' : mjSeatName(seat) + '\'s turn';
    }

    function mjRenderActionBar() {
        var bar = g('mjActionBar'); if (!bar) return;
        bar.innerHTML = '';
        if (entGameOver) {
            bar.innerHTML = '<button class="mj-act-btn mj-act-restart" id="mjAgainBtn">🔄 New Deal</button>';
            var ab = g('mjAgainBtn');
            if (ab) ab.onclick = function () {
                if (MJ.online && !MJ.isHost) return;  // only host re-deals online
                mjStart({ humans: mjHumanCount() });
            };
            return;
        }

        // claim bar?
        if (MJ.claimOptionsForMe) {
            var o = MJ.claimOptionsForMe.opts;
            var html = '<div class="mj-claimbar"><span class="mj-claim-label">Claim ' +
                       mjGlyph(MJ.claimOptionsForMe.tile) + '?</span>';
            if (o.ron)  html += '<button class="mj-act-btn mj-act-win"  data-c="ron">🏆 Win</button>';
            if (o.kong) html += '<button class="mj-act-btn"            data-c="kong">Kong 槓</button>';
            if (o.pung) html += '<button class="mj-act-btn"            data-c="pung">Pung 碰</button>';
            o.chows.forEach(function (ch, i) {
                html += '<button class="mj-act-btn" data-c="chow" data-ci="' + i + '">Chow ' +
                        mjGlyph(ch[0]) + mjGlyph(ch[1]) + '</button>';
            });
            html += '<button class="mj-act-btn mj-act-pass" data-c="pass">Pass</button></div>';
            bar.innerHTML = html;
            bar.querySelectorAll('[data-c]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var c = btn.dataset.c;
                    if (c === 'pass') { mjHumanClaim(null); return; }
                    if (c === 'chow') { mjHumanClaim({ type: 'chow', chow: o.chows[parseInt(btn.dataset.ci, 10)] }); return; }
                    mjHumanClaim({ type: c });
                });
            });
            return;
        }

        // my discard-phase extras (tsumo / concealed kong)
        var seat = mjMyActiveSeat();
        if (seat != null && MJ.turn === seat && MJ.phase === 'discard') {
            var p = MJ.players[seat];
            var extra = '';
            if (mjHandIsWin(p)) extra += '<button class="mj-act-btn mj-act-win" id="mjTsumoBtn">🏆 Win (Tsumo)</button>';
            var cnt = mjCount(p.hand), kongs = [];
            for (var t = 0; t < 34; t++) if (cnt[t] === 4) kongs.push(t);
            kongs.forEach(function (t) {
                extra += '<button class="mj-act-btn mj-kong-btn" data-k="' + t + '">Kong ' + mjGlyph(t) + '</button>';
            });
            if (extra) bar.innerHTML = '<div class="mj-claimbar">' + extra + '</div>';
            var tb = g('mjTsumoBtn');
            if (tb) tb.onclick = function () {
                if (MJ.online && !MJ.isHost) { mjGuestSend({ action: 'tsumo', seat: seat }); return; }
                mjWin(seat, null, null);
            };
            bar.querySelectorAll('[data-k]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var t = parseInt(btn.dataset.k, 10);
                    if (MJ.online && !MJ.isHost) { mjGuestSend({ action: 'selfkong', seat: seat, tile: t }); return; }
                    mjSelfKong(seat, t);
                });
            });
        }
    }

    function mjSelfKong(seat, t) {
        var p = MJ.players[seat];
        mjRemoveN(p.hand, t, 4);
        p.melds.push({ type: 'kong', tiles: [t, t, t, t], from: seat, concealed: true });
        var rt = mjDrawTile(seat); if (rt != null) { p.hand.push(rt); p.lastDraw = rt; mjSortSeat(seat); }
        mjRender();
        if (MJ.online && MJ.isHost) mjBroadcastState();
        if (mjHandIsWin(p)) mjWin(seat, null, null);
    }

    // ════════════════════════════════════════════════════════════════
    //  MAHJONG — online (host-authoritative, Supabase broadcast)
    // ════════════════════════════════════════════════════════════════
    function mjOnlineRoomScreen() {
        var el = g('entModeSelectInner'); if (!el) return;
        el.innerHTML =
            '<h2 class="ent-mode-title">🌐 Mahjong Online</h2>' +
            '<p class="ent-mj-setup-sub">Host a table, share the code with people in your clinic. Empty seats are filled by computers.</p>' +
            '<div class="ent-online-opts">' +
              '<button class="ent-mode-btn" id="mjHostBtn">🏠 Host a Table</button>' +
              '<div class="ent-or-divider">— or —</div>' +
              '<div class="ent-join-row">' +
                '<input type="text" id="mjJoinCode" class="ent-code-input" placeholder="Room code" maxlength="6" autocomplete="off" spellcheck="false">' +
                '<button class="ent-mode-btn" id="mjJoinBtn">🚪 Join</button>' +
              '</div>' +
            '</div>' +
            '<div id="mjRoomMsg" class="ent-room-msg"></div>' +
            '<button class="ent-back-btn" id="mjOnlineBack">← Back</button>';
        showPanel('entModeSelect');
        g('mjHostBtn').onclick = mjHostTable;
        g('mjJoinBtn').onclick = function () {
            var code = String(g('mjJoinCode').value || '').trim().toUpperCase();
            if (!code) { g('mjRoomMsg').textContent = 'Please enter a room code.'; return; }
            mjJoinTable(code);
        };
        g('mjJoinCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') g('mjJoinBtn').click(); });
        g('mjOnlineBack').onclick = function () { showMahjongSetup(); };
    }

    function mjHostTable() {
        entMode = 'online';
        entRole = 'host';
        entRoomCode = randomCode();
        MJ.online = true; MJ.isHost = true; MJ.mySeat = 0;
        MJ.seatClient = {};   // seat -> clientId
        MJ.players = mjFreshPlayers();
        var msg = g('mjRoomMsg');
        function paintLobby() {
            var joined = Object.keys(MJ.seatClient).length;
            msg.innerHTML =
                '<p>Room code:</p><div class="ent-room-code-display">' + entRoomCode + '</div>' +
                '<p class="ent-wait-msg">👥 Players joined: ' + (1 + joined) + ' / 4 (you + ' + joined + ')</p>' +
                '<button class="ent-mode-btn" id="mjStartBtn">▶ Start Game</button>' +
                '<p class="ent-mj-setup-sub">Empty seats become computers.</p>';
            g('mjStartBtn').onclick = function () { startGame('mahjong', 'online', {}); };
        }
        paintLobby();
        openOnlineChannel(function (m) {
            if (m.mjType === 'join') {
                if (Object.values(MJ.seatClient).indexOf(m.clientId) === -1) {
                    var free = -1;
                    for (var s = 1; s < 4; s++) { if (!MJ.seatClient[s]) { free = s; break; } }
                    if (free > 0) {
                        MJ.seatClient[free] = m.clientId;
                        sendOnline({ mjType: 'seat', clientId: m.clientId, seat: free, code: entRoomCode });
                    }
                } else {
                    // re-announce seat for reconnect
                    for (var s2 in MJ.seatClient) if (MJ.seatClient[s2] === m.clientId)
                        sendOnline({ mjType: 'seat', clientId: m.clientId, seat: parseInt(s2, 10), code: entRoomCode });
                }
                if (!entGameOver && MJ.phase && MJ.phase !== 'idle' && MJ.players[0].hand.length) mjBroadcastState();
                else paintLobby();
            } else if (m.mjType === 'action') {
                mjHostHandleAction(m);
            }
        });
    }

    function mjJoinTable(code) {
        entMode = 'online';
        entRole = 'guest';
        entRoomCode = code;
        MJ.online = true; MJ.isHost = false; MJ.mySeat = null;
        g('mjRoomMsg').textContent = 'Connecting to room ' + code + '…';
        openOnlineChannel(function (m) {
            if (m.mjType === 'seat' && m.clientId === entClientId) {
                MJ.mySeat = m.seat;
                g('mjRoomMsg').innerHTML = '<p class="ent-wait-msg">✅ Joined as seat ' + (m.seat + 1) + '. Waiting for host to start…</p>';
            } else if (m.mjType === 'state') {
                mjApplyState(m.state);
            } else if (m.mjType === 'claim') {
                mjGuestClaimOffer(m);
            }
        });
        // (re)send join until the host assigns us a seat
        var tries = 0;
        sendOnline({ mjType: 'join', clientId: entClientId });
        var jt = setInterval(function () {
            if (MJ.mySeat != null || tries++ > 6) { clearInterval(jt); return; }
            sendOnline({ mjType: 'join', clientId: entClientId });
        }, 1200);
    }

    function mjGuestSend(data) {
        sendOnline(Object.assign({ mjType: 'action', clientId: entClientId, seat: MJ.mySeat }, data));
    }

    function mjHostHandleAction(m) {
        if (m.action === 'join_raw') return;
        var seat = m.seat;
        if (seat == null) return;
        // verify the client owns that seat
        if (MJ.seatClient[seat] !== m.clientId) return;

        if (m.action === 'discard') {
            if (MJ.turn === seat && MJ.phase === 'discard') mjDoDiscard(seat, m.tile);
        } else if (m.action === 'tsumo') {
            if (MJ.turn === seat && mjHandIsWin(MJ.players[seat])) mjWin(seat, null, null);
        } else if (m.action === 'selfkong') {
            if (MJ.turn === seat && MJ.phase === 'discard') mjSelfKong(seat, m.tile);
        } else if (m.action === 'claim') {
            mjHostReceiveClaim(seat, m.choice);
        }
    }

    // host opens a claim window: broadcast options, collect remote+local+ai, resolve on timeout
    function mjHostOpenClaimWindow(discarder, tile, optsPerSeat, aiBest) {
        MJ.pending = { discarder: discarder, tile: tile, optsPerSeat: optsPerSeat, aiBest: aiBest, claims: {} };

        // any human seats with options? (host seat 0 or remote seats)
        var humanSeatsWithOpts = [];
        for (var s in optsPerSeat) {
            s = parseInt(s, 10);
            if (!MJ.players[s].ai) humanSeatsWithOpts.push(s);
        }
        if (!humanSeatsWithOpts.length) { mjFinalizeClaim(discarder, tile, aiBest); return; }

        // tell guests their options
        sendOnline({ mjType: 'claim', discarder: discarder, tile: tile, optsPerSeat: optsPerSeat });

        // host's own seat (0) claim bar
        if (optsPerSeat[0] && !MJ.players[0].ai) {
            MJ.claimOptionsForMe = { discarder: discarder, tile: tile, opts: optsPerSeat[0], aiBest: aiBest, hostLocal: true };
            mjRenderActionBar();
        }
        if (MJ.claimTimer) clearTimeout(MJ.claimTimer);
        MJ.claimTimer = setTimeout(function () { mjHostResolveWindow(); }, 6000);
    }

    function mjHostReceiveClaim(seat, choice) {
        if (!MJ.pending) return;
        MJ.pending.claims[seat] = choice;  // choice may be null (pass)
        // resolve early if a ron arrives
        if (choice && choice.type === 'ron') mjHostResolveWindow();
    }

    // host seat0's own claim (called from mjHumanClaim when hostLocal)
    function mjHostLocalClaim(choice) {
        if (!MJ.pending) return;
        MJ.pending.claims[0] = choice;
        if (choice && choice.type === 'ron') mjHostResolveWindow();
    }

    function mjHostResolveWindow() {
        if (!MJ.pending) return;
        if (MJ.claimTimer) { clearTimeout(MJ.claimTimer); MJ.claimTimer = null; }
        var pend = MJ.pending; MJ.pending = null;
        MJ.claimOptionsForMe = null;

        var winner = pend.aiBest;
        for (var s in pend.claims) {
            var ch = pend.claims[s];
            if (!ch) continue;
            var cand = { seat: parseInt(s, 10), type: ch.type, chow: ch.chow };
            winner = mjPickClaim(cand, winner);
        }
        mjFinalizeClaim(pend.discarder, pend.tile, winner);
    }

    // guest receives the claim offer
    function mjGuestClaimOffer(m) {
        var o = m.optsPerSeat[MJ.mySeat];
        if (!o || !mjHasAnyClaim(o)) { mjGuestSend({ action: 'claim', seat: MJ.mySeat, choice: null }); return; }
        MJ.claimOptionsForMe = { discarder: m.discarder, tile: m.tile, opts: o };
        mjRenderActionBar();
        // auto-pass after window so host isn't blocked
        if (MJ.claimTimer) clearTimeout(MJ.claimTimer);
        MJ.claimTimer = setTimeout(function () {
            if (MJ.claimOptionsForMe) { MJ.claimOptionsForMe = null; mjGuestSend({ action: 'claim', seat: MJ.mySeat, choice: null }); mjRenderActionBar(); }
        }, 5800);
    }

    // ── state (de)serialisation for online ─────────────────────────
    function mjBroadcastState() {
        if (!(MJ.online && MJ.isHost)) return;
        var st = {
            players: MJ.players.map(function (p) {
                return { seat: p.seat, hand: p.hand, melds: p.melds, discards: p.discards, flowers: p.flowers, ai: p.ai, name: p.name, lastDraw: p.lastDraw };
            }),
            turn: MJ.turn, phase: MJ.phase, wall: MJ.wall.length,
            lastDiscard: MJ.lastDiscard, over: entGameOver, winMsg: MJ.winMsg || '', winnerSeat: MJ.winnerSeat,
            scores: MJ.scores, winDetail: MJ.winDetail
        };
        sendOnline({ mjType: 'state', state: st });
    }

    function mjApplyState(st) {
        MJ.players = st.players.map(function (p) {
            return { seat: p.seat, hand: p.hand || [], melds: p.melds || [], discards: p.discards || [], flowers: p.flowers || [], ai: p.ai, name: p.name, lastDraw: p.lastDraw };
        });
        MJ.turn = st.turn; MJ.phase = st.phase;
        MJ.wall = new Array(st.wall || 0);   // only length matters for guests
        MJ.lastDiscard = st.lastDiscard;
        entGameOver = st.over; MJ.winMsg = st.winMsg; MJ.winnerSeat = st.winnerSeat;
        MJ.scores = st.scores || MJ.scores; MJ.winDetail = st.winDetail || null;
        entGame = 'mahjong'; entMode = 'online';

        // ensure we're on the game panel
        showPanel('entGameArea');
        var titleEl = g('entGameTitle'); if (titleEl) titleEl.textContent = GAME_NAMES.mahjong;
        var rb = g('entRestartBtn'); if (rb) rb.onclick = function () {}; // guests can't restart
        var xb = g('entExitBtn'); if (xb) xb.onclick = exitGame;

        MJ.claimOptionsForMe = MJ.claimOptionsForMe && MJ.phase === 'claim' ? MJ.claimOptionsForMe : null;
        mjRender();
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑪ TYPING OF THE CATS 打字貓 — first-person Chinese-pinyin shooter
    //     Evolved cat monsters charge at you; type the pinyin under each
    //     to blast it before it reaches your face. (Inspired by
    //     SEGA's "The Typing of the Dead".)
    // ════════════════════════════════════════════════════════════════
    var TY = null;
    var TY_CATS = ['🐱','😼','😾','🙀','😻','🐈','🐈‍⬛','😹','🦁','🐯'];

    // Word bank — Chinese glyph + the (toneless) pinyin the player must type.
    // The player types exactly the pinyin shown, so gameplay never depends on
    // pinyin matching an external standard.
    var TY_CHARS = [
        {w:'猫',p:'mao'},{w:'狗',p:'gou'},{w:'虎',p:'hu'},{w:'龙',p:'long'},{w:'蛇',p:'she'},
        {w:'马',p:'ma'},{w:'羊',p:'yang'},{w:'鸡',p:'ji'},{w:'鸟',p:'niao'},{w:'鱼',p:'yu'},
        {w:'虫',p:'chong'},{w:'牛',p:'niu'},{w:'兔',p:'tu'},{w:'鹿',p:'lu'},{w:'熊',p:'xiong'},
        {w:'狼',p:'lang'},{w:'豹',p:'bao'},{w:'象',p:'xiang'},{w:'蛙',p:'wa'},{w:'火',p:'huo'},
        {w:'水',p:'shui'},{w:'风',p:'feng'},{w:'雷',p:'lei'},{w:'电',p:'dian'},{w:'光',p:'guang'},
        {w:'刀',p:'dao'},{w:'剑',p:'jian'},{w:'拳',p:'quan'},{w:'打',p:'da'},{w:'杀',p:'sha'},
        {w:'跑',p:'pao'},{w:'跳',p:'tiao'},{w:'抓',p:'zhua'},{w:'咬',p:'yao'},{w:'爪',p:'zhao'},
        {w:'山',p:'shan'},{w:'河',p:'he'},{w:'海',p:'hai'},{w:'天',p:'tian'},{w:'地',p:'di'},
        {w:'云',p:'yun'},{w:'星',p:'xing'},{w:'月',p:'yue'},{w:'日',p:'ri'},{w:'木',p:'mu'},
        {w:'林',p:'lin'},{w:'森',p:'sen'},{w:'石',p:'shi'},{w:'金',p:'jin'},{w:'银',p:'yin'},
        {w:'铁',p:'tie'},{w:'雪',p:'xue'},{w:'冰',p:'bing'},{w:'烟',p:'yan'},{w:'花',p:'hua'},
        {w:'草',p:'cao'},{w:'叶',p:'ye'},{w:'果',p:'guo'},{w:'米',p:'mi'},{w:'茶',p:'cha'},
        {w:'酒',p:'jiu'},{w:'肉',p:'rou'},{w:'蛋',p:'dan'},{w:'糖',p:'tang'},{w:'油',p:'you'},
        {w:'人',p:'ren'},{w:'手',p:'shou'},{w:'脚',p:'jiao'},{w:'头',p:'tou'},{w:'眼',p:'yan'},
        {w:'耳',p:'er'},{w:'口',p:'kou'},{w:'心',p:'xin'},{w:'骨',p:'gu'},{w:'皮',p:'pi'},
        {w:'车',p:'che'},{w:'船',p:'chuan'},{w:'门',p:'men'},{w:'窗',p:'chuang'},{w:'桥',p:'qiao'},
        {w:'城',p:'cheng'},{w:'家',p:'jia'},{w:'王',p:'wang'},{w:'弓',p:'gong'},{w:'盾',p:'dun'},
        {w:'旗',p:'qi'},{w:'命',p:'ming'},{w:'死',p:'si'},{w:'生',p:'sheng'},{w:'爱',p:'ai'},
        {w:'恨',p:'hen'},{w:'怕',p:'pa'},{w:'笑',p:'xiao'},{w:'哭',p:'ku'},{w:'吼',p:'hou'},
        {w:'喊',p:'han'},{w:'追',p:'zhui'},{w:'躲',p:'duo'},{w:'防',p:'fang'},{w:'守',p:'shou'},
        {w:'冲',p:'chong'},{w:'闪',p:'shan'},{w:'逃',p:'tao'},{w:'毒',p:'du'},{w:'怒',p:'nu'}
    ];
    var TY_WORDS = [
        {w:'老鼠',p:'laoshu'},{w:'怪猫',p:'guaimao'},{w:'野猫',p:'yemao'},{w:'黑猫',p:'heimao'},
        {w:'利爪',p:'lizhua'},{w:'猫王',p:'maowang'},{w:'攻击',p:'gongji'},{w:'防御',p:'fangyu'},
        {w:'闪避',p:'shanbi'},{w:'逃跑',p:'taopao'},{w:'战斗',p:'zhandou'},{w:'危险',p:'weixian'},
        {w:'怪物',p:'guaiwu'},{w:'进化',p:'jinhua'},{w:'突变',p:'tubian'},{w:'喵喵',p:'miaomiao'},
        {w:'抓痕',p:'zhuahen'},{w:'尖牙',p:'jianya'},{w:'毒液',p:'duye'},{w:'嚎叫',p:'haojiao'},
        {w:'猎杀',p:'liesha'},{w:'暴走',p:'baozou'},{w:'凶猛',p:'xiongmeng'},{w:'敏捷',p:'minjie'},
        {w:'速度',p:'sudu'},{w:'力量',p:'liliang'},{w:'毛球',p:'maoqiu'},{w:'撕咬',p:'siyao'},
        {w:'喵叫',p:'miaojiao'},{w:'猫爪',p:'maozhua'},{w:'猫粮',p:'maoliang'},{w:'铲屎',p:'chanshi'},
        {w:'主人',p:'zhuren'},{w:'宠物',p:'chongwu'},{w:'撒娇',p:'sajiao'},{w:'打滚',p:'dagun'},
        {w:'舔毛',p:'tianmao'},{w:'磨爪',p:'mozhua'},{w:'捕猎',p:'bulie'},{w:'偷鱼',p:'touyu'},
        {w:'翻墙',p:'fanqiang'},{w:'夜行',p:'yexing'},{w:'潜行',p:'qianxing'},{w:'突袭',p:'tuxi'},
        {w:'包围',p:'baowei'},{w:'撤退',p:'chetui'},{w:'反攻',p:'fangong'},{w:'增援',p:'zengyuan'},
        {w:'治疗',p:'zhiliao'},{w:'复活',p:'fuhuo'},{w:'升级',p:'shengji'},{w:'装备',p:'zhuangbei'},
        {w:'武器',p:'wuqi'},{w:'护盾',p:'hudun'},{w:'魔法',p:'mofa'},{w:'火球',p:'huoqiu'},
        {w:'闪电',p:'shandian'},{w:'寒冰',p:'hanbing'},{w:'烈焰',p:'lieyan'},{w:'剧毒',p:'judu'},
        {w:'麻痹',p:'mabi'},{w:'眩晕',p:'xuanyun'},{w:'狂暴',p:'kuangbao'},{w:'隐身',p:'yinshen'},
        {w:'加速',p:'jiasu'},{w:'减速',p:'jiansu'},{w:'巨大',p:'juda'},{w:'锋利',p:'fengli'},
        {w:'坚硬',p:'jianying'},{w:'致命',p:'zhiming'},{w:'无敌',p:'wudi'},{w:'胜利',p:'shengli'},
        {w:'失败',p:'shibai'},{w:'挑战',p:'tiaozhan'},{w:'守护',p:'shouhu'},{w:'觉醒',p:'juexing'},
        {w:'黑暗',p:'heian'},{w:'光明',p:'guangming'},{w:'末日',p:'mori'},{w:'灾难',p:'zainan'},
        {w:'风暴',p:'fengbao'},{w:'海啸',p:'haixiao'},{w:'地震',p:'dizhen'},{w:'烈火',p:'liehuo'}
    ];
    var TY_PHRASES = [
        {w:'喵星人入侵',p:'miaoxingrenruqin'},{w:'进化的怪猫',p:'jinhuadeguaimao'},
        {w:'消灭所有敌人',p:'xiaomiesuoyoudiren'},{w:'危险正在逼近',p:'weixianzhengzaibijin'},
        {w:'守住最后防线',p:'shouzhuzuihoufangxian'},{w:'全力反击',p:'quanlifanji'},
        {w:'猫族大军压境',p:'maozudajunyajing'},{w:'不要让它靠近',p:'buyaorangtakaojin'},
        {w:'快速精准打击',p:'kuaisujingzhundaji'},{w:'击退变异猫群',p:'jituibianyimaoqun'},
        {w:'喵呜的怒吼',p:'miaowudenuhou'},{w:'尖牙利爪',p:'jianyalizhua'},
        {w:'保护铲屎官',p:'baohuchanshiguan'},{w:'别碰我的猫',p:'biepengwodemao'},
        {w:'投喂小鱼干',p:'touweixiaoyugan'},{w:'喵星舰队',p:'miaoxingjiandui'},
        {w:'终极进化形态',p:'zhongjijinhuaxingtai'},{w:'释放终极技能',p:'shifangzhongjijineng'},
        {w:'集中火力',p:'jizhonghuoli'},{w:'不留活口',p:'buliuhuokou'},
        {w:'全军出击',p:'quanjunchuji'},{w:'死守阵地',p:'sishouzhendi'},
        {w:'绝地反击',p:'juedifanji'},{w:'最后一战',p:'zuihouyizhan'},
        {w:'黎明的曙光',p:'limingdeshuguang'},{w:'黑夜降临',p:'heiyejianglin'},
        {w:'猫王降临',p:'maowangjianglin'},{w:'暗影突袭',p:'anyingtuxi'},
        {w:'雷霆万钧',p:'leitingwanjun'},{w:'横扫千军',p:'hengsaoqianjun'},
        {w:'寸步不让',p:'cunbuburang'},{w:'严阵以待',p:'yanzhenyidai'},
        {w:'力挽狂澜',p:'liwankuanglan'},{w:'一击必杀',p:'yijibisha'},
        {w:'势不可挡',p:'shibukedang'},{w:'九条命的猫',p:'jiutiaomingdemao'}
    ];
    var TY_BANK = { c: TY_CHARS, w: TY_WORDS, p: TY_PHRASES };
    var TY_PARAMS = {
        easy:      { spawn:2600, speed:0.0060, max:3, hp:5, pools:['c','c','w'] },
        medium:    { spawn:2100, speed:0.0086, max:4, hp:5, pools:['c','w','w'] },
        difficult: { spawn:1650, speed:0.0116, max:5, hp:5, pools:['w','w','p'] },
        master:    { spawn:1250, speed:0.0150, max:6, hp:4, pools:['w','p','p'] }
    };

    function initTyping(diff) {
        tyStopLoop();
        var d = diff || 'easy';
        var P = TY_PARAMS[d] || TY_PARAMS.easy;
        TY = {
            diff: d, params: P, hp: P.hp, maxhp: P.hp,
            score: 0, wave: 1, kills: 0, combo: 0, bestCombo: 0,
            monsters: [], nextId: 1, target: null, spawnAcc: 0,
            goodKeys: 0, errKeys: 0, totalKeys: 0, started: Date.now(),
            bossActive: false, boss: null, bossCount: 0
        };
        tyBuildScene();
        tyUpdateHud();
        var st = g('entGameStatus');
        if (st) st.textContent = 'Type the pinyin under each cat to blast it!';
    }

    function tyBuildScene() {
        var wrap = g('entBoardWrap'); if (!wrap) return;
        wrap.innerHTML =
            '<div class="ty-game">' +
                '<div class="ty-hud">' +
                    '<div class="ty-hp" id="tyHp"></div>' +
                    '<div class="ty-stats" id="tyStats"></div>' +
                '</div>' +
                '<div class="ty-scene" id="tyScene">' +
                    '<div class="ty-stars"></div>' +
                    '<div class="ty-fog"></div>' +
                    '<div class="ty-grid"></div>' +
                    '<div class="ty-horizon"></div>' +
                    '<div class="ty-dangerzone"></div>' +
                    '<div class="ty-crosshair">+</div>' +
                    '<div class="ty-reticle" id="tyReticle">◎</div>' +
                    '<div class="ty-gun" id="tyGun">🔫</div>' +
                    '<div class="ty-vignette" id="tyVignette"></div>' +
                    '<div class="ty-scanlines"></div>' +
                    '<div class="ty-wave-banner" id="tyWave"></div>' +
                '</div>' +
                '<div class="ty-console">' +
                    '<span class="ty-console-icon">⌨️</span>' +
                    '<input id="tyInput" class="ty-input" type="text" autocomplete="off" ' +
                        'autocorrect="off" autocapitalize="off" spellcheck="false" ' +
                        'placeholder="輸入中文（任何輸入法）或拼音…  Type Chinese (any IME) or pinyin…">' +
                '</div>' +
                '<div class="ty-hint">Use <b>any Chinese input method</b> to type the characters, ' +
                    'or just type the <b>pinyin</b> shown. First key locks on the nearest cat · <b>Esc</b> cancels.</div>' +
            '</div>';
    }

    function tyPickWord() {
        var pools = TY.params.pools;
        var pool = pools[Math.floor(Math.random() * pools.length)];
        var bank = TY_BANK[pool] || TY_CHARS;
        return bank[Math.floor(Math.random() * bank.length)];
    }

    function tyFind(id) {
        for (var i = 0; i < TY.monsters.length; i++) if (TY.monsters[i].id === id) return TY.monsters[i];
        return null;
    }

    function tySpawn() {
        if (TY.bossActive) return;   // focus the duel while a boss is on screen
        if (TY.monsters.length >= TY.params.max) return;
        var e = tyPickWord();
        var waveBoost = 1 + (TY.wave - 1) * 0.06;
        var m = {
            id: TY.nextId++, w: e.w,
            p: e.p.toLowerCase().replace(/[^a-z]/g, ''), typed: 0, cnTyped: 0,
            x: 12 + Math.random() * 76, depth: 0,
            speed: TY.params.speed * (0.8 + Math.random() * 0.5) * waveBoost,
            emoji: TY_CATS[Math.floor(Math.random() * TY_CATS.length)],
            dead: false, el: null
        };
        TY.monsters.push(m);
        tyCreateEl(m);
    }

    function tyCreateEl(m) {
        var sc = g('tyScene'); if (!sc) return;
        var d = document.createElement('div');
        d.className = 'ty-monster' + (m.isBoss ? ' ty-boss' : '');
        d.dataset.id = m.id;
        var inner = '';
        if (m.isBoss) inner += '<div class="ty-bosshp"></div>';
        inner += '<div class="ty-wordbox"></div>';
        if (m.isBoss) inner += '<div class="ty-crown">👑</div>';
        inner += '<div class="ty-cat' + (m.isBoss ? ' ty-bosscat' : '') + '">' + m.emoji + '</div>';
        d.innerHTML = inner;
        m.el = d;
        sc.appendChild(d);
        tyPositionEl(m);
        tyUpdateMonster(m);
        if (m.isBoss) tyUpdateBossHp(m);
    }

    function tyPositionEl(m) {
        if (!m.el) return;
        var d = m.depth;
        var scale = (0.5 + d * 1.2) * (m.isBoss ? 1.8 : 1);
        var top = 14 + d * 60;
        m.el.style.left = m.x + '%';
        m.el.style.top = top + '%';
        m.el.style.transform = 'translate(-50%,-50%) scale(' + scale.toFixed(3) + ')';
        m.el.style.zIndex = String((m.isBoss ? 180 : 100) + Math.round(d * 100));
        m.el.classList.toggle('ty-near', d > 0.72);
    }

    function tyUpdateMonster(m) {
        if (!m.el) return;
        var wb = m.el.querySelector('.ty-wordbox'); if (!wb) return;
        var isTarget = TY.target === m.id;
        var cn = '', i;
        for (i = 0; i < m.w.length; i++) {
            var ccls = i < m.cnTyped ? 'ty-done' : (i === m.cnTyped && isTarget) ? 'ty-cur' : '';
            cn += '<span class="ty-cchar ' + ccls + '">' + m.w[i] + '</span>';
        }
        var py = '';
        for (i = 0; i < m.p.length; i++) {
            var pcls = i < m.typed ? 'ty-done' : (i === m.typed && isTarget) ? 'ty-cur' : '';
            py += '<span class="ty-pchar ' + pcls + '">' + m.p[i] + '</span>';
        }
        wb.innerHTML = '<div class="ty-cn">' + cn + '</div><div class="ty-py">' + py + '</div>';
        m.el.classList.toggle('ty-targeted', isTarget);
    }

    function tyRefreshAll() { for (var i = 0; i < TY.monsters.length; i++) tyUpdateMonster(TY.monsters[i]); }

    function tyUpdateHud() {
        var hp = g('tyHp');
        if (hp) { var s = ''; for (var i = 0; i < TY.maxhp; i++) s += (i < TY.hp ? '❤️' : '🖤'); hp.innerHTML = s; }
        var st = g('tyStats');
        if (st) st.innerHTML = '🎯 <b>' + TY.score + '</b> &nbsp; 💥 ' + TY.kills +
            ' &nbsp; 🔥 x' + TY.combo + ' &nbsp; 🌊 Wave ' + TY.wave;
    }

    function tyFloatScore(m, pts) {
        var sc = g('tyScene'); var pos = tyScenePos(m); if (!sc || !pos) return;
        var f = document.createElement('div');
        f.className = 'ty-float';
        f.textContent = '+' + pts;
        f.style.left = pos.x + 'px';
        f.style.top = pos.y + 'px';
        if (TY.combo >= 3) { f.classList.add('ty-float-big'); f.textContent = '+' + pts + '  x' + TY.combo + '🔥'; }
        sc.appendChild(f);
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 800);
    }

    // ── visual FX ───────────────────────────────────────────────────
    function tyTopPct(d) { return 14 + d * 60; }
    function tyScenePos(m) {
        var sc = g('tyScene'); if (!sc) return null;
        var w = sc.clientWidth, h = sc.clientHeight;
        return { x: m.x / 100 * w, y: tyTopPct(m.depth) / 100 * h, w: w, h: h };
    }

    function tyBeam(m) {
        var sc = g('tyScene'); var pos = tyScenePos(m); if (!sc || !pos) return;
        var gx = pos.w / 2, gy = pos.h - 12;
        var dx = pos.x - gx, dy = pos.y - gy;
        var len = Math.sqrt(dx * dx + dy * dy);
        var ang = Math.atan2(dy, dx) * 180 / Math.PI;
        var b = document.createElement('div');
        b.className = 'ty-beam';
        b.style.left = gx + 'px'; b.style.top = gy + 'px';
        b.style.width = len + 'px';
        b.style.transform = 'rotate(' + ang.toFixed(2) + 'deg)';
        sc.appendChild(b);
        var fl = document.createElement('div');
        fl.className = 'ty-muzzle';
        fl.style.left = gx + 'px'; fl.style.top = gy + 'px';
        sc.appendChild(fl);
        var gun = g('tyGun');
        if (gun) { gun.classList.add('ty-fire'); setTimeout(function () { gun.classList.remove('ty-fire'); }, 130); }
        setTimeout(function () { if (b.parentNode) b.remove(); if (fl.parentNode) fl.remove(); }, 200);
    }

    var TY_SPARK = ['#ffd33d', '#ff7043', '#4ee07a', '#5b8dee', '#ffffff', '#ff5fa2'];
    function tyExplode(m) {
        var sc = g('tyScene'); var pos = tyScenePos(m); if (!sc || !pos) return;
        for (var i = 0; i < 12; i++) {
            var p = document.createElement('div');
            p.className = 'ty-particle';
            var a = Math.random() * Math.PI * 2, dist = 22 + Math.random() * 52;
            p.style.left = pos.x + 'px'; p.style.top = pos.y + 'px';
            p.style.setProperty('--dx', (Math.cos(a) * dist).toFixed(1) + 'px');
            p.style.setProperty('--dy', (Math.sin(a) * dist).toFixed(1) + 'px');
            p.style.background = TY_SPARK[i % TY_SPARK.length];
            sc.appendChild(p);
            (function (el) { setTimeout(function () { if (el.parentNode) el.remove(); }, 640); })(p);
        }
        var boom = document.createElement('div');
        boom.className = 'ty-boomicon'; boom.textContent = '💥';
        boom.style.left = pos.x + 'px'; boom.style.top = pos.y + 'px';
        sc.appendChild(boom);
        setTimeout(function () { if (boom.parentNode) boom.remove(); }, 420);
    }

    function tyUpdateReticle() {
        var ret = g('tyReticle'); if (!ret || !TY) return;
        var tm = TY.target != null ? tyFind(TY.target) : null;
        if (tm && !tm.dead) {
            var pos = tyScenePos(tm);
            if (pos) { ret.style.left = pos.x + 'px'; ret.style.top = pos.y + 'px'; ret.classList.add('show'); }
        } else ret.classList.remove('show');
    }

    function tyDamageFlash() {
        var v = g('tyVignette');
        if (v) { v.classList.add('ty-hit'); setTimeout(function () { v.classList.remove('ty-hit'); }, 360); }
    }

    function tyBanner(text, boss) {
        var wb = g('tyWave'); if (!wb) return;
        wb.textContent = text;
        wb.classList.toggle('ty-boss-banner', !!boss);
        wb.classList.remove('show'); void wb.offsetWidth; wb.classList.add('show');
    }
    function tyWaveBanner(n) { tyBanner('🌊 WAVE ' + n, false); }

    // ── BOSS CATS ───────────────────────────────────────────────────
    var TY_BOSS = ['😾','🦁','🐯','🐲','👺','🦹'];
    function tyPickPhrases(n) {
        var pool = TY_PHRASES.slice(), out = [];
        for (var i = 0; i < n && pool.length; i++) {
            out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        }
        return out;
    }
    function tyUpdateBossHp(m) {
        if (!m.el) return;
        var bar = m.el.querySelector('.ty-bosshp'); if (!bar) return;
        var remaining = m.hpMax - m.seg, s = '';
        for (var i = 0; i < m.hpMax; i++) s += (i < remaining ? '🟥' : '⬛');
        bar.innerHTML = s;
    }
    function tySpawnBoss() {
        TY.bossActive = true; TY.bossCount++;
        var segs = tyPickPhrases(3);
        var first = segs[0];
        var m = {
            id: TY.nextId++, isBoss: true, segments: segs, seg: 0, hpMax: segs.length,
            w: first.w, p: first.p.toLowerCase().replace(/[^a-z]/g, ''), typed: 0, cnTyped: 0,
            x: 50, depth: 0, speed: TY.params.speed * 0.5 * (1 + (TY.wave - 1) * 0.04),
            emoji: TY_BOSS[Math.floor(Math.random() * TY_BOSS.length)], dead: false, el: null
        };
        TY.monsters.push(m); TY.boss = m;
        tyCreateEl(m);
        tyBanner('⚠️ BOSS CAT INCOMING!', true);
    }

    function tyBossSegmentDone(m) {
        TY.combo++;
        if (TY.combo > TY.bestCombo) TY.bestCombo = TY.combo;
        var pts = 35 + TY.combo * 4;
        TY.score += pts;
        tyBeam(m); tyExplode(m); tyFloatScore(m, pts); tyComboPop();
        m.depth = Math.max(0.05, m.depth - 0.10);   // knockback
        if (m.el) { m.el.classList.add('ty-bosshurt'); var el0 = m.el; setTimeout(function () { if (el0) el0.classList.remove('ty-bosshurt'); }, 240); }
        m.seg++;
        if (m.seg >= m.hpMax) { tyBossDefeated(m); return; }
        var nxt = m.segments[m.seg];
        m.w = nxt.w; m.p = nxt.p.toLowerCase().replace(/[^a-z]/g, ''); m.typed = 0; m.cnTyped = 0;
        tyUpdateMonster(m); tyUpdateBossHp(m); tyUpdateReticle();
    }

    function tyBossDefeated(m) {
        m.dead = true;
        TY.kills++;
        var pts = 150 + TY.combo * 10;
        TY.score += pts;
        if (TY.target === m.id) TY.target = null;
        // spectacular finish
        tyExplode(m); tyBeam(m);
        var pos = tyScenePos(m);
        if (pos) for (var k = 0; k < 3; k++) (function (kk) {
            setTimeout(function () { if (m.el) tyExplode(m); }, kk * 90);
        })(k);
        tyFloatScore(m, pts);
        tyBanner('💀 BOSS DOWN!  +' + pts, true);
        if (TY.hp < TY.maxhp) TY.hp++;   // reward: heal one heart
        if (m.el) { m.el.classList.add('ty-dead'); var el = m.el; setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 400); }
        var idx = TY.monsters.indexOf(m);
        if (idx >= 0) TY.monsters.splice(idx, 1);
        TY.bossActive = false; TY.boss = null;
        tyUpdateHud(); tyUpdateReticle();
    }

    function tyBossReach(m) {
        m.dead = true;
        TY.hp -= 2; TY.combo = 0;
        if (TY.target === m.id) TY.target = null;
        var sc = g('tyScene'); if (sc) { sc.classList.add('ty-shake'); setTimeout(function () { sc.classList.remove('ty-shake'); }, 450); }
        tyDamageFlash();
        if (m.el) { var el = m.el; el.classList.add('ty-reach'); setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 300); }
        var idx = TY.monsters.indexOf(m);
        if (idx >= 0) TY.monsters.splice(idx, 1);
        TY.bossActive = false; TY.boss = null;
        tyUpdateHud(); tyUpdateReticle();
        if (TY.hp <= 0) tyGameOver();
    }

    function tyWordComplete(m) { if (m.isBoss) tyBossSegmentDone(m); else tyKill(m); }

    function tyComboPop() {
        var st = g('tyStats'); if (!st) return;
        st.classList.remove('ty-pop'); void st.offsetWidth; st.classList.add('ty-pop');
    }

    function tyKill(m) {
        m.dead = true;
        TY.kills++; TY.combo++;
        if (TY.combo > TY.bestCombo) TY.bestCombo = TY.combo;
        var pts = m.p.length * 5 + TY.combo * 3;
        TY.score += pts;
        if (TY.target === m.id) TY.target = null;
        var leveled = false;
        if (TY.kills % 8 === 0) { TY.wave++; leveled = true; }
        tyBeam(m);
        tyExplode(m);
        tyFloatScore(m, pts);
        tyComboPop();
        if (leveled) {
            tyWaveBanner(TY.wave);
            // periodic boss every 2nd wave (~every 16 kills)
            if (TY.wave % 2 === 0 && !TY.bossActive) setTimeout(function () { if (TY && !entGameOver && !TY.bossActive) tySpawnBoss(); }, 900);
        }
        if (m.el) {
            m.el.classList.add('ty-dead');
            var el = m.el;
            setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 280);
        }
        var idx = TY.monsters.indexOf(m);
        if (idx >= 0) TY.monsters.splice(idx, 1);
        tyUpdateHud();
        tyUpdateReticle();
    }

    function tyMonsterHit(m) {
        m.dead = true;
        TY.hp--; TY.combo = 0;
        if (TY.target === m.id) TY.target = null;
        var sc = g('tyScene'); if (sc) { sc.classList.add('ty-shake'); setTimeout(function () { sc.classList.remove('ty-shake'); }, 320); }
        tyDamageFlash();
        if (m.el) { var el = m.el; el.classList.add('ty-reach'); setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 250); }
        var idx = TY.monsters.indexOf(m);
        if (idx >= 0) TY.monsters.splice(idx, 1);
        tyUpdateHud();
        tyUpdateReticle();
        if (TY.hp <= 0) tyGameOver();
    }

    function tyClearTarget() {
        if (TY.target == null) return;
        var m = tyFind(TY.target);
        TY.target = null;
        if (m) { m.typed = 0; m.cnTyped = 0; tyUpdateMonster(m); }
        tyUpdateReticle();
    }

    function tyFlashWrong(m) {
        if (!m || !m.el) return;
        m.el.classList.add('ty-wrong');
        var el = m.el;
        setTimeout(function () { if (el) el.classList.remove('ty-wrong'); }, 180);
    }

    // acquire nearest monster whose Chinese word / pinyin starts with the token
    function tyAcquire(matchFn) {
        var tm = null;
        for (var i = 0; i < TY.monsters.length; i++) {
            var m = TY.monsters[i];
            if (!m.dead && matchFn(m) && (!tm || m.depth > tm.depth)) tm = m;
        }
        return tm;
    }

    // one committed Chinese character → match against the target word (m.w)
    function tyHandleHan(c) {
        TY.totalKeys++;
        var tm = (TY.target != null) ? tyFind(TY.target) : null;
        if (tm && tm.dead) tm = null;
        if (!tm) {
            tm = tyAcquire(function (m) { return m.w[m.cnTyped] === c || m.w[0] === c; });
            if (!tm) { TY.errKeys++; TY.combo = 0; return; }
            TY.target = tm.id; tm.typed = 0; tm.cnTyped = 0; tyRefreshAll(); tyUpdateReticle();
        }
        if (c === tm.w[tm.cnTyped]) {
            tm.cnTyped++; TY.goodKeys++;
            if (tm.cnTyped >= tm.w.length) tyWordComplete(tm);
            else tyUpdateMonster(tm);
        } else { TY.errKeys++; TY.combo = 0; tyFlashWrong(tm); }
    }

    // one latin letter → match against the target pinyin (m.p)
    function tyHandleLatin(ch) {
        TY.totalKeys++;
        var tm = (TY.target != null) ? tyFind(TY.target) : null;
        if (tm && tm.dead) tm = null;
        if (!tm) {
            tm = tyAcquire(function (m) { return m.p[0] === ch; });
            if (!tm) { TY.errKeys++; TY.combo = 0; return; }
            TY.target = tm.id; tm.typed = 0; tm.cnTyped = 0; tyRefreshAll(); tyUpdateReticle();
        }
        if (ch === tm.p[tm.typed]) {
            tm.typed++; TY.goodKeys++;
            if (tm.typed >= tm.p.length) tyWordComplete(tm);
            else tyUpdateMonster(tm);
        } else { TY.errKeys++; TY.combo = 0; tyFlashWrong(tm); }
    }

    // process a committed string (from IME, paste, or direct latin keystroke)
    function tyProcessText(str) {
        if (!TY || entGameOver || entGame !== 'typing' || !str) return;
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (c >= 'a' && c <= 'z') tyHandleLatin(c);
            else if (c >= 'A' && c <= 'Z') tyHandleLatin(c.toLowerCase());
            else if (c >= '\u4e00' && c <= '\u9fff') tyHandleHan(c);  // CJK Unified
            else if (c >= '\u3400' && c <= '\u4dbf') tyHandleHan(c);  // CJK Ext-A
            // ignore spaces / punctuation / tone marks
        }
    }

    var _tyComposing = false;
    function tyConsume() {
        var inp = g('tyInput'); if (!inp) return;
        var v = inp.value;
        if (v) { tyProcessText(v); inp.value = ''; }
    }
    function tyFocusInput() {
        var inp = g('tyInput');
        if (inp && document.activeElement !== inp && !entGameOver) inp.focus();
    }

    function tyTick() {
        if (!TY || entGameOver || entGame !== 'typing') { tyStopLoop(); return; }
        TY.spawnAcc += 60;
        if (TY.spawnAcc >= TY.params.spawn) { TY.spawnAcc = 0; tySpawn(); }
        for (var i = TY.monsters.length - 1; i >= 0; i--) {
            var m = TY.monsters[i];
            if (m.dead) continue;
            m.depth += m.speed;
            if (m.depth >= 1) { if (m.isBoss) tyBossReach(m); else tyMonsterHit(m); continue; }
            tyPositionEl(m);
            if (m.isBoss) tyUpdateBossHp(m);
        }
        tyUpdateReticle();
    }

    function tyGameOver() {
        tyStopLoop();
        var total = TY.goodKeys + TY.errKeys;
        var acc = total ? Math.round(TY.goodKeys / total * 100) : 100;
        setGameOver('💀 Overrun! Score ' + TY.score + ' · ' + TY.kills + ' kills · ' +
                    acc + '% accuracy · best combo x' + TY.bestCombo);
        entRecordAndToast('typing', TY.score, TY.score + ' pts · ' + TY.kills + ' kills');
    }

    function startTypingLoop() {
        tyStopLoop();
        var inp = g('tyInput');
        if (inp) {
            inp.addEventListener('compositionstart', function () { _tyComposing = true; });
            inp.addEventListener('compositionend', function () { _tyComposing = false; tyConsume(); });
            inp.addEventListener('input', function (e) {
                if (_tyComposing || e.isComposing) return;   // mid-IME composition
                tyConsume();
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); tyClearTarget(); }
            });
        }
        // keep the typing field focused so any IME stays directed at the game
        var area = g('entGameArea');
        _tyKeyHandler = function (e) {
            if (entGame !== 'typing' || entGameOver) return;
            var t = e.target;
            if (t && (t.id === 'entRestartBtn' || t.id === 'entExitBtn')) return;
            tyFocusInput();
        };
        if (area) area.addEventListener('click', _tyKeyHandler);
        _tyFocusArea = area;
        setTimeout(tyFocusInput, 30);
        tyWaveBanner(1);
        _typingLoop = setInterval(tyTick, 60);
    }
    var _tyFocusArea = null;
    function tyStopLoop() {
        if (_typingLoop) { clearInterval(_typingLoop); _typingLoop = null; }
        if (_tyKeyHandler && _tyFocusArea) { _tyFocusArea.removeEventListener('click', _tyKeyHandler); }
        _tyKeyHandler = null; _tyFocusArea = null; _tyComposing = false;
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑩b 中文輸入法練習 — classic Microsoft "IME Practice" game
    //  Chinese characters drift down from the top; clear each one before it
    //  lands by typing it with ANY desktop input method (or the pinyin shown).
    //  Faithful Win95-style window chrome, live speed toolbar, score + lives.
    // ════════════════════════════════════════════════════════════════
    var IM = null;
    var _imLoop = null, _imKeyHandler = null, _imFocusArea = null, _imComposing = false;

    // ── Traditional-Chinese seeding pool (500+ words) ────────────────
    // Each entry: { w: 繁體 word, p: toneless pinyin (typed as a fallback) }.
    // The IME path matches the actual characters; pinyin is the no-IME backup
    // (ü is written as "v", the form keyboard users actually type).
    var IM_DENTAL = [
        {w:'洗牙',p:'xiya'},{w:'補牙',p:'buya'},{w:'假牙',p:'jiaya'},{w:'牙根',p:'yagen'},
        {w:'牙齒',p:'yachi'},{w:'牙醫',p:'yayi'},{w:'牙科',p:'yake'},{w:'牙周',p:'yazhou'},
        {w:'牙垢',p:'yagou'},{w:'牙籤',p:'yaqian'},{w:'牙膏',p:'yagao'},{w:'牙刷',p:'yashua'},
        {w:'牙線',p:'yaxian'},{w:'牙痛',p:'yatong'},{w:'牙齦',p:'yayin'},{w:'牙橋',p:'yaqiao'},
        {w:'牙冠',p:'yaguan'},{w:'牙套',p:'yatao'},{w:'牙肉',p:'yarou'},{w:'蛀牙',p:'zhuya'},
        {w:'拔牙',p:'baya'},{w:'鑲牙',p:'xiangya'},{w:'植牙',p:'zhiya'},{w:'智齒',p:'zhichi'},
        {w:'臼齒',p:'jiuchi'},{w:'門牙',p:'menya'},{w:'犬齒',p:'quanchi'},{w:'乳牙',p:'ruya'},
        {w:'恆牙',p:'hengya'},{w:'齲齒',p:'quchi'},{w:'根管',p:'genguan'},{w:'潔牙',p:'jieya'},
        {w:'口腔',p:'kouqiang'},{w:'舌頭',p:'shetou'},{w:'嘴唇',p:'zuichun'},{w:'咬合',p:'yaohe'},
        {w:'麻醉',p:'mazui'},{w:'漱口',p:'shukou'},{w:'結石',p:'jieshi'},{w:'齒列',p:'chilie'},
        {w:'矯正',p:'jiaozheng'},{w:'琺瑯',p:'falang'},{w:'蛀蝕',p:'zhushi'},{w:'補綴',p:'buzhui'},
        {w:'根管治療',p:'genguanzhiliao'},{w:'牙結石',p:'yajieshi'},{w:'洗牙機',p:'xiyaji'},{w:'漱口水',p:'shukoushui'}
    ];
    var IM_WORDS = [
        // animals
        {w:'貓咪',p:'maomi'},{w:'小狗',p:'xiaogou'},{w:'老虎',p:'laohu'},{w:'獅子',p:'shizi'},
        {w:'大象',p:'daxiang'},{w:'熊貓',p:'xiongmao'},{w:'兔子',p:'tuzi'},{w:'猴子',p:'houzi'},
        {w:'老鼠',p:'laoshu'},{w:'蝴蝶',p:'hudie'},{w:'螞蟻',p:'mayi'},{w:'蜜蜂',p:'mifeng'},
        {w:'青蛙',p:'qingwa'},{w:'烏龜',p:'wugui'},{w:'金魚',p:'jinyu'},{w:'鯊魚',p:'shayu'},
        {w:'鯨魚',p:'jingyu'},{w:'海豚',p:'haitun'},{w:'老鷹',p:'laoying'},{w:'麻雀',p:'maque'},
        {w:'鴿子',p:'gezi'},{w:'鸚鵡',p:'yingwu'},{w:'孔雀',p:'kongque'},{w:'駱駝',p:'luotuo'},
        {w:'斑馬',p:'banma'},{w:'長頸鹿',p:'changjinglu'},{w:'鱷魚',p:'eyu'},{w:'蜘蛛',p:'zhizhu'},
        {w:'蟑螂',p:'zhanglang'},{w:'蚊子',p:'wenzi'},{w:'刺蝟',p:'ciwei'},{w:'松鼠',p:'songshu'},
        // food & drink
        {w:'米飯',p:'mifan'},{w:'麵包',p:'mianbao'},{w:'饅頭',p:'mantou'},{w:'餃子',p:'jiaozi'},
        {w:'包子',p:'baozi'},{w:'麵條',p:'miantiao'},{w:'炒飯',p:'chaofan'},{w:'蛋糕',p:'dangao'},
        {w:'餅乾',p:'binggan'},{w:'巧克力',p:'qiaokeli'},{w:'糖果',p:'tangguo'},{w:'冰淇淋',p:'bingqilin'},
        {w:'牛奶',p:'niunai'},{w:'豆漿',p:'doujiang'},{w:'咖啡',p:'kafei'},{w:'紅茶',p:'hongcha'},
        {w:'綠茶',p:'lvcha'},{w:'果汁',p:'guozhi'},{w:'蘋果',p:'pingguo'},{w:'香蕉',p:'xiangjiao'},
        {w:'橘子',p:'juzi'},{w:'葡萄',p:'putao'},{w:'西瓜',p:'xigua'},{w:'草莓',p:'caomei'},
        {w:'鳳梨',p:'fengli'},{w:'芒果',p:'mangguo'},{w:'番茄',p:'fanqie'},{w:'黃瓜',p:'huanggua'},
        {w:'青菜',p:'qingcai'},{w:'蘿蔔',p:'luobo'},{w:'馬鈴薯',p:'malingshu'},{w:'雞蛋',p:'jidan'},
        {w:'豬肉',p:'zhurou'},{w:'牛肉',p:'niurou'},{w:'雞肉',p:'jirou'},{w:'海鮮',p:'haixian'},
        {w:'火鍋',p:'huoguo'},{w:'便當',p:'biandang'},{w:'壽司',p:'shousi'},{w:'披薩',p:'pisa'},
        // nature & weather
        {w:'天空',p:'tiankong'},{w:'太陽',p:'taiyang'},{w:'月亮',p:'yueliang'},{w:'星星',p:'xingxing'},
        {w:'白雲',p:'baiyun'},{w:'彩虹',p:'caihong'},{w:'閃電',p:'shandian'},{w:'打雷',p:'dalei'},
        {w:'下雨',p:'xiayu'},{w:'颱風',p:'taifeng'},{w:'雪花',p:'xuehua'},{w:'露水',p:'lushui'},
        {w:'海洋',p:'haiyang'},{w:'河流',p:'heliu'},{w:'湖泊',p:'hubo'},{w:'瀑布',p:'pubu'},
        {w:'高山',p:'gaoshan'},{w:'森林',p:'senlin'},{w:'沙漠',p:'shamo'},{w:'草原',p:'caoyuan'},
        {w:'花朵',p:'huaduo'},{w:'樹木',p:'shumu'},{w:'葉子',p:'yezi'},{w:'種子',p:'zhongzi'},
        {w:'石頭',p:'shitou'},{w:'泥土',p:'nitu'},{w:'火山',p:'huoshan'},{w:'地震',p:'dizhen'},
        {w:'海嘯',p:'haixiao'},{w:'朝陽',p:'zhaoyang'},{w:'夕陽',p:'xiyang'},{w:'黎明',p:'liming'},
        {w:'黃昏',p:'huanghun'},{w:'霧氣',p:'wuqi'},{w:'冰霜',p:'bingshuang'},{w:'冰雹',p:'bingbao'},
        {w:'雷雨',p:'leiyu'},{w:'晴天',p:'qingtian'},{w:'陰天',p:'yintian'},{w:'微風',p:'weifeng'},
        // body & health
        {w:'頭髮',p:'toufa'},{w:'眼睛',p:'yanjing'},{w:'鼻子',p:'bizi'},{w:'耳朵',p:'erduo'},
        {w:'嘴巴',p:'zuiba'},{w:'脖子',p:'bozi'},{w:'肩膀',p:'jianbang'},{w:'手臂',p:'shoubi'},
        {w:'手指',p:'shouzhi'},{w:'手掌',p:'shouzhang'},{w:'膝蓋',p:'xigai'},{w:'腳趾',p:'jiaozhi'},
        {w:'心臟',p:'xinzang'},{w:'肺部',p:'feibu'},{w:'胃部',p:'weibu'},{w:'肝臟',p:'ganzang'},
        {w:'腎臟',p:'shenzang'},{w:'骨頭',p:'gutou'},{w:'肌肉',p:'jirou'},{w:'血液',p:'xueye'},
        {w:'皮膚',p:'pifu'},{w:'感冒',p:'ganmao'},{w:'發燒',p:'fashao'},{w:'咳嗽',p:'kesou'},
        {w:'頭痛',p:'toutong'},{w:'醫生',p:'yisheng'},{w:'護士',p:'hushi'},{w:'醫院',p:'yiyuan'},
        {w:'藥物',p:'yaowu'},{w:'健康',p:'jiankang'},
        // family & people
        {w:'爸爸',p:'baba'},{w:'媽媽',p:'mama'},{w:'哥哥',p:'gege'},{w:'姐姐',p:'jiejie'},
        {w:'弟弟',p:'didi'},{w:'妹妹',p:'meimei'},{w:'爺爺',p:'yeye'},{w:'奶奶',p:'nainai'},
        {w:'外公',p:'waigong'},{w:'外婆',p:'waipo'},{w:'叔叔',p:'shushu'},{w:'阿姨',p:'ayi'},
        {w:'舅舅',p:'jiujiu'},{w:'表哥',p:'biaoge'},{w:'朋友',p:'pengyou'},{w:'同學',p:'tongxue'},
        {w:'老師',p:'laoshi'},{w:'學生',p:'xuesheng'},{w:'鄰居',p:'linju'},{w:'客人',p:'keren'},
        {w:'老闆',p:'laoban'},{w:'員工',p:'yuangong'},{w:'顧客',p:'guke'},{w:'警察',p:'jingcha'},
        {w:'司機',p:'siji'},{w:'廚師',p:'chushi'},{w:'農夫',p:'nongfu'},{w:'工人',p:'gongren'},
        // home objects
        {w:'桌子',p:'zhuozi'},{w:'椅子',p:'yizi'},{w:'沙發',p:'shafa'},{w:'床鋪',p:'chuangpu'},
        {w:'衣櫃',p:'yigui'},{w:'鏡子',p:'jingzi'},{w:'時鐘',p:'shizhong'},{w:'電視',p:'dianshi'},
        {w:'電腦',p:'diannao'},{w:'手機',p:'shouji'},{w:'冰箱',p:'bingxiang'},{w:'洗衣機',p:'xiyiji'},
        {w:'電燈',p:'diandeng'},{w:'雨傘',p:'yusan'},{w:'鑰匙',p:'yaoshi'},{w:'錢包',p:'qianbao'},
        {w:'眼鏡',p:'yanjing'},{w:'書包',p:'shubao'},{w:'鉛筆',p:'qianbi'},{w:'橡皮',p:'xiangpi'},
        {w:'尺子',p:'chizi'},{w:'剪刀',p:'jiandao'},{w:'膠水',p:'jiaoshui'},{w:'紙張',p:'zhizhang'},
        {w:'信封',p:'xinfeng'},{w:'郵票',p:'youpiao'},{w:'報紙',p:'baozhi'},{w:'雜誌',p:'zazhi'},
        {w:'字典',p:'zidian'},{w:'課本',p:'keben'},{w:'鋼琴',p:'gangqin'},{w:'吉他',p:'jita'},
        {w:'帽子',p:'maozi'},{w:'鞋子',p:'xiezi'},{w:'襪子',p:'wazi'},{w:'手錶',p:'shoubiao'},
        {w:'項鍊',p:'xianglian'},{w:'戒指',p:'jiezhi'},{w:'雨衣',p:'yuyi'},{w:'枕頭',p:'zhentou'},
        // places
        {w:'學校',p:'xuexiao'},{w:'公園',p:'gongyuan'},{w:'診所',p:'zhensuo'},{w:'商店',p:'shangdian'},
        {w:'市場',p:'shichang'},{w:'餐廳',p:'canting'},{w:'銀行',p:'yinhang'},{w:'郵局',p:'youju'},
        {w:'圖書館',p:'tushuguan'},{w:'博物館',p:'bowuguan'},{w:'電影院',p:'dianyingyuan'},{w:'火車站',p:'huochezhan'},
        {w:'機場',p:'jichang'},{w:'港口',p:'gangkou'},{w:'工廠',p:'gongchang'},{w:'辦公室',p:'bangongshi'},
        {w:'教室',p:'jiaoshi'},{w:'操場',p:'caochang'},{w:'廁所',p:'cesuo'},{w:'廚房',p:'chufang'},
        {w:'客廳',p:'keting'},{w:'臥室',p:'woshi'},{w:'陽台',p:'yangtai'},{w:'樓梯',p:'louti'},
        {w:'電梯',p:'dianti'},{w:'城市',p:'chengshi'},{w:'鄉村',p:'xiangcun'},{w:'街道',p:'jiedao'},
        {w:'馬路',p:'malu'},{w:'橋樑',p:'qiaoliang'},
        // transport
        {w:'汽車',p:'qiche'},{w:'火車',p:'huoche'},{w:'飛機',p:'feiji'},{w:'輪船',p:'lunchuan'},
        {w:'腳踏車',p:'jiaotache'},{w:'機車',p:'jiche'},{w:'公車',p:'gongche'},{w:'計程車',p:'jichengche'},
        {w:'捷運',p:'jieyun'},{w:'地鐵',p:'ditie'},{w:'卡車',p:'kache'},{w:'救護車',p:'jiuhuche'},
        {w:'消防車',p:'xiaofangche'},{w:'警車',p:'jingche'},{w:'太空船',p:'taikongchuan'},{w:'熱氣球',p:'reqiqiu'},
        // time
        {w:'今天',p:'jintian'},{w:'明天',p:'mingtian'},{w:'昨天',p:'zuotian'},{w:'早上',p:'zaoshang'},
        {w:'中午',p:'zhongwu'},{w:'下午',p:'xiawu'},{w:'晚上',p:'wanshang'},{w:'春天',p:'chuntian'},
        {w:'夏天',p:'xiatian'},{w:'秋天',p:'qiutian'},{w:'冬天',p:'dongtian'},{w:'星期',p:'xingqi'},
        {w:'月份',p:'yuefen'},{w:'年份',p:'nianfen'},{w:'假日',p:'jiari'},{w:'生日',p:'shengri'},
        {w:'節日',p:'jieri'},{w:'分鐘',p:'fenzhong'},{w:'秒鐘',p:'miaozhong'},{w:'瞬間',p:'shunjian'},
        // actions
        {w:'跑步',p:'paobu'},{w:'走路',p:'zoulu'},{w:'跳躍',p:'tiaoyue'},{w:'游泳',p:'youyong'},
        {w:'飛翔',p:'feixiang'},{w:'唱歌',p:'changge'},{w:'跳舞',p:'tiaowu'},{w:'畫畫',p:'huahua'},
        {w:'寫字',p:'xiezi'},{w:'閱讀',p:'yuedu'},{w:'思考',p:'sikao'},{w:'學習',p:'xuexi'},
        {w:'工作',p:'gongzuo'},{w:'休息',p:'xiuxi'},{w:'睡覺',p:'shuijiao'},{w:'吃飯',p:'chifan'},
        {w:'喝水',p:'heshui'},{w:'微笑',p:'weixiao'},{w:'大哭',p:'daku'},{w:'生氣',p:'shengqi'},
        {w:'害怕',p:'haipa'},{w:'開心',p:'kaixin'},{w:'難過',p:'nanguo'},{w:'驚訝',p:'jingya'},
        {w:'緊張',p:'jinzhang'},{w:'放鬆',p:'fangsong'},{w:'努力',p:'nuli'},{w:'加油',p:'jiayou'},
        {w:'幫忙',p:'bangmang'},{w:'分享',p:'fenxiang'},{w:'合作',p:'hezuo'},{w:'競爭',p:'jingzheng'},
        {w:'旅行',p:'lvxing'},{w:'探險',p:'tanxian'},{w:'購物',p:'gouwu'},{w:'烹飪',p:'pengren'},
        {w:'種植',p:'zhongzhi'},{w:'打掃',p:'dasao'},{w:'整理',p:'zhengli'},{w:'修理',p:'xiuli'},
        // qualities & feelings
        {w:'快樂',p:'kuaile'},{w:'幸福',p:'xingfu'},{w:'美麗',p:'meili'},{w:'聰明',p:'congming'},
        {w:'勇敢',p:'yonggan'},{w:'善良',p:'shanliang'},{w:'誠實',p:'chengshi'},{w:'友善',p:'youshan'},
        {w:'勤勞',p:'qinlao'},{w:'認真',p:'renzhen'},{w:'活潑',p:'huopo'},{w:'安靜',p:'anjing'},
        {w:'溫柔',p:'wenrou'},{w:'堅強',p:'jianqiang'},{w:'自由',p:'ziyou'},{w:'和平',p:'heping'},
        {w:'希望',p:'xiwang'},{w:'夢想',p:'mengxiang'},{w:'成功',p:'chenggong'},{w:'失敗',p:'shibai'},
        {w:'危險',p:'weixian'},{w:'安全',p:'anquan'},{w:'重要',p:'zhongyao'},{w:'簡單',p:'jiandan'},
        {w:'複雜',p:'fuza'},{w:'新鮮',p:'xinxian'},{w:'美味',p:'meiwei'},{w:'漂亮',p:'piaoliang'},
        {w:'可愛',p:'keai'},{w:'巨大',p:'juda'},{w:'渺小',p:'miaoxiao'},{w:'明亮',p:'mingliang'},
        {w:'黑暗',p:'heian'},{w:'溫暖',p:'wennuan'},{w:'寒冷',p:'hanleng'},{w:'炎熱',p:'yanre'},
        {w:'涼爽',p:'liangshuang'},{w:'感動',p:'gandong'},{w:'滿足',p:'manzu'},{w:'期待',p:'qidai'},
        {w:'思念',p:'sinian'},{w:'後悔',p:'houhui'},{w:'寂寞',p:'jimo'},{w:'孤單',p:'gudan'},
        {w:'興奮',p:'xingfen'},{w:'感謝',p:'ganxie'},
        // colors
        {w:'紅色',p:'hongse'},{w:'橙色',p:'chengse'},{w:'黃色',p:'huangse'},{w:'綠色',p:'lvse'},
        {w:'藍色',p:'lanse'},{w:'紫色',p:'zise'},{w:'黑色',p:'heise'},{w:'白色',p:'baise'},
        {w:'灰色',p:'huise'},{w:'粉紅',p:'fenhong'},{w:'金色',p:'jinse'},{w:'銀色',p:'yinse'},
        {w:'棕色',p:'zongse'},
        // tech & media
        {w:'網路',p:'wanglu'},{w:'程式',p:'chengshi'},{w:'軟體',p:'ruanti'},{w:'硬體',p:'yingti'},
        {w:'鍵盤',p:'jianpan'},{w:'滑鼠',p:'huashu'},{w:'螢幕',p:'yingmu'},{w:'耳機',p:'erji'},
        {w:'喇叭',p:'laba'},{w:'相機',p:'xiangji'},{w:'充電',p:'chongdian'},{w:'訊號',p:'xinhao'},
        {w:'密碼',p:'mima'},{w:'帳號',p:'zhanghao'},{w:'檔案',p:'dangan'},{w:'資料',p:'ziliao'},
        {w:'遊戲',p:'youxi'},{w:'影片',p:'yingpian'},{w:'音樂',p:'yinyue'},{w:'照片',p:'zhaopian'},
        {w:'簡訊',p:'jianxun'},{w:'直播',p:'zhibo'},
        // play & sport
        {w:'風箏',p:'fengzheng'},{w:'氣球',p:'qiqiu'},{w:'玩具',p:'wanju'},{w:'積木',p:'jimu'},
        {w:'拼圖',p:'pintu'},{w:'撲克',p:'puke'},{w:'棋子',p:'qizi'},{w:'骰子',p:'shaizi'},
        {w:'籃球',p:'lanqiu'},{w:'足球',p:'zuqiu'},{w:'棒球',p:'bangqiu'},{w:'網球',p:'wangqiu'},
        {w:'桌球',p:'zhuoqiu'},{w:'羽球',p:'yuqiu'},{w:'跳繩',p:'tiaosheng'},{w:'溜冰',p:'liubing'},
        {w:'滑板',p:'huaban'},{w:'釣魚',p:'diaoyu'},{w:'露營',p:'luying'},{w:'登山',p:'dengshan'},
        {w:'烤肉',p:'kaorou'},
        // plants
        {w:'玫瑰',p:'meigui'},{w:'茉莉',p:'moli'},{w:'蘭花',p:'lanhua'},{w:'菊花',p:'juhua'},
        {w:'荷花',p:'hehua'},{w:'向日葵',p:'xiangrikui'},{w:'鬱金香',p:'yujinxiang'},{w:'仙人掌',p:'xianrenzhang'},
        {w:'竹子',p:'zhuzi'},{w:'松樹',p:'songshu'},{w:'柳樹',p:'liushu'},{w:'楓葉',p:'fengye'},
        {w:'銀杏',p:'yinxing'},{w:'小草',p:'xiaocao'},{w:'樹苗',p:'shumiao'}
    ];
    var IM_SINGLES = [
        {w:'的',p:'de'},{w:'是',p:'shi'},{w:'你',p:'ni'},{w:'我',p:'wo'},{w:'他',p:'ta'},
        {w:'們',p:'men'},{w:'好',p:'hao'},{w:'愛',p:'ai'},{w:'家',p:'jia'},{w:'國',p:'guo'},
        {w:'學',p:'xue'},{w:'書',p:'shu'},{w:'寫',p:'xie'},{w:'讀',p:'du'},{w:'字',p:'zi'},
        {w:'山',p:'shan'},{w:'水',p:'shui'},{w:'火',p:'huo'},{w:'風',p:'feng'},{w:'雲',p:'yun'},
        {w:'雨',p:'yu'},{w:'雪',p:'xue'},{w:'花',p:'hua'},{w:'草',p:'cao'},{w:'樹',p:'shu'},
        {w:'鳥',p:'niao'},{w:'魚',p:'yu'},{w:'貓',p:'mao'},{w:'狗',p:'gou'},{w:'龍',p:'long'},
        {w:'馬',p:'ma'},{w:'羊',p:'yang'},{w:'牛',p:'niu'},{w:'虎',p:'hu'},{w:'龜',p:'gui'},
        {w:'心',p:'xin'},{w:'手',p:'shou'},{w:'口',p:'kou'},{w:'目',p:'mu'},{w:'耳',p:'er'},
        {w:'門',p:'men'},{w:'車',p:'che'},{w:'船',p:'chuan'},{w:'飛',p:'fei'},{w:'跑',p:'pao'}
    ];
    var IM_BANK = IM_DENTAL.concat(IM_WORDS).concat(IM_SINGLES);

    // walk / bike / car / plane → spawn interval (ms), fall speed (rows/tick),
    // and max simultaneously-FALLING tiles. Tiles that reach the floor stack up
    // Tetris-style; the game ends when any column piles to the top.
    var IM_PARAMS = {
        easy:      { spawn: 2200, speed: 0.026, max: 3 },
        medium:    { spawn: 1750, speed: 0.036, max: 4 },
        difficult: { spawn: 1350, speed: 0.050, max: 5 },
        master:    { spawn: 1000, speed: 0.068, max: 6 }
    };
    var IM_SPEED_LABEL = { easy:'🚶 慢速 Slow', medium:'🚲 普通 Normal', difficult:'🚗 快速 Fast', master:'✈️ 極速 Insane' };

    function initIme(diff) {
        imStopLoop();
        var d = diff || 'easy';
        var P = IM_PARAMS[d] || IM_PARAMS.easy;
        IM = {
            diff: d, params: P,
            score: 0, cleared: 0, errors: 0,
            combo: 0, bestCombo: 0, target: null,
            chars: [], stacks: [], cols: 6, rows: 7, rowH: 54,
            nextId: 1, spawnAcc: 0, started: Date.now()
        };
        imBuildScene();
        imMeasure();
        imSyncToolbar();
        imUpdateHud();
        var st = g('entGameStatus');
        if (st) st.textContent = '打出落下的字！沒打到會堆疊，疊到頂就結束。 Clear the words — misses stack up, fill to the top and it is over!';
    }

    // size the column/row grid to the actual field so tiles line up & stack
    function imMeasure() {
        var fld = g('imField');
        var W = (fld && fld.clientWidth)  || 520;
        var H = (fld && fld.clientHeight) || 380;
        IM.cols = Math.max(4, Math.min(8, Math.round(W / 96)));
        IM.rows = Math.max(5, Math.min(9, Math.floor(H / 54)));
        IM.rowH = H / IM.rows;
        IM.stacks = [];
        for (var c = 0; c < IM.cols; c++) IM.stacks.push([]);
    }

    function imLandingRow(col) { return IM.rows - 1 - IM.stacks[col].length; }

    function imBuildScene() {
        var wrap = g('entBoardWrap'); if (!wrap) return;
        wrap.innerHTML =
            '<div class="im-game">' +
                '<div class="im-window">' +
                    '<div class="im-titlebar">' +
                        '<span class="im-title">⌨️ 中文輸入法練習 － 輸入法</span>' +
                        '<span class="im-tbtns"><i>_</i><i>□</i><i>×</i></span>' +
                    '</div>' +
                    '<div class="im-menubar"><span>遊戲(<u>G</u>)</span><span>選項(<u>O</u>)</span><span>說明(<u>H</u>)</span></div>' +
                    '<div class="im-toolbar" id="imToolbar">' +
                        '<button type="button" class="im-tool" data-speed="easy"      title="慢速 (走路)">🚶</button>' +
                        '<button type="button" class="im-tool" data-speed="medium"    title="普通 (腳踏車)">🚲</button>' +
                        '<button type="button" class="im-tool" data-speed="difficult" title="快速 (汽車)">🚗</button>' +
                        '<button type="button" class="im-tool" data-speed="master"    title="極速 (飛機)">✈️</button>' +
                        '<span class="im-tool-sep"></span>' +
                        '<span class="im-speed-tag" id="imSpeedTag"></span>' +
                    '</div>' +
                    '<div class="im-field" id="imField">' +
                        '<div class="im-scan"></div>' +
                        '<div class="im-vignette"></div>' +
                        '<div class="im-baseline" id="imBaseline"></div>' +
                        '<div class="im-combo-pop" id="imComboPop"></div>' +
                    '</div>' +
                    '<div class="im-statusbar">' +
                        '<span class="im-status-cell" id="imStatusText">就緒</span>' +
                        '<span class="im-status-cell im-combo" id="imCombo"></span>' +
                        '<span class="im-status-cell im-score">分數：<b id="imScore">0</b></span>' +
                    '</div>' +
                '</div>' +
                '<div class="im-console">' +
                    '<span class="im-console-icon">⌨️</span>' +
                    '<input id="imInput" class="im-input" type="text" autocomplete="off" ' +
                        'autocorrect="off" autocapitalize="off" spellcheck="false" ' +
                        'placeholder="用任何輸入法打出落下的字（或輸入拼音）…  Type the falling characters with any IME (or pinyin)…">' +
                '</div>' +
                '<div class="im-hint">字會從上方落下，沒打到的會像俄羅斯方塊一樣<b>堆疊</b>起來，疊到頂端就結束！ ' +
                    'Miss a word and it stacks up Tetris-style; fill a column to the top and the game ends. ' +
                    'Use <b>any Chinese IME</b> or the <b>pinyin</b> hint · <b>Enter/Space</b> commits · <b>Esc</b> clears.</div>' +
            '</div>';
        var tb = g('imToolbar');
        if (tb) tb.querySelectorAll('.im-tool[data-speed]').forEach(function (b) {
            b.addEventListener('click', function () { imSetSpeed(b.dataset.speed); imFocusInput(); });
        });
    }

    function imSetSpeed(d) {
        if (!IM || !IM_PARAMS[d]) return;
        IM.diff = d; IM.params = IM_PARAMS[d];
        imSyncToolbar();
        var st = g('imStatusText'); if (st) st.textContent = '速度：' + (IM_SPEED_LABEL[d] || d);
    }

    function imSyncToolbar() {
        var tb = g('imToolbar'); if (!tb) return;
        tb.querySelectorAll('.im-tool[data-speed]').forEach(function (b) {
            b.classList.toggle('im-tool-on', IM && b.dataset.speed === IM.diff);
        });
        var tag = g('imSpeedTag'); if (tag && IM) tag.textContent = IM_SPEED_LABEL[IM.diff] || '';
    }

    function imUpdateHud() {
        if (!IM) return;
        var sc = g('imScore'); if (sc) sc.textContent = IM.score;
        var cb = g('imCombo');
        if (cb) {
            cb.innerHTML = IM.combo >= 2 ? '連擊 <b>x' + IM.combo + '</b>' : '';
            cb.classList.toggle('im-combo-on', IM.combo >= 2);
        }
    }

    // ── visual-effect helpers (layered over the CRT field) ───────────
    function imCharTop(m) { return IM.rows ? (m.row / IM.rows) * 100 : 50; }

    function imFloatScore(m, text, big) {
        var fld = g('imField'); if (!fld) return;
        var f = document.createElement('div');
        f.className = 'im-float' + (big ? ' im-float-big' : '');
        f.textContent = text;
        f.style.left = m.x + '%';
        f.style.top  = imCharTop(m) + '%';
        fld.appendChild(f);
        setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 760);
    }

    function imShatter(m) {
        var fld = g('imField'); if (!fld) return;
        var top = imCharTop(m), n = 8;
        for (var i = 0; i < n; i++) {
            var s = document.createElement('div');
            s.className = 'im-shard';
            var ang = (Math.PI * 2 * i) / n + Math.random() * 0.5;
            var dist = 26 + Math.random() * 30;
            s.style.left = m.x + '%';
            s.style.top  = top + '%';
            s.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
            s.style.setProperty('--dy', (Math.sin(ang) * dist).toFixed(0) + 'px');
            fld.appendChild(s);
            (function (el) { setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 520); })(s);
        }
    }

    function imComboPop(n) {
        var el = g('imComboPop'); if (!el) return;
        el.textContent = 'COMBO x' + n + '!';
        el.classList.remove('im-combo-show'); void el.offsetWidth;   // restart animation
        el.classList.add('im-combo-show');
    }

    function imScorePop() {
        var sc = g('imScore'); if (!sc) return;
        sc.classList.remove('im-score-pop'); void sc.offsetWidth;
        sc.classList.add('im-score-pop');
    }

    function imUpdateLocking(token) {
        for (var i = 0; i < IM.chars.length; i++) {
            var m = IM.chars[i];
            if (!m.el) continue;
            var on = !!token && !m.dead && m.p.indexOf(token) === 0;
            m.el.classList.toggle('im-locking', on);
        }
    }

    function imSpawn() {
        // cap concurrently-falling tiles (stacked ones don't count)
        var falling = 0, c, i, hasFalling = {};
        for (i = 0; i < IM.chars.length; i++) {
            var t = IM.chars[i];
            if (!t.dead && !t.stacked) { falling++; hasFalling[t.col] = true; }
        }
        if (falling >= IM.params.max) return;
        // prefer an empty-ish column with no tile currently dropping in it
        var open = [], any = [];
        for (c = 0; c < IM.cols; c++) {
            if (IM.stacks[c].length >= IM.rows) continue;     // column already full
            any.push(c);
            if (!hasFalling[c]) open.push(c);
        }
        var pool = open.length ? open : any;
        if (!pool.length) return;                              // everything full
        var col = pool[Math.floor(Math.random() * pool.length)];
        var e = IM_BANK[Math.floor(Math.random() * IM_BANK.length)];
        var m = {
            id: IM.nextId++, w: e.w,
            p: e.p.toLowerCase().replace(/[^a-z]/g, ''), cnTyped: 0,
            col: col, x: ((col + 0.5) / IM.cols) * 100, row: 0, stacked: false,
            speed: IM.params.speed * (0.85 + Math.random() * 0.3),
            dead: false, el: null
        };
        IM.chars.push(m);
        imCreateEl(m);
    }

    function imCreateEl(m) {
        var fld = g('imField'); if (!fld) return;
        var d = document.createElement('div');
        d.className = 'im-char';
        d.dataset.id = m.id;
        var hed = '';
        for (var i = 0; i < m.w.length; i++) hed += '<span class="im-hchar">' + entEsc(m.w[i]) + '</span>';
        d.innerHTML = '<span class="im-han">' + hed + '</span>' +
                      '<span class="im-py">' + entEsc(m.p) + '</span>';
        m.el = d;
        fld.appendChild(d);
        imPositionEl(m);
    }

    function imPositionEl(m) {
        if (!m.el) return;
        m.el.style.left = m.x + '%';
        m.el.style.top  = (m.row * IM.rowH) + 'px';
        // warn when a stack is climbing into the top rows
        m.el.classList.toggle('im-danger', m.stacked && m.row <= 1);
    }

    function imFind(pred) {
        // prefer the lowest / most-settled match (clearing it collapses a column)
        var best = null;
        for (var i = 0; i < IM.chars.length; i++) {
            var m = IM.chars[i];
            if (!m.dead && pred(m) && (!best || m.row > best.row)) best = m;
        }
        return best;
    }

    function imHasPrefix(token) {
        for (var i = 0; i < IM.chars.length; i++) {
            var m = IM.chars[i];
            if (!m.dead && m.p.indexOf(token) === 0) return true;
        }
        return false;
    }

    function imFindById(id) {
        for (var i = 0; i < IM.chars.length; i++) if (IM.chars[i].id === id) return IM.chars[i];
        return null;
    }

    // repaint per-character progress (done / current) on the targeted word
    function imRenderWord(m) {
        if (!m || !m.el) return;
        var spans = m.el.querySelectorAll('.im-hchar');
        var targeted = IM.target === m.id;
        for (var i = 0; i < spans.length; i++) {
            spans[i].classList.toggle('im-hdone', targeted && i < m.cnTyped);
            spans[i].classList.toggle('im-hcur',  targeted && i === m.cnTyped);
        }
    }

    function imDropTarget(m) {
        if (!m) return;
        m.cnTyped = 0;
        if (m.el) m.el.classList.remove('im-target');
        imRenderWord(m);
    }

    // one committed Chinese character → advance the locked word (or lock a new
    // one). Supports multi-character words typed char-by-char OR all at once.
    function imHandleHan(ch) {
        var tm = (IM.target != null) ? imFindById(IM.target) : null;
        if (tm && tm.dead) tm = null;
        // if the locked word can't continue with this char, release it
        if (tm && ch !== tm.w[tm.cnTyped]) { imDropTarget(tm); tm = null; IM.target = null; }
        if (!tm) {
            tm = imFind(function (m) { return m.w[0] === ch; });   // nearest word starting with ch
            if (!tm) { imError(); return; }
            IM.target = tm.id; tm.cnTyped = 0;
            if (tm.el) tm.el.classList.add('im-target');
        }
        tm.cnTyped++;
        if (tm.cnTyped >= tm.w.length) { IM.target = null; imClearChar(tm, true); }
        else imRenderWord(tm);
    }

    function imClearChar(m, viaHan) {
        if (!m || m.dead) return;
        m.dead = true;
        if (IM.target === m.id) IM.target = null;
        IM.cleared++;
        IM.combo++; if (IM.combo > IM.bestCombo) IM.bestCombo = IM.combo;
        var base = 10 + (m.w.length - 1) * 5;          // longer glyphs worth a touch more
        var bonus = Math.min(IM.combo - 1, 10) * 2;    // escalating combo bonus (cap +20)
        var gained = base + bonus;
        IM.score += gained;
        if (m.el) {
            m.el.classList.remove('im-stacked', 'im-danger', 'im-target', 'im-locking');
            m.el.classList.add('im-cleared');
            var el = m.el;
            setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 280);
        }
        imShatter(m);
        imFloatScore(m, '+' + gained, IM.combo >= 5);
        if (IM.combo >= 3) imComboPop(IM.combo);
        imScorePop();
        for (var i = IM.chars.length - 1; i >= 0; i--) if (IM.chars[i] === m) { IM.chars.splice(i, 1); break; }
        if (m.stacked) imRemoveFromStack(m);   // collapse the column above it
        imUpdateHud();
    }

    // pull a stacked tile out of its column; everything above settles down a row
    function imRemoveFromStack(m) {
        var col = IM.stacks[m.col]; if (!col) return;
        var idx = col.indexOf(m); if (idx < 0) return;
        col.splice(idx, 1);
        for (var i = idx; i < col.length; i++) {
            col[i].row = IM.rows - 1 - i;
            imPositionEl(col[i]);
        }
    }

    function imError() {
        if (!IM) return;
        IM.errors++; IM.combo = 0;
        var inp = g('imInput');
        if (inp) { inp.classList.add('im-input-wrong'); setTimeout(function () { if (inp) inp.classList.remove('im-input-wrong'); }, 160); }
        imUpdateHud();
    }

    // a falling tile reaches the stack top → lock it in place (Tetris-style)
    function imLockTile(m, landRow) {
        if (!m || m.dead || m.stacked) return;
        m.stacked = true;
        m.row = (landRow < 0) ? 0 : landRow;
        IM.stacks[m.col].push(m);
        if (m.el) m.el.classList.add('im-stacked');
        imPositionEl(m);
        // little "thunk" — floor flash only when it actually hits the ground
        if (IM.stacks[m.col].length === 1) {
            var bl = g('imBaseline');
            if (bl) {
                bl.style.setProperty('--hitx', m.x + '%');
                bl.classList.add('im-baseline-hit');
                setTimeout(function () { if (bl) bl.classList.remove('im-baseline-hit'); }, 360);
            }
        }
        // reached the very top → game over
        if (IM.stacks[m.col].length >= IM.rows) {
            if (m.el) m.el.classList.add('im-overflow');
            var fld = g('imField');
            if (fld) { fld.classList.add('im-field-hit'); setTimeout(function () { if (fld) fld.classList.remove('im-field-hit'); }, 260); }
            imGameOver();
        }
    }

    // process whatever is in the input field (IME commit, paste, or pinyin)
    function imProcessField(commit) {
        var inp = g('imInput'); if (!inp || !IM || entGameOver || entGame !== 'ime') return;
        var v = inp.value;
        if (!v) { imUpdateLocking(''); return; }
        // 1) any committed Chinese characters → advance / clear matching words
        var hadHan = false, ch, m;
        for (var i = 0; i < v.length; i++) {
            ch = v[i];
            var isHan = (ch >= '\u4e00' && ch <= '\u9fff') || (ch >= '\u3400' && ch <= '\u4dbf');
            if (isHan) { hadHan = true; imHandleHan(ch); }
        }
        if (hadHan) { inp.value = ''; imUpdateLocking(''); return; }
        // 2) pinyin fallback — exact whole-syllable match against the hint
        var token = v.toLowerCase().replace(/[^a-z]/g, '');
        if (!token) { if (commit) inp.value = ''; imUpdateLocking(''); return; }
        m = imFind(function (mm) { return mm.p === token; });
        if (m) { imClearChar(m, false); inp.value = ''; imUpdateLocking(''); return; }
        // no exact match: if the token can't lead anywhere (or user pressed
        // Enter/Space), it's a miss-type — reset so the player can retry.
        if (commit || !imHasPrefix(token)) { imError(); inp.value = ''; imUpdateLocking(''); return; }
        // partial but valid prefix → light up the candidate glyph(s) you're aiming at
        imUpdateLocking(token);
    }

    function imFocusInput() {
        var inp = g('imInput');
        if (inp && document.activeElement !== inp && !entGameOver) inp.focus();
    }

    function imTick() {
        if (!IM || entGameOver || entGame !== 'ime') { imStopLoop(); return; }
        IM.spawnAcc += 60;
        if (IM.spawnAcc >= IM.params.spawn) { IM.spawnAcc = 0; imSpawn(); }
        // move only the falling tiles; lowest first so columns stack cleanly
        var falling = [];
        for (var i = 0; i < IM.chars.length; i++) {
            var m = IM.chars[i];
            if (!m.dead && !m.stacked) falling.push(m);
        }
        falling.sort(function (a, b) { return b.row - a.row; });
        for (var j = 0; j < falling.length; j++) {
            var t = falling[j];
            t.row += t.speed;
            var land = imLandingRow(t.col);
            if (t.row >= land) { imLockTile(t, land); if (entGameOver) return; }
            else imPositionEl(t);
        }
    }

    function imGameOver() {
        imStopLoop();
        var total = IM.cleared + IM.errors;
        var acc = total ? Math.round(IM.cleared / total * 100) : 100;
        var secs = Math.max(1, (Date.now() - IM.started) / 1000);
        var cpm = Math.round(IM.cleared / secs * 60);
        setGameOver('🧱 疊到頂了！ Stacked to the top · 分數 ' + IM.score + ' · ' + IM.cleared +
                    ' 字 cleared · ' + cpm + ' CPM · ' + acc + '% accuracy · best combo x' + IM.bestCombo);
        entRecordAndToast('ime', IM.score, IM.score + ' pts · ' + IM.cleared + ' chars');
    }

    function startImeLoop() {
        imStopLoop();
        var inp = g('imInput');
        if (inp) {
            inp.addEventListener('compositionstart', function () { _imComposing = true; });
            inp.addEventListener('compositionend', function () { _imComposing = false; imProcessField(false); });
            inp.addEventListener('input', function (e) {
                if (_imComposing || e.isComposing) return;   // mid-IME composition
                imProcessField(false);
            });
            inp.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') { e.preventDefault(); inp.value = ''; imUpdateLocking(''); }
                else if (e.key === 'Enter' || e.key === ' ') {
                    if (_imComposing || e.isComposing) return;
                    e.preventDefault(); imProcessField(true);
                }
            });
        }
        var area = g('entGameArea');
        _imKeyHandler = function (e) {
            if (entGame !== 'ime' || entGameOver) return;
            var t = e.target;
            if (t && (t.id === 'entRestartBtn' || t.id === 'entExitBtn')) return;
            if (t && t.classList && t.classList.contains('im-tool')) return;  // let toolbar clicks through
            imFocusInput();
        };
        if (area) area.addEventListener('click', _imKeyHandler);
        _imFocusArea = area;
        setTimeout(imFocusInput, 30);
        _imLoop = setInterval(imTick, 60);
    }

    function imStopLoop() {
        if (_imLoop) { clearInterval(_imLoop); _imLoop = null; }
        if (_imKeyHandler && _imFocusArea) { _imFocusArea.removeEventListener('click', _imKeyHandler); }
        _imKeyHandler = null; _imFocusArea = null; _imComposing = false;
    }

    // ════════════════════════════════════════════════════════════════
    //  ⑪ HALL OF FAME — per-game top-3 records (localStorage)
    // ════════════════════════════════════════════════════════════════
    var ENT_REC_KEY   = 'entHallOfFame_v1';
    var ENT_ALLOW_KEY = 'entAllowRecord_v1';
    var ENT_DIFF_RANK = { easy:1, medium:2, difficult:3, master:4 };
    var ENT_DIFF_NAME = { 1:'Easy', 2:'Medium', 3:'Difficult', 4:'Master' };
    var ENT_REC_GAMES = ['2048','snake','minesweeper','sudoku','reversi','c4','gomoku','chess','xiangqi','mahjong','typing','ime'];
    var ENT_REC_ICON  = { '2048':'🔢', snake:'🐍', minesweeper:'💣', sudoku:'🔢', reversi:'⬛',
                          c4:'🔴', gomoku:'⚫', chess:'♟️', xiangqi:'🀄', mahjong:'🀄', typing:'🐱', ime:'⌨️' };

    function entEsc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
        });
    }
    function entLoginName() {
        var n = (typeof currentName !== 'undefined' && currentName) ||
                (typeof currentDoctorName !== 'undefined' && currentDoctorName) ||
                (typeof currentUserId !== 'undefined' && currentUserId) || 'Guest';
        return String(n);
    }
    function entAllowRecord() {
        try { return localStorage.getItem(ENT_ALLOW_KEY) !== 'no'; } catch (e) { return true; }
    }
    function entSetAllowRecord(on) {
        try { localStorage.setItem(ENT_ALLOW_KEY, on ? 'yes' : 'no'); } catch (e) {}
    }
    function entLoadRecords() {
        try { return JSON.parse(localStorage.getItem(ENT_REC_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function entSaveRecords(obj) {
        try { localStorage.setItem(ENT_REC_KEY, JSON.stringify(obj)); } catch (e) {}
    }
    function entTopList(game) { return entLoadRecords()[game] || []; }

    // record a result; returns 1-3 (rank) if it made the board, else 0
    function entRecord(game, sort, disp) {
        if (!entAllowRecord()) return 0;
        var all = entLoadRecords();
        var list = all[game] || [];
        var entry = { name: entLoginName(), sort: sort, disp: disp, ts: Date.now(), _new: true };
        list.push(entry);
        list.sort(function (a, b) { return (b.sort - a.sort) || (a.ts - b.ts); });
        list = list.slice(0, 3);
        var rank = 0;
        for (var i = 0; i < list.length; i++) if (list[i]._new) { rank = i + 1; break; }
        all[game] = list.map(function (e) { return { name: e.name, sort: e.sort, disp: e.disp, ts: e.ts }; });
        entSaveRecords(all);
        return rank;
    }

    function entRecordAndToast(game, sort, disp) {
        if (!entAllowRecord()) return;
        var rank = entRecord(game, sort, disp);
        setTimeout(function () { entShowRecordToast(game, rank); }, 350);
    }

    function entShowRecordToast(game, justRank) {
        var area = g('entGameArea'); if (!area) return;
        var old = g('entRecordToast'); if (old) old.parentNode.removeChild(old);
        var list = entTopList(game);
        if (!list.length) return;
        var rows = list.map(function (e, i) {
            var medal = ['🥇','🥈','🥉'][i] || '';
            var hot = (justRank === i + 1) ? ' ent-rec-hot' : '';
            return '<div class="ent-rec-row' + hot + '"><span>' + medal + ' ' + entEsc(e.name) +
                   '</span><b>' + entEsc(e.disp) + '</b></div>';
        }).join('');
        var div = document.createElement('div');
        div.id = 'entRecordToast'; div.className = 'ent-rec-toast';
        div.innerHTML =
            '<div class="ent-rec-toast-title">' + (justRank ? '🎉 New record!' : '🏆 Top 3') +
            ' — ' + (GAME_NAMES[game] || game) + '</div>' + rows +
            '<button class="ent-rec-toast-close" type="button">✕</button>';
        area.appendChild(div);
        div.querySelector('.ent-rec-toast-close').onclick = function () {
            if (div.parentNode) div.parentNode.removeChild(div);
        };
    }

    function showRecordsModal() {
        var all = entLoadRecords();
        var cards = ENT_REC_GAMES.map(function (gm) {
            var list = all[gm] || [];
            var rows = list.length
                ? list.map(function (e, i) {
                    return '<div class="ent-rec-row"><span>' + (['🥇','🥈','🥉'][i] || '') + ' ' +
                           entEsc(e.name) + '</span><b>' + entEsc(e.disp) + '</b></div>';
                  }).join('')
                : '<div class="ent-rec-empty">No records yet — be the first!</div>';
            return '<div class="ent-rec-card"><div class="ent-rec-game">' +
                   (ENT_REC_ICON[gm] || '🎮') + ' ' + (GAME_NAMES[gm] || gm) + '</div>' + rows + '</div>';
        }).join('');
        var ov = document.createElement('div');
        ov.className = 'ent-rec-overlay'; ov.id = 'entRecOverlay';
        ov.innerHTML =
            '<div class="ent-rec-modal">' +
                '<h2>🏆 Hall of Fame — Top 3</h2>' +
                '<div class="ent-rec-grid">' + cards + '</div>' +
                '<div class="ent-rec-modal-actions">' +
                    '<button id="entRecClear" class="ent-rec-clear" type="button">Clear all records</button>' +
                    '<button id="entRecCloseBtn" class="ent-rec-closebtn" type="button">Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);
        g('entRecCloseBtn').onclick = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
        ov.addEventListener('click', function (e) { if (e.target === ov && ov.parentNode) ov.parentNode.removeChild(ov); });
        g('entRecClear').onclick = function () {
            if (window.confirm('Clear ALL game records? This cannot be undone.')) {
                entSaveRecords({});
                if (ov.parentNode) ov.parentNode.removeChild(ov);
            }
        };
    }

    // ════════════════════════════════════════════════════════════════
    //  WIRING
    // ════════════════════════════════════════════════════════════════
    function wireEntertainment() {
        var back = g('entertainmentBack');
        if (back) back.addEventListener('click', function () {
            cleanupOnlineChannel();
            if (typeof showDashboard === 'function') showDashboard();
        });

        // Game cards in lobby
        var lobby = g('entLobby');
        if (lobby) {
            lobby.querySelectorAll('.ent-game-card[data-game]').forEach(function (el) {
                el.addEventListener('click', function () { selectGame(el.dataset.game); });
            });
        }

        // Records: opt-in toggle + Hall of Fame viewer
        var allowChk = g('entAllowRecordChk');
        if (allowChk) {
            allowChk.checked = entAllowRecord();
            allowChk.addEventListener('change', function () { entSetAllowRecord(allowChk.checked); });
        }
        var viewBtn = g('entViewRecordsBtn');
        if (viewBtn) viewBtn.addEventListener('click', showRecordsModal);
    }

    // ────────────────────────────────────────────────────────────────
    //  PUBLIC API
    // ────────────────────────────────────────────────────────────────
    window.showEntertainment = showEntertainment;
    window.ENT = { show: showEntertainment };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireEntertainment);
    } else {
        setTimeout(wireEntertainment, 0);
    }

})();
