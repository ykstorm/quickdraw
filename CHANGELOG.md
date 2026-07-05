# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

## [1.0.1] - 2026-05-11

### Added
- Vitest unit tests (8 tests: metrics + cost-tracker)
- GitHub Actions CI (test + bench dry-run)
- `.gitignore` (node_modules, dist, .env, coverage)
- `npm test` + `npm run test:watch` scripts

### Changed
- Claude Haiku model reference updated (was incorrectly priced in comments)