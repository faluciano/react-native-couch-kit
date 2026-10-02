---
"@couch-kit/display": minor
---

**New features:** `RelayDisplayHost` takes its room back after a dropped relay connection. It used to lose the room on any drop.

When the display's network blinks, it moves to the new `reconnecting` status. It reconnects with backoff and claims the room with the resume token the relay issued at creation. Phones stay connected throughout and the room code does not change. On success it:

- disconnects phones that left while it was away
- connects phones that arrived, whose held JOINs follow
- re-sends the current state to everyone

The room ends, as before, if:

- the relay's 30-second grace period runs out
- the relay no longer has the room
- the relay closed the display on purpose
- the relay predates resumption

Set `resume: false` to end the room on any drop. `stop()` now closes with code 1000, so the relay ends the room at once rather than holding it.

**Migration:** `RelayDisplayStatus` gains `"reconnecting"`. An exhaustive `switch` over it needs a new case.
