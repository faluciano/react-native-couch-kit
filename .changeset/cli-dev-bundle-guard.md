---
"@couch-kit/cli": minor
---

**CLI improvements:**

- **`couch-kit dev` uses the project's own Vite.** A bare `import("vite")` resolved from wherever the CLI was installed, so under `bunx`, `npx` or a global install it reported "Vite is not installed" even when the project had it. The command now finds `node_modules/vite` by walking up from the working directory, falling back to a copy next to the CLI.
- **`dev` lets Vite find its own config**, so `vite.config.js`/`.mjs` work, not only `vite.config.ts`.
- **`dev` has a real `--no-host`** to listen on localhost only. `--host` used to default to on and could not be turned off.
- **`dev` rejects an invalid port** given to `--port`.
- **`couch-kit bundle` refuses to clear an output directory that would delete more than a bundle.** That covers:
  - the filesystem root
  - the current directory or a parent of it
  - a directory that contains the controller source, or one inside it
  - a non-empty directory with no `www-manifest.json`, which is not a previous bundle. This is the `-o android/app/src/main/assets` case, missing `/www`. Pass `--force` to clear it anyway.
