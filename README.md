# 🎮 React Native Party Kit

**The de-facto framework for building premium local multiplayer games.**

Turn your Android TV (or Fire TV) into a game console and use smartphones as controllers. No dedicated servers, no complex networking code—just React.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-green.svg)

---

## ✨ Features

- **Invisible Networking:** Zero-config connection. Phones connect instantly by scanning a QR code. No IP addresses to type.
- **TV-as-Server:** The TV hosts both the game logic (WebSocket) and the controller website (HTTP). Offline capable.
- **Predictable State:** Game logic is a pure Reducer function shared between Host and Client.
- **Premium Polish:** Built-in NTP Time Sync, Asset Preloading, and Session Recovery.
- **Developer Experience:** Hot-reload your web controller while it's connected to the TV.

---

## 🚀 Usage Guide (Published Library)

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

export type GameAction = { type: "BUZZ" } | { type: "RESET" };

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

function GameScreen() {
  const { state, serverUrl } = useGameHost();

  return (
    <View>
      <Text>Scan to Join: {serverUrl}</Text>
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

---

## 🛠️ Contributing / Local Development

If you want to contribute to `react-native-party-kit` or test changes locally before they are published, follow these steps.

### 1. Setup the Monorepo

Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/react-native-party-kit.git
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
