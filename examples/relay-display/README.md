# Relay Display Host (reference)

Framework-agnostic reference implementation of a **browser display host** for the
cross-network relay transport. It owns the authoritative `GameHostRuntime` (like
the React Native `GameHostProvider`) but bridges it to a shared, game-agnostic
[relay server](../../services/relay) instead of a local WebSocket server.

This is reference glue intended to graduate into a `@couch-kit/display` package.

## Usage

```ts
import { RelayDisplayHost } from "./src";
import { gameReducer, initialState } from "./my-game"; // shared with the controller

const display = new RelayDisplayHost({
  url: "wss://your-relay.example.com", // YOUR relay — see note below
  roomId: "ABCD",
  reducer: gameReducer,
  initialState,
});

// Render whenever authoritative state changes.
display.subscribe(() => render(display.getState()));
```

Phones connect to the same room with the client:

```ts
import { createRelayTransport } from "@couch-kit/client";

useGameClient({
  reducer: gameReducer,
  initialState,
  createTransport: createRelayTransport({
    url: "wss://your-relay.example.com",
    roomId: "ABCD",
  }),
});
```

## Deploy your own relay — the SDK never points at anyone else's

The relay `url` is **required config with no default**. Couch Kit ships the relay
as *source you deploy yourself* (see [`services/relay`](../../services/relay)),
not a hosted service. Every game you build points at the relay **you** deploy;
nobody consuming this SDK is routed through another developer's infrastructure.
One relay deployment can serve all of your games — it is game-agnostic and keyed
only by room code.
