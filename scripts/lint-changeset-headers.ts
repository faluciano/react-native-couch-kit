import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_HEADERS = new Set([
  "Breaking changes",
  "New features",
  "Migration",
  "Security",
  "Dependency cleanup",
  "Bundle & tree-shaking",
  "Runtime performance",
  "CLI improvements",
]);

const BOLD_HEADER_PATTERN = /\*\*([\w\s&-]+):?\*\*/g;
const CHANGESET_DIR = join(process.cwd(), ".changeset");
const SKIP_FILES = new Set(["config.json", "README.md"]);

function lintChangesetFile(filePath: string, fileName: string): number {
  const content = readFileSync(filePath, "utf-8");
  const matches = content.matchAll(BOLD_HEADER_PATTERN);
  let fileErrors = 0;

  for (const match of matches) {
    const header = match[1].trim().replace(/:$/, "");

    if (!ALLOWED_HEADERS.has(header)) {
      console.error(
        `⚠️  ${fileName}: unrecognized bold header "**${header}:**"`,
      );
      console.error(`   Allowed: ${[...ALLOWED_HEADERS].join(", ")}`);
      fileErrors++;
    }
  }

  return fileErrors;
}

function main(): void {
  let entries: string[];
  try {
    entries = readdirSync(CHANGESET_DIR);
  } catch {
    // No .changeset directory — nothing to lint
    return;
  }

  const mdFiles = entries.filter(
    (f) => f.endsWith(".md") && !SKIP_FILES.has(f),
  );

  if (mdFiles.length === 0) return;

  let errorCount = 0;

  for (const file of mdFiles) {
    errorCount += lintChangesetFile(join(CHANGESET_DIR, file), file);
  }

  if (errorCount > 0) {
    console.error(`\n✗ Found ${errorCount} unrecognized changeset header(s)`);
    process.exit(1);
  }
}

main();
