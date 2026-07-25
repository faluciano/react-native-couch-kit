---
"@couch-kit/display": patch
---

**Bundle & tree-shaking**

- Fix `RelayDisplayHost` resolving as "not exported" for consumers on
  `moduleResolution: NodeNext`/`Node16`. The package is `type: module`, so the
  emitted `.d.ts` is read in strict-ESM mode where an extensionless relative
  re-export (`export * from "./relay-display-host"`) is not resolved. Add the
  `.js` extension to the barrel specifier, matching the other ESM packages.
