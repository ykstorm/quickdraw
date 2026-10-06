# Quickdraw

Benchmark LLM streaming across OpenAI and Anthropic: time to first token (TTFT),
tokens per second (TPS), p50/p95/p99, and cost, on your prompts, with a hard cost
ceiling.

[![CI](https://github.com/ykstorm/quickdraw/actions/workflows/ci.yml/badge.svg)](https://github.com/ykstorm/quickdraw/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@ykstormsorg/quickdraw)](https://www.npmjs.com/package/@ykstormsorg/quickdraw)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

---

## What it does

LLM SDKs report a single latency number, not a streaming breakdown. Time to the
first token, time generating the rest, and throughput in tokens per second are
different numbers that answer different questions. Quickdraw splits a streamed
response into those phases, reports each one as avg / p50 / p95 / p99 across
runs, prices the run from provider token counts, and stops before a configured
cost ceiling.

Two design choices are worth calling out. Every call is written to the
`api_calls.jsonl` ledger with its timings, token counts and cost, so a summary can
be checked against the rows it came from. The cost ceiling is checked before each
call against a deliberately high estimate (half a token per prompt character plus
the maximum output), so a call that could cross the ceiling is never started; the
real cost replaces the estimate afterwards, so settled spend can still end up
slightly above the ceiling when a call cost more than its estimate.

---

## How it works

1. The CLI validates the flags, reads the prompt file if one is given, and refuses to start if any model has no pricing on file (unless `--allow-unpriced`).
2. `runBenchmark` loops over the providers and runs. Before each call it reserves a pessimistic cost estimate against the ceiling; a run that would cross it is skipped and marked as such.
3. Each provider streams a response; the first token's arrival time gives TTFT, the rest of the stream gives tokens per second and total duration.
4. Every call is written to `api_calls.jsonl` as it happens (the file is started fresh each run), and the summary numbers are computed from the same per-call records.
5. Results print as a table and, with `--json`, are written with secrets redacted.

Metrics captured per run:

| Metric | Description |
|---|---|
| `ttft_ms` | Milliseconds from request start to first token received |
| `tps` | Tokens per second after first token |
| `total_duration_ms` | Full end-to-end time |
| `cost_usd` | Computed from token counts and model pricing |

---

## Quick start

```bash
# Install
npm install -g @ykstormsorg/quickdraw

# Run against both providers, 3 runs each, $2 hard cost cap
quickdraw bench --providers openai,anthropic --runs 3 --cost-cap 2

# Use your own prompt and save the full results JSON
quickdraw bench --providers openai --runs 5 --prompt-file ./bench/standard-prompt.md --json run.json

# Dry run (no API calls, prints the plan only)
DRY_RUN=true quickdraw bench --providers openai --runs 1

# Regression-diff two saved runs (exit code 2 if a regression is detected)
quickdraw diff baseline.json candidate.json
```

The benchmark table reports avg / p50 / p95 / p99 for both TTFT and TPS, plus
per-provider cost. If a required API key is missing, the CLI exits with a clean
`Set OPENAI_API_KEY` / `Set ANTHROPIC_API_KEY` message and makes no network call.

### Try locally

```bash
git clone https://github.com/ykstorm/quickdraw.git
cd quickdraw
npm install
npm test                    # vitest suite
DRY_RUN=true npm run bench  # prints the plan; no network calls
# Then with real keys:
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
npm run bench               # live against OpenAI + Anthropic
```

---

## Library mode

```typescript
import { runBenchmark } from '@ykstormsorg/quickdraw'

const results = await runBenchmark({
  providers: ['openai', 'anthropic'],
  runs: 3,
})
// results: BenchmarkResult[] with per-provider stream metrics
```

---

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ |
| Types | TypeScript |
| Build | tsup |
| Tests | Vitest |
| Providers | OpenAI + Anthropic REST streaming (raw `fetch`) |
| License | Apache 2.0 |

---

## A sample measurement

Measured once on 2026-07-05 from a GitHub-hosted runner (region not recorded),
3 calls to `claude-haiku-4-5` with the committed
[`bench/standard-prompt.md`](bench/standard-prompt.md) (a ~230-token completion):

| Metric | avg | p50 | p95 / p99 |
|---|---|---|---|
| TTFT (ms) | 775 | 739 | 1143 |
| TPS (tokens/sec) | 87.2 | 85.6 | 90.9 |

Cost for the 3 calls: $0.0037. Read this as a point sample of one network path
on one day, not a provider comparison or a stable benchmark. With n=3 the "p95"
and "p99" are just the slowest of the three calls, and the numbers move with the
runner's region, the time of day, and provider load. Run the numbers for your
own path: trigger the `live-anthropic` job in
[`live-bench.yml`](.github/workflows/live-bench.yml) (manual dispatch only, so
fork PRs cannot reach the key), or locally with `ANTHROPIC_API_KEY=... npm run
bench -- --providers anthropic`.

TPS is computed from the provider's `usage` output-token count, not a raw count
of streamed SSE frames (which undercounts throughput when one frame carries
several tokens). When `usage` is absent, both token counts fall back to a char/4
estimate.

## Supported

- Percentile reporting: TTFT and TPS as avg / p50 / p95 / p99 across runs.
- Regression diffing: `quickdraw diff <run1.json> <run2.json>` compares two saved runs and flags TTFT/TPS/cost regressions and success/model changes (exit code 2 when a regression is found).
- Token counts from each provider's `usage` field when available, falling back to a char/4 estimate.
- API-key preflight: a missing key produces a clean `Set <ENV_VAR>` message and exit 1, not a `Bearer undefined` 401 dump.

## Not supported

- No Bedrock, Vertex, Gemini, Azure, or local models. Only OpenAI and Anthropic.
- No hosted dashboard. Results are a JSON file and a terminal table, with no web UI.
- No guardrail-overhead measurement. A per-chunk `onChunk` callback is available for streaming consumption, but its dispatch cost is not benchmarked.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions.

---

## License

Apache 2.0, see [LICENSE](LICENSE).