/**
 * Backfill Git Tags for Couch-Kit Packages
 *
 * Walks git history to find all commits that bumped a package version,
 * then creates annotated git tags in the `@couch-kit/<pkg>@<version>` format.
 *
 * Usage: bun run scripts/backfill-tags.ts [--dry-run]
 */

import { spawnSync } from "bun";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PACKAGES = ["core", "client", "host", "cli"] as const;
type PackageName = (typeof PACKAGES)[number];

const TAG_SCOPE = "@couch-kit";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(...args: string[]): string {
  const result = spawnSync(["git", ...args], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }

  return result.stdout.toString().trim();
}

function gitMaybe(...args: string[]): string | null {
  const result = spawnSync(["git", ...args], {
    cwd: import.meta.dir + "/..",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) return null;

  return result.stdout.toString().trim();
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

interface CommitInfo {
  hash: string;
  authorDate: string;
  subject: string;
}

function getAllCommitsChronological(): CommitInfo[] {
  const raw = git("log", "--reverse", "--format=%H|%aI|%s");

  if (!raw) return [];

  return raw.split("\n").map((line) => {
    const [hash, authorDate, ...subjectParts] = line.split("|");
    return { hash, authorDate, subject: subjectParts.join("|") };
  });
}

function getPackageVersion(commit: string, pkg: PackageName): string | null {
  const content = gitMaybe("show", `${commit}:packages/${pkg}/package.json`);
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

function getExistingTags(): Set<string> {
  const raw = gitMaybe("tag", "-l");
  if (!raw) return new Set();
  return new Set(raw.split("\n").filter(Boolean));
}

// ---------------------------------------------------------------------------
// Tag creation
// ---------------------------------------------------------------------------

interface TagResult {
  tag: string;
  commit: string;
  status: "created" | "skipped" | "error";
  reason?: string;
}

function createAnnotatedTag(
  tagName: string,
  commit: string,
  authorDate: string,
): TagResult {
  const result = spawnSync(
    ["git", "tag", "-a", tagName, commit, "-m", `Release ${tagName}`],
    {
      cwd: import.meta.dir + "/..",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_COMMITTER_DATE: authorDate,
      },
    },
  );

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    return { tag: tagName, commit, status: "error", reason: stderr };
  }

  return { tag: tagName, commit, status: "created" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log("🏷️  Backfill tags (DRY RUN — no tags will be created)\n");
  } else {
    console.log("🏷️  Backfilling version tags from git history…\n");
  }

  const existingTags = getExistingTags();
  const commits = getAllCommitsChronological();

  if (commits.length === 0) {
    console.log("No commits found.");
    return;
  }

  console.log(`Found ${commits.length} commits to inspect.\n`);

  // Track the last-seen version per package to detect changes.
  const previousVersion = new Map<PackageName, string | null>();
  for (const pkg of PACKAGES) {
    previousVersion.set(pkg, null);
  }

  const results: TagResult[] = [];

  for (const commit of commits) {
    for (const pkg of PACKAGES) {
      const version = getPackageVersion(commit.hash, pkg);
      const prevVersion = previousVersion.get(pkg) ?? null;

      // Only act when the version field actually changed.
      if (version === prevVersion) continue;

      // Update tracked version regardless of tag outcome.
      previousVersion.set(pkg, version);

      // No version means package.json was removed (unlikely but safe).
      if (!version) continue;

      const tagName = `${TAG_SCOPE}/${pkg}@${version}`;

      // Idempotent: skip if tag already exists.
      if (existingTags.has(tagName)) {
        results.push({
          tag: tagName,
          commit: commit.hash.slice(0, 7),
          status: "skipped",
          reason: "tag already exists",
        });
        continue;
      }

      if (dryRun) {
        results.push({
          tag: tagName,
          commit: commit.hash.slice(0, 7),
          status: "created",
          reason: "dry run",
        });
        continue;
      }

      const result = createAnnotatedTag(
        tagName,
        commit.hash,
        commit.authorDate,
      );
      result.commit = commit.hash.slice(0, 7);
      results.push(result);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const created = results.filter((r) => r.status === "created");
  const skipped = results.filter((r) => r.status === "skipped");
  const errors = results.filter((r) => r.status === "error");

  console.log("─".repeat(60));
  console.log("Summary\n");

  if (created.length > 0) {
    const label = dryRun ? "Would create" : "Created";
    console.log(`  ✅ ${label}: ${created.length}`);
    for (const r of created) {
      console.log(`     ${r.tag}  (${r.commit})`);
    }
  }

  if (skipped.length > 0) {
    console.log(`  ⏭️  Skipped: ${skipped.length}`);
    for (const r of skipped) {
      console.log(`     ${r.tag}  — ${r.reason}`);
    }
  }

  if (errors.length > 0) {
    console.log(`  ❌ Errors: ${errors.length}`);
    for (const r of errors) {
      console.log(`     ${r.tag}  — ${r.reason}`);
    }
  }

  if (results.length === 0) {
    console.log("  No version bumps detected.");
  }

  console.log("");
}

main();
