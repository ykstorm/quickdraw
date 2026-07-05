import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openaiStream } from '../src/providers/openai'
import { anthropicStream } from '../src/providers/anthropic'
import { MissingApiKeyError } from '../src/preflight'

/** Build a fetch Response whose body streams the given SSE lines. */
function sseResponse(lines: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line))
      controller.close()
    },
  })
  return {
    ok,
    status,
    body,
    text: async () => lines.join(''),
  } as unknown as Response
}

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
    expect(r.completion_tokens).toBe(1) // one content chunk
  })

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(['nope'], false, 401)))
    await expect(openaiStream('hi')).rejects.toThrow(/OpenAI API error 401/)
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
})
