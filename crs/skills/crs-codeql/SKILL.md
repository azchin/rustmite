---
name: crs-codeql
description: Find vulnerability candidates by writing and running CodeQL queries against the target's prebuilt Rust database (data-flow, reachability, sink calls). Use this to enumerate where attacker input reaches indexing/slicing/arithmetic/unsafe operations, INSTEAD of grepping by hand, then confirm by reading.
---

# crs-codeql — semantic Rust queries

The target is indexed into a CodeQL **rust** database. Querying it enumerates candidate sites —
a worklist to read, not verdicts. Start every query with `import rust`.

## Orient
```bash
crs-codeql info
```
Prints the DB language (rust), the `import` line, and an example.

## Write and run a custom query (the main tool)
```bash
cat > /work/agent/q.ql <<'EOF'
import rust
from IndexExpr e
select e, "index/slice — is the index bounds-checked against attacker input?"
EOF
crs-codeql run /work/agent/q.ql
```
Results print with **file:line:col** locations. Good things to query for in Rust:
`IndexExpr` (slice/array indexing), `.unwrap()`/`.expect()`, integer arithmetic on attacker
bytes, and calls into `unsafe` (`from_raw_parts`, `get_unchecked`, `set_len`, `transmute`)
reachable from harness `{harness}`. Rust CodeQL is newer than C/C++ — the library surface is
smaller; lean on your own queries + reading, and use `crs-codeql info` for what's available.

## Optional broad sweep
```bash
crs-codeql analyze --suite security-extended
```
Noisy; prefer your own custom queries.
