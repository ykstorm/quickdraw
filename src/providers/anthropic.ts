import { ProviderStreamResult } from '../types'
import { assertApiKey } from '../preflight'
import { MAX_OUTPUT_TOKENS } from '../cost-tracker'
import { sanitizeHttpError, requestTimeoutMs, isAbortError } from './http-error'
import { readSSEData } from './sse'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'
const SYSTEM = 'You are a helpful assistant.'

export async function anthropicStream(
  prompt: string,
  onChunk?: (text: string) => void,
  model: string = DEFAULT_ANTHROPIC_MODEL
): Promise<ProviderStreamResult> {
  // Preflight: never send "Bearer undefined" / empty x-api-key.
  assertApiKey('anthropic')
  const apiKey = process.env.ANTHROPIC_API_KEY as string

  const start = Date.now()

  let response: Response
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
      }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    })
  } catch (err) {
    if (isAbortError(err)) throw new Error(`Anthropic request timed out after ${requestTimeoutMs()}ms`)
    throw err
  }

  if (!response.ok) {
    const err = await response.text()
    throw new Error(sanitizeHttpError('Anthropic', response.status, err))
  }

  if (!response.body) throw new Error('No response body')

  let fullText = ''
  let ttft_ms = 0
  let usagePromptTokens = 0
  let usageCompletionTokens = 0

  await readSSEData(response.body, (data) => {
    try {
      const event = JSON.parse(data)
      if (event.type === 'message_start') {
        // Prompt-token usage is on the initial message.
        const u = event.message?.usage
        if (u?.input_tokens != null) usagePromptTokens = u.input_tokens
        if (u?.output_tokens != null) usageCompletionTokens = u.output_tokens
      } else if (event.type === 'content_block_delta' && event.delta?.text) {
        if (ttft_ms === 0) ttft_ms = Date.now() - start
        fullText += event.delta.text
        if (onChunk) onChunk(event.delta.text)
      } else if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
        // Final cumulative output-token count.
        usageCompletionTokens = event.usage.output_tokens
      }
    } catch {
      // skip malformed lines
    }
  })

  const duration_ms = Date.now() - start

  // Prefer provider usage; fall back to char/4 estimate.
  const haveUsage = usagePromptTokens > 0 || usageCompletionTokens > 0
  const prompt_tokens = usagePromptTokens > 0
    ? usagePromptTokens
    : Math.ceil((prompt.length + SYSTEM.length) / 4)
  // Fallback completion estimate uses generated text length (char/4), matching
  // the prompt-token estimate — not the raw SSE delta-event count.
  const completion_tokens = usageCompletionTokens > 0 ? usageCompletionTokens : Math.ceil(fullText.length / 4)

  return {
    text: fullText,
    ttft_ms,
    duration_ms,
    prompt_tokens,
    completion_tokens,
    token_source: haveUsage ? 'usage' : 'estimate',
  }
}
