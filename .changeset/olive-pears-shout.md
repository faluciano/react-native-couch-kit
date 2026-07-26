---
"@couch-kit/devtools": patch
---

Fix an over-strict peer dependency that pinned devtools to one exact client
release.

The peer range was `workspace:*`, which publishing rewrites to the current
version — so `@couch-kit/devtools@3.0.0` demanded *exactly*
`@couch-kit/client@0.11.0`, and any client patch would conflict. devtools uses
one type-only import from client and nothing at runtime, so the peer is now a
wide, optional range (`>=0.9.0 <1.0.0`).

This also stops the runaway majors: because a peerDependency range change is
treated as breaking, every client release majored devtools — 0.2.10 → 1.0.0 →
2.0.0 → 3.0.0 in a day, each changelog reading "Patch Changes". Changesets is
now configured to bump peer dependents only when a release actually leaves
their range.
