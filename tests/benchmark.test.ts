import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProviderStreamResult } from '../src/types'

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
    tokens: 50,
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

  it('halts when the cost ceiling is exceeded', async () => {
    // Each anthropic run: 1M input + 1M output => $6.00, cap is $1 -> first run trips it.
    anthropicStream.mockResolvedValue(
      streamResult({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 })
    )
    const results = await runBenchmark({ providers: ['anthropic'], runs: 5, guardrails: false, costCap: 1 })
    const r = results[0]
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/Cost ceiling exceeded/)
    // It should stop after the first failing run, not run all 5.
    expect(anthropicStream).toHaveBeenCalledTimes(1)
  })

  it('records a failed run when the provider throws', async () => {
    openaiStream.mockRejectedValue(new Error('network boom'))
    const results = await runBenchmark({ providers: ['openai'], runs: 2, guardrails: false })
    expect(results[0].success).toBe(false)
    expect(results[0].error).toMatch(/network boom/)
  })

  it('runs guardrail callback path without error', async () => {
    openaiStream.mockImplementation(async (_p: string, onChunk?: (t: string) => void) => {
      if (onChunk) onChunk('abc')
      return streamResult()
    })
    const results = await runBenchmark({ providers: ['openai'], runs: 1, guardrails: true })
    expect(results[0].success).toBe(true)
  })
})
