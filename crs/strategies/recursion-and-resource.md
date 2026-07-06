---
name: recursion-and-resource
applies_to: [seed-gen, pov-gen]
harness_hint: nested/recursive formats (composite glyphs, nested boxes, nested archives, DWARF)
priority: medium
---
Deeply **nested or self-referential** structures that drive unbounded recursion (stack overflow)
or unbounded allocation (OOM/DoS): composite glyphs referencing components, MP4 boxes containing
boxes, zip inside zip, DWARF DIEs, XML entity expansion. Craft an input with deep nesting or a
length field that induces a huge allocation. These usually manifest as libFuzzer OOM/timeout or a
stack-overflow SIGSEGV — legitimate DoS findings on untrusted input.
