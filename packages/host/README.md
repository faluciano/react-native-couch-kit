# @party-kit/host

The server-side library for React Native TV applications. This package turns your TV app into a local game server.

## Features

*   **Dual-Port Architecture:**
    *   **Port 8080:** Static File Server (serves the web controller).
    *   **Port 8081:** WebSocket Game Server (handles real-time logic).
*   **Smart Network Discovery:** Automatically finds the correct IP address (`wlan0`/`eth0`) to display in QR codes.
*   **Game Loop:** Manages the canonical `IGameState` using a reducer.
*   **Dev Mode:** Supports hot-reloading the web controller during development.

## Installation

```bash
bun add @party-kit/host react-native-static-server react-native-tcp-socket react-native-network-info react-native-fs
```

## Usage

### 1. Configure the Provider

Wrap your root component (or the game screen) with `GameHostProvider`.

```tsx
import { GameHostProvider } from '@party-kit/host';
import { gameReducer, initialState } from './gameLogic';

export default function App() {
  return (
    <GameHostProvider 
        config={{ 
            reducer: gameReducer, 
            initialState: initialState,
            port: 8080,    // Optional: HTTP port
            wsPort: 8081,  // Optional: WebSocket port
            debug: true    // Optional: Log messages
        }}
    >
      <GameScreen />
    </GameHostProvider>
  );
}
```

### 2. Access State & Actions

Use the `useGameHost` hook to access the game state and dispatch actions.

```tsx
import { useGameHost } from '@party-kit/host';
import QRCode from 'react-native-qrcode-svg';

function GameScreen() {
  const { state, dispatch, serverUrl } = useGameHost();

  return (
    <View style={styles.container}>
      {state.status === 'lobby' && (
        <>
          <Text>Join the Game!</Text>
          {serverUrl && <QRCode value={serverUrl} size={200} />}
          <Text>Players: {Object.keys(state.players).length}</Text>
          
          <Button 
            title="Start Game" 
            onPress={() => dispatch({ type: 'START_GAME' })} 
          />
        </>
      )}
      
      {state.status === 'playing' && (
        <Text>Current Score: {state.score}</Text>
      )}
    </View>
  );
}
```

## Development Mode

To iterate on your web controller without rebuilding the Android app constantly:

1.  Start your web project locally (`vite dev` runs on `localhost:5173`).
2.  Configure the Host to point to your laptop:

```tsx
<GameHostProvider 
    config={{ 
        devMode: true, 
        devServerUrl: 'http://YOUR_LAPTOP_IP:5173' 
    }}
>
```

The TV will now tell phones to load the controller from your laptop, but the WebSocket connection will still go to the TV.
