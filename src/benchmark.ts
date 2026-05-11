import { BenchmarkConfig, BenchmarkResult, ProviderStreamResult } from './types'
import { CostTracker } from './cost-tracker'
import { getLogger } from './logger'
import { computeMetrics } from './metrics'
import { anthropicStream } from './providers/anthropic'
import { openaiStream } from './providers/openai'
import { getPrompt } from '../prompts/test-prompts'

export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult[]> {
  const costTracker = new CostTracker(2.00)
  const logger = getLogger()
  const results: BenchmarkResult[] = []

  for (const provider of config.providers) {
    for (let i = 0; i < config.runs; i++) {
      const prompt = getPrompt(i)
      const model = provider === 'anthropic' ? 'claude-3-5-haiku-20241107' : 'gpt-4o-mini'

      try {
        // Guardrail overhead timing wrapper
        let guardrail_overhead_ms = 0
        const onChunk = config.guardrails
          ? (text: string) => {
              const guardStart = Date.now()
              // Minimal guard: just measure callback overhead (no real patterns here)
              void text.length
              guardrail_overhead_ms += Date.now() - guardStart
            }
          : undefined

        const streamStart = Date.now()
        const streamResult: ProviderStreamResult = provider === 'anthropic'
          ? await anthropicStream(prompt, onChunk)
          : await openaiStream(prompt, onChunk)
        const latency_ms = Date.now() - streamStart

        // Check cost ceiling before logging
        costTracker.checkCeiling(provider, streamResult.prompt_tokens, streamResult.completion_tokens)

        const cost = costTracker.computeCost(provider, streamResult.prompt_tokens, streamResult.completion_tokens)

        logger.log({
          timestamp: new Date().toISOString(),
          provider,
          model,
          latency_ms,
          prompt_tokens: streamResult.prompt_tokens,
          completion_tokens: streamResult.completion_tokens,
          cost_usd: cost,
          success: true,
        })

        costTracker.addCost(cost)

        const metrics = computeMetrics(
          streamResult.ttft_ms,
          streamResult.duration_ms,
          streamResult.tokens,
          guardrail_overhead_ms
        )
        metrics.api_calls = logger.count

        results.push({
          provider,
          model,
          metrics,
          cost_usd: cost,
          success: true,
        })

        console.log(`  ✓ ${provider} run ${i + 1}/${config.runs} — TTFT: ${streamResult.ttft_ms}ms, TPS: ${metrics.tps}, Cost: $${cost}`)
      } catch (err: any) {
        const errorMsg = err.message || String(err)
        logger.log({
          timestamp: new Date().toISOString(),
          provider,
          model,
          latency_ms: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_usd: 0,
          success: false,
          error: errorMsg,
        })

        results.push({
          provider,
          model,
          metrics: { ttft_ms: 0, tps: 0, total_duration_ms: 0, token_count: 0, guardrail_overhead_ms: 0, api_calls: logger.count },
          cost_usd: 0,
          success: false,
          error: errorMsg,
        })

        console.error(`  ✗ ${provider} run ${i + 1}/${config.runs} failed: ${errorMsg}`)

        // Stop if cost ceiling hit
        if (errorMsg.includes('Cost ceiling exceeded')) {
          console.error('Cost ceiling reached. Halting benchmark.')
          break
        }
      }
    }
  }

  return results
}