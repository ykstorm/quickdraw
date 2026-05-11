# stream-bench

**LLM streaming performance benchmarking toolkit.**  
Measures time-to-first-token (TTFT), tokens-per-second (TPS), guardrail overhead, and partial-delivery quality for OpenAI and Anthropic streaming endpoints.

---

## What it measures

| Metric | Description |
|---|---|
| **TTFT** | Time to first token — cold network latency |
| **TPS** | Tokens per second — streaming throughput |
| **Guardrail overhead** | Extra latency when guardrail middleware is active vs baseline |
| **Partial delivery** | Content delivered before guardrail abort fires |

---

## Quick start

```bash
npm install stream-bench
# or
git clone https://github.com/ykstorm/stream-bench && cd stream-bench && npm install
```

### Run a benchmark

```bash
# Set API keys
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...

# Run 3 calls per provider
npm run bench

# Dry run (no API calls)
DRY_RUN=true npm run bench:dry
```

---

## Architecture

```
BenchmarkConfig { providers, runs, guardrails }
        │
        ▼
Provider clients (OpenAI, Anthropic)
        │
        ├──► TTFT measurement
        ├──► TPS measurement  
        └──► Guardrail overhead (optional)

CostTracker — logs every call, enforces $2 ceiling
APICallLogger — JSON Lines output (api_calls.jsonl)
```

---

## Output

Each benchmark run produces:
- **JSON** (`results.json`) — structured benchmark results
- **JSONL** (`api_calls.jsonl`) — per-call cost + latency log  
- **Console** — human-readable summary

### Cost ceiling

Default ceiling: **$2.00**. Every API call is logged with cost. If ceiling is exceeded, the run halts before the next call. Check `CostTracker` in `src/cost-tracker.ts`.

---

## Configuration

```typescript
const config: BenchmarkConfig = {
  providers: ['openai', 'anthropic'],
  runs: 3,
  guardrails: true,  // measure guardrail overhead
}
```

---

## Real benchmark numbers

From a 2026-05-11 run on 3 calls each:

| Provider | Model | Avg TTFT | Avg TPS | Guardrail overhead |
|---|---|---|---|---|
| OpenAI | gpt-4o-mini | ~800ms | ~120 tok/s | <50ms |
| Anthropic | claude-3-5-haiku | ~600ms | ~140 tok/s | <50ms |

See [`experiments.md`](./experiments.md) for full raw data.

---

## License

Apache 2.0 — see [`LICENSE`](./LICENSE).
