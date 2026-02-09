const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const gameManager = require('./gameManager');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Helper function to handle warp phase end
function handleWarpPhaseEnd(io, roomCode, warpResult) {
  if (warpResult.wasProtected) {
    // Player was protected by Guardian
    io.to(roomCode).emit('playerProtected', {
      round: warpResult.round,
      players: warpResult.players
    });
  } else if (warpResult.eliminatedPlayer) {
    // Player was eliminated
    io.to(roomCode).emit('playerEliminated', {
      eliminatedPlayer: warpResult.eliminatedPlayer,
      round: warpResult.round,
      players: warpResult.players
    });
  }

  // Check for game end
  if (warpResult.gameOver) {
    io.to(roomCode).emit('gameOver', {
      winner: warpResult.winner,
      finalState: warpResult.finalState
    });
  } else {
    // Start new debate phase
    io.to(roomCode).emit('phaseChange', { 
      phase: 'debate',
      round: warpResult.round
    });
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', games: gameManager.getGamesCount() });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create or join room
  socket.on('createRoom', ({ playerName, isPublic }) => {
    const roomCode = gameManager.createRoom(socket.id, playerName, isPublic);
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerName });
    console.log(`Room created: ${roomCode} by ${playerName} (public: ${isPublic})`);
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    // First try to reconnect if player was disconnected
    const reconnectResult = gameManager.attemptReconnect(roomCode, playerName, socket.id);
    
    if (reconnectResult.success) {
      socket.join(roomCode);
      
      // Send reconnection confirmation with full game state
      socket.emit('reconnected', {
        roomCode,
        isHost: reconnectResult.isHost,
        roleData: reconnectResult.roleData,
        gameState: reconnectResult.gameState
      });
      
      // Notify other players
      io.to(roomCode).emit('playerReconnected', {
        playerName,
        players: reconnectResult.gameState.players.map(p => ({
          id: p.id,
          name: p.name,
          isAlive: p.isAlive,
          disconnected: p.disconnected || false
        }))
      });
      
      console.log(`${playerName} reconnected to room: ${roomCode}`);
      return;
    }
    
    // If reconnection failed, try normal join
    const result = gameManager.joinRoom(roomCode, socket.id, playerName);
    if (result.success) {
      socket.join(roomCode);
      socket.emit('roomJoined', { 
        roomCode, 
        isSpectator: result.isSpectator,
        gameState: result.gameState
      });
      
      if (result.isSpectator) {
        io.to(roomCode).emit('playerJoined', {
          players: result.gameState.players,
          message: `${playerName} joined as spectator`
        });
        console.log(`${playerName} joined room: ${roomCode} as spectator`);
      } else {
        io.to(roomCode).emit('playerJoined', {
          players: result.players,
          message: `${playerName} joined the game`
        });
        console.log(`${playerName} joined room: ${roomCode}`);
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });
  
  // Get public games list
  socket.on('getPublicGames', () => {
    const publicGames = gameManager.getPublicGames();
    socket.emit('publicGamesList', { games: publicGames });
  });

  // Start game
  socket.on('startGame', (roomCode) => {
    const result = gameManager.startGame(roomCode, socket.id);
    if (result.success) {
      // Get Gnosia player info for display
      const gnosiaPlayers = result.players.filter(p => 
        result.gnosiaPlayerIds.includes(p.id)
      );
      
      // Send role assignments privately to each player
      result.roleAssignments.forEach(({ socketId, role, isGnosia, isFollower }) => {
        const roleData = { 
          role, 
          isGnosia,
          isFollower,
          gnosiaPlayers, // Send to all players for the count display
          helperRoleCounts: result.helperRoleCounts,
          isEngineer: result.helperRoles.engineer.includes(socketId),
          isDoctor: result.helperRoles.doctor.includes(socketId),
          isGuardian: result.helperRoles.guardian.includes(socketId)
        };
        
        io.to(socketId).emit('roleAssigned', roleData);
      });
      // Send game started to all players
      io.to(roomCode).emit('gameStarted', {
        phase: 'debate',
        players: result.players,
        round: 1
      });
      console.log(`Game started in room: ${roomCode}`);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Submit vote
  socket.on('submitVote', ({ roomCode, targetPlayerId }) => {
    const result = gameManager.submitVote(roomCode, socket.id, targetPlayerId);
    if (result.success) {
      io.to(roomCode).emit('voteSubmitted', {
        voterCount: result.voterCount,
        totalPlayers: result.totalPlayers
      });

      // Check if all votes are in
      if (result.allVoted) {
        io.to(roomCode).emit('votingComplete', {
          eliminatedPlayer: result.eliminatedPlayer,
          voteResults: result.voteResults,
          allVotes: result.allVotes,
          players: result.players
        });

        // Check for game end
        if (result.gameOver) {
          io.to(roomCode).emit('gameOver', {
            winner: result.winner,
            finalState: result.finalState
          });
        } else {
          // Move to warp phase
          gameManager.updatePhase(roomCode, 'warp');
          
          // Get alive players for Gnosia elimination
          const gameState = gameManager.getGameState(roomCode);
          const alivePlayers = gameState.players
            .filter(p => p.isAlive)
            .map(p => ({ id: p.id, name: p.name }));
          
          // Send phase change to all
          io.to(roomCode).emit('phaseChange', { phase: 'warp' });
          
          // Send elimination phase to ALL Gnosia players
          gameState.players.forEach(player => {
            if (player.isGnosia && player.isAlive) {
              io.to(player.id).emit('gnosiaEliminationPhase', {
                alivePlayers
              });
            }
          });
        }
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Gnosia elimination (warp phase)
  socket.on('gnosiaEliminate', ({ roomCode, targetPlayerId }) => {
    const result = gameManager.gnosiaEliminate(roomCode, socket.id, targetPlayerId);
    if (result.success) {
      // Confirm selection
      socket.emit('actionConfirmed', { message: 'Target selected. Waiting for other actions...' });
      
      // Check if all actions complete
      if (result.allComplete) {
        const warpResult = gameManager.completeWarpPhase(roomCode);
        if (warpResult.success) {
          handleWarpPhaseEnd(io, roomCode, warpResult);
        }
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Engineer investigate
  socket.on('engineerInvestigate', ({ roomCode, targetPlayerId }) => {
    const result = gameManager.engineerInvestigate(roomCode, socket.id, targetPlayerId);
    if (result.success) {
      socket.emit('investigationResult', {
        targetId: targetPlayerId,
        targetName: result.targetName,
        result: result.result
      });
      
      // Check if all actions complete
      if (result.allComplete) {
        const warpResult = gameManager.completeWarpPhase(roomCode);
        if (warpResult.success) {
          handleWarpPhaseEnd(io, roomCode, warpResult);
        }
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Doctor investigate
  socket.on('doctorInvestigate', ({ roomCode, targetPlayerId }) => {
    const result = gameManager.doctorInvestigate(roomCode, socket.id, targetPlayerId);
    if (result.success) {
      socket.emit('investigationResult', {
        targetId: targetPlayerId,
        targetName: result.targetName,
        result: result.result
      });
      
      // Check if all actions complete
      if (result.allComplete) {
        const warpResult = gameManager.completeWarpPhase(roomCode);
        if (warpResult.success) {
          handleWarpPhaseEnd(io, roomCode, warpResult);
        }
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Guardian protect
  socket.on('guardianProtect', ({ roomCode, targetPlayerId }) => {
    const result = gameManager.guardianProtect(roomCode, socket.id, targetPlayerId);
    if (result.success) {
      socket.emit('protectionConfirmed', {
        targetId: targetPlayerId,
        targetName: result.targetName
      });
      
      // Check if all actions complete
      if (result.allComplete) {
        const warpResult = gameManager.completeWarpPhase(roomCode);
        if (warpResult.success) {
          handleWarpPhaseEnd(io, roomCode, warpResult);
        }
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Ready for next phase
  socket.on('readyForNextPhase', ({ roomCode, phase }) => {
    const result = gameManager.markPlayerReady(roomCode, socket.id);
    if (result.success) {
      // Broadcast that this player is ready
      io.to(roomCode).emit('playerReady', { playerId: socket.id });
      
      if (result.allReady) {
        if (phase === 'debate') {
          // Move to voting
          const updateResult = gameManager.updatePhase(roomCode, 'voting');
          const gameState = gameManager.getGameState(roomCode);
          io.to(roomCode).emit('phaseChange', { 
            phase: 'voting',
            alivePlayers: result.alivePlayers,
            players: gameState.players
          });
        }
      }
    }
  });

  // Restart game
  socket.on('restartGame', (roomCode) => {
    const result = gameManager.restartGame(roomCode, socket.id);
    if (result.success) {
      io.to(roomCode).emit('gameRestarted', {
        players: result.players
      });
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Leave Game
  socket.on('leaveGame', (roomCode) => {
    const result = gameManager.leaveGame(roomCode, socket.id);
    if (result.success) {
      if (result.gameAbandoned) {
        // Game was abandoned, just confirm to leaving player
        socket.emit('leftGame', {
          message: 'You have left the game. You can rejoin as a spectator.'
        });
        socket.leave(roomCode);
      } else {
        // Notify all players about the departure
        io.to(roomCode).emit('playerLeft', {
          playerName: result.playerName,
          players: result.players,
          newHost: result.newHost
        });
        
        // Check if game ended due to departure
        if (result.gameOver) {
          io.to(roomCode).emit('gameOver', {
            winner: result.winner,
            finalState: result.finalState
          });
        }
        
        // Confirm to the leaving player
        socket.emit('leftGame', {
          message: 'You have left the game. You can rejoin as a spectator.'
        });
        socket.leave(roomCode);
      }
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Return to Lobby
  socket.on('returnToLobby', (roomCode) => {
    const result = gameManager.returnToLobby(roomCode, socket.id);
    if (result.success) {
      io.to(roomCode).emit('returnedToLobby', {
        players: result.players
      });
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const result = gameManager.handleDisconnect(socket.id);
    if (result.roomCode) {
      io.to(result.roomCode).emit('playerDisconnected', {
        playerName: result.playerName,
        players: result.players
      });
    }
    console.log(`Player disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Gnosia server running on port ${PORT}`);
});
