import { describe, it, expect } from 'vitest'
import { diffRuns, formatDiff, parseRunFile } from '../src/diff'
import { BenchmarkResult } from '../src/types'

function mk(over: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    metrics: { ttft_ms: 100, tps: 50, total_duration_ms: 1000, token_count: 100 },
    cost_usd: 0.001,
    success: true,
    runs: 3,
    ttft: { avg: 100, p50: 100, p95: 110, p99: 120 },
    tps: { avg: 50, p50: 50, p95: 55, p99: 60 },
    ...over,
  }
}

describe('parseRunFile', () => {
  it('parses a bare array', () => {
    const parsed = parseRunFile(JSON.stringify([mk({})]))
    expect(parsed).toHaveLength(1)
  })
  it('parses a { results } envelope', () => {
    const parsed = parseRunFile(JSON.stringify({ results: [mk({})] }))
    expect(parsed).toHaveLength(1)
  })
  it('rejects non-array content', () => {
    expect(() => parseRunFile(JSON.stringify({ nope: 1 }))).toThrow()
  })
  it('rejects invalid JSON with a clean Error', () => {
    expect(() => parseRunFile('{not json')).toThrow(/not valid JSON/)
  })
  it('rejects a malformed entry with a clean Error, not a TypeError', () => {
    // Missing metrics/cost_usd — reading these downstream would throw TypeError.
    expect(() => parseRunFile(JSON.stringify([{ provider: 'openai', model: 'gpt-4o-mini' }]))).toThrow(
      /entry 0 is missing a "metrics"/
    )
    expect(() => parseRunFile(JSON.stringify([{ foo: 1 }]))).toThrow(/entry 0 is missing string/)
    expect(() => parseRunFile(JSON.stringify(['notanobject']))).toThrow(/entry 0/)
  })
  it('rejects an empty metrics object instead of passing it on to diffRuns', () => {
    const entry = { provider: 'openai', model: 'gpt-4o-mini', metrics: {}, cost_usd: 0.001 }
    expect(() => parseRunFile(JSON.stringify([entry]))).toThrow(
      /entry 0 has a "metrics" object without numeric "ttft_ms" and "tps"/
    )
    const badAvg = { ...entry, metrics: { ttft_ms: 100, tps: 50 }, ttft: { avg: 'fast' } }
    expect(() => parseRunFile(JSON.stringify([badAvg]))).toThrow(/entry 0 has a non-numeric "ttft.avg"/)
  })
})

describe('diffRuns', () => {
  it('reports no regression for identical runs', () => {
    const r = [mk({})]
    const d = diffRuns(r, r)
    expect(d.regressed).toBe(false)
    expect(d.providers[0].ttft?.delta).toBe(0)
  })

  it('flags a TTFT regression beyond threshold', () => {
    const before = [mk({ ttft: { avg: 100, p50: 100, p95: 100, p99: 100 } })]
    const after = [mk({ ttft: { avg: 200, p50: 200, p95: 200, p99: 200 } })]
    const d = diffRuns(before, after, 10)
    expect(d.regressed).toBe(true)
    expect(d.providers[0].regressions.join(' ')).toMatch(/TTFT up 100%/)
  })

  it('treats any cost on a zero-cost baseline as a regression', () => {
    const before = [mk({ cost_usd: 0 })]
    const after = [mk({ cost_usd: 5 })]
    const d = diffRuns(before, after, 10)
    expect(d.regressed).toBe(true)
    expect(d.providers[0].regressions.join(' ')).toMatch(/cost up/)
  })

  it('flags a TPS drop beyond threshold', () => {
    const before = [mk({ tps: { avg: 100, p50: 100, p95: 100, p99: 100 } })]
    const after = [mk({ tps: { avg: 50, p50: 50, p95: 50, p99: 50 } })]
    const d = diffRuns(before, after, 10)
    expect(d.regressed).toBe(true)
    expect(d.providers[0].regressions.join(' ')).toMatch(/TPS down 50%/)
  })

  it('flags a success -> failure regression', () => {
    const before = [mk({ success: true })]
    const after = [mk({ success: false, error: 'boom' })]
    const d = diffRuns(before, after)
    expect(d.regressed).toBe(true)
    expect(d.providers[0].regressions.join(' ')).toMatch(/success -> failure/)
  })

  it('lists a model change under Changed, not under REGRESSIONS', () => {
    const d = diffRuns([mk({ model: 'gpt-4o-mini' })], [mk({ model: 'gpt-4o' })])
    expect(d.regressed).toBe(false)
    expect(d.providers[0].regressions).toEqual([])
    expect(d.providers[0].changes).toEqual(['model gpt-4o-mini -> gpt-4o'])
    const text = formatDiff(d)
    expect(text).toMatch(/Changed: model gpt-4o-mini -> gpt-4o/)
    expect(text).not.toMatch(/REGRESSIONS/)
    expect(text).toMatch(/RESULT: no regressions/)
  })

  it('still flags a slower run on a changed model as a regression', () => {
    const before = [mk({ model: 'gpt-4o-mini' })]
    const after = [mk({ model: 'gpt-4o', ttft: { avg: 300, p50: 300, p95: 300, p99: 300 } })]
    const d = diffRuns(before, after, 10)
    expect(d.regressed).toBe(true)
    expect(d.providers[0].changes).toEqual(['model gpt-4o-mini -> gpt-4o'])
    expect(d.providers[0].regressions.join(' ')).toMatch(/TTFT up 200%/)
  })

  it('notes providers present only in one run', () => {
    const before = [mk({ provider: 'openai' })]
    const after = [mk({ provider: 'anthropic', model: 'claude-haiku-4-5' })]
    const d = diffRuns(before, after)
    const openai = d.providers.find((p) => p.provider === 'openai')
    const anthropic = d.providers.find((p) => p.provider === 'anthropic')
    expect(openai?.onlyIn).toBe('run1')
    expect(anthropic?.onlyIn).toBe('run2')
  })

  it('formats a readable report', () => {
    const d = diffRuns([mk({})], [mk({})])
    const text = formatDiff(d)
    expect(text).toMatch(/Regression diff/)
    expect(text).toMatch(/no regressions/)
  })
})
