# @couch-kit/runtime

Transport-neutral authoritative game runtime for Couch Kit hosts.

The runtime owns canonical game state, player sessions, action authorization,
rate limiting, and throttled state broadcasts. Platform packages provide the
connection transport, such as the React Native WebSocket host or a future
browser WebRTC host.

Most applications should use `@couch-kit/host` rather than constructing the
runtime directly.
