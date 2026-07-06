---
name: integer-overflow-size-calc
applies_to: [kani-prove, pov-gen]
harness_hint: image/media/allocation code computing sizes from multiple input fields
priority: medium
---
Size/offset arithmetic on attacker fields that can **overflow or wrap**: `width * height *
bytes_per_pixel`, `stride * rows`, `offset + length`, `count * item_size`. Under the OSS-Fuzz
build (debug-assertions on) these panic on overflow; even in release they can produce a tiny
allocation followed by a large write (OOB). This is a prime **Kani** target: write a
`[u8;N]` proof over the small function computing the size and let Kani find the overflowing
inputs, then frame them into a harness input. Also grep for `as usize` casts that truncate.
