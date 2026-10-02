---
"@couch-kit/runtime": minor
---

New `resendState()`: schedules a state update to every joined connection as if the state had just changed. It is for a transport that may have lost updates, such as a relay connection that dropped and came back.
