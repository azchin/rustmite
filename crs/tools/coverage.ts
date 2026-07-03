#!/usr/bin/env node
// crs-coverage: replay the corpus through the coverage-instrumented harness and emit an
// llvm-cov summary + biggest-gap files. Ported from crs-bug-finding-reference; llvm-cov is
// language-neutral (cargo-fuzz coverage builds are llvm-instrumented).
//
//   crs-coverage --harness H [--corpus DIR] [--build-dir DIR]

import * as fs from "node:fs";
import * as path from "node:path";
import { corpusDir, resolveBuildDir, harnessBinary, run, have, log } from "../common.js";

const LLVM_SUFFIXES = ["", "-18", "-19", "-17", "-20", "-16", "-15"];

function pickLlvm(profraw: string, scratch: string): { profdata: string; cov: string } | null {
  for (const suf of LLVM_SUFFIXES) {
    const profdata = `llvm-profdata${suf}`, cov = `llvm-cov${suf}`;
    if (!have(profdata) || !have(cov)) continue;
    const r = run(profdata, ["merge", "-sparse", profraw, "-o", scratch], { timeoutMs: 180_000 });
    if (r.code === 0) return { profdata, cov };
  }
  return null;
}

function main(): number {
  const argv = process.argv.slice(2);
  let harness = process.env.OSS_CRS_TARGET_HARNESS ?? "";
  let corpus = "", buildDir = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--harness") harness = argv[++i];
    else if (argv[i] === "--corpus") corpus = argv[++i];
    else if (argv[i] === "--build-dir") buildDir = argv[++i];
  }
  if (!harness) { console.error("crs-coverage: no --harness"); return 2; }
  if (!corpus) corpus = corpusDir(harness);

  const bd = resolveBuildDir("coverage", buildDir || undefined);
  const hb = harnessBinary(bd, harness);
  if (!fs.existsSync(hb)) { console.error(`coverage harness not found: ${hb}`); return 2; }

  const outDir = "/work/coverage-report";
  fs.mkdirSync(outDir, { recursive: true });
  const profraw = path.join(outDir, `${harness}.profraw`);
  const profdata = path.join(outDir, `${harness}.profdata`);

  run(hb, [corpus, "-runs=0"], { timeoutMs: 1_200_000, env: { LLVM_PROFILE_FILE: profraw } });
  if (!fs.existsSync(profraw)) { console.error(`no profile at ${profraw} (is this a coverage build?)`); return 1; }

  const tools = pickLlvm(profraw, profdata);
  if (!tools) { console.error("no compatible llvm-profdata for this profile version"); return 1; }
  run(tools.profdata, ["merge", "-sparse", profraw, "-o", profdata], { timeoutMs: 300_000 });

  // Per-file summary via `llvm-cov export -summary-only`.
  const exp = run(tools.cov, ["export", hb, `-instr-profile=${profdata}`, "-summary-only",
    "-ignore-filename-regex=.*/(rustc|cargo|\\.cargo|registry)/.*"], { timeoutMs: 300_000 });
  let total = { lines: 0, covered: 0 };
  const gaps: { file: string; pct: number; missed: number }[] = [];
  try {
    const data = JSON.parse(exp.stdout);
    for (const d of data.data ?? []) {
      for (const f of d.files ?? []) {
        const L = f.summary?.lines;
        if (!L) continue;
        total.lines += L.count; total.covered += L.covered;
        const missed = L.count - L.covered;
        if (f.filename.includes("/src/") && missed > 0)
          gaps.push({ file: f.filename.replace(/^\/src\//, ""), pct: L.percent, missed });
      }
    }
  } catch { /* fall back to report below */ }

  const pct = total.lines ? ((100 * total.covered) / total.lines).toFixed(1) : "0.0";
  console.log(`[crs-coverage] ${harness}: lines ${pct}% (${total.covered}/${total.lines})`);
  gaps.sort((a, b) => b.missed - a.missed);
  if (gaps.length) {
    console.log(`[crs-coverage] biggest gaps (reached, most lines still missed):`);
    for (const g of gaps.slice(0, 12))
      console.log(`    ${g.file.padEnd(48)} ${g.pct.toFixed(1)}%  (${g.missed} missed)`);
  }
  const report = run(tools.cov, ["report", hb, `-instr-profile=${profdata}`], { timeoutMs: 300_000 });
  const full = path.join(outDir, `${harness}.coverage.txt`);
  fs.writeFileSync(full, report.stdout);
  console.log(`[crs-coverage] full report -> ${full}`);
  return 0;
}

process.exit(main());
