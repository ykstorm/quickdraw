#!/usr/bin/env node
/**
 * benchmark.js — Run stream-bench from CLI with JSON output
 * Run: node scripts/benchmark.js --providers openai --runs 3 --ceiling 0.50
 */

const { Command } = require('commander')
const { runBenchmark } = require('../src/benchmark')
const fs = require('fs')

const program = new Command()

program
  .name('benchmark')
  .description('Run LLM benchmark: TTFT, TPS, cost tracking')
  .option('-p, --providers <names>', 'Comma-separated provider list (openai,anthropic)', 'openai')
  .option('-r, --runs <n>', 'Number of runs per provider', '3')
  .option('-c, --ceiling <usd>', 'Cost ceiling in USD', '2.00')
  .option('-g, --guardrails', 'Enable guardrail overhead measurement', false)
  .parse(process.argv)

const opts = program.opts()

async function main() {
  console.log('\n=== stream-bench CLI ===')
  console.log('Providers:', opts.providers)
  console.log('Runs:', opts.runs)
  console.log('Cost ceiling: $' + opts.ceiling)
  console.log('Guardrails:', opts.guardrails)
  console.log('')

  const config = {
    providers: opts.providers.split(','),
    runs: parseInt(opts.runs),
    guardrails: opts.guardrails,
    ceiling: parseFloat(opts.ceiling),
  }

  const results = await runBenchmark(config)

  // Write JSON results
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2))
  console.log('\nResults written to results.json')
  console.log('API calls logged to api_calls.jsonl')

  // Print summary table
  console.log('\n=== Summary ===')
  for (const r of results) {
    console.log(`  ${r.provider} ${r.model}: TTFT=${r.ttft_ms}ms TPS=${r.tps.toFixed(1)} cost=$${r.cost_usd.toFixed(4)}`)
  }
}

main().catch(console.error)