#!/usr/bin/env node
// crs-harness (M3): scaffold a generated/transformed harness into an OSS-Fuzz project dir,
// build it in-container (`libCRS build-project` → rebuild_id), and `libCRS submit-harness`
// the source. Feeds the fuzz/kani/miri drivers (D1 feedback loop).
// STUB — implemented in milestone M3.
function main(): number {
  const sub = process.argv[2] ?? "";
  console.error(
    `[crs-harness] not yet implemented (milestone M3).\n` +
    `Planned: build --proj-dir <d> (→ rebuild_id) | submit --proj-dir <d> [--source-dir <s>] [--name <n>].`,
  );
  return sub ? 2 : 0;
}
process.exit(main());
