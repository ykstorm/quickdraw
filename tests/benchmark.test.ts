import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { ProviderStreamResult } from '../src/types'
import { APICallLogger } from '../src/logger'
import { percentile } from '../src/stats'

// Mock both providers so the orchestrator never touches the network.
const openaiStream = vi.fn()
const anthropicStream = vi.fn()

vi.mock('../src/providers/openai', () => ({
  openaiStream: (...a: unknown[]) => openaiStream(...a),
  DEFAULT_OPENAI_MODEL: 'gpt-4o-mini',
}))
vi.mock('../src/providers/anthropic', () => ({
  anthropicStream: (...a: unknown[]) => anthropicStream(...a),
  DEFAULT_ANTHROPIC_MODEL: 'claude-haiku-4-5',
}))

import { runBenchmark } from '../src/benchmark'

function streamResult(over: Partial<ProviderStreamResult> = {}): ProviderStreamResult {
  return {
    text: 'hello world',
    ttft_ms: 100,
    duration_ms: 1100,
    prompt_tokens: 10,
    completion_tokens: 50,
    token_source: 'usage',
    ...over,
  }
}

beforeEach(() => {
  openaiStream.mockReset()
  anthropicStream.mockReset()
})

describe('runBenchmark', () => {
  it('aggregates runs and reports percentiles', async () => {
    openaiStream
      .mockResolvedValueOnce(streamResult({ ttft_ms: 100 }))
      .mockResolvedValueOnce(streamResult({ ttft_ms: 200 }))
      .mockResolvedValueOnce(streamResult({ ttft_ms: 300 }))

    const results = await runBenchmark({ providers: ['openai'], runs: 3, guardrails: false })
    expect(results).toHaveLength(1)
    const r = results[0]
    expect(r.success).toBe(true)
    expect(r.runs).toBe(3)
    expect(r.model).toBe('gpt-4o-mini')
    expect(r.ttft?.avg).toBeCloseTo(200, 0)
    expect(r.ttft?.p50).toBe(200)
    expect(r.ttft?.p95).toBe(300)
    expect(r.perRun).toHaveLength(3)
    expect(openaiStream).toHaveBeenCalledTimes(3)
  })

  it('uses the configured model override', async () => {
    openaiStream.mockResolvedValue(streamResult())
    await runBenchmark({ providers: ['openai'], runs: 1, guardrails: false, model: 'gpt-4o' })
    expect(openaiStream).toHaveBeenCalledWith(expect.any(String), undefined, 'gpt-4o')
  })

  it('passes a custom prompt through to the provider', async () => {
    openaiStream.mockResolvedValue(streamResult())
    await runBenchmark({ providers: ['openai'], runs: 1, guardrails: false, prompt: 'CUSTOM PROMPT' })
    expect(openaiStream).toHaveBeenCalledWith('CUSTOM PROMPT', undefined, 'gpt-4o-mini')
  })

  it('still runs a later provider whose estimate fits after the ceiling stopped an earlier one', async () => {
    // Haiku reserves about $0.00256 a call, so a $0.0027 cap allows one call and
    // refuses the second. A gpt-4o-mini reservation is about $0.0003, which fits
    // the remaining budget, so openai runs all three times.
    anthropicStream.mockResolvedValue(streamResult({ prompt_tokens: 10, completion_tokens: 50 }))
    openaiStream.mockResolvedValue(streamResult())
    const results = await runBenchmark({ providers: ['anthropic', 'openai'], runs: 3, guardrails: false, costCap: 0.0027, prompt: 'hi' })
    expect(anthropicStream).toHaveBeenCalledTimes(1)
    expect(results[0].perRun?.map((r) => r.error ?? 'ok')).toEqual(['ok', 'skipped: cost ceiling reached'])
    expect(openaiStream).toHaveBeenCalledTimes(3)
    expect(results[1].success).toBe(true)
    expect(results[1].runs).toBe(3)
  })

  it('reports a provider whose estimate does not fit as skipped, not failed', async () => {
    // The openai runs fit a $0.002 cap; one Haiku reservation (about $0.00256) does not.
    anthropicStream.mockResolvedValue(streamResult())
    openaiStream.mockResolvedValue(streamResult())
    const results = await runBenchmark({ providers: ['openai', 'anthropic'], runs: 3, guardrails: false, costCap: 0.002, prompt: 'hi' })
    expect(openaiStream).toHaveBeenCalledTimes(3)
    expect(anthropicStream).toHaveBeenCalledTimes(0)
    expect(results[1].success).toBe(false)
    expect(results[1].error).toBe('skipped: cost ceiling reached')
  })

  it('counts a response with no content as a failed run, not a 0 ms TTFT', async () => {
    openaiStream.mockResolvedValue(streamResult({ text: '', completion_tokens: 0, ttft_ms: 0 }))
    const results = await runBenchmark({ providers: ['openai'], runs: 1, guardrails: false })
    expect(results[0].success).toBe(false)
    expect(results[0].perRun?.[0].error).toBe('no content received')
  })

  it('keeps a run whose text arrived with no output count, and estimates the count', async () => {
    const file = path.join(os.tmpdir(), `quickdraw-estimate-${Date.now()}.jsonl`)
    const logger = new APICallLogger({ file, truncate: true })
    try {
      // "hello world" is 11 characters, estimated at ceil(11 / 2) = 6 output tokens.
      openaiStream.mockResolvedValue(streamResult({ text: 'hello world', prompt_tokens: 10, completion_tokens: 0 }))
      const results = await runBenchmark({ providers: ['openai'], runs: 1 }, { logger, onProgress: () => {} })

      expect(results[0].success).toBe(true)
      expect(results[0].perRun?.[0].metrics.token_count).toBe(6)
      const [line] = fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
      expect(line).toMatchObject({ success: true, completion_tokens: 6, token_source: 'estimate' })
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  })

  it('writes a call with no output to the ledger as a failed run with its real cost', async () => {
    const file = path.join(os.tmpdir(), `quickdraw-empty-${Date.now()}.jsonl`)
    const logger = new APICallLogger({ file, truncate: true })
    try {
      // gpt-4o-mini: 1000 prompt tokens cost $0.00015, 50 output tokens $0.00003.
      openaiStream
        .mockResolvedValueOnce(streamResult({ prompt_tokens: 1000, completion_tokens: 50 }))
        .mockResolvedValueOnce(streamResult({ text: '', prompt_tokens: 1000, completion_tokens: 0, ttft_ms: 0 }))
      const results = await runBenchmark({ providers: ['openai'], runs: 2 }, { logger, onProgress: () => {} })

      expect(fs.existsSync(file)).toBe(true)
      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
      expect(lines).toHaveLength(2)
      expect(lines[1]).toMatchObject({ success: false, error: 'no content received', completion_tokens: 0, cost_usd: 0.00015 })
      // The provider total counts the empty call too, because it was paid for.
      expect(results[0].cost_usd).toBeCloseTo(0.00033, 6)
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  })

  it('refuses to run under DRY_RUN instead of calling a provider without a key', async () => {
    process.env.DRY_RUN = 'true'
    try {
      await expect(runBenchmark({ providers: ['openai'], runs: 1, guardrails: false })).rejects.toThrow(/DRY_RUN/)
      expect(openaiStream).toHaveBeenCalledTimes(0)
    } finally {
      delete process.env.DRY_RUN
    }
  })

  it('refuses the call entirely when even one reservation exceeds the cap', async () => {
    // Haiku max-output reservation (~$0.00256) alone exceeds a $0.001 cap, so the
    // ceiling is hit BEFORE any network call — the provider is never invoked.
    anthropicStream.mockResolvedValue(streamResult())
    const results = await runBenchmark({ providers: ['anthropic'], runs: 5, guardrails: false, costCap: 0.001 })
    expect(anthropicStream).toHaveBeenCalledTimes(0)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toMatch(/cost ceiling/i)
  })

  it('runs one call, then refuses the next when the budget is spent', async () => {
    // Reservation per haiku call (~$0.00256) fits a $0.0027 cap once; after the
    // first call settles at its real (much smaller) cost, the second reservation
    // pushes total over the cap and is refused before the call is made.
    anthropicStream.mockResolvedValue(streamResult({ prompt_tokens: 10, completion_tokens: 50 }))
    const results = await runBenchmark({
      providers: ['anthropic'],
      runs: 3,
      guardrails: false,
      costCap: 0.0027,
      prompt: 'hi',
    })
    expect(anthropicStream).toHaveBeenCalledTimes(1)
    const r = results[0]
    expect(r.success).toBe(true)
    expect(r.runs).toBe(1)
    // Settled cost is the real completion cost (10 in + 50 out on haiku), not the
    // reservation and not a fabricated $0.
    expect(r.cost_usd).toBeCloseTo(0.00026, 6)
  })

  it('writes a ledger whose ttft p50 re-derives to the aggregated result', async () => {
    const file = path.join(os.tmpdir(), `quickdraw-ledger-${Date.now()}.jsonl`)
    const logger = new APICallLogger({ file, truncate: true })
    try {
      openaiStream
        .mockResolvedValueOnce(streamResult({ ttft_ms: 100 }))
        .mockResolvedValueOnce(streamResult({ ttft_ms: 200 }))
        .mockResolvedValueOnce(streamResult({ ttft_ms: 300 }))
      const results = await runBenchmark({ providers: ['openai'], runs: 3 }, { logger })

      const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
      expect(lines).toHaveLength(3)
      // Every ledger line carries the fields needed to re-derive the summary.
      for (const l of lines) {
        expect(typeof l.ttft_ms).toBe('number')
        expect(typeof l.duration_ms).toBe('number')
        expect(typeof l.completion_tokens).toBe('number')
        expect(['usage', 'estimate']).toContain(l.token_source)
      }
      const ttftFromLedger = percentile(lines.map((l) => l.ttft_ms), 50)
      expect(ttftFromLedger).toBe(results[0].ttft?.p50)
    } finally {
      if (fs.existsSync(file)) fs.unlinkSync(file)
    }
  })

  it('records a failed run when the provider throws', async () => {
    openaiStream.mockRejectedValue(new Error('network boom'))
    const results = await runBenchmark({ providers: ['openai'], runs: 2, guardrails: false })
    expect(results[0].success).toBe(false)
    expect(results[0].error).toMatch(/network boom/)
  })

  it('redacts secrets from progress messages', async () => {
    openaiStream.mockRejectedValue(new Error('network boom for sk-proj-LEAK_1234'))
    const seen: string[] = []
    await runBenchmark({ providers: ['openai'], runs: 1 }, { onProgress: (m) => seen.push(m) })
    expect(seen.join(' ')).not.toMatch(/LEAK_1234/)
    expect(seen.join(' ')).toMatch(/fail openai run 1\/1: network boom for \[REDACTED\]/)
  })

  it('passes config.onChunk through to the provider stream', async () => {
    const seen: string[] = []
    openaiStream.mockImplementation(async (_p: string, onChunk?: (t: string) => void) => {
      if (onChunk) onChunk('abc')
      return streamResult()
    })
    const results = await runBenchmark({
      providers: ['openai'],
      runs: 1,
      onChunk: (t: string) => seen.push(t),
    })
    expect(results[0].success).toBe(true)
    expect(seen).toEqual(['abc'])
  })
})
