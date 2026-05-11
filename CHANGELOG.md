# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2026-05-11

### Added
- Vitest unit tests (8 tests: metrics + cost-tracker)
- GitHub Actions CI (test + bench dry-run)
- `.gitignore` (node_modules, dist, .env, coverage)
- `npm test` + `npm run test:watch` scripts

### Changed
- Claude Haiku model reference updated (was incorrectly priced in comments)