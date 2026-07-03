#!/usr/bin/env node
// crs-codeql: author + run CodeQL queries against the target's `rust` database (semantic
// enumeration of candidate sites). The codeql-build phase produced a rust DB; this tool
// wraps `codeql query run` / `database analyze` with the rust query/library packs.
//
//   crs-codeql info
//   crs-codeql run <query.ql>
//   crs-codeql analyze [--suite security-extended]

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { run, libcrsDownloadBuildOutput } from "../common.js";

const DB_LOCAL = "/work/codeql/db";
const CFG = {
  import: "rust",
  queryPack: "codeql/rust-queries",
  libPack: "codeql/rust-all",
  suitePrefix: "rust",
  example:
    "import rust\n\nfrom IndexExpr e\nselect e, \"index/slice — is the index bounds-checked against attacker input?\"\n",
};

function codeqlBin(): string {
  const p = ["/opt/codeql/codeql", "codeql"].find((c) => c === "codeql" ? run("bash", ["-lc", "command -v codeql"]).code === 0 : fs.existsSync(c));
  if (!p) throw new Error("codeql CLI not found (expected on PATH or /opt/codeql/codeql)");
  return p === "codeql" ? "codeql" : "/opt/codeql/codeql";
}

function resolveDb(explicit?: string): string {
  if (explicit) return explicit;
  if (fs.existsSync(path.join(DB_LOCAL, "codeql-database.yml"))) return DB_LOCAL;
  if (libcrsDownloadBuildOutput("codeql", DB_LOCAL) && fs.existsSync(path.join(DB_LOCAL, "codeql-database.yml"))) return DB_LOCAL;
  throw new Error("CodeQL database not found. Ensure the codeql-build phase ran (fetched from build output 'codeql').");
}

function info(db?: string): number {
  const d = resolveDb(db);
  console.log(`CodeQL database: ${d}`);
  console.log(`Language:        rust`);
  console.log(`Query pack:      ${CFG.queryPack}`);
  console.log(`\nStart every query with \`import ${CFG.import}\`. Example query:`);
  console.log("-".repeat(60)); process.stdout.write(CFG.example); console.log("-".repeat(60));
  console.log("Write a query to a .ql file, then:  crs-codeql run <query.ql>");
  return 0;
}

function runQuery(query: string, db?: string): number {
  const d = resolveDb(db);
  if (!fs.existsSync(query)) { console.error(`query file not found: ${query}`); return 2; }
  const packDir = fs.mkdtempSync(path.join(fs.existsSync("/work") ? "/work" : os.tmpdir(), "crs-codeql-"));
  fs.writeFileSync(path.join(packDir, "qlpack.yml"), `name: crs/adhoc\nversion: 0.0.1\ndependencies:\n  ${CFG.libPack}: "*"\n`);
  const wrapped = path.join(packDir, path.basename(query));
  fs.copyFileSync(query, wrapped);
  const bqrs = path.join(packDir, "results.bqrs");
  const bin = codeqlBin();
  const r = run(bin, ["query", "run", `--database=${d}`, "--threads=0", `--output=${bqrs}`, "--", wrapped], { timeoutMs: 1_200_000 });
  if (r.code !== 0) { process.stderr.write(r.stderr); console.error(`\n[crs-codeql] query failed (rc=${r.code}). Fix errors above; run \`crs-codeql info\`.`); return r.code; }
  const dec = run(bin, ["bqrs", "decode", "--format=text", "--entities=string,url", bqrs], { timeoutMs: 600_000 });
  process.stdout.write(dec.stdout);
  return dec.code;
}

function analyze(suite: string, db?: string): number {
  const d = resolveDb(db);
  const spec = suite === "default" ? CFG.queryPack : `${CFG.queryPack}:codeql-suites/${CFG.suitePrefix}-${suite}.qls`;
  const outDir = "/work/codeql-analyze"; fs.mkdirSync(outDir, { recursive: true });
  const sarif = path.join(outDir, `${CFG.suitePrefix}-${suite}.sarif`);
  const r = run(codeqlBin(), ["database", "analyze", d, spec, "--format=sarifv2.1.0", `--output=${sarif}`, "--threads=0", "--rerun"], { timeoutMs: 3_600_000 });
  if (r.code !== 0) { process.stderr.write(r.stderr); console.error(`[crs-codeql] analyze failed (rc=${r.code})`); return r.code; }
  console.log(`[crs-codeql] full SARIF results: ${sarif}`);
  return 0;
}

function main(): number {
  const [sub, ...rest] = process.argv.slice(2);
  let db: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) { if (rest[i] === "--db") db = rest[++i]; else args.push(rest[i]); }
  if (sub === "info" || !sub) return info(db);
  if (sub === "run") { if (!args[0]) { console.error("crs-codeql run: missing <query.ql>"); return 2; } return runQuery(args[0], db); }
  if (sub === "analyze") { let suite = "security-extended"; for (let i = 0; i < args.length; i++) if (args[i] === "--suite") suite = args[++i]; return analyze(suite, db); }
  console.error(`crs-codeql: unknown subcommand '${sub}'`); return 2;
}

process.exit(main());
