import { BenchmarkConfig, BenchmarkResult, ProviderName, ProviderStreamResult, RunResult, StreamMetrics } from './types'
import { CostTracker, CostCeilingError, MAX_OUTPUT_TOKENS } from './cost-tracker'
import { APICallLogger } from './logger'
import { isTruthy } from './preflight'
import { redactSecrets } from './providers/http-error'
import { computeMetrics } from './metrics'
import { anthropicStream, DEFAULT_ANTHROPIC_MODEL } from './providers/anthropic'
import { openaiStream, DEFAULT_OPENAI_MODEL } from './providers/openai'
import { getPrompt } from '../prompts/test-prompts'
import { summarize, average, round } from './stats'

/** Dependencies for a benchmark run. Both default when omitted. */
export interface BenchmarkDeps {
  logger?: APICallLogger
  onProgress?: (msg: string) => void
}

/** Resolve the model id for a provider, honoring an explicit override. */
export function resolveModel(provider: ProviderName, override?: string): string {
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

/**
 * Rough token estimate: the prompt side of the pre-call cost reservation, and
 * the output count of a run whose text arrived without one.
 */
// Deliberately high: English runs near four characters per token, code and
// other scripts fewer, so half a token per character leaves the ceiling check
// erring on the side of not calling. The real cost replaces it after the call.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

const emptyMetrics = (): StreamMetrics => ({ ttft_ms: 0, tps: 0, total_duration_ms: 0, token_count: 0 })

const NO_CONTENT = 'no content received'

/**
 * The stream result as it is recorded. Text that arrived with no output-token
 * count (no usage block) is kept, and its output tokens are estimated and
 * marked as an estimate.
 */
function withOutputCount(r: ProviderStreamResult): ProviderStreamResult {
  if (r.text.length === 0 || r.completion_tokens > 0) return r
  return { ...r, completion_tokens: estimateTokens(r.text), token_source: 'estimate' }
}

interface RunContext {
  logger: APICallLogger
  costTracker: CostTracker
  onChunk?: (text: string) => void
}

/**
 * Execute one call: reserve budget, stream, settle, log the real cost. A refused
 * reservation throws CostCeilingError (no call is made); a provider failure is
 * returned as a failed RunResult.
 */
async function runOnce(
  provider: ProviderName,
  model: string,
  prompt: string,
  ctx: RunContext
): Promise<RunResult> {
  const { logger, costTracker, onChunk } = ctx

  // Reserve budget BEFORE the call using a pessimistic estimate (max output
  // tokens). If this throws CostCeilingError, no network call is made.
  const promptEstimate = estimateTokens(prompt)
  const reserved = costTracker.reserve(provider, model, promptEstimate, MAX_OUTPUT_TOKENS)

  try {
    const streamStart = Date.now()
    const streamResult = withOutputCount(await streamFor(provider, prompt, onChunk, model))
    const latency_ms = Date.now() - streamStart

    // A completed call always costs real money: settle with the actual cost and
    // log that cost, never a fabricated $0.
    const cost = costTracker.priceOf(model, streamResult.prompt_tokens, streamResult.completion_tokens)
    costTracker.settle(reserved, cost)
    // A 200 with no text would otherwise count as a run with a 0 ms TTFT, so it
    // is a failed run, whatever the usage block says. It was still paid for, so
    // it is logged like any other.
    const empty = streamResult.text.length === 0

    logger.log({
      timestamp: new Date().toISOString(),
      provider,
      model,
      latency_ms,
      ttft_ms: streamResult.ttft_ms,
      duration_ms: streamResult.duration_ms,
      prompt_tokens: streamResult.prompt_tokens,
      completion_tokens: streamResult.completion_tokens,
      token_source: streamResult.token_source,
      cost_usd: cost,
      success: !empty,
      error: empty ? NO_CONTENT : undefined,
    })

    if (empty) {
      return { provider, model, metrics: emptyMetrics(), cost_usd: cost, success: false, error: NO_CONTENT }
    }

    const metrics = computeMetrics(streamResult.ttft_ms, streamResult.duration_ms, streamResult.completion_tokens)
    return { provider, model, metrics, cost_usd: cost, success: true }
  } catch (err) {
    // The call failed after the reservation was taken. Its real cost is not
    // reported, but the prompt may have been sent and billed, so it settles at
    // the prompt side of the estimate (input tokens at the input price), not $0.
    const cost = costTracker.priceOf(model, promptEstimate, 0)
    costTracker.settle(reserved, cost)
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.log({
      timestamp: new Date().toISOString(),
      provider,
      model,
      latency_ms: 0,
      ttft_ms: 0,
      duration_ms: 0,
      prompt_tokens: promptEstimate,
      completion_tokens: 0,
      token_source: 'estimate',
      cost_usd: cost,
      settled: 'estimate',
      success: false,
      error: errorMsg,
    })
    return { provider, model, metrics: emptyMetrics(), cost_usd: cost, success: false, error: errorMsg }
  }
}

/**
 * Settled cost of every run, failed ones included: an empty answer is still
 * billed, and a call that failed counts at its prompt-side estimate.
 */
const totalCost = (runs: RunResult[]): number => round(runs.reduce((s, r) => s + r.cost_usd, 0), 6)

/** Fold a provider's per-run results into one aggregated BenchmarkResult. */
function aggregate(provider: string, model: string, runs: RunResult[]): BenchmarkResult {
  const ok = runs.filter((r) => r.success)
  if (ok.length === 0) {
    return {
      provider,
      model,
      metrics: emptyMetrics(),
      cost_usd: totalCost(runs),
      success: false,
      error: runs.find((r) => r.error)?.error ?? 'all runs failed',
      runs: 0,
      perRun: runs,
    }
  }

  const ttftVals = ok.map((r) => r.metrics.ttft_ms)
  const tpsVals = ok.map((r) => r.metrics.tps)
  const avgMetrics: StreamMetrics = {
    ttft_ms: round(average(ttftVals), 1),
    tps: round(average(tpsVals), 1),
    total_duration_ms: round(average(ok.map((r) => r.metrics.total_duration_ms)), 1),
    token_count: Math.round(average(ok.map((r) => r.metrics.token_count))),
  }

  return {
    provider,
    model,
    metrics: avgMetrics,
    cost_usd: totalCost(runs),
    success: true,
    runs: ok.length,
    perRun: runs,
    ttft: summarize(ttftVals, 1),
    tps: summarize(tpsVals, 1),
  }
}

export async function runBenchmark(config: BenchmarkConfig, deps: BenchmarkDeps = {}): Promise<BenchmarkResult[]> {
  if (isTruthy(process.env.DRY_RUN)) {
    throw new Error('DRY_RUN is set: runBenchmark makes network calls. Unset it, or use the CLI, which prints the plan instead.')
  }
  const progress = deps.onProgress ?? ((m: string) => console.log(m))
  const ctx: BenchContext = {
    config,
    costTracker: new CostTracker(config.costCap ?? 2.0, config.allowUnpriced ?? false),
    logger: deps.logger ?? new APICallLogger({ truncate: true }),
    // A failed run's line carries the provider's error text, so redact it.
    onProgress: (m: string) => progress(redactSecrets(m)),
  }
  const results: BenchmarkResult[] = []

  for (const provider of config.providers) {
    const model = resolveModel(provider, config.model)
    // Every provider makes its own reservation, so one whose estimate fits the
    // remaining budget still runs after an earlier provider hit the ceiling.
    results.push(aggregate(provider, model, await benchProvider(provider, model, ctx)))
  }

  return results
}

interface BenchContext {
  config: BenchmarkConfig
  costTracker: CostTracker
  logger: APICallLogger
  onProgress: (m: string) => void
}

const skipped = (provider: string, model: string): RunResult => ({
  provider, model, metrics: emptyMetrics(), cost_usd: 0, success: false, error: 'skipped: cost ceiling reached',
})

/**
 * All runs for one provider. Stops at the first reservation the ceiling refuses,
 * which is recorded as a skipped run, or once settled spend reaches the ceiling.
 */
async function benchProvider(provider: ProviderName, model: string, ctx: BenchContext): Promise<RunResult[]> {
  const { config, costTracker, logger, onProgress } = ctx
  const perRun: RunResult[] = []

  for (let i = 0; i < config.runs; i++) {
    const prompt = config.prompt ?? getPrompt(i)
    const label = `${provider} run ${i + 1}/${config.runs}`

    let result: RunResult
    try {
      result = await runOnce(provider, model, prompt, { logger, costTracker, onChunk: config.onChunk })
    } catch (err) {
      if (!(err instanceof CostCeilingError)) throw err
      onProgress(`  skipped: cost ceiling reached (${label})`)
      perRun.push(skipped(provider, model))
      return perRun
    }

    perRun.push(result)
    onProgress(describeRun(label, result))
    // Stop this provider once settled spend has reached the ceiling.
    if (result.success && costTracker.spent >= costTracker.ceilingUsd) {
      onProgress(`Cost ceiling reached. No more runs for ${provider}.`)
      return perRun
    }
  }
  return perRun
}

function describeRun(label: string, result: RunResult): string {
  if (!result.success) return `  fail ${label}: ${result.error}`
  return `  ok ${label} (TTFT ${result.metrics.ttft_ms}ms, TPS ${result.metrics.tps}, $${result.cost_usd})`
}
