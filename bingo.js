const state = {
  roomCode: localStorage.getItem('bingoRoomCode') || '',
  roomStatus: 'waiting',
  playerId: localStorage.getItem('bingoPlayerId') || '',
  boardId: localStorage.getItem('bingoboardId') || '',
  sessionId: localStorage.getItem('bingoSessionId') || generateSessionId(),
  playerName: localStorage.getItem('bingoPlayerName') || '',
  boardNumbers: [],
  markedNumbers: [],
  calledNumbers: [],
  winners: [],
  players: [],
  dangerNumbers: {},
  socket: null,
  rollTimer: null,
  celebratedWinnerCount: 0,
};

const droppedLimbs = new Set(); // `${playerId}-${limbIndex}` — tracks animated limbs

const LIMB_KEYS = ['arm-l', 'arm-r', 'head', 'leg-l', 'leg-r'];

function createAvatarCard(player) {
  const card = document.createElement('div');
  card.className = 'avatar-card';
  card.dataset.playerId = player.id;

  const isMe = player.id === state.playerId;
  card.innerHTML = `
    <div class="avatar-figure">
      <svg viewBox="0 0 50 90" width="44" height="80" stroke="currentColor" stroke-linecap="round" fill="none" overflow="visible">
        <circle data-limb="head" cx="25" cy="12" r="9" fill="#fff" stroke-width="3"/>
        <line class="avatar-body" x1="25" y1="21" x2="25" y2="56" stroke-width="3"/>
        <line data-limb="arm-l" x1="25" y1="33" x2="7"  y2="47" stroke-width="3"/>
        <line data-limb="arm-r" x1="25" y1="33" x2="43" y2="47" stroke-width="3"/>
        <line data-limb="leg-l" x1="25" y1="56" x2="10" y2="76" stroke-width="3"/>
        <line data-limb="leg-r" x1="25" y1="56" x2="40" y2="76" stroke-width="3"/>
      </svg>
    </div>
    <div class="avatar-name">${player.name}${isMe ? '<span class="avatar-you"> ★</span>' : ''}</div>
  `;
  return card;
}

function renderAvatarArena(players = [], calledNumbers = [], dangerNumbers = {}) {
  const arena = document.getElementById('avatarArena');
  if (!arena) return;

  // Remove cards for players who have left
  arena.querySelectorAll('.avatar-card').forEach(card => {
    if (!players.find(p => p.id === card.dataset.playerId)) card.remove();
  });

  players.forEach(player => {
    let card = arena.querySelector(`[data-player-id="${player.id}"]`);
    if (!card) {
      card = createAvatarCard(player);
      arena.appendChild(card);
    }

    const dangers = dangerNumbers[player.id] || [];
    const lostLimbs = dangers.map(n => calledNumbers.includes(n));
    const eliminated = lostLimbs.length === 5 && lostLimbs.every(Boolean);

    lostLimbs.forEach((lost, i) => {
      const key = `${player.id}-${i}`;
      const limbEl = card.querySelector(`[data-limb="${LIMB_KEYS[i]}"]`);
      if (!limbEl) return;

      if (lost && !droppedLimbs.has(key)) {
        droppedLimbs.add(key);
        limbEl.classList.add('limb-dropping');
        limbEl.addEventListener('animationend', () => {
          limbEl.classList.remove('limb-dropping');
          limbEl.classList.add('limb-gone');
        }, { once: true });
      } else if (lost) {
        limbEl.classList.add('limb-gone');
      }
    });

    card.classList.toggle('avatar-eliminated', eliminated);
  });
}

localStorage.setItem('bingoSessionId', state.sessionId);

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function getCellNumbers(selector) {
  return Array.from(document.querySelectorAll(selector))
    .map((cell) => Number(cell.textContent))
    .filter((n) => Number.isInteger(n));
}

function showAlert(message, title) {
  return window.BingoDialog ? window.BingoDialog.alert(message, title) : Promise.resolve();
}

