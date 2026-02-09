import { Command } from "commander";
import fs from "fs-extra";
import path from "path";
import ora from "ora";
import { execSync } from "child_process";
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
    const spinner = ora("Bundling controller...").start();

    try {
      const sourceDir = path.resolve(process.cwd(), options.source);
      const distDir = path.join(sourceDir, "dist");
      const targetDir = path.resolve(process.cwd(), options.output);

      // 1. Build
      if (options.build) {
        spinner.text = "Running build command...";
        // Auto-detect package manager/script
        if (fs.existsSync(path.join(sourceDir, "package.json"))) {
          // For now assume standard 'build' script
          execSync("bun run build", { cwd: sourceDir, stdio: "ignore" });
        } else {
          spinner.warn("No package.json found, skipping build");
        }
      }

      // 2. Verify Dist
      if (!fs.existsSync(distDir)) {
        throw new Error(`Build output not found at ${distDir}`);
      }

      // 3. Clean Target
      spinner.text = "Cleaning target directory...";
      await fs.emptyDir(targetDir);

      // 4. Copy
      spinner.text = "Copying assets...";
      await fs.copy(distDir, targetDir);

      spinner.succeed(`Controller bundled to ${options.output}`);
    } catch (e) {
      spinner.fail(`Bundle failed: ${toErrorMessage(e)}`);
      process.exit(1);
    }
  });
