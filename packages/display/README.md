# @couch-kit/display

Browser **display host** for cross-network Couch Kit games. It owns the
authoritative `GameHostRuntime` — exactly like the React Native
`GameHostProvider` does on an Android TV — but bridges the runtime to a shared,
game-agnostic [relay server](https://github.com/faluciano/react-native-couch-kit/tree/main/services/relay)
instead of a local LAN WebSocket. That lets phones on **different networks** join
a game hosted in a browser tab.

```
 phone ─┐                       ┌─ RelayDisplayHost (owns the runtime)
 phone ─┼─ WebSocket ─▶ relay ◀─┘        browser display tab
 phone ─┘             (you deploy it)
```

- The display owns the game; the relay only routes opaque envelopes by room code,
  so **one relay deployment serves every game** you build.
- Framework-agnostic (no React dependency): subscribe with `subscribe` /
  `getState` from any UI, e.g. React's `useSyncExternalStore`.

## Install

```bash
bun add @couch-kit/display @couch-kit/core @couch-kit/runtime @couch-kit/client
```

## Usage

```ts
import { RelayDisplayHost } from "@couch-kit/display";
import { gameReducer, initialState } from "./shared"; // shared with the controller

const display = new RelayDisplayHost({
  url: "wss://your-relay.example.com", // YOUR relay — see note below
  roomId: "ABCD",
  reducer: gameReducer,
  initialState,
});

// Render whenever authoritative state changes.
display.subscribe(() => render(display.getState()));
```

Phones connect to the same room with the client's relay transport:

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

## API

`new RelayDisplayHost(options)` — `options` is the game's
`GameHostRuntimeConfig` (`reducer`, `initialState`, and the usual runtime knobs)
plus the relay coordinates:

| Option      | Description                                    |
| ----------- | ---------------------------------------------- |
| `url`       | WebSocket URL of **your** relay server         |
| `roomId`    | Room code phones use to reach this display     |
| `reducer`   | The shared game reducer                        |
| `initialState` | The shared initial state                    |

Instance methods:

- `getState()` — current authoritative state.
- `subscribe(listener)` — subscribe to state changes; returns an unsubscribe fn.
- `dispatch(action)` — dispatch a trusted host-side action.
- `stop()` — tear down the runtime and close the relay socket.

The host maps relay `PEER_JOINED` / `DATA` / `PEER_LEFT` to the runtime's
`handleConnection` / `handleMessage` / `handleDisconnect`, and implements the
runtime's transport by wrapping outbound messages in relay `DATA` envelopes
(unicast when addressed, room broadcast otherwise). Inbound phone messages are
size-bounded (`DEFAULT_MAX_MESSAGE_BYTES`) before parsing.

## Deploy your own relay — the SDK never points at anyone else's

The relay `url` is **required config with no default**. Couch Kit ships the relay
as *source you deploy yourself*
([`services/relay`](https://github.com/faluciano/react-native-couch-kit/tree/main/services/relay)),
not a hosted service. Every game you build points at the relay **you** deploy;
nobody consuming this SDK is routed through another developer's infrastructure.
One relay deployment can serve all of your games — it is game-agnostic and keyed
only by room code.