function showConfirm(message, title) {
  return window.BingoDialog ? window.BingoDialog.confirm(message, title) : Promise.resolve(false);
}

function showWarning(message, title) {
  return window.BingoDialog
    ? window.BingoDialog.warning(message, title)
    : showAlert(message, title);
}

// -----------------------------------------------------------------------------

function showLobbyView() {
  document.getElementById('lobby-view').classList.add('active');
  document.getElementById('game-view').classList.remove('active');
}

function showGameView() {
  document.getElementById('lobby-view').classList.remove('active');
  document.getElementById('game-view').classList.add('active');
}

// -----------------------------------------------------------------------------

function setRoomLabel() {
  const el = document.getElementById('roomCodeDisplay');
  if (el) el.textContent = state.roomCode || '-';
}

function updatePlayerNameDisplay() {
  const el = document.getElementById('playerName');
  if (el) el.textContent = state.playerName ? `Name: ${state.playerName}` : 'Name: -';
}

function updatePlayerCountDisplay(playerCount = 0) {
  const el = document.getElementById('playerCount');
  if (el) el.textContent = `${playerCount}/10`;
}

function renderPlayers(players = [], hostPlayerId = null) {
  const strip = document.getElementById('playersStrip');
  if (!strip) return;

  strip.innerHTML = '';

  if (players.length > 0) {
    const label = document.createElement('span');
    label.className = 'players-label';
    label.textContent = 'Players:';
    strip.appendChild(label);
  }

  players.forEach((player, index) => {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'player-separator';
      separator.textContent = ',';
      strip.appendChild(separator);
    }

    const tag = document.createElement('span');
    tag.className = 'player-tag';
    tag.classList.toggle('current', player.id === state.playerId);
    tag.classList.toggle('host', player.id === hostPlayerId);

    const name = document.createElement('span');
    name.textContent = player.name;
    tag.appendChild(name);

    const badges = [];
    if (player.id === hostPlayerId) badges.push('Host');
    if (player.id === state.playerId) badges.push('You');

    if (badges.length > 0) {
      const currentBadge = document.createElement('strong');
      currentBadge.textContent = `(${badges.join(', ')})`;
      tag.appendChild(currentBadge);
    }

    strip.appendChild(tag);
  });
}

function updateGameStatusDisplay() {
  const statusEl = document.getElementById('gameStatus');
  const playerReset = document.getElementById('playerReset');
  const active = state.roomStatus === 'active';
  const paused = !active && state.calledNumbers.length > 0;
  const locked = active || paused;

  if (statusEl) {
    statusEl.textContent = active ? 'In Progress' : paused ? 'Paused' : 'Waiting';
    statusEl.dataset.status = active ? 'active' : paused ? 'paused' : 'waiting';
  }

  if (playerReset) {
    playerReset.classList.toggle('game-locked', locked);
    playerReset.disabled = !state.boardId || locked;
    playerReset.style.opacity = playerReset.disabled ? '0.4' : '1';
  }
}

// -----------------------------------------------------------------------------

function renderBoard(numbers, markedNumbers = []) {
  const table = document.getElementById('bingoTable');
  if (!table) return;

  table.innerHTML = '';

  const headerRow = table.insertRow();
  ['B', 'I', 'N', 'G', 'O'].forEach((letter) => {
    const th = document.createElement('th');
    th.innerText = letter;
    headerRow.appendChild(th);
  });

  let idx = 0;
  for (let r = 0; r < 5; r++) {
    const row = table.insertRow();
    for (let c = 0; c < 5; c++) {
      const cell = row.insertCell();
      cell.innerText = numbers[idx];
      cell.dataset.n = numbers[idx];
      if (markedNumbers.includes(numbers[idx])) cell.classList.add('marked');
      cell.style.animationDelay = `${idx * 35}ms`;
      cell.classList.add('cell-deal');
      cell.addEventListener('animationend', () => cell.classList.remove('cell-deal'), { once: true });
      idx++;
    }
  }

  attachCellClickListeners();
}

