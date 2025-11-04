
// server.js — Hangman with single room + chat sidebar
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
const ROOM_KEY = 'our-little-game';

const MAX_MISTAKES = 6;
function newState() {
  return {
    players: {},
    order: [],
    status: 'lobby',
    phase: 'idle',
    totalRounds: 3,
    currentPair: 0,
    turn: null,
    answer: '',
    revealed: [],
    guesses: [],
    mistakes: 0,
    chat: []
  };
}
const rooms = new Map([[ROOM_KEY, newState()]]);

function resetForNewMatch(roomKey, keepPlayers=false) {
  const prev = rooms.get(roomKey) || newState();
  const next = newState();
  if (keepPlayers) {
    next.players = prev.players;
    next.order = prev.order;
  }
  rooms.set(roomKey, next);
}

function getOpponentId(state, sid) {
  return state.order.find(id => id !== sid);
}

function scoreForMistakes(m) {
  if (m <= 0) return 100;
  if (m === 1) return 80;
  if (m === 2) return 60;
  if (m === 3) return 40;
  return 20;
}

io.on('connection', (socket) => {

  socket.on('joinRoom', ({ roomKey, name }) => {
    const key = ROOM_KEY;
    if (!rooms.get(key)) rooms.set(key, newState());
    const s = rooms.get(key);

    const nm = String(name || 'Player').slice(0,20);
    if (Object.keys(s.players).length >= 2 && !s.players[socket.id]) {
      socket.emit('gameFull');
      return;
    }
    if (!s.players[socket.id]) {
      s.players[socket.id] = { name: nm, ready: false, word: null, hint: null, score: 0 };
      s.order.push(socket.id);
    } else {
      s.players[socket.id].name = nm;
    }

    socket.join(key);
    io.to(key).emit('lobbyUpdate', serializeLobby(s));
    socket.emit('chatHistory', s.chat);
    const joinMsg = { name: 'System', text: `${nm} joined`, ts: Date.now() };
    s.chat.push(joinMsg);
    io.to(key).emit('chatMessage', joinMsg);
  });

  socket.on('setRounds', (n) => {
    const s = rooms.get(ROOM_KEY);
    if (!s) return;
    if (s.status !== 'lobby') return;
    if (socket.id !== s.order[0]) return;
    const N = Math.max(1, Math.min(10, Number(n) || 1));
    s.totalRounds = N;
    io.to(ROOM_KEY).emit('lobbyUpdate', serializeLobby(s));
  });

  socket.on('setReady', (ready) => {
    const s = rooms.get(ROOM_KEY);
    if (!s || !s.players[socket.id]) return;
    s.players[socket.id].ready = !!ready;
    io.to(ROOM_KEY).emit('lobbyUpdate', serializeLobby(s));
    if (s.status === 'lobby' && s.order.length === 2) {
      const bothReady = s.order.every(id => s.players[id].ready);
      if (bothReady) {
        s.status = 'entry';
        io.to(ROOM_KEY).emit('phaseWordEntry', { round: s.currentPair + 1, totalRounds: s.totalRounds });
      }
    }
  });

  socket.on('submitWord', ({ word, hint }) => {
    const s = rooms.get(ROOM_KEY);
    if (!s || !s.players[socket.id]) return;
    const cleanWord = String(word || '').toUpperCase().replace(/[^A-Z]/g,'').slice(0,16);
    const cleanHint = String(hint || '').slice(0,120);
    s.players[socket.id].word = cleanWord;
    s.players[socket.id].hint = cleanHint;
    io.to(ROOM_KEY).emit('lobbyUpdate', serializeLobby(s));
    const A = s.players[s.order[0]];
    const B = s.players[s.order[1]];
    if (s.status === 'entry' && A?.word && B?.word) {
      startPair(s, 'roundA');
      io.to(ROOM_KEY).emit('startRound', serializeRound(s));
    }
  });

  socket.on('requestHint', () => {
    const s = rooms.get(ROOM_KEY);
    if (!s) return;
    const opp = getOpponentId(s, s.turn);
    const hint = s.players[opp]?.hint || '';
    io.to(ROOM_KEY).emit('hint', { hint });
  });

  socket.on('guess', (letter) => {
    const s = rooms.get(ROOM_KEY);
    if (!s || s.phase !== 'playing') return;
    if (socket.id !== s.turn) return;
    const L = String(letter || '').toUpperCase().replace(/[^A-Z]/g,'');
    if (L.length !== 1) return;
    if (s.guesses.includes(L)) return;

    s.guesses.push(L);
    let hit = false;
    for (let i = 0; i < s.answer.length; i++) {
      if (s.answer[i] === L) { s.revealed[i] = true; hit = true; }
    }
    if (!hit) s.mistakes += 1;

    io.to(ROOM_KEY).emit('board', serializeRound(s), { last: L, hit });

    if (s.revealed.every(Boolean)) {
      const scorer = s.players[s.turn];
      const pts = scoreForMistakes(s.mistakes);
      scorer.score += pts;
      s.phase = 'result';
      io.to(ROOM_KEY).emit('roundResult', { correct: true, message: `Your guess was CORRECT.
Your score is ${pts} points.` });
    } else if (s.mistakes >= MAX_MISTAKES) {
      s.phase = 'result';
      io.to(ROOM_KEY).emit('roundResult', { correct: false, message: `Out of tries. Word was ${s.answer}.` });
    }
  });

  socket.on('next', () => {
    const s = rooms.get(ROOM_KEY);
    if (!s) return;
    if (s.status === 'roundA' && s.phase === 'result') {
      startPair(s, 'roundB');
      io.to(ROOM_KEY).emit('startRound', serializeRound(s));
    } else if (s.status === 'roundB' && s.phase === 'result') {
      s.currentPair += 1;
      if (s.currentPair >= s.totalRounds) {
        s.status = 'finished';
        s.phase = 'idle';
        const scores = s.order.map(id => ({ id, name: s.players[id].name, score: s.players[id].score }));
        let winnerMsg = 'It\'s a tie!';
        if (scores[0].score > scores[1].score) winnerMsg = `${scores[0].name} wins!`;
        else if (scores[1].score > scores[0].score) winnerMsg = `${scores[1].name} wins!`;
        io.to(ROOM_KEY).emit('matchFinished', { scores, winnerMsg });
      } else {
        for (const id of s.order) { s.players[id].word = null; s.players[id].hint = null; }
        s.status = 'entry';
        io.to(ROOM_KEY).emit('phaseWordEntry', { round: s.currentPair + 1, totalRounds: s.totalRounds });
      }
    }
  });

  // Chat
  socket.on('chatSend', (text) => {
    const s = rooms.get(ROOM_KEY);
    if (!s || !s.players[socket.id]) return;
    const name = s.players[socket.id].name || 'Player';
    const clean = String(text || '').slice(0, 400).trim();
    if (!clean) return;
    const msg = { name, text: clean, ts: Date.now() };
    s.chat.push(msg);
    if (s.chat.length > 200) s.chat.shift();
    io.to(ROOM_KEY).emit('chatMessage', msg);
  });

  socket.on('disconnect', () => {
    const s = rooms.get(ROOM_KEY);
    if (!s) return;
    if (s.players[socket.id]) {
      const nm = s.players[socket.id].name;
      delete s.players[socket.id];
      s.order = s.order.filter(id => id !== socket.id);
      const keep = s.order.length > 0;
      resetForNewMatch(ROOM_KEY, keep);
      io.to(ROOM_KEY).emit('lobbyUpdate', serializeLobby(rooms.get(ROOM_KEY)));
      const leaveMsg = { name: 'System', text: `${nm} left`, ts: Date.now() };
      rooms.get(ROOM_KEY).chat.push(leaveMsg);
      io.to(ROOM_KEY).emit('chatMessage', leaveMsg);
    }
  });
});

function startPair(state, which) {
  state.status = which;
  state.phase = 'playing';
  state.mistakes = 0;
  state.guesses = [];
  const guesser = (which === 'roundA') ? state.order[0] : state.order[1];
  const setter  = state.order.find(id => id !== guesser);
  state.turn = guesser;
  state.answer = (state.players[setter].word || '').toUpperCase();
  state.revealed = Array(state.answer.length).fill(false);
}

function serializeLobby(state) {
  return {
    status: state.status,
    rounds: state.totalRounds,
    players: state.order.map(id => ({
      id,
      name: state.players[id]?.name || 'Unknown',
      ready: !!state.players[id]?.ready,
      hasWord: !!state.players[id]?.word,
      score: state.players[id]?.score || 0
    }))
  };
}

function serializeRound(state) {
  return {
    status: state.status,
    phase: state.phase,
    turn: state.turn,
    playerOrder: state.order,
    mistakes: state.mistakes,
    maxMistakes: 6,
    guesses: state.guesses,
    mask: state.revealed.map((v,i)=> v ? state.answer[i] : "_")
  };
}

server.listen(PORT, () => {
  console.log('Hangman server listening on http://localhost:' + PORT);
});
