# @party-kit/client

The client-side library for the web controller. Designed to be lightweight and framework-agnostic (though React hooks are provided).

## Features

*   **Magic Connection:** Automatically connects to the Host serving the page. No config needed.
*   **Time Synchronization:** `useServerTime()` provides NTP-synced time for perfectly timed events.
*   **Asset Preloading:** `usePreload()` blocks the game start until images/audio are ready.
*   **Optimistic UI:** State updates apply locally immediately while being sent to the server.
*   **Session Recovery:** Automatically reconnects and restores state if the screen turns off.

## Installation

```bash
bun add @party-kit/client
```

## Usage

### 1. The Main Hook

The `useGameClient` hook manages the connection and state.

```tsx
import { useGameClient } from '@party-kit/client';
import { gameReducer, initialState } from './shared/types';

export default function Controller() {
  const { 
    status,      // 'connecting' | 'connected' | 'disconnected'
    state,       // The current game state (synced with Host)
    playerId,    // Your unique ID
    sendAction   // Function to send actions to Host
  } = useGameClient({
    reducer: gameReducer,
    initialState: initialState,
    onConnect: () => console.log('Joined!'),
    onDisconnect: () => console.log('Left!')
  });

  if (status === 'connecting') return <div>Connecting...</div>;

  return (
    <button onClick={() => sendAction({ type: 'JUMP' })}>
      JUMP!
    </button>
  );
}
```

### 2. Time Synchronization

For rhythm games or countdowns, use `getServerTime()` instead of `Date.now()`.

```tsx
import { useServerTime } from '@party-kit/client';

function Countdown({ targetTime }) {
  const { getServerTime } = useServerTime(socket);
  
  // Calculate seconds remaining based on SERVER time
  const remaining = Math.max(0, targetTime - getServerTime());
  
  return <div>{Math.ceil(remaining / 1000)}</div>;
}
```

### 3. Asset Preloading

Ensure heavy assets are loaded before showing the game interface.

```tsx
import { usePreload } from '@party-kit/client';

const ASSETS = [
  '/images/avatar_1.png',
  '/sounds/buzz.mp3'
];

function App() {
  const { loaded, progress } = usePreload(ASSETS);

  if (!loaded) {
    return <div>Loading... {progress}%</div>;
  }

  return <Game />;
}
```
