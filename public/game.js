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
    gnosiaPlayerIds: [],
    totalGnosiaCount: 0,
    isEngineer: false,
    isDoctor: false,
    isGuardian: false,
    investigations: new Map()
};

// DOM Elements
const screens = {
    landing: document.getElementById('landing-screen'),
    room: document.getElementById('room-screen'),
    lobby: document.getElementById('lobby-screen'),
    game: document.getElementById('game-screen'),
    gameover: document.getElementById('gameover-screen')
};

// Rules Modal
const rulesModal = document.getElementById('rules-modal');
document.getElementById('rules-btn-landing').addEventListener('click', () => {
    rulesModal.classList.remove('hidden');
});
document.getElementById('rules-btn-game').addEventListener('click', () => {
    rulesModal.classList.remove('hidden');
});
document.getElementById('close-rules').addEventListener('click', () => {
    rulesModal.classList.add('hidden');
});
// Click outside modal to close
rulesModal.addEventListener('click', (e) => {
    if (e.target === rulesModal) {
        rulesModal.classList.add('hidden');
    }
});

// Story Modal
const storyModal = document.getElementById('story-modal');
document.getElementById('story-btn-landing').addEventListener('click', () => {
    storyModal.classList.remove('hidden');
});
document.getElementById('story-btn-game').addEventListener('click', () => {
    storyModal.classList.remove('hidden');
});
document.getElementById('close-story').addEventListener('click', () => {
    storyModal.classList.add('hidden');
});
// Click outside modal to close
storyModal.addEventListener('click', (e) => {
    if (e.target === storyModal) {
        storyModal.classList.add('hidden');
    }
});

// Utility Functions
function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

function showNotification(message) {
    const notif = document.getElementById('notification');
    notif.textContent = message;
    notif.classList.remove('hidden');
    setTimeout(() => notif.classList.add('hidden'), 6000);
}

// Landing Screen
document.getElementById('create-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Host Game';
    document.getElementById('room-code-input').classList.add('hidden');
    document.getElementById('public-checkbox-container').classList.remove('hidden');
    document.getElementById('public-games-list').classList.add('hidden');
    document.getElementById('submit-room-btn').textContent = 'Create';
    document.getElementById('submit-room-btn').onclick = createRoom;
});

