import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

/**
 * The CLI package deliberately does NOT depend on vite (it is a user-land
 * dependency of the scaffolded project). So in this test environment
 * `import("vite")` fails and the command must surface a helpful message and
 * exit rather than crash — that is the branch exercised here.
 */
describe("dev command", () => {
  let errors: string[];
  let restore: (() => void)[];

  beforeEach(() => {
    errors = [];
    const errSpy = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    );
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new ExitError(code);
    }) as never);
    restore = [
      () => errSpy.mockRestore(),
      () => logSpy.mockRestore(),
      () => exitSpy.mockRestore(),
    ];
  });

  afterEach(() => {
    restore.forEach((fn) => fn());
  });

  test("exits with a helpful message when vite is not installed", async () => {
    const { dev } = await import("../src/commands/dev");

    let thrown: unknown;
    try {
      await dev.parseAsync([], { from: "user" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("Vite is not installed");
  });
});

/** A project directory with a stub `vite` that records its server config. */
function projectWithVite(entry: string, exportsField: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-dev-"));
  const viteDir = path.join(root, "node_modules", "vite");
  fs.mkdirSync(path.join(viteDir, path.dirname(entry)), { recursive: true });
  fs.writeFileSync(
    path.join(viteDir, "package.json"),
    JSON.stringify({ name: "vite", type: "module", exports: exportsField }),
  );
  fs.writeFileSync(
    path.join(viteDir, entry),
    `export async function createServer(config) {
       globalThis.__couchKitViteConfig = config;
       return { listen: async () => {} };
     }`,
  );
  return root;
}

describe("findProjectVite", () => {
  test("finds the project's vite through its exports map, walking up", async () => {
    const { findProjectVite } = await import("../src/commands/dev");
    const root = projectWithVite("dist/node/index.js", {
      ".": { import: { types: "./x.d.ts", default: "./dist/node/index.js" } },
    });
    const nested = path.join(root, "packages", "web");
    fs.mkdirSync(nested, { recursive: true });
    try {
      expect(findProjectVite(nested)).toBe(
        path.join(root, "node_modules", "vite", "dist", "node", "index.js"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("returns null when the project has no vite", async () => {
    const { findProjectVite } = await import("../src/commands/dev");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-dev-none-"));
    try {
      // The temp dir's ancestors have no node_modules/vite on a clean machine.
      const found = findProjectVite(root);
      expect(found === null || !found.startsWith(root)).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("dev command with a project vite", () => {
  let cwd: string;
  let restore: (() => void)[];

  beforeEach(() => {
    cwd = process.cwd();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    restore = [() => logSpy.mockRestore()];
  });

  afterEach(() => {
    process.chdir(cwd);
    restore.forEach((fn) => fn());
  });

  test("serves with the project's own vite, LAN-exposed, letting vite find its config", async () => {
    const root = projectWithVite("index.js", { ".": "./index.js" });
    try {
      process.chdir(root);
      const { dev } = await import("../src/commands/dev");
      await dev.parseAsync(["--port", "5180"], { from: "user" });

      const config = (globalThis as Record<string, any>).__couchKitViteConfig;
      expect(config.root).toBe(fs.realpathSync(root));
      expect(config.server).toMatchObject({ port: 5180, host: "0.0.0.0" });
      expect(config.configFile).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
