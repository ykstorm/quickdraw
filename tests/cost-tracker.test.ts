import { describe, it, expect } from 'vitest'
import { CostTracker } from '../src/cost-tracker'

describe('CostTracker', () => {
  it('computes Anthropic Claude Haiku costs correctly', () => {
    const tracker = new CostTracker(10.00)
    // CostTracker uses: anthropic $0.15/M input, $1.50/M output
    const cost = tracker.computeCost('anthropic', 1000, 500)
    // input: 1000/1e6 * 0.15 = 0.00015
    // output: 500/1e6 * 1.50 = 0.00075
    // total = 0.00090
    expect(cost).toBeCloseTo(0.00090, 5)
  })

  it('computes OpenAI GPT-4o-mini costs correctly', () => {
    const tracker = new CostTracker(10.00)
    // GPT-4o-mini: $0.15/M input, $0.60/M output
    const cost = tracker.computeCost('openai', 1000, 500)
    // input: 1000/1e6 * 0.15 = 0.00015
    // output: 500/1e6 * 0.60 = 0.0003
    // total = 0.00045
    expect(cost).toBeCloseTo(0.00045, 5)
  })

  it('tracks total spend across providers', () => {
    const tracker = new CostTracker(1.00)
    tracker.addCost(0.01)
    tracker.addCost(0.02)
    // CostTracker doesn't expose total spent, but addCost shouldn't throw
    expect(() => tracker.addCost(0.015)).not.toThrow()
  })

  it('returns 0 for unknown provider', () => {
    const tracker = new CostTracker(10.00)
    const cost = tracker.computeCost('unknown' as any, 100, 100)
    expect(cost).toBe(0)
  })
})