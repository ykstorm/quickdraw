import { Percentiles } from './types'

/**
 * Nearest-rank percentile over a numeric sample.
 * Returns 0 for an empty sample. `p` is in [0, 100].
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const rank = Math.ceil((p / 100) * sorted.length)
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1
  return sorted[idx]
}

export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Compute avg/p50/p95/p99 for a sample, each rounded to `digits`. */
export function summarize(values: number[], digits = 1): Percentiles {
  const round = (n: number) => parseFloat(n.toFixed(digits))
  return {
    avg: round(average(values)),
    p50: round(percentile(values, 50)),
    p95: round(percentile(values, 95)),
    p99: round(percentile(values, 99)),
  }
}
