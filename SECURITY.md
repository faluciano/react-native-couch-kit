# Security Policy

`couch-kit` builds **local multiplayer party games** where an Android TV host and
phone controllers talk to each other over a **LAN** WebSocket connection. It is
designed for a living-room threat model — everyone on the network is assumed to be
a guest you invited — not for exposure to the public internet.

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
[Security Notes](README.md#security-notes) in the README):

- Player IDs are derived from a per-client session secret with SHA-256; the raw
  secret is never broadcast — only the derived public `playerId` is shared.
- The host rejects injected internal action types, rate-limits actions (60/sec),
  ignores actions from clients that haven't `JOIN`ed, and caps inbound WebSocket
  messages (256 KiB by default, configurable via `maxMessageBytes`).

Reports that fall **outside** the LAN party-game threat model — for example,
attacks that assume the host is deliberately exposed to the public internet, or
that require a malicious actor already on your trusted local network to reach a
device they could compromise by other means — are still welcome, but may be
documented as known limitations rather than patched.
