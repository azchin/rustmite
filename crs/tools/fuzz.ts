#!/usr/bin/env node
// crs-fuzz: run a libFuzzer harness (fork mode) — long-running background or foreground.
// Ported from crs-bug-finding-reference/crs/tools/fuzzer.py. cargo-fuzz / the AFL & honggfuzz
// emit standard libFuzzer binaries, so this is language-neutral.
//
//   crs-fuzz start   --harness H          launch ONE background fuzzer (-reload=1)
//   crs-fuzz add-seeds --harness H <dir>  coverage-merge <dir> into the live corpus
//   crs-fuzz status  --harness H
//   crs-fuzz stop    --harness H
//   crs-fuzz         --harness H --seconds N   foreground bounded run
//   crs-fuzz         --harness H --merge        minimize the corpus (-merge=1)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import {
  POV_DIR, WORK_DIR, corpusDir, resolveBuildDir, harnessBinary, run, spawnBackground,
  alive, have, log, listFiles,
} from "../common.js";

const RUNDIR = process.env.CRS_FUZZ_RUNDIR ?? path.join(WORK_DIR, "agent", "fuzz");
const CRASH_PREFIXES = ["crash", "oom", "timeout", "leak"];

function slug(h: string): string { return h.replace(/[^A-Za-z0-9_.-]/g, "_"); }
function pidfile(h: string): string { return path.join(RUNDIR, `${slug(h)}.json`); }
function logfile(h: string): string { return path.join(RUNDIR, `${slug(h)}.log`); }

function cpus(): number {
  const s = (process.env.OSS_CRS_CPUSET ?? "").trim();
  if (s) {
    let n = 0;
    for (const part of s.split(",")) {
      if (part.includes("-")) { const [a, b] = part.split("-").map(Number); n += b - a + 1; }
      else if (part.trim()) n += 1;
    }
    if (n > 0) return n;
  }
  return Math.max(1, os.cpus().length);
}

function count(dir: string): number {
  try { return fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile()).length; }
  catch { return 0; }
}
function countCrashes(dir: string): number {
  try {
    return fs.readdirSync(dir).filter((f) => CRASH_PREFIXES.includes(f.split("-", 1)[0])).length;
  } catch { return 0; }
}
function seedFromBoot(dst: string): void {
  const src = process.env.CRS_SEED_DIR ?? "/work/seeds";
  for (const f of listFiles(src)) {
    try {
      const buf = fs.readFileSync(f);
      const name = crypto.createHash("sha1").update(buf).digest("hex");
      const to = path.join(dst, name);
      if (!fs.existsSync(to)) fs.writeFileSync(to, buf);
    } catch { /* ignore */ }
  }
}

function buildCmd(hb: string, corpus: string, seconds: number, jobs: number,
                  extra: string[]): string[] {
  const cmd = [
    hb, corpus,
    `-artifact_prefix=${POV_DIR}/`,
    `-fork=${jobs}`, "-reload=1",
    "-ignore_crashes=1", "-ignore_timeouts=1", "-ignore_ooms=1",
    "-detect_leaks=0", "-close_fd_mask=3",
  ];
  if (seconds > 0) cmd.push(`-max_total_time=${seconds}`);
  return cmd.concat(extra);
}

function readState(h: string): { pid: number; started: number; corpus_at_start: number } | null {
  try { return JSON.parse(fs.readFileSync(pidfile(h), "utf8")); } catch { return null; }
}

// engine -> build variant holding that engine's instrumented $OUT harness binary.
function engineBuild(engine: string): "asan" | "afl" | "honggfuzz" {
  return engine === "afl" ? "afl" : engine === "honggfuzz" ? "honggfuzz" : "asan";
}

