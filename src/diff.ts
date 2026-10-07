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
  /** Regressions: a metric past the threshold, or success -> failure. Each sets `regressed`. */
  regressions: string[]
  /**
   * Differences that are not regressions, such as a model change. A run on a
   * different model is a deliberate change, so it is listed but does not set
   * `regressed`; the metric checks still apply to the new numbers.
   */
  changes: string[]
  onlyIn?: 'run1' | 'run2'
}

export interface DiffResult {
  providers: ProviderDiff[]
  /** True if TTFT, TPS or cost moved past the threshold, or a success became a failure. */
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

const isNumber = (v: unknown): v is number => typeof v === 'number'

/** `metrics.ttft_ms` and `metrics.tps` are the fallbacks diffRuns reads, so both must be numbers. */
function checkMetrics(metrics: unknown, i: number): void {
  if (typeof metrics !== 'object' || metrics === null) {
    throw new Error(`Run file entry ${i} is missing a "metrics" object.`)
  }
  const m = metrics as Record<string, unknown>
  if (!isNumber(m.ttft_ms) || !isNumber(m.tps)) {
    throw new Error(`Run file entry ${i} has a "metrics" object without numeric "ttft_ms" and "tps".`)
  }
}

/** An optional `ttft` / `tps` block is read through its `avg`, which must be a number when set. */
function checkPercentiles(e: Record<string, unknown>, i: number): void {
  for (const key of ['ttft', 'tps']) {
    const avg = (e[key] as { avg?: unknown } | null | undefined)?.avg
    if (avg != null && !isNumber(avg)) {
      throw new Error(`Run file entry ${i} has a non-numeric "${key}.avg".`)
    }
  }
}

/**
 * Shape-check every field diffRuns reads, so a malformed file fails here with a
 * clean Error rather than with a TypeError once the numbers are compared.
 */
function checkEntry(entry: unknown, i: number): void {
  const e = entry as Record<string, unknown>
  if (!e || typeof e !== 'object') {
    throw new Error(`Run file entry ${i} is not an object.`)
  }
  if (typeof e.provider !== 'string' || typeof e.model !== 'string') {
    throw new Error(`Run file entry ${i} is missing string "provider"/"model" fields.`)
  }
  checkMetrics(e.metrics, i)
  if (!isNumber(e.cost_usd)) {
    throw new Error(`Run file entry ${i} is missing a numeric "cost_usd".`)
  }
  checkPercentiles(e, i)
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
  arr.forEach(checkEntry)
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
  const changes: string[] = []
  let regressed = false

  if (r1.model !== r2.model) {
    changes.push(`model ${r1.model} -> ${r2.model}`)
  }
  if (r1.success && !r2.success) {
    regressions.push('success -> failure')
    regressed = true
  }

  const ttft = delta(r1.ttft?.avg ?? r1.metrics.ttft_ms, r2.ttft?.avg ?? r2.metrics.ttft_ms)
  const tps = delta(r1.tps?.avg ?? r1.metrics.tps, r2.tps?.avg ?? r2.metrics.tps)
  const cost = delta(r1.cost_usd, r2.cost_usd)

  // pct is Infinity when the baseline was 0, which is a regression too.
  if (ttft.pct > threshold) {
    regressions.push(`TTFT up ${ttft.pct}%`)
    regressed = true
  }
  if (Number.isFinite(tps.pct) && tps.pct < -threshold) {
    regressions.push(`TPS down ${Math.abs(tps.pct)}%`)
    regressed = true
  }
  if (cost.pct > threshold) {
    regressions.push(`cost up ${cost.pct}%`)
    regressed = true
  }

  return { diff: { provider: r2.provider, model: r2.model, ttft, tps, cost, regressions, changes }, regressed }
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
      providers.push({ provider: name, model: r1.model, regressions: [], changes: [], onlyIn: 'run1' })
      continue
    }
    if (!r1 && r2) {
      providers.push({ provider: name, model: r2.model, regressions: [], changes: [], onlyIn: 'run2' })
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
    if (p.changes.length > 0) lines.push(`  Changed: ${p.changes.join('; ')}`)
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
