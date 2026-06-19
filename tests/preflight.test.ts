import { describe, it, expect } from 'vitest'
import { assertApiKey, missingKeys, MissingApiKeyError, REQUIRED_KEY } from '../src/preflight'

describe('preflight', () => {
  it('maps providers to env vars', () => {
    expect(REQUIRED_KEY.openai).toBe('OPENAI_API_KEY')
    expect(REQUIRED_KEY.anthropic).toBe('ANTHROPIC_API_KEY')
  })

  it('throws MissingApiKeyError with a clean message when key is absent', () => {
    try {
      assertApiKey('openai', {})
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(MissingApiKeyError)
      expect((e as Error).message).toBe('Set OPENAI_API_KEY to benchmark openai.')
    }
  })

  it('throws when key is empty/whitespace', () => {
    expect(() => assertApiKey('anthropic', { ANTHROPIC_API_KEY: '   ' })).toThrow(MissingApiKeyError)
  })

  it('does not throw when key present', () => {
    expect(() => assertApiKey('openai', { OPENAI_API_KEY: 'sk-test' })).not.toThrow()
  })

  it('skips the check entirely in DRY_RUN', () => {
    expect(() => assertApiKey('openai', { DRY_RUN: 'true' })).not.toThrow()
  })

  it('missingKeys lists every absent var', () => {
    expect(missingKeys(['openai', 'anthropic'], {})).toEqual(['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'])
    expect(missingKeys(['openai', 'anthropic'], { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' })).toEqual([])
    expect(missingKeys(['openai'], { OPENAI_API_KEY: 'x' })).toEqual([])
  })

  it('missingKeys returns nothing in DRY_RUN', () => {
    expect(missingKeys(['openai', 'anthropic'], { DRY_RUN: 'true' })).toEqual([])
  })
})
