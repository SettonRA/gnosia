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
      result.roleAssignments.forEach(({ socketId, role, isGnosia }) => {
        const roleData = { 
          role, 
          isGnosia,
          gnosiaPlayers, // Send to all players for the count display
          helperRoleCounts: result.helperRoleCounts,
          isEngineer: result.helperRoles.engineer === socketId,
          isDoctor: result.helperRoles.doctor === socketId,
          isGuardian: result.helperRoles.guardian === socketId
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
          
          // Get current turn Gnosia player and alive players
          const warpInfo = gameManager.getWarpInfo(roomCode);
          
          // Send phase change to all
          io.to(roomCode).emit('phaseChange', { phase: 'warp' });
          
          // Send elimination phase only to the Gnosia whose turn it is
          if (warpInfo.currentGnosiaPlayer) {
            io.to(warpInfo.currentGnosiaPlayer).emit('gnosiaEliminationPhase', {
              alivePlayers: warpInfo.alivePlayers
            });
          }
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
      if (result.wasProtected) {
        // Player was protected by Guardian
        io.to(roomCode).emit('playerProtected', {
          round: result.round,
          players: result.players
        });
      } else {
        // Player was eliminated
        io.to(roomCode).emit('playerEliminated', {
          eliminatedPlayer: result.eliminatedPlayer,
          round: result.round,
          players: result.players
        });
      }

      // Check for game end
      if (result.gameOver) {
        io.to(roomCode).emit('gameOver', {
          winner: result.winner,
          finalState: result.finalState
        });
      } else {
        // Start new debate phase
        gameManager.updatePhase(roomCode, 'debate');
        io.to(roomCode).emit('phaseChange', { 
          phase: 'debate',
          round: result.round
        });
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
          io.to(roomCode).emit('phaseChange', { 
            phase: 'voting',
            alivePlayers: result.alivePlayers
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
