---
"@couch-kit/runtime": minor
---

Bound the host's replies to a flooding client, stop broadcasting to sockets that never joined, and publish every reduced action.

- The per-connection rate limit (60 per second) now counts every inbound message, not just actions. Pings, malformed frames and forbidden actions each cost the host a reply, and none of them were limited. Only the first message over the limit gets a `RATE_LIMITED` error; the rest of that second is dropped silently. Before, every rejected action earned its own error, so a client could make the host send as fast as it received. Over the relay those replies count against the display's own budget, and when the relay closes the display the room ends. `RateLimitResult` gains `firstRejection`.
- `GameRuntimeTransport.broadcast` receives a second argument, `recipients`: the connections that have completed a JOIN. Transports that address sockets themselves should send to those only. Nothing is broadcast while nobody has joined. Existing one-argument implementations still type-check.
- New `subscribeActions(listener)`: every action the runtime reduces, in order, whatever its source (host dispatches, player actions stamped with `playerId`, and `__PLAYER_JOINED__` and the other lifecycle actions) and whether or not it changed state. A throwing listener is reported through `onError`. New type: `RuntimeActionListener`.
