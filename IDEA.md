# React Native Party Kit - Development Plan

## Project Overview

**Name:** `react-native-party-kit`

**Purpose:** The de-facto framework for building premium local multiplayer games where an Android TV/Fire TV acts as the game host and smartphones connect as controllers. Focuses on "invisible networking" and zero-friction UX.

**Architecture:** TV-as-Server. The TV application hosts both an HTTP server (serving the controller website) and a WebSocket server (handling real-time communication).

**Target Platforms:**
- Host: Android TV, Fire TV, Google TV
- Client: Mobile web browsers (iOS Safari, Android Chrome)

---

## Tooling Decisions

### Why Bun?

| Benefit | Impact |
|---------|--------|
| ~12x faster package installs | Dramatically faster CI and local setup |
| Native TypeScript execution | No separate compilation step for scripts |
| Built-in workspace support | No need for separate workspace tooling |
| Native test runner | Can replace Vitest/Jest for pure TS packages |
| Anthropic backing | Long-term viability signal |

### Versioning & Publishing
- **Changesets:** Used for managing versioning and changelogs in the monorepo.

### Bun + React Native Compatibility
**Mitigation strategies:**
- Use `bun install --backend=copyfile` if postinstall issues occur
- Keep React Native CLI commands using `npx` or `bunx`
- Add commonly-needed transitive deps explicitly if Metro fails to resolve them

---

## Package Structure

```text
react-native-party-kit/
├── packages/
│   ├── core/           # Shared types, protocol, and reducer logic
│   ├── host/           # React Native TV library (Server)
│   ├── client/         # Web controller library (Client)
│   └── cli/            # Developer tooling (Bundle, Init, Sim)
├── apps/
│   ├── example-host/   # Demo TV app
│   └── example-controller/  # Demo web controller
├── package.json        # Root with workspaces config
└── bunfig.toml         # Bun configuration
```

---

## Core Features & UX Philosophy

