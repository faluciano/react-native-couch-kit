---
"@couch-kit/display": minor
---

`RelayDisplayHost` gains `subscribeActions(listener)`, the runtime's complete action stream: the display's own dispatches, players' actions, and join/leave lifecycle actions. State updates are no longer sent through the relay while no phone has joined the game.
