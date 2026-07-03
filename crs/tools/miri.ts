#!/usr/bin/env node
// crs-miri (M2): run a GIVEN input through Miri (the dynamic UB interpreter) via a small
// #[test] harness, and classify the result. Miri catches UB that the ASan build misses
// (out-of-bounds, use-after-free, invalid alignment, uninit reads, invalid transmute,
// stacked-borrows violations). It is an ORACLE ON ONE EXECUTION — it does not generate
// inputs. The harness reads the input file from $MIRI_INPUT (disable-isolation lets Miri
// do the file read).
//
//   crs-miri test --crate-dir <c> --test <t> --input <file> [--pov-harness <H>]
//   crs-miri scan --crate-dir <c> --test <t> --corpus <dir>     # find a UB/panic input
//
// Classification (test + --pov-harness):
//   run-pov crashes the stock build      -> Tier 1: verified PoV (-> PoV dir).
//   Miri reports UB, stock build clean   -> Tier 3: SARIF bug-candidate (crs-sarif).
//   Miri clean                           -> no finding.

import * as fs from "node:fs";
import * as path from "node:path";
import { POV_DIR, WORK_DIR, run, have, log, libcrsRunPov } from "../common.js";

const NIGHTLY = process.env.CRS_MIRI_TOOLCHAIN ?? "nightly";
const MIRIFLAGS = process.env.MIRIFLAGS ?? "-Zmiri-disable-isolation";

interface MiriResult { code: number; out: string; kind: "ub" | "panic" | "unsupported" | "clean"; loc?: { file: string; line: number }; }

