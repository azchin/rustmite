// rustmite run-phase entrypoint. Dispatches on $CRS_ENTRYPOINT:
//   run            - the concurrent multi-engine supervisor (M0: fuzzing; M1-M3 add
//                    kani ∥ miri ∥ harness-gen drivers here)
//   run_fuzz_only  - fuzzing loop only
//   idle           - boot, then sleep (docker exec in to drive crs-* tools by hand)

import { boot } from "./boot.js";
import { harnessName, log } from "./common.js";
import { runFuzzSupervisor } from "./drivers/fuzz.js";

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

  // M0: `run` and `run_fuzz_only` both drive the fuzzing supervisor. The concurrent
  // kani ∥ miri ∥ harness-gen drivers are wired into `run` in milestones M1-M3.
  await runFuzzSupervisor(ctx, abort);
}

main().catch((e) => { console.error(e); process.exit(1); });