function start(h: string, extra: string[], engine = "libfuzzer"): number {
  const st = readState(h);
  if (st && alive(st.pid)) {
    log(`fuzzer already running for ${h} (pid=${st.pid}); use add-seeds to feed it`);
    return 1;
  }
  const bd = resolveBuildDir(engineBuild(engine));
  const hb = harnessBinary(bd, h);
  if (!fs.existsSync(hb)) { log(`${engine} harness not found: ${hb} (built by the ${engine === "libfuzzer" ? "build" : engine + "-build"} phase)`); return 2; }
  const corpus = corpusDir(h);
  fs.mkdirSync(POV_DIR, { recursive: true });
  seedFromBoot(corpus);
  const jobs = cpus();
  fs.mkdirSync(RUNDIR, { recursive: true });

  if (engine === "libfuzzer") {
    const cmd = buildCmd(hb, corpus, 0, jobs, extra);
    const pid = spawnBackground(cmd[0], cmd.slice(1), { logfile: logfile(h) });
    fs.writeFileSync(pidfile(h), JSON.stringify({ pid, started: Date.now(), corpus_at_start: count(corpus) }));
    log(`started libFuzzer for ${h}: pid=${pid}, -fork=${jobs}, corpus=${count(corpus)}, log ${logfile(h)}. Feed it with crs-fuzz add-seeds.`);
    return 0;
  }

  // AFL / honggfuzz: same run-pov-compatible OSS-Fuzz binary, driven by its native fuzzer.
  // Crashes are routed to the PoV dir (auto-submitted). Best-effort — gated on tool presence.
  if (count(corpus) === 0) fs.writeFileSync(path.join(corpus, "seed0"), Buffer.from([0]));
  let cmd: string[];
  let env: NodeJS.ProcessEnv = {};
  if (engine === "afl") {
    if (!have("afl-fuzz")) { log("afl-fuzz not available in this runner"); return 3; }
    const out = path.join(RUNDIR, `afl-${slug(h)}`); fs.mkdirSync(out, { recursive: true });
    env = { AFL_SKIP_CPUFREQ: "1", AFL_NO_UI: "1", AFL_SKIP_BIN_CHECK: "1", AFL_AUTORESUME: "1" };
    cmd = ["afl-fuzz", "-i", corpus, "-o", out, "--", hb];
    // sync AFL's crashes into the PoV dir (AFL has no libFuzzer artifact_prefix).
    spawnBackground("bash", ["-c",
      `while true; do cp -n ${out}/*/crashes/id* ${POV_DIR}/ 2>/dev/null; sleep 10; done`],
      { logfile: "/dev/null" });
  } else { // honggfuzz
    const hf = path.join(bd, "honggfuzz");
    if (!fs.existsSync(hf)) { log(`honggfuzz runner not found at ${hf}`); return 3; }
    cmd = [hf, "-n", String(jobs), "--persistent", "-i", corpus, "-o", corpus, "--crashdir", POV_DIR, "--", hb];
  }
  const pid = spawnBackground(cmd[0], cmd.slice(1), { cwd: corpus, env, logfile: logfile(h) });
  fs.writeFileSync(pidfile(h), JSON.stringify({ pid, started: Date.now(), corpus_at_start: count(corpus) }));
  log(`started ${engine} for ${h}: pid=${pid}, jobs=${jobs}, corpus=${count(corpus)}, log ${logfile(h)}. Crashes -> PoV dir.`);
  return 0;
}

function status(h: string): number {
  const corpus = corpusDir(h);
  const n = count(corpus), crashes = countCrashes(POV_DIR);
  const st = readState(h);
  if (!st) { console.log(`[crs-fuzz] ${h}: no background fuzzer running. corpus=${n}, crashes=${crashes}.`); return 0; }
  const elapsed = ((Date.now() - st.started) / 1000).toFixed(0);
  if (alive(st.pid)) {
    console.log(`[crs-fuzz] ${h}: RUNNING pid=${st.pid} for ${elapsed}s; corpus=${n} (+${n - st.corpus_at_start} since start), crashes=${crashes}; log ${logfile(h)}. Feed it with crs-fuzz add-seeds.`);
  } else {
    try { fs.unlinkSync(pidfile(h)); } catch { /* */ }
    console.log(`[crs-fuzz] ${h}: fuzzer not running (ended after ~${elapsed}s). corpus=${n}, crashes=${crashes}.`);
  }
  return 0;
}

