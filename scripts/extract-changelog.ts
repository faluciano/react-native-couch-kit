import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { PackageChangelog, ExtractedChangelog } from "./types.ts";

// --- Types ---

interface PublishedPackage {
  name: string;
  version: string;
}

// --- Parsing ---

const BOLD_HEADER_PATTERN = /\*\*([\w\s&-]+:?)\*\*/;

function parsePublishedPackages(jsonArg: string): PublishedPackage[] {
  const parsed: unknown = JSON.parse(jsonArg);

  if (!Array.isArray(parsed)) {
    throw new Error(
      `Expected JSON array of published packages, got: ${typeof parsed}`,
    );
  }

  return parsed.map((entry: unknown, i: number) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("name" in entry) ||
      !("version" in entry)
    ) {
      throw new Error(
        `Invalid package entry at index ${i}: missing name or version`,
      );
    }
    const { name, version } = entry as { name: string; version: string };
    return { name, version };
  });
}

function packageNameToDir(name: string): string {
  // @couch-kit/core -> core
  const match = name.match(/^@couch-kit\/(.+)$/);
  if (!match) {
    throw new Error(
      `Package name "${name}" does not match @couch-kit/* pattern`,
    );
  }
  return match[1];
}

function extractVersionSection(
  changelog: string,
  version: string,
): string | null {
  const versionHeading = `## ${version}`;
  const startIndex = changelog.indexOf(versionHeading);
  if (startIndex === -1) return null;

  const contentStart = startIndex + versionHeading.length;
  const nextHeadingIndex = changelog.indexOf("\n## ", contentStart);

  const section =
    nextHeadingIndex === -1
      ? changelog.slice(contentStart)
      : changelog.slice(contentStart, nextHeadingIndex);

  return section.trim();
}

function findPreviousVersion(
  changelog: string,
  currentVersion: string,
): string | null {
  const versionPattern = /^## (\d+\.\d+\.\d+)/gm;
  const versions: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = versionPattern.exec(changelog)) !== null) {
    versions.push(match[1]);
  }

  const currentIndex = versions.indexOf(currentVersion);
  if (currentIndex === -1 || currentIndex === versions.length - 1) return null;

  return versions[currentIndex + 1];
}

function determineBumpType(
  current: string,
  previous: string | null,
): "major" | "minor" | "patch" {
  if (!previous) return "minor"; // first version — treat as minor

  const [curMajor, curMinor] = current.split(".").map(Number);
  const [prevMajor, prevMinor] = previous.split(".").map(Number);

  if (curMajor !== prevMajor) return "major";
  if (curMinor !== prevMinor) return "minor";
  return "patch";
}

function extractBoldSections(content: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  const lines = content.split("\n");

  let currentHeader: string | null = null;
  let currentLines: string[] = [];

  const flushCurrent = () => {
    if (currentHeader && currentLines.length > 0) {
      const existing = sections.get(currentHeader) ?? [];
      existing.push(...currentLines.filter((l) => l.trim().length > 0));
      sections.set(currentHeader, existing);
    }
    currentLines = [];
  };

  for (const line of lines) {
    const headerMatch = line.match(BOLD_HEADER_PATTERN);
    if (headerMatch) {
      flushCurrent();
      currentHeader = headerMatch[1].trim().replace(/:$/, "");
      // Content may follow on the same line after the bold header
      const afterHeader = line
        .slice(line.indexOf("**", line.indexOf("**") + 2) + 2)
        .trim();
      if (afterHeader) {
        currentLines.push(afterHeader);
      }
    } else if (currentHeader) {
      // If we hit a new ### heading, stop collecting for the bold section
      if (line.match(/^#{1,3}\s/)) {
        flushCurrent();
        currentHeader = null;
      } else {
        currentLines.push(line);
      }
    }
  }

  flushCurrent();
  return sections;
}

function extractItemsForSection(
  boldSections: Map<string, string[]>,
  sectionName: string,
): string[] {
  const lines = boldSections.get(sectionName);
  if (!lines) return [];

  return lines
    .map((l) =>
      l
        .trim()
        .replace(/^[-*]\s*/, "")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

function extractMigrationSection(
  boldSections: Map<string, string[]>,
): string | null {
  const lines = boldSections.get("Migration");
  if (!lines || lines.length === 0) return null;

  return lines.join("\n").trim();
}

// --- Main ---

function main(): void {
  const jsonArg = process.argv[2];
  if (!jsonArg) {
    throw new Error(
      "Usage: bun run scripts/extract-changelog.ts '<published-packages-json>'",
    );
  }

  const packages = parsePublishedPackages(jsonArg);
  const result: ExtractedChangelog = {
    packages: [],
    hasBreaking: false,
    hasSecurity: false,
  };

  for (const pkg of packages) {
    const dirName = packageNameToDir(pkg.name);
    const changelogPath = join(
      process.cwd(),
      "packages",
      dirName,
      "CHANGELOG.md",
    );

    if (!existsSync(changelogPath)) {
      console.error(`⚠️  No CHANGELOG.md found for ${pkg.name}, skipping`);
      continue;
    }

    const changelog = readFileSync(changelogPath, "utf-8");
    const versionSection = extractVersionSection(changelog, pkg.version);

    if (!versionSection) {
      console.error(
        `⚠️  Version ${pkg.version} not found in ${pkg.name} CHANGELOG, skipping`,
      );
      continue;
    }

    const previousVersion = findPreviousVersion(changelog, pkg.version);
    const bump = determineBumpType(pkg.version, previousVersion);
    const boldSections = extractBoldSections(versionSection);

    const breaking = extractItemsForSection(boldSections, "Breaking changes");
    const features = extractItemsForSection(boldSections, "New features");
    const migration = extractMigrationSection(boldSections);
    const security = extractItemsForSection(boldSections, "Security");

    if (breaking.length > 0) result.hasBreaking = true;
    if (security.length > 0) result.hasSecurity = true;

    result.packages.push({
      name: pkg.name,
      version: pkg.version,
      bump,
      breaking,
      features,
      migration,
      security,
      fullChangelog: versionSection,
    });
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main();
