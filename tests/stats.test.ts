import { describe, it, expect } from 'vitest'
import { percentile, average, summarize } from '../src/stats'

describe('percentile', () => {
  it('returns 0 for an empty sample', () => {
    expect(percentile([], 50)).toBe(0)
  })

  it('returns the only value for a singleton', () => {
    expect(percentile([42], 95)).toBe(42)
  })

  it('computes nearest-rank percentiles', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(vals, 50)).toBe(5)
    expect(percentile(vals, 95)).toBe(10)
    expect(percentile(vals, 99)).toBe(10)
    expect(percentile(vals, 10)).toBe(1)
  })

  it('is order-independent', () => {
    expect(percentile([10, 1, 5, 3, 8], 50)).toBe(percentile([1, 3, 5, 8, 10], 50))
  })
})

describe('average', () => {
  it('returns 0 for empty', () => {
    expect(average([])).toBe(0)
  })
  it('averages values', () => {
    expect(average([2, 4, 6])).toBe(4)
  })
})

describe('summarize', () => {
  it('reports avg/p50/p95/p99 rounded', () => {
    const s = summarize([100, 200, 300, 400, 500], 1)
    expect(s.avg).toBe(300)
    expect(s.p50).toBe(300)
    expect(s.p95).toBe(500)
    expect(s.p99).toBe(500)
  })
})
