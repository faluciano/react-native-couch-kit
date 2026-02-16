# @couch-kit/core

Shared TypeScript definitions and protocol logic for Couch Kit.

## Purpose

This package ensures that both the Host (TV) and Client (Phone) speak the exact same language. By sharing types, we get end-to-end type safety across your entire full-stack game.

## Installation

```bash
bun add @couch-kit/core
```

## Key Exports

### `createGameReducer`

A higher-order reducer that wraps your game reducer with automatic handling of internal actions:

- `__HYDRATE__` -- Replaces state wholesale (used for server-to-client state sync).
- `__PLAYER_JOINED__` -- Adds a player to `state.players`.
- `__PLAYER_LEFT__` -- Marks a player as disconnected in `state.players`.
- `__PLAYER_RECONNECTED__` -- Dispatched when a returning player reconnects with a valid session. Sets `connected: true` and preserves all existing player data.
- `__PLAYER_REMOVED__` -- Dispatched when a disconnected player times out (default: 5 minutes). Permanently removes the player from `state.players`.

**You do not need to call this yourself.** Both `GameHostProvider` and `useGameClient` wrap your reducer automatically. Just write a plain reducer that handles your own action types:

```typescript
import { IGameState, IAction } from "@couch-kit/core";

interface GameState extends IGameState {
  score: number;
}

type GameAction = { type: "SCORE"; payload: number } | { type: "RESET" };

const gameReducer = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case "SCORE":
      return { ...state, score: state.score + action.payload };
    case "RESET":
      return { ...state, score: 0 };
    default:
      return state;
  }
};
```

### Middleware

`createGameReducer` accepts an optional second argument with a `middleware` array. Middlewares follow the Redux pattern — each is a three-layer curried function that can observe, transform, or block actions before they reach the reducer.

```typescript
import {
  createGameReducer,
  actionLogger,
  actionValidator,
  type Middleware,
} from "@couch-kit/core";

const reducer = createGameReducer(gameReducer, {
  middleware: [
    actionLogger(),
    actionValidator({ SCORE: (action) => action.payload > 0 }),
  ],
});
```

Middlewares execute in array order: the first middleware sees the action first on the way in and last on the way out. Each middleware is wrapped in an error boundary — if one throws, it is skipped and the action continues to the next layer.

#### `actionLogger(options?)`

Logs every dispatched action with its previous state, action payload, and resulting state.

| Option      | Type      | Default | Description                                     |
| ----------- | --------- | ------- | ----------------------------------------------- |
| `collapsed` | `boolean` | `true`  | Use `console.groupCollapsed` instead of `group` |

```typescript
actionLogger(); // collapsed groups (default)
actionLogger({ collapsed: false }); // expanded groups
```

#### `actionValidator(schema)`

Validates actions against a schema before they reach the reducer. If a validator returns `false`, the action is dropped and a warning is logged.

```typescript
import { actionValidator, type ActionSchema } from "@couch-kit/core";

const schema: ActionSchema<GameAction> = {
  SCORE: (action) => typeof action.payload === "number" && action.payload > 0,
  RESET: () => true,
};

const validator = actionValidator<GameState, GameAction>(schema);
```

Actions without a matching validator in the schema pass through unchanged. Internal actions (types prefixed with `__`) are never validated.

#### Custom middleware

A middleware is a function with the signature:

```typescript
const myMiddleware: Middleware<GameState, GameAction> =
  (api) => (next) => (action) => {
    // `api.getState()` returns the current state
    // `next(action)` passes the action to the next layer
    // Return the resulting state
    const result = next(action);
    return result;
  };
```

> **Note:** Internal actions (`__HYDRATE__`, `__PLAYER_JOINED__`, etc.) flow through middleware and are observable, but custom middleware should **not** block them. Doing so will break framework behaviour.

### Interfaces

#### `IPlayer`

Represents a connected player. Managed automatically by the framework.

```typescript
interface IPlayer {
  id: string;
  name: string;
  avatar?: string;
  isHost: boolean;
  connected: boolean;
}
```

#### `IGameState`

Base interface for all game states. Your state must extend this.

```typescript
interface IGameState {
  status: string;
  players: Record<string, IPlayer>;
}
```

#### `IAction`

Base interface for game actions. Your actions must extend this (at minimum, include a `type` field).

```typescript
interface IAction {
  type: string;
  payload?: unknown;
  playerId?: string;
  timestamp?: number;
}
```

#### `GameReducer<S, A>`

Type alias for a reducer function: `(state: S, action: A) => S`.

### Utility Functions

#### `generateId()`

Generates a cryptographically random ID string. Uses `crypto.randomUUID()` when available, falling back to `crypto.getRandomValues()`.

```typescript
import { generateId } from "@couch-kit/core";

const id = generateId(); // e.g. "a1b2c3d4-e5f6-..."
```

#### `toErrorMessage(error: unknown)`

Safely extracts an error message from an unknown caught value. Returns `error.message` for `Error` instances, otherwise `String(error)`.

```typescript
import { toErrorMessage } from "@couch-kit/core";

try {
  // ...
} catch (e) {
  console.error(toErrorMessage(e));
}
```

#### `isValidSecret(secret: string): boolean`

Validates that a string is a valid UUID format (32+ hex characters, with or without dashes).

#### `derivePlayerId(secret: string): string`

Derives a stable, public player ID from a secret UUID by stripping dashes and taking the first 16 hex characters.

### Constants

| Constant                 | Default          | Description                                              |
| ------------------------ | ---------------- | -------------------------------------------------------- |
| `DEFAULT_HTTP_PORT`      | `8080`           | Default HTTP port for the static file server             |
| `DEFAULT_WS_PORT_OFFSET` | `2`              | WebSocket port offset from HTTP port (skips Metro on +1) |
| `MAX_FRAME_SIZE`         | `1048576` (1 MB) | Maximum WebSocket frame payload size                     |
| `DEFAULT_MAX_RETRIES`    | `5`              | Maximum client reconnection attempts                     |
| `DEFAULT_BASE_DELAY`     | `1000`           | Base delay (ms) for exponential backoff                  |
| `DEFAULT_MAX_DELAY`      | `10000`          | Maximum delay (ms) cap for backoff                       |
| `DEFAULT_SYNC_INTERVAL`  | `5000`           | Time sync ping interval (ms)                             |
| `MAX_PENDING_PINGS`      | `50`             | Maximum outstanding pings before cleanup                 |
| `KEEPALIVE_INTERVAL`     | `30000`          | Server-side keepalive ping interval (ms)                 |
| `KEEPALIVE_TIMEOUT`      | `10000`          | Keepalive timeout before disconnect (ms)                 |

### Protocol Types

Low-level message types and constants used by host/client:

- `ClientMessage` -- Union of all client-to-host message shapes (`JOIN`, `ACTION`, `PING`, `ASSETS_LOADED`)
- `HostMessage` -- Union of all host-to-client message shapes (`WELCOME`, `STATE_UPDATE`, `PONG`, `RECONNECTED`, `ERROR`)
- `MessageTypes` -- Const object with all message type strings

### Protocol Definitions

At the protocol level, the client sends messages like `JOIN`, `ACTION`, `PING`, and the host responds with messages like `WELCOME`, `STATE_UPDATE`, and `PONG`.