function attachCellClickListeners() {
  document.querySelectorAll('#bingoTable td').forEach((cell) => {
    cell.removeEventListener('click', handleCellClick);
    cell.addEventListener('click', handleCellClick);
  });
}

function playSliceAnimation(cell) {
  const number = cell.textContent;

  const overlay = document.createElement('div');
  overlay.className = 'slice-overlay';

  const top = document.createElement('div');
  top.className = 'slice-half slice-top';
  top.textContent = number;

  const bot = document.createElement('div');
  bot.className = 'slice-half slice-bot';
  bot.textContent = number;

  overlay.appendChild(top);
  overlay.appendChild(bot);
  cell.appendChild(overlay);

  // Animate apart and STAY — CSS ::before/::after take over at the same offsets
  const opts = { duration: 220, easing: 'ease-out', fill: 'forwards' };
  top.animate([{ transform: 'translate(0, 0)' }, { transform: 'translate(-2px, -3px)' }], opts);
  bot.animate([{ transform: 'translate(0, 0)' }, { transform: 'translate(2px, 3px)' }], opts);

  setTimeout(() => overlay.remove(), 250);
}

async function handleCellClick(event) {
  const cell = event.target;
  const number = Number(cell.textContent);
  const isMarked = cell.classList.contains('marked');

  if (state.roomStatus !== 'active') {
    await showWarning(
      "Game hasn't started yet. Wait for the host to start the game.",
      'Game Waiting',
    );
    return;
  }

  if (!isMarked && !state.calledNumbers.includes(number)) {
    await showWarning('That number has not been called yet.', 'Not Called');
    return;
  }

  cell.classList.toggle('marked');
  state.markedNumbers = getCellNumbers('#bingoTable td.marked');

  if (!isMarked) playSliceAnimation(cell);

  try {
    await BingoApi.markBoard(state.boardId, state.sessionId, state.markedNumbers);
    await checkBingo();
  } catch (error) {
    await showAlert(error.message, 'Could Not Mark');
  }
}

async function resetPlayerBoard() {
  if (!state.boardId) {
    await showWarning('Join a room first.', 'No Room');
    return;
  }
  if (state.roomStatus === 'active') {
    await showWarning("Game is in progress. You can't reset your board right now.", 'Board Locked');
    return;
  }

  try {
    const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
    state.boardNumbers = data.numbers;
    state.markedNumbers = data.markedNumbers || [];
    renderBoard(state.boardNumbers, state.markedNumbers);
  } catch (error) {
    await showAlert(error.message, 'Could Not Reset');
  }
}

async function checkBingo() {
  if (state.winners.some((w) => w.playerId === state.playerId)) return;

  const marked = new Set(state.markedNumbers);

  const isMarkedAt = (r, c) => marked.has(state.boardNumbers[r * 5 + c]);
  const idx = [0, 1, 2, 3, 4];
  const hasWin =
    idx.some((r) => idx.every((c) => isMarkedAt(r, c))) ||
    idx.some((c) => idx.every((r) => isMarkedAt(r, c))) ||
    idx.every((i) => isMarkedAt(i, i)) ||
    idx.every((i) => isMarkedAt(i, 4 - i));

  if (!hasWin) return;

  try {
    const roomState = await BingoApi.claimBingo(state.boardId, state.sessionId);
    applyRoomState(roomState);
    celebrateNewWinners(roomState.winners || []);
  } catch (error) {
    await showAlert(error.message, 'Bingo Not Ready');
  }
}

function updateCalledNumbersList() {
  const list = document.getElementById('calledNumbersList');
  if (!list) return;
  list.innerHTML = state.calledNumbers.map((n) => `<div>${n}</div>`).join('');
}

