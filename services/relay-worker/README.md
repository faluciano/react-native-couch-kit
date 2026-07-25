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
bun install
bunx wrangler dev --local    # http://localhost:8787
```

## Deployment

Deploys run through **Workers Builds**, Cloudflare's native Git integration:
Cloudflare watches the repository and builds on push, authenticating through its
GitHub App. There is **no API token and no deploy secret in GitHub** — nothing
long-lived to leak or rotate, and no credential in CI at all.

CI still gates quality: the `relay` job in `.github/workflows/ci.yml` runs the
routing-core tests and typechecks the Worker on every PR.

### One-time setup

In the Cloudflare dashboard, under **Workers & Pages → couch-kit-relay →
Settings → Build**:

1. **Connect** the `faluciano/react-native-couch-kit` repository (authorizes the
   Cloudflare GitHub App).
2. Set **root directory** to `services/relay-worker`.
3. Set the production **branch** to `main`.
4. Leave the build and deploy commands at their defaults (`bun run build` and
   `bunx wrangler deploy`). `build` is wired to `tsc --noEmit`, so a type error
   fails the build before anything deploys.

Cloudflare's build image picks the package manager from the lockfile, and this
package ships a `bun.lock` — the same toolchain as the rest of the repo. If a
build ever reports `bun: not found`, the image failed to detect it; `npm` works
as a fallback.

After that, every push to `main` that touches this Worker deploys itself, and
pull requests get build status reported back on the PR.

Manual deploy, if you ever need one (requires `wrangler login`):

```bash
bunx wrangler deploy
```
