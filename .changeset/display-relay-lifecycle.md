---
"@couch-kit/display": minor
---

Make `RelayDisplayHost` aware of its relay connection.

- New `status` (`connecting` → `open` → `closed`) and `onStatusChange` option. When the relay connection drops, every player is marked disconnected, the status becomes `closed`, and the loss is reported through `onError` — previously the display kept running with no sign that the room was gone.
- Nothing is written to a socket that is not open. A display that dispatched before the socket opened threw from the broadcast timer.
- Room broadcasts are skipped while no phone is in the room, saving a billed relay message per state change in an empty lobby.
- `stateThrottleMs` defaults to 50ms here (`DEFAULT_RELAY_STATE_THROTTLE_MS`) so a continuously updating game stays inside the relay's 30 messages/second limit, which closes the display's socket when exceeded.
- Relay errors reach `onError` as `RelayError` with the relay's `code`.
