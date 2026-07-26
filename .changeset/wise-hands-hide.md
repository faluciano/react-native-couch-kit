---
"@couch-kit/runtime": minor
"@couch-kit/client": minor
---

Hidden information can now be hidden for real: `GameHostRuntimeConfig` takes an
optional `project(state, playerId)` that narrows the authoritative state to what
one player may see.

Without it the runtime broadcasts the same state to everyone, so hiding a hand
depends on the client choosing not to look — any player could read opponents'
cards from devtools. With it, the data never reaches their device: the runtime
sends each connection its own projection, in `WELCOME`, `RECONNECTED`, and every
state update.

Games with no hidden information omit `project` and are unchanged — state is
still broadcast in one frame.

Because a projected client holds a *view* rather than the whole state, it cannot
run the game reducer, so `ClientConfig.reducer` is now optional. Omit it and the
client renders what the host sends (no optimistic updates); a round trip is
imperceptible for turn-based games, and it is what makes the guarantee real.
