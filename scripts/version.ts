import { spawnSync } from "child_process";

/**
 * Runs `changeset version` with retries.
 *
 * The `@changesets/changelog-github` plugin calls the GitHub GraphQL API to
 * build changelog entries, and that request intermittently fails on CI with
 * errors like:
 *
 *   error Failed to parse data from GitHub
 *   error Invalid response body while trying to fetch
 *         https://api.github.com/graphql: Premature close
 *
 * When this happens changesets explicitly "escapes applying the changesets,
 * and no files should have been affected", so the command is safe to retry.
 * Without a retry, a single transient API blip fails the whole release run and
 * requires a manual re-run.
 */
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5_000;

const TRANSIENT_PATTERN =
  /Failed to parse data from GitHub|Premature close|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated/i;

function sleep(ms: number): void {
  // Synchronous, non-busy-waiting sleep so this stays a simple, dependency-free
  // script that blocks between retries without spinning a CPU core.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runChangesetVersion(): { code: number; stderr: string } {
  const result = spawnSync("changeset", ["version"], {
    stdio: ["inherit", "inherit", "pipe"],
    encoding: "utf-8",
    shell: process.platform === "win32",
  });
  const stderr = result.stderr ?? "";
  if (stderr) process.stderr.write(stderr);
  return { code: result.status ?? 1, stderr };
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const { code, stderr } = runChangesetVersion();

  if (code === 0) {
    process.exit(0);
  }

  const isTransient = TRANSIENT_PATTERN.test(stderr);
  const isLastAttempt = attempt === MAX_ATTEMPTS;

  if (!isTransient || isLastAttempt) {
    console.error(
      `\n✖ \`changeset version\` failed (attempt ${attempt}/${MAX_ATTEMPTS}) ` +
        `with exit code ${code}.` +
        (isTransient ? " Giving up after exhausting retries." : ""),
    );
    process.exit(code);
  }

  const delay = BASE_DELAY_MS * attempt;
  console.warn(
    `\n⚠️  Transient GitHub API error during \`changeset version\` ` +
      `(attempt ${attempt}/${MAX_ATTEMPTS}). Retrying in ${delay / 1000}s...`,
  );
  sleep(delay);
}
