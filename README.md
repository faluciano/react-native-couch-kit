# 🎮 React Native Party Kit

Turn an Android TV / Fire TV into a local party-game console and use phones as web controllers.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-green.svg)

---

## ✨ Features

- **Local-first:** TV runs HTTP (controller) + WebSocket (game) on your LAN.
- **TV-as-server:** Single source of truth lives on the TV.
- **Shared reducer:** One reducer shared between host + controller.
- **Time sync + preloading:** Helpers for timing-sensitive games and heavy assets.
- **Dev workflow:** Iterate on the controller without constantly rebuilding the TV app.

## How It Works

- TV runs a static file server (default `:8080`) and a WebSocket game server (default `:8082`).
- Phones open the controller page, connect via WebSocket, send actions, and receive state updates.

## Prerequisites / Supported

- **Devices:** Android TV / Fire TV (host). Phones run any modern mobile browser (client).
- **Network:** TV + phones on the same LAN/Wi-Fi. This is not an internet relay.
- **Ports:** `8080` (HTTP) and `8082` (WebSocket) reachable on the LAN (configurable).
- **Native deps:** `@party-kit/host` uses React Native native modules; it is not a pure-JS package.

## Non-goals

- Internet matchmaking / relay servers
- Anti-cheat, account systems, payments
- Hard security guarantees on untrusted networks

---

## 🚀 Usage Guide (Published Library)

