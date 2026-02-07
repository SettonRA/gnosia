// Game state manager
const games = new Map();

// Roles available in the game
const ROLES = {
  CREW: 'Crew Member',
  GNOSIA: 'Gnosia',
  ENGINEER: 'Engineer',
  DOCTOR: 'Doctor',
  GUARD: 'Guard'
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(socketId, playerName) {
  const roomCode = generateRoomCode();
  games.set(roomCode, {
    host: socketId,
    players: new Map([[socketId, {
      id: socketId,
      name: playerName,
      isAlive: true,
      role: null,
      isGnosia: false,
      ready: false
    }]]),
    phase: 'lobby',
    round: 0,
    votes: new Map(),
    started: false
  });
  return roomCode;
}

function joinRoom(roomCode, socketId, playerName) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.started) {
    return { success: false, error: 'Game already started' };
  }
  if (game.players.size >= 15) {
    return { success: false, error: 'Room is full' };
  }

  game.players.set(socketId, {
    id: socketId,
    name: playerName,
    isAlive: true,
    role: null,
    isGnosia: false,
    ready: false
  });

  return {
    success: true,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name
    }))
  };
}

function startGame(roomCode, requesterId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.host !== requesterId) {
    return { success: false, error: 'Only host can start the game' };
  }
  if (game.players.size < 4) {
    return { success: false, error: 'Need at least 4 players to start' };
  }

  // Assign roles
  const playerArray = Array.from(game.players.values());
  const playerCount = playerArray.length;
  
  // Determine number of Gnosia (roughly 1/3 of players, minimum 1)
  const gnosiaCount = Math.max(1, Math.floor(playerCount / 3));
  
  // Shuffle players
  const shuffled = playerArray.sort(() => Math.random() - 0.5);
  
  // Assign Gnosia
  const roleAssignments = [];
  for (let i = 0; i < shuffled.length; i++) {
    const player = shuffled[i];
    const isGnosia = i < gnosiaCount;
    player.isGnosia = isGnosia;
    player.role = isGnosia ? ROLES.GNOSIA : ROLES.CREW;
    player.isAlive = true;
    
    roleAssignments.push({
      socketId: player.id,
      role: player.role,
      isGnosia: player.isGnosia
    });
  }

  game.started = true;
  game.phase = 'debate';
  game.round = 1;

  return {
    success: true,
    roleAssignments,
    players: playerArray.map(p => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive
    }))
  };
}

function submitVote(roomCode, voterId, targetPlayerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'voting') {
    return { success: false, error: 'Not in voting phase' };
  }

  const voter = game.players.get(voterId);
  if (!voter || !voter.isAlive) {
    return { success: false, error: 'You cannot vote' };
  }

  game.votes.set(voterId, targetPlayerId);

  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  const allVoted = game.votes.size === alivePlayers.length;

  if (allVoted) {
    // Count votes
    const voteCounts = new Map();
    game.votes.forEach((targetId) => {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    });

    // Find player with most votes
    let maxVotes = 0;
    let eliminatedPlayerId = null;
    voteCounts.forEach((count, playerId) => {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedPlayerId = playerId;
      }
    });

    const eliminatedPlayer = game.players.get(eliminatedPlayerId);
    eliminatedPlayer.isAlive = false;

    // Check win conditions
    const { gameOver, winner } = checkWinCondition(game);

    game.votes.clear();
    
    if (!gameOver) {
      game.phase = 'warp';
    }

    return {
      success: true,
      allVoted: true,
      eliminatedPlayer: {
        id: eliminatedPlayer.id,
        name: eliminatedPlayer.name,
        role: eliminatedPlayer.role
      },
      voteResults: Array.from(voteCounts.entries()).map(([id, count]) => ({
        playerId: id,
        playerName: game.players.get(id).name,
        votes: count
      })),
      gameOver,
      winner,
      finalState: gameOver ? getGameState(game) : null
    };
  }

  return {
    success: true,
    allVoted: false,
    voterCount: game.votes.size,
    totalPlayers: alivePlayers.length
  };
}

function gnosiaEliminate(roomCode, gnosiaId, targetPlayerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'warp') {
    return { success: false, error: 'Not in warp phase' };
  }

  const gnosia = game.players.get(gnosiaId);
  if (!gnosia || !gnosia.isGnosia || !gnosia.isAlive) {
    return { success: false, error: 'Only alive Gnosia can eliminate' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive || target.isGnosia) {
    return { success: false, error: 'Invalid target' };
  }

  target.isAlive = false;
  game.round++;
  game.phase = 'debate';

  // Check win conditions
  const { gameOver, winner } = checkWinCondition(game);

  return {
    success: true,
    eliminatedPlayer: {
      id: target.id,
      name: target.name
    },
    round: game.round,
    gameOver,
    winner,
    finalState: gameOver ? getGameState(game) : null
  };
}

function checkWinCondition(game) {
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  const aliveGnosia = alivePlayers.filter(p => p.isGnosia).length;
  const aliveCrew = alivePlayers.length - aliveGnosia;

  if (aliveGnosia === 0) {
    return { gameOver: true, winner: 'crew' };
  }
  if (aliveGnosia >= aliveCrew) {
    return { gameOver: true, winner: 'gnosia' };
  }
  return { gameOver: false, winner: null };
}

function getGameState(game) {
  return {
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      isAlive: p.isAlive,
      isGnosia: p.isGnosia
    })),
    round: game.round
  };
}

function updatePhase(roomCode, phase) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  game.phase = phase;
  return { success: true };
}

function markPlayerReady(roomCode, playerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }

  const player = game.players.get(playerId);
  if (player) {
    player.ready = true;
  }

  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  const allReady = alivePlayers.every(p => p.ready);

  if (allReady) {
    // Reset ready status
    game.players.forEach(p => p.ready = false);
    
    return {
      success: true,
      allReady: true,
      gnosiaPlayers: Array.from(game.players.values())
        .filter(p => p.isAlive && p.isGnosia)
        .map(p => p.id),
      alivePlayers: alivePlayers.map(p => ({
        id: p.id,
        name: p.name
      }))
    };
  }

  return { success: true, allReady: false };
}

function handleDisconnect(socketId) {
  for (const [roomCode, game] of games.entries()) {
    if (game.players.has(socketId)) {
      const player = game.players.get(socketId);
      const playerName = player.name;
      game.players.delete(socketId);
      
      if (game.players.size === 0) {
        games.delete(roomCode);
      }
      
      return {
        roomCode,
        playerName,
        players: Array.from(game.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          isAlive: p.isAlive
        }))
      };
    }
  }
  return {};
}

function getGamesCount() {
  return games.size;
}

module.exports = {
  createRoom,
  joinRoom,
  startGame,
  submitVote,
  gnosiaEliminate,
  updatePhase,
  markPlayerReady,
  handleDisconnect,
  getGamesCount
};
