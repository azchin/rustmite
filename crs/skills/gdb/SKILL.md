---
name: gdb
description: Dynamically inspect a Rust target's internal state with rust-gdb on the debug build — break at any function and read live values (sizes, offsets, indices, field values) to confirm a hypothesis, check whether an input reaches a target function or a condition-gated branch, or root-cause a crash. Re-run with more commands to go deeper.
---

# Inspect internal state at runtime with rust-gdb

Run `rust-gdb` yourself as a subprocess to watch what the code *actually does* on a given input.
Replaying a fixed input is deterministic, so re-reaching a breakpoint costs milliseconds.

## Setup
```bash
libCRS download-build-output debug /work/debug-build   # -O0 + full debuginfo: clean stacks + named vars
HB=/work/debug-build/{harness}
export ASAN_OPTIONS=abort_on_error=1:detect_leaks=0:handle_abort=1
```
Source is at `/src` and the debug info's compile dir matches it, so `list` / `file:line` resolve.
**Use `rust-gdb`, not `gdb`** — it loads Rust pretty-printers so `Vec`/`String`/`Option`/slices/
enums render readably (falls back to plain `gdb` if unavailable).

## Break at a Rust panic / a suspect function
```bash
cat > /work/dbg.gdb <<'EOF'
set pagination off
set follow-fork-mode parent
break core::panicking::panic_bounds_check   # slice/array index out of bounds
break rust_panic                            # any panic (unwrap/expect/panic!)
break my_crate::decode                      # or a specific function
run
bt
info locals
EOF
rust-gdb -q -batch -x /work/dbg.gdb --args "$HB" <input>
```
Index-out-of-bounds, slice, and `unwrap`/`expect` always panic; arithmetic overflow panics only
if the target builds with overflow-checks. Read the output, add commands (`up`, `p <expr>`,
`x/16xb buf`, a deeper breakpoint), and re-run.
