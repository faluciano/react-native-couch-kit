---
"@couch-kit/client": minor
---

**New features:** A phone can get out of the dead ends that used to need a page reload.

- `connectionKey` option. Changing it opens a fresh connection with the retry budget reset. With a relay, pass the room code: a phone that typed a wrong code (`ROOM_NOT_FOUND`, which is final) now connects as soon as the right code is entered. Retry the same code with `reconnect()`.
- `reconnectOnResume` (default `true`): when the page becomes visible again, is restored from the back/forward cache, or the browser comes back online, the client reconnects at once with a fresh retry budget. A phone that slept through its five retries used to stay disconnected. Final closes and `disconnect()` are not undone.
- `disconnectReason` now clears when a new connection starts, not when it opens.
- `sendAction` returns `true` if the action was sent and `false` when there is no open connection. An action that was not sent is no longer applied optimistically.
- New exported types `ClientStatus` and `UseGameClientResult`, and helpers `isRecoverableClose` and `sessionSecretKey`.

**Security:** The relay transport keeps a separate session secret per relay and room (`ClientTransport.sessionScope`, also settable as the `sessionScope` option). Anyone can open a relay room and share its link; with one secret per site, that room's display could collect a phone's secret and rejoin the player's real room as them. The LAN default is unchanged, so existing players keep their identity.
