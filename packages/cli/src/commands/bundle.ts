import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { toErrorMessage } from "@couch-kit/core";

/** Recursively collects all file paths relative to `dir`. */
function collectFiles(dir: string, prefix = ""): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), relativePath));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

/** Detects the package manager by looking for lock files in the given directory and its parents. */
function detectPackageManager(dir: string): "bun" | "npm" | "yarn" | "pnpm" {
  for (
    let current = dir, parent = "";
    parent !== current;
    current = path.dirname(current)
  ) {
    parent = current;
    if (
      fs.existsSync(path.join(current, "bun.lockb")) ||
      fs.existsSync(path.join(current, "bun.lock"))
    )
      return "bun";
    if (fs.existsSync(path.join(current, "pnpm-lock.yaml"))) return "pnpm";
    if (fs.existsSync(path.join(current, "yarn.lock"))) return "yarn";
    if (fs.existsSync(path.join(current, "package-lock.json"))) return "npm";
  }
  return "npm";
}

export const bundleCommand = new Command("bundle")
  .description("Bundles the web controller into the Android assets directory")
  .option(
    "-s, --source <path>",
    "Source directory of web controller",
    "./web-controller",
  )
  .option(
    "-o, --output <path>",
    "Android assets directory",
    "./android/app/src/main/assets/www",
  )
  .option("--no-build", "Skip build step (just copy)")
  .option(
    "-m, --manifest <path>",
    "Also write manifest to this path for import in app source",
  )
  .action(async (options) => {
    console.log("Bundling controller...");

    try {
      const sourceDir = path.resolve(process.cwd(), options.source);
      const distDir = path.join(sourceDir, "dist");
      const targetDir = path.resolve(process.cwd(), options.output);

      // 1. Build
      if (options.build) {
        console.log("  Running build command...");
        // Auto-detect package manager/script
        if (fs.existsSync(path.join(sourceDir, "package.json"))) {
          const pm = detectPackageManager(sourceDir);
          console.log(`  Using ${pm} to build...`);
          execSync(`${pm} run build`, { cwd: sourceDir, stdio: "inherit" });
        } else {
          console.warn("  No package.json found, skipping build");
        }
      }

      // 2. Verify Dist
      if (!fs.existsSync(distDir)) {
        throw new Error(`Build output not found at ${distDir}`);
      }

      // 3. Clean Target
      console.log("  Cleaning target directory...");
      fs.rmSync(targetDir, { recursive: true, force: true });
      fs.mkdirSync(targetDir, { recursive: true });

      // 4. Copy
      console.log("  Copying assets...");
      fs.cpSync(distDir, targetDir, { recursive: true });

      // 5. Generate asset manifest
      const files = collectFiles(targetDir).sort();
      const manifest = JSON.stringify({ files }, null, 2);

      const manifestPath = path.join(targetDir, "www-manifest.json");
      fs.writeFileSync(manifestPath, manifest + "\n");
      console.log(`  Generated manifest with ${files.length} files`);

      // 6. Optionally write manifest to a secondary path (e.g. app source for TS imports)
      if (options.manifest) {
        const secondaryPath = path.resolve(process.cwd(), options.manifest);
        fs.mkdirSync(path.dirname(secondaryPath), { recursive: true });
        fs.writeFileSync(secondaryPath, manifest + "\n");
        console.log(`  Manifest also written to ${options.manifest}`);
      }

      console.log(`Done! Controller bundled to ${options.output}`);
    } catch (e) {
      console.error(`Bundle failed: ${toErrorMessage(e)}`);
      process.exit(1);
    }
  });
