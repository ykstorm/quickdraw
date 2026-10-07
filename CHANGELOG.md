# Changelog

All notable changes to `@ykstormsorg/quickdraw`. Dates are UTC and are the days
npm published each version; 1.0.0 was tagged but never published. Every
published version carries npm provenance. Items that can break an existing
install, import or script are marked Breaking.

## 2.0.1 - 2026-10-08

- Bearer tokens are redacted whatever the letter case of the scheme; before, only the exact spelling Bearer was caught (#44).

## 2.0.0 - 2026-10-07

Everything below is relative to 1.0.4 (tag `v1.0.4`, commit `63ef1d2`). That
commit is not on `main`: `main` restarts at root commit `e4fdd8e` (2026-07-07),
whose tree is the 1.0.4 tree plus six README lines. The changes come from PRs
#33 to #36, #40 and #43. Version 1.0.5 was written into `package.json` and
this file but never tagged or published; its notes are folded in here.

### Removed

- Breaking: `getLogger` and `resetLogger` are gone, with the module-level
  logger they managed. `runBenchmark(config, { logger, onProgress })` takes an
  `APICallLogger` instead; without one it makes its own, which starts the
  ledger file fresh (#33).
- Breaking: `PROVIDER_COSTS` is gone. Prices are keyed by model id in
  `MODEL_PRICING`, `pricingFor(model)` looks one up, and `CostConfig` no longer
  has a `model` field (#33).
- Breaking for TypeScript users: `StreamMetrics` no longer has
  `guardrail_overhead_ms` or `api_calls` (#33), and `ProviderStreamResult` no
  longer has `tokens` (#36). The guardrail-overhead measurement is removed;
  `BenchmarkConfig.guardrails` is optional and ignored. Pass `onChunk` to see
  the streamed text.
- Not in the npm package: the nightly GitHub Pages bench job, which never ran
  on `main`, the duplicate `publish.yml`, `SPEC.md` and `docs/CLAIM_AUDIT.md`
  (#33).

### Changed behaviour

- Breaking: the cost ceiling is checked before each call instead of after it.
  `CostTracker.computeCost`, `checkCeiling` and `addCost` are replaced by
  `priceOf`, `reserve` and `settle`. `reserve` prices a deliberately high
  estimate (half a token per prompt character plus the 512-token output limit)
  and throws `CostCeilingError` when it would cross the ceiling, so that call is
  never made. In 1.0.4 the check ran after the call had been paid for. Settled
  spend can still end up above the ceiling by the amount one call cost beyond
  its estimate (#33, #36).
- Breaking: a model with no price on file is refused before any call, by the
  CLI and by `CostTracker.priceOf` (`UnknownPricingError`), unless
  `--allow-unpriced` or `allowUnpriced` is set; such a model is then costed at
  $0 and not capped. In 1.0.4 every model was charged at its provider's
  default-model rate (#33).
- Breaking: `new APICallLogger(file)` is now
  `new APICallLogger({ file, truncate })` (#33).
- Breaking: under `DRY_RUN`, `runBenchmark` (#36) and the exported adapters
  `openaiStream` and `anthropicStream` (#40) throw instead of calling a
  provider. Only the CLI turns `DRY_RUN` into a printed plan.
- `DRY_RUN` accepts `1`, `true`, `yes` or `on` in any case; 1.0.4 accepted only
  `true` (#33).
- Each provider makes its own reservation. One whose estimate does not fit is
  reported as `skipped: cost ceiling reached` (#36), and a later provider that
  does fit still runs (#40). In 1.0.4 every provider after the ceiling was
  reported as failed.
- A call that streams back no text is a failed run, "no content received",
  instead of a success with a 0 ms TTFT (#36), whatever its usage block says
  (#43). It is written to the ledger with its real cost, and that cost counts in
  the provider total (#40). A run whose text arrives with no output-token count
  is kept, with its output estimated at half a token per character and marked
  `token_source: "estimate"` (#43).
- A call that fails with an error settles at the prompt side of its estimate,
  the prompt's estimated input tokens at the input price, instead of $0, so the
  ceiling and the provider total count a prompt that may have been billed. Its
  ledger row carries `settled: "estimate"` (#43).
- Ledger rows also record `ttft_ms`, `duration_ms` and `token_source` (#33).
- The fallback completion-token estimate is the answer's length divided by 4,
  not a count of streamed events (#33).
- `diff`: a model change prints on a `Changed:` line and does not change the
  exit code on its own; a slower run on the new model still exits 2 (#40). A
  rise from a zero baseline counts as a regression (#36). A run file whose
  entries lack the fields `diff` reads is rejected with a message naming the
  entry (#33, #40). The TTFT and TPS p95 are compared as well as the averages,
  and a regression in either counts (#43).
- Provider requests time out after `QUICKDRAW_TIMEOUT_MS`, default 120 s, and
  the timeout is a failed run (#33). A timeout part-way through the answer
  reads `<provider> timeout after <ms> ms, <n> tokens received` instead of the
  raw abort message (#43).
- `--runs` and `--max-prompt-bytes` take whole numbers only (#36); `--threshold`
  must be a number of 0 or more, so a negative one exits 1 (#43); a prompt path
  that is not a file, or is larger than `--max-prompt-bytes` (default 1 MiB), is
  rejected before it is read (#33).
- `package.json` declares Node 20 or later, which commander 14 already needed
  (#36).

### Added

- `quickdraw --version` and `-V` print the package version (#40).
- `--allow-unpriced` and `--max-prompt-bytes` for `bench` (#33).
- Exports: `MODEL_PRICING`, `pricingFor`, `MAX_OUTPUT_TOKENS`,
  `CostCeilingError`, `UnknownPricingError`, `redactSecrets`,
  `sanitizeHttpError`, `requestTimeoutMs`, `round`, `compareProvider`,
  `resolveModel`, `assertLiveCall`, `DryRunError`, and the
  `APICallLoggerOptions` and `BenchmarkDeps` types (#33, #36, #40).

### Fixed

- API keys and bearer tokens are redacted. A provider's error body is cut to
  its type, code and message, redacted, then capped at 200 characters; the
  ledger and the `--json` file are redacted before they are written (#33), and
  so is everything the CLI prints (#40). The bearer pattern stops at token
  characters, so a redacted JSON file still parses (#36).
- The adapters never send a request under `DRY_RUN`. Their key check was
  skipped there, so a direct adapter call went out with `Bearer undefined`
  (#40).
- A run file with an empty `metrics` object fails with a clear message
  instead of a `TypeError` (#40).
- CI installs with `npm ci`, pins actions by commit hash, keeps the token
  read-only by default, passes `workflow_dispatch` inputs through the
  environment, and pins the Docker base image by digest (#33).

### Internal

- `benchAction` is split into `benchConfig`, `readPrompt` and `printDryRun`
  (#34); `runBenchmark` into the provider loop and `benchProvider` (#36); `run`,
  `compareProvider` and the Anthropic event callback into smaller functions, so
  no function is at complexity 10 or more (#40).
- The SSE line reader is shared by both providers (#33).
- Each test worker writes its own ledger file, so parallel test files no longer
  truncate the same `./api_calls.jsonl` (#40).
- CI's publish job stops before `npm publish` when the pushed tag is not `v`
  followed by the `package.json` version (#43).

### Docs

- The README describes a run as numbered steps (#35), drops its bold text
  (#39), and says what the ceiling, the ledger, `DRY_RUN`, a skipped provider
  and the `diff` exit code do (#33, #36, #40). Its sample measurement is marked
  as taken on the 1.0.4 code (#40).
- `docs/architecture.md` and `CONTRIBUTING.md` are rewritten to the real source
  tree, and `SECURITY.md` points at GitHub private vulnerability reporting
  (#33, #36).

## 1.0.4 - 2026-07-05

- Fixed: throughput read about 20 times too low. A `reader.read()` slice can cut
  a `data:` line in half, and splitting each slice on its own dropped those
  events. Both providers now carry the partial line across reads, and TPS uses
  the provider's output-token count instead of the number of streamed frames.
  A test cuts a line in half on purpose.
- Added `live-bench.yml`, a manual-dispatch job that benchmarks Claude Haiku
  live and reports TTFT, TPS and cost; see the README section "A sample
  measurement".

## 1.0.3 - 2026-06-24

- Republished 1.0.2 with updated GitHub Actions and dev dependencies (#21,
  #24). No source change.

## 1.0.2 - 2026-06-19

- A working CLI: `quickdraw bench` runs the benchmark and prints a TTFT, TPS
  and cost table with p50, p95 and p99; `quickdraw diff` compares two saved
  runs and exits 2 on a regression. A missing API key exits 1 with
  `Set OPENAI_API_KEY` or `Set ANTHROPIC_API_KEY` (#23).
- The package imports under both `require` and `import`, with types, and
  `commander` is a runtime dependency (#23).
- Claude Haiku is priced as `claude-haiku-4-5` at $1.00 / $5.00 per million
  tokens (#23).
- A CLI Docker image can be built from the repository (#14).

## 1.0.1 - 2026-05-30

- First npm release, renamed to the `@ykstormsorg` scope, with a README that
  drops claims the code did not back.

## 1.0.0 - not published

- Tagged on 2026-05-28 as `@ykstorm/quickdraw` when the project was renamed
  from stream-bench (#1); never published to npm. Included Vitest tests for the
  metrics and the cost tracker and a GitHub Actions CI job.
