---
name: crs-miri
description: (Rust) Run a specific input through Miri, the dynamic UB interpreter, to catch undefined behavior the ASan build misses — out-of-bounds, use-after-free, invalid alignment, uninitialized reads, invalid transmute, stacked-borrows violations. Miri is an ORACLE ON ONE EXECUTION (it does not generate inputs): feed it a suspicious corpus seed or crash artifact via a tiny #[test] harness. Only for pure-Rust code paths (no FFI/syscalls).
---

# crs-miri — dynamic UB oracle on a given input

Miri interprets one execution and flags UB that compiles and runs "fine" under ASan. Use it
to triage suspicious inputs (crash artifacts, boundary corpus seeds) on **pure-Rust** paths
(Miri can't cross FFI/syscalls). ~100–1000× slower than native, so triage a FEW inputs, not
the whole corpus.

## 1. Write a tiny #[test] harness that reads the input from `$MIRI_INPUT`
Add it under `#[cfg(test)]` to the crate, driving the **same entry the fuzz harness calls**:
```rust
#[test]
fn miri_triage() {
    let path = std::env::var("MIRI_INPUT").unwrap();
    let data = std::fs::read(path).unwrap();
    let _ = my_crate::decode_entry(&data);   // same api the libFuzzer harness drives
}
```
(`-Zmiri-disable-isolation`, set by crs-miri, is what lets Miri do the `fs::read`.)

## 2. Triage one input + tier it
```bash
crs-miri test --crate-dir /src/<crate> --test miri_triage --input <suspicious_file> --pov-harness {harness}
```
- **CLEAN** — no UB/panic under Miri on this input.
- **UB / panic reported** → crs-miri run-povs the same input:
  - crashes the stock build ⇒ **Tier 1** verified PoV (written to the PoV dir).
  - Miri UB but stock build clean ⇒ **Tier 3**: crs-miri emits (or prints) a
    `crs-sarif` bug-candidate at the reported `src.rs:line`.
- **unsupported** — Miri hit FFI/a syscall/couldn't compile; not a finding (pick a
  pure-Rust path or a different input).

## 3. (Optional) sweep a small corpus for a UB-triggering input
```bash
crs-miri scan --crate-dir /src/<crate> --test miri_triage_corpus --corpus <dir>
```
Have that harness loop `MIRI_CORPUS`, printing each filename before it runs, so when Miri
aborts on UB you know which input — then `crs-miri test --input <that>` to tier it.

## Notes
- Miri needs the nightly `miri` component + a prebuilt sysroot (already set up in the image).
- The high-value finds are inside `unsafe` (raw pointers, `get_unchecked`, `from_raw_parts`,
  `transmute`, `set_len`) — that's where UB hides from ASan.
