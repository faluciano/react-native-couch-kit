---
"@couch-kit/host": patch
---

**Security:** Cap the size of inbound client WebSocket messages.

The host now discards any inbound frame larger than a configurable limit
(default 256 KiB, via `maxMessageBytes`) before `JSON.parse`, bounding the
memory a single malicious LAN client can force the host to allocate. The
previous `maxFrameSize` option remains a documented no-op; this is a distinct
application-level guard with a real default.
