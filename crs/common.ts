// Shared runtime helpers for the rustmite CRS (mounts, subprocess, libCRS CLI wrappers).
//
// The run phase mounts (oss-crs convention): /out build outputs, /src source, /work
// scratch, /artifacts persisted outputs (PoVs + corpus). libCRS is a Python CLI on PATH;
// TypeScript drives it as a subprocess (no Python orchestration).

import { spawn, spawnSync, type SpawnOptions } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const OUT_DIR = "/out";
export const SRC_DIR = "/src";
export const WORK_DIR = "/work";
export const ARTIFACT_DIR = "/artifacts";
export const POV_DIR = path.join(ARTIFACT_DIR, "povs");
export const CORPUS_ROOT = process.env.CRS_CORPUS_DIR ?? path.join(ARTIFACT_DIR, "corpus");
export const AGENT_WORK_DIR = path.join(WORK_DIR, "agent");

export const LANGUAGE = process.env.FUZZING_LANGUAGE ?? "rust";
export const SANITIZER = process.env.SANITIZER ?? "address";

export function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`${ts} [rustmite] ${msg}`);
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a command to completion, capturing output. Never throws on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string } = {},
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: opts.timeoutMs,
    input: opts.input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: r.status ?? (r.signal ? 137 : 1),
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

/** Spawn a detached, backgrounded process (its own process group), logging to `logfile`. */
export function spawnBackground(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; logfile: string } = { logfile: "/dev/null" },
): number {
  fs.mkdirSync(path.dirname(opts.logfile), { recursive: true });
  const out = fs.openSync(opts.logfile, "a");
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    detached: true,
    stdio: ["ignore", out, out],
  } as SpawnOptions);
  child.unref();
  return child.pid ?? -1;
}

export function have(cmd: string): boolean {
  return run("bash", ["-lc", `command -v ${JSON.stringify(cmd)} >/dev/null 2>&1`]).code === 0;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- corpus / build dirs ----------------------------------------------------
export function corpusDir(harness: string): string {
  const d = path.join(CORPUS_ROOT, harness);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// build variant -> (libCRS output key, local download path)
export const BUILD_VARIANTS: Record<string, { key: string; local: string }> = {
  asan: { key: "build", local: OUT_DIR },
  debug: { key: "debug", local: "/work/debug-build" },
  coverage: { key: "coverage", local: "/work/coverage-build" },
};

function nonEmptyDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory() && fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

// --- libCRS CLI wrappers ----------------------------------------------------
export function libcrsDownloadBuildOutput(key: string, dst: string): boolean {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const r = run("libCRS", ["download-build-output", key, dst], { timeoutMs: 900_000 });
  if (r.code !== 0) log(`libCRS download-build-output ${key} rc=${r.code}: ${r.stderr.trim()}`);
  return r.code === 0;
}

/** Resolve a build variant dir: pre-existing local, else libCRS download, else asan. */
export function resolveBuildDir(variant: keyof typeof BUILD_VARIANTS, explicit?: string): string {
  if (explicit) return explicit;
  const { key, local } = BUILD_VARIANTS[variant];
  if (nonEmptyDir(local)) return local;
  if (libcrsDownloadBuildOutput(key, local) && nonEmptyDir(local)) return local;
  if (variant !== "asan") {
    log(`${variant} build unavailable; falling back to asan`);
    return resolveBuildDir("asan");
  }
  return local;
}

export function harnessBinary(buildDir: string, harness: string): string {
  return path.join(buildDir, harness);
}

/** libCRS run-pov: returns the retcode (non-zero == crash reproduced == verified PoV). */
export function libcrsRunPov(
  povPath: string,
  harness: string,
  responseDir: string,
  rebuildId?: number,
): number {
  fs.mkdirSync(responseDir, { recursive: true });
  const args = ["run-pov", povPath, responseDir, "--harness", harness];
  if (rebuildId !== undefined) args.push("--rebuild-id", String(rebuildId));
  const r = run("libCRS", args, { timeoutMs: 600_000 });
  const rcFile = path.join(responseDir, "retcode");
  if (fs.existsSync(rcFile)) {
    const rc = parseInt(fs.readFileSync(rcFile, "utf8").trim(), 10);
    if (!Number.isNaN(rc)) return rc;
  }
  return r.code;
}

export function libcrsSubmit(dataType: string, srcPath: string): boolean {
  const r = run("libCRS", ["submit", dataType, srcPath], { timeoutMs: 120_000 });
  if (r.code !== 0) log(`libCRS submit ${dataType} ${srcPath} rc=${r.code}: ${r.stderr.trim()}`);
  return r.code === 0;
}

export function libcrsFetch(dataType: string, dst: string): string[] {
  fs.mkdirSync(dst, { recursive: true });
  run("libCRS", ["fetch", dataType, dst], { timeoutMs: 120_000 });
  return listFiles(dst);
}

export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

export function harnessName(): string {
  const arg = process.argv[2];
  if (arg) return arg;
  const env = process.env.OSS_CRS_TARGET_HARNESS;
  if (env) return env;
  throw new Error("no harness name (argv[2] / OSS_CRS_TARGET_HARNESS)");
}
