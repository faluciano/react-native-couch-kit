import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const PACKAGES_DIR = join(process.cwd(), "packages");
const IS_CI = Boolean(process.env.CI);

// List of packages to publish (order matters if there are strict dep chains, but parallel is usually fine for npm)
const PACKAGES = ["core", "client", "host", "cli"];

const ALREADY_PUBLISHED_PATTERN =
  /you cannot publish over the previously published versions|403 forbidden/i;

function isAlreadyPublishedError(stderr: string): boolean {
  return ALREADY_PUBLISHED_PATTERN.test(stderr);
}

function getPackageJsonPath(pkgName: string) {
  return join(PACKAGES_DIR, pkgName, "package.json");
}

function readPackageJson(pkgName: string) {
  return JSON.parse(readFileSync(getPackageJsonPath(pkgName), "utf-8"));
}

// 1. Gather all current versions
console.log("🔍 Resolving workspace versions...");
const versionMap = new Map<string, string>();
for (const pkg of PACKAGES) {
  const json = readPackageJson(pkg);
  versionMap.set(json.name, json.version);
  console.log(`   ${json.name} -> ${json.version}`);
}

// 2. Publish each package
for (const pkg of PACKAGES) {
  console.log(`\n📦 Preparing to publish ${pkg}...`);
  const pkgPath = getPackageJsonPath(pkg);
  const originalContent = readFileSync(pkgPath, "utf-8");
  const json = JSON.parse(originalContent);

  let modified = false;

  // Helper to replace workspace versions in dependencies
  const replaceWorkspaceDeps = (deps: Record<string, string> | undefined) => {
    if (!deps) return;
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (depVersion.startsWith("workspace:")) {
        const resolvedVersion = versionMap.get(depName);
        if (resolvedVersion) {
          console.log(
            `   Fixing dependency ${depName}: ${depVersion} -> ${resolvedVersion}`,
          );
          deps[depName] = resolvedVersion;
          modified = true;
        } else {
          console.warn(
            `   ⚠️  Warning: Could not resolve workspace dependency: ${depName}`,
          );
        }
      }
    }
  };

  replaceWorkspaceDeps(json.dependencies);
  replaceWorkspaceDeps(json.peerDependencies);
  replaceWorkspaceDeps(json.devDependencies);

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(json, null, 2) + "\n");
  }

  try {
    console.log(`   🚀 Publishing ${json.name}...`);
    const publishArgs = ["publish", "--access", "public"];
    if (IS_CI) publishArgs.push("--provenance");

    const result = spawnSync("bun", publishArgs, {
      cwd: join(PACKAGES_DIR, pkg),
      stdio: IS_CI ? "pipe" : "inherit",
    });

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";

      if (IS_CI) {
        if (isAlreadyPublishedError(stderr)) {
          console.log(
            `   ℹ️  ${json.name} already published at this version, skipping.`,
          );
        } else {
          console.error(`   ❌ Failed to publish ${pkg}`);
          if (stderr) console.error(stderr);
          if (result.stdout) console.error(result.stdout.toString());
          process.exit(1);
        }
      } else {
        console.error(`   ❌ Failed to publish ${pkg}`);
        console.warn(
          `   ⚠️  Continuing despite error (run with CI=1 for fail-fast behavior)...`,
        );
      }
    } else {
      console.log(`   ✅ Published ${pkg}`);
    }
  } catch (e) {
    console.error(`   ❌ Error publishing ${pkg}:`, e);
    if (IS_CI) process.exit(1);
  } finally {
    // 4. Revert changes
    if (modified) {
      console.log(`   🔄 Reverting package.json for ${pkg}`);
      writeFileSync(pkgPath, originalContent);
    }
  }
}

console.log("\n✨ All done!");
