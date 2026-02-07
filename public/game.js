// Socket.io client
const socket = io();

// Game state
let gameState = {
    roomCode: null,
    playerName: null,
    role: null,
    isGnosia: false,
    phase: 'lobby',
    isHost: false,
    players: [],
    selectedVote: null
};

// DOM Elements
const screens = {
    landing: document.getElementById('landing-screen'),
    room: document.getElementById('room-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen')
};

// Utility Functions
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 3000);
}

function addChatMessage(sender, message) {
    const chatMessages = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    messageEl.innerHTML = `<span class="sender">${sender}:</span> ${message}`;
    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Landing Screen
document.getElementById('create-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Create Room';
    document.getElementById('room-code-input').classList.add('hidden');
    document.getElementById('submit-room-btn').textContent = 'Create';
    document.getElementById('submit-room-btn').onclick = createRoom;
});

document.getElementById('join-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Join Room';
    document.getElementById('room-code-input').classList.remove('hidden');
    document.getElementById('submit-room-btn').textContent = 'Join';
    document.getElementById('submit-room-btn').onclick = joinRoom;
});

document.getElementById('back-btn').addEventListener('click', () => {
    showScreen('landing');
    document.getElementById('player-name-input').value = '';
    document.getElementById('room-code-input').value = '';
});

function createRoom() {
    const playerName = document.getElementById('player-name-input').value.trim();
    if (!playerName) {
        showNotification('Please enter your name');
        return;
    }
    gameState.playerName = playerName;
    gameState.isHost = true;
    socket.emit('createRoom', playerName);
}

function joinRoom() {
    const playerName = document.getElementById('player-name-input').value.trim();
    const roomCode = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (!playerName || !roomCode) {
        showNotification('Please enter your name and room code');
        return;
    }
    gameState.playerName = playerName;
    socket.emit('joinRoom', { roomCode, playerName });
}

// Lobby Screen
document.getElementById('start-game-btn').addEventListener('click', () => {
    socket.emit('startGame', gameState.roomCode);
});

function updatePlayerList(players, gameStarted = false) {
    const container = document.getElementById('player-list');
    container.innerHTML = '<h3>Players:</h3>';
    players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-item';
        if (!player.isAlive && gameStarted) {
            playerEl.classList.add('dead');
        }
        playerEl.textContent = player.name;
        container.appendChild(playerEl);
    });
}

function updateGamePlayerList(players) {
    const container = document.getElementById('game-player-list');
    container.innerHTML = '';
    players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-item';
        if (!player.isAlive) {
            playerEl.classList.add('dead');
        }
        playerEl.innerHTML = `
            <strong>${player.name}</strong>
            ${player.isAlive ? '<span style="color: #4ade80;">● Alive</span>' : '<span style="color: #f87171;">● Frozen/Dead</span>'}
        `;
        container.appendChild(playerEl);
    });
}

// Game Screen
document.getElementById('ready-btn').addEventListener('click', () => {
    socket.emit('readyForNextPhase', { 
        roomCode: gameState.roomCode,
        phase: gameState.phase
    });
    document.getElementById('ready-btn').disabled = true;
    document.getElementById('ready-btn').textContent = 'Waiting for others...';
});

document.getElementById('send-chat-btn').addEventListener('click', sendChat);
document.getElementById('chat-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChat();
});

function sendChat() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    if (message) {
        socket.emit('chatMessage', { roomCode: gameState.roomCode, message });
        input.value = '';
    }
}

function updatePhase(phase, instructions) {
    gameState.phase = phase;
    const phaseText = document.getElementById('current-phase');
    const instructionText = document.getElementById('instruction-text');
    const votingSection = document.getElementById('voting-section');
    const gnosiaSection = document.getElementById('gnosia-section');
    const readyBtn = document.getElementById('ready-btn');

    votingSection.classList.add('hidden');
    gnosiaSection.classList.add('hidden');
    readyBtn.classList.remove('hidden');
    readyBtn.disabled = false;
    readyBtn.textContent = 'Ready for Next Phase';

    if (phase === 'debate') {
        phaseText.textContent = 'Debate Phase';
        instructionText.textContent = 'Discuss with others on voice chat who you think is Gnosia.';
    } else if (phase === 'voting') {
        phaseText.textContent = 'Voting Phase';
        instructionText.textContent = 'Vote for who to put in Deep Freeze.';
        votingSection.classList.remove('hidden');
        readyBtn.classList.add('hidden');
        showVoteOptions();
    } else if (phase === 'warp') {
        phaseText.textContent = 'Warp Phase';
        if (gameState.isGnosia) {
            instructionText.textContent = 'Waiting for Gnosia to eliminate someone...';
        } else {
            instructionText.textContent = 'The ship is warping. Gnosia are selecting their target...';
        }
    }
}

