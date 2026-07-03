#!/usr/bin/env node
// crs-miri (M2): run a given corpus/crash input under Miri (via the bolero harness or a
// small #[test]) with MIRIFLAGS=-Zmiri-disable-isolation to catch UB ASan misses; classify
// to Tier 1 (also crashes stock ASan) or Tier 3 (SARIF bug-candidate).
// STUB — implemented in milestone M2.
import { have } from "../common.js";

function main(): number {
  const sub = process.argv[2] ?? "";
  const ok = have("cargo-miri");
  console.error(
    `[crs-miri] not yet implemented (milestone M2). cargo-miri present: ${ok}.\n` +
    `Planned: test --crate-dir <c> -- <test>   (MIRIFLAGS=-Zmiri-disable-isolation cargo miri test).`,
  );
  return sub ? 2 : 0;
}
process.exit(main());
