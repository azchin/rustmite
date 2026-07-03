---
name: run-pov
description: Verify a PoV candidate with libCRS run-pov — the canonical way to reproduce a crash inside the correct target environment. A candidate counts as a real PoV only once run-pov reports a non-zero retcode. Also covers rebuilding against a checks-enabled build and fetching clean source.
---

# Verify a PoV with libCRS run-pov

`libCRS run-pov` runs the harness on a candidate input inside the correct target environment. It
is the ONLY thing that makes a PoV "verified" — running the harness binary yourself is fine for
exploration, but a candidate counts only when run-pov reproduces the crash.

```bash
libCRS run-pov <pov_path> <response_dir> --harness {harness}
```
- A non-zero `retcode` (in `<response_dir>/retcode`) means the crash reproduced — a verified PoV.
- Omit `--rebuild-id` to run against the base (original) build.
- `--rebuild-id <id>` runs against a patched/instrumented build (e.g. a checks-enabled rebuild
  from `libCRS build-project` — used for Tier-2 self-verification of overflow/assert bugs that
  don't crash the stock build).

Only write a file to the PoV directory after run-pov confirms a non-zero retcode.

## Related
```bash
libCRS build-project <modified_proj_dir> <response_dir>   # rebuild (e.g. overflow-checks on) -> rebuild_id
libCRS download-source <source_type> <dst_dir>            # fetch clean source
```
