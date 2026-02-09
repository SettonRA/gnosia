// Game state manager
const games = new Map();

// Roles available in the game
const ROLES = {
  CREW: 'Crew Member',
  GNOSIA: 'Gnosia',
  ENGINEER: 'Engineer',
  DOCTOR: 'Doctor',
  GUARDIAN: 'Guardian',
  FOLLOWER: 'Follower'
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
      ready: false,
      disconnected: false,
      disconnectTime: null
    }]]),
    spectators: new Map(),
    phase: 'lobby',
    round: 0,
    votes: new Map(),
    started: false,
    isPublic: isPublic,
    helperRoles: {
      engineer: [],
      doctor: [],
      guardian: []
    },
    warpActions: {
      engineerInvestigations: new Set(), // Track which engineers have acted
      doctorInvestigations: new Set(), // Track which doctors have acted
      guardianProtections: new Map(), // Map guardianId -> targetPlayerId
      gnosiaElimination: new Map() // Map of gnosiaId -> targetPlayerId
    },
    investigations: new Map(), // Store investigation results per player
    playerNameToId: new Map([[playerName.toLowerCase(), socketId]]), // Map names to IDs for reconnection
    leftPlayers: new Set() // Track players who voluntarily left (can't rejoin)
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
          isAlive: p.isAlive,
          role: p.role // Include role for spectators
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
    ready: false,
    disconnected: false,
    disconnectTime: null
  });
  game.playerNameToId.set(playerName.toLowerCase(), socketId);

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
  if (game.players.size < 5) {
    return { success: false, error: 'Need at least 5 players to start' };
  }

  // Assign roles
  const playerArray = Array.from(game.players.values());
  const playerCount = playerArray.length;
  
  // Testing: Check for players with special names and reserve them
  const testPlayers = {
    gnosia: [],
    follower: null,
    engineer: null,
    doctor: null,
    guardian: null,
    crew: null
  };
  
  const remainingPlayers = [];
  playerArray.forEach(player => {
    const nameLower = player.name.toLowerCase();
    if (nameLower === 'gnosia') {
      testPlayers.gnosia.push(player);
    } else if (nameLower === 'follower') {
      testPlayers.follower = player;
    } else if (nameLower === 'engineer') {
      testPlayers.engineer = player;
    } else if (nameLower === 'doctor') {
      testPlayers.doctor = player;
    } else if (nameLower === 'guardian') {
      testPlayers.guardian = player;
    } else if (nameLower === 'crew') {
      testPlayers.crew = player;
    } else {
      remainingPlayers.push(player);
    }
  });
  
  // Determine number of Gnosia - ensures at least 2 rounds minimum
  // Formula: (playerCount - 1) / 3, rounded down, minimum 1
  let gnosiaCount = Math.max(1, Math.floor((playerCount - 1) / 3));
  
  // Adjust gnosia count if test gnosia players exist
  if (testPlayers.gnosia.length > 0) {
    gnosiaCount = Math.max(gnosiaCount, testPlayers.gnosia.length);
  }
  
  // Shuffle remaining players
  const shuffled = remainingPlayers.sort(() => Math.random() - 0.5);
  
  // Assign Gnosia first
  const roleAssignments = [];
  const gnosiaPlayers = [];
  const crewPlayers = [];
  let followerPlayer = null;
  
  // Assign test Gnosia players first
  testPlayers.gnosia.forEach(player => {
    player.isGnosia = true;
    player.isAlive = true;
    player.isFollower = false;
    player.role = ROLES.GNOSIA;
    gnosiaPlayers.push(player);
  });
  
  // Fill remaining Gnosia slots from shuffled players
  const remainingGnosiaCount = gnosiaCount - testPlayers.gnosia.length;
  for (let i = 0; i < Math.min(remainingGnosiaCount, shuffled.length); i++) {
    const player = shuffled[i];
    player.isGnosia = true;
    player.isAlive = true;
    player.isFollower = false;
    player.role = ROLES.GNOSIA;
    gnosiaPlayers.push(player);
  }
  
  // Assign crew members (remaining players)
  for (let i = remainingGnosiaCount; i < shuffled.length; i++) {
    const player = shuffled[i];
    player.isGnosia = false;
    player.isAlive = true;
    player.isFollower = false;
    crewPlayers.push(player);
  }
  
  // Add test crew/helper players to crew
  if (testPlayers.follower) crewPlayers.push(testPlayers.follower);
  if (testPlayers.engineer) crewPlayers.push(testPlayers.engineer);
  if (testPlayers.doctor) crewPlayers.push(testPlayers.doctor);
  if (testPlayers.guardian) crewPlayers.push(testPlayers.guardian);
  if (testPlayers.crew) crewPlayers.push(testPlayers.crew);
  
  // Initialize test crew players
  [testPlayers.follower, testPlayers.engineer, testPlayers.doctor, testPlayers.guardian, testPlayers.crew].forEach(player => {
    if (player) {
      player.isGnosia = false;
      player.isAlive = true;
      player.isFollower = false;
    }
  });
  
  // Determine if there should be a Follower (only if 2+ Gnosia)
  let hasFollower = false;
  if (gnosiaCount >= 2) {
    // If there's a test follower, force it, otherwise random chance
    if (testPlayers.follower) {
      hasFollower = true;
    } else {
      const followerChance = (gnosiaCount - 1) * 0.30;
      hasFollower = Math.random() < followerChance;
    }
  }
  
  // Determine available helper roles based on Gnosia count
  const availableHelperRoles = [ROLES.ENGINEER, ROLES.GUARDIAN];
  if (gnosiaCount >= 2) {
    availableHelperRoles.push(ROLES.DOCTOR);
  }
  
  // Randomly select helper roles equal to Gnosia count (can have duplicates)
  const selectedHelperRoles = [];
  for (let i = 0; i < gnosiaCount; i++) {
    const randomRole = availableHelperRoles[Math.floor(Math.random() * availableHelperRoles.length)];
    selectedHelperRoles.push(randomRole);
  }
  
  // Shuffle the selected roles
  selectedHelperRoles.sort(() => Math.random() - 0.5);
  
  // Shuffle crew members for random helper role assignment
  const shuffledCrew = crewPlayers.sort(() => Math.random() - 0.5);
  
  // Assign Follower first if applicable
  if (hasFollower && shuffledCrew.length > 0) {
    if (testPlayers.follower) {
      // Use test follower
      followerPlayer = testPlayers.follower;
    } else {
      // Use first shuffled crew member
      followerPlayer = shuffledCrew[0];
    }
    followerPlayer.role = ROLES.CREW; // Follower shows as Crew
    followerPlayer.isFollower = true;
    followerPlayer.isGnosia = false; // Explicitly set to false
  }
  
  // Remove assigned follower from crew to avoid double assignment
  if (followerPlayer) {
    const followerIndex = shuffledCrew.indexOf(followerPlayer);
    if (followerIndex > -1) {
      shuffledCrew.splice(followerIndex, 1);
    }
  }
  
  // Assign test helper roles first
  if (testPlayers.engineer) {
    testPlayers.engineer.role = ROLES.ENGINEER;
    game.helperRoles.engineer.push(testPlayers.engineer.id);
    const index = shuffledCrew.indexOf(testPlayers.engineer);
    if (index > -1) shuffledCrew.splice(index, 1);
  }
  
  if (testPlayers.doctor && availableHelperRoles.includes(ROLES.DOCTOR)) {
    testPlayers.doctor.role = ROLES.DOCTOR;
    game.helperRoles.doctor.push(testPlayers.doctor.id);
    const index = shuffledCrew.indexOf(testPlayers.doctor);
    if (index > -1) shuffledCrew.splice(index, 1);
  }
  
  if (testPlayers.guardian) {
    testPlayers.guardian.role = ROLES.GUARDIAN;
    game.helperRoles.guardian.push(testPlayers.guardian.id);
    const index = shuffledCrew.indexOf(testPlayers.guardian);
    if (index > -1) shuffledCrew.splice(index, 1);
  }
  
  // Assign crew role to test crew player
  if (testPlayers.crew) {
    testPlayers.crew.role = ROLES.CREW;
    const index = shuffledCrew.indexOf(testPlayers.crew);
    if (index > -1) shuffledCrew.splice(index, 1);
  }
  
  // Assign remaining helper roles to remaining crew members
  let roleIndex = 0;
  for (let i = 0; i < shuffledCrew.length; i++) {
    if (roleIndex < selectedHelperRoles.length) {
      const helperRole = selectedHelperRoles[roleIndex];
      shuffledCrew[i].role = helperRole;
      
      // Store helper role player IDs (now arrays to support multiples)
      if (helperRole === ROLES.ENGINEER) {
        game.helperRoles.engineer.push(shuffledCrew[i].id);
      } else if (helperRole === ROLES.DOCTOR) {
        game.helperRoles.doctor.push(shuffledCrew[i].id);
      } else if (helperRole === ROLES.GUARDIAN) {
        game.helperRoles.guardian.push(shuffledCrew[i].id);
      }
      roleIndex++;
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
      isGnosia: player.isGnosia,
      isFollower: player.isFollower || false
    });
  });

  game.started = true;
  game.phase = 'debate';
  game.round = 1;

  // Get list of all Gnosia player IDs
  const gnosiaPlayerIds = playerArray
    .filter(p => p.isGnosia)
    .map(p => p.id);

  // Count helper roles
  const helperRoleCounts = {
    engineer: game.helperRoles.engineer.length,
    doctor: game.helperRoles.doctor.length,
    guardian: game.helperRoles.guardian.length,
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

    // Create allVotes array BEFORE clearing votes
    const allVotes = Array.from(game.votes.entries()).map(([voterId, targetId]) => ({
      voterName: game.players.get(voterId).name,
      targetName: game.players.get(targetId).name,
      count: voteCounts.get(targetId) || 0
    }));

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
      allVotes: allVotes,
      players: Array.from(game.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive
      })),
      gameOver,
      winner,
      finalState: gameOver ? getGameState(roomCode) : null
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
  
  // Check if this Gnosia has already voted
  if (game.warpActions.gnosiaElimination.has(gnosiaId)) {
    return { success: false, error: 'You have already voted for elimination' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive || target.isGnosia) {
    return { success: false, error: 'Invalid target' };
  }

  // Record this Gnosia's vote
  game.warpActions.gnosiaElimination.set(gnosiaId, targetPlayerId);

  // Check if all actions complete
  const allComplete = checkWarpActionsComplete(game);

  return {
    success: true,
    waiting: !allComplete,
    targetPlayerId,
    allComplete
  };
}

