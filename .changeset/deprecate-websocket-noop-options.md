---
"@couch-kit/host": patch
---

Mark the unused `WebSocketConfig` options (`maxFrameSize`, `keepaliveInterval`, `keepaliveTimeout`) as `@deprecated`. These have no effect — the nitro-http WebSocket transport does not expose these knobs, and the server only honors `port` and `debug`. The deprecated fields are retained for backward compatibility and will be removed in a future major release. Application-level heartbeats continue to be handled by the host PING/PONG protocol.
