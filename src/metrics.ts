import { StreamMetrics } from './types'
import { round } from './stats'

export function computeMetrics(ttft_ms: number, duration_ms: number, token_count: number): StreamMetrics {
  const streaming_time_s = (duration_ms - ttft_ms) / 1000
  const tps = streaming_time_s > 0 ? token_count / streaming_time_s : 0

  return {
    ttft_ms,
    tps: round(tps, 1),
    total_duration_ms: duration_ms,
    token_count,
  }
}
