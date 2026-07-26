# Couch Kit Relay Server

A small, **game-agnostic** WebSocket relay that lets a cross-network browser
**display** (which owns the game runtime) exchange messages with **phones** in a
star topology, keyed by room code. It never inspects game payloads — it only
tracks room membership and routes opaque `DATA` envelopes.

- **Zero runtime dependencies** — just [Bun](https://bun.sh).
- **One deployment serves every game** you build. It is not per-game.
- **You deploy it; the SDK never points here by default.** The relay `url` is
  required config in `@couch-kit/client`'s `createRelayTransport` and in the
  display host. No consumer of the SDK is routed through anyone else's relay.

## Run locally

```bash
bun run start        # listens on :8787 (PORT env to override)
bun run dev          # watch mode
bun test             # routing unit tests
```

`GET /healthz` returns `200 ok` for health probes.

## Abuse mitigation

The relay is a public endpoint, so it bounds the blast radius of a hostile
client without any external dependency (all limits are in-memory, per process,
matching the single-instance model). Defaults are generous for party-game scale:

| Limit                          | Default | Env override             | On breach                                  |
| ------------------------------ | ------- | ------------------------ | ------------------------------------------ |
| Messages / connection / second | 30      | _(code: `messagesPerWindow`)_ | `RATE_LIMITED` error, then socket closed (`1008`) |
| Concurrent rooms               | 1000    | _(code: `maxRooms`)_     | `SERVER_BUSY` error on `CREATE_ROOM`       |
| Players per room               | 16      | _(code: `maxPlayersPerRoom`)_ | `ROOM_FULL` error on `JOIN_ROOM`      |
| Concurrent connections / IP    | 50      | `MAX_CONNECTIONS_PER_IP` | `429` on upgrade                           |
| Message size                   | 256 KiB | _(code: `MAX_MESSAGE_BYTES`)_ | `MESSAGE_TOO_LARGE` error             |

Set `ALLOWED_ORIGINS` (comma-separated) to reject WebSocket upgrades from other
origins with `403`; unset (the default) allows any origin, since displays run on
varying Vercel URLs. The rate/room/player limits are constructor options on
`RelayRooms` (see `DEFAULT_LIMITS`); the connection-per-IP cap and origin
allowlist are read from env in `server.ts`.

Room codes are chosen by the display, not the relay, so they are only as
unguessable as the client makes them; the per-connection rate limit plus
per-IP cap are what throttle brute-force `JOIN_ROOM` scanning. Server-generated
codes and auth tokens remain future work.

## Protocol (summary)

Clients speak JSON. `data` is an opaque Couch Kit message string.

| From    | Message                                   | Effect                                  |
| ------- | ----------------------------------------- | --------------------------------------- |
| display | `{type:"CREATE_ROOM", roomId}`            | creates room → `ROOM_CREATED`           |
| phone   | `{type:"JOIN_ROOM", roomId}`              | joins → `ROOM_JOINED` + host `PEER_JOINED` |
| phone   | `{type:"DATA", roomId, data}`             | → host as `{...,from:<peerId>}`          |
| display | `{type:"DATA", roomId, to, data}`         | → that player (unicast)                 |
| display | `{type:"DATA", roomId, data}`             | → all players (broadcast)               |

Message constants mirror `@couch-kit/client`'s `relay-protocol.ts`; they are
duplicated in `src/rooms.ts` to keep this service self-contained.

## Which relay should I run?

For a hosted, cross-network relay, prefer **[`../relay-worker`](../relay-worker)**
— Cloudflare Workers + Durable Objects, one object per room. That is what Couch
Kit itself runs. It has no single-replica ceiling, deploys without dropping live
games, and hibernates when idle.

This Bun server remains the **reference implementation and the self-host / LAN
option**: one process, zero dependencies, easy to read and to run anywhere.

## Self-hosting this server

```bash
docker build -t couch-kit-relay .
docker run -p 8787:8787 couch-kit-relay
```

Notes:

- **Run exactly one instance.** Rooms live in memory, so the process must stay
  warm (no scale-to-zero) and must not be replicated — multiple replicas would
  split rooms across processes. A backplane is future work; the Durable Object
  relay sidesteps this entirely by giving each room its own object.
- Ensure your ingress passes WebSocket upgrades through.
- Point your display + phones at `wss://<host>` via the relay `url`.

Any container host works (Fly, Railway, App Service for Containers, …).
