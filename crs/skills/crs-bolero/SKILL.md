---
name: crs-bolero
description: (Rust) Drive a bolero-unified harness — ONE `bolero::check!()` target that runs under libFuzzer/AFL/honggfuzz AND Miri from the same code. Use to fuzz a chosen api and to replay its corpus under Miri for UB, without writing a separate harness per engine.
---

# crs-bolero — one harness, multiple engines

`bolero::check!().with_type::<T>().for_each(|input| { target(input) })` is a single `#[test]`
that libFuzzer/AFL/honggfuzz and Miri all drive. Write it in `tests/<name>.rs`; the crate's
`Cargo.toml` needs a `[profile.fuzz]` (e.g. `inherits = "release"`, `overflow-checks = true`).

## Discover + run
```bash
crs-bolero list --crate-dir /src/<crate>
crs-bolero fuzz --crate-dir /src/<crate> --harness <target> --runs 1000000   # libFuzzer
crs-bolero fuzz --crate-dir /src/<crate> --harness <target> --engine honggfuzz
crs-bolero miri --crate-dir /src/<crate> --harness <target>                  # Miri over the corpus
```
- A `fuzz` failure prints `panicked at file:line` and bolero saves the crashing input under the
  crate's `crashes`/corpus dir.
- `miri` replays the corpus under `-Zmiri-disable-isolation` and reports UB/PANIC + location.

## Turning a bolero find into a verified PoV
bolero has no `build` that emits an OSS-Fuzz `$OUT` binary. So verify the crashing input against
a **libFuzzer `$OUT` binary for the same api** (the OSS-Fuzz `fuzz_target!`):
`libCRS run-pov <input> <resp> --harness <fuzz_target> [--rebuild-id <id>]` → Tier-1 PoV. If the
api has no such fuzz_target yet, generate one and `crs-harness build` it first (see crs-harness).

## Kani note
The bolero→Kani engine is version-fragile (`--engine kani` may report "no harnesses matched").
Use **crs-kani** for Kani (write a dedicated `#[kani::proof]` over the same api) — don't rely on
`cargo bolero test --engine kani`.
