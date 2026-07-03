// rustmite run-phase entrypoint. Dispatches on $CRS_ENTRYPOINT:
//   run              - full supervisor: fuzzing + kani + miri + harness-gen subagents
//   run_fuzz_only    - fuzzing loop only (seed-gen ∥ pov-gen ∥ pov-gen-cov)
//   run_kani_only    - kani-prove only (isolated M1 validation)
//   run_miri_only    - miri-triage only (isolated M2 validation)
//   run_harness_only - harness-smith only (isolated M3 validation)
//   idle             - boot, then sleep (docker exec in to drive crs-* tools by hand)

import { boot } from "./boot.js";
import { harnessName, log } from "./common.js";
import { runSupervisor } from "./drivers/fuzz.js";

const ROSTERS: Record<string, string[]> = {
  run: ["seed-gen", "pov-gen", "pov-gen-cov", "kani-prove", "miri-triage", "harness-smith"],
  run_fuzz_only: ["seed-gen", "pov-gen", "pov-gen-cov"],
  run_kani_only: ["kani-prove"],
  run_miri_only: ["miri-triage"],
  run_harness_only: ["harness-smith"],
};

async function main(): Promise<void> {
  const harness = harnessName();
  const entry = process.env.CRS_ENTRYPOINT ?? "run";
  log(`CRS_ENTRYPOINT=${entry}`);
  const ctx = boot(harness);

  const abort = new AbortController();
  process.on("SIGTERM", () => { log("SIGTERM — stopping"); abort.abort(); });
  process.on("SIGINT", () => abort.abort());

  if (entry === "idle") {
    log("idle: boot complete; sleeping (docker exec in to run crs-* tools).");
    await new Promise<void>(() => { /* forever */ });
    return;
  }

  const roster = ROSTERS[entry] ?? ROSTERS.run;
  await runSupervisor(ctx, abort, roster);
}

main().catch((e) => { console.error(e); process.exit(1); });
