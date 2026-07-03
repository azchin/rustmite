---
name: crs-coverage
description: Measure which code the current corpus actually reaches (llvm-cov) so you can target the unexplored parts instead of guessing. Get a baseline before fuzzing, and ALWAYS after each crs-fuzz round to find reachable-but-unhit functions to aim seeds/queries at.
---

# crs-coverage — measure reach, then target the gaps

Stop guessing which code runs — measure it. Reports, for the shared corpus at
`/artifacts/corpus/{harness}`, a TOTAL line %, the **biggest-gap** files (reached but with the
most lines still missed — where to push next), and writes a full report.

```bash
crs-coverage --harness {harness}
```

## Use it as a loop, not a one-off
1. **Baseline** — run once up front to see what the boot seeds already reach.
2. **Grow** — seed + fuzz (crs-fuzz, background).
3. **Re-measure** — after a fuzz round, run `crs-coverage` again; read it for reachable-but-unhit
   functions near your suspected bug.
4. **Target** — write new seeds (or a CodeQL query) aimed at those gaps; repeat from step 2.

libFuzzer's `cov:`/`ft:` counters in the fuzz log are NOT this report — only `crs-coverage`
shows *which* functions/lines are unhit.
