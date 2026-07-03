#!/usr/bin/env node
// crs-harness (M3): rebuild the project from a generated/transformed harness in-container
// (`libCRS build-project` → rebuild_id, so fuzz/kani/miri can run-pov against it) and
// `libCRS submit-harness` the harness project for other CRSs. The framework never builds a
// submitted harness itself — rustmite self-builds via build-project (D1 feedback loop).
//
//   crs-harness build  --proj-dir <modified-fuzz-proj> [--source-dir <modified-crate>] [--rebuild-id N]
//   crs-harness submit --proj-dir <fuzz-proj> [--source-dir <crate>] [--name <name>]
//
// build: diffs --proj-dir against /OSS_CRS_FUZZ_PROJ and --source-dir against the target
// base, applies the patches via the builder sidecar, returns a rebuild_id. Feed that id to
// `libCRS run-pov <input> <resp> --harness <new-harness> --rebuild-id <id>` (crs-fuzz /
// crs-kani / crs-miri --pov-harness paths).

import * as fs from "node:fs";
import * as path from "node:path";
import { WORK_DIR, run, log } from "../common.js";

function build(projDir?: string, sourceDir?: string, rebuildId?: string, builderName?: string): number {
  if (!projDir && !sourceDir) { console.error("crs-harness build: need --proj-dir and/or --source-dir"); return 2; }
  const resp = path.join(WORK_DIR, "agent", "harness", `build_${Date.now()}`);
  fs.mkdirSync(resp, { recursive: true });
  const args = ["build-project", "--response-dir", resp];
  if (projDir) args.push("--fuzz-proj-dir", projDir);
  if (sourceDir) args.push("--target-source-dir", sourceDir);
  if (rebuildId) args.push("--rebuild-id", rebuildId);
  // Select the engine builder (build [libFuzzer] | afl-build | honggfuzz-build); default libFuzzer.
  if (builderName) args.push("--builder-name", builderName);
  log(`build-project: proj=${projDir ?? "-"} source=${sourceDir ?? "-"}`);
  const r = run("libCRS", args, { timeoutMs: 60 * 60_000 });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  // build-project sys.exit(exit_code) == rebuild_id. Also surface any id file the sidecar wrote.
  let id = r.code;
  const idFile = path.join(resp, "rebuild_id");
  if (fs.existsSync(idFile)) { const n = parseInt(fs.readFileSync(idFile, "utf8").trim(), 10); if (!Number.isNaN(n)) id = n; }
  if (id < 0) { console.error(`[crs-harness] build-project failed (rc=${r.code})`); return 1; }
  console.log(`[crs-harness] rebuild_id=${id}. Verify a PoV with:  libCRS run-pov <input> <resp> --harness <name> --rebuild-id ${id}`);
  // stash for the drivers
  fs.writeFileSync(path.join(WORK_DIR, "agent", "harness", "last_rebuild_id"), String(id));
  return 0;
}

function submit(projDir?: string, sourceDir?: string, name?: string): number {
  if (!projDir) { console.error("crs-harness submit: --proj-dir <fuzz-proj> required"); return 2; }
  if (!fs.existsSync(projDir) || !fs.statSync(projDir).isDirectory()) { console.error(`not a dir: ${projDir}`); return 2; }
  const args = ["submit-harness", "--fuzz-proj-dir", projDir];
  if (sourceDir) args.push("--target-source-dir", sourceDir);
  if (name) args.push("--name", name);
  const r = run("libCRS", args, { timeoutMs: 300_000 });
  process.stdout.write(r.stdout); process.stderr.write(r.stderr);
  if (r.code !== 0) { console.error(`[crs-harness] submit-harness failed (rc=${r.code})`); return r.code; }
  console.log(`[crs-harness] submitted harness '${name ?? path.basename(projDir)}' to SUBMIT_DIR/harnesses/.`);
  return 0;
}

function main(): number {
  const [sub, ...argv] = process.argv.slice(2);
  const opt: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i]; }
  if (sub === "build") return build(opt["proj-dir"], opt["source-dir"], opt["rebuild-id"], opt["builder-name"]);
  if (sub === "submit") return submit(opt["proj-dir"], opt["source-dir"], opt.name);
  console.error("crs-harness: usage: crs-harness build|submit --proj-dir <d> [--source-dir <s>] [--name <n>] [--rebuild-id N]");
  return 2;
}

process.exit(main());