function checkWarpActionsComplete(game) {
  // Check if all alive helper roles and Gnosia have acted
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  
  // Check if all alive, connected Gnosia have voted
  const aliveConnectedGnosia = alivePlayers.filter(p => p.isGnosia && !p.disconnected);
  for (const gnosia of aliveConnectedGnosia) {
    if (!game.warpActions.gnosiaElimination.has(gnosia.id)) {
      return false; // This Gnosia hasn't voted yet
    }
  }
  
  // Check if alive Engineers have acted
  for (const engineerId of game.helperRoles.engineer) {
    const engineer = game.players.get(engineerId);
    if (engineer && engineer.isAlive && !engineer.disconnected && !game.warpActions.engineerInvestigations.has(engineerId)) {
      return false;
    }
  }
  
  // Check if alive Doctors have acted (only if there are dead players)
  const deadPlayers = Array.from(game.players.values()).filter(p => !p.isAlive);
  if (deadPlayers.length > 0) {
    for (const doctorId of game.helperRoles.doctor) {
      const doctor = game.players.get(doctorId);
      if (doctor && doctor.isAlive && !doctor.disconnected && !game.warpActions.doctorInvestigations.has(doctorId)) {
        return false;
      }
    }
  }
  
  // Check if alive Guardians have acted
  for (const guardianId of game.helperRoles.guardian) {
    const guardian = game.players.get(guardianId);
    if (guardian && guardian.isAlive && !guardian.disconnected && !game.warpActions.guardianProtections.has(guardianId)) {
      return false;
    }
  }
  
  return true;
}

