---
"@couch-kit/host": minor
---

State updates reach only players who have joined, and `useActionRecorder` can record whole sessions.

- State updates go only to sockets that have completed a JOIN. A socket that connects to the LAN server and never identifies itself no longer receives game state. New `GameWebSocketServer.multicast(socketIds, data)` sends one serialization to a set of sockets.
- `useActionRecorder` accepts `{ source }`. Pass `useGameHost()` and it records every action the host reduces, including players' actions and join/leave lifecycle actions. Before, it only saw what was passed to `recordAction`, which on a host meant only the host's own dispatches, so a recording of a real game could not be replayed. `startRecording()` may then be called without a state. A stopped recording no longer accepts actions passed to `recordAction`.
- `useGameHost()` also returns `getState` and `subscribeActions`.
