import { join } from "node:path";
import { mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OUTPUT_DIR = process.argv[2] || join(process.cwd(), "docs");

const PACKAGES_DIR = join(process.cwd(), "packages");

const PACKAGE_NAMES = ["core", "client", "host", "cli", "devtools"] as const;

// ---------------------------------------------------------------------------
// Read package versions dynamically
// ---------------------------------------------------------------------------

async function getPackageVersion(name: string): Promise<string> {
  const pkgPath = join(PACKAGES_DIR, name, "package.json");
  const file = Bun.file(pkgPath);
  const pkg = (await file.json()) as { version: string };
  return pkg.version;
}

async function getVersions(): Promise<Record<string, string>> {
  const entries = await Promise.all(
    PACKAGE_NAMES.map(async (name) => [name, await getPackageVersion(name)]),
  );
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// llms.txt — concise index
// ---------------------------------------------------------------------------

function generateLlmsTxt(versions: Record<string, string>): string {
  return `# Couch Kit

> Turn an Android TV into a local party-game console. Phones join as web controllers over LAN WebSocket.

Couch Kit is a TypeScript framework for building local multiplayer party games on Android TV. The TV runs an HTTP static file server and a WebSocket game server on the LAN. Phones connect as web clients — no internet required. Game logic is defined once as a shared reducer and runs on both host and clients for optimistic updates, with the host as the single source of truth.

Current versions: core ${versions.core}, client ${versions.client}, host ${versions.host}, cli ${versions.cli}, devtools ${versions.devtools}.

## Packages

- [@couch-kit/core](modules/_couch_kit_core.html): Shared types, protocol, constants, middleware, and \`createGameReducer\`
- [@couch-kit/client](modules/_couch_kit_client.html): React hooks for phone web controllers — WebSocket client, time sync, asset preloading, debug panel
- [@couch-kit/host](modules/_couch_kit_host.html): React Native TV host — GameHostProvider, WebSocket server, static file server, asset extraction
- [@couch-kit/cli](modules/_couch_kit_cli.html): CLI tools — bundle, init, simulate, replay, dev
- [@couch-kit/devtools](modules/_couch_kit_devtools.html): DebugOverlay component for development

## Guides

- [Getting Started](index.html#-usage-guide-published-library): Installation, shared logic, host setup, client setup
- [Contracts](index.html#contracts-read-this-once): System actions, state updates, session recovery
- [Dev Workflow](index.html#dev-workflow-controller-on-laptop): Iterate on the web controller without rebuilding the TV app
- [Contributing](index.html#️-contributing--local-development): Monorepo setup, building, testing, yalc workflow

## Examples

- [Buzz](https://github.com/faluciano/buzz-tv-party-game): Minimal buzzer party game (starter)
- [Domino](https://github.com/faluciano/domino-party-game): Dominos with hidden hands (intermediate)
- [Card Game Engine](https://github.com/faluciano/card-game-engine): JSON-driven card game engine with expression evaluator and seeded PRNG (advanced)

## Optional

- [@couch-kit/devtools](modules/_couch_kit_devtools.html): Debug overlay for development builds
- [@couch-kit/cli details](modules/_couch_kit_cli.html): Bundle, simulate, init, replay, and dev commands
- [Full API Reference](llms-full.txt): Complete type signatures and API docs for LLM consumption
`;
}

// ---------------------------------------------------------------------------
// llms-full.txt — comprehensive single-file reference
// ---------------------------------------------------------------------------

function generateLlmsFullTxt(versions: Record<string, string>): string {
  return `# Couch Kit — Complete API Reference

> Turn an Android TV into a local party-game console. Phones join as web controllers over LAN WebSocket.

Versions: @couch-kit/core ${versions.core} · @couch-kit/client ${versions.client} · @couch-kit/host ${versions.host} · @couch-kit/cli ${versions.cli} · @couch-kit/devtools ${versions.devtools}

---

## 1. Overview

Couch Kit is a TypeScript framework for building local multiplayer party games on Android TV (or Fire TV). The architecture is:

- **TV (Host):** Runs a React Native app that starts an HTTP static file server (default port 8080) and a WebSocket game server (default port 8082). The host holds the canonical game state and broadcasts updates to all clients.
- **Phones (Clients):** Open a web page served by the TV's HTTP server, connect via WebSocket, send actions, and receive state updates. The client renders the controller UI.
- **Shared Reducer:** Game logic is defined once as a pure reducer function. Both host and client run the same reducer — the client for optimistic updates, the host as the single source of truth. The host's state is broadcast to clients via \`__HYDRATE__\` actions.
- **Session Recovery:** Players reconnect automatically. Player IDs are derived from a cryptographic secret stored in \`localStorage\`, so the same device always gets the same \`playerId\`.

The framework handles player management (join, leave, reconnect, timeout removal), state synchronization, time sync, and asset preloading automatically.

---

## 2. Quick Start

### Installation

\`\`\`bash
# TV App (Host)
bun add @couch-kit/host @couch-kit/core
npx expo install expo-file-system expo-network
bun add react-native-nitro-modules

# Web Controller (Client)
bun add @couch-kit/client @couch-kit/core
\`\`\`

### Shared Game Logic

\`\`\`typescript
import type { IGameState, IAction } from "@couch-kit/core";

export interface GameState extends IGameState {
  score: number;
}

export type GameAction = { type: "BUZZ" } | { type: "RESET" };

export const initialState: GameState = {
  status: "lobby",
  players: {},
  score: 0,
};

export const gameReducer = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case "BUZZ":
      return { ...state, score: state.score + 1 };
    case "RESET":
      return { ...state, score: 0 };
    default:
      return state;
  }
};
\`\`\`

### Host (TV App)

\`\`\`tsx
import { GameHostProvider, useGameHost } from "@couch-kit/host";
import { gameReducer, initialState } from "./shared/types";

export default function App() {
  return (
    <GameHostProvider config={{ reducer: gameReducer, initialState }}>
      <GameScreen />
    </GameHostProvider>
  );
}

function GameScreen() {
  const { state, serverUrl, serverError } = useGameHost();
  return (
    <View>
      {serverError && <Text>Error: {serverError.message}</Text>}
      <Text>Open on phone: {serverUrl}</Text>
      <Text>Score: {state.score}</Text>
    </View>
  );
}
\`\`\`

### Client (Web Controller)

\`\`\`tsx
import { useGameClient } from "@couch-kit/client";
import { gameReducer, initialState } from "../../shared/types";

export default function Controller() {
  const { state, sendAction } = useGameClient({
    reducer: gameReducer,
    initialState,
  });

  return (
    <button onClick={() => sendAction({ type: "BUZZ" })}>
      BUZZ! (Score: {state.score})
    </button>
  );
}
\`\`\`

---

## 3. Instructions for LLM Agents

When generating code for Couch Kit projects, follow these guidelines:

- **Use \`@couch-kit/core\`** for shared types (\`IGameState\`, \`IAction\`, \`IPlayer\`) and reducer logic (\`createGameReducer\`). This package runs on both host and client.
- **Use \`@couch-kit/host\`** for the TV app (React Native). It provides \`GameHostProvider\`, \`useGameHost\`, and server infrastructure.
- **Use \`@couch-kit/client\`** for phone web controllers (React). It provides \`useGameClient\` for WebSocket connection and state management.
- **Use \`@couch-kit/cli\`** for scaffolding (\`couch-kit init\`), bundling (\`couch-kit bundle\`), and development (\`couch-kit dev\`).
- **Always use \`createGameReducer()\`** to wrap user reducers — it handles internal actions (\`__HYDRATE__\`, \`__PLAYER_JOINED__\`, etc.) automatically.
- **Never dispatch internal action types** (\`__HYDRATE__\`, \`__PLAYER_JOINED__\`, \`__PLAYER_LEFT__\`, \`__PLAYER_RECONNECTED__\`, \`__PLAYER_REMOVED__\`) from client code. These are managed by the framework.
- **Player management is automatic** — don't add players to \`state.players\` manually. The framework handles join/leave/reconnect.
- **The host is the single source of truth.** Clients receive state via hydration. Optimistic updates run locally but are overridden by the host's authoritative state.
- **User reducers only handle custom action types.** The \`createGameReducer\` wrapper handles all internal actions before falling through to the user reducer.
- **On Android, use \`useExtractAssets()\`** to extract bundled web assets from the APK before passing \`staticDir\` to \`GameHostProvider\`.
- **In dev mode, pass \`url: "ws://TV_IP:8082"\`** to \`useGameClient()\` when serving the controller from a laptop.

### Deprecated exports to avoid

- \`MAX_FRAME_SIZE\` — Not used by internals. Will be removed in the next major version.
- \`KEEPALIVE_INTERVAL\` — Not used by internals. Will be removed in the next major version.
- \`KEEPALIVE_TIMEOUT\` — Not used by internals. Will be removed in the next major version.
- \`derivePlayerIdLegacy()\` — Insecure legacy derivation. Use \`derivePlayerId()\` instead.

---

## 4. Package: @couch-kit/core (v${versions.core})

Shared types, protocol definitions, constants, middleware, and the \`createGameReducer\` function.

### Interfaces

#### IPlayer

Represents a player connected to the game session. Managed automatically by \`createGameReducer\`.

\`\`\`typescript
interface IPlayer {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  connected: boolean;
}
\`\`\`

#### IGameState

Base interface for game state. All game states must extend this.

\`\`\`typescript
interface IGameState {
  status: string;
  players: Record<string, IPlayer>;
}
\`\`\`

#### IAction

Base interface for game actions. All custom actions must extend this.

\`\`\`typescript
interface IAction {
  type: string;
  payload?: unknown;
  playerId?: string;
  timestamp?: number;
}
\`\`\`

#### InternalAction

Internal actions managed automatically by \`createGameReducer\`. Consumers do not dispatch these.

\`\`\`typescript
type InternalAction<S extends IGameState = IGameState> =
  | { type: "__HYDRATE__"; payload: S }
  | { type: "__PLAYER_JOINED__"; payload: { id: string; name: string; avatar?: string } }
  | { type: "__PLAYER_LEFT__"; payload: { playerId: string } }
  | { type: "__PLAYER_RECONNECTED__"; payload: { playerId: string } }
  | { type: "__PLAYER_REMOVED__"; payload: { playerId: string } };
\`\`\`

#### CreateGameReducerOptions

Options for \`createGameReducer\`.

\`\`\`typescript
interface CreateGameReducerOptions<S extends IGameState, A extends IAction> {
  /**
   * Optional middleware stack. Middlewares are applied in order — the first
   * middleware in the array is the outermost layer and sees every action first.
   */
  middleware?: Middleware<S, A>[];
}
\`\`\`

### Type Aliases

#### GameReducer

\`\`\`typescript
type GameReducer<S extends IGameState, A extends IAction> = (state: S, action: A) => S;
\`\`\`

#### ClientMessage

Messages sent from client to host.

\`\`\`typescript
type ClientMessage =
  | { type: "JOIN"; payload: { name: string; avatar?: string; secret: string } }
  | { type: "ACTION"; payload: { type: string; payload?: unknown } }
  | { type: "PING"; payload: { id: string; timestamp: number } }
  | { type: "ASSETS_LOADED"; payload: true };
\`\`\`

#### HostMessage

Messages sent from host to client.

\`\`\`typescript
type HostMessage =
  | { type: "WELCOME"; payload: { playerId: string; state: unknown; serverTime: number } }
  | { type: "STATE_UPDATE"; payload: { action?: unknown; newState: unknown; timestamp: number } }
  | { type: "PONG"; payload: { id: string; origTimestamp: number; serverTime: number } }
  | { type: "RECONNECTED"; payload: { playerId: string; state: unknown } }
  | { type: "ERROR"; payload: { code: string; message: string } };
\`\`\`

#### Middleware

Redux-style middleware — a three-layer curried function.

\`\`\`typescript
interface MiddlewareAPI<S extends IGameState> {
  getState: () => S;
}

type MiddlewareDispatch<S extends IGameState, A extends IAction> = (
  action: A | InternalAction<S>,
) => S;

type Middleware<S extends IGameState = IGameState, A extends IAction = IAction> = (
  api: MiddlewareAPI<S>,
) => (next: MiddlewareDispatch<S, A>) => (action: A | InternalAction<S>) => S;
\`\`\`

#### ActionSchema

A map from action type strings to validator functions for \`actionValidator\` middleware.

\`\`\`typescript
type ActionSchema<A extends IAction> = {
  [K in A["type"]]?: (action: A & { type: K }) => boolean;
};
\`\`\`

### Constants

\`\`\`typescript
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_WS_PORT_OFFSET = 2;            // WS port = HTTP port + 2 (skips Metro on +1)
const DEFAULT_WS_PATH = "/ws";
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY = 1000;             // ms, exponential backoff base
const DEFAULT_MAX_DELAY = 10000;             // ms, backoff cap
const DEFAULT_SYNC_INTERVAL = 5000;          // ms, time sync ping interval
const MAX_PENDING_PINGS = 50;
const DEFAULT_DISCONNECT_TIMEOUT = 300000;   // 5 minutes in ms

// @deprecated — will be removed in next major
const MAX_FRAME_SIZE = 1048576;              // 1 MB
const KEEPALIVE_INTERVAL = 30000;            // @deprecated
const KEEPALIVE_TIMEOUT = 10000;             // @deprecated
\`\`\`

#### InternalActionTypes

Well-known internal action type strings.

\`\`\`typescript
const InternalActionTypes = {
  HYDRATE: "__HYDRATE__",
  PLAYER_JOINED: "__PLAYER_JOINED__",
  PLAYER_LEFT: "__PLAYER_LEFT__",
  PLAYER_RECONNECTED: "__PLAYER_RECONNECTED__",
  PLAYER_REMOVED: "__PLAYER_REMOVED__",
} as const;
\`\`\`

#### MessageTypes

Protocol message type constants.

\`\`\`typescript
const MessageTypes = {
  // Client -> Host
  JOIN: "JOIN",
  ACTION: "ACTION",
  PING: "PING",
  ASSETS_LOADED: "ASSETS_LOADED",

  // Host -> Client
  WELCOME: "WELCOME",
  STATE_UPDATE: "STATE_UPDATE",
  PONG: "PONG",
  RECONNECTED: "RECONNECTED",
  ERROR: "ERROR",
} as const;
\`\`\`

### Functions

#### createGameReducer

Wraps a user-provided reducer with automatic handling of internal actions (\`__HYDRATE__\`, \`__PLAYER_JOINED__\`, \`__PLAYER_LEFT__\`, \`__PLAYER_RECONNECTED__\`, \`__PLAYER_REMOVED__\`). When \`options.middleware\` is provided, the middleware stack wraps the entire reducer.

\`\`\`typescript
function createGameReducer<S extends IGameState, A extends IAction>(
  reducer: GameReducer<S, A>,
  options?: CreateGameReducerOptions<S, A>,
): GameReducer<S, A | InternalAction<S>>;
\`\`\`

#### applyMiddleware

Composes an array of middlewares into a higher-order function that wraps a game reducer. Middleware ordering follows the Redux convention: the first middleware is outermost. Each layer has a try/catch error boundary.

\`\`\`typescript
function applyMiddleware<S extends IGameState, A extends IAction>(
  ...middlewares: Middleware<S, A>[]
): (reducer: GameReducer<S, A | InternalAction<S>>) => GameReducer<S, A | InternalAction<S>>;
\`\`\`

#### actionLogger

Middleware that logs every dispatched action with previous and next state.

\`\`\`typescript
interface ActionLoggerOptions {
  /** Use console.groupCollapsed instead of console.group. Defaults to true. */
  collapsed?: boolean;
}

function actionLogger<S extends IGameState, A extends IAction>(
  options?: ActionLoggerOptions,
): Middleware<S, A>;
\`\`\`

Usage:

\`\`\`typescript
createGameReducer(reducer, { middleware: [actionLogger()] });
\`\`\`

#### actionValidator

Middleware that validates actions against a schema before they reach the reducer. Invalid actions are silently dropped with a console warning. Internal actions always pass through.

\`\`\`typescript
function actionValidator<S extends IGameState, A extends IAction>(
  schema: ActionSchema<A>,
): Middleware<S, A>;
\`\`\`

Usage:

\`\`\`typescript
const validator = actionValidator<GameState, GameAction>({
  SCORE: (action) => action.payload > 0,
});
createGameReducer(reducer, { middleware: [validator] });
\`\`\`

#### generateId

Generate a cryptographically random ID string. Uses \`crypto.randomUUID()\` when available, falling back to \`crypto.getRandomValues()\`.

\`\`\`typescript
function generateId(): string;
\`\`\`

#### isValidSecret

Validates that a string looks like a UUID (with or without dashes, 32+ hex chars).

\`\`\`typescript
function isValidSecret(secret: string): boolean;
\`\`\`

#### derivePlayerId

Derives a stable, public player ID from a secret UUID using SHA-256. Takes the first 16 hex characters of the hash. Falls back to \`derivePlayerIdLegacy\` when Web Crypto is unavailable.

\`\`\`typescript
async function derivePlayerId(secret: string): Promise<string>;
\`\`\`

#### derivePlayerIdLegacy

**@deprecated** — Insecure legacy derivation. Exposes first 16 hex chars of secret. Use \`derivePlayerId()\` instead.

\`\`\`typescript
function derivePlayerIdLegacy(secret: string): string;
\`\`\`

#### toErrorMessage

Safely extract an error message from an unknown caught value.

\`\`\`typescript
function toErrorMessage(error: unknown): string;
\`\`\`

### Replay System

Types and function for replaying recorded game sessions.

#### RecordedAction

\`\`\`typescript
interface RecordedAction<A extends IAction = IAction> {
  action: A;
  timestamp: number;
}
\`\`\`

#### StateSnapshot

\`\`\`typescript
interface StateSnapshot<S extends IGameState = IGameState> {
  state: S;
  action: IAction;
  timestamp: number;
  index: number;
}
\`\`\`

#### Recording

\`\`\`typescript
interface Recording<S extends IGameState = IGameState, A extends IAction = IAction> {
  initialState: S;
  actions: RecordedAction<A>[];
  startTimestamp: number;
  endTimestamp?: number;
  metadata?: Record<string, unknown>;
}
\`\`\`

#### ReplayResult

\`\`\`typescript
interface ReplayResult<S extends IGameState = IGameState> {
  finalState: S;
  snapshots: StateSnapshot<S>[];
  duration: number;
  actionCount: number;
}
\`\`\`

#### replayActions

Replays a recording against a reducer, producing the final state and intermediate snapshots for each action applied.

\`\`\`typescript
function replayActions<S extends IGameState = IGameState, A extends IAction = IAction>(
  recording: Recording<S, A>,
  reducer: GameReducer<S, A>,
): ReplayResult<S>;
\`\`\`

### Protocol Message Flow

1. Client opens WebSocket to \`ws://TV_IP:8082/ws\`
2. Client sends \`JOIN\` with \`{ name, avatar?, secret }\`
3. Host derives \`playerId\` from \`secret\`, dispatches \`__PLAYER_JOINED__\` (or \`__PLAYER_RECONNECTED__\` for returning players)
4. Host responds with \`WELCOME\` (or \`RECONNECTED\`) containing \`{ playerId, state, serverTime }\`
5. Client sends \`ACTION\` with \`{ type, payload? }\` — host validates and dispatches
6. Host broadcasts \`STATE_UPDATE\` with \`{ newState, timestamp, action? }\` to all clients
7. Client periodically sends \`PING\`, host replies with \`PONG\` for time sync
8. On disconnect, host dispatches \`__PLAYER_LEFT__\` and starts a cleanup timer (default 5 min)
9. If the player reconnects before timeout, \`__PLAYER_RECONNECTED__\` restores them
10. If timeout expires, \`__PLAYER_REMOVED__\` permanently removes the player from state

---

## 5. Package: @couch-kit/client (v${versions.client})

React hooks for phone web controllers.

### ClientConfig

\`\`\`typescript
interface ClientConfig<S extends IGameState, A extends IAction> {
  url?: string;           // Full WebSocket URL (overrides auto-detection)
  wsPort?: number;        // WebSocket port (default: HTTP port + 2)
  reducer: (state: S, action: A) => S;
  initialState: S;
  name?: string;          // Player display name (default: "Player")
  avatar?: string;        // Player avatar emoji (default: "\\u{1F600}")
  maxRetries?: number;    // Max reconnection attempts (default: 5)
  baseDelay?: number;     // Base delay ms for exponential backoff (default: 1000)
  maxDelay?: number;      // Max delay ms cap for backoff (default: 10000)
  onConnect?: () => void;
  onDisconnect?: () => void;
  debug?: boolean;
}
\`\`\`

### useGameClient

React hook that connects the web controller to the TV host via WebSocket. Manages the full lifecycle: connection, JOIN handshake, session recovery, optimistic state updates, server time synchronization, and automatic reconnection with exponential backoff.

\`\`\`typescript
function useGameClient<S extends IGameState, A extends IAction>(
  config: ClientConfig<S, A>,
): {
  status: "connecting" | "connected" | "disconnected" | "error";
  state: S;
  playerId: string | null;
  sendAction: (action: A) => void;
  getServerTime: () => number;
  rtt: number;
  disconnect: () => void;
  reconnect: () => void;
};
\`\`\`

**Lifecycle:**

1. On mount, auto-detects WebSocket URL from \`window.location\` (or uses explicit \`url\`/\`wsPort\`)
2. Opens WebSocket, sends \`JOIN\` with secret from \`localStorage\` (auto-generated if missing)
3. Receives \`WELCOME\` or \`RECONNECTED\`, hydrates local state from server
4. On \`STATE_UPDATE\`, replaces local state with server's authoritative state
5. \`sendAction()\` applies optimistic local update then sends to host
6. On close, automatically reconnects with exponential backoff (up to \`maxRetries\`)
7. \`disconnect()\` prevents auto-reconnect; \`reconnect()\` resets attempts and reconnects

### calculateTimeSync

Pure function that computes clock offset and RTT using NTP-style calculation.

\`\`\`typescript
function calculateTimeSync(
  clientSendTime: number,
  clientReceiveTime: number,
  serverTime: number,
): { offset: number; rtt: number };
\`\`\`

### useServerTime

React hook that synchronizes the client clock with the host server. Used internally by \`useGameClient\`. Periodically sends PING messages and processes PONG responses.

\`\`\`typescript
function useServerTime(socket: WebSocket | null): {
  getServerTime: () => number;
  rtt: number;
  handlePong: (payload: { id: string; origTimestamp: number; serverTime: number }) => void;
};
\`\`\`

### usePreload

Preloads a list of asset URLs (images via \`Image()\`, others via \`fetch()\`). Returns progress and failure information. Failed assets still count toward progress.

\`\`\`typescript
interface PreloadResult {
  loaded: boolean;       // Whether all assets have finished loading
  progress: number;      // Loading progress 0-100
  failedAssets: string[];// URLs that failed to load
}

function usePreload(
  assets: string[],
  sendMessage?: (msg: { type: string; payload: unknown }) => void,
): PreloadResult;
\`\`\`

### useDebugPanel

Hook that provides debug panel data for development. Tracks state changes, connection status, and action history. Designed to be consumed by \`DebugOverlay\` or custom debug UI.

\`\`\`typescript
interface DebugActionEntry {
  id: number;
  action: unknown;
  timestamp: number;
  source: "local" | "remote";
}

interface DebugStateEntry<S = unknown> {
  id: number;
  state: S;
  timestamp: number;
}

interface DebugPanelData<S = unknown> {
  enabled: boolean;
  actionLog: DebugActionEntry[];
  stateHistory: DebugStateEntry<S>[];
  connectionStatus: string;
  rtt: number | null;
  clearHistory: () => void;
  logAction: (action: unknown, source?: "local" | "remote") => void;
}

interface UseDebugPanelOptions<S = unknown> {
  enabled: boolean;       // Whether debug capture is active
  state: S | null;        // Current game state from useGameClient
  status: string;         // Connection status from useGameClient
  rtt: number;            // RTT from useGameClient
  maxEntries?: number;    // Max entries to keep (default: 50)
}

function useDebugPanel<S = unknown>(options: UseDebugPanelOptions<S>): DebugPanelData<S>;
\`\`\`

---

## 6. Package: @couch-kit/host (v${versions.host})

React Native host for the TV app.

### GameHostConfig

\`\`\`typescript
interface GameHostConfig<S extends IGameState, A extends IAction> {
  initialState: S;
  reducer: (state: S, action: A) => S;
  port?: number;              // Static server port (default: 8080)
  wsPort?: number;            // WebSocket port (default: HTTP port + 2)
  devMode?: boolean;
  devServerUrl?: string;      // e.g. "http://192.168.1.50:5173"
  staticDir?: string;         // Override www directory path (required on Android)
  debug?: boolean;
  disconnectTimeout?: number; // ms before disconnected player is removed (default: 300000)
  onPlayerJoined?: (playerId: string, name: string) => void;
  onPlayerLeft?: (playerId: string) => void;
  onError?: (error: Error) => void;
}
\`\`\`

### GameHostProvider

React context provider that turns a React Native TV app into a local game server. Starts a static file server and a WebSocket game server. Manages canonical game state and broadcasts updates to all connected clients. State broadcasts are throttled to ~30fps.

\`\`\`typescript
function GameHostProvider<S extends IGameState, A extends IAction>(props: {
  children: React.ReactNode;
  config: GameHostConfig<S, A>;
}): JSX.Element;
\`\`\`

**Behavior:**

- Starts static file server on \`config.port\` (default 8080)
- Starts WebSocket server on \`config.wsPort\` (default: HTTP port + 2)
- Wraps the user reducer with \`createGameReducer\` automatically
- Handles JOIN with secret-based player ID derivation (SHA-256 with legacy fallback)
- Rejects internal action types dispatched by clients (\`FORBIDDEN_ACTION\` error)
- Rate-limits client actions (60 per second per socket)
- Automatically manages player lifecycle (join, disconnect, reconnect, timeout removal)
- Broadcasts state updates throttled to ~30fps

### useGameHost

React hook to access the game host context. Must be used within a \`<GameHostProvider>\`.

\`\`\`typescript
function useGameHost<S extends IGameState, A extends IAction>(): {
  state: S;
  dispatch: (action: A) => void;
  serverUrl: string | null;
  serverError: Error | null;
};
\`\`\`

### useStaticServer

React hook that manages a static HTTP file server for serving the web controller.

\`\`\`typescript
interface CouchKitHostConfig {
  port?: number;
  devMode?: boolean;
  devServerUrl?: string;
  staticDir?: string;
}

function useStaticServer(config: CouchKitHostConfig): {
  url: string | null;
  error: Error | null;
  loading: boolean;
};
\`\`\`

### GameWebSocketServer

WebSocket server implementation using nitro-http. Extends a type-safe EventEmitter.

\`\`\`typescript
interface WebSocketConfig {
  port: number;
  debug?: boolean;
  maxFrameSize?: number;       // Max frame payload bytes (default: 1 MB)
  keepaliveInterval?: number;  // Server-side keepalive ping interval ms (default: 30s)
  keepaliveTimeout?: number;   // Pong timeout ms (default: 10s)
}

type WebSocketServerEvents = {
  connection: [socketId: string];
  message: [socketId: string, message: unknown];
  disconnect: [socketId: string];
  listening: [port: number];
  error: [error: Error];
};

class GameWebSocketServer extends EventEmitter<WebSocketServerEvents> {
  constructor(config: WebSocketConfig);

  /** Start the WebSocket server. Binds to 0.0.0.0 (all interfaces). */
  async start(): Promise<void>;

  /** Stop the server and close all client connections. */
  async stop(): Promise<void>;

  /** Send data to a specific client by socket ID. Silently ignores unknown IDs. */
  send(socketId: string, data: unknown): void;

  /** Broadcast data to all connected clients. Optionally exclude one socket ID. */
  broadcast(data: unknown, excludeId?: string): void;

  /** Number of currently connected clients. */
  get clientCount(): number;
}
\`\`\`

### getBestIpAddress

Smart IP discovery. Uses \`expo-network\` to get the device's LAN IP address.

\`\`\`typescript
async function getBestIpAddress(): Promise<string | null>;
\`\`\`

### useExtractAssets

Extracts bundled web assets from the APK to the filesystem so the native HTTP server can serve them. On Android, copies files from \`asset:///www/\` to the document directory. On iOS, returns \`undefined\` (server uses bundle path fallback).

\`\`\`typescript
interface AssetManifest {
  files: string[];
}

interface ExtractAssetsResult {
  staticDir: string | undefined;  // Filesystem path to extracted www dir
  loading: boolean;
  error: string | null;
}

function useExtractAssets(manifest: AssetManifest): ExtractAssetsResult;
\`\`\`

### useActionRecorder

Hook that enables recording of game actions for later replay. Used on the host side to capture game sessions.

\`\`\`typescript
interface RecordedAction<A extends IAction = IAction> {
  action: A;
  timestamp: number;
}

interface ActionRecording<S extends IGameState = IGameState, A extends IAction = IAction> {
  initialState: S;
  actions: RecordedAction<A>[];
  startTimestamp: number;
  endTimestamp?: number;
  metadata?: Record<string, unknown>;
}

interface ActionRecorderControls<S extends IGameState = IGameState, A extends IAction = IAction> {
  isRecording: boolean;
  recordedCount: number;
  startRecording: (currentState: S, metadata?: Record<string, unknown>) => void;
  stopRecording: () => ActionRecording<S, A> | null;
  recordAction: (action: A) => void;
  exportRecording: () => string | null;
  discardRecording: () => void;
}

function useActionRecorder<
  S extends IGameState = IGameState,
  A extends IAction = IAction,
>(): ActionRecorderControls<S, A>;
\`\`\`

---

## 7. Package: @couch-kit/cli (v${versions.cli})

CLI tools for Couch Kit. Installed as \`couch-kit\` binary.

### Commands

#### \`couch-kit bundle\`

Bundles the web controller into the Android assets directory.

\`\`\`
Options:
  -s, --source <path>    Source directory (default: "./web-controller")
  -o, --output <path>    Android assets directory (default: "./android/app/src/main/assets/www")
  --no-build             Skip build step (just copy)
  -m, --manifest <path>  Also write manifest to this path for import in app source
\`\`\`

#### \`couch-kit simulate\`

Spawns headless bots to simulate players.

\`\`\`
Options:
  -n, --count <number>     Number of bots (default: 4)
  -u, --url <url>          WebSocket URL of host (default: "ws://localhost:8082")
  -i, --interval <ms>      Action interval in ms (default: 1000)
\`\`\`

#### \`couch-kit init [name]\`

Scaffolds a new web controller project.

\`\`\`
Arguments:
  name    Project name (default: "web-controller")
\`\`\`

#### \`couch-kit replay <recording> <reducer>\`

Replays a recorded game session against a reducer.

\`\`\`
Arguments:
  recording   Path to recording JSON file
  reducer     Path to reducer module

Options:
  --snapshots   Output intermediate state snapshots
  --json        Output as formatted JSON
\`\`\`

#### \`couch-kit dev\`

Start development server with LAN access.

\`\`\`
Options:
  -p, --port <port>   Port number (default: 5173)
  --host               Expose to LAN
  --open               Open browser automatically
\`\`\`

---

## 8. Package: @couch-kit/devtools (v${versions.devtools})

Developer tooling and debug overlay for Couch Kit games.

### DebugOverlay

React component that renders a floating debug panel. Shows connection status, RTT, action log, and current state as a JSON tree. Toggled by clicking.

\`\`\`typescript
interface DebugOverlayProps {
  /** Debug panel data from useDebugPanel hook */
  data: DebugPanelData;
  /** Initial collapsed state (default: true) */
  defaultCollapsed?: boolean;
  /** Position on screen (default: "bottom-right") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Maximum height of the panel (default: 400) */
  maxHeight?: number;
}

function DebugOverlay(props: DebugOverlayProps): JSX.Element | null;
\`\`\`

Usage:

\`\`\`tsx
import { useDebugPanel } from "@couch-kit/client";
import { DebugOverlay } from "@couch-kit/devtools";

function App() {
  const { state, status, rtt, sendAction } = useGameClient({ ... });

  const debugPanel = useDebugPanel({
    enabled: true,
    state,
    status,
    rtt,
  });

  return (
    <>
      <GameUI />
      <DebugOverlay data={debugPanel} />
    </>
  );
}
\`\`\`

---

## 9. Contracts & Conventions

### System Actions

The framework dispatches these internal actions automatically. User reducers do NOT handle them:

| Action | When | Effect |
|--------|------|--------|
| \`__HYDRATE__\` | Server→client sync | Replaces client state wholesale |
| \`__PLAYER_JOINED__\` | New player JOINs | Adds player to \`state.players\` |
| \`__PLAYER_LEFT__\` | WebSocket disconnects | Marks player as \`connected: false\` |
| \`__PLAYER_RECONNECTED__\` | Returning player JOINs | Sets \`connected: true\`, preserves data |
| \`__PLAYER_REMOVED__\` | Disconnect timeout expires | Removes player from \`state.players\` |

### State Updates

- The host broadcasts full state snapshots (not diffs) via \`STATE_UPDATE\`
- Broadcasts are throttled to ~30fps to reduce serialization overhead
- Clients apply state via hydration (\`__HYDRATE__\`), overriding optimistic updates

### Session Recovery

- Client generates a cryptographic secret (\`crypto.randomUUID\`) stored in \`localStorage\`
- Secret is sent with \`JOIN\` — host derives a stable \`playerId\` via SHA-256
- If the derived ID matches an existing player, host sends \`RECONNECTED\` instead of \`WELCOME\`
- Disconnected players are kept in state for \`disconnectTimeout\` (default: 5 minutes)
- The raw secret is never broadcast — only the derived public \`playerId\` appears in game state

### Dev Workflow

1. Run the TV app with \`devMode: true\` and \`devServerUrl: "http://LAPTOP_IP:5173"\`
2. Run \`couch-kit dev\` (or \`vite\`) in the web controller directory
3. On the controller, pass \`url: "ws://TV_IP:8082"\` to \`useGameClient()\`
4. The TV will redirect phones to the laptop's dev server for hot reload
5. Iterate on the controller without rebuilding the TV app

---

## 10. Troubleshooting

| Problem | Solution |
|---------|----------|
| Phone can't open the controller page | Confirm TV and phone are on the same Wi-Fi; verify \`serverUrl\` is not null |
| Phone opens page but actions do nothing | Check that your reducer handles your custom action types |
| Dev mode WS fails | Pass \`url: "ws://TV_IP:8082"\` to \`useGameClient()\` |
| Connection is flaky | Enable \`debug: true\` in host/client and watch logs; keep TV from sleeping |
| Duplicate React / Invalid Hook Call | Ensure library packages treat \`react\` as peerDependency; don't bundle it |
| Changes not showing up after yalc push | Stop Metro and run \`bun start --reset-cache\` |
| \`staticDir\` undefined on Android | Use \`useExtractAssets(manifest)\` — APK assets can't be served directly |
| Rate limited errors | Client is sending >60 actions/second — throttle your dispatch calls |

---

## 11. Security Notes

- **LAN-only:** The controller URL is reachable to anyone on the same LAN. Do not run on untrusted Wi-Fi.
- **Secret-based session recovery:** \`JOIN\` requires a \`secret\` field — a persistent session token stored in client \`localStorage\`. The raw secret is never broadcast to other clients; only a derived public \`playerId\` (SHA-256 hash prefix) is shared in game state.
- **Internal action rejection:** The host rejects any client-dispatched internal action types (\`__HYDRATE__\`, \`__PLAYER_JOINED__\`, etc.) with a \`FORBIDDEN_ACTION\` error.
- **Rate limiting:** The host enforces a rate limit of 60 actions per second per client socket.
- **Input validation:** The host validates all incoming WebSocket messages against the \`ClientMessage\` schema before processing.
- **No encryption:** WebSocket traffic is unencrypted (\`ws://\`, not \`wss://\`). This is acceptable for LAN party games but not for sensitive data.
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const versions = await getVersions();

  // Ensure output directory exists
  await mkdir(OUTPUT_DIR, { recursive: true });

  const llmsTxt = generateLlmsTxt(versions);
  const llmsFullTxt = generateLlmsFullTxt(versions);

  const llmsPath = join(OUTPUT_DIR, "llms.txt");
  const llmsFullPath = join(OUTPUT_DIR, "llms-full.txt");

  await Promise.all([
    Bun.write(llmsPath, llmsTxt),
    Bun.write(llmsFullPath, llmsFullTxt),
  ]);

  const llmsSize = new Blob([llmsTxt]).size;
  const llmsFullSize = new Blob([llmsFullTxt]).size;

  console.log("Generated LLM-friendly docs:");
  console.log(`  ${llmsPath} (${(llmsSize / 1024).toFixed(1)} KB)`);
  console.log(`  ${llmsFullPath} (${(llmsFullSize / 1024).toFixed(1)} KB)`);
  console.log(
    `  Package versions: ${Object.entries(versions)
      .map(([k, v]) => `${k}@${v}`)
      .join(", ")}`,
  );
}

main().catch((error) => {
  console.error("Failed to generate LLM docs:", error);
  process.exit(1);
});
