# Quickdraw architecture

Quickdraw is a small CLI with a library core. One `bench` run streams a prompt
from each provider, measures the stream, prices it, and writes a JSONL ledger
plus a summary. `diff` compares two saved summaries.

## Source tree

```
src/
  types.ts              shared interfaces
  preflight.ts          API-key checks (clean "Set <ENV>" errors)
  logger.ts             APICallLogger, appends the JSONL ledger (redacted)
  cost-tracker.ts       CostTracker (reserve/settle ceiling) + model pricing
  metrics.ts            computeMetrics (TTFT, TPS)
  stats.ts              percentile / average / summarize (p50/p95/p99)
  report.ts             formatBenchTable (terminal table)
  diff.ts               parseRunFile / diffRuns / formatDiff
  cli.ts                commander CLI (bench + diff)
  benchmark.ts          runBenchmark orchestrator
  index.ts              public library exports
  providers/
    anthropic.ts        anthropicStream() over the Messages SSE endpoint
    openai.ts           openaiStream() over the Chat Completions SSE endpoint
    http-error.ts       secret redaction, error sanitizing, request timeout
    sse.ts              line-aligned SSE reader shared by both providers

prompts/test-prompts.ts built-in prompt rotation
bench/standard-prompt.md canonical prompt for live runs
bin/cli.ts              CLI entry point (thin wrapper over src/cli.ts)
```

## Cost ceiling

`CostTracker.reserve()` runs before a call and charges a pessimistic
estimate (prompt estimate + `MAX_OUTPUT_TOKENS`) against the budget, throwing
`CostCeilingError` if it would breach the ceiling (so the call is never made).
`settle()` then swaps that reservation for the call's real cost. Because the
reservation is added synchronously before the network call, a call that could
cross the ceiling is never started. The reservation is an estimate (half a token
per prompt character plus the maximum output), so settled spend can exceed the
ceiling by the amount one call cost beyond its estimate; it cannot run away.
A call that fails settles at the prompt side of its estimate rather than $0,
because the prompt may have been billed.

A refused reservation stops that provider: the run is recorded as `skipped: cost
ceiling reached` and its later runs are not attempted. The next provider makes
its own reservation, so it still runs if its estimate fits what is left.

## Why JSON Lines

The ledger (`api_calls.jsonl`) is one row per call, written as each call
completes and started fresh for every run, so a crash leaves a readable partial
file, `tail -f api_calls.jsonl | jq` works without setup, and every summary stat
(TTFT/TPS percentiles, cost) can be recomputed from the raw rows. The CLI
computes the summary from the same per-call records in memory; nothing in `src/`
reads the file back.

## Providers

Each provider is one file exporting a `*Stream(prompt, onChunk?, model)`
function that returns a `ProviderStreamResult`. Token counts come from the
provider `usage` field, falling back to a char/4 estimate. Only OpenAI and
Anthropic are implemented.

## CI

CI runs lint, typecheck, tests with coverage, a build, and a `DRY_RUN` smoke of
the built CLI (no key needed). `live-bench.yml` is a manual-dispatch paid job
that runs the real CLI against Anthropic with a hard `--cost-cap`; it is never
triggered by push or PR, so fork PRs cannot reach the key.
