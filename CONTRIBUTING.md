# Contributing to Quickdraw

How to set up the project and the conventions to follow.

## Getting started

### Prerequisites

- Node.js 18+
- npm 9+

### Setup

```bash
git clone https://github.com/ykstorm/quickdraw.git
cd quickdraw
npm install
```

### Useful commands

```bash
npm test          # vitest unit tests
npm run lint      # eslint (zero warnings)
npm run build     # tsup build → dist/
DRY_RUN=true npm run bench   # dry run (no API calls)
npm run bench     # live against OpenAI + Anthropic (costs $)
```

## Adding a new provider

1. Create `src/providers/<provider>.ts` exporting a `<provider>Stream(prompt, onChunk?, model)` function that returns a `ProviderStreamResult` (see `src/providers/openai.ts` for the shape).
2. Wire it into `streamFor` and `resolveModel` in `src/benchmark.ts`, and add the provider to `ProviderName` in `src/types.ts` and to `REQUIRED_KEY` in `src/preflight.ts`.
3. Add the model(s) to `MODEL_PRICING` in `src/cost-tracker.ts`, with an "as of" date.
4. Add tests under `tests/`.
5. Open a PR.

See [docs/architecture.md](docs/architecture.md) for the module layout.

## Adding a new metric

1. Add the field to the relevant interface in `src/types.ts` (`StreamMetrics`, or `APICallLogEntry` for a ledger field).
2. Populate it in `src/metrics.ts` / `src/benchmark.ts`.
3. Log it in `src/logger.ts` if it belongs in the ledger.
4. Add a vitest test.

## Reporting issues

- Search existing issues first.
- Include the output of `DRY_RUN=true npm run bench` so the issue is reproducible without API costs.
- Specify OS, Node version, and provider SDK version.

## Code style

- TypeScript strict mode.
- Avoid `any` outside the overrides already justified in `eslint.config.mjs`.
- Comments for non-obvious logic; docstrings for public APIs.
- Run `npm run lint` before opening a PR — CI enforces zero warnings.

## Commit convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add provider option to specify model
fix: correct TTFT calculation for zero-token responses
docs: clarify cost ceiling behavior
test: add vitest coverage for CostTracker
```

## Pull request checklist

- [ ] `npm test` passes locally.
- [ ] `npm run lint` reports zero warnings.
- [ ] New code has docstrings / comments where needed.
- [ ] `docs/architecture.md` updated if architecture changed.
- [ ] Entry added in `CHANGELOG.md` under `Unreleased` if user-facing.

## License

By contributing, you agree that your contributions will be licensed under the Apache 2.0 license.