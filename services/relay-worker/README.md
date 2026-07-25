# Couch Kit relay — Cloudflare Workers + Durable Objects

The game-agnostic relay, with **one Durable Object per room**.

It shares its routing core (`../relay/src/rooms.ts`) with the Bun reference
server, so both speak an identical wire protocol. This deployment differs only
in how rooms are hosted:

| | Bun relay (`../relay`) | This Worker |
| --- | --- | --- |
| Rooms | all in one process | one Durable Object each |
| Replicas | exactly 1, forever | not a concept |
| Deploy | restarts the process, drops live games | rolls out per script version |
| Idle cost | a container sitting there | none — objects hibernate |

Hibernation is safe here because the relay holds no game state: the browser
display owns the game. A room object only knows who is in it, and that is
rebuilt from the sockets themselves on wake (`RelayRooms.restore`).

## Room addressing

Clients connect to `wss://<host>/r/<ROOM>`. The room has to be in the URL
because a Durable Object must be addressed *before* any frame is read — the
`CREATE_ROOM` / `JOIN_ROOM` handshake still follows, unchanged, so the Bun relay
(which ignores the path) accepts the same clients.

Room codes are case-insensitive; `RelayRooms` canonicalises them.

## Local development

No Cloudflare account needed — `wrangler dev` runs the real runtime locally:

```bash
npm install
npx wrangler dev --local     # http://localhost:8787
```

## Deployment

Automatic: pushing to `main` under `services/relay-worker/**` (or the shared
`rooms.ts`) runs `.github/workflows/deploy-relay-cf.yml`, which tests the core,
typechecks, deploys, and then health-checks the live URL.

Manual, if you need it:

```bash
npx wrangler deploy
```

### Required repository secrets

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |
