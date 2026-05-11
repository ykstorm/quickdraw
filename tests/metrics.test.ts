import { describe, it, expect } from 'vitest'
import { computeMetrics } from '../src/metrics'

describe('computeMetrics', () => {
  it('calculates TPS correctly for normal streaming', () => {
    const result = computeMetrics(
      500,   // ttft_ms
      2000,  // duration_ms
      100,   // token_count
      10     // guardrail_overhead_ms
    )
    expect(result.ttft_ms).toBe(500)
    expect(result.tps).toBeCloseTo(66.7, 1) // (2000-500)/1000 = 1.5s → 100/1.5 = 66.7
    expect(result.total_duration_ms).toBe(2000)
    expect(result.token_count).toBe(100)
    expect(result.guardrail_overhead_ms).toBe(10)
    expect(result.api_calls).toBe(1)
  })

  it('handles instant completion (ttft ≈ duration)', () => {
    // ttft=0, duration=100ms → streaming_time = (100-0)/1000 = 0.1s
    // tps = tokens / streaming_time = 10 / 0.1 = 100
    const result = computeMetrics(0, 100, 10, 0)
    expect(result.ttft_ms).toBe(0)
    expect(result.tps).toBe(100)
  })

  it('handles zero tokens', () => {
    const result = computeMetrics(500, 1000, 0, 0)
    expect(result.tps).toBe(0)
    expect(result.token_count).toBe(0)
  })

  it('accounts for guardrail overhead', () => {
    const result = computeMetrics(500, 2000, 100, 50)
    expect(result.guardrail_overhead_ms).toBe(50)
    // TPS is based on total duration, overhead is separate
  })
})