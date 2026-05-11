import { runBenchmark } from '../src/benchmark'

const DRY_RUN = process.env.DRY_RUN === 'true'

const CONFIG = {
  runs: 3,
  providers: ['anthropic', 'openai'] as ('anthropic' | 'openai')[],
  guardrails: false,
}

async function main() {
  console.log('\n🚀 stream-bench — LLM Streaming Benchmark Toolkit\n')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no API calls)' : 'LIVE (API calls will cost $)'}`)
  console.log(`Runs: ${CONFIG.runs} per provider`)
  console.log(`Providers: ${CONFIG.providers.join(', ')}`)
  console.log(`Guardrails: ${CONFIG.guardrails}\n`)

  if (DRY_RUN) {
    console.log('Dry run complete. Run without DRY_RUN=true to execute real benchmarks.')
    return
  }

  console.log('-' .repeat(60))

  const results = await runBenchmark(CONFIG)

  console.log('\n' + '=' .repeat(60))
  console.log('\n📊 RESULTS SUMMARY\n')

  for (const result of results) {
    if (!result.success) {
      console.log(`❌ ${result.provider} — ${result.model}: ERROR — ${result.error}`)
      continue
    }
    console.log(`✅ ${result.provider} — ${result.model}`)
    console.log(`   TTFT:              ${result.metrics.ttft_ms.toLocaleString()} ms`)
    console.log(`   TPS:               ${result.metrics.tps}`)
    console.log(`   Total Duration:    ${result.metrics.total_duration_ms.toLocaleString()} ms`)
    console.log(`   Token Count:       ${result.metrics.token_count}`)
    console.log(`   Guardrail Overhead: ${result.metrics.guardrail_overhead_ms} ms (${result.metrics.guardrail_overhead_ms > 0 ? 'enabled' : 'disabled'})`)
    console.log(`   API Calls Logged:   ${result.metrics.api_calls}`)
    console.log('')
  }

  // Cost summary
  const { CostTracker } = await import('../src/cost-tracker')
  const tracker = new CostTracker(2.00)
  // Re-sum from results that had costs
  const totalCost = results.reduce((sum, r) => sum + (r.cost_usd || 0), 0)
  console.log(`💰 Total Cost: $${totalCost.toFixed(3)}`)
  console.log(`💰 Cost Remaining: $${(2.00 - totalCost).toFixed(3)} / $2.00`)
  console.log('\n📄 API calls logged to api_calls.jsonl')
}

main().catch((err) => {
  console.error('Benchmark failed:', err)
  process.exit(1)
})