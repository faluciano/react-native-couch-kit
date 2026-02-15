# Contributing to couch-kit

A TypeScript framework for Android TV party games using phones as controllers.

## Development Setup

**Package manager:** Bun (v1.2.19)

```bash
bun install        # install dependencies
bun run build      # build all packages
bun run test       # run tests
bun run lint       # lint
bun run typecheck  # type-check
```

## Monorepo Structure

Four packages under `packages/`:

| Package             | Description                            |
| ------------------- | -------------------------------------- |
| `@couch-kit/core`   | Shared types, protocol, reducer        |
| `@couch-kit/client` | React hooks for phone controllers      |
| `@couch-kit/host`   | React Native TV host                   |
| `@couch-kit/cli`    | CLI tools (bundle, simulate, scaffold) |

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Add a changeset: `bun run changeset`
   - Select which packages are affected
   - Choose the semver bump type (patch / minor / major)
   - Write a summary of the change
4. Commit and push
5. Open a PR to `main`
6. CI runs: lint, typecheck, test, build, and changeset validation
7. Get review and merge

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for version management.

- Every PR that changes published packages **must** include a changeset
- CI will fail if a changeset is missing
- Run `bun run changeset` to create one
- Changesets are consumed during the release process

## Release Process

Releases are automated via GitHub Actions:

1. When PRs with changesets merge to `main`, the Changesets bot opens a **"Version Packages"** PR
2. This PR bumps versions in `package.json` and updates `CHANGELOG.md` files
3. When the maintainer merges the Version Packages PR, the release workflow:
   - Publishes all changed packages to npm
   - Creates git tags (e.g., `@couch-kit/core@0.6.0`)
   - Creates GitHub Releases

### Release Cadence

- **Regular releases** — The Version Packages PR is merged weekly (typically Monday)
- **Hotfixes** — For critical bug fixes, the Version Packages PR is merged immediately
- **Breaking changes** — Version Packages PR is held for review and coordination with dependents

## Maintainer Reference

### NPM_TOKEN Setup

1. Go to [npmjs.com](https://www.npmjs.com) → Avatar → **Access Tokens** → **Generate New Token** → **Granular Access Token**
2. Configure the token:
   - **Name:** `couch-kit-ci-release`
   - **Expiration:** 1 year (set a reminder to rotate)
   - **Packages:** Only select packages — add `@couch-kit/core`, `@couch-kit/client`, `@couch-kit/host`, `@couch-kit/cli`
   - **Permissions:** Read and write
3. Add the token as a GitHub repository secret named `NPM_TOKEN` (Settings → Secrets and variables → Actions)
4. Enable "Allow GitHub Actions to create and approve pull requests" in repo Settings → Actions → General → Workflow permissions

### Branch Protection

The `main` branch has protection rules:

- PRs are required (no direct pushes)
- CI status checks must pass: `lint`, `test`, `build`, `changesets`
- Stale approvals are dismissed on new pushes

To configure branch protection via CLI:

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["lint","test","build","changesets"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"dismiss_stale_reviews":true,"required_approving_review_count":0}' \
  --field restrictions=null
```

## License

MIT
