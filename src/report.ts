import { BenchmarkResult } from './types'

/**
 * Render a benchmark result set as a plain-text table covering TTFT (avg/p50/
 * p95/p99), TPS (avg/p50/p95/p99) and cost. Returns the table string.
 */
export function formatBenchTable(results: BenchmarkResult[]): string {
  const lines: string[] = []
  const header =
    'provider'.padEnd(11) +
    'model'.padEnd(22) +
    'runs'.padStart(5) +
    '  ' +
    'TTFT avg/p50/p95/p99 (ms)'.padEnd(30) +
    'TPS avg/p50/p95/p99'.padEnd(28) +
    'cost $'.padStart(10)
  lines.push(header)
  lines.push('-'.repeat(header.length))

  for (const r of results) {
    if (!r.success) {
      lines.push(
        r.provider.padEnd(11) +
          r.model.padEnd(22) +
          String(r.runs ?? 0).padStart(5) +
          '  ' +
          `ERROR: ${r.error ?? 'unknown'}`
      )
      continue
    }
    const ttft = r.ttft ?? { avg: r.metrics.ttft_ms, p50: r.metrics.ttft_ms, p95: r.metrics.ttft_ms, p99: r.metrics.ttft_ms }
    const tps = r.tps ?? { avg: r.metrics.tps, p50: r.metrics.tps, p95: r.metrics.tps, p99: r.metrics.tps }
    const ttftStr = `${ttft.avg}/${ttft.p50}/${ttft.p95}/${ttft.p99}`
    const tpsStr = `${tps.avg}/${tps.p50}/${tps.p95}/${tps.p99}`
    lines.push(
      r.provider.padEnd(11) +
        r.model.padEnd(22) +
        String(r.runs ?? 0).padStart(5) +
        '  ' +
        ttftStr.padEnd(30) +
        tpsStr.padEnd(28) +
        r.cost_usd.toFixed(4).padStart(10)
    )
  }

  return lines.join('\n')
}
