---
name: crs-fuzz
description: Fuzz the harness (libFuzzer) to grow the corpus and surface crashes. Run ONE long-running background fuzzer and feed it newly generated seeds with `crs-fuzz add-seeds` while it runs — it auto-reloads the corpus, so there is NO restart loop. Drive seed-driven exploration: generate diverse VALID seeds, add them, measure coverage, target the gaps.
---

# crs-fuzz — one long-running fuzzer you feed seeds into

The fuzzer loads the shared corpus at `/artifacts/corpus/{harness}`, mutates from it, grows it
with coverage-increasing inputs, and writes crashes to the PoV dir (auto-submitted). It runs
with `-reload=1`, so one long-running fuzzer keeps picking up new seeds you add — you do **not**
restart it. Your edge is generating valid, structured seeds it can't brute-force.

## Lifecycle
- `crs-fuzz start --harness {harness}` — launch ONE background libFuzzer (runs until stopped).
  Start it once, early.
- `crs-fuzz start --harness {harness} --engine afl` (or `honggfuzz`) — run the same harness
  under a different engine, using the engine-specific build phase's binary. Different
  mutation/scheduling sometimes reaches bugs libFuzzer plateaus on; crashes still go to the PoV
  dir. libFuzzer is the primary/default engine.
- `crs-fuzz add-seeds --harness {harness} <dir>` — coverage-merge the seeds in `<dir>` into the
  live corpus (keeps only inputs that add coverage; `before -> after` shows how many landed).
  The running fuzzer reloads them — this replaces restarting.
- `crs-fuzz status --harness {harness}` — running? corpus growth, crashes so far.
- `crs-fuzz stop --harness {harness}` — stop and submit the corpus + crashes.

## The loop (no restarts)
1. **Start once** — `crs-fuzz start` (early, background).
2. **Generate seeds** — a diverse batch of VALID inputs into a scratch dir (e.g. `/work/agent/newseeds/`).
3. **Feed them in** — `crs-fuzz add-seeds --harness {harness} /work/agent/newseeds`.
4. **Measure** — `crs-coverage` to find reachable-but-unhit functions.
5. **Target the gaps** — next batch aimed at unhit code, back to step 3. `crs-fuzz status` tells
   you whether coverage is still climbing.
