import { join } from "path";
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";

const PACKAGES_DIR = join(process.cwd(), "packages");

// List of packages to publish (order matters if there are strict dep chains, but parallel is usually fine for npm)
const PACKAGES = ["core", "client", "host", "cli"];

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
    // Run bun publish
    // We use spawnSync to inherit stdio so the user can see prompts (like OTP) if they occur,
    // though bun publish usually expects env vars or non-interactive for automation.
    const result = spawnSync("bun", ["publish", "--access", "public"], {
      cwd: join(PACKAGES_DIR, pkg),
      stdio: "inherit",
    });

    if (result.status !== 0) {
      console.error(`   ❌ Failed to publish ${pkg}`);
      // Check if it's likely a version conflict (status 1 is generic, but usually 4xx from npm)
      // Since we can't easily parse stdio:inherit output, we'll assume non-core failures might be safe to continue
      // but if core fails we should probably stop?
      // Actually, if a package is already published, 'bun publish' usually errors.
      // We'll log it but NOT exit, so other packages can try.
      console.warn(
        `   ⚠️  Continuing despite error (package might already exist)...`,
      );
    } else {
      console.log(`   ✅ Published ${pkg}`);
    }
  } catch (e) {
    console.error(`   ❌ Error publishing ${pkg}:`, e);
  } finally {
    // 4. Revert changes
    if (modified) {
      console.log(`   cY Reverting package.json for ${pkg}`);
      writeFileSync(pkgPath, originalContent);
    }
  }
}

console.log("\n✨ All done!");
