import pg from "pg"

async function withClient<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.POSTGRES_URL })
  await c.connect()
  try { return await fn(c) } finally { await c.end() }
}

export async function snapshotRows(runId: string): Promise<Array<{ workflow_name: string; snapshot: any }>> {
  return withClient(async (c) => {
    const { rows } = await c.query(
      "select workflow_name, snapshot from mastra_workflow_snapshot where run_id = $1",
      [runId],
    )
    return rows
  })
}

// Clears prior state for the fixed run/thread so the model reliably re-issues the tool call.
export async function cleanState(runId: string, threadId: string): Promise<void> {
  await withClient(async (c) => {
    for (const [tbl, col, val] of [
      ["mastra_workflow_snapshot", "run_id", runId],
      ["mastra_messages", "thread_id", threadId],
      ["mastra_threads", "id", threadId],
    ] as const) {
      await c.query(`delete from ${tbl} where ${col} = $1`, [val]).catch(() => {})
    }
  })
}
