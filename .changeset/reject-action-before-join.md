---
"@couch-kit/host": patch
---

**Security:** Reject client ACTIONs from sockets that have not completed a JOIN.

Previously an ACTION from a socket with no resolved player ID was dispatched with
`playerId: undefined`, letting an un-joined client mutate game state. The host now
rejects such actions with an `ERROR { code: "NOT_JOINED" }`.

The internal-action injection guard and this new un-joined guard are extracted
into a pure, unit-tested `authorizeClientAction` helper.
