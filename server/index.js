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
  socket.on('createRoom', (playerName) => {
    const roomCode = gameManager.createRoom(socket.id, playerName);
    socket.join(roomCode);
    socket.emit('roomCreated', { roomCode, playerName });
    console.log(`Room created: ${roomCode} by ${playerName}`);
  });

  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const result = gameManager.joinRoom(roomCode, socket.id, playerName);
    if (result.success) {
      socket.join(roomCode);
      socket.emit('roomJoined', { roomCode, playerName });
      io.to(roomCode).emit('playerJoined', {
        players: result.players,
        message: `${playerName} joined the game`
      });
      console.log(`${playerName} joined room: ${roomCode}`);
    } else {
      socket.emit('error', { message: result.error });
    }
  });

  // Start game
  socket.on('startGame', (roomCode) => {
    const result = gameManager.startGame(roomCode, socket.id);
    if (result.success) {
      // Send role assignments privately to each player
      result.roleAssignments.forEach(({ socketId, role, isGnosia }) => {
        io.to(socketId).emit('roleAssigned', { role, isGnosia });
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
          io.to(roomCode).emit('phaseChange', { phase: 'warp' });
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
      io.to(roomCode).emit('playerEliminated', {
        eliminatedPlayer: result.eliminatedPlayer,
        round: result.round,
        players: result.players
      });

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

  // Ready for next phase
  socket.on('readyForNextPhase', ({ roomCode, phase }) => {
    const result = gameManager.markPlayerReady(roomCode, socket.id);
    if (result.success && result.allReady) {
      if (phase === 'warp') {
        // Send warp complete to Gnosia players
        const gnosiaPlayers = result.gnosiaPlayers;
        gnosiaPlayers.forEach(playerId => {
          io.to(playerId).emit('gnosiaEliminationPhase', {
            alivePlayers: result.alivePlayers
          });
        });
      } else if (phase === 'debate') {
        // Move to voting
        const updateResult = gameManager.updatePhase(roomCode, 'voting');
        io.to(roomCode).emit('phaseChange', { 
          phase: 'voting',
          alivePlayers: result.alivePlayers
        });
      }
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
