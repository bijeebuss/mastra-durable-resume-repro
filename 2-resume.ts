// Process B (run AFTER 1-suspend.ts, as a fresh process): try to resume the
// persisted, suspended run. The in-memory run registry from process A is gone.
import { toAISdkStream } from "@mastra/ai-sdk"
import { agent, RUN_ID, THREAD_ID, RESOURCE_ID, requestContext } from "./agent"

// 1) resume() alone: needs the in-memory registry, which is gone after "restart".
try {
  await agent.resume(RUN_ID, { approved: true }, {})
  console.log("resume() alone SUCCEEDED (unexpected in a fresh process)")
} catch (e: any) {
  console.log("resume() alone threw (expected):", e?.message)
}

// 2) prepare() looks like the rehydration primitive — rebuild the registry for RUN_ID.
const prep = await agent.prepare([], { runId: RUN_ID, requestContext, memory: { thread: THREAD_ID, resource: RESOURCE_ID } })

if (prep.runId !== RUN_ID) {
  // ---- THE BUG -------------------------------------------------------------
  console.log(`\nBUG: prepare() ignored the requested runId.`)
  console.log(`  requested: ${RUN_ID}`)
  console.log(`  got:       ${prep.runId}`)
  console.log(`  => a follow-up resume(${RUN_ID}) still can't find the registry.`)
  console.log(`\n  Fix: in node_modules/@mastra/core/dist/agent/durable/index.js, prepare()`)
  console.log(`  passes options to prepareForDurableExecution but omits runId (stream() includes it).`)
  console.log(`  Add  runId: options?.runId,  then re-run 1-suspend.ts and 2-resume.ts.`)
  console.log(`  Upstream fix: https://github.com/mastra-ai/mastra/pull/18113`)
  process.exit(0)
}

// ---- Patched: prepare() honored runId — resume across the restart ----------
console.log("\nprepare() honored runId (patch applied). resume()...")
const result = await agent.resume(RUN_ID, { approved: true }, { onFinish: () => console.log(">> onFinish") })

let toolResult: string | undefined
for await (const part of toAISdkStream(result.output, { from: "agent", version: "v6" } as any)) {
  const t = (part as any).type
  if (t === "tool-output-error") {
    console.log("tool errored:", (part as any).errorText)
  }
  if (t === "tool-output-available" || t === "tool-result") {
    toolResult = JSON.stringify((part as any).result ?? (part as any).output)
  }
  if (t === "finish") break
}
// The approved tool runs with its original args restored from the persisted
// snapshot — e.g. result: { result: "EXECUTED with note: <the persisted note>" }.
console.log("\nresult: approved tool output =", toolResult)
process.exit(0)
