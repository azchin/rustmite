// Supervisor driver: one orchestrator agent coordinating a roster of subagents on the Claude
// Agent SDK. M0 roster = seed-gen ∥ pov-gen ∥ pov-gen-cov (fuzzing); M1 adds kani-prove; M2
// adds miri-triage; M3 adds harness-smith. The background libFuzzer is started by seed-gen;
// PoVs + seeds auto-submit via the dirs registered in boot().

import { runAgent, loadRole, loadAgentDef } from "../agent.js";
import type { RunContext } from "../boot.js";
import { log } from "../common.js";

const SUB_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];

export async function runSupervisor(
  ctx: RunContext, abort: AbortController, subagentNames: string[],
): Promise<void> {
  const vars = { harness: ctx.harness, source_dir: ctx.sourceDir };
  const agents: Record<string, { description: string; prompt: string; tools?: string[]; model?: string }> = {};
  for (const name of subagentNames) {
    const d = loadAgentDef(name, vars);
    agents[name] = { description: d.description, prompt: d.prompt, model: d.model, tools: SUB_TOOLS };
  }
  const roster = subagentNames.map((n) => `\`${n}\``).join(", ");
  const role = loadRole("orchestrator", vars);
  const task =
    `Coordinate the ${roster} subagents to find vulnerabilities in \`${ctx.target}\` through ` +
    `harness \`${ctx.harness}\`, saving verified crashing inputs to /artifacts/povs. Read ` +
    `CLAUDE.md. Launch the subagents to work in parallel now and keep going until killed.`;
  log(`supervisor: orchestrator + [${subagentNames.join(", ")}] on harness ${ctx.harness}`);
  const res = await runAgent({
    task, role, cwd: ctx.sourceDir, agents, abort,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "Agent"],
    maxTurns: 1_000_000,
  });
  log(`orchestrator finished: isError=${res.isError} turns=${res.turns} cost=$${res.cost.toFixed(4)}`);
}