function completeWarpPhase(roomCode) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.phase !== 'warp') {
    return { success: false, error: 'Not in warp phase' };
  }

  // Tally Gnosia votes
  const voteTally = new Map();
  for (const [gnosiaId, targetId] of game.warpActions.gnosiaElimination.entries()) {
    voteTally.set(targetId, (voteTally.get(targetId) || 0) + 1);
  }

  // Find target(s) with most votes
  let maxVotes = 0;
  let topTargets = [];
  for (const [targetId, voteCount] of voteTally.entries()) {
    if (voteCount > maxVotes) {
      maxVotes = voteCount;
      topTargets = [targetId];
    } else if (voteCount === maxVotes) {
      topTargets.push(targetId);
    }
  }

  // If no votes (all Gnosia disconnected), no elimination
  let targetPlayerId = null;
  if (topTargets.length > 0) {
    // Random tie-breaking if multiple targets have same votes
    targetPlayerId = topTargets[Math.floor(Math.random() * topTargets.length)];
  }

  const target = targetPlayerId ? game.players.get(targetPlayerId) : null;
  
  // Check if any guardian protected this target
  const wasProtected = targetPlayerId && Array.from(game.warpActions.guardianProtections.values()).includes(targetPlayerId);
  
  let eliminatedPlayer = null;
  if (!wasProtected && target) {
    target.isAlive = false;
    eliminatedPlayer = {
      id: target.id,
      name: target.name
    };
  }

  // Reset warp actions for next round
  game.warpActions = {
    engineerInvestigations: new Set(),
    doctorInvestigations: new Set(),
    guardianProtections: new Map(),
    gnosiaElimination: new Map()
  };

  game.round++;
  game.phase = 'debate';

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
    finalState: gameOver ? getGameState(roomCode) : null
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
  
  // Check if this Engineer already investigated this round
  if (game.warpActions.engineerInvestigations.has(engineerId)) {
    return { success: false, error: 'You have already investigated this round' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive) {
    return { success: false, error: 'Target must be alive' };
  }

  // Store investigation result (Follower shows as Human)
  const result = (target.isGnosia && !target.isFollower) ? 'Gnosia' : 'Human';
  if (!game.investigations.has(engineerId)) {
    game.investigations.set(engineerId, new Map());
  }
  game.investigations.get(engineerId).set(targetPlayerId, result);
  
  // Mark action as completed by this specific engineer
  game.warpActions.engineerInvestigations.add(engineerId);
  
  // Check if all actions complete
  const allComplete = checkWarpActionsComplete(game);

  return {
    success: true,
    targetName: target.name,
    result,
    allComplete
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
  
  // Check if this Doctor already investigated this round
  if (game.warpActions.doctorInvestigations.has(doctorId)) {
    return { success: false, error: 'You have already investigated this round' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || target.isAlive) {
    return { success: false, error: 'Target must be dead' };
  }

  // Store investigation result (Follower shows as Human)
  const result = (target.isGnosia && !target.isFollower) ? 'Gnosia' : 'Human';
  if (!game.investigations.has(doctorId)) {
    game.investigations.set(doctorId, new Map());
  }
  game.investigations.get(doctorId).set(targetPlayerId, result);
  
  // Mark action as completed by this specific doctor
  game.warpActions.doctorInvestigations.add(doctorId);
  
  // Check if all actions complete
  const allComplete = checkWarpActionsComplete(game);

  return {
    success: true,
    targetName: target.name,
    result,
    allComplete
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
  
  // Check if this Guardian already protected this round
  if (game.warpActions.guardianProtections.has(guardianId)) {
    return { success: false, error: 'You have already protected someone this round' };
  }

  const target = game.players.get(targetPlayerId);
  if (!target || !target.isAlive) {
    return { success: false, error: 'Target must be alive' };
  }

  // Guardian cannot protect themselves
  if (targetPlayerId === guardianId) {
    return { success: false, error: 'Guardian cannot protect themselves' };
  }

  // Store protected player
  game.warpActions.guardianProtections.set(guardianId, targetPlayerId);
  
  // Check if all actions complete
  const allComplete = checkWarpActionsComplete(game);

  return {
    success: true,
    targetName: target.name,
    allComplete
  };
}

function checkWinCondition(game) {
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive);
  const aliveGnosia = alivePlayers.filter(p => p.isGnosia).length;
  const aliveCrew = alivePlayers.filter(p => !p.isGnosia).length; // Follower counts as crew for win condition

  if (aliveGnosia === 0) {
    return { gameOver: true, winner: 'crew' };
  }
  if (aliveGnosia >= aliveCrew) {
    // When Gnosia wins, mark all surviving crew as eliminated (but not Follower)
    game.players.forEach(player => {
      if (!player.isGnosia && !player.isFollower && player.isAlive) {
        player.isAlive = false;
      }
    });
    return { gameOver: true, winner: 'gnosia' };
  }
  return { gameOver: false, winner: null };
}

function getGameState(roomCode) {
  const game = games.get(roomCode);
  if (!game) {
    return null;
  }
  return {
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      isAlive: p.isAlive,
      isGnosia: p.isGnosia,
      isFollower: p.isFollower,
      disconnected: p.disconnected || false,
      ready: p.ready || false
    })),
    round: game.round,
    phase: game.phase
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

  // Only check alive, connected players for ready status
  const alivePlayers = Array.from(game.players.values()).filter(p => p.isAlive && !p.disconnected);
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
  
  // Reset helper roles
  game.helperRoles = {
    engineer: [],
    doctor: [],
    guardian: []
  };
  
  // Reset investigations
  game.investigations.clear();
  
  // Reset warp actions
  game.warpActions = {
    engineerInvestigations: new Set(),
    doctorInvestigations: new Set(),
    guardianProtections: new Map(),
    gnosiaElimination: new Map()
  };

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
      
      // Mark player as disconnected instead of deleting
      player.disconnected = true;
      player.disconnectTime = Date.now();
      player.ready = false; // Unmark as ready
      
      // If game hasn't started and all players are disconnected, delete the room
      if (!game.started) {
        const allDisconnected = Array.from(game.players.values()).every(p => p.disconnected);
        if (allDisconnected) {
          games.delete(roomCode);
          return { roomCode, playerName, players: [], roomDeleted: true };
        }
      }
      
      return {
        roomCode,
        playerName,
        players: Array.from(game.players.values())
          .map(p => ({
            id: p.id,
            name: p.name,
            isAlive: p.isAlive,
            disconnected: p.disconnected || false
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

function attemptReconnect(roomCode, playerName, newSocketId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  
  // Check if player has left the game - rejoin as spectator
  if (game.leftPlayers.has(playerName.toLowerCase())) {
    // Remove from leftPlayers and add as spectator
    game.leftPlayers.delete(playerName.toLowerCase());
    
    // Remove from players if still there
    const oldSocketId = game.playerNameToId.get(playerName.toLowerCase());
    if (oldSocketId && game.players.has(oldSocketId)) {
      game.players.delete(oldSocketId);
    }
    
    // Add as spectator
    game.spectators.set(newSocketId, {
      id: newSocketId,
      name: playerName
    });
    game.playerNameToId.set(playerName.toLowerCase(), newSocketId);
    
    return {
      success: true,
      isSpectator: true,
      roomCode,
      isHost: false,
      gameState: getGameState(roomCode)
    };
  }
  
  // Find the disconnected player by name
  const oldSocketId = game.playerNameToId.get(playerName.toLowerCase());
  if (!oldSocketId || !game.players.has(oldSocketId)) {
    return { success: false, error: 'Player not found in this room' };
  }
  
  const player = game.players.get(oldSocketId);
  
  // Check if player was disconnected
  if (!player.disconnected) {
    return { success: false, error: 'Player is already connected' };
  }
  
  // Check if too much time has passed (5 minutes)
  const RECONNECT_TIMEOUT = 5 * 60 * 1000;
  if (Date.now() - player.disconnectTime > RECONNECT_TIMEOUT) {
    return { success: false, error: 'Reconnection timeout expired' };
  }
  
  // Transfer player data to new socket ID
  player.id = newSocketId;
  player.disconnected = false;
  player.disconnectTime = null;
  
  // Update maps
  game.players.delete(oldSocketId);
  game.players.set(newSocketId, player);
  game.playerNameToId.set(playerName.toLowerCase(), newSocketId);
  
  // Update helper roles if this player is one
  if (game.helperRoles.engineer.includes(oldSocketId)) {
    game.helperRoles.engineer = game.helperRoles.engineer.map(id => id === oldSocketId ? newSocketId : id);
  }
  if (game.helperRoles.doctor.includes(oldSocketId)) {
    game.helperRoles.doctor = game.helperRoles.doctor.map(id => id === oldSocketId ? newSocketId : id);
  }
  if (game.helperRoles.guardian.includes(oldSocketId)) {
    game.helperRoles.guardian = game.helperRoles.guardian.map(id => id === oldSocketId ? newSocketId : id);
  }
  
  // Update host if needed
  if (game.host === oldSocketId) {
    game.host = newSocketId;
  }
  
  // Update Gnosia elimination votes if in warp phase and this player was targeted
  if (game.phase === 'warp') {
    // Update any Gnosia votes that targeted the old socket ID
    for (const [gnosiaId, targetId] of game.warpActions.gnosiaElimination.entries()) {
      if (targetId === oldSocketId) {
        game.warpActions.gnosiaElimination.set(gnosiaId, newSocketId);
      }
    }
  }
  
  // Prepare role data for reconnected player
  const roleData = {
    role: player.role,
    isGnosia: player.isGnosia,
    isFollower: player.isFollower || false,
    isEngineer: game.helperRoles.engineer.includes(newSocketId),
    isDoctor: game.helperRoles.doctor.includes(newSocketId),
    isGuardian: game.helperRoles.guardian.includes(newSocketId)
  };
  
  // Restore investigation results if this player investigated anyone
  if (game.investigations.has(oldSocketId)) {
    const playerInvestigations = game.investigations.get(oldSocketId);
    game.investigations.delete(oldSocketId);
    game.investigations.set(newSocketId, playerInvestigations);
    roleData.investigations = Array.from(playerInvestigations.entries()).map(([targetId, result]) => ({
      targetId,
      result
    }));
  }
  
  // Get Gnosia players if this player is Gnosia
  if (player.isGnosia) {
    const gnosiaPlayers = Array.from(game.players.values())
      .filter(p => p.isGnosia)
      .map(p => ({ id: p.id, name: p.name }));
    roleData.gnosiaPlayers = gnosiaPlayers;
  }
  
  // Get helper role counts
  roleData.helperRoleCounts = {
    gnosia: Array.from(game.players.values()).filter(p => p.isGnosia).length,
    engineer: game.helperRoles.engineer.length,
    doctor: game.helperRoles.doctor.length,
    guardian: game.helperRoles.guardian.length
  };
  
  // Include warp action status if in warp phase
  if (game.phase === 'warp') {
    roleData.hasActed = {
      engineer: game.warpActions.engineerInvestigations.has(newSocketId),
      doctor: game.warpActions.doctorInvestigations.has(newSocketId),
      guardian: game.warpActions.guardianProtections.has(newSocketId),
      gnosia: game.warpActions.gnosiaElimination.has(newSocketId)
    };
  }
  
  return {
    success: true,
    reconnected: true,
    isHost: game.host === newSocketId,
    roleData,
    gameState: {
      phase: game.phase,
      round: game.round,
      players: Array.from(game.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        isAlive: p.isAlive,
        role: p.role,
        isFollower: p.isFollower || false
      }))
    }
  };
}

// Clean up disconnected players after timeout
setInterval(() => {
  const RECONNECT_TIMEOUT = 5 * 60 * 1000;
  const now = Date.now();
  
  for (const [roomCode, game] of games.entries()) {
    let playersRemoved = false;
    
    for (const [socketId, player] of game.players.entries()) {
      if (player.disconnected && now - player.disconnectTime > RECONNECT_TIMEOUT) {
        game.players.delete(socketId);
        game.playerNameToId.delete(player.name.toLowerCase());
        playersRemoved = true;
      }
    }
    
    // If all players are gone, delete the room
    if (game.players.size === 0) {
      games.delete(roomCode);
    }
  }
}, 60000); // Check every minute

function leaveGame(roomCode, socketId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }

  const player = game.players.get(socketId);
  if (!player) {
    return { success: false, error: 'Player not found' };
  }

  // Mark player as left (can't rejoin)
  game.leftPlayers.add(player.name.toLowerCase());
  
  // Mark player as dead/frozen
  player.isAlive = false;
  const wasHost = game.host === socketId;
  
  // Check if all players have left or disconnected
  const activePlayers = Array.from(game.players.values()).filter(p => p.isAlive && !p.disconnected);
  
  if (activePlayers.length === 0) {
    // Game is abandoned - delete it
    games.delete(roomCode);
    return {
      success: true,
      playerName: player.name,
      wasHost,
      gameAbandoned: true
    };
  }
  
  // Transfer host if needed
  let newHost = null;
  if (wasHost) {
    // Pick a random active player as new host
    const activePlayer = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    game.host = activePlayer.id;
    newHost = {
      id: activePlayer.id,
      name: activePlayer.name
    };
  }
  
  // Check win condition
  const { gameOver, winner } = checkWinCondition(game);
  
  return {
    success: true,
    playerName: player.name,
    wasHost,
    newHost,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isAlive: p.isAlive,
      disconnected: p.disconnected || false
    })),
    gameOver,
    winner,
    finalState: gameOver ? getGameState(roomCode) : null
  };
}

