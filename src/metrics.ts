import { StreamMetrics } from './types'

export function computeMetrics(
  ttft_ms: number,
  duration_ms: number,
  token_count: number,
  guardrail_overhead_ms: number
): StreamMetrics {
  const streaming_time_s = (duration_ms - ttft_ms) / 1000
  const tps = streaming_time_s > 0 ? token_count / streaming_time_s : 0

  return {
    ttft_ms,
    tps: parseFloat(tps.toFixed(1)),
    total_duration_ms: duration_ms,
    token_count,
    guardrail_overhead_ms,
    api_calls: 1,
  }
}