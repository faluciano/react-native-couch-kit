# @party-kit/host

The server-side library for React Native TV applications. This package turns your TV app into a local game server.

## Features

- **Dual-Port Architecture:**
  - **Port 8080:** Static File Server (serves the web controller).
  - **Port 8081:** WebSocket Game Server (handles real-time logic).
- **Smart Network Discovery:** Automatically finds the correct IP address (`wlan0`/`eth0`) to display in QR codes.
- **Game Loop:** Manages the canonical `IGameState` using a reducer.
- **Dev Mode:** Supports hot-reloading the web controller during development.
- **Debug Mode:** Optional logging for troubleshooting connection issues.

## Installation

```bash
bun add @party-kit/host react-native-fs react-native-network-info react-native-nitro-http-server react-native-tcp-socket
```

> **Note:** This library relies on several native modules. Ensure you have configured them correctly in your `android/build.gradle` and `ios/Podfile`.

## Usage

### 1. Configure the Provider

Wrap your root component (or the game screen) with `GameHostProvider`.

```tsx
import { GameHostProvider } from "@party-kit/host";
import { gameReducer, initialState } from "./shared/gameLogic";

export default function App() {
  return (
    <GameHostProvider
      config={{
        reducer: gameReducer,
        initialState: initialState,
        port: 8080, // Optional: HTTP port (default 8080)
        wsPort: 8081, // Optional: WebSocket port (default 8081)
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
import { useGameHost } from "@party-kit/host";
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

The TV will now tell phones to load the controller from your laptop, but the WebSocket connection will still go to the TV.
