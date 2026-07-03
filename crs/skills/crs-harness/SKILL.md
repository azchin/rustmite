---
name: crs-harness
description: (Rust) Build a generated OSS-Fuzz harness in-container to get a rebuild_id (so fuzz/kani/miri finds verify against it via run-pov), and submit the harness project for other CRSs. Use after scaffolding a new fuzz_target! for an under-tested api. Supports per-engine builds (libFuzzer/afl/honggfuzz) via --builder-name.
---

# crs-harness — build + submit generated harnesses

The framework never builds a *submitted* harness; rustmite self-builds it, finds PoVs against
the rebuild, and also submits the source for other CRSs.

## Build a modified project → rebuild_id
Scaffold a **modified copy** of the OSS-Fuzz project dir (new/edited `fuzz_target!` + build.sh)
and/or the target source (new harness deps), then:
```bash
crs-harness build --proj-dir <modified-fuzz-proj> [--source-dir <modified-crate>]
# -> libCRS build-project (diffs vs the base mounts, rebuilds) -> prints rebuild_id
# engine variants:  crs-harness build ... --builder-name afl-build   (or honggfuzz-build)
```
Verify a crashing input against that rebuild:
```bash
libCRS run-pov <input> <resp> --harness <new_harness> --rebuild-id <id>
```
non-zero retcode ⇒ Tier-1 verified PoV.

## Submit the harness for other CRSs
```bash
crs-harness submit --proj-dir <fuzz-proj> [--source-dir <crate>] [--name <name>]
# -> libCRS submit-harness -> SUBMIT_DIR/harnesses/<name>/{fuzz-proj,target-source}
```

## Layout notes
- OSS-Fuzz `fuzz_target!` harnesses live in the target repo (e.g. `fuzz/fuzz_targets/*.rs`) with
  the target listed in `fuzz/Cargo.toml`; build.sh must `cp` the built binary to `$OUT`.
- Keep any **original** `fuzz_target!` intact so the stock build/run-pov keep working; add new
  harnesses alongside.
