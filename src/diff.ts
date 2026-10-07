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
  /** p95 TTFT, when both runs carry percentiles. */
  ttftP95?: MetricDelta
  tps?: MetricDelta
  /** p95 TPS, when both runs carry percentiles. */
  tpsP95?: MetricDelta
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
  /**
   * True if the TTFT or TPS average or p95, or the cost, moved past the
   * threshold, or a success became a failure.
   */
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

/** An optional `ttft` / `tps` block is read through its `avg` and `p95`, which must be numbers when set. */
function checkPercentiles(e: Record<string, unknown>, i: number): void {
  for (const key of ['ttft', 'tps']) {
    const block = e[key] as Record<string, unknown> | null | undefined
    for (const stat of ['avg', 'p95']) {
      const value = block?.[stat]
      if (value != null && !isNumber(value)) {
        throw new Error(`Run file entry ${i} has a non-numeric "${key}.${stat}".`)
      }
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

const METRIC_FIELD = { ttft: 'ttft_ms', tps: 'tps' } as const

/** The percentile average when the result has one, else the plain average in `metrics`. */
function avgOf(r: BenchmarkResult, key: 'ttft' | 'tps'): number {
  return r[key]?.avg ?? r.metrics[METRIC_FIELD[key]]
}

/** The p95 delta for a metric, or undefined when either run has no percentiles (an older file, or a failed run). */
function p95Delta(r1: BenchmarkResult, r2: BenchmarkResult, key: 'ttft' | 'tps'): MetricDelta | undefined {
  const before = r1[key]?.p95
  const after = r2[key]?.p95
  return isNumber(before) && isNumber(after) ? delta(before, after) : undefined
}

type Deltas = Pick<ProviderDiff, 'ttft' | 'ttftP95' | 'tps' | 'tpsP95' | 'cost'>

/** For a metric where higher is worse. pct is Infinity when the baseline was 0, which is a regression too. */
function rose(label: string, m: MetricDelta | undefined, threshold: number): string[] {
  return m && m.pct > threshold ? [`${label} up ${m.pct}%`] : []
}

/** For a metric where lower is worse. A rise from a zero baseline is infinite, and it is not a drop. */
function fell(label: string, m: MetricDelta | undefined, threshold: number): string[] {
  return m && Number.isFinite(m.pct) && m.pct < -threshold ? [`${label} down ${Math.abs(m.pct)}%`] : []
}

/** Metric regressions past `threshold` percent: TTFT and cost going up, TPS going down, on the average or the p95. */
function metricRegressions(d: Deltas, threshold: number): string[] {
  return [
    ...rose('TTFT', d.ttft, threshold),
    ...rose('TTFT p95', d.ttftP95, threshold),
    ...fell('TPS', d.tps, threshold),
    ...fell('TPS p95', d.tpsP95, threshold),
    ...rose('cost', d.cost, threshold),
  ]
}

/**
 * Compare one provider across two runs: the TTFT and TPS averages and p95s,
 * and the cost. Returns the per-provider diff and whether it counts as a
 * regression. `threshold` is the percent a metric must worsen before it is
 * flagged.
 */
export function compareProvider(
  r1: BenchmarkResult,
  r2: BenchmarkResult,
  threshold: number
): { diff: ProviderDiff; regressed: boolean } {
  const changes: string[] = r1.model !== r2.model ? [`model ${r1.model} -> ${r2.model}`] : []
  const regressions: string[] = r1.success && !r2.success ? ['success -> failure'] : []

  const deltas: Deltas = {
    ttft: delta(avgOf(r1, 'ttft'), avgOf(r2, 'ttft')),
    ttftP95: p95Delta(r1, r2, 'ttft'),
    tps: delta(avgOf(r1, 'tps'), avgOf(r2, 'tps')),
    tpsP95: p95Delta(r1, r2, 'tps'),
    cost: delta(r1.cost_usd, r2.cost_usd),
  }
  regressions.push(...metricRegressions(deltas, threshold))

  return {
    diff: { provider: r2.provider, model: r2.model, ...deltas, regressions, changes },
    regressed: regressions.length > 0,
  }
}

/**
 * Regression-diff two benchmark runs. `regressionThresholdPct` is how far, in
 * percent, the TTFT or TPS average or p95, or the cost, must worsen before it
 * is flagged. Default 10%. Entries are aligned by provider/model.
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

/** The report rows, in order: label, delta field, unit, and a prefix for the values. */
const ROWS: [label: string, key: keyof Deltas, unit: string, prefix: string][] = [
  ['TTFT:', 'ttft', ' ms', ''],
  ['TTFT p95:', 'ttftP95', ' ms', ''],
  ['TPS: ', 'tps', '', ''],
  ['TPS p95: ', 'tpsP95', '', ''],
  ['cost:', 'cost', '', '$'],
]

const deltaLine = (label: string, m: MetricDelta, unit: string, prefix: string): string =>
  `  ${label} ${prefix}${m.before} -> ${prefix}${m.after}${unit}  (${sign(m.delta)}${unit}, ${sign(m.pct)}%)`

/** The report lines for one provider. */
function providerLines(p: ProviderDiff): string[] {
  if (p.onlyIn) return [`${p.provider} (${p.model}): present only in ${p.onlyIn}`]
  const lines = [`${p.provider} (${p.model}):`]
  for (const [label, key, unit, prefix] of ROWS) {
    const m = p[key]
    if (m) lines.push(deltaLine(label, m, unit, prefix))
  }
  if (p.changes.length > 0) lines.push(`  Changed: ${p.changes.join('; ')}`)
  lines.push(p.regressions.length > 0 ? `  REGRESSIONS: ${p.regressions.join('; ')}` : '  no regressions')
  return lines
}

/** Render a DiffResult as a plain-text report. */
export function formatDiff(d: DiffResult): string {
  const rule = '-'.repeat(60)
  const result = d.regressed ? 'RESULT: regressions detected' : 'RESULT: no regressions'
  return ['Regression diff (run1 -> run2)', rule, ...d.providers.flatMap(providerLines), rule, result].join('\n')
}