function setRollDisplay(number, status, rolling = false) {
  const rollDisplay = document.getElementById('rollDisplay');
  const numberEl = document.getElementById('rollNumber');
  const statusEl = document.getElementById('rollStatus');

  const wasRolling = rollDisplay?.classList.contains('rolling') ?? false;
  if (rollDisplay) rollDisplay.classList.toggle('rolling', rolling);

  if (numberEl) {
    numberEl.textContent = number || '--';
    numberEl.classList.remove('roll-flick', 'roll-impact');
    void numberEl.offsetWidth; // force reflow to restart animation
    if (rolling) {
      numberEl.classList.add('roll-flick');
    } else if (wasRolling && number && number !== '--') {
      numberEl.classList.add('roll-impact');
    }
  }

  if (statusEl) statusEl.textContent = status;
}

function updateRollDisplayFromState() {
  const latestNumber = state.calledNumbers[state.calledNumbers.length - 1];
  setRollDisplay(latestNumber || '--', latestNumber ? 'Latest called number' : 'Waiting for host');
}

function playNumberRoll({ sequence = [], durationMs = 1800 } = {}) {
  if (!sequence.length) return;

  if (state.rollTimer) {
    clearInterval(state.rollTimer);
    state.rollTimer = null;
  }

  let index = 0;
  const intervalMs = Math.max(60, Math.floor(durationMs / sequence.length));

  setRollDisplay(sequence[0], 'Rolling...', true);
  if (window.BingoCaller && typeof window.BingoCaller.setRollEnabled === 'function') {
    window.BingoCaller.setRollEnabled(false);
  }

  state.rollTimer = setInterval(() => {
    index += 1;
    const value = sequence[Math.min(index, sequence.length - 1)];
    setRollDisplay(value, 'Rolling...', true);

    if (index >= sequence.length - 1) {
      clearInterval(state.rollTimer);
      state.rollTimer = null;
    }
  }, intervalMs);
}

function renderWinners() {
  const banner = document.getElementById('winnerBanner');
  const nameEl = document.getElementById('winnerName');
  if (!banner || !nameEl) return;

  if (!state.winners.length) {
    banner.classList.remove('active');
    nameEl.textContent = 'No winner yet';
    return;
  }

  banner.classList.add('active');
  nameEl.textContent = state.winners[0].name;
}

function celebrateNewWinners(winners = []) {
  if (winners.length <= state.celebratedWinnerCount) return;

  state.celebratedWinnerCount = winners.length;
  if (typeof launchConfetti === 'function') launchConfetti();
}

function applyRoomState(roomState) {
  if (!roomState) return;

  state.roomCode = roomState.code || state.roomCode;
  state.roomStatus = roomState.status || state.roomStatus;
  state.calledNumbers = roomState.calledNumbers || [];
  state.winners = roomState.winners || [];
  state.players = roomState.players || state.players;
  if (roomState.dangerNumbers) state.dangerNumbers = roomState.dangerNumbers;

  localStorage.setItem('bingoRoomCode', state.roomCode);

  setRoomLabel();
  updateGameStatusDisplay();
  updatePlayerCountDisplay(roomState.playerCount || 0);
  renderPlayers(roomState.players || [], roomState.hostPlayerId);
  updateCalledNumbersList();
  if (!state.rollTimer) updateRollDisplayFromState();
  renderWinners();
  renderAvatarArena(roomState.players || [], state.calledNumbers, state.dangerNumbers);

  // Notify caller module of host status and player list
  if (window.BingoCaller && typeof window.BingoCaller.applyRoomState === 'function') {
    window.BingoCaller.applyRoomState(roomState, state.playerId);
  }
}

// -----------------------------------------------------------------------------

