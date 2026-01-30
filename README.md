# 🎮 React Native Party Kit

**The de-facto framework for building premium local multiplayer games.**

Turn your Android TV (or Fire TV) into a game console and use smartphones as controllers. No dedicated servers, no complex networking code—just React.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-green.svg)

---

## ✨ Features

*   **Invisible Networking:** Zero-config connection. Phones connect instantly by scanning a QR code. No IP addresses to type.
*   **TV-as-Server:** The TV hosts both the game logic (WebSocket) and the controller website (HTTP). Offline capable.
*   **Predictable State:** Game logic is a pure Reducer function shared between Host and Client.
*   **Premium Polish:** Built-in NTP Time Sync, Asset Preloading, and Session Recovery.
*   **Developer Experience:** Hot-reload your web controller while it's connected to the TV.

---

## 🚀 Quick Start

> **Run the Example App:** Check out the complete "Buzzer" game reference implementation in [`apps/README.md`](./apps/README.md) to see the code in action!

### 1. Create a Project

```bash
# Initialize a new repository
mkdir my-party-game
cd my-party-game
bun init

# Install the kit
bun add react-native-party-kit
```

### 2. The Game Logic (Shared)

Define your game state and actions in a shared file (e.g., `shared/types.ts`):

```typescript
import { IGameState, IAction } from '@party-kit/core';

export interface GameState extends IGameState {
  score: number;
}

export type GameAction = 
  | { type: 'BUZZ' }
  | { type: 'RESET' };

export const initialState: GameState = {
  status: 'lobby',
  players: {}, // Managed automatically
  score: 0,
};

export const gameReducer = (state: GameState, action: GameAction): GameState => {
  switch (action.type) {
    case 'BUZZ':
      return { ...state, score: state.score + 1 };
    case 'RESET':
      return { ...state, score: 0 };
    default:
      return state;
  }
};
```

### 3. The Host (TV App)

In your React Native TV app:

```tsx
import { GameHostProvider, useGameHost } from '@party-kit/host';
import { gameReducer, initialState } from './shared/types';

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

Scaffold the web controller:

```bash
bunx party-kit init web-controller
```

In `web-controller/src/App.tsx`:

```tsx
import { useGameClient } from '@party-kit/client';
import { gameReducer, initialState } from '../../shared/types';

export default function Controller() {
  const { state, sendAction } = useGameClient({
    reducer: gameReducer,
    initialState
  });

  return (
    <button onClick={() => sendAction({ type: 'BUZZ' })}>
      BUZZ! (Score: {state.score})
    </button>
  );
}
```

---

## 📦 Architecture

| Package | Purpose |
|---------|---------|
| **`@party-kit/host`** | Runs on the TV. Manages WebSocket server, serves static files, and holds the "True" state. |
| **`@party-kit/client`** | Runs on the phone browser. Connects to the host and renders the controller UI. |
| **`@party-kit/core`** | Shared TypeScript types and protocol definitions. |
| **`@party-kit/cli`** | Tools to bundle the web controller into the Android app. |

## 🛠️ Development Workflow

1.  **Dev Mode:** Run your web controller on your laptop (`vite dev`).
2.  **Connect:** Configure the Host to proxy to your laptop:
    ```tsx
    <GameHostProvider config={{ devMode: true, devServerUrl: 'http://192.168.1.50:5173' }}>
    ```
3.  **Hot Reload:** Changes on your laptop appear instantly on your phone, which is connected to the TV game session.

## 📚 Documentation

*   [Host Documentation](./packages/host/README.md)
*   [Client Documentation](./packages/client/README.md)
*   [Core Documentation](./packages/core/README.md)
*   [CLI Documentation](./packages/cli/README.md)
