---
"@couch-kit/client": minor
---

Relay clients can now tell players *why* a join failed, and ask for a room code
when they don't have one.

A hosted controller opened without `?room=` has no LAN host to fall back to, so
it could only sit on "connecting" forever — and a wrong or expired code looked
exactly the same. Two additions fix that:

- `useGameClient` returns `disconnectReason`, carrying the relay's error code
  (`ROOM_NOT_FOUND`, `ROOM_FULL`, …) for terminal failures. Previously the
  transport collapsed these to an unexplained close.
- New `useRelayRoom()` tracks the room from `?room=CODE` and lets the app set one
  (updating the URL so reloads and shared links keep it), plus
  `normalizeRoomCode()` and `describeRelayError()` for the entry UI.

Games stay in control of rendering; the SDK supplies the state and the wording.
