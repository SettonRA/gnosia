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
    selectedVote: null,
    voteResults: [],
    isSpectator: false,
    gnosiaPlayerIds: []
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

// Landing Screen
document.getElementById('create-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Create Room';
    document.getElementById('room-code-input').classList.add('hidden');
    document.getElementById('public-checkbox-container').classList.remove('hidden');
    document.getElementById('public-games-list').classList.add('hidden');
    document.getElementById('submit-room-btn').textContent = 'Create';
    document.getElementById('submit-room-btn').onclick = createRoom;
});

document.getElementById('join-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Join Room';
    document.getElementById('room-code-input').classList.remove('hidden');
    document.getElementById('public-checkbox-container').classList.add('hidden');
    document.getElementById('public-games-list').classList.remove('hidden');
    document.getElementById('submit-room-btn').textContent = 'Join';
    document.getElementById('submit-room-btn').onclick = joinRoom;
    loadPublicGames();
});

document.getElementById('back-btn').addEventListener('click', () => {
    showScreen('landing');
    document.getElementById('player-name-input').value = '';
    document.getElementById('room-code-input').value = '';
    document.getElementById('public-game-checkbox').checked = false;
});

function createRoom() {
    const playerName = document.getElementById('player-name-input').value.trim();
    if (!playerName) {
        showNotification('Please enter your name');
        return;
    }
    const isPublic = document.getElementById('public-game-checkbox').checked;
    gameState.playerName = playerName;
    gameState.isHost = true;
    socket.emit('createRoom', { playerName, isPublic });
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

function loadPublicGames() {
    socket.emit('getPublicGames');
}

function joinPublicGame(roomCode) {
    const playerName = document.getElementById('player-name-input').value.trim();
    if (!playerName) {
        showNotification('Please enter your name first');
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
    
    // Update player count
    const playerCount = document.getElementById('player-count');
    if (playerCount) {
        playerCount.textContent = players.length;
    }
}

function updateGamePlayerList(players) {
    const container = document.getElementById('game-player-list');
    container.innerHTML = '';
    
    // Sort players alphabetically by name
    const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));
    
    sortedPlayers.forEach(player => {
        const playerEl = document.createElement('div');
        playerEl.className = 'player-item';
        if (!player.isAlive) {
            playerEl.classList.add('dead');
        }
        if (player.ready && player.isAlive) {
            playerEl.classList.add('ready');
        }
        
        // Get vote count for this player during warp phase
        let voteCount = '';
        if (gameState.phase === 'warp' && gameState.voteResults && gameState.voteResults.length > 0) {
            const voteResult = gameState.voteResults.find(v => v.playerId === player.id);
            if (voteResult) {
                voteCount = ` (${voteResult.votes} vote${voteResult.votes !== 1 ? 's' : ''})`;
            }
        }
        
        // Show Gnosia label if current player is Gnosia and this player is also Gnosia
        const isOtherGnosia = gameState.isGnosia && gameState.gnosiaPlayerIds && gameState.gnosiaPlayerIds.includes(player.id);
        const gnosiaLabel = isOtherGnosia ? ' <span style="color: #ff6b6b; font-weight: bold;">[Gnosia]</span>' : '';
        
        playerEl.innerHTML = `
            <strong>${player.name}${voteCount}${gnosiaLabel}</strong>
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
    
    // Mark self as ready in local state
    const currentPlayer = gameState.players.find(p => p.id === socket.id);
    if (currentPlayer) {
        currentPlayer.ready = true;
        updateGamePlayerList(gameState.players);
    }
});

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
    
    // If spectator, hide all interactive elements
    if (gameState.isSpectator) {
        readyBtn.classList.add('hidden');
        votingSection.classList.add('hidden');
        gnosiaSection.classList.add('hidden');
    }

    if (phase === 'debate') {
        phaseText.textContent = 'Debate Phase';
        
        if (gameState.isSpectator) {
            instructionText.textContent = 'Spectating... You will join in the next game.';
        } else {
            instructionText.textContent = 'Discuss with others on voice chat who you think is Gnosia.';
            
            // Check if current player is alive
            const currentPlayer = gameState.players.find(p => p.id === socket.id);
            if (currentPlayer && !currentPlayer.isAlive) {
                readyBtn.classList.add('hidden');
                instructionText.textContent = 'You are eliminated. Watch as the game continues...';
            }
        }
    } else if (phase === 'voting') {
        gameState.selectedVote = null; // Reset vote
        phaseText.textContent = 'Voting Phase';
        
        if (gameState.isSpectator) {
            instructionText.textContent = 'Spectating the vote...';
            readyBtn.classList.add('hidden');
        } else {
            // Check if current player is alive
            const currentPlayer = gameState.players.find(p => p.id === socket.id);
            if (currentPlayer && currentPlayer.isAlive) {
                instructionText.textContent = 'Vote for who to put in Deep Freeze.';
                votingSection.classList.remove('hidden');
                readyBtn.classList.add('hidden');
                showVoteOptions();
            } else {
                instructionText.textContent = 'You are eliminated. Watch as others vote...';
                readyBtn.classList.add('hidden');
            }
        }
    } else if (phase === 'warp') {
        phaseText.textContent = 'Warp Phase';
        readyBtn.classList.add('hidden'); // Hide ready button during warp
        
        if (gameState.isSpectator) {
            instructionText.textContent = 'Spectating the warp phase...';
        } else if (gameState.isGnosia) {
            instructionText.textContent = 'Select a crew member to eliminate during the warp...';
        } else {
            instructionText.textContent = 'The ship is warping. Gnosia are selecting their target...';
        }
    }
}

function showVoteOptions() {
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    
    // Filter and sort eligible players alphabetically
    const eligiblePlayers = gameState.players.filter(player => {
        const isOtherGnosia = gameState.isGnosia && gameState.gnosiaPlayerIds && gameState.gnosiaPlayerIds.includes(player.id);
        return player.isAlive && player.id !== socket.id && !isOtherGnosia;
    }).sort((a, b) => a.name.localeCompare(b.name));
    
    eligiblePlayers.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.textContent = player.name;
        btn.onclick = () => submitVote(player.id, btn);
        container.appendChild(btn);
    });
}

function submitVote(playerId, btnElement) {
    // Prevent vote changes
    if (gameState.selectedVote) {
        showNotification('Vote already submitted');
        return;
    }
    
    gameState.selectedVote = playerId;
    document.querySelectorAll('.vote-btn').forEach(btn => {
        btn.disabled = true;
        btn.classList.remove('selected');
    });
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
        // Don't show self or other Gnosia
        const isOtherGnosia = gameState.gnosiaPlayerIds && gameState.gnosiaPlayerIds.includes(player.id);
        
        if (player.id !== socket.id && !isOtherGnosia) {
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

document.getElementById('new-game-btn').addEventListener('click', () => {
    socket.emit('restartGame', gameState.roomCode);
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

socket.on('roomJoined', ({ roomCode, isSpectator, gameState: serverGameState }) => {
    gameState.roomCode = roomCode;
    gameState.isSpectator = isSpectator || false;
    
    // If joining as spectator to active game, show game screen
    if (isSpectator && serverGameState) {
        gameState.players = serverGameState.players;
        showScreen('game');
        document.getElementById('round-number').textContent = serverGameState.round;
        document.getElementById('player-role').textContent = 'Spectator';
        document.getElementById('role-display').style.background = 'rgba(107, 114, 128, 0.3)';
        updateGamePlayerList(serverGameState.players);
        updatePhase(serverGameState.phase);
        showNotification('Joined as spectator! You\'ll play in the next game.');
    } else {
        showScreen('lobby');
        document.getElementById('display-room-code').textContent = roomCode;
        if (isSpectator) {
            showNotification('Joined as spectator! You\'ll play in the next game.');
        } else {
            showNotification('Joined room!');
        }
    }
});

socket.on('publicGamesList', ({ games }) => {
    const container = document.getElementById('games-container');
    container.innerHTML = '';
    
    if (games.length === 0) {
        container.innerHTML = '<div class="empty-games">No public games available</div>';
        return;
    }
    
    games.forEach(game => {
        const gameEl = document.createElement('div');
        gameEl.className = 'game-item';
        gameEl.onclick = () => joinPublicGame(game.roomCode);
        
        const statusClass = game.started ? 'in-progress' : 'lobby';
        const statusText = game.started ? 'In Progress' : 'Lobby';
        const joinText = game.started ? '(Join as Spectator)' : '';
        
        gameEl.innerHTML = `
            <div class="game-item-header">
                <span class="game-item-code">${game.roomCode}</span>
                <span class="game-item-status ${statusClass}">${statusText}</span>
            </div>
            <div class="game-item-info">
                ${game.playerCount} player${game.playerCount !== 1 ? 's' : ''} ${joinText}
            </div>
        `;
        container.appendChild(gameEl);
    });
});

socket.on('playerJoined', ({ players, message }) => {
    gameState.players = players;
    updatePlayerList(players);
    showNotification(message);
});

socket.on('roleAssigned', ({ role, isGnosia, gnosiaPlayers }) => {
    gameState.role = role;
    gameState.isGnosia = isGnosia;
    gameState.isSpectator = false; // No longer a spectator once role is assigned
    document.getElementById('player-role').textContent = role;
    const roleDisplay = document.getElementById('role-display');
    if (isGnosia) {
        roleDisplay.classList.add('gnosia');
        
        // Store Gnosia player IDs for filtering
        if (gnosiaPlayers) {
            gameState.gnosiaPlayerIds = gnosiaPlayers.map(p => p.id);
            
            // Show other Gnosia to this player
            const gnosiaNames = gnosiaPlayers
                .filter(p => p.id !== socket.id)
                .map(p => p.name)
                .join(', ');
            
            if (gnosiaNames) {
                showNotification(`Your fellow Gnosia: ${gnosiaNames}`);
            }
        }
    }
});

socket.on('gameStarted', ({ phase, players, round }) => {
    gameState.players = players;
    
    // If we're a spectator, show spectator UI
    if (gameState.isSpectator) {
        showScreen('game');
        document.getElementById('round-number').textContent = round;
        document.getElementById('player-role').textContent = 'Spectator';
        document.getElementById('role-display').style.background = 'rgba(107, 114, 128, 0.3)';
        updateGamePlayerList(players);
        updatePhase(phase);
        showNotification('Watching game as spectator...');
    } else {
        showScreen('game');
        document.getElementById('round-number').textContent = round;
        updateGamePlayerList(players);
        updatePhase(phase);
        showNotification('Game started!');
    }
});

socket.on('phaseChange', ({ phase, round }) => {
    if (round) {
        document.getElementById('round-number').textContent = round;
    }
    // Reset ready status for all players
    gameState.players.forEach(p => p.ready = false);
    
    // Clear vote results when starting new debate phase
    if (phase === 'debate') {
        gameState.voteResults = [];
    }
    
    updatePhase(phase);
    updateGamePlayerList(gameState.players); // Update after phase changes so vote counts show
});

socket.on('playerReady', ({ playerId }) => {
    const player = gameState.players.find(p => p.id === playerId);
    if (player) {
        player.ready = true;
        updateGamePlayerList(gameState.players);
    }
});

socket.on('voteSubmitted', ({ voterCount, totalPlayers }) => {
    showNotification(`${voterCount}/${totalPlayers} votes submitted`);
});

socket.on('votingComplete', ({ eliminatedPlayer, voteResults, players }) => {
    gameState.players = players;
    gameState.voteResults = voteResults; // Store vote results
    showNotification(`${eliminatedPlayer.name} frozen! (Role: ${eliminatedPlayer.role})`);
    // Don't update player list here - wait for phaseChange to warp
});

socket.on('playerEliminated', ({ eliminatedPlayer, round, players }) => {
    gameState.players = players;
    updateGamePlayerList(players);
    showNotification(`${eliminatedPlayer.name} was eliminated by the Gnosia!`);
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
    
    // Show new game button for host
    if (gameState.isHost) {
        document.getElementById('new-game-btn').classList.remove('hidden');
    }
});

socket.on('playerDisconnected', ({ playerName }) => {
    showNotification(`${playerName} disconnected`);
});

socket.on('error', ({ message }) => {
    showNotification(`Error: ${message}`);
});

socket.on('gameRestarted', ({ players }) => {
    gameState.players = players;
    showScreen('lobby');
    updatePlayerList(players);
    showNotification('New game started! Waiting for host...');
    
    // Reset game state
    gameState.role = null;
    gameState.isGnosia = false;
    gameState.phase = 'lobby';
    gameState.selectedVote = null;
    
    // Show start button for host
    if (gameState.isHost) {
        document.getElementById('start-game-btn').classList.remove('hidden');
    }
});
