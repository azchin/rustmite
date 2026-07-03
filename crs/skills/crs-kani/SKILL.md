---
name: crs-kani
description: (Rust) Prove a bounded property with Kani (a bounded model checker) and turn a counterexample into a verified PoV. Kani explores ALL inputs up to a bound symbolically — it finds panics/overflow/index-OOB/assertion failures that fuzzing may miss in narrow branches, and emits the exact bytes. Best on BOUNDED leaf functions, not whole parsers (Kani state-explodes on large inputs).
---

# crs-kani — bounded model checking → concretized PoV

Kani proves (or refutes) a property over all `kani::any()` inputs up to a bound. On a
refutation it emits a **concrete counterexample**; `crs-kani` turns those bytes into a
`run-pov` PoV. Use it where fuzzing plateaus: bounded, self-contained functions with tricky
arithmetic/indexing. **Kani state-explodes on whole parsers** — target a small function and
a small `N`.

## Write a bounded `[u8; N]` proof
Add a proof to the crate that drives the target function on a fixed-size byte array. Guard it
with `#[cfg(kani)]` so the normal build ignores it (do NOT add `kani` to Cargo.toml — `cargo
kani` injects it):
```rust
#[cfg(kani)]
#[kani::proof]
#[kani::unwind(8)]          // bound loop/recursion; raise if you hit "unwinding assertion"
fn kani_check() {
    let data: [u8; 16] = kani::any();   // MUST be bounded; there is no any() for &[u8]/Vec
    let _ = my_crate::target_fn(&data); // the function under test — a panic/overflow FAILS
}
```
Choose `target_fn` and `N` deliberately: larger `N`/unwind ⇒ blow-up. Start small (N≤16).

## Prove + concretize + verify
```bash
crs-kani prove --crate-dir /src/<crate> --harness kani_check --pov-harness {harness}
```
- Runs `cargo kani -Z concrete-playback --concrete-playback=print --harness kani_check`.
- On a failure it concretizes the counterexample (Kani records one byte-vec per `kani::any()`
  draw; a `[u8; N]` array = N of them, concatenated = the input bytes) → `/work/agent/kani/`.
- With `--pov-harness`, it runs `libCRS run-pov` on those bytes:
  - **non-zero retcode on the stock build ⇒ TIER 1 verified PoV** (written to the PoV dir).
  - reproduces only with checks on ⇒ Tier 2 (rebuild with overflow-checks; `libCRS build-project`).
  - no crash ⇒ **Tier 3**: emit `crs-sarif --rule-id KANI-<fn> --message "…" --file <f> --line <n>`.

## Mapping caveat (important)
The concretized bytes are the input to **the function your proof calls**. For a Tier-1 PoV
they must be the input the `--pov-harness` libFuzzer harness consumes — so either prove over
the **same entry** the fuzz harness calls (`data → decode(data)`), or generate a dedicated
`fuzz_target!` for the leaf (crs-harness) and pass that as `--pov-harness`. If the
counterexample is for a leaf that the stock harness can't be fed directly, record it as a
Tier-3 SARIF bug-candidate.

## Notes
- Only **panic-class** failures concretize (assert/panic/overflow/index-OOB/div0); pure-UB
  checks that don't panic are reported but not concretized — treat those as Tier-3 leads.
- `crs-kani setup` re-runs `cargo kani setup` (CBMC) if needed.
