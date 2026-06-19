# stream-bench — LLM Streaming Benchmark Toolkit

## Overview

**stream-bench** is a TypeScript benchmarking toolkit for measuring LLM streaming performance metrics: Time To First Token (TTFT), Tokens Per Second (TPS), partial delivery behavior, and guardrail overhead.

## Features

### Metrics Measured

| Metric | Description |
|---|---|
| **TTFT** | Time to first token (ms) |
| **TPS** | Tokens per second (steady-state) |
| **Total Duration** | End-to-end streaming time (ms) |
| **Token Count** | Total tokens delivered |
| **Guardrail Overhead** | Extra latency introduced by guardrails (ms) |
| **Partial Delivery** | Chunks delivered per second granularity |

### Providers

- **Anthropic** — Claude 3.5 Haiku via `messages` streaming endpoint
- **OpenAI** — GPT-4o Mini via `chat/completions` streaming endpoint

### Architecture

```
src/
  types.ts              — shared TypeScript interfaces
  preflight.ts          — API-key preflight (clean "Set <ENV>" errors)
  logger.ts             — APICallLogger (logs every API request/response)
  cost-tracker.ts       — CostTracker with a hard cost ceiling + pricing table
  metrics.ts            — computeMetrics (TTFT, TPS, overhead)
  stats.ts              — percentile / average / summarize (p50/p95/p99)
  report.ts             — formatBenchTable (TTFT/TPS/cost table)
  diff.ts               — diffRuns / formatDiff (regression diffing)
  cli.ts                — commander CLI (bench + diff subcommands)
  providers/
    anthropic.ts        — anthropicStream() helper
    openai.ts           — openaiStream() helper
  benchmark.ts          — runBenchmark runner
  index.ts              — public exports

prompts/
  test-prompts.ts       — diverse benchmark prompts

bench/
  standard-prompt.md    — canonical prompt used by the nightly bench

bin/
  cli.ts                — CLI entry point (thin wrapper over src/cli.ts)
```

## Usage

```bash
# Install dependencies
npm install

# Run benchmark (defaults: 3 runs each provider, prompt variety)
npm run bench

# Run with custom params
npx quickdraw bench --providers openai --runs 5 --prompt-file ./bench/standard-prompt.md

# Programmatic
import { runBenchmark } from './src/index'

const results = await runBenchmark({
  runs: 3,
  providers: ['anthropic', 'openai'],
  guardrails: false,
})
console.log(results)
```

## Output

```
✅ Anthropic — claude-3-5-haiku-20241107
   TTFT:              1,247 ms
   TPS:                  42.3
   Total Duration:    4,102 ms
   Token Count:           173
   Guardrail Overhead:     0 ms (disabled)
   API Calls Logged:       3

✅ OpenAI — gpt-4o-mini
   TTFT:                623 ms
   TPS:                  61.7
   Total Duration:    2,891 ms
   Token Count:           178
   Guardrail Overhead:     0 ms (disabled)
   API Calls Logged:       3

💰 Total Cost: $0.041
💰 Cost Remaining: $1.959 / $2.00
```

## Design Decisions

1. **Zero-cost dry run first** — `runBenchmark` always runs a dry-run validation before billing starts.
2. **Per-call cost tracking** — Each API response includes `usage` with `prompt_tokens` + `completion_tokens`; costs computed via OpenRouter-style pricing (Anthropic Haiku: $0.15/M input, $1.50/M output; OpenAI Mini: $0.15/M input, $0.60/M output).
3. **API call logging** — Every request/response pair is serialized to `api_calls.jsonl` with timestamp, provider, model, latency, tokens, and cost.
4. **$2 hard ceiling** — `CostTracker` throws if total cost would exceed $2.00. Benchmark halts before making an unaffordable call.
5. **Guardrail overhead** — When `guardrails: true`, wraps the stream with a simple StreamingGuard (pattern-free, just measures callback overhead). Real pattern guardrails can be layered in via `@ykstorm/guardrail-proxy`.
6. **TypeScript only** — No transpiler needed at runtime; ts-node for execution.

## Testing

```bash
npm run build   # tsc --noEmit
npm run bench   # actual API calls (costs $)
```
