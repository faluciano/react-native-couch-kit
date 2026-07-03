---
"@couch-kit/cli": patch
---

**CLI improvements:** Fix argument forwarding from the top-level command to the lazily-loaded sub-commands. `couch-kit init <name>` now scaffolds into `<name>` instead of always creating a folder called `init`; `couch-kit replay <recording> <reducer>` no longer shifts its positional arguments; and positive boolean flags (`--host`, `--open`, `--snapshots`, `--json`) are now forwarded correctly instead of being silently dropped.
