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
 */
import { spawnSync } from "bun";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Floor {
  lines: number;
  functions: number;
}

// Minimum own-`src/` coverage each package must maintain. Ratchet these up as
// coverage improves; never lower them without a very good reason.
const FLOORS: Record<string, Floor> = {
  core: { lines: 82, functions: 88 },
  runtime: { lines: 95, functions: 90 },
  client: { lines: 34, functions: 70 },
  host: { lines: 79, functions: 75 },
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

function parseOwnSrc(lcov: string): FileCov {
  const totals: FileCov = { lf: 0, lh: 0, fnf: 0, fnh: 0 };
  let include = false;
  for (const line of lcov.split("\n")) {
    if (line.startsWith("SF:")) {
      const sf = line.slice(3).trim();
      // Only count the package's own source, not workspace imports
      // (../core/...) or temporary files created during tests (absolute paths).
      include = sf.startsWith("src/");
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

  const cov = parseOwnSrc(lcov);
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
