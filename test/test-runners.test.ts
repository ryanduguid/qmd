import { afterEach, describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const repo = new URL("..", import.meta.url);
// Bun also runs this suite; the stand-ins need Node's file execution semantics.
const node = process.versions.bun
  ? execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim()
  : process.execPath;
const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "qmd test runners-"));
  fixtures.push(root);
  const bin = join(root, "Program Files", "nodejs");
  mkdirSync(bin, { recursive: true });
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = join(bin, `node${suffix}`);
  copyFileSync(node, executable);
  for (const tool of ["bun", "sh"]) linkSync(executable, join(bin, `${tool}${suffix}`));
  const log = join(root, "stages.jsonl");
  writeFileSync(log, "");

  function write(path: string, source: string, mode = 0o644) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source, { mode });
  }
  function stage(label: string) {
    return `import { appendFileSync } from 'node:fs';
    appendFileSync(process.env.QMD_RUNNER_LOG, JSON.stringify({
      stage: ${JSON.stringify(label)}, ci: process.env.CI, args: process.argv.slice(2)
    }) + '\\n');
    if (process.env.QMD_RUNNER_FAIL === ${JSON.stringify(label)}) process.exit(23);`;
  }
  for (const script of ["test-all.mjs", "package-smoke.mjs"]) {
    write(`scripts/${script}`, readFileSync(new URL(`scripts/${script}`, repo), "utf8"));
  }
  write("package.json", JSON.stringify({ type: "module", files: ["dist"], bin: { qmd: "bin/qmd" } }));
  write("node_modules/typescript/bin/tsc", stage("typecheck"));
  write("node_modules/vitest/vitest.mjs", stage("vitest"));
  write("test", stage("bun tests"));
  write("scripts/build.mjs", stage("build"));
  write("scripts/check-package-grammars.mjs", stage("grammars"));
  write("dist/index.js", "");
  write("dist/index.d.ts", "");
  write("dist/cli/qmd.js", stage("compiled CLI"));
  write("bin/qmd", stage("package wrapper"), 0o755);

  return {
    root,
    removeTool(tool: string) { rmSync(join(bin, `${tool}${suffix}`)); },
    run(script: string, extraEnv: Record<string, string> = {}) {
      const result = spawnSync(executable, [join(root, "scripts", script)], {
        cwd: root, encoding: "utf8", timeout: 30_000,
        env: { ...process.env, PATH: bin, QMD_RUNNER_LOG: log, QMD_RUNNER_FAIL: "", QMD_SKIP_BUN_SMOKE: "", CI: "", ...extraEnv },
      });
      expect(result.error).toBeUndefined();
      const stages = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
      return { ...result, stages, labels: stages.map(row => row.stage) };
    },
  };
}

const packageStages = ["build", "grammars", "compiled CLI", "package wrapper", "compiled CLI"];
for (const script of ["test-all.mjs", "package-smoke.mjs"]) {
  describe(script, () => {
    test("runs each stage through paths containing spaces", () => {
      const result = fixture().run(script);
      expect(result.status, result.stderr).toBe(0);
      const prefix = script === "test-all.mjs" ? ["typecheck", "vitest", "bun tests"] : [];
      expect(result.labels).toEqual([...prefix, ...packageStages]);
      for (const row of result.stages.filter(row => ["vitest", "bun tests"].includes(row.stage))) {
        expect(row.ci).toBe("true");
      }
      if (prefix.length) expect(result.stages[0].args).toEqual(["-p", "tsconfig.build.json", "--noEmit"]);
    });

    test("preserves a child's failure status and stops later stages", () => {
      const label = script === "test-all.mjs" ? "vitest" : "build";
      const result = fixture().run(script, { QMD_RUNNER_FAIL: label });
      expect(result.status).toBe(23);
      expect(result.labels).toEqual(label === "vitest" ? ["typecheck", "vitest"] : ["build"]);
    });

    test("reports a missing executable and stops later stages", () => {
      const f = fixture();
      const tool = script === "test-all.mjs" ? "bun" : "sh";
      f.removeTool(tool);
      const result = f.run(script);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(tool);
      expect(result.stderr).toContain("ENOENT");
      expect(result.labels).toEqual(tool === "bun" ? ["typecheck", "vitest"] : packageStages.slice(0, 3));
    });
  });
}

test("package smoke honours the explicit Bun skip", () => {
  const f = fixture();
  f.removeTool("bun");
  const result = f.run("package-smoke.mjs", { QMD_SKIP_BUN_SMOKE: "1" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.labels).toEqual(packageStages.slice(0, -1));
});

test("package smoke checks executable permissions only on platforms with execute bits", () => {
  const f = fixture();
  chmodSync(join(f.root, "bin/qmd"), 0o644);
  const result = f.run("package-smoke.mjs");
  expect(result.status, result.stderr).toBe(process.platform === "win32" ? 0 : 1);
  if (process.platform !== "win32") expect(result.stderr).toContain("not executable");
});