### 1. Invisible Networking (Zero Config)
- **Smart Discovery:** Host automatically prioritizes `wlan0`/`eth0` interfaces to guess the correct IP.
- **Magic Client:** Web client connects via `window.location.hostname` (since it's served by the host), removing the need for IP entry.
- **Fail-Safe:** "Trouble connecting?" button on Host reveals the full URL (http://192.168.x.x:8080) and a Network Interface Cycler.
- **Room Code:** A 4-character code is displayed to validate the session (preventing cross-talk between multiple local games), but the primary connection method relies on the HTTP-served client.

### 2. Robust State Management
- **Full State Sync:** Host sends the entire `IGameState` object on every update. This is simpler to debug and prevents clients from getting "out of sync" (unlike delta patching).
- **Typed Reducers:** Game logic is defined as a pure reducer function (Action + State -> New State), shared between host and client for optimistic updates.
- **Generics:** All libraries use `IGameState` and `IAction` generics for full type safety in consuming apps.

### 3. "Premium" Polish
- **Time Sync:** NTP-style synchronization to ensure countdowns and music start simultaneously on all devices.
- **Aggressive Reconnection:** "Seat Reservation" system. If a phone reconnects with a valid secret, it immediately "takes over" the previous session, disconnecting any zombie sockets.
- **Asset Preloading:** Host waits for clients to report "Assets Loaded" before starting gameplay to prevent laggy sounds/images.

---

## Package Specifications

### @party-kit/core
**Purpose:** Pure TypeScript package containing shared logic.
**Key Features:**
- **Generic Types:** `PartyKit<State, Action>` wrapper.
- **Reducer Pattern:** `createGameReducer()` helper.
- **Session Types:** Definitions for seat reservations.
- **Protocol:** Message definitions (JOIN, ACTION, SYNC_TIME, ASSET_LOADED).

### @party-kit/host
**Purpose:** React Native library for the TV application.
**Key Features:**
- **Smart Network Selection:** Heuristic to find the best IP.
- **Dev Mode (Direct Connect):** Host enables CORS to allow the phone to load assets from a laptop (e.g., `http://localhost:5173`) but connect WebSocket to the TV.
- **Debug Dashboard:** Overlay UI to inspect connected players, kick users, and view logs.
- **Static File Server:** Serves the production bundle.
- **WebSocket Server:** Handles gameplay traffic.

### @party-kit/client
**Purpose:** Lightweight library for the web controller.
**Key Features:**
- **Headless Hooks:** `useGameClient`, `useServerTime`. No pre-styled UI components (bring your own UI) to ensure maximum flexibility.
- **Time Sync:** `useServerTime()` hook.
- **Auto-Reconnect:** Transparent session recovery (Aggressive Takeover).
- **Asset Loader:** `usePreload()` hook to block "Ready" status until assets are cached.
- **Optimistic UI:** Immediate state updates based on local reducer execution.

### @party-kit/cli
**Purpose:** Developer tooling.
**Commands:**
- `bundle`: Builds web controller and copies to Android assets.
- `init`: Scaffolds new project.
- `simulate`: Spawns headless "bot" clients to stress-test the host or test game logic without multiple devices.

---

## Development Phases

### Phase 1: Project Setup (2-3 days)
- Initialize Bun monorepo.
- Configure **Changesets** for versioning.
- Set up TypeScript, ESLint, Prettier.
- Configure CI/CD with Bun.

### Phase 2: Core Package & Architecture (3-4 days)
- Define `IGameState` and `IAction` generics.
- Implement Reducer pattern.
- Implement ID generators and Validation.
- Define Protocol (including Time Sync & Recovery messages).

### Phase 3: Host Package - Foundation (1 week)
- React Native Static Server & TCP Socket setup.
- **Smart IP Discovery** logic.
- **Dev Mode** implementation (CORS & Direct Connect).
- Basic "Hello World" connectivity.

### Phase 4: Host Package - Advanced (1-2 weeks)
- WebSocket Server implementation.
- **Session Recovery** (Seat Reservation) logic.
- **Debug Dashboard** overlay.
- QR Code generation.

### Phase 5: Client Package (1 week)
- WebSocket Client with Reconnect logic.
- **Time Synchronization** implementation.
- **Asset Preloading** system.
- React Hooks (`useGameClient`, `useServerTime`).

### Phase 6: CLI & Simulation (3-4 days)
- Bundle & Init commands.
- **Simulation Command:** Create a bot runner to simulate N players sending random actions.

### Phase 7: Example App "Buzzer" (1 week)
- Complete implementation of the Buzzer game.
- Demonstrate Reducers, Time Sync, and Preloading.
- Use for manual testing on TV/Phones.

### Phase 8: Documentation & Polish (3-4 days)
- Comprehensive README.
- Troubleshooting guide (Network isolation, etc.).
- Release via Changesets.

---

## Message Protocol (Enhanced)

**Client to Host:**
| Type | Payload | Purpose |
|------|---------|---------|
| `JOIN` | `{ name, avatar, secret? }` | Request to join (secret used for reconnect) |
| `ACTION` | `{ type, payload }` | Game action |
| `PING` | `{ id, timestamp }` | Time sync request |
| `ASSETS_LOADED` | `true` | Client ready state |

**Host to Client:**
| Type | Payload | Purpose |
|------|---------|---------|
| `WELCOME` | `{ playerId, state, serverTime }` | Initial state |
| `STATE_UPDATE` | `{ action, newState, timestamp }` | State change |
| `PONG` | `{ id, origTimestamp, serverTime }` | Time sync response |
| `RECONNECTED` | `{ state }` | Session restored |

---

## Success Criteria
1. **Zero Config:** Developer runs app, scans code, it just works.
2. **Hot Reloading:** Developer changes web code on laptop, sees update on phone immediately (Dev Mode).
3. **Robustness:** Turning phone screen off/on instantly resumes the session (Aggressive Takeover).
4. **Sync:** Audio cues play in sync across devices.
5. **Type Safety:** Full TypeScript inference from Host to Client.
