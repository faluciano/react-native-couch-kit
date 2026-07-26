---
"@couch-kit/display": minor
"@couch-kit/client": minor
---

Let the relay assign room codes

`RelayDisplayHost`'s `roomId` is now optional. Omit it and the relay mints an
unused six-character code, reported through the new `onRoomCode` callback and
the `roomCode` getter.

A display could never check its own code for collisions — only the relay knows
which codes are live — so a self-chosen code could land on a game already in
progress, and did so only after it was on screen. Minted codes are drawn from
the CSPRNG over a 32-character alphabet without `O`/`0` or `I`/`1`, giving about
1.07 billion codes.

Existing callers that pass `roomId` keep their current behaviour, including
`ROOM_EXISTS` when the code is taken. New callers should expect the code to
arrive one round trip after connecting rather than being known up front:

```ts
const [roomCode, setRoomCode] = useState<string | null>(null);
new RelayDisplayHost({ url, onRoomCode: setRoomCode, reducer, initialState });
```

Relays need a matching update to mint: both bundled implementations
(`services/relay`, `services/relay-worker`) support it. A display that omits
`roomId` against an older relay gets `MALFORMED`.
