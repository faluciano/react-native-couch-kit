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

> **Note:** This library includes native dependencies (`react-native-tcp-socket`, `react-native-fs`, etc.). React Native's autolinking will handle the setup for Android. Ensure your `android/build.gradle` is configured correctly if you encounter build issues.

## Compatibility

| Dependency                   | Minimum Version |
| ---------------------------- | --------------- |
| `react`                      | `>= 18.2.0`     |
| `react-native`               | `>= 0.72.0`     |
| `react-native-nitro-modules` | `>= 0.33.0`     |

## Usage

## API

### `<GameHostProvider config={...}>`

Config:

- `initialState`: initial host state
- `reducer`: `(state, action) => state` (shared reducer)
- `port?`: HTTP static server port (default `8080`)
- `wsPort?`: WebSocket game server port (default `8082`)
- `staticDir?`: absolute path to the directory of static files to serve. On Android, APK assets live inside a zip archive and cannot be served directly — use this to point to a writable filesystem path where you've extracted the `www/` assets at runtime. Defaults to `${RNFS.MainBundlePath}/www`.
- `devMode?`: if true, do not start the TV static file server; instead point phones at `devServerUrl`
- `devServerUrl?`: URL of your laptop dev server (e.g. `http://192.168.1.50:5173`)
- `debug?`: enable verbose logs

### `useGameHost()`

Returns:

- `state`: canonical host state
- `dispatch(action)`: dispatches an action into your reducer
- `serverUrl`: HTTP URL phones should open (or `devServerUrl` in dev mode)
- `serverError`: static server error (if startup fails)

## System Actions

The host automatically dispatches internal system actions (`__PLAYER_JOINED__`, `__PLAYER_LEFT__`, `__HYDRATE__`) into `createGameReducer`, which handles them for you. **You do not need to handle these in your reducer.**

Player tracking (`state.players`) is managed automatically:

- When a player joins, they are added to `state.players` with `connected: true`.
- When a player disconnects, they are marked as `connected: false`.

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
        devMode: true,
        devServerUrl: 'http://192.168.1.50:5173' // Your laptop's IP
    }}
>
```

The TV will now tell phones to load the controller from your laptop.

Important: when the controller is served from the laptop, the client-side hook cannot infer the TV WebSocket host from `window.location.hostname`. In dev mode, pass `url: "ws://TV_IP:8082"` to `useGameClient()`.

## Bundling / Assets

In production, the host serves static controller assets from `${RNFS.MainBundlePath}/www`.

The CLI `couch-kit bundle` copies your web build output into `android/app/src/main/assets/www` (default). Ensure your app packaging makes those assets available under the expected `www` folder.
