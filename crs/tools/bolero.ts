#!/usr/bin/env node
// crs-bolero (M3): build/run a bolero-unified harness. `cargo bolero build` emits the
// standalone libFuzzer $OUT binary (for run-pov); `cargo bolero test <name> [--engine kani]`
// drives the fuzz/kani engines from the same harness.
// STUB — implemented in milestone M3.
import { have } from "../common.js";

function main(): number {
  const sub = process.argv[2] ?? "";
  const ok = have("cargo-bolero");
  console.error(
    `[crs-bolero] not yet implemented (milestone M3). cargo-bolero present: ${ok}.\n` +
    `Planned: build --crate-dir <c>  |  test <name> [--engine kani|afl|honggfuzz].`,
  );
  return sub ? 2 : 0;
}
process.exit(main());
