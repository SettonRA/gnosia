// Game state manager
const games = new Map();

// Roles available in the game
const ROLES = {
  CREW: 'Crew Member',
  GNOSIA: 'Gnosia',
  ENGINEER: 'Engineer',
  DOCTOR: 'Doctor',
  GUARDIAN: 'Guardian'
};

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function createRoom(socketId, playerName, isPublic = false) {
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
    spectators: new Map(),
    phase: 'lobby',
    round: 0,
    votes: new Map(),
    started: false,
    isPublic: isPublic,
    gnosiaEliminationTurnIndex: 0,
    helperRoles: {
      engineer: [],
      doctor: [],
      guardian: []
    },
    warpActions: {
      engineerInvestigation: null,
      doctorInvestigation: null,
      guardianProtection: null,
      gnosiaElimination: null
    },
    investigations: new Map() // Store investigation results per player
  });
  return roomCode;
}

function joinRoom(roomCode, socketId, playerName) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  
  // If game has started, join as spectator
  if (game.started) {
    if (game.spectators.size + game.players.size >= 20) {
      return { success: false, error: 'Room is full' };
    }
    
    game.spectators.set(socketId, {
      id: socketId,
      name: playerName
    });
    
    return {
      success: true,
      isSpectator: true,
      gameState: {
        phase: game.phase,
        round: game.round,
        players: Array.from(game.players.values()).map(p => ({
          id: p.id,
          name: p.name,
          isAlive: p.isAlive
        }))
      }
    };
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
    isSpectator: false,
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
  if (game.players.size < 5) {
    return { success: false, error: 'Need at least 5 players to start' };
  }

  // Assign roles
  const playerArray = Array.from(game.players.values());
  const playerCount = playerArray.length;
  
  // Determine number of Gnosia (roughly 1/3 of players, minimum 1)
  const gnosiaCount = Math.max(1, Math.floor(playerCount / 3));
  
  // Shuffle players
  const shuffled = playerArray.sort(() => Math.random() - 0.5);
  
  // Assign Gnosia first
  const roleAssignments = [];
  const gnosiaPlayers = [];
  const crewPlayers = [];
  
  for (let i = 0; i < shuffled.length; i++) {
    const player = shuffled[i];
    const isGnosia = i < gnosiaCount;
    player.isGnosia = isGnosia;
    player.isAlive = true;
    
    if (isGnosia) {
      player.role = ROLES.GNOSIA;
      gnosiaPlayers.push(player);
    } else {
      crewPlayers.push(player);
    }
  }
  
  // Assign helper roles to crew members (equal to number of Gnosia)
  const helperRoleCount = gnosiaCount;
  const availableHelperRoles = [ROLES.ENGINEER, ROLES.GUARDIAN];
  
  // Only include Doctor if there are 2+ Gnosia
  if (gnosiaCount >= 2) {
    availableHelperRoles.push(ROLES.DOCTOR);
  }
  
  // Shuffle crew members for random helper role assignment
  const shuffledCrew = crewPlayers.sort(() => Math.random() - 0.5);
  
  // Assign helper roles
  let helperRoleIndex = 0;
  for (let i = 0; i < shuffledCrew.length; i++) {
    if (i < helperRoleCount && availableHelperRoles.length > 0) {
      // Assign a helper role
      const roleIndex = helperRoleIndex % availableHelperRoles.length;
      const helperRole = availableHelperRoles[roleIndex];
      shuffledCrew[i].role = helperRole;
      
      // Store helper role player IDs
      if (helperRole === ROLES.ENGINEER) {
        game.helperRoles.engineer = shuffledCrew[i].id;
      } else if (helperRole === ROLES.DOCTOR) {
        game.helperRoles.doctor = shuffledCrew[i].id;
      } else if (helperRole === ROLES.GUARDIAN) {
        game.helperRoles.guardian = shuffledCrew[i].id;
      }
      
      helperRoleIndex++;
    } else {
      // Regular crew member
      shuffledCrew[i].role = ROLES.CREW;
    }
  }
  
  // Create role assignments array
  playerArray.forEach(player => {
    roleAssignments.push({
      socketId: player.id,
      role: player.role,
      isGnosia: player.isGnosia
    });
  });

  game.started = true;
  game.phase = 'debate';
  game.round = 1;

  // Get list of all Gnosia player IDs and initialize turn order
  const gnosiaPlayerIds = playerArray
    .filter(p => p.isGnosia)
    .map(p => p.id);
  
  // Store the Gnosia turn order in the game state
  game.gnosiaTurnOrder = [...gnosiaPlayerIds];
  game.gnosiaEliminationTurnIndex = 0;

  // Count helper roles
  const helperRoleCounts = {
    engineer: game.helperRoles.engineer.length,
    doctor: game.helperRoles.doctor.length,
    guardian: game.helperRoles.guardian.length,
    crew: playerArray.filter(p => !p.isGnosia && p.role === ROLES.CREW).length,
    gnosia: gnosiaPlayerIds.length
  };

  return {
    success: true,
    roleAssignments,
    gnosiaPlayerIds,
    helperRoles: game.helperRoles,
    helperRoleCounts,
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
      players: Array.from(game.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive
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
  
  // Check if it's this Gnosia player's turn
  const warpInfo = getWarpInfo(roomCode);
  if (warpInfo.currentGnosiaPlayer !== gnosiaId) {
    return { success: false, error: 'Not your turn to eliminate' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive || target.isGnosia) {
    return { success: false, error: 'Invalid target' };
  }

  // Mark that Gnosia elimination action has been taken
  game.warpActions.gnosiaElimination = targetPlayerId;

  // Check if Guardian protected this player
  const wasProtected = game.warpActions.guardianProtection === targetPlayerId;
  
  let eliminatedPlayer = null;
  if (!wasProtected) {
    target.isAlive = false;
    eliminatedPlayer = {
      id: target.id,
      name: target.name
    };
  }

  // Reset warp actions for next round
  game.warpActions = {
    engineerInvestigation: false,
    doctorInvestigation: false,
    guardianProtection: null,
    gnosiaElimination: null
  };

  game.round++;
  game.phase = 'debate';
  
  // Increment turn index for next Gnosia elimination
  if (game.gnosiaTurnOrder) {
    game.gnosiaEliminationTurnIndex++;
  }

  // Check win conditions
  const { gameOver, winner } = checkWinCondition(game);

  return {
    success: true,
    eliminatedPlayer,
    wasProtected,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive
    })),
    round: game.round,
    gameOver,
    winner,
    finalState: gameOver ? getGameState(game) : null
  };
}

