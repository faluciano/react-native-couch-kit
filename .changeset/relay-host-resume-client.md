---
"@couch-kit/client": minor
---

Relay protocol support for display resumption. `CreateRoomMessage` gains an optional `resumeToken` and `RoomCreatedMessage` carries one. New in this release:

- the `ROOM_RESUMED` message type (`RoomResumedMessage`, which lists the phones still in the room)
- the `RELAY_CLOSE_HOST_REPLACED` (4002) close code
- `RELAY_HOST_RESUME_GRACE_MS` (30 seconds)

Phones need no change. They stay connected while a display reconnects.
