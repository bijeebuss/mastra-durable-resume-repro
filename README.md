# Repro: durable agent can't resume a suspended run after a process restart

`@mastra/core@1.42.0`. A durable `EventedAgent` run that suspends on tool
approval cannot be resumed once the in-memory run registry is gone (idle
eviction, or a process restart) — even though the **full workflow snapshot,
including the suspended tool's args, is durably persisted** to storage.

The blocker is a single bug: **`prepare()` ignores `options.runId`**, so it can't
be used to rehydrate a known run id before resuming.

> **Note (resolved):** An earlier version of this repro also claimed a second
> gap — "the suspended tool's args are dropped on cold resume." That was a bug
> in *this repo's tool*, not in Mastra. The tool read `context.note` from its
> first `execute` argument, but Mastra calls `execute(validatedInput, context)`
> (the tool input is the first positional arg). So `note` was always `undefined`,
> warm or cold. Reading the input correctly (`execute: async ({ note }) => …`)
> fixes it: the args are in fact persisted **and** restored across a restart.
> This repo now reads the input correctly, leaving only the real `prepare()` bug.

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

## The bug — `prepare()` ignores `options.runId`

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

With that one-line patch, `prepare()` registers the correct runId, `resume()`
**loads the durable snapshot and resumes the workflow across the restart**, and
the approved tool executes with its original args restored from
`suspendPayload.args`.

## Upstream

- Issue: https://github.com/mastra-ai/mastra/issues/18031
- Fix PR: https://github.com/mastra-ai/mastra/pull/18113
