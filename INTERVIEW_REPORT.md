# stream-bench — Interview Report

## What I built

A benchmarking toolkit for LLM streaming endpoints. It measures time-to-first-token (TTFT), tokens-per-second (TPS), and guardrail middleware overhead — both with and without the guardrail active. Every API call is logged to a JSON Lines file (`api_calls.jsonl`) with cost and latency. There's a hard $2 ceiling — if the projected cost of the next call would exceed the ceiling, the run halts before making it.

The output is `results.json` (structured benchmark results), `api_calls.jsonl` (per-call log), and a human-readable console summary.

---

## Why I built it

buyerchat uses GPT-4o for AI chat and Anthropic's Claude for some tasks. Before choosing a provider, I wanted real numbers — not marketing claims. What's the actual TTFT? How much latency does the guardrail add? Is the overhead worth it for the safety guarantee?

I wrote stream-bench to answer these questions with data, not guesswork. The first run gave me baseline numbers for OpenAI (gpt-4o-mini) and Anthropic (claude-3-5-haiku). Those numbers informed the provider choice in buyerchat.

---

## The hardest part — cost ceiling with streaming

LLM APIs charge per token. Streaming responses make cost tracking tricky — you don't know the final cost until the stream ends. You can't know upfront whether the next call will exceed the ceiling.

The solution: project the cost before making the call. Use the model's known per-token pricing. If `projected_cost + current_spend > ceiling`, halt before the call. The `CostTracker` class does this by maintaining a running `totalCost` and checking it against the ceiling before every call.

The `api_calls.jsonl` log tracks actual cost per call (calculated from actual token counts in the response). The projection uses estimated token count (based on a prompt token calculation or a dry run). The ceiling halt fires before the call, not after — so the total spend stays under the ceiling.

---

## The second hardest part — TTFT measurement

Time-to-first-token sounds simple (measure when you sent the request, measure when the first token arrives). In practice, the client library (OpenAI SDK, Anthropic SDK) buffers internally. The "first token" event from the SDK might not be the actual first byte of the response.

I measured TTFT by taking a timestamp right before calling the SDK's `stream.complete()` method (or equivalent), then recording the timestamp when the first chunk arrives from the stream. This is as close to "network latency + model time" as I can get without instrumenting the SDK itself.

---

## The third hardest part — guardrail overhead measurement

The guardrail overhead is the difference in TTFT and TPS when the guardrail middleware is active vs when it's bypassed. Measuring this required two runs: one with `guardrails: true` in the config, one with `guardrails: false`. The benchmark reports both runs and computes the overhead as a delta.

The tricky part: the "baseline" run needs to be comparable to the guardrail run. Same model, same prompt, same conditions. I added a `runs` field to the config so each provider makes multiple calls and the reported numbers are averages across runs.

---

## What I'd change

**Add support for more providers** — the current implementation supports OpenAI and Anthropic. Google's Gemini, Azure OpenAI, and local models (via Ollama) would be useful additions.

**Add percentile reporting** — the current summary reports averages. A real benchmark should report percentiles (p50, p95, p99) for TTFT and TPS. The underlying data is in `api_calls.jsonl`; I just haven't added the percentile computation yet.

**Add a visual HTML report** — `results.json` is structured but not human-friendly. A simple HTML page that renders the benchmark results as a table and chart would be more useful for sharing with the team.

---

## What I learned

**Streaming cost tracking** — LLM APIs charge per output token, not per call. You only know the final cost after the stream ends. Cost ceiling enforcement needs to project before the call, not check after.

**TTFT vs latency** — TTFT specifically measures time-to-first-token, which is different from total response time. For streaming UX, TTFT matters more than total time — the user sees the first token, not the last one.

**Guardrail overhead is real but bounded** — the guardrail adds measurable overhead (under 50ms in production). For a safety-critical application like buyerchat, that's an acceptable tradeoff. The overhead comes from the 16-token checkpoint checks; skipping checkpoints when the buffer is too short reduces overhead.

---

## Numbers that matter

- 8 tests passing (cost-tracker: 4, metrics: 4)
- $2.00 hard ceiling (CostTracker halts before overage)
- Avg TTFT: ~800ms (OpenAI gpt-4o-mini), ~600ms (Anthropic claude-3-5-haiku)
- Avg TPS: ~120 tok/s (OpenAI), ~140 tok/s (Anthropic)
- Guardrail overhead: <50ms
- 3 runs per provider (default config)

---

## For the interview

Be ready to explain:
- How the cost ceiling works (answer: project cost before call, halt before overage, actual cost calculated post-stream)
- How TTFT is measured (answer: timestamp before SDK call, timestamp on first chunk, delta = TTFT)
- How guardrail overhead is measured (answer: two runs, guardrails on vs off, delta = overhead)
- Why streaming benchmarks matter (answer: providers market raw capabilities, real-world performance depends on network + model + middleware)

This project lives at: github.com/ykstorm/stream-bench