// Supervisor driver: an orchestrator agent coordinating a roster of subagents on the Claude
// Agent SDK, LOOPED until the run is aborted (SIGTERM/timeout). One `query()` returns when the
// agent decides it's done — which used to end the whole run early and kill the background
// fuzzer. Instead we relaunch the orchestrator round after round (the fuzzer keeps running
// across rounds), so the run uses its full time budget. A consecutive-error breaker stops the
// loop if the LLM endpoint is failing (e.g. token limit) rather than spinning.

import { runAgent, loadRole, loadAgentDef } from "../agent.js";
import type { RunContext } from "../boot.js";
import { log } from "../common.js";

const SUB_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep"];
const ROUND_PAUSE_MS = 5_000;
const MAX_CONSEC_ERRORS = 3;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

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

  const opts = {
    role, cwd: ctx.sourceDir, agents,
    model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8",
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "Agent"],
    maxTurns: 1_000_000,
  };
  const firstTask =
    `Coordinate the ${roster} subagents to find vulnerabilities in \`${ctx.target}\` through ` +
    `harness \`${ctx.harness}\`, saving verified crashing inputs to /artifacts/povs. Read ` +
    `CLAUDE.md and consult .rustmite/strategies/ (pick an untried strategy per subagent). Launch ` +
    `the subagents to work in parallel now and keep coordinating until you have exhausted the ` +
    `current leads.`;
  const contTask =
    `Continuing the bug-finding campaign on \`${ctx.target}\` / harness \`${ctx.harness}\`. The ` +
    `background fuzzer has kept running and the corpus has grown. Re-read CLAUDE.md, check ` +
    `\`crs-coverage\` for new reach, review .rustmite/strategies/_tried.jsonl to avoid repeating ` +
    `attempts, pick a fresh strategy/gap, and relaunch the subagents on it. Find NEW distinct ` +
    `bugs and keep the fuzzer fed.`;

  log(`supervisor(loop): orchestrator + [${subagentNames.join(", ")}] on harness ${ctx.harness}`);
  let round = 0, consecErrors = 0;
  while (!abort.signal.aborted) {
    round += 1;
    const res = await runAgent({ task: round === 1 ? firstTask : contTask, abort, ...opts });
    log(`orchestrator round ${round}: isError=${res.isError} turns=${res.turns} cost=$${res.cost.toFixed(4)}`);
    if (abort.signal.aborted) break;
    // A fast error at ~$0 cost is an LLM-endpoint failure (token/rate limit). Back off; bail if persistent.
    if (res.isError || (res.turns <= 1 && res.cost === 0)) {
      if (++consecErrors >= MAX_CONSEC_ERRORS) {
        log(`stopping supervisor loop after ${consecErrors} consecutive LLM failures (likely token/rate limit).`);
        break;
      }
      await sleep(30_000, abort.signal);
    } else {
      consecErrors = 0;
      await sleep(ROUND_PAUSE_MS, abort.signal);
    }
  }
  log(`supervisor loop ended after ${round} round(s) (aborted=${abort.signal.aborted}).`);
}
