---
"@couch-kit/client": minor
---

Fix the `useGameClient` connection lifecycle and make optimistic updates self-correcting.

- Time sync now actually runs. The ping loop only started if the socket was already open when the hook first saw it, which it never was, so no `PING` was ever sent: `rtt` stayed `0` and `getServerTime()` returned the local clock. It now starts when the socket opens. Games that use neither can pass `timeSync: false` to skip the pings (on a relay each one is a billed message).
- No more duplicate connections. A socket closed by cleanup, `disconnect()` or `reconnect()` still fires its `close` event later; that event used to overwrite the new connection's status and schedule a second, parallel reconnect. This happened on every mount under React `StrictMode` and whenever `url`, `wsPort` or the retry options changed. Events from a replaced transport are now ignored.
- Optimistic updates no longer get stuck. The host stays silent when an action changes nothing, so an optimistic update it ignored stood forever. The client now falls back to the last host state if no update arrives within `optimisticTimeoutMs` (default 2000, `0` disables), and immediately on a host `ERROR`.
- New `onError` callback receives host rejections (`RATE_LIMITED`, `NOT_JOINED`, …), which were silently dropped before. `interpretHostMessage` now returns an `error` effect for `ERROR` messages.
- `disconnectReason` resets to `null` once a connection opens, as documented.
- A stored session secret the host would reject is replaced instead of reused, so a corrupted `ck_secret` no longer fails every JOIN.
- The relay transport reports a room whose display disconnected as a terminal `HOST_LEFT` close (new `RelayErrorCodes.HOST_LEFT`, `RELAY_CLOSE_HOST_LEFT`), and `describeRelayError` explains it.
