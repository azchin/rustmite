---
name: empty-collection-index
applies_to: [pov-gen, pov-gen-cov, kani-prove]
harness_hint: parsers that size a buffer/Vec from a computed count that can be zero
priority: high
---
Find a place where a **count/length is computed** (from a header field, a sum, a
`num_points`/`len`/`capacity`), a collection is sized to it, and then the code **indexes or
writes `[0]` / iterates** into that collection — *without* first checking it's non-empty.

The bug fires when the computed count is **0** but the parser still has data to write. Classic
shape: `let n = compute(...); let mut v = vec![_; n]; while let Some(x) = data.next() { v[i] = x; ... if i == n { break } }` — the `i == n` break is checked **after** the write, so with `n == 0`
the first `v[0] = x` panics.

To craft it: make the count-deriving field yield **0** (e.g. `number_of_contours = 0`,
`num_entries = 0`, an empty section) while leaving **trailing bytes** the loop will still consume.
Verify with `libCRS run-pov`; the panic message is `index out of bounds: the len is 0 but the
index is 0`. (This is exactly the fontations `read_points_fast` bug: glyf.rs:244.)
