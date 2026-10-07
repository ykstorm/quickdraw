import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { APICallLogger } from '../src/logger'
import { runBenchmark } from '../src/benchmark'
import { sseResponse, timedOutResponse } from './fake-stream'

// runBenchmark with the real adapters and a fake fetch, so the whole path from
// the SSE body to the ledger row runs without a network.

const ORIGINAL_ENV = { ...process.env }
let file: string
let logger: APICallLogger

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
  process.env.OPENAI_API_KEY = 'sk-test'
  delete process.env.DRY_RUN
  file = path.join(os.tmpdir(), `quickdraw-fetch-${process.pid}-${Date.now()}.jsonl`)
  logger = new APICallLogger({ file, truncate: true })
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.unstubAllGlobals()
  fs.rmSync(file, { force: true })
})

const ledger = () => fs.readFileSync(file, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))

describe('runBenchmark over a fake fetch', () => {
  it('fails a stream whose usage reports output tokens but which sends no text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n',
          'data: {"type":"message_delta","usage":{"output_tokens":3}}\n',
          'data: [DONE]\n',
        ])
      )
    )
    const results = await runBenchmark({ providers: ['anthropic'], runs: 1 }, { logger, onProgress: () => {} })

    expect(results[0].success).toBe(false)
    expect(results[0].perRun?.[0].error).toBe('no content received')
    // Still billed: 20 input and 3 output tokens on claude-haiku-4-5.
    expect(ledger()[0]).toMatchObject({ success: false, error: 'no content received', cost_usd: 0.000035 })
  })

  it('prints a mid-stream timeout in the same shape as the other failures', async () => {
    process.env.QUICKDRAW_TIMEOUT_MS = '5000'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(timedOutResponse(['data: {"choices":[{"delta":{"content":"hey"}}]}\n'])))
    const seen: string[] = []
    await runBenchmark({ providers: ['openai'], runs: 1 }, { logger, onProgress: (m) => seen.push(m) })

    const message = 'OpenAI timeout after 5000 ms, 1 tokens received'
    expect(seen).toContain(`  fail openai run 1/1: ${message}`)
    expect(ledger()[0]).toMatchObject({ success: false, error: message })
  })
})
