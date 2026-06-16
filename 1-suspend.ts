// Process A: start a durable run, suspend it on tool approval, confirm the
// snapshot (incl. the tool args) is durably persisted, then EXIT — simulating a
// process restart. Then run `2-resume.ts` in a fresh process.
import { toAISdkStream } from "@mastra/ai-sdk"
import { agent, RUN_ID, THREAD_ID, RESOURCE_ID, requestContext } from "./agent"
import { cleanState, snapshotRows } from "./db"

await cleanState(RUN_ID, THREAD_ID)

const result = await agent.stream(
  [{ role: "user", content: "Please do the dangerous thing now." }],
  {
    runId: RUN_ID,
    requestContext,
    memory: { thread: THREAD_ID, resource: RESOURCE_ID },
    toolChoice: "required", // force the tool call so the run deterministically suspends
    onSuspended: () => console.log("onSuspended fired"),
  },
)

for await (const part of toAISdkStream(result.output, { from: "agent", version: "v6" } as any)) {
  const t = (part as any).type
  if (t === "tool-approval-request" || t === "data-tool-call-approval" || t === "data-tool-call-suspended") {
    console.log("suspended on:", t)
    break
  }
  if (t === "finish") {
    console.log("finished without suspending (model didn't call the tool) — just re-run.")
    process.exit(1)
  }
}

// The OUTER `durable-agentic-loop` snapshot persists shortly after the inner one;
// wait for it so we don't "restart" before the resume target is on disk.
let rows: Array<{ workflow_name: string; snapshot: any }> = []
for (let i = 0; i < 30; i++) {
  rows = await snapshotRows(RUN_ID)
  if (rows.some((r) => r.workflow_name === "durable-agentic-loop")) break
  await new Promise((r) => setTimeout(r, 500))
}

console.log("persisted snapshot workflows:", rows.map((r) => r.workflow_name).sort())
const loop = rows.find((r) => r.workflow_name === "durable-agentic-loop")
const s = loop ? (typeof loop.snapshot === "string" ? loop.snapshot : JSON.stringify(loop.snapshot)) : ""
const m = s.match(/"suspendPayload":\{"args":(\{[^}]*\})/)
console.log("suspendPayload.args persisted:", m ? m[1] : "NOT FOUND")
console.log("\nNow run a FRESH process:  npx tsx 2-resume.ts")
process.exit(0)
