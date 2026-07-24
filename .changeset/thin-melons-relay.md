---
"@couch-kit/client": minor
---

**New features**

Add an injectable client transport so the web controller can connect over
transports other than the default LAN WebSocket. `useGameClient` now accepts a
`createTransport` factory, and the package exports a `ClientTransport` interface
plus `createWebSocketTransport` (the default).

Ship a cross-network relay transport (`createRelayTransport`) and the shared
relay wire protocol, enabling a hosted browser display to reach phones across
networks through a game-agnostic relay server. The default WebSocket behavior is
unchanged and fully backward compatible.
