#!/usr/bin/env node
// crs-kani (M1): drive Kani over a bounded proof harness, concretize a counterexample, and
// turn the recorded bytes into a run-pov PoV.
//
//   crs-kani setup
//   crs-kani prove --crate-dir <dir> --harness <proof_fn> [--pov-harness <libfuzzer_harness>]
//
// Flow: `cargo kani -Z concrete-playback --concrete-playback=print --harness <fn>` prints a
// generated #[test] holding `concrete_vals: Vec<Vec<u8>>` — one inner byte-vector per
// kani::any() call. For a `let data:[u8;N]=kani::any(); lib::api(&data)` proof, the first
// inner vector IS the input bytes. Write them to a file and verify against the ORIGINAL
// libFuzzer harness via run-pov:
//   - non-zero retcode on the stock build            -> Tier 1: verified PoV (-> PoV dir).
//   - reproduces only on a checks-enabled rebuild     -> Tier 2 (build_project; TODO).
//   - no reproducing crash                            -> Tier 3: SARIF bug-candidate.

import * as fs from "node:fs";
import * as path from "node:path";
import { POV_DIR, run, have, log, libcrsRunPov, WORK_DIR } from "../common.js";

const KANI_TC = process.env.CRS_KANI_TOOLCHAIN; // usually unset; kani manages its own

/** Parse the `concrete_vals: Vec<Vec<u8>> = vec![ ... ];` block from playback output. */
export function parseConcreteVals(out: string): number[][] {
  const m = out.match(/concrete_vals\s*:\s*Vec<Vec<u8>>\s*=\s*vec!\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  const body = m[1];
  const inner: number[][] = [];
  const re = /vec!\s*\[([^\]]*)\]/g;
  let g: RegExpExecArray | null;
  while ((g = re.exec(body)) !== null) {
    const bytes = g[1].split(",").map((s) => s.trim()).filter((s) => s.length > 0).map((s) => parseInt(s, 10));
    if (bytes.every((b) => !Number.isNaN(b))) inner.push(bytes);
  }
  return inner;
}

function cargoKani(crateDir: string, harness: string): { code: number; out: string } {
  const args = ["kani", "-Z", "concrete-playback", "--concrete-playback=print", "--harness", harness];
  const env: NodeJS.ProcessEnv = {};
  if (KANI_TC) env.RUSTUP_TOOLCHAIN = KANI_TC;
  const r = run("cargo", args, { cwd: crateDir, env, timeoutMs: 30 * 60_000 });
  return { code: r.code, out: `${r.stdout}\n${r.stderr}` };
}