function engineerInvestigate(roomCode, engineerId, targetPlayerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'warp') {
    return { success: false, error: 'Not in warp phase' };
  }

  // Verify Engineer
  if (!game.helperRoles.engineer.includes(engineerId)) {
    return { success: false, error: 'You are not the Engineer' };
  }

  const engineer = game.players.get(engineerId);
  if (!engineer || !engineer.isAlive) {
    return { success: false, error: 'Engineer must be alive' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive) {
    return { success: false, error: 'Target must be alive' };
  }

  // Store investigation result
  const result = target.isGnosia ? 'Gnosia' : 'Human';
  if (!game.investigations.has(engineerId)) {
    game.investigations.set(engineerId, new Map());
  }
  game.investigations.get(engineerId).set(targetPlayerId, result);
  
  // Mark action as completed
  game.warpActions.engineerInvestigation = true;

  return {
    success: true,
    targetName: target.name,
    result
  };
}

function doctorInvestigate(roomCode, doctorId, targetPlayerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'warp') {
    return { success: false, error: 'Not in warp phase' };
  }

  // Verify Doctor
  if (!game.helperRoles.doctor.includes(doctorId)) {
    return { success: false, error: 'You are not the Doctor' };
  }

  const doctor = game.players.get(doctorId);
  if (!doctor || !doctor.isAlive) {
    return { success: false, error: 'Doctor must be alive' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || target.isAlive) {
    return { success: false, error: 'Target must be dead' };
  }

  // Store investigation result
  const result = target.isGnosia ? 'Gnosia' : 'Human';
  if (!game.investigations.has(doctorId)) {
    game.investigations.set(doctorId, new Map());
  }
  game.investigations.get(doctorId).set(targetPlayerId, result);
  
  // Mark action as completed
  game.warpActions.doctorInvestigation = true;

  return {
    success: true,
    targetName: target.name,
    result
  };
}