function returnToLobby(roomCode, requesterId) {
  const game = games.get(roomCode);
  if (!game) {
    return { success: false, error: 'Room not found' };
  }
  if (game.host !== requesterId) {
    return { success: false, error: 'Only host can return to lobby' };
  }

  // Reset all players
  game.players.forEach(player => {
    player.isAlive = true;
    player.role = null;
    player.isGnosia = false;
    player.ready = false;
  });
  
  // Clear spectators and left players
  game.spectators.clear();
  game.leftPlayers.clear();
  
  // Reset game state
  game.started = false;
  game.phase = 'lobby';
  game.round = 0;
  game.votes.clear();
  game.investigations.clear();
  game.warpActions = {
    engineerInvestigations: new Set(),
    doctorInvestigations: new Set(),
    guardianProtections: new Map(),
    gnosiaElimination: new Map()
  };
  game.helperRoles = {
    engineer: [],
    doctor: [],
    guardian: []
  };

  return {
    success: true,
    players: Array.from(game.players.values()).map(p => ({
      id: p.id,
      name: p.name
    }))
  };
}

module.exports = {
  createRoom,
  joinRoom,
  attemptReconnect,
  startGame,
  submitVote,
  gnosiaEliminate,
  engineerInvestigate,
  doctorInvestigate,
  guardianProtect,
  completeWarpPhase,
  updatePhase,
  getGameState,
  markPlayerReady,
  restartGame,
  handleDisconnect,
  getGamesCount,
  getPublicGames,
  leaveGame,
  returnToLobby
};
