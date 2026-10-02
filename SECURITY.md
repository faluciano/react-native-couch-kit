# Security Policy

`couch-kit` builds **multiplayer party games** that run in one of two modes, and
the threat model differs between them:

- **LAN mode (default).** An Android TV host and phone controllers talk to each
  other over a **LAN** WebSocket connection. It is designed for a living-room
  threat model — everyone on the network is assumed to be a guest you invited —
  not for exposure to the public internet.
- **Relay mode (opt-in, cross-network).** A browser display owns the game and
  phones reach it by room code through a relay that _is_ on the public internet.
  The living-room assumption does not hold there; see [Relay mode](#relay-mode)
  for what the relay does and does not protect.

## Supported Versions

The project is pre-1.0. Security fixes are released only against the **latest
published version** of each `@couch-kit/*` package on npm. Please upgrade to the
newest release before reporting an issue.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately through GitHub's private vulnerability reporting:

1. Go to the [**Security** tab](https://github.com/faluciano/react-native-couch-kit/security).
2. Click **Report a vulnerability** (or use this direct link:
   <https://github.com/faluciano/react-native-couch-kit/security/advisories/new>).
3. Describe the issue, the affected package(s) and version(s), and — if possible —
   a minimal reproduction and the impact you believe it has.

You should get an initial acknowledgement within **7 days**. Once a fix is ready it
will be published to npm and disclosed via a GitHub Security Advisory, crediting the
reporter unless anonymity is requested.

## Scope

The host is authoritative and already applies several hardening measures (see
[Security Notes](README.md#security-notes) in the README). These come from the
shared runtime, so they apply to the TV host in LAN mode and to the browser
display in relay mode alike:

- Player IDs are derived from a per-client session secret with SHA-256; the raw
  secret is never broadcast — only the derived public `playerId` is shared.
- The host rejects injected internal action types, rate-limits actions (60/sec),
  ignores actions from clients that haven't `JOIN`ed, and caps inbound messages
  at 256 KiB (configurable via `maxMessageBytes` on the LAN host).

By default every player receives the full game state, so anything a controller
merely chooses not to render is still on that player's device. Games with hidden
information (hands, roles, secret answers) should set the runtime's `project`
option, which sends each player only their own view so hidden data never reaches
other players' devices. This applies in both modes.

### LAN mode

Reports that fall **outside** the LAN party-game threat model — for example,
attacks that assume the host is deliberately exposed to the public internet, or
that require a malicious actor already on your trusted local network to reach a
device they could compromise by other means — are still welcome, but may be
documented as known limitations rather than patched.

### Relay mode

In relay mode the display and the phones each connect out to a relay
(`services/relay-worker` on Cloudflare Workers, or the self-hosted
`services/relay`). The relay `url` is required configuration with no default, so
you choose which relay your players' traffic goes through.

What to assume:

- **The room code is the only credential needed to join a room.** There are no
  accounts or per-player tokens at the relay; anyone who learns or guesses a live
  code can join as a player. Relay-assigned codes are six characters from a
  32-character alphabet, drawn from a CSPRNG (about 1.07 billion possibilities).
  A display that supplies its own `roomId` gets a code only as unguessable as the
  one it chose.
- **Hosting a room is held by a resume token.** The relay gives the display a
  128-bit random token when the room is created, and only a connection that
  presents it can take the room back after the display's connection drops. A
  wrong token gets the same `ROOM_NOT_FOUND` as a room that does not exist. The
  token lives in the display's memory only and is never sent to phones.
- **The relay routes opaque envelopes.** It tracks room membership and forwards
  `DATA` envelopes between the display and its phones without parsing the game
  messages inside them. A phone's messages go only to the display, never directly
  to other phones.
- **Session secrets travel through the relay to the display.** Game messages are
  not end-to-end encrypted, so whoever operates the relay is in a position to
  read them, including each player's session secret in `JOIN`. Use a relay you
  trust, served over `wss://`.
- **The relay applies abuse limits, not authentication.** Each phone is
  limited to 75 messages per second and the display to 1200 (exceeding either
  returns `RATE_LIMITED` and closes the socket), rooms hold at most 16 players, and messages over 256 KiB
  are rejected. Connections are also limited per IP: the Bun relay caps
  concurrent connections, and the Worker rate-limits new connections when its
  `CONNECT_LIMITER` binding is configured. An optional `Origin` allowlist
  (`ALLOWED_ORIGINS`) stops other web pages from opening sockets to the relay,
  but non-browser clients can forge the header, so it is hygiene rather than a
  security boundary.

Reports about the relay itself are in scope — for example, messages crossing
between rooms, a player joining a room without its code, a player impersonating
the display or another player, or the limits above being bypassed. Reports that
amount to "someone who knows the room code can join" describe the design and may
be documented as known limitations rather than patched.