function connectSocket(code) {
  if (!code || !window.io) return;

  if (!state.socket) {
    state.socket = window.io();

    state.socket.on('room-state', applyRoomState);

    state.socket.on('number-called', (payload) => {
      if (state.rollTimer) {
        clearInterval(state.rollTimer);
        state.rollTimer = null;
      }

      state.calledNumbers = payload.calledNumbers || state.calledNumbers;
      setRollDisplay(
        payload.number || state.calledNumbers[state.calledNumbers.length - 1] || '--',
        'Called number',
      );
      updateCalledNumbersList();
      renderAvatarArena(state.players, state.calledNumbers, state.dangerNumbers);
      if (window.BingoCaller && typeof window.BingoCaller.setRollEnabled === 'function') {
        window.BingoCaller.setRollEnabled(
          state.roomStatus === 'active' && state.calledNumbers.length < 25,
        );
      }
    });

    state.socket.on('number-roll', playNumberRoll);

    state.socket.on('game-reset', async (roomState) => {
      state.markedNumbers = [];
      state.celebratedWinnerCount = 0;
      droppedLimbs.clear();
      const arena = document.getElementById('avatarArena');
      if (arena) arena.innerHTML = '';
      applyRoomState(roomState);
      updateRollDisplayFromState();

      const isNotHost = roomState.hostPlayerId !== state.playerId;
      let refreshFailed = false;

      if (state.boardId && state.sessionId) {
        try {
          const data = await BingoApi.resetBoard(state.boardId, state.sessionId);
          state.boardNumbers = data.numbers;
          state.markedNumbers = data.markedNumbers || [];
        } catch (_) {
          refreshFailed = true;
        }
      }
      renderBoard(state.boardNumbers, []);

      if (isNotHost) {
        if (refreshFailed) {
          showWarning(
            'The host reset the game but your board could not be refreshed. Use "Reset Board" to get new numbers.',
            'Game Reset',
          );
        } else {
          showAlert('The host has reset the game. Your board has been refreshed.', 'Game Reset');
        }
      }
    });

    state.socket.on('host-transferred', (roomState) => {
      const becameHost = roomState.hostPlayerId === state.playerId;
      applyRoomState(roomState);
      if (becameHost) {
        const msg = roomState.fromName
          ? `${roomState.fromName} handed off the host role to you.`
          : 'The previous host left. You are now the host!';
        showAlert(msg, "You're the Host");
      }
    });
    state.socket.on('winner-added', (roomState) => {
      applyRoomState(roomState);
      celebrateNewWinners(roomState.winners || []);
    });

    state.socket.on('game-over', (roomState) => {
      applyRoomState(roomState);
      showAlert('All 25 numbers have been called with no winner. The game has ended.', 'Game Over');
    });

    state.socket.on('error', (payload) => {
      if (payload && payload.error) showAlert(payload.error, 'Room Error');
    });

    // Re-join socket room and resync board on reconnect
    state.socket.io.on('reconnect', async () => {
      state.socket.emit('join-room', { code, sessionId: state.sessionId });
      if (!state.boardId) return;
      try {
        const data = await BingoApi.joinRoom(code, state.playerName, state.sessionId);
        state.boardNumbers = data.numbers;
        state.markedNumbers = data.markedNumbers || [];
        renderBoard(state.boardNumbers, state.markedNumbers);
      } catch (_) {}
    });
  }

  state.socket.emit('join-room', { code, sessionId: state.sessionId });
}

// -----------------------------------------------------------------------------

async function createRoom() {
  try {
    // Create room - sessionId is the host identity
    const room = await BingoApi.createRoom(state.sessionId);

    // Auto-join as player so host also gets a board
    const name = document.getElementById('playerNameInput')?.value.trim() || '';
    const data = await BingoApi.joinRoom(room.code, name, state.sessionId);

    state.roomCode = data.room.code;
    state.playerId = data.playerId;
    state.boardId = data.boardId;
    state.playerName = data.playerName;
    state.boardNumbers = data.numbers;
    state.markedNumbers = data.markedNumbers || [];

    localStorage.setItem('bingoRoomCode', state.roomCode);
    localStorage.setItem('bingoPlayerId', state.playerId);
    localStorage.setItem('bingoboardId', state.boardId);
    localStorage.setItem('bingoPlayerName', state.playerName);

    renderBoard(state.boardNumbers, state.markedNumbers);
    updatePlayerNameDisplay();
    applyRoomState(data.room);
    connectSocket(state.roomCode);
    showGameView();
  } catch (error) {
    await showAlert(error.message, 'Could Not Create Room');
  }
}