> **Starter Project:** The fastest way to get started is to clone the [Buzz](https://github.com/faluciano/buzz-tv-party-game) starter project — a fully working buzzer game that demonstrates the complete `@party-kit` setup (shared reducer, TV host, phone controller, build pipeline). Use it as a starting point for your own game.

This guide assumes you are using the published `@party-kit/*` packages from npm.

### 1. Installation

Create a new project and install the library:

```bash
# Initialize a new repository
mkdir my-party-game
cd my-party-game
bun init

# For the TV App (Host)
bun add @party-kit/host @party-kit/core
```

If you are setting up the Web Controller manually (instead of using the CLI in Step 4):

```bash
# For the Web Controller (Client)
bun add @party-kit/client @party-kit/core
```

### 2. The Game Logic (Shared)

Define your game state and actions in a shared file (e.g., `shared/types.ts`). This ensures both your TV Host and Web Controller agree on the rules.

```typescript
import { IGameState, IAction } from "@party-kit/core";

export interface GameState extends IGameState {
  score: number;
}

// Party Kit reserves a few action types for system-level behavior.
// Your reducer must handle these if you want full state sync.
export type GameAction =
  | { type: "BUZZ" }
  | { type: "RESET" }
  | { type: "HYDRATE"; payload: GameState }
  | {
      type: "PLAYER_JOINED";
      payload: { id: string; name: string; avatar?: string; secret?: string };
    }
  | { type: "PLAYER_LEFT"; payload: { playerId: string } };

export const initialState: GameState = {
  status: "lobby",
  players: {}, // Managed automatically
  score: 0,
};

export const gameReducer = (
  state: GameState,
  action: GameAction,
): GameState => {
  switch (action.type) {
    case "HYDRATE":
      // Full state replacement from the host.
      return action.payload;
    case "PLAYER_JOINED":
      return {
        ...state,
        players: {
          ...state.players,
          [action.payload.id]: {
            id: action.payload.id,
            name: action.payload.name,
            avatar: action.payload.avatar,
            isHost: false,
            connected: true,
          },
        },
      };
    case "PLAYER_LEFT": {
      const { [action.payload.playerId]: _removed, ...rest } = state.players;
      return { ...state, players: rest };
    }
    case "BUZZ":
      return { ...state, score: state.score + 1 };
    case "RESET":
      return { ...state, score: 0 };
    default:
      return state;
  }
};
```

### 3. The Host (TV App)

In your React Native TV app (using `react-native-tvos` or Expo with TV config):

```tsx
import { GameHostProvider, useGameHost } from "@party-kit/host";
import { gameReducer, initialState } from "./shared/types";
import { Text, View } from "react-native";

export default function App() {
  return (
    <GameHostProvider config={{ reducer: gameReducer, initialState }}>
      <GameScreen />
    </GameHostProvider>
  );
}
```

> **Tip:** On Android, APK-bundled assets live inside a zip archive and cannot be served directly. Use the `staticDir` config option to point to a writable filesystem path where you've extracted the `www/` assets at runtime. See the [Buzz starter](https://github.com/faluciano/buzz-tv-party-game) for a working example with `useExtractAssets()`.

function GameScreen() {
  const { state, serverUrl, serverError } = useGameHost();

  return (
    <View>
      {serverError && <Text>Server error: {String(serverError.message)}</Text>}
      <Text>Open on phone: {serverUrl}</Text>
      <Text>Score: {state.score}</Text>
    </View>
  );
}
```

### 4. The Client (Web Controller)

Scaffold a web controller for players to run on their phones:

```bash
bunx party-kit init web-controller
```

In `web-controller/src/App.tsx`:

```tsx
import { useGameClient } from "@party-kit/client";
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
```

## Contracts (Read This Once)

- **System action types:** the runtime currently uses `HYDRATE`, `PLAYER_JOINED`, and `PLAYER_LEFT` as action types. Treat them as reserved and handle them in your reducer.
- **State updates:** the host broadcasts full state; the client applies it by dispatching `{ type: "HYDRATE", payload: newState }`.
- **Dev-mode WebSocket:** if the controller is served from your laptop (Vite), `useGameClient()` will try to connect WS to the laptop by default. In dev, pass `url: "ws://TV_IP:8082"`.

## Dev Workflow (Controller on Laptop)

On the TV host:

```tsx
<GameHostProvider
  config={{
    reducer: gameReducer,
    initialState,
    devMode: true,
    devServerUrl: "http://192.168.1.50:5173",
  }}
>
  <GameScreen />
</GameHostProvider>
```

On the controller (served from the laptop), explicitly point WS to the TV:

```ts
useGameClient({
  reducer: gameReducer,
  initialState,
  url: "ws://192.168.1.99:8082", // TV IP
});
```

---

## 🛠️ Contributing / Local Development

If you want to contribute to `react-native-party-kit` or test changes locally before they are published, follow these steps.

### 1. Setup the Monorepo

Clone the repository and install dependencies:

```bash
git clone <this-repo>
cd react-native-party-kit
bun install
```

### 2. Building the Libraries

The packages (`host`, `client`, `core`, `cli`) are located in `packages/*`. You can build them all at once:

```bash
bun run build
```

Or individually:

```bash
bun run --filter @party-kit/host build
```

### 3. Testing in a Real App (Yalc)

To test your local changes in a real React Native app, we recommend using `yalc`. It simulates a published package by copying build artifacts directly into your project, avoiding common Metro Bundler symlink issues.

**First, publish local versions:**

```bash
# In the root of react-native-party-kit
bun global add yalc
bun run build

# Publish each package to local yalc registry
cd packages/core && yalc publish
cd ../client && yalc publish
cd ../host && yalc publish
```

**Then, link them in your consumer app:**

```bash
cd ../my-party-game
yalc add @party-kit/core @party-kit/client @party-kit/host
bun install
```

> **Note:** We do not use the `--link` flag. Keeping the default `file:` protocol ensures files are copied _inside_ your project root, which allows Metro Bundler to watch them correctly without extra configuration.

**Iterating:**

When you make changes to the library:

1. Run `bun run build` in the library repo.
2. Run `yalc push` in the modified package folder (e.g., `packages/host`).
3. Your game app should hot-reload automatically.

**Troubleshooting:**

- **Duplicate React / Invalid Hook Call:** Ensure your library packages treat `react` as a `peerDependency` and do not bundle it. `yalc` handles this correctly by default.
- **Changes not showing up?** If you add new files or exports, Metro might get stuck. Stop the bundler and run:
  ```bash
  bun start --reset-cache
  ```

---

## 📦 Architecture

| Package                 | Purpose                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **`@party-kit/host`**   | Runs on the TV. Manages WebSocket server, serves static files, and holds the "True" state. |
| **`@party-kit/client`** | Runs on the phone browser. Connects to the host and renders the controller UI.             |
| **`@party-kit/core`**   | Shared TypeScript types and protocol definitions.                                          |
| **`@party-kit/cli`**    | Tools to bundle the web controller into the Android app.                                   |

## 📚 Documentation

- [Host Documentation](./packages/host/README.md)
- [Client Documentation](./packages/client/README.md)
- [Core Documentation](./packages/core/README.md)
- [CLI Documentation](./packages/cli/README.md)

## Troubleshooting

- Phone can’t open the controller page: confirm TV and phone are on the same Wi‑Fi; verify `serverUrl` is not null.
- Phone opens page but actions do nothing: ensure your reducer handles `HYDRATE` (state sync) and the host isn’t erroring.
- Dev mode WS fails: pass `url: "ws://TV_IP:8082"` to `useGameClient()`.
- Connection is flaky: enable `debug` in host/client and watch logs; keep the TV from sleeping.

## Security Notes

- The controller URL is reachable to anyone on the same LAN. Don’t run this on untrusted Wi‑Fi.
- `JOIN` supports an optional `secret` field (protocol-level). Enforcement is up to your game/host logic.
