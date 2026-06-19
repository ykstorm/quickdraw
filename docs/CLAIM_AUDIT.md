# Claim Audit

Every public claim about quickdraw mapped to the code that backs it. Line
numbers are for the state of this branch (`fix/real-e2e`).

| # | Public claim | Backed by (file:line) | Verified by |
|---|---|---|---|
| 1 | `quickdraw bench` runs a real streaming benchmark across providers | `src/cli.ts:50` (bench subcommand) → `src/benchmark.ts:65` (`runBenchmark`) | `test/cli.test.ts` (bench live), `tests/benchmark.test.ts` |
| 2 | `--providers`, `--runs`, `--cost-cap`, `--prompt-file`, `--model` flags work | `src/cli.ts:51-58` | `test/cli.test.ts` (dry-run, prompt-file, unknown-provider) |
| 3 | Hard cost cap is enforced and halts the run | `src/benchmark.ts:95` (`checkCeiling`), `src/cost-tracker.ts:31` (throws) | `tests/benchmark.test.ts` ("halts when the cost ceiling is exceeded"), `tests/cost-tracker.test.ts` |
| 4 | `quickdraw diff <run1> <run2>` regression-diffs two saved runs | `src/cli.ts:118` → `src/diff.ts:55` (`diffRuns`) | `tests/diff.test.ts`, `test/cli.test.ts` (diff exits 0/2), live run (`diff` exit code 2) |
| 5 | TTFT and TPS reported as avg / p50 / p95 / p99 | `src/stats.ts:22` (`summarize`), `src/report.ts:7` (`formatBenchTable`) | `tests/stats.test.ts`, `tests/benchmark.test.ts` (percentiles) |
| 6 | Anthropic Haiku priced as `claude-haiku-4-5` at $1.00 / $5.00 per M | `src/cost-tracker.ts:14` | `tests/cost-tracker.test.ts` (pricing assertions) |
| 7 | OpenAI gpt-4o-mini priced at $0.15 / $0.60 per M | `src/cost-tracker.ts:15` | `tests/cost-tracker.test.ts` |
| 8 | Missing API key → clean `Set <ENV_VAR>` message + exit 1, no `Bearer undefined` | `src/preflight.ts:13` (message), `src/cli.ts:82-86` (CLI exit), `src/providers/*.ts` (`assertApiKey`) | `tests/preflight.test.ts`, `test/cli.test.ts` (preflight), live keyless run |
| 9 | `DRY_RUN=true` prints the plan and makes no network call | `src/cli.ts:78,88-95`; `src/preflight.ts:24` (skips check) | `test/cli.test.ts` (dry-run), live dry-run |
| 10 | Token counts read from provider `usage`, char/4 fallback | `src/providers/openai.ts:29,70-72,89-91`; `src/providers/anthropic.ts:64-76,90-93` | `tests/providers.test.ts` (usage + estimate paths) |
| 11 | Importable as a library (`import { runBenchmark }`) | `package.json` exports → `dist/index.{mjs,js,d.ts}`; `src/index.ts` | clean-clone tarball test: `require()` + `import` both resolve |
| 12 | Ships type definitions | `tsup.config.ts:18` (`dts: true`); `dist/index.d.ts` | build emits `dist/index.d.ts`; tarball contains it |
| 13 | CLI bin `quickdraw` is installed and runs | `package.json` bin → `dist/bin/cli.js`; `bin/cli.ts` | clean-clone tarball test: `npx quickdraw --help` |
| 14 | Nightly workflow runs the real CLI against `bench/standard-prompt.md` | `.github/workflows/ci.yml` (`nightly-bench`); `bench/standard-prompt.md` | file exists; workflow calls `node dist/bin/cli.js bench ... --prompt-file ./bench/standard-prompt.md` |
| 15 | Test coverage > 70% lines, enforced in CI | `vitest.config.ts` (`thresholds.lines: 70`); `.github/workflows/ci.yml` (`test:coverage`) | `npm run test:coverage` reports 96.5% lines |

## Known limitations (also stated in the README)

- Guardrail overhead is still a no-op callback measurement (not real Tripwire patterns).
- No hosted dashboard UI beyond the GitHub Pages results page produced by the nightly job.
- Only OpenAI and Anthropic providers; no Bedrock / Vertex / Gemini / Azure / local models.
