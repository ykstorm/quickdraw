import { describe, it, expect } from 'vitest'
import {
  CostTracker,
  CostCeilingError,
  UnknownPricingError,
  MODEL_PRICING,
  pricingFor,
} from '../src/cost-tracker'

describe('MODEL_PRICING', () => {
  it('prices claude-haiku-4-5 at $1.00/$5.00 per M', () => {
    expect(MODEL_PRICING['claude-haiku-4-5'].input_cost_per_million).toBe(1.0)
    expect(MODEL_PRICING['claude-haiku-4-5'].output_cost_per_million).toBe(5.0)
  })

  it('prices gpt-4o-mini at $0.15/$0.60 per M', () => {
    expect(MODEL_PRICING['gpt-4o-mini'].input_cost_per_million).toBe(0.15)
    expect(MODEL_PRICING['gpt-4o-mini'].output_cost_per_million).toBe(0.6)
  })

  it('pricingFor returns undefined for an unknown model', () => {
    expect(pricingFor('no-such-model')).toBeUndefined()
  })
})

describe('CostTracker.priceOf', () => {
  it('prices by model id, not provider — a model override is costed correctly', () => {
    const tracker = new CostTracker(10.0)
    // 1000 input + 500 output on haiku: 0.001 + 0.0025 = 0.0035
    expect(tracker.priceOf('claude-haiku-4-5', 1000, 500)).toBeCloseTo(0.0035, 6)
    // gpt-4o-mini: 0.00015 + 0.0003 = 0.00045
    expect(tracker.priceOf('gpt-4o-mini', 1000, 500)).toBeCloseTo(0.00045, 6)
    // gpt-4o is far more expensive and is priced as such, not at the mini rate.
    expect(tracker.priceOf('gpt-4o', 1000, 500)).toBeCloseTo(0.0075, 6)
  })

  it('throws UnknownPricingError for an unpriced model (never silently $0)', () => {
    const tracker = new CostTracker(10.0)
    expect(() => tracker.priceOf('mystery-model', 100, 100)).toThrow(UnknownPricingError)
  })

  it('returns $0 for an unpriced model only when allowUnpriced is set', () => {
    const tracker = new CostTracker(10.0, true)
    expect(tracker.priceOf('mystery-model', 100, 100)).toBe(0)
  })
})

describe('CostTracker.reserve / settle', () => {
  it('reserves pessimistically and throws CostCeilingError when it would breach', () => {
    const tracker = new CostTracker(0.001)
    // haiku max-output reservation (512 out) is ~$0.00256, over the $0.001 cap.
    expect(() => tracker.reserve('anthropic', 'claude-haiku-4-5', 10, 512)).toThrow(CostCeilingError)
  })

  it('does not throw when the reservation fits', () => {
    const tracker = new CostTracker(10.0)
    expect(() => tracker.reserve('openai', 'gpt-4o-mini', 100, 512)).not.toThrow()
  })

  it('settles a reservation with the real cost and frees the rest of the budget', () => {
    const tracker = new CostTracker(1.0)
    const reserved = tracker.reserve('anthropic', 'claude-haiku-4-5', 10, 512)
    expect(tracker.total).toBeCloseTo(reserved, 6)
    expect(tracker.spent).toBe(0)
    // Real cost of a small completion is far below the reservation.
    const actual = tracker.priceOf('claude-haiku-4-5', 10, 50)
    tracker.settle(reserved, actual)
    expect(tracker.spent).toBeCloseTo(actual, 6)
    expect(tracker.total).toBeCloseTo(actual, 6) // reservation released
    expect(tracker.remaining).toBeCloseTo(1.0 - actual, 6)
  })

  it('CostCeilingError is an Error subclass matchable with instanceof', () => {
    const tracker = new CostTracker(0)
    try {
      tracker.reserve('openai', 'gpt-4o-mini', 1, 512)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(CostCeilingError)
      expect(e).toBeInstanceOf(Error)
    }
  })
})