function prove(crateDir: string, harness: string, povHarness?: string): number {
  if (!have("cargo-kani")) { console.error("[crs-kani] cargo-kani not available in this image."); return 2; }
  log(`kani prove: crate=${crateDir} harness=${harness}`);
  const { code, out } = cargoKani(crateDir, harness);
  // A verdict requires an explicit VERIFICATION line. If neither appears, kani never actually
  // model-checked (a manifest/compile/setup error — e.g. an edition the pinned kani's bundled
  // Cargo can't parse) — that is NOT "proven sound"; surface it as an error, never SUCCESS.
  const succeeded = /VERIFICATION:- SUCCESSFUL/.test(out);
  const failed = /VERIFICATION:- FAILED/.test(out);
  const vals = parseConcreteVals(out);
  if (!succeeded && !failed) {
    console.error(`[crs-kani] ${harness}: kani produced NO verdict (cargo rc=${code}) — build/manifest/` +
      `setup error, NOT a proof of soundness. Fix the crate/proof so it compiles under kani. Tail:`);
    process.stderr.write(out.split("\n").filter((l) => l.trim()).slice(-20).join("\n") + "\n");
    return 3;
  }
  if (succeeded && vals.length === 0) {
    console.log(`[crs-kani] ${harness}: VERIFICATION SUCCESSFUL — property holds for all inputs within the bound.`);
    return 0;
  }
  if (vals.length === 0) {
    console.log(`[crs-kani] ${harness}: a check FAILED but no concrete playback was produced ` +
      `(non-panic UB checks are not concretized). Treat the Kani report as a Tier-3 lead.`);
    process.stdout.write(out.split("\n").filter((l) => /FAILED|Failed|panic|overflow|bounds/.test(l)).slice(0, 20).join("\n") + "\n");
    return 0;
  }
  if (Buffer.concat(vals.map((v) => Buffer.from(v))).length === 0) {
    console.log(`[crs-kani] ${harness}: FAILED but the concretized input is empty — not a usable PoV; Tier-3 lead.`);
    return 0;
  }
  // Kani records one inner Vec per `kani::any()` draw. For `let data:[u8;N]=kani::any()`
  // that's N one-byte vecs, so the input array = concatenation of all inner vecs in order.
  // (For structured `Arbitrary` inputs this is the typed decode, not the raw libFuzzer byte
  // stream — those need re-encoding; the plain `[u8;N]` proof shape avoids that.)
  const bytes = Buffer.concat(vals.map((v) => Buffer.from(v)));
  const kdir = path.join(WORK_DIR, "agent", "kani");
  fs.mkdirSync(kdir, { recursive: true });
  const povPath = path.join(kdir, `kani_${harness}.bin`);
  fs.writeFileSync(povPath, bytes);
  console.log(`[crs-kani] ${harness}: counterexample concretized -> ${povPath} (${bytes.length} bytes)`);

  if (!povHarness) {
    console.log(`[crs-kani] no --pov-harness given; verify with:  libCRS run-pov ${povPath} <resp> --harness <H>`);
    return 0;
  }
  const respDir = path.join(kdir, `resp_${harness}`);
  const rc = libcrsRunPov(povPath, povHarness, respDir);
  if (rc !== 0) {
    // Tier 1: verified PoV against the stock build.
    fs.mkdirSync(POV_DIR, { recursive: true });
    const dst = path.join(POV_DIR, `kani_${harness}_${bytes.length}b.bin`);
    fs.writeFileSync(dst, bytes);
    const prov = path.join(WORK_DIR, "agent", "pov_provenance.tsv");
    fs.appendFileSync(prov, `kani-prove\t${path.basename(dst)}\t${bytes.length}b\tKani counterexample for ${harness}\n`);
    console.log(`[crs-kani] TIER 1 VERIFIED PoV (run-pov retcode=${rc}) -> ${dst}`);
  } else {
    console.log(`[crs-kani] concretized input did NOT crash the stock build (retcode=0). ` +
      `Tier-2 (rebuild with overflow-checks/debug-assertions via build_project — TODO) or ` +
      `Tier-3: emit a SARIF bug-candidate:  crs-sarif --rule-id KANI-${harness} --message "..." --file <f> --line <n>`);
  }
  return 0;
}

function setup(): number {
  if (!have("rustup")) { console.error("[crs-kani] rustup not found"); return 1; }
  const r = run("cargo", ["kani", "setup"], { timeoutMs: 20 * 60_000 });
  if (r.code !== 0) { process.stderr.write(r.stderr); return r.code; }
  console.log("[crs-kani] kani setup complete.");
  return 0;
}

function main(): number {
  const [sub, ...argv] = process.argv.slice(2);
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i]; }
  if (sub === "setup") return setup();
  if (sub === "prove") {
    if (!opt["crate-dir"] || !opt.harness) { console.error("crs-kani prove: --crate-dir <dir> --harness <proof_fn> [--pov-harness <H>]"); return 2; }
    return prove(opt["crate-dir"], opt.harness, opt["pov-harness"]);
  }
  console.error("crs-kani: usage: crs-kani setup | prove --crate-dir <dir> --harness <fn> [--pov-harness <H>]");
  return 2;
}

process.exit(main());
