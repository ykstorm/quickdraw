import { BenchmarkConfig, BenchmarkResult, ProviderName, ProviderStreamResult, RunResult, StreamMetrics } from './types'
import { CostTracker } from './cost-tracker'
import { getLogger } from './logger'
import { computeMetrics } from './metrics'
import { anthropicStream, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'
import { openaiStream, DEFAULT_OPENAI_MODEL } from './providers/openai'
import { getPrompt } from '../prompts/test-prompts'
import { summarize, average } from './stats'

function modelFor(provider: ProviderName, override?: string): string {
  if (override) return override
  return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : DEFAULT_OPENAI_MODEL
}

function streamFor(
  provider: ProviderName,
  prompt: string,
  onChunk: ((text: string) => void) | undefined,
  model: string
): Promise<ProviderStreamResult> {
  return provider === 'anthropic'
    ? anthropicStream(prompt, onChunk, model)
    : openaiStream(prompt, onChunk, model)
}

/** Fold a provider's per-run results into one aggregated BenchmarkResult. */
function aggregate(provider: string, model: string, runs: RunResult[]): BenchmarkResult {
  const ok = runs.filter((r) => r.success)
  if (ok.length === 0) {
    return {
      provider,
      model,
      metrics: { ttft_ms: 0, tps: 0, total_duration_ms: 0, token_count: 0, guardrail_overhead_ms: 0, api_calls: runs.length },
      cost_usd: 0,
      success: false,
      error: runs.find((r) => r.error)?.error ?? 'all runs failed',
      runs: 0,
      perRun: runs,
    }
  }

  const ttftVals = ok.map((r) => r.metrics.ttft_ms)
  const tpsVals = ok.map((r) => r.metrics.tps)
  const avgMetrics: StreamMetrics = {
    ttft_ms: parseFloat(average(ttftVals).toFixed(1)),
    tps: parseFloat(average(tpsVals).toFixed(1)),
    total_duration_ms: parseFloat(average(ok.map((r) => r.metrics.total_duration_ms)).toFixed(1)),
    token_count: Math.round(average(ok.map((r) => r.metrics.token_count))),
    guardrail_overhead_ms: parseFloat(average(ok.map((r) => r.metrics.guardrail_overhead_ms)).toFixed(1)),
    api_calls: runs.length,
  }

  return {
    provider,
    model,
    metrics: avgMetrics,
    cost_usd: parseFloat(ok.reduce((s, r) => s + r.cost_usd, 0).toFixed(6)),
    success: true,
    runs: ok.length,
    perRun: runs,
    ttft: summarize(ttftVals, 1),
    tps: summarize(tpsVals, 1),
  }
}

export async function runBenchmark(config: BenchmarkConfig): Promise<BenchmarkResult[]> {
  const costTracker = new CostTracker(config.costCap ?? 2.0)
  const logger = getLogger()
  const results: BenchmarkResult[] = []
  let ceilingHit = false

  for (const provider of config.providers) {
    const model = modelFor(provider, config.model)
    const perRun: RunResult[] = []

    for (let i = 0; i < config.runs; i++) {
      if (ceilingHit) break
      const prompt = config.prompt ?? getPrompt(i)

      try {
        let guardrail_overhead_ms = 0
        const onChunk = config.guardrails
          ? (text: string) => {
              const guardStart = Date.now()
              void text.length
              guardrail_overhead_ms += Date.now() - guardStart
            }
          : undefined

        const streamStart = Date.now()
        const streamResult = await streamFor(provider, prompt, onChunk, model)
        const latency_ms = Date.now() - streamStart

        // Enforce the cost ceiling BEFORE recording the run.
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

        perRun.push({ provider, model, metrics, cost_usd: cost, success: true })
        console.log(`  ✓ ${provider} run ${i + 1}/${config.runs} — TTFT: ${streamResult.ttft_ms}ms, TPS: ${metrics.tps}, Cost: $${cost}`)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
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

        perRun.push({
          provider,
          model,
          metrics: { ttft_ms: 0, tps: 0, total_duration_ms: 0, token_count: 0, guardrail_overhead_ms: 0, api_calls: logger.count },
          cost_usd: 0,
          success: false,
          error: errorMsg,
        })
        console.error(`  ✗ ${provider} run ${i + 1}/${config.runs} failed: ${errorMsg}`)

        if (errorMsg.includes('Cost ceiling exceeded')) {
          console.error('Cost ceiling reached. Halting benchmark.')
          ceilingHit = true
          break
        }
      }
    }

    results.push(aggregate(provider, model, perRun))
  }

  return results
}