function showVoteOptions() {
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    gameState.players.forEach(player => {
        if (player.isAlive && player.id !== socket.id) {
            const btn = document.createElement('button');
            btn.className = 'vote-btn';
            btn.textContent = player.name;
            btn.onclick = () => submitVote(player.id, btn);
            container.appendChild(btn);
        }
    });
}

function submitVote(playerId, btnElement) {
    document.querySelectorAll('.vote-btn').forEach(btn => btn.classList.remove('selected'));
    btnElement.classList.add('selected');
    socket.emit('submitVote', { roomCode: gameState.roomCode, targetPlayerId: playerId });
    showNotification('Vote submitted');
}

function showGnosiaEliminationOptions(alivePlayers) {
    const container = document.getElementById('elimination-options');
    const section = document.getElementById('gnosia-section');
    const readyBtn = document.getElementById('ready-btn');
    
    container.innerHTML = '';
    section.classList.remove('hidden');
    readyBtn.classList.add('hidden');

    alivePlayers.forEach(player => {
        if (player.id !== socket.id) {
            const btn = document.createElement('button');
            btn.className = 'vote-btn';
            btn.textContent = player.name;
            btn.onclick = () => {
                socket.emit('gnosiaEliminate', { 
                    roomCode: gameState.roomCode, 
                    targetPlayerId: player.id 
                });
                section.classList.add('hidden');
                showNotification('Target eliminated');
            };
            container.appendChild(btn);
        }
    });
}

// Game Over Screen
document.getElementById('return-lobby-btn').addEventListener('click', () => {
    window.location.reload();
});

// Socket Event Handlers
socket.on('roomCreated', ({ roomCode, playerName }) => {
    gameState.roomCode = roomCode;
    showScreen('lobby');
    document.getElementById('display-room-code').textContent = roomCode;
    document.getElementById('start-game-btn').classList.remove('hidden');
    updatePlayerList([{ id: socket.id, name: playerName }]);
    showNotification('Room created!');
});

socket.on('roomJoined', ({ roomCode }) => {
    gameState.roomCode = roomCode;
    showScreen('lobby');
    document.getElementById('display-room-code').textContent = roomCode;
    showNotification('Joined room!');
});

socket.on('playerJoined', ({ players, message }) => {
    gameState.players = players;
    updatePlayerList(players);
    showNotification(message);
});

socket.on('roleAssigned', ({ role, isGnosia }) => {
    gameState.role = role;
    gameState.isGnosia = isGnosia;
    document.getElementById('player-role').textContent = role;
    const roleDisplay = document.getElementById('role-display');
    if (isGnosia) {
        roleDisplay.classList.add('gnosia');
    }
});

socket.on('gameStarted', ({ phase, players, round }) => {
    gameState.players = players;
    showScreen('game');
    document.getElementById('round-number').textContent = round;
    updateGamePlayerList(players);
    updatePhase(phase);
    showNotification('Game started!');
});

socket.on('phaseChange', ({ phase, round }) => {
    if (round) {
        document.getElementById('round-number').textContent = round;
    }
    updatePhase(phase);
});

socket.on('voteSubmitted', ({ voterCount, totalPlayers }) => {
    showNotification(`${voterCount}/${totalPlayers} votes submitted`);
});

socket.on('votingComplete', ({ eliminatedPlayer, voteResults }) => {
    addChatMessage('SYSTEM', `${eliminatedPlayer.name} has been put in Deep Freeze! (Role: ${eliminatedPlayer.role})`);
    showNotification(`${eliminatedPlayer.name} frozen!`);
});

socket.on('playerEliminated', ({ eliminatedPlayer, round }) => {
    addChatMessage('SYSTEM', `During the warp, ${eliminatedPlayer.name} was eliminated by the Gnosia!`);
    document.getElementById('round-number').textContent = round;
});

socket.on('gnosiaEliminationPhase', ({ alivePlayers }) => {
    if (gameState.isGnosia) {
        showGnosiaEliminationOptions(alivePlayers);
    }
});

socket.on('gameOver', ({ winner, finalState }) => {
    showScreen('gameover');
    const winnerText = document.getElementById('winner-text');
    winnerText.textContent = winner === 'crew' ? 'Crew Wins!' : 'Gnosia Win!';
    winnerText.style.color = winner === 'crew' ? '#4ade80' : '#ff6b6b';
    
    const resultsContainer = document.getElementById('final-results');
    resultsContainer.innerHTML = '<h3>Final Results:</h3>';
    finalState.players.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'result-player';
        if (player.isGnosia) playerEl.classList.add('gnosia');
        playerEl.innerHTML = `
            <span>${player.name}</span>
            <span>${player.role} ${player.isAlive ? '(Survived)' : '(Eliminated)'}</span>
        `;
        resultsContainer.appendChild(playerEl);
    });
});

socket.on('chatMessage', ({ playerName, message }) => {
    addChatMessage(playerName, message);
});

socket.on('playerDisconnected', ({ playerName }) => {
    showNotification(`${playerName} disconnected`);
});

socket.on('error', ({ message }) => {
    showNotification(`Error: ${message}`);
});
