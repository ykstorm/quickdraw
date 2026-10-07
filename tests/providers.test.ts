import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openaiStream } from '../src/providers/openai'
import { anthropicStream } from '../src/providers/anthropic'
import { DryRunError, MissingApiKeyError } from '../src/preflight'
import { sseResponse, timedOutResponse } from './fake-stream'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.restoreAllMocks()
})

describe('openaiStream', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test'
    delete process.env.DRY_RUN
  })

  it('preflights: throws MissingApiKeyError without a key', async () => {
    delete process.env.OPENAI_API_KEY
    await expect(openaiStream('hi')).rejects.toBeInstanceOf(MissingApiKeyError)
  })

  it('sends no request under DRY_RUN, with or without a key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.DRY_RUN = 'true'
    await expect(openaiStream('hi')).rejects.toThrow(/DRY_RUN is set/)
    delete process.env.OPENAI_API_KEY
    await expect(openaiStream('hi')).rejects.toBeInstanceOf(DryRunError)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('parses content deltas and the usage field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n',
        'data: [DONE]\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await openaiStream('hi')
    expect(r.text).toBe('Hello')
    expect(r.prompt_tokens).toBe(11)
    expect(r.completion_tokens).toBe(7)
    expect(r.token_source).toBe('usage')
    // Bearer header should carry the real key, never "undefined".
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('falls back to char/4 estimate when usage is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse(['data: {"choices":[{"delta":{"content":"hey"}}]}\n', 'data: [DONE]\n'])
      )
    )
    const r = await openaiStream('hi')
    expect(r.token_source).toBe('estimate')
    expect(r.completion_tokens).toBe(1) // ceil(3 / 4): "hey" is 3 characters, estimated at 4 per token
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['nope'], false, 401)))
    await expect(openaiStream('hi')).rejects.toThrow(/OpenAI API error 401/)
  })

  it('never leaks an API key echoed in a 401 error body', async () => {
    const leaky = JSON.stringify({
      error: { type: 'invalid_request_error', message: 'bad key sk-proj-SHOULD_NOT_APPEAR_1234' },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([leaky], false, 401)))
    await expect(openaiStream('hi')).rejects.toThrow(/OpenAI API error 401/)
    await openaiStream('hi').catch((e: Error) => {
      expect(e.message).not.toMatch(/sk-proj-SHOULD_NOT_APPEAR_1234/)
    })
  })

  it('maps a request timeout to a clean failed-run error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        const e = new Error('The operation was aborted')
        e.name = 'TimeoutError'
        return Promise.reject(e)
      })
    )
    await expect(openaiStream('hi')).rejects.toThrow(/timed out/)
  })

  it('reports a timeout part-way through the answer with how much had arrived', async () => {
    process.env.QUICKDRAW_TIMEOUT_MS = '5000'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        timedOutResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n',
        ])
      )
    )
    // "Hello world" is 11 characters, ceil(11 / 4) = 3 tokens.
    await expect(openaiStream('hi')).rejects.toThrow(/^OpenAI timeout after 5000 ms, 3 tokens received$/)
  })

  it('passes any other stream error through unchanged', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('socket hang up'))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body } as unknown as Response))
    await expect(openaiStream('hi')).rejects.toThrow(/^socket hang up$/)
  })
})

describe('anthropicStream', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test'
    delete process.env.DRY_RUN
  })

  it('preflights: throws MissingApiKeyError without a key', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(anthropicStream('hi')).rejects.toBeInstanceOf(MissingApiKeyError)
  })

  it('sends no request under DRY_RUN, with or without a key', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    process.env.DRY_RUN = '1'
    await expect(anthropicStream('hi')).rejects.toThrow(/DRY_RUN is set/)
    delete process.env.ANTHROPIC_API_KEY
    await expect(anthropicStream('hi')).rejects.toBeInstanceOf(DryRunError)
    expect(fetchMock).toHaveBeenCalledTimes(0)
  })

  it('parses deltas and usage from message_start + message_delta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}\n',
        'data: {"type":"content_block_delta","delta":{"text":"Hi"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":" there"}}\n',
        'data: {"type":"message_delta","usage":{"output_tokens":9}}\n',
        'data: [DONE]\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await anthropicStream('hi')
    expect(r.text).toBe('Hi there')
    expect(r.prompt_tokens).toBe(20)
    expect(r.completion_tokens).toBe(9)
    expect(r.token_source).toBe('usage')
    expect(r.ttft_ms).toBeGreaterThanOrEqual(0)
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test')
  })

  it('reassembles a data line split across read() chunk boundaries', async () => {
    // The whole SSE body arrives as arbitrary byte slices that cut a `data:`
    // line in half. A naive per-chunk split would drop both halves; the carry
    // buffer must stitch them back so the delta and usage still register.
    const raw =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":0}}}\n' +
      'data: {"type":"content_block_delta","delta":{"text":"Hello world"}}\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":42}}\n' +
      'data: [DONE]\n'
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split at an offset that lands inside the content_block_delta line.
        const cut = raw.indexOf('Hello world') + 3
        controller.enqueue(encoder.encode(raw.slice(0, cut)))
        controller.enqueue(encoder.encode(raw.slice(cut)))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body, text: async () => raw } as unknown as Response))

    const r = await anthropicStream('hi')
    expect(r.text).toBe('Hello world')
    expect(r.completion_tokens).toBe(42)
  })

  it('uses a custom model id when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n']))
    vi.stubGlobal('fetch', fetchMock)
    await anthropicStream('hi', undefined, 'claude-sonnet-4-6')
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-4-6')
  })

  it('reports a timeout part-way through the answer with how much had arrived', async () => {
    process.env.QUICKDRAW_TIMEOUT_MS = '5000'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        timedOutResponse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n',
          'data: {"type":"content_block_delta","delta":{"text":"Hi there"}}\n',
        ])
      )
    )
    // "Hi there" is 8 characters, ceil(8 / 4) = 2 tokens.
    await expect(anthropicStream('hi')).rejects.toThrow(/^Anthropic timeout after 5000 ms, 2 tokens received$/)
  })
})
