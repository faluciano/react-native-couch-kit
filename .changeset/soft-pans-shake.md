---
"@couch-kit/client": patch
---

Room codes are now case-insensitive end to end.

A code created as `6DX8` could not be joined as `6dx8`: the Cloudflare relay
uppercased the code to route the connection to the right Durable Object, but the
room registry inside still keyed rooms by the raw string from the
`CREATE_ROOM` / `JOIN_ROOM` message. The join silently missed and the phone sat
on "connecting" forever.

Room codes get read off a TV and retyped or re-scanned, so case must not matter.
They are now canonicalised in one place — the routing core — which fixes both the
Bun relay and the Worker.
