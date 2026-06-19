import { describe, it, expect, vi } from 'vitest'
import { run } from '../src/cli'
import type { BenchmarkResult } from '../src/types'

function harness() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    deps: {
      out: (m: string) => out.push(m),
      err: (m: string) => err.push(m),
    },
  }
}

function sampleResult(over: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    provider: 'openai',
    model: 'gpt-4o-mini',
    metrics: { ttft_ms: 100, tps: 50, total_duration_ms: 1000, token_count: 100, guardrail_overhead_ms: 0, api_calls: 1 },
    cost_usd: 0.001,
    success: true,
    runs: 1,
    ttft: { avg: 100, p50: 100, p95: 100, p99: 100 },
    tps: { avg: 50, p50: 50, p95: 50, p99: 50 },
    ...over,
  }
}

describe('cli: --help', () => {
  it('prints help and exits 0', async () => {
    const h = harness()
    const code = await run(['--help'], h.deps)
    expect(code).toBe(0)
    expect(h.out.join('\n')).toMatch(/quickdraw/)
    expect(h.out.join('\n')).toMatch(/bench/)
    expect(h.out.join('\n')).toMatch(/diff/)
  })
})

describe('cli: bench preflight', () => {
  it('exits 1 with "Set OPENAI_API_KEY" when key missing (no network)', async () => {
    const h = harness()
    const bench = vi.fn()
    const code = await run(['bench', '--providers', 'openai', '--runs', '1'], {
      ...h.deps,
      env: {}, // no keys, not dry-run
      runBenchmark: bench,
    })
    expect(code).toBe(1)
    expect(h.err.join('\n')).toMatch(/Set OPENAI_API_KEY/)
    expect(h.err.join('\n')).not.toMatch(/Bearer undefined/)
    expect(bench).not.toHaveBeenCalled()
  })

  it('names the anthropic key too', async () => {
    const h = harness()
    const code = await run(['bench', '--providers', 'anthropic', '--runs', '1'], {
      ...h.deps,
      env: {},
      runBenchmark: vi.fn(),
    })
    expect(code).toBe(1)
    expect(h.err.join('\n')).toMatch(/Set ANTHROPIC_API_KEY/)
  })
})

describe('cli: bench dry-run', () => {
  it('prints the plan and makes no calls', async () => {
    const h = harness()
    const bench = vi.fn()
    const code = await run(['bench', '--providers', 'openai,anthropic', '--runs', '2'], {
      ...h.deps,
      env: { DRY_RUN: 'true' },
      runBenchmark: bench,
    })
    expect(code).toBe(0)
    const text = h.out.join('\n')
    expect(text).toMatch(/DRY_RUN=true/)
    expect(text).toMatch(/Total planned calls: 4/)
    expect(bench).not.toHaveBeenCalled()
  })
})

describe('cli: bench live (mocked runBenchmark)', () => {
  it('runs the benchmark and prints a table with percentiles', async () => {
    const h = harness()
    const bench = vi.fn().mockResolvedValue([sampleResult()])
    const code = await run(['bench', '--providers', 'openai', '--runs', '1'], {
      ...h.deps,
      env: { OPENAI_API_KEY: 'sk-test' },
      runBenchmark: bench,
    })
    expect(code).toBe(0)
    expect(bench).toHaveBeenCalledTimes(1)
    const cfg = bench.mock.calls[0][0]
    expect(cfg.costCap).toBe(2)
    const text = h.out.join('\n')
    expect(text).toMatch(/TTFT avg\/p50\/p95\/p99/)
    expect(text).toMatch(/gpt-4o-mini/)
  })

  it('reads the prompt file when given', async () => {
    const h = harness()
    const bench = vi.fn().mockResolvedValue([sampleResult()])
    const code = await run(['bench', '--runs', '1', '--prompt-file', 'PROMPT.md'], {
      ...h.deps,
      env: { OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'sk' },
      readFile: () => '  hello from file  ',
      runBenchmark: bench,
    })
    expect(code).toBe(0)
    expect(bench.mock.calls[0][0].prompt).toBe('hello from file')
  })

  it('exits 1 if any provider run failed', async () => {
    const h = harness()
    const bench = vi.fn().mockResolvedValue([sampleResult({ success: false, error: 'boom' })])
    const code = await run(['bench', '--providers', 'openai', '--runs', '1'], {
      ...h.deps,
      env: { OPENAI_API_KEY: 'sk' },
      runBenchmark: bench,
    })
    expect(code).toBe(1)
  })

  it('rejects an unknown provider', async () => {
    const h = harness()
    const code = await run(['bench', '--providers', 'gemini', '--runs', '1'], {
      ...h.deps,
      env: { OPENAI_API_KEY: 'sk' },
      runBenchmark: vi.fn(),
    })
    expect(code).toBe(1)
    expect(h.err.join('\n')).toMatch(/Unknown provider/)
  })
})

describe('cli: diff', () => {
  const run1 = JSON.stringify([sampleResult({ ttft: { avg: 100, p50: 100, p95: 100, p99: 100 } })])
  const run2Regress = JSON.stringify([sampleResult({ ttft: { avg: 250, p50: 250, p95: 250, p99: 250 } })])

  it('exits 0 when there are no regressions', async () => {
    const h = harness()
    const files: Record<string, string> = { 'a.json': run1, 'b.json': run1 }
    const code = await run(['diff', 'a.json', 'b.json'], {
      ...h.deps,
      readFile: (p: string) => files[p],
    })
    expect(code).toBe(0)
    expect(h.out.join('\n')).toMatch(/no regressions/)
  })

  it('exits 2 when a regression is detected', async () => {
    const h = harness()
    const files: Record<string, string> = { 'a.json': run1, 'b.json': run2Regress }
    const code = await run(['diff', 'a.json', 'b.json'], {
      ...h.deps,
      readFile: (p: string) => files[p],
    })
    expect(code).toBe(2)
    expect(h.out.join('\n')).toMatch(/regressions detected/)
  })

  it('errors (exit 1) when an argument is missing', async () => {
    const h = harness()
    const code = await run(['diff', 'only-one.json'], {
      ...h.deps,
      readFile: () => '[]',
    })
    expect(code).toBe(1)
  })
})
