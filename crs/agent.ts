// Claude Agent SDK glue: run a Claude agent (query()) with a role system-prompt, the
// shipped skills (via settingSources+cwd), pre-approved tools, optional named subagents,
// and cancellation. See notes/agent-sdk-reference.md.

import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./common.js";

// Prompt assets (crs/agents, crs/roles, crs/skills, crs/CLAUDE.md*) ship uncompiled under
// $RUSTMITE_ROOT/crs (the runner sets RUSTMITE_ROOT=/opt/rustmite).
export const RUSTMITE_ROOT =
  process.env.RUSTMITE_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ASSET_ROOT = path.join(RUSTMITE_ROOT, "crs");

export function fillPlaceholders(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

export function loadRole(name: string, vars: Record<string, string>): string {
  return fillPlaceholders(fs.readFileSync(path.join(ASSET_ROOT, "roles", `${name}.md`), "utf8"), vars);
}

export function loadAgentDef(name: string, vars: Record<string, string>): {
  description: string;
  prompt: string;
  model?: string;
} {
  // crs/agents/<name>.md: YAML-ish frontmatter (name/model/description) + body prompt.
  const raw = fillPlaceholders(fs.readFileSync(path.join(ASSET_ROOT, "agents", `${name}.md`), "utf8"), vars);
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const fm = m ? m[1] : "";
  const body = m ? m[2].trim() : raw.trim();
  const desc = (fm.match(/^description:\s*(.*)$/m)?.[1] ?? "").trim();
  const model = (fm.match(/^model:\s*(.*)$/m)?.[1] ?? "").trim() || undefined;
  return { description: desc, prompt: body, model };
}

const DEFAULT_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "Agent"];

export interface AgentResult {
  text: string;
  cost: number;
  isError: boolean;
  turns: number;
}

export interface RunAgentOpts {
  task: string;
  role?: string; // appended to the claude_code system preset
  cwd: string; // usually the source dir (loads CLAUDE.md + .claude/skills)
  model?: string;
  allowedTools?: string[];
  agents?: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }>;
  maxTurns?: number;
  abort?: AbortController;
}

/** Run one Claude agent to completion; returns its final text + cumulative cost. */
export async function runAgent(o: RunAgentOpts): Promise<AgentResult> {
  let text = "";
  let cost = 0;
  let turns = 0;
  let isError = false;
  const options: Record<string, unknown> = {
    cwd: o.cwd,
    model: o.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    permissionMode: "bypassPermissions",
    settingSources: ["project"], // load <cwd>/CLAUDE.md + <cwd>/.claude/skills
    skills: "all",
    allowedTools: o.allowedTools ?? DEFAULT_TOOLS,
    systemPrompt: o.role
      ? { type: "preset", preset: "claude_code", append: o.role }
      : { type: "preset", preset: "claude_code" },
  };
  if (o.agents) options.agents = o.agents;
  if (o.maxTurns) options.maxTurns = o.maxTurns;
  if (o.abort) options.abortController = o.abort;

  try {
    for await (const msg of query({ prompt: o.task, options: options as never })) {
      const m = msg as { type: string; message?: { content?: { type: string; text?: string }[] }; total_cost_usd?: number; error?: { message?: string } };
      if (m.type === "assistant") {
        turns += 1;
        const blocks = (m.message?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "");
        if (blocks.length) text = blocks.join("\n");
        if (typeof m.total_cost_usd === "number") cost = m.total_cost_usd;
      } else if (m.type === "error") {
        isError = true;
        text = `ERROR: ${m.error?.message ?? "unknown"}`;
        log(`agent error: ${text}`);
      }
    }
  } catch (e) {
    isError = true;
    text = `EXCEPTION: ${(e as Error).message}`;
    log(text);
  }
  return { text, cost, isError, turns };
}
