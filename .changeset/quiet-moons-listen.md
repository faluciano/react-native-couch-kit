---
"@couch-kit/client": minor
"@couch-kit/core": minor
---

Back the time-sync ping off to 30s once the clock estimate settles

`useGameClient`'s clock sync pinged every 5 seconds for the life of the
connection. It now starts there and doubles to a 30-second ceiling
(`MAX_SYNC_INTERVAL`), resetting to the fast interval whenever a new socket is
established, including after a reconnect.

The first few pings are what converge the offset; the clock difference they
measure does not drift on a human timescale, so the fast interval stops earning
its cost within about a minute. On a relay transport it is not free: each ping
is a message in and a `PONG` back out, and pings are the only traffic an idle
table generates at all. A four-player lobby went from 5,760 relay messages an
hour to under 1,000 while sitting untouched.

`rtt` and `getServerTime()` are unchanged in accuracy — both are updated by the
same `PONG` handling as before, just less often once settled. Games needing the
old cadence can dispatch their own pings; the constants
(`DEFAULT_SYNC_INTERVAL`, `MAX_SYNC_INTERVAL`, `SYNC_BACKOFF_FACTOR`) are
exported from `@couch-kit/core`.