function stop(h: string): number {
  const st = readState(h);
  if (!st) { console.log(`[crs-fuzz] ${h}: no fuzzer to stop.`); return 0; }
  if (alive(st.pid)) { try { process.kill(-st.pid, "SIGTERM"); } catch { try { process.kill(st.pid, "SIGTERM"); } catch { /* */ } } }
  try { fs.unlinkSync(pidfile(h)); } catch { /* */ }
  console.log(`[crs-fuzz] stopped ${h}; corpus=${count(corpusDir(h))}, crashes=${countCrashes(POV_DIR)}`);
  return 0;
}

function addSeeds(h: string, dir: string): number {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { log(`add-seeds: dir not found: ${dir}`); return 2; }
  const bd = resolveBuildDir("asan");
  const hb = harnessBinary(bd, h);
  const corpus = corpusDir(h);
  const before = count(corpus);
  run(hb, [corpus, dir, "-merge=1", "-detect_leaks=0", "-close_fd_mask=3"], { timeoutMs: 900_000 });
  const after = count(corpus);
  console.log(`[crs-fuzz] add-seeds ${h}: corpus ${before} -> ${after} (+${after - before}); the running fuzzer reloads them.`);
  return after;
}

function foreground(h: string, seconds: number, merge: boolean, extra: string[]): number {
  const bd = resolveBuildDir("asan");
  const hb = harnessBinary(bd, h);
  const corpus = corpusDir(h);
  fs.mkdirSync(POV_DIR, { recursive: true });
  seedFromBoot(corpus);
  if (merge) {
    const tmp = fs.mkdtempSync(path.join(path.dirname(corpus), `.merge-${slug(h)}-`));
    run(hb, [tmp, corpus, "-merge=1", "-detect_leaks=0", "-close_fd_mask=3"], { timeoutMs: 900_000 });
    const merged = listFiles(tmp);
    if (merged.length) {
      for (const f of fs.readdirSync(corpus)) { const p = path.join(corpus, f); if (fs.statSync(p).isFile()) fs.unlinkSync(p); }
      for (const f of merged) fs.renameSync(f, path.join(corpus, path.basename(f)));
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`[crs-fuzz] merge ${h}: -> ${count(corpus)} inputs`);
    return 0;
  }
  const cmd = buildCmd(hb, corpus, seconds, cpus(), extra);
  const r = run(cmd[0], cmd.slice(1), { timeoutMs: (seconds + 120) * 1000 });
  console.log(`[crs-fuzz] ${h}: ${countCrashes(POV_DIR)} crash artifact(s); corpus=${count(corpus)}`);
  return r.code;
}

function parse(argv: string[]): { harness: string; rest: string[]; opts: Record<string, string> } {
  const opts: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--harness") opts.harness = argv[++i];
    else if (a === "--engine") opts.engine = argv[++i];
    else if (a === "--seconds") opts.seconds = argv[++i];
    else if (a === "--merge") opts.merge = "1";
    else if (a === "--dict") rest.push(`-dict=${argv[++i]}`);
    else if (a === "--max-len") rest.push(`-max_len=${argv[++i]}`);
    else rest.push(a);
  }
  return { harness: opts.harness ?? process.env.OSS_CRS_TARGET_HARNESS ?? "", rest, opts };
}

function main(): number {
  const [sub, ...argv] = process.argv.slice(2);
  const lifecycle = ["start", "status", "stop", "add-seeds"];
  if (lifecycle.includes(sub)) {
    const { harness, rest, opts } = parse(argv);
    if (!harness) { console.error("crs-fuzz: no --harness"); return 2; }
    if (sub === "start") return start(harness, rest, opts.engine ?? "libfuzzer");
    if (sub === "status") return status(harness);
    if (sub === "stop") return stop(harness);
    if (sub === "add-seeds") { const dir = rest[0]; if (!dir) { console.error("crs-fuzz add-seeds: missing <dir>"); return 2; } return addSeeds(harness, dir) >= 0 ? 0 : 1; }
  }
  const { harness, rest, opts } = parse([sub, ...argv].filter(Boolean));
  if (!harness) { console.error("crs-fuzz: no --harness"); return 2; }
  return foreground(harness, parseInt(opts.seconds ?? "300", 10), opts.merge === "1", rest);
}

process.exit(main());
