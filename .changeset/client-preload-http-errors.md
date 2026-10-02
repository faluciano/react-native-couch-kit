---
"@couch-kit/client": patch
---

`usePreload` counts an HTTP error response (a 404, say) as a failed asset. Before, any response that arrived counted as loaded, so a missing sound file came back as `loaded: true` with an empty `failedAssets`.
