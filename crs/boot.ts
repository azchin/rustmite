// Boot sequence for the run phase: auth, fetch evidence, download build+src, write
// CLAUDE.md, install skills, register auto-submit dirs. Uses the libCRS CLI (no Python).

import * as fs from "node:fs";
import * as path from "node:path";
import {
  OUT_DIR, SRC_DIR, WORK_DIR, POV_DIR, ARTIFACT_DIR, corpusDir, run, spawnBackground,
  libcrsFetch, libcrsDownloadBuildOutput, listFiles, log, LANGUAGE, SANITIZER,
} from "./common.js";
import { ASSET_ROOT, fillPlaceholders } from "./agent.js";

export interface RunContext {
  harness: string;
  sourceDir: string;
  target: string;
  diffs: string[];
  seeds: string[];
  bugCandidates: string[];
}

/** Point the Agent SDK at the right LLM endpoint. See notes/agent-sdk-reference.md (auth). */
export function configureAuth(): void {
  const proxyUrl = process.env.OSS_CRS_LLM_API_URL || process.env.EXTERNAL_LITELLM_API_BASE || "";
  const keyFile = process.env.OSS_CRS_LLM_API_KEY_FILE;
  const key =
    (keyFile && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "") ||
    process.env.OSS_CRS_LLM_API_KEY ||
    process.env.EXTERNAL_LITELLM_API_KEY ||
    "";
  if (proxyUrl && key) {
    // LiteLLM proxy path (definitely supported by the SDK).
    process.env.ANTHROPIC_BASE_URL = proxyUrl;
    process.env.ANTHROPIC_AUTH_TOKEN = key;
    log(`auth: LiteLLM proxy ${proxyUrl}`);
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    // OAuth path — works if the SDK honors it (verify at first run; else set a proxy).
    log("auth: CLAUDE_CODE_OAUTH_TOKEN (verify the Agent SDK honors it)");
  } else if (process.env.ANTHROPIC_API_KEY) {
    log("auth: ANTHROPIC_API_KEY");
  } else {
    log("WARN: no LLM auth configured (proxy / OAuth / API key all absent)");
  }
}

function fetchInputs(): { diffs: string[]; seeds: string[]; bugCandidates: string[] } {
  const diffs = libcrsFetch("diff", path.join(WORK_DIR, "diffs")).filter((f) => {
    try { return fs.readFileSync(f, "utf8").trim().length > 0; } catch { return false; }
  });
  const seeds = libcrsFetch("seed", path.join(WORK_DIR, "seeds"));
  const bugCandidates = libcrsFetch("bug-candidate", path.join(WORK_DIR, "bug-candidates"));
  log(`fetched: ${diffs.length} diff(s), ${seeds.length} seed(s), ${bugCandidates.length} bug-candidate(s)`);
  return { diffs, seeds, bugCandidates };
}

function setupSource(): string {
  run("git", ["config", "--global", "--add", "safe.directory", "*"]);
  if (!libcrsDownloadBuildOutput("src", SRC_DIR)) throw new Error("failed to download /src");
  const dir = fs.realpathSync(SRC_DIR);
  if (!fs.existsSync(path.join(dir, ".git"))) {
    log(`git init ${dir}`);
    run("git", ["init"], { cwd: dir, timeoutMs: 60_000 });
    run("git", ["add", "-A"], { cwd: dir, timeoutMs: 120_000 });
    run("git", ["-c", "user.name=crs", "-c", "user.email=crs@local", "commit", "-m", "initial source"], { cwd: dir, timeoutMs: 120_000 });
  }
  return dir;
}

function registerSubmitDirs(harness: string): void {
  fs.mkdirSync(POV_DIR, { recursive: true });
  const corpus = corpusDir(harness);
  // libCRS register-submit-dir blocks (runs the watch loop inline) — background it.
  spawnBackground("libCRS", ["register-submit-dir", "pov", POV_DIR], { logfile: "/work/agent/submit-pov.log" });
  spawnBackground("libCRS", ["register-submit-dir", "seed", corpus], { logfile: "/work/agent/submit-seed.log" });
  log(`auto-submit watchers: pov -> ${POV_DIR}, seed -> ${corpus}`);
}

function installSkills(sourceDir: string, vars: Record<string, string>): void {
  const src = path.join(ASSET_ROOT, "skills");
  const dst = path.join(sourceDir, ".claude", "skills");
  if (!fs.existsSync(src)) return;
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const sd = path.join(src, name);
    if (!fs.statSync(sd).isDirectory()) continue;
    fs.cpSync(sd, path.join(dst, name), { recursive: true });
    const md = path.join(dst, name, "SKILL.md");
    if (fs.existsSync(md)) fs.writeFileSync(md, fillPlaceholders(fs.readFileSync(md, "utf8"), vars));
  }
  log(`installed skills: ${fs.readdirSync(dst).join(", ")}`);
}

function writeClaudeMd(sourceDir: string, vars: Record<string, string>): void {
  const tmpl = path.join(ASSET_ROOT, "CLAUDE.md");
  if (!fs.existsSync(tmpl)) return;
  fs.writeFileSync(path.join(sourceDir, "CLAUDE.md"), fillPlaceholders(fs.readFileSync(tmpl, "utf8"), vars));
}

export function boot(harness: string): RunContext {
  process.umask(0o000);
  log(`Starting rustmite: harness=${harness} language=${LANGUAGE} sanitizer=${SANITIZER}`);
  configureAuth();
  const { diffs, seeds, bugCandidates } = fetchInputs();
  registerSubmitDirs(harness);
  if (!libcrsDownloadBuildOutput("build", OUT_DIR)) throw new Error("failed to download build outputs");
  const sourceDir = setupSource();
  const target = process.env.OSS_CRS_TARGET ?? path.basename(sourceDir);
  const vars: Record<string, string> = {
    harness, source_dir: sourceDir, language: LANGUAGE, sanitizer: SANITIZER,
    build_dir: OUT_DIR, pov_dir: POV_DIR, work_dir: path.join(WORK_DIR, "agent"),
    corpus_dir: corpusDir(harness), target,
    seed_dir: seeds.length ? path.dirname(seeds[0]) : "",
  };
  fs.mkdirSync(path.join(WORK_DIR, "agent"), { recursive: true });
  writeClaudeMd(sourceDir, vars);
  installSkills(sourceDir, vars);
  return { harness, sourceDir, target, diffs, seeds, bugCandidates };
}
