import { describe, it, expect } from 'vitest'
import { redactSecrets, sanitizeHttpError, requestTimeoutMs, isAbortError } from '../src/providers/http-error'

describe('redactSecrets', () => {
  it('redacts sk-, sk-ant-, sk-proj- and sk-live- keys', () => {
    const s = redactSecrets('key=sk-abcd1234 ant=sk-ant-XYZ789 proj=sk-proj-AbC_123 live=sk-live-FAKE42')
    expect(s).not.toMatch(/sk-abcd1234/)
    expect(s).not.toMatch(/sk-ant-XYZ789/)
    expect(s).not.toMatch(/sk-proj-AbC_123/)
    expect(s).not.toMatch(/sk-live-FAKE42/)
    expect(s).toContain('[REDACTED]')
  })

  it('leaves JSON parseable after redacting a Bearer token inside a string', () => {
    const doc = JSON.stringify({ error: 'got 401 with Authorization: Bearer abc.def-123' })
    const out = redactSecrets(doc)
    expect(() => JSON.parse(out)).not.toThrow()
    expect(out).not.toContain('abc.def-123')
  })

  it('redacts Bearer tokens', () => {
    expect(redactSecrets('Authorization: Bearer supersecrettoken')).not.toMatch(/supersecrettoken/)
  })
})

describe('sanitizeHttpError', () => {
  it('keeps type/code/message, redacts secrets, caps detail at 200', () => {
    const body = JSON.stringify({
      error: {
        type: 'authentication_error',
        code: 'invalid_api_key',
        message: 'Incorrect API key provided: sk-proj-LEAKED_SECRET_VALUE. ' + 'x'.repeat(400),
      },
    })
    const msg = sanitizeHttpError('OpenAI', 401, body)
    expect(msg).toMatch(/^OpenAI API error 401/)
    expect(msg).toMatch(/authentication_error/)
    expect(msg).not.toMatch(/sk-proj-LEAKED_SECRET_VALUE/)
    // "OpenAI API error 401: " prefix + at most 200 chars of detail.
    expect(msg.length).toBeLessThanOrEqual('OpenAI API error 401: '.length + 200)
  })

  it('falls back to the raw body (redacted) when it is not JSON', () => {
    const msg = sanitizeHttpError('Anthropic', 500, 'upstream failure for Bearer sk-ant-NOPE')
    expect(msg).toMatch(/Anthropic API error 500/)
    expect(msg).not.toMatch(/sk-ant-NOPE/)
  })
})

describe('requestTimeoutMs', () => {
  it('defaults to 120s and honors QUICKDRAW_TIMEOUT_MS', () => {
    expect(requestTimeoutMs({})).toBe(120_000)
    expect(requestTimeoutMs({ QUICKDRAW_TIMEOUT_MS: '5000' })).toBe(5000)
    expect(requestTimeoutMs({ QUICKDRAW_TIMEOUT_MS: 'nonsense' })).toBe(120_000)
  })
})

describe('isAbortError', () => {
  it('recognizes AbortError and TimeoutError', () => {
    const a = new Error('x'); a.name = 'AbortError'
    const t = new Error('x'); t.name = 'TimeoutError'
    expect(isAbortError(a)).toBe(true)
    expect(isAbortError(t)).toBe(true)
    expect(isAbortError(new Error('plain'))).toBe(false)
  })
})
