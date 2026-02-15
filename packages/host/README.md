# @couch-kit/host

The server-side library for React Native TV applications. This package turns your TV app into a local game server.

> **Looking for a working example?** Check out the [Buzz](https://github.com/faluciano/buzz-tv-party-game) starter project for a complete host setup including asset extraction, QR code display, and player tracking.

## Features

- **Dual-Port Architecture:**
  - **Port 8080:** Static File Server (serves the web controller).
  - **Port 8082:** WebSocket Game Server (handles real-time logic).
- **Session Recovery:** Tracks user secrets to support reconnection (handling page refreshes).
- **Large Message Support:** Capable of sending game states larger than 64KB (64-bit frame lengths).
- **Smart Network Discovery:** Uses the device IPv4 address for LAN URLs.
- **Game Loop:** Manages the canonical `IGameState` using a reducer.
- **Dev Mode:** Supports hot-reloading the web controller during development.
- **Debug Mode:** Optional logging for troubleshooting connection issues.

## Installation

```bash
bun add @couch-kit/host
```

Then install the required peer dependencies:

```bash
npx expo install expo-file-system expo-network
bun add react-native-tcp-socket react-native-nitro-modules
```

> **Note:** This library requires Expo modules (`expo-file-system`, `expo-network`), `react-native-tcp-socket`, and `react-native-nitro-modules` as peer dependencies. These must be installed in your consumer app. React Native's autolinking will handle native setup automatically.

## Compatibility

| Dependency                   | Minimum Version |
| ---------------------------- | --------------- |
| `react`                      | `>= 18.2.0`     |
| `react-native`               | `>= 0.72.0`     |
| `react-native-nitro-modules` | `>= 0.33.0`     |
| `expo`                       | `>= 51.0.0`     |
| `expo-file-system`           | `>= 17.0.0`     |
| `expo-network`               | `>= 7.0.0`      |
| `react-native-tcp-socket`    | `>= 6.0.0`      |

> **New Architecture:** This package supports React Native's New Architecture (Fabric/TurboModules) via React Native 0.83+.

## API

### `<GameHostProvider config={...}>`

Config:

- `initialState`: initial host state
- `reducer`: `(state, action) => state` (shared reducer)
- `port?`: HTTP static server port (default `8080`)
- `wsPort?`: WebSocket game server port (default `8082`)
- `staticDir?`: absolute path to the directory of static files to serve. **Required on Android** — APK assets live inside a zip archive and cannot be served directly, so use this to point to a writable filesystem path where you've extracted the `www/` assets at runtime. On iOS, defaults to the bundle directory + `/www`.
- `devMode?`: if true, do not start the TV static file server; instead point phones at `devServerUrl`
- `devServerUrl?`: URL of your laptop dev server (e.g. `http://192.168.1.50:5173`)
- `debug?`: enable verbose logs

### `useGameHost()`

Returns:

- `state`: canonical host state
- `dispatch(action)`: dispatches an action into your reducer
- `serverUrl`: HTTP URL phones should open (or `devServerUrl` in dev mode)
- `serverError`: static server error (if startup fails)

### `useExtractAssets(manifest)`

Extracts bundled web assets from the APK to a writable directory so the native HTTP server can serve them.

On Android, assets live inside the APK and cannot be served directly. This hook copies each file listed in the manifest from the APK to the device filesystem. On iOS, extraction is skipped since assets are accessible from the bundle directory.

```tsx
import { useExtractAssets } from "@couch-kit/host";
import manifest from "./www/manifest.json";

function App() {
  const { staticDir, loading, error } = useExtractAssets(manifest);

  if (loading) return <Text>Extracting assets...</Text>;
  if (error) return <Text>Error: {error}</Text>;

  return (
    <GameHostProvider config={{ staticDir, reducer, initialState }}>
      ...
    </GameHostProvider>
  );
}
```

| Property    | Type                  | Description                                       |
| ----------- | --------------------- | ------------------------------------------------- |
| `staticDir` | `string \| undefined` | Filesystem path to extracted assets, or undefined |
| `loading`   | `boolean`             | Whether extraction is in progress                 |
| `error`     | `string \| null`      | Error message if extraction failed                |

## System Actions

The host automatically dispatches internal system actions (`__PLAYER_JOINED__`, `__PLAYER_LEFT__`, `__PLAYER_RECONNECTED__`, `__PLAYER_REMOVED__`, `__HYDRATE__`) into `createGameReducer`, which handles them for you. **You do not need to handle these in your reducer.**

Player tracking (`state.players`) is managed automatically:

- When a player joins, they are added to `state.players` with `connected: true`.
- When a player disconnects, they are marked as `connected: false`.
- If a player reconnects from the same device/browser, they are automatically reassigned their previous player data via `__PLAYER_RECONNECTED__` (sets `connected: true`, preserves hand, score, etc.).
- If a disconnected player does not reconnect within the timeout window (default: 5 minutes), they are permanently removed from `state.players` via `__PLAYER_REMOVED__`.

Game logic that iterates over `state.players` should account for players being removed after the timeout.

To react to player events outside of state (e.g., logging, analytics), use the callback config options:

- `onPlayerJoined?: (playerId: string, name: string) => void` -- called when a player successfully joins.
- `onPlayerLeft?: (playerId: string) => void` -- called when a player disconnects.
- `onError?: (error: Error) => void` -- called when a server error occurs.

### 1. Configure the Provider

Wrap your root component (or the game screen) with `GameHostProvider`.

```tsx
import { GameHostProvider } from "@couch-kit/host";
import { gameReducer, initialState } from "./shared/gameLogic";

export default function App() {
  return (
    <GameHostProvider
      config={{
        reducer: gameReducer,
        initialState: initialState,
        port: 8080, // Optional: HTTP port (default 8080)
        wsPort: 8082, // Optional: WebSocket port (default 8082)
        debug: true, // Optional: Enable detailed logs
      }}
    >
      <GameScreen />
    </GameHostProvider>
  );
}
```

### 2. Access State & Actions

Use the `useGameHost` hook to access the game state, dispatch actions, and get the server URL (for QR codes).

```tsx
import { useGameHost } from "@couch-kit/host";
import QRCode from "react-native-qrcode-svg";
import { View, Text, Button } from "react-native";

function GameScreen() {
  const { state, dispatch, serverUrl } = useGameHost();

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      {state.status === "lobby" && (
        <>
          <Text style={{ fontSize: 24, marginBottom: 20 }}>Join the Game!</Text>
          {serverUrl && <QRCode value={serverUrl} size={200} />}
          <Text style={{ marginTop: 20 }}>Scan to connect</Text>
          <Text>Players Connected: {Object.keys(state.players).length}</Text>

          <Button
            title="Start Game"
            onPress={() => dispatch({ type: "START_GAME" })}
          />
        </>
      )}

      {state.status === "playing" && (
        <Text style={{ fontSize: 40 }}>Current Score: {state.score}</Text>
      )}
    </View>
  );
}
```

## Development Mode

To iterate on your web controller without rebuilding the Android app constantly:

1.  Start your web project locally (`vite dev` usually runs on `localhost:5173`).
2.  Configure the Host to point to your laptop:

```tsx
<GameHostProvider
    config={{
        reducer: gameReducer,
        initialState,
        devMode: true,
        devServerUrl: 'http://192.168.1.50:5173' // Your laptop's IP
    }}
>
```

The TV will now tell phones to load the controller from your laptop.

Important: when the controller is served from the laptop, the client-side hook cannot infer the TV WebSocket host from `window.location.hostname`. In dev mode, pass `url: "ws://TV_IP:8082"` to `useGameClient()`.

## Bundling / Assets

In production, the host serves static controller assets from the iOS bundle directory + `/www` by default. On Android, `staticDir` must be provided since bundle assets live inside the APK.

The CLI `couch-kit bundle` copies your web build output into `android/app/src/main/assets/www` (default). Ensure your app packaging makes those assets available under the expected `www` folder.