document.getElementById('join-room-btn').addEventListener('click', () => {
    showScreen('room');
    document.getElementById('room-title').textContent = 'Join Game';
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
        showNotification('Please enter your name and game code');
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
        
        // Show investigation result if this player was investigated by current player
        let investigationLabel = '';
        if (gameState.investigations && gameState.investigations.has(player.id)) {
            const result = gameState.investigations.get(player.id);
            const color = result === 'Human' ? '#4ade80' : '#ff6b6b';
            investigationLabel = ` <span style="color: ${color}; font-weight: bold;">(${result})</span>`;
        }
        
        // Show role if spectator (including Follower)
        let roleLabel = '';
        if (gameState.isSpectator && player.role) {
            let displayRole = player.role;
            let roleColor = '#4ade80'; // Default crew color
            
            if (player.role === 'Gnosia') {
                roleColor = '#ff6b6b';
            } else if (player.isFollower) {
                displayRole = 'Follower';
                roleColor = '#fbbf24'; // Yellow/orange for Follower
            }
            
            roleLabel = ` <span style="color: ${roleColor}; font-weight: bold;">[${displayRole}]</span>`;
        }
        
        playerEl.innerHTML = `
            <strong>${player.name}${voteCount}${gnosiaLabel}${investigationLabel}${roleLabel}</strong>
            ${player.disconnected ? '<span style="color: #fbbf24;">● Disconnected</span>' : 
              player.isAlive ? '<span style="color: #4ade80;">● Alive</span>' : '<span style="color: #f87171;">● Frozen/Dead</span>'}
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
    
    // Reset voting header
    document.getElementById('voting-header').textContent = 'Vote for who to put in Deep Freeze';
    
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
        votingSection.classList.add('hidden'); // Hide voting section
        
        // Check if current player is alive
        const currentPlayer = gameState.players.find(p => p.id === socket.id);
        const isPlayerAlive = currentPlayer && currentPlayer.isAlive;
        
        if (gameState.isSpectator) {
            instructionText.textContent = 'Spectating the warp phase...';
        } else if (gameState.isEngineer && isPlayerAlive && !gameState.hasActed?.engineer) {
            instructionText.textContent = 'You are the Engineer! Select an alive player to investigate...';
            document.getElementById('voting-header').textContent = 'Select a player to investigate';
            votingSection.classList.remove('hidden'); // Show for selection
            showEngineerOptions();
        } else if (gameState.isDoctor && isPlayerAlive && !gameState.hasActed?.doctor) {
            instructionText.textContent = 'You are the Doctor! Select a dead player to investigate...';
            document.getElementById('voting-header').textContent = 'Select a dead player to investigate';
            votingSection.classList.remove('hidden'); // Show for selection
            showDoctorOptions();
        } else if (gameState.isGuardian && isPlayerAlive && !gameState.hasActed?.guardian) {
            instructionText.textContent = 'You are the Guardian! Select a player to protect...';
            document.getElementById('voting-header').textContent = 'Select a player to protect';
            votingSection.classList.remove('hidden'); // Show for selection
            showGuardianOptions();
        } else if (gameState.isGnosia && isPlayerAlive && !gameState.hasActed?.gnosia) {
            instructionText.textContent = 'Select a crew member to eliminate during the warp...';
            // Show Gnosia elimination UI if they haven't acted yet
            const alivePlayers = gameState.players.filter(p => p.isAlive);
            showGnosiaEliminationOptions(alivePlayers);
        } else if ((gameState.isEngineer || gameState.isDoctor || gameState.isGuardian) && isPlayerAlive) {
            instructionText.textContent = 'Waiting for other players to complete their actions...';
        } else if (gameState.isGnosia && isPlayerAlive) {
            instructionText.textContent = 'Waiting for the warp to complete...';
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
                // Mark as having acted
                if (!gameState.hasActed) gameState.hasActed = {};
                if (gameState.isGnosia) gameState.hasActed.gnosia = true;
                
                socket.emit('gnosiaEliminate', { 
                    roomCode: gameState.roomCode, 
                    targetPlayerId: player.id 
                });
                section.classList.add('hidden');
                showNotification(`${player.name} targeted`);
            };
            container.appendChild(btn);
        }
    });
}

function showEngineerOptions() {
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    
    // Show alive players for investigation
    const alivePlayers = gameState.players.filter(player => 
        player.isAlive && player.id !== socket.id
    ).sort((a, b) => a.name.localeCompare(b.name));
    
    alivePlayers.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.textContent = player.name;
        btn.onclick = () => {
            socket.emit('engineerInvestigate', { 
                roomCode: gameState.roomCode, 
                targetPlayerId: player.id 
            });
            container.innerHTML = '<p style="color: #10b981;">Investigation sent. Waiting for results...</p>';
        };
        container.appendChild(btn);
    });
}

function showDoctorOptions() {
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    
    // Show dead players for investigation
    const deadPlayers = gameState.players.filter(player => 
        !player.isAlive
    ).sort((a, b) => a.name.localeCompare(b.name));
    
    if (deadPlayers.length === 0) {
        container.innerHTML = '<p style="color: #9ca3af;">No dead players to investigate yet.</p>';
        return;
    }
    
    deadPlayers.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.textContent = player.name;
        btn.onclick = () => {
            socket.emit('doctorInvestigate', { 
                roomCode: gameState.roomCode, 
                targetPlayerId: player.id 
            });
            container.innerHTML = '<p style="color: #10b981;">Investigation sent. Waiting for results...</p>';
        };
        container.appendChild(btn);
    });
}

function showGuardianOptions() {
    const container = document.getElementById('vote-options');
    container.innerHTML = '';
    
    // Show all alive players except the Guardian themselves
    const alivePlayers = gameState.players.filter(player => 
        player.isAlive && player.id !== socket.id
    ).sort((a, b) => a.name.localeCompare(b.name));
    
    alivePlayers.forEach(player => {
        const btn = document.createElement('button');
        btn.className = 'vote-btn';
        btn.textContent = player.name;
        btn.onclick = () => {
            socket.emit('guardianProtect', { 
                roomCode: gameState.roomCode, 
                targetPlayerId: player.id 
            });
            container.innerHTML = '<p style="color: #10b981;">Protection confirmed for ' + player.name + '</p>';
        };
        container.appendChild(btn);
    });
}

// Game Over Screen
document.getElementById('return-lobby-btn').addEventListener('click', () => {
    window.location.reload();
});

document.getElementById('new-game-btn').addEventListener('click', () => {
    socket.emit('restartGame', gameState.roomCode);
});

// Game Control Buttons
document.getElementById('leave-game-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the game? You will not be able to rejoin this game.')) {
        socket.emit('leaveGame', { roomCode: gameState.roomCode });
        showNotification('You have left the game');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    }
});

document.getElementById('return-lobby-btn-game').addEventListener('click', () => {
    if (confirm('Return all players to lobby? The current game will end.')) {
        socket.emit('returnToLobby', gameState.roomCode);
    }
});

// Socket Event Handlers
socket.on('roomCreated', ({ roomCode, playerName }) => {
    gameState.roomCode = roomCode;
    showScreen('lobby');
    document.getElementById('display-room-code').textContent = roomCode;
    document.getElementById('start-game-btn').classList.remove('hidden');
    updatePlayerList([{ id: socket.id, name: playerName }]);
    showNotification('Game created!');
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
            showNotification('Joined game!');
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

socket.on('roleAssigned', ({ role, isGnosia, isFollower, gnosiaPlayers, helperRoleCounts, isEngineer, isDoctor, isGuardian }) => {
    gameState.role = role;
    gameState.isGnosia = isGnosia;
    gameState.isFollower = isFollower || false;
    gameState.isSpectator = false; // No longer a spectator once role is assigned
    gameState.isEngineer = isEngineer || false;
    gameState.isDoctor = isDoctor || false;
    gameState.isGuardian = isGuardian || false;
    gameState.investigations = new Map(); // Store investigation results
    
    // Display appropriate role name (Follower sees "Follower", not "Crew")
    document.getElementById('player-role').textContent = isFollower ? 'Follower' : role;
    const roleDisplay = document.getElementById('role-display');
    
    // Clear any previous gnosia class
    roleDisplay.classList.remove('gnosia');
    
    if (isGnosia) {
        roleDisplay.classList.add('gnosia');
        
        // Store Gnosia player IDs for filtering
        if (gnosiaPlayers) {
            gameState.gnosiaPlayerIds = gnosiaPlayers.map(p => p.id);
            gameState.totalGnosiaCount = gnosiaPlayers.length;
            
            // Update the Gnosia count display
            document.getElementById('gnosia-count').textContent = gameState.totalGnosiaCount;
            
            // Show other Gnosia to this player
            const gnosiaNames = gnosiaPlayers
                .filter(p => p.id !== socket.id)
                .map(p => p.name)
                .join(', ');
            
            if (gnosiaNames) {
                showNotification(`Your fellow Gnosia: ${gnosiaNames}`);
            }
        }
    } else if (isFollower) {
        // Follower gets red display since they're Gnosia-aligned
        roleDisplay.classList.add('gnosia');
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.3), rgba(153, 27, 27, 0.3))';
        
        // Follower notification
        if (gnosiaPlayers) {
            gameState.totalGnosiaCount = gnosiaPlayers.length;
            document.getElementById('gnosia-count').textContent = gameState.totalGnosiaCount;
        }
        showNotification('You are a Follower! Win with Gnosia but stay hidden. You appear as Human in investigations.');
    } else {
        // For crew members, store the total count
        if (gnosiaPlayers) {
            gameState.totalGnosiaCount = gnosiaPlayers.length;
            document.getElementById('gnosia-count').textContent = gameState.totalGnosiaCount;
        }
        
        // Show helper role notification
        if (isEngineer) {
            showNotification('You are the Engineer! During warp phase, you can investigate alive players.');
        } else if (isDoctor) {
            showNotification('You are the Doctor! During warp phase, you can investigate dead players.');
        } else if (isGuardian) {
            showNotification('You are the Guardian! During warp phase, you can protect a player from elimination.');
        }
    }
    
    // Update all role counts in Roles section
    if (helperRoleCounts) {
        document.getElementById('gnosia-count').textContent = helperRoleCounts.gnosia || 0;
        document.getElementById('engineer-count').textContent = helperRoleCounts.engineer || 0;
        document.getElementById('doctor-count').textContent = helperRoleCounts.doctor || 0;
        document.getElementById('guardian-count').textContent = helperRoleCounts.guardian || 0;
    }
    
    // Update role display color based on role
    if (isGnosia || isFollower) {
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.3), rgba(153, 27, 27, 0.3))';
    } else if (isEngineer || isDoctor || isGuardian) {
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(22, 163, 74, 0.3))';
    } else {
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.3))';
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
        
        // Show Return to Lobby button if host
        if (gameState.isHost) {
            document.getElementById('return-lobby-btn-game').classList.remove('hidden');
        }
    }
});

socket.on('phaseChange', ({ phase, round, players }) => {
    if (round) {
        document.getElementById('round-number').textContent = round;
    }
    
    // Update players if provided (includes cleared ready status)
    if (players) {
        gameState.players = players;
    }
    
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
    showNotification(`${eliminatedPlayer.name} was frozen!`);
    
    // Update role display if current player was eliminated
    if (eliminatedPlayer.id === socket.id) {
        const currentRole = document.getElementById('player-role').textContent;
        document.getElementById('player-role').textContent = `${currentRole} - Frozen/Dead`;
    }
    // Don't update player list here - wait for phaseChange to warp
});

socket.on('playerEliminated', ({ eliminatedPlayer, round, players }) => {
    gameState.players = players;
    updateGamePlayerList(players);
    showNotification(`${eliminatedPlayer.name} was eliminated by the Gnosia!`);
    
    // Update role display if current player was eliminated
    if (eliminatedPlayer.id === socket.id) {
        const currentRole = document.getElementById('player-role').textContent;
        document.getElementById('player-role').textContent = `${currentRole} - Frozen/Dead`;
    }
    
    document.getElementById('round-number').textContent = round;
});

socket.on('playerProtected', ({ round, players }) => {
    gameState.players = players;
    updateGamePlayerList(players);
    showNotification('The Guardian protected someone! No one was eliminated.');
    document.getElementById('round-number').textContent = round;
});

socket.on('investigationResult', ({ targetId, targetName, result }) => {
    // Store the investigation result
    gameState.investigations.set(targetId, result);
    
    // Mark as having acted
    if (!gameState.hasActed) gameState.hasActed = {};
    if (gameState.isEngineer) gameState.hasActed.engineer = true;
    if (gameState.isDoctor) gameState.hasActed.doctor = true;
    
    // Update the player list to show the investigation
    updateGamePlayerList(gameState.players);
    
    showNotification(`Investigation complete: ${targetName} is ${result}!`);
});

socket.on('protectionConfirmed', ({ targetId, targetName }) => {
    // Mark as having acted
    if (!gameState.hasActed) gameState.hasActed = {};
    if (gameState.isGuardian) gameState.hasActed.guardian = true;
    
    showNotification(`Protection set for ${targetName}`);
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
        
        // Determine display role (reveal Follower in results)
        let displayRole = player.role;
        if (player.isFollower) {
            displayRole = 'Follower';
            playerEl.style.color = '#fbbf24'; // Yellow/orange for Follower
        }
        
        playerEl.innerHTML = `
            <span>${player.name}</span>
            <span>${displayRole} ${player.isAlive ? '(Survived)' : '(Eliminated)'}</span>
        `;
        resultsContainer.appendChild(playerEl);
    });
    
    // Show new game button for host
    if (gameState.isHost) {
        document.getElementById('new-game-btn').classList.remove('hidden');
    }
});

socket.on('playerDisconnected', ({ playerName, players }) => {
    gameState.players = players;
    updateGamePlayerList(players);
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
    gameState.isFollower = false;
    gameState.phase = 'lobby';
    gameState.selectedVote = null;
    gameState.isEngineer = false;
    gameState.isDoctor = false;
    gameState.isGuardian = false;
    gameState.investigations = new Map();
    gameState.voteResults = [];
    gameState.gnosiaPlayerIds = [];
    gameState.totalGnosiaCount = 0;
    
    // Reset role display styling
    const roleDisplay = document.getElementById('role-display');
    roleDisplay.classList.remove('gnosia');
    roleDisplay.style.background = '';
    document.getElementById('player-role').textContent = 'Waiting...';
    
    // Reset role counts
    document.getElementById('gnosia-count').textContent = '0';
    document.getElementById('engineer-count').textContent = '0';
    document.getElementById('doctor-count').textContent = '0';
    document.getElementById('guardian-count').textContent = '0';
    
    // Show start button for host
    if (gameState.isHost) {
        document.getElementById('start-game-btn').classList.remove('hidden');
    }
});

socket.on('playerLeft', ({ playerName, players, newHost }) => {
    showNotification(`${playerName} has left the game`);
    gameState.players = players;
    updatePlayerList(players);
    
    if (newHost) {
        if (newHost.id === socket.id) {
            gameState.isHost = true;
            showNotification(`You are now the host!`);
            document.getElementById('return-lobby-btn-game').classList.remove('hidden');
        } else {
            showNotification(`${newHost.name} is now the host`);
        }
    }
});

socket.on('leftGame', ({ message }) => {
    showNotification(message);
    setTimeout(() => {
        window.location.reload();
    }, 1500);
});

socket.on('returnedToLobby', ({ players }) => {
    gameState.players = players;
    showScreen('lobby');
    updatePlayerList(players);
    showNotification('Returned to lobby!');
    
    // Reset game state
    gameState.role = null;
    gameState.isGnosia = false;
    gameState.isFollower = false;
    gameState.phase = 'lobby';
    gameState.selectedVote = null;
    gameState.isEngineer = false;
    gameState.isDoctor = false;
    gameState.isGuardian = false;
    gameState.investigations = new Map();
    gameState.voteResults = [];
    gameState.gnosiaPlayerIds = [];
    gameState.totalGnosiaCount = 0;
    
    // Reset role display styling
    const roleDisplay = document.getElementById('role-display');
    roleDisplay.classList.remove('gnosia');
    roleDisplay.style.background = '';
    document.getElementById('player-role').textContent = 'Waiting...';
    
    // Reset role counts
    document.getElementById('gnosia-count').textContent = '0';
    document.getElementById('engineer-count').textContent = '0';
    document.getElementById('doctor-count').textContent = '0';
    document.getElementById('guardian-count').textContent = '0';
    
    // Show start button for host
    if (gameState.isHost) {
        document.getElementById('start-game-btn').classList.remove('hidden');
    }
});

socket.on('reconnected', ({ roomCode, isHost, roleData, gameState: serverGameState }) => {
    gameState.roomCode = roomCode;
    gameState.isHost = isHost;
    gameState.players = serverGameState.players;
    gameState.role = roleData.role;
    gameState.isGnosia = roleData.isGnosia;
    gameState.isFollower = roleData.isFollower;
    gameState.isEngineer = roleData.isEngineer;
    gameState.isDoctor = roleData.isDoctor;
    gameState.isGuardian = roleData.isGuardian;
    gameState.isSpectator = false;
    gameState.hasActed = roleData.hasActed || {};
    
    // Restore investigation results if any
    if (roleData.investigations && roleData.investigations.length > 0) {
        gameState.investigations = new Map();
        roleData.investigations.forEach(({ targetId, result }) => {
            gameState.investigations.set(targetId, result);
        });
    }
    
    // Show game screen
    showScreen('game');
    document.getElementById('round-number').textContent = serverGameState.round;
    
    // Restore role display
    const currentPlayer = serverGameState.players.find(p => p.id === socket.id);
    let roleText = gameState.isFollower ? 'Follower' : roleData.role;
    if (currentPlayer && !currentPlayer.isAlive) {
        roleText += ' - Frozen/Dead';
    }
    document.getElementById('player-role').textContent = roleText;
    const roleDisplay = document.getElementById('role-display');
    roleDisplay.classList.remove('gnosia');
    
    if (gameState.isGnosia || gameState.isFollower) {
        roleDisplay.classList.add('gnosia');
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(220, 38, 38, 0.3), rgba(153, 27, 27, 0.3))';
    } else if (gameState.isEngineer || gameState.isDoctor || gameState.isGuardian) {
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(22, 163, 74, 0.3))';
    } else {
        roleDisplay.style.background = 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.3))';
    }
    
    // Restore Gnosia info if applicable
    if (roleData.gnosiaPlayers) {
        gameState.gnosiaPlayerIds = roleData.gnosiaPlayers.map(p => p.id);
        gameState.totalGnosiaCount = roleData.gnosiaPlayers.length;
    } else if (roleData.helperRoleCounts) {
        gameState.totalGnosiaCount = roleData.helperRoleCounts.gnosia;
    }
    
    // Update role counts
    if (roleData.helperRoleCounts) {
        document.getElementById('gnosia-count').textContent = roleData.helperRoleCounts.gnosia || 0;
        document.getElementById('engineer-count').textContent = roleData.helperRoleCounts.engineer || 0;
        document.getElementById('doctor-count').textContent = roleData.helperRoleCounts.doctor || 0;
        document.getElementById('guardian-count').textContent = roleData.helperRoleCounts.guardian || 0;
    }
    
    // Update player list and phase
    updateGamePlayerList(serverGameState.players);
    updatePhase(serverGameState.phase);
    
    showNotification('Reconnected successfully!');
});

socket.on('playerReconnected', ({ playerName, players }) => {
    gameState.players = players;
    updateGamePlayerList(players);
    showNotification(`${playerName} reconnected`);
});

