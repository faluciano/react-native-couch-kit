#!/usr/bin/env bun
/**
 * Coverage gate for the monorepo.
 *
 * Bun's built-in `coverageThreshold` is enforced per-file and also measures
 * cross-package files pulled in through `@couch-kit/*` workspace imports, which
 * makes a per-package threshold meaningless for packages that import `core`.
 *
 * This script runs `bun test --coverage` per package, parses the emitted lcov
 * report, keeps only each package's own `src/` files, and enforces a minimum
 * line/function coverage floor. Run with `--report` to print numbers without
 * failing (useful when ratcheting the floors up).
 *
 * Bun only reports files a test actually loaded, so a source file no test
 * imports would otherwise vanish from the denominator and leave the package
 * looking *better* covered. Such files are counted here as entirely uncovered,
 * using an estimate of their executable lines, and listed by name.
 */
import { spawnSync } from "bun";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

interface Floor {
  lines: number;
  functions: number;
}

// Minimum own-`src/` coverage each package must maintain. Ratchet these up as
// coverage improves; never lower them without a very good reason.
const FLOORS: Record<string, Floor> = {
  core: { lines: 82, functions: 88 },
  runtime: { lines: 95, functions: 90 },
  client: { lines: 80, functions: 88 },
  host: { lines: 95, functions: 90 },
  cli: { lines: 60, functions: 68 },
  devtools: { lines: 95, functions: 80 },
  display: { lines: 90, functions: 90 },
};

const reportOnly = process.argv.includes("--report");
const repoRoot = join(import.meta.dir, "..");

interface FileCov {
  lf: number;
  lh: number;
  fnf: number;
  fnh: number;
}

function parseOwnSrc(lcov: string, seen: Set<string>): FileCov {
  const totals: FileCov = { lf: 0, lh: 0, fnf: 0, fnh: 0 };
  let include = false;
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      const sf = line.slice(3).trim();
      // Only count the package's own source, not workspace imports
      // (../core/...) or temporary files created during tests (absolute paths).
      include = sf.startsWith("src/");
      if (include) seen.add(sf);
      continue;
    }
    if (!include) continue;
    if (line.startsWith("LF:")) totals.lf += Number(line.slice(3));
    else if (line.startsWith("LH:")) totals.lh += Number(line.slice(3));
    else if (line.startsWith("FNF:")) totals.fnf += Number(line.slice(4));
    else if (line.startsWith("FNH:")) totals.fnh += Number(line.slice(4));
  }
  return totals;
}

/** Every `.ts`/`.tsx` file under `dir`, relative to `root`, as lcov names them. */
function sourceFiles(root: string, dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(root, path));
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      files.push(relative(root, path));
    }
  }
  return files;
}

const transpiler = new Bun.Transpiler({ loader: "tsx" });

/**
 * Executable lines in a file Bun never instrumented: what remains once types
 * and comments are stripped, minus module wiring. An estimate — Bun's own
 * count for a loaded file differs slightly — but the right order of magnitude,
 * which is all an untested file's penalty needs. A pure re-export barrel
 * comes out at zero and costs nothing.
 */
function estimatedLines(path: string): number {
  const js = transpiler
    .transformSync(readFileSync(path, "utf8"))
    // Imports and re-exports, including ones spread over several lines.
    .replace(/^\s*(import|export)\b[^;]*?\bfrom\s*["'][^"']+["'];?/gms, "")
    .replace(/^\s*import\s*["'][^"']+["'];?/gm, "")
    .replace(/^\s*export\s*\{[^}]*\};?/gm, "");
  return js.split("\n").filter((line) => line.trim() !== "").length;
}

function pct(hit: number, found: number): number {
  return found === 0 ? 100 : (hit / found) * 100;
}

const overall: FileCov = { lf: 0, lh: 0, fnf: 0, fnh: 0 };
const rows: string[] = [];
let failed = false;

for (const pkg of Object.keys(FLOORS)) {
  const cwd = join(repoRoot, "packages", pkg);
  const covDir = mkdtempSync(join(tmpdir(), `covgate-${pkg}-`));
  const result = spawnSync(
    [
      "bun",
      "test",
      "--coverage",
      "--coverage-reporter=lcov",
      `--coverage-dir=${covDir}`,
    ],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );

  if (!result.success) {
    console.error(`\n✗ ${pkg}: test run failed\n`);
    console.error(result.stderr.toString());
    rmSync(covDir, { recursive: true, force: true });
    process.exit(1);
  }

  const lcov = readFileSync(join(covDir, "lcov.info"), "utf8");
  rmSync(covDir, { recursive: true, force: true });

  const seen = new Set<string>();
  const cov = parseOwnSrc(lcov, seen);
  const untested: string[] = [];
  for (const file of sourceFiles(cwd, join(cwd, "src"))) {
    if (seen.has(file)) continue;
    const lines = estimatedLines(join(cwd, file));
    if (lines === 0) continue;
    cov.lf += lines;
    untested.push(`${file} (~${lines} lines)`);
  }
  overall.lf += cov.lf;
  overall.lh += cov.lh;
  overall.fnf += cov.fnf;
  overall.fnh += cov.fnh;

  const lines = pct(cov.lh, cov.lf);
  const funcs = pct(cov.fnh, cov.fnf);
  const floor = FLOORS[pkg]!;
  const ok = lines >= floor.lines && funcs >= floor.functions;
  if (!ok && !reportOnly) failed = true;

  rows.push(
    `${ok ? "✓" : "✗"} ${pkg.padEnd(9)} lines ${lines.toFixed(2).padStart(6)}% ` +
      `(floor ${floor.lines}%)  funcs ${funcs.toFixed(2).padStart(6)}% ` +
      `(floor ${floor.functions}%)`,
  );
  for (const file of untested) {
    rows.push(`    not loaded by any test: ${file}`);
  }
}

const overallLines = pct(overall.lh, overall.lf);
const overallFuncs = pct(overall.fnh, overall.fnf);

console.log("\nCoverage (own src/ only)\n" + "-".repeat(64));
for (const row of rows) console.log(row);
console.log("-".repeat(64));
console.log(
  `  overall   lines ${overallLines.toFixed(2).padStart(6)}%          ` +
    `funcs ${overallFuncs.toFixed(2).padStart(6)}%`,
);

if (failed) {
  console.error("\nCoverage gate failed: a package dropped below its floor.");
  process.exit(1);
}
if (reportOnly) {
  console.log("\n(report mode: floors not enforced)");
}
