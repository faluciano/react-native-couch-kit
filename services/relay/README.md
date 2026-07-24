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

## Deploy to Azure Container Apps

```bash
# From this directory:
az acr build --registry <yourRegistry> --image couch-kit-relay:latest .

az containerapp create \
  --name couch-kit-relay \
  --resource-group <rg> \
  --environment <env> \
  --image <yourRegistry>.azurecr.io/couch-kit-relay:latest \
  --target-port 8787 \
  --ingress external \
  --transport auto \
  --min-replicas 1 \
  --max-replicas 1
```

Notes:

- **`--min-replicas 1`**: rooms live in memory, so the instance must stay warm
  (no scale-to-zero) and, for this first slice, run as a **single instance**.
  Multiple replicas would split rooms across processes — a Redis/Azure Web PubSub
  backplane is future work.
- **`--transport auto`** keeps WebSocket upgrades working through the ingress.
- Point your display + phones at `wss://<app-fqdn>` via the relay `url`.

Any container host works (App Service for Containers, Fly, Railway, …); Azure is
the reference here.
