import { anthropic } from "@ai-sdk/anthropic"
import { Agent } from "@mastra/core/agent"
import { EventedAgent } from "@mastra/core/agent/durable"
import { Mastra } from "@mastra/core/mastra"
import { RequestContext } from "@mastra/core/request-context"
import { createTool } from "@mastra/core/tools"
import { Memory } from "@mastra/memory"
import { PostgresStore } from "@mastra/pg"
import { z } from "zod"

export const RUN_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
export const THREAD_ID = "repro-thread"
export const RESOURCE_ID = "repro-resource"
export const requestContext = new RequestContext<any>([["tenant", "t"], ["userId", "u"]])

const storage = new PostgresStore({ id: "repro-store", connectionString: process.env.POSTGRES_URL! })

// A tool that requires approval, so the run suspends when the agent calls it.
const dangerTool = createTool({
  id: "danger_action",
  description: "Performs a sensitive action. Use whenever the user asks to 'do the dangerous thing'.",
  inputSchema: z.object({ note: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  requireApproval: true,
  // Mastra calls execute(validatedInput, context) — the tool input is the FIRST
  // positional arg (context is the second). Read `note` off the input.
  execute: async ({ note }: { note: string }) => ({ result: `EXECUTED with note: ${note}` }),
})

const baseAgent = new Agent({
  id: "repro-agent",
  name: "Repro Agent",
  instructions: "You MUST call the danger_action tool for every user request before replying. After it returns, reply exactly: ALL DONE.",
  model: anthropic(process.env.REPRO_MODEL?.trim() || "claude-haiku-4-5"),
  tools: { danger_action: dangerTool },
  memory: new Memory({ id: "repro-mem", storage }),
})

export const mastra = new Mastra({
  id: "repro-mastra",
  agents: { reproAgent: new EventedAgent({ agent: baseAgent as any, cleanupTimeoutMs: 10 * 60 * 1000 }) },
  storage,
})

// Resolve through Mastra so the agent's storage/workflow wiring is in place.
export const agent = mastra.getAgentById("repro-agent") as any
