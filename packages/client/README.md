# @couch-kit/client

The client-side library for the web controller. Designed to be lightweight and framework-agnostic (though React hooks are provided).

## Features

- **Default connection:** By default, connects to `ws(s)://{window.location.hostname}:8082`.
- **Time synchronization:** `useServerTime()` helps estimate server time using periodic ping/pong.
- **Asset preloading:** `usePreload()` is a small helper for preloading images and fetching other URLs.
- **Optimistic UI:** State updates apply locally immediately while being sent to the server.
- **Reconnection attempts:** Automatically retries the WebSocket connection when it drops.
- **Session Recovery:** Persists a secret in local storage to recover the same player session after a page refresh.

## Installation

```bash
bun add @couch-kit/client
```

## API

### `useGameClient(config)`

Connects the controller to the TV host WebSocket, applies state updates, and provides an action sender.

Config:

- `reducer`: `(state, action) => state` (your shared reducer)
- `initialState`: initial state used until the host hydrates
- `url?`: explicit WebSocket URL. If omitted, the hook uses `ws(s)://{window.location.hostname}:8082`.
- `wsPort?`: WebSocket port override (default: auto-detected from page URL using HTTP port + 2)
- `name?`: player display name (default: `"Player"`)
- `avatar?`: player avatar emoji (default: `"\u{1F600}"`)
- `maxRetries?`: maximum reconnection attempts before giving up (default: `5`)
- `baseDelay?`: base delay in ms for exponential backoff reconnection (default: `1000`)
- `maxDelay?`: maximum delay in ms cap for reconnection backoff (default: `10000`)
- `debug?`: enable console logs
- `onConnect?`, `onDisconnect?`: lifecycle callbacks

Returns:

- `status`: `'connecting' | 'connected' | 'disconnected' | 'error'`
- `state`: current controller state (optimistic + hydrated)
- `playerId`: stable public identifier derived from the session secret. Persists across page refreshes and reconnections (the same player always gets the same `playerId`).
- `sendAction(action)`: optimistic dispatch + send to host
- `getServerTime()`: NTP-ish server time based on periodic ping/pong
- `rtt`: round-trip time (ms) to the server, updated periodically via PING/PONG
- `disconnect()`: manually disconnect from the host (prevents automatic reconnection)
- `reconnect()`: manually reconnect to the host (resets the reconnection attempt counter)

## State Sync Contract

The host broadcasts full state snapshots. The client automatically applies them using a higher-order reducer wrapper.

**You do NOT need to handle `HYDRATE` manually in your reducer.** The library now handles this automatically by intercepting the hydration action before it reaches your reducer logic.

Just write your reducer as if it were local:

```ts
function reducer(state, action) {
  switch (action.type) {
    case "SCORE":
      return { ...state, score: state.score + 1 };
    default:
      return state;
  }
}
```

## Dev Mode (Controller Served From Laptop)

If your controller is served from your laptop (Vite), `window.location.hostname` is the laptop, so the “magic connection” will try to connect WS to the laptop.

In dev, pass the TV WebSocket URL explicitly:

```ts
useGameClient({
  reducer,
  initialState,
  url: "ws://TV_IP:8082",
});
```

## Usage

### 1. The Main Hook

The `useGameClient` hook manages the WebSocket connection and synchronizes state with the TV.

```tsx
import { useGameClient } from "@couch-kit/client";
import { gameReducer, initialState } from "./shared/types";

export default function Controller() {
  const {
    status, // 'connecting' | 'connected' | 'disconnected' | 'error'
    state, // The current game state (synced with Host)
    playerId, // Stable identifier, persists across reconnections
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

For rhythm games or precise countdowns, use `getServerTime()` from the `useGameClient` return value instead of `Date.now()`. This accounts for network latency.

```tsx
import { useGameClient } from "@couch-kit/client";
import { gameReducer, initialState } from "./shared/types";

function Controller({ targetTimestamp }) {
  const { state, sendAction, getServerTime } = useGameClient({
    reducer: gameReducer,
    initialState,
  });

  // Calculate seconds remaining based on SERVER time
  const now = getServerTime();
  const remaining = Math.max(0, targetTimestamp - now);

  return <div>{Math.ceil(remaining / 1000)}s</div>;
}
```

### 3. Asset Preloading

Ensure heavy assets (images, sounds) are fully loaded before showing the game interface.

```tsx
import { usePreload } from "@couch-kit/client";

const ASSETS = ["/images/avatar_1.png", "/sounds/buzz.mp3"];

function App() {
  const { loaded, progress, failedAssets } = usePreload(ASSETS);

  if (!loaded) {
    return <div>Loading... {Math.round(progress)}%</div>;
  }

  return <GameController />;
}
```

## Notes / Limitations

- `usePreload()` preloads images via `Image()` and uses `fetch()` for other URLs; it does not currently send the protocol `ASSETS_LOADED` message. Failed assets are available via `failedAssets`.
