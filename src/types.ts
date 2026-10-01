export type ProviderName = 'anthropic' | 'openai'

export interface BenchmarkConfig {
  runs: number
  providers: ProviderName[]
  /**
   * @deprecated Accepted but ignored. The guardrail-overhead stub was removed;
   * pass `onChunk` to observe streamed text. Will be dropped in a future minor.
   */
  guardrails?: boolean
  /** Optional per-chunk callback, passed through to each provider stream. */
  onChunk?: (text: string) => void
  /** Hard cost ceiling in USD. Defaults to 2.00 when omitted. */
  costCap?: number
  /** Override the prompt used for every run (e.g. from --prompt-file). */
  prompt?: string
  /** Override the model id per provider. */
  model?: string
  /** Cost unpriced models at $0 instead of refusing to run. Defaults to false. */
  allowUnpriced?: boolean
}

export interface APICallLogEntry {
  timestamp: string
  provider: string
  model: string
  latency_ms: number
  /** Time to first token, ms. 0 for a failed call. */
  ttft_ms: number
  /** End-to-end stream duration, ms. 0 for a failed call. */
  duration_ms: number
  prompt_tokens: number
  completion_tokens: number
  /** Where the token counts came from: provider `usage` or a char/4 estimate. */
  token_source: 'usage' | 'estimate'
  cost_usd: number
  success: boolean
  error?: string
}

export interface StreamMetrics {
  ttft_ms: number
  tps: number
  total_duration_ms: number
  token_count: number
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