function cargoMiri(crateDir: string, test: string, env: NodeJS.ProcessEnv): MiriResult {
  const r = run("cargo", [`+${NIGHTLY}`, "miri", "test", test, "--", "--exact", "--nocapture"],
    { cwd: crateDir, env: { MIRIFLAGS, ...env }, timeoutMs: 60 * 60_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  let kind: MiriResult["kind"] = "clean";
  if (/error: Undefined Behavior|Undefined Behavior:|Miri detected/i.test(out)) kind = "ub";
  else if (/unsupported operation|can't call foreign function|Miri (cannot|does not support)|not supported by Miri/i.test(out)) kind = "unsupported";
  else if (/panicked at|thread '.*' panicked/i.test(out)) kind = "panic";
  else if (r.code !== 0 && /error(\[|:)/.test(out)) kind = "unsupported"; // compile/setup error, not a bug
  // Source location: Miri's `--> file.rs:line:col` (UB), or a Rust `panicked at file.rs:line`.
  let loc: MiriResult["loc"];
  const m = out.match(/-->\s+([^\s:]+\.rs):(\d+):\d+/) ?? out.match(/panicked at\s+([^\s:]+\.rs):(\d+):\d+/);
  if (m) loc = { file: m[1], line: parseInt(m[2], 10) };
  return { code: r.code, out, kind, loc };
}

function tail(out: string, n = 24): string {
  return out.split("\n").filter((l) => l.trim()).slice(-n).join("\n");
}

function test(crateDir: string, testName: string, input: string, povHarness?: string): number {
  if (!have("cargo-miri")) { console.error("[crs-miri] cargo-miri not available in this image."); return 2; }
  if (!fs.existsSync(input)) { console.error(`[crs-miri] input not found: ${input}`); return 2; }
  log(`miri test: crate=${crateDir} test=${testName} input=${input}`);
  const res = cargoMiri(crateDir, testName, { MIRI_INPUT: path.resolve(input) });

  if (res.kind === "unsupported") {
    console.log(`[crs-miri] ${testName}: Miri could not analyze this (FFI/syscall/compile). Not a finding. Tail:`);
    console.log(tail(res.out)); return 0;
  }
  if (res.kind === "clean") { console.log(`[crs-miri] ${testName}: CLEAN — no UB/panic on this input under Miri.`); return 0; }

  const locStr = res.loc ? `${res.loc.file}:${res.loc.line}` : "unknown location";
  console.log(`[crs-miri] ${testName}: Miri reported ${res.kind.toUpperCase()} at ${locStr}.`);
  console.log(tail(res.out, 12));

  if (!povHarness) {
    console.log(`[crs-miri] no --pov-harness; to tier this, run-pov the input against the libFuzzer harness.`);
    return 0;
  }
  const respDir = path.join(WORK_DIR, "agent", "miri", `resp_${path.basename(input)}`);
  const rc = libcrsRunPov(input, povHarness, respDir);
  if (rc !== 0) {
    // Tier 1: the same input crashes the stock ASan build -> verified PoV.
    fs.mkdirSync(POV_DIR, { recursive: true });
    const bytes = fs.readFileSync(input);
    const dst = path.join(POV_DIR, `miri_${testName}_${bytes.length}b.bin`);
    fs.writeFileSync(dst, bytes);
    fs.appendFileSync(path.join(WORK_DIR, "agent", "pov_provenance.tsv"),
      `miri-triage\t${path.basename(dst)}\t${bytes.length}b\tMiri ${res.kind} at ${locStr}, run-pov rc=${rc}\n`);
    console.log(`[crs-miri] TIER 1 VERIFIED PoV (run-pov rc=${rc}) -> ${dst}`);
  } else if (res.kind === "ub") {
    // Tier 3: real UB that the stock ASan build does not crash on -> SARIF bug-candidate.
    const rid = `MIRI-UB-${testName}`;
    console.log(`[crs-miri] TIER 3: Miri UB with no stock-build crash. Emitting a bug-candidate:`);
    console.log(`    crs-sarif --rule-id ${rid} --level error --message ` +
      `"Miri: undefined behavior at ${locStr}" --file ${res.loc?.file ?? "<file>"} --line ${res.loc?.line ?? 1}`);
    if (have("crs-sarif") && res.loc)
      run("crs-sarif", ["--rule-id", rid, "--level", "error", "--message",
        `Miri: undefined behavior at ${locStr}`, "--file", res.loc.file, "--line", String(res.loc.line)]);
  } else {
    console.log(`[crs-miri] ${testName}: Miri ${res.kind} but stock build did not crash (rc=0). ` +
      `Likely a checks-off panic — Tier-2 rebuild (build_project, TODO) or Tier-3 SARIF lead.`);
  }
  return 0;
}

function scan(crateDir: string, testName: string, corpus: string): number {
  if (!have("cargo-miri")) { console.error("[crs-miri] cargo-miri not available."); return 2; }
  if (!fs.existsSync(corpus)) { console.error(`[crs-miri] corpus not found: ${corpus}`); return 2; }
  log(`miri scan: crate=${crateDir} test=${testName} corpus=${corpus}`);
  const res = cargoMiri(crateDir, testName, { MIRI_CORPUS: path.resolve(corpus) });
  if (res.kind === "clean") { console.log(`[crs-miri] scan: CLEAN over ${corpus} — no UB/panic found.`); return 0; }
  if (res.kind === "unsupported") { console.log(`[crs-miri] scan: Miri unsupported here. Tail:\n${tail(res.out)}`); return 0; }
  console.log(`[crs-miri] scan: Miri hit ${res.kind.toUpperCase()} at ${res.loc ? `${res.loc.file}:${res.loc.line}` : "?"}. ` +
    `Have the harness print each filename so you can isolate the input, then: crs-miri test --input <that-file> --pov-harness <H>.`);
  console.log(tail(res.out, 16));
  return 0;
}

function main(): number {
  const [sub, ...argv] = process.argv.slice(2);
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i]; }
  if (sub === "test") {
    if (!opt["crate-dir"] || !opt.test || !opt.input) { console.error("crs-miri test: --crate-dir <c> --test <t> --input <file> [--pov-harness <H>]"); return 2; }
    return test(opt["crate-dir"], opt.test, opt.input, opt["pov-harness"]);
  }
  if (sub === "scan") {
    if (!opt["crate-dir"] || !opt.test || !opt.corpus) { console.error("crs-miri scan: --crate-dir <c> --test <t> --corpus <dir>"); return 2; }
    return scan(opt["crate-dir"], opt.test, opt.corpus);
  }
  console.error("crs-miri: usage: crs-miri test|scan ...");
  return 2;
}

process.exit(main());
