import { Percentiles } from './types'

/** Round to `digits` decimal places and return a number (not a string). */
export function round(value: number, digits = 1): number {
  return parseFloat(value.toFixed(digits))
}

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
  return {
    avg: round(average(values), digits),
    p50: round(percentile(values, 50), digits),
    p95: round(percentile(values, 95), digits),
    p99: round(percentile(values, 99), digits),
  }
}
