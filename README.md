# Gnosia - Online Social Deduction Game

A multiplayer browser-based social deduction game inspired by the Gnosia anime/light novel. Players must work together to identify and eliminate the Gnosia before they take over the ship.

## Game Overview

A transport spaceship has just escaped from a planet, but some passengers have been infected and turned into Gnosia. The game is played in rounds with three phases:

1. **Debate Phase**: Players discuss (via Discord voice chat) who they suspect is Gnosia
2. **Voting Phase**: Players vote to put someone in "Deep Freeze" (stasis)
3. **Warp Phase**: The ship warps to a new location, during which the Gnosia eliminate one crew member

### Win Conditions
- **Crew Wins**: All Gnosia are put in stasis
- **Gnosia Win**: Gnosia equal or outnumber the remaining crew

## Features

- 5-15 player support
- Room-based multiplayer with 6-character room codes
- Real-time game state synchronization
- Simple text-based interface
- Role assignment (Crew/Gnosia)
- Turn-based gameplay phases
- Use Discord for voice communication during debate phases

## Tech Stack

- **Backend**: Node.js + Express + Socket.io
- **Frontend**: Vanilla JavaScript (no framework)
- **Deployment**: Docker + Docker Compose

## Installation

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production mode
npm start
```

The server will start on port 3000 by default.

### Docker Deployment

```bash
# Build and start container
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down
```

The Docker deployment maps to port 3002 on the host.

## Deployment on Docker01

```bash
# SSH to Docker01
ssh cray@192.168.1.111

# Navigate to project
cd /path/to/gnosia

# Deploy
docker compose down && docker compose build --no-cache && docker compose up -d
```

### HAProxy Configuration

Add to HAProxy config for routing via subdomain (e.g., gnosia.tech-ra.net):

```
backend gnosia
    server gnosia docker01.local:3002 check
```

## How to Play

1. One player creates a room and shares the room code
2. Other players join using the room code
3. Host starts the game when all players are ready (minimum 5 players)
4. Players receive their secret roles (Crew or Gnosia)
5. Each round:
   - **Debate**: Discuss on Discord who might be Gnosia
   - **Vote**: All players vote on who to freeze
   - **Warp**: Gnosia eliminate someone (if any Gnosia remain)
6. Game continues until one side wins

## Game Mechanics

- Roles are randomly assigned at game start
- Approximately 1/3 of players are Gnosia (minimum 1)
- Players eliminated by freezing or Gnosia attack cannot participate
- All alive players must vote before proceeding
- Only alive Gnosia can eliminate during warp phase
- Game state persists even if players temporarily disconnect

## Future Enhancements

- Special roles (Engineer, Doctor, Guard)
- Player abilities and special actions
- Game statistics and history
- Persistent user accounts
- Lobby browser to find public games
- Spectator mode for eliminated players
- Customizable game settings (Gnosia count, special roles)

## License

MIT
