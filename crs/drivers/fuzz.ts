// Fuzzing driver (M0): one orchestrator agent coordinating the seed-gen / pov-gen /
// pov-gen-cov subagents (the reference loop), on the Claude Agent SDK. The background
// libFuzzer (crs-fuzz) is started by the seed-gen subagent; PoVs + seeds auto-submit via
// the dirs registered in boot().

import { runAgent, loadRole, loadAgentDef } from "../agent.js";
import type { RunContext } from "../boot.js";
import { log } from "../common.js";

const SUBAGENTS = ["seed-gen", "pov-gen", "pov-gen-cov"];
const SUB_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

export async function runFuzzSupervisor(ctx: RunContext, abort: AbortController): Promise<void> {
  const vars = { harness: ctx.harness, source_dir: ctx.sourceDir };
  const agents: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> = {};
  for (const name of SUBAGENTS) {
    const d = loadAgentDef(name, vars);
    agents[name] = { description: d.description, prompt: d.prompt, model: d.model, tools: SUB_TOOLS };
  }
  const role = loadRole("orchestrator", vars);
  const task =
    `Coordinate the seed-gen, pov-gen, and pov-gen-cov subagents to find vulnerabilities in ` +
    `\`${ctx.target}\` through harness \`${ctx.harness}\`, saving verified crashing inputs to ` +
    `/artifacts/povs. Read CLAUDE.md. Launch all three subagents in parallel now and keep going ` +
    `until killed.`;
  log(`fuzz supervisor: orchestrator + [${SUBAGENTS.join(", ")}] on harness ${ctx.harness}`);
  const res = await runAgent({
    task, role, cwd: ctx.sourceDir, agents, abort,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "Agent"],
    maxTurns: 1_000_000,
  });
  log(`orchestrator finished: isError=${res.isError} turns=${res.turns} cost=$${res.cost.toFixed(4)}`);
}
