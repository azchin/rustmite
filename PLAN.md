# rustmite — implementation tracker

A Rust-specialized OSS-CRS: **bug-finding** (fuzzing + Miri + Kani) and
**harness-generation** (create + transform, bolero-unified), orchestrated by a
**TypeScript** async supervisor on the Claude Agent SDK.

Design doc: `~/.claude/plans/i-created-a-new-merry-music.md`.
Reference CRS being ported/mined: `~/post/crs-bug-finding-reference` (esp.
`notes/miri-rudra-integration.md`, `RUST_TARGETS.md`).

## Key decisions
- Types: `[bug-finding, harness-gen]`; language: `rust` only.
- **Bolero-unified harnesses**: one `bolero::check!()` → libFuzzer/AFL/honggfuzz/Kani
  (`cargo bolero test [--engine …]`) + Miri (`MIRIFLAGS=-Zmiri-disable-isolation cargo
  +nightly miri test`). Generated build.sh uses `cargo bolero build` → `$OUT` binary.
- **TypeScript orchestration** via `@anthropic-ai/claude-agent-sdk` (concurrent `query()`
  agents, cancellable engine drivers). No Python orchestration; `libCRS` used as a CLI.
- **Finding tiers**: T1 native PoV (crashes stock ASan build) → run-pov → POV;
  T2 self-verified via checks-enabled `build_project` rebuild; T3 SARIF `bug-candidate`.

## Milestones
- [x] **M0** — TS supervisor boot + fuzzing parity (image-png/decode). **DONE + validated
  end-to-end:** boot→auth(OAuth via IS_SANDBOX=1)→SDK orchestrator + seed-gen/pov-gen/
  pov-gen-cov subagents→crs-fuzz RUNNING (corpus growing). Runner image carries the full
  toolchain (cargo-bolero, cargo-kani+CBMC, cargo-miri, rust-gdb) — M1-M3 unblocked. Ports
  seed-gen/pov-gen/pov-gen-cov + crs-fuzz/crs-coverage/crs-codeql.
- [x] **M1** — Kani engine. **Code-complete; mechanics validated on host.** `crs-kani prove`
  runs `cargo kani -Z concrete-playback`, parses `concrete_vals`, **concatenates** the inner
  byte-vecs (Kani records one per `any()` draw; `[u8;N]`=N of them) → `.bin` → `run-pov`
  (Tier-1 PoV, else Tier-3 SARIF). Host test on a `[u8;4]` proof produced the exact
  counterexample `fe ff ff ff`; parser reconstructs it. `kani-prove` agent + skill; wired into
  the `run` roster + `run_kani_only`. **Pending:** full in-container agentic validation run
  (T2 checks-enabled rebuild via build_project still a TODO in the tool).
- [ ] **M2** — Miri oracle (crs-miri + miri-triage; corpus/crash triage → T1/T3).
- [ ] **M3** — Harness-gen (crs-bolero + crs-harness + harness-smith; feedback loop).
- [ ] **Cross-cutting** — crs-sarif, threat-model asset, tiered submission pipeline,
  bolero harness template, reproduce.sh framework TODO note.

## Layout
```
crs/                TS supervisor + agents/roles/skills
  main.ts boot.ts   entrypoint + boot (libCRS CLI + Agent SDK)
  drivers/*.ts      concurrent engine drivers (fuzz, kani, miri, harness, coverage)
  tools/*.ts        Node CLIs: crs-fuzz crs-coverage crs-codeql crs-kani crs-miri
                    crs-bolero crs-harness crs-sarif
  agents/*  roles/*  skills/*   Agent SDK prompt assets
builder/            OSS-Fuzz build phase scripts (rust)
oss-crs/crs.yaml    CRS manifest
oss-crs/dockerfiles builder + runner images
notes/              reproduce.sh TODO, etc.
```

## Status log
- **Framework scaffold — VALIDATED.** crs.yaml + 4 builder scripts + 5 dockerfiles +
  registry + compose. `oss-crs prepare` OK; `oss-crs build-target` on image-png OK for all
  four phases (build w/ `decode` harness, coverage, debug, codeql — `db-rust`,
  `primaryLanguage: rust`).
- **Agent SDK verified** (`@anthropic-ai/claude-agent-sdk@0.3.199`, ESM, Node≥18) — see
  `notes/agent-sdk-reference.md`. ⚠️ open auth question: SDK may not honor
  `CLAUDE_CODE_OAUTH_TOKEN` (CLI-only) — `boot.configureAuth()` prefers a LiteLLM proxy and
  falls back to OAuth; **verify at first real run**.
- **TS app — COMPILES clean** (`npm run build`). `crs/{common,agent,boot,main}.ts`,
  `crs/drivers/fuzz.ts`; tools `crs-fuzz`/`crs-coverage`/`crs-codeql`/`crs-sarif` real,
  `crs-kani`/`crs-miri`/`crs-bolero`/`crs-harness` stubs. Tools run standalone (sarif emits
  valid SARIF; stubs report their milestone).
- **Prompt assets** ported (rust-only): `crs/CLAUDE.md`, `roles/orchestrator.md`,
  `agents/{seed-gen,pov-gen,pov-gen-cov}.md`, `skills/{crs-fuzz,crs-coverage,crs-codeql,gdb,
  run-pov}`.
- **NEXT (M0 finish):** build the runner image (heavy: Rust+CBMC+bolero+miri+Node+SDK) and
  do a real `oss-crs run` on image-png/decode — validates boot+auth, skill loading, the
  orchestrator spawning subagents, crs-fuzz + crs-coverage end-to-end. Resolve the auth
  question there (OAuth vs proxy).
- Working tree uncommitted (git initialized) — commit on request.
