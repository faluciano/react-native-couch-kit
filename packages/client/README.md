# @party-kit/client

The client-side library for the web controller. Designed to be lightweight and framework-agnostic (though React hooks are provided).

## Features

- **Magic Connection:** Automatically connects to the Host serving the page. No manual configuration needed.
- **Time Synchronization:** `useServerTime()` provides NTP-synced time for perfectly timed events.
- **Asset Preloading:** `usePreload()` blocks the game start until images/audio are ready.
- **Optimistic UI:** State updates apply locally immediately while being sent to the server.
- **Session Recovery:** Automatically reconnects and restores state if the screen turns off or the browser reloads.

## Installation

```bash
bun add @party-kit/client
```

## Usage

### 1. The Main Hook

The `useGameClient` hook manages the WebSocket connection and synchronizes state with the TV.

```tsx
import { useGameClient } from "@party-kit/client";
import { gameReducer, initialState } from "./shared/types";

export default function Controller() {
  const {
    status, // 'connecting' | 'connected' | 'disconnected'
    state, // The current game state (synced with Host)
    playerId, // Your unique session ID
    sendAction, // Function to send actions to Host
  } = useGameClient({
    reducer: gameReducer,
    initialState: initialState,
    onConnect: () => console.log("Joined the party!"),
    onDisconnect: () => console.log("Left the party!"),
  });

  if (status === "connecting") {
    return <div>Connecting to TV...</div>;
  }

  return (
    <div className="controller">
      <h1>Score: {state.score}</h1>
      <button onClick={() => sendAction({ type: "JUMP" })}>JUMP!</button>
    </div>
  );
}
```

### 2. Time Synchronization

For rhythm games or precise countdowns, use `getServerTime()` instead of `Date.now()`. This accounts for network latency.

```tsx
import { useServerTime } from "@party-kit/client";

function Countdown({ targetTimestamp }) {
  const { getServerTime } = useServerTime();

  // Calculate seconds remaining based on SERVER time
  const now = getServerTime();
  const remaining = Math.max(0, targetTimestamp - now);

  return <div>{Math.ceil(remaining / 1000)}s</div>;
}
```

### 3. Asset Preloading

Ensure heavy assets (images, sounds) are fully loaded before showing the game interface.

```tsx
import { usePreload } from "@party-kit/client";

const ASSETS = ["/images/avatar_1.png", "/sounds/buzz.mp3"];

function App() {
  const { loaded, progress } = usePreload(ASSETS);

  if (!loaded) {
    return <div>Loading... {Math.round(progress)}%</div>;
  }

  return <GameController />;
}
```
