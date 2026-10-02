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

| `onStatusChange` | Called when the relay connection changes: `connecting` → `open`, then `reconnecting` ↔ `open` across drops, and `closed` at the end |
| `resume`    | Take the room back after a dropped connection (default `true`). `false` ends the room on any drop |
| `onError`   | Receives runtime and relay errors; relay errors are `RelayError` with a `code` |
| `stateThrottleMs` | Minimum interval between state broadcasts. Defaults to 50ms here (not the LAN default of 33ms) so a continuously updating game stays inside the relay's per-connection rate limit |

Instance members:

- `getState()` — current authoritative state.
- `subscribe(listener)` — subscribe to state changes; returns an unsubscribe fn.
- `dispatch(action)` — dispatch a trusted host-side action.
- `status` — `connecting` until the relay confirms the room, then `open`;
  `reconnecting` while taking the room back after a drop; `closed` once the
  room is gone.
- `subscribeActions(listener)` — every action the runtime reduces, from any
  source; pass the host to `useActionRecorder({ source })` to record sessions.
- `stop()` — tear down the runtime and close the relay socket.

### When the relay connection drops

When the room is created the relay hands the display a resume token. If the
display's socket then dies without closing — the tab's network blinks — the
relay keeps the room for 30 seconds, phones stay connected, and what they send
is held for the display. Meanwhile the display host:

- moves to `status: "reconnecting"`, keeping every player as they were,
- reconnects with backoff and claims the room with its token,
- on success, disconnects phones that left while it was away, connects phones
  that arrived (their held JOINs follow), re-sends the current state to
  everyone, and returns to `open`. The room code does not change.

The room ends instead — the display marks every player `connected: false`,
moves to `status: "closed"`, and reports the loss through `onError` — when:

- the 30 seconds run out, or the relay no longer has the room (it restarted);
- the relay closed the display on purpose (a rate-limit breach);
- `resume: false` is set, or the relay predates resumption and issued no token.

The game state stays readable after `closed`, so the display can show what
happened rather than a board that silently stopped updating. Phones see
`disconnectReason: "HOST_LEFT"`, which `describeRelayError` turns into a
message for the join screen.

A page reload is not a drop: the browser closes the socket on purpose and the
game state is gone with the page, so the relay ends the room at once. So does
`stop()`.

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
