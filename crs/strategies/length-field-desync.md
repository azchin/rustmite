---
name: length-field-desync
applies_to: [pov-gen, pov-gen-cov]
harness_hint: binary/container formats with explicit length or count fields
priority: high
---
Attacker-controlled **length/count fields** that are trusted without re-validating against the
actual remaining input. Find a field that says "N items / N bytes follow", used to bound a loop,
slice, or allocation. Craft an input where the declared N **disagrees** with reality:
- N **larger** than the real data → over-read / index-OOB / `read_array` past end.
- N **smaller** → desync: the next field is parsed from the wrong offset (a chunk/box length that
  doesn't match the real chunk size), causing a downstream panic or misparse.
- N used in **arithmetic** (`offset + N`, `N * item_size`) → see integer-overflow-size-calc.
Look for `read_array::<T>(count)`, `advance_by(len)`, `&data[..len]`, `with_capacity(n)`.
