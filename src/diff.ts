import { BenchmarkResult } from './types'

export interface MetricDelta {
  before: number
  after: number
  delta: number
  pct: number
}

export interface ProviderDiff {
  provider: string
  model: string
  ttft?: MetricDelta
  tps?: MetricDelta
  cost?: MetricDelta
  /** A flag regression: e.g. went from success -> failure, or only-in-one-run. */
  regressions: string[]
  onlyIn?: 'run1' | 'run2'
}

export interface DiffResult {
  providers: ProviderDiff[]
  /** True if any TTFT/cost worsened materially or a success regressed. */
  regressed: boolean
}

function delta(before: number, after: number): MetricDelta {
  const d = after - before
  const pct = before !== 0 ? (d / before) * 100 : after === 0 ? 0 : Infinity
  return {
    before: parseFloat(before.toFixed(4)),
    after: parseFloat(after.toFixed(4)),
    delta: parseFloat(d.toFixed(4)),
    pct: Number.isFinite(pct) ? parseFloat(pct.toFixed(1)) : pct,
  }
}

/**
 * Parse a saved run file's contents into BenchmarkResult[]. Accepts either a
 * bare array or a `{ results: [...] }` envelope.
 */
export function parseRunFile(raw: string): BenchmarkResult[] {
  const data = JSON.parse(raw)
  const arr = Array.isArray(data) ? data : data.results
  if (!Array.isArray(arr)) {
    throw new Error('Run file must be a JSON array of results (or { results: [...] }).')
  }
  return arr as BenchmarkResult[]
}

/**
 * Regression-diff two benchmark runs. `regressionThresholdPct` controls how much
 * TTFT/cost must worsen (or TPS drop) before it is flagged. Default 10%.
 */
export function diffRuns(
  run1: BenchmarkResult[],
  run2: BenchmarkResult[],
  regressionThresholdPct = 10
): DiffResult {
  const byProvider = (rs: BenchmarkResult[]) => {
    const m = new Map<string, BenchmarkResult>()
    for (const r of rs) m.set(r.provider, r)
    return m
  }
  const a = byProvider(run1)
  const b = byProvider(run2)
  const names = new Set<string>([...a.keys(), ...b.keys()])

  const providers: ProviderDiff[] = []
  let regressed = false

  for (const name of names) {
    const r1 = a.get(name)
    const r2 = b.get(name)
    const regressions: string[] = []

    if (r1 && !r2) {
      providers.push({ provider: name, model: r1.model, regressions: [], onlyIn: 'run1' })
      continue
    }
    if (r2 && !r1) {
      providers.push({ provider: name, model: r2.model, regressions: [], onlyIn: 'run2' })
      continue
    }
    if (!r1 || !r2) continue

    if (r1.model !== r2.model) {
      regressions.push(`model changed: ${r1.model} -> ${r2.model}`)
    }
    if (r1.success && !r2.success) {
      regressions.push('success -> failure')
      regressed = true
    }

    const ttftBefore = r1.ttft?.avg ?? r1.metrics.ttft_ms
    const ttftAfter = r2.ttft?.avg ?? r2.metrics.ttft_ms
    const tpsBefore = r1.tps?.avg ?? r1.metrics.tps
    const tpsAfter = r2.tps?.avg ?? r2.metrics.tps

    const ttft = delta(ttftBefore, ttftAfter)
    const tps = delta(tpsBefore, tpsAfter)
    const cost = delta(r1.cost_usd, r2.cost_usd)

    if (Number.isFinite(ttft.pct) && ttft.pct > regressionThresholdPct) {
      regressions.push(`TTFT up ${ttft.pct}%`)
      regressed = true
    }
    if (Number.isFinite(tps.pct) && tps.pct < -regressionThresholdPct) {
      regressions.push(`TPS down ${Math.abs(tps.pct)}%`)
      regressed = true
    }
    if (Number.isFinite(cost.pct) && cost.pct > regressionThresholdPct) {
      regressions.push(`cost up ${cost.pct}%`)
      regressed = true
    }

    providers.push({ provider: name, model: r2.model, ttft, tps, cost, regressions })
  }

  return { providers, regressed }
}

const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`)

/** Render a DiffResult as a plain-text report. */
export function formatDiff(d: DiffResult): string {
  const lines: string[] = []
  lines.push('Regression diff (run1 -> run2)')
  lines.push('-'.repeat(60))
  for (const p of d.providers) {
    if (p.onlyIn) {
      lines.push(`${p.provider} (${p.model}): present only in ${p.onlyIn}`)
      continue
    }
    lines.push(`${p.provider} (${p.model}):`)
    if (p.ttft) lines.push(`  TTFT: ${p.ttft.before} -> ${p.ttft.after} ms  (${sign(p.ttft.delta)} ms, ${sign(p.ttft.pct)}%)`)
    if (p.tps) lines.push(`  TPS:  ${p.tps.before} -> ${p.tps.after}  (${sign(p.tps.delta)}, ${sign(p.tps.pct)}%)`)
    if (p.cost) lines.push(`  cost: $${p.cost.before} -> $${p.cost.after}  (${sign(p.cost.delta)}, ${sign(p.cost.pct)}%)`)
    if (p.regressions.length > 0) {
      lines.push(`  REGRESSIONS: ${p.regressions.join('; ')}`)
    } else {
      lines.push('  no regressions')
    }
  }
  lines.push('-'.repeat(60))
  lines.push(d.regressed ? 'RESULT: regressions detected' : 'RESULT: no regressions')
  return lines.join('\n')
}
