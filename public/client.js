
const $ = (s) => document.querySelector(s);
const view = {
  rooms: $('#rooms'),
  join: $('#join'),
  lobby: $('#lobby'),
  entry: $('#entry'),
  board: $('#board'),
  result: $('#result'),
  finished: $('#finished'),
};
function show(id) {
  Object.values(view).forEach(v => v.classList.add('hidden'));
  view[id].classList.remove('hidden');
}

const socket = io();
let myId = null;

const joinRoomBtn = $('#joinRoomBtn');
const joinBtn = $('#joinBtn');
const nameInput = $('#playerName');
const roundsSel = $('#roundsSel');
const readyBtn = $('#readyBtn');
const playersEl = $('#players');

const wordInput = $('#wordInput');
const hintInput = $('#hintInput');
const playBtn = $('#playBtn');
const entryTitle = $('#entryTitle');

const maskEl = $('#mask');
const mistakesEl = $('#mistakes');
const maxMistakesEl = $('#maxMistakes');
const keyboardEl = $('#kbd');
const turnTitle = $('#turnTitle');
const hintBtn = $('#hintBtn');
const hintText = $('#hintText');

const resultText = $('#resultText');
const nextBtn = $('#nextBtn');
const scoreBoard = $('#scoreBoard');
const winnerText = $('#winnerText');

const chatToggle = $('#chatToggle');
const chatPanel = $('#chat');
const chatClose = $('#chatClose');
const chatMessages = $('#chatMessages');
const chatInput = $('#chatInput');
const chatSend = $('#chatSend');

chatToggle.onclick = () => chatPanel.classList.toggle('hidden');
chatClose.onclick = () => chatPanel.classList.add('hidden');

chatSend.onclick = sendChat;
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});
function sendChat() {
  const txt = (chatInput.value || '').trim();
  if (!txt) return;
  socket.emit('chatSend', txt);
  chatInput.value = '';
}

joinRoomBtn.onclick = () => { show('join'); };
joinBtn.onclick = () => {
  const nm = (nameInput.value || '').trim() || 'Player';
  socket.emit('joinRoom', { roomKey: 'our-little-game', name: nm });
  socket.emit('setRounds', Number(roundsSel.value));
};

roundsSel.onchange = () => socket.emit('setRounds', Number(roundsSel.value));
readyBtn.onclick = () => socket.emit('setReady', true);

playBtn.onclick = () => {
  const word = wordInput.value.trim().toUpperCase();
  const hint = hintInput.value.trim();
  if (!/^[A-Z]{1,16}$/.test(word)) { alert('Word must be letters only, 1–16 chars.'); return; }
  socket.emit('submitWord', { word, hint });
  playBtn.disabled = true;
  playBtn.textContent = 'Waiting...';
};

hintBtn.onclick = () => socket.emit('requestHint');
nextBtn.onclick = () => socket.emit('next');

socket.on('connect', () => { myId = socket.id; });
socket.on('gameFull', () => alert('Two players already connected.'));

socket.on('lobbyUpdate', (data) => {
  playersEl.innerHTML = '';
  data.players.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pill';
    d.textContent = `${p.name} ${p.ready ? '✓' : ''} ${p.hasWord ? '•' : ''} — ${p.score}`;
    playersEl.appendChild(d);
  });
  roundsSel.value = String(data.rounds);
  if (data.status === 'lobby') show('lobby');
});

socket.on('phaseWordEntry', ({ round, totalRounds }) => {
  entryTitle.textContent = `Round ${round} / ${totalRounds} — Enter your word and hint`;
  wordInput.value = '';
  hintInput.value = '';
  playBtn.disabled = false;
  playBtn.textContent = 'PLAY';
  hintText.textContent = '';
  show('entry');
});

socket.on('startRound', (round) => { setBoard(round); show('board'); });
socket.on('board', (round, info) => setBoard(round, info));
socket.on('hint', ({ hint }) => { hintText.textContent = hint || '(no hint)'; });

socket.on('roundResult', ({ correct, message }) => {
  resultText.textContent = message;
  show('result');
});

socket.on('matchFinished', ({ scores, winnerMsg }) => {
  const lines = scores.map(s => `${s.name}: ${s.score} points`).join('<br>');
  scoreBoard.innerHTML = lines;
  winnerText.textContent = winnerMsg;
  show('finished');
});

function setBoard(round, info) {
  const isMyTurn = (round.turn === myId);
  turnTitle.textContent = isMyTurn ? "Your turn" : "Spectating";
  maskEl.textContent = round.mask.join(' ');
  mistakesEl.textContent = round.mistakes;
  maxMistakesEl.textContent = round.maxMistakes;
  keyboardEl.innerHTML = '';
  for (let c = 65; c <= 90; c++) {
    const L = String.fromCharCode(c);
    const key = document.createElement('div');
    key.className = 'key';
    key.textContent = L;
    if (round.guesses.includes(L)) {
      key.classList.add('used');
      let wasHit = false;
      if (info && info.last === L) wasHit = info.hit;
      else wasHit = round.mask.includes(L);
      key.classList.add(wasHit ? 'right' : 'wrong');
    }
    if (isMyTurn && round.phase === 'playing' && !round.guesses.includes(L)) {
      key.onclick = () => socket.emit('guess', L);
    }
    keyboardEl.appendChild(key);
  }
  hintText.textContent = '';
}

// Chat events
socket.on('chatHistory', (items) => {
  chatMessages.innerHTML = '';
  items.forEach(addMsg);
  chatScroll();
});
socket.on('chatMessage', (msg) => {
  addMsg(msg);
  chatScroll();
});

function addMsg({name, text, ts}) {
  const div = document.createElement('div');
  div.className = 'msg';
  if (name === 'System') {
    div.innerHTML = `<span class="sys">[${new Date(ts).toLocaleTimeString()}] ${text}</span>`;
  } else {
    div.innerHTML = `<span class="who">${name}:</span> <span class="txt">${escapeHtml(text)}</span>`;
  }
  chatMessages.appendChild(div);
}
function chatScroll() { chatMessages.scrollTop = chatMessages.scrollHeight; }
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
