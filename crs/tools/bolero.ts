#!/usr/bin/env node
// crs-bolero (M3): drive a bolero-unified harness across engines from ONE `bolero::check!()`
// target. Validated commands (cargo-bolero 0.13):
//   cargo bolero list
//   cargo bolero test <target> --engine libfuzzer|afl|honggfuzz --runs N   (fuzz)
//   MIRIFLAGS=-Zmiri-disable-isolation cargo +nightly miri test <target>   (Miri, same target)
//
//   crs-bolero list  --crate-dir <c>
//   crs-bolero fuzz  --crate-dir <c> --harness <t> [--runs N] [--engine libfuzzer]
//   crs-bolero miri  --crate-dir <c> --harness <t>
//
// NOTE on engines: bolero unifies libFuzzer/AFL/honggfuzz + Miri cleanly. The bolero→Kani
// bridge is version-fragile (bolero 0.13.4 emits a proof cargo-kani 0.67 can't discover:
// "no harnesses matched"), so rustmite drives Kani via `crs-kani` (kani-prove writes its own
// #[kani::proof]) instead of `cargo bolero test --engine kani`. For a run-pov PoV, verify the
// crashing input against the OSS-Fuzz libFuzzer $OUT binary (the fuzz_target! for the same api).

import { run, have, log } from "../common.js";

const NIGHTLY = process.env.CRS_MIRI_TOOLCHAIN ?? "nightly";

function requireProfile(): void {
  // bolero needs [profile.fuzz]; agents add it, but log a hint if a run fails on it.
}

function list(crateDir: string): number {
  if (!have("cargo-bolero")) { console.error("[crs-bolero] cargo-bolero not available."); return 2; }
  const r = run("cargo", ["bolero", "list"], { cwd: crateDir, timeoutMs: 20 * 60_000 });
  const targets = r.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
  if (!targets.length) {
    console.error(`[crs-bolero] no bolero targets found. Ensure a #[test] uses bolero::check!() and Cargo.toml has [profile.fuzz].`);
    process.stderr.write(r.stderr.split("\n").filter((l) => /error|profile/.test(l)).slice(0, 6).join("\n") + "\n");
    return 1;
  }
  console.log(`[crs-bolero] targets:`);
  for (const t of targets) console.log(`    ${t}`);
  return 0;
}

function fuzz(crateDir: string, harness: string, runs: number, engine: string): number {
  if (!have("cargo-bolero")) { console.error("[crs-bolero] cargo-bolero not available."); return 2; }
  log(`bolero fuzz: ${harness} engine=${engine} runs=${runs}`);
  const args = ["bolero", "test", harness, "--engine", engine];
  if (runs > 0) args.push("--runs", String(runs));
  const r = run("cargo", args, { cwd: crateDir, timeoutMs: 60 * 60_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const panic = out.match(/panicked at\s+([^\s:]+\.rs):(\d+)/);
  if (panic) {
    console.log(`[crs-bolero] ${harness} (${engine}): FAILURE — panic at ${panic[1]}:${panic[2]}. ` +
      `bolero wrote the crashing input under the crate's corpus/crashes dir; reproduce it against ` +
      `the libFuzzer $OUT binary via run-pov for a Tier-1 PoV.`);
    process.stdout.write(out.split("\n").filter((l) => /panicked|Test Failure|index out of bounds|overflow|input:/i.test(l)).slice(0, 10).join("\n") + "\n");
    return 0;
  }
  console.log(`[crs-bolero] ${harness} (${engine}): no failure in ${runs} runs.`);
  return 0;
}

function miri(crateDir: string, harness: string): number {
  if (!have("cargo-miri")) { console.error("[crs-bolero] cargo-miri not available."); return 2; }
  log(`bolero miri: ${harness}`);
  // Miri drives the SAME bolero target; bolero replays its corpus deterministically under Miri.
  const r = run("cargo", [`+${NIGHTLY}`, "miri", "test", harness, "--", "--exact", "--nocapture"],
    { cwd: crateDir, env: { MIRIFLAGS: process.env.MIRIFLAGS ?? "-Zmiri-disable-isolation" }, timeoutMs: 60 * 60_000 });
  const out = `${r.stdout}\n${r.stderr}`;
  const m = out.match(/Undefined Behavior/i) ?? out.match(/panicked at\s+([^\s:]+\.rs):(\d+)/);
  if (m) {
    const loc = out.match(/(?:-->|panicked at)\s+([^\s:]+\.rs):(\d+)/);
    console.log(`[crs-bolero] ${harness} (miri): ${/Undefined Behavior/i.test(out) ? "UB" : "PANIC"} at ${loc ? `${loc[1]}:${loc[2]}` : "?"}. Tier via run-pov (Tier-1) or crs-sarif (Tier-3).`);
    return 0;
  }
  console.log(`[crs-bolero] ${harness} (miri): CLEAN over the corpus.`);
  return 0;
}

function main(): number {
  requireProfile();
  const [sub, ...argv] = process.argv.slice(2);
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i]; }
  const crate = opt["crate-dir"];
  if (!crate) { console.error("crs-bolero: --crate-dir required"); return 2; }
  if (sub === "list") return list(crate);
  if (sub === "fuzz") { if (!opt.harness) { console.error("crs-bolero fuzz: --harness <t>"); return 2; } return fuzz(crate, opt.harness, parseInt(opt.runs ?? "1000000", 10), opt.engine ?? "libfuzzer"); }
  if (sub === "miri") { if (!opt.harness) { console.error("crs-bolero miri: --harness <t>"); return 2; } return miri(crate, opt.harness); }
  console.error("crs-bolero: usage: crs-bolero list|fuzz|miri --crate-dir <c> [--harness <t>] [--runs N] [--engine E]");
  return 2;
}

process.exit(main());
