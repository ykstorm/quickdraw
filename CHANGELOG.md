# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.5] - 2026-10-01

### Security
- **Cost ceiling now caps before spend.** `CostTracker.reserve()` charges a
  pessimistic estimate (prompt estimate + max output tokens) before each call and
  throws `CostCeilingError` when it would breach the ceiling, so the call is never
  made; `settle()` swaps the reservation for the real cost afterward. Previously
  the ceiling was checked only after the call had already spent money.
- **API keys are redacted everywhere.** Provider HTTP errors are sanitized to
  `type`/`code`/`message`, capped at 200 chars, and run (with the JSONL ledger and
  the results JSON) through a redactor that strips `sk-*` / `Bearer` tokens.
- **Request timeout.** Both providers abort after `QUICKDRAW_TIMEOUT_MS` (default
  120s); a timeout is reported as a clean failed run.
- **Input validation.** Prompt files are size-checked (`--max-prompt-bytes`,
  default 1 MiB) and run files are shape-checked before use.
- **CI hardening.** `npm ci`, actions pinned to commit SHAs, `permissions:
  contents: read`, `workflow_dispatch` inputs passed through env, duplicate
  `publish.yml` removed, Docker base image pinned by digest.

### Changed
- **Pricing is keyed by model id, not provider.** A `--model` override is now
  costed at its own rate. An unpriced model raises `UnknownPricingError` unless
  `--allow-unpriced` is set (never a silent $0). Prices carry an "as of" date.
- **Ledger is re-derivable.** Each `api_calls.jsonl` row now records `ttft_ms`,
  `duration_ms`, `completion_tokens`, and `token_source`, so the summary
  percentiles recompute from the raw rows.
- The fallback completion-token estimate uses generated-text length (char/4),
  matching the prompt estimate, instead of the raw SSE delta-event count.

### Removed
- Nightly GitHub Pages bench job (it was gated on `master` and never ran on
  `main`) and the stale `SPEC.md` / `docs/CLAIM_AUDIT.md`.
- The guardrail-overhead stub. `StreamMetrics` no longer carries
  `guardrail_overhead_ms` or `api_calls`; the `guardrails` config flag is
  accepted but ignored (deprecated). Pass `config.onChunk` for streaming
  consumption. `runBenchmark(config, { logger?, onProgress? })` replaces the
  module-level logger singleton (`getLogger`/`resetLogger` removed).

## [1.0.4] - 2026-07-05

### Fixed
- **SSE streaming undercounted throughput.** A `reader.read()` slice can cut a
  `data:` line in half; the naive per-chunk split dropped those deltas, so TPS
  read ~20x low on real responses. Both providers now carry a partial-line
  buffer across reads, and TPS is computed from the provider `usage`
  output-token count rather than streamed-frame count. Adds a split-boundary
  regression test.

### Added
- `live-bench.yml` — manual-dispatch job that benchmarks Claude Haiku live and
  publishes measured TTFT/TPS/cost (see README → Measured).

## [1.0.3] - 2026-06-20

No separate release notes were recorded for this version.

## [1.0.2] - 2026-05-28

No separate release notes were recorded for this version.

## [1.0.1] - 2026-05-11

### Added
- Vitest unit tests (8 tests: metrics + cost-tracker)
- GitHub Actions CI (test + bench dry-run)
- `.gitignore` (node_modules, dist, .env, coverage)
- `npm test` + `npm run test:watch` scripts

### Changed
- Claude Haiku model reference updated (was incorrectly priced in comments)