---
"@couch-kit/client": minor
"@couch-kit/runtime": minor
"@couch-kit/display": patch
---

**New features:** `createAutoTransport({ relayUrl, roomId?, url?, wsPort? })` in `@couch-kit/client` lets one controller build work both on the TV's local network and through the relay.

- A room code, given or from `?room=` in the page URL, always selects the relay.
- A page served over `http:` from a local-network address (the TV host) selects the LAN socket at HTTP port + 2.
- Otherwise it returns `kind: "none"`, with reason `NEEDS_ROOM_CODE` or `NO_RELAY_URL`.

The result carries `kind` (to show "Local" vs "Room ABCD"), plus `createTransport` and `connectionKey` to pass to `useGameClient`. The relay URL is supplied by the app, typically from build config, so it never needs to come from the page URL. Also new: `isLocalNetworkHost(hostname)`. `CreateRoomMessage.roomId` is now optional, matching how displays ask the relay to pick a code.

`GameHostRuntime.stop()` no longer strands players. `GameHostProvider` stops and reuses the runtime on a StrictMode or Fast Refresh remount, and it used to leave every connected player marked `connected: true` forever. Players already waiting for removal were never removed. Now `stop()` marks live players disconnected. When a transport is attached again, those players and any pending removals get a fresh disconnect timeout, and a player who rejoins first is kept. A final `stop()` leaves no timers running. `HostSessionManager.clearRemovalTimers()` now returns the removals it cancelled.

`RelayDisplayHost` no longer sits at `connecting` forever when the relay refuses to create the room (`ROOM_EXISTS`, `SERVER_BUSY`). It closes the socket, moves to `closed`, and reports the `RelayError`. A room that ends is also no longer reported twice when its socket's close event follows.
