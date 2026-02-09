import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { toErrorMessage } from "@couch-kit/core";

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
          // For now assume standard 'build' script
          execSync("bun run build", { cwd: sourceDir, stdio: "ignore" });
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

      console.log(`Done! Controller bundled to ${options.output}`);
    } catch (e) {
      console.error(`Bundle failed: ${toErrorMessage(e)}`);
      process.exit(1);
    }
  });
