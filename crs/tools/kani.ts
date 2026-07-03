#!/usr/bin/env node
// crs-kani (M1): drive Kani over a bounded proof harness, concretize a counterexample
// (`cargo kani -Z concrete-playback --concrete-playback=print`), and turn the recorded
// bytes into a run-pov PoV (Tier 1) or a checks-enabled self-verified PoV (Tier 2).
// STUB — implemented in milestone M1.
import { have } from "../common.js";

function main(): number {
  const sub = process.argv[2] ?? "";
  const ok = have("cargo-kani");
  console.error(
    `[crs-kani] not yet implemented (milestone M1). cargo-kani present: ${ok}.\n` +
    `Planned: prove --crate-dir <c> --harness <name>  (bounded [u8;N] proof → concrete-playback → run-pov).`,
  );
  return sub ? 2 : 0;
}
process.exit(main());
