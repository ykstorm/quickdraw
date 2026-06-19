import { describe, it, expect } from 'vitest'
import { CostTracker, PROVIDER_COSTS } from '../src/cost-tracker'

describe('CostTracker', () => {
  it('prices Anthropic Haiku as claude-haiku-4-5 at $1.00/$5.00 per M', () => {
    expect(PROVIDER_COSTS.anthropic.model).toBe('claude-haiku-4-5')
    expect(PROVIDER_COSTS.anthropic.input_cost_per_million).toBe(1.0)
    expect(PROVIDER_COSTS.anthropic.output_cost_per_million).toBe(5.0)
  })

  it('computes Anthropic Claude Haiku costs correctly', () => {
    const tracker = new CostTracker(10.0)
    // anthropic claude-haiku-4-5: $1.00/M input, $5.00/M output
    const cost = tracker.computeCost('anthropic', 1000, 500)
    // input:  1000/1e6 * 1.00 = 0.0010
    // output:  500/1e6 * 5.00 = 0.0025
    // total = 0.0035
    expect(cost).toBeCloseTo(0.0035, 6)
  })

  it('computes OpenAI GPT-4o-mini costs correctly', () => {
    const tracker = new CostTracker(10.0)
    // GPT-4o-mini: $0.15/M input, $0.60/M output
    const cost = tracker.computeCost('openai', 1000, 500)
    // input:  1000/1e6 * 0.15 = 0.00015
    // output:  500/1e6 * 0.60 = 0.0003
    // total = 0.00045
    expect(cost).toBeCloseTo(0.00045, 6)
  })

  it('tracks total spend and remaining against the ceiling', () => {
    const tracker = new CostTracker(1.0)
    tracker.addCost(0.01)
    tracker.addCost(0.02)
    expect(tracker.total).toBeCloseTo(0.03, 6)
    expect(tracker.remaining).toBeCloseTo(0.97, 6)
  })

  it('throws when a run would exceed the ceiling', () => {
    const tracker = new CostTracker(0.001)
    // 1M input + 1M output anthropic tokens = $6.00, well over $0.001.
    expect(() => tracker.checkCeiling('anthropic', 1_000_000, 1_000_000)).toThrow(/Cost ceiling exceeded/)
  })

  it('does not throw when a run stays under the ceiling', () => {
    const tracker = new CostTracker(10.0)
    expect(() => tracker.checkCeiling('openai', 100, 100)).not.toThrow()
  })

  it('returns 0 for unknown provider', () => {
    const tracker = new CostTracker(10.0)
    const cost = tracker.computeCost('unknown', 100, 100)
    expect(cost).toBe(0)
  })
})
