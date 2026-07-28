---
"@couch-kit/runtime": minor
"@couch-kit/display": minor
"@couch-kit/client": minor
---

Send a projected state update as one relay frame instead of one per player

A game with a `project` function sends every player their own view, which meant
one WebSocket frame per player for every state change. Relays bill and
rate-limit per inbound frame, so a four-player table paid four messages for one
update and spent four of the display's 30-per-second budget.

`GameRuntimeTransport` gains an optional `sendMany(entries)`. When a transport
implements it, the runtime hands over the whole projected batch at once;
transports that do not — the LAN WebSocket path — keep receiving one `send` per
connection and are unaffected.

`RelayDisplayHost` implements it with a new `DATA_MULTI` envelope carrying a
peer-id-to-payload map, which the relay unpacks into ordinary `DATA` frames.
Phones need no update — nothing on the client side can tell a batched update
from a unicast one. If the combined frame would exceed the relay's 256KB
ceiling, the display falls back to individual frames rather than send something
the relay would drop.

Relays must be updated before displays: both bundled implementations
(`services/relay`, `services/relay-worker`) understand `DATA_MULTI`, and an
older relay answers it with `MALFORMED`. The type is host-only — a phone sending
it is rejected, so it cannot be used to reach another phone directly.
