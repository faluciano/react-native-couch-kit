import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * Sentinel thrown by the mocked process.exit so the command's `catch`
 * stops executing (mirroring a real exit) and the test can assert on it.
 */
class ExitError extends Error {
  constructor(public code?: number) {
    super(`process.exit(${code})`);
  }
}

describe("init command", () => {
  let tmpDir: string;
  let originalCwd: string;
  let logs: string[];
  let errors: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let restore: (() => void)[];

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "couch-kit-init-"));
    process.chdir(tmpDir);

    logs = [];
    errors = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      },
    );
    const errSpy = spyOn(console, "error").mockImplementation(
      (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
      },
    );
    restore = [() => logSpy.mockRestore(), () => errSpy.mockRestore()];
  });

  afterEach(() => {
    restore.forEach((fn) => fn());
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("scaffolds a complete Vite + React + TS project", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const projectDir = path.join(tmpDir, "my-controller");
    const expectedFiles = [
      "package.json",
      "tsconfig.json",
      "tsconfig.node.json",
      "vite.config.ts",
      "index.html",
      ".gitignore",
      "src/main.tsx",
      "src/App.tsx",
      "src/index.css",
      "src/reducer.ts",
    ];
    for (const file of expectedFiles) {
      expect(
        fs.existsSync(path.join(projectDir, file)),
        `expected ${file} to be scaffolded`,
      ).toBe(true);
    }
  });

  test("writes a valid package.json wired to @couch-kit/client", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "my-controller", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.name).toBe("my-controller");
    expect(pkg.type).toBe("module");
    expect(pkg.dependencies).toHaveProperty("@couch-kit/client");
    expect(pkg.scripts.dev).toBe("vite");
    // tsconfig.json must be valid JSON too
    expect(() =>
      JSON.parse(
        fs.readFileSync(
          path.join(tmpDir, "my-controller", "tsconfig.json"),
          "utf-8",
        ),
      ),
    ).not.toThrow();
  });

  test("declares every @couch-kit package the scaffold imports", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const projectDir = path.join(tmpDir, "my-controller");
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectDir, "package.json"), "utf-8"),
    );

    const imported = new Set<string>();
    for (const file of fs.readdirSync(path.join(projectDir, "src"))) {
      const source = fs.readFileSync(
        path.join(projectDir, "src", file),
        "utf-8",
      );
      for (const match of source.matchAll(/from ["'](@couch-kit\/[\w-]+)["']/g))
        imported.add(match[1]!);
    }

    // The sample reducer imports core and App.tsx imports client.
    expect([...imported].sort()).toEqual([
      "@couch-kit/client",
      "@couch-kit/core",
    ]);
    for (const name of imported) {
      expect(
        pkg.dependencies,
        `expected ${name} to be a dependency of the scaffold`,
      ).toHaveProperty([name]);
    }
  });

  test("tracks the latest @couch-kit releases instead of a stale range", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "my-controller", "package.json"),
        "utf-8",
      ),
    );
    // A 0.x caret range (e.g. ^0.8.0) never reaches later 0.x minors.
    expect(pkg.dependencies["@couch-kit/client"]).toBe("latest");
    expect(pkg.dependencies["@couch-kit/core"]).toBe("latest");
  });

  test("pins a vite major that @vitejs/plugin-react supports", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const pkg = JSON.parse(
      fs.readFileSync(
        path.join(tmpDir, "my-controller", "package.json"),
        "utf-8",
      ),
    );
    // @vitejs/plugin-react 6 has a peer dependency on vite ^8.
    expect(pkg.devDependencies["@vitejs/plugin-react"]).toBe("^6.0.0");
    expect(pkg.devDependencies.vite).toBe("^8.0.0");
  });

  test("sample reducer references @couch-kit/core and handles SCORE", async () => {
    const { initCommand } = await import("../src/commands/init");
    await initCommand.parseAsync(["my-controller"], { from: "user" });

    const reducer = fs.readFileSync(
      path.join(tmpDir, "my-controller", "src", "reducer.ts"),
      "utf-8",
    );
    expect(reducer).toContain('from "@couch-kit/core"');
    expect(reducer).toContain('case "SCORE"');
    expect(reducer).toContain("export const gameReducer");
    expect(reducer).toContain("export const initialState");
  });

  test("defaults the project name to web-controller", async () => {
    const { initCommand } = await import("../src/commands/init");
    // No positional arg → commander applies the "web-controller" default.
    await initCommand.parseAsync([], { from: "user" });

    expect(fs.existsSync(path.join(tmpDir, "web-controller"))).toBe(true);
  });

  test("fails when the target directory already exists", async () => {
    fs.mkdirSync(path.join(tmpDir, "taken"));

    const exitSpy = spyOn(process, "exit").mockImplementation(((
      code?: number,
    ) => {
      throw new ExitError(code);
    }) as never);
    restore.push(() => exitSpy.mockRestore());

    const { initCommand } = await import("../src/commands/init");

    let thrown: unknown;
    try {
      await initCommand.parseAsync(["taken"], { from: "user" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(ExitError);
    expect((thrown as ExitError).code).toBe(1);
    expect(errors.join("\n")).toContain("already exists");
  });
});
