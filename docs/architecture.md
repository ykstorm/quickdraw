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

prompts/test-prompts.ts built-in prompt rotation
bench/standard-prompt.md canonical prompt for live runs
bin/cli.ts              CLI entry point (thin wrapper over src/cli.ts)
```

## Cost ceiling

`CostTracker.reserve()` runs **before** a call and charges a pessimistic
estimate (prompt estimate + `MAX_OUTPUT_TOKENS`) against the budget, throwing
`CostCeilingError` if it would breach the ceiling (so the call is never made).
`settle()` then swaps that reservation for the call's real cost. Because the
reservation is added synchronously before the network call, an in-flight request
can never overshoot the ceiling.

## Why JSON Lines

The ledger (`api_calls.jsonl`) is append-only and one row per call, so a crash
leaves a readable partial file, `tail -f … | jq` works without setup, and every
summary stat (TTFT/TPS percentiles, cost) re-derives from the raw rows.

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
