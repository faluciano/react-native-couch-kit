import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("Bundle manifest generation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupDistFixture() {
    const sourceDir = path.join(tmpDir, "web-controller");
    const distDir = path.join(sourceDir, "dist");
    const assetsDir = path.join(distDir, "assets");

    fs.mkdirSync(assetsDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.html"), "<html></html>");
    fs.writeFileSync(path.join(assetsDir, "index-abc.js"), "// js");
    fs.writeFileSync(path.join(assetsDir, "style-def.css"), "/* css */");
    fs.writeFileSync(
      path.join(sourceDir, "package.json"),
      JSON.stringify({ scripts: {} }),
    );

    return { sourceDir, distDir };
  }

  test("generates www-manifest.json in the output directory", async () => {
    setupDistFixture();

    const outputDir = path.join(tmpDir, "output", "www");
    const { bundleCommand } = await import("../src/commands/bundle");

    await bundleCommand.parseAsync(
      [
        "--source",
        path.join(tmpDir, "web-controller"),
        "--output",
        outputDir,
        "--no-build",
      ],
      { from: "user" },
    );

    const manifestPath = path.join(outputDir, "www-manifest.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest).toHaveProperty("files");
    expect(Array.isArray(manifest.files)).toBe(true);

    // Should contain the files we created (sorted), but not the manifest itself
    // since the manifest is written after file collection
    expect(manifest.files).toContain("index.html");
    expect(manifest.files).toContain("assets/index-abc.js");
    expect(manifest.files).toContain("assets/style-def.css");
    expect(manifest.files).toHaveLength(3);
  });

  test("--manifest flag writes manifest to a secondary path", async () => {
    setupDistFixture();

    const outputDir = path.join(tmpDir, "output", "www");
    const secondaryManifestPath = path.join(
      tmpDir,
      "app-source",
      "www-manifest.json",
    );

    const { bundleCommand } = await import("../src/commands/bundle");

    await bundleCommand.parseAsync(
      [
        "--source",
        path.join(tmpDir, "web-controller"),
        "--output",
        outputDir,
        "--no-build",
        "--manifest",
        secondaryManifestPath,
      ],
      { from: "user" },
    );

    // Primary manifest should exist
    expect(fs.existsSync(path.join(outputDir, "www-manifest.json"))).toBe(true);

    // Secondary manifest should also exist
    expect(fs.existsSync(secondaryManifestPath)).toBe(true);

    const primary = JSON.parse(
      fs.readFileSync(path.join(outputDir, "www-manifest.json"), "utf-8"),
    );
    const secondary = JSON.parse(
      fs.readFileSync(secondaryManifestPath, "utf-8"),
    );

    // Both should have identical content
    expect(secondary).toEqual(primary);
  });
});
