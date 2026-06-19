export type ProviderName = 'anthropic' | 'openai'

export interface BenchmarkConfig {
  runs: number
  providers: ProviderName[]
  guardrails: boolean
  /** Hard cost ceiling in USD. Defaults to 2.00 when omitted. */
  costCap?: number
  /** Override the prompt used for every run (e.g. from --prompt-file). */
  prompt?: string
  /** Override the model id per provider. */
  model?: string
}

export interface APICallLogEntry {
  timestamp: string
  provider: string
  model: string
  latency_ms: number
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number
  success: boolean
  error?: string
}

export interface StreamMetrics {
  ttft_ms: number
  tps: number
  total_duration_ms: number
  token_count: number
  guardrail_overhead_ms: number
  api_calls: number
}

/** A single run's outcome (one prompt, one provider). */
export interface RunResult {
  provider: string
  model: string
  metrics: StreamMetrics
  cost_usd: number
  success: boolean
  error?: string
}

/** Percentile breakdown for a metric across runs. */
export interface Percentiles {
  avg: number
  p50: number
  p95: number
  p99: number
}

/**
 * Aggregated, per-provider benchmark result. `metrics` carries the average run
 * (preserved for backwards compatibility); `ttft` / `tps` carry percentiles.
 */
export interface BenchmarkResult {
  provider: string
  model: string
  metrics: StreamMetrics
  cost_usd: number
  success: boolean
  error?: string
  /** Number of successful runs aggregated. */
  runs?: number
  /** Per-run detail (present when aggregated). */
  perRun?: RunResult[]
  ttft?: Percentiles
  tps?: Percentiles
}

export interface ProviderStreamResult {
  text: string
  tokens: number
  ttft_ms: number
  duration_ms: number
  prompt_tokens: number
  completion_tokens: number
  /** Where prompt/completion token counts came from. */
  token_source: 'usage' | 'estimate'
}
