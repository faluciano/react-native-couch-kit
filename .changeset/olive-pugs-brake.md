---
"@couch-kit/client": minor
"@couch-kit/display": minor
---

Relay connections now address the room in the URL: the socket opens against
`<relayUrl>/r/<roomId>` instead of `<relayUrl>`, and the new `relayRoomUrl()`
helper builds it.

The `CREATE_ROOM` / `JOIN_ROOM` handshake is unchanged, so relays that hold
every room in one process (the Bun reference server in `services/relay`) ignore
the path and keep working. Putting the room in the URL lets a relay route a
connection *before* reading any frames, which is what per-room hosting — such as
a Cloudflare Durable Object — requires.

No consumer code changes: both `createRelayTransport` and `RelayDisplayHost`
already take `roomId`, and build the URL themselves.