async function joinRoom() {
  const code = document.getElementById('roomCodeInput')?.value.trim().toUpperCase() || '';
  const name = document.getElementById('playerNameInput')?.value.trim() || '';

  if (!code) {
    await showAlert('Enter a room code.', 'Room Code Needed');
    return;
  }

  try {
    const data = await BingoApi.joinRoom(code, name, state.sessionId);

    state.roomCode = data.room.code;
    state.playerId = data.playerId;
    state.boardId = data.boardId;
    state.playerName = data.playerName;
    state.boardNumbers = data.numbers;
    state.markedNumbers = data.markedNumbers || [];

    localStorage.setItem('bingoRoomCode', state.roomCode);
    localStorage.setItem('bingoPlayerId', state.playerId);
    localStorage.setItem('bingoboardId', state.boardId);
    localStorage.setItem('bingoPlayerName', state.playerName);

    renderBoard(state.boardNumbers, state.markedNumbers);
    updatePlayerNameDisplay();
    applyRoomState(data.room);
    connectSocket(state.roomCode);
    showGameView();
  } catch (error) {
    await showAlert(error.message, 'Could Not Join Room');
  }
}

async function restoreRoom() {
  if (!state.roomCode) return;

  try {
    const data = await BingoApi.joinRoom(state.roomCode, state.playerName, state.sessionId);

    state.playerId = data.playerId;
    state.boardId = data.boardId;
    state.playerName = data.playerName;
    state.boardNumbers = data.numbers;
    state.markedNumbers = data.markedNumbers || [];

    localStorage.setItem('bingoPlayerId', state.playerId);
    localStorage.setItem('bingoboardId', state.boardId);
    localStorage.setItem('bingoPlayerName', state.playerName);

    renderBoard(state.boardNumbers, state.markedNumbers);
    updatePlayerNameDisplay();
    applyRoomState(data.room);
    connectSocket(state.roomCode);
    showGameView();
  } catch (error) {
    console.warn('Could not restore room:', error.message);
    localStorage.removeItem('bingoRoomCode');
    localStorage.removeItem('bingoPlayerId');
    localStorage.removeItem('bingoboardId');
    state.roomCode = '';
    state.playerId = '';
    state.boardId = '';
  }
}

async function leaveRoom() {
  if (!(await showConfirm('Leave this room?', 'Leave Room'))) return;

  if (state.rollTimer) {
    clearInterval(state.rollTimer);
    state.rollTimer = null;
  }

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  ['bingoRoomCode', 'bingoPlayerId', 'bingoboardId', 'bingoPlayerName'].forEach((k) =>
    localStorage.removeItem(k),
  );

  Object.assign(state, {
    roomCode: '',
    playerId: '',
    boardId: '',
    playerName: '',
    boardNumbers: [],
    markedNumbers: [],
    calledNumbers: [],
    winners: [],
    roomStatus: 'waiting',
    rollTimer: null,
    celebratedWinnerCount: 0,
  });

  const table = document.getElementById('bingoTable');
  if (table) table.innerHTML = '';

  updateCalledNumbersList();
  updateRollDisplayFromState();
  renderPlayers();
  renderWinners();
  updatePlayerNameDisplay();
  setRoomLabel();

  if (window.BingoCaller && typeof window.BingoCaller.setHostStatus === 'function') {
    window.BingoCaller.setHostStatus(false, []);
  }

  showLobbyView();
}

// -----------------------------------------------------------------------------

