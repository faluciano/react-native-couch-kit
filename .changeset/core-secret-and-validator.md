---
"@couch-kit/core": patch
---

**Security:** `actionValidator` drops an action whose validator throws. Before, the middleware error boundary passed it on to the reducer, so a malformed payload (exactly what makes a validator like `(a) => a.payload.points > 0` throw) skipped validation. `isValidSecret` now also rejects secrets longer than 128 hex characters (`MAX_SECRET_HEX_LENGTH`), so a client cannot make the host hash and store an arbitrarily long string.
