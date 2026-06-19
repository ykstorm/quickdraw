#!/usr/bin/env node
/**
 * Quickdraw CLI entry point.
 *
 * Subcommands:
 *   quickdraw bench  --providers openai,anthropic --runs 3 --cost-cap 2 [--model id] [--prompt-file path] [--json out.json]
 *   quickdraw diff   <run1.json> <run2.json> [--threshold pct]
 *
 * Env:
 *   DRY_RUN=true       print the plan, make no network calls
 *   OPENAI_API_KEY     required for the openai provider (live runs)
 *   ANTHROPIC_API_KEY  required for the anthropic provider (live runs)
 */
import { run } from '../src/cli'

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[quickdraw] Fatal:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
