export interface BenchmarkConfig {
  runs: number
  providers: ('anthropic' | 'openai')[]
  guardrails: boolean
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

export interface BenchmarkResult {
  provider: string
  model: string
  metrics: StreamMetrics
  cost_usd: number
  success: boolean
  error?: string
}

export interface ProviderStreamResult {
  text: string
  tokens: number
  ttft_ms: number
  duration_ms: number
  prompt_tokens: number
  completion_tokens: number
}