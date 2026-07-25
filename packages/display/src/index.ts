// Use an `export *` barrel (a named `export { X } from` lets bun tree-shake the
// sole class out under `sideEffects: false`, publishing an empty bundle) AND a
// `.js` extension on the specifier: the package is `type: module`, so consumers
// on `moduleResolution: NodeNext` resolve the emitted `.d.ts` in strict-ESM mode
// and an extensionless re-export fails to find `relay-display-host.d.ts`.
export * from "./relay-display-host.js";
