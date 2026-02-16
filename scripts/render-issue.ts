import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { PackageChangelog, ExtractedChangelog } from "./types.ts";

// --- Constants ---

const BUMP_BADGES: Record<string, string> = {
  major: "🔴 major",
  minor: "🟡 minor",
  patch: "🟢 patch",
};

const DELIMITER = "---BODY---";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = join(SCRIPTS_DIR, "templates", "update-issue.md");

// --- Rendering ---

function readChangelog(filePath: string): ExtractedChangelog {
  const raw = readFileSync(filePath, "utf-8");
  const parsed: unknown = JSON.parse(raw);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("packages" in parsed)
  ) {
    throw new Error("Invalid changelog JSON: missing 'packages' field");
  }

  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.packages)) {
    throw new Error("Invalid changelog JSON: 'packages' must be an array");
  }

  return parsed as ExtractedChangelog;
}

function renderPackageSections(packages: PackageChangelog[]): string {
  return packages
    .map((pkg) => {
      const badge = BUMP_BADGES[pkg.bump];
      return `### \`${pkg.name}\` → \`${pkg.version}\` ${badge}\n\n${pkg.fullChangelog}`;
    })
    .join("\n\n");
}

function renderBreakingSection(changelog: ExtractedChangelog): string {
  if (!changelog.hasBreaking) return "";

  const items = changelog.packages
    .filter((pkg) => pkg.breaking.length > 0)
    .flatMap((pkg) => pkg.breaking.map((b) => `- **${pkg.name}**: ${b}`));

  return `## ⚠️ Breaking Changes\n\n${items.join("\n")}`;
}

function renderMigrationSection(changelog: ExtractedChangelog): string {
  const migrations = changelog.packages.filter((pkg) => pkg.migration !== null);
  if (migrations.length === 0) return "";

  const sections = migrations
    .map((pkg) => `### ${pkg.name}\n\n${pkg.migration}`)
    .join("\n\n");

  return `## 🔄 Migration Guide\n\n${sections}`;
}

function renderSecuritySection(changelog: ExtractedChangelog): string {
  if (!changelog.hasSecurity) return "";

  const items = changelog.packages
    .filter((pkg) => pkg.security.length > 0)
    .flatMap((pkg) => pkg.security.map((s) => `- **${pkg.name}**: ${s}`));

  return `## 🔒 Security Updates\n\n${items.join("\n")}`;
}

function renderCopilotContext(packages: PackageChangelog[]): string {
  const packageNames = packages.map((p) => p.name);
  const hasCore = packageNames.includes("@couch-kit/core");
  const hasHost = packageNames.includes("@couch-kit/host");
  const hasClient = packageNames.includes("@couch-kit/client");

  const invariants = [
    "- Host package is server-authoritative; never trust client state",
    "- `createGameReducer` wraps user reducers — check for API changes in `@couch-kit/core`",
    "- Player IDs are derived deterministically from secrets",
    "- State broadcasts are throttled at ~30fps (33ms trailing-edge debounce)",
    "- WebSocket port = HTTP port + 2",
  ];

  const grepPatterns: string[] = [
    "# Find all @couch-kit imports",
    'rg "from [\'\\"]@couch-kit/" --type ts',
    "",
  ];

  if (hasCore) {
    grepPatterns.push("# Find reducer usage");
    grepPatterns.push('rg "createGameReducer" --type ts');
    grepPatterns.push("");
  }

  if (hasClient) {
    grepPatterns.push("# Find client hooks");
    grepPatterns.push('rg "useGameClient|useServerTime|usePreload" --type ts');
    grepPatterns.push("");
  }

  if (hasHost) {
    grepPatterns.push("# Find host provider usage");
    grepPatterns.push('rg "GameHostProvider|useGameHost" --type tsx');
    grepPatterns.push("");
  }

  const verificationSteps = [
    "1. `bun install` — resolve new versions",
    "2. `bun run typecheck` — catch type breakages",
    "3. `bun run build` — verify compilation",
    "4. Test on device: launch TV app, connect phone controller, play through one full round",
  ];

  return `<details>
<summary>Architecture context for automated updates</summary>

### Key Invariants
${invariants.join("\n")}

### Useful Grep Patterns
\`\`\`bash
${grepPatterns.join("\n")}
\`\`\`

### Verification Steps
${verificationSteps.join("\n")}
</details>`;
}

function generateTitle(packages: PackageChangelog[]): string {
  const packageVersions = packages
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .join(", ");

  return `chore: update ${packageVersions}`;
}

function renderTemplate(
  template: string,
  changelog: ExtractedChangelog,
): string {
  const replacements: Record<string, string> = {
    "{{packageSections}}": renderPackageSections(changelog.packages),
    "{{breakingSection}}": renderBreakingSection(changelog),
    "{{migrationSection}}": renderMigrationSection(changelog),
    "{{securitySection}}": renderSecuritySection(changelog),
    "{{copilotContext}}": renderCopilotContext(changelog.packages),
  };

  let rendered = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    rendered = rendered.replace(placeholder, value);
  }

  // Clean up empty lines from removed conditional sections
  rendered = rendered.replace(/\n{3,}/g, "\n\n");

  return rendered.trim();
}

// --- Main ---

function main(): void {
  const changelogPath = process.argv[2];
  if (!changelogPath) {
    throw new Error(
      "Usage: bun run scripts/render-issue.ts <changelog-json-path>",
    );
  }

  const changelog = readChangelog(changelogPath);

  if (changelog.packages.length === 0) {
    throw new Error("No packages found in changelog JSON");
  }

  const template = readFileSync(TEMPLATE_PATH, "utf-8");
  const title = generateTitle(changelog.packages);
  const body = renderTemplate(template, changelog);

  process.stdout.write(`${title}\n${DELIMITER}\n${body}\n`);
}

main();
