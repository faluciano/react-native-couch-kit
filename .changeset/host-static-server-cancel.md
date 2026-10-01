---
"@couch-kit/host": patch
---

`useStaticServer` no longer publishes results from, or leaks, a server whose effect was torn down while it was still starting (a config change, a `StrictMode` double mount, an unmount). A stale error is also cleared when the server restarts.
