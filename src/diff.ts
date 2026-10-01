import { BenchmarkResult } from './types'
import { round } from './stats'

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
    before: round(before, 4),
    after: round(after, 4),
    delta: round(d, 4),
    pct: Number.isFinite(pct) ? round(pct, 1) : pct,
  }
}

/**
 * Parse a saved run file's contents into BenchmarkResult[]. Accepts either a
 * bare array or a `{ results: [...] }` envelope.
 */
export function parseRunFile(raw: string): BenchmarkResult[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('Run file is not valid JSON.')
  }
  const arr = Array.isArray(data) ? data : (data as { results?: unknown })?.results
  if (!Array.isArray(arr)) {
    throw new Error('Run file must be a JSON array of results (or { results: [...] }).')
  }
  // Shape-check each entry so a malformed file fails with a clean Error rather
  // than a downstream TypeError when fields are read.
  arr.forEach((entry, i) => {
    const e = entry as Record<string, unknown>
    if (!e || typeof e !== 'object') {
      throw new Error(`Run file entry ${i} is not an object.`)
    }
    if (typeof e.provider !== 'string' || typeof e.model !== 'string') {
      throw new Error(`Run file entry ${i} is missing string "provider"/"model" fields.`)
    }
    if (typeof e.metrics !== 'object' || e.metrics === null) {
      throw new Error(`Run file entry ${i} is missing a "metrics" object.`)
    }
    if (typeof e.cost_usd !== 'number') {
      throw new Error(`Run file entry ${i} is missing a numeric "cost_usd".`)
    }
  })
  return arr as BenchmarkResult[]
}

/**
 * Compare one provider across two runs. Returns the per-provider diff and
 * whether it counts as a regression. `threshold` is the percent a metric must
 * worsen before it is flagged.
 */
export function compareProvider(
  r1: BenchmarkResult,
  r2: BenchmarkResult,
  threshold: number
): { diff: ProviderDiff; regressed: boolean } {
  const regressions: string[] = []
  let regressed = false

  if (r1.model !== r2.model) {
    regressions.push(`model changed: ${r1.model} -> ${r2.model}`)
  }
  if (r1.success && !r2.success) {
    regressions.push('success -> failure')
    regressed = true
  }

  const ttft = delta(r1.ttft?.avg ?? r1.metrics.ttft_ms, r2.ttft?.avg ?? r2.metrics.ttft_ms)
  const tps = delta(r1.tps?.avg ?? r1.metrics.tps, r2.tps?.avg ?? r2.metrics.tps)
  const cost = delta(r1.cost_usd, r2.cost_usd)

  if (Number.isFinite(ttft.pct) && ttft.pct > threshold) {
    regressions.push(`TTFT up ${ttft.pct}%`)
    regressed = true
  }
  if (Number.isFinite(tps.pct) && tps.pct < -threshold) {
    regressions.push(`TPS down ${Math.abs(tps.pct)}%`)
    regressed = true
  }
  if (Number.isFinite(cost.pct) && cost.pct > threshold) {
    regressions.push(`cost up ${cost.pct}%`)
    regressed = true
  }

  return { diff: { provider: r2.provider, model: r2.model, ttft, tps, cost, regressions }, regressed }
}

/**
 * Regression-diff two benchmark runs. `regressionThresholdPct` controls how much
 * TTFT/cost must worsen (or TPS drop) before it is flagged. Default 10%. Entries
 * are aligned by provider/model.
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

    if (r1 && !r2) {
      providers.push({ provider: name, model: r1.model, regressions: [], onlyIn: 'run1' })
      continue
    }
    if (!r1 && r2) {
      providers.push({ provider: name, model: r2.model, regressions: [], onlyIn: 'run2' })
      continue
    }
    if (!r1 || !r2) continue

    const { diff, regressed: r } = compareProvider(r1, r2, regressionThresholdPct)
    if (r) regressed = true
    providers.push(diff)
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
