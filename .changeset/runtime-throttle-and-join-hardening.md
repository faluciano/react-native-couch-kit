---
"@couch-kit/runtime": minor
---

Make state broadcasts a real throttle and harden JOIN handling.

- `BroadcastScheduler` no longer resets its timer on every change. It was a debounce: a host updating faster than `stateThrottleMs` sent nothing until the updates paused. The first change now opens a window and everything inside it is coalesced into one broadcast when the window closes.
- Projected games (`project`) no longer attach client actions to `STATE_UPDATE`. They leaked one player's action payload to every other player, which is what a projection exists to prevent.
- Actions that leave state unchanged are no longer queued for the next `STATE_UPDATE`, and the queue is capped. Previously they accumulated without bound until an unrelated change flushed them all.
- A JOIN whose socket closes while the player ID is being derived no longer touches session state. It used to cancel the player's pending removal (leaving a disconnected ghost forever) and could orphan their live connection. `HostSessionManager` gains `derivePlayerIdFor` and `registerJoin` for this; `handleJoin` is unchanged.
- JOIN fields are sanitized: the name is trimmed, capped at 64 characters and never blank; an avatar that is not a string of at most 16 KiB is dropped (the avatar is re-sent on every state update). A non-string `avatar` is rejected as `INVALID_MESSAGE`. New exports: `sanitizePlayerName`, `sanitizePlayerAvatar`, `MAX_PLAYER_NAME_LENGTH`, `MAX_PLAYER_AVATAR_LENGTH`, `DEFAULT_PLAYER_NAME`.