function lobbyArrowSequence() {
  const oEl = document.querySelector('.lobby-o');
  const lobbyView = document.getElementById('lobby-view');
  const header = document.querySelector('.lobby-header');
  if (!oEl || !lobbyView || !header || oEl.dataset.animating) return;
  oEl.dataset.animating = '1';

  const arrow = document.createElement('div');
  arrow.className = 'lobby-arrow';
  lobbyView.appendChild(arrow);

  const oRect = oEl.getBoundingClientRect();
  const lvRect = lobbyView.getBoundingClientRect();
  const hRect = header.getBoundingClientRect();

  const floorY = hRect.bottom - oRect.bottom;
  const oRadius = oRect.height / 2;

  // O centre relative to lobbyView
  const oX = oRect.left - lvRect.left + oRect.width * 0.2;
  const oY = oRect.top - lvRect.top + oRect.height * 0.2;

  // Arrow starts off-screen top-right (1-2 o'clock)
  const startX = lvRect.width + 80;
  const startY = oY - 180;

  // Angle from start → O centre
  const angleDeg = Math.atan2(oY - startY, oX - startX) * (180 / Math.PI);

  arrow.style.left = '0';
  arrow.style.top = '0';

  // Phase 1: arrow flies in diagonally
  arrow
    .animate(
      [
        { transform: `translate(${startX}px, ${startY}px) rotate(${angleDeg}deg)` },
        { transform: `translate(${oX}px,     ${oY}px)     rotate(${angleDeg}deg)` },
      ],
      { duration: 200, easing: 'ease-in', fill: 'forwards' },
    )
    .finished.then(() => new Promise((r) => setTimeout(r, 1000)))
    .then(() => {
      arrow.remove();
      // rAF physics — gravity, bounce, roll
      let x = 0,
        y = 0;
      let vx = 0.3,
        vy = 0; // drop straight down
      const gravity = 0.02;
      const dampen = 0.7; // energy kept per bounce
      const exitX = 480;
      const fadeAt = 360;

      function tick() {
        vy += gravity;
        x += vx;
        y += vy;

        if (y >= floorY) {
          y = floorY;
          vy *= -dampen;
          if (Math.abs(vy) < 0.8) vy = 0; // kill micro-bounces
        }

        if (vy === 0) vx *= 1.01; // accelerate once rolling on floor

        // tyre rotation: degrees = distance / circumference * 360
        const rot = (x / (2 * Math.PI * oRadius)) * 360;
        const opacity = x > fadeAt ? Math.max(0, 1 - (x - fadeAt) / (exitX - fadeAt)) : 1;

        oEl.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
        oEl.style.opacity = opacity;

        if (x < exitX && lobbyView.classList.contains('active')) {
          requestAnimationFrame(tick);
        } else {
          oEl.style.transform = '';
          oEl.style.opacity = '';
          delete oEl.dataset.animating;
        }
      }

      requestAnimationFrame(tick);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const lobbyView = document.getElementById('lobby-view');
  lobbyView.addEventListener('mousemove', (e) => {
    lobbyView.style.setProperty('--mx', e.clientX + 'px');
    lobbyView.style.setProperty('--my', e.clientY + 'px');
  });

  setTimeout(lobbyArrowSequence, 1800);
  setInterval(lobbyArrowSequence, 5500);

  document.getElementById('createRoom')?.addEventListener('click', createRoom);
  document.getElementById('joinRoom')?.addEventListener('click', joinRoom);
  document.getElementById('playerReset')?.addEventListener('click', resetPlayerBoard);
  document.getElementById('leaveRoom')?.addEventListener('click', leaveRoom);

  document.getElementById('copyRoomCode')?.addEventListener('click', () => {
    if (!state.roomCode) return;
    navigator.clipboard.writeText(state.roomCode).then(() => {
      const btn = document.getElementById('copyRoomCode');
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 1500);
    });
  });

  ['roomCodeInput', 'playerNameInput'].forEach((id) => {
    document.getElementById(id)?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinRoom();
    });
  });

  restoreRoom();
});

window.BingoApp = { state, applyRoomState, connectSocket, updateCalledNumbersList };
