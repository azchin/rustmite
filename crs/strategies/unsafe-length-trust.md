---
name: unsafe-length-trust
applies_to: [pov-gen, miri-triage]
harness_hint: crates with unsafe blocks in the decode path
priority: high
---
`unsafe` that trusts an attacker-derived length/index: `slice::from_raw_parts(ptr, n)`,
`get_unchecked(i)`, `Vec::set_len(n)`, `ptr::copy(.., n)`, `transmute`. Find where `n`/`i` comes
(directly or via arithmetic) from input bytes and isn't bounded by the real buffer. These are the
highest-value memory-safety bugs (they can be true OOB/UAF, not just panics). Route a crafted
input through **miri-triage** — Miri catches the UB even when ASan doesn't; tier to a PoV if the
stock build also crashes, else a SARIF bug-candidate.
