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
  // ---- GAP 1 ---------------------------------------------------------------
  console.log(`\nGAP 1: prepare() ignored the requested runId.`)
  console.log(`  requested: ${RUN_ID}`)
  console.log(`  got:       ${prep.runId}`)
  console.log(`  => a follow-up resume(${RUN_ID}) still can't find the registry.`)
  console.log(`\n  Fix: in node_modules/@mastra/core/dist/agent/durable/index.js, prepare()`)
  console.log(`  passes options to prepareForDurableExecution but omits runId (stream() includes it).`)
  console.log(`  Add  runId: options?.runId,  then re-run 1-suspend.ts and 2-resume.ts to see Gap 2.`)
  process.exit(0)
}

// ---- GAP 2 (only reached once Gap 1 is patched) ----------------------------
console.log("\nprepare() honored runId (patch applied). resume()...")
const result = await agent.resume(RUN_ID, { approved: true }, { onFinish: () => console.log(">> onFinish") })

let toolOk = false
for await (const part of toAISdkStream(result.output, { from: "agent", version: "v6" } as any)) {
  const t = (part as any).type
  if (t === "tool-output-error") {
    console.log("GAP 2: the approved tool failed with undefined args:")
    console.log("  ", (part as any).errorText)
    console.log("  (the args are in the persisted snapshot's suspendPayload.args, but they")
    console.log("   are not restored into the tool step on a cold/rehydrated resume.)")
  }
  if (t === "tool-output-available" || t === "tool-result") toolOk = true
  if (t === "finish") break
}
console.log("\nresult: tool executed correctly =", toolOk)
process.exit(0)
