#!/usr/bin/env node
// crs-sarif: emit a SARIF 2.1.0 bug-candidate report and submit it (DataType.BUG_CANDIDATE)
// for Tier-3 findings (Kani/Miri bugs with no reproducing byte-input crash). The SARIF
// schema matches libCRS/libCRS/sarif.py: { rule_id, level, message, locations:[{file,line}] }.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { libcrsSubmit, log } from "../common.js";

interface Finding {
  ruleId: string;
  level?: "error" | "warning" | "note";
  message: string;
  file: string;
  line: number;
}

export function writeSarif(f: Finding, dst?: string): string {
  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: { driver: { name: "rustmite", rules: [{ id: f.ruleId }] } },
        results: [
          {
            ruleId: f.ruleId,
            level: f.level ?? "warning",
            message: { text: f.message },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: f.file },
                  region: { startLine: f.line },
                },
              },
            ],
          },
        ],
      },
    ],
  };
  const out = dst ?? path.join(os.tmpdir(), `rustmite-${f.ruleId}-${Date.now()}.sarif`);
  fs.writeFileSync(out, JSON.stringify(sarif, null, 2));
  return out;
}

function main(): number {
  const argv = process.argv.slice(2);
  const opt: Record<string, string> = {};
  const BOOL = new Set(["no-submit"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (BOOL.has(key)) opt[key] = "1";
    else opt[key] = argv[++i];
  }
  if (!opt["rule-id"] || !opt.message || !opt.file) {
    console.error("crs-sarif: usage: crs-sarif --rule-id <id> --message <m> --file <f> [--line <n>] [--level error|warning|note] [--no-submit]");
    return 2;
  }
  const sarif = writeSarif({
    ruleId: opt["rule-id"],
    level: (opt.level as Finding["level"]) ?? "warning",
    message: opt.message,
    file: opt.file,
    line: parseInt(opt.line ?? "1", 10),
  }, opt.out);
  console.log(`[crs-sarif] wrote ${sarif}`);
  if (opt["no-submit"] === undefined) {
    if (libcrsSubmit("bug-candidate", sarif)) log(`submitted bug-candidate ${sarif}`);
  }
  return 0;
}

process.exit(main());
