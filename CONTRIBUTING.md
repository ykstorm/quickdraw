# Contributing to Quickdraw

Thank you for your interest in contributing! Here's everything you need to know to get started.

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

1. Create `src/providers/<provider>.ts` implementing the `Provider` interface.
2. Register it in `src/providers/index.ts`.
3. Add pricing in `src/cost-tracker.ts`.
4. Add tests.
5. Open a PR.

See [docs/architecture.md](docs/architecture.md) for the full provider adapter interface.

## Adding a new metric

1. Add the field to `src/types.ts` → `MetricResult`.
2. Capture it in `src/metrics.ts` → `MetricCollector`.
3. Log it in `src/logger.ts` → `APICallLogger`.
4. Add a vitest test.

## Reporting issues

- Search existing issues first.
- Include output of `DRY_RUN=true npm run bench` so we can reproduce without API costs.
- Specify OS, Node version, and provider SDK version.

## Code style

- TypeScript strict mode.
- No `any` (except in `.eslintrc.json` justified overrides).
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