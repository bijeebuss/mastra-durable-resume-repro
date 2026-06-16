# Repro: durable agent can't resume a suspended run after a process restart

`@mastra/core@1.42.0`. A durable `EventedAgent` run that suspends on tool
approval cannot be resumed once the in-memory run registry is gone (idle
eviction, or a process restart) — even though the **full workflow snapshot,
including the suspended tool's args, is durably persisted** to storage. Two gaps
in the durable-agent layer block resuming a persisted suspended run from a cold
process.

## Run

Requires Postgres (used by `@mastra/pg`) and an Anthropic API key:

```sh
export POSTGRES_URL="postgres://user:pass@host:5432/db"
export ANTHROPIC_API_KEY="sk-ant-..."
# optional: export REPRO_MODEL="claude-haiku-4-5"
npm install

# Process A: start a run, suspend on approval, persist the snapshot, then exit (= "restart")
npx tsx 1-suspend.ts

# Process B: a FRESH process tries to resume the persisted run
npx tsx 2-resume.ts
```

`1-suspend.ts` prints that the run suspended and that the snapshot is persisted
to `mastra_workflow_snapshot` for both the inner `durable-agentic-execution` and
outer `durable-agentic-loop` workflows, with `suspendPayload.args` containing the
tool args. So everything needed to resume is on disk.

## Gap 1 — `prepare()` ignores `options.runId`

`2-resume.ts` shows that `resume(runId)` throws
`No registry entry found for run … Cannot resume.` (the registry built by the
original `stream()` is gone). `prepare()` looks like the intended rehydration
primitive, but it **registers a different runId than requested**, so a follow-up
`resume(runId)` still can't find it.

`stream()` forwards the run id to the preparation; `prepare()` does not. In
`node_modules/@mastra/core/dist/agent/durable/index.js`, `prepare()`:

```js
const preparation = await prepareForDurableExecution({
  agent: this.#wrappedAgent,
  messages,
  options,
  runId: options?.runId,          // <-- ADD THIS (stream() already passes it)
  requestContext: options?.requestContext,
  mastra: this.#mastra,
});
```

(`prepareForDurableExecution` does `const runId = providedRunId ?? crypto.randomUUID()`,
so without the forward it always mints a new id.)

After applying that one-line patch, re-run `1-suspend.ts` then `2-resume.ts`:
now `prepare()` registers the correct runId, `resume()` **loads the durable
snapshot and resumes the workflow across the restart** — but you hit Gap 2.

## Gap 2 — rehydrated resume drops the suspended tool's args

With Gap 1 patched, the approved tool executes with **undefined args**:

```
Error: Cannot read properties of undefined (reading 'note')
  at .../agent/durable/index.js   // const cleanedArgs = { ...args };  (args is undefined)
```

The args are in the persisted snapshot (`1-suspend.ts` prints
`suspendPayload.args = { "note": "…" }`), but they are not restored into the tool
step on a cold/rehydrated resume. In an in-process resume the args survive
because the step state is still in memory; from a fresh process they're dropped.

## Expected

Resuming a persisted, suspended durable run after a restart should rehydrate the
registry from the agent + a fresh request context and resume from the durable
snapshot, with the suspended tool's args restored from `suspendPayload.args`.
Either fix `prepare()` (forward `runId`) **and** restore the args on cold resume,
or add a dedicated "resume a persisted run by id" API that does both.