function guardianProtect(roomCode, guardianId, targetPlayerId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'warp') {
    return { success: false, error: 'Not in warp phase' };
  }

  // Verify Guardian
  if (!game.helperRoles.guardian.includes(guardianId)) {
    return { success: false, error: 'You are not the Guardian' };
  }

  const guardian = game.players.get(guardianId);
  if (!guardian || !guardian.isAlive) {
    return { success: false, error: 'Guardian must be alive' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive) {
    return { success: false, error: 'Target must be alive' };
  }

  // Store protected player
  game.warpActions.guardianProtection = targetPlayerId;

  return {
    success: true,
    targetName: target.name
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
    // When Gnosia wins, mark all surviving crew as eliminated
    game.players.forEach(player => {
      if (!player.isGnosia && player.isAlive) {
        player.isAlive = false;
      }
    });
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

function getWarpInfo(roomCode) {
  const game = games.get(roomCode);
  if (!game) {
    return { currentGnosiaPlayer: null, alivePlayers: [] };
  }
  
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  const aliveGnosia = alivePlayers.filter(p => p.isGnosia);
  
  // Determine which Gnosia player's turn it is
  let currentGnosiaPlayer = null;
  if (aliveGnosia.length > 0 && game.gnosiaTurnOrder) {
    // Filter turn order to only alive Gnosia
    const aliveGnosiaTurnOrder = game.gnosiaTurnOrder.filter(id => {
      const player = game.players.get(id);
      return player && player.isAlive && player.isGnosia;
    });
    
    if (aliveGnosiaTurnOrder.length > 0) {
      // Ensure turn index is within bounds
      game.gnosiaEliminationTurnIndex = game.gnosiaEliminationTurnIndex % aliveGnosiaTurnOrder.length;
      currentGnosiaPlayer = aliveGnosiaTurnOrder[game.gnosiaEliminationTurnIndex];
    }
  }
  
  return {
    currentGnosiaPlayer,
    alivePlayers: alivePlayers.map(p => ({
      id: p.id,
      name: p.name
    }))
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

function restartGame(roomCode, requesterId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.host !== requesterId) {
    return { success: false, error: 'Only host can restart the game' };
  }

  // Reset all players
  game.players.forEach(player => {
    player.isAlive = true;
    player.role = null;
    player.isGnosia = false;
    player.ready = false;
  });
  
  // Convert spectators to players
  game.spectators.forEach((spectator, socketId) => {
    game.players.set(socketId, {
      id: socketId,
      name: spectator.name,
      isAlive: true,
      role: null,
      isGnosia: false,
      ready: false
    });
  });
  game.spectators.clear();

  // Reset game state
  game.phase = 'lobby';
  game.round = 0;
  game.votes.clear();
  game.started = false;

  return {
    success: true,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name
    }))
  };
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

function getPublicGames() {
  const publicGames = [];
  
  for (const [roomCode, game] of games.entries()) {
    if (game.isPublic) {
      publicGames.push({
        roomCode,
        playerCount: game.players.size,
        started: game.started,
        round: game.round
      });
    }
  }
  
  return publicGames;
}

module.exports = {
  createRoom,
  joinRoom,
  startGame,
  submitVote,
  gnosiaEliminate,
  engineerInvestigate,
  doctorInvestigate,
  guardianProtect,
  updatePhase,
  getWarpInfo,
  markPlayerReady,
  restartGame,
  handleDisconnect,
  getGamesCount,
  getPublicGames
};
